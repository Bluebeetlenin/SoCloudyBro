// Sidebar search: filters the chat list by name and searches the messages in
// your own chats.

const SEARCH_LIMIT=50;
let _searchSeq=0, _searchTimer=null;

function onSearchInput(q){
  searchQ=q;
  const seq=++_searchSeq;
  clearTimeout(_searchTimer);
  renderSidebar();
  const wrap=document.getElementById('search-results');
  if(!q||q.trim().length<2){ wrap.style.display='none'; wrap.innerHTML=''; return; }
  _searchTimer=setTimeout(()=>runMessageSearch(q.trim(),seq),200);
}

// Only chats you belong to. The local cache also holds other people's
// conversations, which must never show up in your results. Locked chats and
// message requests stay out too.
function searchableConvos(){
  if(!convosCache||!me) return [];
  const found=[];
  knownContacts().forEach(contact=>{
    const key=contact.key||(contact.number?dmKey(me.number,contact.number):null);
    if(!key||lockedChats[key]) return;
    const convo=convoByKey(key);
    if(!convo) return;
    const isGroup=contact.type==='group'||key.startsWith('grp_');
    if(!isConvoMemberOf(convo,isGroup)) return;
    found.push({contact,convo,isGroup});
  });
  return found;
}
function searchableMessages(convo){
  let list=(convo.messages||[]).filter(Boolean);
  list=_applyDisappearingFilter(list,convo.disappearAfter||0);
  return list.filter(m=>m.type!=='system'&&m.type!=='call'&&m.type!=='ping'
    &&!m.selfDestruct
    &&(m.from===me.number||(!m.shadowMuted&&!m.quarantined)));
}
function searchableText(m){
  if(_decCache[m.id]&&_decCache[m.id].textFailed) return '';
  const poll=msgPollData(m);
  if(poll) return [poll.question].concat((poll.options||[]).map(o=>o&&o.text)).filter(Boolean).join(' · ');
  const file=msgFileData(m);
  if(file) return file.name||'';
  const event=msgEventData(m);
  if(event) return ['📅',event.title,event.place].filter(Boolean).join(' ');
  return msgText(m)||'';
}

async function runMessageSearch(q,seq){
  const needle=q.toLowerCase();
  const results=[];
  for(const {contact,convo,isGroup} of searchableConvos()){
    try{ await decryptConvoMessages(convo); }
    catch(e){ console.warn('search: could not decrypt a chat',e); }
    if(seq!==_searchSeq) return; // the query changed while decrypting
    searchableMessages(convo).forEach(m=>{
      const text=searchableText(m);
      if(text.toLowerCase().includes(needle)) results.push({contact,convo,isGroup,m,text});
    });
  }
  results.sort((a,b)=>b.m.time-a.m.time);
  renderSearchResults(results,q);
}

// Builds the snippet from text nodes, so message content is never read as HTML.
function highlightedSnippet(text,q){
  const box=document.createElement('div');
  box.className='search-result-text';
  const lower=text.toLowerCase(), needle=q.toLowerCase();
  const first=lower.indexOf(needle);
  let from=Math.max(0,first-30);
  const to=Math.min(text.length,from+110);
  if(from>0) box.appendChild(document.createTextNode('…'));
  let at=lower.indexOf(needle,from);
  while(at!==-1&&at<to){
    box.appendChild(document.createTextNode(text.slice(from,at)));
    const mark=document.createElement('mark');
    mark.textContent=text.slice(at,at+needle.length);
    box.appendChild(mark);
    from=at+needle.length;
    at=lower.indexOf(needle,from);
  }
  if(from<to) box.appendChild(document.createTextNode(text.slice(from,to)));
  if(to<text.length) box.appendChild(document.createTextNode('…'));
  return box;
}
function renderSearchResults(results,q){
  const wrap=document.getElementById('search-results');
  wrap.innerHTML='';
  wrap.style.display='block';
  const label=document.createElement('div');
  label.className='search-result-count';
  label.textContent=!results.length?'No messages found'
    : results.length>SEARCH_LIMIT?'Newest '+SEARCH_LIMIT+' of '+results.length+' messages'
    : results.length+(results.length===1?' message':' messages');
  wrap.appendChild(label);
  results.slice(0,SEARCH_LIMIT).forEach(r=>{
    const item=document.createElement('div');
    item.className='search-result-item';
    item.tabIndex=0; item.setAttribute('role','button');
    const head=document.createElement('div'); head.className='search-result-chat';
    const sender=r.m.from===me.number?'You':(dec((lookupUser(r.m.from)||{}).name)||('#'+r.m.from));
    const chat=dec(r.contact.name)||r.contact.name||'Chat';
    head.textContent=r.isGroup?chat+' · '+sender:(r.m.from===me.number?chat+' · You':chat);
    const time=document.createElement('span'); time.className='search-result-time'; time.textContent=fmtTime(r.m.time);
    head.appendChild(time);
    item.appendChild(head);
    item.appendChild(highlightedSnippet(r.text,q));
    const open=()=>openSearchResult(r);
    item.onclick=open;
    item.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } };
    wrap.appendChild(item);
  });
}
async function openSearchResult(r){
  _searchSeq++;
  searchQ='';
  const wrap=document.getElementById('search-results');
  wrap.style.display='none'; wrap.innerHTML='';
  document.getElementById('sb-search-input').value='';
  renderSidebar();
  await openChat(r.contact);
  if(!activeConvo||activeConvo.key!==r.convo.key) return; // locked or restricted
  if(r.isGroup&&r.m.channelId&&r.m.channelId!==activeChannelId&&typeof switchChannel==='function'){
    switchChannel(r.m.channelId);
  }
  // A thread reply lives under its parent message.
  scrollToMessage(r.m.threadOf||r.m.id);
}
function scrollToMessage(msgId){
  setTimeout(()=>{
    const wrap=document.getElementById('messages-wrap');
    const rows=wrap.querySelectorAll('.msg-row');
    rows.forEach(row=>{if(row.dataset.msgId===msgId){row.scrollIntoView({behavior:'smooth',block:'center'});row.style.background='rgba(107,93,232,0.2)';setTimeout(()=>{row.style.background='';},1500);}});
  },400);
}
