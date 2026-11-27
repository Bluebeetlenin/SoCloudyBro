// -- ADMIN PANEL ----------------------------------------------------------
function checkAdminPanel(){
  // Was checking only the literal super-admin number, overwriting the
  // correct hasAnyAdminAccess() check renderMyCard() had just set — a
  // delegated admin (adminAccess.permissions, not the ADMIN_NUMBER account)
  // would see the shield for a moment on launch, then this ran a second
  // later and hid it again. The weekly-digest/URL-param admin actions below
  // are genuinely super-admin-only, so that check stays separate.
  const btn=document.getElementById('admin-dash-btn');
  if(btn) btn.style.display=hasAnyAdminAccess()?'flex':'none';
  if(!me||me.number!==ADMIN_NUMBER) return;
  maybeAutoSendWeeklyDigest();
  const params=new URLSearchParams(window.location.search);
  if(params.get('admin')==='1'){
    const userNum=parseInt(params.get('user'));
    openAdminPanel(userNum);
    window.history.replaceState({},document.title,window.location.pathname);
  }
}
async function openAdminPanel(reportedNum){
  if(!me||me.number!==ADMIN_NUMBER){showToast('Access denied',scbErr('SCB-ADMIN-02','That admin tool is only available to the site administrator.'));return;}
  const body=document.getElementById('admin-panel-body');body.innerHTML='<div style="padding:10px;color:var(--muted)">Loading...</div>';
  openModal('admin-panel-modal');
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===reportedNum);
    const isBanned=!!(u&&u.banned);
    body.innerHTML=`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div class="avatar" style="width:48px;height:48px;background:var(--accent);color:#fff;font-size:18px">${u?(dec(u.name)||'?').charAt(0).toUpperCase():'?'}</div>
        <div>
          <div style="font-size:15px;font-weight:600">${esc(u?dec(u.name):'Unknown')}</div>
          <div style="font-size:12px;color:var(--muted)">#${reportedNum}</div>
          <div style="font-size:11px;color:var(--muted)">${esc(u?dec(u.bio||''):'')}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm" data-number="${reportedNum}" onclick="adminMessage(Number(this.dataset.number))">💬 Message</button>
        ${isBanned
          ? `<button class="btn btn-ghost btn-sm" data-number="${reportedNum}" onclick="adminUnban(Number(this.dataset.number))">✅ Unban</button>`
          : `<button class="btn btn-danger btn-sm" data-number="${reportedNum}" onclick="adminBan(Number(this.dataset.number))">🚫 Ban</button>`}
      </div>
      ${isBanned?'<div style="margin-top:10px;padding:8px 12px;background:rgba(209,52,56,0.1);border:1px solid rgba(209,52,56,0.3);border-radius:8px;font-size:12px;color:var(--danger)">This user is currently banned.</div>':''}
    `;
  }catch(e){
    selfHeal('SCB-ADMIN-18', e, { context: 'openAdminPanel' });
    body.innerHTML='<div style="color:var(--danger)">'+esc(scbErr('SCB-ADMIN-18','This user\'s moderation details couldn\'t be loaded.',(e&&e.message)||''))+'</div>';
  }
}
// Ban/unban now flips a `banned` flag on the user's own record in Firebase
// (synced for everyone), instead of the old approach of deleting the record
// and tracking bans in localStorage only on the admin's own device/browser.
async function adminBan(num){
  if(!requirePermission('users_ban')) return;
  if(!confirm('Ban user #'+num+'? They will be signed out and blocked from using the app.')) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===num);
    if(!u){showToast('User not found',scbErr('SCB-ADMIN-03','No user with that account number was found.'));return;}
    u.banned=true;
    await saveUsers(users);
    _logAdminAction('ban','#'+num).catch(()=>{});
    showToast('User banned','#'+num+' has been banned.');
  }catch(e){
    selfHeal('SCB-ADMIN-04', e, { context: 'adminBan' });
    showToast('Ban failed',scbErr('SCB-ADMIN-04','That user couldn\'t be banned — the server rejected the write.',(e.message||'')));return;
  }
  closeModal('admin-panel-modal');
  if(document.getElementById('admin-dashboard-modal').classList.contains('visible')) renderAdminUsersTab();
}
async function adminUnban(num){
  if(!requirePermission('users_ban')) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===num);
    if(u) u.banned=false;
    await saveUsers(users);
    _logAdminAction('unban','#'+num).catch(()=>{});
    showToast('User unbanned','#'+num+' can use the app again.');
  }catch(e){
    selfHeal('SCB-ADMIN-05', e, { context: 'adminUnban' });
    showToast('Unban failed',scbErr('SCB-ADMIN-05','That user couldn\'t be unbanned — the server rejected the write.',(e.message||'')));return;
  }
  closeModal('admin-panel-modal');
  if(document.getElementById('admin-dashboard-modal').classList.contains('visible')) renderAdminUsersTab();
}
/* ===== SHADOW-MUTE (security feature 25/32) =====
   Unlike a ban, a shadow-muted account is given no indication anything is
   wrong at all: sendMsg() still lets them "send" normally and renderMessages()
   still shows it in THEIR OWN view (set in me.shadowMuted at login/poll —
   see finishLogin()/registerOrUpdate()), it's just never rendered for
   anyone else. Meant for a repeat offender where an immediate ban would
   just prompt them to make a new account and keep going. ===== */
async function adminShadowMute(num){
  if(!requirePermission('users_ban')) return;
  if(!confirm('Shadow-mute user #'+num+'?\n\nTheir messages will appear to send normally to them, but will never actually be delivered to anyone else. They are given no notice of this.')) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===num);
    if(!u){showToast('User not found',scbErr('SCB-ADMIN-27','No user with that account number was found.'));return;}
    u.shadowMuted=true;
    await saveUsers(users);
    await _logSecurityEvent('shadow_mute','Shadow-muted #'+num).catch(()=>{});
    _logAdminAction('shadow_mute','#'+num).catch(()=>{});
    showToast('User shadow-muted','#'+num+'\'s messages will no longer be delivered to anyone else.');
  }catch(e){
    selfHeal('SCB-ADMIN-27', e, { context: 'adminShadowMute' });
    showToast('Failed',scbErr('SCB-ADMIN-27','That user couldn\'t be shadow-muted — the server rejected the write.',(e.message||'')));return;
  }
  if(document.getElementById('admin-dashboard-modal').classList.contains('visible')) renderAdminUsersTab();
}
async function adminShadowMuteForHours(num,hours){
  if(!requirePermission('users_ban')) return;
  if(!confirm('Shadow-mute user #'+num+' for '+hours+' hour(s)? It lifts automatically — no need to come back and undo it.')) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===num);
    if(!u){showToast('User not found',scbErr('SCB-ADMIN-31','No user with that account number was found.'));return;}
    u.shadowMuted=true;
    u.shadowMuteExpiresAt=Date.now()+hours*3600000;
    await saveUsers(users);
    await _logSecurityEvent('shadow_mute','Shadow-muted #'+num+' for '+hours+'h').catch(()=>{});
    _logAdminAction('shadow_mute_temp','#'+num+' for '+hours+'h').catch(()=>{});
    showToast('Temporarily muted','#'+num+' is shadow-muted for '+hours+' hour(s), lifts automatically.');
  }catch(e){
    selfHeal('SCB-ADMIN-31', e, { context: 'adminShadowMuteForHours' });
    showToast('Failed',scbErr('SCB-ADMIN-31','That user couldn\'t be shadow-muted — the server rejected the write.',(e.message||'')));return;
  }
  if(document.getElementById('admin-dashboard-modal').classList.contains('visible')) renderAdminUsersTab();
}
async function adminUnshadowMute(num){
  if(!requirePermission('users_ban')) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===num);
    if(u){ u.shadowMuted=false; u.shadowMuteExpiresAt=null; }
    await saveUsers(users);
    await _logSecurityEvent('shadow_mute','Un-shadow-muted #'+num).catch(()=>{});
    _logAdminAction('un_shadow_mute','#'+num).catch(()=>{});
    showToast('Shadow-mute lifted','#'+num+'\'s messages deliver normally again.');
  }catch(e){
    selfHeal('SCB-ADMIN-28', e, { context: 'adminUnshadowMute' });
    showToast('Failed',scbErr('SCB-ADMIN-28','That couldn\'t be undone — the server rejected the write.',(e.message||'')));return;
  }
  if(document.getElementById('admin-dashboard-modal').classList.contains('visible')) renderAdminUsersTab();
}
// Verified-identity tier: a lightweight admin-granted badge (not document/ID
// verification) so people can tell real, admin-confirmed community members
// apart from randoms — shown as a ✓ next to their name everywhere.
async function adminVerify(num){
  if(!requireAdmin()) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===num);
    if(!u){showToast('User not found',scbErr('SCB-ADMIN-06','No user with that account number was found.'));return;}
    u.verified=true;
    await saveUsers(users);
    showToast('User verified','#'+num+' now has a verified badge.');
  }catch(e){
    selfHeal('SCB-ADMIN-07', e, { context: 'adminVerify' });
    showToast('Verify failed',scbErr('SCB-ADMIN-07','That user couldn\'t be verified — the server rejected the write.',(e.message||'')));return;
  }
  if(document.getElementById('admin-dashboard-modal').classList.contains('visible')) renderAdminUsersTab();
  renderSidebar();
}
async function adminUnverify(num){
  if(!requireAdmin()) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===num);
    if(u) u.verified=false;
    await saveUsers(users);
    showToast('Verification removed','');
  }catch(e){
    selfHeal('SCB-ADMIN-08', e, { context: 'adminUnverify' });
    showToast('Failed',scbErr('SCB-ADMIN-08','That user\'s verified badge couldn\'t be removed — the server rejected the write.',(e.message||'')));return;
  }
  if(document.getElementById('admin-dashboard-modal').classList.contains('visible')) renderAdminUsersTab();
  renderSidebar();
}
/* -----------------------------------------------------------------------------
   ADMIN: RESET ACCOUNT
   -----------------------------------------------------------------------------
   For an account whose own profile record has gone bad (double-encrypted
   name/bio, a broken avatar, theme colours that make the UI unusable) — not a
   moderation action and not a deletion. The single most important property of
   this feature is what it does NOT touch:

   * The account NUMBER never changes. Conversations live in their own
     `conversations` records keyed by convo key (dm_2015_2019, grp_…) and list
     participants by NUMBER; they never embed the user record. So rewriting the
     user record cannot affect a single message, chat or group, and this
     function never opens CONVOS_BIN at all.
   * No other user's record is read for writing, and reports/moderation history
     (`reports`, `banned`, `verified`) are left exactly as they are.

   Preserved deliberately (see the report for the full rationale): pwd, email,
   birthdate, createdAt, blocked, sessions, TOTP/face MFA, secQuestions,
   parental fields, Google/Syntax links, banned/verified.

   The write lands on the TARGET's record from the ADMIN's browser, so the
   target's own tab knows nothing about it yet — and worse, its next
   registerOrUpdate() would write its locally-cached `me.name`/avatar/theme
   straight back over the reset, because registerOrUpdate() takes those from
   `me` first. That's why the reset leaves an `accountReset` stamp on the
   record: applyPendingAccountReset() reads it on the target's next launch,
   before registerOrUpdate() runs, exactly like the parentalConsentStatus and
   pendingDeletion checks at the top of launch() already do. Same
   "next time their client checks in" contract as adminBan and device
   revocation — nothing is pushed to the target.
   -------------------------------------------------------------------------- */
