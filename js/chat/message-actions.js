// -- CONTEXT MENU --------------------------------------------------------------
function showCtxMenu(e,m){
  ctxMsg=m;
  const menu=document.getElementById('ctx-menu');
  // Only show Edit for own non-GIF messages
  const editBtn=document.getElementById('ctx-edit-btn');
  if(editBtn) editBtn.style.display=(m.from===me.number&&!m.gif)?'flex':'none';
  const pinBtn=document.getElementById('ctx-pin-btn');
  if(pinBtn){
    const c=convosCache&&activeConvo?convosCache.find(x=>x&&x.key===activeConvo.key):null;
    if(c) migratePinnedIfNeeded(c);
    const pinnedId=c?c.pinnedByChannel[pinKeyFor(c)]:null;
    pinBtn.textContent=(pinnedId===m.id)?'📌 Unpin':'📌 Pin';
  }
  // Clamp against the menu's ACTUAL rendered size, not a guessed width/height —
  // this menu has grown to 10 items over time (Thread, Translate, etc. were
  // added after the original 150px-tall guess was written) and a stale guess
  // just lets it run off the bottom/right edge of the screen instead of
  // actually fitting, exactly what was happening before this fix. Make it
  // visible off-screen first so offsetWidth/offsetHeight reflect its real
  // size, then position it for real.
  menu.style.left='-9999px';menu.style.top='-9999px';menu.style.display='block';
  const mw=menu.offsetWidth,mh=menu.offsetHeight;
  menu.style.left=Math.max(4,Math.min(e.clientX,window.innerWidth-mw-4))+'px';
  menu.style.top=Math.max(4,Math.min(e.clientY,window.innerHeight-mh-4))+'px';
  document.addEventListener('click',hideCtxMenu,{once:true});
}
function hideCtxMenu(){document.getElementById('ctx-menu').style.display='none';}
let replyingTo=null;
function ctxAction(action){
  if(!ctxMsg) return;
  if(action==='copy'){navigator.clipboard.writeText(msgText(ctxMsg));}
  else if(action==='info'){showMsgInfo(ctxMsg);}
  else if(action==='reply'){startReply(ctxMsg);}
  else if(action==='edit'){startEditMsg(ctxMsg);}
  else if(action==='pin'){togglePinMessage(ctxMsg);}
  else if(action==='forward'){openForwardModal(ctxMsg);}
  else if(action==='thread'){openThread(ctxMsg);}
  else if(action==='translate'){
    const txt=msgText(ctxMsg);
    if(!txt){ showToast('Nothing to translate',''); ctxMsg=null; return; }
    const _tMsgId=ctxMsg.id; // capture before ctxMsg is nulled below
    showToast('Translating…','');
    fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(txt.substring(0,500))+'&langpair=auto|en')
      .then(r=>r.json()).then(d=>{
        const tr=(d&&d.responseData&&d.responseData.translatedText)||'';
        if(tr && tr.toLowerCase()!==txt.toLowerCase()){
          const msgEl=document.querySelector('[data-msg-id="'+_tMsgId+'"] .bubble');
          if(msgEl){
            let tDiv=msgEl.querySelector('.msg-translation');
            if(!tDiv){ tDiv=document.createElement('div'); tDiv.className='msg-translation'; tDiv.style.cssText='font-size:11px;color:var(--muted);border-top:1px solid var(--border);margin-top:4px;padding-top:4px;font-style:italic'; msgEl.appendChild(tDiv); }
            tDiv.textContent='🌐 '+tr;
          }
          showToast('Translated','');
        } else { showToast('No translation found',''); }
      }).catch(()=>showToast('Translation failed','Check your connection.'));
  }
  else if(action==='delete'){
    if(!convosCache) return;
    const c=convosCache.find(x=>x&&x.key===activeConvo.key);
    if(c){c.messages=c.messages.filter(m=>m.id!==ctxMsg.id);saveConvos().then(()=>renderMessages(c.messages)).catch(()=>{});}
  }
  else if(action==='select'){
    enterMsgSelectMode(ctxMsg.id);
  }
  ctxMsg=null;
}
function startReply(msg){
  const u=msg.from===me.number?me:(lookupUser(msg.from)||{});
  const name=msg.from===me.number?'yourself':(dec(u.name)||('#'+msg.from));
  const snippet=(msgHasGif(msg)?'GIF':msgHasPoll(msg)?'📊 '+((msgPollData(msg)||{}).question||'Poll'):msgFileData(msg)?'📎 '+((msgFileData(msg)||{}).name||'Attachment'):msgText(msg)).substring(0,100);
  replyingTo={id:msg.id,from:msg.from,name,snippet};
  document.getElementById('reply-preview-text').innerHTML='Replying to <b>'+esc(name)+'</b>: '+esc(snippet);
  document.getElementById('reply-preview-row').style.display='flex';
  document.getElementById('msg-input').focus();
}
function cancelReply(){
  replyingTo=null;
  document.getElementById('reply-preview-row').style.display='none';
}

// Swipe action is configurable (Settings > Messaging > "Swipe gesture").
// Keep the set of valid values here in sync with the <select> options.
const SWIPE_ACTIONS={
  reply:   m=>startReply(m),
  pin:     m=>togglePinMessage(m),
  forward: m=>openForwardModal(m),
  react:   m=>addReaction(m,'👍'),
};
function getSwipeAction(){
  const v=scbLoad('cc_swipe_action','reply');
  return SWIPE_ACTIONS[v]?v:'reply';
}
function runSwipeAction(m){
  (SWIPE_ACTIONS[getSwipeAction()]||SWIPE_ACTIONS.reply)(m);
}

