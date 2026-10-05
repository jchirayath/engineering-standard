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
