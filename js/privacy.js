/* ===== PRIVACY PREFERENCES =====
   Read receipts, typing indicators, online status, secure link warning.
   Stored in localStorage under cc_privacy as a JSON object. ===== */
function _getPrivacyPrefs(){
  try{ return JSON.parse(localStorage.getItem('cc_privacy')||'{}'); }catch{ return {}; }
}
function savePrivacyPref(key, val){
  const prefs=_getPrivacyPrefs();
  prefs[key]=val;
  try{ localStorage.setItem('cc_privacy',JSON.stringify(prefs)); }catch{}
  _debounceSavePrefs();
}

/* ===== ZERO RETENTION MODE =====
   Used to be a pure no-op: savePrivacyPref() persisted the toggle and
   updateZeroRetentionUI() changed a label, but nothing anywhere ever read
   the preference to actually do anything — a false privacy promise. Now
   reuses the disappearing-messages machinery (per-message zrExpireAt,
   checked by _applyDisappearingFilter alongside the per-conversation
   disappearAfter timer) to actually delete a sender's own messages shortly
   after sending, independent of whatever disappearing-message setting that
   conversation has. ZERO_RETENTION_MS is deliberately short — this is a
   grace window for normal realtime delivery, not a "disappearing messages"
   timer a recipient is meant to have time to read on their own schedule. */
const ZERO_RETENTION_MS = 60000; // 1 minute after sending
function _zrExpireAt(){ return getPrivacyPref('zeroRetention',false) ? Date.now()+ZERO_RETENTION_MS : null; }
function updateZeroRetentionUI(){
  const tog=document.getElementById('zero-retention-toggle');
  const sub=document.getElementById('zero-retention-sub');
  if(!tog||!sub) return;
  sub.textContent=tog.checked?'On — your new messages are deleted from Firebase about '+Math.round(ZERO_RETENTION_MS/1000)+'s after sending':'Off — messages are kept in Firebase as normal';
}

/* ===== COMPACT MODE ===== */
function toggleCompactMode(){
  const on=document.body.classList.toggle('sb-compact');
  try{ localStorage.setItem('cc_compact',on?'1':'0'); }catch{}
  const btn=document.getElementById('compact-mode-btn');
  const sub=document.getElementById('compact-mode-sub');
  if(btn) btn.checked=on;
  if(sub) sub.textContent=on?'On — messages are tightly spaced':'Off — messages have a comfortable amount of spacing';
}
function _initCompactMode(){
  try{
    if(localStorage.getItem('cc_compact')==='1'){
      document.body.classList.add('sb-compact');
      const btn=document.getElementById('compact-mode-btn');
      const sub=document.getElementById('compact-mode-sub');
      if(btn) btn.checked=true;
      if(sub) sub.textContent='On — messages are tightly spaced';
    }
  }catch{}
}

/* ===== FOCUS MODE ===== */
let _focusModeOn=false;
function toggleFocusMode(){
  _focusModeOn=!_focusModeOn;
  document.body.classList.toggle('focus-mode',_focusModeOn);
  const btn=document.getElementById('focus-mode-btn');
  if(btn) btn.title=_focusModeOn?'Exit focus mode (show sidebar)':'Focus mode — hide sidebar';
}

/* ===== KEYBOARD SHORTCUTS MODAL ===== */
function openShortcuts(){ openModal('shortcuts-modal'); }

/* ===== AUDIO PLAYBACK SPEED ===== */
function setAudioSpeed(audioId,speed,btn){
  const audio=document.getElementById(audioId);
  if(audio) audio.playbackRate=speed;
  const wrap=btn&&btn.closest('div');
  if(wrap){ wrap.querySelectorAll('.speed-btn').forEach(b=>b.classList.remove('speed-active')); btn.classList.add('speed-active'); }
}

/* ===== AVATAR ZOOM ===== */
function openAvatarZoom(imgEl){
  const src=imgEl&&(imgEl.src||(imgEl.querySelector&&imgEl.querySelector('img')&&imgEl.querySelector('img').src));
  if(!src) return;
  const ov=document.getElementById('avatar-zoom-overlay');
  const zm=document.getElementById('avatar-zoom-img');
  if(!ov||!zm) return;
  zm.src=src;
  ov.style.display='flex';
}
function closeAvatarZoom(){ const ov=document.getElementById('avatar-zoom-overlay'); if(ov) ov.style.display='none'; }

/* ===== SCHEDULE MESSAGE ===== */
function openScheduleMsg(){
  const now=new Date(Date.now()+60000);
  const dt=document.getElementById('schedule-dt-input');
  if(dt){
    const pad=n=>String(n).padStart(2,'0');
    dt.min=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    dt.value='';
  }
  const err=document.getElementById('schedule-error'); if(err) err.textContent='';
  openModal('schedule-msg-modal');
}
function confirmScheduleMsg(){
  const dt=document.getElementById('schedule-dt-input');
  const err=document.getElementById('schedule-error');
  if(!dt||!dt.value){ if(err) err.textContent='Please pick a time.'; return; }
  const sendAt=new Date(dt.value).getTime();
  if(sendAt<=Date.now()+30000){ if(err) err.textContent='Please pick a time at least 1 minute in the future.'; return; }
  const msgInput=document.getElementById('msg-input');
  const text=msgInput?msgInput.value.trim():'';
  if(!text){ if(err) err.textContent='Type your message first, then schedule it.'; return; }
  const k='cc_scheduled_msgs';
  let list=[]; try{ list=JSON.parse(localStorage.getItem(k)||'[]'); }catch{}
  const item={id:Date.now(),convo:activeConvo&&activeConvo.key,text,sendAt};
  list.push(item); try{ localStorage.setItem(k,JSON.stringify(list)); }catch{}
  setTimeout(()=>_deliverScheduledMsg(item.id),sendAt-Date.now());
  if(msgInput) msgInput.value='';
  closeModal('schedule-msg-modal');
  showToast('Scheduled','Sends at '+new Date(sendAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));
}
async function _deliverScheduledMsg(id){
  const k='cc_scheduled_msgs';
  let list=[]; try{ list=JSON.parse(localStorage.getItem(k)||'[]'); }catch{}
  const item=list.find(m=>m.id===id); if(!item) return;
  list=list.filter(m=>m.id!==id); try{ localStorage.setItem(k,JSON.stringify(list)); }catch{}
  if(!item.convo||!item.text||!me) return;
  const alreadyOpen=activeConvo&&String(activeConvo.key)===String(item.convo);
  const previousConvo=activeConvo;
  try{
    if(!alreadyOpen){
      // Previously, a scheduled message only actually sent if the user
      // happened to still have THAT EXACT chat open when the timer fired —
      // any other chat, or the app sitting on the sidebar/a different
      // screen, meant this just silently dropped the message with the
      // user never finding out. Instead, briefly switch to the target
      // chat to deliver it for real, then switch back to whatever the
      // user was actually looking at.
      if(!convosCache) await getConvos();
      const conv=convosCache&&convosCache.find(x=>x&&x.key===String(item.convo));
      if(!conv){ showToast('Scheduled message not sent',scbErr('SCB-MSG-27','That chat no longer exists.')); return; }
      const contactLike=(contacts&&contacts.find(x=>x.key===conv.key))||{key:conv.key,type:conv.type,number:conv.number,name:conv.name,members:conv.members};
      await openChat(contactLike);
    }
    const el=document.getElementById('msg-input');
    if(el){ el.value=item.text; await sendMsg(); }
  }catch(e){
    console.error('_deliverScheduledMsg failed:',e);
    showToast('Scheduled message not sent',scbErr('SCB-MSG-27','That message couldn\'t be delivered.',(e&&e.message)||''));
  }finally{
    if(!alreadyOpen&&previousConvo) await openChat(previousConvo);
  }
}
function _initScheduledMsgs(){
  const k='cc_scheduled_msgs';
  let list=[]; try{ list=JSON.parse(localStorage.getItem(k)||'[]'); }catch{}
  const now=Date.now();
  for(const item of list){
    const d=item.sendAt-now;
    if(d>0) setTimeout(()=>_deliverScheduledMsg(item.id),d);
  }
}

/* ===== MESSAGE DRAFTS PER CHAT ===== */
function _saveDraft(){
  if(!activeConvo) return;
  const el=document.getElementById('msg-input'); if(!el) return;
  const k='cc_draft_'+activeConvo.key;
  try{ if(el.value) localStorage.setItem(k,el.value); else localStorage.removeItem(k); }catch{}
}
function _loadDraft(){
  if(!activeConvo) return;
  const k='cc_draft_'+activeConvo.key;
  const val=localStorage.getItem(k)||'';
  const el=document.getElementById('msg-input'); if(el) el.value=val;
}

/* ===== KEYBOARD SHORTCUTS ===== */
// Modal id -> its real cancel/teardown function, for the Escape handler
// below. Every entry here owns a live resource (camera stream, an active
// call's Firebase record + ringtone) that a bare closeModal() would leave
// running silently in the background.
const ESCAPE_MODAL_CLEANUP={
  'chat-lock-overlay': ()=>closeChatLockOverlay(),
  'face-mfa-setup-modal': ()=>cancelFaceEnrollment(),
  'incoming-call-modal': ()=>declineIncomingCall(),
  'outgoing-call-modal': ()=>cancelOutgoingCall(),
  'setup-modal': ()=>{
    // setup-modal hosts login/signup/2FA panes too, which own no resource —
    // only route through the camera-owning cleanup while the face-login
    // view is the one actually showing (a live _faceLoginStream is exactly
    // that signal), otherwise close it normally like any other modal.
    if(typeof _faceLoginStream!=='undefined'&&_faceLoginStream) cancelFaceLoginView();
    else closeModal('setup-modal');
  },
};
document.addEventListener('keydown',function(e){
  const inInput=e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA';
  const ctrl=e.ctrlKey||e.metaKey;
  // ? — only when not typing
  if(!inInput&&e.key==='?'&&!ctrl){ openShortcuts(); return; }
  // Ctrl/Cmd shortcuts work everywhere
  if(ctrl&&e.key===','){ e.preventDefault(); if(typeof showSettings==='function') showSettings(); return; }
  if(ctrl&&e.key.toLowerCase()==='b'){ e.preventDefault(); toggleFocusMode(); return; }
  if(ctrl&&e.key.toLowerCase()==='k'){ e.preventDefault(); if(typeof toggleMsgSearch==='function') toggleMsgSearch(); return; }
  // Esc — close topmost modal when not searching
  if(!inInput&&e.key==='Escape'){
    // Use the z-stack to close the topmost modal; fall back to DOM query if
    // the stack is empty (e.g. a modal opened without going through openModal).
    const id=_modalZStack.length ? _modalZStack[_modalZStack.length-1].id
            : (document.querySelector('.overlay.visible')||{}).id;
    if(id){
      // A handful of modals own a live resource (camera stream, an active
      // call's Firebase record + ringtone) that only their dedicated cancel
      // function releases — a bare closeModal() just hides the overlay and
      // silently leaves that resource running (camera left on; an incoming
      // call's ringtone looping forever off-screen; an outgoing call still
      // live so it can auto-connect the mic later if the other side
      // answers). Route those through their real teardown; everything else
      // still just closes normally.
      const cleanup=ESCAPE_MODAL_CLEANUP[id];
      if(cleanup) cleanup();
      else closeModal(id);
    }
  }
});

