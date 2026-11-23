#!/usr/bin/env python3
"""Check that every inline <script> and static on*="..." handler in
SoCloudyBro.html is allowed by a CSP.

They are only allowed if their sha256 is listed in the CSP. A missing script
freezes the app on the splash screen; a missing handler makes its button
silently do nothing.

Usage:
  csp_check.py repo                 check against vercel.json in the repo
  csp_check.py live URL [SECONDS]   check against the Content-Security-Policy
                                    header URL actually serves; poll up to
                                    SECONDS (default 600) while Vercel deploys

Exit code 0 = all hashes present, 1 = something missing (or timed out).
"""
import base64
import hashlib
import html as htmllib
import re
import subprocess
import sys
import time

HTML_PATH = "SoCloudyBro.html"
VERCEL_JSON = "vercel.json"


def _hash(text):
    digest = base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode()
    return "sha256-" + digest


def inline_script_hashes():
    """Hashes the CSP must allow: inline <script> bodies and static on*="..." handlers.

    Returns a list of (hash, line, size_or_text) tuples.
    """
    page = open(HTML_PATH, encoding="utf-8").read().replace("\r", "")
    script_rx = re.compile(r"<script(?P<attrs>[^>]*)>(?P<body>.*?)</script>", re.I | re.S)
    found = []

    # 1) inline <script> blocks
    for m in script_rx.finditer(page):
        if re.search(r"src\s*=", m.group("attrs")):
            continue
        body = m.group("body")
        if not body.strip():
            continue
        line = page[: m.start()].count("\n") + 1
        found.append((_hash(body), line, "script, %d chars" % len(body)))

    # 2) static inline event handlers, outside <script> bodies. The browser
    #    hashes the attribute value after HTML-entity decoding.
    markup = script_rx.sub("", page)
    attr_rx = re.compile(r"""\son[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I | re.S)
    for m in attr_rx.finditer(markup):
        value = m.group(1) if m.group(1) is not None else m.group(2)
        value = htmllib.unescape(value)
        found.append((_hash(value), 0, "handler: " + value[:60]))
    return found


def missing_from(policy_text):
    return [h for h in inline_script_hashes() if h[0] not in policy_text]


def report(missing, where):
    print("❌ Inline script/handler hashes missing from " + where + ":", file=sys.stderr)
    for token, line, what in missing:
        where_txt = ("line %d, " % line) if line else ""
        print("   %s  (%s%s)" % (token, where_txt, what), file=sys.stderr)


def fetch_live_csp(url):
    # -sI = headers only, -L follows redirects; return every CSP header line.
    out = subprocess.run(
        ["curl", "-sIL", "--max-time", "20", url],
        capture_output=True, text=True,
    ).stdout
    lines = [l for l in out.splitlines() if l.lower().startswith("content-security-policy")]
    return "\n".join(lines)


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("repo", "live"):
        print(__doc__)
        return 2

    if sys.argv[1] == "repo":
        policy = open(VERCEL_JSON, encoding="utf-8").read()
        missing = missing_from(policy)
        if missing:
            report(missing, VERCEL_JSON + " (CSP)")
            print("\nFix: run  powershell -File scripts/update-csp-hashes.ps1  then commit vercel.json",
                  file=sys.stderr)
            return 1
        print("✅ repo: all inline script and handler hashes are in vercel.json")
        # Every hash adds ~60 bytes to a response header. The platform limit is
        # not documented in what we checked, so warn well before ~32 KB.
        size = len(policy)
        if size > 28000:
            print("⚠️  vercel.json is %d bytes; the CSP header is getting large. "
                  "Run: powershell -File scripts/update-csp-hashes.ps1 -Prune" % size)
        return 0

    url = sys.argv[2] if len(sys.argv) > 2 else "https://socloudybro.vercel.app/"
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 600
    deadline = time.time() + limit
    attempt = 0
    while True:
        attempt += 1
        policy = fetch_live_csp(url)
        if not policy:
            print("attempt %d: no CSP header returned by %s" % (attempt, url))
            missing = inline_script_hashes()  # treat as nothing allowed yet
        else:
            missing = missing_from(policy)
            if not missing:
                print("✅ live: %s serves a CSP that allows every inline script (attempt %d)" % (url, attempt))
                return 0
            print("attempt %d: %d hash(es) not yet in the live CSP" % (attempt, len(missing)))
        if time.time() >= deadline:
            break
        time.sleep(15)

    report(missing, "the live CSP at " + url)
    print(
        "\nProduction is not serving the matching vercel.json yet, so deploying this HTML\n"
        "would freeze the app on the splash screen for everyone.\n"
        "Fix: promote the newest Vercel deployment to Production (or set Production Branch\n"
        "to scb/main), then re-run this workflow with 'Run workflow'.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