// -- PINNED MESSAGES -----------------------------------------------------------
// Pinning is per-channel (a map keyed by channel id) for group chats, and
// still a single pin for DMs which have no channels. Old data used a single
// `c.pinned` field — migrated into the map under 'general' the first time
// a pinned conversation with channels is touched.
function pinKeyFor(c){ return (activeConvo&&activeConvo.type==='group') ? (activeChannelId||'general') : '_dm'; }
function migratePinnedIfNeeded(c){
  if(c.pinned && !c.pinnedByChannel){
    c.pinnedByChannel = { [pinKeyFor(c)]: c.pinned };
    delete c.pinned;
  }
  if(!c.pinnedByChannel) c.pinnedByChannel={};
}
async function togglePinMessage(msg){
  if(!activeConvo||!convosCache) return;
  const c=convosCache.find(x=>x&&x.key===activeConvo.key);
  if(!c) return;
  migratePinnedIfNeeded(c);
  const key=pinKeyFor(c);
  c.pinnedByChannel[key]=(c.pinnedByChannel[key]===msg.id)?null:msg.id;
  await saveConvos();
  renderPinnedBanner(c);
  showToast(c.pinnedByChannel[key]?'Message pinned':'Message unpinned','');
}
function renderPinnedBanner(c){
  const banner=document.getElementById('pinned-banner');
  if(!banner) return;
  if(!c){ banner.style.display='none'; banner.innerHTML=''; return; }
  migratePinnedIfNeeded(c);
  const key=pinKeyFor(c);
  const pinnedId=c.pinnedByChannel[key];
  if(!pinnedId){ banner.style.display='none'; banner.innerHTML=''; return; }
  const msg=c.messages.find(x=>x.id===pinnedId);
  if(!msg){ banner.style.display='none'; banner.innerHTML=''; c.pinnedByChannel[key]=null; return; }
  const u=msg.from===me.number?me:(lookupUser(msg.from)||{});
  const preview=msgHasGif(msg)?'📎 GIF':msgHasPoll(msg)?('📊 '+((msgPollData(msg)||{}).question||'Poll')):(msgText(msg));
  banner.style.display='flex';
  banner.innerHTML=`<span class="pin-ico">📌</span><span class="pin-text"><strong>${esc(dec(u.name)||'Someone')}</strong>: ${esc(preview)}</span><span class="pin-unpin" title="Unpin">✕</span>`;
  const _unpinBtn=banner.querySelector('.pin-unpin');
  if(_unpinBtn) _unpinBtn.onclick=e=>{ e.stopPropagation(); unpinFromBanner(); };
}
async function unpinFromBanner(){
  if(!activeConvo||!convosCache) return;
  const c=convosCache.find(x=>x&&x.key===activeConvo.key);
  if(!c) return;
  migratePinnedIfNeeded(c);
  c.pinnedByChannel[pinKeyFor(c)]=null;
  await saveConvos();
  renderPinnedBanner(c);
  showToast('Message unpinned','');
}
function scrollToLpSection(id){
  // #landing-page itself is the scrolling container (position:fixed +
  // overflow-y:auto), not the window — so scrollIntoView's default
  // block:'start' lands the section's top edge exactly at the TOP of
  // #landing-page's viewport. But .lp-nav is `position:sticky;top:0`
  // inside that same container, so it then sits on top of (hides) the
  // section's own heading/label — visually it looks like the scroll
  // went further than it should have. Scroll to an explicit position
  // offset by the sticky nav's real height instead, within the actual
  // scrolling element.
  const scroller=document.getElementById('landing-page');
  const target=document.getElementById(id);
  if(!scroller||!target) return;
  const nav=scroller.querySelector('.lp-nav');
  const navH=nav?nav.getBoundingClientRect().height:0;
  const top=target.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop-navH-16;
  scroller.scrollTo({top:Math.max(0,top),behavior:'smooth'});
}
function scrollToPinned(){
  if(!activeConvo||!convosCache) return;
  const c=convosCache.find(x=>x&&x.key===activeConvo.key);
  if(!c) return;
  migratePinnedIfNeeded(c);
  const pinnedId=c.pinnedByChannel[pinKeyFor(c)];
  if(!pinnedId) return;
  const wrap=document.getElementById('messages-wrap');
  const target=wrap.querySelector(`[data-msg-id="${pinnedId}"]`);
  if(target){
    target.scrollIntoView({behavior:'smooth',block:'center'});
    target.classList.add('msg-highlight');
    setTimeout(()=>target.classList.remove('msg-highlight'),1200);
  }
}

// -- FORWARD MESSAGE -------------------------------------------------------------
// forwardMsgs is always an array internally — openForwardModal() accepts
// either a single message (every existing call site: ctx menu, swipe
// action) or an array (the multi-select bulk-forward bar), normalizing
// either way, so forwardToTarget() has one code path regardless of how
// many messages are being forwarded.
let forwardMsgs=[];
function openForwardModal(m){
  forwardMsgs=Array.isArray(m)?m.filter(Boolean):(m?[m]:[]);
  if(!forwardMsgs.length) return;
  const list=document.getElementById('forward-list');
  list.innerHTML='';
  if(!contacts||!contacts.length){
    list.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px">No contacts or groups yet.</div>';
  }else{
    contacts.forEach(c=>{
      const row=document.createElement('div');
      row.className='sb-item';
      row.style.cssText='display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--r-sm);cursor:pointer';
      const av=document.createElement('div');
      av.className=c.type==='group'?'group-avatar':'avatar';
      av.style.cssText='width:36px;height:36px;font-size:14px;background:linear-gradient(135deg,#0078d4,#6264a0);color:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:50%';
      const _fwAv=(lookupUser(c.number)||{}).avatar||c.avatar||'';
      if(_fwAv&&(String(_fwAv).startsWith('data:image/')||String(_fwAv).startsWith('https://'))) av.innerHTML='<img src="'+esc(_fwAv)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
      else av.textContent=c.type==='group'?'👥':(dec(c.name)||'?').charAt(0).toUpperCase();
      const name=document.createElement('div');
      name.style.cssText='font-size:13px;font-weight:500';
      name.textContent=dec(c.name)||'Unknown';
      row.appendChild(av);row.appendChild(name);
      row.onclick=()=>forwardToTarget(c);
      list.appendChild(row);
    });
  }
  openModal('forward-modal');
}
async function forwardToTarget(c){
  if(!forwardMsgs.length||!me) return;
  const key=c.key||dmKey(me.number,c.number);
  if(lockedChats[key]){
    closeModal('forward-modal');
    showToast('Chat locked',scbErr('SCB-MSG-23','Open and unlock that chat first, then forward the message.'));
    forwardMsgs=[];
    return;
  }
  closeModal('forward-modal');
  try{
    const conv=await getOrMakeConvo(key,c.type==='group'?c.members:[me.number,c.number]);
    const destAesKey=await getConvoAesKey(conv);
    for(const fm of forwardMsgs){
      const msg={id:Date.now().toString(36)+Math.random().toString(36).slice(2,5),from:me.number,time:Date.now(),seen:[],forwarded:true};
      if(msgHasGif(fm)){
        const gifUrl=msgGifUrl(fm);
        const wrapped=destAesKey?await aesEnc(destAesKey,gifUrl):null;
        if(wrapped){ msg.cgif=wrapped; _decCache[msg.id]={gif:gifUrl}; }
        else msg.gif=gifUrl;
      }else if(fm.poll){
        const clean='📊 '+(dec(fm.poll.question)||'Poll');
        const wrapped=destAesKey?await aesEnc(destAesKey,clean):null;
        if(wrapped){ msg.ctext=wrapped; _decCache[msg.id]={text:clean}; }
        else msg.text=enc(clean);
      }else{
        const clean=msgText(fm);
        const wrapped=destAesKey?await aesEnc(destAesKey,clean):null;
        if(wrapped){ msg.ctext=wrapped; _decCache[msg.id]={text:clean}; }
        else msg.text=enc(clean);
      }
      conv.messages.push(msg);
    }
    if(conv.messages.length>500) conv.messages.splice(0,conv.messages.length-500);
    await saveConvos();
    showToast('Forwarded',dec(c.name)?((forwardMsgs.length>1?forwardMsgs.length+' messages sent to ':'Sent to ')+dec(c.name)):'Message forwarded');
    if(activeConvo&&activeConvo.key===key){renderMessages(conv.messages);lastMsgHash=JSON.stringify(conv.messages);}
  }catch(e){showToast('Forward failed',scbErr('SCB-MSG-07','That message couldn\'t be forwarded — the server rejected the write.',(e.message||'')));}
  forwardMsgs=[];
  exitMsgSelectMode();
}

