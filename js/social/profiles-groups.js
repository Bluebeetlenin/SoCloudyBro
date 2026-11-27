// -- START ---------------------------------------------------------------------

// ── THEME (DARK/LIGHT MANUAL) ────────────────────────────────────────────
function toggleTheme() {
  const cur = localStorage.getItem('cc_theme') || 'auto';
  // cur==='schedule' used to fall through to isDark=false unconditionally,
  // so clicking this quick-toggle while on a schedule not only silently
  // dropped the user out of schedule mode into plain manual dark/light (the
  // schedule itself, in cc_theme_schedule, is left stored and can still be
  // switched back to from Settings — no data is lost), it also got the
  // target color wrong half the time: if the schedule currently had the
  // theme dark (e.g. nighttime), this still computed isDark=false and set
  // 'dark' again instead of toggling to 'light'.
  const isDark = cur === 'dark' || (cur === 'auto' && window.matchMedia('(prefers-color-scheme:dark)').matches) || (cur === 'schedule' && isWithinDarkSchedule());
  setTheme(isDark ? 'light' : 'dark');
}

// ── BAD WORD FILTER ──────────────────────────────────────────────────────────
// Words encoded as base64 to keep them out of plain sight
const _bw = ['ZnVjaw==','c2hpdA==','YXNz','YmljaA==','Y3VudA==','d2hvcmU=','ZGljaw==','cHVzc3k=','YmFzdGFyZA==','ZmFnZ290','cmV0YXJk','Y29jaw==','dHdhdA==','Y3JhcA==','cGlzcw==','c2x1dA==','ZG91Y2hlYmFn','YXNzaG9sZQ==','bW90aGVyZnVja2Vy','c29ub2ZhYml0Y2g='];
const BAD_WORDS = _bw.map(w => atob(w));
function filterBadWords(text) {
  if (!text) return text;
  let out = text;
  // Merge global BAD_WORDS with any server-specific custom keywords
  const conv = activeConvo && convosCache ? convosCache.find(x=>x&&x.key===activeConvo.key) : null;
  const customWords = (conv && conv.autoModWords) || [];
  const allWords = BAD_WORDS.concat(customWords.filter(w=>w&&w.trim()));
  allWords.forEach(w => {
    // Word-boundary match, not a bare substring search — without this, any
    // bad word that's also a substring of an innocent one gets falsely
    // censored (the classic "Scunthorpe problem": "ass" inside "wassap",
    // "hell" inside "hello", "cock" inside "cockpit", etc). \b only works
    // reliably around plain word characters, which is what BAD_WORDS entries
    // are; a bad word containing punctuation/spaces still gets escaped and
    // matched as-is, just without the extra boundary guard on that side.
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const boundary = /^[A-Za-z0-9_]/;
    const left = boundary.test(w[0]) ? '\\b' : '';
    const right = boundary.test(w[w.length-1]) ? '\\b' : '';
    const re = new RegExp(left+escaped+right, 'gi');
    out = out.replace(re, m => '#'.repeat(m.length));
  });
  return out;
}
async function saveWelcomeRules(){
  const conv=getActiveConvoObj();
  if(!conv||!conv.isServer) return;
  if(!(conv.admins&&conv.admins.includes(me.number))){ showToast('Admins only',''); return; }
  const rulesEl=document.getElementById('gp-welcome-rules');
  conv.welcomeRules=rulesEl?rulesEl.value.trim():'';
  try{ await saveConvos(); showToast('Welcome message saved','New members will see this when they first open the server.'); }
  catch(e){ showToast('Save failed',''); }
}
function openServerWelcome(c, conv){
  if(!c||!c.isServer) return;
  const seenKey='cc_seen_welcome_'+c.key;
  try{ if(localStorage.getItem(seenKey)) return; localStorage.setItem(seenKey,'1'); }catch(e){ return; }
  document.getElementById('swm-name').textContent=c.name||'Welcome';
  document.getElementById('swm-info').textContent=c.info||'You just joined this server.';
  const rulesEl=document.getElementById('swm-rules');
  const rules=conv&&conv.welcomeRules;
  if(rules&&rules.trim()){ rulesEl.textContent=rules; rulesEl.style.display='block'; }
  else rulesEl.style.display='none';
  const members=(conv&&(conv.participants||conv.members)||[]).length;
  document.getElementById('swm-members').textContent=members?members+' member'+(members===1?'':'s'):'';
  const iconEl=document.getElementById('swm-icon');
  if(c.avatar&&typeof c.avatar==='string'&&c.avatar.startsWith('data:image/')){
    iconEl.innerHTML='<img src="'+c.avatar+'" style="width:56px;height:56px;border-radius:12px;object-fit:cover">';
  } else { iconEl.textContent='🖥️'; }
  openModal('server-welcome-modal');
}
async function saveVerifyLevel(level){
  const conv=getActiveConvoObj();
  if(!conv||!conv.isServer) return;
  if(!(conv.admins&&conv.admins.includes(me.number))){ showToast('Admins only',''); return; }
  conv.verifyLevel=level||'none';
  try{ await saveConvos(); showToast('Verification level saved',''); }
  catch(e){ showToast('Save failed',''); }
}
async function saveAutoModWords(){
  const conv=getActiveConvoObj();
  if(!conv||!conv.isServer) return;
  if(!(conv.admins&&conv.admins.includes(me.number))){ showToast('Admins only',''); return; }
  const wordsEl=document.getElementById('gp-automod-words');
  if(!wordsEl) return;
  const words=wordsEl.value.split('\n').map(w=>w.trim().toLowerCase()).filter(w=>w.length>0&&w.length<80);
  conv.autoModWords=words;
  try{ await saveConvos(); showToast('AutoMod saved',words.length+' keyword'+(words.length===1?'':'s')+' active.'); }
  catch(e){ showToast('Save failed',''); }
}

// ── NICKNAMES ────────────────────────────────────────────────────────────────
let nicknames = (()=>{ try{ return JSON.parse(localStorage.getItem('cc_nicknames') || '{}'); }catch{ return {}; } })();
function getNickname(number) { return nicknames[number] || null; }
function setNickname(number, nick) {
  if (nick) nicknames[number] = nick;
  else delete nicknames[number];
  localStorage.setItem('cc_nicknames', JSON.stringify(nicknames));
}
function displayName(contact) {
  if (!contact) return '?';
  return getNickname(contact.number) || contact.name;
}

// ── CONTACT INFO PANEL ───────────────────────────────────────────────────────
function openContactPanel() {
  if (!activeConvo || activeConvo.type === 'group') { openGroupPanel(); return; }
  const c = activeConvo;
  if (isSelfKey(c.key)) return;
  const u = lookupUser(c.number) || {};
  const nick = getNickname(c.number);
  document.getElementById('cp-name').textContent = (dec(c.name)||c.name) + (nick ? '  (\u201C' + nick + '\u201D)' : '');
  document.getElementById('cp-number').textContent = '#' + c.number;
  document.getElementById('cp-bio').textContent = dec(u.bio || '') || 'No bio';
  document.getElementById('cp-nickname').value = nick || '';
  const online = isOnline(u.lastSeen);
  const statusEl = document.getElementById('cp-status');
  const customStatus = dec(u.customStatus || '');
  statusEl.textContent = customStatus || (online ? '\u25CF Online' : 'Last seen ' + fmtTime(u.lastSeen));
  statusEl.style.color = customStatus ? 'var(--text2)' : (online ? 'var(--success)' : 'var(--muted)');
  const mutualEl = document.getElementById('cp-mutual');
  if (mutualEl) {
    const mutualCount = (convosCache || []).filter(g =>
      g && g.type === 'group' && (g.participants || g.members || []).includes(c.number)
    ).length;
    mutualEl.textContent = mutualCount > 0 ? `${mutualCount} mutual group${mutualCount === 1 ? '' : 's'}` : '';
  }
  renderMutualFriends(c.number);
  const av = document.getElementById('cp-avatar');
  renderAvatar(av, { name: enc(c.name), avatar: (u&&u.avatar)||c.avatar||'' });
  // make avatar tappable for zoom
  av.style.cursor='zoom-in'; av.onclick=()=>openAvatarZoom(av);
  // load contact notes
  const notesEl=document.getElementById('cp-notes');
  if(notesEl){ const notes=getContactNote(c.number); notesEl.value=notes||''; }
  updatePingButtonState(c.number);
  openModal('contact-panel-overlay');
}

// -- MUTUAL FRIENDS --------------------------------------------------------
// "Friend" here means a DM contact — the same relationship the rest of the
// app already treats as a contact. Both my own list and the other person's
// are available client-side already (mine in `contacts`, theirs synced to
// their own users/{number}/prefs.contacts, which getUsers() already pulls
// into usersCache for every user — the same data every existing lookupUser()
// call already relies on), so no new sync path or storage is needed.
/* ===== "WHO CAN ADD ME TO GROUPS" (security feature 32/32) =====
   A privacy pref (anyone / mutuals / nobody) stored like every other
   privacy pref — users/{number}/prefs.privacy.groupAddPermission — so
   anyone attempting to add someone can read their current setting the
   same way getMutualFriends() below already reads another user's contact
   list. Default 'anyone' preserves existing behavior for anyone who's
   never touched this setting. ===== */
function _isMutualWithMe(targetNum){
  if(!me) return false;
  // Unanswered message requests never count as knowing each other.
  const iHaveThem=(contacts||[]).some(c=>c&&c.type==='dm'&&c.number===targetNum&&!c.request);
  const target=(usersCache||[]).find(x=>x&&x.number===targetNum);
  const theyHaveMe=((target&&target.prefs&&target.prefs.contacts)||[]).some(c=>c&&c.type==='dm'&&c.number===me.number&&!c.request);
  return iHaveThem&&theyHaveMe;
}
/* ===== "WHO CAN SEE MY NUMBER" (security feature 39/32) =====
   This app has no phone-number field — the account number IS its "phone
   number" equivalent (the thing people use to find/add each other), so
   that's the closest real mapping of this item. Same pref storage pattern
   as groupAddPermission above. Deliberately scoped to group member lists
   (where a number shows up next to someone you may not actually know) —
   your own number always shows to you, and a group's admins/mods always
   see every member's number regardless, since moderation needs it. ===== */
