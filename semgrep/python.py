import os
import requests


def f(cur, uid):
    # ruleid: std.py.print
    print("hello")
    # ok: std.py.print
    log.info("thing.done", uid=uid)
    # ruleid: std.py.environ
    url = os.environ["API_URL"]
    # ruleid: std.py.environ
    key = os.getenv("KEY")
    # ruleid: std.py.requests-no-timeout
    requests.get("https://example.com")
    # ok: std.py.requests-no-timeout
    requests.get("https://example.com", timeout=5)
    # ruleid: std.py.sql-string
    cur.execute(f"select * from t where id = {uid}")
    # ruleid: std.py.sql-string
    cur.execute("select * from t where id = %s" % uid)
    # ok: std.py.sql-string
    cur.execute("select * from t where id = %s", (uid,))
    # ruleid: std.py.tls-bypass
    requests.get("https://x", verify=False, timeout=5)
    # ruleid: std.py.swallowed-exception
    try:
        work()
    except ValueError:
        pass
    # ok: std.py.swallowed-exception
    try:
        work()
    except ValueError:
        log.exception("work.failed")


def pitfalls(password, data, cmd):
    import random, hashlib, pickle, yaml, subprocess, jwt
    # ruleid: std.py.insecure-random
    reset_token = str(random.random())
    # ok: std.py.insecure-random
    delay = random.uniform(0, 1)
    # ruleid: std.py.weak-password-hash
    h = hashlib.sha256((salt + password).encode())
    # ok: std.py.weak-password-hash
    etag = hashlib.sha256(data)
    # ruleid: std.py.unsafe-deserialization
    obj = pickle.loads(data)
    # ruleid: std.py.unsafe-deserialization
    cfg = yaml.load(data)
    # ok: std.py.unsafe-deserialization
    cfg2 = yaml.safe_load(data)
    # ruleid: std.py.shell-true
    subprocess.run(cmd, shell=True, timeout=5)
    # ok: std.py.shell-true
    subprocess.run(["ls", "-l"], timeout=5)
    # ruleid: std.py.jwt-unverified
    claims = jwt.decode(token, options={"verify_signature": False})


def crypto_controls(key, data):
    import hashlib
    from Crypto.Cipher import AES
    # ruleid: std.py.weak-crypto
    d = hashlib.md5(data).hexdigest()
    # ok: std.py.weak-crypto
    etag = hashlib.md5(data, usedforsecurity=False).hexdigest()
    # ruleid: std.py.weak-crypto
    c = AES.new(key, AES.MODE_ECB)
    # ok: std.py.weak-crypto
    g = AES.new(key, AES.MODE_GCM)