function getPrivacyPref(key, defaultVal=true){
  const prefs=_getPrivacyPrefs();
  return key in prefs ? prefs[key] : defaultVal;
}
function _initPrivacyToggles(){
  const ids={readReceipts:'read-receipts-toggle',typingIndicators:'typing-indicator-toggle',showOnline:'online-status-toggle',secureLinkWarning:'secure-links-toggle',messageSound:'message-sound-toggle',callRingtone:'call-ringtone-toggle',pingSound:'ping-sound-toggle',suppressEveryone:'suppress-everyone-toggle'};
  for(const [key,id] of Object.entries(ids)){
    const el=document.getElementById(id);
    if(el) el.checked=getPrivacyPref(key,true);
  }
  // zero-retention
  const zr=document.getElementById('zero-retention-toggle');
  if(zr){ zr.checked=!!getPrivacyPref('zeroRetention',false); updateZeroRetentionUI(); }
  const badgeSel=document.getElementById('badge-style-select');
  if(badgeSel) badgeSel.value=getPrivacyPref('badgeStyle','count');
  const groupAddSel=document.getElementById('group-add-permission-select');
  if(groupAddSel) groupAddSel.value=getPrivacyPref('groupAddPermission','anyone');
  const numVisSel=document.getElementById('number-visibility-select');
  if(numVisSel) numVisSel.value=getPrivacyPref('numberVisibility','anyone');
  const selfDestructSel=document.getElementById('self-destruct-select');
  if(selfDestructSel&&me) selfDestructSel.value=String(me.selfDestructMonths||0);
  _scbPopulateSoundSelects();
}

/* ===== PIN BRUTE FORCE LOCKOUT =====
   5 wrong PIN attempts → 15-minute lockout, stored in localStorage. ===== */
function _pinLockKey(){ return 'cc_pin_lock'; }
function _checkPinLocked(){
  try{
    const raw=localStorage.getItem(_pinLockKey());
    if(!raw) return null;
    const data=JSON.parse(raw);
    if(Date.now()>data.until){ localStorage.removeItem(_pinLockKey()); return null; }
    return data;
  }catch{ return null; }
}
function _recordPinFailure(){
  try{
    const raw=localStorage.getItem(_pinLockKey());
    let data=raw?JSON.parse(raw):{count:0,until:0};
    if(data.until>0&&Date.now()>data.until) data={count:0,until:0}; // expired lockout: reset
    data.count+=1;
    if(data.count>=5) data.until=Date.now()+15*60*1000;
    localStorage.setItem(_pinLockKey(),JSON.stringify(data));
    return data;
  }catch{ return {count:1,until:0}; }
}
function _clearPinLock(){ try{ localStorage.removeItem(_pinLockKey()); }catch{} }

/* ===== LOGIN HISTORY =====
   Last 5 logins stored in user record under loginHistory[]. ===== */
/* ===== RISK-BASED LOGIN CHALLENGE (security feature 7/32) =====
   There's no backend here to see the real client IP, so "location" is a
   best-effort client-side IP geolocation lookup (ipapi.co, free, no key —
   same spirit as the other no-key services already used in this app).
   Fails open: if the lookup fails or is rate-limited, the login is never
   blocked over it — this is a risk SIGNAL, not a hard gate on its own. ===== */
async function _getApproxCountry(){
  try{
    // fetch() has no default timeout — if ipapi.co is slow, rate-limited,
    // or silently intercepted by an ad-blocker/privacy extension (common
    // for exactly this kind of third-party IP-lookup request), the promise
    // can hang forever with no rejection. That left every caller stuck:
    // _checkLoginRisk() is awaited directly in submitLogin() before 2FA
    // branching even happens, so a hung fetch here froze the Log In button
    // on an infinite spinner with no error ever shown — the existing
    // .catch() wrappers only handle a REJECTED promise, not one that never
    // settles at all. Aborting after 5s turns that into the same
    // already-handled "treat as non-risky, let login proceed" fallback.
    const ctrl=new AbortController();
    const timeout=setTimeout(()=>ctrl.abort(),5000);
    let res;
    try{ res=await fetch('https://ipapi.co/json/',{signal:ctrl.signal}); }
    finally{ clearTimeout(timeout); }
    if(!res.ok) return null;
    const data=await res.json();
    return (data&&data.country_code)?String(data.country_code).toUpperCase():null;
  }catch(e){ return null; }
}
function _recentLoginCountries(user){
  return (Array.isArray(user.loginHistory)?user.loginHistory:[]).map(h=>h&&h.country).filter(Boolean);
}

// ── GEOFENCING / COMPLIANCE MODE ─────────────────────────────────────────────
// HONEST SCOPE: this app has no backend server — only client + Firebase +
// a couple of Cloudflare Worker proxies. There is no way to actually BLOCK
// a feature server-side based on region (real geofencing needs a server
// that enforces it). What we CAN honestly do client-side is detect an
// approximate region from IP geolocation and surface the data-rights
// notice that region's privacy law requires, pointing at the real rights
// this app already supports (encrypted data export, account self-destruct/
// deletion) — a disclosure/consent layer, not a feature-blocking one.
const GDPR_EEA_COUNTRIES=['AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','IS','IT','LI','LT','LU','LV','MT','NL','NO','PL','PT','RO','SE','SI','SK','GB'];
function _isGdprRegion(countryCode){
  return !!countryCode && GDPR_EEA_COUNTRIES.includes(String(countryCode).toUpperCase());
}
function renderComplianceNotice(countryCode){
  const dlg=document.createElement('div');
  dlg.id='compliance-notice-modal';
  dlg.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px';
  dlg.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);padding:24px;width:100%;max-width:420px;box-shadow:var(--shadow-lg)">
    <div style="font-size:28px;margin-bottom:8px">🔐</div>
    <h3 style="margin:0 0 6px;font-size:15px">Your data rights</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 12px">Based on your approximate location (${esc(countryCode||'your region')}), you have rights over your data under local privacy law. SoCloudyBro supports these directly:</p>
    <ul style="font-size:12px;color:var(--text2);margin:0 0 16px;padding-left:20px;line-height:1.6">
      <li><b>Right to access/export</b> — download an encrypted copy of all your data in Settings.</li>
      <li><b>Right to erasure</b> — delete your account any time, or set it to self-destruct automatically after a period of inactivity.</li>
      <li><b>Right to object</b> — control what others can see about you in Settings &gt; Privacy.</li>
    </ul>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost btn-sm" style="flex:1" id="compliance-notice-dismiss">Dismiss</button>
      <button class="btn btn-sm" style="flex:1" id="compliance-notice-export">Export my data</button>
    </div>
  </div>`;
  document.body.appendChild(dlg);
  document.getElementById('compliance-notice-dismiss').onclick=()=>{dlg.remove();};
  document.getElementById('compliance-notice-export').onclick=()=>{dlg.remove();if(typeof exportAllDataEncrypted==='function')exportAllDataEncrypted();};
  return dlg;
}
// Debounced to once per account — never nags on every login.
async function _maybeShowComplianceNotice(){
  if(!window.me) return;
  const seenKey='cc_compliance_notice_seen_'+window.me.number;
  if(localStorage.getItem(seenKey)) return;
  const country=await _getApproxCountry();
  if(!_isGdprRegion(country)) return;
  localStorage.setItem(seenKey,'1');
  renderComplianceNotice(country);
}
// Only flags a login as risky when the country is actually known AND there's
// prior history with a known country to compare against — a brand-new
// account or a lookup failure is never treated as risky.
async function _checkLoginRisk(user){
  const country=await _getApproxCountry();
  if(!country) return {risky:false,country:null};
  const known=_recentLoginCountries(user);
  if(!known.length) return {risky:false,country};
  return {risky:!known.includes(country),country};
}
// Blocking interstitial shown only when _checkLoginRisk() flags the sign-in.
// Resolves true if the user explicitly confirms it was them, false if they
// cancel (login must not proceed in that case).
function showRiskyLoginChallenge(country){
  return new Promise(resolve=>{
    const dlg=document.createElement('div');
    dlg.id='risky-login-modal';
    dlg.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px';
    dlg.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);padding:24px;width:100%;max-width:380px;box-shadow:var(--shadow-lg)">
      <div style="font-size:28px;margin-bottom:8px">🌍</div>
      <h3 style="margin:0 0 6px;font-size:15px">New sign-in location</h3>
      <p style="font-size:12px;color:var(--muted);margin:0 0 16px">This sign-in looks like it's coming from ${country?esc(country):'an unfamiliar location'} — somewhere this account hasn't signed in from recently. If this is you, continue below. If it isn't, cancel and change your password.</p>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" style="flex:1" id="risky-login-cancel">Cancel</button>
        <button class="btn btn-sm" style="flex:1" id="risky-login-continue">Yes, continue</button>
      </div>
    </div>`;
    document.body.appendChild(dlg);
    document.getElementById('risky-login-cancel').onclick=()=>{dlg.remove();resolve(false);};
    document.getElementById('risky-login-continue').onclick=()=>{dlg.remove();resolve(true);};
  });
}
async function _recordLogin(){
  if(!window.me) return false;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===window.me.number);
    if(!u) return false;
    if(!Array.isArray(u.loginHistory)) u.loginHistory=[];
    const label=getDeviceLabel(), os=getDeviceOS();
    const country=await _getApproxCountry();
    // Only a device label genuinely never seen before counts as "new" — not
    // the user's very first-ever login (nothing to compare against yet).
    const isNewDevice=u.loginHistory.length>0 && !u.loginHistory.some(h=>h&&h.device===label);
    u.loginHistory.unshift({time:Date.now(),device:label,os,country});
    if(u.loginHistory.length>5) u.loginHistory=u.loginHistory.slice(0,5);
    await saveUsers(users);
    if(isNewDevice) _alertNewDeviceLogin(u,label,os).catch(()=>{});
    return isNewDevice;
  }catch(e){ console.warn('Login history record failed',e); return false; }
}
// Security feature 2/32: alert on sign-in from a device never seen before.
// Shown in-app immediately (always works), and best-effort emailed via the
// same Web3Forms key used for reports/digests. Honest limitation: that key
// is configured to deliver to the admin's own inbox (see WEB3FORMS_ACCESS_KEY
// above) — Web3Forms only forwards to the account holder's own email address
// too if an autoresponder is set up for this key in the Web3Forms dashboard,
// which this code can't configure or verify. The admin copy always arrives
// either way, which on its own is still a real security-monitoring signal.
async function _alertNewDeviceLogin(u,label,os){
  showToast('🆕 New device signed in',(label||'A device')+(os?' ('+os+')':'')+' just signed in. If this wasn\'t you, change your password immediately.');
  await _logSecurityEvent('new_device_login','New device: '+(label||'Unknown')+(os?' · '+os:'')).catch(()=>{});
  if(!u||!u.email) return;
  try{
    await sendWeb3Form({
      subject:'New device signed in to your SoCloudyBro account',
      email:u.email,
      account_number:u.number,
      account_name:dec(u.name||''),
      device:label||'Unknown device',
      os:os||'Unknown OS',
      time:new Date().toLocaleString(),
      message:'A new device just signed in to your SoCloudyBro account (#'+u.number+'). If this was you, no action is needed. If you don\'t recognize this device, change your password right away from Settings → Security.',
    });
  }catch(e){ console.warn('New-device alert email failed (non-fatal):',e.message); }
}
/* ===== SELF-DESTRUCT ACCOUNT ON INACTIVITY (security feature 37/32) =====
   A dormant account's own client isn't running to check its own clock, so
   the sweep runs on the ADMIN's session instead (featurePostLaunch(),
   gated to ADMIN_NUMBER, debounced to once/day) — the one account that's
   actually guaranteed to log in periodically. Each self-destruct is logged
   to admin_site/self_destructed_log via push() with no corresponding
   delete UI anywhere in this app, so that log is append-only in practice.
   Honest limitation: this app has no backend, so it has never recorded
   anyone's real IP address anywhere — "ban that IP" isn't something this
   architecture can do. What IS tracked (and what the admin can act on from
   that log) is the account number and its device labels/history. ===== */
