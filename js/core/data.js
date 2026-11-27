// -- DEVICE DETECTION & ADAPTIVE LAYOUT ------------------------------------
// Classifies the device as phone / tablet / desktop using viewport size + touch
// + user-agent hints, then toggles a body class so CSS can rearrange the UI
// (single-pane navigation on phones, narrower sidebar on tablets, etc.)
function detectDeviceType(){
  const ua = navigator.userAgent || '';
  const isPhoneUA = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|Mobi/i.test(ua);
  const isTabletUA = /iPad|Android(?!.*Mobile)|Tablet|PlayBook|Silk/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  // Check tablet FIRST — the bare `Mobi` alternative in isPhoneUA also matches
  // the "Mobile" substring inside a real iPad's UA (e.g. "...Mobile/15E148
  // Safari..."), which is a standard token in every iOS UA, iPad included.
  // Checking isPhoneUA first meant every real iPad was misclassified as a
  // phone and the whole two-pane tablet layout never activated.
  if (isTabletUA) return 'tablet';
  if (isPhoneUA) return 'phone';
  const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const w = window.innerWidth, h = window.innerHeight;
  const minSide = Math.min(w, h);
  const isPortrait = h > w;
  // Real phones are held in portrait; a narrow *landscape* window is just a
  // resized desktop browser (or a touchscreen laptop) -- keep it two-pane.
  if (hasTouch && isPortrait && minSide < 600) return 'phone';
  // Use WIDTH (w), not minSide, so a touchscreen laptop in landscape
  // (e.g. 1440×900, w=1440 ≥ 1024) stays 'desktop' rather than being
  // misclassified as tablet because its HEIGHT (900) < 1024.
  if (hasTouch && w < 1024) return 'tablet';
  if (isPortrait && minSide < 480) return 'phone';
  return 'desktop';
}
let _lastDeviceType = null;
function applyDeviceType(){
  const type = detectDeviceType();
  if (type === _lastDeviceType) return;
  _lastDeviceType = type;
  document.body.classList.remove('device-phone','device-tablet','device-desktop');
  document.body.classList.add('device-' + type);
  // Re-sync the single-pane phone view with whatever chat is currently open
  // (guarded with try/catch -- on first load, `activeConvo` may not be declared yet)
  if (type === 'phone') {
    try {
      document.body.classList.toggle('chat-open', !!(activeConvo && document.getElementById('chat-panel').classList.contains('visible')));
    } catch(e){ document.body.classList.remove('chat-open'); }
  } else {
    document.body.classList.remove('chat-open');
  }
}
// On phones, only one pane (sidebar OR chat) is shown at a time; this returns to the sidebar
function closeChatToSidebar(){
  document.body.classList.remove('chat-open');
  // The <640px media query has its own CSS-only fallback for single-pane
  // layout (`body:has(#chat-panel.visible)`, with !important) for a
  // desktop browser resized narrow without ever getting JS-reclassified
  // as device-phone. That fallback only looks at #chat-panel's .visible
  // class, not the chat-open body class above — so on any real phone
  // (which DOES carry chat-open) leaving .visible in place meant the
  // !important fallback rule kept forcing the chat panel back open right
  // after this function removed chat-open, making the back button look
  // broken and the sidebar/chat panel fight over the same space. Clear
  // both so neither mechanism can disagree with the other.
  const chatPanel=document.getElementById('chat-panel');
  if(chatPanel) chatPanel.classList.remove('visible');
}
window.addEventListener('resize', () => { applyDeviceType(); });
if (window.matchMedia) {
  try { window.matchMedia('(orientation: portrait)').addEventListener('change', applyDeviceType); } catch(e){}
}
applyDeviceType();


// -- STATE (var so these are on window and accessible from other script blocks) --
var me = null;
let deviceId = localStorage.getItem('cc_device_id') || (()=>{
  const id = 'dev_'+Math.random().toString(36).slice(2,10)+Date.now().toString(36);
  localStorage.setItem('cc_device_id', id);
  return id;
})();
var contacts = [];
var activeConvo = null; // {type:'dm'|'group', key, name, avatar, number?}
let pollTimer = null, hbTimer = null;
let lastMsgHash = '';
var usersCache = [];
let reportsCache = [];
var convosCache = null;
let pinPhase = null; // 'set1','set2','chat'
let pinTemp = null;
let avatarTarget = null; // 'setup'|'profile'|'group'
let tempGroupAvatar = null;
let tempSetupAvatar = null;
let lockedChats = {};
let archivedContacts = {};
let mutedChats = {};
let acceptedRequests = {}; // convo key -> true, message requests you accepted
let dndEnabled = localStorage.getItem('cc_dnd')==='1';
let quietHours = (()=>{ try{ return JSON.parse(localStorage.getItem('cc_quiet_hours')||'{"enabled":false,"start":"22:00","end":"07:00"}'); }catch{ return {enabled:false,start:'22:00',end:'07:00'}; } })();
let currentTab = 'chats';
let ctxMsg = null;
let updatesCache = null;
let updatesFilter = 'all';
let searchQ = '';
let gifDebounce = null;

let removedContacts = {}; // key → true, persisted so sync never re-adds them

// Called at the start of both login and signup, before the new identity is set.
// Without this, logging into (or signing up as) a *different* account on a
// browser that still has a previous account's data cached — e.g. multiple people
// testing on the same device without an explicit Log Out in between, which is a
// very plausible way for beta testers to be using this — silently carries that
// previous account's contacts and conversation references into the new session.
// logOut()/forceLocalLogout() already handle this correctly via
// localStorage.clear() + a full reload, but that's not the only path to a new
// session: this closes the gap for that case too.
function resetLocalSessionState(){
  contacts = [];
  activeConvo = null;
  usersCache = [];
  reportsCache = [];
  convosCache = null;
  lockedChats = {};
  archivedContacts = {};
  mutedChats = {};
  acceptedRequests = {};
  removedContacts = {};
  updatesCache = null;
  updatesFilter = 'all';
  searchQ = '';
  currentTab = 'chats';
  ctxMsg = null;
  if(pollTimer){ clearInterval(pollTimer); pollTimer=null; }
  if(hbTimer){ clearInterval(hbTimer); hbTimer=null; }
  // Crypto/plaintext caches are per-ACCOUNT, and every one of them is keyed by
  // something that does not include the signed-in account number: _decCache by
  // message id, _dmAesCache by the OTHER party's number, _groupAesCache by
  // convo key, and _myKeyPair/_myPubJwk not at all. Leaving them in place
  // across a login means the next account inherits the previous account's
  // decrypted message text and, worse, its ECDH keypair — registerOrUpdate()
  // would then publish the previous account's public key as the new account's
  // `pubkey`, so nobody could ever decrypt messages sent to it. This function
  // exists precisely to make a login a clean slate; these belong in it.
  try{
    Object.keys(_decCache).forEach(k=>delete _decCache[k]);
    Object.keys(_dmAesCache).forEach(k=>delete _dmAesCache[k]);
    Object.keys(_groupAesCache).forEach(k=>delete _groupAesCache[k]);
    Object.keys(_pubKeyCache).forEach(k=>delete _pubKeyCache[k]);
  }catch(e){ console.warn('crypto cache reset failed', e); }
  _myKeyPair=null; _myPubJwk=null;
  launched = false;
  try{ localStorage.removeItem('cc_session_start'); }catch{}
  // Login/signup can reach this without ever going through logOut() (e.g.
  // switching to a saved account), so the same account-scoped localStorage
  // keys logout clears (outbox, welcome banner flag, birthday-seen cache,
  // etc.) need clearing here too, or the next account on this device
  // inherits the previous one's leftover state.
  try{ clearLocalSessionPreservingE2EKeys(); }catch(e){ console.warn('session key reset failed', e); }
}

// -- LOAD FROM STORAGE --------------------------------------------------------
function loadStorage(){
  // Each key is parsed independently and falls back to a safe default on
  // corrupt/invalid JSON, so one bad localStorage value (e.g. from a partial
  // write or manual edit) can't throw here and abort the whole boot sequence.
  function safeParse(key, fallback){
    try{ const v=JSON.parse(localStorage.getItem(key)); return v===null||v===undefined?fallback:v; }
    catch{ return fallback; }
  }
  me            = safeParse('cc_me', null);
  // The locally-cached copy of `me` can itself have been saved while
  // name/bio/customStatus were still (partially) encrypted — e.g. from before
  // the enc()/dec() double-encryption fix, or from a session that was open
  // when the bug happened. Reloading the page restores that cached copy
  // as-is, with no login step to trigger dec() again, so it needs its own
  // repair pass right here. Persist the fix so this only has to run once.
  if(me && healMeFields(me)) saveStorage();
  contacts      = (safeParse('cc_contacts', [])||[]).filter(Boolean);
  // Heal any contact names still stored as v2:... ciphertext (same idea as
  // healMeFields above). Happens when contacts were cached before dec() started
  // working (i.e. before CryptoJS was re-added after the face-api removal).
  let _cHealed=false;
  contacts.forEach(c=>{ if(c&&typeof c.name==='string'&&c.name.startsWith('v2:')){ c.name=dec(c.name)||c.name; _cHealed=true; } });
  if(_cHealed) saveStorage();
  lockedChats   = safeParse('cc_locked', {});
  archivedContacts = safeParse('cc_archived', {});
  mutedChats    = safeParse('cc_muted', {});
  removedContacts  = safeParse('cc_removed', {});
  acceptedRequests = safeParse('cc_requests_accepted', {});
}
function saveStorage(){
  localStorage.setItem('cc_me', JSON.stringify(me));
  localStorage.setItem('cc_contacts', JSON.stringify(contacts));
  localStorage.setItem('cc_locked', JSON.stringify(lockedChats));
  localStorage.setItem('cc_archived', JSON.stringify(archivedContacts));
  localStorage.setItem('cc_muted', JSON.stringify(mutedChats));
  localStorage.setItem('cc_removed', JSON.stringify(removedContacts));
  localStorage.setItem('cc_requests_accepted', JSON.stringify(acceptedRequests));
  _debounceSavePrefs();
}

