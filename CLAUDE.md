# SoCloudyBro

Single-file chat app. All code lives in **`SoCloudyBro.html`** (~30K lines, ~1.8 MB).

## Branches
- `scb/main` — production. Push here to deploy.
- `claude/file-error-check-test-41ozdr` — dev branch for isolated changes.

## Deploy pipeline
Push to `scb/main` → GitHub Action (`.github/workflows/remote-deploy.yml`) → gzip HTML → POST to Cloudflare Worker → Firebase RTDB (`admin_site/html`). The app auto-applies updates via a site-update banner. No Vercel redeploy needed for content changes.

## Script block structure (critical)
Two large inline `<script>` blocks:
- **Block F** lines 5535–28378 — main app. All core functions defined here.
- **Block G** lines 28564–30164 — privacy prefs, slash palette, zero-retention, etc.

**Cross-block rule:** Block G runs after Block F, but bare name references at the top level of Block G can throw `ReferenceError` if the name isn't on `window`. Always guard with `typeof`:
```js
// BAD — throws if onMsgInput isn't resolved yet
const orig = onMsgInput;

// GOOD
const orig = typeof onMsgInput === 'function' ? onMsgInput : null;
```
This was the root cause of the splash-screen force-dismiss bug (fixed Nov 2026).

## CSP
`vercel.json` has a `Content-Security-Policy` header with `'unsafe-hashes'` and 522 sha256 hashes covering all static `on*=` inline handlers in the HTML. Dynamic `onclick=` strings injected via `innerHTML` at runtime (banners) are NOT covered — they generate CSP console warnings but still work. Fix: use `addEventListener` instead of `onclick=` strings in banner-building functions.

## Key CSS variables
`--accent:#5A52D5` · `--bg:#12161a` · `--surface:#1e252b` · `--danger:#d13438` · `--border2` · `--shadow-lg`

## Banner system
`_bannerRow(id)` creates a row in `#top-banner-stack`. Use CSS classes `.tbr-btn`, `.tbr-btn-action`, `.tbr-btn-ghost`, `.tbr-dismiss`, `.tbr-progress`, `.tbr-progress-fill` for banner buttons. Do not use inline styles on banner buttons.

## Firebase
Project: `socloudybro-b8606`. Owner: `bluebeetlenin01@gmail.com`.
RTDB region: `europe-west1`. Do not run destructive operations on live production data.

## Known issues (not yet fixed)
- Dynamic banner `onclick=` strings cause CSP console spam (~6 banner functions need `addEventListener` refactor)
- 8 Firebase `.on('value', cb)` listeners have no error callback (silent failure on rules denial)
