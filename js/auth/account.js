// -- MUTE NOTIFICATIONS --------------------------------------------------------
// One choice per chat: 'all' (nothing stored), 'mentions', or 'muted' (off).
// Older entries stored `true` for muted.
function notifLevel(key){
  const v=mutedChats[key];
  return !v ? 'all' : v==='mentions' ? 'mentions' : 'muted';
}
function setNotifLevel(key,level){
  if(level==='all') delete mutedChats[key];
  else mutedChats[key]=level;
  saveStorage();
  showToast('Notifications', level==='all' ? 'You\'ll be notified about every message here.'
    : level==='mentions' ? 'You\'ll only be notified when you\'re mentioned.'
    : 'Notifications are off for this chat.');
}
// Draws the All / Mentions / Off control. Mentions only makes sense in groups.
function renderNotifChoice(box,convo){
  if(!box||!convo) return;
  const key=convo.key||dmKey(me.number,convo.number);
  const current=notifLevel(key);
  const options=[['all','All'],['mentions','Mentions'],['muted','Off']]
    .filter(o=>o[0]!=='mentions'||convo.type==='group'||current==='mentions');
  box.innerHTML='<span class="notif-label">Notifications</span><span class="notif-options"></span>';
  options.forEach(([level,label])=>{
    const b=document.createElement('button');
    b.type='button'; b.textContent=label;
    b.setAttribute('aria-pressed',level===current?'true':'false');
    b.onclick=(e)=>{ e.stopPropagation(); setNotifLevel(key,level); renderNotifChoice(box,convo); };
    box.lastChild.appendChild(b);
  });
}
// -- CHAT LOCK -----------------------------------------------------------------
// Tracks which chat a pending PIN unlock applies to. Set explicitly
// by every entry point into openChatLockOverlay() rather than assumed to be
// activeConvo — opening a locked chat from the sidebar must NOT point
// activeConvo at it until it's actually unlocked (see _origOpenChat), or a
// cancelled/abandoned unlock leaves activeConvo silently pointed at the
// locked chat while the screen still shows whatever was open before, and the
// next message you send goes into the locked chat instead.
let _chatLockTarget=null;
function lockChatToggle(){
  if(!activeConvo) return;
  const key=activeConvo.key;
  if(!localStorage.getItem('cc_pin')){showToast('Set up a PIN first',scbErr('SCB-SEC-19','Go to Settings → Security to set a PIN.'));return;}
  if(lockedChats[key]){
    // unlock flow — this chat is already the active/rendered one
    _chatLockTarget=activeConvo;
    openChatLockOverlay();
  }else{
    lockedChats[key]=true;saveStorage();
    document.getElementById('lock-chat-btn').innerHTML="<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"11\" width=\"18\" height=\"11\" rx=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 10 0v4\"/></svg>";
    showToast('Chat locked','This chat is now protected — unlock with your PIN.');
  }
}
function checkChatLockPin(pin,inputs){
  const stored=localStorage.getItem('cc_pin');
  if(hashPin(pin)===stored){
    const target=_chatLockTarget;
    if(target){
      delete lockedChats[target.key];saveStorage();
      const btn=document.getElementById('lock-chat-btn');
      if(btn) btn.innerHTML="<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"11\" width=\"18\" height=\"11\" rx=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 9.9-1\"/></svg>";
    }
    _chatLockTarget=null;
    closeChatLockOverlay();clearPinInputs(inputs);
    showToast('Chat unlocked','');
    // The overlay may have been opened from the sidebar, before the chat was
    // actually rendered (activeConvo is never pointed at a locked chat until
    // it's unlocked — see _origOpenChat) — open it now that it's unlocked.
    // Harmless no-op re-open if this chat was already the active one.
    if(target) openChat(target);
  }else{
    document.getElementById('chat-lock-error').textContent=scbErr('SCB-SEC-20','Incorrect PIN.');
    clearPinInputs(inputs);
  }
}

