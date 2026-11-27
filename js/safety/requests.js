// Message requests and photo blur.
// A direct message from someone you haven't added waits in "Message requests"
// until you accept it. Photos from people you don't know stay blurred until
// tapped. Both are always on for under-18 accounts.

// -- WHO COUNTS AS KNOWN -------------------------------------------------------
function isMinorAccount(){
  const tier=myTier();
  return tier==='child'||tier==='minor';
}
function requestsEnabled(){ return isMinorAccount() || !!getPrivacyPref('messageRequests',true); }
function blurEnabled(){ return isMinorAccount() || !!getPrivacyPref('blurUnknownMedia',true); }
// Staff and linked family can always reach you.
function isTrustedNumber(number){
  const n=Number(number);
  if(!me||!n) return false;
  if(n===Number(me.number)||n===ADMIN_NUMBER) return true;
  if(_SCB_ADMINS.some(a=>a.number===n)) return true;
  if(n===Number(me.childOf)||n===Number(me.linkedParent)) return true;
  const u=lookupUser(n);
  return !!u && (Number(u.childOf)===Number(me.number) || Number(u.linkedParent)===Number(me.number));
}
function isRequest(c){
  return !!(me && c && c.type==='dm' && c.request && !acceptedRequests[c.key]
    && requestsEnabled() && !isTrustedNumber(c.number));
}
function isRequestKey(key){ return isRequest(contacts.find(c=>c&&c.key===key)); }
function isKnownNumber(number){
  if(isTrustedNumber(number)) return true;
  const n=Number(number);
  return contacts.some(c=>c&&c.type==='dm'&&Number(c.number)===n&&!c.request) ||
         contacts.some(c=>c&&c.type==='dm'&&Number(c.number)===n&&!!acceptedRequests[c.key]);
}
function knownContacts(){ return contacts.filter(c=>c&&!isRequest(c)); }
function convoByKey(key){ return convosCache ? convosCache.find(x=>x&&x.key===key) : null; }
// Replying to someone counts as accepting them. Call events don't count: they
// are written when you decline a call too.
function hasSentTo(key){
  const convo=convoByKey(key);
  return !!(me && convo && (convo.messages||[]).some(m=>m&&m.from===me.number&&m.type!=='call'&&m.type!=='system'));
}

// -- UNREAD --------------------------------------------------------------------
// The one definition of "unread" used by the sidebar, dashboard and tab title.
function unreadMessagesIn(convo){
  if(!me||!convo) return [];
  let list=(convo.messages||[]).filter(Boolean);
  if(convo.disappearAfter) list=_applyDisappearingFilter(list,convo.disappearAfter);
  return list.filter(m=>m.from!==me.number && m.type!=='call' && m.type!=='system'
    && !m.shadowMuted && !m.quarantined && !m.threadOf
    && !(m.seen&&m.seen.includes(me.number)) && !_isLocallySeen(m.id));
}

// -- REQUEST LIST ---------------------------------------------------------------
// Only chats where the other person has actually written something.
function pendingRequests(){
  if(!me) return [];
  return contacts.filter(c=>{
    if(!isRequest(c)||removedContacts[c.key]||isBlockedEitherWay(c.number)) return false;
    const convo=convoByKey(c.key);
    return !!(convo && (convo.messages||[]).some(m=>m&&m.from!==me.number&&m.type!=='system'&&!m.shadowMuted));
  });
}
function openRequestList(){ currentTab='requests'; renderSidebar(); }
function renderRequestList(){
  const list=document.getElementById('sb-list');
  if(!list) return;
  list.innerHTML='';
  const back=document.createElement('button');
  back.type='button'; back.className='sb-request-back';
  back.textContent='← Message requests';
  back.onclick=()=>{ currentTab='chats'; renderSidebar(); };
  list.appendChild(back);
  const items=pendingRequests();
  if(!items.length){
    const empty=document.createElement('div');
    empty.className='section-empty'; empty.textContent='No message requests.';
    list.appendChild(empty);
    return;
  }
  items.forEach(c=>{
    const count=convoByKey(c.key).messages.filter(m=>m&&m.from!==me.number&&m.type!=='system').length;
    const name=dec(c.name)||('#'+c.number);
    const row=document.createElement('div');
    row.className='sb-item'+(activeConvo&&activeConvo.key===c.key?' active':'');
    row.tabIndex=0; row.setAttribute('role','button');
    // No message text here: nothing from a stranger shows until you open it.
    row.innerHTML='<div class="avatar sb-request-av"></div><div class="sb-item-info"><div class="sb-item-top"><span class="sb-item-name"></span></div><div class="sb-item-preview"></div></div>';
    row.querySelector('.avatar').textContent=name.charAt(0).toUpperCase();
    row.querySelector('.sb-item-name').textContent=name+' · #'+c.number;
    row.querySelector('.sb-item-preview').textContent=count+(count===1?' message':' messages');
    row.onclick=()=>openChat(c);
    row.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openChat(c); } };
    list.appendChild(row);
  });
}