async function saveSelfDestructMonths(months){
  if(!me) return;
  me.selfDestructMonths=parseInt(months)||0;
  saveStorage();
  try{ await registerOrUpdate(); }catch(e){ showToast('Failed to save',scbErr('SCB-SEC-30','That setting couldn\'t be saved — the server rejected the write.',(e.message||''))); }
}
const SELF_DESTRUCT_SWEEP_INTERVAL_MS=24*60*60*1000; // run the sweep at most once/day
async function _sweepSelfDestructAccounts(){
  if(!me||me.number!==ADMIN_NUMBER) return;
  try{
    const lastSwept=Number(localStorage.getItem('cc_last_self_destruct_sweep')||0);
    if(Date.now()-lastSwept<SELF_DESTRUCT_SWEEP_INTERVAL_MS) return;
    localStorage.setItem('cc_last_self_destruct_sweep',String(Date.now()));
    const users=await getUsers();
    const now=Date.now();
    let anyDestroyed=false;
    for(const u of users){
      if(!u||!u.selfDestructMonths||u.deleted||u.number===ADMIN_NUMBER) continue;
      const thresholdMs=u.selfDestructMonths*30*86400000;
      // Prefer lastActive (privacy-pref-independent) over lastSeen, which
      // freezes for any user who has turned off "show online status" —
      // see registerOrUpdate()'s comment on the lastActive field.
      const lastActive=u.lastActive||u.lastSeen||u.createdAt||0;
      if(!lastActive||now-lastActive<thresholdMs) continue;
      // Immutable log entry BEFORE anonymizing — this is the only remaining
      // record of who this account was, so it has to be written first.
      try{
        // .push() isn't covered by the global Firebase timeout guard (see its
        // installer comment near `const fbdb=...`) — guarded individually here.
        await _withFirebaseTimeout(fbdb.ref('admin_site/self_destructed_log').push({
          number:u.number, name:dec(u.name)||('#'+u.number), lastSeen:lastActive,
          selfDestructMonths:u.selfDestructMonths, destroyedAt:now,
          devices:u.devices?Object.values(u.devices).map(d=>d&&d.label).filter(Boolean):[],
        }),'Self-destruct log write',10000);
      }catch(e){ console.warn('Self-destruct log write failed (non-fatal):',e.message); }
      u.name=enc('Deleted User'); u.bio=''; u.customStatus=''; u.avatar=''; u.pwd=''; u.email=''; u.birthdate='';
      u.blocked=[]; u.blockedCalls=[]; u.blockedMessages=[]; u.deleted=true; u.devices={};
      u.totpEnabled=false; u.totpSecret=''; u.faceMfaEnabled=false; u.faceDescriptor=null;
      u.googleSub=null; u.googleEmail=''; u.linkedSyntaxAccount=null; u.linkedSyntaxAccountName='';
      u.selfDestructMonths=0;
      anyDestroyed=true;
    }
    if(anyDestroyed) await saveUsers(users);
  }catch(e){ console.warn('Self-destruct sweep failed (non-fatal):',e.message); }
}
function openSelfDestructedLog(){
  if(me.number!==ADMIN_NUMBER){ showToast('Admins only',''); return; }
  (async()=>{
    const snap=await fbdb.ref('admin_site/self_destructed_log').orderByChild('destroyedAt').limitToLast(100).get().catch(()=>null);
    const entries=[];
    if(snap&&snap.exists()) snap.forEach(child=>entries.unshift({_key:child.key,...child.val()}));
    const rows=entries.length
      ? entries.map(e=>`<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500">${esc(e.name||'Unknown')} <span style="color:var(--muted);font-size:11px">#${e.number}</span></div>
          <div style="font-size:11px;color:var(--muted)">Destroyed ${new Date(e.destroyedAt).toLocaleString()} · inactive ${e.selfDestructMonths}mo · last seen ${e.lastSeen?new Date(e.lastSeen).toLocaleDateString():'?'}</div>
          ${(e.devices||[]).length?'<div style="font-size:10px;color:var(--muted)">Devices: '+esc(e.devices.join(', '))+'</div>':''}</div>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-number="${e.number}" onclick="adminBanDestroyedAccount(Number(this.dataset.number))">🚫 Ban #${e.number}</button>
        </div>`).join('')
      : '<div style="color:var(--muted);font-size:13px;padding:12px 0">No accounts have self-destructed yet.</div>';
    const dlg=document.createElement('div');
    dlg.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
    dlg.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);padding:24px;width:100%;max-width:480px;max-height:80vh;overflow-y:auto;box-shadow:var(--shadow-lg)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <h3 style="margin:0;font-size:15px">💀 Self-Destructed Accounts</h3>
        <button class="btn btn-ghost btn-sm" onclick="this.closest('div[style*=fixed]').remove()">✕</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">This log is permanent and cannot be edited or erased. This app has no backend and has never recorded real IP addresses — banning here blocks the account number, the only identity this log actually has.</div>
      ${rows}
    </div>`;
    document.body.appendChild(dlg);
  })();
}
async function adminBanDestroyedAccount(num){
  if(!requirePermission('users_ban')) return;
  if(!confirm('Reserve account #'+num+' so it can never be used again?')) return;
  try{
    const rsnap=await fbdb.ref('admin_site/reserved_numbers').get();
    const reserved=rsnap.exists()?(rsnap.val()||[]):[];
    const updated=[...new Set([...(Array.isArray(reserved)?reserved:[]).map(Number),Number(num)])];
    await fbdb.ref('admin_site/reserved_numbers').set(updated);
    showToast('Account number banned','#'+num+' can never sign up again.');
  }catch(e){ showToast('Failed',scbErr('SCB-ADMIN-29','Could not reserve that number.',(e.message||''))); }
}
function openLoginHistory(){
  if(!window.me) return;
  const users=window.usersCache||[];
  const u=users.find(x=>x.number===window.me.number);
  const history=(u&&u.loginHistory)||[];
  const rows=history.length
    ? history.map(h=>`<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)"><div><div style="font-size:13px;font-weight:500">${esc(h.device||'Unknown device')}</div><div style="font-size:11px;color:var(--muted)">${esc(h.os||'')}</div></div><div style="font-size:12px;color:var(--muted);text-align:right">${new Date(h.time).toLocaleString()}</div></div>`).join('')
    : '<div style="color:var(--muted);font-size:13px;padding:12px 0">No login history yet.</div>';
  const dlg=document.createElement('div');
  dlg.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
  dlg.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);padding:24px;width:100%;max-width:400px;max-height:80vh;overflow-y:auto;box-shadow:var(--shadow-lg)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <h3 style="margin:0;font-size:15px">🕐 Login History</h3>
      <button class="btn btn-ghost btn-sm" onclick="this.closest('div[style*=fixed]').remove()">✕</button>
    </div>
    ${rows}
  </div>`;
  document.body.appendChild(dlg);
}

/* ===== SECURITY LOG =====
   Logs security events (login, pwd change, MFA toggle, key rotation) in
   user record under securityLog[]. Max 20 entries. ===== */
async function _logSecurityEvent(type, detail=''){
  if(!window.me) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===window.me.number);
    if(!u) return;
    if(!Array.isArray(u.securityLog)) u.securityLog=[];
    u.securityLog.unshift({time:Date.now(),type,detail,device:getDeviceLabel()});
    if(u.securityLog.length>20) u.securityLog=u.securityLog.slice(0,20);
    await saveUsers(users);
  }catch(e){ console.warn('Security log write failed',e); }
}
function openSecurityLog(){
  const users=window.usersCache||[];
  const u=window.me?users.find(x=>x.number===window.me.number):null;
  const log=(u&&u.securityLog)||[];
  const icons={login:'🔑',password_change:'🔒',mfa_enabled:'🛡',mfa_disabled:'⚠️',key_rotation:'🔄',logout:'🚪',pin_set:'📌',pin_removed:'📌',face_mfa:'📷',recovery_set:'❓',new_device_login:'🆕',passkey_added:'🔑',remote_wipe:'🗑️',shadow_mute:'🔇'};
  const rows=log.length
    ? log.map(e=>`<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)"><div style="font-size:18px;min-width:24px">${icons[e.type]||'📋'}</div><div style="flex:1"><div style="font-size:13px;font-weight:500">${esc(e.type.replace(/_/g,' '))}</div><div style="font-size:11px;color:var(--muted)">${esc(e.detail||'')} · ${esc(e.device||'')}</div></div><div style="font-size:11px;color:var(--muted);white-space:nowrap">${new Date(e.time).toLocaleString()}</div></div>`).join('')
    : '<div style="color:var(--muted);font-size:13px;padding:12px 0">No security events recorded yet.</div>';
  const dlg=document.createElement('div');
  dlg.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
  dlg.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);padding:24px;width:100%;max-width:480px;max-height:80vh;overflow-y:auto;box-shadow:var(--shadow-lg)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <h3 style="margin:0;font-size:15px">📋 Security Log</h3>
      <button class="btn btn-ghost btn-sm" onclick="this.closest('div[style*=fixed]').remove()">✕</button>
    </div>
    ${rows}
  </div>`;
  document.body.appendChild(dlg);
}

/* ===== SECURITY SCORE =====
   0–100 score based on active protections. Shown in settings panel. ===== */
function _computeSecurityScore(){
  const _me=window.me; const _uc=window.usersCache; const _pk=window._myPubJwk;
  let score=0; const checks=[];
  if(_me&&_me.pwd){ score+=20; checks.push({ok:true,label:'Password set'}); } else checks.push({ok:false,label:'No password'});
  if(_me&&(_me.totpEnabled||_me.faceMfaEnabled)){ score+=25; checks.push({ok:true,label:'2FA enabled'}); } else checks.push({ok:false,label:'2FA off'});
  if(localStorage.getItem('cc_pin')){ score+=15; checks.push({ok:true,label:'PIN lock on'}); } else checks.push({ok:false,label:'No PIN lock'});
  const u=_uc&&_me?_uc.find(x=>x&&x.number===_me.number):null;
  if(u&&Array.isArray(u.secQuestions)&&u.secQuestions.length===2){ score+=15; checks.push({ok:true,label:'Recovery questions set'}); } else checks.push({ok:false,label:'No recovery questions'});
  if(_pk){ score+=15; checks.push({ok:true,label:'E2E keys active'}); } else checks.push({ok:false,label:'E2E keys missing'});
  if(getPrivacyPref('secureLinkWarning',true)){ score+=10; checks.push({ok:true,label:'Secure link warning'}); } else checks.push({ok:false,label:'Link warning off'});
  return {score,checks};
}
function renderSecurityScore(){
  const numEl=document.getElementById('sec-score-num');
  const labelEl=document.getElementById('sec-score-label');
  const subEl=document.getElementById('sec-score-sub');
  const iconEl=document.getElementById('sec-score-icon');
  if(!numEl) return;
  const {score,checks}=_computeSecurityScore();
  numEl.textContent=score;
  labelEl.textContent='Security score';
  const missing=checks.filter(c=>!c.ok).map(c=>c.label);
  if(score>=90){ iconEl.textContent='🛡'; subEl.textContent='Excellent — all major protections active'; }
  else if(score>=60){ iconEl.textContent='🔒'; subEl.textContent='Good'+( missing.length?'. Missing: '+missing.join(', '):''); }
  else if(score>=30){ iconEl.textContent='⚠️'; subEl.textContent='Fair. Enable: '+missing.join(', '); }
  else{ iconEl.textContent='🔓'; subEl.textContent='Weak. Enable: '+missing.slice(0,3).join(', '); }
}

/* ===== E2E KEY ROTATION ===== */
// Core rotation logic shared by the manual "Rotate" button and the
// periodic automatic rotation below (security feature 15/32 — forward-
// secrecy key ratcheting: rotate the DM key periodically, not just
// on-demand). Returns true on success.
async function _doRotateE2EKeys(){
  localStorage.removeItem('cc_e2e_priv_'+window.me.number);
  localStorage.removeItem('cc_e2e_pub_'+window.me.number);
  try{ sessionStorage.removeItem('e2e_synced_'+window.me.number); }catch(e){}
  window._myKeyPair=null; window._myPubJwk=null;
  Object.keys(window._dmAesCache||{}).forEach(k=>delete window._dmAesCache[k]);
  Object.keys(window._groupAesCache||{}).forEach(k=>delete window._groupAesCache[k]);
  const kp=await ensureE2EKeypair();
  if(kp){
    await registerOrUpdate();
    await _logSecurityEvent('key_rotation','E2E keypair regenerated');
    try{ localStorage.setItem('cc_e2e_last_rotation_'+window.me.number,String(Date.now())); }catch(e){}
  }
  return !!kp;
}
async function rotateE2EKeys(){
  if(!window.me){ showToast('Not logged in','Log in first.'); return; }
  if(!confirm('Rotate your E2E encryption keys?\n\nMessages sent before rotation can no longer be decrypted on new devices. Existing messages on THIS device are still readable.\n\nThis cannot be undone.')) return;
  try{
    const ok=await _doRotateE2EKeys();
    if(ok) showToast('Keys rotated','Your E2E encryption keys have been regenerated and published.');
  }catch(e){ showToast('Rotation failed',scbErr('SCB-SEC-22','Key rotation failed.',(e.message||''))); }
}
// Automatic periodic rotation, checked once per app launch. A brand-new
// account (no recorded rotation yet) just starts the clock rather than
// immediately rotating a key it only just created.
const E2E_AUTO_ROTATE_DAYS=90;
async function _maybeAutoRotateE2EKeys(){
  if(!window.me) return;
  try{
    const storeKey='cc_e2e_last_rotation_'+window.me.number;
    const last=Number(localStorage.getItem(storeKey)||0);
    if(!last){ localStorage.setItem(storeKey,String(Date.now())); return; }
    if(Date.now()-last < E2E_AUTO_ROTATE_DAYS*86400000) return;
    const ok=await _doRotateE2EKeys();
    if(ok) showToast('🔄 Encryption keys refreshed','Your messaging keys were automatically rotated for security (every '+E2E_AUTO_ROTATE_DAYS+' days). Older unsynced devices may need Settings → Export/Import Decryption Key.');
  }catch(e){ console.warn('Auto key rotation check failed (non-fatal):',e.message); }
}

/* ===== E2E KEY EXPORT / IMPORT (cross-device) ===== */
async function exportE2EKey(){
  if(!window.me){ showToast('Not logged in','Log in first.'); return; }
  const stored=localStorage.getItem('cc_e2e_priv_'+me.number);
  const storedPub=localStorage.getItem('cc_e2e_pub_'+me.number);
  if(!stored||!storedPub){ showToast('No key yet','Generate a key by sending a message first.'); return; }
  const bundle=btoa(JSON.stringify({number:me.number,priv:stored,pub:storedPub,v:1}));
  const el=document.createElement('textarea');
  el.value=bundle;
  el.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(el);
  el.select();
  try{
    await navigator.clipboard.writeText(bundle);
    showToast('Key copied','Paste it on your other device in Settings → Import Decryption Key. Keep it private.');
  }catch{
    showToast('Key ready','Copy the text below from the text area that opened.');
  }
  el.remove();
  // Show in modal for easy copying
  const txt=document.createElement('div');
  txt.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px';
  txt.innerHTML='<div style="background:var(--surface);border-radius:14px;padding:20px;max-width:480px;width:100%">'
    +'<div style="font-weight:700;margin-bottom:8px;font-size:15px">🔑 Your Decryption Key</div>'
    +'<p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.5">This key lets any device read your messages. Keep it private — treat it like a password.</p>'
    +'<textarea readonly onclick="this.select()" style="width:100%;height:100px;font-size:11px;font-family:monospace;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text);resize:none;box-sizing:border-box">'+bundle+'</textarea>'
    +'<div style="display:flex;gap:8px;margin-top:12px"><button data-act="copyCloseDlg" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px;font-size:13px;font-weight:600;cursor:pointer">Copy & Close</button><button data-act="closeDlg" style="background:transparent;border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;color:var(--text)">Close</button></div>'
    +'</div>';
  document.body.appendChild(txt);
}
async function importE2EKey(){
  if(!window.me){ showToast('Not logged in','Log in first.'); return; }
  const input=prompt('Paste your exported key here:');
  if(!input||!input.trim()) return;
  try{
    const bundle=JSON.parse(atob(input.trim()));
    if(!bundle||!bundle.priv||!bundle.pub||bundle.v!==1){ showToast('Invalid key','This does not look like a valid exported key.'); return; }
    if(bundle.number!==me.number){ showToast('Wrong account','This key belongs to a different account number.'); return; }
    // Validate that the key actually imports correctly
    const privJwk=JSON.parse(bundle.priv);
    const pubJwk=JSON.parse(bundle.pub);
    const pk=await crypto.subtle.importKey('jwk',privJwk,{name:'ECDH',namedCurve:'P-256'},true,['deriveKey','deriveBits']);
    if(!pk){ showToast('Invalid key','Could not load this key — it may be corrupted.'); return; }
    localStorage.setItem('cc_e2e_priv_'+me.number,bundle.priv);
    localStorage.setItem('cc_e2e_pub_'+me.number,bundle.pub);
    window._myKeyPair=null; window._myPubJwk=null;
    Object.keys(window._dmAesCache||{}).forEach(k=>delete window._dmAesCache[k]);
    Object.keys(window._groupAesCache||{}).forEach(k=>delete window._groupAesCache[k]);
    await ensureE2EKeypair();
    _retryFailedDecryptions();
    showToast('Key imported!','Your messages will now decrypt correctly on this device. Reload to decrypt existing messages.');
    setTimeout(()=>{ if(confirm('Reload now to apply the new key?')) location.reload(); },1500);
  }catch(e){ showToast('Import failed','Invalid or corrupted key: '+(e.message||'')); }
}

/* ===== SECURE EXTERNAL LINK WARNING ===== */
document.addEventListener('click', function(e){
  if(!getPrivacyPref('secureLinkWarning',true)) return;
  const a=e.target.closest('a[href]');
  if(!a) return;
  const href=a.href||'';
  if(!href||href.startsWith('javascript')||href.startsWith('#')) return;
  try{
    const url=new URL(href);
    if(url.origin===location.origin) return; // internal link, no warning
  }catch{ return; }
  e.preventDefault();
  const dlg=document.createElement('div');
  dlg.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
  dlg.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);padding:24px;width:100%;max-width:360px;box-shadow:var(--shadow-lg)">
    <div style="font-size:24px;margin-bottom:8px">🔗</div>
    <h3 style="margin:0 0 6px;font-size:15px">External link</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 12px;word-break:break-all">${esc(href)}</p>
    <p style="font-size:12px;margin:0 0 16px">This link goes outside SoCloudyBro. Only open it if you trust the sender.</p>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost btn-sm" id="_extlnk_cancel" style="flex:1">Cancel</button>
      <button class="btn btn-sm" id="_extlnk_open" style="flex:1">Open anyway</button>
    </div>
  </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('#_extlnk_cancel').addEventListener('click',function(){dlg.remove();});
  dlg.querySelector('#_extlnk_open').addEventListener('click',function(){window.open(href,'_blank','noopener,noreferrer');dlg.remove();});
}, true);

/* ===== LAST LOGIN NOTIFICATION ===== */
function _showLastLoginNotif(_afterTour){
  if(!window.me) return;
  if(!_afterTour && typeof _tutorialBusy==='function' && _tutorialBusy()){ _afterTutorial(function(){ _showLastLoginNotif(true); }); return; }
  const users=window.usersCache||[];
  const u=users.find(x=>x&&x.number===window.me.number);
  const history=(u&&u.loginHistory)||[];
  if(history.length<2) return; // first login
  const prev=history[1]; // [0] is the one we just recorded
  const timeStr=new Date(prev.time).toLocaleString();
  showToast('Welcome back','Last login: '+timeStr+(prev.device?' from '+prev.device:''));
}

/* ===== READ RECEIPTS / TYPING INDICATOR / ONLINE STATUS (privacy gates) ===== */
// These hook into the existing seen[] push and typing broadcast.
// The actual gate is applied in the logic sections below.

/* ===== ENCRYPTED EXPORT ===== */
async function exportAllDataEncrypted(){
  const pwd=prompt('Enter a password to encrypt your export:\n(You will need this to decrypt it later — there is no recovery.)');
  if(!pwd||!pwd.trim()){ return; }
  if(pwd.length<6){ showToast('Too short','Use at least 6 characters for the export password.'); return; }
  const btn=document.querySelector('[onclick="exportAllDataEncrypted()"]');
  if(btn){ btn.disabled=true; btn.textContent='Encrypting…'; }
  try{
    // Build the plain export first (reuse same logic)
    if(!window.convosCache) await getConvos();
    const _me=window.me; const _cc=window.contacts||[]; const _uc=window.usersCache||[];
    const data={exportedAt:new Date().toISOString(),app:'SoCloudyBro',profile:{name:_me.name,number:_me.number,email:_me.email||null,bio:_me.bio||''},contacts:_cc.map(c=>({type:c.type,name:c.name,number:c.number||null,key:c.key})),conversations:[]};
    for(const c of _cc){
      const conv=(window.convosCache||[]).find(x=>x&&x.key===c.key);
      if(!conv||!conv.messages||!conv.messages.length) continue;
      const messages=conv.messages.map(m=>{
        const u=m.from===_me.number?_me:(_uc.find(x=>x&&x.number===m.from)||{});
        let content;
        if(msgHasGif(m)) content='[GIF]';
        else if(msgHasPoll&&msgHasPoll(m)) content='[Poll]';
        else{ const f=msgFileData&&msgFileData(m); content=f?'[Attachment]':(msgText(m)||'[encrypted]'); }
        return{from:dec(u.name||'')||('#'+m.from),time:new Date(m.time).toISOString(),content};
      });
      data.conversations.push({name:c.name,type:c.type,messages});
    }
    const plaintext=new TextEncoder().encode(JSON.stringify(data,null,2));
    // Derive key from password with PBKDF2
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const keyMat=await crypto.subtle.importKey('raw',new TextEncoder().encode(pwd),{name:'PBKDF2'},false,['deriveKey']);
    const aesKey=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:200000,hash:'SHA-256'},keyMat,{name:'AES-GCM',length:256},false,['encrypt']);
    const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},aesKey,plaintext);
    // Pack: 4 bytes magic + 16 salt + 12 iv + ciphertext
    const magic=new Uint8Array([0x53,0x43,0x42,0x01]); // "SCB\x01"
    const out=new Uint8Array(magic.length+salt.length+iv.length+ct.byteLength);
    let off=0;out.set(magic,off);off+=magic.length;out.set(salt,off);off+=salt.length;out.set(iv,off);off+=iv.length;out.set(new Uint8Array(ct),off);
    const blob=new Blob([out],{type:'application/octet-stream'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='scb-export-'+window.me.number+'-'+Date.now()+'.scbenc';document.body.appendChild(a);a.click();a.remove();
    showToast('Encrypted export ready','Saved as .scbenc — keep your password safe, there is no recovery.');
  }catch(e){ showToast('Export failed',scbErr('SCB-SEC-21','Encrypted export failed.',(e.message||''))); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='🔒 Encrypted'; } }
}

/* ===== SELF-DESTRUCT MESSAGES (view-once) =====
   A message flagged as selfDestruct=true is shown once, then deleted from
   convosCache and Firebase when the recipient views it. ===== */
function sendSelfDestructMsg(){
  if(!window.activeConvo||window.activeConvo.type==='group'){ showToast('DMs only','Self-destruct messages are only available in direct chats.'); return; }
  const text=prompt('Type your self-destruct message:\n(The recipient sees it once, then it is permanently deleted.)');
  if(!text||!text.trim()) return;
  _sendSelfDestruct(text.trim());
}
async function _sendSelfDestruct(text){
  if(!window.me||!window.activeConvo||!window.convosCache) return;
  // This path (view-once self-destruct messages) never checked parental
  // restrictions at all — a noDm/noGroups-restricted account could send
  // self-destruct messages with zero gating even with the direct fix above
  // on sendMsg()/sendFileMsg().
  if (window.activeConvo.type!=='group' && blockIfRestricted('noDm','Direct messages are turned off for your account.')) return;
  if (window.activeConvo.type==='group' && blockIfRestricted('noGroups','Group chats are turned off for your account.')) return;
  const key=window.activeConvo.key;
  const c=(window.convosCache||[]).find(x=>x&&x.key===key);
  if(!c) return;
  const aesKey=await getConvoAesKey(c);
  const clean=filterBadWords(text);
  const msg={id:Date.now().toString(36)+Math.random().toString(36).slice(2,5),from:window.me.number,time:Date.now(),seen:[],selfDestruct:true};
  const wrapped=aesKey?await aesEnc(aesKey,clean):null;
  if(wrapped){ msg.ctext=wrapped; if(typeof _decCache!=='undefined') _decCache[msg.id]={text:clean}; } else { msg.text=enc(clean); }
  c.messages.push(msg);
  if(c.messages.length>100) c.messages.splice(0,c.messages.length-100);
  await saveConvos();
  lastMsgHash=''; renderMessages(c.messages);
}

/* ===== DISAPPEARING MESSAGES =====
   Per-conversation TTL. Stored as `disappearAfter` (ms) on the conv object.
   Messages older than Date.now()-disappearAfter are hidden on render and
   pruned from storage on the next saveConvos(). ===== */
const _DISAPPEAR_OPTIONS=[
  {label:'Off',ms:0},
  {label:'1 minute',ms:60*1000},
  {label:'1 hour',ms:60*60*1000},
  {label:'24 hours',ms:24*60*60*1000},
  {label:'7 days',ms:7*24*60*60*1000},
];
function _disappearLabel(ms){
  const opt=_DISAPPEAR_OPTIONS.find(o=>o.ms===ms);
  return opt?opt.label:ms+'ms';
}
function openDisappearingMenu(){
  if(!activeConvo){ showToast('No chat open','Open a chat first.'); return; }
  const conv=convosCache&&convosCache.find(x=>x&&x.key===activeConvo.key);
  if(!conv){ showToast('Chat not loaded','Try reopening the chat.'); return; }
  const current=conv.disappearAfter||0;
  const opts=_DISAPPEAR_OPTIONS.map(o=>`<option value="${o.ms}"${o.ms===current?' selected':''}>${o.label}</option>`).join('');
  const dlg=document.createElement('div');
  dlg.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center';
  dlg.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);padding:24px;min-width:280px;max-width:90vw;box-shadow:var(--shadow-lg)">
    <h3 style="margin:0 0 8px;font-size:15px">⏱ Disappearing messages</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 16px">Messages will be hidden and deleted from this chat after the selected time.</p>
    <select id="_disappear_sel" style="width:100%;padding:8px;border-radius:var(--r-sm);border:1px solid var(--border2);background:var(--surface2);color:var(--text);font-size:13px">${opts}</select>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-ghost btn-sm" style="flex:1" onclick="this.closest('div[style*=fixed]').remove()">Cancel</button>
      <button class="btn btn-sm" style="flex:1" onclick="setDisappearTimer(parseInt(document.getElementById('_disappear_sel').value));this.closest('div[style*=fixed]').remove()">Save</button>
    </div>
  </div>`;
  document.body.appendChild(dlg);
}
async function setDisappearTimer(ms){
  if(!activeConvo) return;
  const conv=convosCache&&convosCache.find(x=>x&&x.key===activeConvo.key);
  if(!conv) return;
  if(ms>0) conv.disappearAfter=ms; else delete conv.disappearAfter;
  await saveConvos();
  showToast('Disappearing messages',ms>0?'Set to '+_disappearLabel(ms):'Turned off');
  lastMsgHash=''; renderMessages(conv.messages);
}
// Called from renderMessages — filter expired messages and schedule a prune.
// Filters on TWO independent mechanisms: the per-conversation disappearAfter
// timer (applies to every message in the conversation), and each message's
// own zrExpireAt (set only on a sender's own messages when they had Zero
// Retention Mode on when sending — see _zrExpireAt()). Either one expiring a
// message removes it.
function _applyDisappearingFilter(msgs, disappearAfter){
  const now=Date.now();
  return msgs.filter(m=>{
    if(!m) return false;
    if(disappearAfter>0 && m.time && m.time<=now-disappearAfter) return false;
    if(m.zrExpireAt && m.zrExpireAt<=now) return false;
    return true;
  });
}
// Earliest time ANY surviving message would next expire under either
// mechanism — used to schedule the next prune+save (see renderMessages).
function _nextDisappearTime(msgs, disappearAfter){
  let min=Infinity;
  for(const m of (msgs||[])){
    if(!m) continue;
    if(disappearAfter>0 && m.time) min=Math.min(min, m.time+disappearAfter);
    if(m.zrExpireAt) min=Math.min(min, m.zrExpireAt);
  }
  return min;
}

