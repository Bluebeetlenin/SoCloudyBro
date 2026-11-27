// -- NOTIFICATIONS -------------------------------------------------------------
function requestNotifPerm(){
  if('Notification' in window&&Notification.permission==='default')Notification.requestPermission();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(e=>console.warn('Service worker registration failed (notifications will still work while the tab is focused/visible):',e));
  }
}


function toggleDND(){
  const next = !dndEnabled;
  // Flip the persisted value BEFORE the in-memory flag (unlike the old
  // order) so a localStorage failure (quota, private-mode storage block)
  // aborts before dndEnabled changes — otherwise shouldSuppressNotifications()
  // reads the already-flipped live flag while the UI/toast never updated and
  // the change silently never persisted (reverts on reload).
  try{ localStorage.setItem('cc_dnd', next?'1':'0'); }
  catch(e){ showToast('Could not save',scbErr('SCB-SET-07','Your Do Not Disturb setting couldn\'t be saved on this device.')); return; }
  dndEnabled = next;
  updateDNDUI();
  showToast(dndEnabled ? 'Do Not Disturb is on' : 'Do Not Disturb is off', dndEnabled ? 'Notifications are silenced. Turn it off anytime.' : 'You\'ll get notifications as normal.');
}

function updateDNDUI(){
  const btn = document.getElementById('dnd-toggle-btn');
  const sub = document.getElementById('dnd-status-text');
  if(!btn||!sub) return;
  btn.checked = dndEnabled;
  sub.textContent = dndEnabled
    ? "On — notifications are silenced. You can turn this off anytime."
    : "Off — you'll get notifications as normal";
}

function saveQuietHours(){
  const enabled = document.getElementById('quiet-hours-enabled').checked;
  const start = document.getElementById('quiet-hours-start').value || '22:00';
  const end = document.getElementById('quiet-hours-end').value || '07:00';
  const next = {enabled, start, end};
  // Persist before updating the in-memory value (see toggleDND's comment) —
  // a quota/private-mode failure then leaves both the displayed settings and
  // isQuietHoursActive()'s actual behavior on the previous value, instead of
  // silently diverging.
  try{ localStorage.setItem('cc_quiet_hours', JSON.stringify(next)); }
  catch(e){ showToast('Could not save',scbErr('SCB-SET-08','Your quiet hours setting couldn\'t be saved on this device.')); return; }
  quietHours = next;
}

function updateQuietHoursUI(){
  const en = document.getElementById('quiet-hours-enabled');
  const st = document.getElementById('quiet-hours-start');
  const en2 = document.getElementById('quiet-hours-end');
  if(!en||!st||!en2) return;
  en.checked = !!quietHours.enabled;
  st.value = quietHours.start || '22:00';
  en2.value = quietHours.end || '07:00';
}

