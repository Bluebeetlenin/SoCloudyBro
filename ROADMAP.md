# SoCloudyBro feature roadmap

Built from four research reports on WhatsApp, Telegram, Signal, iMessage, Discord and Slack (Nov 2026), checked against what `SoCloudyBro.html` already does.

**How to read this**
- **Evidence** counts how many of the 4 reports back the item (4/4 = all of them).
- **Effort**: S = under a day, M = a few days, L = a week or more.
- "Already in the app" was checked by keyword search of the code, so treat it as a strong hint, not proof. Confirm in the live app before skipping an item.
- The reports disagree on some numbers (user counts, dates) and cite a few things I could not verify, such as a 2026 iMessage CVE number and "iOS 27". I only used points that two or more reports agree on, and ignored the shaky ones.

---

## Already in the app. Do not build again

Scheduled send, disappearing/self-destruct messages, pinned messages, reply/quote, threads, polls, edit message, reactions, voice channels, view-once media, usernames, parental approval for minors, birthdate/age checks, E2EE and encrypted backups, quiet hours, translation, summaries, screenshot protection, key-change warnings, 2FA, passkeys, face login, chat lock, meetings, business bot, slash commands, stories/status, GIFs, call history, block/report, spam handling, typing-race activity.

This is most of the "table stakes" list in the reports. The roadmap below is only the gaps.

---

## P0. Do first: high evidence, low effort

| # | Feature | Why | Evidence | Effort |
|---|---------|-----|----------|--------|
| 1 | **Per-contact read receipts and online status** (everyone / contacts / nobody, per chat) | Today these are single global switches (`readReceipts`, `typingIndicators`, `showOnline`). Research ties read receipts to anxiety and lost sleep, and the "tunable receipts" idea is still not standard anywhere. This is a wellbeing and privacy selling point. | 3/4 | S-M |
| 2 | **Chat folders / filter chips** (All, Unread, Groups, Favourites, custom) | No folders found in the code. WhatsApp ships filters, Signal is adding folders, and users ask for them everywhere. | 2/4 | M |
| 3 | **Plain-language "what is protected" panel** per chat (encrypted or not, what the server can see, when data is deleted) | Telegram's biggest trust failure is users assuming chats are encrypted. Being explicit is cheap and builds trust. | 4/4 | S |
| 4 | **Per-chat notification controls** (mute until, schedule, batch group pings) | Notification overload is the top complaint on Slack and Discord. Only global quiet hours and spam mutes exist today. | 3/4 | M |

## P1. Next: real gaps, moderate effort

| # | Feature | Why | Evidence | Effort |
|---|---------|-----|----------|--------|
| 5 | **Message requests inbox** for unknown senders (accept / delete / block before they can message you) | iMessage's unknown-sender filtering is a top safety feature and cuts spam and grooming. No equivalent found. | 3/4 | M |
| 6 | **Slow mode and group health tools** (post limits, batched notifications, mute-by-default for large groups) | Group chats are a documented stress source and no app markets this well. | 2/4 | M |
| 7 | **Ban/restriction appeal flow with a human review queue** | "Banned with no explanation or appeal" is the most-hated behaviour on Telegram and Discord. Only one mention of appeals in the code. | 3/4 | M |
| 8 | **Teen safety defaults**: blur sensitive media, warn on a first DM from a stranger, guardian notice on reports | Builds on the parental approval you already have. Regulators (Ofcom, EU DSA, KOSA) are moving here. | 4/4 | M-L |
| 9 | **Data export** ("download my data") | None found. Needed for GDPR-style expectations and builds trust. | 1/4 | M |

## P2. Later: differentiators

| # | Feature | Why | Evidence | Effort |
|---|---------|-----|----------|--------|
| 10 | **Ambient AI only**: opt-in thread summaries, "catch me up", reply suggestions. Never a bot inside a conversation unasked. | Users accept background AI and reject forced chatbots (WhatsApp, Slack backlash). Be explicit about what data AI sees. | 3/4 | M-L |
| 11 | **Accessibility pass 2**: reduce-motion that keeps some effects, screen-reader testing of chat and calls, haptic/flash alerts | Only 2 reduce-motion mentions found. The first pass (dialog roles, labels, focus) is already done. | 2/4 | M |
| 12 | **Check-in / safety timer** (share arrival, alert if no response) | iMessage's Check In is liked and underserved elsewhere. Needs checking whether a version exists. | 2/4 | M |
| 13 | **Metadata minimisation review** (what the Firebase records reveal about who talks to whom, and when) | Signal's real edge is metadata, not just content. A review comes before any redesign. | 3/4 | L |
| 14 | **Larger file sharing** with clear limits | Telegram's 2 GB is loved and 100 MB limits are resented. Depends on storage cost. | 2/4 | M |

