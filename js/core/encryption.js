// -- OWNER-CONFIGURABLE PLACEHOLDERS ------------------------------------------
// (Self-healing admin alerts need no configuration: notifyAdminByEmail() sends
// them through sendWeb3Form(), reusing the WEB3FORMS_ACCESS_KEY above that
// reports and the weekly digest already use.)
//
// FILE THREAT SCANNING.
// This site is static, so a real VirusTotal key can NEVER live in this file —
// anyone viewing page source would see it and could drain/abuse your quota.
// Instead, point VIRUS_SCAN_API_ENDPOINT at a small server-side proxy that
// holds the key privately and forwards requests to VirusTotal on your behalf.
// A ready-to-deploy Cloudflare Worker for this is provided separately
// (virustotal-proxy/worker.js) — deploy it, run
// `wrangler secret put VT_API_KEY` there (never here) to store the real key,
// then paste the Worker's *.workers.dev URL below. No API key belongs in
// this file at all; that's why there's no VIRUS_SCAN_API_KEY constant here
// anymore — the proxy is the only thing that ever holds it.
// While unset, scanFileForThreats() returns {status:'unconfigured'} and the
// download UI honestly says scanning isn't configured rather than claiming a
// file is clean.
const VIRUS_SCAN_API_ENDPOINT = 'https://socloudybro-vt-proxy.steveemil7.workers.dev';

// MEETINGS.
// Two transports, chosen at runtime by connectToMeetingRoom():
//
//   1. LiveKit (a real SFU) — used when BOTH constants below are filled in.
//      Every participant sends one stream to LiveKit's server instead of one
//      per peer, which is what makes large rooms possible.
//   2. Built-in full-mesh WebRTC over Firebase signalling — the automatic
//      fallback when LiveKit isn't configured, or when the token endpoint or
//      the LiveKit connection fails. Mesh stops being stable past a handful of
//      peers (each participant uploads a separate stream to every other
//      participant), hence the small cap.
//
// LIVEKIT_URL is NOT a secret — it's just the project's websocket address, so
// it is safe directly in this file. The API key/secret must NEVER appear here:
// LIVEKIT_TOKEN_ENDPOINT points at the Cloudflare Worker in livekit-proxy/,
// which holds the secret and mints short-lived, room-scoped join tokens.
//   LIVEKIT_URL            = 'wss://<your-project>.livekit.cloud'
//   LIVEKIT_TOKEN_ENDPOINT = 'https://<your-worker>.workers.dev'
const LIVEKIT_URL = 'wss://socloudybro-grm4l0gf.livekit.cloud';
const LIVEKIT_TOKEN_ENDPOINT = 'https://socloudybro-livekit-token-proxy.steveemil7.workers.dev';
// Cap while running on the mesh fallback.
const MAX_MEETING_PARTICIPANTS = 6;
// Cap while running on LiveKit. NOTE: this assumes the owner's LiveKit plan
// supports this many concurrent participants in one room — adjust downwards if
// their plan's limits are lower.
const LIVEKIT_MAX_PARTICIPANTS = 40;

// GOOGLE SIGN-IN.
// Powers "Sign in with Google" on the login screen and "Connect Google Account"
// in Settings → Connected Accounts. Unlike the VirusTotal/LiveKit keys above, an
// OAuth 2.0 *Client ID* is NOT a secret — it is designed to be public and sits
// in the page source of every site that uses Google sign-in, so it belongs here
// directly. (There is deliberately no client *secret* anywhere in this file; the
// browser-only flow used here never needs one.)
//
// TO ACTIVATE:
//   1. Go to console.cloud.google.com → APIs & Services → Credentials.
//   2. Create Credentials → OAuth client ID → Application type: "Web
//      application".
//   3. Under "Authorized JavaScript origins" add this site's own origin(s) —
//      for this deployment that is https://socloudybro.vercel.app (add
//      http://localhost:8000 too, or whatever you serve locally on, if you want
//      it to work while developing). Origins only: scheme + host + port, no
//      path. "Authorized redirect URIs" can be left empty — the Google Identity
//      Services flow used here returns the token straight to the page.
//   4. Configure the OAuth consent screen if prompted (app name, support email,
//      logo). While the app is in "Testing" only the test users you list can
//      sign in; publish it when you're ready for everyone.
//   5. Copy the generated Client ID — it looks like
//      "1234567890-abc123def456.apps.googleusercontent.com" — and paste it
//      between the quotes below.
//
// While this is an empty string, googleSignInConfigured() returns false, the two
// buttons render visibly disabled with a note saying Google sign-in isn't set up
// on this site yet, and nothing else in the app changes. Nobody gets a dead
// button that silently does nothing.
const GOOGLE_CLIENT_ID = '838238846995-462tmfqv9p4mthurorumg30d2uq4qin1.apps.googleusercontent.com';

// GOOGLE SIGN-IN VERIFICATION.
// A Google ID token is only worth anything if its signature is actually checked
// against Google's public keys, and that check has to happen somewhere the user
// can't rewrite — i.e. not in this page. GOOGLE_VERIFY_ENDPOINT points at the
// small Cloudflare Worker provided separately (google-verify-proxy/worker.js),
// exactly like VIRUS_SCAN_API_ENDPOINT and LIVEKIT_TOKEN_ENDPOINT above do for
// their own proxies. Nothing secret is involved here: the Worker only needs
// Google's public JWKS and the same (public) Client ID as above, so there is no
// API key to store anywhere.
//   GOOGLE_VERIFY_ENDPOINT = 'https://<your-worker>.workers.dev'
// Deploy the Worker (set its ALLOWED_ORIGIN and GOOGLE_CLIENT_ID first), then
// paste its *.workers.dev URL below. The page POSTs {credential:'<id_token>'}
// and the Worker answers {status:'ok', sub, email, emailVerified, name, picture}
// with the VERIFIED claims, or {status:'error', message} — a rejection is a
// rejection and the sign-in is refused.
// While this is an empty string, Google sign-in still works but falls back to
// the old client-only decode of the token (decodeGoogleIdToken()), which cannot
// prove a token is genuine — see the long honesty note above that function. In
// that state the UI keeps saying so out loud rather than implying verification
// that isn't happening.
const GOOGLE_VERIFY_ENDPOINT = 'https://socloudybro-google-verify.steveemil7.workers.dev';