function canSeeNumber(targetNum){
  if(!me||targetNum===me.number) return true;
  const target=(usersCache||[]).find(x=>x&&x.number===targetNum);
  const pref=(target&&target.prefs&&target.prefs.privacy&&target.prefs.privacy.numberVisibility)||'anyone';
  if(pref==='nobody') return false;
  if(pref==='mutuals') return _isMutualWithMe(targetNum);
  return true;
}
function canAddToGroup(targetNum){
  const target=(usersCache||[]).find(x=>x&&x.number===targetNum);
  const pref=(target&&target.prefs&&target.prefs.privacy&&target.prefs.privacy.groupAddPermission)||'anyone';
  if(pref==='nobody') return false;
  if(pref==='mutuals') return _isMutualWithMe(targetNum);
  return true; // 'anyone', or an unrecognized value — fail open to the pre-existing behavior
}
function getMutualFriends(otherNumber){
  if(!me||!contacts) return [];
  const myFriendNums=new Set(
    contacts.filter(x=>x&&x.type==='dm'&&!x.request&&!x.isSelf&&x.number!=null&&String(x.number)!=='00000'&&x.number!==otherNumber).map(x=>x.number)
  );
  if(!myFriendNums.size) return [];
  const other=(usersCache||[]).find(x=>x&&x.number===otherNumber);
  const theirFriendNums=new Set(
    ((other&&other.prefs&&other.prefs.contacts)||[])
      .filter(x=>x&&x.type==='dm'&&x.number!=null&&String(x.number)!=='00000'&&x.number!==me.number)
      .map(x=>x.number)
  );
  const mutualNums=[...myFriendNums].filter(n=>theirFriendNums.has(n));
  return mutualNums.map(n=>{
    const u=lookupUser(n);
    return {number:n,name:(u&&dec(u.name))||('#'+n)};
  });
}
function renderMutualFriends(otherNumber){
  const label=document.getElementById('cp-mutual-friends');
  const list=document.getElementById('cp-mutual-friends-list');
  if(!label||!list) return;
  const friends=getMutualFriends(otherNumber);
  list.style.display='none'; list.innerHTML='';
  if(!friends.length){ label.style.display='none'; label.textContent=''; return; }
  label.style.display='';
  label.textContent=`👥 ${friends.length} mutual friend${friends.length===1?'':'s'}`;
  label._friends=friends;
}
function toggleMutualFriendsList(){
  const label=document.getElementById('cp-mutual-friends');
  const list=document.getElementById('cp-mutual-friends-list');
  if(!label||!list||!label._friends) return;
  const opening=list.style.display==='none';
  if(opening){
    list.innerHTML=label._friends.map(f=>
      `<span class="cloudy-chip" style="display:inline-block;margin:2px" data-number="${f.number}" onclick="closeModal('contact-panel-overlay');cloudyOpenChatByNumber(Number(this.dataset.number))">${esc(f.name)}</span>`
    ).join('');
  }
  list.style.display=opening?'block':'none';
}
// cloudyFindContact() only matches by name — the mutual-friends list already
// has the exact contact number, so look up (and open) by number directly.
function cloudyOpenChatByNumber(num){
  const target=contacts.find(x=>x&&x.type==='dm'&&x.number===num);
  if(target){ openChat(target); return; }
  const u=lookupUser(num);
  if(u) openChat({type:'dm',number:num,name:u.name||('#'+num),avatar:u.avatar||'',key:dmKey(me.number,num)});
}

// -- PING --------------------------------------------------------------------
// A lightweight "hey, pay attention" nudge — like AIM's Buzz — separate from
// sending a text message. Stored as a normal message (type:'ping') in the
// shared conversation, so it syncs the same way every other message does;
// rendered as a centered pill like a call-event, and triggers a shake +
// notification on the other person's side when it's a brand-new incoming one.
const PING_COOLDOWN_MS=60*1000;
function _pingCooldownKey(convKey){ return 'cc_last_ping_'+convKey; }
function pingCooldownRemaining(convKey){
  try{
    const last=parseInt(localStorage.getItem(_pingCooldownKey(convKey))||'0',10);
    return Math.max(0,PING_COOLDOWN_MS-(Date.now()-last));
  }catch{ return 0; }
}
function updatePingButtonState(otherNumber){
  const btn=document.getElementById('cp-ping-btn');
  if(!btn||!me) return;
  if(isBlockedEitherWay(otherNumber)){ btn.disabled=true; btn.textContent='🔔 Ping'; btn.style.display='none'; return; }
  btn.style.display='';
  const convKey=dmKey(me.number,otherNumber);
  const remaining=pingCooldownRemaining(convKey);
  btn.disabled=remaining>0;
  btn.textContent=remaining>0?`🔔 Ping (wait ${Math.ceil(remaining/1000)}s)`:'🔔 Ping';
}
async function sendPing(){
  if(!activeConvo||activeConvo.type==='group'||!me){ showToast('Ping','Open a direct chat first.'); return; }
  // Every other way of reaching someone (sendMsg, calls) already refuses to
  // go through when either side has blocked the other — pinging had no such
  // check, so a blocked contact could still shake/notify/sound-alert you
  // (and you could still ping them), defeating the point of blocking.
  if(isBlockedEitherWay(activeConvo.number)){ showToast('Can\'t ping',scbErr('SCB-MSG-22','This conversation is blocked.')); return; }
  const convKey=activeConvo.key;
  const remaining=pingCooldownRemaining(convKey);
  if(remaining>0){ showToast('Slow down','Wait '+Math.ceil(remaining/1000)+'s before pinging '+ (activeConvo.name||'them') +' again.'); return; }
  // Record the cooldown (and disable the button) BEFORE any await — a fast
  // double-click/tap used to race two calls past the synchronous check above
  // while the first call's getOrMakeConvo()/saveConvos() were still pending,
  // sending two pings well inside the 60s cooldown.
  localStorage.setItem(_pingCooldownKey(convKey),String(Date.now()));
  updatePingButtonState(activeConvo.number);
  try{
    const conv=await getOrMakeConvo(convKey,[me.number,activeConvo.number]);
    if(!Array.isArray(conv.messages)) conv.messages=[];
    conv.messages.push({id:'ping_'+convKey+'_'+Date.now(),type:'ping',from:me.number,time:Date.now()});
    await saveConvos();
    if(activeConvo.key===convKey){ lastMsgHash=''; renderMessages(conv.messages); }
    showToast('🔔 Pinged!','You pinged '+(activeConvo.name||'them')+'.');
  }catch(e){
    // A real failure shouldn't cost the user the full 60s cooldown for a ping
    // that never actually went out.
    localStorage.removeItem(_pingCooldownKey(convKey));
    updatePingButtonState(activeConvo.number);
    showToast('Ping failed',scbErr('SCB-MSG-24','Couldn\'t send the ping.',e.message));
  }
}
// Shake the chat window and notify when a fresh incoming ping arrives —
// shakes only when the ping belongs to the open chat.
function handleIncomingPing(fromNum,isOpen){
  const u=lookupUser(fromNum)||{};
  const name=dec(u.name)||'Someone';
  const from=contacts.find(c=>c.type!=='group'&&c.number===fromNum);
  sendNotif('Ping',name+' pinged you',from&&from.key);
  playPingSound();
  if(!isOpen){
    if(!shouldSuppressNotifications()) showToast('Ping',name+' pinged you');
    return;
  }
  const wrap=document.getElementById('chat-bg-wrapper')||document.getElementById('chat-panel');
  if(wrap){
    wrap.classList.remove('scb-ping-shake');
    void wrap.offsetWidth; // restart the animation if a ping lands twice quickly
    wrap.classList.add('scb-ping-shake');
    setTimeout(()=>wrap.classList.remove('scb-ping-shake'),600);
  }
}
function saveCpNickname() {
  if (!activeConvo) return;
  const nick = document.getElementById('cp-nickname').value.trim();
  setNickname(activeConvo.number, nick);
  // also save notes
  const notesEl=document.getElementById('cp-notes');
  if(notesEl) setContactNote(activeConvo.number, notesEl.value.trim());
  renderSidebar();
  document.getElementById('cp-name').textContent = activeConvo.name + (nick ? '  (\u201C' + nick + '\u201D)' : '');
  showToast('Saved', nick ? 'Nickname: "' + nick + '"' : 'Saved');
}
// Contact notes (private, localStorage only)
let _contactNotes=(()=>{try{return JSON.parse(localStorage.getItem('cc_contact_notes')||'{}')}catch{return {}}})();
function getContactNote(num){return _contactNotes[String(num)]||'';}
function setContactNote(num,note){if(note){_contactNotes[String(num)]=note;}else{delete _contactNotes[String(num)];}localStorage.setItem('cc_contact_notes',JSON.stringify(_contactNotes));}
async function deleteContact() {
  if (!activeConvo) return;
  if (!confirm('Delete this contact and chat history?')) return;
  contacts = contacts.filter(c=>c&&c.key !== activeConvo.key);
  // Previously this only removed the conversation from the in-memory convosCache and
  // called saveStorage() — which persists contacts/localStorage only, never touches
  // Firebase. The messages themselves were never actually deleted server-side, so a
  // reload (or syncContactsFromConvos() re-running) would resurrect the "deleted" chat
  // with full history, and starting a fresh chat with the same person hit the same
  // underlying conversation record and brought all the old messages right back.
  if (convosCache) convosCache = convosCache.filter(c=>c&&c.key !== activeConvo.key);
  saveStorage();
  try {
    await saveConvos(); // actually persist the removal to Firebase, not just local state
  } catch (e) {
    showToast('Delete may not have fully synced', scbErr('SCB-MSG-14','Chat removed locally, but saving to the server failed — check your connection.'));
  }
  activeConvo = null;
  hideAll();
  showMainEmpty();
  renderSidebar();
}

