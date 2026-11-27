// -- "Needs attention" banner: written now, shown on the next login, dismissible
// Unread badge style: count (default, the actual number), dot (a plain
// colored dot — the count without the number), or off (no badge at all).
// Shared by every place an unread count renders so the setting is
// consistent everywhere rather than needing per-call-site wiring.
function renderUnreadBadgeHtml(count,extraStyle){
  if(!count||count<=0) return '';
  const style=getPrivacyPref('badgeStyle','count');
  const styleAttr=extraStyle?' style="'+extraStyle+'"':'';
  if(style==='off') return '';
  if(style==='dot') return '<span class="unread-badge unread-badge-dot"'+styleAttr+'></span>';
  return '<span class="unread-badge"'+styleAttr+'>'+count+'</span>';
}
function flagNeedsAttention(message){
  const existing=scbLoad('cc_needs_attention', null);
  if(existing && existing.message===message) return;
  scbSave('cc_needs_attention', {message, time:Date.now()});
  // Single chokepoint for "something genuinely critical that self-healing
  // couldn't fix" — every call site (selfHeal's exhausted-retries path,
  // Firebase permission failures, the weekly-digest failure handler, etc.)
  // gets a background notification for free, deduplicated the same way the
  // in-app banner already is (identical message = no repeat).
  if(typeof sendNotif==='function') sendNotif('⚠️ SoCloudyBro needs attention',message);
}
function showNeedsAttentionBanner(){
  const info=scbLoad('cc_needs_attention', null);
  if(!info || !info.message) return;
  if(document.getElementById('scb-attention-banner')) return;
  const bar=document.createElement('div');
  bar.id='scb-attention-banner';
  bar.innerHTML='<span class="scb-attention-text"></span><button type="button" class="scb-attention-x" title="Dismiss">✕</button>';
  bar.querySelector('.scb-attention-text').textContent='⚠️ Something needs attention: '+info.message;
  bar.querySelector('.scb-attention-x').onclick=dismissNeedsAttention;
  document.body.appendChild(bar);
}
function dismissNeedsAttention(){
  try{ localStorage.removeItem('cc_needs_attention'); }catch(e){}
  const bar=document.getElementById('scb-attention-banner');
  if(bar) bar.remove();
}
// Every Firebase read/write in the app funnels through getBin/putBin, so
// wrapping just these two gives retry-with-backoff to messaging, contacts,
// groups and account/session loading at once.
const _origGetBin = getBin;
getBin = function(path){ return withRetry(()=>_origGetBin(path), 'read:'+path); };
const _origPutBin = putBin;
putBin = function(path, data){ return withRetry(()=>_origPutBin(path, data), 'write:'+path); };

/* =============================================================================
   5. SYSTEM STATUS (Settings → System Status)
   ========================================================================== */