// MINT_TOKEN_ENDPOINT points at the existing firebase-rules Cloudflare
// Worker's /mint-token route. init() signs every visitor in anonymously
// (signInAnonymously()) purely so pre-login reads work at all — that
// session satisfies Firebase's "auth != null" for literally anyone, logged
// in or not, which is why every admin/permission/membership check in this
// app is backed by nothing server-side today. finishLogin() calls
// _tryUpgradeToCustomAuth() below to trade that anonymous session for a
// real one once a PASSWORD login succeeds (the Worker independently
// re-verifies the password server-side before minting anything — this
// isn't the client asserting its own identity). This is intentionally only
// step one: it changes who you're authenticated AS, not what any Firebase
// rule actually checks — the rules themselves are unchanged, so this is
// safe to ship on its own. Covers password AND Google logins (the Worker
// independently re-verifies whichever proof is sent — a password hash
// comparison, or the Google ID token's signature — server-side; the
// client's say-so alone is never enough). Passkey/face/backup-PIN logins
// still run on the plain anonymous session until each gets its own proof
// wired up the same way.
const MINT_TOKEN_ENDPOINT = 'https://socloudybro-firebase-rules.steveemil7.workers.dev/mint-token';
// Same Worker, two new routes for email verification via a one-time code
// (see the Worker's own comment block for how the stateless challenge works).
const SEND_OTP_ENDPOINT = 'https://socloudybro-firebase-rules.steveemil7.workers.dev/send-otp';
const VERIFY_OTP_ENDPOINT = 'https://socloudybro-firebase-rules.steveemil7.workers.dev/verify-otp';
// Best-effort, never blocks or breaks login: on any failure (Worker
// unreachable, bad credentials server-side somehow, timeout) this just
// leaves the existing anonymous session in place exactly as before this
// existed, so the worst case is "no upgrade happened," never "login broke."
// `proof` is exactly one of {password}, {googleCredential}, {passkeyAssertion},
// {faceDescriptor}, or {backupPin} — whichever the login path that just
// succeeded actually has. The Worker independently re-verifies whichever one
// is sent (password/PIN hash comparison, Google ID token signature, WebAuthn
// assertion signature, or face-descriptor distance) server-side — the
// client's say-so alone is never enough for any of them.
async function _tryUpgradeToCustomAuth(number, proof){
  if(!number || !proof || !(proof.password||proof.googleCredential||proof.passkeyAssertion||proof.faceDescriptor||proof.backupPin||proof.secAnswers) || !MINT_TOKEN_ENDPOINT) return false;
  try{
    const ctl = (typeof AbortController!=='undefined') ? new AbortController() : null;
    const timer = ctl ? setTimeout(()=>{ try{ ctl.abort(); }catch(e){} }, 8000) : null;
    let res;
    try{
      res = await fetch(MINT_TOKEN_ENDPOINT, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({number, ...proof}),
        ...(ctl?{signal:ctl.signal}:{}),
      });
    } finally { if(timer) clearTimeout(timer); }
    if(!res.ok) return false;
    const data = await res.json().catch(()=>null);
    if(!data || !data.token) return false;
    await firebase.auth().signInWithCustomToken(data.token);
    return true;
  }catch(e){
    console.warn('[auth] custom-token upgrade failed, staying on the existing session:', e.message);
    return false;
  }
}