function isQuietHoursActive(){
  if(!quietHours || !quietHours.enabled) return false;
  const [sh,sm] = (quietHours.start||'22:00').split(':').map(Number);
  const [eh,em] = (quietHours.end||'07:00').split(':').map(Number);
  const now = new Date();
  const cur = now.getHours()*60 + now.getMinutes();
  const start = sh*60+sm, end = eh*60+em;
  if(start === end) return false;
  if(start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

function shouldSuppressNotifications(){
  return dndEnabled || isQuietHoursActive();
}

/* ===== SOUNDS: message tone + call ringtone =====
   Generated with WebAudio oscillators rather than shipping an audio file —
   this is a single self-contained HTML file with no asset pipeline, so a
   couple of short tones synthesized on the fly avoid adding a binary asset
   (and its hosting/CORS concerns) for what's really just a beep. ===== */
let _scbSoundCtx=null;
function _scbAudioCtx(){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) return null;
    if(!_scbSoundCtx) _scbSoundCtx=new AC();
    if(_scbSoundCtx.state==='suspended') _scbSoundCtx.resume().catch(()=>{});
    return _scbSoundCtx;
  }catch(e){ return null; }
}
// Autoplay policies block audio (WebAudio included) until a real user
// gesture — resume the (already-created-on-load) context on the first
// click/keypress so the very first ring/tone after page load isn't silently
// dropped while waiting for some later unrelated interaction.
document.addEventListener('pointerdown',()=>{ _scbAudioCtx(); },{once:true,capture:true});
document.addEventListener('keydown',()=>{ _scbAudioCtx(); },{once:true,capture:true});
function _scbTone(ctx,freq,startAt,dur,gainPeak){
  const osc=ctx.createOscillator(), gain=ctx.createGain();
  osc.type='sine'; osc.frequency.value=freq;
  osc.connect(gain); gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0,startAt);
  gain.gain.linearRampToValueAtTime(gainPeak,startAt+0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001,startAt+dur);
  osc.start(startAt); osc.stop(startAt+dur+0.03);
}
// Each sound is a little melody: a list of [freqHz, startOffsetSec, durationSec, gainPeak]
// notes played relative to "now" — _scbPlayPattern schedules them all at once.
const MESSAGE_SOUNDS={
  classic: {label:'Classic Ding', notes:[[880,0,0.09,0.16],[1318.5,0.08,0.15,0.13]]},
  chime:   {label:'Chime',        notes:[[659.25,0,0.12,0.14],[830.61,0.10,0.12,0.13],[1046.5,0.20,0.18,0.12]]},
  pop:     {label:'Pop',          notes:[[988,0,0.07,0.2]]},
  marimba: {label:'Marimba',      notes:[[392,0,0.16,0.13],[523.25,0.06,0.18,0.11]]},
  xylo:    {label:'Xylophone',    notes:[[523.25,0,0.07,0.15],[659.25,0.05,0.07,0.15],[783.99,0.10,0.07,0.15],[1046.5,0.15,0.12,0.13]]},
};
const CALL_RINGTONES={
  classic: {label:'Classic Ring', notes:[[523.25,0,0.16,0.17],[659.25,0.18,0.18,0.17],[523.25,0.42,0.16,0.17],[659.25,0.60,0.18,0.17]]},
  digital: {label:'Digital',      notes:[[1200,0,0.08,0.15],[1200,0.14,0.08,0.15],[1200,0.28,0.08,0.15]]},
  marimba: {label:'Marimba',      notes:[[349.23,0,0.2,0.14],[440,0.22,0.2,0.14],[349.23,0.44,0.2,0.14],[440,0.66,0.2,0.14]]},
  chimes:  {label:'Chimes',       notes:[[523.25,0,0.3,0.12],[659.25,0.15,0.3,0.11],[783.99,0.30,0.35,0.1]]},
};
const PING_SOUNDS={
  classic: {label:'Classic Buzz', notes:[[440,0,0.05,0.18],[440,0.08,0.05,0.18],[440,0.16,0.09,0.18]]},
  bell:    {label:'Bell',         notes:[[1567.98,0,0.22,0.15],[1975.53,0.04,0.26,0.11]]},
  knock:   {label:'Knock',        notes:[[220,0,0.05,0.22],[196,0.09,0.06,0.2]]},
  laser:   {label:'Laser',        notes:[[1800,0,0.05,0.14],[1200,0.03,0.05,0.14],[800,0.06,0.07,0.14]]},
  bloop:   {label:'Bloop',        notes:[[660,0,0.05,0.16],[990,0.05,0.09,0.16]]},
};
function _scbPlayPattern(ctx,notes){
  const t=ctx.currentTime;
  notes.forEach(([freq,offset,dur,peak])=>_scbTone(ctx,freq,t+offset,dur,peak));
}
function playMessageSound(){
  if(!getPrivacyPref('messageSound',true)||shouldSuppressNotifications()) return;
  const ctx=_scbAudioCtx(); if(!ctx) return;
  const id=getPrivacyPref('messageSoundId','classic');
  _scbPlayPattern(ctx,(MESSAGE_SOUNDS[id]||MESSAGE_SOUNDS.classic).notes);
}
function previewMessageSound(id){
  const ctx=_scbAudioCtx(); if(!ctx) return;
  const useId=id||document.getElementById('message-sound-select')?.value||getPrivacyPref('messageSoundId','classic');
  _scbPlayPattern(ctx,(MESSAGE_SOUNDS[useId]||MESSAGE_SOUNDS.classic).notes);
}
function saveMessageSoundChoice(id){ savePrivacyPref('messageSoundId',id); previewMessageSound(id); }
let _scbRingTimer=null;
function _scbRingBurst(){
  const ctx=_scbAudioCtx(); if(!ctx) return;
  const id=getPrivacyPref('callRingtoneId','classic');
  _scbPlayPattern(ctx,(CALL_RINGTONES[id]||CALL_RINGTONES.classic).notes);
}
function startCallRingtone(){
  stopCallRingtone();
  if(!getPrivacyPref('callRingtone',true)||shouldSuppressNotifications()) return;
  _scbRingBurst();
  _scbRingTimer=setInterval(_scbRingBurst,2600);
}
function stopCallRingtone(){
  if(_scbRingTimer){ clearInterval(_scbRingTimer); _scbRingTimer=null; }
}
function previewCallRingtone(id){
  const ctx=_scbAudioCtx(); if(!ctx) return;
  const useId=id||document.getElementById('call-ringtone-select')?.value||getPrivacyPref('callRingtoneId','classic');
  _scbPlayPattern(ctx,(CALL_RINGTONES[useId]||CALL_RINGTONES.classic).notes);
}
function saveCallRingtoneChoice(id){ savePrivacyPref('callRingtoneId',id); previewCallRingtone(id); }
function playPingSound(){
  if(!getPrivacyPref('pingSound',true)||shouldSuppressNotifications()) return;
  const ctx=_scbAudioCtx(); if(!ctx) return;
  const id=getPrivacyPref('pingSoundId','classic');
  _scbPlayPattern(ctx,(PING_SOUNDS[id]||PING_SOUNDS.classic).notes);
}
function previewPingSound(id){
  const ctx=_scbAudioCtx(); if(!ctx) return;
  const useId=id||document.getElementById('ping-sound-select')?.value||getPrivacyPref('pingSoundId','classic');
  _scbPlayPattern(ctx,(PING_SOUNDS[useId]||PING_SOUNDS.classic).notes);
}
function savePingSoundChoice(id){ savePrivacyPref('pingSoundId',id); previewPingSound(id); }
function _scbPopulateSoundSelects(){
  const msgSel=document.getElementById('message-sound-select');
  if(msgSel&&!msgSel.options.length){
    Object.entries(MESSAGE_SOUNDS).forEach(([id,s])=>{ const o=document.createElement('option'); o.value=id; o.textContent=s.label; msgSel.appendChild(o); });
  }
  if(msgSel) msgSel.value=getPrivacyPref('messageSoundId','classic');
  const callSel=document.getElementById('call-ringtone-select');
  if(callSel&&!callSel.options.length){
    Object.entries(CALL_RINGTONES).forEach(([id,s])=>{ const o=document.createElement('option'); o.value=id; o.textContent=s.label; callSel.appendChild(o); });
  }
  if(callSel) callSel.value=getPrivacyPref('callRingtoneId','classic');
  const pingSel=document.getElementById('ping-sound-select');
  if(pingSel&&!pingSel.options.length){
    Object.entries(PING_SOUNDS).forEach(([id,s])=>{ const o=document.createElement('option'); o.value=id; o.textContent=s.label; pingSel.appendChild(o); });
  }
  if(pingSel) pingSel.value=getPrivacyPref('pingSoundId','classic');
}