let _statusLastRun = null;
function statusPill(state, label){
  return '<span class="scb-pill scb-pill-'+state+'">'+esc(label)+'</span>';
}
async function checkFirebasePing(){
  const t0=Date.now();
  try{
    // Was `.ref('.info/serverTimeOffset')` — a special virtual path the SDK
    // is supposed to special-case, but it was throwing "Invalid token in
    // path" with NO network request ever appearing (confirmed in the
    // Network tab), meaning the SDK's own path validator was rejecting it
    // client-side before dispatch, on at least one real deployment. Rather
    // than chase an SDK/version quirk that isn't reproducible here, this
    // just does an ordinary shallow read — the same kind of call
    // checkMessaging() already uses successfully — which sidesteps the
    // special-path code entirely regardless of what was actually wrong with it.
    // Same unguarded-hang risk _withFirebaseTimeout exists for elsewhere in
    // this file (see getUsers()/getConvos()) — a blocked WebSocket left this
    // specific check stuck on "Checking…" forever instead of ever reporting
    // red, which defeats the entire point of a diagnostics panel.
    const snap=await _withFirebaseTimeout(fbdb.ref(UPDATES_BIN).limitToFirst(1).get(),'Firebase ping',8000);
    const ms=Date.now()-t0;
    void snap;
    return {state: ms<1500?'green':'yellow', msg:'Connected — responded in '+ms+' ms'};
  }catch(e){
    return {state:'red', msg:'Cannot reach Firebase: '+((e&&e.message)||'unknown error')};
  }
}
async function checkMessaging(){
  const t0=Date.now();
  try{
    // Deliberately a shallow read (one child, limited) rather than the whole
    // conversations blob — this is a reachability probe, not a data load.
    // See checkFirebasePing() above for why this is time-bounded.
    await _withFirebaseTimeout(fbdb.ref(CONVOS_BIN).limitToFirst(1).get(),'Messaging check',8000);
    const ms=Date.now()-t0;
    return {state: ms<2500?'green':'yellow', msg:(ms<2500?'Sending and receiving normally':'Reachable but slow')+' — '+ms+' ms'};
  }catch(e){
    const cfg=isConfigFailure(e);
    return {state:'red', msg:cfg?'Rejected by Firebase rules — the site owner needs to check the database rules':'Unreachable: '+((e&&e.message)||'network error')};
  }
}
function checkCallSubsystem(){
  const hasMedia=!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const hasRTC=typeof RTCPeerConnection!=='undefined';
  const hasScreen=!!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  const secure=window.isSecureContext!==false;
  if(!hasRTC) return {state:'red', msg:'WebRTC is not available in this browser — calls and meetings can\'t run'};
  if(!hasMedia) return {state:'red', msg:'Camera/microphone API unavailable'+(secure?'':' (page is not on HTTPS)')};
  if(!secure) return {state:'yellow', msg:'Available, but this page isn\'t on HTTPS — browsers will block camera/mic'};
  if(!hasScreen) return {state:'yellow', msg:'Voice and video OK; screen sharing is not supported on this browser'};
  return {state:'green', msg:'Camera, microphone, screen share and peer connections all available'};
}
// Meetings had no self-test at all — unlike every other major subsystem here,
// nothing would ever flag it if LIVEKIT_URL/LIVEKIT_TOKEN_ENDPOINT or the SDK
// script stopped working. checkCallSubsystem() above only covers the browser's
// own WebRTC capability (shared with 1:1 calls); this covers the LiveKit
// transport specifically, with the mesh fallback always reported healthy since
// that path needs nothing external.
async function checkMeetingsLiveKit(){
  if(!LIVEKIT_URL && !LIVEKIT_TOKEN_ENDPOINT){
    return {state:'green', msg:'LiveKit not configured — meetings run on the built-in mesh fallback (up to '+MAX_MEETING_PARTICIPANTS+' people)'};
  }
  if(!LIVEKIT_URL || !LIVEKIT_TOKEN_ENDPOINT){
    return {state:'yellow', msg:'LiveKit only partly configured (need both LIVEKIT_URL and LIVEKIT_TOKEN_ENDPOINT) — meetings fall back to the mesh'};
  }
  if(!getLiveKitSdk()) return {state:'yellow', msg:'The livekit-client script never loaded — meetings will silently fall back to the mesh'};
  const t0=Date.now();
  try{
    const res=await fetch(LIVEKIT_TOKEN_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:'scb-diagnostics-check',identity:'diagnostics',name:'Diagnostics'})});
    const ms=Date.now()-t0;
    if(!res.ok) return {state:'red', msg:'Token proxy responded with '+res.status+' — meetings will fall back to the mesh'};
    let data={}; try{ data=await res.json(); }catch(e){}
    if(data.status!=='ok'||!data.token) return {state:'red', msg:'Token proxy reachable but did not return a valid token — meetings will fall back to the mesh'};
    return {state: ms<2500?'green':'yellow', msg:'LiveKit SDK loaded, token proxy reachable — '+ms+' ms'};
  }catch(e){
    return {state:'red', msg:'Token proxy unreachable: '+((e&&e.message)||'network error')+' — meetings will fall back to the mesh'};
  }
}
async function checkWeatherSource(){
  const t0=Date.now();
  try{
    const res=await fetch('https://geocoding-api.open-meteo.com/v1/search?name=London&count=1');
    if(!res.ok) return {state:'yellow', msg:'Open-Meteo responded with '+res.status};
    await res.json();
    return {state:'green', msg:'Open-Meteo reachable — '+(Date.now()-t0)+' ms'};
  }catch(e){
    return {state:'red', msg:'Weather data source unreachable: '+((e&&e.message)||'network error')};
  }
}
async function checkAdminPanelStatus(){
  // The admin panel's data comes from the reports node, so its health is
  // exactly "can we read that node". A non-admin being refused is expected and
  // is not an outage.
  if(!me) return {state:'yellow', msg:'Not signed in'};
  if(me.number!==ADMIN_NUMBER) return {state:'green', msg:'Not applicable — this account isn\'t an admin'};
  try{
    // _origGetBin is the raw, unwrapped getBin() — same unguarded-hang risk
    // as the two checks above, bypassing even the withRetry() wrapper below.
    const d=await _withFirebaseTimeout(_origGetBin('reports'),'Admin panel check',8000);
    const n=Array.isArray(d.reports)?d.reports.length:0;
    return {state:'green', msg:'Admin data loaded — '+n+' report'+(n===1?'':'s')+' on file'};
  }catch(e){
    return {state:'red', msg:'Admin data unreadable: '+((e&&e.message)||'error')};
  }
}
async function checkE2EEncryption(){
  if(!me) return {state:'yellow', msg:'Not signed in'};
  try{
    const kp=await ensureE2EKeypair();
    if(!kp||!_myPubJwk) return {state:'red', msg:'No local encryption keypair on this device — messages can\'t be encrypted'};
    // Compare the local public key against Firebase's canonical copy. A
    // mismatch here is exactly the bug class that caused messages to stay
    // encrypted/undecryptable after a device's local key went stale — this
    // was fixed by having ensureE2EKeypair() self-heal against the cloud
    // copy, but surfacing the comparison here too catches it if it recurs.
    const snap=await _withFirebaseTimeout(fbdb.ref(USERS_BIN+'/'+me.number+'/pubkey').get(),'E2E key check',8000);
    const cloudPub=snap.exists()?snap.val():null;
    if(!cloudPub) return {state:'yellow', msg:'Local keypair ready, but not yet published to Firebase'};
    if(cloudPub!==_myPubJwk) return {state:'red', msg:'Local encryption key doesn\'t match Firebase\'s copy — messages may fail to decrypt until this resolves (try reloading)'};
    // Round-trip sanity check with a throwaway AES-GCM key, independent of
    // any contact — this catches a broken Web Crypto implementation rather
    // than a specific contact's key.
    const testKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
    const wrapped=await aesEnc(testKey,'scb-diagnostic-ping');
    const back=wrapped?await aesDec(testKey,wrapped):null;
    if(back!=='scb-diagnostic-ping') return {state:'red', msg:'Encrypt/decrypt round-trip failed — Web Crypto may be unavailable in this browser'};
    return {state:'green', msg:'Local key matches Firebase, and encrypt/decrypt round-trip succeeded'};
  }catch(e){
    return {state:'red', msg:'Encryption check failed: '+((e&&e.message)||'error')};
  }
}
async function checkWriteRoundTrip(){
  // The other checks here are all reads. A connection can serve reads fine
  // while writes are degraded or dead (see _fbReadWithFallback — the
  // WS→REST fallback it installs only covers reads, not writes), so without
  // this, "everything green" could still mean nothing anyone sends actually
  // goes through.
  if(!me) return {state:'yellow', msg:'Not signed in'};
  const t0=Date.now();
  try{
    const ref=fbdb.ref('admin_site/diagnostics_ping/'+me.number);
    await _withFirebaseTimeout(ref.set(Date.now()),'Write round-trip (write)',8000);
    await _withFirebaseTimeout(ref.get(),'Write round-trip (read-back)',8000);
    const ms=Date.now()-t0;
    return {state: ms<3000?'green':'yellow', msg:(ms<3000?'Writes confirmed normally':'Writes reachable but slow')+' — '+ms+' ms round-trip'};
  }catch(e){
    const cfg=isConfigFailure(e);
    return {state:'red', msg:cfg?'Writes rejected by Firebase rules':'Write failed: '+((e&&e.message)||'network error')};
  }
}
async function checkRulesWorker(){
  // Same deliberately-invalid-request pattern as the Workers category in
  // SCB_CHECKS (admin diagnostics) — a clean 4xx proves the route is
  // actually deployed and routing; a 5xx means its own code is broken even
  // though it answered; a thrown error/timeout means it's unreachable.
  // This is public-facing (not admin-only) because this Worker mints the
  // real auth session for every login/signup — if it's down, that's
  // everyone's problem, not just an admin's.
  const t0=Date.now();
  try{
    const ctl=(typeof AbortController!=='undefined')?new AbortController():null;
    const timer=ctl?setTimeout(()=>{try{ctl.abort();}catch(e){}},8000):null;
    let res;
    try{ res=await fetch(VERIFY_OTP_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge:'x',code:'000000'}),...(ctl?{signal:ctl.signal}:{})}); }
    finally{ if(timer) clearTimeout(timer); }
    const ms=Date.now()-t0;
    if(res.status>=500) return {state:'red', msg:'The login/sign-up server returned an error (HTTP '+res.status+', '+ms+'ms) — sign-in and account recovery may be affected'};
    return {state: ms<1500?'green':'yellow', msg:'Connected — responded in '+ms+' ms'};
  }catch(e){
    return {state:'red', msg:'Cannot reach the login/sign-up server: '+((e&&e.message)||'unknown error')};
  }
}
function checkConnectionMode(){
  if(typeof _sdkConnBad==='undefined') return {state:'yellow', msg:'Connection-mode tracking unavailable'};
  if(_sdkConnBad) return {state:'yellow', msg:'Reads are on the REST fallback — the live WebSocket connection looks blocked. Writes still go straight over the WebSocket and aren\'t covered by this fallback, so they may still be degraded even though reads work.'};
  return {state:'green', msg:'Normal WebSocket connection'};
}
async function checkGroupKeyHealth(){
  if(!me) return {state:'yellow', msg:'Not signed in'};
  try{
    if(!convosCache) await _withFirebaseTimeout(getConvos(),'Group key check',8000);
    const groups=(convosCache||[]).filter(c=>c&&c.wrappedKeys&&(c.type==='group'||String(c.key||'').startsWith('grp_'))&&isConvoMemberOf(c,true));
    if(!groups.length) return {state:'green', msg:'No encrypted groups to check'};
    let broken=0;
    for(const c of groups){ if(!(await getGroupAesKey(c))) broken++; }
    if(!broken) return {state:'green', msg:'Group key decrypts correctly in all '+groups.length+' group'+(groups.length===1?'':'s')};
    return {state:'red', msg:broken+' of '+groups.length+' group'+(groups.length===1?'':'s')+' can\'t decrypt their key on this device — messages there may be unreadable here'};
  }catch(e){
    return {state:'red', msg:'Group key check failed: '+((e&&e.message)||'error')};
  }
}
const SYSTEM_STATUS_CHECKS = [
  {id:'messaging', label:'Messaging',        run:checkMessaging},
  {id:'firebase',  label:'Firebase',         run:checkFirebasePing},
  // checkRulesWorker() deliberately NOT in this list: this widget is public,
  // reachable by every signed-in AND anonymous visitor, and the check sends
  // a POST to the OTP-verification Worker route — if that route rate-limits
  // repeated bad attempts (the normal defense against OTP brute-forcing),
  // many people opening this panel from the same network could trip that
  // limiter and block real logins. Worker health stays admin-only (admin
  // Diagnostics' "Workers" category, Owner Tools' service-status panel).
  {id:'write_rt',  label:'Write round-trip', run:checkWriteRoundTrip},
  {id:'conn_mode', label:'Connection mode',  run:checkConnectionMode},
  {id:'e2e',       label:'Message encryption', run:checkE2EEncryption},
  {id:'group_key', label:'Group encryption keys', run:checkGroupKeyHealth},
  {id:'calls',     label:'Voice & Video Calls', run:checkCallSubsystem},
  {id:'meetings',  label:'Meetings (LiveKit)', run:checkMeetingsLiveKit},
  {id:'weather',   label:'Weather widget',   run:checkWeatherSource},
  {id:'admin',     label:'Admin Panel',      run:checkAdminPanelStatus}
];
async function runSystemStatusChecks(){
  const body=document.getElementById('scb-status-body');
  if(!body) return;
  const btn=document.getElementById('scb-status-recheck');
  if(btn) btn.disabled=true;
  body.innerHTML='';
  SYSTEM_STATUS_CHECKS.forEach(c=>{
    const row=document.createElement('div');
    row.className='scb-status-row';
    row.id='scb-status-row-'+c.id;
    row.innerHTML='<div class="scb-status-label">'+esc(c.label)+'</div>'+
                  '<div class="scb-status-msg">Checking…</div>'+
                  '<div class="scb-status-pill">'+statusPill('yellow','Checking')+'</div>';
    body.appendChild(row);
  });
  await Promise.all(SYSTEM_STATUS_CHECKS.map(async c=>{
    let r;
    try{ r=await c.run(); }
    catch(e){ r={state:'red', msg:'Check failed: '+((e&&e.message)||'error')}; }
    const row=document.getElementById('scb-status-row-'+c.id);
    if(!row) return;
    row.querySelector('.scb-status-msg').textContent=r.msg;
    row.querySelector('.scb-status-pill').innerHTML=statusPill(r.state, r.state==='green'?'OK':r.state==='yellow'?'Degraded':'Down');
  }));
  _statusLastRun=Date.now();
  const stamp=document.getElementById('scb-status-stamp');
  if(stamp) stamp.textContent=scbT('last_checked')+': '+new Date(_statusLastRun).toLocaleTimeString();
  if(btn) btn.disabled=false;
}
function openSystemStatus(){
  // Belt-and-suspenders: the row that calls this is hidden from non-admins
  // by updateFeatureSettingsUI(), but guard the action itself too in case
  // it's ever reached another way (stale DOM, a future direct call, etc.).
  if(!hasAnyAdminAccess()){ showToast('Access denied',scbErr('SCB-ADMIN-01','This action is for administrators only.')); return; }
  openModal('scb-status-modal');
  runSystemStatusChecks();
}

/* =============================================================================
   9. AGE-TIERED ACCOUNTS
   Tiers are derived from the birthdate already collected at signup.
     under 8  -> child   (cannot self-register; a verified adult owns the profile)
     8 – 17   -> minor   (normal account, optional parent link)
     18 – 34  -> adult
     35+      -> elderly (offered — never forced — a larger-text simplified mode)
   35 is the threshold the site owner specified.
   ========================================================================== */