## P3. Watch, do not build yet

- **Post-quantum encryption.** Signal did it, but it matters only once the base protocol is settled.
- **Federation / bridging** (Matrix-style). Large effort and a hosting burden for a single-file app.
- **Real-time text for deaf users.** Worth doing only if you have users who need it.

## Product rule: no money

SoCloudyBro will have **no payments, crypto, NFTs, gifts with a price, tipping, subscriptions, paid tiers, ads or any other money feature**. This is your decision, and it overrides the reports.

- Anything in the research that depends on money is excluded: Telegram Stars and TON, collectible gifts, Premium tiers, Discord Nitro and server subscriptions, Apple Cash, Signal payments, Slack's paid plans.
- The only item that touched this was larger file sharing (P2, item 14). Decide its limits on storage cost alone, with no paid upgrade.
- A keyword search of the app found no payment, billing or crypto-currency code. The "crypto" matches are the Web Crypto API used for password hashing and encryption.

## What the reports say to avoid

- Silent privacy-policy changes.
- Forcing AI on users.
- Putting basic features behind a paywall.
- Server-side unencrypted storage of chats.
- Account bans with no reason or recourse.
- Anything involving money (see the product rule above).

---

## Needs your input

These are the things I cannot do for you. I did not enter your dummy account's password on the live site, because I do not type passwords into non-local sites, so the logged-in steps are yours.

### 1. Check the new build reached the live site (2 minutes)
1. Open `https://socloudybro.vercel.app` in Chrome and press **Ctrl+Shift+R** (hard refresh). Pressing it keeps you signed in. Do not use "Clear site data", which signs you out.
2. If a "site update" banner appears, click it.
3. Press **F12**, open the **Console** tab, paste this and press Enter:
   `document.getElementById('toast').getAttribute('role')`
4. It should print `"status"`. If it prints `null`, the update has not arrived yet. Wait two minutes and repeat. If it is still `null` after that, tell me.

### 2. Logged-in click-through (10 minutes)
Log in with your dummy account yourself, keep **F12 → Console** open, and note any red errors.
- [ ] Pin a message, then click the ✕ on the pinned banner. It should unpin and not jump to the message.
- [ ] Send a message longer than 600 characters and click **Show more**. It should expand and not open anything else.
- [ ] Create a group and add, then remove, a member chip (the ×).
- [ ] Open the dashboard widgets (pinned chats, voice channels, missed calls) and click a row in each.
- [ ] Click a BIZ badge in a chat header, if you have a business contact.
- [ ] Open a group description banner and dismiss it.
- [ ] Open 3 modals on top of each other (Settings, then a sub-modal). Press **Esc** and check only the top one closes, and that **Tab** never reaches the page behind.
- [ ] Start a meeting with a second browser window, chat and leave. The listeners I touched are there.
- [ ] Look for new warnings in the Console, especially ones starting with "listener error". A few at login would point to a Firebase rules problem.

### 3. Screen reader and phone check (15 minutes)
- Windows has a built-in screen reader: press **Win+Ctrl+Enter** to turn on Narrator. Tab through the login modal. You should hear it announce a dialog and a name for each field, such as "PIN digit 1 of 4". Press the same keys to turn it off.
- Open the site on your phone and open a modal, then close it. Check the keyboard does not pop up by itself.

### 4. Decisions only you can make
- **Escape while typing in a field.** Today it does nothing, which protects typed text. I recommend leaving it.
- **Which tier to start.** I recommend P0 items 1 and 3 first (per-contact receipts, "what is protected" panel). They are small and clearly differentiating.
- **Age and teen safety.** Item 8 needs a policy decision (minimum age, who counts as a guardian, what is blurred by default) before any code.
- **Which features are really missing.** My "already in the app" list comes from keyword search. Skim it and tell me any that are not actually in the app.

### If something breaks
Copy the red lines from the Console (right-click → Save as, or select and copy) and paste them to me, with what you clicked just before.