// Desktop notification, shown only while the tab is hidden. `convoKey` makes a
// click open that chat and lets newer messages replace the older notice.
function sendNotif(title,body,convoKey){
  if(shouldSuppressNotifications()) return;
  if(!('Notification' in window)||Notification.permission!=='granted'||!document.hidden) return;
  const icon='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="26" font-size="28">☁</text></svg>';
  const options={body,icon,data:{convoKey:convoKey||null}};
  if(convoKey){ options.tag='scb-'+convoKey; options.renotify=true; }
  const direct=()=>{
    try{
      const n=new Notification(title,options);
      n.onclick=()=>{ window.focus(); n.close(); if(convoKey) dashOpenChat(convoKey); };
    }catch(e){ console.warn('Notification failed',e); }
  };
  if('serviceWorker' in navigator && navigator.serviceWorker.controller){
    navigator.serviceWorker.ready.then(reg=>reg.showNotification(title,options)).catch(direct);
  }else{
    direct();
  }
}
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message',e=>{
    if(e.data&&e.data.type==='open-chat'&&e.data.convoKey) dashOpenChat(e.data.convoKey);
  });
}

// -- VOICE-TO-TEXT COMPOSING ---------------------------------------------------
let voiceRecognition = null;
let voiceListening = false;
const SpeechRecAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