// -- IN-CHAT MESSAGE SEARCH -----------------------------------------------------
let msgSearchResults=[];
let msgSearchIdx=-1;
let msgSearchDebounce=null;
function toggleMsgSearch(){
  const bar=document.getElementById('msg-search-bar');
  const visible=bar.style.display!=='none'&&bar.style.display!=='';
  if(visible){
    bar.style.display='none';
    document.getElementById('msg-search-input').value='';
    clearMsgSearchHighlights();
    msgSearchResults=[];msgSearchIdx=-1;
  }else{
    bar.style.display='flex';
    const input=document.getElementById('msg-search-input');
    input.value='';input.focus();
    document.getElementById('msg-search-count').textContent='0 / 0';
  }
}
function clearMsgSearchHighlights(){
  document.querySelectorAll('.msg-search-match').forEach(el=>el.classList.remove('msg-search-match','msg-search-current'));
}
function msgSearchInput(q){
  clearTimeout(msgSearchDebounce);
  msgSearchDebounce=setTimeout(()=>runMsgSearch(q.trim()),200);
}
function runMsgSearch(q){
  clearMsgSearchHighlights();
  msgSearchResults=[];msgSearchIdx=-1;
  if(!q||!activeConvo||!convosCache){updateMsgSearchCount();return;}
  const c=convosCache.find(x=>x&&x.key===activeConvo.key);
  if(!c||!c.messages) {updateMsgSearchCount();return;}
  const ql=q.toLowerCase();
  c.messages.forEach(m=>{
    if(!m.gif&&!m.poll){
      const txt=(msgText(m)).toLowerCase();
      if(txt.includes(ql)) msgSearchResults.push(m.id);
    }
  });
  const wrap=document.getElementById('messages-wrap');
  msgSearchResults.forEach(id=>{
    const row=wrap.querySelector(`[data-msg-id="${id}"] .bubble`);
    if(row) row.classList.add('msg-search-match');
  });
  if(msgSearchResults.length){msgSearchIdx=0;jumpToMsgSearchResult();}
  updateMsgSearchCount();
}
function updateMsgSearchCount(){
  const el=document.getElementById('msg-search-count');
  if(el) el.textContent=msgSearchResults.length?((msgSearchIdx+1)+' / '+msgSearchResults.length):'0 / 0';
}
function msgSearchNav(dir){
  if(!msgSearchResults.length) return;
  msgSearchIdx=(msgSearchIdx+dir+msgSearchResults.length)%msgSearchResults.length;
  jumpToMsgSearchResult();
  updateMsgSearchCount();
}
function jumpToMsgSearchResult(){
  if(msgSearchIdx<0||msgSearchIdx>=msgSearchResults.length) return;
  document.querySelectorAll('.msg-search-current').forEach(el=>el.classList.remove('msg-search-current'));
  const id=msgSearchResults[msgSearchIdx];
  const wrap=document.getElementById('messages-wrap');
  const bubble=wrap.querySelector(`[data-msg-id="${id}"] .bubble`);
  if(bubble){
    bubble.classList.add('msg-search-current');
    bubble.scrollIntoView({behavior:'smooth',block:'center'});
  }
}
function msgSearchKeydown(e){
  if(e.key==='Enter'){e.preventDefault();msgSearchNav(e.shiftKey?-1:1);}
  else if(e.key==='Escape'){toggleMsgSearch();}
}

// -- EDIT MESSAGE --------------------------------------------------------------
let editingMsgId=null;
function startEditMsg(m){
  editingMsgId=m.id;
  const input=document.getElementById('msg-input');
  input.value=msgText(m);
  input.focus();autoResize(input);
  // Show edit indicator
  let bar=document.getElementById('edit-bar');
  if(!bar){
    bar=document.createElement('div');bar.id='edit-bar';
    bar.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:4px 14px;background:rgba(0,120,212,0.12);font-size:12px;color:var(--accent);border-top:1px solid var(--border);flex-shrink:0;';
    const footer=document.getElementById('chat-footer');
    footer.parentNode.insertBefore(bar,footer);
  }
  bar.innerHTML='<span>✏️ Editing message</span>';
  const _editX=document.createElement('span');
  _editX.style.cssText='cursor:pointer;font-size:16px;color:var(--muted)';
  _editX.textContent='✕';
  _editX.onclick=cancelEdit;
  bar.appendChild(_editX);
  bar.style.display='flex';
  // Override send to save edit
  document.getElementById('send-btn').onclick=saveEditMsg;
}
async function saveEditMsg(){
  const input=document.getElementById('msg-input');
  const newText=input.value.trim();
  if(!newText||!editingMsgId||!activeConvo||!convosCache) return;
  const c=convosCache.find(x=>x&&x.key===activeConvo.key);
  if(!c) return;
  const m=c.messages.find(x=>x.id===editingMsgId);
  if(!m){cancelEdit();return;}
  const clean=filterBadWords(newText);
  // Mirror sendMsg()'s encryption branch, not just the plain enc() path: a
  // message that was sent with ctext (the normal case in any E2E-encrypted
  // conversation) needs to be RE-encrypted with the convo's AES key, not
  // switched over to the separate fixed-key enc() scheme — otherwise m.text
  // is set but msgText() keeps serving the pre-edit text from _decCache
  // (checked before falling back to dec(m.text), and decryptConvoMessages()
  // skips any message that already has a _decCache entry), so the edit
  // silently never shows up for anyone, including the editor after reload.
  const aesKey=await getConvoAesKey(c);
  const wrapped=aesKey?await aesEnc(aesKey,clean):null;
  if(wrapped){ m.ctext=wrapped; delete m.text; _decCache[m.id]={text:clean}; }
  else{ m.text=enc(clean); delete m.ctext; delete _decCache[m.id]; }
  m.edited=true;
  try{
    await saveConvos();
    renderMessages(c.messages);
    showToast('Message edited','');
  }catch(e){showToast('Edit failed',scbErr('SCB-MSG-08','Your edit couldn\'t be saved — the server rejected the write.',e.message));}
  cancelEdit();
}
function cancelEdit(){
  editingMsgId=null;
  const input=document.getElementById('msg-input');
  input.value='';autoResize(input);
  const bar=document.getElementById('edit-bar');
  if(bar) bar.style.display='none';
  document.getElementById('send-btn').onclick=()=>sendMsg();
}