const ELDERLY_TIER_AGE = 35;
const CHILD_TIER_MAX_AGE = 8;   // under this age = child tier
function deriveAccountTier(birthdate){
  const age=calcAge(birthdate);
  if(age===null||age===undefined) return '';
  if(age<CHILD_TIER_MAX_AGE) return 'child';
  if(age<18) return 'minor';
  if(age<ELDERLY_TIER_AGE) return 'adult';
  return 'elderly';
}
function myTier(){
  if(!me) return '';
  return me.accountTier || deriveAccountTier(me.birthdate) || '';
}
// -- Large-text / simplified mode (opt-in, default OFF) ----------------------
function applyLargeTextMode(on){
  document.body.classList.toggle('scb-large-text', !!on);
}
function toggleLargeTextMode(on){
  applyLargeTextMode(on);
  scbSave('cc_large_text', !!on);
  if(me){ me.largeTextMode=!!on; try{ saveStorage(); }catch(e){} registerOrUpdate().catch(()=>{}); }
}
function initLargeTextMode(){
  const on = scbLoad('cc_large_text', null);
  const val = (on===null) ? !!(me&&me.largeTextMode) : !!on;
  applyLargeTextMode(val);
  const cb=document.getElementById('scb-large-text-toggle');
  if(cb) cb.checked=val;
}
function toggleColorblindMode(on){
  document.body.classList.toggle('theme-colorblind',!!on);
  scbSave('cc_colorblind_mode',!!on);
}
function initColorblindMode(){
  const on=!!scbLoad('cc_colorblind_mode',false);
  document.body.classList.toggle('theme-colorblind',on);
  const cb=document.getElementById('scb-colorblind-toggle');
  if(cb) cb.checked=on;
}
// -- Restriction flags -------------------------------------------------------
const RESTRICTION_DEFS = [
  {id:'noDm',     label:'Block direct messages and chats'},
  {id:'noCalls',  label:'Restrict calling'},
  {id:'noGroups', label:'Block joining or creating groups'},
  {id:'noVoice',  label:'Restrict voice chat and meetings'}
];
// Read live from the polled user cache so a parent's change lands on the
// child's device within one poll rather than only at next login.
function getMyRestrictions(){
  if(!me) return {};
  const u=(usersCache||[]).find(x=>x&&x.number===me.number);
  return (u&&u.restrictions) || me.restrictions || {};
}
function isRestricted(kind){ return !!getMyRestrictions()[kind]; }
function blockIfRestricted(kind, what){
  if(!isRestricted(kind)) return false;
  showToast(scbT('restricted'), scbErr('SCB-FAM-05',what||'A parent or guardian has turned this off for your account.'));
  return true;
}
// -- Parent side: manage child profiles and linked minors ---------------------
function parentIsAgeVerified(){
  const age=calcAge(me&&me.birthdate);
  return age!==null && age>=18;
}
function openChildAccountsModal(){
  if(!me) return;
  if(!parentIsAgeVerified()){
    showToast('Age verification needed',scbErr('SCB-FAM-06','Your own account needs a date of birth confirming you\'re 18 or older before you can manage a child profile.'));
    return;
  }
  document.getElementById('scb-child-name').value='';
  document.getElementById('scb-child-number').value='';
  document.getElementById('scb-child-password').value='';
  document.getElementById('scb-child-birthdate').value='';
  document.getElementById('scb-child-error').textContent='';
  openModal('scb-child-modal');
  renderManagedAccounts();
}
async function renderManagedAccounts(){
  const list=document.getElementById('scb-managed-list');
  if(!list||!me) return;
  list.innerHTML='<div class="section-empty">Loading…</div>';
  try{
    const users=await getUsers();
    const managed=users.filter(u=>u && (u.childOf===me.number || u.linkedParent===me.number));
    if(!managed.length){ list.innerHTML='<div class="section-empty">No child or linked accounts yet.</div>'; return; }
    list.innerHTML='';
    managed.forEach(u=>{
      const card=document.createElement('div');
      card.className='scb-managed-card';
      const kind = u.childOf===me.number ? 'Child profile' : 'Linked account';
      let html='<div class="scb-managed-head"><b>'+esc(dec(u.name)||('#'+u.number))+'</b> <span class="scb-managed-kind">'+esc(kind)+' · #'+esc(String(u.number))+'</span></div>';
      RESTRICTION_DEFS.forEach(r=>{
        const on=!!((u.restrictions||{})[r.id]);
        html+='<label class="scb-managed-row"><input type="checkbox" data-num="'+esc(String(u.number))+'" data-flag="'+r.id+'"'+(on?' checked':'')+'/> '+esc(r.label)+'</label>';
      });
      card.innerHTML=html;
      card.querySelectorAll('input[type=checkbox]').forEach(cb=>{
        cb.onchange=()=>setRestrictionFlag(parseInt(cb.getAttribute('data-num'),10), cb.getAttribute('data-flag'), cb.checked);
      });
      list.appendChild(card);
    });
  }catch(e){
    list.innerHTML='<div class="section-empty">'+esc(scbErr('SCB-FAM-30','Your managed accounts couldn\'t be loaded.',(e&&e.message)||'error'))+'</div>';
  }
}
async function setRestrictionFlag(number, flag, value){
  if(!me) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x&&x.number===number);
    if(!u){ showToast('Not found',scbErr('SCB-FAM-07','That account no longer exists.')); return; }
    if(u.childOf!==me.number && u.linkedParent!==me.number){ showToast('Not allowed',scbErr('SCB-FAM-08','You don\'t manage that account.')); return; }
    u.restrictions=Object.assign({}, u.restrictions||{});
    u.restrictions[flag]=!!value;
    await saveUsers(users);
    showToast('Saved', (value?'Restriction on':'Restriction off')+' for #'+number);
  }catch(e){ showToast('Couldn\'t save', scbErr('SCB-FAM-09','That restriction couldn\'t be saved — the server rejected the write.',(e.message||'error'))); }
}
async function createChildProfile(){
  const err=document.getElementById('scb-child-error'); err.textContent='';
  if(!me || !parentIsAgeVerified()){ err.textContent=scbErr('SCB-FAM-10','Your own account must be age-verified as 18+.'); return; }
  const name=document.getElementById('scb-child-name').value.trim();
  const num=parseInt(document.getElementById('scb-child-number').value,10);
  const pwd=document.getElementById('scb-child-password').value;
  const bd=document.getElementById('scb-child-birthdate').value;
  if(!name){ err.textContent=scbErr('SCB-FAM-11','Enter the child\'s display name.'); return; }
  if(!num||num<1000||num>99999){ err.textContent=scbErr('SCB-FAM-12','Account number must be 1000–99999.'); return; }
  if(!pwd||pwd.length<8){ err.textContent=scbErr('SCB-FAM-13','Password must be at least 8 characters.'); return; }
  if(!bd){ err.textContent=scbErr('SCB-FAM-14','Enter the child\'s date of birth.'); return; }
  const btn=document.getElementById('scb-child-create-btn');
  if(btn) btn.disabled=true;
  try{
    const users=await getUsers();
    if(users.find(u=>u&&u.number===num)){ err.textContent=scbErr('SCB-FAM-15','#'+num+' is already taken.'); return; }
    // Block reserved/privileged numbers from being claimed via child profile creation
    if(num===ADMIN_NUMBER){ err.textContent=scbErr('SCB-FAM-15','#'+num+' is reserved and cannot be used.'); return; }
    try{
      const rsnap=await fbdb.ref('admin_site/reserved_numbers').get();
      const reserved=rsnap.val()||[];
      if(Array.isArray(reserved)&&reserved.includes(num)){ err.textContent=scbErr('SCB-FAM-15','#'+num+' is reserved and cannot be used.'); return; }
    }catch(e){}
    const rec={
      number:num, name:name, bio:'', customStatus:'', avatar:'',
      pwd:await hashPasswordV2(pwd), email:'', birthdate:bd, blocked:[], lastSeen:0,
      createdAt:Date.now(), accountTier:deriveAccountTier(bd), childOf:me.number,
      // Child profiles start locked down; the parent opens things up deliberately.
      restrictions:{noDm:true, noCalls:true, noGroups:true, noVoice:true}
    };
    users.push(rec);
    await saveUsers(users);
    document.getElementById('scb-child-name').value='';
    document.getElementById('scb-child-number').value='';
    document.getElementById('scb-child-password').value='';
    document.getElementById('scb-child-birthdate').value='';
    showToast('Child profile created','#'+num+' can now sign in with that password.');
    renderManagedAccounts();
  }catch(e){ err.textContent=scbErr('SCB-FAM-16','That child profile couldn\'t be created — the server rejected the write.',(e.message||'failed')); }
  finally{ if(btn) btn.disabled=false; }
}
// -- Minor side: link / unlink a parent account ------------------------------
function openLinkParentModal(){
  if(!me) return;
  const linked=!!me.linkedParent;
  document.getElementById('scb-link-linked').style.display=linked?'block':'none';
  document.getElementById('scb-link-form').style.display=linked?'none':'block';
  document.getElementById('scb-link-current').textContent=linked?('#'+me.linkedParent):'';
  document.getElementById('scb-link-parent-number').value='';
  document.getElementById('scb-link-parent-password').value='';
  document.getElementById('scb-link-pin').value='';
  document.getElementById('scb-link-unlink-pin').value='';
  document.getElementById('scb-link-error').textContent='';
  document.getElementById('scb-unlink-error').textContent='';
  openModal('scb-link-parent-modal');
}
async function submitLinkParent(){
  const err=document.getElementById('scb-link-error'); err.textContent='';
  if(!me) return;
  const pnum=parseInt(document.getElementById('scb-link-parent-number').value,10);
  const ppwd=document.getElementById('scb-link-parent-password').value;
  const pin=document.getElementById('scb-link-pin').value.trim();
  if(!pnum){ err.textContent=scbErr('SCB-FAM-17','Enter the parent\'s account number.'); return; }
  if(pnum===me.number){ err.textContent=scbErr('SCB-FAM-18','That\'s your own account number.'); return; }
  if(!ppwd){ err.textContent=scbErr('SCB-FAM-19','Enter the parent\'s account password.'); return; }
  if(!/^\d{4,8}$/.test(pin)){ err.textContent=scbErr('SCB-FAM-20','Choose a parental PIN of 4–8 digits.'); return; }
  try{
    const users=await getUsers();
    const parent=users.find(u=>u&&u.number===pnum);
    if(!parent){ err.textContent=scbErr('SCB-FAM-21','No account found with that number.'); return; }
    const age=calcAge(parent.birthdate);
    if(age===null||age<18){ err.textContent=scbErr('SCB-FAM-22','That account isn\'t verified as 18 or older.'); return; }
    // The password check proves the parent is present and consenting. Newer
    // accounts have no hash on their record, so the server checks those.
    let ok;
    if(parent.pwd){
      ok=await verifyPassword(ppwd, parent.pwd);
    }else{
      const result=await checkPasswordWithServer(pnum, ppwd);
      if(result==='unavailable'||result==='locked'){
        err.textContent=scbErr('SCB-FAM-23',result==='locked'?'Too many failed attempts. Try again in 5 minutes.':'That password couldn\'t be checked. Try again in a moment.');
        return;
      }
      ok=result==='ok';
    }
    if(!ok){ err.textContent=scbErr('SCB-FAM-23','That password is incorrect.'); return; }
    const mine=users.find(u=>u&&u.number===me.number);
    if(!mine){ err.textContent=scbErr('SCB-FAM-24','Your account record wasn\'t found.'); return; }
    mine.linkedParent=pnum;
    mine.parentalPin=await hashPasswordV2(pin);   // same PBKDF2 helper as passwords, separate field
    await saveUsers(users);
    me.linkedParent=pnum;
    try{ saveStorage(); }catch(e){}
    closeModal('scb-link-parent-modal');
    showToast('Parent linked','#'+pnum+' can now see and manage restrictions on your account.');
    updateFeatureSettingsUI();
  }catch(e){ err.textContent=scbErr('SCB-FAM-25','The parent link couldn\'t be saved — the server rejected the write.',(e.message||'failed')); }
}
async function submitUnlinkParent(){
  const err=document.getElementById('scb-unlink-error'); err.textContent='';
  if(!me||!me.linkedParent) return;
  const pin=document.getElementById('scb-link-unlink-pin').value.trim();
  if(!pin){ err.textContent=scbErr('SCB-FAM-26','Enter your parental PIN.'); return; }
  try{
    const users=await getUsers();
    const mine=users.find(u=>u&&u.number===me.number);
    if(!mine){ err.textContent=scbErr('SCB-FAM-27','Your account record wasn\'t found.'); return; }
    const ok=await verifyPassword(pin, mine.parentalPin);
    if(!mine.parentalPin || !ok){ err.textContent=scbErr('SCB-FAM-28','That PIN is incorrect.'); return; }
    mine.linkedParent=null; mine.parentalPin=null; mine.restrictions=null;
    await saveUsers(users);
    me.linkedParent=null; me.restrictions=null;
    try{ saveStorage(); }catch(e){}
    closeModal('scb-link-parent-modal');
    showToast('Parent unlinked','Restrictions on your account have been cleared.');
    updateFeatureSettingsUI();
  }catch(e){ err.textContent=scbErr('SCB-FAM-29','The parent link couldn\'t be removed — the server rejected the write.',(e.message||'failed')); }
}
// Turning 18 ends the link automatically — checked once per login.
async function checkParentLinkExpiry(){
  try{
    if(!me||!me.linkedParent) return;
    const age=calcAge(me.birthdate);
    if(age===null||age<18) return;
    const users=await getUsers();
    const mine=users.find(u=>u&&u.number===me.number);
    if(mine){
      mine.linkedParent=null; mine.parentalPin=null; mine.restrictions=null;
      mine.accountTier=deriveAccountTier(mine.birthdate);
      await saveUsers(users);
    }
    me.linkedParent=null; me.restrictions=null;
    try{ saveStorage(); }catch(e){}
    showToast('Parent link ended','You\'ve turned 18, so the parental link on your account was removed automatically.');
  }catch(e){ console.warn('parent link expiry check failed', e); }
}