function initVoiceInput(){
  const btn = document.getElementById('mic-btn');
  if(!btn) return;
  if(!SpeechRecAPI){ btn.style.display='none'; return; }
  btn.style.display='';
}

function toggleVoiceInput(){
  if(!SpeechRecAPI){ showToast('Not supported', scbErr('SCB-SET-05','Voice input is not supported in this browser.')); return; }
  if(voiceListening){ stopVoiceInput(); return; }
  startVoiceInput();
}

function startVoiceInput(){
  const input = document.getElementById('msg-input');
  const btn = document.getElementById('mic-btn');
  voiceRecognition = new SpeechRecAPI();
  voiceRecognition.continuous = true;
  voiceRecognition.interimResults = true;
  voiceRecognition.lang = navigator.language || 'en-US';
  const baseText = input.value ? input.value.replace(/\s+$/,'') + ' ' : '';
  voiceRecognition.onresult = (e)=>{
    let finalText='', interimText='';
    for(let i=0;i<e.results.length;i++){
      const txt = e.results[i][0].transcript;
      if(e.results[i].isFinal) finalText += txt + ' ';
      else interimText += txt;
    }
    input.value = (baseText + finalText + interimText).trimStart();
    autoResize(input);
  };
  voiceRecognition.onerror = ()=>{ stopVoiceInput(); };
  voiceRecognition.onend = ()=>{
    if(voiceListening){ try{ voiceRecognition.start(); }catch(e){ stopVoiceInput(); } }
  };
  try{
    voiceRecognition.start();
    voiceListening = true;
    btn.classList.add('recording');
    btn.style.color = 'var(--danger, #e74c3c)';
    btn.title = 'Stop voice input';
  }catch(e){
    showToast('Microphone error', scbErr('SCB-SET-06','Could not start voice input. Check microphone permissions.'));
  }
}

function stopVoiceInput(){
  voiceListening = false;
  const btn = document.getElementById('mic-btn');
  if(btn){ btn.classList.remove('recording'); btn.style.color=''; btn.title='Voice to text'; }
  if(voiceRecognition){
    try{ voiceRecognition.onend = null; voiceRecognition.stop(); }catch(e){}
    voiceRecognition = null;
  }
}