// ── GROUP INFO PANEL ─────────────────────────────────────────────────────────
let memberCtxTarget = null;
function isGroupAdmin() {
  if (!activeConvo || activeConvo.type !== 'group') return false;
  const conv = convosCache ? convosCache.find(x=>x&&x.key === activeConvo.key) : null;
  return conv && conv.admins && conv.admins.includes(me.number);
}
function openGroupPanel() {
  if (!activeConvo || activeConvo.type !== 'group') return;
  const conv = convosCache ? convosCache.find(x=>x&&x.key === activeConvo.key) : null;
  if (!conv) return;
  const isAdmin = conv.admins && conv.admins.includes(me.number);
  const isServer = !!conv.isServer;
  document.getElementById('gp-name').textContent = activeConvo.name;
  document.getElementById('gp-info-text').textContent = activeConvo.info || '';
  const members = conv.participants || conv.members || [];
  document.getElementById('gp-member-count').textContent = members.length + ' members';
  document.getElementById('gp-admin-note').textContent = isAdmin ? '\uD83D\uDC51 You are an admin' : '';
  document.getElementById('gp-edit-btn').style.display = isAdmin ? 'inline-flex' : 'none';
  document.getElementById('gp-name-edit').style.display = 'none';
  document.getElementById('gp-roles-section').style.display = isAdmin ? 'block' : 'none';
  // Badges: render what we already know synchronously, then kick off the
  // (async) auto-criteria check for the signed-in member \u2014 it re-renders
  // this same section again if it actually grants anything new.
  renderBadgesSection(conv);
  if(isServer) _checkAutoBadges(conv);
  // Server-only: invite code (visible to every member \u2014 any member can share
  // it, same as Discord) and pending join requests (admins only, since
  // approving is what actually wraps the E2E key for the new member).
  const inviteSection=document.getElementById('gp-invite-section');
  inviteSection.style.display = isServer ? 'block' : 'none';
  if(isServer){
    document.getElementById('gp-invite-code').textContent = conv.inviteCode || '\u2014';
    document.getElementById('gp-invite-regen-btn').style.display = isAdmin ? 'inline-flex' : 'none';
    // Invite expiry + max uses controls (admin only)
    const invSettingsEl=document.getElementById('gp-invite-settings');
    if(invSettingsEl) invSettingsEl.style.display=isAdmin?'flex':'none';
    if(isAdmin){
      const expiryEl=document.getElementById('gp-invite-expiry');
      const maxUsesEl=document.getElementById('gp-invite-maxuses');
      if(expiryEl) expiryEl.value=String(conv.inviteExpiry||0);
      if(maxUsesEl) maxUsesEl.value=String(conv.inviteMaxUses||0);
      const usageEl=document.getElementById('gp-invite-usage');
      if(usageEl){
        const used=conv.inviteUsed||0;
        const max=conv.inviteMaxUses||0;
        const expiry=conv.inviteExpiry;
        const issuedAt=conv.inviteIssuedAt||0;
        let parts=[];
        if(max) parts.push(used+' / '+max+' uses');
        if(expiry&&issuedAt){const exp=issuedAt+expiry;const rem=exp-Date.now();parts.push(rem>0?('Expires in '+_fmtDuration(rem)):'Expired');}
        usageEl.textContent=parts.join(' \u00b7 ');
      }
    }
  }
  const joinReqSection=document.getElementById('gp-join-requests-section');
  const joinRequests=(conv.joinRequests||[]);
  joinReqSection.style.display = (isServer && isAdmin && joinRequests.length) ? 'block' : 'none';
  if(isServer && isAdmin && joinRequests.length){
    document.getElementById('gp-join-requests-list').innerHTML = joinRequests.map(r=>{
      const u=lookupUser(r.number)||{};
      const name=dec(u.name||'')||r.name||('#'+r.number);
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--surface2);border-radius:6px;margin-bottom:4px">'
        +'<div style="flex:1;font-size:13px">'+esc(name)+' <span style="color:var(--muted);font-size:11px">#'+r.number+'</span></div>'
        +'<button class="btn btn-sm" data-number="'+r.number+'" onclick="approveJoinRequest(Number(this.dataset.number))">\u2713 Approve</button>'
        +'<button class="btn btn-ghost btn-sm" data-number="'+r.number+'" onclick="denyJoinRequest(Number(this.dataset.number))">\u2715</button>'
        +'</div>';
    }).join('');
  }
  // Welcome message / rules (admin only)
  const welcomeSection=document.getElementById('gp-welcome-section');
  if(welcomeSection) welcomeSection.style.display=isAdmin&&isServer?'block':'none';
  if(isAdmin&&isServer){
    const rulesEl=document.getElementById('gp-welcome-rules');
    if(rulesEl) rulesEl.value=conv.welcomeRules||'';
  }
  // Server verification level (admin only)
  const verifySection=document.getElementById('gp-verifylevel-section');
  if(verifySection) verifySection.style.display=isAdmin&&isServer?'block':'none';
  if(isAdmin&&isServer){
    const verifyEl=document.getElementById('gp-verify-level');
    if(verifyEl) verifyEl.value=conv.verifyLevel||'none';
  }
  // AutoMod custom keywords (admin only)
  const automodSection=document.getElementById('gp-automod-section');
  if(automodSection) automodSection.style.display=isAdmin&&isServer?'block':'none';
  if(isAdmin&&isServer){
    const wordsEl=document.getElementById('gp-automod-words');
    if(wordsEl) wordsEl.value=(conv.autoModWords||[]).join('\n');
  }
  // Quarantine new members (security feature 29/32) — admin-only toggle + pending-approval list
  const quarantineSection=document.getElementById('gp-quarantine-section');
  quarantineSection.style.display=isAdmin?'block':'none';
  if(isAdmin){
    document.getElementById('gp-quarantine-toggle').checked=!!conv.quarantineNewMembers;
    const pending=(conv.pendingApproval||[]).filter(n=>members.includes(n));
    const pendingWrap=document.getElementById('gp-quarantine-pending-wrap');
    pendingWrap.style.display=pending.length?'block':'none';
    if(pending.length){
      document.getElementById('gp-quarantine-pending-list').innerHTML=pending.map(n=>{
        const u=lookupUser(n)||{};
        const name=dec(u.name||'')||'#'+n;
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--surface2);border-radius:6px;margin-bottom:4px">'
          +'<div style="flex:1;font-size:13px">'+esc(name)+' <span style="color:var(--muted);font-size:11px">#'+n+'</span></div>'
          +'<button class="btn btn-sm" data-number="'+n+'" onclick="approveQuarantinedMember(Number(this.dataset.number))">✓ Approve</button>'
          +'</div>';
      }).join('');
    }
  }
  // Group/Server avatar
  const gpAv = document.getElementById('gp-avatar');
  if (typeof activeConvo.avatar==='string' && activeConvo.avatar.startsWith('data:image/')) {
    gpAv.innerHTML = '<img src="' + activeConvo.avatar + '" style="width:100%;height:100%;object-fit:cover;border-radius:12px"/>';
  } else { gpAv.innerHTML = isServer ? '\uD83D\uDDA5\uFE0F' : '\uD83D\uDC65'; }
  gpAv.style.background = isServer ? 'linear-gradient(135deg,#5865f2,#3ba55d)' : 'linear-gradient(135deg,#ca5010,#6264a0)';
  // Roles list
  const roles = conv.roles || [];
  const rolesEl = document.getElementById('gp-roles-list');
  rolesEl.innerHTML = roles.length ? roles.sort((a, b) => a.priority - b.priority).map(r =>
    '<div style="padding:6px 8px;background:var(--surface2);border-radius:6px;margin-bottom:4px">' +
    '<div style="display:flex;align-items:center;gap:8px">' +
    '<span>' + (r.icon || '\uD83C\uDFF7') + '</span><span style="font-size:13px;font-weight:500">' + esc(r.name) + '</span>' +
    '<span style="font-size:11px;color:var(--muted);margin-left:auto">P' + r.priority + '</span>' +
    '<button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" data-id="' + esc(r.id) + '" onclick="deleteRole(this.dataset.id)">×</button></div>' +
    (r.desc ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;padding-left:24px">' + esc(r.desc) + '</div>' : '') +
    '</div>'
  ).join('') : '<div style="font-size:12px;color:var(--muted)">No roles yet.</div>';
  // Members list
  const membersEl = document.getElementById('gp-members-list');
  membersEl.innerHTML = '';
  members.forEach(num => {
    const u = lookupUser(num) || {};
    const name = dec(u.name || '') || '#' + num;
    const isAdminMember = conv.admins && conv.admins.includes(num);
    const memberRole = (conv.memberRoles || {})[num];
    const roleObj = roles.find(r => r.id === memberRole);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--r-sm);cursor:context-menu;transition:background .15s';
    row.onmouseenter = () => row.style.background = 'var(--surface2)';
    row.onmouseleave = () => row.style.background = '';
    row.oncontextmenu = e => { e.preventDefault(); if (isAdmin && num !== me.number) showMemberCtxMenu(e, num); };
    const avDiv = document.createElement('div');
    avDiv.className = 'avatar'; avDiv.style.cssText = 'width:32px;height:32px;font-size:12px;background:var(--accent);color:#fff;flex-shrink:0';
    renderAvatar(avDiv, { name: enc(name), avatar: u.avatar || '' }, 32);
    row.appendChild(avDiv);
    const info = document.createElement('div'); info.style.flex = '1';
    // Security feature 39/32: "who can see my number" \u2014 a non-mutual,
    // non-admin viewer doesn't get this member's bare #number at all;
    // admins still see it (moderation needs it), and you always see your own.
    const numVisible = num===me.number || isAdmin || canSeeNumber(num);
    info.innerHTML = '<div style="font-size:13px;font-weight:500">' + esc(name) + (num === me.number ? ' <span style="color:var(--muted)">(you)</span>' : '') + '</div>' +
      '<div style="font-size:11px;color:var(--muted)">' + (numVisible?('#' + num):'') + (isAdminMember ? ' \u2022 \uD83D\uDC51 Admin' : '') + (roleObj ? ' \u2022 ' + roleObj.icon + ' ' + roleObj.name : '') + '</div>';
    row.appendChild(info);
    membersEl.appendChild(row);
  });
  openModal('group-panel-overlay');
}
function toggleGpEdit() {
  const sec = document.getElementById('gp-name-edit');
  sec.style.display = sec.style.display === 'none' ? 'block' : 'none';
  if (sec.style.display === 'block') {
    document.getElementById('gp-name-input').value = activeConvo.name;
    document.getElementById('gp-info-input').value = activeConvo.info || '';
  }
}
async function saveGroupInfo() {
  if (!isGroupAdmin()) { showToast('Admins only', scbErr('SCB-GRP-12','Only group admins can rename this group.')); return; }
  const name = document.getElementById('gp-name-input').value.trim();
  const info = document.getElementById('gp-info-input').value.trim();
  if (!name) return;
  if (!convosCache) return;
  const conv = convosCache.find(x=>x&&x.key === activeConvo.key);
  // These used to be written as `conv.groupName`/`conv.groupInfo`, AES-encrypted.
  // Nothing in the entire app ever read either field: the shared group record's
  // name/description is created by submitNewGroup() as PLAINTEXT `c.name`/
  // `c.info`, and that is what syncContactsFromConvos() reads to build every
  // other member's contact entry. So a rename only ever updated the renamer's
  // own local copy (activeConvo + their contacts entry) — every other member
  // kept seeing the old name forever, and the renamer themselves lost it on a
  // new device or after a localStorage clear. Write the fields that are
  // actually read, in the plaintext format the group record already uses.
  if (conv) { conv.name = name; conv.info = info; await saveConvos(); }
  activeConvo.name = name; activeConvo.info = info;
  const ci = contacts.find(c=>c&&c.key === activeConvo.key);
  if (ci) { ci.name = name; ci.info = info; saveStorage(); }
  document.getElementById('gp-name').textContent = name;
  document.getElementById('chat-header-name').textContent = name;
  document.getElementById('gp-name-edit').style.display = 'none';
  showToast('Group updated', '');
}
// Adds members to an existing group (the header ➕ button) — admin-only,
// reuses the same E2E key-wrapping helper new-group creation uses so
// encryption keeps working for everyone once they're added.
function quickAddMember(){
  if(!activeConvo||activeConvo.type!=='group') return;
  const conv=getActiveConvoObj();
  if(!conv) return;
  if(!isGroupAdmin()){ showToast('Admins only',scbErr('SCB-GRP-13','Only group admins can add members.')); return; }
  const existingMembers=new Set((conv.participants||conv.members||[]).map(Number));
  const bannedMembers=new Set((conv.banned||[]).map(Number));
  const pick=document.getElementById('add-group-member-pick-list'); pick.innerHTML='';
  const sel=document.getElementById('add-group-member-selected'); sel.innerHTML='';
  document.getElementById('add-group-member-error').textContent='';
  const eligible=knownContacts().filter(c=>c.type!=='group'&&!c.isSelf&&!existingMembers.has(c.number)&&!bannedMembers.has(Number(c.number)));
  if(!eligible.length){
    pick.innerHTML='<div style="font-size:12px;color:var(--muted)">All your contacts are already in this group.</div>';
  }
  eligible.forEach(c=>{
    const row=document.createElement('div');row.className='sb-item';row.style.borderRadius='var(--r-xs)';row.style.cursor='pointer';row.dataset.num=c.number;
    row.innerHTML=`<div class="avatar" style="width:30px;height:30px;font-size:12px;background:linear-gradient(135deg,#0078d4,#6264a0);color:#fff">${c.name.charAt(0).toUpperCase()}</div><span style="font-size:13px">${esc(c.name)} <span style="color:var(--muted)">#${c.number}</span></span>`;
    row.onclick=()=>toggleAddGroupMember(c.number,c.name,row);
    pick.appendChild(row);
  });
  openModal('add-group-member-modal');
}
function toggleAddGroupMember(num,name,row){
  const sel=document.getElementById('add-group-member-selected');
  const pick=document.getElementById('add-group-member-pick-list');
  const theRow=row||(pick&&[...pick.children].find(r=>String(r.dataset.num)===String(num)));
  const existingChip=sel.querySelector(`[data-num="${num}"]`);
  if(existingChip){ existingChip.remove(); if(theRow) theRow.style.background=''; }
  else{
    const chip=document.createElement('div');chip.className='chip';chip.dataset.num=num;
    chip.innerHTML=esc(name)+' <span class="chip-remove" data-act="toggleAddGroupMember">×</span>';
    sel.appendChild(chip); if(theRow) theRow.style.background='var(--bg3)';
  }
}
// System messages: group-membership events ("X joined", "X left"), rendered
// as small centered pills in renderMessages() (collapsed into one summary
// when 3+ land in a row). Appended straight into conv.messages so they sync
// to every member the same way a real message does.
function _addSystemMessage(conv, text){
  if(!conv||!text) return;
  if(!Array.isArray(conv.messages)) conv.messages=[];
  conv.messages.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,5),type:'system',time:Date.now(),text});
}
// Security feature 28/32: throttle how many group adds/invites one account
// can send per hour, regardless of how many different groups it spreads
// them across — localStorage-backed rolling window, same spirit as the
// existing message-rate spam detector's sliding window.
const GROUP_INVITE_HOURLY_LIMIT=20;
function _groupInviteTimestamps(){
  try{ return JSON.parse(localStorage.getItem('cc_group_invite_times')||'[]'); }catch(e){ return []; }
}
function _groupInviteHourlyCount(){
  const now=Date.now();
  return _groupInviteTimestamps().filter(t=>now-t<3600000).length;
}
function _recordGroupInvites(count){
  const now=Date.now();
  const times=_groupInviteTimestamps().filter(t=>now-t<3600000);
  for(let i=0;i<count;i++) times.push(now);
  try{ localStorage.setItem('cc_group_invite_times',JSON.stringify(times)); }catch(e){}
}
async function submitAddGroupMembers(){
  const conv=getActiveConvoObj();
  const err=document.getElementById('add-group-member-error'); err.textContent='';
  if(!conv) return;
  // quickAddMember() checks isGroupAdmin() before opening the picker, but the
  // write itself did not — the modal can be reopened/submitted without going
  // back through that entry point.
  if(!isGroupAdmin()){ err.textContent=scbErr('SCB-GRP-14','Only group admins can add members.'); return; }
  const chips=document.getElementById('add-group-member-selected').querySelectorAll('.chip');
  const bannedMembers=new Set((conv.banned||[]).map(Number));
  const nums=Array.from(chips).map(c=>parseInt(c.dataset.num)).filter(n=>!bannedMembers.has(n));
  if(!nums.length){ err.textContent=scbErr('SCB-GRP-15','Select at least one contact.'); return; }
  if(me.number!==ADMIN_NUMBER){
    const soFar=_groupInviteHourlyCount();
    if(soFar+nums.length>GROUP_INVITE_HOURLY_LIMIT){
      err.textContent=scbErr('SCB-GRP-46','You\'ve added/invited too many people recently ('+soFar+'/'+GROUP_INVITE_HOURLY_LIMIT+' this hour) — try again later.');
      return;
    }
  }
  // Security feature 32/32: "who can add me to groups" — skip (don't add
  // and don't fail the rest of the batch over) anyone whose own privacy
  // setting doesn't permit it.
  const privacyBlocked=nums.filter(n=>!canAddToGroup(n));
  const privacyAllowedNums=nums.filter(n=>canAddToGroup(n));
  nums.length=0; nums.push(...privacyAllowedNums);
  if(!nums.length){ err.textContent=scbErr('SCB-GRP-49','None of those contacts can be added — their privacy settings don\'t allow it.'); return; }
  try{
    const failed=[];
    for(const n of nums){ if(!await addMemberToGroupKey(conv,n)) failed.push(n); }
    const added=nums.filter(n=>!failed.includes(n));
    if(added.length) _recordGroupInvites(added.length);
    added.forEach(n=>_maybeQuarantineNewMember(conv,n));
    const existing=new Set((conv.participants||conv.members||[]).map(Number));
    added.forEach(n=>existing.add(n));
    const merged=[...existing];
    conv.participants=merged; conv.members=merged;
    added.forEach(n=>{ const u=lookupUser(n); _addSystemMessage(conv,(dec(u&&u.name)||('#'+n))+' was added to the group'); });
    await saveConvos();
    closeModal('add-group-member-modal');
    const privacyNote=privacyBlocked.length?(' ('+privacyBlocked.length+' other contact'+(privacyBlocked.length===1?'':'s')+' couldn\'t be added — their privacy settings don\'t allow it.)'):'';
    if(failed.length&&added.length){
      showToast('Some members added',scbErr('SCB-GRP-44','Added '+added.length+', but couldn\'t securely add '+failed.length+' (no key exchange with them yet) — ask them to message you first, then retry.'+privacyNote));
    } else if(failed.length){
      err.textContent=scbErr('SCB-GRP-44','Couldn\'t securely add those contacts — no key exchange with them yet. Ask them to message you first, then retry.'+privacyNote);
      return;
    } else {
      showToast('Members added',privacyNote.trim());
    }
    openGroupPanel();
  }catch(e){ err.textContent=scbErr('SCB-GRP-16','Those members couldn\'t be added — the server rejected the write.',e.message); }
}
async function leaveGroup() {
  if (!confirm('Leave this group?')) return;
  if (!convosCache) return;
  const conv = convosCache.find(x=>x&&x.key === activeConvo.key);
  if (conv) {
    await _removeMemberFromConv(conv, me.number);
    _addSystemMessage(conv,(dec(me.name)||me.name||('#'+me.number))+' left the '+(conv.isServer?'server':'group'));
    await saveConvos();
  }
  contacts = contacts.filter(c=>c&&c.key !== activeConvo.key);
  saveStorage(); activeConvo = null;
  closeModal('group-panel-overlay');
  hideAll(); showMainEmpty();
  renderSidebar();
}