// Any account that logged in before the custom-auth upgrade existed (or
// whose browser simply kept its old anonymous Firebase session alive
// across reloads — Firebase persists that session the same way it
// persists a real one) is still running on the plain anonymous session
// today: nothing besides an explicit fresh login (finishLogin(), which is
// what actually calls _tryUpgradeToCustomAuth()) ever upgrades it. Not
// exploitable on its own (every sensitive write still requires the real
// token), but it means that device's own Firebase rule checks silently
// fall back to weaker "auth != null" coverage wherever a bypass branch for
// that exists, and the account can't be told apart from ANY anonymous
// visitor server-side. This surfaces a small, dismissible, non-blocking
// banner offering a one-click fix; dismissing it only silences this
// session (reappears next full reload) specifically so it isn't
// permanently ignorable by accident.
// A brute-force lockout (5 failed mint-token attempts) now stamps
// users/<number>/lastLockoutAt server-side — surfaced here so the real
// account owner finds out an attack happened, instead of it being
// invisible to everyone except whoever was attempting it. De-duped against
// localStorage (keyed by the exact timestamp, not just "seen one ever") so
// the SAME lockout episode isn't re-alerted on every poll, but a NEW one
// (a different lastLockoutAt) always gets its own toast.
function maybeShowLockoutAlert(){
  try{
    if(!me||!me.lastLockoutAt) return;
    const key='cc_lockout_ack_'+me.number;
    const ack=parseInt(localStorage.getItem(key)||'0',10);
    if(me.lastLockoutAt<=ack) return;
    localStorage.setItem(key,String(me.lastLockoutAt));
    showToast('⚠️ Repeated failed login attempts',
      'Someone made several incorrect attempts to log into this account around '+new Date(me.lastLockoutAt).toLocaleString()+'. If that wasn\'t you, consider changing your password.');
  }catch(e){}
}
function checkStaleAnonymousSession(){
  try{
    if(!me||!me.number) return;
    const cu=firebase.auth&&firebase.auth().currentUser;
    if(!cu||!cu.isAnonymous) return;
    if(sessionStorage.getItem('cc_stale_session_dismissed')==='1') return;
    _showStaleSessionBanner();
  }catch(e){ console.warn('checkStaleAnonymousSession failed (non-fatal):',e.message); }
}
function _dismissStaleSessionBanner(){
  try{ sessionStorage.setItem('cc_stale_session_dismissed','1'); }catch(e){}
  const el=document.getElementById('stale-session-banner');
  if(el) el.remove();
}
function _showStaleSessionBanner(){
  if(document.getElementById('stale-session-banner')) return;
  const hasPwd=!!(me.pwd);
  const el=document.createElement('div');
  el.id='stale-session-banner';
  el.style.cssText='position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:900;background:var(--surface);border:1px solid var(--border2);border-radius:var(--r-card);box-shadow:var(--shadow-lg);padding:12px 14px;max-width:360px;width:calc(100% - 32px);font-size:12.5px';
  el.innerHTML = hasPwd
    ? ('<div style="margin-bottom:8px"><b>🔒 Secure this session</b><br><span style="color:var(--muted)">This device is signed in but hasn\'t verified your identity since an update. Confirm your password once to secure it.</span></div>'
      +'<input type="password" id="stale-session-pwd" placeholder="Password" style="margin-bottom:6px">'
      +'<div class="error-text" id="stale-session-error" style="margin-bottom:6px;font-size:11px"></div>'
      +'<div style="display:flex;gap:6px"><button class="btn btn-sm" style="flex:1" onclick="_submitStaleSessionUpgrade()">Secure</button><button class="btn btn-ghost btn-sm" onclick="_dismissStaleSessionBanner()">Later</button></div>')
    : ('<div style="margin-bottom:8px"><b>🔒 Secure this session</b><br><span style="color:var(--muted)">This device is signed in but hasn\'t verified your identity since an update. Log out and back in once to secure it.</span></div>'
      +'<div style="display:flex;gap:6px"><button class="btn btn-sm" style="flex:1" onclick="logOut()">Log out</button><button class="btn btn-ghost btn-sm" onclick="_dismissStaleSessionBanner()">Later</button></div>');
  document.body.appendChild(el);
}
async function _submitStaleSessionUpgrade(){
  const input=document.getElementById('stale-session-pwd');
  const err=document.getElementById('stale-session-error');
  const pwd=(input?input.value:'').trim();
  if(err) err.textContent='';
  if(!pwd){ if(err) err.textContent='Enter your password.'; return; }
  // Fast local check first (same hash already cached in me.pwd) before
  // spending a network round-trip — the Worker independently re-verifies
  // regardless, this is purely for snappier wrong-password feedback.
  if(!(await verifyPassword(pwd,me.pwd))){ if(err) err.textContent='Incorrect password.'; return; }
  const ok=await _tryUpgradeToCustomAuth(me.number,{password:pwd});
  if(ok){ _dismissStaleSessionBanner(); showToast('Secured','This session is now fully verified.'); }
  else if(err) err.textContent='Couldn\'t verify with the server — check your connection and try again.';
}

// Realtime Database paths (each holds the same JSON blob that used to live in a JSONBin bin)
const USERS_BIN     = 'users';
const USERS_PRIVATE = 'users_private'; // pwd / backupPinHash / faceDescriptor — not publicly readable
const CONVOS_BIN    = 'conversations';
const UPDATES_BIN = 'updates';
// Web3Forms submissions are proxied through the Cloudflare Worker's /report
// endpoint so the access key is never exposed in client source. The key has
// been removed from the client and stored as a Worker secret (WEB3FORMS_ACCESS_KEY).
const WEB3FORMS_ACCESS_KEY = '';
// Giphy requests are proxied through the Worker's /giphy endpoint so the key
// is never exposed in client source. Add GIPHY_KEY as a Worker variable.
const GIPHY_KEY   = '';
const ENC_KEY     = 'cc_s3cr3t_2025';
const POLL_MS     = 25000;
const ADMIN_NUMBER = 2015;
const SITE_URL     = 'https://socloudybro.vercel.app';
const HB_MS       = 45000;
// ----------------------------------------------------------------------------

// Re-verifies the signed-in account really is the admin at the moment a
// privileged write happens, instead of trusting that an admin-only button was
// rendered. Every admin action used to rely purely on openAdminPanel()/
// openAdminDashboard() having checked once at open time, and on the button
// being display:none for everyone else — which is not a check at all in a
// client-only app: adminBan(2015) or adminDeleteGroup('grp_…') typed into the
// console by any signed-in user would go straight through to the Firebase
// write. This is still client-side only (nothing here can stop someone editing
// the page), but it closes the trivial path and means every privileged write
// states its own precondition instead of inheriting one.
function requireAdmin(silent){
  if(me && me.number===ADMIN_NUMBER) return true;
  if(!silent) try{ showToast('Access denied',scbErr('SCB-ADMIN-01','This action is for administrators only.')); }catch(e){}
  return false;
}

// Granular admin access — returns true if user is full admin OR has the specific permission
function hasPermission(perm){
  if(!me) return false;
  if(me.number===ADMIN_NUMBER) return true;
  if(me.adminAccess&&me.adminAccess.expiresAt&&Date.now()>=me.adminAccess.expiresAt) return false;
  const perms=me.adminAccess&&me.adminAccess.permissions;
  if(!Array.isArray(perms)) return false;
  return perms.includes(perm);
}

// Same purpose as requireAdmin(), but for an action a delegated admin can be
// granted via the permission editor (openPermissionEditor/savePermissions).
// Using requireAdmin() here would make the grant a no-op: the Users tab and
// its Ban button are shown to anyone with hasPermission('users_ban'), but
// the write itself would still refuse everyone except the literal #2015
// account, so a granted permission would silently never actually work.
function requirePermission(perm,silent){
  if(hasPermission(perm)) return true;
  if(!silent) try{ showToast('Access denied',scbErr('SCB-ADMIN-01','This action is for administrators only.')); }catch(e){}
  return false;
}

