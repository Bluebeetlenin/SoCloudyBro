// -- INIT ----------------------------------------------------------------------
let launched=false;
async function init(){
  // Guard: always dismiss the splash on any uncaught error so the app never
  // freezes on the loading screen indefinitely.
  const _dismissSplashOnError=()=>{
    const s=document.getElementById('scb-splash');
    if(s){ s.style.opacity='0'; setTimeout(()=>s.remove(),400); }
  };
  try{
  // Wait for Firebase auth state to settle before any DB op. If no user exists,
  // sign in anonymously. onAuthStateChanged fires immediately for an existing
  // session (anonymous sessions persist across page loads), so this adds no
  // perceptible delay on return visits and only a single network round-trip on
  // a fresh page load — far safer than fire-and-forget signInAnonymously().
  await Promise.race([
    new Promise(resolve=>{
      try{
        if(!window.firebase||!firebase.auth){ resolve(); return; }
        const unsub=firebase.auth().onAuthStateChanged(async user=>{
          unsub();
          if(!user){
            try{ await firebase.auth().signInAnonymously(); }
            catch(e){ console.warn('SCB-AUTH: anonymous sign-in failed:',e.message); }
          }
          resolve();
        }, ()=>resolve());
      }catch(e){ console.warn('SCB-AUTH: setup failed:',e.message); resolve(); }
    }),
    new Promise(resolve=>setTimeout(resolve,8000))
  ]);
  // (email SDK removed — reports now go through Web3Forms, 2FA uses TOTP)
  loadStorage();
  _initCompactMode();
  _initScheduledMsgs();
  loadFeatureFlags(); // best-effort, non-blocking — isFeatureEnabled() falls back to its default if this hasn't resolved yet
  // Dismiss splash — Firebase has settled and storage is loaded; the rest of
  // init (landing page, login modal, or launch) runs without the splash overlay.
  // If launch() is called it adds its own fade-out after full initialisation.
  const _splashEarly=document.getElementById('scb-splash');
  if(_splashEarly){ _splashEarly.style.opacity='0'; _splashEarly.id=''; setTimeout(()=>{ _splashEarly.remove(); },400); }
  // Always ensure setup modal is closed if we have a user
  if(me && me.number){ closeModal('setup-modal'); document.getElementById('landing-page').style.display='none'; document.getElementById('shell').style.display=''; }
  // Paint the signed-in identity and cached chat list right away. launch() below
  // makes several network calls before its own render, and until then the sidebar
  // would show the "Set up account" placeholder as if the user were signed out.
  if(me && me.number){ try{ renderMyCard(); }catch(e){} try{ renderSidebar(); }catch(e){} }
  if(!me || !me.number){
    // Check if we're switching accounts — skip landing and go straight to login
    const switchTo=localStorage.getItem('cc_switch_to')||localStorage.getItem('cc_after_login_switch');
    if(switchTo && switchTo!=='1'){
      document.getElementById('landing-page').style.display='none';
      document.getElementById('shell').style.display='';
      setTimeout(()=>{
        openModal('setup-modal');
        if(typeof switchAuthTab==='function') switchAuthTab('login');
        // Pre-fill number and switch to number mode
        loginByNumber=true;
        const lbl=document.getElementById('login-identity-label');
        const inp=document.getElementById('login-email');
        const lnk=document.getElementById('login-mode-toggle');
        if(lbl) lbl.textContent='SCB Number';
        if(inp){ inp.type='number'; inp.placeholder='Your SCB number'; inp.value=switchTo; }
        if(lnk) lnk.textContent='Use email instead';
      },100);
    } else {
      document.getElementById('landing-page').style.display='block';
      document.getElementById('shell').style.display='none';
    }
    return;
  }
  const pin=localStorage.getItem('cc_pin');
  if(pin){showLockScreen();}else{await launch();}
  }catch(e){ console.error('SCB-INIT: uncaught error, dismissing splash:',e); _dismissSplashOnError(); }
}
async function launch(){
  if(launched){hideLockScreen();return;}
  // Session auto-expiry: force re-login after 24 hours
  const SESSION_TTL=24*60*60*1000;
  try{
    const sessionStart=parseInt(localStorage.getItem('cc_session_start')||'0',10);
    if(sessionStart&&Date.now()-sessionStart>SESSION_TTL){
      localStorage.removeItem('cc_session_start');
      me=null; launched=false;
      localStorage.removeItem('cc_me');
      // Also drop the PIN lock — leaving it behind produced exactly the
      // "cc_pin set but me is null" state that crashed launch() on
      // me.parentalConsentStatus (SCB-SYS-06) the next time this device
      // reached the lock screen with a stale session.
      localStorage.removeItem('cc_pin');
      setTimeout(()=>{ openModal('setup-modal'); if(typeof switchAuthTab==='function') switchAuthTab('login'); showToast('Session expired','Your session has expired. Please log in again.'); },100);
      return;
    }
    if(!sessionStart) localStorage.setItem('cc_session_start',String(Date.now()));
  }catch{}
  launched=true;
  // checkLockPin() calls launch() on the FIRST correct PIN entry (launched
  // was still false), but this function never used to hide the lock screen
  // on that path — only the `if(launched)` re-entry guard above did. So the
  // overlay stayed up through the whole first (correct) attempt, and only
  // came down on a second PIN entry, once `launched` was already true. Hide
  // it here, immediately once the PIN is confirmed correct, instead of
  // requiring a second entry.
  hideLockScreen();
  // Email verification gate: refresh from the authoritative server record
  // first (same reason the parental-consent check below does), so verifying
  // from another device/tab — or the Google-login backfill in
  // googleAuthenticate() — is picked up immediately instead of needing a
  // stale local `me.emailVerified` to catch up first.
  if(needsEmailVerification(me)){
    try{
      const users=await getUsers();
      const u=users.find(x=>x.number===me.number);
      if(u&&u.emailVerified) me.emailVerified=true;
    }catch(e){ console.error('Email verification status check failed:',e); }
    if(needsEmailVerification(me)){
      saveStorage();
      showEmailVerifyGate();
      return;
    }
  }
  // Parental consent check runs first and can stop the whole launch: fetch the
  // authoritative server-side status before anything else touches `me`, since
  // registerOrUpdate() below would otherwise write the stale locally-cached
  // status (e.g. still 'pending') back over a parent's 'approved' update made
  // from another device/session.
  if(me.parentalConsentStatus){
    try{
      const users=await getUsers();
      const u=users.find(x=>x.number===me.number);
      if(u&&u.parentalConsentStatus) me.parentalConsentStatus=u.parentalConsentStatus;
    }catch(e){ console.error('Parental consent status check failed:',e); }
    if(me.parentalConsentStatus==='pending'||me.parentalConsentStatus==='denied'){
      saveStorage();
      showParentalPendingScreen();
      return;
    }
  }
  // Same idea for a scheduled account deletion: check the authoritative server
  // status (the cooldown may have elapsed since the last time this device was
  // open, or been cancelled from another device) before deciding whether to
  // actually perform the deletion.
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===me.number);
    if(u){ me.pendingDeletion=!!u.pendingDeletion; me.deletionScheduledAt=u.deletionScheduledAt||null; }
  }catch(e){ console.error('Deletion status check failed:',e); }
  if(me.pendingDeletion&&me.deletionScheduledAt&&Date.now()>=me.deletionScheduledAt){
    await performScheduledAccountDeletion();
    return;
  }
  // And the same idea again for an admin "Reset Account": adopt the reset from
  // the authoritative record BEFORE registerOrUpdate() below gets a chance to
  // write this device's stale cached profile back over it. Guarded so a failure
  // here can't stop the rest of the launch.
  let _resetApplied=false;
  try{ _resetApplied=await applyPendingAccountReset(); }
  catch(e){ console.error('launch() step failed: applyPendingAccountReset', e); }
  // Load persisted settings/prefs from Firebase before rendering anything,
  // so contacts, privacy settings, theme etc. are all available immediately.
  try{ await loadPrefsFromFirebase(); }
  catch(e){ console.error('launch() step failed: loadPrefsFromFirebase', e); }
  // Each step is isolated so a failure in any one of them (a render bug, a bad
  // cached value, anything) can't silently take down everything that comes after
  // it — previously this whole function was one unguarded chain, so a single
  // throw in renderSidebar() at the top meant messages, polling, heartbeat, the
  // admin panel check, and incoming calls all silently never initialized.
  const step = (name, fn) => { try { fn(); } catch (e) { console.error('launch() step failed:', name, e); } };
  step('renderMyCard', renderMyCard);
  step('renderSidebar (initial)', renderSidebar);
  step('initSidebarLayoutPref', initSidebarLayoutPref);
  step('startHB', startHB);
  step('startPoll', startPoll);
  try {
    await Promise.all([registerOrUpdate(), getConvos()]);
  } catch (e) {
    console.error('launch() step failed: registerOrUpdate/getConvos', e);
  }
  // If registerOrUpdate threw before getUsers() set usersCache, syncContactsFromConvos
  // would skip every DM contact (lookupUser returns null for everyone). Same for
  // getConvos: if it threw, convosCache is null and syncContactsFromConvos returns early.
  // Fetch both explicitly so the contact list always populates on first render.
  if(!usersCache.length){
    try{ await getUsers(); }catch(e){ console.error('launch() step failed: getUsers fallback',e); }
  }
  if(!convosCache){
    try{ await getConvos(); }catch(e){ console.error('launch() step failed: getConvos fallback',e); }
  }
  // Re-render profile card now that registerOrUpdate has refreshed me.* from Firebase
  step('renderMyCard (refreshed)', renderMyCard);
  step('syncContactsFromConvos', syncContactsFromConvos);
  step('renderSidebar (after load)', renderSidebar);
  step('updateOfflineBanner', updateOfflineBanner);
  step('checkBirthdaysToday', checkBirthdaysToday);
  step('checkSecuritySetupNudge', checkSecuritySetupNudge);
  step('checkFaceRemovalNotice', checkFaceRemovalNotice);
  step('flushOutbox', flushOutbox);
  step('requestNotifPerm', requestNotifPerm);
  step('initVoiceInput', initVoiceInput);
  step('loadChatBg', loadChatBg);
  step('initTheme', initTheme);
  step('checkAdminPanel', checkAdminPanel);
  step('watchIncomingCalls', watchIncomingCalls);
  step('checkForSiteUpdate', checkForSiteUpdate);
  step('checkPendingChildApprovals', checkPendingChildApprovals);
  step('showMainEmpty', showMainEmpty);
  // Asked for last so it lands on top of a fully-rendered app rather than
  // blocking the launch. If they dismiss it, they're asked again next launch —
  // the flag lives on the server record until a new password is actually set.
  if(me.mustChangePassword) step('promptForcedPasswordChange', promptForcedPasswordChange);
  if(_resetApplied) step('renderMyCard (after reset)', renderMyCard);
  if(shouldShowTutorial()) step('startTutorial', startTutorial);
  step('checkStaleAnonymousSession', checkStaleAnonymousSession);
  step('startMusicPolling', ()=>{ if(getSpotifyTokens()||getLastfmUsername()) startMusicPolling(); });
  // Dismiss the splash/loading screen now that the app is fully ready
  const _splash=document.getElementById('scb-splash');
  if(_splash){
    if(window._splashProgress) window._splashProgress(100);
    setTimeout(()=>{ _splash.style.opacity='0'; setTimeout(()=>{ _splash.remove(); },500); },200);
  }
}