// -- SERVERS: invite code + join requests ---------------------------------------
function copyServerInviteCode(){
  const conv=getActiveConvoObj();
  if(!conv||!conv.inviteCode) return;
  navigator.clipboard.writeText(conv.inviteCode).then(
    ()=>showToast('Copied','Invite code copied to clipboard.'),
    ()=>showToast('Copy failed',scbErr('SCB-GRP-31','Couldn\'t copy — copy it manually instead.'))
  );
}
async function regenerateServerInviteCode(){
  const conv=getActiveConvoObj();
  if(!conv||!conv.isServer) return;
  if(!(conv.admins&&conv.admins.includes(me.number))){ showToast('Admins only',scbErr('SCB-GRP-32','Only server admins can regenerate the invite code.')); return; }
  if(!confirm('Generate a new invite code? The old code will stop working.')) return;
  conv.inviteCode=generateInviteCode();
  conv.inviteIssuedAt=Date.now();
  conv.inviteUsed=0;
  const expiryEl=document.getElementById('gp-invite-expiry');
  const maxUsesEl=document.getElementById('gp-invite-maxuses');
  conv.inviteExpiry=expiryEl?parseInt(expiryEl.value)||0:0;
  conv.inviteMaxUses=maxUsesEl?parseInt(maxUsesEl.value)||0:0;
  try{ await saveConvos(); openGroupPanel(); showToast('New invite code','The old code no longer works.'); }
  catch(e){ showToast('Failed',scbErr('SCB-GRP-33','That code couldn\'t be regenerated — the server rejected the write.',(e.message||''))); }
}
function openJoinServer(){
  if(!me){ showToast('Set up first',scbErr('SCB-GRP-34','Finish setting up your account before joining a server.')); return; }
  const input=document.getElementById('join-server-code'); if(input) input.value='';
  document.getElementById('join-server-error').textContent='';
  openModal('join-server-modal');
}
async function submitJoinServer(){
  const err=document.getElementById('join-server-error'); err.textContent='';
  const codeRaw=document.getElementById('join-server-code').value.trim().toUpperCase();
  if(!codeRaw){ err.textContent=scbErr('SCB-GRP-35','Enter an invite code.'); return; }
  if(!convosCache) await getConvos();
  const conv=convosCache.find(c=>c&&c.isServer&&c.inviteCode===codeRaw);
  if(!conv){ err.textContent=scbErr('SCB-GRP-36','No server found with that code.'); return; }
  // Check expiry
  if(conv.inviteExpiry&&conv.inviteIssuedAt&&(Date.now()>conv.inviteIssuedAt+conv.inviteExpiry)){
    err.textContent='This invite link has expired. Ask an admin to generate a new one.'; return;
  }
  // Check max uses
  if(conv.inviteMaxUses&&conv.inviteUsed>=(conv.inviteMaxUses)){
    err.textContent='This invite link has reached its maximum number of uses. Ask an admin to generate a new one.'; return;
  }
  const members=conv.participants||conv.members||[];
  if(members.includes(me.number)){ err.textContent=scbErr('SCB-GRP-37','You\'re already a member of that server.'); return; }
  if(!Array.isArray(conv.joinRequests)) conv.joinRequests=[];
  if(conv.joinRequests.some(r=>r.number===me.number)){ err.textContent=scbErr('SCB-GRP-38','You\'ve already requested to join — waiting on an admin to approve.'); return; }
  conv.joinRequests.push({number:me.number,name:me.name||('#'+me.number),time:Date.now()});
  if(typeof conv.inviteUsed==='number') conv.inviteUsed++;
  else if(conv.inviteMaxUses) conv.inviteUsed=1;
  try{
    // Written narrowly to conversations/<key>/joinRequests only, NOT via the
    // general saveConvos() (which replaces the whole conversation object) —
    // the requester isn't a member yet, so the Firebase rule only allows
    // them to write this one specific path, not the conversation as a
    // whole. See the conversations rule's joinRequests sub-rule comment.
    await fbdb.ref('conversations/'+conv.key+'/joinRequests').set(conv.joinRequests);
    closeModal('join-server-modal');
    showToast('Request sent','An admin needs to approve your request to join "'+(conv.name||'that server')+'".');
  }catch(e){ err.textContent=scbErr('SCB-GRP-39','That request couldn\'t be sent — the server rejected the write.',(e.message||'')); }
}
// Approving is what actually grants E2E access: only the approving admin's
// browser has the server's group key (getGroupAesKey() inside
// addMemberToGroupKey() requires already being a member), so a join
// request — rather than an instant join — is what lets that wrapping
// happen at all, the same way an ordinary "add member" already works.
async function approveJoinRequest(num){
  const conv=getActiveConvoObj();
  if(!conv||!conv.isServer) return;
  if(!(conv.admins&&conv.admins.includes(me.number))){ showToast('Admins only',scbErr('SCB-GRP-40','Only server admins can approve join requests.')); return; }
  try{
    const wrapped=await addMemberToGroupKey(conv,num);
    if(!wrapped){
      showToast('Can\'t approve yet',scbErr('SCB-GRP-41','Couldn\'t securely add this person — no key exchange with them yet. Ask them to DM you first, then approve again.'));
      return;
    }
    const existing=new Set((conv.participants||conv.members||[]).map(Number));
    existing.add(num);
    const merged=[...existing];
    conv.participants=merged; conv.members=merged;
    conv.joinRequests=(conv.joinRequests||[]).filter(r=>r.number!==num);
    _maybeQuarantineNewMember(conv,num);
    const joinedUser=lookupUser(num);
    _addSystemMessage(conv,(dec(joinedUser&&joinedUser.name)||('#'+num))+' joined the '+(conv.isServer?'server':'group'));
    await saveConvos();
    openGroupPanel();
    showToast('Member approved','');
  }catch(e){ showToast('Failed',scbErr('SCB-GRP-41','That request couldn\'t be approved — the server rejected the write.',(e.message||''))); }
}
/* ===== QUARANTINE NEW MEMBERS (security feature 29/32) =====
   When enabled for a group, a member added while it's on has their
   messages tagged quarantined:true (in sendMsg()) until an admin/mod
   explicitly approves them — renderMessages() hides a quarantined
   message from everyone except its own sender and the group's admins
   (who need to see it to review), so it reads as a real, if unreviewed,
   message to a mod rather than a silent deception like shadow-mute. ===== */
