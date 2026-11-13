#!/usr/bin/env python3
"""Send the daily scout summary by email: the same method as netinventory.

SMTP settings live in the macOS Keychain (service "engineering-standard-email", one account per field). They are
never stored in the repo or in an environment file. When no password is stored, or SMTP fails, the message goes
out through Mail.app's own account instead. Elsewhere (Linux) the settings go in ~/.engineering-standard/email.json,
readable by its owner only. Standard library only.

  python3 -I bin/scout-mail.py set                     prompt for the settings (blank password = use Mail.app)
  python3 -I bin/scout-mail.py import-netinv           copy netinventory's email settings (Keychain netinv-cloud-email)
  python3 -I bin/scout-mail.py status                  which settings are stored (never prints the password)
  python3 -I bin/scout-mail.py send --subject S --body-file F
  python3 -I bin/scout-mail.py test                    send a test message
"""
import argparse, getpass, json, os, shutil, ssl, subprocess, sys
from pathlib import Path

SERVICE = "engineering-standard-email"
NETINV_SERVICE = "netinv-cloud-email"
FIELDS = [("smtp_host", False, "SMTP server (Gmail: smtp.gmail.com)"),
          ("smtp_port", False, "SMTP port (587 = STARTTLS, 465 = SSL)"),
          ("username", False, "SMTP login (your email address)"),
          ("password", True, "SMTP password (Gmail: an app password; blank = send through Mail.app)"),
          ("to", False, "Send the scout summary to (email address)")]
CRED_FILE = Path(os.environ.get("STANDARD_EMAIL_FILE", Path.home() / ".engineering-standard" / "email.json"))


def _keychain():
    return sys.platform == "darwin" and shutil.which("security") is not None