// -- BLOCK USER ------------------------------------------------------------
async function toggleBlockUser(){
  if(!activeConvo||activeConvo.type==='group'||!me) return;
  if(!me.blocked) me.blocked=[];
  const num=activeConvo.number;
  const idx=me.blocked.indexOf(num);
  const willBlock=idx===-1;
  if(willBlock){
    if(!confirm('Block '+activeConvo.name+'? They won\'t be able to message you, and you won\'t be able to message them.')) return;
    me.blocked.push(num);
  }else{
    me.blocked.splice(idx,1);
  }
  saveStorage();
  try{ await registerOrUpdate(me.blocked); }catch(e){ showToast('Failed to sync block',scbErr('SCB-CONT-09','Your block/unblock change couldn\'t be saved to the server.',(e.message||''))); }
  const blockBtn=document.getElementById('block-menu-item');
  if(blockBtn){ blockBtn.innerHTML=willBlock?'✅ Unblock':'⛔ Block'; }
  showToast(willBlock?'User blocked':'User unblocked','');
}
// Messaging block check: a full block (`blocked`) always counts, as does
// a messages-only block (`blockedMessages`) — security feature 31/32.
function isBlockedEitherWay(otherNum){
  if(me&&me.blocked&&me.blocked.includes(otherNum)) return true;
  if(me&&Array.isArray(me.blockedMessages)&&me.blockedMessages.includes(otherNum)) return true;
  const other=lookupUser(otherNum);
  if(other&&me){
    if(Array.isArray(other.blocked)&&other.blocked.includes(me.number)) return true;
    if(Array.isArray(other.blockedMessages)&&other.blockedMessages.includes(me.number)) return true;
  }
  return false;
}
// Calls block check: a full block always counts, as does a calls-only
// block (`blockedCalls`) — independent of whether messages are blocked.
function isBlockedForCalls(otherNum){
  if(me&&me.blocked&&me.blocked.includes(otherNum)) return true;
  if(me&&Array.isArray(me.blockedCalls)&&me.blockedCalls.includes(otherNum)) return true;
  const other=lookupUser(otherNum);
  if(other&&me){
    if(Array.isArray(other.blocked)&&other.blocked.includes(me.number)) return true;
    if(Array.isArray(other.blockedCalls)&&other.blockedCalls.includes(me.number)) return true;
  }
  return false;
}
async function toggleBlockCallsOnly(){
  if(!activeConvo||activeConvo.type==='group'||!me) return;
  if(!Array.isArray(me.blockedCalls)) me.blockedCalls=[];
  const num=activeConvo.number;
  const idx=me.blockedCalls.indexOf(num);
  const willBlock=idx===-1;
  if(willBlock){
    if(!confirm('Block calls from '+activeConvo.name+'? Messages will still work normally.')) return;
    me.blockedCalls.push(num);
  }else{
    me.blockedCalls.splice(idx,1);
  }
  saveStorage();
  try{ await registerOrUpdate(me.blocked,me.blockedCalls,me.blockedMessages); }
  catch(e){ showToast('Failed to sync',scbErr('SCB-CONT-10','Your call-block change couldn\'t be saved to the server.',(e.message||''))); }
  const btn=document.getElementById('block-calls-menu-item');
  if(btn) btn.innerHTML=willBlock?'✅ Unblock calls':'📵 Block calls only';
  showToast(willBlock?'Calls blocked':'Calls unblocked','');
}
async function toggleBlockMessagesOnly(){
  if(!activeConvo||activeConvo.type==='group'||!me) return;
  if(!Array.isArray(me.blockedMessages)) me.blockedMessages=[];
  const num=activeConvo.number;
  const idx=me.blockedMessages.indexOf(num);
  const willBlock=idx===-1;
  if(willBlock){
    if(!confirm('Block messages from '+activeConvo.name+'? Calls will still work normally.')) return;
    me.blockedMessages.push(num);
  }else{
    me.blockedMessages.splice(idx,1);
  }
  saveStorage();
  try{ await registerOrUpdate(me.blocked,me.blockedCalls,me.blockedMessages); }
  catch(e){ showToast('Failed to sync',scbErr('SCB-CONT-11','Your message-block change couldn\'t be saved to the server.',(e.message||''))); }
  const btn=document.getElementById('block-messages-menu-item');
  if(btn) btn.innerHTML=willBlock?'✅ Unblock messages':'🔇 Block messages only';
  showToast(willBlock?'Messages blocked':'Messages unblocked','');
}

