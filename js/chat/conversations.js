// -- SIDEBAR -------------------------------------------------------------------
function renderSidebar(){
  const list=document.getElementById('sb-list');list.innerHTML='';
  if(!me){list.innerHTML='<div class="section-empty">Set up your account first.</div>';return;}
  let items=contacts.filter(c=>{
    const isArchived=archivedContacts[c.key||dmKey(me.number,c.number)];
    if(currentTab==='archived') return isArchived;
    if(currentTab==='chats') return !isArchived&&c.type!=='group';
    if(currentTab==='groups') return !isArchived&&c.type==='group'&&!c.isServer;
    if(currentTab==='servers') return !isArchived&&c.type==='group'&&!!c.isServer;
    return false;
  });
  if(searchQ){items=items.filter(c=>c.name.toLowerCase().includes(searchQ.toLowerCase())||(c.number&&String(c.number).includes(searchQ)));}
  if(!items.length){list.innerHTML=`<div class="section-empty">${currentTab==='archived'?'No archived chats.':currentTab==='groups'?'No groups yet.':currentTab==='servers'?'No servers yet — create one or join with an invite code.':'No contacts yet.'}</div>`;return;}
  items.forEach(c=>{ 
    const key=c.key||dmKey(me.number,c.number);
    const isActive=activeConvo&&activeConvo.key===key;
    const conv=convosCache?convosCache.find(x=>x&&x.key===key):null;
    const lastMsg=conv&&conv.messages.length?conv.messages[conv.messages.length-1]:null;
    const preview=lastMsg?(lastMsg.gif?'🖼 GIF':lastMsg.type==='ping'?'🔔 Ping':lastMsg.type==='call'?'📞 '+(lastMsg.missed?scbT('missed_call'):scbT('voice_call')):(msgText(lastMsg)||'')).substring(0,32):'';
    const timeStr=lastMsg?fmtTime(lastMsg.time):'';
    const online=c.type!=='group'?isOnline((lookupUser(c.number)||{}).lastSeen):false;
    const inCall=c.type!=='group'&&_numbersInActiveCall.has(Number(c.number));
    const div=document.createElement('div');
    div.className='sb-item'+(isActive?' active':'');
    div.onclick=()=>openChat(c);
    div.oncontextmenu=(e)=>{e.preventDefault();showContactCtxMenu(e,c);};
    const _safeGrpAv=(c.avatar&&typeof c.avatar==='string'&&(c.avatar.startsWith('data:image/')||c.avatar.startsWith('https://')))?`<img src="${esc(c.avatar)}" style="width:100%;height:100%;object-fit:cover;">`:(c.isServer?'🖥️':'👥');
    const _isCloudyContact=c.avatar==='__cloudy__';
    const avDiv=c.type==='group'?`<div class="group-avatar" style="background:${c.isServer?'linear-gradient(135deg,#5865f2,#3ba55d)':'linear-gradient(135deg,#ca5010,#6264a0)'};color:#fff;font-size:16px;">${_safeGrpAv}</div>`:_isCloudyContact?`<div style="position:relative"><div class="avatar" style="width:38px;height:38px;font-size:20px;background:linear-gradient(135deg,#60a5fa,#a78bfa);color:#fff;display:flex;align-items:center;justify-content:center;border-radius:50%;">☁️</div><div class="online-ring" style="background:var(--success)"></div></div>`:`<div style="position:relative"><div class="avatar" style="width:38px;height:38px;font-size:14px;background:linear-gradient(135deg,#0078d4,#6264a0);color:#fff;${typeof c.avatar==='string'&&c.avatar.startsWith('data:image/')?'background:none;':''}">${typeof c.avatar==='string'&&c.avatar.startsWith('data:image/')?`<img src="${c.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:(c.name||'?').charAt(0).toUpperCase()}</div><div class="${online?'online-ring':'offline-ring'}"></div></div>`;
    const _cDispName=dec(c.name)||c.name||'?';
    div.innerHTML=`${avDiv}<div class="sb-item-info"><div class="sb-item-top"><span class="sb-item-name">${esc(_cDispName)}${c.type!=='group'?verifiedBadge(c.number)+equippedBadgeHtml(c.number):''}${inCall?' <span title="In a call now" style="color:var(--success)">\u260E</span>':''}</span><span class="sb-item-time">${timeStr}</span></div><div class="sb-item-preview">${esc(preview)}</div></div>`;
    list.appendChild(div);
  });
}
function switchTab(tab,btn){
  currentTab=tab;
  document.querySelectorAll('.sb-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  // On phone, the sidebar is hidden (display:none) while a chat is open —
  // switching tabs (e.g. the sidebar's Chats/Groups tabs while a DM is
  // open) re-rendered it invisibly with no visible effect. Harmless no-op
  // everywhere else (desktop/tablet never set chat-open).
  if(typeof closeChatToSidebar==='function') closeChatToSidebar();
  renderSidebar();
}

// -- CONTACT CONTEXT MENU ------------------------------------------------------
let ctxContact=null;
function showContactCtxMenu(e,c){
  ctxContact=c;
  const menu=document.getElementById('contact-ctx-menu');
  // Measure actual rendered size instead of guessing — see showCtxMenu()'s
  // comment for why a hardcoded guess here silently goes stale.
  menu.style.left='-9999px';menu.style.top='-9999px';menu.style.display='block';
  const mw=menu.offsetWidth,mh=menu.offsetHeight;
  menu.style.left=Math.max(4,Math.min(e.clientX,window.innerWidth-mw-4))+'px';
  menu.style.top=Math.max(4,Math.min(e.clientY,window.innerHeight-mh-4))+'px';
  document.addEventListener('click',hideContactCtxMenu,{once:true});
}
function hideContactCtxMenu(){
  const menu=document.getElementById('contact-ctx-menu');
  if(menu) menu.style.display='none';
}
function toggleHeaderMenu(e){
  e.stopPropagation();
  const menu=document.getElementById('chat-header-menu');
  if(!menu) return;
  const opening=!menu.classList.contains('visible');
  if(opening){
    // Show "Verify security" only for DMs where both parties have E2E keys
    const safetyItem=document.getElementById('safety-numbers-item');
    if(safetyItem){
      const isDm=activeConvo&&activeConvo.type!=='group';
      const theirKey=isDm&&activeConvo.number?_userPubKeyStr(activeConvo.number):null;
      safetyItem.style.display=(isDm&&theirKey&&_myPubJwk)?'flex':'none';
    }
    // Update disappearing label to show current setting
    const disappearItem=document.getElementById('disappear-menu-item');
    if(disappearItem&&activeConvo){
      const conv=convosCache&&convosCache.find(x=>x&&x.key===activeConvo.key);
      const ttl=conv&&conv.disappearAfter;
      const label=ttl?_disappearLabel(ttl):'Off';
      disappearItem.textContent='⏱ Disappearing: '+label;
    }
  }
  menu.classList.toggle('visible',opening);
  if(opening) setTimeout(()=>document.addEventListener('click',hideHeaderMenu,{once:true}),0);
}
function hideHeaderMenu(){
  const menu=document.getElementById('chat-header-menu');
  if(menu) menu.classList.remove('visible');
}
function removeContact(){
  if(!ctxContact) return;
  const key=ctxContact.key||dmKey(me.number,ctxContact.number);
  const name=ctxContact.name;
  if(!confirm(`Remove "${name}" from your contacts?`)) return;
  contacts=contacts.filter(c=>(c.key||dmKey(me.number,c.number))!==key);
  removedContacts[key]=true; // block sync from re-adding
  saveStorage();
  if(activeConvo&&activeConvo.key===key){
    activeConvo=null;
    hideAll();
    showMainEmpty();
  }
  renderSidebar();
  renderDashboardWidget('online');
  renderDashboardWidget('recent');
  showToast('Contact removed','');
  ctxContact=null;
}

// -- OPEN CHAT -----------------------------------------------------------------
async function _origOpenChat(c){
  // Flush any unsaved draft for the chat we're LEAVING under its own key
  // BEFORE cancelEdit() runs below — cancelEdit() unconditionally blanks
  // #msg-input (even when there was no edit in progress), so doing this
  // after it would always flush an empty string. This also has to happen
  // before activeConvo flips to the new chat's key further down: without
  // it, a keystroke landing during the async load a few lines down
  // (onMsgInput -> _saveDraft()) would save using the NEW chat's key while
  // the input still held the OLD chat's leftover text, leaking one chat's
  // draft into another's.
  if(activeConvo&&activeConvo.key){
    const _oldInp=document.getElementById('msg-input');
    if(_oldInp){
      try{ const k='cc_draft_'+activeConvo.key; if(_oldInp.value) localStorage.setItem(k,_oldInp.value); else localStorage.removeItem(k); }catch{}
      _oldInp.value='';
    }
  }
  if(typeof cancelEdit==='function') cancelEdit();
  if(typeof cleanupRaceListeners==='function') cleanupRaceListeners();
  const key=c.key||dmKey(me.number,c.number);
  if(lockedChats[key]){
    // Do NOT touch activeConvo here — it must keep pointing at whatever chat
    // is actually rendered on screen until this one is really unlocked, or a
    // cancelled unlock leaves activeConvo silently pointed at a locked chat
    // no one is looking at (see _chatLockTarget).
    _chatLockTarget={...c,key};
    openChatLockOverlay();
    return;
  }
  activeConvo={...c,key};
  lastMsgHash='';
  if(typeof loadChatBg==='function') loadChatBg(key);
  if(typeof exitMsgSelectMode==='function') exitMsgSelectMode();
  if(typeof _restoreKeyChangeBannerIfAny==='function'&&c.type!=='group'&&c.number) _restoreKeyChangeBannerIfAny(c.number);
  else { const kcb=document.getElementById('key-change-banner'); if(kcb) kcb.style.display='none'; }
  hideAll();
  const searchBar=document.getElementById('msg-search-bar');
  if(searchBar&&searchBar.style.display!=='none'){searchBar.style.display='none';clearMsgSearchHighlights();msgSearchResults=[];msgSearchIdx=-1;}
  const mentionSug=document.getElementById('mention-suggest');
  if(mentionSug){mentionSug.classList.remove('visible');mentionSug.innerHTML='';}
  document.getElementById('chat-panel').classList.add('visible');
  if (document.body.classList.contains('device-phone')) document.body.classList.add('chat-open');
  // Header
  const _bizUser = c.type!=='group'&&c.number ? lookupUser(c.number) : null;
  const _bizActive = _bizUser && _bizUser.bizProfile && _bizUser.bizProfile.enabled;
  document.getElementById('chat-header-name').innerHTML=esc(dec(c.name)||c.name)+(c.number?' · #'+c.number:'')+(c.type!=='group'&&c.number?verifiedBadge(c.number)+equippedBadgeHtml(c.number):'') + (_bizActive ? ' <span class="biz-badge" title="Business account" style="cursor:pointer" data-number="'+c.number+'" data-act="bizView">BIZ</span>' : '');
  // DMs: a 1-on-1 chat has no per-message sender name/avatar to click (that's
  // only shown in groups), so the header — already styled "Click for info"
  // but with nothing actually wired to it — is the one place to reach the
  // new profile card from. Groups don't have an equivalent info view yet,
  // so left as-is rather than wiring it to something that doesn't exist.
  const chatHeaderAv=document.getElementById('chat-header-av');
  if(c.type!=='group'&&c.number){
    document.getElementById('chat-header-name').onclick=()=>openUserProfile(c.number);
    // .onX property assignment (not addEventListener) is safe to repeat on
    // every openChat() call — this is a persistent element reused across
    // every chat, so addEventListener here would stack a fresh listener
    // per chat switch instead of just replacing the target number.
    if(chatHeaderAv){
      chatHeaderAv.style.cursor='pointer';
      chatHeaderAv.onclick=()=>openUserProfile(c.number);
      chatHeaderAv.onmouseenter=()=>scheduleUserHoverCard(c.number,chatHeaderAv);
      chatHeaderAv.onmouseleave=cancelUserHoverCard;
    }
  } else {
    document.getElementById('chat-header-name').onclick=null;
    if(chatHeaderAv){ chatHeaderAv.onmouseenter=null; chatHeaderAv.onmouseleave=null; }
    if(chatHeaderAv){ chatHeaderAv.style.cursor=''; chatHeaderAv.onclick=null; }
  }
  const pollBtn=document.getElementById('poll-compose-btn');if(pollBtn) pollBtn.style.display=c.type==='group'?'flex':'none';
  const gameBtn=document.getElementById('game-compose-btn');if(gameBtn) gameBtn.style.display='flex';
  const addMemberBtn=document.getElementById('add-member-btn');if(addMemberBtn) addMemberBtn.style.display=c.type==='group'?'flex':'none';
  const blockBtn=document.getElementById('block-menu-item');
  if(blockBtn){
    blockBtn.style.display=c.type==='group'?'none':'flex';
    const isBlocked=!!(me&&me.blocked&&me.blocked.includes(c.number));
    blockBtn.innerHTML=isBlocked?'✅ Unblock':'⛔ Block';
  }
  const blockCallsBtn=document.getElementById('block-calls-menu-item');
  if(blockCallsBtn){
    blockCallsBtn.style.display=c.type==='group'?'none':'flex';
    const callsBlocked=!!(me&&Array.isArray(me.blockedCalls)&&me.blockedCalls.includes(c.number));
    blockCallsBtn.innerHTML=callsBlocked?'✅ Unblock calls':'📵 Block calls only';
  }
  const blockMsgsBtn=document.getElementById('block-messages-menu-item');
  if(blockMsgsBtn){
    blockMsgsBtn.style.display=c.type==='group'?'none':'flex';
    const msgsBlocked=!!(me&&Array.isArray(me.blockedMessages)&&me.blockedMessages.includes(c.number));
    blockMsgsBtn.innerHTML=msgsBlocked?'✅ Unblock messages':'🔇 Block messages only';
  }
  const callBtn=document.getElementById('call-btn');if(callBtn) callBtn.style.display=c.type==='group'?'none':'flex';
  const quickGroupBtn=document.getElementById('quick-group-btn');if(quickGroupBtn) quickGroupBtn.style.display=c.type==='group'?'none':'flex';
  document.getElementById('chat-header-sub').textContent='loading…';
  document.getElementById('chat-header-sub').className='';
  document.getElementById('lock-chat-btn').innerHTML=lockedChats[key]?"<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"11\" width=\"18\" height=\"11\" rx=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 10 0v4\"/></svg>":"<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"11\" width=\"18\" height=\"11\" rx=\"2\"/><path d=\"M7 11V7a5 5 0 0 1 9.9-1\"/></svg>";
  const archiveBtn=document.getElementById('archive-menu-item');
  if(archiveBtn) archiveBtn.innerHTML=archivedContacts[key]?'📁 Unarchive':'📁 Archive';
  const muteBtn=document.getElementById('mute-menu-item');
  if(muteBtn){
    const _ml=mutedChats[key];
    muteBtn.innerHTML=!_ml?'🔕 Mute notifications':_ml==='mentions'?'💬 Mentions only':'🔔 Unmute notifications';
    muteBtn.classList.toggle('active',!!_ml);
  }
  // Avatar
  const haEl=document.getElementById('chat-header-av');
  if(c.type==='group'){haEl.style.borderRadius='10px';haEl.style.background='linear-gradient(135deg,#ca5010,#6264a0)';haEl.style.color='#fff';if(c.avatar&&typeof c.avatar==='string'&&(c.avatar.startsWith('data:image/')||c.avatar.startsWith('https://'))){const _img=document.createElement('img');_img.src=c.avatar;_img.style.cssText='width:100%;height:100%;object-fit:cover;';_img.onerror=()=>{haEl.textContent='👥';};haEl.textContent='';haEl.appendChild(_img);}else{haEl.textContent='👥';}}
  else{haEl.style.borderRadius='50%';renderAvatar(haEl,lookupUser(c.number)||{name:enc(c.name),avatar:c.avatar||''});}
  renderContacts();
  renderSidebar();
  // Pulled out so selfHeal() can retry exactly this (a fresh getConvos() +
  // render) without recursing back through _origOpenChat's own catch below —
  // recursing through the whole function would let a persistent failure
  // retry itself indefinitely instead of stopping at one bounded attempt.
  const doOpenChatLoad=async()=>{
    await getConvos();
    // Guard against the user switching chats while the async fetch was in flight:
    // if activeConvo changed, rendering this (now-stale) conversation's messages
    // would show the wrong chat's content (Bug 2).
    if(activeConvo.key!==key) return;
    const conv=await getOrMakeConvo(key,c.type==='group'?c.members:[me.number,c.number]);
    if(activeConvo.key!==key) return;
    const chBar=document.getElementById('channel-bar');
    if(c.type==='group'){
      const isNew=ensureChannels(conv);
      if(isNew) await saveConvos();
      activeChannelId=pickDefaultChannel(conv);
      chBar.style.display='flex';
      renderChannelBar(conv);
      refreshVoiceParticipantCounts(conv);
      if(c.isServer&&typeof openServerWelcome==='function') setTimeout(()=>openServerWelcome(c,conv),400);
    } else {
      chBar.style.display='none';
      document.getElementById('voice-bar').style.display='none';
    }
    renderMessages(conv.messages);
  };
  try{
    await doOpenChatLoad();
  }catch(e){
    console.error('openChat failed:',e);
    const {healed,note}=await selfHeal('SCB-MSG-01',e,{context:'openChat',retryFn:doOpenChatLoad});
    if(!healed) showToast('Error loading chat',scbErr('SCB-MSG-01',note));
  }
  // Runs regardless of whether the block above succeeded, so a hiccup
  // loading messages can't leave the header stuck on "loading…" forever.
  if(c.type!=='group') updateOnlineStatus(c.number);
  else document.getElementById('chat-header-sub').textContent='';
  updateGroupDescBanner(c);
  const _inp=document.getElementById('msg-input');
  if(_inp){ _inp.focus(); _loadDraft(); }
}
function updateGroupDescBanner(c){
  const banner=document.getElementById('group-desc-banner');
  if(!banner) return;
  const info=(c&&c.type==='group')?(c.info||'').trim():'';
  if(!info||_dismissedGroupDescBanners[c.key]){ banner.style.display='none'; return; }
  banner.innerHTML=`<span>ℹ️</span><span>${esc(info)}</span><span class="gdb-close" data-key="${esc(c.key)}" data-act="dismissGroupDesc">✕</span>`;
  banner.style.display='flex';
}
let _dismissedGroupDescBanners={};
function dismissGroupDescBanner(key){
  _dismissedGroupDescBanners[key]=true;
  const banner=document.getElementById('group-desc-banner');
  if(banner) banner.style.display='none';
}
function updateOnlineStatus(num){
  if(String(num)===CLOUDY_NUMBER){ const el=document.getElementById('chat-header-sub'); if(el){el.textContent='AI Assistant · always online';el.className='online';} return; }
  const u=lookupUser(num);
  const online=u&&isOnline(u.lastSeen);
  const el=document.getElementById('chat-header-sub');
  const customStatus=u&&dec(u.customStatus||'');
  const theirKey=_userPubKeyStr(num);
  const myKey=me&&_myPubJwk;
  const e2eOn=!!(theirKey&&myKey);
  const e2eBadge=e2eOn?' <span style="color:var(--success);font-size:10px;font-weight:600">🔒 E2E</span>':'';
  if(customStatus){ el.innerHTML=esc(customStatus)+e2eBadge; el.className=online?'online':''; return; }
  el.innerHTML=(online?'● Online':`Last seen ${u?fmtTime(u.lastSeen):'unknown'}`)+e2eBadge;
  el.className=online?'online':'';
}

// -- ADD CONTACT ---------------------------------------------------------------
function openAddContact(){
  if(!me){showToast('Set up first',scbErr('SCB-CONT-01','Finish setting up your account before adding contacts.'));return;}
  document.getElementById('add-num').value='';
  document.getElementById('add-error').textContent='';
  openModal('add-modal');
  renderSuggestedFriends();
}
function renderSuggestedFriends(){
  const section=document.getElementById('suggested-friends-section');
  const list=document.getElementById('suggested-friends-list');
  if(!section||!list) return;
  // Anyone who shares a group with me but isn't already a direct contact
  const myGroupKeys=contacts.filter(c=>c&&c.type==='group').map(c=>c.key);
  const existingNums=new Set(contacts.filter(c=>c&&c.type==='dm').map(c=>c.number));
  const suggested=new Map(); // number -> shared group count
  myGroupKeys.forEach(key=>{
    const conv=(convosCache||[]).find(x=>x&&x.key===key);
    if(!conv) return;
    (conv.participants||conv.members||[]).forEach(num=>{
      if(num===me.number||existingNums.has(num)) return;
      suggested.set(num,(suggested.get(num)||0)+1);
    });
  });
  const ranked=[...suggested.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  if(!ranked.length){ section.style.display='none'; return; }
  section.style.display='block';
  list.innerHTML='';
  ranked.forEach(([num,count])=>{
    const u=lookupUser(num);
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:6px 4px;cursor:pointer;border-radius:var(--r-sm)';
    const av=document.createElement('div');
    av.className='avatar';
    av.style.cssText='width:32px;height:32px;font-size:13px;background:linear-gradient(135deg,#0078d4,#6264a0);color:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:50%';
    av.textContent=u?(dec(u.name)||'?').charAt(0).toUpperCase():'?';
    const info=document.createElement('div');
    info.innerHTML=`<div style="font-size:13px;font-weight:500">${esc(u?dec(u.name):'#'+num)}</div><div style="font-size:11px;color:var(--muted)">${count} mutual group${count===1?'':'s'}</div>`;
    row.appendChild(av);row.appendChild(info);
    row.onclick=()=>{ document.getElementById('add-num').value=num; };
    list.appendChild(row);
  });
}
async function submitAdd(){
  const num=parseInt(document.getElementById('add-num').value);
  const err=document.getElementById('add-error');err.textContent='';
  if(!num||num<1000){err.textContent=scbErr('SCB-CONT-02','Enter a valid number.');return;}
  if(num===me.number){err.textContent=scbErr('SCB-CONT-03',"That's your own number.");return;}
  if(contacts.find(c=>c.number===num&&c.type!=='group')){err.textContent=scbErr('SCB-CONT-04','Already in contacts.');return;}
  try{
    const users=await getUsers();
    const user=users.find(u=>u.number===num);
    if(!user){err.textContent=scbErr('SCB-CONT-05',`#${num} is not registered.`);return;}
    if(user.banned){err.textContent=scbErr('SCB-CONT-07',`#${num} is a banned account.`);return;}
    const c={type:'dm',number:num,name:dec(user.name),bio:dec(user.bio||''),avatar:user.avatar||'',key:'dm_'+[me.number,num].sort((a,b)=>a-b).join('_')};
    contacts.push(c);saveStorage();renderSidebar();renderDashboardWidget('online');closeModal('add-modal');openChat(c);
  }catch(e){err.textContent=scbErr('SCB-CONT-06','That contact couldn\'t be added — the server request failed.',e.message);}
}

// -- NEW GROUP -----------------------------------------------------------------
function openNewGroup(preselectContact,asServer){
  if(!me){showToast('Set up first',scbErr('SCB-GRP-01','Finish setting up your account before creating a group.'));return;}
  document.getElementById('grp-name').value='';
  document.getElementById('grp-info').value='';
  document.getElementById('grp-error').textContent='';
  document.getElementById('grp-add-by-num').value='';
  document.getElementById('grp-is-server').checked=!!asServer;
  document.getElementById('group-modal-title').textContent=asServer?'New Server':'New Group';
  document.getElementById('group-modal-desc').textContent=asServer?'Create a multi-channel server and invite your contacts.':'Create a group chat and invite your contacts.';
  tempGroupAvatar=null;
  document.getElementById('grp-av-preview').innerHTML=asServer?'🖥️':'👥';
  document.getElementById('grp-av-preview').style.background=asServer?'linear-gradient(135deg,#5865f2,#3ba55d)':'linear-gradient(135deg,#ca5010,#6264a0)';
  // Build member pick list
  const pick=document.getElementById('member-pick-list');pick.innerHTML='';
  const sel=document.getElementById('selected-members');sel.innerHTML='';
  const dmContacts=contacts.filter(c=>c.type!=='group');
  if(!dmContacts.length){
    pick.innerHTML='<div style="font-size:12px;color:var(--muted)">No saved contacts yet — use "Add by number" above.</div>';
  }else{
    dmContacts.forEach(c=>{
      const row=document.createElement('div');row.className='sb-item';row.style.borderRadius='var(--r-xs)';row.style.cursor='pointer';
      row.innerHTML=`<div class="avatar" style="width:30px;height:30px;font-size:12px;background:linear-gradient(135deg,#0078d4,#6264a0);color:#fff">${c.name.charAt(0).toUpperCase()}</div><span style="font-size:13px">${esc(c.name)} <span style="color:var(--muted)">#${c.number}</span></span>`;
      row.onclick=()=>toggleMember(c,row);
      pick.appendChild(row);
      if(preselectContact&&c.number===preselectContact.number) toggleMember(c,row);
    });
  }
  // If quick-started from a DM whose contact wasn't in the saved list for some reason, add them directly.
  if(preselectContact&&!sel.querySelector(`[data-num="${preselectContact.number}"]`)){
    const chip=document.createElement('div');chip.className='chip';chip.dataset.num=preselectContact.number;
    chip.innerHTML=esc(preselectContact.name)+' <span class="chip-remove" data-act="removeMember">×</span>';
    sel.appendChild(chip);
  }
  openModal('group-modal');
}
// Quick-start a group straight from an open DM — pre-selects that contact so
// you only need to add anyone else and pick a name, WhatsApp-style.
function quickGroupWithContact(){
  if(!activeConvo||activeConvo.type==='group') return;
  openNewGroup({number:activeConvo.number,name:activeConvo.name});
}
// Lets you add someone to a new group by number even if they aren't already
// a saved local contact — fixes the dead end where an empty contacts list
// made it impossible to create a group at all.
async function addMemberByNumber(num,err){
  if(!num||num<1000) return {ok:false,reason:'invalid'};
  if(num===me.number) return {ok:false,reason:'self'};
  const sel=document.getElementById('selected-members');
  if(sel.querySelector(`[data-num="${num}"]`)) return {ok:false,reason:'duplicate'};
  try{
    const users=await getUsers();
    const user=users.find(u=>u.number===num);
    if(!user) return {ok:false,reason:'unregistered'};
    const name=dec(user.name)||('#'+num);
    const chip=document.createElement('div');chip.className='chip';chip.dataset.num=num;
    chip.innerHTML=esc(name)+' <span class="chip-remove" data-act="removeMember">×</span>';
    sel.appendChild(chip);
    const pick=document.getElementById('member-pick-list');
    const row=pick&&[...pick.children].find(r=>String(r.dataset.rowNum)===String(num));
    if(row) row.style.background='var(--bg3)';
    return {ok:true};
  }catch(e){ return {ok:false,reason:'error',message:e.message}; }
}
async function grpAddByNumber(){
  const input=document.getElementById('grp-add-by-num');
  const err=document.getElementById('grp-error'); err.textContent='';
  const num=parseInt(input.value);
  const result=await addMemberByNumber(num);
  if(result.ok){ input.value=''; return; }
  const messages={invalid:'Enter a valid number.',self:"That's your own number.",duplicate:'Already added.',unregistered:`#${num} is not registered.`,error:'Error: '+(result.message||'')};
  err.textContent=scbErr('SCB-CONT-07',messages[result.reason]||'Could not add that number.');
  if(result.reason==='duplicate') input.value='';
}
async function importGroupMembersCsv(fileInput){
  const err=document.getElementById('grp-error'); err.textContent='';
  const file=fileInput.files&&fileInput.files[0];
  if(!file) return;
  const text=await file.text();
  // Accepts a plain list of numbers, one per line or comma-separated, with or
  // without a header row (any non-numeric line is just skipped) — deliberately
  // loose since this is for quickly bulk-adding people you already know the
  // handles of, not a formal data-import spec.
  const numbers=[...new Set(text.split(/[\r\n,]+/).map(s=>parseInt(s.trim())).filter(n=>!isNaN(n)&&n>=1000&&n<=99999))];
  fileInput.value='';
  if(!numbers.length){ err.textContent=scbErr('SCB-CONT-08','No valid numbers found in that file.'); return; }
  let added=0,skipped=0;
  for(const num of numbers){
    const result=await addMemberByNumber(num);
    if(result.ok) added++; else skipped++;
  }
  showToast('CSV import complete',`${added} added${skipped?`, ${skipped} skipped (already added, unregistered, or invalid)`:''}.`);
}
function toggleMember(c,row){
  const sel=document.getElementById('selected-members');
  const existing=sel.querySelector(`[data-num="${c.number}"]`);
  if(existing){existing.remove();row.style.background='';}
  else{
    const chip=document.createElement('div');chip.className='chip';chip.dataset.num=c.number;
    chip.innerHTML=esc(c.name)+' <span class="chip-remove" data-act="removeMember">×</span>';
    sel.appendChild(chip);row.style.background='var(--bg3)';row.dataset.rowNum=c.number;
  }
}
function removeMember(num){
  const sel=document.getElementById('selected-members');
  const chip=sel.querySelector(`[data-num="${num}"]`);
  if(chip) chip.remove();
  const pick=document.getElementById('member-pick-list');
  const row=pick&&[...pick.children].find(r=>String(r.dataset.rowNum)===String(num));
  if(row) row.style.background='';
}
// Servers are group conversations with isServer:true — same membership,
// admin, channel, and E2E-key-wrapping machinery as an ordinary group, just
// with a distinct identity (icon/sidebar section), a few more starter
// channels, and an invite code. See joinServerByCode()/approveJoinRequest()
// for why joining isn't instant: a joiner has no way to unwrap the group's
// E2E key for themselves, so joining creates a request an existing admin
// must approve (their browser has the key and does the wrapping), same as
// any ordinary "add member" already works.
function generateInviteCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easy to misread
  const existing=new Set((convosCache||[]).filter(c=>c&&c.isServer&&c.inviteCode).map(c=>c.inviteCode));
  let code;
  do{
    code='';
    for(let i=0;i<6;i++) code+=chars[Math.floor(Math.random()*chars.length)];
  }while(existing.has(code));
  return code;
}
async function submitNewGroup(){
  const name=document.getElementById('grp-name').value.trim();
  const info=document.getElementById('grp-info').value.trim();
  const isServer=document.getElementById('grp-is-server').checked;
  const err=document.getElementById('grp-error');err.textContent='';
  if(!name){err.textContent=scbErr('SCB-GRP-02',isServer?'Enter a server name.':'Enter a group name.');return;}
  const chips=document.getElementById('selected-members').querySelectorAll('.chip');
  const memberNums=Array.from(chips).map(c=>parseInt(c.dataset.num));
  if(!memberNums.length){err.textContent=scbErr('SCB-GRP-03','Add at least one member.');return;}
  // Security feature 32/32: skip anyone whose own privacy setting doesn't
  // allow being added to a group, same as submitAddGroupMembers().
  const _privacyBlockedNew=memberNums.filter(n=>!canAddToGroup(n));
  const allowedMemberNums=memberNums.filter(n=>canAddToGroup(n));
  if(!allowedMemberNums.length){err.textContent=scbErr('SCB-GRP-49','None of those contacts can be added — their privacy settings don\'t allow it.');return;}
  // Security feature 28/32 — same hourly invite throttle submitAddGroupMembers() uses.
  if(me.number!==ADMIN_NUMBER){
    const soFar=_groupInviteHourlyCount();
    if(soFar+allowedMemberNums.length>GROUP_INVITE_HOURLY_LIMIT){
      err.textContent=scbErr('SCB-GRP-46','You\'ve added/invited too many people recently ('+soFar+'/'+GROUP_INVITE_HOURLY_LIMIT+' this hour) — try again later.');
      return;
    }
  }
  _recordGroupInvites(allowedMemberNums.length);
  if(_privacyBlockedNew.length) showToast('Some contacts skipped',_privacyBlockedNew.length+' contact'+(_privacyBlockedNew.length===1?'':'s')+' couldn\'t be added — their privacy settings don\'t allow it.');
  const allMembers=[me.number,...allowedMemberNums];
  const key='grp_'+Date.now();
  const g={type:'group',key,name,info,avatar:tempGroupAvatar||'',members:allMembers,isServer};
  contacts.push(g);saveStorage();
  // Store the group convo with both participants AND members so all members can sync
  if(!convosCache) await getConvos();
  let c=convosCache.find(x=>x&&x.key===key);
  if(!c){
    c={key,type:'group',name,info,avatar:tempGroupAvatar||'',participants:allMembers,members:allMembers,admins:[me.number],coadmins:[],roles:[],memberRoles:{},badges:[],memberBadges:{},memberJoinedAt:Object.fromEntries(allMembers.map(n=>[n,Date.now()])),messages:[],isServer,
      channels:isServer
        ?[{id:'general',name:'general',type:'text',order:0},{id:'announcements',name:'announcements',type:'text',order:1},{id:'voice',name:'Voice Chat',type:'voice',order:2}]
        :[{id:'general',name:'general',type:'text',order:0},{id:'voice',name:'Voice Chat',type:'voice',order:1}]};
    if(isServer){ c.inviteCode=generateInviteCode(); c.joinRequests=[]; }
    // Generate a random E2E group key and wrap it individually for each member (Signal-style key wrapping)
    try{
      await ensureE2EKeypair();
      const bundle=await makeGroupKeyBundle(allMembers);
      if(bundle&&bundle.wrapped&&Object.keys(bundle.wrapped).length){
        c.wrappedKeys=bundle.wrapped;
        _groupAesCache[key]=bundle.groupKey;
      }
    }catch(e){}
    convosCache.push(c);
    await saveConvos();
  }
  renderSidebar();closeModal('group-modal');openChat(g);
}

// -- MESSAGES ------------------------------------------------------------------
function showMsgInfo(m){
  const body=document.getElementById('msg-info-body');
  const u=lookupUser(m.from)||{};
  const seenBy=(m.seen||[]).map(n=>{const su=lookupUser(n)||{};return esc(dec(su.name)||'#'+n);}).join(', ')||'No one yet';
  body.innerHTML=`<div class="field"><label>From</label><div>${esc(dec(u.name)||'#'+m.from)}</div></div><div class="field"><label>Sent</label><div>${esc(new Date(m.time).toLocaleString())}</div></div><div class="field"><label>Seen by</label><div>${seenBy}</div></div>`;
  openModal('msg-info-overlay');
}

// -- TYPING INDICATOR ----------------------------------------------------------
// Each entry is {t: timestamp, activity: 'typing'|'recording'} so the
// indicator can say what someone's actually doing, not just a generic
// "typing…" — e.g. while they're recording a voice message. Reads stay
// backward-compatible with the old raw-timestamp-number shape (in case a
// stale cached snapshot or an in-flight write from just before this change
// still has one), treating a bare number as {t:number, activity:'typing'}.
let lastTypingBroadcast=0;
function _normTypingEntry(entry){
  return typeof entry==='number' ? {t:entry,activity:'typing'} : entry;
}
async function broadcastTyping(activity){
  if(!activeConvo||!convosCache||!me) return;
  if(!getPrivacyPref('typingIndicators',true)) return;
  activity=activity||'typing';
  const now=Date.now();
  // The throttle only applies to plain typing — a recording-state change
  // is a one-off, meaningful event (not a per-keystroke spam risk), and
  // waiting up to 2.5s to broadcast "recording" would make the indicator
  // lag noticeably behind someone actually starting a voice message.
  if(activity==='typing'){
    if(now-lastTypingBroadcast<2500) return; // throttle to avoid hammering the bin
    lastTypingBroadcast=now;
  }
  try{
    const c=convosCache.find(x=>x&&x.key===activeConvo.key);
    if(!c) return;
    if(!c.typingByChannel) c.typingByChannel={};
    const chKey=activeConvo.type==='group'?(activeChannelId||'general'):'_dm';
    if(!c.typingByChannel[chKey]) c.typingByChannel[chKey]={};
    c.typingByChannel[chKey][me.number]={t:now,activity};
    await saveConvos();
  }catch{}
}
const TYPING_ACTIVITY_LABELS={typing:'typing…',recording:'recording a voice message…'};
function showTypingIndicator(c){
  const sub=document.getElementById('chat-header-sub');
  if(!sub||!activeConvo||!c) return false;
  const now=Date.now();
  const chKey=activeConvo.type==='group'?(activeChannelId||'general'):'_dm';
  const typingHere=(c.typingByChannel&&c.typingByChannel[chKey])||{};
  const others=Object.keys(typingHere).map(Number).filter(n=>{
    const e=_normTypingEntry(typingHere[n]);
    return n!==me.number&&e&&(now-e.t)<6000;
  });
  if(!others.length) return false;
  let label;
  if(activeConvo.type==='group'){
    const names=others.slice(0,2).map(n=>{const u=lookupUser(n)||{};return dec(u.name)||'Someone';});
    // Only call out a specific activity (e.g. "recording a voice message")
    // when every currently-active person is doing that same thing —
    // otherwise (a mix, or more than 2 people) the generic "typing…" stays
    // accurate without implying something that isn't true for everyone.
    const activities=new Set(others.map(n=>_normTypingEntry(typingHere[n]).activity||'typing'));
    const activityLabel=(activities.size===1)?TYPING_ACTIVITY_LABELS[[...activities][0]]:null;
    label=names.join(', ')+(others.length>2?' and others':'')+' '+(activityLabel||'typing…');
  }else{
    const activity=_normTypingEntry(typingHere[others[0]]).activity||'typing';
    label=TYPING_ACTIVITY_LABELS[activity]||'typing…';
  }
  sub.textContent=label;
  sub.className='';
  return true;
}
// Surfaces typing activity happening in OTHER channels of the same group —
// useful while you're in a voice channel or viewing a different channel and
// might otherwise miss that a conversation is happening elsewhere.
function renderCrossChannelTyping(c){
  const el=document.getElementById('cross-channel-typing');
  if(!el) return;
  if(!activeConvo||activeConvo.type!=='group'||!c||!c.typingByChannel){ el.style.display='none'; return; }
  const now=Date.now();
  const activeCh=activeChannelId||'general';
  const notices=[];
  Object.entries(c.typingByChannel).forEach(([chId,typers])=>{
    if(chId===activeCh) return;
    const whoNums=Object.keys(typers).map(Number).filter(n=>{
      const e=_normTypingEntry(typers[n]);
      return n!==me.number&&e&&(now-e.t)<6000;
    });
    if(!whoNums.length) return;
    const ch=(c.channels||[]).find(x=>x.id===chId);
    const chName=ch?ch.name:chId;
    const who=dec((lookupUser(whoNums[0])||{}).name)||'Someone';
    notices.push(esc(who)+' typing in #'+esc(chName));
  });
  if(!notices.length){ el.style.display='none'; el.textContent=''; return; }
  el.style.display='block';
  el.innerHTML='✏️ '+notices.slice(0,2).join(' · ');
}

function finalizeAutocorrect(){} // removed
function onMsgInput(el){
  autoResize(el);
  broadcastTyping();
  updateMentionSuggest(el);
  _saveDraft();
}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}
function msgKeydown(e){
  const sug=document.getElementById('mention-suggest');
  if(sug&&sug.classList.contains('visible')){
    const items=[...sug.querySelectorAll('.mention-suggest-item')];
    let idx=items.findIndex(i=>i.classList.contains('active'));
    if(e.key==='ArrowDown'){e.preventDefault();idx=(idx+1)%items.length;items.forEach((it,j)=>it.classList.toggle('active',j===idx));return;}
    if(e.key==='ArrowUp'){e.preventDefault();idx=(idx-1+items.length)%items.length;items.forEach((it,j)=>it.classList.toggle('active',j===idx));return;}
    if((e.key==='Enter'||e.key==='Tab')&&idx>=0){e.preventDefault();items[idx].click();return;}
    if(e.key==='Escape'){e.preventDefault();sug.classList.remove('visible');sug.innerHTML='';return;}
  }
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault(); if(editingMsgId) saveEditMsg(); else sendMsg();}
}