/* =============================================================================
   10. RULES & GUIDELINES
   ========================================================================== */
function openRulesModal(){ openModal('scb-rules-modal'); }

/* =============================================================================
   12. MEETINGS — real peer-to-peer WebRTC over the existing Firebase RTDB
   Full mesh: every participant holds one RTCPeerConnection per other
   participant. Signalling (offer / answer / ICE) is relayed through
   syntax_meetings/<meetingId>/signals/<participantId>, alongside a presence
   list and a text chat node, which is exactly how the rest of this app moves
   realtime data.
   ========================================================================== */
const MEETINGS_ROOT = 'syntax_meetings';
let meetingState = null;   // {id, myId, localStream, screenStream, peers:{}, refs:[], camOn, micOn}

function newMeetingId(){
  // Codes are now shared in links, so they come from the secure random source.
  // 32 symbols without look-alikes (no I, O, 0, 1).
  const abc='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const s=Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>abc[b%32]).join('');
  return s.slice(0,4)+'-'+s.slice(4,8)+'-'+s.slice(8);
}
function openMeetingsPanel(){
  if(blockIfRestricted('noVoice','Meetings are turned off for your account.')) return;
  document.getElementById('scb-meeting-code').value='';
  document.getElementById('scb-meeting-lobby-error').textContent='';
  document.getElementById('scb-meeting-cap-note').textContent='Rooms hold up to '+effectiveMaxParticipants()+' people.';
  openModal('scb-meeting-lobby');
}
function startNewMeeting(){
  const id=newMeetingId();
  closeModal('scb-meeting-lobby');
  joinMeeting(id);
}
function joinMeetingFromLobby(){
  const code=(document.getElementById('scb-meeting-code').value||'').trim().toUpperCase();
  const err=document.getElementById('scb-meeting-lobby-error');
  if(!code){ err.textContent=scbErr('SCB-MEET-01','Enter a meeting code.'); return; }
  closeModal('scb-meeting-lobby');
  joinMeeting(code);
}
// Group → meeting entry point. The code is derived from the group key so
// everyone in the group lands in the same room.
function startMeetingForActiveGroup(){
  if(!activeConvo){ openMeetingsPanel(); return; }
  if(blockIfRestricted('noVoice','Meetings are turned off for your account.')) return;
  const id=('GRP-'+String(activeConvo.key||'').replace(/[^A-Za-z0-9]/g,'').slice(-10)).toUpperCase();
  joinMeeting(id);
}

// ---- Transport selection ----------------------------------------------------
// The LiveKit SDK's UMD bundle publishes the global `LivekitClient`; the other
// spellings are checked too so a different bundle version can't silently break
// the feature (we just fall back to mesh if none are present).
function getLiveKitSdk(){ return window.LivekitClient || window.LiveKit || window.livekit || null; }
function livekitConfigured(){ return !!(LIVEKIT_URL && LIVEKIT_TOKEN_ENDPOINT && getLiveKitSdk()); }
// What the UI should advertise: the real cap for whichever transport is in use.
function effectiveMaxParticipants(){
  if(meetingState) return meetingState.mode==='livekit' ? LIVEKIT_MAX_PARTICIPANTS : MAX_MEETING_PARTICIPANTS;
  return livekitConfigured() ? LIVEKIT_MAX_PARTICIPANTS : MAX_MEETING_PARTICIPANTS;
}
// The in-call text chat rides on Firebase in BOTH transports — it already works,
// and keeping it transport-independent means the chat panel behaves identically
// whichever path a given meeting took.
function attachMeetingChatFeed(meetingId){
  const chatRef = fbdb.ref(MEETINGS_ROOT+'/'+meetingId+'/chat').limitToLast(50);
  const onChat = chatRef.on('child_added', (s)=>appendMeetingChat(s.val()), (err)=>console.warn('meeting chat listener error', err));
  meetingState.refs.push({ref:chatRef, event:'child_added', cb:onChat});
}