// Returns true if user should see the Admin button at all
function hasAnyAdminAccess(){
  if(!me) return false;
  if(me.number===ADMIN_NUMBER) return true;
  if(me.adminAccess&&me.adminAccess.expiresAt&&Date.now()>=me.adminAccess.expiresAt) return false;
  const perms=me.adminAccess&&me.adminAccess.permissions;
  return Array.isArray(perms)&&perms.length>0;
}

// -- ENCRYPTION (XOR + base64) ---------------------------------------------
// Upgraded from a plain XOR cipher with a hardcoded key sitting directly in this
// file — trivially reversible by anyone who reads the source, so it was
// obfuscation from casual DB browsing at best, never real encryption — to
// genuine AES-256 via CryptoJS. Kept fully synchronous (unlike WebCrypto's
// Promise-based subtle.encrypt/decrypt) since enc()/dec() are called
// synchronously in well over a hundred places throughout this file; switching
// to an async implementation would have required rewriting every one of those
// call sites, which was too large and risky a change to make blind.
// One honest limitation no cipher choice can fix: ENC_KEY is still a constant
// embedded in client code, because profile fields like name/bio/status must be
// readable by OTHER users viewing your profile — the decryption capability
// can't be scoped to only you the way real E2E message encryption is (see the
// ECDH+AES-GCM section for that, which is the actual privacy boundary for
// message content when a key exchange succeeds). So this is meaningfully
// stronger against casual inspection and tampering than XOR, but it is not a
// secret from someone who reads this file — same limitation as before, just a
// correct, standard cipher instead of a trivial one.
function enc(str){
  if(!str) return str;
  // Idempotent guard: a value that's already our own ciphertext (starts with
  // 'v2:') must never be encrypted again. Some call site somewhere in this
  // file was passing an already-encrypted string back into enc() (e.g. a
  // value read back from a user record without being decrypted first), which
  // produced double-wrapped ciphertext that dec() could only partially peel
  // off — the outer layer decrypts fine, but what's "inside" is itself still
  // a 'v2:...' string, so it displays as garbage instead of the real name/bio.
  // Rather than track down every possible call site that could feed enc() an
  // already-encrypted value, make enc() itself refuse to double-wrap: a
  // genuine plaintext name/bio realistically never starts with 'v2:', so this
  // is a safe, permanent guard against the bug recurring from any call site,
  // present or future.
  if(str.startsWith('v2:')) return str;
  try{
    return 'v2:'+CryptoJS.AES.encrypt(str,ENC_KEY).toString();
  }catch{return str;}
}
function dec(str){
  if(!str) return str;
  try{
    // Self-healing: peel off 'v2:' layers until what's left doesn't look like
    // our own ciphertext anymore. This repairs any value that was already
    // double (or triple, etc.) encrypted before the enc() guard above existed
    // — including accounts created earlier that are stuck showing raw
    // ciphertext right now — without needing a separate one-off data-repair
    // script. Capped at 5 layers so a value that's corrupt in some other way
    // can't spin forever.
    let out=str, layers=0;
    while(typeof out==='string' && out.startsWith('v2:') && layers<5){
      out=CryptoJS.AES.decrypt(out.slice(3),ENC_KEY).toString(CryptoJS.enc.Utf8);
      layers++;
    }
    // out no longer starts with 'v2:' — fully decrypted
    return out;
  }catch{return str;}
}
// Repairs a `me` object (from localStorage cache, a fresh login, or signup)
// whose name/bio/customStatus fields are still (partially) encrypted instead
// of plain text — see the enc()/dec() double-encryption fix above. Safe to
// call on an already-healthy `me`: a field that doesn't start with 'v2:' is
// left untouched. Returns true if anything was actually changed, so callers
// know whether they need to persist the repair.
function healMeFields(m){
  if(!m) return false;
  let changed=false;
  ['name','bio','customStatus'].forEach(k=>{
    if(typeof m[k]==='string' && m[k].startsWith('v2:')){
      m[k]=dec(m[k]);
      changed=true;
    }
  });
  return changed;
}

// -- E2E ENCRYPTION (ECDH P-256 + AES-GCM via WebCrypto) --------------------
const _decCache={};      // msgId -> {text, gif, poll}
// decryptConvoMessages() below caches a FAILED attempt (textFailed:true)
// permanently — it skips any msgId already in _decCache, success or failure,
// so a message that failed to decrypt once stays stuck showing "keys don't
// match" for the rest of the session even after this device gets the right
// key (cloud-restore finishing, or a manual key import). Call this right
// after the key actually changes so those messages get a fresh attempt
// instead of needing a full page reload to ever re-check.
function _retryFailedDecryptions(){
  Object.keys(_decCache).forEach(id=>{ if(_decCache[id]&&_decCache[id].textFailed) delete _decCache[id]; });
}
const _dmAesCache={};    // otherNumber -> CryptoKey
const _groupAesCache={}; // convoKey -> CryptoKey
const _pubKeyCache={};   // number -> CryptoKey (their ECDH public key)
var _myKeyPair=null;     // {privateKey, publicKey} — var so accessible cross-script
var _myPubJwk=null;      // string JWK of our public key — var so accessible cross-script
let _disappearRenderTimer=null; // setTimeout handle for disappearing-message re-render

function _b64(buf){const b=new Uint8Array(buf);let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s);}
function _unb64(str){const s=atob(str);const b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b.buffer;}

// Derive a wrapping AES-GCM key from a secret + account number using PBKDF2.
// This key encrypts/decrypts the ECDH private key stored in Firebase so it
// can be restored automatically on any new device after login. `slot`
// distinguishes which secret the key was derived from (see below) so the
// two slots never share key material even if the underlying secrets ever
// collided.
async function _deriveWrapKey(rawSecret, number, slot){
  const bytes=new TextEncoder().encode(rawSecret);
  const salt=new TextEncoder().encode('scb-e2e-wrap-v1:'+(slot||'pwd')+':'+String(number));
  const baseKey=await crypto.subtle.importKey('raw',bytes,'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',salt,iterations:200000,hash:'SHA-256'},
    baseKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']
  );
}

