// -- SERVICE STATUS ------------------------------------------------------------
// Thin UI wrapper (caching + an in-flight guard, so switching Owner Tools
// tabs repeatedly doesn't repeatedly hit the live, security-sensitive
// Worker endpoint) around the same canonical checks the public System
// Status widget and the admin Diagnostics tab's "Workers" category both
// use (checkFirebasePing(), checkRulesWorker()) — one probe implementation,
// not three independently-maintained copies of the same reachability logic.
let _serviceStatusCache=null, _serviceStatusCacheAt=0, _serviceStatusInFlight=null;
async function renderServiceStatus(force){
  const el=document.getElementById('admin-service-status');
  if(!el) return;
  const row=(label,ok,detail)=>'<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><span>'+(ok===null?'⏳':ok==='yellow'?'🟡':ok?'🟢':'🔴')+'</span><span style="flex:1">'+esc(label)+'</span><span style="color:var(--muted);font-size:11px">'+esc(detail||'')+'</span></div>';
  if(!force&&_serviceStatusCache&&Date.now()-_serviceStatusCacheAt<60000){
    el.innerHTML=row('Firebase Realtime Database',_serviceStatusCache.fbOk,_serviceStatusCache.fbDetail)+row('Firebase Rules Worker',_serviceStatusCache.workerOk,_serviceStatusCache.workerDetail)
      +'<button class="btn btn-ghost btn-sm" style="margin-top:4px" onclick="renderServiceStatus(true)">Re-check now</button>';
    return;
  }
  // A probe already in flight (e.g. the admin flipped tabs and back before
  // the first one resolved) is reused instead of starting a second
  // concurrent hit on the security-sensitive Worker endpoint — the whole
  // point of the cache above, which can't help until the FIRST call has
  // actually finished and populated it.
  if(!force&&_serviceStatusInFlight){ await _serviceStatusInFlight; return renderServiceStatus(false); }
  el.innerHTML=row('Firebase Realtime Database',null,'')+row('Firebase Rules Worker',null,'');
  const probe=Promise.all([
    checkFirebasePing().then(r=>({ok:r.state==='green'?true:r.state==='yellow'?'yellow':false,detail:r.msg})).catch(e=>({ok:false,detail:(e&&e.message)||'unreachable'})),
    checkRulesWorker().then(r=>({ok:r.state==='green'?true:r.state==='yellow'?'yellow':false,detail:r.msg})).catch(e=>({ok:false,detail:(e&&e.message)||'unreachable'})),
  ]);
  _serviceStatusInFlight=probe;
  const [fb,worker]=await probe;
  _serviceStatusInFlight=null;
  _serviceStatusCache={fbOk:fb.ok,fbDetail:fb.detail,workerOk:worker.ok,workerDetail:worker.detail};
  _serviceStatusCacheAt=Date.now();
  el.innerHTML=row('Firebase Realtime Database',fb.ok,fb.detail)+row('Firebase Rules Worker',worker.ok,worker.detail)
    +'<button class="btn btn-ghost btn-sm" style="margin-top:4px" onclick="renderServiceStatus(true)">Re-check now</button>';
}
async function renderAdminAuditLog(){
  const el=document.getElementById('admin-audit-log-list');
  if(!el) return;
  el.innerHTML='<div style="color:var(--muted)">Loading…</div>';
  try{
    // orderByChild('at') requires a .indexOn rule — push() keys are already
    // chronological, so limitToLast on the default key order is equivalent
    // and needs no index. In-memory sort below handles the final ordering.
    const snap=await fbdb.ref('admin_site/audit_log').limitToLast(30).get();
    const entries=[];
    // A malformed/null entry (e.g. a write that got interrupted mid-way)
    // used to crash the whole render via (b.at||0) on null — one bad
    // record then permanently broke this panel for everyone, forever,
    // with no way to tell why. Filtered out instead of trusted blindly.
    if(snap.exists()) snap.forEach(c=>{ const v=c.val(); if(v&&typeof v==='object') entries.push(v); });
    entries.sort((a,b)=>(b.at||0)-(a.at||0));
    if(!entries.length){ el.innerHTML='<div style="color:var(--muted)">No actions logged yet.</div>'; return; }
    el.innerHTML=entries.map(e=>
      '<div style="padding:5px 0;border-bottom:1px solid var(--border)">'
      +'<span style="color:var(--muted)">'+new Date(e.at||0).toLocaleString()+'</span> — '
      +'<b>#'+esc(String(e.admin||'?'))+'</b> '+esc((e.action||'').replace(/_/g,' '))
      +(e.detail?' <span style="color:var(--muted)">('+esc(e.detail)+')</span>':'')
      +'</div>'
    ).join('');
  }catch(e){ el.innerHTML='<div style="color:var(--danger)">Couldn\'t load the audit log — '+esc((e&&e.message)||'unknown error')+'</div>'; }
}
// -- FEATURE FLAGS -----------------------------------------------------------
// Stored at admin_site/feature_flags/<key> (boolean). Loaded once at launch
// (see loadFeatureFlags() in init()) and cached in-memory; isFeatureEnabled()
// reads the cache, never a fresh network call, so gating a feature behind a
// flag costs nothing on the hot path. Owner Tools can flip a flag live —
// every open tab picks it up on its next natural Firebase poll, no redeploy.
let _featureFlagsCache={};
async function loadFeatureFlags(){
  try{
    const snap=await fbdb.ref('admin_site/feature_flags').get();
    _featureFlagsCache=snap.val()||{};
  }catch(e){ console.warn('loadFeatureFlags failed:',e.message); }
}
function isFeatureEnabled(key,defaultValue){
  if(!_featureFlagsCache||typeof _featureFlagsCache[key]==='undefined') return !!defaultValue;
  return !!_featureFlagsCache[key];
}
async function toggleFeatureFlag(key){
  if(!requireAdmin()) return;
  const next=!isFeatureEnabled(key,false);
  try{
    await fbdb.ref('admin_site/feature_flags/'+key).set(next);
    _featureFlagsCache[key]=next;
    renderFeatureFlagsList();
  }catch(e){ showToast('Failed',scbErr('SCB-FLAG-01','That flag couldn\'t be saved — the server rejected the write.',e.message)); }
}
async function addFeatureFlag(){
  if(!requireAdmin()) return;
  const input=document.getElementById('admin-new-flag-key');
  const key=(input.value||'').trim().toLowerCase().replace(/[^a-z0-9_]/g,'_');
  if(!key){ showToast('Enter a key','e.g. quarantine_new_members'); return; }
  try{
    await fbdb.ref('admin_site/feature_flags/'+key).set(false);
    _featureFlagsCache[key]=false;
    input.value='';
    renderFeatureFlagsList();
  }catch(e){ showToast('Failed',scbErr('SCB-FLAG-02','That flag couldn\'t be created — the server rejected the write.',e.message)); }
}
function renderFeatureFlagsList(){
  const list=document.getElementById('admin-feature-flags-list');
  if(!list) return;
  const keys=Object.keys(_featureFlagsCache).sort();
  if(!keys.length){ list.innerHTML='<div style="font-size:12px;color:var(--muted);padding:6px 0">No flags yet — add one below.</div>'; return; }
  list.innerHTML=keys.map(k=>{
    const on=!!_featureFlagsCache[k];
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12.5px;cursor:pointer">'
      +'<input type="checkbox" '+(on?'checked':'')+' data-key="'+esc(k)+'" onchange="toggleFeatureFlag(this.dataset.key)">'
      +'<span style="font-family:monospace">'+esc(k)+'</span>'
      +'<span style="margin-left:auto;color:'+(on?'var(--success)':'var(--muted)')+';font-size:11px">'+(on?'ON':'OFF')+'</span>'
      +'</label>';
  }).join('');
}
// -- USER RECORD VIEWER -------------------------------------------------------
// Pulls the account's full profile plus every report/spam-flag that
// mentions them (either as the target or the one who filed it) into one
// place, instead of an admin having to cross-reference the separate
// Users/Reports/Spam tabs by number manually. Read-only except for the
// admin-notes field, which is a free-text scratchpad for moderators —
// never shown to the account owner, purely internal.
let _adminRecordTargetNumber=null;
async function openUserRecordModal(number){
  if(!hasPermission('users_view')&&!hasPermission('users_ban')&&me.number!==ADMIN_NUMBER){ showToast('Access denied',scbErr('SCB-ADMIN-25','You do not have access to view user records.')); return; }
  _adminRecordTargetNumber=number;
  const body=document.getElementById('admin-record-body');
  document.getElementById('admin-record-title').textContent='📋 User Record — #'+number;
  body.innerHTML='<div style="padding:16px 0;color:var(--muted)">Loading…</div>';
  openModal('admin-user-record-modal');
  try{
    const [users,reportsSnap,flagsSnap]=await Promise.all([
      getUsers(),
      fbdb.ref('reports').get().catch(()=>null),
      fbdb.ref('spam_flags').get().catch(()=>null)
    ]);
    const u=users.find(x=>x.number===number);
    if(!u){ body.innerHTML='<div style="padding:16px 0;color:var(--muted)">No record found for #'+number+'.</div>'; return; }
    const reports=[];
    if(reportsSnap&&reportsSnap.exists()) reportsSnap.forEach(c=>{ const v=c.val(); if(v&&(v.reportedNumber===number||v.reporterNumber===number)) reports.push(v); });
    reports.sort((a,b)=>(b.time||0)-(a.time||0));
    const flags=[];
    if(flagsSnap&&flagsSnap.exists()) flagsSnap.forEach(c=>{ const v=c.val(); if(v&&v.number===number) flags.push(v); });
    flags.sort((a,b)=>(b.at||0)-(a.at||0));

    const fmt=t=>t?new Date(t).toLocaleString():'—';
    let html='';
    html+='<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12.5px;margin:10px 0 14px">';
    html+='<div style="color:var(--muted)">Name</div><div>'+esc(dec(u.name)||'—')+'</div>';
    html+='<div style="color:var(--muted)">Email</div><div>'+esc(u.email||'—')+(u.emailVerified?' ✓':'')+'</div>';
    html+='<div style="color:var(--muted)">Joined</div><div>'+fmt(u.createdAt)+'</div>';
    html+='<div style="color:var(--muted)">Status</div><div>'+(u.banned?'<span style="color:var(--danger)">Banned</span> ':'')+(u.shadowMuted?'<span style="color:var(--warn)">Shadow-muted</span> ':'')+(u.verified?'Verified ':'')+(!u.banned&&!u.shadowMuted?'Active':'')+'</div>';
    html+='<div style="color:var(--muted)">2FA</div><div>'+(u.totpEnabled?'Authenticator app':u.faceMfaEnabled?'Face MFA':'Off')+'</div>';
    html+='<div style="color:var(--muted)">Parent email</div><div>'+esc(u.parentEmail||'—')+(u.parentalConsentStatus?' ('+esc(u.parentalConsentStatus)+')':'')+'</div>';
    html+='</div>';

    html+='<h4 style="margin:14px 0 6px;font-size:12.5px;color:var(--text)">📝 Admin notes <span style="font-weight:400;color:var(--muted)">(internal only, never shown to the user)</span></h4>';
    html+='<textarea id="admin-record-notes" style="min-height:60px" placeholder="Nothing noted yet...">'+esc(u.adminNotes||'')+'</textarea>';
    html+='<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="saveAdminUserNote()">Save note</button>';

    html+='<h4 style="margin:16px 0 6px;font-size:12.5px;color:var(--text)">🚩 Reports ('+reports.length+')</h4>';
    html+=reports.length?reports.map(r=>{
      const dir=r.reportedNumber===number?'against this account':'filed by this account';
      return '<div style="font-size:12px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px">'
        +'<div style="color:var(--muted)">'+fmt(r.time)+' · '+esc(dir)+' · <span style="text-transform:capitalize">'+esc(r.status||'open')+'</span></div>'
        +'<div>'+esc(r.category||'')+(r.reason?': '+esc(r.reason):'')+'</div>'
        +'</div>';
    }).join(''):'<div style="font-size:12px;color:var(--muted)">None.</div>';

    html+='<h4 style="margin:16px 0 6px;font-size:12.5px;color:var(--text)">🤖 Spam flags ('+flags.length+')</h4>';
    html+=flags.length?flags.map(f=>{
      return '<div style="font-size:12px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px">'
        +'<div style="color:var(--muted)">'+fmt(f.at)+' · <span style="text-transform:capitalize">'+esc((f.type||'').replace(/_/g,' '))+'</span>'+(f.resolved?' · resolved':'')+'</div>'
        +'</div>';
    }).join(''):'<div style="font-size:12px;color:var(--muted)">None.</div>';

    body.innerHTML=html;
  }catch(e){
    selfHeal('SCB-ADMIN-26', e, { context: 'openUserRecordModal' });
    body.innerHTML='<div style="color:var(--danger)">'+esc(scbErr('SCB-ADMIN-26','This record couldn\'t be loaded.',(e&&e.message)||''))+'</div>';
  }
}
async function saveAdminUserNote(){
  if(!_adminRecordTargetNumber) return;
  const ta=document.getElementById('admin-record-notes');
  const note=(ta?ta.value:'').slice(0,4000);
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===_adminRecordTargetNumber);
    if(u){ u.adminNotes=note; await saveUsers(users); }
    showToast('Saved','Admin note updated.');
  }catch(e){ showToast('Failed',scbErr('SCB-ADMIN-27','That note couldn\'t be saved — the server rejected the write.',e.message)); }
}
async function renderAdminUsersTab(){
  if(!hasPermission('users_view')&&!hasPermission('users_ban')){ const body=document.getElementById('admin-dashboard-body'); if(body) body.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted)">Access denied.</div>'; return; }
  const body=document.getElementById('admin-dashboard-body');
  body.innerHTML='<div style="padding:10px;color:var(--muted)">Loading users…</div>';
  try{
    const users=await getUsers();
    if(!users.length){ body.innerHTML='<div style="padding:10px;color:var(--muted)">No users yet.</div>'; return; }
    body.innerHTML='<div style="font-size:11px;color:var(--muted);padding:0 2px 10px;letter-spacing:.03em">'+users.length+' user(s)</div>'
      + users.map(u=>{
        const rawName=dec(u.name)||'#'+u.number;
        const name=esc(rawName);
        const banned=!!u.banned;
        const verified=!!u.verified;
        const shadowMuted=!!u.shadowMuted;
        const isAdmin=String(u.number)===String(ADMIN_NUMBER);
        // Delegated admins (adminAccess.permissions, not just #2015) must
        // never be deletable by anyone but the true owner — used only for
        // the Delete button below, kept separate from `isAdmin` (which
        // elsewhere on this card specifically means "is #2015") so those
        // other owner-exclusive controls are unaffected.
        const targetHasAdminAccess=isAdmin||!!(u.adminAccess&&Array.isArray(u.adminAccess.permissions)&&u.adminAccess.permissions.length);
        const joinDate=u.createdAt?new Date(u.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'';
        return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:8px">'
          +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
          +'<div class="avatar" style="width:40px;height:40px;flex-shrink:0;background:var(--accent);color:#fff;font-size:16px">'+name.charAt(0).toUpperCase()+'</div>'
          +'<div style="min-width:0;flex:1">'
          +'<div style="font-size:14px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:5px;flex-wrap:wrap">'+name
          +(verified?' <span class="verified-badge" title="Verified">✓</span>':'')
          +(isAdmin?' <span style="font-size:10px;background:var(--accent);color:#fff;border-radius:4px;padding:1px 5px">Admin</span>':'')
          +(u.adminAccess&&u.adminAccess.roleTag?' <span style="font-size:10px;background:var(--surface2);color:var(--text2);border:1px solid var(--border2);border-radius:4px;padding:1px 5px">'+esc(u.adminAccess.roleTag)+'</span>':'')
          +(banned?' <span style="font-size:10px;background:var(--danger);color:#fff;border-radius:4px;padding:1px 5px">Banned</span>':'')
          +(shadowMuted?' <span style="font-size:10px;background:var(--warn);color:#fff;border-radius:4px;padding:1px 5px" title="Their messages silently never deliver — they are not told">🔇 Shadow-muted</span>':'')
          +'</div>'
          +'<div style="font-size:11px;color:var(--muted);margin-top:1px">#'+u.number+(joinDate?' · joined '+joinDate:'')+'</div>'
          +'</div></div>'
          +'<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">'
          +'<button class="btn btn-ghost btn-sm" data-number="'+u.number+'" onclick="adminMessage(Number(this.dataset.number))" title="Open DM">💬 Message</button>'
          +'<button class="btn btn-ghost btn-sm" data-number="'+u.number+'" onclick="openUserRecordModal(Number(this.dataset.number))" title="Full record: profile, reports, flags, notes">📋 Record</button>'
          +(hasPermission('badges_grant')?'<button class="btn btn-ghost btn-sm" data-number="'+u.number+'" onclick="openGrantBadgeModal(Number(this.dataset.number))" title="Grant an individual badge">🏅 Badges</button>':'')
          +(me.number===ADMIN_NUMBER?(verified?'<button class="btn btn-ghost btn-sm" data-number="'+u.number+'" onclick="adminUnverify(Number(this.dataset.number))">✓ Unverify</button>':'<button class="btn btn-ghost btn-sm" data-number="'+u.number+'" onclick="adminVerify(Number(this.dataset.number))">☑️ Verify</button>'):'')
          +(hasPermission('users_ban')?(banned?'<button class="btn btn-ghost btn-sm" data-number="'+u.number+'" onclick="adminUnban(Number(this.dataset.number))">✅ Unban</button>':'<button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-number="'+u.number+'" onclick="adminBan(Number(this.dataset.number))">🚫 Ban</button>'):'')
          +(hasPermission('users_ban')&&!isAdmin?(shadowMuted?'<button class="btn btn-ghost btn-sm" data-number="'+u.number+'" onclick="adminUnshadowMute(Number(this.dataset.number))">🔈 Un-shadow-mute</button>':'<button class="btn btn-ghost btn-sm" data-number="'+u.number+'" onclick="adminShadowMute(Number(this.dataset.number))" title="Their messages will silently never deliver — no ban notice shown to them">🔇 Shadow-mute</button>'):'')
          +(hasPermission('users_ban')&&!isAdmin&&!shadowMuted?'<select data-number="'+u.number+'" data-change="shadowMuteHours" style="width:auto;padding:5px 8px;font-size:12px" title="Shadow-mute for a fixed window, lifts automatically"><option value="">⏱️ Mute for...</option><option value="1">1 hour</option><option value="6">6 hours</option><option value="24">24 hours</option><option value="168">7 days</option></select>':'')
          +(!isAdmin&&me.number===ADMIN_NUMBER?'<button class="btn btn-ghost btn-sm" style="color:var(--accent)" data-number="'+u.number+'" data-name="'+esc(rawName)+'" data-perms="'+esc(JSON.stringify((u.adminAccess&&u.adminAccess.permissions)||[]))+'" data-roletag="'+esc((u.adminAccess&&u.adminAccess.roleTag)||'')+'" onclick="openPermissionEditor(Number(this.dataset.number),this.dataset.name,JSON.parse(this.dataset.perms),this.dataset.roletag)" title="Manage admin access">'+(u.adminAccess&&(u.adminAccess.permissions||[]).length?'🔑 Perms':'🔑 Grant')+'</button>':'')
          +(me.number===ADMIN_NUMBER?'<button class="btn btn-ghost btn-sm" data-number="'+u.number+'" onclick="adminResetAccount(Number(this.dataset.number))" title="Clear profile for a fresh start">🔄 Reset</button>':'')
          +(Number(u.number)!==ADMIN_NUMBER&&hasPermission('users_delete')&&(!targetHasAdminAccess||me.number===ADMIN_NUMBER)?'<button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-number="'+u.number+'" data-name="'+esc(rawName)+'" onclick="adminDeleteUser(Number(this.dataset.number),this.dataset.name)">🗑️ Delete</button>':'')
          +'</div></div>';
      }).join('');
  }catch(e){
    selfHeal('SCB-ADMIN-20', e, { context: 'renderAdminUsersTab' });
    body.innerHTML='<div style="color:var(--danger)">'+esc(scbErr('SCB-ADMIN-20','The user list couldn\'t be loaded.',(e&&e.message)||''))+'</div>';
  }
}
async function renderAdminGroupsTab(){
  if(!hasPermission('groups_view')){ const body=document.getElementById('admin-dashboard-body'); if(body) body.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted)">Access denied.</div>'; return; }
  const body=document.getElementById('admin-dashboard-body');
  body.innerHTML='<div style="padding:10px;color:var(--muted)">Loading groups…</div>';
  try{
    if(!convosCache) await getConvos();
    const groups=(convosCache||[]).filter(c=>c.type==='group'||(c.key&&c.key.startsWith('grp_')));
    if(!groups.length){ body.innerHTML='<div style="padding:10px;color:var(--muted)">No groups yet.</div>'; return; }
    body.innerHTML=groups.map(g=>{
      const name=esc(g.name||g.key);
      const memberCount=(g.members||g.participants||[]).length;
      return '<div class="sb-item" style="border-radius:var(--r-sm)">'
        +'<div class="avatar" style="width:36px;height:36px;background:linear-gradient(135deg,#ca5010,#6264a0);color:#fff">👥</div>'
        +'<div class="sb-item-info"><div class="sb-item-name">'+name+'</div><div class="sb-item-preview">'+memberCount+' member(s) · '+(g.messages||[]).length+' messages</div></div>'
        +(hasPermission('groups_delete')?'<button class="btn btn-danger btn-sm" data-key="'+esc(g.key)+'" onclick="adminDeleteGroup(this.dataset.key)">🗑️ Delete</button>':'')
        +'</div>';
    }).join('');
  }catch(e){
    selfHeal('SCB-ADMIN-21', e, { context: 'renderAdminGroupsTab' });
    body.innerHTML='<div style="color:var(--danger)">'+esc(scbErr('SCB-ADMIN-21','The group list couldn\'t be loaded.',(e&&e.message)||''))+'</div>';
  }
}
async function adminDeleteUser(number,name){
  if(!requirePermission('users_delete')) return;
  if(Number(number)===ADMIN_NUMBER){ showToast('Protected','The admin account (#2015) cannot be deleted.'); return; }
  // Only the true owner (#2015) can delete an admin account — a delegated
  // admin (anyone with adminAccess.permissions, which is how someone other
  // than #2015 got the users_delete permission that got them this far at
  // all) must never be able to remove a peer admin or have their own
  // account removed by one. Re-checked here against a fresh fetch rather
  // than trusting the button having been hidden for this exact reason
  // (see the comment on requireAdmin() above).
  if(me.number!==ADMIN_NUMBER){
    try{
      const users=await getUsers();
      const target=users.find(x=>x&&Number(x.number)===Number(number));
      if(target&&target.adminAccess&&Array.isArray(target.adminAccess.permissions)&&target.adminAccess.permissions.length){
        showToast('Protected','Only the owner (#'+ADMIN_NUMBER+') can delete an admin account.');
        return;
      }
    }catch(e){
      showToast('Delete failed',scbErr('SCB-ADMIN-31','Could not verify that account before deleting it — the server request failed.',(e&&e.message)||''));
      return;
    }
  }
  if(!confirm('Permanently delete account for '+name+' (#'+number+')?\n\nThis removes their account from Firebase entirely — not a ban. If they\'re still signed in on a device, they\'ll be signed out the next time it checks in.\n\nThis cannot be undone.')) return;
  try{
    await fbdb.ref('users/'+number).remove();
    // Reserve the number the same way Nuclear Reset does, for the same reason:
    // registerOrUpdate() treats "no server record" as possibly-just-wiped and
    // checks this list before deciding whether to recreate the account. Without
    // reserving it here, a device still signed in as this user would silently
    // write its own cached profile straight back to Firebase on its next
    // launch/poll — resurrecting the very account we just deleted.
    try{
      const rsnap=await fbdb.ref('admin_site/reserved_numbers').get();
      const reserved=rsnap.exists()?(rsnap.val()||[]):[];
      const updated=Array.isArray(reserved)?reserved.filter(n=>Number(n)!==Number(number)):[];
      updated.push(Number(number));
      await fbdb.ref('admin_site/reserved_numbers').set([...new Set(updated)]);
    }catch(e){ console.error('Could not reserve deleted number',e); }
    // Other users who had this account as a contact are left with a phantom
    // entry otherwise — nothing else in the app ever cleaned these up, and
    // the contacts.phantom diagnostic could only ever detect one, never fix
    // it. Strip the deleted number out of every other user's own contacts
    // list, writing only each affected user's own prefs/contacts path
    // (same "touch only what changed" approach as the rest of this app).
    try{
      const allUsers=await getUsers();
      for(const u of allUsers){
        if(!u||Number(u.number)===Number(number)) continue;
        const list=u.prefs&&Array.isArray(u.prefs.contacts)?u.prefs.contacts:null;
        if(!list) continue;
        const filtered=list.filter(c=>c&&Number(c.number)!==Number(number));
        if(filtered.length!==list.length){
          await fbdb.ref('users/'+u.number+'/prefs/contacts').set(filtered);
        }
      }
    }catch(e){ console.error('Could not clean up phantom contacts after delete',e); }
    // Remove from local users cache
    usersCache=usersCache.filter(u=>String(u.number)!==String(number));
    _logAdminAction('delete_user','#'+number+' ('+(name||'?')+')').catch(()=>{});
    showToast('Account deleted','User #'+number+' has been permanently deleted.');
    renderAdminUsersTab();
  }catch(e){ showToast('Delete failed',scbErr('SCB-ADMIN-30','Could not delete that account.',(e&&e.message)||'')); }
}
async function adminDeleteGroup(key){
  if(!requirePermission('groups_delete')) return;
  if(!confirm('Permanently delete this group and all its messages for everyone?')) return;
  try{
    if(!convosCache) await getConvos();
    convosCache=convosCache.filter(c=>c&&c.key!==key);
    // Delete the specific conversation key — using Firebase remove() so only
    // that one record is touched, not the entire conversations path.
    await fbdb.ref(CONVOS_BIN+'/'+key).remove();
    _logAdminAction('delete_group',key).catch(()=>{});
    showToast('Group deleted','');
    renderAdminGroupsTab();
  }catch(e){ showToast('Delete failed',scbErr('SCB-GRP-29','That group couldn\'t be deleted — the server rejected the write.',(e.message||''))); }
}
async function renderAdminReportsTab(){
  if(!hasPermission('reports_view')){ const body=document.getElementById('admin-dashboard-body'); if(body) body.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted)">Access denied.</div>'; return; }
  const body=document.getElementById('admin-dashboard-body');
  body.innerHTML='<div style="padding:10px;color:var(--muted)">Loading reports…</div>';
  try{
    const reports=await getReports();
    if(!reports.length){ body.innerHTML='<div style="padding:10px;color:var(--muted)">No reports yet.</div>'; return; }
    const sorted=[...reports].sort((a,b)=>b.time-a.time);
    body.innerHTML=sorted.map(r=>{
      const open=r.status!=='resolved';
      const categoryLabel=REPORT_CATEGORY_LABELS[r.category]||r.category;
      const evidence=Array.isArray(r.evidence)?r.evidence:[];
      return '<div style="padding:10px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;'+(open?'':'opacity:.55')+'">'
        +'<div style="font-size:12px;font-weight:600">Reported: '+esc(r.reportedName||'Unknown')+' (#'+r.reportedNumber+')'
        +(categoryLabel?' <span style="font-size:10px;font-weight:600;background:var(--surface2);color:var(--text2);border-radius:999px;padding:1px 8px;margin-left:4px">'+esc(categoryLabel)+'</span>':'')
        +'</div>'
        +'<div style="font-size:11px;color:var(--muted);margin:2px 0">By '+esc(r.reporterName||'')+' (#'+r.reporterNumber+') · '+new Date(r.time).toLocaleString()+'</div>'
        +'<div style="font-size:12px;margin:6px 0">'+esc(r.reason||'')+'</div>'
        +(evidence.length?('<details style="margin:6px 0"><summary style="cursor:pointer;font-size:11px;color:var(--accent)">📎 '+evidence.length+' message(s) attached as evidence</summary>'
          +'<div style="margin-top:6px;font-size:11px;color:var(--text2);background:var(--surface2);border-radius:6px;padding:8px;max-height:160px;overflow-y:auto">'
          +evidence.map(m=>'<div style="margin-bottom:4px"><b>#'+m.from+'</b> · '+new Date(m.time).toLocaleTimeString()+': '+esc(m.text)+'</div>').join('')
          +'</div></details>'):'')
        +'<div style="display:flex;gap:6px">'
        +(me.number===ADMIN_NUMBER?'<button class="btn btn-ghost btn-sm" data-number="'+r.reportedNumber+'" onclick="openAdminPanel(Number(this.dataset.number))">View user</button>':'')
        +(hasPermission('reports_resolve')?(open?'<button class="btn btn-ghost btn-sm" data-id="'+esc(r.id)+'" onclick="resolveReport(this.dataset.id)">✅ Mark resolved</button>':'<span style="font-size:11px;color:var(--muted)">Resolved</span>'):(open?'':'<span style="font-size:11px;color:var(--muted)">Resolved</span>'))
        +'</div></div>';
    }).join('');
  }catch(e){
    selfHeal('SCB-ADMIN-22', e, { context: 'renderAdminReportsTab' });
    body.innerHTML='<div style="color:var(--danger)">'+esc(scbErr('SCB-ADMIN-22','The reports list couldn\'t be loaded.',(e&&e.message)||''))+'</div>';
  }
}
async function resolveReport(id){
  if(!requirePermission('reports_resolve')) return;
  try{
    const reports=await getReports();
    const r=reports.find(x=>x.id===id);
    if(r){ r.status='resolved'; r.resolvedAt=Date.now(); }
    await saveReports(reports);
    renderAdminReportsTab();
  }catch(e){ showToast('Failed',scbErr('SCB-ADMIN-17','That report change couldn\'t be saved — the server rejected the write.',(e.message||''))); }
}



// -- FIREBASE RULES MANAGER (admin-only) -------------------------------------
// Direct Firebase RTDB REST API — no Cloudflare Worker needed.
const _RTDB_RULES_URL = 'https://socloudybro-b8606-default-rtdb.europe-west1.firebasedatabase.app/.settings/rules.json';

async function _getRulesToken() {
  try {
    const user = firebase.auth && firebase.auth().currentUser;
    if (user) return await user.getIdToken(true);
  } catch(e) {}
  return null;
}

const SCB_CANONICAL_RULES = {
  "rules": {
    // Default deny — only explicitly granted paths are accessible
    ".read": false,
    ".write": false,

    "users": {
      // Requires any Firebase Auth session (anonymous or custom) — prevents
      // unauthenticated REST dumps of the entire user table. All in-app reads
      // already carry an anonymous or custom token, so this is backwards-
      // compatible. Removes the ability to curl the DB without a token.
      ".read": "auth != null",
      ".indexOn": ["number", "linkedSoCloudyBro", "lastSeen", "createdAt", "online"],
      "$uid": {
        // A user may only write their own record (auth.token.number comes from
        // a real Firebase custom auth token minted by the firebase-rules
        // Worker's /mint-token — see MINT_TOKEN_ENDPOINT's comment — never
        // from the plain anonymous session every visitor gets for free).
        // Admin #2015 and any account with adminAccess set can write any record.
        //
        // SECURITY FIX: the self-write branch below used to have no field
        // restriction, which let any ordinary user grant themselves
        // adminAccess by writing it onto their OWN record — and since the
        // third branch here grants full write over EVERY user record to
        // anyone whose own adminAccess merely exists(), that one self-write
        // was a full privilege escalation to "can overwrite any account,
        // including banning/deleting others or hijacking their pwd/PIN
        // hash". The self-write branch now explicitly forbids changing
        // adminAccess (newData must match the current value) — only the
        // literal admin account or an account that ALREADY has adminAccess
        // (via the third branch, unaffected by this fix — delegated admins
        // still need this to ban/unban other users through saveUsers()'s
        // single whole-table write) can grant or revoke it.
        //
        // SECOND FIX: saveUsers() always writes the ENTIRE users table in
        // one .set() — dozens of ordinary self-service flows (trust/revoke
        // a device, cancel account deletion, password reset, backup-PIN
        // setup, etc.) call getUsers() (every account), mutate only the
        // caller's own record, then saveUsers(wholeArray) straight back.
        // Without an explicit "value didn't change" bypass, that single
        // write would need EVERY OTHER user's record to also independently
        // satisfy this rule for the write to succeed at all — which an
        // ordinary non-admin caller never does — breaking every one of
        // those flows outright. An unchanged record is a no-op by
        // definition, so allowing it costs nothing security-wise; this
        // mirrors the same bypass already used for the reports rule below,
        // for the exact same reason.
        //
        // THIRD FIX: brand-new sign-up (submitSetup() -> registerOrUpdate()
        // -> saveUsers()) writes the new account's own record while the
        // session is STILL anonymous — _tryUpgradeToCustomAuth() only ever
        // runs from finishLogin() on an existing account, because minting a
        // token requires something server-side to verify a proof against,
        // and a brand-new account has no server record yet to verify
        // against. An anonymous session has no auth.token.number at all, so
        // every branch above was unsatisfiable and EVERY new sign-up was
        // rejected with PERMISSION_DENIED. Fixed by allowing a write to a
        // path with no existing record at all (pure account creation) —
        // but only when the new record doesn't carry adminAccess, so this
        // can't be used to self-grant admin by "signing up" at an unclaimed
        // number (numbers are also pre-screened client-side in
        // submitSetup(), but that's not a substitute for a server-side
        // guarantee).
        ".write": "auth != null && ((!data.exists() && !newData.child('adminAccess').exists()) || data.val() == newData.val() || (auth.token.number == $uid && newData.child('adminAccess').val() == data.child('adminAccess').val()) || auth.token.number == '2015' || (root.child('users').child(auth.token.number).child('adminAccess').exists() && (!root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').exists() || root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').val() > now)))",
        // A parent approving/denying a CHILD's account (approveChildAccount()/
        // denyChildAccount()) writes to the CHILD's record as the parent —
        // none of the branches above cover that (the parent's own
        // auth.token.number never equals the child's $uid, and an ordinary
        // parent has no adminAccess). Identified by email instead of number,
        // since that's what the child's signup flow actually records
        // (parentEmail) — /mint-token now includes the account's own email as
        // a custom claim specifically for this. Scoped narrowly to exactly
        // these two fields (writes go through narrow set()s at these paths,
        // not the whole-record $uid rule above) so a matching parent can only
        // ever flip consent + record their own number, nothing else on the
        // child's record.
        "parentalConsentStatus": {
          ".write": "auth != null && auth.token.email != null && auth.token.email != '' && auth.token.email == data.parent().child('parentEmail').val() && (newData.val() == 'approved' || newData.val() == 'denied')"
        },
        "parentNumber": {
          ".write": "auth != null && auth.token.email != null && auth.token.email != '' && auth.token.email == data.parent().child('parentEmail').val() && (newData.val() + '') == auth.token.number"
        }
      }
    },

    "users_private": {
      // Sensitive auth credentials — password hash, backup PIN hash, face
      // descriptor. Readable only by the account owner (custom auth token with
      // matching number claim) or the Worker's service-account token (which
      // bypasses client rules entirely). Writable by the owner and by new
      // account creation (anonymous !data.exists() — same pattern as users/$uid,
      // needed for the bootstrap write during sign-up before the custom token
      // is minted). The Worker always uses the service-account token, so it can
      // read from here regardless of what the client rule says.
      "$uid": {
        ".read":  "auth.token.number == $uid",
        ".write": "auth.token.number == $uid || auth.token.number == '2015' || !data.exists()"
      }
    },

    "conversations": {
      // Requires any Firebase Auth session — anonymous sessions satisfy this,
      // so every in-browser visitor can still read. Only blocks unauthenticated
      // REST dumps. Message content is also E2E encrypted at the app layer.
      ".read": "auth != null",
      // Writes require a REAL authenticated session (a custom auth token from
      // /mint-token — password, Google, passkey, face, or backup-PIN login all
      // mint one now), not just the anonymous session every visitor gets for
      // free on page load.
      ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'",
      "$convoId": {
        // Per-conversation membership check, on top of the blanket rule above.
        // members/participants are stored as arrays (unchanged — every read/
        // mutation site elsewhere in the app still uses them exactly as
        // before), and Firebase rules can't cheaply check "is this number in
        // this array". saveConvos() now ALSO writes a parallel memberSet map
        // ({"1234":true,...}) on every save specifically so this rule can
        // check "does this child key exist" instead. A conversation with no
        // memberSet yet (saved before this existed, and not yet covered by
        // the one-time admin "Backfill Conversation Member Index" pass) falls
        // back to the blanket rule above instead of being locked — this can
        // only ever ADD restriction, never remove access nothing else grants.
        //
        // SECURITY FIX: this used to also accept
        // newData.child('memberSet').child(auth.token.number).exists() — i.e.
        // "allow the write if the SUBMITTED data includes the writer in
        // memberSet". Since every save is a full-object replace (saveConvos()
        // always writes the whole conversation, never a narrow patch), that
        // let ANY authenticated user submit a complete rewrite of ANY
        // existing conversation — messages, admins, wrappedKeys, everything —
        // just by including their own number in the memberSet they were
        // submitting. No legitimate flow actually needs this: joining an
        // existing conversation always goes through joinRequests (below),
        // approved by an admin who is already a member and so already
        // satisfies the rule below without it.
        ".write": "!data.exists() || !data.child('memberSet').exists() || data.child('memberSet').child(auth.token.number).exists()",
        // Lets a non-member submit a join request (see submitJoinServer(),
        // which writes ONLY this path — not the whole conversation — for
        // exactly this reason) without the blanket membership check above
        // applying to this one path. Same trust level as reports/spam_flags:
        // any real-auth user can write here, an admin reviews before acting
        // on it, and the worst a bad actor can do is submit junk requests or
        // clobber the pending list, not touch messages/members/anything else.
        "joinRequests": {
          ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'"
        },
        "messages": {
          ".indexOn": ["time", "sender", "type"]
        },
        ".indexOn": ["updatedAt", "createdAt"]
      }
    },

    "updates": {
      // Readable by any Firebase Auth session (anonymous or custom) so the
      // in-browser update banner loads for every visitor. Writable only by
      // admin (#2015) — prevents any authenticated user from posting fake
      // app announcements.
      ".read": "auth != null",
      ".write": "auth != null && (auth.token.number == '2015' || (root.child('users').child(auth.token.number).child('adminAccess').exists() && (!root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').exists() || root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').val() > now)))",
      ".indexOn": ["at", "author"]
    },

    "reports": {
      ".read": "auth != null",
      ".indexOn": ["at", "reporter", "number", "resolved"],
      "$reportId": {
        ".write": "auth != null && (data.val() == newData.val() || !data.exists() || auth.token.number == '2015' || (root.child('users').child(auth.token.number).child('adminAccess').exists() && (!root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').exists() || root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').val() > now)))"
      }
    },

    "calls": {
      // Requires a real login (custom auth token) — anonymous page visitors
      // cannot initiate or modify call records.
      ".read": "auth != null",
      ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'",
      ".indexOn": ["at", "caller", "callee", "status"]
    },

    "voice": {
      ".read": "auth != null",
      ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'"
    },

    "races": {
      ".read": "auth != null",
      ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'"
    },

    "syntax_meetings": {
      ".read": "auth != null",
      ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'"
    },

    "feedback": {
      // Any logged-in user can submit feedback, but not anonymous visitors.
      ".read": "auth != null",
      ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'"
    },

    "admin_site": {
      // Requires any Firebase Auth session — blocks unauthenticated REST dumps
      // while still allowing the in-browser update banner to load (every visitor
      // gets an anonymous session on page load).
      // Write is admin-only (unchanged).
      ".read": "auth != null",
      ".write": "auth != null && (auth.token.number == '2015' || (root.child('users').child(auth.token.number).child('adminAccess').exists() && (!root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').exists() || root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').val() > now)))",
      "self_destructed_log": {
        ".indexOn": ["destroyedAt"]
      },
      "audit_log": {
        ".indexOn": ["at", "author", "action"]
      }
    },

    "blacklist": {
      // Device/IP age-block list — separate path so reads/writes never touch
      // user records. Stored per-entry (keyed by deviceId, see
      // blockDeviceForAge()) instead of one array blob, so this rule can
      // allow creating a NEW block entry without granting the ability to
      // remove or rewrite an existing one (previously any authenticated
      // user — including the blocked device itself — could clear the whole
      // list via one write).
      ".read": "auth != null",
      "$entryId": {
        ".write": "auth != null && (!data.exists() || auth.token.number == '2015' || (root.child('users').child(auth.token.number).child('adminAccess').exists() && (!root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').exists() || root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').val() > now)))"
      }
    },

    "spam_flags": {
      // Spam reports indexed for orderByChild('at') queries in admin panel.
      // Each flag is its own pushed child, so (unlike reports/blacklist
      // below) no data-model change was needed here — just a tighter rule:
      // anyone can create a NEW flag (the existing rate-limit/mass-report
      // detection this backs), but only an admin can modify or delete an
      // EXISTING one. Previously any authenticated user could resolve their
      // own flag or wipe everyone else's.
      ".read": "auth != null",
      ".indexOn": ["at", "reporter", "number"],
      "$flagId": {
        ".write": "auth != null && (!data.exists() || auth.token.number == '2015' || (root.child('users').child(auth.token.number).child('adminAccess').exists() && (!root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').exists() || root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').val() > now)))"
      }
    },

    "errors": {
      // Error log entries — writable by any real-auth session so logged-in
      // users can report client errors; anonymous visitors cannot flood the
      // log. Readable by admin only.
      ".read": "auth != null && (auth.token.number == '2015' || (root.child('users').child(auth.token.number).child('adminAccess').exists() && (!root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').exists() || root.child('users').child(auth.token.number).child('adminAccess').child('expiresAt').val() > now)))",
      ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'",
      ".indexOn": ["ts"]
    },

    // ── Presence ──────────────────────────────────────────────────────────────
    // Per-user online/typing/lastSeen — separated from users/ so presence
    // writes don't trigger full-user-record listeners or bump write quotas on
    // the main profile.
    "presence": {
      ".read": "auth != null",
      "$uid": {
        ".write": "auth != null && (auth.token.number == $uid || auth.token.number == '2015')",
        ".indexOn": ["lastSeen", "online"]
      }
    },

    // ── Notifications ─────────────────────────────────────────────────────────
    // Per-user push notification queue. Each entry is a pushed child with a
    // type, payload, and ts. Writable by any real-auth user (to send a
    // notification to another user), readable only by the recipient.
    "notifications": {
      "$uid": {
        ".read": "auth.token.number == $uid",
        ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'",
        ".indexOn": ["ts", "type"]
      }
    },

    // ── Reactions ─────────────────────────────────────────────────────────────
    // Per-conversation emoji reactions keyed by messageId then userId.
    // Any conversation member can read/write (enforced at app layer via memberSet).
    "reactions": {
      ".read": "auth != null",
      ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'",
      "$convoId": {
        "$messageId": {
          ".indexOn": ["at"]
        }
      }
    },

    // ── Read receipts ─────────────────────────────────────────────────────────
    // Per-conversation read position per user: {lastReadTime, lastReadMsgId}.
    // Readable by conversation members (enforced at app layer), writable only
    // by the owner.
    "read_receipts": {
      ".read": "auth != null",
      "$convoId": {
        "$uid": {
          ".write": "auth != null && auth.token.number == $uid"
        }
      }
    },

    // ── Pinned messages ───────────────────────────────────────────────────────
    "pin_messages": {
      ".read": "auth != null",
      ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'",
      "$convoId": {
        ".indexOn": ["pinnedAt", "pinnedBy"]
      }
    },

    // ── Polls ─────────────────────────────────────────────────────────────────
    "polls": {
      ".read": "auth != null",
      ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'",
      "$convoId": {
        ".indexOn": ["createdAt", "createdBy"]
      }
    },

    // ── User stats ────────────────────────────────────────────────────────────
    // Lightweight counters kept out of users/ to avoid bloating profile reads.
    // Writable only by the owner or admin; readable by any auth session.
    "user_stats": {
      ".read": "auth != null",
      "$uid": {
        ".write": "auth != null && (auth.token.number == $uid || auth.token.number == '2015')",
        ".indexOn": ["messageCount", "joinedAt", "streak"]
      }
    },

    // ── Blocked users ─────────────────────────────────────────────────────────
    // Per-user block list keyed by blocked number. Readable only by owner.
    "blocked": {
      "$uid": {
        ".read": "auth.token.number == $uid",
        ".write": "auth != null && auth.token.number == $uid",
        ".indexOn": ["blockedAt"]
      }
    },

    // ── Invites ───────────────────────────────────────────────────────────────
    // Invite codes for groups/servers. Writable by real-auth users (creator),
    // readable by any auth session so the invite link works before login.
    "invites": {
      ".read": "auth != null",
      "$code": {
        ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'",
        ".indexOn": ["convoId", "createdBy", "expiresAt"]
      }
    },

    // ── Leaderboards ──────────────────────────────────────────────────────────
    // Global and per-game leaderboard entries. Writable by real-auth users
    // (the game engine writes the score), readable by any auth session.
    "leaderboards": {
      ".read": "auth != null",
      "$game": {
        ".write": "auth != null && auth.token.firebase.sign_in_provider == 'custom'",
        ".indexOn": ["score", "time", "number"]
      }
    },

    // Block any other top-level path not listed above
    "$other": {
      ".read": false,
      ".write": false
    }
  }
};

async function adminLoadRules() {
  if(!requireAdmin()) return;
  // Firebase RTDB /.settings/rules.json requires a Google OAuth2 admin token,
  // not a Firebase ID token from getIdToken(). Load canonical rules locally instead.
  const ta = document.getElementById('admin-rules-input');
  if (ta) ta.value = JSON.stringify(SCB_CANONICAL_RULES, null, 2);
  showToast('Canonical rules loaded', 'Copy the rules below and paste them in Firebase Console → Realtime Database → Rules.');
}

async function adminPushRules() {
  if(!requireAdmin()) return;
  const ta = document.getElementById('admin-rules-input');
  if (!ta || !ta.value.trim()) { showToast('Enter rules JSON first', 'The text area above is empty.'); return; }
  let rules;
  try { rules = JSON.parse(ta.value); } catch(e) { showToast('Invalid JSON', e.message); return; }
  // Firebase RTDB rules API requires a Google OAuth2 admin token — not available in browser.
  // Direct the admin to paste these rules manually in Firebase Console.
  const consoleUrl = 'https://console.firebase.google.com/project/socloudybro-b8606/database/socloudybro-b8606-default-rtdb/rules';
  if (confirm('Firebase rules cannot be pushed directly from the browser (requires a service account token).\n\nOpen Firebase Console to paste them manually?')) {
    window.open(consoleUrl, '_blank', 'noopener,noreferrer');
  }
  showToast('Use Firebase Console', 'Copy the JSON from the text area and paste it in Firebase Console → Rules.');
}
// -- END FIREBASE RULES MANAGER -----------------------------------------------

// -- FIREBASE DATA CLEANUP ----------------------------------------------------
async function _fbRestAuthParam(){
  // Firebase REST API needs ?auth= token for secured paths.
  // We use the app's own access token from the Firebase SDK if available.
  try{
    const user=firebase.auth&&firebase.auth().currentUser;
    if(user){const t=await user.getIdToken();return '?auth='+encodeURIComponent(t);}
  }catch(e){}
  return '';
}
// Covers every category adminDiagnoseFirebase() reports THAT HAS A SAFE,
// unambiguous fix — pending flags, orphan messages, double-encrypted
// profiles, empty junk conversations, duplicate entries in a conversation's
// member list, a redundant banned flag on an already-deleted account,
// moderation reports that can only resolve one way (target account gone, or
// already banned), and duplicate blacklist entries.
//
// Deliberately NOT auto-fixed here, even though Diagnose Only counts them —
// each needs a human judgment call this function has no safe default for:
//   - accounts missing a number, or two accounts sharing one: which record
//     is the real one isn't something this can infer from the data alone.
//   - two accounts linking the same Google sign-in: unlinking the wrong one
//     locks the rightful owner out.
//   - stale (30+ day) open reports on an account still active: that's an
//     actual moderation decision, not a data-integrity fix.
async function adminCleanFirebase() {
  if(!requireAdmin()) return;
  if (!confirm('This will scan ALL Firebase data and remove corrupted/bad records. This may take a while. Continue?')) return;

  const results = { pendingStripped: 0, orphanMsgs: 0, profilesFixed: 0, emptyConvosRemoved: 0, duplicateMembersFixed: 0, contradictoryFlagsFixed: 0, orphanReportsResolved: 0, reportsOnBannedResolved: 0, duplicateBlacklistRemoved: 0, errors: 0 };
  showToast('🔧 Firebase Cleanup', 'Starting scan… this may take a minute');

  try {
    // PASS 1: Messages — strip pending:true, remove orphan messages, and
    // remove conversations that are empty junk (no members, no messages) or
    // have duplicate entries in their member list.
    showToast('🔧 Firebase Cleanup', 'Pass 1/6: Scanning messages & conversations…');
    const convoSnap = await fbdb.ref('conversations').get();
    const convoRaw = convoSnap.val() || {};
    // saveConvos() stores {conversations:[...]} at the 'conversations' path
    const convoArr = Array.isArray(convoRaw.conversations) ? convoRaw.conversations : Object.values(convoRaw.conversations||convoRaw).filter(Boolean);
    const convoData = Object.fromEntries(convoArr.filter(c=>c&&c.key).map(c=>[c.key,c]));
    const convoPatches = {};
    for (const [convoId, convo] of Object.entries(convoData)) {
      if (!convo) continue;
      const hasMembers = Array.isArray(convo.members) && convo.members.length > 0;
      const hasMessages = convo.messages && Object.keys(convo.messages).length > 0;
      if (!hasMembers && !hasMessages) {
        convoPatches[`conversations/${convoId}`] = null;
        results.emptyConvosRemoved++;
        continue;
      }
      if (Array.isArray(convo.members)) {
        const deduped = [...new Set(convo.members.map(m => String(m)))].map(s => isNaN(Number(s)) ? s : Number(s));
        if (deduped.length !== convo.members.length) {
          convoPatches[`conversations/${convoId}/members`] = deduped;
          results.duplicateMembersFixed++;
        }
      }
      if (!convo.messages) continue;
      const members = new Set(convo.members || []);
      for (const [msgId, msg] of Object.entries(convo.messages)) {
        if (!msg) continue;
        if (msg.pending === true) {
          convoPatches[`conversations/${convoId}/messages/${msgId}/pending`] = null;
          results.pendingStripped++;
        }
        if (msg.from && members.size > 0 && !members.has(Number(msg.from)) && !members.has(String(msg.from))) {
          convoPatches[`conversations/${convoId}/messages/${msgId}`] = null;
          results.orphanMsgs++;
        }
      }
    }
    if (Object.keys(convoPatches).length > 0) {
      await fbdb.ref('/').update(convoPatches);
    }

    // PASS 2: Fix double-encrypted profile fields, and clear a redundant
    // banned flag on an account that's already deleted (deleteAccount()
    // already wipes the record — a leftover banned:true there is stale, not
    // meaningful; nothing reads it once deleted:true is set).
    showToast('🔧 Firebase Cleanup', 'Pass 2/6: Fixing profiles…');
    const usersSnap = await fbdb.ref('users').get();
    const usersData = usersSnap.val() || {};
    const usersObj = Array.isArray(usersData)
      ? Object.fromEntries(usersData.map((u,i)=>[i,u]))
      : usersData;
    const knownNumbers = new Set();
    for (const [acctKey, acct] of Object.entries(usersObj)) {
      if (!acct) continue;
      if (acct.number != null) knownNumbers.add(String(acct.number));
      const profilePatches = {};
      for (const field of ['name', 'bio', 'customStatus']) {
        if (!acct[field]) continue;
        try {
          // Check for legacy encrypted value and migrate to plaintext
          if(acct[field] && typeof acct[field]==='string' && acct[field].startsWith('v2:')){
            const decoded = dec(acct[field]);
            if(typeof decoded==='string' && !decoded.startsWith('v2:')){
              profilePatches[`users/${acctKey}/${field}`] = decoded;
              results.profilesFixed++;
            }
          }
        } catch(e) { results.errors++; }
      }
      if (acct.deleted && acct.banned) {
        profilePatches[`users/${acctKey}/banned`] = false;
        results.contradictoryFlagsFixed++;
      }
      if (Object.keys(profilePatches).length > 0) {
        await fbdb.ref('/').update(profilePatches);
      }
    }
    const bannedNumbers = new Set(Object.values(usersObj).filter(u => u && u.banned && u.number != null).map(u => String(u.number)));

    // PASS 3: Resolve reports that can only go one way — the reported
    // account no longer exists, or it's already banned (the report already
    // got the outcome it was asking for).
    showToast('🔧 Firebase Cleanup', 'Pass 3/6: Resolving moot reports…');
    try {
      const reports = await getReports();
      let reportsChanged = false;
      for (const r of (reports || [])) {
        if (!r || (r.status || 'open') !== 'open') continue;
        if (r.reportedNumber == null) continue;
        const num = String(r.reportedNumber);
        if (!knownNumbers.has(num)) {
          r.status = 'resolved'; r.resolution = 'Account no longer exists'; r.resolvedAt = Date.now();
          results.orphanReportsResolved++; reportsChanged = true;
        } else if (bannedNumbers.has(num)) {
          r.status = 'resolved'; r.resolution = 'Account already banned'; r.resolvedAt = Date.now();
          results.reportsOnBannedResolved++; reportsChanged = true;
        }
      }
      if (reportsChanged) await saveReports(reports);
    } catch(e) { results.errors++; }

    // PASS 4: De-duplicate the device/IP blacklist (same device or IP
    // blocked more than once — harmless but pointless bloat).
    showToast('🔧 Firebase Cleanup', 'Pass 4/6: De-duplicating blacklist…');
    try {
      const blSnap = await fbdb.ref('blacklist').get();
      const blRaw = blSnap.exists() ? blSnap.val() : [];
      const bl = (Array.isArray(blRaw) ? blRaw : Object.values(blRaw || {})).filter(Boolean);
      const seenDevices = new Set(), seenIPs = new Set(), deduped = {};
      let i = 0;
      for (const b of bl) {
        const dupDevice = b.deviceId && seenDevices.has(b.deviceId);
        const dupIP = b.ip && seenIPs.has(b.ip);
        if (dupDevice || dupIP) { results.duplicateBlacklistRemoved++; continue; }
        if (b.deviceId) seenDevices.add(b.deviceId);
        if (b.ip) seenIPs.add(b.ip);
        // Keyed by deviceId (matches blockDeviceForAge()'s write shape) so
        // the collection stays individually addressable per entry, not a
        // single array blob — see the blacklist rule's comment.
        deduped[b.deviceId || b.ip || ('entry_'+(i++))] = b;
      }
      if (results.duplicateBlacklistRemoved > 0) await fbdb.ref('blacklist').set(deduped);
    } catch(e) { results.errors++; }

    showToast('✅ Cleanup Complete',
      `Removed ${results.pendingStripped} pending flags, ${results.orphanMsgs} orphan messages, ${results.emptyConvosRemoved} empty conversations, fixed ${results.duplicateMembersFixed} member-list duplicates, `+
      `fixed ${results.profilesFixed} profiles, cleared ${results.contradictoryFlagsFixed} stale banned flags, resolved ${results.orphanReportsResolved + results.reportsOnBannedResolved} moot reports, `+
      `removed ${results.duplicateBlacklistRemoved} duplicate blacklist entries. Errors: ${results.errors}. `+
      `Not auto-fixed (needs a judgment call — see Diagnose Only): accounts missing/sharing a number, duplicate Google sign-in links, stale unresolved reports on active accounts.`);

  } catch(e) {
    selfHeal('SCB-ADMIN-25', e, { context: 'adminCleanFirebase' });
    showToast('❌ Cleanup Failed', scbErr('SCB-ADMIN-25', 'Firebase cleanup failed', e.message));
  }
}

async function adminDiagnoseFirebase() {
  if(!requireAdmin()) return;
  showToast('🔍 Diagnosing…', 'Scanning Firebase for issues…');
  const results = {
    pendingFlags: 0, orphanMsgs: 0, doubleEncrypted: 0, missingTimestamp: 0, duplicateMembers: 0,
    emptyConvos: 0, missingNumber: 0, duplicateNumbers: 0, duplicateGoogleSub: 0, contradictoryFlags: 0,
    orphanReports: 0, staleOpenReports: 0, reportsOnBannedUnresolved: 0, duplicateBlacklist: 0,
    errors: 0
  };

  try {
    // Scan messages via SDK
    const convoSnap = await fbdb.ref('conversations').get();
    const convoData = convoSnap.val() || {};
    for (const [convoId, convo] of Object.entries(convoData)) {
      if (!convo) continue;
      const hasMembers = Array.isArray(convo.members) && convo.members.length > 0;
      const hasMessages = convo.messages && Object.keys(convo.messages).length > 0;
      if (!hasMembers && !hasMessages) { results.emptyConvos++; continue; }
      if (Array.isArray(convo.members)) {
        const uniqueMembers = new Set(convo.members.map(m => String(m)));
        if (uniqueMembers.size !== convo.members.length) results.duplicateMembers++;
      }
      if (!convo.messages) continue;
      const members = new Set(convo.members || []);
      for (const [msgId, msg] of Object.entries(convo.messages)) {
        if (!msg) continue;
        if (msg.pending === true) results.pendingFlags++;
        if (msg.from && members.size > 0 && !members.has(Number(msg.from)) && !members.has(String(msg.from))) results.orphanMsgs++;
        if (msg.time == null || typeof msg.time !== 'number') results.missingTimestamp++;
      }
    }

    // Scan users for double-encrypted fields, missing/duplicate account numbers, duplicate
    // googleSub (would let two accounts both sign in as the same Google identity), and
    // contradictory banned+deleted flag combinations, via SDK
    const usersSnap = await fbdb.ref('users').get();
    const usersRaw2 = usersSnap.val() || {};
    const usersObj2 = Array.isArray(usersRaw2) ? Object.fromEntries(usersRaw2.map((u,i)=>[i,u])) : usersRaw2;
    const seenNumbers = new Set();
    const knownNumbers = new Set();
    const bannedNumbers = new Set();
    const seenGoogleSubs = new Set();
    for (const [, acct] of Object.entries(usersObj2)) {
      if (!acct) continue;
      if (acct.number == null || acct.number === '') { results.missingNumber++; }
      else {
        const n = String(acct.number);
        if (seenNumbers.has(n)) results.duplicateNumbers++;
        seenNumbers.add(n);
        knownNumbers.add(n);
        if (acct.banned) bannedNumbers.add(n);
      }
      if (acct.googleSub) {
        if (seenGoogleSubs.has(acct.googleSub)) results.duplicateGoogleSub++;
        seenGoogleSubs.add(acct.googleSub);
      }
      // A deleted account that's also still marked banned is redundant/contradictory —
      // deleteAccount() already wipes the record, banned shouldn't survive that.
      if (acct.deleted && acct.banned) results.contradictoryFlags++;
      for (const field of ['name', 'bio', 'customStatus']) {
        if (!acct[field]) continue;
        try {
          let decoded = dec(acct[field]);
          if (decoded && typeof decoded === 'string' && decoded.startsWith('v2:')) results.doubleEncrypted++;
        } catch(e) { results.errors++; }
      }
    }

    // Scan reports for stale/unresolved entries, references to accounts that no longer exist,
    // and open reports against a user who's already been banned (moderation queue not closed out)
    try {
      const reports = await getReports();
      const staleCutoff = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days
      for (const r of (reports || [])) {
        if (!r) continue;
        if (r.reportedNumber != null && !knownNumbers.has(String(r.reportedNumber))) results.orphanReports++;
        if ((r.status || 'open') === 'open' && typeof r.time === 'number' && r.time < staleCutoff) results.staleOpenReports++;
        if ((r.status || 'open') === 'open' && r.reportedNumber != null && bannedNumbers.has(String(r.reportedNumber))) results.reportsOnBannedUnresolved++;
      }
    } catch(e) { results.errors++; }

    // Scan the device/IP blacklist for duplicate entries (same deviceId or ip blocked more than once)
    try {
      const blSnap = await fbdb.ref('blacklist').get();
      const blRaw = blSnap.exists() ? blSnap.val() : [];
      const bl = (Array.isArray(blRaw) ? blRaw : Object.values(blRaw || {})).filter(Boolean);
      const seenDevices = new Set(), seenIPs = new Set();
      for (const b of bl) {
        if (b.deviceId) { if (seenDevices.has(b.deviceId)) results.duplicateBlacklist++; seenDevices.add(b.deviceId); }
        if (b.ip) { if (seenIPs.has(b.ip)) results.duplicateBlacklist++; seenIPs.add(b.ip); }
      }
    } catch(e) { results.errors++; }

    showToast('🔍 Diagnosis Complete',
      `Found: ${results.pendingFlags} pending flags, ${results.orphanMsgs} orphan messages, ${results.missingTimestamp} messages missing a timestamp, `+
      `${results.doubleEncrypted} double-encrypted profile fields, ${results.emptyConvos} empty conversations, ${results.duplicateMembers} conversations with duplicate members, `+
      `${results.missingNumber} accounts missing a number, ${results.duplicateNumbers} duplicate account numbers, ${results.duplicateGoogleSub} duplicate Google sign-in links, `+
      `${results.contradictoryFlags} accounts both banned and deleted, ${results.orphanReports} reports on deleted accounts, ${results.staleOpenReports} stale unresolved reports (30+ days), `+
      `${results.reportsOnBannedUnresolved} open reports on already-banned users, ${results.duplicateBlacklist} duplicate blacklist entries. Errors: ${results.errors}`);
  } catch(e) {
    selfHeal('SCB-ADMIN-26', e, { context: 'adminDiagnoseFirebase' });
    showToast('❌ Diagnosis Failed', scbErr('SCB-ADMIN-26', 'Firebase diagnosis failed', e.message));
  }
}

// One-time (but safe to re-run — it skips anything already done) migration:
// adds a memberSet map ({"1234":true,...}) to every existing conversation,
// derived from its current participants/members array. saveConvos() now
// writes this automatically for every FUTURE save (see its own comment), so
// this only needs to run once to cover conversations that existed before
// that change shipped. Purely additive — never modifies or removes
// participants/members/messages/anything else, so there's nothing to lose
// if it's interrupted or re-run. This is also the thing the tightened
// conversations Firebase rule (requiring real membership to write) actually
// checks against — a conversation with no memberSet still falls back to the
// old "just needs to be really logged in" rule, so running this is what
// turns real per-conversation enforcement on, not merely a cleanup step.
async function adminBackfillMemberSets(){
  if(!requireAdmin()) return;
  showToast('🔑 Backfilling…', 'Scanning conversations…');
  const results = { updated: 0, skipped: 0, errors: 0 };
  try {
    const convoSnap = await fbdb.ref('conversations').get();
    const convoData = convoSnap.val() || {};
    const patches = {};
    for (const [convoId, convo] of Object.entries(convoData)) {
      if (!convo) { results.skipped++; continue; }
      if (convo.memberSet && typeof convo.memberSet === 'object' && Object.keys(convo.memberSet).length) {
        results.skipped++; continue; // already backfilled (or already written by the new saveConvos())
      }
      const memberList = Array.isArray(convo.participants) && convo.participants.length ? convo.participants
        : Array.isArray(convo.members) ? convo.members
        : Object.values(convo.participants || convo.members || {}).filter(n => n != null);
      if (!memberList.length) { results.skipped++; continue; }
      const memberSet = {};
      memberList.forEach(n => { if (n != null) memberSet[String(n)] = true; });
      if (Object.keys(memberSet).length) {
        patches[`conversations/${convoId}/memberSet`] = memberSet;
        results.updated++;
      } else {
        results.skipped++;
      }
    }
    if (Object.keys(patches).length > 0) {
      await fbdb.ref('/').update(patches);
    }
    showToast('✅ Backfill Complete',
      `Added a member index to ${results.updated} conversation(s). ${results.skipped} already had one or had no members. Errors: ${results.errors}`);
  } catch(e) {
    selfHeal('SCB-ADMIN-28', e, { context: 'adminBackfillMemberSets' });
    showToast('❌ Backfill Failed', scbErr('SCB-ADMIN-28', 'Conversation member-index backfill failed', e.message));
  }
}

// One-time migration: reports and blacklist used to be stored as a single
// array blob ({reports:[...]} / a plain array), which the tightened
// Firebase rules for those paths can no longer apply a per-entry
// create-vs-edit check against. getReports()/saveReports() and
// blockDeviceForAge() already migrate to the new per-id keyed shape
// automatically on their own next write — but until that happens, the OLD
// blob key is still sitting there, and the new rule only lets an ADMIN
// remove/replace an existing entry. That means an ORDINARY user's next
// report or age-block write would be rejected outright (the whole write is
// atomic — it can't partially succeed) until something admin-authored
// clears the stale blob first. Run this ONCE, before switching the live
// Firebase rules over to the tightened versions, so that moment never
// happens for a real user.
async function adminMigrateReportsAndBlacklist(){
  if(!requireAdmin()) return;
  showToast('📦 Migrating…', 'Converting reports & blacklist to per-entry storage…');
  const results = { reportsMigrated: 0, blacklistMigrated: 0, errors: 0 };
  try {
    const reportsSnap = await fbdb.ref('reports').get();
    const reportsVal = reportsSnap.val();
    if (reportsVal && reportsVal.reports !== undefined) {
      const arr = (Array.isArray(reportsVal.reports) ? reportsVal.reports : Object.values(reportsVal.reports || {})).filter(r => r && r.id);
      await fbdb.ref('reports').set(Object.fromEntries(arr.map(r => [r.id, r])));
      results.reportsMigrated = arr.length;
    }
  } catch(e) { results.errors++; }
  try {
    const blSnap = await fbdb.ref('blacklist').get();
    const blVal = blSnap.val();
    if (Array.isArray(blVal)) {
      const obj = {}; let i = 0;
      blVal.filter(Boolean).forEach(b => { obj[b.deviceId || b.ip || ('entry_'+(i++))] = b; });
      await fbdb.ref('blacklist').set(obj);
      results.blacklistMigrated = Object.keys(obj).length;
    }
  } catch(e) { results.errors++; }
  showToast('✅ Migration Complete',
    `Converted ${results.reportsMigrated} reports and ${results.blacklistMigrated} blacklist entries to per-entry storage. Errors: ${results.errors}. `+
    `Safe to push the tightened Firebase rules now.`);
}
// -- END FIREBASE DATA CLEANUP ------------------------------------------------

