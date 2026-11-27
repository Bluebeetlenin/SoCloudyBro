// Note to self: a private chat with your own number, synced like any other chat
// and encrypted with a key only your account holds.

function isSelfKey(key){ return !!(me && key===dmKey(me.number,me.number)); }

async function getSelfAesKey(){
  const pair=await ensureE2EKeypair();
  return pair ? _deriveAesFromPub(pair.publicKey) : null;
}
function ensureSelfContact(){
  const key=dmKey(me.number,me.number);
  let c=contacts.find(x=>x&&x.key===key);
  if(!c){
    c={type:'dm',number:me.number,name:'Note to self',key,isSelf:true,avatar:''};
    contacts.push(c);
  }
  return c;
}
function openNoteToSelf(){
  if(!me){ showToast('Set up first','Finish setting up your account first.'); return; }
  delete removedContacts[dmKey(me.number,me.number)];
  const c=ensureSelfContact();
  saveStorage();
  closeModal('add-modal');
  currentTab='chats';
  renderSidebar();
  openChat(c);
}
// Hides everything that only makes sense with another person.
function updateSelfChat(){
  const panel=document.getElementById('chat-panel');
  const self=!!(activeConvo && isSelfKey(activeConvo.key));
  if(panel) panel.classList.toggle('is-self',self);
  if(!self) return;
  const name=document.getElementById('chat-header-name');
  if(name){ name.textContent='Note to self'; name.onclick=null; }
  const avatar=document.getElementById('chat-header-av');
  if(avatar){ avatar.onclick=null; avatar.onmouseenter=null; avatar.textContent='📝'; }
  const sub=document.getElementById('chat-header-sub');
  if(sub){ sub.textContent='Only you can read these'; sub.className=''; }
}

(function(){
  const button=document.getElementById('note-to-self-btn');
  if(button) button.onclick=openNoteToSelf;
  const openChatBefore=openChat;
  openChat=async function(c){
    const r=await openChatBefore(c);
    updateSelfChat();
    return r;
  };
  const statusBefore=updateOnlineStatus;
  updateOnlineStatus=function(num){
    if(activeConvo&&isSelfKey(activeConvo.key)){ updateSelfChat(); return; }
    return statusBefore(num);
  };
  const callBefore=startDirectCall;
  startDirectCall=function(contact){
    if(contact&&me&&Number(contact.number)===Number(me.number)) return;
    return callBefore(contact);
  };
})();