// -- AUTH TABS & LOGIN ---------------------------------------------------------
// The setup modal (#setup-modal) is one of several "steps" below, shown one
// at a time: the main signup/login forms, plus the login-flow steps a
// session can get routed into (needs an email on file, 2FA code, face scan,
// backup PIN). Those used to each be toggled individually with raw
// style.display calls scattered across many functions — easy to forget to
// hide a sibling view when showing a new one, which would leave two views
// visible stacked on top of each other. showAuthView() is the one place
// that knows the full set and guarantees exactly one is ever visible.
const AUTH_VIEW_IDS=['signup-view','login-view','login-set-email-view','login-2fa-view'];
function showAuthView(viewId){
  AUTH_VIEW_IDS.forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display=(id===viewId)?'block':'none';
  });
}
function switchAuthTab(tab) {
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  showAuthView(tab === 'signup' ? 'signup-view' : 'login-view');
  document.getElementById('setup-error').textContent = '';
  document.getElementById('login-error').textContent = '';
  if(tab === 'signup') resetTurnstile();
}
var loginByNumber=false;
function toggleLoginMode(){
  loginByNumber=!loginByNumber;
  const label=document.getElementById('login-identity-label');
  const input=document.getElementById('login-email');
  const link=document.getElementById('login-mode-toggle');
  document.getElementById('login-error').textContent='';
  if(loginByNumber){
    label.textContent='Your number';
    input.type='number'; input.placeholder='e.g. 4821'; input.value='';
    link.textContent='Have an email on file? Log in with email instead';
  }else{
    label.textContent='Email';
    input.type='email'; input.placeholder='you@example.com'; input.value='';
    link.textContent='Signed up before email was added? Log in with your number';
  }
}

// -- TOTP (RFC 6238) — authenticator-app 2FA, no email service involved --------
function base32Encode(bytes){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits='',output='';
  for(const b of bytes) bits+=b.toString(2).padStart(8,'0');
  for(let i=0;i+5<=bits.length;i+=5) output+=alphabet[parseInt(bits.substr(i,5),2)];
  const rem=bits.length%5;
  if(rem) output+=alphabet[parseInt(bits.substr(bits.length-rem).padEnd(5,'0'),2)];
  return output;
}
function base32Decode(str){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str=str.replace(/=+$/,'').toUpperCase();
  let bits='';
  for(const c of str){ const idx=alphabet.indexOf(c); if(idx===-1) continue; bits+=idx.toString(2).padStart(5,'0'); }
  const bytes=[];
  for(let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.substr(i,8),2));
  return new Uint8Array(bytes);
}
function generateTotpSecret(){
  const bytes=new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}
async function totpCodeAt(secretB32,timeStepIndex){
  const keyBytes=base32Decode(secretB32);
  const key=await crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-1'},false,['sign']);
  const counter=new ArrayBuffer(8);
  const view=new DataView(counter);
  view.setUint32(4, timeStepIndex >>> 0);
  view.setUint32(0, Math.floor(timeStepIndex/0x100000000));
  const sig=await crypto.subtle.sign('HMAC',key,counter);
  const h=new Uint8Array(sig);
  const offset=h[h.length-1]&0xf;
  const code=((h[offset]&0x7f)<<24|(h[offset+1]&0xff)<<16|(h[offset+2]&0xff)<<8|(h[offset+3]&0xff))%1000000;
  return code.toString().padStart(6,'0');
}
async function verifyTotpCode(secretB32,code){
  const step=Math.floor(Date.now()/1000/30);
  for(const drift of [0,-1,1]){ // ±30s clock drift tolerance
    if(await totpCodeAt(secretB32,step+drift)===code) return true;
  }
  return false;
}

/* ===== TRUSTED DEVICES — skip 2FA on a device already approved
   (security feature 3/32) =====
   A random token lives only in this browser's localStorage (never sent
   anywhere as-is); only its SHA-256 hash is stored server-side next to an
   expiry, so a leaked user record can't be replayed as a login bypass
   without also having had access to this exact browser's local storage. ===== */