// ---- LiveKit (SFU) path ------------------------------------------------------
async function fetchLiveKitToken(room, identity, name){
  const res = await fetch(LIVEKIT_TOKEN_ENDPOINT, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({room, identity, name})
  });
  let data={};
  try{ data=await res.json(); }catch(e){}
  if(!res.ok || data.status!=='ok' || !data.token){
    throw new Error(data.message || ('Token endpoint returned '+res.status));
  }
  return data.token;
}
// Remote participants are held in the same meetingState.peers shape the mesh
// path uses ({stream}), so renderMeetingGrid and the rest of the UI don't care
// which transport produced them.
function lkPeerEntry(participant){
  const id = participant.identity || participant.sid;
  if(!meetingState.peers[id]) meetingState.peers[id] = {stream:new MediaStream(), label:(participant.name||('#'+id)), lk:true};
  return meetingState.peers[id];
}
async function connectToLiveKitRoom(meetingId, localStream){
  const LK = getLiveKitSdk();
  if(!LK) throw new Error('LiveKit SDK did not load');
  // The token proxy validates room/identity against ^[A-Za-z0-9_-]{1,64}$.
  const room = String(meetingId).replace(/[^A-Za-z0-9_-]/g,'').slice(0,64);
  const identity = String((me&&me.number)||'guest'+Math.floor(Math.random()*100000));
  const token = await fetchLiveKitToken(room, identity, (me&&me.name)||'Guest');

  const lkRoom = new LK.Room({adaptiveStream:true, dynacast:true});
  meetingState = {id:meetingId, myId:identity, mode:'livekit', lkRoom, localStream,
                  screenStream:null, screenOn:false, peers:{}, refs:[], camOn:true, micOn:true};

  lkRoom.on(LK.RoomEvent.TrackSubscribed, (track, publication, participant)=>{
    if(track.kind!=='video' && track.kind!=='audio') return;
    const entry=lkPeerEntry(participant);
    try{ entry.stream.addTrack(track.mediaStreamTrack); }catch(e){}
    renderMeetingGrid();
  });
  lkRoom.on(LK.RoomEvent.TrackUnsubscribed, (track, publication, participant)=>{
    const id=participant.identity||participant.sid;
    const entry=meetingState && meetingState.peers[id];
    if(entry){ try{ entry.stream.removeTrack(track.mediaStreamTrack); }catch(e){} }
    renderMeetingGrid();
  });
  lkRoom.on(LK.RoomEvent.ParticipantConnected, (participant)=>{ lkPeerEntry(participant); renderMeetingGrid(); });
  lkRoom.on(LK.RoomEvent.ParticipantDisconnected, (participant)=>{
    const id=participant.identity||participant.sid;
    if(meetingState) delete meetingState.peers[id];
    renderMeetingGrid();
  });
  lkRoom.on(LK.RoomEvent.Disconnected, ()=>{
    // Guard on identity, not just mode: leaveMeeting() fires this disconnect
    // asynchronously, and a quick leave-then-rejoin can already have a
    // brand-new livekit-mode meetingState (a different Room) live by the
    // time the OLD room's event actually arrives — which would otherwise
    // pass the mode check and tear down the session you just rejoined.
    if(meetingState && meetingState.mode==='livekit' && meetingState.lkRoom===lkRoom){
      showToast('Meeting ended',scbErr('SCB-MEET-02','You were disconnected from the room.'));
      leaveMeeting();
    }
  });

  await lkRoom.connect(LIVEKIT_URL, token);
  // The LiveKit project enforces its own server-side caps, but nothing here
  // mirrored LIVEKIT_MAX_PARTICIPANTS client-side — effectiveMaxParticipants()
  // advertises it to users with no actual enforcement behind it.
  const _lkRoomSize=1+(lkRoom.remoteParticipants?lkRoom.remoteParticipants.size:(lkRoom.participants?lkRoom.participants.size:0));
  if(_lkRoomSize>LIVEKIT_MAX_PARTICIPANTS){
    try{ lkRoom.disconnect(); }catch(e){}
    throw new Error('This meeting is full ('+LIVEKIT_MAX_PARTICIPANTS+' people). Ask someone to leave, or start another room.');
  }
  // Publish the camera/mic tracks already captured by joinMeeting(), so the
  // local preview tile and the existing mic/camera toggles (which flip
  // track.enabled on this same stream) keep working unchanged.
  for(const track of (localStream?localStream.getTracks():[])){
    try{ await lkRoom.localParticipant.publishTrack(track); }
    catch(e){ console.warn('[meetings] publishTrack failed for '+track.kind, e); }
  }
  // Anyone already in the room before we joined.
  try{
    const existing = lkRoom.remoteParticipants || lkRoom.participants;
    if(existing && typeof existing.forEach==='function') existing.forEach(p=>lkPeerEntry(p));
  }catch(e){}
  attachMeetingChatFeed(meetingId);
  return meetingState;
}

// ---- The one place that knows HOW we connect to a room. ---------------------
// Picks LiveKit when it's configured and reachable, otherwise the mesh. Any
// LiveKit failure (endpoint unset, network error, non-2xx, SDK/connect error)
// logs the reason and falls through to the mesh rather than stranding the user.
async function connectToMeetingRoom(meetingId, localStream){
  if(livekitConfigured()){
    try{
      return await connectToLiveKitRoom(meetingId, localStream);
    }catch(e){
      console.warn('[meetings] LiveKit join failed — falling back to mesh WebRTC:', e);
      try{ if(meetingState && meetingState.lkRoom) meetingState.lkRoom.disconnect(); }catch(e2){}
      // A half-finished LiveKit join may already have attached the Firebase
      // chat listener; detach it so the mesh attempt doesn't end up with two.
      try{
        if(meetingState && Array.isArray(meetingState.refs)){
          meetingState.refs.forEach(r=>{ try{ r.ref.off(r.event, r.cb); }catch(e3){} });
        }
      }catch(e4){}
      meetingState=null;
    }
  }else if(LIVEKIT_URL || LIVEKIT_TOKEN_ENDPOINT){
    console.warn('[meetings] LiveKit is only partly configured (need LIVEKIT_URL, LIVEKIT_TOKEN_ENDPOINT and the SDK) — using mesh WebRTC.');
  }
  return connectToMeshRoom(meetingId, localStream);
}