// -- EXPORT --------------------------------------------------------------------
function exportChat(){
  if(!activeConvo||!convosCache) return;
  const c=convosCache.find(x=>x&&x.key===activeConvo.key);
  if(!c||!c.messages.length){showToast('Nothing to export',scbErr('SCB-MSG-09','No messages in this chat.'));return;}
  let txt=`SoCloudyBro Export\nChat: ${activeConvo.name}\nExported: ${new Date().toLocaleString()}\n${'-'.repeat(40)}\n\n`;
  c.messages.forEach(m=>{
    const u=lookupUser(m.from)||{};
    const name=dec(u.name)||'#'+m.from;
    const time=new Date(m.time).toLocaleString();
    txt+=`[${time}] ${name}: ${msgHasGif(m)?'[GIF]':msgText(m)}\n`;
  });
  const blob=new Blob([txt],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`chat_${activeConvo.name.replace(/\s+/g,'_')}_${Date.now()}.txt`;
  a.click();
}
// -- FULL ACCOUNT EXPORT (all conversations, decrypted, + profile/settings) ---
async function exportAllData(){
  if(!me) return;
  const btn=document.getElementById('export-all-btn');
  if(btn){ btn.disabled=true; btn.textContent='Preparing export…'; }
  try{
    if(!convosCache) await getConvos();
    const data={
      exportedAt:new Date().toISOString(),
      app:'SoCloudyBro',
      profile:{name:me.name,number:me.number,email:me.email||null,bio:me.bio||''},
      contacts:contacts.map(c=>({type:c.type,name:c.name,number:c.number||null,key:c.key})),
      conversations:[]
    };
    for(const c of contacts){
      const conv=convosCache.find(x=>x&&x.key===c.key);
      if(!conv||!conv.messages||!conv.messages.length) continue;
      try{ await decryptConvoMessages(conv); }catch(e){}
      const messages=conv.messages.map(m=>{
        const u=m.from===me.number?me:(lookupUser(m.from)||{});
        let content;
        if(msgHasGif(m)) content='[GIF: '+(msgGifUrl(m)||'')+']';
        else if(msgHasPoll(m)) content='[Poll: '+((msgPollData(m)||{}).question||'')+']';
        else{ const f=msgFileData(m); content=f?'[Attachment: '+(f.name||'file')+' — '+(f.url||'')+']':msgText(m); }
        return {from:dec(u.name)||('#'+m.from),time:new Date(m.time).toISOString(),content};
      });
      data.conversations.push({name:c.name,type:c.type,messageCount:messages.length,messages});
    }
    data.settings={
      accentColor:localStorage.getItem('cc_accent_color')||null,
      theme:localStorage.getItem('cc_theme')||null,
      weatherLocation:getWeatherLocation(),
      dashboardLayout:getDashboardLayout()
    };
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='socloudybro-export-'+me.number+'-'+Date.now()+'.json';
    document.body.appendChild(a); a.click(); a.remove();
    showToast('Export ready','Your data has been downloaded as a JSON file.');
  }catch(e){
    showToast('Export failed',scbErr('SCB-MSG-10','Your chat export couldn\'t be built — reading or downloading the data failed.',(e.message||'')));
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Export My Data'; }
  }
}


// -- REPORT --------------------------------------------------------------------
function openReport(){
  if(!activeConvo||activeConvo.type==='group'){showToast('Select a DM to report',scbErr('SCB-MSG-11','Reports can only be sent about a direct message — open a DM first.'));return;}
  document.getElementById('report-reason').value='';
  document.getElementById('report-category').value='spam';
  document.getElementById('report-error').textContent='';
  openModal('report-modal');
}
// Security feature 30/32: snapshot the last few messages in the reported
// conversation as evidence, decrypted to plain readable text for the
// reviewer — a report is otherwise just the reporter's own unverifiable
// claim with nothing for a moderator to actually look at.
const REPORT_EVIDENCE_COUNT=10;
function _buildReportEvidence(convoKey){
  try{
    const conv=(convosCache||[]).find(c=>c&&c.key===convoKey);
    if(!conv||!Array.isArray(conv.messages)) return [];
    return conv.messages.slice(-REPORT_EVIDENCE_COUNT).map(m=>{
      let text='';
      if(m.type==='system') text='[system] '+(m.text||'');
      else if(_decCache[m.id]&&_decCache[m.id].text!=null) text=_decCache[m.id].text;
      else if(m.text) text=dec(m.text)||'[could not decrypt]';
      else if(m.gif||m.cgif) text='[GIF]';
      else if(m.file||m.cfile) text='[file attachment]';
      else text='[unreadable]';
      return { from:m.from, time:m.time, text };
    });
  }catch(e){ return []; }
}
// -- WEB3FORMS (report emails to the admin's inbox) -----------------------------
// Table-based, all-inline-style HTML fragment for the emails Web3Forms sends —
// email clients (Outlook especially) don't reliably support modern CSS, so
// this deliberately doesn't reuse the app's own stylesheet. Kept as a fragment
// (no <html>/<head>) since it's dropped into a `message`/merge-tag field
// inside Web3Forms' own outer email template, not sent as a standalone email.
function _scbEmailCard(opts){
  const {emoji='☁️', title='SoCloudyBro', accentColor='#4C46C4', rows=[], footerNote=''} = opts;
  const rowsHtml=rows.filter(r=>r&&r.value!=null&&r.value!=='').map(r=>
    `<tr>
      <td style="padding:9px 0;border-bottom:1px solid #eef0f6;font:600 12px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;vertical-align:top;white-space:nowrap;padding-right:16px">${esc(r.label)}</td>
      <td style="padding:9px 0;border-bottom:1px solid #eef0f6;font:400 14px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a;line-height:1.5">${r.html?r.value:esc(String(r.value))}</td>
    </tr>`).join('');
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <tr><td style="background:linear-gradient(135deg,${accentColor} 0%,#7C5FD4 100%);background-color:${accentColor};padding:20px 24px">
      <span style="font-size:20px;font-weight:700;color:#ffffff">${emoji} ${esc(title)}</span>
    </td></tr>
    <tr><td style="padding:20px 24px 8px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rowsHtml}</table>
    </td></tr>
    ${footerNote?`<tr><td style="padding:4px 24px 20px"><span style="font:400 12px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#9ca3af">${esc(footerNote)}</span></td></tr>`:''}
    <tr><td style="background:#f9fafb;padding:12px 24px;border-top:1px solid #e5e7eb">
      <span style="font:400 11px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#9ca3af">SoCloudyBro · automated notification</span>
    </td></tr>
  </table>`;
}
async function sendWeb3Form(fields){
  // Route through the Worker's /report endpoint so the Web3Forms access key
  // stays server-side. Falls back to the direct Web3Forms call if the Worker
  // is unreachable (e.g. during a Worker deploy/outage).
  const workerBase = MINT_TOKEN_ENDPOINT.replace(/\/mint-token$/, '');
  try {
    const res=await fetch(workerBase+'/report',{
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify(fields)
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok||!data.ok) throw new Error(data.error||'Worker report failed');
    return data;
  } catch(e) {
    if(!WEB3FORMS_ACCESS_KEY) throw e;
    const res=await fetch('https://api.web3forms.com/submit',{
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({access_key:WEB3FORMS_ACCESS_KEY,...fields})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok||!data.success) throw new Error(data.message||'Failed to send.');
    return data;
  }
}
const REPORT_CATEGORY_LABELS={spam:'Spam',harassment:'Harassment or bullying',scam:'Scam or phishing',inappropriate:'Inappropriate content',impersonation:'Impersonation',other:'Other'};
async function submitReport(){
  const reason=document.getElementById('report-reason').value.trim();
  const category=document.getElementById('report-category').value||'other';
  const err=document.getElementById('report-error');err.textContent='';
  if(!reason){err.textContent=scbErr('SCB-MSG-12','Please describe the issue.');return;}
  const btn=document.querySelector('#report-modal .btn-danger');btn.disabled=true;btn.innerHTML='<span class="spinner"></span>';
  try{
    const reported=contacts.find(c=>c&&c.key===activeConvo.key);
    const adminLink=`${SITE_URL}?admin=1&user=${reported?reported.number:'?'}`;
    // Security feature 30/32: snapshot the last few messages as evidence —
    // a report is otherwise just the reporter's own unverifiable claim.
    const evidence=_buildReportEvidence(activeConvo.key);
    try{
      const newReport={
        id:Date.now().toString(36)+Math.random().toString(36).slice(2,5),
        reportedNumber:reported?reported.number:null,
        reportedName:reported?reported.name:'Unknown',
        reporterNumber:me.number,
        reporterName:me.name,
        category,
        reason,
        evidence,
        time:Date.now(),
        status:'open'
      };
      // Written narrowly to reports/<id> instead of fetch-all-then-
      // saveReports(wholeArray) — the reports Firebase rule only allows a
      // non-admin to create a NEW entry, not touch any existing one, so
      // two reports filed close together used to race: whichever save
      // landed second would omit the other's just-added report from its
      // snapshot, which the rule reads as "deleting an existing report"
      // and rejects the ENTIRE write — silently losing the second
      // reporter's report (the catch below swallows it). A direct
      // single-key write can't collide with anyone else's report this way.
      await fbdb.ref('reports/'+newReport.id).set(newReport);
      reportsCache=[...(reportsCache||[]),newReport];
      if(reported) await _checkMassReportSpike(reported.number,reported.name,reportsCache);
    }catch(e){ /* report email below still goes out even if this fails */ }
    const evidenceText=evidence.length
      ? evidence.map(m=>'#'+m.from+' ('+new Date(m.time).toLocaleString()+'): '+m.text).join('\n')
      : '(no message history available)';
    await sendWeb3Form({
      subject:'SoCloudyBro report: '+(reported?reported.name:'Unknown user'),
      reported_name:reported?reported.name:'Unknown',
      reported_number:reported?reported.number:'?',
      admin_link:adminLink,
      reporter_name:me.name,
      reporter_number:me.number,
      category:REPORT_CATEGORY_LABELS[category]||category,
      reason,
      evidence:evidenceText,
      time:new Date().toLocaleString(),
      // Extra field, additive only — doesn't touch the existing merge-tag
      // fields above so any custom template already configured on the
      // Web3Forms dashboard for this form keeps working unchanged. A
      // template that adds {{summary_html}} gets a ready-made styled card;
      // one that doesn't reference it is unaffected.
      summary_html:_scbEmailCard({
        emoji:'🚩', title:'New Report', accentColor:'#d13438',
        rows:[
          {label:'Reported',value:(reported?reported.name:'Unknown')+' (#'+(reported?reported.number:'?')+')'},
          {label:'Reported by',value:me.name+' (#'+me.number+')'},
          {label:'Category',value:REPORT_CATEGORY_LABELS[category]||category},
          {label:'Reason',value:reason},
          {label:'Evidence',value:esc(evidenceText).replace(/\n/g,'<br>'),html:true},
          {label:'Time',value:new Date().toLocaleString()},
          {label:'Review',value:`<a href="${esc(adminLink)}" style="color:#4C46C4">Open admin panel →</a>`,html:true},
        ],
      }),
    });
    closeModal('report-modal');
    showToast('Report sent','Thank you. We will review this.');
  }catch(e){err.textContent=scbErr('SCB-MSG-13','Failed to send report. Try again.');}
  finally{btn.disabled=false;btn.textContent='Send Report';}
}

// -- ARCHIVE -------------------------------------------------------------------
function archiveToggle(){
  if(!activeConvo) return;
  const key=activeConvo.key;
  archivedContacts[key]=!archivedContacts[key];
  saveStorage();
  showToast(archivedContacts[key]?'Archived':'Unarchived','');
  hideAll();showMainEmpty();
  activeConvo=null;renderSidebar();
}

// -- CHAT BACKGROUND (STATIC GRADIENTS + ANIMATED) ----------------------------------------
const BG_PRESETS={
  bubbles:'radial-gradient(circle at 22% 28%, rgba(0,150,255,0.30), transparent 45%), radial-gradient(circle at 78% 68%, rgba(139,92,246,0.28), transparent 50%), linear-gradient(160deg,#0f0c29,#302b63,#24243e)',
  aurora:'linear-gradient(160deg, rgba(0,255,150,0.16), transparent 45%), linear-gradient(210deg, rgba(0,200,255,0.14), transparent 55%), linear-gradient(135deg,#070b14,#0d1f2d,#091a1a)',
  sunset:'linear-gradient(180deg,#1a0533 0%,#5c1240 35%,#c45b2a 72%,#f0a830 100%)',
  textures:'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 14px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.03) 0 2px, transparent 2px 14px), linear-gradient(135deg,#23272f,#3a4150)',
  abstract:'linear-gradient(135deg,#ff6b6b 0%,#f7b733 28%,#6b5de8 58%,#1abc9c 100%)',
  pastel:'linear-gradient(135deg,#ffd6e7 0%,#cfe8ff 38%,#d6f5e1 70%,#fff3d6 100%)'
};
const ANIM_BG_TYPES=new Set(['rain','snow','stars','leaves']);

function clearAnimBg(){
  const ov=document.getElementById('chat-anim-overlay');
  if(ov){ if(typeof ov._starsCleanup==='function'){ ov._starsCleanup(); ov._starsCleanup=null; } ov.innerHTML=''; ov.style.display='none'; }
}
function initAnimBg(type){
  const ov=document.getElementById('chat-anim-overlay');
  if(!ov) return;
  if(typeof ov._starsCleanup==='function'){ ov._starsCleanup(); ov._starsCleanup=null; }
  ov.innerHTML=''; ov.style.display='block';
  if(type==='rain'){
    // Video background
    const v=document.createElement('video');
    v.src='rain-bg.mp4'; v.autoplay=true; v.muted=true; v.loop=true; v.playsInline=true;
    v.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.9;';
    ov.appendChild(v);
    v.play().catch(()=>{
      // Fallback to CSS rain if video can't play
      _initCssRain(ov);
    });
    return;
  }
  if(type==='stars'){
    // Canvas-based stars: single DOM node instead of 160+ divs, no layout thrashing
    const cvs=document.createElement('canvas');
    cvs.style.cssText='position:absolute;inset:0;width:100%;height:100%;';
    ov.appendChild(cvs);
    const starBaseColors=[[255,255,255],[200,220,255],[255,250,200],[220,200,255],[180,220,255]];
    // Build star data once
    const stars=Array.from({length:160},()=>{
      const c=starBaseColors[Math.floor(Math.random()*starBaseColors.length)];
      return {
        x:Math.random(), y:Math.random(),
        r:0.4+Math.random()*1.6,
        r2:c, // color components
        baseAlpha:0.4+Math.random()*0.6,
        speed:1.2+Math.random()*4,
        phase:Math.random()*Math.PI*2,
        twinkleType:Math.random()<0.5?0:1
      };
    });
    // Shooting stars data
    const shoots=Array.from({length:4},()=>({
      x:Math.random()*0.6, y:Math.random()*0.4,
      dur:8+Math.random()*14,
      phase:Math.random()*Math.PI*2
    }));
    let rafId;
    function resizeCvs(){
      cvs.width=ov.offsetWidth||window.innerWidth;
      cvs.height=ov.offsetHeight||window.innerHeight;
    }
    resizeCvs();
    const ro=new ResizeObserver(resizeCvs);
    ro.observe(ov);
    function drawStars(ts){
      const t=ts/1000;
      const w=cvs.width, h=cvs.height;
      const ctx=cvs.getContext('2d');
      ctx.clearRect(0,0,w,h);
      for(const s of stars){
        // twinkle: oscillate alpha
        const wave=s.twinkleType===0
          ? 0.5+0.5*Math.sin(t*((2*Math.PI)/s.speed)+s.phase)
          : 0.5+0.5*(Math.sin(t*((2*Math.PI)/s.speed)+s.phase)*Math.cos(t*1.3+s.phase));
        const alpha=Math.max(0.05, s.baseAlpha*(0.3+0.7*wave));
        const [cr,cg,cb]=s.r2;
        const px=s.x*w, py=s.y*h;
        ctx.beginPath();
        ctx.arc(px,py,s.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(${cr},${cg},${cb},${alpha.toFixed(2)})`;
        ctx.fill();
        // glow
        if(s.r>1){
          const grd=ctx.createRadialGradient(px,py,0,px,py,s.r*3);
          grd.addColorStop(0,`rgba(${cr},${cg},${cb},${(alpha*0.4).toFixed(2)})`);
          grd.addColorStop(1,'rgba(0,0,0,0)');
          ctx.beginPath();
          ctx.arc(px,py,s.r*3,0,Math.PI*2);
          ctx.fillStyle=grd;
          ctx.fill();
        }
      }
      // Shooting stars: trail from left-to-right diagonal
      for(const ss of shoots){
        const prog=((t/ss.dur)+ss.phase/(2*Math.PI))%1;
        const sx=(ss.x+prog*1.2)*w, sy=(ss.y+prog*0.5)*h;
        const len=60, angle=Math.PI/6;
        const ex=sx-Math.cos(angle)*len, ey=sy-Math.sin(angle)*len;
        const grd=ctx.createLinearGradient(ex,ey,sx,sy);
        grd.addColorStop(0,'rgba(255,255,255,0)');
        grd.addColorStop(1,'rgba(255,255,255,0.9)');
        ctx.beginPath();
        ctx.moveTo(ex,ey);
        ctx.lineTo(sx,sy);
        ctx.strokeStyle=grd;
        ctx.lineWidth=1.5;
        ctx.stroke();
      }
      rafId=requestAnimationFrame(drawStars);
    }
    rafId=requestAnimationFrame(drawStars);
    // Store cleanup on the overlay so _clearAnimBg can stop the loop
    ov._starsRaf=rafId;
    ov._starsCleanup=()=>{ cancelAnimationFrame(ov._starsRaf); ro.disconnect(); };
    return;
  }
  if(type==='leaves'){
    const leafEmoji=['🍁','🍂','🍃','🌿'];
    const leafAlts=['🍁','🍂','🍁','🍃','🍂','🌿'];
    for(let i=0;i<45;i++){
      const p=document.createElement('div');
      p.className='anim-particle';
      const sz=14+Math.random()*14;
      const emoji=leafAlts[i%leafAlts.length];
      const dur=(5+Math.random()*7).toFixed(2);
      const delay=(-Math.random()*8).toFixed(2);
      p.style.cssText=`width:${sz.toFixed(0)}px;height:${sz.toFixed(0)}px;border-radius:0;background:none;`+
        `left:${(Math.random()*100).toFixed(1)}%;top:-30px;`+
        `font-size:${sz.toFixed(0)}px;line-height:1;display:flex;align-items:center;justify-content:center;`+
        `animation:leafSway ${dur}s ${delay}s ease-in-out infinite;`+
        `filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));`;
      p.textContent=emoji;
      ov.appendChild(p);
    }
    return;
  }
  const cfg={
    snow:{n:55,color:'rgba(220,240,255,0.85)',w:'6px',h:'6px',br:'50%',anim:'snowFall',dur:[3,6],delay:[0,5]}
  }[type];
  if(!cfg) return;
  for(let i=0;i<cfg.n;i++){
    const p=document.createElement('div');
    p.className='anim-particle';
    const sz=3+Math.random()*7;
    p.style.cssText=`width:${sz}px;height:${sz}px;border-radius:${cfg.br};background:${cfg.color};`+
      `left:${Math.random()*100}%;top:-20px;`+
      `animation:${cfg.anim} ${(cfg.dur[0]+Math.random()*(cfg.dur[1]-cfg.dur[0])).toFixed(2)}s ${(-Math.random()*cfg.delay[1]).toFixed(2)}s linear infinite;`;
    ov.appendChild(p);
  }
}
function _initCssRain(ov){
  for(let i=0;i<70;i++){
    const p=document.createElement('div');
    p.className='anim-particle';
    p.style.cssText=`width:1.5px;height:${16+Math.random()*12}px;border-radius:1px;`+
      `background:rgba(130,180,255,${(0.3+Math.random()*0.4).toFixed(2)});`+
      `left:${(Math.random()*100).toFixed(1)}%;top:-20px;`+
      `animation:rainFall ${(0.5+Math.random()*0.9).toFixed(2)}s ${(-Math.random()*2).toFixed(2)}s linear infinite;`;
    ov.appendChild(p);
  }
}