// -- @MENTIONS (group chats) ----------------------------------------------------
function getMentionCandidates(){
  if(!activeConvo||activeConvo.type!=='group'||!me) return [];
  return (activeConvo.members||[]).filter(n=>n!==me.number).map(num=>{
    const u=lookupUser(num);
    return {number:num,name:dec((u&&u.name)||'')||('User'+num)};
  });
}
function updateMentionSuggest(el){
  const sug=document.getElementById('mention-suggest');
  if(!sug) return;
  if(!activeConvo||activeConvo.type!=='group'){sug.classList.remove('visible');sug.innerHTML='';return;}
  const pos=el.selectionStart;
  const before=el.value.slice(0,pos);
  const m=before.match(/(?:^|\s)@([A-Za-z0-9_]*)$/);
  if(!m){sug.classList.remove('visible');sug.innerHTML='';return;}
  const q=m[1].toLowerCase();
  const cands=getMentionCandidates();
  const matches=cands.filter(c=>c.name.toLowerCase().includes(q));
  const all=[{number:'all',name:'everyone'}].filter(c=>c.name.startsWith(q)||q==='');
  const list=[...matches,...(q===''||'everyone'.startsWith(q)?all:[])].slice(0,6);
  if(!list.length){sug.classList.remove('visible');sug.innerHTML='';return;}
  sug.innerHTML='';
  list.forEach((c,i)=>{
    const item=document.createElement('div');
    item.className='mention-suggest-item'+(i===0?' active':'');
    item.innerHTML='<span style="font-size:13px">'+(c.number==='all'?'📢':'@')+'</span><span>'+esc(c.name)+'</span>';
    item.onclick=()=>{
      const start=before.lastIndexOf('@');
      el.value=el.value.slice(0,start)+'@'+c.name+' '+el.value.slice(pos);
      el.focus();
      const newPos=start+c.name.length+2;
      el.setSelectionRange(newPos,newPos);
      sug.classList.remove('visible');sug.innerHTML='';
      autoResize(el);
    };
    sug.appendChild(item);
  });
  sug.classList.add('visible');
}
function parseMentions(text){
  if(!activeConvo||activeConvo.type!=='group') return [];
  const cands=getMentionCandidates();
  const found=new Set();
  const re=/@([A-Za-z0-9_]+)/g;
  let mm;
  while((mm=re.exec(text))){
    const name=mm[1].toLowerCase();
    if(name==='everyone'||name==='all'){(activeConvo.members||[]).forEach(n=>{if(n!==me.number) found.add(n);});continue;}
    const c=cands.find(c=>c.name.split(/\s+/)[0].toLowerCase()===name);
    if(c) found.add(c.number);
  }
  return [...found];
}
// -- SUSPICIOUS LINK DETECTION --------------------------------------------------
// Lightweight, local heuristics only (no external threat-intel API) — flags
// links worth a second look rather than claiming to know they're malicious.
const RISKY_TLDS=['tk','ml','ga','cf','gq','top','xyz','click','loan','work','gdn','fit','men','date'];
const URL_SHORTENERS=['bit.ly','tinyurl.com','t.co','goo.gl','ow.ly','is.gd','buff.ly','cutt.ly','rebrand.ly','shorturl.at','rb.gy'];
const IMPERSONATION_BRANDS=['paypal','google','apple','microsoft','amazon','netflix','bankofamerica','chase','wellsfargo','instagram','facebook','discord','steamcommunity','steam','roblox'];
function scanUrlRisk(rawUrl){
  const reasons=[];
  let u;
  try{ u=new URL(rawUrl); }catch(e){ return ['malformed link']; }
  const host=u.hostname.toLowerCase();
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) reasons.push('raw IP address instead of a normal domain');
  if(host.startsWith('xn--')||host.includes('.xn--')) reasons.push('punycode domain (can visually impersonate other letters)');
  const tld=host.split('.').pop();
  if(RISKY_TLDS.includes(tld)) reasons.push('uses a ".'+tld+'" domain often abused for scam links');
  if(URL_SHORTENERS.includes(host)) reasons.push('shortened link — the real destination is hidden');
  for(const b of IMPERSONATION_BRANDS){
    // A real subdomain of the brand's actual domain (accounts.google.com,
    // checkout.paypal.com, www.chase.com, ...) is legitimate, not an
    // impersonation attempt — only an exact match or "...co" TLD counted
    // before, which false-flagged every real subdomain of every brand.
    const officialDomains=[b+'.com', b+'.co'];
    const isOfficial=officialDomains.some(d=>host===d||host.endsWith('.'+d));
    if(host.includes(b)&&!isOfficial){ reasons.push('mentions "'+b+'" but is not '+b+'.com'); break; }
  }
  if((host.match(/-/g)||[]).length>=3) reasons.push('unusually many hyphens in the domain');
  if(u.username||u.password) reasons.push('embeds credentials in the link itself');
  return reasons;
}
let _riskyLinkId=0;
const _riskyLinks={};
function confirmRiskyLinkClick(e,id){
  const info=_riskyLinks[id];
  if(!info) return;
  const msg='This link looks suspicious:\n\n'+info.reasons.map(r=>'• '+r).join('\n')+'\n\nOpen it anyway?\n'+info.url;
  if(!confirm(msg)) e.preventDefault();
}
const URL_RE=/\bhttps?:\/\/[^\s<>"']+/g;
function linkifySegment(rawText){
  // Splits on raw URLs, escapes plain text normally, and wraps URLs in <a>
  // tags — flagging risky ones with a warning badge + confirm-before-open.
  let out=''; let last=0; let m;
  URL_RE.lastIndex=0;
  while((m=URL_RE.exec(rawText))){
    let url=m[0].replace(/[.,!?;:)\]}]+$/,''); // trim trailing punctuation
    out+=esc(rawText.slice(last,m.index));
    const reasons=scanUrlRisk(url);
    const safeUrl=esc(url);
    if(reasons.length){
      const id='rl'+(_riskyLinkId++);
      _riskyLinks[id]={url,reasons};
      out+='<a href="'+safeUrl+'" target="_blank" rel="noopener" class="msg-link risky-link" data-id="'+id+'" onclick="confirmRiskyLinkClick(event,this.dataset.id)" title="This link looks suspicious">'+safeUrl+' ⚠️</a>';
    }else{
      out+='<a href="'+safeUrl+'" target="_blank" rel="noopener" class="msg-link">'+safeUrl+'</a>';
    }
    last=m.index+url.length;
  }
  out+=esc(rawText.slice(last));
  return out;
}
function renderMsgTextWithMentions(text){
  const linked=linkifySegment(text);
  if(!activeConvo||activeConvo.type!=='group') return linked;
  const cands=getMentionCandidates();
  // Mention matching runs on the linkified HTML but only touches plain "@word"
  // occurrences outside tag attributes, which the URL regex above already consumed.
  return linked.replace(/@([A-Za-z0-9_]+)/g,(full,name)=>{
    const nl=name.toLowerCase();
    if(nl==='everyone'||nl==='all') return '<span class="mention-chip">@'+esc(name)+'</span>';
    const c=cands.find(c=>c.name.split(/\s+/)[0].toLowerCase()===nl);
    return c?'<span class="mention-chip">@'+esc(name)+'</span>':full;
  });
}