// Encrypt the ECDH private-key JWK and store it in Firebase at
// users/{number}/<field>. Called silently — never surfaces errors to the
// user. Two independent copies are kept so the key can be restored on a new
// device regardless of which method that device signs in with:
//  - e2eEnc  (slot 'pwd'):    wrapped with a key derived from the account
//                             password — only a password login can unwrap it.
//  - e2eEncG (slot 'google'): wrapped with a key derived from the linked
//                             Google account's stable subject id — only a
//                             Google sign-in (with that same account) can
//                             unwrap it. Without this second copy, any device
//                             that only ever signs in with Google has no
//                             password to restore the password-wrapped copy
//                             with, so it silently minted its own fresh
//                             keypair instead — breaking decryption of every
//                             past (and future, until manually rotated)
//                             message with everyone, on every device,
//                             exactly the "sent from another device — keys
//                             don't match here" bug this fixes.
async function _syncE2EKeyToCloudSlot(rawSecret, number, privJwk, slot, field){
  if(!rawSecret||!number||!privJwk) return;
  try{
    const wrapKey=await _deriveWrapKey(rawSecret,number,slot);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const plain=new TextEncoder().encode(JSON.stringify(privJwk));
    const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},wrapKey,plain);
    const blob={iv:_b64(iv),ct:_b64(ct),v:1};
    await fbdb.ref(USERS_BIN+'/'+number+'/'+field).set(blob);
  }catch(e){ console.warn('E2E cloud sync ('+slot+') failed (non-fatal):',e.message); }
}
function _syncE2EKeyToCloud(rawPassword, number, privJwk){ return _syncE2EKeyToCloudSlot(rawPassword,number,privJwk,'pwd','e2eEnc'); }
function _syncE2EKeyToCloudGoogle(googleSub, number, privJwk){ return _syncE2EKeyToCloudSlot(googleSub,number,privJwk,'google','e2eEncG'); }
// Third slot (field e2eEncP), same scheme as the two above — wrapped with a
// key derived from the backup PIN, so a device that only ever signs in with
// the backup PIN (no password, no Google link) can still restore the
// account's real E2E key instead of silently minting its own. Passkey and
// face logins have no equivalent: there's no portable secret to derive a
// wrap key from (a passkey's private key never leaves its device/OS
// keychain, and a face descriptor isn't stable between scans), so a brand
// new device signing in only that way still can't self-restore — it still
// gets the canonical-pubkey mismatch repair below if THIS device previously
// had a working key, just not a from-nothing cloud restore.
function _syncE2EKeyToCloudBackupPin(backupPin, number, privJwk){ return _syncE2EKeyToCloudSlot(backupPin,number,privJwk,'pin','e2eEncP'); }

// Fetch the encrypted ECDH private key from Firebase and restore it to localStorage.
// Returns true if successfully restored, false otherwise.
async function _restoreE2EKeyFromCloudSlot(rawSecret, number, slot, field){
  if(!rawSecret||!number) return false;
  try{
    const snap=await fbdb.ref(USERS_BIN+'/'+number+'/'+field).once('value');
    const blob=snap.val();
    if(!blob||!blob.iv||!blob.ct) return false;
    const wrapKey=await _deriveWrapKey(rawSecret,number,slot);
    const iv=new Uint8Array(_unb64(blob.iv));
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},wrapKey,_unb64(blob.ct));
    const privJwk=JSON.parse(new TextDecoder().decode(plain));
    // Verify the private key is valid by importing it
    await crypto.subtle.importKey('jwk',privJwk,{name:'ECDH',namedCurve:'P-256'},true,['deriveKey','deriveBits']);
    // Get the matching public key from Firebase (stored by this device at sync time)
    const pubSnap=await fbdb.ref(USERS_BIN+'/'+number+'/pubkey').once('value');
    const storedPubJwkStr=pubSnap.val();
    if(!storedPubJwkStr) return false;
    await crypto.subtle.importKey('jwk',JSON.parse(storedPubJwkStr),{name:'ECDH',namedCurve:'P-256'},true,[]);
    localStorage.setItem('cc_e2e_priv_'+number,JSON.stringify(privJwk));
    localStorage.setItem('cc_e2e_pub_'+number,storedPubJwkStr);
    return true;
  }catch(e){ console.warn('E2E cloud restore ('+slot+') failed:',e.message); return false; }
}
function _restoreE2EKeyFromCloud(rawPassword, number){ return _restoreE2EKeyFromCloudSlot(rawPassword,number,'pwd','e2eEnc'); }
function _restoreE2EKeyFromCloudGoogle(googleSub, number){ return _restoreE2EKeyFromCloudSlot(googleSub,number,'google','e2eEncG'); }
function _restoreE2EKeyFromCloudBackupPin(backupPin, number){ return _restoreE2EKeyFromCloudSlot(backupPin,number,'pin','e2eEncP'); }

// Raw password available at login time — stored temporarily so ensureE2EKeypair
// can sync/restore the cloud-backed key.
var _loginRawPwd=null;
// Google account subject id available at login time (password-less Google
// sign-in) — same purpose as _loginRawPwd, for devices that never have the
// account password. Also set when linking Google to an already-logged-in
// account, so that account's other Google-only devices can restore too.
var _loginGoogleSub=null;
// The raw, already-verified Google ID token from the current login — set by
// handleGoogleCredentialResponse() right alongside _loginGoogleSub above,
// and consumed once by finishLogin() to mint a real Firebase custom auth
// token for this login the same way _loginRawPwd does for password logins.
// See MINT_TOKEN_ENDPOINT's comment.
var _loginGoogleCredential=null;
// Same purpose as _loginRawPwd/_loginGoogleCredential, for the three login
// methods that previously had no server-verifiable proof at all (see
// MINT_TOKEN_ENDPOINT's comment) — set right before finishLogin() by
// whichever of passkey/face/backup-PIN login just succeeded, consumed once,
// and nulled alongside the others so a stale proof from an earlier attempt
// can never leak into a later login.
var _loginPasskeyProof=null;
var _loginFaceDescriptorProof=null;
var _loginBackupPinProof=null;