function _applyBgToEl(el, name, customUrlOverride){
  const customUrl = customUrlOverride!==undefined ? customUrlOverride : localStorage.getItem('cc_bg_custom_url');
  if(!el) return;
  if(name==='none'){ el.classList.remove('bg-active'); el.style.background=''; el.style.backgroundImage=''; }
  else if(name==='custom'&&customUrl){ el.classList.add('bg-active'); el.style.backgroundImage=`url('${customUrl}')`; el.style.backgroundSize='cover'; el.style.backgroundPosition='center'; }
  else if(BG_PRESETS[name]){ el.classList.add('bg-active'); el.style.backgroundImage=''; el.style.background=BG_PRESETS[name]; }
  else if(ANIM_BG_TYPES.has(name)){
    el.classList.add('bg-active'); el.style.backgroundImage='';
    const bgMap={rain:'linear-gradient(180deg,#0d1b2a 0%,#1a2332 100%)',snow:'linear-gradient(180deg,#1a2535 0%,#2d3e50 100%)',stars:'linear-gradient(180deg,#050510 0%,#0a0a1e 50%,#050515 100%)',leaves:'linear-gradient(180deg,#0f2010 0%,#1a3520 100%)'};
    el.style.background=bgMap[name]||'';
  }
  else { el.classList.remove('bg-active'); el.style.background=''; el.style.backgroundImage=''; }
}