// Firebase-backed settings/prefs — stored at users/{number}/prefs so they
// survive localStorage wipes and sync across devices automatically.
let _savePrefTimer=null, _savePrefsPending=null, _resolveSavePrefs=null;
function _debounceSavePrefs(){
  if(!me||!me.number) return;
  clearTimeout(_savePrefTimer);
  // Track one pending promise across the whole coalescing burst (not just
  // the final timer) so registerOrUpdate() can await "the write that's
  // queued" rather than racing it — same shape as saveConvos()/
  // _saveConvosPending, which fixed the identical race for conversations.
  if(!_savePrefsPending) _savePrefsPending=new Promise(resolve=>{ _resolveSavePrefs=resolve; });
  _savePrefTimer=setTimeout(async()=>{
    try{ await savePrefsToFirebase(); }
    finally{ const r=_resolveSavePrefs; _savePrefsPending=null; _resolveSavePrefs=null; if(r) r(); }
  }, 2000);
}
async function savePrefsToFirebase(){
  if(!me||!me.number||typeof fbdb==='undefined') return;
  try{
    const prefs={
      contacts:(contacts||[]).filter(c=>c&&String(c.number)!=='00000').map(({type,number,name,key,bio,info,members,request,isSelf})=>({type,number,name,key,bio:bio||undefined,info:info||undefined,members:members||undefined,request:request||undefined,isSelf:isSelf||undefined})),
      locked:lockedChats||{},
      archived:archivedContacts||{},
      muted:mutedChats||{},
      removed:removedContacts||{},
      accepted:acceptedRequests||{},
      privacy:(()=>{ try{ return JSON.parse(localStorage.getItem('cc_privacy')||'{}'); }catch{ return {}; } })(),
      dnd:dndEnabled,
      quietHours:quietHours,
      chatBg:(()=>{ try{ return localStorage.getItem('cc_chat_bg')||null; }catch{ return null; } })(),
      settingsTab:(()=>{ try{ return localStorage.getItem('cc_settings_tab')||null; }catch{ return null; } })(),
      v:2
    };
    // Privacy settings go first and on their own: other people's apps read them
    // (who can add you to groups, who sees your number).
    await fbdb.ref(USERS_BIN+'/'+me.number+'/prefs/privacy').set(JSON.parse(JSON.stringify(prefs.privacy)));
    // KNOWN ISSUE: this full write throws whenever a contact has an empty field
    // (the database rejects undefined). Leave it until the database rules have
    // been reviewed.
    await fbdb.ref(USERS_BIN+'/'+me.number+'/prefs').set(prefs);
  }catch(e){ /* non-fatal — localStorage copy still valid */ }
}
async function loadPrefsFromFirebase(){
  if(!me||!me.number||typeof fbdb==='undefined') return;
  try{
    const snap=await fbdb.ref(USERS_BIN+'/'+me.number+'/prefs').once('value');
    const prefs=snap.val();
    if(!prefs) return;
    // Merge: Firebase wins over empty localStorage, but don't overwrite
    // data the user has set on this device during THIS session.
    // Don't count the synthetic Cloudy contact as a "real" local contact —
    // if Cloudy was the only entry saved before Firebase synced, real contacts
    // from prefs would never be restored.
    const _realLocal=contacts.filter(c=>c&&c.number!=='00000');
    if(Array.isArray(prefs.contacts)&&prefs.contacts.length&&!_realLocal.length){
      contacts=prefs.contacts;
      localStorage.setItem('cc_contacts',JSON.stringify(contacts));
    }
    if(prefs.locked&&!Object.keys(lockedChats||{}).length){
      lockedChats=prefs.locked;
      localStorage.setItem('cc_locked',JSON.stringify(lockedChats));
    }
    if(prefs.archived&&!Object.keys(archivedContacts||{}).length){
      archivedContacts=prefs.archived;
      localStorage.setItem('cc_archived',JSON.stringify(archivedContacts));
    }
    if(prefs.muted&&!Object.keys(mutedChats||{}).length){
      mutedChats=prefs.muted;
      localStorage.setItem('cc_muted',JSON.stringify(mutedChats));
    }
    if(prefs.removed&&!Object.keys(removedContacts||{}).length){
      removedContacts=prefs.removed;
      localStorage.setItem('cc_removed',JSON.stringify(removedContacts));
    }
    if(prefs.accepted){
      // Merge: a request accepted on any device stays accepted.
      acceptedRequests=Object.assign({},prefs.accepted,acceptedRequests);
      localStorage.setItem('cc_requests_accepted',JSON.stringify(acceptedRequests));
    }
    if(prefs.privacy&&!localStorage.getItem('cc_privacy')){
      localStorage.setItem('cc_privacy',JSON.stringify(prefs.privacy));
    }
    // Only apply boolean settings if localStorage has no explicit value (i.e. never been set on this device)
    if(typeof prefs.dnd==='boolean'&&localStorage.getItem('cc_dnd')===null) dndEnabled=prefs.dnd;
    if(prefs.quietHours&&localStorage.getItem('cc_quiet_hours')===null) quietHours=prefs.quietHours;
    if(prefs.chatBg&&!localStorage.getItem('cc_chat_bg')){
      localStorage.setItem('cc_chat_bg',prefs.chatBg);
    }
    if(prefs.settingsTab&&!localStorage.getItem('cc_settings_tab')){
      localStorage.setItem('cc_settings_tab',prefs.settingsTab);
    }
  }catch(e){ /* non-fatal */ }
}

// -- FIREBASE (Realtime Database) ---------------------------------------------
// A stalled Firebase connection (blocked by a firewall/ad-blocker/extension, a
// DNS hiccup, etc.) leaves fbdb.ref(...).get() neither resolved nor rejected —
// same failure mode as the ipapi.co fetch fixed above (_getApproxCountry).
// getUsers() is the very first thing submitLogin()/submitSetup()/launch() all
// await, so a stuck connection there froze sign-in on an infinite spinner
// with no error ever shown. Race it against a timeout so that instead surfaces
// as a real, user-visible error.
function _withFirebaseTimeout(promise, label, ms=15000){
  return new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(new Error((label||'Request')+' timed out — check your internet connection and try again.')), ms);
    promise.then(v=>{clearTimeout(t);resolve(v);}, e=>{clearTimeout(t);reject(e);});
  });
}
// Same interface as before (getBin/putBin), so every call site elsewhere in this
// file works unchanged — only the storage backend underneath has changed.
async function getBin(path){
  try{
    const snap=await fbdb.ref(path).get();
    return snap.exists() ? snap.val() : {};
  }catch(e){
    if(e && e.code==='PERMISSION_DENIED') throw new Error('Firebase permission denied. Check your Realtime Database security rules.');
    throw new Error('Network error - check your internet connection or Firebase config.');
  }
}
async function putBin(path,data){
  try{
    await fbdb.ref(path).set(data);
    return data;
  }catch(e){
    if(e && e.code==='PERMISSION_DENIED') throw new Error('Firebase permission denied. Check your Realtime Database security rules.');
    if(e && e.message && e.message.length>10000) throw new Error('Save failed — data too large (likely a profile picture). Try a smaller image.');
    throw new Error('Network error while saving — check your internet connection.');
  }
}

// -- FIREBASE READ with WebSocket→REST fallback --------------------------------
// Firebase's JS SDK talks over a WebSocket (falling back to long-polling if
// that's blocked) — some corporate/school networks, VPNs and privacy
// extensions block exactly that kind of connection while leaving ordinary
// HTTPS requests completely untouched, which from inside the SDK is
// indistinguishable from a dead connection (that hang is what
// _withFirebaseTimeout above turns into a visible error at all, instead of
// an infinite spinner). If the SDK path times out, fall back to Firebase's
// plain HTTPS REST API (carrying the same anonymous auth session the SDK
// uses — see _fetchFirebaseRest) over a transport a block on WebSockets
// specifically can't touch — before giving up for real.
//
// Sticky: getUsers()/getConvos() are two of the most-called functions in the
// whole file (70+ call sites between them), including the 25s poll loop —
// paying the full SDK timeout on EVERY one of those calls, every tick, for a
// connection already known to be bad this session is what turned "sign-in
// eventually works via REST" into "now everything is slow". Once the SDK
// path has actually failed once, skip straight to REST on later calls;
// rechecked periodically in case the connection recovers, rather than a
// one-way downgrade for the rest of the session.
let _sdkConnBad=false, _sdkConnCheckedAt=0;
const SDK_RECHECK_MS=2*60*1000;
async function _fetchFirebaseRest(path){
  // Not every path is world-readable without auth — `users` is, but e.g.
  // `conversations` requires the same anonymous Firebase Auth session the
  // SDK already carries (the app signs in anonymously at launch; see
  // onAuthStateChanged below). That sign-in itself goes over a normal HTTPS
  // call to a different Google endpoint, not the Realtime Database's
  // WebSocket, so it's unaffected even when THAT'S what's blocked — attach
  // its token here so this fallback can actually read the same data the SDK
  // would, not just the handful of paths with fully public rules.
  let authParam='';
  try{
    const user=firebase.auth&&firebase.auth().currentUser;
    if(user) authParam='?auth='+encodeURIComponent(await user.getIdToken());
  }catch(e){}
  const res=await fetch(firebaseConfig.databaseURL+'/'+path+'.json'+authParam);
  if(!res.ok) throw new Error('REST fallback got HTTP '+res.status);
  return res.json();
}
async function _fbReadWithFallback(path,label){
  const dueForRecheck=(Date.now()-_sdkConnCheckedAt)>SDK_RECHECK_MS;
  if(!_sdkConnBad||dueForRecheck){
    try{
      // Shorter than _withFirebaseTimeout's own default: there's a real,
      // fast-succeeding fallback below worth getting to quickly rather than
      // making someone wait out a long timeout on a connection that's
      // actually just blocked, not slow.
      const snap=await _withFirebaseTimeout(fbdb.ref(path).get(),label,8000);
      _sdkConnBad=false;
      return snap.exists()?snap.val():null;
    }catch(e){
      _sdkConnBad=true; _sdkConnCheckedAt=Date.now();
      try{ return await _fetchFirebaseRest(path); }
      catch{ throw e; } // REST failed too — surface the SDK's original error, it's the more informative one
    }
  }
  try{
    return await _fetchFirebaseRest(path);
  }catch(e){
    // REST failed too this time — give the SDK one more real shot before giving up
    try{
      const snap=await _withFirebaseTimeout(fbdb.ref(path).get(),label,8000);
      _sdkConnBad=false;
      return snap.exists()?snap.val():null;
    }catch(e2){ throw e2; }
  }
}