async function ensureE2EKeypair(){
  if(_myKeyPair) return _myKeyPair;
  if(!window.crypto||!crypto.subtle||!me) return null;
  try{
    let stored=localStorage.getItem('cc_e2e_priv_'+me.number);
    let storedPub=localStorage.getItem('cc_e2e_pub_'+me.number);
    const googleSub=_loginGoogleSub||me.googleSub||null;
    // If no local key, try to restore from cloud first (seamless cross-device).
    // Try whichever secret this login actually has — a password login only
    // has _loginRawPwd, a Google sign-in only has googleSub, and either can
    // unwrap the copy the OTHER login method originally wrapped, as long as
    // both slots were ever synced (see the opportunistic sync below).
    if((!stored||!storedPub)&&_loginRawPwd){
      const restored=await _restoreE2EKeyFromCloud(_loginRawPwd,me.number);
      if(restored){
        stored=localStorage.getItem('cc_e2e_priv_'+me.number);
        storedPub=localStorage.getItem('cc_e2e_pub_'+me.number);
        _retryFailedDecryptions();
      }
    }
    if((!stored||!storedPub)&&googleSub){
      const restored=await _restoreE2EKeyFromCloudGoogle(googleSub,me.number);
      if(restored){
        stored=localStorage.getItem('cc_e2e_priv_'+me.number);
        storedPub=localStorage.getItem('cc_e2e_pub_'+me.number);
        _retryFailedDecryptions();
      }
    }
    if((!stored||!storedPub)&&_loginBackupPinProof){
      const restored=await _restoreE2EKeyFromCloudBackupPin(_loginBackupPinProof,me.number);
      if(restored){
        stored=localStorage.getItem('cc_e2e_priv_'+me.number);
        storedPub=localStorage.getItem('cc_e2e_pub_'+me.number);
        _retryFailedDecryptions();
      }
    }
    // Even when this device already has SOME local key, it may be a stale or
    // orphaned one — e.g. generated before cloud-restore worked at all (see
    // the Sept 25 fix to _restoreE2EKeyFromCloud), or from a device that was
    // never able to restore in the first place. A wrong local key doesn't
    // just break this device: the next registerOrUpdate() from here publishes
    // its public key as the account's new canonical one, silently breaking
    // decryption for everyone else too. So don't just trust whatever's
    // already in localStorage — verify it still matches the account's
    // current canonical pubkey in Firebase, and re-restore from the
    // cloud-wrapped copy (kept in sync with the canonical key by
    // _syncE2EKeyToCloudSlot) if it doesn't, instead of silently using a
    // key nothing else on the account agrees with.
    if(stored&&storedPub&&(_loginRawPwd||googleSub||_loginBackupPinProof)){
      try{
        const pubSnap=await fbdb.ref(USERS_BIN+'/'+me.number+'/pubkey').once('value');
        const canonicalPub=pubSnap.val();
        if(canonicalPub&&canonicalPub!==storedPub){
          let fixed=_loginRawPwd&&await _restoreE2EKeyFromCloud(_loginRawPwd,me.number);
          if(!fixed&&googleSub) fixed=await _restoreE2EKeyFromCloudGoogle(googleSub,me.number);
          if(!fixed&&_loginBackupPinProof) fixed=await _restoreE2EKeyFromCloudBackupPin(_loginBackupPinProof,me.number);
          if(fixed){
            stored=localStorage.getItem('cc_e2e_priv_'+me.number);
            storedPub=localStorage.getItem('cc_e2e_pub_'+me.number);
            _retryFailedDecryptions();
          }
        }
      }catch(e){ console.warn('E2E canonical-key check failed (non-fatal):',e.message); }
    }
    if(stored&&storedPub){
      const privJwk=JSON.parse(stored), pubJwk=JSON.parse(storedPub);
      const privateKey=await crypto.subtle.importKey('jwk',privJwk,{name:'ECDH',namedCurve:'P-256'},true,['deriveKey','deriveBits']);
      const publicKey=await crypto.subtle.importKey('jwk',pubJwk,{name:'ECDH',namedCurve:'P-256'},true,[]);
      _myKeyPair={privateKey,publicKey};
      _myPubJwk=storedPub;
      // Opportunistically sync to cloud (both slots, whichever secrets are
      // available) if not yet done this session — covers both a fresh key
      // and backfilling the other slot for an account linked after the fact.
      if((_loginRawPwd||googleSub||_loginBackupPinProof)&&!sessionStorage.getItem('e2e_synced_'+me.number)){
        sessionStorage.setItem('e2e_synced_'+me.number,'1');
        if(_loginRawPwd) _syncE2EKeyToCloud(_loginRawPwd,me.number,privJwk);
        if(googleSub) _syncE2EKeyToCloudGoogle(googleSub,me.number,privJwk);
        if(_loginBackupPinProof) _syncE2EKeyToCloudBackupPin(_loginBackupPinProof,me.number,privJwk);
      }
      return _myKeyPair;
    }
    const kp=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey','deriveBits']);
    const privJwk=await crypto.subtle.exportKey('jwk',kp.privateKey);
    const pubJwk=await crypto.subtle.exportKey('jwk',kp.publicKey);
    localStorage.setItem('cc_e2e_priv_'+me.number,JSON.stringify(privJwk));
    localStorage.setItem('cc_e2e_pub_'+me.number,JSON.stringify(pubJwk));
    _myKeyPair=kp;
    _myPubJwk=JSON.stringify(pubJwk);
    // Sync new key to cloud for future devices (all slots, whichever secrets are available)
    if(_loginRawPwd||googleSub||_loginBackupPinProof){
      sessionStorage.setItem('e2e_synced_'+me.number,'1');
      if(_loginRawPwd) _syncE2EKeyToCloud(_loginRawPwd,me.number,privJwk);
      if(googleSub) _syncE2EKeyToCloudGoogle(googleSub,me.number,privJwk);
      if(_loginBackupPinProof) _syncE2EKeyToCloudBackupPin(_loginBackupPinProof,me.number,privJwk);
    }
    return _myKeyPair;
  }catch(e){ _myKeyPair=null; return null; }
}