let _adminResetTarget=null;
function adminResetAccount(num){
  if(!requireAdmin()) return;
  _adminResetTarget=num;
  const u=(usersCache||[]).find(x=>x&&x.number===num);
  const nm=(u?dec(u.name||''):'')||('#'+num);
  const who=document.getElementById('admin-reset-who');
  if(who) who.textContent=nm+' (#'+num+')';
  const line=document.getElementById('admin-reset-summary');
  if(line) line.textContent='This clears '+nm+'\'s profile — name, bio, status, avatar and theme colours — and gives them a completely fresh start. Their message history, chats and groups stay exactly as they are, and so do their password, email, account age, blocked list and any connected Google or Syntax account.';
  const k=document.getElementById('admin-reset-keys'); if(k) k.checked=false;
  const p=document.getElementById('admin-reset-pwd'); if(p) p.checked=false;
  const m=document.getElementById('admin-reset-mfa'); if(m) m.checked=false;
  const err=document.getElementById('admin-reset-error'); if(err) err.textContent='';
  openModal('admin-reset-modal');
}
async function submitAdminResetAccount(){
  if(!requireAdmin()) return;
  const num=_adminResetTarget;
  const err=document.getElementById('admin-reset-error');
  if(err) err.textContent='';
  if(!num){ if(err) err.textContent=scbErr('SCB-ADMIN-09','No user selected.'); return; }
  const regenKeys=!!(document.getElementById('admin-reset-keys')||{}).checked;
  const forcePwd=!!(document.getElementById('admin-reset-pwd')||{}).checked;
  const clearMfa=!!(document.getElementById('admin-reset-mfa')||{}).checked;
  const btn=document.getElementById('admin-reset-submit');
  if(btn){ btn.disabled=true; btn.innerHTML='<span class="spinner"></span>'; }
  try{
    const users=await getUsers();
    const u=users.find(x=>x&&x.number===num);
    if(!u){ if(err) err.textContent=scbErr('SCB-ADMIN-10','User #'+num+' not found.'); return; }
    // --- profile fields: cleared ---------------------------------------------
    // Reset to a generic placeholder rather than blank, so the account still
    // renders everywhere (sidebar initials, chat headers, report rows) instead
    // of showing an empty name.
    u.name='Reset User #'+num;
    u.bio='';
    u.customStatus='';
    u.avatar='';
    u.themeColors=null;
    u.largeTextMode=false;
    // --- E2E key material ----------------------------------------------------
    // Only on explicit request. An admin CANNOT mint a keypair for someone
    // else: the ECDH private half only ever exists in that person's own
    // localStorage (ensureE2EKeypair), and is never uploaded. So the honest
    // implementation is to retire the published public key here and let the
    // target's own client generate and publish the replacement on its next
    // launch. Until it does, `pubkey` is absent, which _userPubKeyStr()
    // already handles: getDmAesKey() returns null and decryptConvoMessages()
    // marks bubbles textFailed instead of crashing.
    if(regenKeys) u.pubkey=null;
    // --- two-factor/face sign-in: an admin-side rescue for a genuinely
    // locked-out account (no camera, no passkey on hand, no backup PIN or
    // security questions set up — the normal self-service fallbacks).
    // secQuestions/backupPinHash are deliberately left untouched: they're
    // the solution, not the lock, and clearing them would only strip a
    // working recovery option the account might still have. ------------------
    if(clearMfa){ u.totpEnabled=false; u.totpSecret=''; u.faceMfaEnabled=false; u.faceDescriptor=null; }
    // --- the stamp the target's own client reads ------------------------------
    u.accountReset={at:Date.now(),by:me.number,keys:regenKeys,pwd:forcePwd,mfa:clearMfa};
    // Keeps the current hash valid for one more sign-in and then makes them
    // choose a new one. Blanking `pwd` instead would be a real security
    // regression: submitLogin() treats an empty `pwd` as "no password set yet
    // — accept any and store it", so the number would be takeoverable by
    // anyone who knows it (the same hole the `deleted` check exists to close).
    if(forcePwd) u.mustChangePassword=true;
    // --- accountability ------------------------------------------------------
    // There's no general admin-action audit log in this app (bans/verifications
    // just flip a flag on the record; the only export is the reports-based
    // moderation log), so this records itself on the target's own record rather
    // than inventing an audit system that nothing else here uses.
    if(!Array.isArray(u.resetHistory)) u.resetHistory=[];
    u.resetHistory.push({by:me.number,at:Date.now(),keysRegenerated:regenKeys,passwordResetRequired:forcePwd,mfaCleared:clearMfa});
    await saveUsers(users);
    closeModal('admin-reset-modal');
    _adminResetTarget=null;
    showToast('Account reset','#'+num+'\'s profile was cleared. It applies on their device the next time they open the app.');
    // Resetting your own account is the one case where "next time their client
    // checks in" is this very tab: adopt it immediately so a later
    // registerOrUpdate() from this session (any settings change) can't write
    // the old cached profile back over the reset.
    if(me&&me.number===num){
      try{ await applyPendingAccountReset(); }catch(e){ console.warn('self-reset apply failed',e); }
    }
    if(document.getElementById('admin-dashboard-modal').classList.contains('visible')) renderAdminUsersTab();
    try{ renderSidebar(); }catch(e){}
  }catch(e){
    selfHeal('SCB-ADMIN-11', e, { context: 'submitAdminResetAccount' });
    if(err) err.textContent=scbErr('SCB-ADMIN-11','That account couldn\'t be reset — the server rejected the write.',(e.message||'unknown error'));
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Reset account'; }
  }
}

function verifiedBadge(num){
  const u=lookupUser(num);
  return (u&&u.verified) ? ' <span class="verified-badge" title="Verified by admin">✓</span>' : '';
}

// ── LIFETIME BADGES (tiered, Discord-style) ───────────────────────────────────
// Each category has: id, label, color, bg, stat(number)→value, unit, tiers[]
// tiers: [{icon, name, threshold}] sorted ascending
const LIFETIME_BADGE_CATS = [
  {
    id:'age', label:'Account Age', color:'#10b981', bg:'rgba(16,185,129,0.14)',
    unit:'months',
    stat(n){ const u=lookupUser(n); if(!u||!u.createdAt) return 0; return (Date.now()-u.createdAt)/2592000000; },
    tiers:[
      {icon:'🌱',name:'Newcomer',   threshold:0.25,  req:'1 week'},
      {icon:'🌿',name:'Member',     threshold:1,     req:'1 month'},
      {icon:'🍃',name:'Regular',    threshold:6,     req:'6 months'},
      {icon:'🌳',name:'Veteran',    threshold:12,    req:'1 year'},
      {icon:'🏔️',name:'Elder',      threshold:24,    req:'2 years'},
      {icon:'👑',name:'Legend',     threshold:36,    req:'3 years'},
    ]
  },
  {
    id:'msgs', label:'Chatter', color:'#60a5fa', bg:'rgba(96,165,250,0.14)',
    unit:'messages',
    stat(n){
      if(!convosCache) return 0;
      return convosCache.reduce((s,c)=>s+((c&&c.memberMsgCount&&c.memberMsgCount[n])||0),0);
    },
    tiers:[
      {icon:'💬',name:'Talker',     threshold:10,    req:'10 messages'},
      {icon:'🗣️',name:'Chatty',     threshold:50,    req:'50 messages'},
      {icon:'📢',name:'Blabber',    threshold:250,   req:'250 messages'},
      {icon:'📝',name:'Wordsmith',  threshold:1000,  req:'1,000 messages'},
      {icon:'📚',name:'Oracle',     threshold:5000,  req:'5,000 messages'},
    ]
  },
  {
    id:'social', label:'Social', color:'#a78bfa', bg:'rgba(167,139,250,0.14)',
    unit:'contacts',
    stat(n){
      // Count unique DM contacts visible in local data for this number
      if(n===me?.number) return (contacts||[]).filter(c=>c.type!=='group').length;
      // For others: count convos where both they and the viewer are participants (approximation)
      if(!convosCache) return 0;
      return convosCache.filter(c=>c&&c.type!=='group'&&(c.participants||[]).includes(n)).length;
    },
    tiers:[
      {icon:'👋',name:'Friendly',   threshold:2,     req:'2 contacts'},
      {icon:'🤝',name:'Social',     threshold:8,     req:'8 contacts'},
      {icon:'🎉',name:'Popular',    threshold:20,    req:'20 contacts'},
      {icon:'🌐',name:'Influencer', threshold:50,    req:'50 contacts'},
    ]
  },
  {
    id:'builder', label:'Builder', color:'#f59e0b', bg:'rgba(245,158,11,0.14)',
    unit:'groups',
    stat(n){
      if(!convosCache) return 0;
      return convosCache.filter(c=>c&&c.type==='group'&&c.admins&&c.admins[0]===n).length;
    },
    tiers:[
      {icon:'🔨',name:'Creator',    threshold:1,     req:'1 group'},
      {icon:'🏗️',name:'Organizer',  threshold:3,     req:'3 groups'},
      {icon:'🏛️',name:'Leader',     threshold:5,     req:'5 groups'},
      {icon:'🌍',name:'Pioneer',    threshold:10,    req:'10 groups'},
    ]
  },
  {
    id:'explorer', label:'Explorer', color:'#2dd4bf', bg:'rgba(45,212,191,0.14)',
    unit:'groups joined',
    stat(n){
      if(!convosCache) return 0;
      return convosCache.filter(c=>c&&c.type==='group'&&(c.participants||c.members||[]).includes(n)).length;
    },
    tiers:[
      {icon:'🗺️',name:'Curious',    threshold:2,     req:'2 groups'},
      {icon:'🧭',name:'Explorer',   threshold:5,     req:'5 groups'},
      {icon:'⛺',name:'Adventurer', threshold:10,    req:'10 groups'},
      {icon:'🚀',name:'Wanderer',   threshold:20,    req:'20 groups'},
    ]
  },
  {
    id:'verified', label:'Verified', color:'#4f8ef7', bg:'rgba(79,142,247,0.14)',
    unit:'',
    stat(n){ const u=lookupUser(n); return (u&&u.verified)?1:0; },
    tiers:[
      {icon:'✦', name:'Verified',   threshold:1,     req:'Admin-granted'},
    ]
  },
  {
    id:'supporter', label:'Supporter', color:'#ec4899', bg:'rgba(236,72,153,0.14)',
    unit:'',
    stat(n){ const u=lookupUser(n); return (u&&u.supporter)?1:0; },
    tiers:[
      {icon:'💜', name:'Supporter', threshold:1,     req:'Supports SoCloudyBro'},
    ]
  },
];