// -- USERS ---------------------------------------------------------------------
async function getUsers(){
  const val=await _fbReadWithFallback(USERS_BIN,'Loading accounts');
  if(!val){ usersCache=[]; _usersCacheSnapshot=[]; return usersCache; }
  // Support both legacy monolithic format {users:[...]} and new per-number format {<number>:{...}}
  if(val&&val.users!==undefined){
    usersCache=(Array.isArray(val.users)?val.users:Object.values(val.users||{})).filter(Boolean);
  } else {
    usersCache=Object.values(val||{}).filter(u=>u&&u.number!=null);
  }
  // Callers mutate the objects in usersCache directly (fetch, change one
  // field, save back), so usersCache itself can't serve as the "what did
  // this look like before" baseline for saveUsers() — by the time save
  // runs, the live objects already reflect the caller's own edit. Keep a
  // deep-cloned snapshot frozen at fetch time instead.
  _usersCacheSnapshot=JSON.parse(JSON.stringify(usersCache));
  return usersCache;
}
let _usersCacheSnapshot=[];
async function saveUsers(u){
  // Guard against a cold/never-primed cache silently degrading this into a
  // blanket write again (every record looking "new" with no prior baseline
  // to diff against) — fetch a real baseline first in that case.
  if(!usersCache||!usersCache.length) await getUsers();
  const prevByNum=new Map((_usersCacheSnapshot||[]).filter(x=>x&&x.number!=null).map(x=>[x.number,x]));
  usersCache=u;
  const valid=u.filter(x=>x&&x.number!=null);
  // Write only the records that actually changed, as a scoped multi-path
  // update — NOT a single .set() over the whole table. The write rule for
  // users/$uid lets an ordinary caller touch only their own record (or an
  // unchanged one, as a no-op bypass); a blanket .set() bundles every
  // OTHER cached user's record into that same atomic write, and since
  // other users' records keep changing server-side between this caller's
  // last getUsers() and now (lastSeen, shadow-mute, lockouts, etc.), those
  // records almost never still match live data by the time this fires —
  // failing their half of the rule and getting the ENTIRE write rejected,
  // including the caller's own change. Scoping to just the changed
  // records sidesteps that staleness entirely.
  const updates={};
  const seenNumbers=new Set();
  for(const x of valid){
    seenNumbers.add(x.number);
    const before=prevByNum.get(x.number);
    if(!before||JSON.stringify(before)!==JSON.stringify(x)) updates[USERS_BIN+'/'+x.number]=x;
  }
  for(const before of prevByNum.values()){
    if(!seenNumbers.has(before.number)) updates[USERS_BIN+'/'+before.number]=null;
  }
  if(!Object.keys(updates).length) return;
  await fbdb.ref().update(updates);
  _usersCacheSnapshot=JSON.parse(JSON.stringify(usersCache));
}
async function getReports(){
  const d=await getBin('reports');
  // Support both the legacy monolithic format ({reports:[...]}) and the new
  // per-report-id keyed format ({<id>:{...},...}) — same migration pattern
  // as USERS_BIN. The Firebase rule needs each report individually
  // addressable (to tell "a new report" from "an edit to an existing one"),
  // which a single array blob can't provide.
  if(d&&d.reports!==undefined){
    reportsCache=(Array.isArray(d.reports)?d.reports:Object.values(d.reports||{})).filter(Boolean);
  }else{
    reportsCache=Object.values(d||{}).filter(r=>r&&r.id);
  }
  // See getUsers()'s matching comment: callers mutate reportsCache's
  // objects in place, so it can't double as saveReports()'s "before"
  // baseline — keep a separate deep-cloned snapshot frozen at fetch time.
  _reportsCacheSnapshot=JSON.parse(JSON.stringify(reportsCache));
  return reportsCache;
}
let _reportsCacheSnapshot=[];
async function saveReports(r){
  // Same fix as saveUsers(): write only the reports that actually changed,
  // not the whole table in one .set() — an ordinary user filing a new
  // report would otherwise need every OTHER cached report to still exactly
  // match live data (reports/$reportId's write rule has the same
  // unchanged-record bypass, for the same reason), which breaks as soon as
  // an admin has resolved/edited any report since this client last fetched.
  if(!reportsCache||!reportsCache.length) await getReports();
  const prevById=new Map((_reportsCacheSnapshot||[]).filter(x=>x&&x.id).map(x=>[x.id,x]));
  reportsCache=r;
  const valid=r.filter(x=>x&&x.id);
  const updates={};
  const seenIds=new Set();
  for(const x of valid){
    seenIds.add(x.id);
    const before=prevById.get(x.id);
    if(!before||JSON.stringify(before)!==JSON.stringify(x)) updates['reports/'+x.id]=x;
  }
  for(const before of prevById.values()){
    if(!seenIds.has(before.id)) updates['reports/'+before.id]=null;
  }
  if(!Object.keys(updates).length) return;
  await fbdb.ref().update(updates);
  _reportsCacheSnapshot=JSON.parse(JSON.stringify(reportsCache));
}
// -- MULTI-DEVICE SESSIONS -----------------------------------------------------
function getDeviceLabel(){
  const ua = navigator.userAgent || '';
  const isTablet = /iPad|Android(?!.*Mobile)/i.test(ua);
  const isMobile = /Android|iPhone|iPod|Opera Mini|IEMobile|WPDesktop/i.test(ua);
  if(isTablet) return 'SoCloudyBro Web Tablet';
  if(isMobile) return 'SoCloudyBro Web Mobile';
  return 'SoCloudyBro Web';
}
function getDeviceOS(){
  const ua = navigator.userAgent || '';
  if(/Windows/i.test(ua)) return 'Windows';
  if(/Mac OS X/i.test(ua)) return 'macOS';
  if(/iPhone|iPad/i.test(ua)) return 'iOS';
  if(/Android/i.test(ua)) return 'Android';
  if(/Linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}
function upsertSession(u){
  // Migrate old flat sessions array to devices map if needed
  if(!u.devices || typeof u.devices!=='object' || Array.isArray(u.devices)) u.devices={};
  if(Array.isArray(u.sessions) && u.sessions.length>0){
    u.sessions.forEach(s=>{
      if(s && s.id && !u.devices[s.id]){
        u.devices[s.id]={label:s.label||getDeviceLabel(),os:getDeviceOS(),firstSeen:s.createdAt||Date.now(),lastSeen:s.lastActive||Date.now(),sessions:{}};
      }
    });
    delete u.sessions;
  }
  if(!Array.isArray(u.revokedDeviceIds)) u.revokedDeviceIds=[];
  if(!Array.isArray(u.revokedDeviceMeta)) u.revokedDeviceMeta=[];
  // Prune tombstones older than 24h so this list doesn't grow forever.
  const cutoff=Date.now()-24*60*60*1000;
  u.revokedDeviceMeta=u.revokedDeviceMeta.filter(m=>m.at>cutoff);
  u.revokedDeviceIds=u.revokedDeviceMeta.map(m=>m.id);
  if(u.revokedDeviceIds.includes(deviceId)){
    // 'wipe' (security feature 19/32 — remote wipe) vs plain true (ordinary
    // remote sign-out) tells the caller whether to also clear local data.
    const meta=u.revokedDeviceMeta.find(m=>m.id===deviceId);
    return (meta&&meta.wipe)?'wipe':true;
  }
  const now=Date.now();
  if(!u.devices[deviceId]){
    u.devices[deviceId]={label:getDeviceLabel(),os:getDeviceOS(),firstSeen:now,lastSeen:now,sessions:{}};
  }else{
    u.devices[deviceId].lastSeen=now;
    if(!u.devices[deviceId].label) u.devices[deviceId].label=getDeviceLabel();
    if(!u.devices[deviceId].os) u.devices[deviceId].os=getDeviceOS();
    if(!u.devices[deviceId].sessions || typeof u.devices[deviceId].sessions!=='object' || Array.isArray(u.devices[deviceId].sessions)) u.devices[deviceId].sessions={};
  }
  return false;
}
// Records one login session under the current device entry. Called on each
// successful login (not on heartbeat) so each sign-in creates a timestamped
// entry under the device rather than just updating lastSeen.
function addLoginSession(u){
  if(!u.devices || typeof u.devices!=='object' || Array.isArray(u.devices)) return;
  const dev=u.devices[deviceId];
  if(!dev) return;
  if(!dev.sessions || typeof dev.sessions!=='object' || Array.isArray(dev.sessions)) dev.sessions={};
  const sessionKey=Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);
  dev.sessions[sessionKey]={at:Date.now()};
}
// Clears the LOCAL-SESSION data tied to the account that's signing out —
// deliberately an explicit list of what TO clear, not (as this used to be)
// "wipe everything, then restore a small allowlist". That inverted version
// wiped every device-level preference and one-time "seen it" flag on every
// single logout — theme, language, sidebar layout, and notably
// cc_tutorial_done, which is exactly why the welcome tutorial kept coming
// back after being skipped: skipping it only ever survived until the next
// logout. A new preference/flag added later now persists across logout by
// default, the way someone would actually expect, instead of silently being
// wiped unless a developer remembered to also add it to a restore list.
//
// cc_e2e_priv_<number>/cc_e2e_pub_<number> (E2E keys) are never in this list
// for the same reason as before: the private key never leaves the device,
// and wiping it would make every previously sent/received encrypted message
// silently undecryptable the moment the same account signs back in here.
// cc_device_id and cc_accounts (the saved-accounts switcher) aren't session
// data at all — they identify the device/browser itself, not whoever's
// currently signed into it.
const LOGOUT_CLEAR_KEYS=[
  'cc_me','cc_contacts','cc_locked','cc_archived','cc_muted','cc_removed',
  'cc_pin','cc_privacy','cc_cloudy_memory','cc_cloudy_msgs','cc_call_log',
  'cc_missed_calls','cc_outbox','cc_session_start','cc_switch_to',
  'cc_after_login_switch','cc_nicknames','cc_contact_notes',
  'cc_group_invite_times','cc_needs_attention','cc_birthday_posts',
  'cc_welcome_post','cc_auto_logout_reason','cc_dnd','cc_quiet_hours',
  'cc_welcomed','cc_birthday_seen',
];
const LOGOUT_CLEAR_PREFIXES=['cc_reset_ack_','cc_secq_prompted_'];
function clearLocalSessionPreservingE2EKeys(){
  for(let i=localStorage.length-1;i>=0;i--){
    const k=localStorage.key(i);
    if(!k) continue;
    if(LOGOUT_CLEAR_KEYS.includes(k)||LOGOUT_CLEAR_PREFIXES.some(p=>k.startsWith(p))) localStorage.removeItem(k);
  }
}
function forceLocalLogout(reason){
  try{ if(typeof leaveVoiceChannel==='function') leaveVoiceChannel(); }catch{}
  alert(scbErr('SCB-AUTH-01',reason||'This device was signed out remotely.'));
  clearLocalSessionPreservingE2EKeys();
  location.reload();
}
// Security feature 19/32: remote wipe. Unlike forceLocalLogout() above,
// this deliberately does NOT preserve the local E2E keys — the whole point
// of remotely wiping a lost/stolen device is that nothing usable is left
// behind on it, not even its message-decryption keys.
function forceRemoteWipeLocal(){
  try{ if(typeof leaveVoiceChannel==='function') leaveVoiceChannel(); }catch{}
  alert(scbErr('SCB-AUTH-24','This device was remotely wiped from your account — its local data, including cached messages and encryption keys, has been cleared.'));
  localStorage.clear();
  location.reload();
}
async function remoteWipeSessionEntry(id,label){
  if(!confirm('Remotely wipe "'+(label||'this device')+'"?\n\nIt will be signed out AND have its local data fully cleared — including cached messages and encryption keys — the next time it checks in (usually within a minute). Meant for a lost or stolen device.\n\nThis cannot be undone.')) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===me.number);
    if(u){
      if(u.devices&&u.devices[id]) delete u.devices[id];
      if(!Array.isArray(u.revokedDeviceMeta)) u.revokedDeviceMeta=[];
      u.revokedDeviceMeta=u.revokedDeviceMeta.filter(m=>m.id!==id);
      u.revokedDeviceMeta.push({id,at:Date.now(),wipe:true});
      await fbdb.ref(USERS_BIN+'/'+me.number).set(u);
    }
    renderSessionsList();
    showToast('Wipe scheduled','That device will be signed out and wiped the next time it checks in.');
    await _logSecurityEvent('remote_wipe','Remote wipe requested for a device').catch(()=>{});
  }catch(e){ showToast('Error',scbErr('SCB-SEC-23','That device couldn\'t be scheduled for wipe — the server rejected the change.',e.message)); }
}
function renderSessionsList(){
  const wrap = document.getElementById('sessions-list');
  if(!wrap||!me) return;
  const u = (usersCache||[]).find(x=>x.number===me.number);
  const devs = (u&&u.devices&&typeof u.devices==='object'&&!Array.isArray(u.devices)) ? u.devices : {};
  const devList = Object.entries(devs).sort(([,a],[,b])=>(b.lastSeen||0)-(a.lastSeen||0));
  const lastChecked=Number(localStorage.getItem('cc_sessions_last_checked')||0);
  wrap.innerHTML = devList.map(([id,d])=>{
    const isThis = id===deviceId;
    const ago = fmtTime(d.lastSeen||d.firstSeen);
    const sessionCount = d.sessions && typeof d.sessions==='object' ? Object.keys(d.sessions).length : 0;
    const isNew = !isThis && d.firstSeen && d.firstSeen>lastChecked;
    return `<div class="settings-row">
      <div class="settings-row-main"><div class="settings-row-label">${esc(d.label||'Unknown device')}${isThis?' <span style="color:var(--accent,#0078d4);font-weight:500">&#9679; this device</span>':''}${isNew?' <span style="font-size:10px;font-weight:700;color:#fff;background:var(--warn);border-radius:8px;padding:1px 6px;margin-left:4px">New</span>':''}</div>
      <div class="settings-row-sub">${d.os?esc(d.os)+' · ':''}First seen ${esc(fmtTime(d.firstSeen))} · Last active ${esc(ago)}${sessionCount?' · '+sessionCount+' login'+(sessionCount===1?'':'s'):''}</div></div>
      ${isThis?'':`<div class="settings-row-actions"><button class="btn btn-ghost btn-sm" data-id="${esc(id)}" onclick="removeSessionEntry(this.dataset.id)">Remove</button><button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-id="${esc(id)}" data-label="${esc(d.label||'that device')}" onclick="remoteWipeSessionEntry(this.dataset.id,this.dataset.label)">🗑️ Wipe</button></div>`}
    </div>`;
  }).join('') || '<div class="settings-row"><div class="settings-row-main settings-row-sub">No devices found</div></div>';
  localStorage.setItem('cc_sessions_last_checked',String(Date.now()));
}
async function removeSessionEntry(id){
  if(!confirm('Remove this device? It will be signed out automatically the next time it checks in (usually within a minute).')) return;
  try{
    const users = await getUsers();
    const u = users.find(x=>x.number===me.number);
    if(u && u.devices && u.devices[id]){
      delete u.devices[id];
      if(!Array.isArray(u.revokedDeviceMeta)) u.revokedDeviceMeta=[];
      u.revokedDeviceMeta.push({id,at:Date.now()});
      await fbdb.ref(USERS_BIN+'/'+me.number).set(u);
    }
    renderSessionsList();
    showToast('Device removed','It will be signed out automatically on its next check-in.');
  }catch(e){ showToast('Error', scbErr('SCB-SEC-01','That device couldn\'t be removed — the server rejected the change.',e.message)); }
}
async function logOutOtherSessions(){
  if(!confirm('Sign out every other device? Each will be logged out automatically the next time it checks in (usually within a minute).')) return;
  try{
    const users = await getUsers();
    const u = users.find(x=>x.number===me.number);
    if(u){
      const devs = u.devices && typeof u.devices==='object' && !Array.isArray(u.devices) ? u.devices : {};
      const toRevoke = Object.keys(devs).filter(id=>id!==deviceId);
      toRevoke.forEach(id=>delete devs[id]);
      u.devices = devs;
      if(!Array.isArray(u.revokedDeviceMeta)) u.revokedDeviceMeta=[];
      toRevoke.forEach(id=>u.revokedDeviceMeta.push({id,at:Date.now()}));
      await fbdb.ref(USERS_BIN+'/'+me.number).set(u);
    }
    renderSessionsList();
    showToast('Other devices signed out','They will be logged out automatically on their next check-in.');
  }catch(e){ showToast('Error', scbErr('SCB-SEC-02','Your other devices couldn\'t be signed out — the server rejected the change.',e.message)); }
}
async function registerOrUpdate(blockedOverride,blockedCallsOverride,blockedMessagesOverride){
  if(!me||!me.number) return;
  if(_savePrefsPending){
    // A prefs write is queued (see _debounceSavePrefs) but hasn't landed yet.
    // getUsers() below reads the whole record including its .prefs subtree
    // and later writes that same snapshot back verbatim — reading it now
    // would capture the PRE-write prefs and then silently overwrite the
    // real write once it lands moments later. Wait for it first, same fix
    // as the getConvos()/_saveConvosPending race.
    await _savePrefsPending.catch(()=>{});
  }
  const users=await getUsers();
  let u=users.find(x=>x.number===me.number);
  // If this account has no server record, it may be because an admin ran
  // Nuclear Reset and wiped it. Without this check, a device that's still
  // logged in (cc_me cached locally) would silently write its own cached
  // profile straight back to Firebase on the next launch/poll — resurrecting
  // an account the admin just deleted, with the admin never knowing. Refuse
  // to recreate any number the reset reserved, and sign this device out.
  if(!u){
    try{
      const rsnap=await fbdb.ref('admin_site/reserved_numbers').get();
      const reserved=rsnap.exists()?(rsnap.val()||[]):[];
      if(Array.isArray(reserved)&&reserved.some(n=>Number(n)===Number(me.number))){
        forceLocalLogout('Your account was removed by an administrator.');
        return;
      }
    }catch(e){ console.error('Reserved-number check failed',e); }
  }
  await ensureE2EKeypair();
  // Profile fields stored as plaintext — name/bio/customStatus are public by design
  // (visible to all users). Encrypting them with a shared client-visible key was
  // obfuscation only. dec() is kept below for backward compat reading old encrypted values.
  // For profile fields: always prefer me.* but fall back to the server copy
  // if the local value was wiped (e.g. after a reset). This prevents a fresh
  // session from overwriting good Firebase data with empty strings.
  if(u){
    if(!me.name&&u.name) me.name=dec(u.name)||u.name;
    if(!me.avatar&&u.avatar) me.avatar=u.avatar;
    if(!me.bio&&u.bio) me.bio=dec(u.bio)||u.bio;
    if(!me.birthdate&&u.birthdate) me.birthdate=u.birthdate;
    // Self-heals sessions still carrying the old broken `me` shape from
    // before finishLogin() copied these fields at all (see the comment
    // there) — only fills in a field that's genuinely missing (undefined,
    // meaning this session never had it), never overwrites one a user
    // deliberately just changed this session (even to false/null).
    if(typeof me.secQuestions==='undefined') me.secQuestions=u.secQuestions||null;
    if(typeof me.faceMfaEnabled==='undefined') me.faceMfaEnabled=!!u.faceMfaEnabled;
    if(typeof me.faceDescriptor==='undefined') me.faceDescriptor=u.faceDescriptor||null;
    if(typeof me.backupPinHash==='undefined') me.backupPinHash=u.backupPinHash||null;
    // Security-sensitive, admin-controlled — always take the server's current
    // value (never fall back to a locally-cached one, and never write it back
    // in `payload` below). Without this, hasPermission()/requirePermission()
    // checks read me.adminAccess, which was never populated from anywhere,
    // so a permission an admin granted via the permission editor would never
    // actually take effect on the grantee's own session.
    me.adminAccess=u.adminAccess||null;
    // Time-limited admin grants (openPermissionEditor()'s expiry field)
    // self-heal the same way shadowMuteExpiresAt does below — once past,
    // clear it here rather than leaving a stale, now-meaningless adminAccess
    // object sitting on the record. hasPermission()/hasAnyAdminAccess()
    // already refuse an expired grant client-side the moment it passes
    // (both check expiresAt directly); this just tidies the stored data to
    // match on the next poll.
    if(me.adminAccess&&me.adminAccess.expiresAt&&Date.now()>=me.adminAccess.expiresAt){
      me.adminAccess=null;
      fbdb.ref('users/'+me.number+'/adminAccess').remove().catch(()=>{});
    }
    // Same reasoning as adminAccess above: shadow-mute is an admin-applied
    // restriction, not something this device should keep a stale cached
    // copy of — an admin lifting it must take effect on the very next poll,
    // same as applying it in the first place.
    me.shadowMuted=!!u.shadowMuted;
    // "Mute for X hours" (adminShadowMuteForHours()) stamps shadowMuteExpiresAt
    // alongside shadowMuted — self-heals back to unmuted here once it's past,
    // same best-effort fire-and-forget pattern the reserved-numbers check
    // above uses, rather than needing a server-side cron the app doesn't have.
    if(u.shadowMuted&&u.shadowMuteExpiresAt&&Date.now()>=u.shadowMuteExpiresAt){
      me.shadowMuted=false;
      fbdb.ref('users/'+me.number).update({shadowMuted:false,shadowMuteExpiresAt:null}).catch(()=>{});
    }
    // The Worker stamps this when a brute-force lockout actually triggers
    // (5 failed attempts) — refreshed on every poll, not just fresh login,
    // so an already-logged-in device picks up "someone just tried to
    // brute-force your account" even if it happened on a different device.
    // maybeShowLockoutAlert() does its own once-per-episode de-dupe.
    me.lastLockoutAt=u.lastLockoutAt||null;
    if(me.lastLockoutAt) maybeShowLockoutAlert();
    try{ saveStorage(); }catch(e){}
  }
  // `blocked` can't use the simple "prefer me.* over server" rule every other
  // field here uses: that always keeps whatever this device last happened to
  // have in memory, so any OTHER device/session whose `me.blocked` predates a
  // block/unblock made elsewhere (very easy — it's only ever populated at
  // login, never refreshed) silently overwrites the real block with its own
  // stale copy the next time it calls registerOrUpdate() for anything at all
  // (an avatar change, a theme toggle...). Server wins by default, like
  // `restrictions` below — the one device actually performing a block/unblock
  // (toggleBlockUser/cloudyBlockToggle) passes its new list explicitly instead
  // of relying on ambient `me.blocked`, so its own change is never lost either.
  const blocked = blockedOverride!==undefined ? blockedOverride : ((u&&u.blocked)||me.blocked||[]);
  // Security feature 31/32 — granular blocklist: block-everything (`blocked`
  // above) still blocks both, but these let someone block just one or the
  // other. Same override pattern as `blocked`: the one device actually
  // toggling it passes its new list explicitly, everyone else falls back to
  // the server's copy.
  const blockedCalls = blockedCallsOverride!==undefined ? blockedCallsOverride : ((u&&u.blockedCalls)||me.blockedCalls||[]);
  const blockedMessages = blockedMessagesOverride!==undefined ? blockedMessagesOverride : ((u&&u.blockedMessages)||me.blockedMessages||[]);
  // lastActive is a SEPARATE field from lastSeen, deliberately never gated
  // by the showOnline privacy pref. lastSeen is the public-facing "online
  // status" shown to others, which should legitimately freeze when a user
  // opts out of broadcasting it — but _sweepSelfDestructAccounts() uses
  // whichever of these is freshest to decide if an account is truly
  // inactive, and using lastSeen for that meant simply turning off "show
  // online status" (an unrelated privacy toggle) froze the inactivity clock
  // forever, so a fully active user could eventually have their account
  // wrongly destroyed by the inactivity sweep.
  const payload={number:me.number,name:me.name||'',bio:me.bio||'',customStatus:me.customStatus||'',avatar:me.avatar||'',email:me.email||(u&&u.email)||'',birthdate:me.birthdate||'',blocked,blockedCalls,blockedMessages,lastSeen:getPrivacyPref('showOnline',true)?Date.now():(u&&u.lastSeen)||Date.now(),lastActive:Date.now(),parentEmail:me.parentEmail||(u&&u.parentEmail)||'',parentalConsentStatus:me.parentalConsentStatus||(u&&u.parentalConsentStatus)||'',createdAt:(u&&u.createdAt)||me.createdAt||Date.now()};
  me.blocked = blocked; me.blockedCalls = blockedCalls; me.blockedMessages = blockedMessages; // keep the in-memory copy consistent with what was actually just persisted
  if(_myPubJwk) payload.pubkey=_myPubJwk;
  // Per-account settings added by the feature pack. Each falls back to whatever
  // the server already has, so a device that hasn't loaded them yet can never
  // blank them out for the other devices.
  // Security-sensitive fields: always trust the server copy, never the locally-cached me.*
  // A child account editing cc_me in localStorage cannot lift their own restrictions or
  // upgrade their tier through a normal registerOrUpdate() call.
  payload.accountTier   = (u&&u.accountTier) || deriveAccountTier(me.birthdate||(u&&u.birthdate));
  payload.themeColors   = me.themeColors || (u&&u.themeColors) || null;
  payload.largeTextMode = (typeof me.largeTextMode==='boolean') ? me.largeTextMode : !!(u&&u.largeTextMode);
  payload.childOf       = (u&&u.childOf!==undefined&&u.childOf!==null) ? u.childOf : ((me.childOf!==undefined&&me.childOf!==null)?me.childOf:null);
  payload.linkedParent  = (u&&u.linkedParent!==undefined&&u.linkedParent!==null) ? u.linkedParent : ((me.linkedParent!==undefined&&me.linkedParent!==null)?me.linkedParent:null);
  payload.restrictions  = (u&&u.restrictions) || me.restrictions || null; // server wins
  payload.language      = me.language || (u&&u.language) || (typeof getLanguage==='function'?getLanguage():'en');
  // Security feature 37/32: self-destruct after inactivity. Self-controlled,
  // same fallback rule as language above — never blanked by a device that
  // hasn't loaded it yet.
  payload.selfDestructMonths = (typeof me.selfDestructMonths==='number') ? me.selfDestructMonths : ((u&&u.selfDestructMonths)||0);
  // Connected Accounts (Settings → Connected Accounts, and the Google sign-in
  // flow on the login screen). Same "fall back to whatever the server already
  // has" rule as every field above, for the same reason: a device that hasn't
  // loaded the link yet must not blank it for the others.
  //
  // Because of that fallback, these can only be CLEARED by writing the user
  // record directly (getUsers → set to null → saveUsers), which is exactly what
  // disconnectGoogleAccount()/disconnectSyntaxAccount() do — the same approach
  // submitUnlinkParent() already uses for linkedParent.
  payload.googleSub     = me.googleSub || (u&&u.googleSub) || null;
  payload.googleEmail   = me.googleEmail || (u&&u.googleEmail) || '';
  // Sticky true — OR'd with the server's copy so a device that hasn't caught
  // up on a verification made elsewhere (or just did one locally) can never
  // accidentally write the flag back to false.
  payload.emailVerified = !!(me.emailVerified || (u&&u.emailVerified));
  payload.linkedSyntaxAccount     = (me.linkedSyntaxAccount!==undefined&&me.linkedSyntaxAccount!==null) ? me.linkedSyntaxAccount : ((u&&u.linkedSyntaxAccount)||null);
  payload.linkedSyntaxAccountName = me.linkedSyntaxAccountName || (u&&u.linkedSyntaxAccountName) || '';
  payload.bizProfile    = me.bizProfile || (u&&u.bizProfile) || null;
  // Which server badge (if any) this account displays everywhere its name
  // appears — see equippedBadgeHtml(). Self-controlled, same "server wins
  // only when this device hasn't set one at all" rule doesn't apply here:
  // selecting/clearing a badge is an explicit action (selectMyBadge/
  // clearMyBadge), so me.selectedBadge is always this device's latest intent,
  // including explicitly clearing it back to null.
  payload.selectedBadge = (me.selectedBadge!==undefined) ? me.selectedBadge : ((u&&u.selectedBadge)||null);
  if(!u){u=payload;users.push(u);}else{Object.assign(u,payload);}
  // If this device id was force-logged-out from another device/admin action,
  // clear that tombstone on a fresh explicit login (re-authenticating is what
  // un-revokes a device) rather than treating a real login as a bounce.
  if(Array.isArray(u.revokedDeviceMeta)) u.revokedDeviceMeta=u.revokedDeviceMeta.filter(m=>m.id!==deviceId);
  // Detect a genuinely new device (not just a fresh session on one already known)
  // before upsertSession records it, so we can flag it — both as an immediate
  // notice on this device, and via renderSessionsList's "new" highlight so the
  // owner notices it if they check Sessions later from another device. There's
  // no push mechanism available here to alert the owner on a device that isn't
  // the one currently logging in.
  const hasExistingDevices=u.devices && typeof u.devices==='object' && !Array.isArray(u.devices) && Object.keys(u.devices).length>0;
  const isNewDevice=hasExistingDevices && !u.devices[deviceId];
  upsertSession(u);
  addLoginSession(u);
  usersCache=users;
  // Write only our own record — avoids a race where two users calling saveUsers()
  // concurrently overwrite each other's changes with stale full-array snapshots.
  await fbdb.ref(USERS_BIN+'/'+me.number).set(u);
  // Mirror sensitive auth fields to the private node (read-restricted to the
  // account owner and the Worker's service-account token). Kept as a fire-and-
  // forget parallel write — never blocking the main profile write — because a
  // transient failure here is not user-visible and the Worker falls back to the
  // public-node copy for backward compat during the migration window.
  {
    const priv={};
    if(u.pwd)           priv.pwd           = u.pwd;
    if(u.backupPinHash) priv.backupPinHash = u.backupPinHash;
    if(u.faceDescriptor)priv.faceDescriptor= u.faceDescriptor;
    if(Object.keys(priv).length) fbdb.ref(USERS_PRIVATE+'/'+me.number).update(priv).catch(()=>{});
  }
  if(isNewDevice&&!sessionStorage.getItem('cc_new_device_notice_shown')){
    sessionStorage.setItem('cc_new_device_notice_shown','1');
    setTimeout(()=>showToast('New device signed in','If this wasn\'t you, review and revoke devices in Settings → Sessions.'),1500);
  }
}
async function heartbeat(){
  if(!me||!me.number) return;
  try{
    // Read only our own record (works in new per-number format; falls back to full
    // read if we haven't migrated yet — i.e. our record isn't at users/<number>)
    let u=null;
    const mySnap=await fbdb.ref(USERS_BIN+'/'+me.number).get();
    if(mySnap.exists()&&mySnap.val()&&mySnap.val().number!=null){
      u=mySnap.val();
    } else {
      const all=await getUsers();
      u=all.find(x=>x.number===me.number)||null;
    }
    if(u){
      u.lastSeen=Date.now();
      u.lastActive=Date.now(); // see registerOrUpdate()'s comment — never gated by the showOnline privacy pref
      const revoked=upsertSession(u);
      if(revoked){
        if(revoked==='wipe') forceRemoteWipeLocal();
        else forceLocalLogout('This device was signed out remotely from your account settings.');
        return;
      }
      // Write only our own record — no full-array write needed
      await fbdb.ref(USERS_BIN+'/'+me.number).set(u);
    }
  }catch{}
}
function isOnline(ls){return ls&&(Date.now()-ls)<40000;}
function lookupUser(num){const n=Number(num);return usersCache.find(u=>Number(u.number)===n);}