async function _sha256Hex(str){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function _trustedDeviceTokenKey(number){ return 'cc_trusted_device_'+number; }
function _getOrCreateTrustedDeviceToken(number){
  const key=_trustedDeviceTokenKey(number);
  let tok=localStorage.getItem(key);
  if(!tok){ tok=(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36)); localStorage.setItem(key,tok); }
  return tok;
}
const TRUSTED_DEVICE_DAYS=30;
// Called right after a successful 2FA code entry, only if the user checked
// "Trust this device". Stores {hash, expiresAt, label} server-side.
async function trustThisDevice(user){
  try{
    const token=_getOrCreateTrustedDeviceToken(user.number);
    const hash=await _sha256Hex(token);
    const users=await getUsers();
    const u=users.find(x=>x.number===user.number);
    if(!u) return;
    if(!Array.isArray(u.trustedDevices)) u.trustedDevices=[];
    u.trustedDevices=u.trustedDevices.filter(d=>d&&d.expiresAt>Date.now()&&d.hash!==hash); // drop expired + replace any existing entry for this device
    u.trustedDevices.push({hash,label:getDeviceLabel(),expiresAt:Date.now()+TRUSTED_DEVICE_DAYS*86400000});
    await saveUsers(users);
  }catch(e){ console.warn('Trust device failed (non-fatal):',e.message); }
}
// Called before showing the 2FA screen — true if THIS device already holds
// an unexpired trusted token for this account.
async function isThisDeviceTrusted(user){
  try{
    const key=_trustedDeviceTokenKey(user.number);
    const tok=localStorage.getItem(key);
    if(!tok) return false;
    const hash=await _sha256Hex(tok);
    const list=Array.isArray(user.trustedDevices)?user.trustedDevices:[];
    return list.some(d=>d&&d.hash===hash&&d.expiresAt>Date.now());
  }catch(e){ return false; }
}
async function revokeTrustedDevice(hashPrefix){
  if(!me) return;
  if(!confirm('Revoke this trusted device? It will need to enter a 2FA code again next time.')) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===me.number);
    if(!u) return;
    u.trustedDevices=(u.trustedDevices||[]).filter(d=>!d||!d.hash.startsWith(hashPrefix));
    await saveUsers(users);
    showToast('Device revoked','');
    renderTrustedDevicesList();
  }catch(e){ showToast('Failed','Could not revoke that device.'); }
}
function renderTrustedDevicesList(){
  const el=document.getElementById('scb-trusted-devices-list');
  if(!el||!me) return;
  const u=(usersCache||[]).find(x=>x.number===me.number);
  const list=(Array.isArray(u&&u.trustedDevices)?u.trustedDevices:[]).filter(d=>d&&d.expiresAt>Date.now());
  el.innerHTML=list.length
    ? list.map(d=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;font-size:12px"><span>💻 ${esc(d.label||'Device')} · expires ${new Date(d.expiresAt).toLocaleDateString()}</span><button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-hash="${esc(d.hash.slice(0,12))}" onclick="revokeTrustedDevice(this.dataset.hash)">Revoke</button></div>`).join('')
    : '<div style="font-size:12px;color:var(--muted)">No trusted devices.</div>';
}

// -- FIRST-RUN TUTORIAL ------------------------------------------------------
const TUTORIAL_STEPS=[
  {icon:'💬',title:'Welcome to SoCloudyBro!',body:'This quick tour covers the basics — feel free to skip if you\'d rather explore on your own.'},
  {icon:'👋',title:'Start a chat',body:'Tap the message icon in the sidebar to start a new conversation with anyone by their number.'},
  {icon:'👥',title:'Groups',body:'Create a group to chat with several people at once — you can even import members from a CSV file.'},
  {icon:'🎙️',title:'Voice & calls',body:'Call a contact directly, or join a group voice channel to hang out with friends live.'},
  {icon:'🔒',title:'Your security',body:'Set up a passkey, two-factor authentication, or security questions any time in Settings.'},
  {icon:'🚀',title:'You\'re all set!',body:'That\'s the basics — enjoy SoCloudyBro!'}
];
let _tutorialStepIdx=0;
function shouldShowTutorial(){ return !localStorage.getItem('cc_tutorial_done'); }
// First-run sequencing: banners and toasts wait until the welcome tour is done so
// they don't pile up on top of it.
function _tutorialBusy(){
  try{
    const t=document.getElementById('tutorial-overlay');
    return shouldShowTutorial() || (!!t && t.style.display==='flex');
  }catch(e){ return false; }
}
// Runs fn once the tour is finished (or after ~2 minutes regardless, so a
// device that can't store the "tour done" flag still gets its banners).
function _afterTutorial(fn,tries){
  tries=(tries===undefined)?80:tries;
  if(!_tutorialBusy()||tries<=0){ fn(); return; }
  setTimeout(function(){ _afterTutorial(fn,tries-1); },1500);
}
function startTutorial(){
  _tutorialStepIdx=0;
  renderTutorialStep();
  document.getElementById('tutorial-overlay').style.display='flex';
}
function renderTutorialStep(){
  const step=TUTORIAL_STEPS[_tutorialStepIdx];
  document.getElementById('tutorial-step-icon').textContent=step.icon;
  document.getElementById('tutorial-step-title').textContent=step.title;
  document.getElementById('tutorial-step-body').textContent=step.body;
  document.getElementById('tutorial-next-btn').textContent=_tutorialStepIdx===TUTORIAL_STEPS.length-1?'Get Started':'Next';
  const dots=document.getElementById('tutorial-dots');
  dots.innerHTML=TUTORIAL_STEPS.map((_,i)=>`<span style="width:6px;height:6px;border-radius:50%;background:${i===_tutorialStepIdx?'var(--accent)':'var(--border2)'}"></span>`).join('');
}
function tutorialNext(){
  _tutorialStepIdx++;
  if(_tutorialStepIdx>=TUTORIAL_STEPS.length){ skipTutorial(); return; }
  renderTutorialStep();
}
function skipTutorial(){
  localStorage.setItem('cc_tutorial_done','1');
  document.getElementById('tutorial-overlay').style.display='none';
}

let _pendingTotpSecret=null;
// -- SECURITY QUESTIONS (account recovery) ---------------------------------
const SECQ_LABELS={
  pet:"What was the name of your first pet?",
  school:"What elementary school did you attend?",
  city:"What city were you born in?",
  food:"What is your favorite food?",
  street:"What street did you grow up on?",
  mother_maiden:"What is your mother's maiden name?",
  childhood_friend:"What was the name of your best childhood friend?",
  first_car:"What was the make of your first car?",
  sport:"What sport did you play in school?",
  movie:"What is your all-time favourite movie?",
  teacher:"What was your favourite teacher's last name?",
  nickname:"What was your childhood nickname?",
  birth_hospital:"What hospital were you born in?",
  first_job:"What was your first job?",
  holiday:"What was your favourite holiday destination as a child?",
};
function onSecqSelectChange(selectId, customId){
  const sel=document.getElementById(selectId);
  const inp=document.getElementById(customId);
  if(!sel||!inp) return;
  inp.style.display=sel.value==='custom'?'block':'none';
  if(sel.value==='custom') inp.focus();
}
function normalizeSecAnswer(a){ return String(a||'').trim().toLowerCase(); }
function _secqGetQ(selectId, customId){
  const sel=document.getElementById(selectId);
  if(!sel) return '';
  if(sel.value==='custom'){
    const t=(document.getElementById(customId)||{}).value||'';
    return t.trim()?t.trim():'custom';
  }
  return SECQ_LABELS[sel.value]||sel.value;
}
function openSecurityQuestionsSetup(){
  if(!me) return;
  document.getElementById('secq-a1').value='';
  document.getElementById('secq-a2').value='';
  document.getElementById('secq-error').textContent='';
  ['secq-q1-custom','secq-q2-custom'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
  openModal('secq-setup-modal');
}
async function saveSecurityQuestions(){
  const err=document.getElementById('secq-error'); err.textContent='';
  const q1Key=document.getElementById('secq-q1').value;
  const q2Key=document.getElementById('secq-q2').value;
  const q1Text=_secqGetQ('secq-q1','secq-q1-custom');
  const q2Text=_secqGetQ('secq-q2','secq-q2-custom');
  const a1=document.getElementById('secq-a1').value.trim();
  const a2=document.getElementById('secq-a2').value.trim();
  if(q1Text===q2Text||(q1Key!=='custom'&&q1Key===q2Key)){ err.textContent=scbErr('SCB-RECOV-01','Pick two different questions.'); return; }
  if(!a1||!a2){ err.textContent=scbErr('SCB-RECOV-02','Answer both questions.'); return; }
  if(q1Key==='custom'&&q1Text==='custom'){ err.textContent='Type your first question.'; return; }
  if(q2Key==='custom'&&q2Text==='custom'){ err.textContent='Type your second question.'; return; }
  try{
    const hash1=await hashPasswordV3(normalizeSecAnswer(a1));
    const hash2=await hashPasswordV3(normalizeSecAnswer(a2));
    const users=await getUsers();
    const u=users.find(x=>x.number===me.number);
    const secQuestions=[{q:q1Text,hash:hash1},{q:q2Text,hash:hash2}];
    if(u) u.secQuestions=secQuestions;
    await saveUsers(users);
    me.secQuestions=secQuestions; saveStorage();
    closeModal('secq-setup-modal');
    updateSecQStatusUI();
    if(typeof checkSecuritySetupNudge==='function') checkSecuritySetupNudge();
    showToast('Security questions saved','You can use these to recover your account.');
  }catch(e){ err.textContent=scbErr('SCB-RECOV-03','Your security questions couldn\'t be saved — the server rejected the update.',e.message); }
}
function updateSecQStatusUI(){
  const sub=document.getElementById('secq-status-text');
  const btn=document.getElementById('secq-btn-text');
  if(!sub||!btn) return;
  if(me&&Array.isArray(me.secQuestions)&&me.secQuestions.length===2){
    sub.textContent='Set — you can use these to recover your account';
    btn.textContent='Change';
  }else{
    sub.textContent='Not set — the only way to recover your account if you forget your password';
    btn.textContent='Set Up';
  }
}

// -- ACCOUNT RECOVERY (login-side, uses the security questions above) ------
let _recoverState=null; // {number, secQuestions}
function openRecoverAccount(){
  document.getElementById('recover-number-input').value='';
  document.getElementById('recover-number-error').textContent='';
  document.getElementById('recover-step-number').style.display='block';
  document.getElementById('recover-step-questions').style.display='none';
  document.getElementById('recover-step-newpass').style.display='none';
  document.getElementById('recover-step-btn').textContent='Continue';
  document.getElementById('recover-account-sub').textContent='Enter your account number to begin.';
  _recoverState=null;
  openModal('recover-account-modal');
}
async function recoverSubmitStep(){
  if(!_recoverState){
    // Step 1: look up the account and check it actually has security questions set
    const err=document.getElementById('recover-number-error'); err.textContent='';
    const num=parseInt(document.getElementById('recover-number-input').value);
    if(!num){ err.textContent=scbErr('SCB-RECOV-04','Enter a valid account number.'); return; }
    try{
      const users=await getUsers();
      const u=users.find(x=>x.number===num);
      if(!u){ err.textContent=scbErr('SCB-RECOV-05','No account found with that number.'); return; }
      if(!Array.isArray(u.secQuestions)||u.secQuestions.length!==2){ err.textContent=scbErr('SCB-RECOV-06','This account has no security questions set up — recovery isn\'t available.'); return; }
      _recoverState={number:num,secQuestions:u.secQuestions};
      document.getElementById('recover-q1-label').textContent=SECQ_LABELS[u.secQuestions[0].q]||u.secQuestions[0].q;
      document.getElementById('recover-q2-label').textContent=SECQ_LABELS[u.secQuestions[1].q]||u.secQuestions[1].q;
      document.getElementById('recover-a1-input').value='';
      document.getElementById('recover-a2-input').value='';
      document.getElementById('recover-answers-error').textContent='';
      document.getElementById('recover-step-number').style.display='none';
      document.getElementById('recover-step-questions').style.display='block';
      document.getElementById('recover-account-sub').textContent='Answer both questions correctly to continue.';
      document.getElementById('recover-step-btn').textContent='Verify';
    }catch(e){ err.textContent=scbErr('SCB-RECOV-07','That account number couldn\'t be looked up — the server request failed.',e.message); }
  }else if(!_recoverState.verified){
    // Step 2: verify both answers
    const err=document.getElementById('recover-answers-error'); err.textContent='';
    const recoverKey='recover_'+_recoverState.number;
    const rl=_checkLoginRateLimit(recoverKey);
    if(rl&&rl.until>Date.now()){
      err.textContent=scbErr('SCB-RECOV-10','Too many incorrect attempts. Try again in '+Math.ceil((rl.until-Date.now())/60000)+' minute(s).');
      return;
    }
    const a1=document.getElementById('recover-a1-input').value;
    const a2=document.getElementById('recover-a2-input').value;
    try{
      const ok1=await verifyPassword(normalizeSecAnswer(a1),_recoverState.secQuestions[0].hash);
      const ok2=await verifyPassword(normalizeSecAnswer(a2),_recoverState.secQuestions[1].hash);
      if(!ok1||!ok2){ _recordLoginFailure(recoverKey); err.textContent=scbErr('SCB-RECOV-08','One or both answers are incorrect.'); return; }
      // The check above is a fast local pre-check (same public-read hashes
      // anyone could read anyway) — the thing that actually authorizes the
      // password write in step 3 is this: trade the plain anonymous session
      // for a real one, independently re-verified server-side against the
      // SAME two answers (see the Worker's secAnswers proof type). Without
      // this, saveUsers() in step 3 would still be writing as an anonymous
      // session that doesn't match the target account, and the users/$uid
      // rule would reject it — account recovery would locally say "verified"
      // and then fail to actually reset anything.
      const upgraded=await _tryUpgradeToCustomAuth(_recoverState.number,{secAnswers:[a1,a2]});
      if(!upgraded){ _recordLoginFailure(recoverKey); err.textContent=scbErr('SCB-RECOV-12','Your answers couldn\'t be verified by the server. Check your connection and try again.'); return; }
      _clearLoginRateLimit(recoverKey);
      _recoverState.verified=true;
      document.getElementById('recover-step-questions').style.display='none';
      document.getElementById('recover-step-newpass').style.display='block';
      document.getElementById('recover-newpass-input').value='';
      document.getElementById('recover-newpass-error').textContent='';
      document.getElementById('recover-account-sub').textContent='Choose a new password.';
      document.getElementById('recover-step-btn').textContent='Reset Password';
    }catch(e){ err.textContent=scbErr('SCB-RECOV-09','Your recovery answers couldn\'t be checked — the server request failed.',e.message); }
  }else{
    // Step 3: set the new password
    const err=document.getElementById('recover-newpass-error'); err.textContent='';
    const newPwd=document.getElementById('recover-newpass-input').value;
    if(!newPwd||newPwd.length<8){ err.textContent=scbErr('SCB-RECOV-10','Password must be at least 8 characters.'); return; }
    try{
      const users=await getUsers();
      const u=users.find(x=>x.number===_recoverState.number);
      if(u){
        u.pwd=await hashPasswordV3(newPwd);
        // An admin reset can ask for a new password (adminResetAccount's second
        // checkbox). Setting one is what satisfies that, whichever route they
        // took to get here, so clear the flag in the same write.
        u.mustChangePassword=false;
      }
      await saveUsers(users);
      // Mirror new pwd to users_private immediately so the Worker sees the
      // updated hash on the next login attempt without waiting for registerOrUpdate.
      try{ if(u&&u.pwd) await fbdb.ref(USERS_PRIVATE+'/'+u.number+'/pwd').set(u.pwd); }catch(e){}
      // If this was the signed-in account choosing its own new password, keep
      // the local copy in step so registerOrUpdate() doesn't push the old hash
      // back and so the prompt doesn't reappear on the next launch.
      if(u&&me&&me.number===u.number){
        me.pwd=u.pwd;
        me.mustChangePassword=false;
        try{ saveStorage(); }catch(e){}
        // Re-sync E2E key under the new password so other devices can restore it
        _loginRawPwd=newPwd;
        try{
          sessionStorage.removeItem('e2e_synced_'+me.number);
          const privStored=localStorage.getItem('cc_e2e_priv_'+me.number);
          if(privStored) await _syncE2EKeyToCloud(newPwd,me.number,JSON.parse(privStored));
        }catch(e){}
      }
      closeModal('recover-account-modal');
      showToast('Password reset','You can now log in with your new password.');
      _recoverState=null;
    }catch(e){ _loginRawPwd=null; err.textContent=scbErr('SCB-RECOV-11','Your new password couldn\'t be saved — the server rejected the update.',e.message); }
  }
}

function onToggleTotpClick(){
  if(!me) return;
  if(me.totpEnabled){
    if(confirm('Turn off two-factor authentication?')) disableTotp();
  } else {
    openTotpSetup();
  }
}

// -- FACE SIGN-IN RETIRED --------------------------------------------------
// Accounts that used face recognition get a notice pointing them to passkeys,
// until they add one or dismiss it.
function checkFaceRemovalNotice(){
  if(!me) return;
  const u=(usersCache||[]).find(x=>x.number===me.number);
  if(!u||!u.faceMfaEnabled){ _removeBannerRow('face-removed-banner'); return; }
  const bar=_bannerRow('face-removed-banner');
  bar.textContent='';
  bar.style.background='#4C46C4';
  const text=document.createElement('span');
  text.className='tbr-text';
  text.textContent='Face sign-in has been removed. Add a passkey to keep using your face or fingerprint on this device.';
  const add=document.createElement('button');
  add.className='tbr-btn tbr-btn-action';
  add.style.color='#4C46C4';
  add.textContent='Add passkey';
  add.onclick=registerPasskey;
  const close=document.createElement('button');
  close.className='tbr-dismiss';
  close.textContent='✕';
  close.setAttribute('aria-label','Dismiss');
  close.onclick=dismissFaceRemovalNotice;
  bar.append(text,add,close);
  _updateBannerStackHeight();
}
async function dismissFaceRemovalNotice(){
  _removeBannerRow('face-removed-banner');
  const u=me&&(usersCache||[]).find(x=>x.number===me.number);
  if(!u||!u.faceMfaEnabled) return;
  delete u.faceMfaEnabled;
  try{ await fbdb.ref(USERS_BIN+'/'+me.number+'/faceMfaEnabled').remove(); }
  catch(e){ console.warn('Could not clear the face sign-in notice',e); }
}function openTotpSetup(){
  _pendingTotpSecret=generateTotpSecret();
  document.getElementById('totp-secret-display').value=_pendingTotpSecret;
  document.getElementById('totp-confirm-code').value='';
  document.getElementById('totp-setup-error').textContent='';
  openModal('totp-setup-modal');
}
function copyTotpSecret(){
  const el=document.getElementById('totp-secret-display');
  el.select();
  try{ navigator.clipboard.writeText(el.value); showToast('Copied',''); }catch(e){}
}
async function confirmTotpSetup(){
  const code=document.getElementById('totp-confirm-code').value.trim();
  const err=document.getElementById('totp-setup-error');
  err.textContent='';
  if(!/^\d{6}$/.test(code)){ err.textContent=scbErr('SCB-SEC-07','Enter the 6-digit code.'); return; }
  const ok=await verifyTotpCode(_pendingTotpSecret,code);
  if(!ok){ err.textContent=scbErr('SCB-SEC-08','Incorrect code — check the app and try again.'); return; }
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===me.number);
    if(u){ u.totpSecret=_pendingTotpSecret; u.totpEnabled=true; }
    await saveUsers(users);
    me.totpEnabled=true; saveStorage();
    updateTotpStatusUI();
    closeModal('totp-setup-modal');
    showToast('2FA enabled','You will be asked for a code on future logins.');
  }catch(e){ err.textContent=scbErr('SCB-SEC-09','Two-factor authentication couldn\'t be enabled — the server rejected the update.',e.message); }
}
async function disableTotp(){
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===me.number);
    if(u){ u.totpEnabled=false; u.totpSecret=''; }
    await saveUsers(users);
    me.totpEnabled=false; saveStorage();
    updateTotpStatusUI();
    showToast('2FA disabled','');
  }catch(e){ showToast('Failed',scbErr('SCB-SEC-10','Two-factor authentication couldn\'t be turned off — the server rejected the change.',(e.message||''))); }
}
function updateTotpStatusUI(){
  const sub=document.getElementById('totp-status-text');
  const btn=document.getElementById('totp-btn-text');
  const nudge=document.getElementById('totp-nudge-badge');
  if(!sub||!btn) return;
  if(me&&me.totpEnabled){ sub.textContent='On — an authenticator app code is required at login'; btn.textContent='Disable'; if(nudge) nudge.style.display='none'; }
  else{ sub.textContent='Off — use an authenticator app for an extra login step'; btn.textContent='Enable'; if(nudge) nudge.style.display='inline-block'; }
}
function toggleCompactSidebar(on){
  document.body.classList.toggle('sb-compact',on);
  localStorage.setItem('cc_sb_compact',on?'1':'0');
}
function initSidebarLayoutPref(){
  const on=localStorage.getItem('cc_sb_compact')==='1';
  document.body.classList.toggle('sb-compact',on);
  const cb=document.getElementById('compact-sidebar-toggle');
  if(cb) cb.checked=on;
}
function toggleNoiseSuppress(on){
  localStorage.setItem('cc_noise_suppress',on?'1':'0');
}
function initNoiseSuppressPref(){
  const cb=document.getElementById('noise-suppress-toggle');
  if(cb) cb.checked=localStorage.getItem('cc_noise_suppress')!=='0'; // on by default
}