async function toggleGroupQuarantine(on){
  const conv=getActiveConvoObj();
  if(!conv||!isGroupAdmin()) return;
  conv.quarantineNewMembers=!!on;
  try{ await saveConvos(); showToast(on?'Quarantine enabled':'Quarantine disabled',on?'New members\' messages will be held for mod approval.':''); }
  catch(e){ showToast('Failed',scbErr('SCB-GRP-47','Couldn\'t save that setting — the server rejected the write.',(e.message||''))); }
}
// Called wherever a member is actually admitted to a group — adds them to
// the pending-approval list only if quarantine is currently on.
function _maybeQuarantineNewMember(conv,num){
  if(!conv||!conv.quarantineNewMembers||num===me.number) return;
  if(!Array.isArray(conv.pendingApproval)) conv.pendingApproval=[];
  if(!conv.pendingApproval.includes(num)) conv.pendingApproval.push(num);
}
async function approveQuarantinedMember(num){
  const conv=getActiveConvoObj();
  if(!conv||!isGroupAdmin()) return;
  conv.pendingApproval=(conv.pendingApproval||[]).filter(n=>n!==num);
  // Retroactively un-hide everything they already sent while quarantined —
  // approval means their backlog becomes visible too, not just future messages.
  (conv.messages||[]).forEach(m=>{ if(m&&m.from===num&&m.quarantined) delete m.quarantined; });
  try{
    await saveConvos();
    lastMsgHash='';
    if(activeConvo&&activeConvo.key===conv.key) renderMessages(conv.messages);
    openGroupPanel();
    showToast('Member approved','Their messages are now visible to everyone.');
  }catch(e){ showToast('Failed',scbErr('SCB-GRP-48','Couldn\'t save that approval — the server rejected the write.',(e.message||''))); }
}
async function denyJoinRequest(num){
  const conv=getActiveConvoObj();
  if(!conv||!conv.isServer) return;
  if(!(conv.admins&&conv.admins.includes(me.number))){ showToast('Admins only',scbErr('SCB-GRP-42','Only server admins can deny join requests.')); return; }
  conv.joinRequests=(conv.joinRequests||[]).filter(r=>r.number!==num);
  try{ await saveConvos(); openGroupPanel(); }
  catch(e){ showToast('Failed',scbErr('SCB-GRP-43','That couldn\'t be saved — the server rejected the write.',(e.message||''))); }
}