// -- CONVOS --------------------------------------------------------------------
function dmKey(a,b){return 'dm_'+[Number(a),Number(b)].sort((x,y)=>x-y).join('_');}
// Shared by getConvos() (initial load / 25s poll) AND _scbApplyConvoSnapshot()
// (the realtime .on('value') listener) — these used to duplicate this logic,
// and the realtime path silently drifted out of sync with a fix made to the
// other (missing participants/members/joinRequests normalization entirely,
// and wiping channels to [] instead of reconstructing it). One function used
// by both closes that gap for good instead of requiring the two to be
// "kept in step" by hand.
function _normalizeConvo(c){
  // Firebase Realtime Database drops empty arrays entirely on write, so any
  // conversation with zero messages comes back with `messages` missing
  // (undefined) instead of `[]` — normalize that here, once, at the source,
  // rather than guarding every single .messages access across the app.
  // Firebase may return arrays-with-holes as plain objects
  if(c.messages && !Array.isArray(c.messages)) c.messages=Object.values(c.messages).filter(Boolean);
  if(!Array.isArray(c.messages)) c.messages=[];
  // Strip pending flag — it's local-only and must never persist to Firebase
  c.messages.forEach(m=>{ if(m) delete m.pending; });
  // Firebase can return arrays-with-holes as plain objects for participants/members too
  if(c.participants && !Array.isArray(c.participants)) c.participants=Object.values(c.participants).filter(n=>n!=null);
  if(!Array.isArray(c.participants)) c.participants=[];
  if(c.members && !Array.isArray(c.members)) c.members=Object.values(c.members).filter(n=>n!=null);
  if(!Array.isArray(c.members)) c.members=[];
  // Reconstruct participants from DM key if empty (avoids isMember false-negative)
  if(c.type!=='group' && !c.participants.length && c.key && c.key.startsWith('dm_')){
    c.participants=c.key.replace('dm_','').split('_').map(Number).filter(Boolean);
  }
  // DMs must not carry channel data — if it leaked in (data bug), strip it
  if(c.type!=='group') delete c.channels;
  // Same sparse-array-as-object quirk as messages/participants/members above —
  // reconstruct instead of discarding, or a round-trip silently wipes every channel.
  if(c.channels && !Array.isArray(c.channels)) c.channels=Object.values(c.channels).filter(Boolean);
  // Only touch `channels` for groups below — for a DM it was just deleted
  // above, and `c.channels=c.channels` on an already-undefined property
  // explicitly SETS it to undefined (a real own property, not an absent
  // one). Firebase's update()/set() throws on any undefined value anywhere
  // in the payload, which broke saveConvos() for its WHOLE batched write —
  // every conversation, not just the DM — the moment convosCache held even
  // one DM. This is the bug behind "every message stuck pending".
  if(c.type==='group' && !Array.isArray(c.channels)) c.channels=[];
  if(c.joinRequests && !Array.isArray(c.joinRequests)) c.joinRequests=Object.values(c.joinRequests).filter(Boolean);
  if(c.type==='group'){
    if(!c.admins||!c.admins.length){const m=c.participants||c.members||[];c.admins=m.length?[m[0]]:[];}
    if(!c.coadmins) c.coadmins=[];
    if(!c.roles) c.roles=[];
    if(!c.memberRoles) c.memberRoles={};
    // Badges (Discord-style, server-owner-defined) — same sparse-array/object
    // quirk as roles/channels above.
    if(c.badges && !Array.isArray(c.badges)) c.badges=Object.values(c.badges).filter(Boolean);
    if(!Array.isArray(c.badges)) c.badges=[];
    if(!c.memberBadges) c.memberBadges={};
    if(!c.memberJoinedAt) c.memberJoinedAt={};
    if(!c.memberMsgCount) c.memberMsgCount={};
  }
}
async function getConvos(){
  if(_saveConvosPending){
    // Our own mutation is still queued in the 350ms debounce — reading the
    // server now would fetch the pre-write snapshot and silently revert the
    // in-memory change (and then the debounce timer would re-save that
    // reverted state, losing the change on both ends). Wait for our own
    // write to land first, so we always read at least what we just wrote.
    await _saveConvosPending.catch(()=>{});
  }
  const val=await _fbReadWithFallback(CONVOS_BIN,'Loading conversations');
  let rawArr=[];
  if(val){
    if(val.conversations!==undefined){
      // Legacy monolithic format: {conversations:[...]}
      rawArr=Array.isArray(val.conversations)?val.conversations:Object.values(val.conversations||{});
    } else if(typeof val==='object'){
      // New per-key format: {<convoKey>:{...convo...}}
      rawArr=Object.values(val).filter(c=>c&&c.key);
    }
  }
  // Strip falsy slots (Firebase can introduce null gaps in arrays)
  convosCache=rawArr.filter(Boolean);
  convosCache.forEach(c=>{
    // Wrapped per-conversation: a bug or corrupted field in one conversation
    // (e.g. a group's malformed data) must never block loading/opening any
    // other conversation just because they're normalized in the same pass.
    try{ _normalizeConvo(c); }catch(e){ console.error('Failed to normalize conversation',c&&c.key,e); }
  });
  // See getUsers()'s matching comment: callers mutate convosCache's objects
  // in place, so it can't double as saveConvos()'s "before" baseline — keep
  // a separate deep-cloned snapshot frozen at fetch time (post-normalize,
  // since that's what every conversation's OWN snapshot was also taken
  // after, making the comparison apples-to-apples).
  _convosCacheSnapshot=JSON.parse(JSON.stringify(convosCache));
  return convosCache;
}
let _convosCacheSnapshot=[];
let _saveConvosTimer=null, _saveConvosPending=null, _convosDirty=false;
function saveConvos(){
  // Coalesce rapid-fire saves (typing, votes, sends) into a single PUT request to cut JSON traffic
  if(_saveConvosPending) return _saveConvosPending;
  _saveConvosPending=new Promise((resolve,reject)=>{
    clearTimeout(_saveConvosTimer);
    _saveConvosTimer=setTimeout(async()=>{
      // `_saveConvosPending` used to be cleared HERE, before the write had
      // actually gone out. That left two holes for the whole duration of the
      // (retried, so potentially multi-second) PUT:
      //   1. a second saveConvos() during that window started a SECOND
      //      concurrent PUT of the same whole-document bin, so the two writes
      //      could land out of order and an older snapshot could clobber a
      //      newer one;
      //   2. startConvoRealtime()'s "don't overwrite local state while our own
      //      write is in flight" guard (`if(_saveConvosPending) return;`) read
      //      false while the write was still in flight, so a pre-write server
      //      snapshot could replace convosCache and drop the message that was
      //      at that very moment being saved.
      // Clear it only once the write has settled, which is what both callers
      // already assumed it meant.
      try{
        // Strip local-only flags before writing — pending:true must never persist to Firebase.
        // Also prune messages that have passed their disappearing-message TTL.
        const toSave=convosCache.map(c=>{
          if(!c) return c;
          let msgs=c.messages||[];
          if(c.disappearAfter&&c.disappearAfter>0){
            const cutoff=Date.now()-c.disappearAfter;
            msgs=msgs.filter(m=>!m||!m.time||m.time>cutoff);
          }
          if(msgs.some(m=>m&&m.pending)) msgs=msgs.map(m=>{ if(!m||!m.pending) return m; const {pending,...rest}=m; return rest; });
          const withMsgs=msgs===c.messages?c:{...c,messages:msgs};
          // memberSet: the SAME membership as participants/members, just also
          // keyed as a map ({"1234":true}) instead of only an array — every
          // read/mutation site elsewhere in the app keeps using the arrays
          // exactly as before, untouched. This is purely additive and exists
          // only so a Firebase security rule can cheaply check "is this
          // account actually a member of this conversation" (hasChild/exists
          // on a map), which it cannot do against an array at all. Written
          // here, in the one function every conversation save already funnels
          // through, instead of at each of the many places the app adds/
          // removes a member — so this one spot tracks all of them for free
          // and future membership changes stay in sync automatically.
          const memberList=Array.isArray(withMsgs.participants)&&withMsgs.participants.length?withMsgs.participants
            :Array.isArray(withMsgs.members)?withMsgs.members:[];
          if(!memberList.length) return withMsgs;
          const memberSet={};
          memberList.forEach(n=>{ if(n!=null) memberSet[String(n)]=true; });
          return {...withMsgs,memberSet};
        });
        // Write per-conversation key — replaces the old monolithic blob.
        // update() merges keys so concurrent writers don't clobber each other's conversations.
        //
        // Only include conversations that actually changed. conversations/
        // has public READ (so convosCache can easily hold conversations —
        // public/discoverable servers especially — this user has never
        // joined), but the $convoId WRITE rule has no "unchanged" bypass at
        // all: it strictly requires memberSet to already contain this user.
        // Bundling every cached conversation into one update() meant that
        // the instant convosCache held even a single conversation this user
        // isn't a member of, Firebase rejected the ENTIRE multi-path write —
        // including the actual conversation being saved. Scoping to just
        // the changed ones (which a non-member's conversation never is,
        // since nothing here ever mutates it) sidesteps that entirely, the
        // same fix as saveUsers()/saveReports().
        const prevByKey=new Map((_convosCacheSnapshot||[]).filter(c=>c&&c.key).map(c=>[c.key,c]));
        const convoUpdates={};
        for(const c of toSave){
          if(!c||!c.key) continue;
          const before=prevByKey.get(c.key);
          if(!before||JSON.stringify(before)!==JSON.stringify(c)) convoUpdates[c.key]=c;
        }
        // Null out the legacy nested 'conversations' array key in the same atomic update —
        // Firebase treats null as "delete". Without this, getConvos() would keep finding
        // the old key and re-reading stale data, making new messages vanish on reload.
        convoUpdates['conversations']=null;
        await fbdb.ref(CONVOS_BIN).update(convoUpdates); _saveConvosPending=null; _convosDirty=false;
        _convosCacheSnapshot=JSON.parse(JSON.stringify(convosCache));
        resolve(); }
      catch(e){ _saveConvosPending=null; reject(e); }
    },350);
  });
  return _saveConvosPending;
}