// The PIN is checked live: if it has been removed since the chat was locked,
// say so instead of showing a keypad nothing can satisfy.
function openChatLockOverlay(){
  const hasPin=!!localStorage.getItem('cc_pin');
  document.getElementById('chat-lock-pin-pane').style.display=hasPin?'block':'none';
  document.getElementById('chat-lock-error').textContent=hasPin?'':scbErr('SCB-SEC-24','This chat was locked with a PIN that\'s no longer set up. Set one up again in Settings → Security to unlock it.');
  clearPinInputs(document.querySelectorAll('#chat-lock-pin-pane .pin-digit'));
  openModal('chat-lock-overlay');
}
function closeChatLockOverlay(){
  _chatLockTarget=null;
  closeModal('chat-lock-overlay');
}
// -- AVATAR --------------------------------------------------------------------
const PRESET_AVATARS=[
  // Gradient letter avatars
  {type:'gradient',bg:'linear-gradient(135deg,#0078d4,#6264a0)',label:'🔵'},
  {type:'gradient',bg:'linear-gradient(135deg,#ca5010,#fbbf24)',label:'🟠'},
  {type:'gradient',bg:'linear-gradient(135deg,#13a10e,#00b4d8)',label:'🟢'},
  {type:'gradient',bg:'linear-gradient(135deg,#d13438,#a78bfa)',label:'🔴'},
  {type:'gradient',bg:'linear-gradient(135deg,#6264a0,#00b4d8)',label:'🟣'},
  {type:'gradient',bg:'linear-gradient(135deg,#e91e63,#ff9800)',label:'🌸'},
  {type:'gradient',bg:'linear-gradient(135deg,#009688,#4caf50)',label:'🌿'},
  {type:'gradient',bg:'linear-gradient(135deg,#ff5722,#ff9800)',label:'🔶'},
  // Animals
  {type:'emoji',emoji:'🦊'},{type:'emoji',emoji:'🐼'},{type:'emoji',emoji:'🦁'},
  {type:'emoji',emoji:'🐧'},{type:'emoji',emoji:'🦋'},{type:'emoji',emoji:'🐉'},
  {type:'emoji',emoji:'🐶'},{type:'emoji',emoji:'🐱'},{type:'emoji',emoji:'🐻'},
  {type:'emoji',emoji:'🦄'},{type:'emoji',emoji:'🦅'},{type:'emoji',emoji:'🦋'},
  {type:'emoji',emoji:'🐙'},{type:'emoji',emoji:'🦈'},{type:'emoji',emoji:'🐺'},
  {type:'emoji',emoji:'🦊'},{type:'emoji',emoji:'🐢'},{type:'emoji',emoji:'🦜'},
  {type:'emoji',emoji:'🐸'},{type:'emoji',emoji:'🦁'},{type:'emoji',emoji:'🐯'},
  // Space & tech
  {type:'emoji',emoji:'🤖'},{type:'emoji',emoji:'👾'},{type:'emoji',emoji:'🎃'},
  {type:'emoji',emoji:'🚀'},{type:'emoji',emoji:'🛸'},{type:'emoji',emoji:'🌍'},
  {type:'emoji',emoji:'🌙'},{type:'emoji',emoji:'☀️'},{type:'emoji',emoji:'⭐'},
  {type:'emoji',emoji:'🔭'},{type:'emoji',emoji:'💫'},{type:'emoji',emoji:'🌌'},
  // Fire & energy
  {type:'emoji',emoji:'🔥'},{type:'emoji',emoji:'⚡'},{type:'emoji',emoji:'🌟'},
  {type:'emoji',emoji:'💥'},{type:'emoji',emoji:'🌈'},{type:'emoji',emoji:'❄️'},
  // Fun & activities
  {type:'emoji',emoji:'🎮'},{type:'emoji',emoji:'🎵'},{type:'emoji',emoji:'🎨'},
  {type:'emoji',emoji:'🏆'},{type:'emoji',emoji:'⚽'},{type:'emoji',emoji:'🎸'},
  {type:'emoji',emoji:'🎯'},{type:'emoji',emoji:'🎲'},{type:'emoji',emoji:'🎭'},
  {type:'emoji',emoji:'🎬'},{type:'emoji',emoji:'🎤'},{type:'emoji',emoji:'🎧'},
  // Food & nature
  {type:'emoji',emoji:'🌸'},{type:'emoji',emoji:'🌺'},{type:'emoji',emoji:'🌻'},
  {type:'emoji',emoji:'🌴'},{type:'emoji',emoji:'🍀'},{type:'emoji',emoji:'🍁'},
  {type:'emoji',emoji:'🍕'},{type:'emoji',emoji:'🍦'},{type:'emoji',emoji:'🌮'},
  // Faces & people
  {type:'emoji',emoji:'😎'},{type:'emoji',emoji:'🥷'},{type:'emoji',emoji:'🧙'},
  {type:'emoji',emoji:'🧜'},{type:'emoji',emoji:'🦸'},{type:'emoji',emoji:'🤡'},
  {type:'emoji',emoji:'👻'},{type:'emoji',emoji:'💀'},{type:'emoji',emoji:'🤠'},
  // Objects & symbols
  {type:'emoji',emoji:'💎'},{type:'emoji',emoji:'👑'},{type:'emoji',emoji:'🔮'},
  {type:'emoji',emoji:'⚔️'},{type:'emoji',emoji:'🛡️'},{type:'emoji',emoji:'🗡️'},
  {type:'emoji',emoji:'🔑'},{type:'emoji',emoji:'💣'},{type:'emoji',emoji:'🧲'},
];
function openGroupAvatarEdit(){
  avatarTarget = 'group-edit';
  document.getElementById('avatar-modal-title').textContent = 'Change Group Icon';
  const presets = document.getElementById('avatar-presets');
  presets.innerHTML = '';
  PRESET_AVATARS.forEach((p, i) => {
    const div = document.createElement('div'); div.className = 'preset-av';
    if (p.type === 'gradient') { div.style.background = p.bg; div.textContent = p.label; }
    else { div.textContent = p.emoji; div.style.background = 'var(--surface2)'; div.style.fontSize = '26px'; }
    div.onclick = () => selectPresetAvatar(p, i);
    presets.appendChild(div);
  });
  openModal('avatar-modal');
}
function openAvatarEditor(forSetup=false,forGroup=false){
  avatarTarget = forSetup ? 'setup' : forGroup ? 'group' : 'profile';
  
  // Update Title dynamically
  document.getElementById('avatar-modal-title').textContent = forGroup ? 'Choose Group Icon' : 'Choose Avatar';
  
  const presets=document.getElementById('avatar-presets');
  presets.innerHTML='';
  PRESET_AVATARS.forEach((p,i)=>{
    const div=document.createElement('div');div.className='preset-av';
    if(p.type==='gradient'){div.style.background=p.bg;div.textContent=p.label;}
    else{div.textContent=p.emoji;div.style.background='var(--surface2)';div.style.fontSize='26px';}
    div.onclick=()=>selectPresetAvatar(p,i);
    presets.appendChild(div);
  });
  openModal('avatar-modal');
}
function avatarToDataUrl(p,name='?'){
  const c=document.createElement('canvas');c.width=80;c.height=80;
  const ctx=c.getContext('2d');
  if(p.type==='gradient'){
    const g=ctx.createLinearGradient(0,0,80,80);
    const parts=p.bg.match(/#[0-9a-f]{6}/gi);
    if(parts&&parts.length>=2){g.addColorStop(0,parts[0]);g.addColorStop(1,parts[1]);}
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(40,40,40,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='bold 32px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText((name||'?').charAt(0).toUpperCase(),40,42);
  }else{
    ctx.fillStyle='#23272e';ctx.beginPath();ctx.arc(40,40,40,0,Math.PI*2);ctx.fill();
    ctx.font='40px serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(p.emoji,40,44);
  }
  return c.toDataURL('image/png');
}
function selectPresetAvatar(p,i){
  const name=(avatarTarget==='group')?(document.getElementById('grp-name').value||'G'):(avatarTarget==='group-edit')?(activeConvo?activeConvo.name||'G':'G'):(me?me.name:'?');
  const url=avatarToDataUrl(p,name);
  applyAvatar(url);
  document.querySelectorAll('.preset-av').forEach((el,j)=>el.classList.toggle('selected',j===i));
}
function uploadAvatar(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const size=160;
      const c=document.createElement('canvas');c.width=size;c.height=size;
      const ctx=c.getContext('2d');
      const scale=Math.max(size/img.width,size/img.height);
      const w=img.width*scale,h=img.height*scale;
      ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h);
      applyAvatar(c.toDataURL('image/jpeg',0.72));
      closeModal('avatar-modal');
    };
    img.onerror=()=>{applyAvatar(e.target.result);closeModal('avatar-modal');};
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}
function applyAvatar(url){
  if(avatarTarget==='setup'){tempSetupAvatar=url;setAvatarEl('setup-av-preview',url);}
  else if(avatarTarget==='group'){tempGroupAvatar=url;setAvatarEl('grp-av-preview',url);}
  else if(avatarTarget==='group-edit'){
    if(!activeConvo) return;
    // Update the in-memory conv and contact records, then persist
    if(convosCache){const conv=convosCache.find(x=>x&&x.key===activeConvo.key);if(conv){conv.avatar=url;saveConvos();}}
    activeConvo.avatar=url;
    const ci=contacts.find(c=>c&&c.key===activeConvo.key);
    if(ci){ci.avatar=url;saveStorage();}
    // Refresh group panel avatar and chat header
    const gpAv=document.getElementById('gp-avatar');
    if(gpAv){gpAv.innerHTML=`<img src="${esc(url)}" style="width:100%;height:100%;object-fit:cover;border-radius:14px"/>`;gpAv.style.background='';}
    const haEl=document.getElementById('chat-header-avatar');
    if(haEl&&haEl.style){haEl.innerHTML=`<img src="${esc(url)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"/>`;haEl.style.background='';}
    renderSidebar();
    showToast('Group icon updated','');
  }
  else{
    if(me){me.avatar=url;saveStorage();renderMyCard();updateSettingsPanel();registerOrUpdate();}
  }
  closeModal('avatar-modal');
}
function setAvatarEl(id,url){
  const el=document.getElementById(id);if(!el)return;
  const safeSrcUrl=(typeof url==='string'&&url.startsWith('data:image/'))?url:'';
  if(safeSrcUrl){el.innerHTML=`<img src="${esc(safeSrcUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;el.style.background='';}
  else{el.textContent=url;el.style.background='var(--surface2)';}
}
function renderAvatar(el,user,size=38){
  if(!el)return;
  el.style.width=size+'px';el.style.height=size+'px';el.style.fontSize=(size*0.38)+'px';
  const letter=(user&&dec(user.name)||'?').charAt(0).toUpperCase();
  const _av=user&&typeof user.avatar==='string'?user.avatar:'';
  const safeSrc=(_av.startsWith('data:image/')||_av.startsWith('https://'))?_av:'';
  if(safeSrc){
    el.innerHTML=`<img src="${esc(safeSrc)}" data-letter="${esc(letter)}" onerror="avatarFallback(this,this.dataset.letter)" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    el.style.background='';
  }else{
    el.innerHTML='';el.textContent=letter;
    el.style.background='linear-gradient(135deg,#0078d4,#6264a0)';el.style.color='#fff';
  }
}
// Falls back to an initial-letter badge if a stored avatar image fails to load
// (e.g. a corrupted or truncated data: URI from the remote store).
function avatarFallback(img,letter){
  const el=img&&img.parentElement;
  if(!el) return;
  el.innerHTML='';
  el.textContent=letter||'?';
  el.style.background='linear-gradient(135deg,#0078d4,#6264a0)';
  el.style.color='#fff';
}