// -- AUTO-SYNC CONTACTS FROM CONVOS --------------------------------------------
// When someone messages you or adds you to a group, you have no local contact
// entry for them. This runs after every poll and injects missing entries.
function syncContactsFromConvos(){
  if(!convosCache||!me) return;
  let changed=false;
  convosCache.forEach(c=>{
    const participants=c.participants||c.members||[];
    const isParticipant=participants.some(p=>Number(p)===Number(me.number));
    const isDm=c.key&&c.key.startsWith('dm_');
    const isGroup=c.type==='group'||(c.key&&c.key.startsWith('grp_'));
    // BUG FIX: this used to read `if(!isParticipant&&!isDm) return;` — since isDm
    // is true for every DM conversation regardless of who's actually in it, that
    // condition never skipped a single DM, meaning every user's contact list was
    // silently pulling in every DM conversation that exists anywhere in the whole
    // app (the full conversations table is fetched by every client) and
    // misattributing a random participant as if they were the user's own contact
    // — including the real, shared conversation key, so opening it showed a
    // stranger's actual private messages. This is almost certainly the "random
    // users and messages from another chat" issue. The fix: skip anything the
    // user isn't actually a participant in, full stop — isDm/isGroup below only
    // determine HOW to process a conversation the user legitimately belongs to,
    // never WHETHER to process it.
    if(!isParticipant) return;
    // Never re-add a contact the user explicitly removed
    if(removedContacts[c.key]) return;
    if(isDm){
      // Your own notes: restore the chat on a new device.
      if(c.key==='dm_'+me.number+'_'+me.number){
        if((c.messages||[]).length&&!contacts.some(x=>x&&x.key===c.key)){ ensureSelfContact(); changed=true; }
        return;
      }
      const parts=c.key.replace('dm_','').split('_');
      const otherNum=parseInt(parts.find(p=>parseInt(p)!==Number(me.number)));
      if(!otherNum||isNaN(otherNum)) return;
      const dmKey='dm_'+[me.number,otherNum].sort((a,b)=>a-b).join('_');
      if(removedContacts[dmKey]) return;
      const alreadyHave=contacts.find(x=>x.type!=='group'&&x.number===otherNum);
      if(!alreadyHave){
        const u=lookupUser(otherNum);
        if(!u) return; // skip contacts for users who don't exist in the user list
        // Someone reached out first: hold it as a message request.
        contacts.push({type:'dm',number:otherNum,name:dec(u.name)||'#'+otherNum,bio:dec(u.bio||''),avatar:u.avatar||'',key:c.key,
          request:(!isTrustedNumber(otherNum)&&!hasSentTo(c.key))||undefined});
        changed=true;
      }else{
        if(alreadyHave.request&&hasSentTo(alreadyHave.key)){ delete alreadyHave.request; acceptedRequests[alreadyHave.key]=true; changed=true; }
        // Refresh avatar and name from live usersCache for existing DM contacts
        const u=lookupUser(otherNum);
        if(u){
          if(u.avatar&&alreadyHave.avatar!==u.avatar){alreadyHave.avatar=u.avatar;changed=true;}
          const freshName=dec(u.name)||'#'+otherNum;
          if(freshName&&alreadyHave.name!==freshName){alreadyHave.name=freshName;changed=true;}
        }
      }
    } else if(isGroup&&isParticipant){
      if(removedContacts[c.key]) return;
      const alreadyHave=contacts.find(x=>x&&x.key===c.key);
      if(!alreadyHave){
        contacts.push({type:'group',key:c.key,name:c.name||'Group',info:c.info||'',avatar:c.avatar||'',members:c.participants||c.members||[]});
        changed=true;
      }else{
        // Creating the contact entry once was the only sync that ever happened,
        // so a group rename/description change made by an admin never reached
        // anyone who already had the group in their list. Refresh the cached
        // copy when the shared record differs.
        // Only when the shared record actually carries a value — a legacy group
        // record missing `name` must not blank out a good local one.
        if(typeof c.name==='string' && c.name && alreadyHave.name!==c.name){ alreadyHave.name=c.name; changed=true; }
        if(typeof c.info==='string' && (alreadyHave.info||'')!==c.info){ alreadyHave.info=c.info; changed=true; }
        // Members were only ever set once, at first sync — a member added,
        // approved (Servers), or removed afterward never reached anyone
        // besides whoever performed the action in their own session, so
        // @mentions and member lists silently went stale for everyone else.
        const freshMembers=c.participants||c.members||[];
        const oldMembers=alreadyHave.members||[];
        if(freshMembers.length!==oldMembers.length||freshMembers.some(n=>!oldMembers.includes(n))){
          alreadyHave.members=freshMembers.slice();
          changed=true;
        }
      }
    }
  });
  if(changed){saveStorage();renderSidebar();}
}