// `convoKey` is optional: omitted (or called from the global Settings >
// Chat Background picker), it sets the app-wide default background used
// by any chat that has no override of its own. Passed (from the
// per-chat wallpaper picker, see openChatWallpaperPicker()), it sets an
// override for just that one conversation, stored separately so it
// doesn't touch the global default.
function setChatBg(name,el,convoKey){
  const wrap=document.getElementById('chat-bg-wrapper');
  const dash=document.getElementById('main-empty');
  if(!wrap) return;
  if(convoKey) localStorage.setItem('cc_chat_bg_'+convoKey,name);
  else localStorage.setItem('cc_bg',name);
  document.querySelectorAll('.bg-option').forEach(o=>o.classList.remove('selected'));
  if(el) el.classList.add('selected');
  // Only re-render the live chat panel if this change actually affects
  // what's currently showing (the open chat, when setting its override;
  // always, when changing the global default and no override is active).
  if(!convoKey || (activeConvo&&activeConvo.key===convoKey)){
    clearAnimBg();
    _applyBgToEl(wrap, name);
    _applyBgToEl(dash, name);
    if(ANIM_BG_TYPES.has(name)) initAnimBg(name);
  }
}
const CHAT_BG_OPTIONS=[
  {name:'none',cls:'bg-opt-none',label:'None'},
  {name:'bubbles',cls:'bg-opt-bubbles',label:'✦ Bubbles'},
  {name:'aurora',cls:'bg-opt-aurora',label:'🌌 Aurora'},
  {name:'sunset',cls:'bg-opt-sunset',label:'🌅 Sunset'},
  {name:'textures',cls:'bg-opt-textures',label:'◈ Creative Textures'},
  {name:'abstract',cls:'bg-opt-abstract',label:'◆ Abstract'},
  {name:'pastel',cls:'bg-opt-pastel',label:'❀ Pastel Gradients'},
  {name:'rain',cls:'bg-opt-rain',label:'🌧 Rain'},
  {name:'snow',cls:'bg-opt-snow',label:'❄️ Snow'},
  {name:'stars',cls:'bg-opt-stars',label:'✨ Starfield'},
  {name:'leaves',cls:'bg-opt-leaves',label:'🍂 Falling Leaves'},
];
// Per-chat wallpaper picker, reached from the chat header's "..." menu.
// Shares setChatBg()/CHAT_BG_OPTIONS with the global Settings > Chat
// Background picker, just always passes activeConvo.key as the 3rd arg so
// the choice only affects this one conversation.
function openChatWallpaperPicker(){
  if(!activeConvo) return;
  const key=activeConvo.key;
  const current=localStorage.getItem('cc_chat_bg_'+key)||localStorage.getItem('cc_bg')||'none';
  const wrap=document.getElementById('chat-wallpaper-options');
  wrap.innerHTML=CHAT_BG_OPTIONS.map(o=>
    '<div class="bg-option '+o.cls+(o.name===current?' selected':'')+'" data-bg-name="'+esc(o.name)+'" data-convo-key="'+esc(key)+'" onclick="setChatBg(this.dataset.bgName,this,this.dataset.convoKey)">'+esc(o.label)+'</div>'
  ).join('');
  openModal('chat-wallpaper-modal');
}