/* ===== SAFETY NUMBERS (key fingerprint) =====
   Computes a 40-char hex fingerprint of the shared AES-GCM key bytes so
   two users can compare out-of-band that no one is intercepting their chat. ===== */
async function _computeSafetyNumbers(otherNum){
  const key=await getDmAesKey(otherNum);
  if(!key) return null;
  try{
    const raw=await crypto.subtle.exportKey('raw',key);
    const hash=await crypto.subtle.digest('SHA-256',raw);
    const hex=Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
    // Format as 5 groups of 8: easier to read aloud
    return hex.slice(0,40).match(/.{8}/g).join(' ');
  }catch{ return null; }
}
/* ===== KEY-CHANGE WARNING BANNER (security feature 12/32) =====
   Signal-style: if a contact's public key changes from the one we last saw
   and trusted, that's flagged loudly instead of silently re-deriving a new
   shared key and moving on — it's exactly what a MITM key-swap looks like,
   even though it's far more often just the other person reinstalling the
   app or using rotateE2EKeys(). The last-seen key is remembered in
   localStorage (per contact, forever) so this survives a reload. ===== */
async function _checkContactKeyChange(number,pubkeyStr){
  if(!pubkeyStr) return false;
  try{
    const hash=await _sha256Hex(pubkeyStr);
    const storageKey='cc_known_pubkey_'+number;
    const prev=localStorage.getItem(storageKey);
    localStorage.setItem(storageKey,hash);
    if(prev&&prev!==hash){
      delete _dmAesCache[number]; // force re-derivation with the new key rather than keep using a stale cached session key
      return true;
    }
    return false;
  }catch(e){ return false; }
}
function _flagContactKeyChanged(number){
  try{ sessionStorage.setItem('cc_key_changed_'+number,'1'); }catch(e){}
  if(typeof showToast==='function') showToast('⚠️ Encryption key changed','A contact\'s security key changed — verify their safety number before trusting new messages.');
  if(typeof _logSecurityEvent==='function') _logSecurityEvent('key_change_warning','Key changed for contact #'+number).catch(()=>{});
  renderKeyChangeBanner(number);
}
function renderKeyChangeBanner(number){
  const el=document.getElementById('key-change-banner');
  if(!el) return;
  if(!activeConvo||activeConvo.type==='group'||activeConvo.number!==number){ el.style.display='none'; return; }
  el.style.display='flex';
  el.innerHTML='';
  el.appendChild(document.createTextNode('⚠️ This contact\'s encryption key changed. '));
  const _kcVerify=document.createElement('button');
  _kcVerify.style.cssText='margin-left:6px;text-decoration:underline;background:none;border:none;color:inherit;cursor:pointer;font-size:12px;padding:0';
  _kcVerify.textContent='Verify now';
  _kcVerify.onclick=()=>{ hideHeaderMenu(); openSafetyNumbers(); };
  const _kcDismiss=document.createElement('button');
  _kcDismiss.style.cssText='margin-left:auto;background:none;border:none;color:inherit;cursor:pointer;font-size:14px;padding:0';
  _kcDismiss.textContent='✕';
  _kcDismiss.onclick=()=>dismissKeyChangeBanner(number);
  el.appendChild(_kcVerify);
  el.appendChild(_kcDismiss);
}
function dismissKeyChangeBanner(number){
  try{ sessionStorage.removeItem('cc_key_changed_'+number); }catch(e){}
  const el=document.getElementById('key-change-banner');
  if(el) el.style.display='none';
}
// Called from _origOpenChat() when switching into a DM, so a previously
// flagged-but-not-yet-dismissed warning for THIS contact still shows after
// navigating away and back, instead of only ever appearing once.
function _restoreKeyChangeBannerIfAny(number){
  try{ if(sessionStorage.getItem('cc_key_changed_'+number)){ renderKeyChangeBanner(number); return; } }catch(e){}
  const el=document.getElementById('key-change-banner');
  if(el) el.style.display='none';
}
async function openSafetyNumbers(){
  if(!activeConvo||activeConvo.type==='group'){ showToast('DM only','Safety numbers are only available in 1-on-1 chats.'); return; }
  const otherNum=activeConvo.number;
  const fp=await _computeSafetyNumbers(otherNum);
  if(!fp){ showToast('Not encrypted','This chat doesn\'t have E2E encryption active yet. Ask the other person to open the app to exchange keys.'); return; }
  const dlg=document.createElement('div');
  dlg.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center';
  dlg.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--r);padding:24px;min-width:300px;max-width:90vw;box-shadow:var(--shadow-lg);text-align:center">
    <div style="font-size:28px;margin-bottom:8px">🔐</div>
    <h3 style="margin:0 0 6px;font-size:15px">Security verification</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 16px">Compare this code with <b>#${otherNum}</b> over a call or in person. If it matches on both devices, your chat is secure.</p>
    <div style="font-family:monospace;font-size:17px;font-weight:700;letter-spacing:0.08em;background:var(--surface2);border-radius:var(--r-sm);padding:14px;word-break:break-all;color:var(--accent)">${esc(fp)}</div>
    <p style="font-size:11px;color:var(--muted);margin:10px 0 16px">If the codes don\'t match, someone may be intercepting your messages.</p>
    <button class="btn btn-full" onclick="this.closest('div[style*=fixed]').remove()">Close</button>
  </div>`;
  document.body.appendChild(dlg);
}

/* ===== CLIPBOARD AUTO-CLEAR =====
   After copying any message, clear the clipboard after 60 seconds so the
   contents don't linger in the OS clipboard manager. ===== */
let _clipboardClearTimer=null;
const _origClipboardWrite=navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText.bind(navigator.clipboard):null;
if(_origClipboardWrite){
  navigator.clipboard.writeText=function(text){
    clearTimeout(_clipboardClearTimer);
    _clipboardClearTimer=setTimeout(()=>{
      _origClipboardWrite('').catch(()=>{});
    }, 60000);
    return _origClipboardWrite(text);
  };
}

/* ===== SCREENSHOT DETECTION (security feature 14/32) =====
   Best-effort, Snapchat-style: a web page can never see an OS-level
   screenshot gesture (macOS Cmd+Shift+3/4, mobile power+volume, etc. never
   reach the browser at all), but on Windows the PrintScreen key DOES fire a
   normal keydown/keyup the focused page can observe — that's the one
   reliable signal available here, so that's what this detects. Drops a
   system message into the open DM so the other person knows, the same way
   Snapchat notifies on a screenshot — there's deliberately no setting to
   suppress this, since a self-disable would defeat the point of it. ===== */
let _lastScreenshotNotifTime=0;
function _maybeNotifyScreenshot(){
  if(!me||!activeConvo||activeConvo.type==='group') return; // DMs only for now
  const now=Date.now();
  if(now-_lastScreenshotNotifTime<3000) return; // debounce the key's repeat/double-fire
  _lastScreenshotNotifTime=now;
  showToast('📸 Screenshot noted','The other person will see a note in this chat that you took a screenshot.');
  (async()=>{
    try{
      if(!convosCache) await getConvos();
      const conv=getActiveConvoObj();
      if(!conv) return;
      _addSystemMessage(conv,'📸 '+(me.name||('#'+me.number))+' took a screenshot of this chat');
      await saveConvos();
    }catch(e){ console.warn('Screenshot notice failed (non-fatal):',e.message); }
  })();
}
document.addEventListener('keyup',function(e){
  if(e.key==='PrintScreen') _maybeNotifyScreenshot();
});

/* ===== AUTO-LOCK / AUTO-LOGOUT ON INACTIVITY + SCREEN BLUR ON HIDE =====
   (security feature 4/32 — session timeout after inactivity)
   Auto-lock: if a PIN is set, lock the screen after 10 minutes of no
   keyboard/mouse/touch activity. The timer resets on every interaction.
   Auto-logout: a session with NO PIN set has no quick-unlock screen to show,
   so instead it gets signed all the way out after a longer 30-minute idle
   period — still a real session timeout, just higher-friction since it
   requires a full password re-entry, which is why it gets a longer grace
   period than the PIN-protected lock screen.
   Screen blur: blur the app content when the tab is hidden or the window
   loses focus, so the OS task-switcher / screen recorder can't read it. ===== */
(function scbSecurityHooks(){
  const AUTO_LOCK_MS = 10 * 60 * 1000; // 10 minutes idle → lock (PIN set)
  const AUTO_LOGOUT_NO_PIN_MS = 30 * 60 * 1000; // 30 minutes idle → full sign-out (no PIN)
  let _idleTimer = null;

  // One-time notice after a reload caused by the idle auto-logout below.
  try{
    if(localStorage.getItem('cc_auto_logout_reason')){
      localStorage.removeItem('cc_auto_logout_reason');
      setTimeout(function(){ if(typeof showToast==='function') showToast('Signed out','You were signed out after being inactive for a while.'); },1500);
    }
  }catch(e){}

  function _autoLogoutOnIdle(){
    try{
      if(typeof leaveVoiceChannel==='function') leaveVoiceChannel();
      if(typeof leaveMeeting==='function') leaveMeeting();
      if(typeof stopConvoRealtime==='function') stopConvoRealtime();
    }catch(e){}
    try{ localStorage.setItem('cc_auto_logout_reason','inactivity'); }catch(e){}
    clearLocalSessionPreservingE2EKeys();
    location.reload();
  }

  function _resetIdleTimer(){
    if(!window.me) return; // no session → nothing to lock or log out
    clearTimeout(_idleTimer);
    const hasPin=!!localStorage.getItem('cc_pin');
    _idleTimer = setTimeout(function(){
      if(hasPin){
        // Don't lock if the lock screen is already showing
        const ls = document.getElementById('lock-screen');
        if(ls && ls.classList.contains('visible')) return;
        if(window.me && localStorage.getItem('cc_pin')){
          if(typeof showLockScreen === 'function') showLockScreen();
        }
      } else if(window.me){
        _autoLogoutOnIdle();
      }
    }, hasPin?AUTO_LOCK_MS:AUTO_LOGOUT_NO_PIN_MS);
  }

  // Reset the idle timer on any real user activity
  ['mousemove','mousedown','keydown','touchstart','scroll','click'].forEach(function(ev){
    document.addEventListener(ev, _resetIdleTimer, {passive: true, capture: true});
  });
  _resetIdleTimer();

  // Screen blur overlay — created once, shown/hidden via visibility events
  var blurOverlay = document.createElement('div');
  blurOverlay.id = 'scb-blur-overlay';
  blurOverlay.style.cssText = [
    'position:fixed','inset:0','z-index:9998',
    'background:var(--bg,#111)','display:none',
    'align-items:center','justify-content:center',
    'flex-direction:column','gap:12px',
    'font-size:28px','color:var(--text2,#aaa)',
    'backdrop-filter:blur(24px)','-webkit-backdrop-filter:blur(24px)',
    'user-select:none'
  ].join(';');
  blurOverlay.innerHTML = '<div style="font-size:40px">🔒</div><div style="font-size:14px;opacity:0.6">Screen hidden</div>';
  document.body.appendChild(blurOverlay);

  function _showBlur(){
    if(!window.me) return; // not logged in, nothing sensitive on screen
    blurOverlay.style.display = 'flex';
  }
  function _hideBlur(){
    blurOverlay.style.display = 'none';
    _resetIdleTimer();
  }

  document.addEventListener('visibilitychange', function(){
    if(document.hidden) _showBlur(); else _hideBlur();
  });
  window.addEventListener('blur', _showBlur);
  window.addEventListener('focus', _hideBlur);
})();

/* =============================================================================
   SLASH COMMANDS + CLOUDY CHAT
   ============================================================================= */
// These must be globals — referenced by openChat and updateOnlineStatus above
const CLOUDY_NUMBER='00000';
const CLOUDY_CONTACT={type:'dm',number:CLOUDY_NUMBER,name:'Cloudy',avatar:'__cloudy__',bio:'Your AI assistant — chat, call, or schedule anything.',key:'dm_00000_cloudy',_isCloudy:true};

(function(){

// ── SLASH COMMAND REGISTRY ──────────────────────────────────────────────────
const SLASH_CMDS = [
  { cmd:'/gif',     icon:'🎞️',  args:'[search]',           desc:'Send a GIF',
    run:(args)=>{ const q=args.trim(); if(q){ _slashGif(q); } else toggleGif(); } },
  { cmd:'/shrug',   icon:'🤷',  args:'',                   desc:'¯\\_(ツ)_/¯',
    run:()=>{ _insertText('¯\\_(ツ)_/¯'); } },
  { cmd:'/me',      icon:'💬',  args:'[text]',              desc:'Narrate an action',
    run:(args)=>{ if(args.trim()) _insertText('/me '+args.trim(),true); } },
  { cmd:'/poll',    icon:'📊',  args:'[question]',          desc:'Create a poll',
    run:(args)=>{ if(typeof openPollModal==='function') openPollModal(args.trim()||''); } },
  { cmd:'/clear',   icon:'🗑️',  args:'',                   desc:'Clear the input box',
    run:()=>{ const el=document.getElementById('msg-input'); if(el){el.value='';autoResize(el);} } },
  { cmd:'/call',    icon:'📞',  args:'',                   desc:'Start a voice call',
    // `startCall` never existed as a function, so this always fell through
    // to cloudyStartCall(activeConvo.name) — a by-name DM contact lookup that
    // can never match the chat you're already in, so /call in a group always
    // reported "couldn't find that contact" instead of joining its voice
    // channel. Go straight to the right action for the chat that's open.
    run:()=>{
      if(!activeConvo){ showToast('Call','Open a chat first'); return; }
      if(activeConvo.type==='group'){ if(typeof cloudyJoinVoiceChannel==='function') cloudyJoinVoiceChannel(); }
      else{ const c=contacts.find(x=>x&&x.key===activeConvo.key); if(c) startDirectCall(c); else showToast('Call','Open a chat first'); }
    } },
  { cmd:'/pin',     icon:'📌',  args:'',                   desc:'Pin a message',
    run:()=>{ showToast('Pin','Long-press or right-click a message to pin it.'); } },
  { cmd:'/mute',    icon:'🔕',  args:'',                   desc:'Mute/unmute this chat',
    run:()=>{ if(activeConvo&&typeof mutedChats!=='undefined'){ const k=activeConvo.key; mutedChats[k]=!mutedChats[k]; saveStorage(); showToast('Chat',mutedChats[k]?'Muted':'Unmuted'); } else showToast('Mute','Open a chat first'); } },
  { cmd:'/image',   icon:'🖼️',  args:'',                   desc:'Attach an image',
    run:()=>{ const fi=document.getElementById('file-attach-input'); if(fi){fi.accept='image/*';fi.click();} } },
  { cmd:'/file',    icon:'📎',  args:'',                   desc:'Attach a file',
    run:()=>{ if(typeof openAttachPicker==='function') openAttachPicker(); } },
  { cmd:'/remind',  icon:'⏰',  args:'[time] [text]',       desc:'Set a reminder (e.g. /remind 5m Call Alex)',
    run:(args)=>{ _slashRemind(args.trim()); } },
  { cmd:'/whisper', icon:'🤫',  args:'@user [text]',        desc:'Send a private message',
    run:(args)=>{ _slashWhisper(args.trim()); } },
  { cmd:'/cloudy',  icon:'☁️',  args:'[message]',           desc:'Chat with Cloudy',
    run:(args)=>{ _openCloudy(); if(args.trim()) setTimeout(()=>_sendToCloudyChat(args.trim()),400); } },
];

function _insertText(text, send=false){
  const el=document.getElementById('msg-input');
  if(!el) return;
  el.value=text;
  autoResize(el);
  if(send) sendMsg();
}

function _slashGif(query){
  if(typeof toggleGif==='function') toggleGif();
  setTimeout(()=>{
    const gi=document.getElementById('gif-search');
    if(gi){gi.value=query; gi.dispatchEvent(new Event('input'));}
  },300);
}

function _slashRemind(args){
  const m=args.match(/^(\d+)\s*(m(?:in(?:utes?)?)?|h(?:ours?)?|s(?:econds?)?)\s+(.+)$/i)
         ||args.match(/^in\s+(\d+)\s*(min(?:utes?)?|hours?)\s+(.+)$/i);
  if(!m){
    if(typeof openScheduleMsg==='function') openScheduleMsg();
    showToast('Reminder','Usage: /remind 5m Call Alex');
    return;
  }
  // Both patterns now capture the same 3 groups (n, unit, text) — the old
  // "in N minutes" fallback used to throw its own number away and hardcode a
  // flat 60s delay no matter what was actually asked for.
  const n=parseInt(m[1],10);
  const unit=m[2].toLowerCase();
  const text=m[3];
  const delay=unit.startsWith('h')?n*3600000:unit.startsWith('s')?n*1000:n*60000;
  const unitLabel=unit.startsWith('h')?'hour':unit.startsWith('s')?'second':'minute';
  setTimeout(()=>showToast('⏰ Reminder',text),delay);
  showToast('Reminder','Set! I\'ll remind you in '+n+' '+unitLabel+(n===1?'':'s')+'.');
}

function _slashWhisper(args){
  const m=args.match(/^@?(\S+)\s+(.+)$/);
  if(!m){ showToast('/whisper','Usage: /whisper @name message'); return; }
  const name=m[1], text=m[2];
  if(typeof cloudySendMessage==='function') cloudySendMessage(name, '🤫 [whisper] '+text);
  else showToast('Whisper','Could not find contact: '+name);
}

// ── PALETTE UI ──────────────────────────────────────────────────────────────
function _showSlashPalette(q){
  const pal=document.getElementById('slash-palette');
  if(!pal) return;
  const filter=q.toLowerCase();
  const matches=SLASH_CMDS.filter(c=>c.cmd.includes(filter)||c.desc.toLowerCase().includes(filter));
  if(!matches.length){_hideSlashPalette();return;}
  pal.innerHTML='';
  matches.forEach((c,i)=>{
    const el=document.createElement('div');
    el.className='slash-cmd-item'+(i===0?' active':'');
    el.innerHTML=`<span class="slash-cmd-icon">${c.icon}</span><span class="slash-cmd-name">${esc(c.cmd)}</span><span class="slash-cmd-args">${esc(c.args)}</span><span class="slash-cmd-desc" style="margin-left:8px">${esc(c.desc)}</span>`;
    el.dataset.idx=i;
    el.onclick=()=>_execSlashItem(matches,i);
    pal.appendChild(el);
  });
  pal.classList.add('visible');
  pal._matches=matches;
}
function _hideSlashPalette(){
  const pal=document.getElementById('slash-palette');
  if(pal){pal.classList.remove('visible');pal.innerHTML='';pal._matches=null;}
}
function _execSlashItem(matches,idx){
  const item=matches[idx];
  if(!item) return;
  const el=document.getElementById('msg-input');
  // Extract args: anything after the command, before clearing the input
  const val=(el&&el.value)||'';
  const spIdx=val.indexOf(' ');
  const args=spIdx>=0?val.slice(spIdx+1).trim():'';
  if(el) el.value='';
  _hideSlashPalette();
  item.run(args);
}
function _execActiveSlash(){
  const pal=document.getElementById('slash-palette');
  if(!pal||!pal._matches) return false;
  const active=pal.querySelector('.slash-cmd-item.active');
  const idx=active?parseInt(active.dataset.idx):0;
  const el=document.getElementById('msg-input');
  // extract args typed after /command
  let args='';
  if(el){
    const val=el.value;
    const spIdx=val.indexOf(' ');
    args=spIdx>=0?val.slice(spIdx+1).trim():'';
    el.value='';
  }
  const item=pal._matches[idx];
  _hideSlashPalette();
  if(item) item.run(args);
  return true;
}

// ── PATCH onMsgInput ─────────────────────────────────────────────────────────
const _scbOrigOnMsgInput2 = typeof onMsgInput === 'function' ? onMsgInput : null;
onMsgInput = function(el){
  try{ _scbOrigOnMsgInput2(el); }catch(e){}
  const val=el.value;
  if(val.startsWith('/')){
    const spIdx=val.indexOf(' ');
    const query=spIdx>=0?val.slice(1,spIdx):val.slice(1);
    _showSlashPalette(query);
  } else {
    _hideSlashPalette();
  }
};

// ── PATCH msgKeydown ──────────────────────────────────────────────────────────
const _scbOrigMsgKeydown = typeof msgKeydown === 'function' ? msgKeydown : null;
msgKeydown = function(e){
  const pal=document.getElementById('slash-palette');
  if(pal&&pal.classList.contains('visible')){
    const items=[...pal.querySelectorAll('.slash-cmd-item')];
    let idx=items.findIndex(i=>i.classList.contains('active'));
    if(e.key==='ArrowDown'){e.preventDefault();idx=(idx+1)%items.length;items.forEach((it,j)=>it.classList.toggle('active',j===idx));return;}
    if(e.key==='ArrowUp'){e.preventDefault();idx=(idx-1+items.length)%items.length;items.forEach((it,j)=>it.classList.toggle('active',j===idx));return;}
    if(e.key==='Tab'||e.key==='Enter'){e.preventDefault();if(_execActiveSlash()) return;}
    if(e.key==='Escape'){e.preventDefault();_hideSlashPalette();return;}
  }
  if(_scbOrigMsgKeydown) _scbOrigMsgKeydown(e);
};

// ── CLOUDY CHAT CONTACT ───────────────────────────────────────────────────────
function _injectCloudyContact(){
  if(!contacts) return;
  // Always replace any stale/incomplete Cloudy entry (e.g. one restored from
  // Firebase prefs that was saved without _isCloudy / avatar:'__cloudy__').
  // Clicking a stale entry would fall through to normal-chat logic and break.
  const idx=contacts.findIndex(c=>c&&String(c.number)===CLOUDY_NUMBER);
  if(idx===-1){
    contacts.unshift(CLOUDY_CONTACT);
  } else if(!contacts[idx]._isCloudy){
    contacts[idx]=CLOUDY_CONTACT;
  }
  // Don't saveStorage — this is a synthetic contact, persisted in memory only
}

function _openCloudy(){
  _injectCloudyContact();
  if(typeof openChat==='function') openChat(CLOUDY_CONTACT);
}

// ── Cloudy memory — a few small persisted facts (name, joke count) so chat
// replies aren't the same fresh bot every time. Client-side only, never sent
// anywhere.
function _cloudyMemGet(){ try{ return JSON.parse(localStorage.getItem('cc_cloudy_memory')||'{}'); }catch{ return {}; } }
function _cloudyMemSet(patch){ try{ const m=Object.assign(_cloudyMemGet(),patch); localStorage.setItem('cc_cloudy_memory',JSON.stringify(m)); return m; }catch{ return patch; } }

// Small safe arithmetic evaluator (+ - * / parens, decimals) — deliberately
// not eval()/Function(), so a chat message can never run arbitrary JS.
function _cloudySafeCalc(expr){
  const clean=expr.replace(/[^0-9+\-*/().\s]/g,'');
  if(!clean.trim()||!/[0-9]/.test(clean)||!/[+\-*/]/.test(clean)) return null;
  let i=0;
  const peek=()=>clean[i];
  const next=()=>clean[i++];
  function skip(){ while(peek()===' ') i++; }
  function parseNum(){ skip(); const s=i; if(peek()==='-') i++; while(/[0-9.]/.test(peek()||'')) i++; if(i===s) return NaN; return parseFloat(clean.slice(s,i)); }
  function parseFactor(){ skip(); if(peek()==='('){ next(); const v=parseExpr(); skip(); if(peek()===')') next(); return v; } return parseNum(); }
  function parseTerm(){ let v=parseFactor(); skip(); while(peek()==='*'||peek()==='/'){ const op=next(); const r=parseFactor(); v=(op==='*')?v*r:v/r; skip(); } return v; }
  function parseExpr(){ let v=parseTerm(); skip(); while(peek()==='+'||peek()==='-'){ const op=next(); const r=parseTerm(); v=(op==='+')?v+r:v-r; skip(); } return v; }
  try{ const result=parseExpr(); skip(); if(i<clean.length||!isFinite(result)||isNaN(result)) return null; return Math.round(result*1e8)/1e8; }catch{ return null; }
}

// Route chat text through the SAME natural-language grammar the voice
// assistant uses (handleCloudyTranscript) — so typing "message Alex saying
// hi", "call Sam", "mute", "dark mode", "remind us in 10 min to stretch",
// "search pizza", "change my bio to ...", etc. in the Cloudy CHAT actually
// does it, instead of Cloudy only being able to talk about it. We swap
// showToast/cloudySpeak out for the duration of the call so the resulting
// confirmation (or "I didn't understand") comes back to us as a value
// instead of firing a toast + speaking it aloud.
// The command grammar in handleCloudyTranscript expects imperative phrasing
// ("open my chat with X"), but chat is more conversational than voice —
// people type "can you open my chat with X?" or "could you please call
// Sam". Strip the wrapping politeness/question shell so the same grammar
// still matches underneath.
function _cloudyStripPoliteness(text){
  let s=text.trim();
  s=s.replace(/^(?:hey |ok |okay |yo )?(?:can|could|would|will) you (?:please )?/i,'');
  s=s.replace(/^(?:please )?/i,'');
  s=s.replace(/^(?:i want you to|i need you to)\s+/i,'');
  s=s.replace(/\?+$/,'');
  return s.trim();
}

// Two overlapping calls used to each save/restore window.showToast independently:
// if call B started while call A's swap was still installed, B's "original" was
// actually A's fake function, and A's restore (firing first, in start order) put
// the REAL showToast back — which B's later restore then overwrote AGAIN with
// A's now-stale fake, permanently breaking window.showToast for the rest of the
// page session (nothing ever pointed it at the real function again). Serialize
// all calls through one queue so only one swap is ever active — the saved
// "original" is always the real function, never another call's fake — and
// forward any showToast a call doesn't recognize as its own captured response
// to the real function instead of silently discarding it.
let _cloudyRouteQueue=Promise.resolve();
function _cloudyTryRouteAction(text){
  const run=()=>new Promise(resolve=>{
    if(typeof handleCloudyTranscript!=='function'){ resolve(null); return; }
    const stripped=_cloudyStripPoliteness(text);
    let captured=null, understood=true, settled=false;
    const realToast=window.showToast, realSpeak=window.cloudySpeak;
    window.showToast=(title,msg)=>{
      if(captured===null){
        captured=(typeof msg==='string'?msg:(msg&&msg.message))||title||'';
        if(/SCB-ASST-06|didn.t understand/i.test(String(captured))) understood=false;
      } else if(realToast){
        realToast(title,msg); // not our own response — don't swallow it
      }
    };
    window.cloudySpeak=()=>{};
    const restore=()=>{ if(!settled){ settled=true; window.showToast=realToast; window.cloudySpeak=realSpeak; } };
    try{ handleCloudyTranscript('cloudy '+stripped); }
    catch(e){ restore(); resolve(null); return; }
    // the matched action (openChat/sendMsg/etc.) is async — give it a beat
    // to run and call showToast before we put the real one back.
    setTimeout(()=>{ restore(); resolve(understood?captured:null); },850);
  });
  const result=_cloudyRouteQueue.then(run);
  _cloudyRouteQueue=result.catch(()=>{});
  return result;
}

// Local knowledge/small-talk layer — used when the command grammar above
// didn't recognize an actionable command. Returns either a plain string or
// {text, chips} to also show quick-reply buttons under the bubble.
function _cloudyChatReply(userText){
  const t=userText.toLowerCase().trim();
  const mem=_cloudyMemGet();

  // remember + use the user's name
  const mIntro=userText.match(/^(?:my name is|i'?m|call me)\s+([a-z][a-z'\-]{1,24})\b/i);
  if(mIntro){
    const name=mIntro[1].replace(/^\w/,c=>c.toUpperCase());
    _cloudyMemSet({name});
    return `Nice to meet you, ${name}! ☁️ I'll remember that. What can I help you with?`;
  }

  // greetings
  if(/^(hi|hello|hey|howdy|yo|sup|hiya|what'?s up|how are you|good morning|good evening|good afternoon)\b/.test(t))
    return _cloudyGreet();

  if(/\bwho are you\b|\bwhat are you\b|\byour name\b|\bwhat'?s your name\b/.test(t))
    return "☁️ I'm Cloudy, your built-in assistant. I can act on natural-language requests (open chats, send messages, start calls, change settings...), do quick math, roll dice, tell jokes, and answer questions about using SoCloudyBro. Ask away!";

  // calculator — "12*7", "what's 45 + 12", "(3+4)*2"
  if(/[0-9].*[+\-*/].*[0-9]/.test(userText) || /^\s*[0-9.]+\s*[+\-*/]\s*[0-9.]/.test(userText)){
    const calcExpr=userText.replace(/^(?:what'?s|what is|calculate|compute)\s+/i,'').replace(/\s*=\s*\??$/,'').replace(/\?$/,'');
    const result=_cloudySafeCalc(calcExpr);
    if(result!==null) return `🧮 ${calcExpr.trim()} = **${result}**`;
  }

  // dice / coin
  if(/\bflip a coin\b|\bcoin flip\b/.test(t)) return '🪙 '+(Math.random()<0.5?'Heads!':'Tails!');
  const mDice=t.match(/\broll(?: a| an)? (?:d(\d+)|(\d+)\s*sided)\b/) || (/\broll (?:a |the )?dice\b/.test(t)?['','6']:null);
  if(mDice || /\broll (?:a |the )?dice\b|\broll a die\b/.test(t)){
    const sides=parseInt((mDice&&(mDice[1]||mDice[2]))||'6',10)||6;
    return `🎲 You rolled a **${1+Math.floor(Math.random()*sides)}** (d${sides}).`;
  }

  // jokes
  if(/\bjoke\b/.test(t)){
    const jokes=["Why don't scientists trust atoms? Because they make up everything!","I told my computer I needed a break. Now it won't stop sending me Kit-Kat ads.","Why do programmers prefer dark mode? Because light attracts bugs!","I asked my dog what 2 minus 2 is. He said nothing.","Why did the developer go broke? Because they used up all their cache.","I would tell you a UDP joke, but you might not get it."];
    const n=(mem.jokeCount||0)+1; _cloudyMemSet({jokeCount:n});
    return '😄 '+jokes[(n-1)%jokes.length];
  }
  // fun fact
  if(/\bfun fact\b|\btell me a fact\b/.test(t)){
    const facts=["A group of flamingos is called a 'flamboyance'.","Octopuses have three hearts.","Honey never spoils — archaeologists have found edible honey in ancient Egyptian tombs.","Bananas are berries, but strawberries aren't.","The first computer 'bug' was an actual moth found in a relay in 1947."];
    return '💡 '+facts[Math.floor(Math.random()*facts.length)];
  }

  // time / date (the command grammar handles the exact phrasings; this
  // covers looser ones like "current time" or "what's today")
  if(/\btime\b/.test(t)) return `🕐 It's ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}.`;
  if(/\bdate\b|\btoday\b/.test(t)) return `📅 Today is ${new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}.`;

  // weather (stub — no live weather API wired up)
  if(/\bweather\b/.test(t)) return "🌤️ I can't fetch live weather yet, but I can open a chat, call, or message someone if that's what you're really after.";

  // thanks / bye
  if(/^(thanks|thank you|thx|ty)\b/.test(t)) return mem.name?`Anytime, ${mem.name}! ☁️`:'Anytime! ☁️';
  if(/^(bye|goodbye|see ya|later)\b/.test(t)) return '👋 Talk soon!';

  // help
  if(/\bhelp\b|\bwhat can you do\b|\bcommands\b/.test(t)){
    return {text:"Plain English works, not just commands:\n• \"message Alex saying I'm running late\"\n• \"call Sam\" / \"mute\" / \"hang up\"\n• \"open the group Weekend Trip\"\n• \"remind us in 10 minutes to stretch\"\n• \"dark mode\" / \"change my bio to ...\"\n• \"search pizza\"\n• quick math like \"12*7+5\", \"roll a dice\", \"flip a coin\"\n• or slash shortcuts like /call, /remind, /poll, /gif",
      chips:['📞 Call someone','✉️ Send a message','⏰ Set a reminder','🔎 Search']};
  }

  // fallback — contextual + name-aware, never the exact same line twice in a row
  const fallbacks=[
    "Not sure what you meant — try \"message Jamie saying hi\" or \"call Sam\".",
    "You can also use slash commands like /call, /remind, or /poll.",
    "Type 'help' to see what I can do.",
  ];
  const pick=fallbacks[Math.floor(Math.random()*fallbacks.length)];
  return mem.name?`${mem.name}, ${pick.charAt(0).toLowerCase()+pick.slice(1)}`:pick;
}

function _cloudyGreet(){
  const h=new Date().getHours();
  const tod=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  const mem=_cloudyMemGet();
  const who=mem.name?`, ${mem.name}`:'';
  return `${tod}${who}! ☁️ Message or call someone, open a chat, set a reminder, switch themes, or do quick math — what do you need?`;
}

async function _sendToCloudyChat(text){
  if(!text||!text.trim()) return;
  let store=JSON.parse(localStorage.getItem('cc_cloudy_msgs')||'[]');
  store.push({id:Date.now().toString(36)+'u',from:me&&me.number||'me',time:Date.now(),text:text,side:'out'});
  if(store.length>200) store=store.slice(-200);
  localStorage.setItem('cc_cloudy_msgs',JSON.stringify(store));
  const onCloudy=activeConvo&&activeConvo._isCloudy;
  if(onCloudy){ _renderCloudyChat(); _cloudyShowTyping(); }

  // Try the real command grammar first (open/send/call/mute/theme/etc.) —
  // only fall back to small talk if nothing actionable was recognized.
  const routed=await _cloudyTryRouteAction(text);
  const reply=routed || _cloudyChatReply(text);
  const extra=280+Math.random()*420;
  setTimeout(()=>{ _cloudyHideTyping(); _cloudyDeliverMsg(reply); }, extra);
}

function _cloudyShowTyping(){
  const feed=document.getElementById('messages-wrap');
  if(!feed||document.getElementById('cloudy-typing-row')) return;
  const row=document.createElement('div');
  row.id='cloudy-typing-row';
  row.style.cssText='display:flex;justify-content:flex-start;margin:2px 12px;';
  row.innerHTML='<div style="background:var(--bg3);border-radius:14px;border-bottom-left-radius:3px;padding:10px 14px;display:flex;gap:4px;align-items:center"><span class="cloudy-typing-dot"></span><span class="cloudy-typing-dot"></span><span class="cloudy-typing-dot"></span></div>';
  feed.appendChild(row);
  requestAnimationFrame(()=>{ feed.scrollTop=feed.scrollHeight; });
}
function _cloudyHideTyping(){
  document.getElementById('cloudy-typing-row')?.remove();
}

function _renderCloudyChat(){
  const feed=document.getElementById('messages-wrap');
  if(!feed) return;
  feed.innerHTML='';
  const store=JSON.parse(localStorage.getItem('cc_cloudy_msgs')||'[]');
  store.forEach(msg=>{
    const isOut=msg.side==='out'||(me&&msg.from===me.number);
    const row=document.createElement('div');
    row.className='msg-row '+(isOut?'msg-out':'msg-in');
    row.style.cssText='display:flex;flex-direction:column;'+(isOut?'align-items:flex-end':'align-items:flex-start')+';margin:2px 12px;';
    const bubbleRow=document.createElement('div');
    bubbleRow.style.cssText='display:flex;'+(isOut?'justify-content:flex-end':'justify-content:flex-start')+';width:100%;';
    const bubble=document.createElement('div');
    bubble.className='msg-bubble';
    bubble.style.cssText='max-width:72%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.45;word-break:break-word;'+(isOut?'background:var(--accent);color:#fff;border-bottom-right-radius:3px':'background:var(--bg3);color:var(--text);border-bottom-left-radius:3px');
    bubble.innerHTML=(typeof esc==='function'?esc(msg.text):msg.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
    bubbleRow.appendChild(bubble);
    row.appendChild(bubbleRow);
    if(!isOut&&Array.isArray(msg.chips)&&msg.chips.length){
      const chipsRow=document.createElement('div');
      chipsRow.style.cssText='display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;max-width:90%';
      msg.chips.forEach(chipText=>{
        const chip=document.createElement('span');
        chip.className='cloudy-chip';
        chip.textContent=chipText;
        chip.onclick=()=>{ const label=chipText.replace(/^\S+\s/,''); _sendToCloudyChat(label); };
        chipsRow.appendChild(chip);
      });
      row.appendChild(chipsRow);
    }
    feed.appendChild(row);
  });
  requestAnimationFrame(()=>{ feed.scrollTop=feed.scrollHeight; });
}

// Override sendMsg for Cloudy convo
(function(){
  const _origSend=sendMsg;
  // This used to be a plain (non-async) function that called _origSend()
  // without returning its promise — every `await sendMsg()` caller (Cloudy's
  // voice-driven send/reminder flows included) resolved almost immediately,
  // well before the real async work (spam check, encryption, push, debounced
  // save) had actually run, so code that assumed "the message is sent" right
  // after the await was racing the real send.
  sendMsg=async function(){
    if(activeConvo&&activeConvo._isCloudy){
      const el=document.getElementById('msg-input');
      if(!el) return;
      const text=el.value.trim();
      if(!text) return;
      el.value='';
      if(typeof autoResize==='function') autoResize(el);
      return _sendToCloudyChat(text);
    }
    return _origSend.apply(this,arguments);
  };
})();

// Deliver a bot message into Cloudy chat (used for welcome + responses).
// `reply` can be a plain string, or {text, chips:[...]} to also render
// quick-reply buttons (e.g. the welcome message, or the help reply).
function _cloudyDeliverMsg(reply, chips){
  const text=(reply&&typeof reply==='object')?reply.text:reply;
  const chipList=(reply&&typeof reply==='object'&&Array.isArray(reply.chips))?reply.chips:chips;
  if(!text) return;
  let store=JSON.parse(localStorage.getItem('cc_cloudy_msgs')||'[]');
  const msg={id:(Date.now()+1).toString(36)+'b',from:CLOUDY_NUMBER,time:Date.now(),text:text,side:'in'};
  if(Array.isArray(chipList)&&chipList.length) msg.chips=chipList;
  store.push(msg);
  if(store.length>200) store=store.slice(-200);
  localStorage.setItem('cc_cloudy_msgs',JSON.stringify(store));
  if(activeConvo&&activeConvo._isCloudy) _renderCloudyChat();
}

// Inject Cloudy into sidebar after login and re-render so it appears immediately
document.addEventListener('scb:loggedin',()=>{
  setTimeout(()=>{ _injectCloudyContact(); if(typeof renderSidebar==='function') renderSidebar(); }, 500);
});
// Also try immediately (for already-loaded sessions)
if(typeof me!=='undefined'&&me&&me.number){
  setTimeout(()=>{ _injectCloudyContact(); if(typeof renderSidebar==='function') renderSidebar(); }, 800);
}
// And whenever renderSidebar is called, make sure Cloudy stays there
const _origRenderSidebar=typeof renderSidebar==='function'?renderSidebar:null;
if(_origRenderSidebar){
  renderSidebar=function(){
    _injectCloudyContact();
    _origRenderSidebar();
  };
}

// Expose Cloudy helpers as globals — openChat patch at ~line 11931 calls them
window._renderCloudyChat = _renderCloudyChat;
window._cloudyDeliverMsg = _cloudyDeliverMsg;
window._sendToCloudyChat = _sendToCloudyChat;

})(); // end slash+cloudy block