// -- TOP BANNER STACK --------------------------------------------------------
// Every transient top-of-screen notice (offline/queued messages, a
// connection issue, someone's birthday, a site update, a security-setup
// nudge) used to be its own independent position:fixed;top:0 bar with no
// coordination between them — if more than one was showing at once they
// fully overlapped instead of stacking, and none of them reserved any
// space for themselves: they floated OVER the real header/content rather
// than pushing it down, visually eating into the top of the app. They're
// now compact single-line rows inside one shared stack that measures its
// own height and feeds it back via a CSS custom property, so the app
// shell reserves exactly as much space as is actually in use — zero when
// nothing is showing, and each banner stacks below the last instead of
// hiding it.
function _ensureBannerStack(){
  let stack=document.getElementById('top-banner-stack');
  if(!stack){
    stack=document.createElement('div');
    stack.id='top-banner-stack';
    document.body.appendChild(stack);
  }
  return stack;
}
function _updateBannerStackHeight(){
  const stack=document.getElementById('top-banner-stack');
  const h=stack?stack.offsetHeight:0;
  document.documentElement.style.setProperty('--banner-stack-h',h+'px');
}
// Returns the (creating if needed) compact row for a given banner id,
// appended into the shared stack — callers just set its background/content.
function _bannerRow(id){
  const stack=_ensureBannerStack();
  let row=document.getElementById(id);
  if(!row){
    row=document.createElement('div');
    row.id=id;
    row.className='top-banner-row';
    stack.appendChild(row);
  }
  return row;
}
function _removeBannerRow(id){
  const row=document.getElementById(id);
  if(row) row.remove();
  _updateBannerStackHeight();
}

