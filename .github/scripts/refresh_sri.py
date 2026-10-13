#!/usr/bin/env python3
"""
Nightly SRI hash refresh for SoCloudyBro.
Fetches the two CDN scripts, recomputes their SHA-384 hashes, and if
either changed updates integrity= in the HTML, recomputes all <script>
and <style> SHA-256 hashes, and rewrites vercel.json's CSP directive.

Outputs a GitHub Actions output variable:
  changed=true|false
  changed_scripts=<newline-separated list of changed script names>
"""
import hashlib, base64, json, os, re, sys, urllib.request

SCRIPTS = {
    'google-gsi': 'https://accounts.google.com/gsi/client',
    'cf-turnstile': 'https://challenges.cloudflare.com/turnstile/v0/api.js',
}

HTML_PATH = 'SoCloudyBro.html'
VERCEL_PATH = 'vercel.json'
GITHUB_OUTPUT = os.environ.get('GITHUB_OUTPUT', '')


def sha384_b64(data: bytes) -> str:
    return base64.b64encode(hashlib.sha384(data).digest()).decode()


def sha256_b64(data: bytes) -> str:
    return base64.b64encode(hashlib.sha256(data).digest()).decode()


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def set_output(key: str, value: str):
    if GITHUB_OUTPUT:
        with open(GITHUB_OUTPUT, 'a') as f:
            # Multi-line values use the heredoc syntax
            if '\n' in value:
                delim = 'EOF_DELIM'
                f.write(f'{key}<<{delim}\n{value}\n{delim}\n')
            else:
                f.write(f'{key}={value}\n')
    else:
        print(f'OUTPUT {key}={value!r}')


def main():
    html = open(HTML_PATH, 'r', encoding='utf-8').read()

    changed_scripts = []

    for name, url in SCRIPTS.items():
        print(f'Fetching {name} from {url} …', flush=True)
        try:
            content = fetch(url)
        except Exception as e:
            print(f'  ERROR: {e}', flush=True)
            continue

        new_hash = f'sha384-{sha384_b64(content)}'
        print(f'  hash: {new_hash}', flush=True)

        # Find the existing integrity= value for this script's src URL
        # Match the <script tag that contains this URL
        pattern = re.compile(
            r'(<script\s[^>]*?'
            + re.escape(url.split('/')[2])  # hostname as anchor
            + r'[^>]*?)(\bintegrity="sha384-[A-Za-z0-9+/=]+")',
            re.DOTALL
        )
        m = pattern.search(html)
        if not m:
            print(f'  WARNING: could not find integrity= for {name}', flush=True)
            continue

        old_attr = m.group(2)
        new_attr = f'integrity="{new_hash}"'

        if old_attr == new_attr:
            print(f'  unchanged.', flush=True)
        else:
            print(f'  CHANGED — updating {old_attr!r} → {new_attr!r}', flush=True)
            html = html[:m.start(2)] + new_attr + html[m.end(2):]
            changed_scripts.append(name)

    if not changed_scripts:
        set_output('changed', 'false')
        set_output('changed_scripts', '')
        print('No changes — all SRI hashes are current.')
        return

    # Write updated HTML
    with open(HTML_PATH, 'w', encoding='utf-8') as f:
        f.write(html)

    # Recompute all inline <script> and <style> hashes for CSP
    html_bytes = html.encode('utf-8')

    INLINE_SCRIPT = re.compile(rb'<script(?:\s(?:(?!src=)[^>])*)?>(.*?)</script>', re.DOTALL | re.IGNORECASE)
    script_hashes = [
        f"'sha256-{sha256_b64(m.group(1))}'"
        for m in INLINE_SCRIPT.finditer(html_bytes)
        if m.group(1).strip()
    ]

    STYLE_BLOCK = re.compile(rb'<style(?:\s[^>]*)?>(.*?)</style>', re.DOTALL | re.IGNORECASE)
    style_hashes = [
        f"'sha256-{sha256_b64(m.group(1))}'"
        for m in STYLE_BLOCK.finditer(html_bytes)
        if m.group(1).strip()
    ]

    print(f'Script hashes: {len(script_hashes)}, style hashes: {len(style_hashes)}')

    # Rebuild CSP
    new_csp = (
        "default-src 'self'; "
        "script-src 'self' " + " ".join(script_hashes) + " "
        "https://accounts.google.com https://cdn.jsdelivr.net "
        "https://cdnjs.cloudflare.com https://challenges.cloudflare.com "
        "https://www.gstatic.com; "
        "style-src 'self' " + " ".join(style_hashes) + " "
        "https://fonts.googleapis.com https://accounts.google.com; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "img-src 'self' data: blob: https:; "
        "media-src 'self' data: blob: https:; "
        "connect-src 'self' https: wss:; "
        "frame-src https://accounts.google.com https://challenges.cloudflare.com; "
        "frame-ancestors 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "report-uri https://socloudybro-firebase-rules.steveemil7.workers.dev/csp-report"
    )

    with open(VERCEL_PATH, 'r') as f:
        vercel = json.load(f)

    for header_obj in vercel['headers']:
        for h in header_obj['headers']:
            if h['key'] == 'Content-Security-Policy':
                h['value'] = new_csp

    with open(VERCEL_PATH, 'w') as f:
        json.dump(vercel, f, indent=2)

    print('vercel.json updated.')
    set_output('changed', 'true')
    set_output('changed_scripts', '\n'.join(changed_scripts))


if __name__ == '__main__':
    main()