// ---- Built-in full-mesh WebRTC path (fallback) -------------------------------
// Unchanged from the original implementation apart from tagging the state with
// mode:'mesh' and sharing the chat-feed helper. Everything else (UI, chat
// panel, track toggles) talks to the meeting through joinMeeting/leaveMeeting
// and never touches RTCPeerConnection directly.
async function connectToMeshRoom(meetingId, localStream){
  const myId = ((me&&me.number)||'anon')+'_'+Math.random().toString(36).slice(2,7);
  const roomRef = fbdb.ref(MEETINGS_ROOT+'/'+meetingId);
  const partsRef = roomRef.child('participants');

  const snap = await partsRef.get();
  const existing = snap.exists() ? Object.keys(snap.val()||{}) : [];
  if(existing.length >= MAX_MEETING_PARTICIPANTS){
    throw new Error('This meeting is full ('+MAX_MEETING_PARTICIPANTS+' people). Ask someone to leave, or start another room.');
  }

  meetingState = {id:meetingId, myId, mode:'mesh', localStream, screenStream:null, screenOn:false, peers:{}, refs:[], camOn:true, micOn:true};

  await partsRef.child(myId).set({name:(me&&me.name)||'Guest', number:(me&&me.number)||0, joined:Date.now()});
  partsRef.child(myId).onDisconnect().remove();
  roomRef.child('signals/'+myId).onDisconnect().remove();

  // Peer connections are created reactively (here, and in onJoin below) and
  // left to WebRTC's own onnegotiationneeded to create the offer, with
  // handleMeetingSignal()'s perfect-negotiation handling resolving which
  // side "wins" if both happen to offer at once — the same pattern
  // _startVoiceSession/ensureVoicePeer use for 1:1 calls and voice channels.
  // The previous version offered only to a ONE-SHOT snapshot of "existing"
  // participants and relied on "whoever joins later offers to me" for
  // everyone else — if two people joined within the same round-trip, each
  // one's snapshot missed the other, NEITHER side ever offered, and they
  // stayed silently connected-per-Firebase but unable to see/hear each other.
  existing.forEach(otherId=>ensureMeetingPeer(otherId));

  const sigRef = roomRef.child('signals/'+myId);
  const onSignal = sigRef.on('child_added', async (s)=>{
    const sig=s.val();
    s.ref.remove();
    if(!sig || !sig.from) return;
    try{ await handleMeetingSignal(sig); }
    catch(e){ console.warn('meeting signal failed', e); }
  }, (err)=>console.warn('meeting signal listener error', err));
  meetingState.refs.push({ref:sigRef, event:'child_added', cb:onSignal});

  const onLeave = partsRef.on('child_removed', (s)=>{
    const id=s.key;
    if(id===myId) return;
    teardownMeetingPeer(id);
    renderMeetingGrid();
  }, (err)=>console.warn('meeting leave listener error', err));
  meetingState.refs.push({ref:partsRef, event:'child_removed', cb:onLeave});

  const onJoin = partsRef.on('child_added', (s)=>{
    if(s.key!==myId){ ensureMeetingPeer(s.key); renderMeetingGrid(); }
  }, (err)=>console.warn('meeting join listener error', err));
  meetingState.refs.push({ref:partsRef, event:'child_added', cb:onJoin});

  attachMeetingChatFeed(meetingId);

  return meetingState;
}
function sendMeetingSignal(toId, payload){
  if(!meetingState) return;
  fbdb.ref(MEETINGS_ROOT+'/'+meetingState.id+'/signals/'+toId).push(
    Object.assign({from:meetingState.myId, name:(me&&me.name)||'Guest'}, payload)
  ).catch(e=>console.warn('signal send failed', e));
}
function ensureMeetingPeer(otherId){
  if(!meetingState) return null;
  if(meetingState.peers[otherId]) return meetingState.peers[otherId];
  const pc=new RTCPeerConnection({iceServers:RTC_ICE_SERVERS});
  // Deterministic tie-break (same idea as ensureVoicePeer's pc._polite) so
  // a collision between two simultaneous offers always resolves the same
  // way on both ends — a plain string compare is enough since myId/otherId
  // are always strings here (number+random suffix).
  const entry={pc, stream:new MediaStream(), senders:{}, pendingCandidates:[], polite:String(meetingState.myId)>String(otherId), makingOffer:false};
  meetingState.peers[otherId]=entry;
  (meetingState.localStream?meetingState.localStream.getTracks():[]).forEach(track=>{
    entry.senders[track.kind]=pc.addTrack(track, meetingState.localStream);
  });
  pc.onicecandidate=(e)=>{ if(e.candidate) sendMeetingSignal(otherId,{type:'ice', candidate:JSON.stringify(e.candidate)}); };
  pc.ontrack=(e)=>{
    (e.streams[0]?e.streams[0].getTracks():[e.track]).forEach(tr=>{
      if(!entry.stream.getTracks().includes(tr)) entry.stream.addTrack(tr);
    });
    renderMeetingGrid();
  };
  pc.onconnectionstatechange=()=>{
    if(pc.connectionState==='failed'||pc.connectionState==='closed'){ teardownMeetingPeer(otherId); renderMeetingGrid(); }
  };
  pc.onnegotiationneeded=async()=>{
    try{
      entry.makingOffer=true;
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendMeetingSignal(otherId,{type:'offer', sdp:JSON.stringify(pc.localDescription)});
    }catch(e){ console.warn('meeting offer failed', e); }
    finally{ entry.makingOffer=false; }
  };
  return entry;
}
async function _flushMeetingIceQueue(entry){
  if(!entry || !entry.pendingCandidates || !entry.pendingCandidates.length) return;
  const queued=entry.pendingCandidates;
  entry.pendingCandidates=[];
  for(const candidate of queued){
    try{ await entry.pc.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate))); }catch(e){}
  }
}
async function handleMeetingSignal(sig){
  if(!meetingState) return;
  const from=sig.from;
  if(sig.type==='offer'){
    const entry=ensureMeetingPeer(from);
    try{
      const desc=new RTCSessionDescription(JSON.parse(sig.sdp));
      // Perfect-negotiation collision handling, mirroring ensureVoicePeer's
      // signal handler: without this, two peers created within the same
      // round-trip (see connectToMeshRoom's comment above) could both end up
      // offering at once, and the loser's setRemoteDescription on a
      // non-stable signaling state would throw and silently kill that pair.
      const collision=entry.makingOffer||entry.pc.signalingState!=='stable';
      const ignoreOffer=!entry.polite&&collision;
      if(ignoreOffer) return;
      if(collision){ await Promise.all([entry.pc.setLocalDescription({type:'rollback'}),entry.pc.setRemoteDescription(desc)]); }
      else{ await entry.pc.setRemoteDescription(desc); }
      await _flushMeetingIceQueue(entry);
      const answer=await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      sendMeetingSignal(from,{type:'answer', sdp:JSON.stringify(entry.pc.localDescription)});
      renderMeetingGrid();
    }catch(e){ console.warn('meeting offer handling failed', e); }
  }else if(sig.type==='answer'){
    const entry=meetingState.peers[from];
    if(entry){ await entry.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sig.sdp))); await _flushMeetingIceQueue(entry); }
  }else if(sig.type==='ice'){
    const entry=meetingState.peers[from];
    if(!entry) return;
    if(entry.pc.remoteDescription){
      try{ await entry.pc.addIceCandidate(new RTCIceCandidate(JSON.parse(sig.candidate))); }catch(e){}
    }else{
      entry.pendingCandidates.push(sig.candidate);
    }
  }
}
function teardownMeetingPeer(otherId){
  if(!meetingState) return;
  const entry=meetingState.peers[otherId];
  if(!entry) return;
  try{ entry.pc.close(); }catch(e){}
  delete meetingState.peers[otherId];
}
let _joiningMeeting=false;
async function joinMeeting(meetingId){
  if(blockIfRestricted('noVoice','Meetings are turned off for your account.')) return;
  if(meetingState){ showToast('Already in a meeting',scbErr('SCB-MEET-03','Leave the current meeting first.')); return; }
  if(typeof RTCPeerConnection==='undefined' || !navigator.mediaDevices){
    showToast('Not supported',scbErr('SCB-MEET-04','This browser can\'t run meetings.'));
    return;
  }
  // Reentrancy guard: meetingState isn't assigned until deep inside
  // connectToLiveKitRoom/connectToMeshRoom, well after the getUserMedia
  // await below — a double-click on "start/join meeting" before that
  // resolves would otherwise start two concurrent sessions (two camera/mic
  // streams, two sets of peer connections), with the loser's never torn
  // down by leaveMeeting() (which only knows about whichever meetingState
  // "won").
  if(_joiningMeeting) return;
  _joiningMeeting=true;
  try{
    let stream=null;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true, video:true});
    }catch(e){
      // Fall back to audio-only rather than failing the whole join.
      try{ stream=await navigator.mediaDevices.getUserMedia({audio:true, video:false}); }
      catch(e2){ showToast('Can\'t join',scbErr('SCB-MEET-05','You couldn\'t join the meeting because microphone access is required and was refused.',(e2.message||'permission denied'))); return; }
    }
    try{
      document.getElementById('scb-meeting-room').classList.add('visible');
      document.getElementById('scb-meeting-id-label').textContent=meetingId;
      document.getElementById('scb-meeting-chat-log').innerHTML='';
      await connectToMeetingRoom(meetingId, stream);
      renderMeetingGrid();
      updateMeetingControls();
      showToast('Meeting started','Share the code '+meetingId+' with up to '+(effectiveMaxParticipants()-1)+' other people.');
    }catch(e){
      // However far setup got — a mesh join can have already created peer
      // connections, written a presence record, and attached up to 3 Firebase
      // listeners before failing later in the sequence (e.g. the final
      // attachMeetingChatFeed() step) — tear all of it down the same way a
      // normal leave does, instead of just nulling meetingState and leaking
      // RTCPeerConnections / a ghost presence record / live listeners behind it.
      leaveMeeting();
      stream.getTracks().forEach(t=>t.stop());
      showToast('Couldn\'t join', scbErr('SCB-MEET-06','You couldn\'t join that meeting — connecting to the meeting room failed.',(e.message||'error')));
    }
  }finally{ _joiningMeeting=false; }
}
function leaveMeeting(){
  if(!meetingState){ document.getElementById('scb-meeting-room').classList.remove('visible'); return; }
  const st=meetingState;
  meetingState=null;
  try{ st.refs.forEach(r=>{ try{ r.ref.off(r.event, r.cb); }catch(e){} }); }catch(e){}
  if(st.mode==='livekit'){
    try{ if(st.lkRoom) st.lkRoom.disconnect(); }catch(e){ console.warn('[meetings] LiveKit disconnect failed', e); }
  }else{
    Object.keys(st.peers||{}).forEach(id=>{ try{ st.peers[id].pc.close(); }catch(e){} });
    // Cancel the onDisconnect registrations themselves (not just remove the
    // data) — otherwise every join/leave cycle in one tab leaves a stale
    // registration sitting on Firebase's side until the connection actually
    // drops, the same listener-accumulation hazard _voiceCountListeners/
    // _dropVoiceCountListeners was written to avoid for voice channels.
    try{ fbdb.ref(MEETINGS_ROOT+'/'+st.id+'/participants/'+st.myId).onDisconnect().cancel(); }catch(e){}
    try{ fbdb.ref(MEETINGS_ROOT+'/'+st.id+'/signals/'+st.myId).onDisconnect().cancel(); }catch(e){}
    try{ fbdb.ref(MEETINGS_ROOT+'/'+st.id+'/participants/'+st.myId).remove(); }catch(e){}
    try{ fbdb.ref(MEETINGS_ROOT+'/'+st.id+'/signals/'+st.myId).remove(); }catch(e){}
  }
  if(st.localStream) st.localStream.getTracks().forEach(t=>t.stop());
  if(st.screenStream) st.screenStream.getTracks().forEach(t=>t.stop());
  document.getElementById('scb-meeting-room').classList.remove('visible');
  document.getElementById('scb-meeting-grid').innerHTML='';
}
function renderMeetingGrid(){
  const grid=document.getElementById('scb-meeting-grid');
  if(!grid||!meetingState) return;
  grid.innerHTML='';
  const addTile=(id, label, stream, muted)=>{
    const tile=document.createElement('div');
    tile.className='scb-meet-tile';
    const v=document.createElement('video');
    v.autoplay=true; v.playsInline=true; v.muted=!!muted;
    if(stream) v.srcObject=stream;
    const cap=document.createElement('div');
    cap.className='scb-meet-name';
    cap.textContent=label;                        // textContent — participant names are user data
    tile.appendChild(v); tile.appendChild(cap);
    grid.appendChild(tile);
  };
  addTile(meetingState.myId, ((me&&me.name)||'You')+' (you)', meetingState.screenStream||meetingState.localStream, true);
  Object.keys(meetingState.peers).forEach(id=>{
    const entry=meetingState.peers[id];
    const label = entry.label || (id.split('_')[0]==='anon' ? 'Guest' : ('#'+id.split('_')[0]));
    addTile(id, label, entry.stream, false);
  });
  const count=1+Object.keys(meetingState.peers).length;
  const c=document.getElementById('scb-meeting-count');
  if(c) c.textContent=count+' / '+effectiveMaxParticipants();
}
function toggleMeetingMic(){
  if(!meetingState||!meetingState.localStream) return;
  meetingState.micOn=!meetingState.micOn;
  meetingState.localStream.getAudioTracks().forEach(t=>t.enabled=meetingState.micOn);
  updateMeetingControls();
}
function toggleMeetingCam(){
  if(!meetingState||!meetingState.localStream) return;
  meetingState.camOn=!meetingState.camOn;
  meetingState.localStream.getVideoTracks().forEach(t=>t.enabled=meetingState.camOn);
  updateMeetingControls();
}
async function toggleMeetingScreenShare(){
  if(!meetingState) return;
  if(meetingState.mode==='livekit'){ return toggleLiveKitScreenShare(); }
  if(meetingState.screenStream){ stopMeetingScreenShare(); return; }
  if(!navigator.mediaDevices.getDisplayMedia){ showToast('Not supported',scbErr('SCB-MEET-07','Screen sharing isn\'t available in this browser.')); return; }
  let screen;
  try{
    screen=await navigator.mediaDevices.getDisplayMedia({video:true});
  }catch(e){ return; } // user cancelled the browser's share picker
  if(!meetingState){ screen.getTracks().forEach(t=>t.stop()); return; } // left the meeting while the picker was open
  meetingState.screenStream=screen;
  const track=screen.getVideoTracks()[0];
  // Swap the outgoing video track on every peer connection, so nobody has to
  // renegotiate.
  Object.keys(meetingState.peers).forEach(id=>{
    const s=meetingState.peers[id].senders.video;
    if(s) s.replaceTrack(track).catch(e=>console.warn('replaceTrack failed', e));
  });
  track.onended=stopMeetingScreenShare;
  renderMeetingGrid(); updateMeetingControls();
}
// LiveKit publishes/unpublishes the screen track itself — no manual
// getDisplayMedia or replaceTrack, and no renegotiation to manage.
async function toggleLiveKitScreenShare(){
  const lp = meetingState && meetingState.lkRoom && meetingState.lkRoom.localParticipant;
  if(!lp) return;
  const turningOn = !meetingState.screenOn;
  try{
    await lp.setScreenShareEnabled(turningOn);
    if(!meetingState) return; // left the meeting while this was pending
    meetingState.screenOn = turningOn;
    // Mirror the shared screen into the local tile when the SDK exposes the
    // publication; if it doesn't, the tile keeps showing the camera and only
    // the button state changes — the outgoing share is unaffected either way.
    let localScreen=null;
    if(turningOn){
      try{
        const LK=getLiveKitSdk();
        const pubs = lp.trackPublications || lp.tracks;
        if(pubs && typeof pubs.forEach==='function'){
          pubs.forEach(pub=>{
            if(pub && pub.source===(LK&&LK.Track?LK.Track.Source.ScreenShare:'screen_share') && pub.track && pub.track.mediaStreamTrack){
              localScreen=new MediaStream([pub.track.mediaStreamTrack]);
            }
          });
        }
      }catch(e){ console.warn('[meetings] could not build local screen preview', e); }
    }
    meetingState.screenStream = localScreen;
  }catch(e){
    // Most commonly the user cancelled the browser's screen picker.
    console.warn('[meetings] screen share toggle failed', e);
    if(meetingState) meetingState.screenOn = !turningOn ? meetingState.screenOn : false;
  }
  if(meetingState){ renderMeetingGrid(); updateMeetingControls(); }
}
function stopMeetingScreenShare(){
  if(!meetingState||!meetingState.screenStream) return;
  meetingState.screenStream.getTracks().forEach(t=>t.stop());
  meetingState.screenStream=null;
  const camTrack=meetingState.localStream?meetingState.localStream.getVideoTracks()[0]:null;
  Object.keys(meetingState.peers).forEach(id=>{
    const s=meetingState.peers[id].senders.video;
    if(s&&camTrack) s.replaceTrack(camTrack).catch(()=>{});
  });
  renderMeetingGrid(); updateMeetingControls();
}
function updateMeetingControls(){
  if(!meetingState) return;
  const mic=document.getElementById('scb-meet-mic-btn');
  const cam=document.getElementById('scb-meet-cam-btn');
  const scr=document.getElementById('scb-meet-screen-btn');
  if(mic) mic.textContent = meetingState.micOn ? '🔇 '+scbT('mute') : '🎙 '+scbT('unmute');
  if(cam) cam.textContent = meetingState.camOn ? '📹 '+scbT('camera') : '🚫 '+scbT('camera');
  const sharing = !!(meetingState.screenStream || meetingState.screenOn);
  if(scr) scr.textContent = sharing ? '🛑 '+scbT('stop_sharing') : '🖥 '+scbT('share_screen');
}
function sendMeetingChat(){
  if(!meetingState) return;
  const input=document.getElementById('scb-meeting-chat-input');
  const text=(input.value||'').trim();
  if(!text) return;
  input.value='';
  fbdb.ref(MEETINGS_ROOT+'/'+meetingState.id+'/chat').push({
    from:(me&&me.name)||'Guest', number:(me&&me.number)||0, text:text, time:Date.now()
  }).catch(e=>showToast('Couldn\'t send', scbErr('SCB-MEET-08','That meeting chat message couldn\'t be sent.',(e.message||'error'))));
}
function appendMeetingChat(entry){
  if(!entry) return;
  const log=document.getElementById('scb-meeting-chat-log');
  if(!log) return;
  const row=document.createElement('div');
  row.className='scb-meet-chat-row';
  const who=document.createElement('b'); who.textContent=(entry.from||'Guest')+': ';
  const txt=document.createElement('span'); txt.textContent=entry.text||'';   // textContent, never innerHTML
  row.appendChild(who); row.appendChild(txt);
  log.appendChild(row);
  log.scrollTop=log.scrollHeight;
}
function meetingChatKeydown(e){ if(e.key==='Enter'){ e.preventDefault(); sendMeetingChat(); } }