// -- OFFLINE OUTBOX --------------------------------------------------------
// When the network/Firebase is unreachable, queued messages are kept (per-conversation)
// in localStorage and rendered locally with a "pending" clock icon; they're flushed
// (re-saved) automatically the moment connectivity returns, with no user action needed.
let netOnline = navigator.onLine !== false;
function getOutbox(){ try{ return JSON.parse(localStorage.getItem('cc_outbox')||'{}'); }catch{ return {}; } }
function setOutbox(ob){ localStorage.setItem('cc_outbox', JSON.stringify(ob)); }
function queueOutboxMsg(convoKey, msgId){
  const ob=getOutbox();
  if(!ob[convoKey]) ob[convoKey]=[];
  if(!ob[convoKey].includes(msgId)) ob[convoKey].push(msgId);
  setOutbox(ob);
}
function clearOutboxConvo(convoKey){
  const ob=getOutbox();
  if(ob[convoKey]){ delete ob[convoKey]; setOutbox(ob); }
}
function outboxCount(){
  const ob=getOutbox();
  return Object.values(ob).reduce((s,arr)=>s+(arr?arr.length:0),0);
}
function updateOfflineBanner(){
  const pending=outboxCount();
  if(!netOnline||pending){
    const bar=_bannerRow('offline-banner');
    bar.style.background=!netOnline?'#a8430f':'#4C46C4';
    bar.innerHTML='<span class="tbr-text">'+(!netOnline
      ? '📡 You\'re offline'+(pending?' — '+pending+' message'+(pending!==1?'s':'')+' queued':' — messages will send when you reconnect')
      : '⏳ Sending '+pending+' queued message'+(pending!==1?'s':'')+'…')+'</span>';
    _updateBannerStackHeight();
  } else {
    _removeBannerRow('offline-banner');
  }
}
// -- BIRTHDAY REMINDERS --------------------------------------------------------
function dismissBirthdayBanner(){ _removeBannerRow('birthday-banner'); }
function showBirthdayBanner(u){
  const bar=_bannerRow('birthday-banner');
  bar.style.background='#a82f68';
  const name=dec(u.name)||'Someone';
  bar.innerHTML='';
  const span=document.createElement('span');
  span.className='tbr-text';
  span.innerHTML=`🎂 <b>${esc(name)}</b>'s birthday today!`;
  const sayBtn=document.createElement('button');
  sayBtn.className='tbr-btn tbr-btn-action';
  sayBtn.style.color='#d83b86';
  sayBtn.textContent='Say Happy Birthday 🎉';
  sayBtn.onclick=()=>postBirthdayToChannel(u);
  const closeBtn=document.createElement('button');
  closeBtn.className='tbr-dismiss';
  closeBtn.textContent='✕';
  closeBtn.onclick=dismissBirthdayBanner;
  bar.appendChild(span);
  bar.appendChild(sayBtn);
  bar.appendChild(closeBtn);
  _updateBannerStackHeight();
}
function postBirthdayToChannel(u){
  const name=dec(u.name)||('#'+u.number);
  const post={
    title:'🎂 Birthday',
    body:`Happy Birthday, ${name}! 🎉 Wishing you an amazing day from everyone at SoCloudyBro! ☁️`,
    time:Date.now(),
    channel:'SoCloudyBro'
  };
  try{
    const posts=JSON.parse(localStorage.getItem('cc_birthday_posts')||'[]');
    posts.push(post);
    localStorage.setItem('cc_birthday_posts',JSON.stringify(posts));
  }catch{}
  if(updatesCache){ updatesCache.push(post); updatesCache.sort((a,b)=>b.time-a.time); }
  dismissBirthdayBanner();
  showUpdates();
  setTimeout(()=>{
    const btn=Array.from(document.querySelectorAll('.update-ch-btn')).find(b=>b.textContent.includes('SoCloudyBro'));
    if(btn) filterUpdates('SoCloudyBro',btn);
    else renderUpdates();
  },150);
  showToast('Posted to SoCloudyBro',`A birthday shoutout for ${name} is now live in the channel.`);
}
function checkBirthdaysToday(){
  if(!me) return;
  const today=new Date();
  const mm=today.getMonth(), dd=today.getDate();
  const todayKey=today.toISOString().slice(0,10);
  let seen; try{ seen=JSON.parse(localStorage.getItem('cc_birthday_seen')||'{}'); }catch{ seen={}; }
  for(const u of (usersCache||[])){
    if(!u.birthdate||u.number===me.number) continue;
    if(!(contacts||[]).some(c=>Number(c.number)===Number(u.number))) continue;
    const b=new Date(u.birthdate);
    if(isNaN(b)||b.getMonth()!==mm||b.getDate()!==dd) continue;
    const seenKey=u.number+'_'+todayKey;
    if(seen[seenKey]) continue;
    seen[seenKey]=true;
    localStorage.setItem('cc_birthday_seen',JSON.stringify(seen));
    showBirthdayBanner(u);
    sendNotif('🎂 '+(dec(u.name)||'Someone')+'\'s birthday is today!','Tap to send them a birthday message');
    break; // one banner at a time keeps it from getting noisy
  }
}
async function flushOutbox(){
  if(!netOnline) return;
  const ob=getOutbox();
  const keys=Object.keys(ob);
  if(!keys.length) return;
  if(!convosCache) { try{ await getConvos(); }catch{ return; } }
  updateOfflineBanner();
  for(const key of keys){
    const c=convosCache.find(x=>x&&x.key===key);
    if(!c){ clearOutboxConvo(key); continue; }
    try{
      await saveConvos();
      // The outbox only ever stores message IDs, never their content — if
      // the page reloaded before this message made it into convosCache (tab
      // killed, phone locked the PWA, etc.), a fresh getConvos() on relaunch
      // rebuilds convosCache from the server, which never received it, so
      // the id below is genuinely gone. This used to clear the outbox entry
      // unconditionally either way, silently losing such messages with no
      // sign anything went wrong. There's nothing left to retry for a
      // missing id, but the loss should not be silent.
      const idsForKey=ob[key]||[];
      const missingIds=[];
      idsForKey.forEach(id=>{
        const m=c.messages.find(x=>x.id===id);
        if(m) delete m.pending;
        else missingIds.push(id);
      });
      clearOutboxConvo(key);
      if(missingIds.length){
        showToast('Message not delivered',scbErr('SCB-MSG-25',missingIds.length+' queued message'+(missingIds.length===1?'':'s')+' in this chat '+(missingIds.length===1?'was':'were')+' lost before it could be resent — most likely the app closed before it saved.'));
      }
      if(activeConvo&&activeConvo.key===key){ lastMsgHash=''; renderMessages(c.messages); }
    }catch(e){ /* still offline or save failed -- retry on next flush */ break; }
  }
  updateOfflineBanner();
}
window.addEventListener('online', ()=>{ netOnline=true; updateOfflineBanner(); flushOutbox(); });
window.addEventListener('offline', ()=>{ netOnline=false; updateOfflineBanner(); });
setInterval(()=>{ if(netOnline) flushOutbox(); }, 20000);

