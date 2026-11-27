# SoCloudyBro — Claude context

Chat app. Markup is in **`SoCloudyBro.html`**; scripts are in `js/`, styles in `css/`.

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
Vercel Production Branch is `scb/main` (set Nov 23 2026), so every push there deploys to production automatically. Before sending the HTML to Firebase the Action runs `scripts/csp_check.py` twice: against the repo's `vercel.json` and against the CSP header production is actually serving (waits up to 10 min), so a build the live CSP would block never reaches users.

## Files and load order (critical)
Scripts are plain (non-module) files sharing one global scope, loaded by `<script>` tags in `SoCloudyBro.html`. **Order matters**: top-level code may only use names from the same file or an earlier one.

| Folder | Contents |
|--------|----------|
| `js/core/` | config, errors, diagnostics, encryption, data |
| `js/auth/` | login, account, sign-in |
| `js/chat/`, `js/calls/`, `js/social/` | conversations, messages, voice, profiles and groups |
| `js/admin/`, `js/safety/`, `js/ui/`, `js/dashboard/` | admin tools, moderation, widgets, home dashboard |
| `js/privacy.js`, `js/consent.js` | load after the main files |
| `css/` | loaded in the order listed in the HTML; later files override earlier ones |

`init()` runs on `DOMContentLoaded` (end of `js/ui/widgets.js`), after every script has loaded. From earlier files, still guard names defined later:
```js
const orig = typeof someFn === 'function' ? someFn : null;
```

## After editing anything in `js/`, `css/` or inline code
```powershell
powershell -File scripts/update-csp-hashes.ps1
```
It updates the `?v=` stamps in the HTML and the CSP hashes. Commit those with your change, or the deploy check fails.

## CSP — run before every push that edits an inline `<script>`
`vercel.json` only allows inline scripts whose sha256 is listed. Editing ANY inline `<script>` in `SoCloudyBro.html` changes its hash, the browser blocks it, and the app freezes on the splash screen (happened Nov 22 2026). After editing, run:
```powershell
powershell -File scripts/update-csp-hashes.ps1
```
then commit `vercel.json` together with the HTML. Verify on the live site afterwards (the page must leave the splash).
The script also covers static `on*="..."` handlers. Handlers built inside JS strings must be constant text or the CSP blocks them: use `data-act` (click), `data-change` (select) or `.onclick =` instead of `onclick="..."` in `innerHTML`.
The CSP header is ~27 KB because every hash adds ~60 bytes. When `scripts/csp_check.py` warns it is getting large, run `powershell -File scripts/update-csp-hashes.ps1 -Prune` to drop unused hashes (safe: it keeps anything a JS-built handler could match).

## CSP — realtime database hosts (learned the hard way, Nov 24 2026)
Firebase RTDB does not stay on the database's own hostname: it hops to a shard host like `s-gke-euw1-nssi2-7.europe-west1.firebasedatabase.app`. `connect-src` (https + wss), `script-src` (long-poll fallback) and `frame-src` (long-poll iframe) therefore all need `*.europe-west1.firebasedatabase.app`, not just the exact hostnames. Listing exact hosts silently broke realtime for logged-in users (WebSocket blocked, ~10s startup, stale "Set up account" header).
**After ANY CSP change, test while LOGGED IN**, not just on the logged-out page: in the browser console run `firebase.database().ref('.info/connected').once('value',s=>console.log(s.val()))` (expect `true`) and check the console for `Connecting to ... violates` / `Framing ... violates` errors. Logged-out checks do not exercise realtime.
If the Firebase SDK ever records a WebSocket failure it caches `firebase:previous_websocket_failure` in localStorage and tries long-polling first on every load; the one-time reset near `firebase.initializeApp` clears it (bump `scb_ws_reset_vN` to re-run it for everyone).

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