// -- NEW MESSAGE ALERTS --------------------------------------------------------
// Checks every chat on each poll, not only the open one.
const _lastAlerted=new Map();
const _alertsSince=Date.now();
function checkIncomingMessages(){
  if(!me||!convosCache) return;
  contacts.forEach(function(contact){
    const convo=convosCache.find(x=>x&&x.key===contact.key);
    const last=convo&&convo.messages&&convo.messages[convo.messages.length-1];
    if(!last) return;
    const seenUpTo=_lastAlerted.has(contact.key)?_lastAlerted.get(contact.key):_alertsSince;
    if(!(last.time>seenUpTo)) return;
    _lastAlerted.set(contact.key,last.time);
    if(last.from===me.number||last.type==='system'||last.type==='call') return;
    alertForMessage(contact,last);
  });
}
function alertForMessage(contact,last){
  const level=mutedChats[contact.key]; // undefined=all, 'mentions', 'muted'/true=silent
  if(level==='muted'||level===true) return;
  if(contact.type!=='group'&&isBlockedEitherWay(contact.number)) return;
  if(isRequest(contact)){ announceRequest(contact); return; }
  const isOpen=!!activeConvo&&activeConvo.key===contact.key;
  if(last.type==='ping'){ handleIncomingPing(last.from,isOpen); return; }

  const sender=dec((lookupUser(last.from)||{}).name)||'Someone';
  const text=msgText(last);
  const mentioned=!!(last.mentions&&last.mentions.includes(me.number));
  const everyone=!!last.mentions&&/@(everyone|all)\b/i.test(text);
  if(everyone&&!mentioned&&getPrivacyPref('suppressEveryone',false)) return;
  if(level==='mentions'&&!mentioned&&!everyone) return;

  playMessageSound();
  if(isOpen&&!document.hidden) return;

  let title=everyone?sender+' mentioned @everyone':mentioned?sender+' mentioned you':sender;
  if(contact.type==='group') title+=' · '+(contact.name||'Group');
  let body=msgHasGif(last)?'Sent a GIF':msgHasPoll(last)?'Sent a poll':msgFileData(last)?'Sent an attachment':String(text||'').slice(0,120);
  // A locked chat never shows who wrote or what they wrote.
  if(lockedChats[contact.key]){ title='Locked chat'; body='New message'; }
  sendNotif(title,body,contact.key);
  if(!document.hidden&&!shouldSuppressNotifications()){
    _pushToast(title,body,{kind:'message',duration:6000,onClick:function(){ dashOpenChat(contact.key); }});
  }
}

// -- POLL ----------------------------------------------------------------------
function startPoll(){
  if(pollTimer) clearInterval(pollTimer);
  pollTimer=setInterval(async()=>{
    try{
      await getUsers();
      await getConvos();
      syncContactsFromConvos();
      checkReminders();
      renderSidebar();
      checkBirthdaysToday();
      checkIncomingMessages();
      setConnectionStatus(true);
      if(activeConvo){
        const c=convosCache.find(x=>x&&x.key===activeConvo.key);
        if(c){
          const prev=lastMsgHash;
          const newHash=JSON.stringify(c.messages);
          if(newHash!==prev){
            lastMsgHash=newHash;
          }
          renderMessages(c.messages);
          maybeRunBizBot(c);
          if(!showTypingIndicator(c)&&activeConvo.type!=='group') updateOnlineStatus(activeConvo.number);
          renderCrossChannelTyping(c);
          // Save seen — only write to Firebase when something actually changed
          if(_convosDirty) await saveConvos();
        }
      }
    }catch(e){
      // BUG FIX: this was a bare `catch{}` — if Firebase rejected any of the calls
      // above (e.g. permission-denied because the database rules haven't been
      // published, or expired again — a real, recurring issue in this project),
      // every single poll tick would silently do nothing: no error, no message,
      // no visible sign anything was wrong. That's a plausible explanation for
      // "messages don't arrive" with no other symptom. Now it's surfaced instead
      // of swallowed.
      console.error('Poll failed:',e);
      setConnectionStatus(false,e);
    }
  },POLL_MS);
}
let _connectionIssueShown=false;
function setConnectionStatus(ok,err){
  if(ok){
    if(_connectionIssueShown){ _connectionIssueShown=false; hideConnectionBanner(); }
    return;
  }
  if(_connectionIssueShown) return; // don't spam a new toast every 25s while it's still down
  _connectionIssueShown=true;
  const denied=err&&err.code==='PERMISSION_DENIED';
  showConnectionBanner(denied
    ? scbErr('SCB-SYS-01','Can\'t reach messages — Firebase is rejecting requests (check your database rules are published).')
    : scbErr('SCB-SYS-02','Connection issue — messages may be delayed until this clears up.'));
}
function showConnectionBanner(text){
  const banner=_bannerRow('conn-issue-banner');
  banner.style.background='var(--danger)';
  banner.innerHTML='<span class="tbr-text">⚠ '+esc(text)+'</span>';
  _updateBannerStackHeight();
}
function hideConnectionBanner(){ _removeBannerRow('conn-issue-banner'); }
function startHB(){if(hbTimer)clearInterval(hbTimer);hbTimer=setInterval(heartbeat,HB_MS);heartbeat();}