async function getOrMakeConvo(key,participants){
  if(!convosCache) await getConvos();
  let c=convosCache.find(x=>x&&x.key===key);
  if(!c){c={key,participants,members:participants,messages:[]};convosCache.push(c);await saveConvos();}
  else if(!c.participants||!c.participants.length){c.participants=participants;c.members=participants;await saveConvos();}
  return c;
}

/* -----------------------------------------------------------------------------
   TARGET SIDE OF AN ADMIN "RESET ACCOUNT"
   -----------------------------------------------------------------------------
   An admin reset writes to the TARGET's record in the `users` bin from the
   ADMIN's browser. Nothing is pushed: the target's own tab only finds out when
   it next checks in with the server, the same contract adminBan and remote
   device revocation use.

   This has to run BEFORE registerOrUpdate() in launch(), for the same reason
   the parentalConsentStatus and pendingDeletion checks do: registerOrUpdate()
   builds its payload from the locally-cached `me` first, so a device that
   still had the old name/avatar/theme in cc_me would write them straight back
   over the reset and silently undo it.

   Idempotency: the reset's timestamp is recorded per-account in
   cc_reset_ack_<number>, so a reset is adopted exactly once per device even
   though the `accountReset` stamp stays on the record as a history marker.
   Every device of that account picks it up independently on its own next
   launch (each has its own ack key), which is what makes it work across
   devices without touching sessions.
   -------------------------------------------------------------------------- */