function _ltBadgeEarned(cat, number){
  const val = cat.stat(number);
  let tierIdx = -1;
  for(let i=0;i<cat.tiers.length;i++){ if(val>=cat.tiers[i].threshold) tierIdx=i; }
  if(tierIdx<0) return null;
  return {cat, tierIdx, tier:cat.tiers[tierIdx], value:val};
}

function getEarnedBadges(number){
  return LIFETIME_BADGE_CATS.map(cat=>_ltBadgeEarned(cat,number)).filter(Boolean);
}

function renderProfileBadges(el, number, compact){
  if(!el) return;
  const earned = getEarnedBadges(number);
  if(!earned.length){ el.innerHTML=''; return; }
  if(compact){
    el.innerHTML = earned.map(b=>
      `<span class="hc-badge" title="${esc(b.cat.label+': '+b.tier.name)}" data-act="openBadgeDetail" data-cat="${esc(b.cat.id)}" data-badge-number="${Number(number)}">${b.tier.icon}</span>`
    ).join('');
  } else {
    el.innerHTML = earned.map(b=>
      `<span class="lt-badge" style="--ltb-color:${b.cat.color};--ltb-bg:${b.cat.bg}" data-act="openBadgeDetail" data-cat="${esc(b.cat.id)}" data-badge-number="${Number(number)}">` +
      `<span class="ltb-icon">${b.tier.icon}</span>` +
      `<span class="ltb-name">${esc(b.tier.name)}</span>` +
      `</span>`
    ).join('');
  }
}

function openBadgeDetail(catId, number){
  const cat = LIFETIME_BADGE_CATS.find(c=>c.id===catId);
  if(!cat) return;
  const val = cat.stat(number);
  let tierIdx = -1;
  for(let i=0;i<cat.tiers.length;i++){ if(val>=cat.tiers[i].threshold) tierIdx=i; }
  if(tierIdx<0) return;
  const tier = cat.tiers[tierIdx];
  const nextTier = cat.tiers[tierIdx+1]||null;

  // Header gradient based on badge color
  const hdr = document.getElementById('badge-detail-header');
  hdr.style.background = `linear-gradient(145deg, color-mix(in srgb, ${cat.color} 20%, #0c1012), color-mix(in srgb, ${cat.color} 10%, #0c1012))`;

  // Build body
  const body = document.getElementById('badge-detail-body');
  const u = lookupUser(number);
  const metaParts = [];
  if(cat.unit && val>=1) metaParts.push(Math.round(val)+' '+cat.unit);
  const statHtml = metaParts.length ? `<div class="bdm-meta">${esc(metaParts.join(' • '))}</div>` : '';

  let progressHtml = '';
  if(nextTier){
    const pct = Math.min(100, Math.round((val/nextTier.threshold)*100));
    const needed = nextTier.threshold - val;
    const neededFmt = needed<1 ? 'less than 1' : (Number.isInteger(needed)?needed:needed.toFixed(1));
    progressHtml = `
      <div class="bdm-progress-wrap">
        <div class="bdm-progress-label">Your progress</div>
        <div class="bdm-track-row">
          <span class="bdm-track-icon">${tier.icon}</span>
          <div class="bdm-track"><div class="bdm-fill" style="width:${pct}%"></div></div>
          <span class="bdm-track-icon">${nextTier.icon}</span>
        </div>
        <div class="bdm-next-hint">${neededFmt} more ${cat.unit||'needed'} to unlock <strong>${esc(nextTier.name)}</strong></div>
      </div>`;
  } else {
    progressHtml = `<div class="bdm-progress-wrap" style="text-align:center;color:var(--muted);font-size:12px">🏆 Max tier reached!</div>`;
  }

  const tiersHtml = cat.tiers.map((t,i)=>{
    const cls = i===tierIdx ? 'bdm-tier-row current unlocked' : i<tierIdx ? 'bdm-tier-row unlocked' : 'bdm-tier-row locked';
    const lock = i>tierIdx ? '<span class="bdm-lock">🔒</span>' : '';
    return `<div class="${cls}">
      <span class="bdm-tier-row-icon">${t.icon}</span>
      <div class="bdm-tier-row-info">
        <div class="bdm-tier-row-name">${esc(t.name)}</div>
        <div class="bdm-tier-row-req">${esc(t.req)}</div>
      </div>${lock}
    </div>`;
  }).join('');

  body.innerHTML = `
    <div style="text-align:center;padding:0 0 16px">
      <span class="bdm-big-icon">${tier.icon}</span>
      <div class="bdm-cat-label">${esc(cat.label)}</div>
      <div class="bdm-tier-name">${esc(tier.name.toUpperCase())}</div>
      ${statHtml}
    </div>
    ${progressHtml}
    <div class="bdm-tiers-label">All tiers</div>
    ${tiersHtml}`;

  openModal('badge-detail-modal');
}
function adminMessage(num){
  if(!hasPermission('users_view')&&!hasPermission('users_ban')){ showToast('Access denied',scbErr('SCB-ADMIN-01','This action is for administrators only.')); return; }
  closeModal('admin-panel-modal');
  closeModal('admin-dashboard-modal');
  const existing=contacts.find(c=>c.type!=='group'&&c.number===num);
  if(existing){openChat(existing);}
  else{
    getUsers().then(users=>{
      const u=users.find(x=>x.number===num);
      if(!u){showToast('User not found',scbErr('SCB-ADMIN-12','No user with that account number was found.'));return;}
      const c={type:'dm',number:num,name:dec(u.name)||'#'+num,avatar:u.avatar||'',key:'dm_'+[me.number,num].sort((a,b)=>a-b).join('_')};
      contacts.push(c);saveStorage();openChat(c);
    }).catch(e=>showToast('Error',e.message));
  }
}

// -- ADMIN DASHBOARD ---------------------------------------------------------
let adminDashTab='overview';
async function openAdminDashboard(){
  if(!hasAnyAdminAccess()){showToast('Access denied',scbErr('SCB-ADMIN-13','You do not have admin panel access.'));return;}
  openModal('admin-dashboard-modal');
  // Hide tabs the user doesn't have access to. Permission-based visibility
  // is tracked separately (data-allowed) from the search filter's own
  // show/hide, so typing in the search box can never reveal a section this
  // user isn't actually permitted to see — filterAdminNav() always ANDs the
  // two together.
  document.querySelectorAll('.admin-dash-tab').forEach(btn=>{
    const t=btn.dataset.tab;
    const show=me.number===ADMIN_NUMBER||
      (t==='overview'&&hasPermission('overview'))||
      (t==='users'&&(hasPermission('users_view')||hasPermission('users_ban')))||
      (t==='groups'&&hasPermission('groups_view'))||
      (t==='reports'&&hasPermission('reports_view'))||
      (t==='spam'&&hasPermission('users_view'))||
      (t==='sla'&&hasPermission('reports_view'))||
      (t==='feedback'&&hasPermission('feedback_view'))||
      (t==='code'&&hasPermission('code_update'))||
      (t==='errors'&&(me.number===ADMIN_NUMBER||hasAnyAdminAccess()))||
      (t==='diagnostics'&&(me.number===ADMIN_NUMBER||hasAnyAdminAccess()))||
      (t==='ownertools'&&me.number===ADMIN_NUMBER);
    btn.dataset.allowed=show?'1':'0';
  });
  _updateErrBadge();
  const searchInput=document.getElementById('admin-dash-search');
  if(searchInput) searchInput.value='';
  filterAdminNav('');
  // Pick first visible tab (avoids opening on a hidden tab after permission changes)
  const visibleTabs=[...document.querySelectorAll('.admin-dash-tab')].filter(b=>b.dataset.allowed==='1').map(b=>b.dataset.tab);
  const firstTab=visibleTabs.includes(adminDashTab)?adminDashTab:(visibleTabs[0]||'overview');
  switchAdminTab(firstTab);
}
// Filters the sidebar nav by substring match against each button's visible
// label plus its data-keywords (so e.g. "ban" finds Users, "deploy" finds
// Code). Group labels (Moderation/Platform/Diagnostics) hide themselves
// when every button in their group is filtered out, so the sidebar never
// shows an orphaned heading over an empty section.
function filterAdminNav(query){
  const q=(query||'').trim().toLowerCase();
  const nav=document.getElementById('admin-dash-nav');
  if(!nav) return;
  let anyVisible=false;
  let groupLabel=null, groupHasVisible=false;
  Array.from(nav.children).forEach(el=>{
    if(el.classList.contains('admin-dash-tab-group-label')){
      if(groupLabel) groupLabel.style.display=groupHasVisible?'':'none';
      groupLabel=el; groupHasVisible=false;
      return;
    }
    if(!el.classList.contains('admin-dash-tab')) return;
    const allowed=el.dataset.allowed!=='0';
    const haystack=(el.textContent+' '+(el.dataset.keywords||'')).toLowerCase();
    const matches=!q||haystack.includes(q);
    const show=allowed&&matches;
    el.style.display=show?'':'none';
    if(show){ anyVisible=true; groupHasVisible=true; }
  });
  if(groupLabel) groupLabel.style.display=groupHasVisible?'':'none';
  const empty=document.getElementById('admin-dash-nav-empty');
  if(empty) empty.style.display=anyVisible?'none':'block';
}
function switchAdminTab(tab){
  adminDashTab=tab;
  document.querySelectorAll('.admin-dash-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  const perm={overview:'overview',users:'users_view',groups:'groups_view',reports:'reports_view',spam:'users_view',sla:'reports_view',feedback:'feedback_view',code:'code_update'};
  // errors/diagnostics have no delegable permission of their own — this must
  // match openAdminDashboard()'s own check for whether to show these two tab
  // buttons at all (hasAnyAdminAccess()). It didn't: perm[tab] was undefined
  // for both, so this fell through to hasPermission('errors'/'diagnostics') —
  // a permission string that can never be granted — meaning every delegated
  // admin could SEE these tabs but got "access denied" on every click.
  const hasTabAccess=(tab==='errors'||tab==='diagnostics')?hasAnyAdminAccess():hasPermission(perm[tab]||tab);
  if(!hasTabAccess&&me&&me.number!==ADMIN_NUMBER){
    const body=document.getElementById('admin-dashboard-body');
    if(body) body.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted)">You don\'t have permission to view this section.</div>';
    return;
  }
  if(tab==='overview') renderAdminOverviewTab();
  else if(tab==='users') renderAdminUsersTab();
  else if(tab==='groups') renderAdminGroupsTab();
  else if(tab==='reports') renderAdminReportsTab();
  else if(tab==='spam') renderAdminSpamTab();
  else if(tab==='sla') renderAdminModerationSlaTab();
  else if(tab==='feedback') renderAdminFeedbackTab();
  else if(tab==='code') renderAdminCodeTab();
  else if(tab==='errors') renderAdminErrorsTab();
  else if(tab==='diagnostics') renderAdminDiagnosticsTab();
  else if(tab==='ownertools') renderAdminOwnerToolsTab();
}