/* =============================================================================
   FEATURE PACK — STYLES
   ========================================================================== */
const scbFeatureCSS = document.createElement('style');
scbFeatureCSS.textContent = `
/* ── FAVOURITES ──
   The star sits in the same 8px rhythm as the rest of a sidebar row and picks
   its "on" colour from a theme variable, so it stays legible in light mode. */
.sb-fav-star{margin-left:6px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;
  font-size:14px;line-height:1;color:var(--muted2);cursor:pointer;flex-shrink:0;align-self:center;
  border-radius:var(--r-xs);transition:color .15s var(--ease-fluent-soft),background .15s,transform .15s var(--ease-fluent-soft)}
.sb-fav-star:hover{color:var(--favorite);background:var(--surface3);transform:scale(1.12)}
.sb-fav-star.on{color:var(--favorite)}
#sb-tab-fav{letter-spacing:.01em}

/* ── CHAT TABS ──
   Deliberately built on the same pill language as the existing #channel-bar so
   the two strips directly above the conversation read as one system. */
#scb-tab-bar{display:none;align-items:center;gap:6px;padding:6px 12px;overflow-x:auto;overflow-y:hidden;
  border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;white-space:nowrap;
  scrollbar-width:thin;-webkit-overflow-scrolling:touch}
#scb-tab-bar::-webkit-scrollbar{height:4px}
#scb-tab-bar::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}
/* The strip lives at the top of #main, which also hosts Settings and Updates.
   It belongs to the conversation view, so it steps aside on those screens. */
#main:has(#settings-panel.visible) #scb-tab-bar,
#main:has(#updates-panel.visible) #scb-tab-bar{display:none!important}
.scb-tab{display:inline-flex;align-items:center;gap:6px;padding:5px 6px 5px 12px;border-radius:var(--r-pill);
  background:var(--surface2);border:1px solid var(--border);font-size:12px;font-weight:500;color:var(--text2);
  cursor:pointer;max-width:170px;flex-shrink:0;
  transition:background .15s var(--ease-fluent-soft),color .15s,border-color .15s,box-shadow .18s,transform .15s var(--ease-fluent-soft)}
.scb-tab:hover{background:var(--surface3);color:var(--text);transform:translateY(-1px)}
.scb-tab:active{transform:scale(.97);transition-duration:.08s}
.scb-tab.active{background:var(--accent);color:#fff;border-color:transparent}
.scb-tab.active:hover{color:#fff}
.scb-tab-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.scb-tab-close{width:18px;height:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0;
  border-radius:50%;opacity:.55;font-size:13px;line-height:1;transition:opacity .15s,background .15s}
.scb-tab-close:hover{opacity:1;background:rgba(127,127,127,0.22)}
.scb-tab.active .scb-tab-close:hover{background:rgba(255,255,255,0.25)}

/* ── TYPING SUGGESTIONS ──
   No horizontal padding of its own: the chat footer already provides the left
   gutter, so the chips line up exactly with the message box beneath them. */
#scb-suggest-bar{display:none;gap:6px;padding:2px 0 8px;overflow-x:auto;white-space:nowrap;
  scrollbar-width:none;-webkit-overflow-scrolling:touch}
#scb-suggest-bar::-webkit-scrollbar{display:none}
.scb-suggest-chip{background:var(--surface2);border:1px solid var(--border);color:var(--text2);
  border-radius:var(--r-pill);padding:4px 12px;font-size:12px;font-family:inherit;line-height:1.35;
  cursor:pointer;flex-shrink:0;
  transition:background .15s var(--ease-fluent-soft),color .15s,border-color .15s,transform .15s var(--ease-fluent-soft)}
.scb-suggest-chip:hover{background:var(--accent);color:#fff;border-color:var(--accent);transform:translateY(-1px)}
.scb-suggest-chip:active{transform:scale(.96);transition-duration:.08s}

/* ── SCAM / PHISHING WARNING ── */
.scb-scam-warn{background:var(--warn-soft);border:1px solid var(--warn);border-radius:12px;
  padding:10px 12px;max-width:280px;animation:msgIn 0.32s cubic-bezier(0.16,1,0.3,1)}
.scb-scam-title{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--warn-text);line-height:1.35}
.scb-scam-why{font-size:11.5px;color:var(--text2);opacity:.85;margin:4px 0 8px;line-height:1.5}
.scb-scam-btn{background:transparent;border:1px solid var(--warn);color:var(--warn-text);border-radius:var(--r-xs);
  font-size:11.5px;font-weight:600;padding:4px 12px;cursor:pointer;font-family:inherit;
  transition:background .15s,color .15s,transform .12s var(--ease-fluent-soft)}
.scb-scam-btn:hover{background:var(--warn);color:#fff}
.scb-scam-btn:active{transform:scale(.96)}
.scb-file-scan-note{width:100%;flex-basis:100%;font-size:10.5px;color:var(--warn-text);
  margin-top:6px;padding-top:6px;border-top:1px solid var(--border);line-height:1.45}

/* ── SYSTEM STATUS PILLS ──
   Wraps instead of squashing: on a narrow phone the message drops below the
   label rather than being reduced to two words per line. */
.scb-status-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;padding:12px 2px;border-bottom:1px solid var(--border)}
.scb-status-row:last-child{border-bottom:none}
.scb-status-label{font-size:13px;font-weight:600;width:150px;flex-shrink:0;line-height:1.3}
.scb-status-msg{font-size:12px;color:var(--muted);flex:1;min-width:140px;line-height:1.5}
.scb-status-pill{flex-shrink:0;margin-left:auto;display:flex;align-items:center}
.scb-pill{font-size:10px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;
  border-radius:var(--r-pill);padding:3px 10px;color:#fff;white-space:nowrap}
.scb-pill-green{background:var(--success)}
.scb-pill-yellow{background:var(--warn)}
.scb-pill-red{background:var(--danger)}

/* ── "NEEDS ATTENTION" BANNER ──
   Given the same card chrome and entrance as the toast it sits next to, and
   kept clear of the iOS home indicator. */
#scb-attention-banner{position:fixed;bottom:0;left:0;right:0;z-index:520;background:var(--warn);color:#fff;
  font-size:12px;font-weight:600;line-height:1.5;display:flex;align-items:center;gap:10px;
  padding:10px 14px;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));
  box-shadow:0 -6px 20px rgba(0,0,0,0.22);animation:scbAttentionIn .35s cubic-bezier(0.16,1,0.3,1)}
@keyframes scbAttentionIn{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
.scb-attention-text{flex:1;min-width:0}
.scb-attention-x{width:26px;height:26px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,0.14);border:none;border-radius:50%;color:#fff;font-size:14px;line-height:1;
  cursor:pointer;transition:background .15s,transform .15s var(--ease-fluent-soft)}
.scb-attention-x:hover{background:rgba(255,255,255,0.3);transform:scale(1.08)}
.scb-attention-x:focus-visible{outline:2px solid #fff;outline-offset:2px}

/* ── MANAGED (CHILD / LINKED) ACCOUNTS ── */
.scb-managed-card{border:1px solid var(--border);border-radius:var(--r);padding:12px 14px;margin-bottom:10px;background:var(--surface2)}
.scb-managed-head{font-size:13px;font-weight:600;margin-bottom:8px;line-height:1.4}
.scb-managed-kind{font-size:11px;color:var(--muted);font-weight:400}
.scb-managed-row{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text2);
  padding:6px 8px;margin:0 -8px;border-radius:var(--r-xs);cursor:pointer;transition:background .12s}
.scb-managed-row:hover{background:var(--surface3)}
.scb-managed-row input[type=checkbox]{width:auto;flex-shrink:0;margin:0;cursor:pointer;accent-color:var(--accent)}

/* ── RULES & GUIDELINES ── */
.scb-rules-body h4{font-size:13px;font-weight:600;color:var(--text);margin:18px 0 6px;line-height:1.4}
.scb-rules-body > h4:first-child{margin-top:2px}
.scb-rules-body p,.scb-rules-body li{font-size:12.5px;color:var(--text2);line-height:1.65}
.scb-rules-body p{margin-bottom:6px}
.scb-rules-body ul{margin:0 0 8px 18px}
.scb-rules-body li{margin-bottom:4px}

/* ── SETTINGS: THEME COLOUR PICKERS ──
   A real swatch rather than a raw OS colour input: same radius and border as
   every other control in Settings, and a big enough target to hit on a phone. */
.scb-color-input{width:46px;height:30px;padding:0;border:1px solid var(--border2);border-radius:var(--r-xs);
  background:none;cursor:pointer;flex-shrink:0;transition:border-color .15s,transform .15s var(--ease-fluent-soft),box-shadow .15s}
.scb-color-input:hover{border-color:var(--accent);transform:scale(1.05);box-shadow:var(--shadow)}
.scb-color-input::-webkit-color-swatch-wrapper{padding:2px}
.scb-color-input::-webkit-color-swatch{border:none;border-radius:5px}
.scb-color-input::-moz-color-swatch{border:none;border-radius:5px}
/* Small section heading inside a modal body — matches .settings-section h3. */
.scb-subhead{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
  color:var(--muted);margin:18px 0 8px}
/* Keep the language dropdown to its content width instead of stretching the
   whole settings row, the way every other inline control here behaves. */
#scb-language-select{width:auto;min-width:150px}

/* ── MEETINGS ── */
#scb-meeting-room{position:fixed;inset:0;z-index:480;background:var(--bg);display:none;flex-direction:column}
#scb-meeting-room.visible{display:flex;animation:scbMeetingIn .3s cubic-bezier(0.16,1,0.3,1)}
@keyframes scbMeetingIn{from{opacity:0;transform:scale(0.99)}to{opacity:1;transform:scale(1)}}
#scb-meeting-top{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);
  background:var(--surface);flex-shrink:0}
#scb-meeting-top > span:first-child{font-size:16px;line-height:1}
#scb-meeting-id-label{font-size:14px;font-weight:700;letter-spacing:.06em}
#scb-meeting-count{font-size:11px;font-weight:600;color:var(--muted);background:var(--surface2);
  border:1px solid var(--border);border-radius:var(--r-pill);padding:2px 10px;white-space:nowrap}
#scb-meeting-main{flex:1;display:flex;min-height:0}
#scb-meeting-grid{flex:1;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;
  padding:12px;overflow-y:auto;align-content:start}
.scb-meet-tile{position:relative;background:#000;border:1px solid var(--border);border-radius:var(--r);
  overflow:hidden;aspect-ratio:16/9;box-shadow:var(--shadow)}
.scb-meet-tile video{width:100%;height:100%;object-fit:cover;display:block}
.scb-meet-name{position:absolute;left:8px;bottom:8px;max-width:calc(100% - 16px);overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;background:rgba(0,0,0,.6);color:#fff;font-size:11px;font-weight:500;
  padding:3px 9px;border-radius:var(--r-pill);backdrop-filter:blur(6px)}
#scb-meeting-chat{width:270px;border-left:1px solid var(--border);background:var(--surface);
  display:flex;flex-direction:column;flex-shrink:0}
#scb-meeting-chat-log{flex:1;overflow-y:auto;padding:12px;font-size:12px;line-height:1.55}
#scb-meeting-chat-log::-webkit-scrollbar{width:4px}
#scb-meeting-chat-log::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}
.scb-meet-chat-row{margin-bottom:8px;word-break:break-word;color:var(--text2)}
.scb-meet-chat-row b{color:var(--accent);font-weight:600}
#scb-meeting-chat-form{display:flex;gap:6px;padding:10px;border-top:1px solid var(--border)}
#scb-meeting-chat-form input{flex:1;min-width:0}
#scb-meeting-controls{display:flex;gap:8px;justify-content:center;padding:12px;border-top:1px solid var(--border);
  background:var(--surface);flex-wrap:wrap;flex-shrink:0;
  padding-bottom:calc(12px + env(safe-area-inset-bottom,0px))}
/* Narrow screens keep the meeting chat — it stacks under the tiles instead of
   disappearing, which is what the old max-width rule used to do. */
@media(max-width:760px){
  #scb-meeting-main{flex-direction:column}
  #scb-meeting-grid{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;padding:8px;flex:1 1 auto}
  #scb-meeting-chat{width:100%;flex:0 0 auto;max-height:34vh;border-left:none;border-top:1px solid var(--border)}
  #scb-meeting-top{padding:8px 12px;gap:8px}
  #scb-meeting-id-label{font-size:13px}
  #scb-meeting-controls{padding:10px 8px;gap:6px}
  #scb-meeting-controls .btn{flex:1;min-width:0;padding:8px 6px}
}

/* ── PHONE / NARROW-VIEWPORT TUNING FOR THE NEWER CHROME ── */
@media(max-width:640px){
  #scb-tab-bar{padding:6px 10px;gap:5px}
  .scb-tab{max-width:120px;font-size:11.5px;padding:5px 5px 5px 10px}
  .scb-suggest-chip{font-size:11.5px;padding:4px 10px}
  .scb-status-row{padding:10px 2px}
  .scb-status-label{width:100%}
  .scb-status-pill{margin-left:0}
  .scb-scam-warn{max-width:100%}
  .scb-color-input{width:52px;height:34px}
  #scb-settings-block .settings-row-actions{flex-shrink:0}
}

/* ── LARGER-TEXT / SIMPLIFIED MODE (opt-in) ──
   Icon buttons are fixed-size circles, so they grow by box size, not padding —
   adding padding to them used to push their glyph off-centre. */
body.scb-large-text{font-size:118%}
body.scb-large-text .bubble,body.scb-large-text .sb-item-name,body.scb-large-text .settings-row-label{font-size:16px;line-height:1.6}
body.scb-large-text .sb-item-preview,body.scb-large-text .settings-row-sub{font-size:14px}
body.scb-large-text .btn{font-size:15px;padding:10px 18px}
body.scb-large-text .btn-sm{font-size:14px;padding:8px 14px}
body.scb-large-text .icon-btn{width:44px;height:44px;font-size:19px}
body.scb-large-text .compose-btn,body.scb-large-text #send-btn{width:40px;height:40px;font-size:17px}
body.scb-large-text .msg-meta{font-size:12px}
body.scb-large-text .scb-tab{font-size:14px;max-width:210px}
body.scb-large-text .scb-suggest-chip{font-size:14px;padding:6px 14px}

/* custom accent colours: the few places that hardcode a gradient inline.
   :not(:has(img)) keeps photo avatars untouched. */
body.scb-custom-colors .avatar:not(:has(img)),
body.scb-custom-colors .group-avatar:not(:has(img)),
body.scb-custom-colors #chat-header-av:not(:has(img)),
body.scb-custom-colors #my-avatar:not(:has(img)){background:var(--accent)!important}
`;
document.head.appendChild(scbFeatureCSS);