// -- AGE GATE / DEVICE BLACKLIST ------------------------------------------------
const MIN_SIGNUP_AGE = 13;
const PARENTAL_CONSENT_MAX_AGE = 17; // ages MIN_SIGNUP_AGE..this require an
// approving parent/guardian account before the app unlocks. 18+ signs up
// normally with no consent gate.
function checkSetupAgeForParentField(){
  const bd=document.getElementById('setup-birthdate').value;
  const field=document.getElementById('setup-parent-email-field');
  if(!bd){ field.style.display='none'; return; }
  const age=calcAge(bd);
  field.style.display=(age!==null&&age<=PARENTAL_CONSENT_MAX_AGE&&age>=MIN_SIGNUP_AGE)?'block':'none';
}

// -- PARENTAL CONSENT ------------------------------------------------------
// A minor's account is created with parentalConsentStatus:'pending' and never
// reaches the normal app until a parent approves it. There's no backend here
// to actually email the parent a notification — the mechanism instead waits
// for the parent to independently show up (sign up or log in) using the same
// email the minor provided, at which point checkPendingChildApprovals below
// surfaces the request to them. Honest about the tradeoff: this only works if
// the parent proactively visits the app; it can't push them a notification.
function showEmailVerifyGate(){
  const gate=document.getElementById('email-verify-gate');
  if(!gate) return;
  document.getElementById('email-verify-error').textContent='';
  gate.style.display='flex';
  const shell=document.getElementById('shell'); if(shell) shell.style.display='none';
  const splash=document.getElementById('scb-splash'); if(splash) splash.remove();
  resetEmailOtpStep();
  const addrEl=document.getElementById('email-otp-address');
  if(addrEl && me && me.email) addrEl.value=me.email;
  initEmailVerifyGoogleButton();
}
// -- EMAIL OTP (verification gate) ------------------------------------------
// `_emailOtpChallenge` holds the signed, stateless token the Worker handed
// back from /send-otp — it carries the code's hash + expiry, never the code
// itself, and is only meaningful to the Worker (see its own comment block).
let _emailOtpChallenge=null;
function resetEmailOtpStep(){
  _emailOtpChallenge=null;
  const stepEmail=document.getElementById('email-otp-step-email');
  const stepCode=document.getElementById('email-otp-step-code');
  if(stepEmail) stepEmail.style.display='block';
  if(stepCode) stepCode.style.display='none';
  const codeEl=document.getElementById('email-otp-code'); if(codeEl) codeEl.value='';
  const note=document.getElementById('email-otp-note'); if(note) note.textContent='';
  const err=document.getElementById('email-verify-error'); if(err) err.textContent='';
}
async function sendEmailOtp(){
  const addrEl=document.getElementById('email-otp-address');
  const email=(addrEl?addrEl.value:'').trim().toLowerCase();
  const err=document.getElementById('email-verify-error');
  const note=document.getElementById('email-otp-note');
  err.textContent='';note.textContent='';
  if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){err.textContent='Enter a valid email address.';return;}
  const btn=document.getElementById('email-otp-send-btn');
  btn.disabled=true;const origLabel=btn.textContent;btn.innerHTML='<span class="spinner"></span>';
  try{
    const res=await fetch(SEND_OTP_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
    const data=await res.json().catch(()=>null);
    if(!res.ok||!data||!data.challenge){
      err.textContent=(data&&data.error)?data.error:'Couldn\'t send the code. Try again in a moment.';
      return;
    }
    _emailOtpChallenge=data.challenge;
    document.getElementById('email-otp-sent-to').textContent=email;
    document.getElementById('email-otp-step-email').style.display='none';
    document.getElementById('email-otp-step-code').style.display='block';
    document.getElementById('email-otp-code').focus();
  }catch(e){
    err.textContent='Couldn\'t reach the server. Check your connection and try again.';
  }finally{
    btn.disabled=false;btn.textContent=origLabel;
  }
}
async function verifyEmailOtp(){
  const codeEl=document.getElementById('email-otp-code');
  const code=(codeEl?codeEl.value:'').trim();
  const err=document.getElementById('email-verify-error');
  err.textContent='';
  if(!_emailOtpChallenge){err.textContent='Request a new code first.';return;}
  if(!/^\d{6}$/.test(code)){err.textContent='Enter the 6-digit code.';return;}
  const btn=document.getElementById('email-otp-verify-btn');
  btn.disabled=true;const origLabel=btn.textContent;btn.innerHTML='<span class="spinner"></span>';
  try{
    const res=await fetch(VERIFY_OTP_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge:_emailOtpChallenge,code})});
    const data=await res.json().catch(()=>null);
    if(!res.ok||!data||!data.ok){
      err.textContent=(data&&data.error)?data.error:'That code didn\'t match. Try again.';
      return;
    }
    // Verified server-side — the Worker independently confirmed the code
    // matches what it emailed to this address, same trust boundary as the
    // Google-link path (which also only trusts the Worker's own check).
    await _markEmailVerified(data.email);
  }catch(e){
    err.textContent='Couldn\'t reach the server. Check your connection and try again.';
  }finally{
    btn.disabled=false;btn.textContent=origLabel;
  }
}
async function _markEmailVerified(verifiedEmail){
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===me.number);
    if(u){
      u.emailVerified=true;
      if(verifiedEmail && !u.email) u.email=verifiedEmail;
      await saveUsers(users);
    }
    me.emailVerified=true; saveStorage();
    location.reload();
  }catch(e){
    document.getElementById('email-verify-error').textContent=scbErr('SCB-SEC-23','Your verification status couldn\'t be saved.',(e.message||'Try again in a moment.'));
  }
}
function hideEmailVerifyGate(){
  const gate=document.getElementById('email-verify-gate');
  if(gate) gate.style.display='none';
  const shell=document.getElementById('shell'); if(shell) shell.style.display='';
}
// A standalone Google-button initializer for the gate screen — mirrors
// initGoogleSignIn()'s own logic (same configured/origin/loaded checks) but
// targets the gate's own holder/fallback/note ids instead of the fixed
// login-screen pair initGoogleSignIn() is hardcoded to.
function initEmailVerifyGoogleButton(){
  const holder='google-btn-emailverify', fallbackId='email-verify-fallback', noteId='email-verify-note';
  const h=document.getElementById(holder), fb=document.getElementById(fallbackId), note=document.getElementById(noteId);
  function showNote(text){
    if(h){ h.innerHTML=''; h.style.display='none'; }
    if(fb) fb.style.display='inline-flex';
    if(note){ note.textContent=text; note.style.display='block'; }
  }
  if(!googleSignInConfigured()){
    showNote('Google sign-in isn\'t set up on this site yet — contact the admin to get your account verified another way.');
    return;
  }
  const _origin=location.origin;
  const _knownOrigins=['http://localhost','https://socloudybro','https://cubeleap'];
  const _originOk=_knownOrigins.some(o=>_origin.startsWith(o))||_origin.startsWith('file://');
  if(!_originOk){
    showNote('Google sign-in is disabled on this URL. Contact the admin.');
    return;
  }
  whenGoogleIdentityReady(ready=>{
    if(!ready){ showNote('Google sign-in couldn\'t load — check your connection and reload the page.'); return; }
    if(h) h.style.display='flex';
    if(fb) fb.style.display='none';
    if(note) note.style.display='none';
    if(!renderGoogleButton(holder)) showNote('Google sign-in couldn\'t start on this device. Reload and try again.');
  });
}
async function checkEmailVerifyStatus(){
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===me.number);
    if(u&&u.emailVerified){
      me.emailVerified=true; saveStorage();
      location.reload();
    } else {
      showToast('Not verified yet','Your email isn\'t confirmed yet — send and enter the code above (or use Google) to verify.');
    }
  }catch(e){ showToast('Couldn\'t check',scbErr('SCB-SEC-23','Your verification status couldn\'t be checked.',(e.message||'Try again in a moment.'))); }
}
function showParentalPendingScreen(){
  const denied=me.parentalConsentStatus==='denied';
  document.getElementById('parental-pending-email').textContent=me.parentEmail||'';
  const screen=document.getElementById('parental-pending-screen');
  document.getElementById('parental-pending-title').textContent=denied?'Account not approved':'Waiting for parent approval';
  document.getElementById('parental-pending-body').style.display=denied?'none':'block';
  document.getElementById('parental-denied-body').style.display=denied?'block':'none';
  screen.style.display='flex';
  document.getElementById('shell').style.display='none';
}
async function checkParentalConsentStatus(){
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===me.number);
    if(u&&u.parentalConsentStatus==='approved'){
      me.parentalConsentStatus='approved';
      saveStorage();
      // launch() already set `launched=true` the first time it hit this
      // gate (before returning early), so calling launch() again here would
      // just hit its own `if(launched){hideLockScreen();return;}` guard and
      // do nothing — leaving an empty shell with no contacts/messages/
      // polling. Reload instead, the same fix already applied to the
      // analogous email-verify-gate case in linkGoogleToCurrentAccount().
      location.reload();
    }else{
      showToast('Still pending','Your parent/guardian hasn\'t approved this account yet.');
    }
  }catch(e){ showToast('Couldn\'t check',scbErr('SCB-FAM-01','Your account\'s approval status couldn\'t be checked.',(e.message||'Try again in a moment.'))); }
}
async function checkPendingChildApprovals(){
  if(!me||!me.email) return;
  try{
    const users=await getUsers();
    const pending=users.filter(u=>u.number!==me.number&&(u.parentEmail||'').toLowerCase()===me.email.toLowerCase()&&u.parentalConsentStatus==='pending');
    if(!pending.length) return;
    const list=document.getElementById('parental-approval-list');
    list.innerHTML='';
    pending.forEach(u=>{
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)';
      row.innerHTML=`<div><div style="font-weight:600">${esc(dec(u.name))}</div><div style="font-size:12px;color:var(--muted)">#${esc(String(u.number))} · born ${esc(u.birthdate||'unknown')}</div></div>`;
      const btns=document.createElement('div');
      btns.style.cssText='display:flex;gap:6px;flex-shrink:0';
      const approveBtn=document.createElement('button');
      approveBtn.className='btn btn-sm';approveBtn.textContent='Approve';
      approveBtn.onclick=()=>approveChildAccount(u.number);
      const denyBtn=document.createElement('button');
      denyBtn.className='btn btn-danger btn-sm';denyBtn.textContent='Deny';
      denyBtn.onclick=()=>denyChildAccount(u.number);
      btns.appendChild(approveBtn);btns.appendChild(denyBtn);
      row.appendChild(btns);
      list.appendChild(row);
    });
    openModal('parental-approval-modal');
  }catch(e){ console.error('checkPendingChildApprovals failed:',e); }
}
async function approveChildAccount(childNumber){
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===childNumber);
    if(!u){ showToast('Not found',scbErr('SCB-FAM-02','That account no longer exists.')); return; }
    if(!me||!me.email||(u.parentEmail||'').toLowerCase()!==me.email.toLowerCase()){ showToast('Not allowed',scbErr('SCB-FAM-02','You are not the registered parent for that account.')); return; }
    // Narrow writes to exactly the two fields the Firebase rule authorizes a
    // matching parent (by email claim) to touch on a CHILD's own record —
    // see users/$uid/parentalConsentStatus's rule. A whole-table saveUsers()
    // here would be rejected: the parent's own auth.token.number never
    // equals the child's $uid, so none of the normal self/admin branches
    // apply to this cross-account write.
    await fbdb.ref('users/'+childNumber+'/parentNumber').set(me.number);
    await fbdb.ref('users/'+childNumber+'/parentalConsentStatus').set('approved');
    showToast('Approved',`${dec(u.name)} can now use SoCloudyBro.`);
    await checkPendingChildApprovals();
    if(!document.getElementById('parental-approval-list').children.length) closeModal('parental-approval-modal');
  }catch(e){ showToast('Approval failed',scbErr('SCB-FAM-03','That account couldn\'t be approved — the server rejected the write.',(e.message||''))); }
}
async function denyChildAccount(childNumber){
  if(!confirm('Deny this account? They will not be able to use SoCloudyBro with this signup.')) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===childNumber);
    if(u&&(!me||!me.email||(u.parentEmail||'').toLowerCase()!==me.email.toLowerCase())){ showToast('Not allowed',scbErr('SCB-FAM-04','You are not the registered parent for that account.')); return; }
    if(u){ await fbdb.ref('users/'+childNumber+'/parentalConsentStatus').set('denied'); }
    showToast('Denied','');
    await checkPendingChildApprovals();
    if(!document.getElementById('parental-approval-list').children.length) closeModal('parental-approval-modal');
  }catch(e){ showToast('Failed',scbErr('SCB-FAM-04','That account couldn\'t be denied — the server rejected the write.',(e.message||''))); }
}
function calcAge(birthdateStr){
  const b = new Date(birthdateStr);
  if(isNaN(b)) return null;
  const now = new Date();
  if(b > now) return null; // a birthdate in the future is invalid, not a negative age
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if(m < 0 || (m===0 && now.getDate() < b.getDate())) age--;
  return age;
}
function isDeviceAgeBlocked(){
  return localStorage.getItem('cc_age_blocked')==='1';
}
async function getDeviceIP(){
  try{
    const r = await fetch('https://api.ipify.org?format=json');
    const d = await r.json();
    return d.ip || null;
  }catch{ return null; }
}
async function blockDeviceForAge(){
  localStorage.setItem('cc_age_blocked','1');
  try{
    const ip = await getDeviceIP();
    // Blacklist lives at its own top-level path — NOT nested in users — so reading
    // or writing it never touches user records.
    const snap = await fbdb.ref('blacklist').get();
    const raw = snap.exists() ? snap.val() : [];
    const bl = (Array.isArray(raw) ? raw : Object.values(raw||{})).filter(Boolean);
    if(!bl.find(b=>b.deviceId===deviceId || (ip && b.ip===ip))){
      // Written to its own keyed child (by deviceId) instead of a full
      // array replace — stored per-entry (like reports/spam_flags) so the
      // Firebase rule can allow creating a NEW blacklist entry this way
      // without granting the ability to rewrite or remove existing ones.
      await fbdb.ref('blacklist/'+deviceId).set({deviceId, ip: ip||null, reason:'underage_signup', blockedAt: Date.now()});
    }
  }catch{}
}
async function isDeviceOrIPBlacklisted(){
  if(isDeviceAgeBlocked()) return true;
  try{
    const snap = await fbdb.ref('blacklist').get();
    const raw = snap.exists() ? snap.val() : [];
    const bl = (Array.isArray(raw) ? raw : Object.values(raw||{})).filter(Boolean);
    if(bl.find(b=>b.deviceId===deviceId)){ localStorage.setItem('cc_age_blocked','1'); return true; }
    const ip = await getDeviceIP();
    if(ip && bl.find(b=>b.ip===ip)){ localStorage.setItem('cc_age_blocked','1'); return true; }
  }catch{}
  return false;
}