async function _importPubKey(jwkStr){
  if(!jwkStr) return null;
  if(_pubKeyCache[jwkStr]) return _pubKeyCache[jwkStr];
  try{
    const jwk=typeof jwkStr==='string'?JSON.parse(jwkStr):jwkStr;
    const k=await crypto.subtle.importKey('jwk',jwk,{name:'ECDH',namedCurve:'P-256'},true,[]);
    _pubKeyCache[jwkStr]=k;
    return k;
  }catch{ return null; }
}

async function _deriveAesFromPub(theirPubKey){
  const kp=await ensureE2EKeypair();
  if(!kp||!theirPubKey) return null;
  try{
    return await crypto.subtle.deriveKey({name:'ECDH',public:theirPubKey},kp.privateKey,{name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  }catch{ return null; }
}

function _userPubKeyStr(number){
  const u=(usersCache||[]).find(x=>x.number===number);
  return u&&typeof u.pubkey==='string'&&u.pubkey?u.pubkey:null;
}

async function getDmAesKey(otherNumber){
  const jwkStr=_userPubKeyStr(otherNumber);
  // Security feature 12/32: don't just silently re-derive and move on if
  // this contact's key changed since we last saw it — flag it loudly.
  // This check must run BEFORE the cache short-circuit below, not after —
  // it's a cheap, local-only comparison (no network call), but it used to
  // sit after the `_dmAesCache` early-return, so it only ever ran once per
  // contact per session (the first call, on a cache miss). A contact who
  // rotated their key mid-session kept getting silently encrypted/decrypted
  // against the stale cached key for the rest of the session, with the
  // "key changed" banner never firing until a full page reload emptied
  // _dmAesCache. _checkContactKeyChange() itself deletes the stale cache
  // entry when it detects a change, so the cache check below still re-uses
  // a cached key whenever nothing actually changed.
  if(jwkStr && await _checkContactKeyChange(otherNumber,jwkStr)) _flagContactKeyChanged(otherNumber);
  if(_dmAesCache[otherNumber]) return _dmAesCache[otherNumber];
  if(!jwkStr) return null;
  const theirPub=await _importPubKey(jwkStr);
  const key=await _deriveAesFromPub(theirPub);
  if(key) _dmAesCache[otherNumber]=key;
  return key;
}

async function aesEnc(key,plaintext){
  if(!key||plaintext==null) return null;
  try{
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const data=new TextEncoder().encode(plaintext);
    const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data);
    return {iv:_b64(iv),ct:_b64(ct)};
  }catch{ return null; }
}
async function aesDec(key,payload){
  if(!key||!payload||!payload.iv||!payload.ct) return null;
  try{
    const iv=new Uint8Array(_unb64(payload.iv));
    const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,_unb64(payload.ct));
    return new TextDecoder().decode(pt);
  }catch{ return null; }
}

async function _exportRawAesKey(key){
  const raw=await crypto.subtle.exportKey('raw',key);
  return raw;
}
async function _importRawAesKey(raw){
  return crypto.subtle.importKey('raw',raw,{name:'AES-GCM',length:256},true,['encrypt','decrypt']);
}

// Generate a random group AES key and "wrap" (encrypt) it individually for each member
async function makeGroupKeyBundle(memberNums){
  if(!me) return {groupKey:null,wrapped:{}};
  const groupKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  const raw=await _exportRawAesKey(groupKey);
  const rawB64=_b64(raw);
  const wrapped={};
  for(const num of memberNums){
    let payload=null;
    if(num===me.number){
      // ECDH can't derive a key with ourselves, so our own copy of the
      // group key is stored as plain base64 rather than AES-wrapped.
      payload={self:true,raw:rawB64};
    }else{
      const aes=await getDmAesKey(num);
      if(aes){ payload=await aesEnc(aes,rawB64); if(payload) payload.by=me.number; }
    }
    if(payload) wrapped[num]=payload;
  }
  return {groupKey,wrapped};
}

async function getGroupAesKey(c){
  if(!c||!c.key) return null;
  if(_groupAesCache[c.key]) return _groupAesCache[c.key];
  if(!c.wrappedKeys||!me) return null;
  const w=c.wrappedKeys[me.number];
  if(!w) return null;
  try{
    let rawB64=null;
    if(w.self){ rawB64=w.raw; }
    else{
      const aes=await getDmAesKey(w.by);
      if(aes) rawB64=await aesDec(aes,w);
    }
    if(!rawB64) return null;
    const key=await _importRawAesKey(_unb64(rawB64));
    _groupAesCache[c.key]=key;
    return key;
  }catch{ return null; }
}

// Rewrap the existing group key for a newly-added member (requires we already hold the group key)
async function addMemberToGroupKey(c,newMemberNum){
  // Returns true only if the new member's copy of the group key was actually
  // wrapped and stored — callers must not admit someone as a member on a
  // false return, or they're permanently stuck unable to decrypt anything.
  if(!c||!me) return false;
  const groupKey=await getGroupAesKey(c);
  if(!groupKey) return false;
  const raw=await _exportRawAesKey(groupKey);
  const rawB64=_b64(raw);
  const aes=await getDmAesKey(newMemberNum);
  if(!aes) return false;
  const payload=await aesEnc(aes,rawB64);
  if(!payload) return false;
  payload.by=me.number;
  c.wrappedKeys=c.wrappedKeys||{};
  c.wrappedKeys[newMemberNum]=payload;
  // Stamp when this member actually joined — the single chokepoint every
  // member-add path (submitAddGroupMembers, approveJoinRequest) already
  // goes through, so "member for N days" badge criteria has real data to
  // check against instead of needing its own tracking added per call site.
  c.memberJoinedAt=c.memberJoinedAt||{};
  if(!c.memberJoinedAt[newMemberNum]) c.memberJoinedAt[newMemberNum]=Date.now();
  return true;
}