// Resolves and applies the effective background for a given chat: its own
// per-chat override if it has one, else the app-wide default. Called
// whenever a chat opens (see _origOpenChat) and once at launch for the
// dashboard/empty state (no convoKey — global default only).
function loadChatBg(convoKey){
  const saved=(convoKey&&localStorage.getItem('cc_chat_bg_'+convoKey))||localStorage.getItem('cc_bg')||'none';
  const wrap=document.getElementById('chat-bg-wrapper');
  const dash=document.getElementById('main-empty');
  if(!wrap) return;
  clearAnimBg();
  _applyBgToEl(wrap, saved);
  _applyBgToEl(dash, saved);
  if(ANIM_BG_TYPES.has(saved)) initAnimBg(saved);
  document.querySelectorAll('.bg-option').forEach(o=>{
    const m=o.getAttribute('onclick')||'';
    const match=m.match(/'([^']+)'/);
    if(match) o.classList.toggle('selected',match[1]===saved);
    else if(o.id==='bg-opt-custom-btn') o.classList.toggle('selected',saved==='custom');
  });
}
function updateSettingsBgSelection(){
  const saved=localStorage.getItem('cc_bg')||'none';
  document.querySelectorAll('.bg-option').forEach(o=>{
    const m=o.getAttribute('onclick')||'';
    const match=m.match(/'([^']+)'/);
    if(match) o.classList.toggle('selected',match[1]===saved);
    else if(o.id==='bg-opt-custom-btn') o.classList.toggle('selected',saved==='custom');
  });
}

// Custom photo background
function pickCustomBgPhoto(el){
  document.getElementById('custom-bg-input').click();
}
async function applyCustomBgPhoto(input){
  const file=input.files&&input.files[0];
  input.value='';
  if(!file) return;
  const readAsDataUrl=()=>new Promise(res=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(file); });
  try{
    let url='';
    if(fbstorage&&me&&me.number){
      try{
        const ref=fbstorage.ref('bg_photos/'+me.number+'/custom_bg');
        await ref.put(file);
        url=await ref.getDownloadURL();
      }catch(storageErr){
        // Firebase Storage blocked or permission denied — fall back to local data URL
        url=await readAsDataUrl();
      }
    } else {
      url=await readAsDataUrl();
    }
    if(!url) return;
    localStorage.setItem('cc_bg_custom_url',url);
    setChatBg('custom', document.getElementById('bg-opt-custom-btn'));
    showToast('Background set','Your photo is now your chat background');
  }catch(e){
    showToast('Failed','Could not apply photo background: '+e.message);
  }
}