// Member context menu
function showMemberCtxMenu(e, num) {
  memberCtxTarget = num;
  const menu = document.getElementById('member-ctx-menu');
  // Measure actual rendered size instead of guessing — this menu's item
  // count varies by permission (admin vs regular member), so a fixed guess
  // is wrong even more often than the similar fix in showCtxMenu().
  menu.style.left='-9999px';menu.style.top='-9999px';menu.style.display='block';
  const mw=menu.offsetWidth,mh=menu.offsetHeight;
  menu.style.left = Math.max(4,Math.min(e.clientX, window.innerWidth-mw-4)) + 'px';
  menu.style.top = Math.max(4,Math.min(e.clientY, window.innerHeight-mh-4)) + 'px';
  document.addEventListener('click', () => { menu.style.display = 'none'; }, { once: true });
}
// Shared cleanup for kicking/banning/leaving a group. conv.participants was
// the only roster array any removal path used to prune — isConvoMemberOf()
// and sendMsg()'s own membership guard both prefer conv.members when it's
// present, so a kicked/banned/left member whose entry stayed in conv.members
// could keep sending into the group indefinitely despite the UI showing them
// as removed. Also drops their now-stale per-member data (roles, badges,
// message count, join timestamp, wrapped group key copy) instead of leaving
// it dangling.
async function _removeMemberFromConv(conv, num) {
  conv.participants = (conv.participants || []).filter(n => n !== num);
  if (conv.members) conv.members = conv.members.filter(n => n !== num);
  if (conv.admins) {
    conv.admins = conv.admins.filter(n => n !== num);
    // Without this, a group whose only/last admin leaves (or is removed)
    // becomes permanently unmanageable — regenerating the invite code,
    // approving join requests, kicking/banning, and promoting anyone else
    // all gate on conv.admins.includes(), so an empty admins list is a dead
    // end nobody can recover from, not just "no one happens to be admin
    // right now". Auto-promote the longest-standing remaining member (or
    // just the first one left, if join times aren't tracked) instead.
    if (!conv.admins.length) {
      const remainingMembers = (conv.members && conv.members.length ? conv.members : conv.participants) || [];
      if (remainingMembers.length) {
        let nextAdmin = remainingMembers[0];
        if (conv.memberJoinedAt) {
          const sorted = remainingMembers.slice().sort((a, b) => (conv.memberJoinedAt[a] ?? Infinity) - (conv.memberJoinedAt[b] ?? Infinity));
          nextAdmin = sorted[0];
        }
        conv.admins = [nextAdmin];
        const promotedUser = (usersCache || []).find(u => u && u.number === nextAdmin);
        const promotedName = promotedUser ? (dec(promotedUser.name) || promotedUser.name) : ('#' + nextAdmin);
        _addSystemMessage(conv, promotedName + ' is now an admin (the group had none left)');
      }
    }
  }
  if (conv.coadmins) conv.coadmins = conv.coadmins.filter(n => n !== num);
  if (conv.memberRoles) delete conv.memberRoles[num];
  if (conv.memberBadges) delete conv.memberBadges[num];
  if (conv.memberMsgCount) delete conv.memberMsgCount[num];
  if (conv.memberJoinedAt) delete conv.memberJoinedAt[num];
  if (conv.wrappedKeys) {
    delete conv.wrappedKeys[num];
    // Deleting their wrappedKeys entry alone isn't enough — they may already
    // have the current key cached locally. Actually rotate it so the group's
    // real AES content key changes, not just who can fetch a copy of it.
    const remaining = (conv.members && conv.members.length ? conv.members : conv.participants) || [];
    if (remaining.length) {
      const ok = await rotateGroupKey(conv, remaining);
      if (!ok) console.warn('Group key rotation after member removal failed — group key unchanged (likely missing a remaining member\'s public key); the removed member may still be able to decrypt new messages until this is retried.');
    }
  }
}
async function memberCtxAction(action) {
  const num = memberCtxTarget;
  if (!num || !convosCache) return;
  const conv = convosCache.find(x=>x&&x.key === activeConvo.key);
  if (!conv) return;
  document.getElementById('member-ctx-menu').style.display = 'none';
  // Group-admin actions were gated only by the UI (the member context menu
  // is bound behind `isAdmin`, the roles section is display:none for everyone
  // else). That is a rendering decision, not an enforcement point — the write
  // itself never asked who was calling it. Re-check at the write.
  if (action !== 'message' && !isGroupAdmin()) { showToast('Admins only', scbErr('SCB-GRP-17','Only group admins can manage members.')); return; }
  if (action !== 'message' && num === me.number) { showToast('Not allowed', scbErr('SCB-GRP-18','You can\'t run that action on yourself.')); return; }
  if (action === 'message') {
    const u = lookupUser(num) || {};
    const name = dec(u.name || '') || '#' + num;
    const key = 'dm_' + [me.number, num].sort((a, b) => a - b).join('_');
    let c = contacts.find(x=>x&&x.key === key);
    if (!c) { c = { type: 'dm', number: num, name, avatar: u.avatar || '', key }; contacts.push(c); saveStorage(); }
    closeModal('group-panel-overlay'); openChat(c);
  } else if (action === 'remove') {
    if (!confirm('Kick this member?')) return;
    await _removeMemberFromConv(conv, num);
    if (activeConvo) activeConvo.members = (activeConvo.members || []).filter(n => n !== num);
    const ci = contacts.find(x=>x&&x.key === conv.key); if (ci) ci.members = (ci.members || []).filter(n => n !== num);
    saveStorage();
    await saveConvos(); openGroupPanel(); showToast('Member kicked', '');
  } else if (action === 'ban') {
    if (!confirm('Ban and kick this member? They will not be able to be added back to this group.')) return;
    await _removeMemberFromConv(conv, num);
    if (!conv.banned) conv.banned = [];
    if (!conv.banned.includes(num)) conv.banned.push(num);
    if (activeConvo) activeConvo.members = (activeConvo.members || []).filter(n => n !== num);
    const ci = contacts.find(x=>x&&x.key === conv.key); if (ci) ci.members = (ci.members || []).filter(n => n !== num);
    saveStorage();
    await saveConvos(); openGroupPanel(); showToast('Member banned and kicked', '');
  } else if (action === 'admin') {
    if (!conv.admins) conv.admins = [];
    if (!conv.admins.includes(num)) conv.admins.push(num);
    await saveConvos(); showToast('Admin assigned', ''); openGroupPanel();
  } else if (action === 'coadmin') {
    if (!conv.admins) conv.admins = [];
    if (!conv.admins.includes(num)) conv.admins.push(num);
    if (!conv.coadmins) conv.coadmins = [];
    if (!conv.coadmins.includes(num)) conv.coadmins.push(num);
    await saveConvos(); showToast('Co-admin assigned', ''); openGroupPanel();
  } else if (action === 'role') {
    const roles = conv.roles || [];
    if (!roles.length) { showToast('No roles yet', scbErr('SCB-GRP-19','Create a role first.')); return; }
    const u2 = lookupUser(num) || {};
    document.getElementById('assign-role-desc').textContent = 'Assign a role to ' + (dec(u2.name || '') || '#' + num);
    const list = document.getElementById('assign-role-list');
    list.innerHTML = roles.map(r =>
      '<div class="sb-item" style="border-radius:var(--r-xs);cursor:pointer" data-id="' + esc(r.id) + '" data-number="' + num + '" onclick="assignRole(this.dataset.id,this.dataset.number)">' +
      '<span style="font-size:18px">' + r.icon + '</span>' +
      '<div><div style="font-size:13px;font-weight:500">' + esc(r.name) + '</div><div style="font-size:11px;color:var(--muted)">Priority ' + r.priority + '</div></div></div>'
    ).join('');
    openModal('assign-role-modal');
  }
}
async function assignRole(roleId, num) {
  if (!convosCache) return;
  if (!isGroupAdmin()) { showToast('Admins only', scbErr('SCB-GRP-20','Only group admins can assign roles.')); return; }
  const conv = convosCache.find(x=>x&&x.key === activeConvo.key);
  if (!conv) return;
  if (!conv.memberRoles) conv.memberRoles = {};
  conv.memberRoles[num] = roleId;
  await saveConvos();
  closeModal('assign-role-modal');
  showToast('Role assigned', '');
  openGroupPanel();
}
// Roles
function openCreateRole() { document.getElementById('role-name-input').value = ''; document.getElementById('role-icon-input').value = ''; document.getElementById('role-desc-input').value = ''; document.getElementById('role-priority-input').value = 5; document.getElementById('role-error').textContent = ''; openModal('role-modal'); }
async function saveRole() {
  if (!isGroupAdmin()) { showToast('Admins only', scbErr('SCB-GRP-21','Only group admins can create roles.')); return; }
  const name = document.getElementById('role-name-input').value.trim();
  const icon = document.getElementById('role-icon-input').value.trim() || '\uD83C\uDFF7';
  const desc = document.getElementById('role-desc-input').value.trim();
  const priority = parseInt(document.getElementById('role-priority-input').value) || 5;
  if (!name) { document.getElementById('role-error').textContent = scbErr('SCB-GRP-22','Enter a role name.'); return; }
  if (!convosCache) return;
  const conv = convosCache.find(x=>x&&x.key === activeConvo.key);
  if (!conv) return;
  if (!conv.roles) conv.roles = [];
  conv.roles.push({ id: Date.now().toString(36), name, icon, desc, priority });
  await saveConvos();
  closeModal('role-modal');
  showToast('Role created', name);
  openGroupPanel();
}
async function deleteRole(roleId) {
  if (!isGroupAdmin()) { showToast('Admins only', scbErr('SCB-GRP-23','Only group admins can delete roles.')); return; }
  if (!confirm('Delete this role?')) return;
  if (!convosCache) return;
  const conv = convosCache.find(x=>x&&x.key === activeConvo.key);
  if (!conv) return;
  conv.roles = (conv.roles || []).filter(r => r.id !== roleId);
  if (conv.memberRoles) {
    Object.keys(conv.memberRoles).forEach(num => {
      if (conv.memberRoles[num] === roleId) delete conv.memberRoles[num];
    });
  }
  await saveConvos();
  openGroupPanel();
}