// ── NUCLEAR RESET ────────────────────────────────────────────────────────────
// SECURITY: This reset preserves the current admin account and any accounts
// that were granted admin access, then locks those numbers so nobody can
// re-register them after the wipe. Your own session stays active.
async function adminNuclearReset(){
  if(!requireAdmin()) return;
  // First confirmation
  if(!confirm('⚠️ This will permanently delete ALL other users, messages, conversations, groups, feedback, and reports from Firebase.\n\nYour own account (#'+me.number+') will be preserved.\nThis CANNOT be undone. Are you absolutely sure?')) return;
  // Second confirmation — type to confirm
  const typed=prompt('Type DELETE EVERYTHING to confirm the wipe:');
  if(typed!=='DELETE EVERYTHING'){
    showToast('Cancelled','Nuclear reset cancelled — nothing was deleted.');
    return;
  }
  showToast('Wiping…','Deleting all Firebase data except your account…');
  try{
    // Collect numbers that must be reserved (admin + any user who had adminAccess)
    let reservedNums=[ADMIN_NUMBER];
    try{
      const allUsers=await getUsers();
      allUsers.forEach(u=>{
        if(u&&u.adminAccess&&Array.isArray(u.adminAccess.permissions)&&u.adminAccess.permissions.length>0){
          reservedNums.push(u.number);
        }
      });
    }catch(e){ console.warn('Could not read users for reserved list',e); }
    reservedNums=[...new Set(reservedNums)];

    // Keep only the current admin's user record
    const myRecord=usersCache.find(u=>u&&u.number===me.number)||null;
    const usersToSave=myRecord?[myRecord]:[];

    // Delete each top-level path individually so partial failures are visible
    const paths=['conversations','reports','calls','voice','races','syntax_meetings','feedback','updates'];
    await Promise.all(paths.map(p=>fbdb.ref(p).remove().catch(e=>console.warn('Could not remove '+p,e))));

    // Save only the admin's own user record back (wipes all other accounts)
    await fbdb.ref('users').set({users:usersToSave});
    usersCache=usersToSave;

    // Write the reserved-numbers list so submitSetup() blocks re-registration
    await fbdb.ref('admin_site/reserved_numbers').set(reservedNums);

    // Clear local conversation cache but keep the admin's own session alive
    convosCache=null;
    // Remove per-conversation localStorage items but preserve identity + keys.
    // Also strip group contacts from cc_contacts — all groups are gone from Firebase.
    try{
      const keepKeys=['cc_me','cc_pin','cc_lang'];
      const keep=keepKeys.map(k=>({k,v:localStorage.getItem(k)}));
      // Filter contacts: keep only DM contacts for the admin's own number
      let cleanContacts=[];
      try{
        const raw=localStorage.getItem('cc_contacts');
        const parsed=raw?JSON.parse(raw):[];
        cleanContacts=(parsed||[]).filter(c=>c&&c.type!=='group');
      }catch(e){}
      Object.keys(localStorage).forEach(k=>{
        if(!keepKeys.includes(k)&&k!=='cc_contacts') try{ localStorage.removeItem(k); }catch(e){}
      });
      keep.forEach(({k,v})=>{ if(v!==null) try{ localStorage.setItem(k,v); }catch(e){} });
      try{ localStorage.setItem('cc_contacts',JSON.stringify(cleanContacts)); }catch(e){}
    }catch(e){}

    showToast('✓ Done','All other accounts wiped. Your account (#'+me.number+') is preserved. Reserved numbers: '+reservedNums.join(', '));
    renderAdminOverviewTab();
    try{ renderSidebar(); }catch(e){}
  }catch(e){
    showToast('Error',scbErr('SCB-ADMIN-99','Nuclear reset failed — some data may remain.',(e&&e.message)||''));
  }
}

// ── FEEDBACK SYSTEM ──────────────────────────────────────────────────────────
const FEEDBACK_PATH='feedback';
let _feedbackType='feedback'; // 'rate' | 'feedback' | 'bug'
let _feedbackRating=0;

// Full grantable admin permission list, grouped for the permission editor.
// Nuclear Reset, the Firebase Rules Manager, and Data Cleanup are
// deliberately NOT on this list — they stay hardcoded to the primary admin
// account (ADMIN_NUMBER) everywhere they're checked, so no combination of
// granted permissions can ever unlock them for a delegated admin.
const ADMIN_PERMS=[
  {group:'Dashboard',perms:[
    {id:'overview',label:'View Dashboard Overview'},
  ]},
  {group:'Users',perms:[
    {id:'users_view',label:'View Users'},
    {id:'users_ban',label:'Ban / Unban Users'},
    {id:'users_delete',label:'Permanently Delete User Accounts'},
    {id:'badges_grant',label:'Grant / Revoke Individual Badges'},
  ]},
  {group:'Groups',perms:[
    {id:'groups_view',label:'View Groups'},
    {id:'groups_delete',label:'Delete Groups'},
  ]},
  {group:'Reports & Spam',perms:[
    {id:'reports_view',label:'View User Reports'},
    {id:'reports_resolve',label:'Resolve Reports'},
    {id:'spam_resolve',label:'Dismiss Spam Flags'},
  ]},
  {group:'Feedback',perms:[
    {id:'feedback_view',label:'View Feedback & Bug Reports'},
    {id:'feedback_manage',label:'Reply To / Resolve Feedback'},
  ]},
  {group:'Platform',perms:[
    {id:'code_update',label:'Push Live Code Updates'},
    {id:'moderation_export',label:'Export Moderation Logs'},
    {id:'digest_send',label:'Send Weekly Admin Digest'},
  ]},
];
// Flat list kept for any older code still expecting the original shape.
const FEEDBACK_PERMS=ADMIN_PERMS.reduce((a,g)=>a.concat(g.perms),[]);

function openFeedbackModal(type){
  _feedbackType=type;
  _feedbackRating=0;
  const titles={rate:'Rate the App',feedback:'Send Feedback',bug:'Report a Bug'};
  const subs={rate:'How would you rate SoCloudyBro?',feedback:'Share your thoughts, ideas or suggestions.',bug:'Describe the issue and how to reproduce it.'};
  document.getElementById('feedback-modal-title').textContent=titles[type]||'Feedback';
  document.getElementById('feedback-modal-sub').textContent=subs[type]||'';
  const body=document.getElementById('feedback-modal-body');
  let html='';
  if(type==='rate'){
    html+=`<div style="text-align:center;margin-bottom:14px">
      <div id="fb-stars" style="font-size:32px;cursor:pointer;letter-spacing:4px;user-select:none">
        ${[1,2,3,4,5].map(i=>`<span class="fb-star" data-v="${i}" onclick="setFeedbackRating(Number(this.dataset.v))" onmouseover="hoverFbStar(Number(this.dataset.v))" onmouseout="resetFbStars()" style="opacity:.3;transition:opacity .1s">★</span>`).join('')}
      </div>
      <div id="fb-rating-label" style="font-size:12px;color:var(--muted);margin-top:6px;height:16px"></div>
    </div>`;
  }
  if(type==='bug'){
    html+=`<div style="margin-bottom:10px">
      <label style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em">Error code (optional)</label>
      <input id="fb-errcode" type="text" placeholder="e.g. SCB-CHAT-07" style="margin-top:4px;font-size:13px"/>
    </div>`;
  }
  html+=`<div>
    <label style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em">${type==='bug'?'Description':'Your message'}</label>
    <textarea id="fb-text" placeholder="${type==='bug'?'Describe the bug and steps to reproduce…':'What\'s on your mind?'}" style="margin-top:4px;min-height:90px;font-size:13px;resize:vertical"></textarea>
  </div>`;
  body.innerHTML=html;
  openModal('feedback-modal');
}

const _ratingLabels=['','Terrible','Not great','It\'s okay','Pretty good','Amazing!'];
function setFeedbackRating(v){
  _feedbackRating=v;
  resetFbStars();
  document.getElementById('fb-rating-label').textContent=_ratingLabels[v]||'';
}
function hoverFbStar(v){
  document.querySelectorAll('.fb-star').forEach(s=>{s.style.opacity=Number(s.dataset.v)<=v?'1':'0.3';});
}
function resetFbStars(){
  document.querySelectorAll('.fb-star').forEach(s=>{s.style.opacity=Number(s.dataset.v)<=_feedbackRating?'1':'0.3';});
}

async function submitFeedback(){
  const btn=document.getElementById('feedback-submit-btn');
  const text=(document.getElementById('fb-text')||{}).value||'';
  const errCode=(document.getElementById('fb-errcode')||{}).value||'';
  if(_feedbackType==='rate'&&!_feedbackRating){showToast('Pick a rating','Tap a star to rate the app.');return;}
  if(!text.trim()&&_feedbackType!=='rate'){showToast('Empty message','Please write something before sending.');return;}
  btn.disabled=true;btn.textContent='Sending…';
  try{
    const id=Date.now()+'_'+(me?me.number:'anon');
    await fbdb.ref(FEEDBACK_PATH+'/'+id).set({
      type:_feedbackType,
      from:me?me.number:0,
      fromName:me?dec(me.name):'',
      text:text.trim(),
      rating:_feedbackRating||null,
      errorCode:errCode.trim()||null,
      time:Date.now(),
      status:'new'
    });
    closeModal('feedback-modal');
    showToast('Thank you!',_feedbackType==='rate'?'Your rating has been recorded.':_feedbackType==='bug'?'Bug report submitted.':'Feedback sent successfully.');
  }catch(e){
    showToast('Error','Could not send — please try again.');
  }
  btn.disabled=false;btn.textContent='Send';
}