// Generates a BRAND NEW group AES key and rewraps it for every member still
// in `remainingNums`, then replaces c.wrappedKeys wholesale. Without this, a
// kicked/banned/left member's wrappedKeys entry being deleted (see
// _removeMemberFromConv) only stops them fetching the key fresh — it does
// nothing about a copy they already decrypted and cached locally
// (_groupAesCache), or about the group's actual AES-GCM content key itself,
// which was never regenerated by anything else in this file. Both let a
// removed member keep reading every future message in that group forever.
// Caller is responsible for calling this with the NEW member list (after
// removal), and must have a valid DM-key relationship with every one of
// them — if wrapping fails for even one remaining member, the whole
// rotation aborts rather than silently locking that member out (same
// safety rule addMemberToGroupKey's own comment states).
async function rotateGroupKey(c, remainingNums) {
  if (!c || !me || !Array.isArray(remainingNums) || !remainingNums.length) return false;
  const nums = [...new Set(remainingNums.map(Number))];
  const bundle = await makeGroupKeyBundle(nums);
  if (!bundle.groupKey) return false;
  for (const num of nums) {
    if (!bundle.wrapped[num]) return false; // couldn't wrap for someone — abort, don't half-rotate
  }
  c.wrappedKeys = bundle.wrapped;
  delete _groupAesCache[c.key]; // the old key this device has cached is now stale too
  return true;
}

async function getConvoAesKey(c){
  if(!c||!me) return null;
  if(c.type==='group'||c.key&&c.key.startsWith('grp_')) return getGroupAesKey(c);
  // DM: figure out the "other" number (guard against object-form participants from Firebase)
  const _parts=Array.isArray(c.participants)?c.participants:Object.values(c.participants||{}).filter(n=>n!=null);
  const other=_parts.find(n=>n!==me.number);
  if(other==null) return null;
  return getDmAesKey(other);
}

// -- decrypted-message cache & accessor helpers (with legacy fallback) ------
async function decryptConvoMessages(c){
  if(!c||!c.messages) return;
  const key=await getConvoAesKey(c);
  for(const m of c.messages){
    if(_decCache[m.id]) continue;
    const entry={};
    // An E2E message can't be decrypted if the key can't be derived (no key
    // at all) or the derived key doesn't match what it was encrypted with
    // (aesDec returns null either way). Previously this left the bubble
    // completely blank with no indication anything was wrong; textFailed
    // lets msgText() show an honest placeholder instead of nothing.
    if(m.ctext){
      entry.text = key ? await aesDec(key,m.ctext) : null;
      if(entry.text==null) entry.textFailed=true;
    }
    if(m.cgif&&key){ entry.gif=await aesDec(key,m.cgif); }
    if(m.cfile&&key){ try{ entry.file=JSON.parse(await aesDec(key,m.cfile)); }catch{} }
    if(m.cpoll&&key){
      try{
        const q=await aesDec(key,m.cpoll.cq);
        const options=[];
        for(const o of (m.cpoll.options||[])){
          options.push({text:await aesDec(key,o.ctext),votes:o.votes||[]});
        }
        entry.poll={question:q,options,creator:m.cpoll.creator};
      }catch{}
    }
    if(Object.keys(entry).length) _decCache[m.id]=entry;
  }
}

function msgText(m){
  if(!m) return '';
  const c=_decCache[m.id];
  if(c){
    if(c.text!=null) return c.text;
    if(c.textFailed) return '🔒 Encrypted message (sent from another device — keys don\'t match here)';
  }
  return dec(m.text)||'';
}
function msgGifUrl(m){
  if(!m) return '';
  const c=_decCache[m.id];
  if(c&&c.gif!=null) return c.gif;
  return m.gif||'';
}
function msgHasGif(m){
  if(!m) return false;
  const c=_decCache[m.id];
  if(c&&c.gif!=null) return true;
  return !!m.gif;
}
function msgFileData(m){
  if(!m) return null;
  const c=_decCache[m.id];
  if(c&&c.file) return c.file;
  return m.file||null;
}
function msgPollData(m){
  if(!m) return null;
  const c=_decCache[m.id];
  if(c&&c.poll){
    // Ensure cached poll options are an array (Firebase may have returned an object)
    if(c.poll.options && !Array.isArray(c.poll.options)) c.poll.options=Object.values(c.poll.options);
    if(c.poll.options) c.poll.options.forEach(o=>{ if(o&&!Array.isArray(o.votes)) o.votes=Object.values(o.votes||{}); });
    return c.poll;
  }
  if(m.poll){
    // Firebase can return arrays as objects with numeric string keys when there are gaps
    const rawOpts=m.poll.options;
    const opts=Array.isArray(rawOpts)?rawOpts:(rawOpts&&typeof rawOpts==='object'?Object.values(rawOpts):[]);
    return {
      question:dec(m.poll.question)||'',
      options:opts.map(o=>{ if(!o) return {text:'',votes:[]}; const v=o.votes; return {text:dec(o.text)||'',votes:Array.isArray(v)?v:(v&&typeof v==='object'?Object.values(v):[])}; }),
      creator:m.poll.creator
    };
  }
  return null;
}
function msgHasPoll(m){
  if(!m) return false;
  return !!(_decCache[m.id]&&_decCache[m.id].poll)||!!m.poll;
}