// -- ACCEPT, DELETE, BLOCK ------------------------------------------------------
function acceptRequest(key){
  const c=contacts.find(x=>x&&x.key===key);
  if(!c) return;
  acceptedRequests[key]=true;
  c.request=false;
  saveStorage();
  if(currentTab==='requests') currentTab='chats';
  updateRequestBar();
  renderSidebar();
  renderDashboard();
  const convo=convoByKey(key);
  if(activeConvo&&activeConvo.key===key&&convo){ lastMsgHash=''; renderMessages(convo.messages); }
}
async function declineRequest(key,block){
  const c=contacts.find(x=>x&&x.key===key);
  if(!c||!me) return;
  const name=dec(c.name)||('#'+c.number);
  if(!confirm(block
      ? 'Block '+name+'? They won\'t be able to message or call you.'
      : 'Delete this request from '+name+'? You won\'t see their messages unless you add them yourself.')) return;
  removedContacts[key]=true;
  contacts=contacts.filter(x=>x!==c);
  if(block){
    me.blocked=me.blocked||[];
    if(!me.blocked.includes(c.number)) me.blocked.push(c.number);
  }
  saveStorage();
  if(activeConvo&&activeConvo.key===key){ activeConvo=null; updateRequestBar(); hideAll(); showMainEmpty(); }
  if(!pendingRequests().length && currentTab==='requests') currentTab='chats';
  renderSidebar();
  showToast(block?'Blocked':'Request deleted',name);
  if(block){
    try{ await registerOrUpdate(me.blocked); }
    catch(e){ showToast('Failed to sync block',scbErr('SCB-CONT-09','Your block/unblock change couldn\'t be saved to the server.',(e.message||''))); }
  }
}
function updateRequestBar(){
  const panel=document.getElementById('chat-panel'), footer=document.getElementById('chat-footer');
  if(!panel||!footer) return;
  const c=activeConvo ? contacts.find(x=>x&&x.key===activeConvo.key) : null;
  const show=isRequest(c);
  panel.classList.toggle('is-request',show);
  let bar=document.getElementById('request-bar');
  if(!show){ if(bar) bar.remove(); return; }
  if(!bar){
    bar=document.createElement('div'); bar.id='request-bar';
    footer.parentNode.insertBefore(bar,footer);
  }
  bar.innerHTML='<p></p><div class="request-actions">'
    +'<button type="button" class="btn btn-sm" data-r="accept">Accept</button>'
    +'<button type="button" class="btn btn-ghost btn-sm" data-r="delete">Delete</button>'
    +'<button type="button" class="btn btn-ghost btn-sm" data-r="block">Block</button>'
    +'<button type="button" class="btn btn-ghost btn-sm" data-r="report">Report</button></div>';
  bar.querySelector('p').textContent=(dec(c.name)||('#'+c.number))+' isn\'t in your contacts. Accept to reply. They won\'t see a read receipt until you do.';
  bar.querySelector('[data-r="accept"]').onclick=()=>acceptRequest(c.key);
  bar.querySelector('[data-r="delete"]').onclick=()=>declineRequest(c.key,false);
  bar.querySelector('[data-r="block"]').onclick=()=>declineRequest(c.key,true);
  bar.querySelector('[data-r="report"]').onclick=()=>openReport();
}
// One quiet notice per sender per visit, with no name and no message text.
const _announcedRequests=new Set();
function announceRequest(contact){
  if(_announcedRequests.has(contact.key)) return;
  _announcedRequests.add(contact.key);
  const body='Someone you haven\'t added sent you a message.';
  sendNotif('Message request',body);
  if(!document.hidden&&!shouldSuppressNotifications()){
    _pushToast('Message request',body,{kind:'message',duration:6000,onClick:openRequestList});
  }
}

