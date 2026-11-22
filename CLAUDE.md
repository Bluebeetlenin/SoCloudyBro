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

## CSP — run before every push that edits an inline `<script>`
`vercel.json` only allows inline scripts whose sha256 is listed. Editing ANY inline `<script>` in `SoCloudyBro.html` changes its hash, the browser blocks it, and the app freezes on the splash screen (happened Nov 22 2026). After editing, run:
```powershell
powershell -File scripts/update-csp-hashes.ps1
```
then commit `vercel.json` together with the HTML. Verify on the live site afterwards (the page must leave the splash).

## CSP details
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

## Product rules
- **No money features, ever.** No payments, crypto, NFTs, paid gifts, tipping, subscriptions, premium tiers or ads in SCB. Don't propose or build them, and don't add integrations that need them.

## Known remaining issues
- Firebase `.on(...)` listeners now all have an error callback (fixed Nov 2026). Keep it that way: pass `(err)=>console.warn(...)` as the last argument to every new `.on()`.
- All dynamic `onclick=` strings in `innerHTML` were removed (Nov 2026). JS-built UI uses `data-act` + the delegated click handler at the end of Block F (before `init();`), or `.onclick =` when `stopPropagation` is needed.
- Modals: `openModal`/`closeModal` manage the z-stack, focus-in and focus-restore; a Tab trap and `a11yEnhance()` (dialog roles, labels) live at the end of Block F.
- Unfixed: the `button-label` duplicate ID comes from Google's sign-in widget, not our code.