// ── BADGES (Discord-style, server-owner-defined) ────────────────────────────
// Scoped per SERVER (a group with isServer:true), not per plain group —
// mirrors roles' data shape:
//   conv.badges         : [{id,name,icon,desc,criteria}]
//   conv.memberBadges   : {num: [badgeId,...]}    — who has actually earned what
//   conv.memberJoinedAt : {num: timestamp}         — stamped in addMemberToGroupKey()
// criteria is null (manual — an admin grants/revokes it by hand) or
// {type:'account_age_days',days:N} / {type:'member_for_days',days:N},
// evaluated client-side for the signed-in member only (see _checkAutoBadges) —
// so an auto-criteria badge is picked up the next time ITS OWNER has the
// server's panel open, not instantly for every qualifying member at once.
// A member can hold badges from several servers; which ONE they display
// everywhere their name appears is their own choice (me.selectedBadge),
// synced like any other profile field so everyone else can resolve it via
// lookupUser() — see equippedBadgeHtml().
function isServerBadgeOwner(conv){
  return !!(conv && conv.admins && me && conv.admins.includes(me.number));
}
function updateBadgeCriteriaFieldVisibility(){
  const type=document.getElementById('badge-criteria-select').value;
  const manual=(type==='manual');
  document.getElementById('badge-criteria-days-field').style.display=manual?'none':'block';
  if(!manual) document.getElementById('badge-criteria-days-label').textContent =
    (type==='account_age_days') ? 'Account age (days)' :
    (type==='member_for_days') ? 'Member for (days)' : 'Messages sent';
}
function openCreateBadge(){
  const conv=getActiveConvoObj();
  if(!isServerBadgeOwner(conv)){ showToast('Admins only',scbErr('SCB-GRP-50','Only server admins can create badges.')); return; }
  document.getElementById('badge-name-input').value='';
  document.getElementById('badge-icon-input').value='';
  document.getElementById('badge-desc-input').value='';
  document.getElementById('badge-criteria-select').value='manual';
  document.getElementById('badge-criteria-days').value=30;
  updateBadgeCriteriaFieldVisibility();
  document.getElementById('badge-error').textContent='';
  openModal('badge-modal');
}
async function saveBadge(){
  const conv=getActiveConvoObj();
  if(!isServerBadgeOwner(conv)){ showToast('Admins only',scbErr('SCB-GRP-50','Only server admins can create badges.')); return; }
  const err=document.getElementById('badge-error'); err.textContent='';
  const name=document.getElementById('badge-name-input').value.trim();
  const icon=document.getElementById('badge-icon-input').value.trim()||'🏅';
  const desc=document.getElementById('badge-desc-input').value.trim();
  const critType=document.getElementById('badge-criteria-select').value;
  if(!name){ err.textContent=scbErr('SCB-GRP-51','Enter a badge name.'); return; }
  let criteria=null;
  if(critType==='account_age_days'||critType==='member_for_days'){
    const days=parseInt(document.getElementById('badge-criteria-days').value);
    if(!days||days<1){ err.textContent=scbErr('SCB-GRP-52','Enter a number of days greater than 0.'); return; }
    criteria={type:critType,days};
  }else if(critType==='message_count'){
    const count=parseInt(document.getElementById('badge-criteria-days').value);
    if(!count||count<1){ err.textContent=scbErr('SCB-GRP-52','Enter a number of messages greater than 0.'); return; }
    criteria={type:critType,count};
  }
  if(!convosCache) return;
  const liveConv=convosCache.find(x=>x&&x.key===conv.key);
  if(!liveConv) return;
  if(!liveConv.badges) liveConv.badges=[];
  liveConv.badges.push({id:Date.now().toString(36),name,icon,desc,criteria});
  await saveConvos();
  closeModal('badge-modal');
  showToast('Badge created',icon+' '+name);
  openGroupPanel();
}
async function deleteBadge(badgeId){
  const conv=getActiveConvoObj();
  if(!isServerBadgeOwner(conv)){ showToast('Admins only',scbErr('SCB-GRP-53','Only server admins can delete badges.')); return; }
  if(!confirm('Delete this badge? Anyone currently displaying it will stop seeing it.')) return;
  if(!convosCache) return;
  const liveConv=convosCache.find(x=>x&&x.key===conv.key);
  if(!liveConv) return;
  liveConv.badges=(liveConv.badges||[]).filter(b=>b.id!==badgeId);
  // Best-effort cleanup — equippedBadgeHtml() re-validates every render
  // anyway (badge must still exist AND still be held), so a deleted badge
  // disappears everywhere on its own even without this, but there's no
  // reason to leave dangling ids sitting in memberBadges forever.
  if(liveConv.memberBadges){
    Object.keys(liveConv.memberBadges).forEach(num=>{
      liveConv.memberBadges[num]=(liveConv.memberBadges[num]||[]).filter(id=>id!==badgeId);
    });
  }
  await saveConvos();
  openGroupPanel();
}
function openManageBadge(badgeId){
  const conv=getActiveConvoObj();
  if(!isServerBadgeOwner(conv)){ showToast('Admins only',scbErr('SCB-GRP-54','Only server admins can grant badges.')); return; }
  const liveConv=(convosCache&&convosCache.find(x=>x&&x.key===conv.key))||conv;
  const badge=(liveConv.badges||[]).find(b=>b.id===badgeId);
  if(!badge) return;
  document.getElementById('badge-members-title').textContent='Manage: '+badge.icon+' '+badge.name;
  const members=liveConv.participants||liveConv.members||[];
  document.getElementById('badge-members-list').innerHTML = members.length ? members.map(num=>{
    const u=lookupUser(num)||{};
    const name=dec(u.name||'')||'#'+num;
    const has=((liveConv.memberBadges||{})[num]||[]).includes(badgeId);
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--surface2);border-radius:6px;margin-bottom:4px">'
      +'<div style="flex:1;font-size:13px">'+esc(name)+'<span style="color:var(--muted);font-size:11px"> #'+num+'</span></div>'
      +'<button class="btn btn-sm'+(has?' btn-ghost':'')+'" data-badge-id="'+esc(badgeId)+'" data-number="'+num+'" onclick="toggleBadgeForMember(this.dataset.badgeId,this.dataset.number)">'+(has?'✓ Granted':'Grant')+'</button>'
      +'</div>';
  }).join('') : '<div style="font-size:12px;color:var(--muted)">No members.</div>';
  openModal('badge-members-modal');
}
async function toggleBadgeForMember(badgeId,num){
  const conv=getActiveConvoObj();
  if(!isServerBadgeOwner(conv)){ showToast('Admins only',scbErr('SCB-GRP-54','Only server admins can grant badges.')); return; }
  if(!convosCache) return;
  const liveConv=convosCache.find(x=>x&&x.key===conv.key);
  if(!liveConv) return;
  if(!liveConv.memberBadges) liveConv.memberBadges={};
  const held=liveConv.memberBadges[num]||[];
  liveConv.memberBadges[num]=held.includes(badgeId) ? held.filter(id=>id!==badgeId) : [...held,badgeId];
  await saveConvos();
  openManageBadge(badgeId); // re-render the same modal so the admin can toggle several members in a row
  renderBadgesSection(liveConv);
}
// Runs for the signed-in member only, when their server panel is opened —
// lazy, same "check when viewed" pattern as the rest of this app (security
// score, diagnostics), not a background job watching every member.
async function _checkAutoBadges(conv){
  if(!conv||!me||!Array.isArray(conv.badges)||!conv.badges.length) return;
  const mine=new Set((conv.memberBadges||{})[me.number]||[]);
  const joinedAt=(conv.memberJoinedAt||{})[me.number]||null;
  const accountCreatedAt=me.createdAt||null;
  const msgCount=(conv.memberMsgCount||{})[me.number]||0;
  const earned=[];
  for(const b of conv.badges){
    if(!b.criteria||mine.has(b.id)) continue;
    let qualifies=false;
    if(b.criteria.type==='account_age_days'&&accountCreatedAt) qualifies=(Date.now()-accountCreatedAt)>=b.criteria.days*86400000;
    else if(b.criteria.type==='member_for_days'&&joinedAt) qualifies=(Date.now()-joinedAt)>=b.criteria.days*86400000;
    else if(b.criteria.type==='message_count') qualifies=msgCount>=b.criteria.count;
    if(qualifies) earned.push(b);
  }
  if(!earned.length) return;
  if(!convosCache) return;
  const liveConv=convosCache.find(x=>x&&x.key===conv.key);
  if(!liveConv) return;
  if(!liveConv.memberBadges) liveConv.memberBadges={};
  if(!liveConv.memberBadges[me.number]) liveConv.memberBadges[me.number]=[];
  earned.forEach(b=>liveConv.memberBadges[me.number].push(b.id));
  try{ await saveConvos(); }catch(e){ return; }
  earned.forEach(b=>showToast('🏅 Badge earned!',b.icon+' '+b.name+' — '+(liveConv.name||'this server')));
  renderBadgesSection(liveConv);
}
function renderBadgesSection(conv){
  const section=document.getElementById('gp-badges-section');
  if(!section||!conv) return;
  const isServer=!!conv.isServer;
  section.style.display=isServer?'block':'none';
  if(!isServer) return;
  const isAdmin=isServerBadgeOwner(conv);
  const badges=conv.badges||[];
  const mine=new Set((conv.memberBadges||{})[me.number]||[]);
  document.getElementById('gp-badges-list').innerHTML = badges.length ? badges.map(b=>{
    const holds=mine.has(b.id);
    const equipped=!!(me.selectedBadge&&me.selectedBadge.serverKey===conv.key&&me.selectedBadge.badgeId===b.id);
    const reqText = b.criteria
      ? ('Automatic — '+(
          b.criteria.type==='account_age_days' ? 'account at least '+b.criteria.days+' day'+(b.criteria.days===1?'':'s')+' old' :
          b.criteria.type==='member_for_days' ? 'member for at least '+b.criteria.days+' day'+(b.criteria.days===1?'':'s') :
          'send at least '+b.criteria.count+' message'+(b.criteria.count===1?'':'s')+' in this server'
        ))
      : (b.desc || 'Awarded by a server admin');
    return '<div style="padding:8px;background:var(--surface2);border-radius:6px;margin-bottom:6px">'
      +'<div style="display:flex;align-items:center;gap:8px">'
      +'<span style="font-size:16px">'+esc(b.icon||'🏅')+'</span>'
      +'<span style="font-size:13px;font-weight:500;flex:1">'+esc(b.name)+'</span>'
      +(isAdmin?'<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 8px" data-id="'+esc(b.id)+'" onclick="openManageBadge(this.dataset.id)">Manage</button>':'')
      +(isAdmin?'<button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" data-id="'+esc(b.id)+'" onclick="deleteBadge(this.dataset.id)">×</button>':'')
      +'</div>'
      +'<div style="font-size:11px;color:var(--muted);margin-top:2px;padding-left:24px">'+esc(reqText)+'</div>'
      +(holds
        ? ('<div style="margin-top:4px;padding-left:24px">'+(equipped
            ? ('<span style="font-size:11px;color:var(--success,#27ae60)">✓ Displaying on your profile</span> <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 6px" onclick="clearMyBadge()">Hide</button>')
            : ('<button class="btn btn-ghost btn-sm" style="font-size:11px" data-key="'+esc(conv.key)+'" data-id="'+esc(b.id)+'" onclick="selectMyBadge(this.dataset.key,this.dataset.id)">Display this badge</button>'))+'</div>')
        : '')
      +'</div>';
  }).join('') : '<div style="font-size:12px;color:var(--muted)">No badges yet.</div>';
  const createBtn=document.getElementById('gp-badges-create-btn');
  if(createBtn) createBtn.style.display=isAdmin?'inline-flex':'none';
}
async function selectMyBadge(serverKey,badgeId){
  if(!me) return;
  me.selectedBadge={serverKey,badgeId};
  saveStorage();
  try{ await registerOrUpdate(); }catch(e){}
  showToast('Badge displayed','');
  try{ renderSidebar(); }catch(e){}
  try{ renderMyCard(); }catch(e){}
  const conv=getActiveConvoObj();
  if(conv&&convosCache){ const liveConv=convosCache.find(x=>x&&x.key===conv.key); if(liveConv) renderBadgesSection(liveConv); }
}
async function clearMyBadge(){
  if(!me) return;
  me.selectedBadge=null;
  saveStorage();
  try{ await registerOrUpdate(); }catch(e){}
  showToast('Badge removed','');
  try{ renderSidebar(); }catch(e){}
  try{ renderMyCard(); }catch(e){}
  const conv=getActiveConvoObj();
  if(conv&&convosCache){ const liveConv=convosCache.find(x=>x&&x.key===conv.key); if(liveConv) renderBadgesSection(liveConv); }
}
// Mirrors verifiedBadge(num) exactly — splice this next to it wherever a
// name renders. Re-validates against live data every call (the server
// convo still exists, the badge is still defined, the member still
// actually holds it) so a deleted badge or a revoked grant disappears
// everywhere on its own, with nothing to clean up at the point of change.
function equippedBadgeHtml(num){
  const u=lookupUser(num);
  let html='';
  // Individually admin-granted badges — not tied to any one group, unlike
  // conv.badges below. Always shown (no "equip one at a time" pool to
  // compete over, since these aren't earned per-group criteria — an admin
  // granted them directly), so every one of them renders here.
  if(u&&Array.isArray(u.globalBadges)){
    u.globalBadges.forEach(b=>{
      if(!b) return;
      html+=' <span class="equipped-badge" title="'+esc(b.name||'')+'">'+esc(b.icon||'🏅')+'</span>';
    });
  }
  const sel=u&&u.selectedBadge;
  if(!sel||!sel.serverKey||!sel.badgeId||!convosCache) return html;
  const conv=convosCache.find(c=>c&&c.key===sel.serverKey);
  if(!conv) return html;
  const badge=(conv.badges||[]).find(b=>b.id===sel.badgeId);
  if(!badge) return html;
  const held=((conv.memberBadges||{})[num]||[]).includes(badge.id);
  if(!held) return html;
  return html+' <span class="equipped-badge" title="'+esc(badge.name)+' — '+esc(conv.name||'')+'">'+esc(badge.icon||'🏅')+'</span>';
}
// -- INDIVIDUAL (ADMIN-GRANTED) BADGES ---------------------------------------
async function openGrantBadgeModal(number){
  if(!requirePermission('badges_grant')) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===number);
    if(!u){ showToast('Not found',''); return; }
    const existing=Array.isArray(u.globalBadges)?u.globalBadges:[];
    let m=document.getElementById('badge-grant-modal');
    if(!m){
      m=document.createElement('div');m.className='overlay';m.id='badge-grant-modal';
      m.innerHTML='<div class="modal" style="max-width:380px"><div class="modal-header"><h2>🏅 Badges — <span id="badge-grant-who"></span></h2></div><div class="modal-body" id="badge-grant-body"></div></div>';
      m.addEventListener('click',e=>{if(e.target===m)closeModal('badge-grant-modal');});
      document.body.appendChild(m);
    }
    document.getElementById('badge-grant-who').textContent='#'+number;
    const body=document.getElementById('badge-grant-body');
    body.innerHTML=
      '<div id="badge-grant-list" style="margin-bottom:12px">'
      +(existing.length?existing.map((b,i)=>'<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)"><span style="font-size:18px">'+esc(b.icon||'🏅')+'</span><span style="flex:1;font-size:13px">'+esc(b.name||'')+'</span><button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-number="'+number+'" data-i="'+i+'" onclick="revokeGlobalBadge(Number(this.dataset.number),Number(this.dataset.i))">Revoke</button></div>').join(''):'<div style="font-size:12px;color:var(--muted)">No individual badges yet.</div>')
      +'</div>'
      +'<div style="display:flex;gap:6px;align-items:center">'
      +'<input type="text" id="badge-grant-icon" placeholder="🏅" maxlength="4" style="width:54px;text-align:center">'
      +'<input type="text" id="badge-grant-name" placeholder="Badge name" maxlength="40" style="flex:1">'
      +'</div>'
      +'<button class="btn btn-sm" style="margin-top:8px" data-number="'+number+'" onclick="grantGlobalBadge(Number(this.dataset.number))">+ Grant Badge</button>'
      +'<div style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-act="closeModalById" data-modal="badge-grant-modal">Close</button></div>';
    openModal('badge-grant-modal');
  }catch(e){ showToast('Error',scbErr('SCB-ADMIN-28','Badges couldn\'t be loaded.',e.message)); }
}
async function grantGlobalBadge(number){
  if(!requirePermission('badges_grant')) return;
  const iconEl=document.getElementById('badge-grant-icon'), nameEl=document.getElementById('badge-grant-name');
  const icon=(iconEl.value||'🏅').trim().slice(0,4)||'🏅';
  const name=(nameEl.value||'').trim().slice(0,40);
  if(!name){ showToast('Name required',''); return; }
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===number);
    if(!u){ showToast('Not found',''); return; }
    if(!Array.isArray(u.globalBadges)) u.globalBadges=[];
    u.globalBadges.push({id:Date.now().toString(36),icon,name,grantedBy:me.number,grantedAt:Date.now()});
    await saveUsers(users);
    _logAdminAction('grant_badge','#'+number+': '+name).catch(()=>{});
    showToast('Granted',name+' granted to #'+number+'.');
    openGrantBadgeModal(number);
  }catch(e){ showToast('Failed',scbErr('SCB-ADMIN-29','That badge couldn\'t be saved — the server rejected the write.',e.message)); }
}
async function revokeGlobalBadge(number,index){
  if(!requirePermission('badges_grant')) return;
  try{
    const users=await getUsers();
    const u=users.find(x=>x.number===number);
    if(!u||!Array.isArray(u.globalBadges)) return;
    const removed=u.globalBadges.splice(index,1)[0];
    await saveUsers(users);
    _logAdminAction('revoke_badge','#'+number+': '+((removed&&removed.name)||'')).catch(()=>{});
    openGrantBadgeModal(number);
  }catch(e){ showToast('Failed',scbErr('SCB-ADMIN-30','That badge couldn\'t be revoked — the server rejected the write.',e.message)); }
}