// -- GIF -----------------------------------------------------------------------
// The picker is position:fixed (not absolute) so it can't be clipped by
// #chat-panel's overflow:hidden — an ancestor a bottom:100% popover sits
// underneath. We compute its box in JS instead, clamped to whatever room is
// actually above the footer, so on short viewports it shrinks (and its own
// grid still scrolls) rather than getting sliced off by the ancestor.
function positionGifPicker(){
  const picker=document.getElementById('gif-picker'),footer=document.getElementById('chat-footer');
  if(!picker||!footer) return;
  const fr=footer.getBoundingClientRect();
  const margin=8;
  const availAbove=Math.max(120,fr.top-margin);
  const pickerMaxH=Math.min(320,availAbove);
  picker.style.left=fr.left+'px';
  picker.style.width=fr.width+'px';
  picker.style.bottom=(window.innerHeight-fr.top)+'px';
  picker.style.maxHeight=pickerMaxH+'px';
  // account for the search bar + tab strip (~94px) so the content pane's
  // own scroll region is what shrinks, not the search/tabs getting squeezed
  const paneMaxH=Math.max(80,pickerMaxH-94)+'px';
  ['gif-grid','emoji-grid'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.maxHeight=paneMaxH; });
}
window.addEventListener('resize',()=>{ if(document.getElementById('gif-picker')?.classList.contains('visible')) positionGifPicker(); });
function toggleGif(){
  const p=document.getElementById('gif-picker');
  p.classList.toggle('visible');
  if(p.classList.contains('visible')){ positionGifPicker(); switchGifPickerTab('gifs'); }
}
// -- GIF / Emoji tab strip (Discord-style picker) ----------------------------
function switchGifPickerTab(tab){
  const tabs=document.querySelectorAll('.gif-picker-tab');
  tabs.forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  const gifGrid=document.getElementById('gif-grid'), emojiGrid=document.getElementById('emoji-grid');
  const search=document.getElementById('gif-search');
  gifGrid.style.display = tab==='gifs' ? 'block' : 'none';
  emojiGrid.style.display = tab==='emoji' ? 'grid' : 'none';
  if(search){
    search.style.display = '';
    search.placeholder = tab==='emoji' ? 'Search emoji…' : 'Search GIFs…';
    search.value='';
  }
  document.getElementById('gif-picker')._activeTab=tab;
  if(tab==='gifs' && !gifGrid.childElementCount) loadTrendingGifs();
  if(tab==='emoji' && !emojiGrid.childElementCount) renderEmojiGrid('');
  positionGifPicker();
}
function onGifPickerSearchInput(q){
  const tab=document.getElementById('gif-picker')?._activeTab||'gifs';
  if(tab==='emoji') renderEmojiGrid(q);
  else searchGifs(q);
}
// Reuses the app's existing EMOJI_CATEGORIES (defined further down, next to
// the reaction picker) — {CategoryName:[emoji,emoji,...]} — instead of
// keeping a second, separately-curated emoji set in sync with the first.
function renderEmojiGrid(filter){
  const grid=document.getElementById('emoji-grid');
  if(!grid||typeof EMOJI_CATEGORIES==='undefined') return;
  const q=(filter||'').toLowerCase().trim();
  grid.innerHTML='';
  let any=false;
  Object.keys(EMOJI_CATEGORIES).forEach(cat=>{
    // no per-emoji keyword metadata to search against — match by category
    // name (e.g. "food" surfaces the Food category) or the literal emoji
    if(q&&!cat.toLowerCase().includes(q)&&!EMOJI_CATEGORIES[cat].includes(filter)) return;
    const matches=EMOJI_CATEGORIES[cat];
    any=true;
    const label=document.createElement('div');
    label.className='emoji-cat-label';
    label.textContent=cat;
    grid.appendChild(label);
    matches.forEach(e=>{
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='emoji-cell';
      btn.textContent=e;
      btn.title=e;
      btn.onclick=()=>pickerInsertText(e);
      grid.appendChild(btn);
    });
  });
  if(!any) grid.innerHTML='<div style="grid-column:1/-1;color:var(--muted);font-size:12px;padding:12px;text-align:center">No emoji found.</div>';
}
// Insert text at the caret in the message box (used by the emoji tab) —
// unlike a GIF click, this doesn't send or close the picker, so multiple
// emoji can be picked in a row, matching how every other chat app does it.
function pickerInsertText(text){
  const el=document.getElementById('msg-input');
  if(!el) return;
  const start=el.selectionStart??el.value.length, end=el.selectionEnd??el.value.length;
  el.value=el.value.slice(0,start)+text+el.value.slice(end);
  const pos=start+text.length;
  el.setSelectionRange(pos,pos);
  el.focus();
  if(typeof autoResize==='function') autoResize(el);
  if(typeof onMsgInput==='function') onMsgInput(el);
}
// GIFs from external CDNs can fail to load later (rate limits, expired links,
// CORS). Show a small "open externally" placeholder instead of a broken icon.
function normalizeGifUrl(u){
  if(!u) return u;
  if(typeof u==='object') u=u.url||u.original||u.src||'';
  u=String(u);
  if(!u) return u;
  if(/^https?:\/\//i.test(u)) return u;
  if(u.startsWith('//')) return 'https:'+u;
  return 'https://'+u.replace(/^\/+/,'');
}
function gifImgFail(img,url){
  const wrap=img.parentElement;
  if(!wrap||wrap.dataset.gifFailed) return;
  wrap.dataset.gifFailed='1';
  const safeUrl=esc(normalizeGifUrl(url));
  wrap.innerHTML='<a href="'+safeUrl+'" target="_blank" rel="noopener" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:18px 22px;color:var(--muted);font-size:11px;text-decoration:none;border:1px dashed var(--border2);border-radius:10px"><span style="font-size:20px">🖼️</span>GIF unavailable — open ↗</a>';
}
async function loadTrendingGifs(){
  const grid=document.getElementById('gif-grid');
  grid.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px">Loading…</div>';
  try{
    const workerBase=MINT_TOKEN_ENDPOINT.replace(/\/mint-token$/,'');
    const r=await fetch(`${workerBase}/giphy?endpoint=trending&limit=12&rating=g`);
    const d=await r.json();
    if(!r.ok||(d.meta&&d.meta.status&&d.meta.status>=400)) return gifLoadFailed(d.meta&&d.meta.msg);
    renderGifs(d.data);
  }catch(e){ gifLoadFailed('network error'); }
}
function gifLoadFailed(reason){
  const grid=document.getElementById('gif-grid');
  const msg=reason==='network error' ? 'Couldn\'t reach GIF search — check your connection.' : 'GIF search is temporarily unavailable'+(reason?' ('+esc(reason)+')':'')+'.';
  grid.innerHTML='<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;gap:6px;color:var(--muted);font-size:12px;padding:14px;text-align:center">'
    +'<span>'+msg+'</span>'
    +'<span class="btn btn-ghost btn-sm" style="cursor:pointer" onclick="loadTrendingGifs()">Retry</span></div>';
}
function searchGifs(q){
  clearTimeout(gifDebounce);
  const grid=document.getElementById('gif-grid');
  gifDebounce=setTimeout(async()=>{
    if(!q){loadTrendingGifs();return;}
    grid.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px">Searching…</div>';
    try{
      const workerBase=MINT_TOKEN_ENDPOINT.replace(/\/mint-token$/,'');
      const r=await fetch(`${workerBase}/giphy?endpoint=search&q=${encodeURIComponent(q)}&limit=12&rating=g`);
      const d=await r.json();
      if(!r.ok||(d.meta&&d.meta.status&&d.meta.status>=400)) return gifLoadFailed(d.meta&&d.meta.msg);
      renderGifs(d.data);
    }catch(e){ gifLoadFailed('network error'); }
  },400);
}
function renderGifs(gifs){
  const grid=document.getElementById('gif-grid');grid.innerHTML='';
  if(!gifs||!gifs.length){grid.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px">No GIFs found.</div>';return;}
  gifs.forEach(g=>{
    // Collect every URL variant Giphy offers, in order of preference, and try
    // each in turn — a single broken/rate-limited link shouldn't hide the GIF.
    const images=g.images||{};
    const candidates=[images.fixed_height_small,images.downsized,images.fixed_height,images.downsized_medium,images.original]
      .filter(Boolean).map(i=>i.url).filter(Boolean);
    if(!candidates.length) return;
    // Masonry-style: no forced crop/height, so a GIF's own aspect ratio
    // shows (matches how Discord/Slack pickers render thumbnails) instead
    // of slicing faces/frames off with object-fit:cover on a fixed box.
    const wrapper=document.createElement('div');wrapper.style.cssText='position:relative;min-height:40px;';
    const img=document.createElement('img');
    let idx=0;
    img.src=candidates[idx];
    img.loading='lazy';
    img.style.cssText='width:100%;height:auto;display:block;cursor:pointer;transition:opacity 0.15s;';
    img.onerror=()=>{
      idx++;
      if(idx<candidates.length) img.src=candidates[idx];
      else wrapper.remove();
    };
    const sendUrl=()=>candidates[idx];
    img.onclick=()=>{sendMsg(sendUrl());document.getElementById('gif-picker').classList.remove('visible');};
    wrapper.appendChild(img);
    grid.appendChild(wrapper);
  });
}

// -- FILE / VOICE ATTACHMENTS ---------------------------------------------------
function fmtFileSize(bytes){
  if(bytes==null) return '';
  if(bytes<1024) return bytes+' B';
  if(bytes<1024*1024) return (bytes/1024).toFixed(1)+' KB';
  if(bytes<1024*1024*1024) return (bytes/(1024*1024)).toFixed(1)+' MB';
  return (bytes/(1024*1024*1024)).toFixed(2)+' GB';
}
function sanitizeFileName(name){
  return String(name||'file').replace(/[^a-zA-Z0-9.\-_ ]/g,'_').slice(-100);
}
function openAttachPicker(){ document.getElementById('file-attach-input').click(); }
function handleFileAttach(input){
  const file=input.files&&input.files[0];
  input.value='';
  if(!file) return;
  uploadAndSendFile(file);
}
function showUploadProgress(pct,name){
  const row=document.getElementById('upload-progress-row');
  row.style.display='flex';
  document.getElementById('upload-progress-name').textContent=name;
  document.getElementById('upload-progress-fill').style.width=pct+'%';
  document.getElementById('upload-progress-pct').textContent=pct+'%';
}
function hideUploadProgress(){
  document.getElementById('upload-progress-row').style.display='none';
}
function uploadAndSendFile(file){
  if(!activeConvo){ showToast('No chat open',scbErr('SCB-FILE-01','No chat is open, so there is nothing to attach a file to.')); return; }
  if(activeConvo.type!=='group' && isBlockedEitherWay(activeConvo.number)){ showToast('Cannot send',scbErr('SCB-MSG-02','This conversation is blocked.')); return; }
  if(me.createdAt && Date.now()-me.createdAt < 86400000){ showToast('Not yet','New accounts can\'t send files for 24 hours after joining.'); return; }
  if(file.size>MAX_UPLOAD_BYTES){
    showToast('File too large',scbErr('SCB-FILE-02','Max attachment size is 50MB (this file is '+fmtFileSize(file.size)+').'));
    return;
  }
  if(!CLOUDINARY_CLOUD||CLOUDINARY_CLOUD==='YOUR_CLOUD_NAME'){
    showToast('Upload not configured',scbErr('SCB-FILE-03','Set CLOUDINARY_CLOUD and CLOUDINARY_PRESET in the app config to enable file sharing.'));
    return;
  }
  showUploadProgress(0,file.name);
  const fd=new FormData();
  fd.append('file',file);
  fd.append('upload_preset',CLOUDINARY_PRESET);
  fd.append('public_id','scb/'+activeConvo.key+'/'+Date.now()+'_'+sanitizeFileName(file.name));
  const xhr=new XMLHttpRequest();
  xhr.open('POST','https://api.cloudinary.com/v1_1/'+CLOUDINARY_CLOUD+'/auto/upload',true);
  xhr.upload.onprogress=function(ev){
    if(ev.lengthComputable) showUploadProgress(Math.round(ev.loaded/ev.total*100),file.name);
  };
  xhr.onload=async function(){
    hideUploadProgress();
    if(xhr.status===200){
      try{
        const res=JSON.parse(xhr.responseText);
        await sendFileMsg({name:file.name,url:res.secure_url,type:file.type||'application/octet-stream',size:file.size});
      }catch(e){
        showToast('Upload failed',scbErr('SCB-FILE-06','File uploaded but couldn\'t be saved to the chat.',(e.message||'')));
      }
    } else {
      let detail='';
      try{ detail=JSON.parse(xhr.responseText).error&&JSON.parse(xhr.responseText).error.message; }catch{}
      showToast('Upload failed',scbErr('SCB-FILE-05','Cloudinary rejected the upload.',(detail||'Status '+xhr.status)));
    }
  };
  xhr.onerror=function(){
    hideUploadProgress();
    showToast('Upload failed',scbErr('SCB-FILE-05','Your file upload failed — check your connection.'));
  };
  xhr.send(fd);
}
async function sendFileMsg(fileMeta){
  if(!activeConvo||!me) return;
  // Same navigation-time-only restriction gap as sendMsg() — enforce at the
  // actual send, not just when the chat was opened.
  if (activeConvo.type!=='group' && blockIfRestricted('noDm','Direct messages are turned off for your account.')) return;
  if (activeConvo.type==='group' && blockIfRestricted('noGroups','Group chats are turned off for your account.')) return;
  if (activeConvo.type!=='group' && isBlockedEitherWay(activeConvo.number)) { showToast('Cannot send', scbErr('SCB-MSG-21','This conversation is blocked.')); return; }
  try{
    if(!convosCache) await getConvos();
    const key=activeConvo.key;
    let c=convosCache.find(x=>x&&x.key===key);
    if(!c){ c={key,participants:activeConvo.members||[me.number,activeConvo.number],messages:[]}; convosCache.push(c); }
    if(!isConvoMemberOf(c, activeConvo.type==='group')){
      console.error('Blocked file send into a conversation the signed-in account is not a member of',{convoKey:key,me:me.number});
      showToast('Could not send',scbErr('SCB-MSG-03','This chat is no longer open correctly — please reopen it from your chat list.'));
      return;
    }
    const msg={id:Date.now().toString(36)+Math.random().toString(36).slice(2,5),from:me.number,time:Date.now(),seen:[]};
    const _zr=_zrExpireAt(); if(_zr) msg.zrExpireAt=_zr; // Zero Retention Mode
    if (activeConvo.type === 'group') {
      msg.channelId = activeChannelId || 'general';
      // Same quarantine stamp sendMsg() applies to text — without it, an
      // unapproved member could post files that bypass the hold entirely.
      if (Array.isArray(c.pendingApproval) && c.pendingApproval.includes(me.number)) msg.quarantined = true;
    }
    const aesKey=await getConvoAesKey(c);
    const wrapped=aesKey?await aesEnc(aesKey,JSON.stringify(fileMeta)):null;
    if(wrapped){ msg.cfile=wrapped; _decCache[msg.id]={file:fileMeta}; }
    else{ msg.file=fileMeta; }
    c.messages.push(msg);
    if(c.messages.length>100) c.messages.splice(0,c.messages.length-100);
    if(!netOnline){
      msg.pending=true; queueOutboxMsg(key,msg.id); updateOfflineBanner();
      lastMsgHash=''; renderMessages(c.messages);
    }else{
      try{ await saveConvos(); lastMsgHash=''; renderMessages(c.messages); }
      catch(e){
        msg.pending=true; queueOutboxMsg(key,msg.id); updateOfflineBanner();
        lastMsgHash=''; renderMessages(c.messages);
        showToast('Message queued','Will send automatically once back online.');
      }
    }
  }catch(e){
    const { healed, note } = await selfHeal('SCB-MSG-04', e, { context: 'sendFileMsg' });
    if (!healed) showToast('Send failed', scbErr('SCB-MSG-04', note));
  }
}

// -- VOICE MESSAGES --------------------------------------------------------------
let voiceMsgRecorder=null, voiceMsgChunks=[], voiceMsgStream=null;
let voiceRecordInterval=null, voiceRecordSeconds=0, voiceRecordCancelled=false;

function _voiceRecordTick(){
  voiceRecordSeconds++;
  const m=Math.floor(voiceRecordSeconds/60), s=voiceRecordSeconds%60;
  const el=document.getElementById('voice-record-timer');
  if(el) el.textContent=m+':'+(s<10?'0':'')+s;
}
function _showVoiceBar(show){
  const bar=document.getElementById('voice-record-bar');
  const row=document.getElementById('compose-row');
  if(!bar||!row) return;
  bar.style.display=show?'flex':'none';
  row.style.display=show?'none':'flex';
  if(show){
    const wf=document.getElementById('voice-waveform');
    if(wf){ wf.innerHTML=''; for(let i=0;i<18;i++){ const s=document.createElement('span'); s.style.animationDelay=(i*0.04)+'s'; wf.appendChild(s); } }
    voiceRecordSeconds=0;
    const t=document.getElementById('voice-record-timer');
    if(t) t.textContent='0:00';
    voiceRecordInterval=setInterval(_voiceRecordTick,1000);
  } else {
    if(voiceRecordInterval){ clearInterval(voiceRecordInterval); voiceRecordInterval=null; }
  }
}

async function toggleVoiceMsgRecording(){
  if(voiceMsgRecorder&&voiceMsgRecorder.state==='recording'){ voiceMsgRecorder.stop(); return; }
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    showToast('Not supported',scbErr('SCB-MSG-05','Voice messages need microphone access, which this browser/context does not allow (try https).'));
    return;
  }
  try{
    voiceMsgStream=await navigator.mediaDevices.getUserMedia({audio:true});
  }catch(e){
    const {note}=await selfHeal('SCB-MSG-06',e,{context:'toggleVoiceMsgRecording',silent:true});
    showToast('Microphone unavailable',scbErr('SCB-MSG-06',note));
    return;
  }
  voiceMsgChunks=[];
  voiceRecordCancelled=false;
  const mimeType=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')?'audio/ogg;codecs=opus':MediaRecorder.isTypeSupported('audio/ogg')?'audio/ogg':MediaRecorder.isTypeSupported('audio/mp4')?'audio/mp4':'';
  const capturedMimeType=mimeType; // capture before recorder is created/stopped
  voiceMsgRecorder=mimeType?new MediaRecorder(voiceMsgStream,{mimeType}):new MediaRecorder(voiceMsgStream);
  voiceMsgRecorder.ondataavailable=e=>{ if(e.data&&e.data.size) voiceMsgChunks.push(e.data); };
  voiceMsgRecorder.onstop=()=>{
    voiceMsgStream.getTracks().forEach(t=>t.stop());
    _showVoiceBar(false);
    if(!voiceRecordCancelled){
      const actualType=capturedMimeType||(voiceMsgRecorder&&voiceMsgRecorder.mimeType)||'audio/webm';
      const ext=actualType.includes('ogg')?'.ogg':actualType.includes('mp4')?'.mp4':'.webm';
      const blob=new Blob(voiceMsgChunks,{type:actualType});
      if(blob.size) uploadAndSendFile(new File([blob],'voice-message'+ext,{type:actualType}));
    }
    voiceMsgRecorder=null; voiceMsgChunks=[];
  };
  voiceMsgRecorder.start();
  _showVoiceBar(true);
  broadcastTyping('recording');
}
function stopAndSendVoice(){
  voiceRecordCancelled=false;
  if(voiceMsgRecorder&&voiceMsgRecorder.state==='recording') voiceMsgRecorder.stop();
}
function cancelVoiceRecording(){
  voiceRecordCancelled=true;
  if(voiceMsgRecorder&&voiceMsgRecorder.state==='recording') voiceMsgRecorder.stop();
  else _showVoiceBar(false);
}

// -- CAMERA CAPTURE --------------------------------------------------------------
let cameraStream=null;
function openCameraCapture(){
  const inp=document.getElementById('camera-input');
  if(!inp) return;
  // On mobile, use native camera picker via file input
  // On desktop, try getUserMedia for live preview
  if(/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)){
    inp.click(); return;
  }
  if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){
    const modal=document.getElementById('camera-modal');
    if(modal){ modal.style.display='flex'; _startCameraPreview(); }
  } else {
    inp.click();
  }
}
async function _startCameraPreview(){
  const vid=document.getElementById('camera-preview');
  if(!vid) return;
  try{
    cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    vid.srcObject=cameraStream;
  }catch{
    closeCameraModal();
    document.getElementById('camera-input').click();
  }
}
function closeCameraModal(){
  if(cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; }
  const modal=document.getElementById('camera-modal');
  const vid=document.getElementById('camera-preview');
  if(vid) vid.srcObject=null;
  if(modal) modal.style.display='none';
}
function snapAndSendPhoto(){
  const vid=document.getElementById('camera-preview');
  const canvas=document.getElementById('camera-canvas');
  if(!vid||!canvas) return;
  canvas.width=vid.videoWidth||640; canvas.height=vid.videoHeight||480;
  canvas.getContext('2d').drawImage(vid,0,0);
  closeCameraModal();
  canvas.toBlob(blob=>{
    if(blob) uploadAndSendFile(new File([blob],'photo.jpg',{type:'image/jpeg'}));
  },'image/jpeg',0.92);
}
function handleCameraCapture(input){
  const file=input.files&&input.files[0];
  input.value='';
  if(file) uploadAndSendFile(file);
}

