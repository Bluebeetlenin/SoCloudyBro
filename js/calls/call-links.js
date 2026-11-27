// Shareable call links. The meeting code travels after the # sign, so it is
// never sent to the web server. Opening a link always asks before the camera or
// microphone turn on.

const CALL_CODE_RX=/^[A-Z0-9-]{4,24}$/;
const PENDING_CALL_KEY='scb_pending_call';

function meetingLink(code){ return location.origin+'/#call='+code; }

function callCodeFromHash(hash){
  const m=/^#call=([A-Za-z0-9-]+)$/.exec(hash||'');
  const code=m?m[1].toUpperCase():'';
  return CALL_CODE_RX.test(code)?code:'';
}
async function shareCallLink(code){
  const link=meetingLink(code);
  if(navigator.share&&window.matchMedia('(pointer:coarse)').matches){
    try{ await navigator.share({title:'SoCloudyBro call',url:link}); return; }
    catch(e){ if(e&&e.name==='AbortError') return; }
  }
  try{
    // A call link is meant to be pasted later, so skip the 60-second clipboard wipe.
    if(_origClipboardWrite){ clearTimeout(_clipboardClearTimer); await _origClipboardWrite(link); }
    else await navigator.clipboard.writeText(link);
    showToast('Link copied','Anyone signed in to SoCloudyBro with this link can join the call.');
  }catch(e){
    prompt('Copy this call link:',link);
  }
}
function createCallLink(){
  if(blockIfRestricted('noVoice','Meetings are turned off for your account.')) return;
  const code=newMeetingId();
  const field=document.getElementById('scb-meeting-code');
  if(field) field.value=code;
  return shareCallLink(code);
}

// -- OPENING A LINK -----------------------------------------------------------
function rememberPendingCall(){
  const code=callCodeFromHash(location.hash);
  if(!code) return false;
  try{ sessionStorage.setItem(PENDING_CALL_KEY,code); }catch(e){}
  history.replaceState(null,'',location.pathname+location.search);
  return true;
}
function offerPendingCall(){
  let code='';
  try{ code=sessionStorage.getItem(PENDING_CALL_KEY)||''; }catch(e){}
  if(!CALL_CODE_RX.test(code)) return;
  if(!me){ showToast('Call link','Sign in to join this call.'); return; }
  // Keep the link waiting while an approval, email or PIN screen is in the way.
  const blocked=['parental-pending-screen','email-verify-gate','lock-screen'].some(id=>{
    const el=document.getElementById(id);
    return el&&getComputedStyle(el).display!=='none';
  });
  if(blocked) return;
  try{ sessionStorage.removeItem(PENDING_CALL_KEY); }catch(e){}
  showJoinCallPrompt(code);
}
function showJoinCallPrompt(code){
  if(blockIfRestricted('noVoice','Meetings are turned off for your account.')) return;
  let modal=document.getElementById('join-call-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.className='overlay'; modal.id='join-call-modal';
    modal.innerHTML='<div class="modal"><div class="modal-header"><h2>Join this call?</h2><p></p></div>'
      +'<div class="modal-footer"><button type="button" class="btn" id="join-call-yes">Join call</button>'
      +'<button type="button" class="btn btn-ghost" id="join-call-no">Not now</button></div></div>';
    document.body.appendChild(modal);
  }
  modal.querySelector('p').textContent='Meeting code '+code+'. Your microphone and camera turn on when you join. Only join links from people you trust.';
  modal.querySelector('#join-call-yes').onclick=()=>{ closeModal('join-call-modal'); joinMeeting(code); };
  modal.querySelector('#join-call-no').onclick=()=>closeModal('join-call-modal');
  openModal('join-call-modal');
}

(function(){
  rememberPendingCall();
  window.addEventListener('hashchange',()=>{ if(rememberPendingCall()) offerPendingCall(); });
  // A call link tapped inside a chat opens here instead of in a new tab.
  document.addEventListener('click',e=>{
    const a=e.target.closest&&e.target.closest('a[href]');
    if(!a) return;
    let url;
    try{ url=new URL(a.href,location.href); }catch(err){ return; }
    const code=url.origin===location.origin?callCodeFromHash(url.hash):'';
    if(!code) return;
    e.preventDefault(); e.stopPropagation();
    if(!me) return;
    showJoinCallPrompt(code);
  },true);
  const launchBefore=launch;
  launch=async function(){
    const r=await launchBefore.apply(this,arguments);
    offerPendingCall();
    return r;
  };
})();