// -- UTILS ---------------------------------------------------------------------
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function fmtTime(ts){
  if(!ts) return '';
  const d=new Date(ts),now=new Date();
  if(d.toDateString()===now.toDateString()) return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString([],{month:'short',day:'numeric'});
}
var _modalZBase=600,_modalZStack=[];
function openModal(id){
  const el=document.getElementById(id);if(!el)return;
  hideHeaderMenu();hideCtxMenu();
  // Re-opening a modal that is already open moves it to the top of the stack
  // instead of leaving a duplicate entry; keep the original opener so focus
  // returns to the real trigger on close.
  const prev=_modalZStack.find(function(e){return e.id===id;});
  const opener=prev?prev.opener:document.activeElement;
  _modalZStack=_modalZStack.filter(function(e){return e.id!==id;});
  el.style.display='';el.classList.add('visible');
  // Always one step above the current top so stacked modals can never tie.
  var z=(_modalZStack.length?_modalZStack[_modalZStack.length-1].z:_modalZBase)+10;
  el.style.zIndex=z;
  _modalZStack.push({id:id,z:z,opener:opener});
  // Move keyboard focus into the dialog (unless code already focused
  // something inside it) so Tab/Esc act on the modal, not the page behind.
  if(!el.contains(document.activeElement)){
    const box=el.querySelector('.modal')||el;
    if(!box.hasAttribute('tabindex')) box.setAttribute('tabindex','-1');
    try{ box.focus({preventScroll:true}); }catch(e){}
  }
}
function showPrivacyPolicy(){openModal('privacy-modal');}
function showTermsOfService(){openModal('tos-modal');}