// -- PHOTO BLUR ------------------------------------------------------------------
const _revealedMedia=new Set();
function applyMediaBlur(){
  const wrap=document.getElementById('messages-wrap');
  if(!wrap||!activeConvo||!me) return;
  const convo=convoByKey(activeConvo.key);
  if(!convo) return;
  const request=isRequestKey(activeConvo.key);
  if(!request&&!blurEnabled()) return;
  const byId=new Map((convo.messages||[]).filter(Boolean).map(m=>[m.id,m]));
  wrap.querySelectorAll('.msg-row.them[data-msg-id]').forEach(row=>{
    const m=byId.get(row.dataset.msgId);
    if(!m||_revealedMedia.has(m.id)||(!request&&isKnownNumber(m.from))) return;
    row.querySelectorAll('.bubble').forEach(bubble=>{
      if(!bubble.querySelector('img,video')||bubble.querySelector('.scb-reveal')) return;
      bubble.classList.add('scb-blur');
      const b=document.createElement('button');
      b.type='button'; b.className='scb-reveal';
      b.textContent='Tap to view';
      b.setAttribute('aria-label','Photo from someone you don\'t know. Show it.');
      bubble.appendChild(b);
    });
  });
}
// Capture phase: the first tap only reveals, so it can't also open the image.
document.addEventListener('click',e=>{
  const bubble=e.target.closest&&e.target.closest('#messages-wrap .bubble.scb-blur');
  if(!bubble) return;
  e.preventDefault(); e.stopPropagation();
  const row=bubble.closest('[data-msg-id]');
  if(row) _revealedMedia.add(row.dataset.msgId);
  bubble.classList.remove('scb-blur');
  const b=bubble.querySelector('.scb-reveal');
  if(b) b.remove();
},true);

// -- SETTINGS --------------------------------------------------------------------
function syncSafetyToggles(){
  const minor=isMinorAccount();
  [['message-requests-toggle',requestsEnabled()],['blur-media-toggle',blurEnabled()]].forEach(([id,on])=>{
    const el=document.getElementById(id);
    if(el){ el.checked=on; el.disabled=minor; }
  });
  const note=document.getElementById('safety-minor-note');
  if(note) note.style.display=minor?'':'none';
}
function saveSafetyPref(key,on){
  savePrivacyPref(key,on);
  updateRequestBar();
  if(currentTab==='requests'&&!requestsEnabled()) currentTab='chats';
  renderSidebar();
  const convo=activeConvo&&convoByKey(activeConvo.key);
  if(convo){ lastMsgHash=''; renderMessages(convo.messages); }
}

// -- WIRING ------------------------------------------------------------------------
(function(){
  const req=document.getElementById('message-requests-toggle');
  if(req) req.onchange=()=>saveSafetyPref('messageRequests',req.checked);
  const blur=document.getElementById('blur-media-toggle');
  if(blur) blur.onchange=()=>saveSafetyPref('blurUnknownMedia',blur.checked);

  const showSettingsBefore=showSettings;
  showSettings=function(){
    const r=showSettingsBefore.apply(this,arguments);
    syncSafetyToggles();
    return r;
  };
  const renderSidebarBefore=renderSidebar;
  renderSidebar=function(){
    if(currentTab==='requests'){ renderRequestList(); return; }
    renderSidebarBefore.apply(this,arguments);
    const list=document.getElementById('sb-list');
    if(!list||currentTab!=='chats'||searchQ) return;
    const count=pendingRequests().length;
    if(!count) return;
    const row=document.createElement('button');
    row.type='button'; row.className='sb-request-row';
    row.innerHTML='<span>Message requests</span><b></b>';
    row.querySelector('b').textContent=count;
    row.onclick=openRequestList;
    list.insertBefore(row,list.firstChild);
  };
  const openChatBefore=openChat;
  openChat=async function(c){
    const r=await openChatBefore(c);
    updateRequestBar();
    return r;
  };
  const renderMessagesBefore=renderMessages;
  renderMessages=function(msgs){
    const r=renderMessagesBefore(msgs);
    applyMediaBlur();
    return r;
  };
  // Calls from people you haven't added don't ring. The caller just sees no answer.
  const showIncomingBefore=showIncomingCallModal;
  showIncomingCallModal=function(pairKey,c){
    if(requestsEnabled()&&!isKnownNumber(c.from)){
      logMissedCall(c.from,c.fromName);
      renderDashboardWidget('missedcalls');
      if(!shouldSuppressNotifications()) showToast('Missed call','Someone you haven\'t added tried to call you.');
      return;
    }
    return showIncomingBefore(pairKey,c);
  };
})();