// -- SETUP ---------------------------------------------------------------------
let _numberCheckTimer=null;
async function checkNumberAvailability(val){
  clearTimeout(_numberCheckTimer);
  const hint=document.getElementById('setup-number-hint');
  const suggestBox=document.getElementById('setup-number-suggestions');
  const num=parseInt(val);
  suggestBox.style.display='none';suggestBox.innerHTML='';
  if(!num||num<1000||num>99999){
    hint.textContent='1000–99999 · must be unique · this is your permanent handle';
    hint.style.color='var(--muted)';
    return;
  }
  hint.textContent='Checking…';
  hint.style.color='var(--muted)';
  _numberCheckTimer=setTimeout(async()=>{
    try{
      const users=await getUsers();
      const taken=users.some(u=>u.number===num);
      // ADMIN_NUMBER is always reserved; plus any numbers stored after a nuclear reset
      let reserved=[];
      try{
        const rsnap=await fbdb.ref('admin_site/reserved_numbers').get();
        reserved=rsnap.val()||[];
      }catch(e){}
      const isReserved=num===ADMIN_NUMBER||(Array.isArray(reserved)&&reserved.includes(num));
      if(!taken&&!isReserved){
        hint.textContent='✓ #'+num+' is available';
        hint.style.color='var(--success)';
      }else{
        hint.textContent='✗ #'+num+' is already taken';
        hint.style.color='var(--danger)';
        const taken_set=new Set([...users.map(u=>u.number),...(Array.isArray(reserved)?reserved:[])]);
        const suggestions=[];
        for(let offset=1;offset<50&&suggestions.length<4;offset++){
          if(num+offset<=99999&&!taken_set.has(num+offset)) suggestions.push(num+offset);
          if(num-offset>=1000&&!taken_set.has(num-offset)) suggestions.push(num-offset);
        }
        if(suggestions.length){
          suggestBox.style.display='flex';
          suggestions.slice(0,4).forEach(n=>{
            const chip=document.createElement('button');
            chip.type='button';
            chip.className='update-ch-btn';
            chip.textContent='#'+n;
            chip.onclick=()=>{document.getElementById('setup-number').value=n;checkNumberAvailability(n);};
            suggestBox.appendChild(chip);
          });
        }
      }
    }catch(e){ hint.textContent='1000–99999 · must be unique · this is your permanent handle'; hint.style.color='var(--muted)'; }
  },400); // debounced so we're not hammering Firebase on every keystroke
}
async function submitSetup(){
  const name=document.getElementById('setup-name').value.trim();
  const email=document.getElementById('setup-email').value.trim().toLowerCase();
  const num=parseInt(document.getElementById('setup-number').value);
  const pwd=document.getElementById('setup-password').value.trim();
  const birthdate=document.getElementById('setup-birthdate').value;
  const bio=document.getElementById('setup-bio').value.trim();
  const err=document.getElementById('setup-error');
  err.textContent='';

  // Honeypot: bots fill this hidden field, humans don't
  const hp=document.getElementById('hp-website');
  if(hp&&hp.value){return;} // silently fail for bots
  if(isDeviceAgeBlocked()){err.textContent=scbErr('SCB-SIGNUP-01','Sign-up is not available on this device.');return;}
  if(!name){err.textContent=scbErr('SCB-SIGNUP-02','Enter a name.');return;}
  if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){err.textContent=scbErr('SCB-SIGNUP-03','Enter a valid email address.');return;}
  if(!num||num<1000||num>99999){err.textContent=scbErr('SCB-SIGNUP-04','Number must be 1000–99999.');return;}
  if(!pwd){err.textContent=scbErr('SCB-SIGNUP-05','Create a password.');return;}
  if(pwd.length<8){err.textContent=scbErr('SCB-SIGNUP-06','Password must be at least 8 characters.');return;}
  if(!(await _warnIfBreachedPassword(pwd))) return;
  if(!birthdate){err.textContent=scbErr('SCB-SIGNUP-07','Enter your date of birth.');return;}
  const age=calcAge(birthdate);
  if(age===null){err.textContent=scbErr('SCB-SIGNUP-08','Enter a valid date of birth.');return;}
  if(age<MIN_SIGNUP_AGE){
    // CHILD TIER (under 8): a standalone account can't be created at all. The
    // sanctioned path is a parent, on their own already-age-verified account,
    // adding a child profile from Settings → Manage Child Accounts. The device
    // is deliberately NOT age-blocked here (unlike the old behaviour) because
    // that same device is very likely the parent's, and they need to be able to
    // log in to create the profile.
    err.innerHTML='Accounts for under-'+MIN_SIGNUP_AGE+'s can\'t be created here. A parent or guardian with a SoCloudyBro account can add a child profile for you from <b>Settings → Manage Child Accounts</b> on their own account.';
    return;
  }
  const needsParentalConsent=age<=PARENTAL_CONSENT_MAX_AGE;
  let parentEmail='';
  if(needsParentalConsent){
    parentEmail=document.getElementById('setup-parent-email').value.trim().toLowerCase();
    if(!parentEmail||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)){err.textContent=scbErr('SCB-SIGNUP-09','Enter a valid parent/guardian email — accounts under 18 need one.');return;}
    if(parentEmail===email){err.textContent=scbErr('SCB-SIGNUP-10','Parent/guardian email must be different from your own email.');return;}
  }

  const btn=document.querySelector('#setup-modal .btn-full');btn.disabled=true;btn.innerHTML='<span class="spinner"></span>';
  try{
    if(await isDeviceOrIPBlacklisted()){err.textContent=scbErr('SCB-SIGNUP-11','Sign-up is not available on this device.');return;}
    const users=await getUsers();
    if(users.find(u=>u.number===num)){err.textContent=scbErr('SCB-SIGNUP-12',`#${num} is taken. Try another.`);return;}
    // Block reserved/privileged numbers — ADMIN_NUMBER is always reserved,
    // plus any numbers stored in admin_site/reserved_numbers after a nuclear reset
    if(num===ADMIN_NUMBER){err.textContent=scbErr('SCB-SIGNUP-12',`#${num} is reserved and cannot be registered.`);return;}
    try{
      const rsnap=await fbdb.ref('admin_site/reserved_numbers').get();
      const reserved=rsnap.val()||[];
      if(Array.isArray(reserved)&&reserved.includes(num)){err.textContent=scbErr('SCB-SIGNUP-12',`#${num} is reserved and cannot be registered.`);return;}
    }catch(e){}
    if(users.find(u=>(u.email||'').toLowerCase()===email)){err.textContent=scbErr('SCB-SIGNUP-13','An account with that email already exists.');return;}
    // Re-checked here, not just in handleGoogleCredentialResponse(), because the
    // form can sit open for a while: another device could have linked this same
    // Google account in between. Without this, two SoCloudyBro accounts could
    // end up sharing one `googleSub` and "Sign in with Google" would then match
    // whichever one getUsers() happened to return first.
    if(_pendingGoogleSignup && users.find(u=>u&&u.googleSub&&u.googleSub===_pendingGoogleSignup.sub)){
      err.textContent=scbErr('SCB-SIGNUP-14','That Google account is already linked to a SoCloudyBro account. Switch to Log In and use "Sign in with Google".');
      return;
    }

    // Hash the password locally (salted SHA-256) before storing -- never sent or stored in plaintext
    _loginRawPwd = pwd; // available for E2E cloud key sync during this session
    resetLocalSessionState();
    me={name,email,number:num,bio,birthdate,pwd:await hashPasswordV3(pwd),avatar:tempSetupAvatar||'',createdAt:Date.now()};
    // Stamp the Google identity onto the brand-new account. `sub` is Google's
    // stable per-account subject id and is what every later sign-in matches on;
    // the email is stored only for display in Settings, never for matching,
    // because a Google account's email address can change.
    if(_pendingGoogleSignup){
      me.googleSub=_pendingGoogleSignup.sub;
      me.googleEmail=_pendingGoogleSignup.email||'';
      if(_pendingGoogleSignup.emailVerified) me.emailVerified=true;
    }
    if(needsParentalConsent){
      me.parentEmail=parentEmail;
      me.parentalConsentStatus='pending';
    }
    saveStorage();
    // Bootstrap the account record with just the fields the Worker needs to
    // verify identity (number + pwd hash). This write goes out on the anonymous
    // session; the Firebase rule allows anonymous creation of a record that
    // doesn't yet exist (!data.exists()). We write only the minimum here so the
    // Worker can verify the password server-side on the very next call.
    await fbdb.ref(USERS_BIN+'/'+num).set({number:num, createdAt:me.createdAt});
    // Mirror pwd to the private node BEFORE calling the Worker — the Worker reads
    // users_private/<num>/pwd to verify the password server-side. This must be
    // awaited; a fire-and-forget write creates a race where the Worker finds no
    // hash yet, _tryUpgradeToCustomAuth returns false, and registerOrUpdate() then
    // runs anonymously against an already-existing record → PERMISSION_DENIED.
    await fbdb.ref(USERS_PRIVATE+'/'+num+'/pwd').set(me.pwd);
    // Now upgrade to a custom auth token — the record exists, so the Worker can
    // verify the password (or Google credential) server-side. Every subsequent
    // write in registerOrUpdate() and launch() runs on the real custom session,
    // which satisfies auth.token.number checks in the Firebase rules.
    const upgraded = _pendingGoogleSignup && _loginGoogleCredential
      ? await _tryUpgradeToCustomAuth(num, {googleCredential:_loginGoogleCredential})
      : await _tryUpgradeToCustomAuth(num, {password:pwd});
    // If the Worker is down or rejects the proof, registerOrUpdate() would run
    // anonymously against an already-existing record → PERMISSION_DENIED. Make
    // the failure explicit so the error is actionable rather than opaque.
    if(!upgraded) throw new Error('Could not verify your identity with the server — please try again.');
    // Write the full record now that we have custom auth.
    await registerOrUpdate();
    _pendingGoogleSignup=null;
    try{ await sendWelcomeMessage(); }catch{}
    closeModal('setup-modal');await launch();
  }catch(e){
    _loginRawPwd = null; // clear sensitive credential on any error path
    selfHeal('SCB-SIGNUP-15', e, { context: 'signUp' });
    err.textContent=scbErr('SCB-SIGNUP-15','Your account couldn\'t be created — the server rejected the sign-up.',e.message);
  }
  finally{btn.disabled=false;btn.textContent='Get Started ↗';}
}