// ── MESSAGE SEARCH ────────────────────────────────────────────────────────────
let msgSearchActive = false;
function searchContacts(q) {
  searchQ = q;
  if (q.startsWith('/') || q.length > 2) {
    const results = searchMessages(q.startsWith('/') ? q.slice(1) : q);
    if (results.length) { showMsgSearchResults(results); return; }
  }
  hideMsgSearchResults();
  renderSidebar();
}
function searchMessages(q) {
  if (!convosCache || !q) return [];
  const results = [];
  const lq = q.toLowerCase();
  convosCache.forEach(conv => {
    const contact = contacts.find(c=>c&&c.key === conv.key);
    if (!contact) return;
    conv.messages.forEach(m => {
      const text = msgText(m);
      if (text.toLowerCase().includes(lq)) {
        results.push({ conv, contact, msg: m, text });
      }
    });
  });
  return results.slice(0, 20);
}
function showMsgSearchResults(results) {
  const el = document.getElementById('msg-search-results');
  el.style.display = 'block';
  el.innerHTML = '<div style="padding:8px 14px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--muted)">Message Results</div>' +
    results.map((r, i) =>
      '<div class="sb-item" style="border-radius:0;padding:10px 14px;cursor:pointer" data-i="' + i + '" onclick="jumpToMessage(Number(this.dataset.i))">' +
      '<div class="avatar" style="width:32px;height:32px;font-size:12px;background:var(--accent);color:#fff">' + (r.contact.name || '?').charAt(0).toUpperCase() + '</div>' +
      '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500">' + esc(r.contact.name) + '</div>' +
      '<div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.text.substring(0, 60)) + '</div></div>' +
      '<div style="font-size:10px;color:var(--muted)">' + fmtTime(r.msg.time) + '</div></div>'
    ).join('');
  window._msgSearchResults = results;
}
function hideMsgSearchResults() {
  document.getElementById('msg-search-results').style.display = 'none';
  window._msgSearchResults = null;
}
async function jumpToMessage(idx) {
  const r = (window._msgSearchResults || [])[idx];
  if (!r) return;
  hideMsgSearchResults();
  document.getElementById('sb-search').querySelector('input').value = '';
  searchQ = '';
  await openChat(r.contact);
  // Scroll to message
  setTimeout(() => {
    const wrap = document.getElementById('messages-wrap');
    const bubbles = wrap.querySelectorAll('.bubble');
    const msgs = r.conv.messages;
    const mIdx = msgs.findIndex(m => m.id === r.msg.id);
    if (bubbles[mIdx]) {
      bubbles[mIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
      bubbles[mIdx].style.outline = '2px solid var(--accent)';
      setTimeout(() => { if (bubbles[mIdx]) bubbles[mIdx].style.outline = ''; }, 2000);
    }
  }, 400);
}