let pending2fa=null; // {user, pwdToStore}
// Login rate limiting: max 5 attempts per identity per 5 minutes
function _loginRateLimitKey(identity){ return 'cc_ratelimit_'+String(identity).toLowerCase(); }
function _checkLoginRateLimit(identity){
  try{
    const raw=localStorage.getItem(_loginRateLimitKey(identity));
    if(!raw) return null;
    const data=JSON.parse(raw);
    if(Date.now()>data.until) return null; // window expired
    return data;
  }catch(e){ return null; }
}
function _recordLoginFailure(identity){
  try{
    const key=_loginRateLimitKey(identity);
    const raw=localStorage.getItem(key);
    let data=raw?JSON.parse(raw):{count:0,until:0};
    if(Date.now()>data.until){ data={count:0,until:0}; }
    data.count+=1;
    if(data.count>=5) data.until=Date.now()+5*60*1000; // lock 5 min after 5 failures
    localStorage.setItem(key,JSON.stringify(data));
    return data;
  }catch(e){ return {count:1,until:0}; }
}
function _clearLoginRateLimit(identity){
  try{ localStorage.removeItem(_loginRateLimitKey(identity)); }catch(e){}
}

async function submitLogin() {
  const identity = document.getElementById('login-email').value.trim();
  const pwd = document.getElementById('login-password').value.trim();
  const err = document.getElementById('login-error'); err.textContent = '';

  if(loginByNumber){
    const num = parseInt(identity);
    if(!num || num<1000) { err.textContent = scbErr('SCB-AUTH-08','Enter a valid number.'); return; }
  } else {
    if(!identity || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) { err.textContent = scbErr('SCB-AUTH-09','Enter a valid email address.'); return; }
  }
  if(!pwd) { err.textContent = scbErr('SCB-AUTH-10','Enter your password.'); return; }

  // Rate limit check before hitting Firebase
  const rl=_checkLoginRateLimit(identity);
  if(rl&&rl.until>Date.now()){
    const secsLeft=Math.ceil((rl.until-Date.now())/1000);
    err.textContent=scbErr('SCB-AUTH-17',`Too many failed attempts. Try again in ${secsLeft} seconds.`);
    return;
  }

  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';

  try {
    const users = await getUsers();
    const user = loginByNumber
      ? users.find(u => u.number === parseInt(identity))
      : users.find(u => (u.email||'').toLowerCase() === identity.toLowerCase());
    if(!user) { _recordLoginFailure(identity); err.textContent = scbErr('SCB-AUTH-11',loginByNumber ? `#${identity} is not registered.` : 'No account found with that email.'); return; }
    if(user.banned) { err.textContent = scbErr('SCB-AUTH-12','This account has been suspended.'); return; }
    // performScheduledAccountDeletion() anonymizes the record in place and
    // blanks `pwd`. The legacy-account path below deliberately treats an empty
    // `pwd` as "no password set yet — accept any and store it", which meant a
    // deleted account's number could be logged into by ANYONE with any
    // password at all, resurrecting it (registerOrUpdate() would immediately
    // rewrite the record from the new session). A deleted account is gone.
    if(user.deleted) { err.textContent = scbErr('SCB-AUTH-13','This account has been deleted.'); return; }

    // Check the password. Older accounts carry its hash on their record; newer
    // ones don't, so the server checks those. An account with no password at all
    // is refused by the server: accepting any password and storing it would let
    // anyone who knows the number take the account over.
    let passwordOk;
    if(user.pwd){
      passwordOk = await verifyPassword(pwd, user.pwd);
    }else{
      const result = await checkPasswordWithServer(user.number, pwd);
      if(result==='unavailable'){ err.textContent = scbErr('SCB-AUTH-25','Your password couldn\'t be checked because the server didn\'t answer. Try again in a moment.'); return; }
      if(result==='locked'){ err.textContent = scbErr('SCB-AUTH-26','Too many failed attempts. Try again in 5 minutes.'); return; }
      passwordOk = result==='ok';
    }
    if(!passwordOk) {
      const rd=_recordLoginFailure(identity);
      const remaining=5-rd.count;
      err.textContent = scbErr('SCB-AUTH-14', remaining>0
        ? `Incorrect password. ${remaining} attempt${remaining===1?'':'s'} left before temporary lockout.`
        : 'Too many failed attempts. Try again in 5 minutes.');
      return;
    }
    _clearLoginRateLimit(identity);
    _loginRawPwd = pwd; // available for E2E cloud key sync/restore during this session
    // Clear any stale Google credential from an earlier login this session
    // (e.g. a failed Google attempt, or a different account entirely) —
    // otherwise finishLogin()'s _loginRawPwd-first check is fine on its
    // own here, but leaving a stale credential around is still a latent
    // trap for any future caller that checks it independently.
    _loginGoogleCredential = null;
    // Mint the real custom auth token right here, as soon as the password is
    // confirmed valid — NOT only at the end via finishLogin(). The branches
    // below (no email on file, 2FA) can all return early before
    // finishLogin() ever runs, and the "no email on file" branch in
    // particular writes to this user's own record (submitLoginSetEmail())
    // while still on the plain anonymous session if this isn't done first —
    // the users/$uid rule's self-write branch needs auth.token.number to
    // already equal this account's number, which only a minted token
    // provides. finishLogin() still calls this again at the very end for
    // every OTHER login path (such as passkeys) that reaches it
    // directly; re-running it here for password logins is a harmless no-op
    // if it already succeeded.
    const serverVerified = await _tryUpgradeToCustomAuth(user.number, {password:pwd});
    let pwdToStore = user.pwd || '';
    if(pwdToStore.indexOf('v3$')!==0){
      pwdToStore = await hashPasswordV3(pwd);
      // Move an older hash on the account record to the current format. Only
      // after the server accepted the password: the write needs that session.
      if(serverVerified && user.pwd){
        try{
          await fbdb.ref(USERS_BIN+'/'+user.number+'/pwd').set(pwdToStore);
          user.pwd = pwdToStore;
          await fbdb.ref(USERS_PRIVATE+'/'+user.number+'/pwd').set(pwdToStore);
        }catch(e){ console.warn('Password hash upgrade failed (non-fatal):',e.message); }
      }
    }
    // Risk-based login challenge: an unfamiliar country for an account with
    // established history requires explicit confirmation before continuing,
    // and forces 2FA even on an otherwise-trusted device (see below).
    const loginRisk = await _checkLoginRisk(user).catch(()=>({risky:false,country:null}));
    if(loginRisk.risky){
      const confirmed = await showRiskyLoginChallenge(loginRisk.country);
      if(!confirmed) return;
      await _logSecurityEvent('risky_login_challenge','Confirmed sign-in from '+(loginRisk.country||'an unfamiliar location')).catch(()=>{});
    }

    // Accounts created before email/password login existed may have no email
    // on file — require one now so future logins work the normal way.
    if(!user.email){
      pending2fa = null;
      _pendingEmailSetup = { user, pwdToStore };
      document.getElementById('login-set-email-input').value='';
      document.getElementById('login-set-email-error').textContent='';
      showAuthView('login-set-email-view');
      return;
    }

    if(user.totpEnabled && user.totpSecret && (loginRisk.risky || !(await isThisDeviceTrusted(user)))){
      pending2fa = { user, pwdToStore };
      document.getElementById('login-2fa-code').value = '';
      document.getElementById('login-2fa-error').textContent = '';
      showAuthView('login-2fa-view');
    } else {
      await finishLogin(user, pwdToStore);
    }
  } catch(e) {
    _loginRawPwd = null; // clear sensitive credential on any error path
    selfHeal('SCB-AUTH-15', e, { context: 'finishLogin' });
    err.textContent = scbErr('SCB-AUTH-15','Log-in couldn\'t be completed — the server rejected or failed the sign-in request.',e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Log In ↗';
  }
}
let _pendingEmailSetup=null;
async function submitLoginSetEmail(){
  const err=document.getElementById('login-set-email-error'); err.textContent='';
  if(!_pendingEmailSetup){ err.textContent=scbErr('SCB-AUTH-16','Session expired — log in again.'); return; }
  const email=document.getElementById('login-set-email-input').value.trim().toLowerCase();
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = scbErr('SCB-AUTH-17','Enter a valid email address.'); return; }
  try{
    const users=await getUsers();
    if(users.find(u=>(u.email||'').toLowerCase()===email && u.number!==_pendingEmailSetup.user.number)){
      err.textContent=scbErr('SCB-AUTH-18','That email is already used by another account.'); return;
    }
    const u=users.find(x=>x.number===_pendingEmailSetup.user.number);
    if(u){ u.email=email; await saveUsers(users); }
    const user={..._pendingEmailSetup.user, email};
    const pwdToStore=_pendingEmailSetup.pwdToStore;
    _pendingEmailSetup=null;
    if(user.totpEnabled && user.totpSecret && !(await isThisDeviceTrusted(user))){
      pending2fa = { user, pwdToStore };
      document.getElementById('login-2fa-code').value = '';
      document.getElementById('login-2fa-error').textContent = '';
      showAuthView('login-2fa-view');
    } else {
      await finishLogin(user, pwdToStore);
    }
  }catch(e){ err.textContent=scbErr('SCB-AUTH-19','Your email address couldn\'t be saved — the server rejected the update.',e.message); }
}
async function submit2faCode(){
  const err=document.getElementById('login-2fa-error'); err.textContent='';
  if(!pending2fa){ err.textContent=scbErr('SCB-AUTH-20','Session expired — log in again.'); return; }
  const entered=document.getElementById('login-2fa-code').value.trim();
  if(!/^\d{6}$/.test(entered)){ err.textContent=scbErr('SCB-AUTH-21','Enter the 6-digit code.'); return; }
  // Rate-limit guessing, same as the password step above this one in the
  // login flow uses. verifyTotpCode() is a local crypto.subtle computation
  // with no network round-trip per attempt, so without this an attacker who
  // already has the password could brute-force all 1,000,000 six-digit
  // codes client-side in seconds. Keyed separately from the password
  // attempt-counter (prefixed 2fa_) so failing the password step doesn't
  // also eat into the 2FA attempt budget, or vice versa.
  const rlId='2fa_'+pending2fa.user.number;
  const rl=_checkLoginRateLimit(rlId);
  if(rl&&rl.count>=5){ err.textContent=scbErr('SCB-AUTH-22','Too many incorrect codes. Try again in 5 minutes.'); return; }
  const btn=document.getElementById('login-2fa-btn'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  try{
    const ok=await verifyTotpCode(pending2fa.user.totpSecret,entered);
    if(!ok){
      const rd=_recordLoginFailure(rlId);
      const remaining=5-rd.count;
      err.textContent=scbErr('SCB-AUTH-22', remaining>0
        ? `Incorrect code. ${remaining} attempt${remaining===1?'':'s'} left before temporary lockout.`
        : 'Too many incorrect codes. Try again in 5 minutes.');
      return;
    }
    _clearLoginRateLimit(rlId);
    const trustEl=document.getElementById('login-2fa-trust-device');
    if(trustEl&&trustEl.checked) await trustThisDevice(pending2fa.user).catch(()=>{});
    await finishLogin(pending2fa.user, pending2fa.pwdToStore);
    pending2fa=null;
  }catch(e){ err.textContent=scbErr('SCB-AUTH-23','Your two-factor code couldn\'t be checked — the server request failed.',e.message); }
  finally{ btn.disabled=false; btn.textContent='Verify ↗'; }
}
async function finishLogin(user, pwdToStore){
  resetLocalSessionState();
  me = { name: dec(user.name), email: user.email||'', number: user.number, bio: dec(user.bio||''), pwd: pwdToStore, avatar: user.avatar||'', blocked: user.blocked||[], blockedCalls: user.blockedCalls||[], blockedMessages: user.blockedMessages||[], totpEnabled: !!user.totpEnabled, shadowMuted: !!user.shadowMuted, selfDestructMonths: user.selfDestructMonths||0,
    // Recovery state lives on the server record; Settings reads it off `me`.
    secQuestions: user.secQuestions||null,    // createdAt + emailVerified drive the email-verification gate in launch()
    // (needsEmailVerification()) — without copying them onto `me` here, that
    // check would only ever work right after signUp() (which sets them
    // directly), never after an ordinary login.
    createdAt: user.createdAt||null, emailVerified: !!user.emailVerified,
    // Fields the age-tier / parental-controls / customization features depend
    // on. These live on the server user record; without copying them onto `me`
    // at login they'd be invisible to this session until the next full refetch.
    birthdate: user.birthdate||'', accountTier: user.accountTier||'', childOf: user.childOf||null,
    linkedParent: user.linkedParent||null, restrictions: user.restrictions||null,
    themeColors: user.themeColors||null, largeTextMode: !!user.largeTextMode,
    // Connected Accounts. Copied onto `me` here for the same reason as the
    // fields above: registerOrUpdate() reads them off `me` on every save, so if
    // a fresh login didn't pick them up from the server record, the next save
    // would be writing back a session that doesn't know about the link.
    googleSub: user.googleSub||null, googleEmail: user.googleEmail||'',
    linkedSyntaxAccount: user.linkedSyntaxAccount||null,
    linkedSyntaxAccountName: user.linkedSyntaxAccountName||'',
    // Without this, hasPermission()/hasAnyAdminAccess() have nothing to read
    // until the first registerOrUpdate() poll completes after launch, so a
    // delegated admin's admin button/tabs would flash hidden then appear.
    adminAccess: user.adminAccess||null, selectedBadge: user.selectedBadge||null, lastLockoutAt: user.lastLockoutAt||null };
  // Whichever login path just succeeded (password, Google or passkey) has its
  // own server-verifiable proof, see MINT_TOKEN_ENDPOINT's comment. Password is
  // checked first; a login only ever has one set at a time.
  try{
    let _upgraded=false;
    if(_loginRawPwd) _upgraded=await _tryUpgradeToCustomAuth(me.number, {password:_loginRawPwd});
    else if(_loginGoogleCredential) _upgraded=await _tryUpgradeToCustomAuth(me.number, {googleCredential:_loginGoogleCredential});
    else if(_loginPasskeyProof) _upgraded=await _tryUpgradeToCustomAuth(me.number, {passkeyAssertion:_loginPasskeyProof});

    if(!_upgraded) showToast('Session notice','Could not fully verify your session. Some features may be limited. Try logging out and back in.',7000);
  }catch(e){}
  // A passkey assertion works once, so drop it straight away.
  _loginPasskeyProof=null;
  saveStorage();
  // Save account to multi-account list
  try{ _saveAccountToAccounts(me); }catch(e){}
  closeModal('setup-modal');
  // Handle post-switch restore
  try{ localStorage.removeItem('cc_switch_to'); localStorage.removeItem('cc_after_login_switch'); }catch(e){}
  await launch();
  // Record login history and show last-login notification. A brand-new
  // device already gets its own, more urgent toast + email from inside
  // _recordLogin() — skip the plain "Welcome back" one so this login
  // doesn't show two toasts.
  const isNewDevice=await _recordLogin().catch(()=>false);
  if(!isNewDevice) _showLastLoginNotif();
  await _logSecurityEvent('login','Successful login').catch(()=>{});
}

/* ===== PASSKEYS (WebAuthn) — security feature 1/32 =====
   Passwordless sign-in using the platform/roaming authenticator's own
   public-key credential. There is no server to verify the assertion
   signature against, so verification happens entirely client-side with
   WebCrypto — honest about the tradeoff: this is a convenience login for a
   device that already has (or can restore) this account's local E2E key,
   not a way to read messages from a brand-new device that has never signed
   in with the password or Google. ===== */
function _b64url(buf){
  return _b64(buf).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function _unb64url(str){
  const pad=str.length%4===0?'':'='.repeat(4-(str.length%4));
  return _unb64((str+pad).replace(/-/g,'+').replace(/_/g,'/'));
}
// WebAuthn assertion signatures are DER-encoded ECDSA (SEQUENCE of two
// INTEGERs); WebCrypto's verify() wants the raw r||s (64 bytes for P-256).
function _derToRawEcdsaSig(der){
  const b=new Uint8Array(der);
  let p=0;
  function readLen(){ let len=b[p++]; if(len&0x80){ const n=len&0x7f; len=0; for(let i=0;i<n;i++) len=(len<<8)|b[p++]; } return len; }
  function readInt(){
    if(b[p++]!==0x02) throw new Error('bad DER signature');
    let len=readLen();
    let bytes=Array.from(b.slice(p,p+len)); p+=len;
    while(bytes.length>32&&bytes[0]===0) bytes.shift(); // strip ASN.1 sign-padding byte(s)
    if(bytes.length<32){ const pad=new Array(32-bytes.length).fill(0); bytes=pad.concat(bytes); }
    return bytes;
  }
  if(b[p++]!==0x30) throw new Error('bad DER signature');
  readLen();
  const r=readInt(), s=readInt();
  return new Uint8Array(r.concat(s)).buffer;
}
function passkeysSupported(){
  return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && navigator.credentials.get);
}
async function registerPasskey(){
  if(!me){ showToast('Not logged in','Log in first.'); return; }
  if(!passkeysSupported()){ showToast('Not supported','Passkeys aren\'t supported in this browser or device.'); return; }
  try{
    const challenge=crypto.getRandomValues(new Uint8Array(32));
    const cred=await navigator.credentials.create({publicKey:{
      challenge,
      rp:{name:'SoCloudyBro'},
      user:{id:new TextEncoder().encode(String(me.number)), name: me.email||('#'+me.number), displayName: me.name||('#'+me.number)},
      pubKeyCredParams:[{type:'public-key',alg:-7}], // ES256
      authenticatorSelection:{userVerification:'required'},
      timeout:60000,
    }});
    if(!cred) return;
    const spki=cred.response.getPublicKey&&cred.response.getPublicKey();
    if(!spki){ showToast('Not supported','This device didn\'t return a usable public key — passkey not added.'); return; }
    const entry={ id:_b64url(cred.rawId), publicKeySpki:_b64(spki), name:(navigator.platform||'Device'), createdAt:Date.now() };
    const snap=await fbdb.ref(USERS_BIN+'/'+me.number+'/passkeys').once('value');
    const list=Array.isArray(snap.val())?snap.val():[];
    list.push(entry);
    await fbdb.ref(USERS_BIN+'/'+me.number+'/passkeys').set(list);
    await _logSecurityEvent('passkey_added','New passkey registered on this device').catch(()=>{});
    showToast('Passkey added','You can now sign in with this device\'s passkey.');
    dismissFaceRemovalNotice();
    renderSecurityPasskeysList();
  }catch(e){ showToast('Couldn\'t add passkey', e.message||'Try again.'); }
}
async function removePasskey(credId){
  if(!me) return;
  if(!confirm('Remove this passkey? You\'ll need to sign in another way on that device from now on.')) return;
  try{
    const snap=await fbdb.ref(USERS_BIN+'/'+me.number+'/passkeys').once('value');
    const list=(Array.isArray(snap.val())?snap.val():[]).filter(p=>p.id!==credId);
    await fbdb.ref(USERS_BIN+'/'+me.number+'/passkeys').set(list);
    showToast('Passkey removed','');
    renderSecurityPasskeysList();
  }catch(e){ showToast('Failed','Could not remove that passkey.'); }
}
function renderSecurityPasskeysList(){
  const el=document.getElementById('scb-passkeys-list');
  if(!el||!me) return;
  const u=(usersCache||[]).find(x=>x.number===me.number);
  const list=Array.isArray(u&&u.passkeys)?u.passkeys:[];
  el.innerHTML=list.length
    ? list.map(p=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;font-size:12px"><span>🔑 ${esc(p.name||'Device')} · added ${new Date(p.createdAt||0).toLocaleDateString()}</span><button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-id="${esc(p.id)}" onclick="removePasskey(this.dataset.id)">Remove</button></div>`).join('')
    : '<div style="font-size:12px;color:var(--muted)">No passkeys added yet.</div>';
}
// Verify a WebAuthn assertion entirely client-side against a stored SPKI
// public key — there is no server to do this, so this IS the verification.
async function _verifyPasskeyAssertion(assertion, storedEntry, expectedChallenge){
  const resp=assertion.response;
  const clientDataJSON=JSON.parse(new TextDecoder().decode(resp.clientDataJSON));
  if(clientDataJSON.type!=='webauthn.get') return false;
  if(clientDataJSON.challenge!==_b64url(expectedChallenge)) return false;
  if(clientDataJSON.origin!==location.origin) return false;
  const pubKey=await crypto.subtle.importKey('spki',_unb64(storedEntry.publicKeySpki),{name:'ECDSA',namedCurve:'P-256'},true,['verify']);
  const clientDataHash=await crypto.subtle.digest('SHA-256',resp.clientDataJSON);
  const signedData=new Uint8Array(resp.authenticatorData.byteLength+clientDataHash.byteLength);
  signedData.set(new Uint8Array(resp.authenticatorData),0);
  signedData.set(new Uint8Array(clientDataHash),resp.authenticatorData.byteLength);
  const rawSig=_derToRawEcdsaSig(resp.signature);
  return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pubKey,rawSig,signedData.buffer);
}
// Given an already-resolved user (and the password value finishLogin() expects
// for them), runs the WebAuthn challenge/verify and completes sign-in. errElId
// is the error element visible in the caller's view.
async function _attemptPasskeyLogin(user,pwdToStore,errElId){
  const err=document.getElementById(errElId); if(err) err.textContent='';
  if(!passkeysSupported()){ showToast('Not supported','Passkeys aren\'t supported in this browser or device.'); return; }
  try{
    const passkeys=Array.isArray(user.passkeys)?user.passkeys:[];
    if(!passkeys.length){ if(err) err.textContent=scbErr('SCB-AUTH-19','This account has no passkeys set up yet. Log in normally, then add one in Settings → Security.'); return; }
    // Fetch a one-time server challenge so the Worker can verify the assertion
    // isn't a replay of a previously captured one (60-second TTL).
    const workerBase=MINT_TOKEN_ENDPOINT.replace(/\/mint-token$/,'');
    const challengeRes=await fetch(workerBase+'/passkey-challenge');
    if(!challengeRes.ok) throw new Error('Could not get passkey challenge from server');
    const {challenge:challengeB64u,challengeToken}=await challengeRes.json();
    // Decode the base64url challenge bytes for the WebAuthn API.
    const challengeBytes=Uint8Array.from(atob(challengeB64u.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const assertion=await navigator.credentials.get({publicKey:{
      challenge:challengeBytes,
      allowCredentials:passkeys.map(p=>({type:'public-key',id:_unb64url(p.id)})),
      userVerification:'required',
      timeout:60000,
    }});
    if(!assertion){ if(err) err.textContent=scbErr('SCB-AUTH-20','Passkey sign-in was cancelled.'); return; }
    const matched=passkeys.find(p=>p.id===_b64url(assertion.rawId));
    if(!matched||!(await _verifyPasskeyAssertion(assertion,matched,challengeBytes))){
      if(err) err.textContent=scbErr('SCB-AUTH-21','That passkey could not be verified.');
      return;
    }
    if(user.banned){ if(err) err.textContent=scbErr('SCB-AUTH-12','This account has been suspended.'); return; }
    if(user.deleted){ if(err) err.textContent=scbErr('SCB-AUTH-13','This account has been deleted.'); return; }
    // Hand the Worker everything it needs to independently re-verify this
    // exact assertion, plus the challengeToken proving the challenge was
    // freshly issued by the Worker itself (prevents replay attacks).
    _loginRawPwd=null; _loginGoogleCredential=null;
    _loginPasskeyProof={
      credentialId:_b64url(assertion.rawId),
      clientDataJSON:_b64(assertion.response.clientDataJSON),
      authenticatorData:_b64(assertion.response.authenticatorData),
      signature:_b64(assertion.response.signature),
      challengeToken,
    };
    await finishLogin(user, pwdToStore);
  }catch(e){
    if(err) err.textContent=scbErr('SCB-AUTH-22','Passkey sign-in failed.',e.message||'');
  }
}
async function loginWithPasskey(){
  const identity=(document.getElementById('login-email')||{}).value||'';
  if(!identity.trim()){ showToast('Enter your account first','Type your email or number above, then tap "Sign in with a passkey" again.'); return; }
  const err=document.getElementById('login-error'); if(err) err.textContent='';
  let user;
  try{
    const users=await getUsers();
    user=loginByNumber ? users.find(u=>u.number===parseInt(identity)) : users.find(u=>(u.email||'').toLowerCase()===identity.trim().toLowerCase());
  }catch(e){
    if(err) err.textContent=scbErr('SCB-AUTH-22','Passkey sign-in failed.',e.message||'');
    return;
  }
  if(!user){ if(err) err.textContent=scbErr('SCB-AUTH-18','No account found for that login.'); return; }
  await _attemptPasskeyLogin(user,user.pwd,'login-error');
}
// -- LOCK SCREEN ---------------------------------------------------------------
function showLockScreen(){
  document.getElementById('lock-screen').classList.add('visible');
  if(me&&me.name){
    document.getElementById('lock-name').textContent=me.name;
    const av=document.getElementById('lock-avatar');
    if(av) renderAvatar(av,{name:me.name,avatar:me.avatar||''},80);
  }
}
function hideLockScreen(){document.getElementById('lock-screen').classList.remove('visible');}

// -- ACCOUNT DELETION (two-step, with a cooldown) -------------------------
const DELETE_ACCOUNT_COOLDOWN_MS = 7*24*60*60*1000; // 7 days (user self-delete)

// ── CHANGE PASSWORD ───────────────────────────────────────────────────────────
function openChangePassword(){
  if(!me){ showToast('Not signed in',''); return; }
  ['chpwd-current','chpwd-new','chpwd-confirm'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('chpwd-error').textContent='';
  openModal('change-password-modal');
}
/* ===== PASSWORD BREACH CHECK (security feature 8/32) =====
   Uses the Pwned Passwords k-anonymity range API (api.pwnedpasswords.com,
   free, no key): only the first 5 hex characters of the password's SHA-1
   hash are ever sent, never the password itself or the full hash — the
   matching is done locally against the ~hundreds of candidate suffixes the
   API returns for that prefix. Fails open: any network/API failure is
   treated as "not found in a breach" rather than blocking the user. ===== */
async function checkPasswordBreach(password){
  try{
    const buf=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(password));
    const hex=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
    const prefix=hex.slice(0,5), suffix=hex.slice(5);
    const res=await fetch('https://api.pwnedpasswords.com/range/'+prefix);
    if(!res.ok) return 0;
    const text=await res.text();
    const line=text.split('\n').find(l=>l.trim().toUpperCase().startsWith(suffix+':'));
    if(!line) return 0;
    const count=parseInt(line.split(':')[1]||'',10);
    return isNaN(count)?0:count;
  }catch(e){ return 0; }
}
// Shared confirm-or-cancel prompt used at both signup and password change.
// Returns true if the user should be allowed to proceed with this password.
async function _warnIfBreachedPassword(password){
  const count=await checkPasswordBreach(password).catch(()=>0);
  if(!count) return true;
  return confirm('This password has appeared in '+count.toLocaleString()+' known data breaches. We strongly recommend choosing a different one.\n\nUse it anyway?');
}
async function submitChangePassword(){
  const err=document.getElementById('chpwd-error'); err.textContent='';
  const cur=document.getElementById('chpwd-current').value;
  const nw=document.getElementById('chpwd-new').value;
  const cf=document.getElementById('chpwd-confirm').value;
  if(!cur){ err.textContent='Enter your current password.'; return; }
  if(nw.length<8){ err.textContent='New password must be at least 8 characters.'; return; }
  if(nw!==cf){ err.textContent='Passwords do not match.'; return; }
  if(!(await _warnIfBreachedPassword(nw))) return;
  // Verify current password against this app's own hashed-password system —
  // NOT Firebase Auth reauthentication. firebase.auth() here is only ever an
  // anonymous session (see init()'s signInAnonymously()); this app's real
  // login/password system is a separate salted-SHA-256 hash stored in the
  // Realtime Database (hashPassword()/verifyPassword(), the same functions
  // submitLogin() uses). The old Firebase-Auth-reauth code below always found
  // no real Firebase Auth user with an email, so it always failed with
  // "Cannot re-authenticate" no matter what the user typed — this was
  // leftover from a design that predates the app's own password system and
  // was never migrated, making Change Password completely non-functional.
  try{
    // verifyPassword() now fails closed on an empty `stored` (see its own
    // comment) rather than treating "no password set yet" as "any input is
    // correct" — so that case needs handling here instead: an account that
    // genuinely has no password yet (e.g. Google-only sign-in) has nothing
    // to verify `cur` against, and is setting its first password rather
    // than changing one, so skip the current-password check for it only.
    const ok=!me.pwd || await verifyPassword(cur,me.pwd);
    if(!ok){ err.textContent='Current password is incorrect.'; return; }
    const hashed=await hashPasswordV3(nw);
    await fbdb.ref('users/'+me.number).update({pwd:hashed});
    // Await the USERS_PRIVATE write — the Worker reads this node to verify the
    // password on login. Fire-and-forget here creates a race: a login attempt
    // on another device immediately after a password change would hit the old
    // hash and fail even with the correct new password.
    await fbdb.ref(USERS_PRIVATE+'/'+me.number+'/pwd').set(hashed).catch(()=>{});
    me.pwd=hashed; saveStorage();
    closeModal('change-password-modal');
    showToast('Password updated','Your new password is active.');
    _logSecurityEvent('password_change').catch(()=>{});
  }catch(e){
    err.textContent=scbErr('SCB-AUTH-25','Password change failed: '+(e.message||''));
  }
}
function deleteMyAccountStep1(){
  if(!me) return;
  // Deleting your account needs your PIN, not just clicking through a
  // confirmation dialog — but that only means something if a PIN actually
  // exists. Send the user to set one first rather than silently skipping
  // the PIN check for accounts that never set one.
  if(!localStorage.getItem('cc_pin')){
    showToast('Set a PIN first',scbErr('SCB-SEC-11','Go to Settings → Security and set a PIN before you can delete your account.'));
    return;
  }
  document.getElementById('delete-account-num-hint').textContent='#'+me.number;
  document.getElementById('delete-account-confirm-input').value='';
  document.getElementById('delete-account-error').textContent='';
  const pinInputs=document.querySelectorAll('#delete-pin-row .pin-digit');
  clearPinInputs(pinInputs);
  openModal('delete-account-modal');
}
async function confirmAccountDeletion(pin,pinInputs){
  const err=document.getElementById('delete-account-error'); err.textContent='';
  // #2015 (admin) cannot delete their own account
  if(me&&Number(me.number)===ADMIN_NUMBER){ err.textContent='The admin account (#2015) cannot be deleted.'; return; }
  const typed=document.getElementById('delete-account-confirm-input').value.trim();
  if(typed!==String(me.number)){ err.textContent=scbErr('SCB-SEC-12','That doesn\'t match your account number.'); if(pinInputs) clearPinInputs(pinInputs); return; }
  const stored=localStorage.getItem('cc_pin');
  if(!stored || hashPin(pin)!==stored){ err.textContent=scbErr('SCB-SEC-13','Incorrect PIN.'); if(pinInputs) clearPinInputs(pinInputs); if(pinInputs&&pinInputs[0]) pinInputs[0].focus(); return; }
  try{
    // Instant deletion — no cooldown
    await performScheduledAccountDeletion();
  }catch(e){ err.textContent=scbErr('SCB-SEC-14','Your account deletion failed — the server rejected the request.',(e.message||'')); }
}
async function cancelAccountDeletion(){
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===me.number);
    if(u){ u.pendingDeletion=false; u.deletionScheduledAt=null; }
    await saveUsers(users);
    me.pendingDeletion=false; me.deletionScheduledAt=null;
    saveStorage();
    updateDeleteAccountBanner();
    showToast('Deletion cancelled','Your account is safe.');
  }catch(e){ showToast('Failed',scbErr('SCB-SEC-15','Your scheduled account deletion couldn\'t be cancelled — the server rejected the change.',(e.message||''))); }
}
function updateDeleteAccountBanner(){
  const sub=document.getElementById('delete-account-sub');
  const btn=document.getElementById('delete-account-btn');
  if(!sub||!btn) return;
  if(me&&me.pendingDeletion&&me.deletionScheduledAt){
    const daysLeft=Math.max(0,Math.ceil((me.deletionScheduledAt-Date.now())/86400000));
    sub.innerHTML=`<span style="color:var(--danger)">Scheduled for deletion in ${daysLeft} day${daysLeft===1?'':'s'}</span>`;
    btn.textContent='Cancel deletion';
    btn.onclick=cancelAccountDeletion;
    btn.className='btn btn-ghost btn-sm';
  }else{
    sub.textContent='Permanently remove your account and data';
    btn.textContent='Delete';
    btn.onclick=deleteMyAccountStep1;
    btn.className='btn btn-danger btn-sm';
  }
}
// Actually performs the deletion once the cooldown has elapsed. Scoped
// deliberately narrow: anonymizes the user's own profile/login credentials and
// revokes their sessions, but does NOT reach into other people's stored
// conversations to strip out messages this account sent — that would mean
// mutating shared data other users depend on for their own chat history, which
// is a much larger and riskier operation than what "delete my account" needs
// to mean here. Past messages will simply display under a "Deleted User" name.
async function performScheduledAccountDeletion(){
  try{
    const users=await getUsers();
    const idx=users.findIndex(x=>x.number===me.number);
    if(idx===-1) return;
    users[idx]={
      number:me.number,name:enc('Deleted User'),bio:'',customStatus:'',avatar:'',
      pwd:'',email:'',birthdate:'',blocked:[],lastSeen:Date.now(),
      deleted:true,devices:{},totpEnabled:false,totpSecret:'',faceMfaEnabled:false,faceDescriptor:null,
      // Stated explicitly rather than just left off the replacement record: a
      // deleted account must not keep claiming a Google `sub`, or "Sign in with
      // Google" would keep matching it (the deleted check would then refuse the
      // login instead of letting that Google account start a fresh account).
      googleSub:null,googleEmail:'',linkedSyntaxAccount:null,linkedSyntaxAccountName:''
    };
    await saveUsers(users);
    // The record above doesn't cover the private node, which may still hold
    // face data or a backup PIN saved by an older version of the app.
    try{
      if(fbdb) await fbdb.ref(USERS_PRIVATE+'/'+me.number).update({faceDescriptor:null,backupPinHash:null});
    }catch(e){ console.error('performScheduledAccountDeletion: could not clear private data:',e); }
  }catch(e){ console.error('performScheduledAccountDeletion failed:',e); }
  clearLocalSessionPreservingE2EKeys();
  location.reload();
}

// -- LOGOUT --------------------------------------------------------------------
function logOut(){
  if(!confirm('Log out of SoCloudyBro?')) return;
  try{ if(typeof leaveVoiceChannel==='function') leaveVoiceChannel(); }catch{}
  try{ if(typeof leaveMeeting==='function') leaveMeeting(); }catch{}
  try{ if(typeof stopConvoRealtime==='function') stopConvoRealtime(); }catch{}
  // Removing this device's entry from the account's device list is best-effort
  // housekeeping, not something signing out should ever wait on — on a slow
  // or degraded connection this round-trip (getUsers() + saveUsers()) could
  // take several seconds on its own, which was the actual reason "signing
  // out" felt slow: the local sign-out below can't even start until this
  // finishes. Fire it off and don't block on it; at worst a stale device
  // entry lingers in the account's device list until the next successful
  // logout or a manual revoke, which is harmless.
  (async()=>{
    try{
      const users = await getUsers();
      const u = users.find(x=>x.number===me.number);
      if(u && u.devices && u.devices[deviceId]){
        delete u.devices[deviceId];
        await saveUsers(users);
      }
    }catch{}
  })();
  // Clear local session data — PIN included so reload goes straight to login —
  // but preserve the E2E key pairs so message history stays readable if this
  // same account logs back in on this same device (see
  // clearLocalSessionPreservingE2EKeys for why: a plain localStorage.clear()
  // here would silently destroy previously sent/received message content).
  clearLocalSessionPreservingE2EKeys();
  location.reload();
}
// Show/hide toggle shared by every real password field in the app (sign up,
// log in, change password, recovery, child-profile and parent/Syntax linking
// passwords) — see .pwd-field-wrap/.pwd-toggle-btn for the markup pattern.
function togglePwd(inputId,btn){
  const input=document.getElementById(inputId);
  if(!input) return;
  const show=input.type==='password';
  input.type=show?'text':'password';
  btn.textContent=show?'🙈':'👁️';
  btn.setAttribute('aria-label',show?'Hide password':'Show password');
}
function pinNav(el,idx,ctx){
  if(!/^\d$/.test(el.value)){el.value='';return;}
  const rows={lock:'lock-pin-row',set:'pin-input-row',chat:'chat-lock-overlay',delete:'delete-pin-row'};
  const row=document.getElementById(rows[ctx]);
  const inputs=row?row.querySelectorAll('.pin-digit'):[];
  if(idx<3&&inputs[idx+1]) inputs[idx+1].focus();
  if(idx===3){
    const pin=Array.from(inputs).map(i=>i.value).join('');
    if(ctx==='lock') checkLockPin(pin,inputs);
    else if(ctx==='set') handleSetPin(pin,inputs);
    else if(ctx==='chat') checkChatLockPin(pin,inputs);
    else if(ctx==='delete') confirmAccountDeletion(pin,inputs);

  }
}
function checkLockPin(pin,inputs){
  const lockData=_checkPinLocked();
  if(lockData&&lockData.until>Date.now()){
    const secsLeft=Math.ceil((lockData.until-Date.now())/1000);
    document.getElementById('lock-error').textContent=`Too many attempts. Try again in ${secsLeft}s.`;
    clearPinInputs(inputs);inputs[0].focus();return;
  }
  const stored=localStorage.getItem('cc_pin');
  if(hashPin(pin)===stored){
    _clearPinLock();
    // cc_pin can outlive cc_me/`me` — e.g. an interrupted session-expiry or
    // account-reset flow that cleared the session but not the PIN. launch()
    // unconditionally reads me.parentalConsentStatus, so a stale PIN with no
    // `me` behind it crashed here (SCB-SYS-06) instead of just sending the
    // user back to login where they belong.
    if(!me||!me.number){
      localStorage.removeItem('cc_pin');
      hideLockScreen();
      openModal('setup-modal');
      if(typeof switchAuthTab==='function') switchAuthTab('login');
      showToast('Please log in',scbErr('SCB-SEC-21','Your session expired — log in again to continue.'));
      clearPinInputs(inputs);
      return;
    }
    if(!launched){launch();}else{hideLockScreen();}
    clearPinInputs(inputs);
  }
  else{
    const rd=_recordPinFailure();
    const remaining=5-rd.count;
    document.getElementById('lock-error').textContent=rd.until>Date.now()
      ? `Too many attempts. Locked for 15 minutes.`
      : scbErr('SCB-SEC-16',`Incorrect PIN.${remaining>0?' '+remaining+' attempt'+(remaining===1?'':'s')+' left.':''}`);
    clearPinInputs(inputs);inputs[0].focus();
  }
}
function lockForgotPin(){
  if(confirm('Reset PIN? You will be taken back to the login screen.')){
    localStorage.removeItem('cc_pin');
    launched=false;
    hideLockScreen();
    me=null;
    localStorage.removeItem('cc_me');
    openModal('setup-modal');
    if(typeof switchAuthTab==='function') switchAuthTab('login');
  }
}
function hashPin(p){let h=0;for(let i=0;i<p.length;i++){h=((h<<5)-h)+p.charCodeAt(i);h|=0;}return h.toString(36);}
// Proper one-way password hashing: SHA-256 with a per-user random salt.
// Stored format: "<salt>$<hexDigest>". Falls back gracefully to legacy hashPin() values.
async function hashPassword(p,existingSalt){
  const salt=existingSalt||_b64(crypto.getRandomValues(new Uint8Array(16)));
  const data=new TextEncoder().encode(salt+':'+p);
  const buf=await crypto.subtle.digest('SHA-256',data);
  const hex=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  return salt+'$'+hex;
}
// PBKDF2-SHA256. New credentials (sign-up, password change, security answers,
// parental PIN) use "v3$<iterations>$<saltB64>$<sha256 of the derived key>".
// The slow part runs on this device and the Worker only compares the SHA-256:
// Cloudflare refuses more than 100000 iterations and limits processing time.
// The iteration count travels with the hash so it can be raised later.
const PBKDF2_ITERATIONS=600000;
const PBKDF2_MAX_ITERATIONS=2000000;
async function _pbkdf2Hex(p,saltBytes,iterations){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(p),{name:'PBKDF2'},false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:saltBytes,iterations,hash:'SHA-256'},key,256);
  return Array.from(new Uint8Array(bits)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
// The derived key for a v3 hash: what the Worker is sent in place of the secret.
// Refuses a weaker setting than this app saves.
async function stretchSecret(p,{salt,iterations}){
  if(!(iterations>=PBKDF2_ITERATIONS&&iterations<=PBKDF2_MAX_ITERATIONS)) throw new Error('Unexpected password hashing settings');
  return _pbkdf2Hex(p,new Uint8Array(_unb64(salt)),iterations);
}
async function hashPasswordV3(p,existingSaltB64,iterations){
  iterations=iterations||PBKDF2_ITERATIONS;
  const salt=existingSaltB64||_b64(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const derived=await stretchSecret(p,{salt,iterations});
  return 'v3$'+iterations+'$'+salt+'$'+await _sha256Hex(derived);
}
// Older format, kept only so hashes already saved can still be checked.
async function hashPasswordV2(p,saltB64,iterations){
  return 'v2$'+iterations+'$'+saltB64+'$'+await _pbkdf2Hex(p,new Uint8Array(_unb64(saltB64)),iterations);
}async function verifyPassword(p,stored){
  // Fail CLOSED, not open: every caller (login, change-password's "current
  // password" check, recovery security answers, parental PIN/
  // password) is verifying a secret that's supposed to already be set. A
  // missing/empty `stored` means that secret was never configured, which
  // must never be treated as "any input matches" — that previously let
  // submitChangePassword be bypassed by typing anything as the "current
  // password" on any account whose `me.pwd` was empty (e.g. reachable via
  // Google sign-in's pwdToStore=user.pwd||'').
  if(!stored) return false;
  if(stored.indexOf('v3$')===0||stored.indexOf('v2$')===0){
    const [version,iterations,salt]=stored.split('$');
    const rehash=version==='v3'?hashPasswordV3:hashPasswordV2;
    try{ return (await rehash(p,salt,parseInt(iterations,10)))===stored; }
    catch(e){ console.warn('Stored password hash could not be checked:',e.message); return false; }
  }
  if(stored.indexOf('$')>-1){
    const salt=stored.split('$')[0];
    const recomputed=await hashPassword(p,salt);
    return recomputed===stored;
  }
  // legacy weak hash format
  return stored===hashPin(p);
}
function clearPinInputs(inputs){inputs.forEach(i=>i.value='');if(inputs[0])inputs[0].focus();}

// -- PIN SETUP -----------------------------------------------------------------
function openPinSetup(){
  const has=!!localStorage.getItem('cc_pin');
  document.getElementById('pin-modal-title').textContent=has?'Change PIN':'Set PIN';
  document.getElementById('pin-modal-desc').textContent=has?'Enter your new 4-digit PIN.':'Choose a 4-digit PIN to secure your account.';
  document.getElementById('pin-remove-btn').style.display=has?'inline-flex':'none';
  pinPhase='set1';pinTemp=null;
  clearPinInputs(document.getElementById('pin-input-row').querySelectorAll('.pin-digit'));
  openModal('pin-modal');
}
function handleSetPin(pin,inputs){
  if(pinPhase==='set1'){
    pinTemp=pin;pinPhase='set2';
    document.getElementById('pin-modal-desc').textContent='Confirm your PIN.';
    clearPinInputs(inputs);inputs[0].focus();
  }else{
    if(pin===pinTemp){
      localStorage.setItem('cc_pin',hashPin(pin));
      closeModal('pin-modal');
      document.getElementById('pin-status-text').textContent='PIN is set';
      document.getElementById('pin-btn-text').textContent='Change PIN';
      showToast('PIN set','Your account is now PIN-protected.');
    }else{
      document.getElementById('pin-error').textContent=scbErr('SCB-SEC-17','PINs do not match. Try again.');
      pinPhase='set1';pinTemp=null;
      clearPinInputs(inputs);inputs[0].focus();
    }
  }
}
function confirmPin(){const r=document.getElementById('pin-input-row');const inputs=r.querySelectorAll('.pin-digit');const pin=Array.from(inputs).map(i=>i.value).join('');if(pin.length<4){document.getElementById('pin-error').textContent=scbErr('SCB-SEC-18','Enter all 4 digits.');return;}handleSetPin(pin,inputs);}
function removePin(){if(confirm('Remove PIN protection?')){localStorage.removeItem('cc_pin');closeModal('pin-modal');document.getElementById('pin-status-text').textContent='Not set';document.getElementById('pin-btn-text').textContent='Set PIN';showToast('PIN removed','Your account is no longer PIN-protected.');}}

// Security questions are the way back in after a forgotten password, so nudge
// accounts without them: a dismissible banner, not a modal wall. Dismissing it
// only lasts the session.
function checkSecuritySetupNudge(_afterTour){
  if(!me) return;
  if(!_afterTour && _tutorialBusy()){ _afterTutorial(function(){ checkSecuritySetupNudge(true); }); return; }
  const hasSecQuestions=Array.isArray(me.secQuestions)&&me.secQuestions.length===2;
  if(hasSecQuestions){ _removeBannerRow('security-setup-banner'); return; }
  try{ if(sessionStorage.getItem('cc_security_nudge_dismissed')==='1') return; }catch{}
  const bar=_bannerRow('security-setup-banner');
  bar.textContent='';
  bar.style.background='#4C46C4';
  const _ssnTxt=document.createElement('span');
  _ssnTxt.className='tbr-text';
  _ssnTxt.textContent='🔐 Add security questions so you can recover your account if you forget your password';
  const _ssnSetup=document.createElement('button');
  _ssnSetup.className='tbr-btn tbr-btn-action';
  _ssnSetup.style.color='#4C46C4';
  _ssnSetup.textContent='Set up';
  _ssnSetup.onclick=()=>{ showSettings(); switchSettingsTab('security'); };
  const _ssnDismiss=document.createElement('button');
  _ssnDismiss.className='tbr-dismiss';
  _ssnDismiss.textContent='✕';
  _ssnDismiss.onclick=dismissSecuritySetupNudge;
  bar.appendChild(_ssnTxt);
  bar.appendChild(_ssnSetup);
  bar.appendChild(_ssnDismiss);
  _updateBannerStackHeight();
}
function dismissSecuritySetupNudge(){
  try{ sessionStorage.setItem('cc_security_nudge_dismissed','1'); }catch{}
  _removeBannerRow('security-setup-banner');
}