def kc_get(account, service=SERVICE):
    if not _keychain():
        try:
            return json.loads(CRED_FILE.read_text()).get(account) or None
        except (OSError, ValueError):
            return None
    r = subprocess.run(["security", "find-generic-password", "-s", service, "-a", account, "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return r.stdout.rstrip("\n") or None


def kc_set(account, secret, service=SERVICE):
    if not _keychain():
        CRED_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            d = json.loads(CRED_FILE.read_text())
        except (OSError, ValueError):
            d = {}
        d[account] = secret
        fd = os.open(CRED_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(d, f)
        return
    # The secret goes to `security -i` on stdin, never on argv (argv is visible to every local process via ps).
    if any(c in secret for c in "\r\n\0"):
        raise ValueError(f"{account}: line breaks are not allowed")
    q = lambda s: '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    cmd = f"add-generic-password -U -s {q(service)} -a {q(account)} -l {q('engineering-standard email ' + account)} -w {q(secret)}\n"
    r = subprocess.run(["security", "-i"], input=cmd, capture_output=True, text=True)
    if r.returncode != 0 or "error" in (r.stderr + r.stdout).lower():
        raise RuntimeError(f"Keychain write failed for {account}: {(r.stderr or r.stdout).strip()[:200]}")


def kc_delete(account):
    if not _keychain():
        try:
            d = json.loads(CRED_FILE.read_text())
            d.pop(account, None)
            CRED_FILE.write_text(json.dumps(d))
        except (OSError, ValueError):
            pass
        return
    subprocess.run(["security", "delete-generic-password", "-s", SERVICE, "-a", account], capture_output=True, text=True)


def settings():
    return {f: kc_get(f) for f, _s, _p in FIELDS}


# Arguments go in as argv, never spliced into the script, so a subject or body with quotes in it cannot break
# (or inject into) the AppleScript.
MAIL_APP_SCRIPT = """on run argv
  set {theSubject, theBody, theTo, theFrom} to argv
  tell application "Mail"
    set m to make new outgoing message with properties {subject:theSubject, content:theBody, visible:false}
    if theFrom is not "" then set sender of m to theFrom
    tell m to make new to recipient at end of to recipients with properties {address:theTo}
    send m
  end tell
end run"""


def send_via_mail_app(subject, body, to, sender=""):
    if sys.platform != "darwin":
        return False, "Mail.app is macOS only"
    try:
        r = subprocess.run(["osascript", "-", subject, body, to, sender or ""], input=MAIL_APP_SCRIPT,
                           capture_output=True, text=True, timeout=60)
    except Exception as e:  # noqa: BLE001
        return False, f"Mail.app: {e}"
    if r.returncode != 0:
        return False, f"Mail.app: {(r.stderr or r.stdout).strip()}"
    return True, "sent via Mail.app"


def send_smtp(subject, body, c):
    import smtplib
    from email.message import EmailMessage
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, c["username"], c["to"]
    msg.set_content(body)
    try:
        port, ctx = int(c["smtp_port"]), ssl.create_default_context()
        if port == 465:
            server = smtplib.SMTP_SSL(c["smtp_host"], port, context=ctx, timeout=20)
        else:
            server = smtplib.SMTP(c["smtp_host"], port, timeout=20)
            server.starttls(context=ctx)          # never sends the login in clear text
        with server:
            server.login(c["username"], c["password"])
            server.send_message(msg)
        return True, "sent"
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def send_email(subject, body):
    """SMTP when a full login is stored, otherwise (or when SMTP fails) Mail.app. Returns (ok, message)."""
    s = settings()
    if not s.get("to"):
        return False, "email not configured; run: python3 -I bin/scout-mail.py set (or import-netinv)"
    subject = subject.replace("\r", " ").replace("\n", " ")[:200]   # no header injection
    if all(s.get(f) for f, _s, _p in FIELDS):
        ok, msg = send_smtp(subject, body, s)
        if ok:
            return ok, msg
        ok2, mail_msg = send_via_mail_app(subject, body, s["to"], s.get("username"))
        return ok2, (f"{mail_msg} (SMTP failed: {msg})" if ok2 else f"SMTP: {msg}; {mail_msg}")
    return send_via_mail_app(subject, body, s["to"], s.get("username"))


def cmd_set(_a):
    for field, secret, prompt in FIELDS:
        val = getpass.getpass(f"{prompt}: ") if secret else input(f"{prompt}: ").strip()
        if not val and field == "password":
            kc_delete(field)
            continue
        if not val:
            print(f"  aborted: '{field}' empty")
            return 1
        kc_set(field, val)
    print("saved" + (" in the Keychain" if _keychain() else f" in {CRED_FILE}"))


def cmd_import_netinv(_a):
    if not _keychain():
        print("import-netinv reads the macOS Keychain; on this system run: set")
        return 1
    got = {f: kc_get(f, NETINV_SERVICE) for f, _s, _p in FIELDS}
    if not got.get("to"):
        print(f"netinventory has no email settings (Keychain service {NETINV_SERVICE}); run: set")
        return 1
    for f, v in got.items():
        if v:
            kc_set(f, v)
        else:
            kc_delete(f)
    print(f"copied {', '.join(f for f, v in got.items() if v)} from netinventory "
          f"({'SMTP' if all(got.values()) else 'Mail.app'} delivery)")


def cmd_status(_a):
    s = settings()
    for f, secret, _p in FIELDS:
        print(f"  {f:9} {'(set)' if secret and s[f] else (s[f] or '—')}")
    print("  delivery:", "SMTP, Mail.app fallback" if all(s.values()) else "Mail.app" if s.get("to") else "not configured")


def cmd_send(a):
    body = Path(a.body_file).read_text() if a.body_file else sys.stdin.read()
    ok, msg = send_email(a.subject, body)
    print(f"email: {msg}")
    return 0 if ok else 1


def cmd_test(_a):
    ok, msg = send_email("[engineering-standard] scout email test", "If you can read this, the daily scout can email you.")
    print(f"email: {msg}")
    return 0 if ok else 1


def main():
    p = argparse.ArgumentParser(description="Email for the engineering-standard daily scout")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("set").set_defaults(fn=cmd_set)
    sub.add_parser("import-netinv").set_defaults(fn=cmd_import_netinv)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("test").set_defaults(fn=cmd_test)
    s = sub.add_parser("send")
    s.add_argument("--subject", required=True)
    s.add_argument("--body-file")
    s.set_defaults(fn=cmd_send)
    a = p.parse_args()
    return a.fn(a) or 0


if __name__ == "__main__":
    sys.exit(main())