// ── ADMIN FEEDBACK TAB ────────────────────────────────────────────────────────
async function renderAdminFeedbackTab(){
  const body=document.getElementById('admin-dashboard-body');
  if(!hasPermission('feedback_view')&&me&&me.number!==ADMIN_NUMBER){
    if(body) body.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted)">You don\'t have permission to view this section.</div>';
    return;
  }
  body.innerHTML='<div style="padding:10px;color:var(--muted)">Loading…</div>';
  try{
    const snap=await fbdb.ref(FEEDBACK_PATH).get();
    const items=[];
    snap.forEach(c=>{const v=c.val();if(v&&v.time) items.push({id:c.key,...v});});
    items.sort((a,b)=>(b.time||0)-(a.time||0));
    if(items.length>100) items.length=100;
    if(!items.length){body.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted)">No feedback yet.</div>';return;}
    const typeIcons={rate:'⭐',feedback:'💬',bug:'🐛'};
    const statusColor={new:'var(--accent)',reviewed:'var(--muted)',resolved:'var(--success)'};
    body.innerHTML=`
      <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm fb-filter-btn active" data-filter="all" onclick="filterFeedbackAdmin(this,'all')">All (${items.length})</button>
        <button class="btn btn-ghost btn-sm fb-filter-btn" data-filter="rate" onclick="filterFeedbackAdmin(this,'rate')">⭐ Ratings</button>
        <button class="btn btn-ghost btn-sm fb-filter-btn" data-filter="feedback" onclick="filterFeedbackAdmin(this,'feedback')">💬 Feedback</button>
        <button class="btn btn-ghost btn-sm fb-filter-btn" data-filter="bug" onclick="filterFeedbackAdmin(this,'bug')">🐛 Bugs</button>
        <button class="btn btn-ghost btn-sm fb-filter-btn" data-filter="new" onclick="filterFeedbackAdmin(this,'new')">🆕 New</button>
      </div>
      <div id="fb-admin-list">
        ${items.map(item=>`
          <div class="fb-admin-card" data-type="${item.type}" data-status="${item.status||'new'}" style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--r-sm);padding:10px 12px;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:16px">${typeIcons[item.type]||'📝'}</span>
              <span style="font-weight:600;font-size:13px;flex:1">${item.fromName?esc(item.fromName):'User #'+item.from} ${item.type==='rate'&&item.rating?'<span style="color:#f5c542">'+('★').repeat(item.rating)+'</span>':''}</span>
              <span style="font-size:10px;color:${statusColor[item.status||'new']||'var(--muted)'};font-weight:600;text-transform:uppercase;letter-spacing:.04em">${item.status||'new'}</span>
              <span style="font-size:10px;color:var(--muted)">${new Date(item.time).toLocaleString()}</span>
            </div>
            ${item.errorCode?`<div style="font-size:11px;color:var(--muted);margin-bottom:4px">Error: <code style="color:var(--text2)">${esc(item.errorCode)}</code></div>`:''}
            ${item.text?`<div style="font-size:13px;color:var(--text2);margin-bottom:8px;white-space:pre-wrap;word-break:break-word">${esc(item.text)}</div>`:''}
            ${item.adminReply?`<div style="font-size:12px;background:var(--surface2);border-left:3px solid var(--accent);padding:6px 8px;border-radius:0 var(--r-xs) var(--r-xs) 0;margin-bottom:8px;white-space:pre-wrap;word-break:break-word"><b style="color:var(--accent)">Admin replied:</b> ${esc(item.adminReply)}</div>`:''}
            ${hasPermission('feedback_manage')?`<div style="display:flex;gap:6px;flex-wrap:wrap">
              ${item.status!=='reviewed'?`<button class="btn btn-ghost btn-sm" data-id="${esc(item.id)}" onclick="setFeedbackStatus(this.dataset.id,'reviewed')">Mark Reviewed</button>`:''}
              ${item.status!=='resolved'?`<button class="btn btn-ghost btn-sm" style="color:var(--success)" data-id="${esc(item.id)}" onclick="setFeedbackStatus(this.dataset.id,'resolved')">✓ Resolve</button>`:''}
              <button class="btn btn-ghost btn-sm" data-id="${esc(item.id)}" data-name="${esc(item.fromName||'User #'+item.from)}" onclick="replyToFeedback(this.dataset.id,this.dataset.name)">↩ Reply</button>
            </div>`:''}
          </div>
        `).join('')}
      </div>`;
  }catch(e){body.innerHTML='<div style="padding:20px;color:var(--danger)">Failed to load feedback.</div>';}
}

function filterFeedbackAdmin(btn,filter){
  document.querySelectorAll('.fb-filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#fb-admin-list .fb-admin-card').forEach(card=>{
    const show=filter==='all'||card.dataset.type===filter||card.dataset.status===filter;
    card.style.display=show?'':'none';
  });
}

async function setFeedbackStatus(id,status){
  if(!requirePermission('feedback_manage')) return;
  try{await fbdb.ref(FEEDBACK_PATH+'/'+id+'/status').set(status);renderAdminFeedbackTab();}
  catch(e){showToast('Error','Could not update status.');}
}

function replyToFeedback(id,name){
  if(!requirePermission('feedback_manage')) return;
  const reply=prompt('Reply to '+name+':');
  if(!reply) return;
  fbdb.ref(FEEDBACK_PATH+'/'+id).update({adminReply:reply,status:'reviewed'})
    .then(()=>renderAdminFeedbackTab())
    .catch(()=>showToast('Error','Could not send reply.'));
}

// ── PERMISSION EDITOR (in admin Users tab) ───────────────────────────────────
function openPermissionEditor(userNum,userName,currentPerms,currentRoleTag){
  const permsArr=Array.isArray(currentPerms)?currentPerms:[];
  const roleTagField=`
    <div style="margin-bottom:14px">
      <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);display:block;margin-bottom:4px">Role tag <span style="font-weight:400;text-transform:none">(shown next to their name, any text — e.g. "Support", "General Manager (France)", "Tester 7")</span></label>
      <input type="text" id="perm-role-tag" value="${esc(currentRoleTag||'')}" placeholder="e.g. Assistant Head Admin" maxlength="60">
    </div>
    <div style="margin-bottom:14px">
      <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);display:block;margin-bottom:4px">Access expires</label>
      <select id="perm-expires">
        <option value="">Never (standing access)</option>
        <option value="7">In 7 days</option>
        <option value="30">In 30 days</option>
        <option value="90">In 90 days</option>
      </select>
    </div>`;
  const rows=ADMIN_PERMS.map(g=>`
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:14px 0 4px">${esc(g.group)}</div>
    ${g.perms.map(p=>`
    <label style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer">
      <input type="checkbox" data-perm="${p.id}" ${permsArr.includes(p.id)?'checked':''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)"/>
      <span style="font-size:13px">${p.label}</span>
    </label>`).join('')}`).join('');
  const html=`
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px">
      Granting admin panel access to <b style="color:var(--text)">${esc(userName)}</b> (#${userNum}). Full admin (you) always has all permissions. This is the complete list of permissions that can be delegated.
    </div>
    <div style="font-size:11px;color:var(--warn);background:var(--warn-soft);border-radius:var(--r-sm);padding:8px 10px;margin-bottom:10px">⚠️ Nuclear Reset, the Firebase Rules Manager, and Data Cleanup can never be granted — those stay restricted to the primary admin account no matter what's checked below.</div>
    ${roleTagField}
    ${rows}
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      <button class="btn" data-number="${userNum}" onclick="savePermissions(Number(this.dataset.number))">Save Access</button>
      <button class="btn btn-ghost" style="color:var(--danger)" data-number="${userNum}" onclick="revokeAllPermissions(Number(this.dataset.number))">Revoke All Access</button>
      <button class="btn btn-ghost" onclick="closeModal('perm-editor-modal')">Cancel</button>
    </div>`;
  let m=document.getElementById('perm-editor-modal');
  if(!m){
    m=document.createElement('div');m.className='overlay';m.id='perm-editor-modal';
    m.innerHTML='<div class="modal" style="max-width:400px"><div class="modal-header"><h2>Manage Access</h2></div><div class="modal-body" id="perm-editor-body"></div></div>';
    m.addEventListener('click',e=>{if(e.target===m)closeModal('perm-editor-modal');});
    document.body.appendChild(m);
  }
  document.getElementById('perm-editor-body').innerHTML=html;
  openModal('perm-editor-modal');
}

async function savePermissions(userNum){
  if(!requireAdmin()) return;
  const checked=[...document.querySelectorAll('#perm-editor-body input[data-perm]:checked')].map(i=>i.dataset.perm);
  const roleTagEl=document.getElementById('perm-role-tag');
  const roleTag=(roleTagEl?roleTagEl.value:'').trim().slice(0,60);
  const expiresEl=document.getElementById('perm-expires');
  const expiresDays=expiresEl&&expiresEl.value?Number(expiresEl.value):null;
  const expiresAt=expiresDays?Date.now()+expiresDays*86400000:null;
  try{
    const usersSnap=await fbdb.ref('users').orderByChild('number').equalTo(userNum).get();
    let uid=null;usersSnap.forEach(c=>{uid=c.key;});
    if(!uid){showToast('Error','User not found.');return;}
    // A role tag with no permissions still means something (e.g. "Head
    // Tester" might only need to see things, not act on them), so it's
    // preserved even when `checked` is empty rather than only writing
    // adminAccess when permissions exist.
    await fbdb.ref('users/'+uid+'/adminAccess').set((checked.length||roleTag)?{permissions:checked,roleTag:roleTag||null,expiresAt}:null);
    _logAdminAction('set_permissions','#'+userNum+': '+(checked.length?checked.join(', '):'(none)')+(roleTag?' · tag: '+roleTag:'')+(expiresAt?' · expires '+new Date(expiresAt).toLocaleDateString():'')).catch(()=>{});
    closeModal('perm-editor-modal');
    showToast('Saved','Admin access updated for user #'+userNum+'.');
    renderAdminUsersTab();
  }catch(e){showToast('Error','Could not save permissions.');}
}

async function revokeAllPermissions(userNum){
  if(!requireAdmin()) return;
  if(!confirm('Remove ALL admin access from user #'+userNum+'?')) return;
  try{
    const usersSnap=await fbdb.ref('users').orderByChild('number').equalTo(userNum).get();
    let uid=null;usersSnap.forEach(c=>{uid=c.key;});
    if(!uid){showToast('Error','User not found.');return;}
    await fbdb.ref('users/'+uid+'/adminAccess').remove();
    _logAdminAction('revoke_permissions','#'+userNum).catch(()=>{});
    closeModal('perm-editor-modal');
    showToast('Done','Admin access revoked.');
    renderAdminUsersTab();
  }catch(e){showToast('Error','Could not revoke permissions.');}
}

// ── LIVE CODE UPDATER ─────────────────────────────────────────────────────────
// Saves the full site HTML to Firebase so admin can push updates without
// a Vercel redeploy. Connected users get a "new version" banner and reload
// into the updated HTML served from Firebase / localStorage cache.
const ADMIN_SITE_PATH = 'admin_site';

