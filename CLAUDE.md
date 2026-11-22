# SoCloudyBro — Claude context

Single-file chat app. All code lives in **`SoCloudyBro.html`** (~30K lines, ~1.8 MB).

## First thing every session
There are unpushed commits on `scb/main`. Push them immediately:
```bash
git push origin scb/main
```
`.claude/settings.json` already grants `Bash(git push*)` permission so this works without prompts.

## Branches
- `scb/main` — production. Always push here.
- `claude/file-error-check-test-41ozdr` — dev/isolated changes only.

## Deploy pipeline
Push `scb/main` → GitHub Action → gzip HTML → Cloudflare Worker → Firebase RTDB `admin_site/html`. App auto-updates via site-update banner. No Vercel action needed for content changes.

## Script blocks (critical)
| Block | Lines | Contents |
|-------|-------|----------|
| F (main) | 5535–28378 | All core functions |
| G | 28564–30164 | Privacy, slash palette, zero-retention |
| H | 30247–30272 | Cookie consent IIFE |

**Cross-block rule:** Top-level code in Block G runs after F, but bare name lookups can still throw. Always guard:
```js
const orig = typeof someFn === 'function' ? someFn : null;
```
Root cause of the splash-screen force-dismiss bug (fixed Nov 2026 — `onMsgInput`, `msgKeydown`).

## CSP
`vercel.json` has `Content-Security-Policy` with `unsafe-hashes` + 522 sha256 hashes for static `on*=` handlers. Dynamic `onclick=` via `innerHTML` are NOT hashed → console spam. Fix: always use `.onclick =` property or `addEventListener` in JS-built UI. Static HTML `onclick=` are fine (they're hashed).

## Banner system
`_bannerRow(id)` → adds row to `#top-banner-stack`. CSS classes for buttons:
- `.tbr-btn .tbr-btn-action` — primary action (white bg)
- `.tbr-btn .tbr-btn-ghost` — secondary (semi-transparent)
- `.tbr-dismiss` — ✕ close button
- `.tbr-progress` / `.tbr-progress-fill` — countdown bar

Never use `onclick=` strings in banner innerHTML. Use `.onclick =` on created elements.

## Key CSS variables
`--accent:#5A52D5` · `--bg:#12161a` · `--surface:#1e252b` · `--danger:#d13438` · `--border2` · `--shadow-lg` · `--r-card:8px`

## Firebase
Project: `socloudybro-b8606`. Owner: `bluebeetlenin01@gmail.com`. RTDB: `europe-west1`.
Do NOT run destructive operations on live production Firebase data.

## User preferences (Emil)
- Wants changes pushed immediately after each commit — don't leave things unpushed.
- Prefers staying in the same chat session rather than starting fresh.
- Wants fixes AND improvements in the same session — don't just find issues, fix them.
- Keep responses short and direct. No lengthy explanations unless asked.
- Wants the app to look and feel polished — visual improvements are always welcome.
- Public speaking coach — keep language clear, confident, no filler.

## Known remaining issues
- 8 Firebase `.on('value', cb)` listeners have no error callback (silent failure on rules denial): lines 13455, 13551, 13582, 13857, 13926, 13974, 19585, 27612
- CSP banner onclick fixes done for: security-setup, site-update, edit-bar, key-change banners. Birthday banner was already clean.