async function applyPendingAccountReset(){
  if(!me) return false;
  let u=null;
  try{
    const users=await getUsers();
    u=users.find(x=>x&&x.number===me.number);
  }catch(e){ console.error('Account-reset check failed:',e); return false; }
  if(!u||!u.accountReset||!u.accountReset.at) return false;
  const at=Number(u.accountReset.at)||0;
  let ack=0;
  try{ ack=Number(localStorage.getItem('cc_reset_ack_'+me.number)||0)||0; }catch(e){}
  if(at<=ack) return false;
  const regenKeys=!!u.accountReset.keys;
  // Adopt the reset profile from the authoritative record rather than guessing
  // at it locally, so `me` and the server agree before registerOrUpdate() runs.
  me.name=dec(u.name||'')||('Reset User #'+me.number);
  me.bio='';
  me.customStatus='';
  me.avatar='';
  me.themeColors=null;
  me.largeTextMode=false;
  if(u.mustChangePassword) me.mustChangePassword=true;
  // Per-device leftovers of exactly the settings that were just cleared. Chat
  // backgrounds, pins, favourites, archive and mute are per-device preferences
  // about OTHER people's chats, not this profile, so they're left alone.
  try{
    localStorage.removeItem('cc_theme_colors');
    localStorage.removeItem('cc_accent_color');
  }catch(e){}
  try{
    const root=document.documentElement;
    ['--accent','--accent2','--accent-hover','--accent-grad','--accent-bright'].forEach(v=>root.style.removeProperty(v));
    document.body.classList.remove('scb-custom-colors');
  }catch(e){}
  if(regenKeys){
    // The admin retired the published public key; the private half only ever
    // existed here, so this device is the only place a replacement can be
    // made. Drop the stored pair and every cache derived from it, then let
    // ensureE2EKeypair() mint a fresh one — registerOrUpdate(), which runs
    // straight after this in launch(), publishes it as the new `pubkey`.
    try{
      localStorage.removeItem('cc_e2e_priv_'+me.number);
      localStorage.removeItem('cc_e2e_pub_'+me.number);
    }catch(e){}
    try{
      Object.keys(_decCache).forEach(k=>delete _decCache[k]);
      Object.keys(_dmAesCache).forEach(k=>delete _dmAesCache[k]);
      Object.keys(_groupAesCache).forEach(k=>delete _groupAesCache[k]);
      Object.keys(_pubKeyCache).forEach(k=>delete _pubKeyCache[k]);
    }catch(e){}
    _myKeyPair=null; _myPubJwk=null;
    try{ await ensureE2EKeypair(); }catch(e){ console.error('E2E key regeneration failed:',e); }
  }
  try{ localStorage.setItem('cc_reset_ack_'+me.number,String(at)); }catch(e){}
  try{ saveStorage(); }catch(e){}
  // Told plainly, and only about what actually happened — the key warning is
  // shown only on the path that really rotated the keys.
  setTimeout(()=>{
    try{
      showToast('Your profile was reset by an admin', regenKeys
        ? 'Your name, bio, avatar and appearance settings were cleared and new encryption keys were created. Your chats and groups are untouched, but messages from before now may no longer be readable.'
        : 'Your name, bio, avatar and appearance settings were cleared. Your chats, groups and messages are untouched.');
    }catch(e){}
  },1200);
  return true;
}

// Reuses the existing "choose a new password" step of the recovery modal. The
// security-question steps are skipped on purpose: this person is already signed
// in, so they've authenticated — there's nothing left to prove.
function promptForcedPasswordChange(){
  if(!me||!me.mustChangePassword) return;
  try{
    _recoverState={number:me.number,verified:true,forced:true};
    document.getElementById('recover-step-number').style.display='none';
    document.getElementById('recover-step-questions').style.display='none';
    document.getElementById('recover-step-newpass').style.display='block';
    document.getElementById('recover-newpass-input').value='';
    document.getElementById('recover-newpass-error').textContent='';
    document.getElementById('recover-account-sub').textContent='An administrator asked you to choose a new password.';
    document.getElementById('recover-step-btn').textContent='Set new password';
    openModal('recover-account-modal');
  }catch(e){ console.error('forced password change prompt failed:',e); }
}