/* ===== CONTACT US ===== */
const _SCB_ADMINS = [
  { priority: 1, role: 'Head Admin', name: 'SoCloudyBro Admin', number: 2015, email: '' },
  { priority: 2, role: 'Support Admin', name: 'SCB Support', number: null, email: 'syntaxgroupscb@gmail.com' },
];
function openContactUs(){
  const list = document.getElementById('contact-us-list');
  if(list){
    list.innerHTML = _SCB_ADMINS.map(a=>`
      <div style="background:var(--surface2,rgba(127,127,127,.07));border:1px solid var(--border);border-radius:var(--r-sm,10px);padding:12px 14px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;background:var(--accent);color:#fff;border-radius:20px">P${a.priority} · ${esc(a.role)}</span>
        </div>
        <div style="font-weight:600;font-size:14px;margin-bottom:4px">${esc(a.name)}</div>
        ${a.email ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <span style="font-size:12px;color:var(--text2)">${esc(a.email)}</span>
          <button class="btn btn-ghost btn-sm" style="padding:2px 7px;font-size:11px" data-email="${esc(a.email)}" data-act="copyEmail">Copy</button>
          <a class="btn btn-ghost btn-sm" style="padding:2px 7px;font-size:11px;text-decoration:none" href="mailto:${esc(a.email)}">Open</a>
        </div>` : ''}
        ${a.number ? `<button class="btn btn-sm" style="font-size:12px;padding:4px 12px" data-number="${a.number}" onclick="closeModal('contact-us-modal');_openDmWithAdmin(Number(this.dataset.number))">💬 Message #${a.number}</button>` : ''}
      </div>
    `).join('');
  }
  openModal('contact-us-modal');
}
function openSecurityDisclosure(){
  openModal('security-disclosure-modal');
}
function _openDmWithAdmin(num){
  if(!me){ showToast('Sign in required','You need to be signed in to send a message.'); return; }
  if(num===me.number){ showToast('That\'s you','You can\'t message yourself.'); return; }
  const existing = contacts.find(c=>c.number===num&&c.type!=='group');
  if(existing){ openChat(existing); return; }
  const u = usersCache && usersCache.find(x=>x.number===num);
  const c = { type:'dm', number:num, name:(u&&u.name?dec(u.name):'Admin #'+num), avatar:(u&&u.avatar)||'', key:'dm_'+[me.number,num].sort((a,b)=>a-b).join('_') };
  contacts.push(c); saveStorage(); openChat(c);
}
function closeModal(id){
  const el=document.getElementById(id);if(!el)return;
  const entry=_modalZStack.find(function(e){return e.id===id;});
  el.classList.remove('visible');el.style.zIndex='';
  _modalZStack=_modalZStack.filter(function(e){return e.id!==id;});
  // Give focus back to whatever opened the modal, but only if focus was
  // inside it (or lost) — never steal it from something the user moved to.
  const ae=document.activeElement;
  if(entry&&entry.opener&&entry.opener!==document.body&&document.contains(entry.opener)&&entry.opener.offsetParent!==null&&(ae===document.body||el.contains(ae))){
    try{ entry.opener.focus({preventScroll:true}); }catch(e){}
  }
}
function renderContacts(){renderSidebar();}
// -- IN-APP NOTIFICATIONS ------------------------------------------------------
// Cards stack in #toast, newest at the bottom. Hovering or focusing a card
// keeps it open.
const TOAST_LIMIT=4;
function _toastKind(title,body){
  const s=(title+' '+body).toLowerCase();
  if(/scb-[a-z]+-\d+|failed|could not|couldn.t|error|denied|not supported/.test(s)) return 'error';
  if(/saved|sent|copied|added|created|updated|pinged/.test(s)) return 'success';
  return 'info';
}
function _pushToast(title,body,opts){
  const o=opts||{};
  const stack=document.getElementById('toast');
  if(!stack) return;
  const heading=String(title==null?'':title);
  const text=String(body==null?'':body);
  const key=heading+'|'+text;
  Array.from(stack.children).forEach(function(c){ if(c.dataset.key===key) c.remove(); });

  const card=document.createElement('div');
  card.className='toast-card toast-'+(o.kind||_toastKind(heading,text));
  card.dataset.key=key;
  const main=document.createElement(o.onClick?'button':'div');
  main.className='toast-main';
  const h=document.createElement('span'); h.className='toast-title'; h.textContent=heading;
  const b=document.createElement('span'); b.className='toast-body'; b.textContent=text;
  main.append(h,b);
  if(o.onClick){ main.type='button'; main.onclick=function(){ card.remove(); o.onClick(); }; }
  card.appendChild(main);
  if(o.action){
    const act=document.createElement('button');
    act.type='button'; act.className='toast-action'; act.textContent=o.action.label;
    act.onclick=function(){ card.remove(); o.action.run(); };
    card.appendChild(act);
  }
  const close=document.createElement('button');
  close.type='button'; close.className='toast-close'; close.textContent='✕';
  close.setAttribute('aria-label','Dismiss notification');
  close.onclick=function(){ card.remove(); };
  card.appendChild(close);
  stack.appendChild(card);
  while(stack.children.length>TOAST_LIMIT) stack.firstElementChild.remove();

  // Longer messages stay up longer.
  const ms=o.duration||Math.min(9000,Math.max(3500,key.length*60));
  let timer=null;
  const hold=function(){ clearTimeout(timer); };
  const arm=function(){ clearTimeout(timer); timer=setTimeout(function(){ card.remove(); },ms); };
  card.addEventListener('mouseenter',hold);
  card.addEventListener('mouseleave',arm);
  card.addEventListener('focusin',hold);
  card.addEventListener('focusout',arm);
  arm();
}
function showToast(title,body){ _pushToast(title,body); }

function showUndoSendToast(originalText, msg, convo) {
  _pushToast('Message sent', originalText.length > 40 ? originalText.slice(0,40)+'…' : originalText, {
    kind: 'success',
    duration: 4000,
    action: { label: 'Edit message', run: () => {
      // Put text back in input for re-send
      const input = document.getElementById('msg-input');
      if (input) { input.value = originalText; autoResize(input); input.focus(); }
      // Remove the sent message from local cache
      const idx = convo.messages.indexOf(msg);
      if (idx !== -1) convo.messages.splice(idx, 1);
      lastMsgHash = ''; renderMessages(convo.messages);
    } }
  });
}