async function renderAdminCodeTab(){
  if(!requirePermission('code_update')) return;
  const body=document.getElementById('admin-dashboard-body');
  body.innerHTML='<div style="padding:10px;color:var(--muted)">Loading…</div>';
  try{
    const snap=await fbdb.ref(ADMIN_SITE_PATH).get();
    const val=snap.val()||{};
    const currentVer=val.version||0;
    const updatedAt=val.updated_at?new Date(val.updated_at).toLocaleString():'never';
    const note=val.note||'';
    body.innerHTML=`
      <div style="padding:4px 0 10px;font-size:11px;color:var(--muted)">
        Current live version: <b style="color:var(--text)">${currentVer>0?'v'+currentVer:'(built-in, no override)'}</b>
        &nbsp;·&nbsp; Last updated: <b style="color:var(--text)">${updatedAt}</b>
        ${note?`&nbsp;·&nbsp; Note: <i>${esc(note)}</i>`:''}
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="adminCodeFetchPage()">📋 Use current page HTML</button>
        <button class="btn btn-ghost btn-sm" onclick="adminCodeFetchFirebase()">☁️ Load from Firebase</button>
        ${currentVer>0?`<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="adminCodeClearOverride()">✕ Clear override (revert to built-in)</button>`:''}
      </div>
      <div style="margin-bottom:6px">
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-weight:600">Version note (optional)</label>
        <input id="admin-code-note" type="text" placeholder="e.g. Fixed call bug, added dark mode" value="${esc(note)}" style="margin-top:4px;font-size:12px"/>
      </div>
      <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-weight:600">HTML source</label>
      <textarea id="admin-code-editor"
        placeholder="Paste the full site HTML here, or click 'Use current page HTML' above…"
        style="width:100%;height:260px;font-family:monospace;font-size:11px;background:var(--bg);color:var(--text);border:1px solid var(--border2);border-radius:var(--r-sm);padding:8px;box-sizing:border-box;resize:vertical;margin-top:4px;tab-size:2;white-space:pre;overflow:auto"></textarea>
      <div id="admin-code-status" style="min-height:18px;font-size:11px;margin-top:4px;color:var(--muted)"></div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="adminCodePublish(this)">🚀 Save to Firebase &amp; notify users</button>
        <button class="btn btn-ghost btn-sm" onclick="adminCodePreview()">👁 Preview in new tab</button>
      </div>
      <div style="margin-top:14px;padding:10px 12px;background:var(--surface2);border-radius:var(--r-sm);font-size:11px;color:var(--muted);line-height:1.6">
        <b style="color:var(--text2)">How it works:</b> Paste the updated HTML, click Save. Connected users get a "New version available" banner.
        When they reload, the browser serves the new HTML from its local cache — no Vercel deploy needed.
        To revert everyone to the Vercel-deployed version, click "Clear override".
      </div>
    `;
  }catch(e){
    body.innerHTML='<div style="padding:10px;color:var(--danger)">'+esc(scbErr('SCB-ADMIN-20','Code editor failed to load.',(e.message||'')))+'</div>';
  }
}

function adminCodeFetchPage(){
  const ta=document.getElementById('admin-code-editor');
  const st=document.getElementById('admin-code-status');
  if(!ta) return;
  try{
    ta.value='<!DOCTYPE html>\n'+document.documentElement.outerHTML;
    st.textContent='✓ Loaded '+Math.round(ta.value.length/1024)+'KB from current page DOM.';
    st.style.color='var(--success)';
  }catch(e){ st.textContent='Could not capture page HTML: '+e.message; st.style.color='var(--danger)'; }
}

async function adminCodeFetchFirebase(){
  const ta=document.getElementById('admin-code-editor');
  const st=document.getElementById('admin-code-status');
  if(!ta) return;
  try{
    st.textContent='Loading from Firebase…'; st.style.color='var(--muted)';
    const snap=await fbdb.ref(ADMIN_SITE_PATH+'/html').get();
    const html=snap.val()||'';
    if(!html){ st.textContent='No override stored in Firebase yet.'; return; }
    ta.value=html;
    st.textContent='✓ Loaded '+Math.round(html.length/1024)+'KB from Firebase.';
    st.style.color='var(--success)';
  }catch(e){ st.textContent='Firebase load failed: '+e.message; st.style.color='var(--danger)'; }
}

async function adminCodePublish(btn){
  if(!requirePermission('code_update')) return;
  const ta=document.getElementById('admin-code-editor');
  const noteEl=document.getElementById('admin-code-note');
  const st=document.getElementById('admin-code-status');
  if(!ta||!ta.value.trim()){ if(st){ st.textContent='Paste or load HTML first.'; st.style.color='var(--danger)'; } return; }
  const html=ta.value.trim();
  if(html.length>9*1024*1024){ st.textContent='File too large (>9MB). Reduce size before saving.'; st.style.color='var(--danger)'; return; }
  if(btn){ btn.disabled=true; btn.textContent='Saving…'; }
  try{
    const snap=await fbdb.ref(ADMIN_SITE_PATH+'/version').get();
    const newVer=(snap.val()||0)+1;
    // update(), never set(): the same node holds reserved numbers, feature flags
    // and the audit log.
    await fbdb.ref(ADMIN_SITE_PATH).update({
      version:newVer,
      html:html,
      note:(noteEl&&noteEl.value.trim())||'',
      updated_at:Date.now(),
      updated_by:me.number
    });
    // Cache locally too so the admin sees the new version immediately
    try{ localStorage.setItem('scb_site_version',String(newVer)); localStorage.setItem('scb_site_html',html); }catch(e2){}
    if(st){ st.textContent='✓ v'+newVer+' saved to Firebase. Users will see a "Reload" banner.'; st.style.color='var(--success)'; }
    showToast('Code published','v'+newVer+' is live in Firebase. Users will be prompted to reload.');
  }catch(e){
    if(st){ st.textContent='Save failed: '+e.message; st.style.color='var(--danger)'; }
    showToast('Publish failed',e.message||'Firebase rejected the write.');
  }finally{ if(btn){ btn.disabled=false; btn.textContent='🚀 Save to Firebase & notify users'; } }
}

async function adminCodeClearOverride(){
  if(!requirePermission('code_update')) return;
  if(!confirm('Clear the Firebase override? All users will reload into the original Vercel-deployed version.')) return;
  try{
    // Clear only the override fields. Removing the node would take the other
    // admin data with it.
    await fbdb.ref(ADMIN_SITE_PATH).update({html:null,version:null,note:null,updated_at:null,updated_by:null});
    try{ localStorage.removeItem('scb_site_version'); localStorage.removeItem('scb_site_html'); }catch(e2){}
    showToast('Override cleared','Users will reload into the built-in version.');
    renderAdminCodeTab();
  }catch(e){ showToast('Failed',e.message||''); }
}