// -- PROFILE -------------------------------------------------------------------
function renderMyCard(){
  if(!me)return;
  document.getElementById('my-name').innerHTML=esc(me.name)+equippedBadgeHtml(me.number);
  const av=document.getElementById('my-avatar');
  renderAvatar(av,{name:me.name,avatar:me.avatar||''});
  const statusEl=document.getElementById('my-status-text');
  if(statusEl){
    statusEl.innerHTML=me.customStatus
      ? esc(me.customStatus)
      : '<span style="color:var(--success)">●</span> Online';
  }
  updateSettingsPanel();
  const adminBtn=document.getElementById('admin-dash-btn');
  if(adminBtn) adminBtn.style.display=hasAnyAdminAccess()?'flex':'none';
}
function updateSettingsPanel(){
  if(!me)return;
  renderSessionsList();
  updateDNDUI();
  updateQuietHoursUI();
  const swipeSel=document.getElementById('swipe-action-select');
  if(swipeSel) swipeSel.value=getSwipeAction();
  document.getElementById('settings-name-disp').textContent=me.name;
  document.getElementById('settings-num-disp').textContent='#'+me.number;
  document.getElementById('settings-bio-disp').textContent=me.bio||'No bio set';
  renderAvatar(document.getElementById('settings-avatar'),{name:me.name,avatar:me.avatar||''},60);
  const hasPin=!!localStorage.getItem('cc_pin');
  document.getElementById('pin-status-text').textContent=hasPin?'PIN is set':'Not set';
  document.getElementById('pin-btn-text').textContent=hasPin?'Change PIN':'Set PIN';
  updateTotpStatusUI();
  updateSecQStatusUI();
  updateDeleteAccountBanner();
  initNoiseSuppressPref();
  const loc=getWeatherLocation();
  const locInput=document.getElementById('weather-location-input');
  if(locInput&&loc) locInput.value=loc.name;
  _renderBizSettings();
}
function openEditProfile(){
  document.getElementById('edit-name').value=me.name;
  document.getElementById('edit-bio').value=me.bio||'';
  document.getElementById('edit-status').value=me.customStatus||'';
  openModal('edit-profile-modal');
}
async function saveProfile(){
  const name=document.getElementById('edit-name').value.trim();
  const bio=document.getElementById('edit-bio').value.trim();
  const customStatus=document.getElementById('edit-status').value.trim();
  const err=document.getElementById('edit-error');
  err.textContent='';
  if(!name){err.textContent=scbErr('SCB-SET-01','Name cannot be empty.');return;}
  me.name=name;me.bio=bio;me.customStatus=customStatus;saveStorage();
  renderMyCard();renderSidebar();
  closeModal('edit-profile-modal');
  await registerOrUpdate();
  showToast('Profile updated','');
}