function adminCodePreview(){
  const ta=document.getElementById('admin-code-editor');
  if(!ta||!ta.value.trim()){ showToast('Nothing to preview','Load or paste HTML first.'); return; }
  const blob=new Blob([ta.value],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  window.open(url,'_blank','noopener,noreferrer');
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

// Called after Firebase is initialized — checks if a newer version is stored
async function checkForSiteUpdate(){
  try{
    fbdb.ref(ADMIN_SITE_PATH+'/version').on('value',snap=>{
      const remoteVer=snap.val()||0;
      if(!remoteVer) return;
      const localVer=Number(localStorage.getItem('scb_site_version')||'0');
      if(remoteVer>localVer){
        // Fetch the new HTML and cache it, then show the banner
        fbdb.ref(ADMIN_SITE_PATH).get().then(s=>{
          const d=s.val()||{};
          if(!d.html) return;
          try{ localStorage.setItem('scb_site_version',String(remoteVer)); localStorage.setItem('scb_site_html',d.html); }catch(e){}
          showSiteUpdateBanner(remoteVer,d.note||'');
        }).catch(()=>{});
      }
    },err=>{ console.warn('site version listener error',err); });
  }catch(e){}
}

function _siteUpdateShouldWait(){
  try{
    const t=document.getElementById('tutorial-overlay');
    if(t && t.style.display==='flex') return true;
    if(typeof _modalZStack!=='undefined' && _modalZStack.length) return true;
    const a=document.activeElement;
    if(a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && String(a.value||'').trim()) return true;
    const mi=document.getElementById('msg-input');
    if(mi && String(mi.value||'').trim()) return true;
  }catch(e){}
  return false;
}
function showSiteUpdateBanner(ver,note){
  if(document.getElementById('site-update-banner')) return;
  const bar=_bannerRow('site-update-banner');
  bar.style.background='var(--accent)';
  const totalSecs=8; let secs=totalSecs;
  bar.innerHTML='<span class="tbr-text">🚀 Update available'+(note?' — '+esc(note):'')+' — applying in <b id="sub-countdown">'+secs+'s</b></span>'+
    '<button id="sub-apply" class="tbr-btn tbr-btn-ghost">Apply now</button>'+
    '<button id="sub-dismiss" class="tbr-dismiss">✕</button>'+
    '<div class="tbr-progress"><span class="tbr-progress-fill" id="sub-progress-fill" style="width:100%"></span></div>';
  _updateBannerStackHeight();
  const cd=document.getElementById('sub-countdown');
  const fill=document.getElementById('sub-progress-fill');
  const applyBtn=document.getElementById('sub-apply');
  if(applyBtn) applyBtn.onclick=applySiteUpdate;
  const timer=setInterval(()=>{
    secs--;
    if(cd) cd.textContent=secs+'s';
    if(fill) fill.style.width=Math.max(0,(secs/totalSecs)*100)+'%';
    if(secs<=0){
      // Reloading mid-tour, mid-dialog or mid-message would throw the user's
      // context away, so hold the update until they are not busy.
      if(_siteUpdateShouldWait()){ secs=1; if(cd) cd.textContent='after you finish'; return; }
      clearInterval(timer); applySiteUpdate();
    }
  },1000);
  const dismiss=document.getElementById('sub-dismiss');
  if(dismiss) dismiss.onclick=()=>{ clearInterval(timer); _removeBannerRow('site-update-banner'); };
}

// Applies a pending site update with a real reload. The old approach rewrote the
// open page in place (document.open/write), but that keeps the old page's globals
// and its Firebase connection alive, so the new scripts half-start: the sidebar
// stays on "Set up account", the database never connects, and the page also keeps
// the old page's security policy. A reload starts clean. Vercel serves the new
// build, but it can lag the Firebase copy by a minute, so wait (up to ~60s) until
// the served page matches the update before reloading.
let _applyingSiteUpdate=false;
async function applySiteUpdate(){
  if(_applyingSiteUpdate) return;
  _applyingSiteUpdate=true;
  let html='';
  try{ html=localStorage.getItem('scb_site_html')||''; }catch(e){}
  let ready=!html;
  for(let i=0;i<12&&!ready;i++){
    try{
      const r=await fetch(location.pathname||'/',{cache:'no-store'});
      const t=await r.text();
      ready=(t.length===html.length);
    }catch(e){}
    if(!ready) await new Promise(function(res){ setTimeout(res,5000); });
  }
  try{ localStorage.removeItem('scb_site_html'); }catch(e){}
  location.reload();
}
// Weekly digest: sends a real email via the same Web3Forms mechanism already
// used for user reports (see sendWeb3Form above) — reusing exactly that pattern
// since Web3Forms is tied to one fixed destination (the admin's own inbox) and
// can't dynamically target anyone else. Honest limitation: there's no server or
// cron job here, so this can't fire on a real schedule by itself. It's a
// "send now" action, plus a lightweight check (see maybeAutoSendWeeklyDigest
// below) that fires it automatically if a week has passed AND the admin
// happens to have the dashboard open — not a substitute for real automation,
// but useful without needing a backend.
async function sendAdminWeeklyDigest(btn){
  if(!requirePermission('digest_send')) return;
  if(btn){ btn.disabled=true; btn.textContent='Sending…'; }
  try{
    const [users,convData,reports]=await Promise.all([getUsers(),getBin(CONVOS_BIN).catch(()=>({})),getReports().catch(()=>[])]);
    const convos=(convData&&convData.conversations||[]).filter(Boolean);
    const now=Date.now(), weekMs=7*86400000;
    const activeWeek=users.filter(u=>u.lastSeen&&(now-u.lastSeen)<weekMs).length;
    const newWeek=users.filter(u=>u.createdAt&&(now-u.createdAt)<weekMs).length;
    const messagesWeek=convos.reduce((sum,c)=>sum+((c.messages||[]).filter(m=>m&&m.time&&(now-m.time)<weekMs).length),0);
    const reportsOpen=(reports||[]).filter(r=>r.status!=='resolved').length;
    const topReports=(reports||[]).filter(r=>r.status!=='resolved').slice(0,5)
      // <br>-joined rather than \n-joined: this value is dropped into an HTML
      // email template on the Web3Forms dashboard, where newlines collapse.
      .map(r=>`• ${r.reportedName||'Unknown'} (#${r.reportedNumber||'?'}): ${r.reason||'no reason given'}`).join('<br>')||'None';

    // Sent as structured fields (not one flat `message` blob) so the Weekly
    // Digest email template's {{merge_tags}} on the Web3Forms dashboard
    // actually populate — same shape as the report submission above. The field
    // names here MUST match the merge tags in that template exactly.
    await sendWeb3Form({
      subject:'SoCloudyBro Weekly Digest',
      total_users:users.length,
      active_week:activeWeek,
      new_week:newWeek,
      messages_week:messagesWeek,
      reports_open:reportsOpen,
      top_reports:topReports,
      time:new Date().toLocaleString(),
      // Additive field, same reasoning as the report email above — the
      // existing merge-tag fields are untouched so any custom Web3Forms
      // dashboard template already wired to them keeps working.
      summary_html:_scbEmailCard({
        emoji:'📊', title:'Weekly Digest', accentColor:'#4C46C4',
        rows:[
          {label:'Total users',value:users.length},
          {label:'Active this week',value:activeWeek},
          {label:'New this week',value:newWeek},
          {label:'Messages this week',value:messagesWeek},
          {label:'Open reports',value:reportsOpen},
          {label:'Top open reports',value:topReports,html:true},
        ],
        footerNote:'Generated '+new Date().toLocaleString(),
      }),
    });
    localStorage.setItem('cc_last_digest_sent',String(Date.now()));
    const statusEl=document.getElementById('last-digest-sent-text');
    if(statusEl) statusEl.textContent=new Date().toLocaleString();
    showToast('Digest sent','Check the admin inbox.');
  }catch(e){
    showToast('Failed to send digest',scbErr('SCB-ADMIN-14','The weekly digest couldn\'t be sent — the email service rejected the request.',(e.message||'')));
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='📧 Send weekly digest now'; }
  }
}
// Best-effort auto-send: called once during admin launch (see checkAdminPanel),
// fires the same digest above without user interaction if 7+ days have passed
// since the last one. Only actually sends anything if the admin's own browser
// happens to load the app around that time — see the honesty note above.
async function maybeAutoSendWeeklyDigest(){
  const last=Number(localStorage.getItem('cc_last_digest_sent')||0);
  if(Date.now()-last<7*86400000) return;
  try{ await sendAdminWeeklyDigestSilent(); }catch(e){ console.error('Auto digest failed:',e); }
}
async function sendAdminWeeklyDigestSilent(){
  if(!requireAdmin(true)) return;
  const [users,convData,reports]=await Promise.all([getUsers(),getBin(CONVOS_BIN).catch(()=>({})),getReports().catch(()=>[])]);
  const convos=(convData&&convData.conversations||[]).filter(Boolean);
  const now=Date.now(), weekMs=7*86400000;
  const activeWeek=users.filter(u=>u.lastSeen&&(now-u.lastSeen)<weekMs).length;
  const newWeek=users.filter(u=>u.createdAt&&(now-u.createdAt)<weekMs).length;
  const messagesWeek=convos.reduce((sum,c)=>sum+((c.messages||[]).filter(m=>m&&m.time&&(now-m.time)<weekMs).length),0);
  const reportsOpen=(reports||[]).filter(r=>r.status!=='resolved').length;
  const topReports=(reports||[]).filter(r=>r.status!=='resolved').slice(0,5)
    .map(r=>`• ${r.reportedName||'Unknown'} (#${r.reportedNumber||'?'}): ${r.reason||'no reason given'}`).join('<br>')||'None';
  // Structured fields, matching the Weekly Digest template's merge tags — see
  // the comment in sendAdminWeeklyDigest().
  await sendWeb3Form({
    subject:'SoCloudyBro Weekly Digest (auto)',
    from_name:'SoCloudyBro System',
    total_users:users.length,
    active_week:activeWeek,
    new_week:newWeek,
    messages_week:messagesWeek,
    reports_open:reportsOpen,
    top_reports:topReports,
    time:new Date().toLocaleString()
  });
  localStorage.setItem('cc_last_digest_sent',String(Date.now()));
}
// CSV export of the full moderation log (all reports, resolved or not).
/* ===== ADMIN ACTION AUDIT LOG + ENCRYPTED EXPORT (security feature 45/32) =====
   A centralized, append-only log of admin actions (who, what, on whom,
   when) — admin_site/audit_log, written via push() with no delete UI
   anywhere, same append-only-in-practice pattern as self_destructed_log.
   exportEncryptedAuditLog() seals a point-in-time snapshot of it with a
   password the exporter chooses, using the exact same PBKDF2+AES-GCM
   .scbenc packing exportAllDataEncrypted() already uses — once exported,
   that sealed copy can't be quietly edited without the password, which is
   the actual protection this delivers. It does not make the LIVE Firebase
   log tamper-proof on its own (this app has no backend to enforce that);
   what it gives is a verifiable sealed snapshot an admin can hand to
   someone else for review. ===== */
async function _logAdminAction(action,detail){
  if(!me) return;
  try{
    // .push() isn't covered by the global Firebase timeout guard (see its
    // installer comment near `const fbdb=...` — push() with no argument has
    // to stay synchronous), so a push that includes data, like this one,
    // needs its own guard at the call site instead.
    await _withFirebaseTimeout(fbdb.ref('admin_site/audit_log').push({
      admin:me.number, adminName:me.name||'', action, detail:detail||'', at:Date.now(),
    }),'Admin audit log write',10000);
  }catch(e){ console.warn('Admin audit log write failed (non-fatal):',e.message); }
}
async function exportEncryptedAuditLog(){
  if(me.number!==ADMIN_NUMBER){ showToast('Admins only',''); return; }
  const pwd=prompt('Enter a password to encrypt this audit log export:\n(You will need this to decrypt it later — there is no recovery.)');
  if(!pwd||!pwd.trim()) return;
  if(pwd.length<6){ showToast('Too short','Use at least 6 characters.'); return; }
  try{
    // Same as renderAdminAuditLog: push() keys are chronological so
    // limitToLast without orderByChild needs no .indexOn rule.
    const snap=await fbdb.ref('admin_site/audit_log').limitToLast(1000).get();
    const entries=[];
    if(snap.exists()) snap.forEach(child=>entries.push({_key:child.key,...child.val()}));
    entries.sort((a,b)=>a.at-b.at);
    const data={exportedAt:new Date().toISOString(),exportedBy:me.number,app:'SoCloudyBro',type:'admin_audit_log',entries};
    const plaintext=new TextEncoder().encode(JSON.stringify(data,null,2));
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const keyMat=await crypto.subtle.importKey('raw',new TextEncoder().encode(pwd),{name:'PBKDF2'},false,['deriveKey']);
    const aesKey=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:200000,hash:'SHA-256'},keyMat,{name:'AES-GCM',length:256},false,['encrypt']);
    const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},aesKey,plaintext);
    const magic=new Uint8Array([0x53,0x43,0x42,0x01]);
    const out=new Uint8Array(magic.length+salt.length+iv.length+ct.byteLength);
    let off=0;out.set(magic,off);off+=magic.length;out.set(salt,off);off+=salt.length;out.set(iv,off);off+=iv.length;out.set(new Uint8Array(ct),off);
    const blob=new Blob([out],{type:'application/octet-stream'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='scb-audit-log-'+Date.now()+'.scbenc';document.body.appendChild(a);a.click();a.remove();
    showToast('Encrypted audit log ready','Saved as .scbenc — keep your password safe, there is no recovery.');
  }catch(e){ showToast('Export failed',scbErr('SCB-SEC-31','Encrypted audit log export failed.',(e.message||''))); }
}
function exportModerationLogCsv(){
  if(!requirePermission('moderation_export')) return;
  (async()=>{
    try{
      const reports=await getReports();
      if(!reports||!reports.length){ showToast('Nothing to export',scbErr('SCB-ADMIN-15','No reports on file.')); return; }
      const header='ID,Reported Name,Reported Number,Reporter Name,Reporter Number,Reason,Status,Date\n';
      const rows=reports.map(r=>{
        const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
        return [r.id,r.reportedName,r.reportedNumber,r.reporterName,r.reporterNumber,r.reason,r.status,new Date(r.time||0).toISOString()].map(esc).join(',');
      }).join('\n');
      const blob=new Blob([header+rows],{type:'text/csv'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download=`moderation_log_${Date.now()}.csv`;
      a.click();
    }catch(e){ showToast('Export failed',scbErr('SCB-ADMIN-16','The reports export couldn\'t be built — reading or downloading the data failed.',(e.message||''))); }
  })();
}
async function renderAdminOverviewTab(){
  if(!hasPermission('overview')){ const body=document.getElementById('admin-dashboard-body'); if(body) body.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted)">Access denied.</div>'; return; }
  const body=document.getElementById('admin-dashboard-body');
  body.innerHTML='<div style="padding:10px;color:var(--muted)">Loading stats…</div>';
  try{
    const [users,convData,reports]=await Promise.all([getUsers(),getBin(CONVOS_BIN).catch(()=>({})),getReports().catch(()=>[])]);
    const convos=(convData&&convData.conversations||[]).filter(Boolean);
    const now=Date.now();
    const dayMs=86400000;

    const totalUsers=users.length;
    const activeNow=users.filter(u=>isOnline(u.lastSeen)).length;
    const activeToday=users.filter(u=>u.lastSeen&&(now-u.lastSeen)<dayMs).length;
    const activeWeek=users.filter(u=>u.lastSeen&&(now-u.lastSeen)<7*dayMs).length;
    const newToday=users.filter(u=>u.createdAt&&(now-u.createdAt)<dayMs).length;
    const newWeek=users.filter(u=>u.createdAt&&(now-u.createdAt)<7*dayMs).length;
    const pendingDeletions=users.filter(u=>u.pendingDeletion).length;
    const pendingParental=users.filter(u=>u.parentalConsentStatus==='pending').length;

    const dmCount=convos.filter(c=>c.type!=='group').length;
    const groupCount=convos.filter(c=>c.type==='group').length;
    const totalMessages=convos.reduce((sum,c)=>sum+((c.messages||[]).length),0);
    const messagesToday=convos.reduce((sum,c)=>sum+((c.messages||[]).filter(m=>m&&m.time&&(now-m.time)<dayMs).length),0);

    const reportsOpen=(reports||[]).filter(r=>r.status!=='resolved').length;
    const reportsStale=(reports||[]).filter(r=>r.status!=='resolved'&&r.time&&(now-r.time)>dayMs).length;

    const totpCount=users.filter(u=>u.totpEnabled).length;
    const faceMfaCount=users.filter(u=>u.faceMfaEnabled).length;
    const secQCount=users.filter(u=>Array.isArray(u.secQuestions)&&u.secQuestions.length).length;

    const card=(label,value,sub,color)=>`<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:12px 14px">
      <div style="font-size:22px;font-weight:700;${color?`color:${color}`:''}">${value}</div>
      <div style="font-size:11px;color:var(--text2);font-weight:600">${label}</div>
      ${sub?`<div style="font-size:10px;color:var(--muted);margin-top:2px">${sub}</div>`:''}
    </div>`;

    body.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:11px;color:var(--muted)">Live snapshot — refreshes each time you open this tab</div>
        <button class="btn btn-ghost btn-sm" onclick="renderAdminOverviewTab()">↻ Refresh</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px">
        ${card('Online right now',activeNow,`of ${totalUsers} total users`,'var(--success)')}
        ${card('Active today',activeToday,'')}
        ${card('Active this week',activeWeek,'')}
        ${card('New signups today',newToday,`${newWeek} this week`)}
        ${card('Direct messages',dmCount,'')}
        ${card('Groups',groupCount,'')}
        ${card('Total messages',totalMessages.toLocaleString(),`${messagesToday.toLocaleString()} today`)}
        ${card('Open reports',reportsOpen,reportsStale?`${reportsStale} open >24h`:'',reportsStale?'var(--danger)':undefined)}
      </div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:8px">Security adoption</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px">
        ${card('2FA enabled',totpCount,totalUsers?Math.round(totpCount/totalUsers*100)+'% of users':'')}
        ${card('Face MFA enabled',faceMfaCount,totalUsers?Math.round(faceMfaCount/totalUsers*100)+'% of users':'')}
        ${card('Security questions set',secQCount,totalUsers?Math.round(secQCount/totalUsers*100)+'% of users':'')}
        ${pendingDeletions?card('Pending deletions',pendingDeletions,'','var(--warn)'):''}
        ${pendingParental?card('Pending parental approval',pendingParental,'','var(--warn)'):''}
      </div>
      ${(hasPermission('digest_send')||hasPermission('moderation_export'))?`
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${hasPermission('digest_send')?'<button class="btn btn-sm" onclick="sendAdminWeeklyDigest(this)">📧 Send weekly digest now</button>':''}
        ${hasPermission('moderation_export')?'<button class="btn btn-ghost btn-sm" onclick="exportModerationLogCsv()">⬇ Export moderation log (CSV)</button>':''}
      </div>
      ${hasPermission('digest_send')?`<div style="font-size:10px;color:var(--muted);margin-top:8px">Last digest sent: <span id="last-digest-sent-text">${localStorage.getItem('cc_last_digest_sent')?new Date(Number(localStorage.getItem('cc_last_digest_sent'))).toLocaleString():'never'}</span></div>`:''}
      `:''}
      ${me.number===ADMIN_NUMBER?'<div style="margin-top:16px;font-size:11px;color:var(--muted)">Firebase rules, data cleanup, nuclear reset, and other owner-only tools moved to the <b>👑 Owner Tools</b> tab.</div>':''}
    `;
  }catch(e){
    selfHeal('SCB-ADMIN-19', e, { context: 'renderAdminOverviewTab' });
    body.innerHTML='<div style="padding:10px;color:var(--danger)">'+esc(scbErr('SCB-ADMIN-19','The admin stats couldn\'t be loaded.',(e&&e.message)||''))+'</div>';
  }
}
// Owner-exclusive tools, split out of what used to be an Overview-tab
// "Danger Zone" <details> block plus two buttons buried in its export row.
// Pulling these into their own tab (gated owner-only in openAdminDashboard()'s
// visibility map, same as the tab button itself) makes the three-tier model
// — plain user / delegated admin / owner — visible in the panel's structure
// instead of only in which buttons happen to render inside a shared tab.
function renderAdminOwnerToolsTab(){
  const body=document.getElementById('admin-dashboard-body');
  if(me.number!==ADMIN_NUMBER){ if(body) body.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted)">Owner only.</div>'; return; }
  body.innerHTML=`
    <div style="font-size:11px;color:var(--muted);margin-bottom:14px">Visible only to the account that owns this deployment (#${ADMIN_NUMBER}) — not delegated admins.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn btn-ghost btn-sm" onclick="openSelfDestructedLog()">💀 Self-destructed accounts</button>
      <button class="btn btn-ghost btn-sm" onclick="exportEncryptedAuditLog()">🔒 Export encrypted audit log</button>
    </div>
    <h4 style="margin:0 0 6px;font-size:13px;font-weight:600">🩺 Service Status</h4>
    <div id="admin-service-status" style="margin-bottom:18px;font-size:12px">Checking…</div>
    <h4 style="margin:0 0 6px;font-size:13px;font-weight:600">🧾 Recent Admin Actions</h4>
    <div id="admin-audit-log-list" style="max-height:200px;overflow-y:auto;margin-bottom:18px;font-size:12px"></div>
    <h4 style="margin:0 0 6px;font-size:13px;font-weight:600">🚩 Feature Flags</h4>
    <p style="font-size:11px;color:var(--muted);margin:0 0 10px">Toggle named behaviors on/off instantly — no Vercel redeploy needed. Only features explicitly built to check a flag respond to it; this doesn't retroactively gate everything in the app.</p>
    <div id="admin-feature-flags-list" style="margin-bottom:8px"></div>
    <div style="display:flex;gap:6px;margin-bottom:18px">
      <input type="text" id="admin-new-flag-key" placeholder="new_flag_key" style="flex:1">
      <button class="btn btn-ghost btn-sm" onclick="addFeatureFlag()">+ Add</button>
    </div>
    <details>
      <summary style="cursor:pointer;font-size:12px;font-weight:700;color:var(--danger);padding:8px 0;user-select:none">⚠️ Danger Zone — destructive database tools (click to expand)</summary>
    <div id="admin-rules-section" style="margin-top:16px;">
      <h4 style="margin:0 0 8px;font-size:13px;font-weight:600">Firebase Rules Manager</h4>
      <textarea id="admin-rules-input" placeholder="Paste Firebase Realtime Database rules JSON here..."
        style="width:100%;height:160px;font-family:monospace;font-size:12px;background:#1a1a2e;color:#e0e0e0;border:1px solid #444;border-radius:6px;padding:8px;box-sizing:border-box;resize:vertical;"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button onclick="adminLoadRules()" style="flex:1;padding:8px;background:#2a2a4a;border:1px solid #444;border-radius:6px;color:#ccc;cursor:pointer;">Load Current Rules</button>
        <button onclick="adminPushRules()" style="flex:1;padding:8px;background:#e74c3c;border:none;border-radius:6px;color:#fff;font-weight:700;cursor:pointer;">Push Rules</button>
      </div>
      <div id="admin-heal-log" style="margin-top:8px;font-size:11px;color:#888;font-family:monospace;max-height:80px;overflow-y:auto;white-space:pre-wrap;"></div>
    </div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid #333;">
      <h4 style="margin:0 0 8px;color:#e0e0e0;">Data Cleanup</h4>
      <p style="margin:0 0 10px;font-size:12px;color:#888;">Remove corrupted/orphaned data left by old bugs: pending message flags, cross-account messages, double-encrypted profiles.</p>
      <button onclick="adminCleanFirebase()" style="width:100%;padding:10px;background:#e67e22;border:none;border-radius:6px;color:#fff;font-weight:700;cursor:pointer;font-size:14px;">🧹 Clean Firebase Data</button>
      <button onclick="adminDiagnoseFirebase()" style="width:100%;margin-top:8px;padding:8px;background:#2a2a4a;border:1px solid #444;border-radius:6px;color:#ccc;cursor:pointer;">🔍 Diagnose Only (no changes)</button>
      <button onclick="adminBackfillMemberSets()" style="width:100%;margin-top:8px;padding:8px;background:#2a2a4a;border:1px solid #444;border-radius:6px;color:#ccc;cursor:pointer;">🔑 Backfill Conversation Member Index</button>
      <p style="margin:6px 0 0;font-size:11px;color:#666;">One-time, safe to re-run: adds a lookup index (memberSet) to every conversation so Firebase rules can enforce "only members can write here" — needed before that rule can actually be turned on. Purely additive; never touches messages or removes anything.</p>
      <button onclick="adminMigrateReportsAndBlacklist()" style="width:100%;margin-top:8px;padding:8px;background:#2a2a4a;border:1px solid #444;border-radius:6px;color:#ccc;cursor:pointer;">📦 Migrate Reports &amp; Blacklist Storage</button>
      <p style="margin:6px 0 0;font-size:11px;color:#666;">Run this ONCE before pushing the tightened reports/blacklist Firebase rules — converts both from a single array blob to per-entry storage. Safe to re-run (no-op once migrated). Skipping this before the rule update would block ordinary users from filing new reports until it's run.</p>
    </div>
    <div style="margin-top:16px;padding:14px;border:2px solid var(--danger);border-radius:var(--r-sm);background:rgba(220,50,50,0.07)">
      <h4 style="margin:0 0 6px;color:var(--danger);font-size:13px">☢️ Nuclear Reset — Danger Zone</h4>
      <p style="margin:0 0 10px;font-size:12px;color:var(--muted)">Permanently wipes <b>everything</b> from Firebase: all users, messages, conversations, groups, feedback, reports. The app returns to a blank state. <b>This cannot be undone.</b></p>
      <button class="btn btn-danger btn-sm" onclick="adminNuclearReset()">☢️ Wipe Everything &amp; Start Fresh</button>
    </div>
    </details>
  `;
  renderFeatureFlagsList();
  renderAdminAuditLog();
  renderServiceStatus();
}
