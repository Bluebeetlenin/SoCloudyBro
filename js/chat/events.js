// Group events: a message with a title, time and place that members answer
// Going, Maybe or Can't. Details are encrypted like other group messages.
// Answers are stored as plain member numbers, the same way poll votes are.

const EVENT_ANSWERS=[['going','Going'],['maybe','Maybe'],['no','Can\'t']];
const EVENT_OVER_AFTER_MS=3*60*60*1000;

function msgEventData(m){
  if(!m||(!m.evt&&!m.cevt)) return null;
  const cached=_decCache[m.id];
  if(cached&&cached.event) return cached.event;
  if(m.evt){ try{ return JSON.parse(dec(m.evt)); }catch(e){ return null; } }
  return null;
}

// -- CREATE ----------------------------------------------------------------------
let _eventConvoKey=null;
function _eventModal(){
  let modal=document.getElementById('event-modal');
  if(modal) return modal;
  modal=document.createElement('div');
  modal.className='overlay'; modal.id='event-modal';
  modal.innerHTML='<div class="modal"><div class="modal-header"><h2>New event</h2><p>Everyone in this channel can answer.</p></div>'
    +'<div class="modal-body">'
    +'<div class="field"><label for="event-title">Title</label><input type="text" id="event-title" maxlength="80" placeholder="Study session"/></div>'
    +'<div class="field"><label for="event-when">Date and time</label><input type="datetime-local" id="event-when"/></div>'
    +'<div class="field"><label for="event-place">Place (optional)</label><input type="text" id="event-place" maxlength="120" placeholder="Library, room 2"/></div>'
    +'<div class="error-text" id="event-error"></div></div>'
    +'<div class="modal-footer"><button type="button" class="btn" id="event-save">Create event</button>'
    +'<button type="button" class="btn btn-ghost" id="event-cancel">Cancel</button></div></div>';
  document.body.appendChild(modal);
  modal.querySelector('#event-save').onclick=submitEvent;
  modal.querySelector('#event-cancel').onclick=()=>closeModal('event-modal');
  return modal;
}
function openEventModal(){
  if(!activeConvo||activeConvo.type!=='group'){ showToast('Groups only','Events can only be created in a group chat.'); return; }
  if(blockIfRestricted('noGroups','Group chats are turned off for your account.')) return;
  _eventModal();
  ['event-title','event-when','event-place'].forEach(id=>{ document.getElementById(id).value=''; });
  document.getElementById('event-error').textContent='';
  _eventConvoKey=activeConvo.key;
  openModal('event-modal');
}
let _savingEvent=false;
async function submitEvent(){
  if(_savingEvent) return;
  const title=document.getElementById('event-title').value.trim();
  const start=new Date(document.getElementById('event-when').value).getTime();
  const place=document.getElementById('event-place').value.trim();
  const error=document.getElementById('event-error');
  error.textContent='';
  if(!title){ error.textContent='Add a title.'; return; }
  if(!start){ error.textContent='Pick a date and time.'; return; }
  if(start<Date.now()){ error.textContent='Pick a time in the future.'; return; }
  _savingEvent=true;
  try{
    if(!convosCache) await getConvos();
    const c=convoByKey(_eventConvoKey);
    if(!c){ closeModal('event-modal'); return; }
    if(!isConvoMemberOf(c,true)){ error.textContent='You\'re not a member of that group.'; return; }
    if(blockIfRestricted('noGroups','Group chats are turned off for your account.')) return;
    const data={title:filterBadWords(title),start,place:filterBadWords(place)};
    const msg={id:'evt_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),from:me.number,time:Date.now(),seen:[],
      channelId:activeChannelId||'general'};
    if(me.shadowMuted) msg.shadowMuted=true;
    if(Array.isArray(c.pendingApproval)&&c.pendingApproval.includes(me.number)) msg.quarantined=true;
    const key=await getConvoAesKey(c);
    const wrapped=key?await aesEnc(key,JSON.stringify(data)):null;
    if(wrapped) msg.cevt=wrapped; else msg.evt=enc(JSON.stringify(data));
    _decCache[msg.id]={event:data,text:'📅 Event: '+data.title};
    c.messages.push(msg); _convosDirty=true;
    if(c.messages.length>100) c.messages.splice(0,c.messages.length-100);
    await saveConvos();
    closeModal('event-modal');
    lastMsgHash=''; renderMessages(c.messages);
  }catch(e){
    console.warn('event save failed',e);
    error.textContent='The event couldn\'t be saved. Check your connection and try again.';
  }finally{ _savingEvent=false; }
}

// -- ANSWER AND CANCEL -----------------------------------------------------------
async function _changeEvent(msgId,change){
  if(!activeConvo||!me) return;
  const c=convoByKey(activeConvo.key);
  const m=c&&c.messages.find(x=>x&&x.id===msgId);
  if(!m||!isConvoMemberOf(c,true)) return;
  if(blockIfRestricted('noGroups','Group chats are turned off for your account.')) return;
  change(m);
  _convosDirty=true;
  lastMsgHash=''; renderMessages(c.messages);
  try{ await saveConvos(); }
  catch(e){ console.warn('event update failed',e); showToast('Not saved','Your change couldn\'t be saved. Check your connection.'); }
}
function answerEvent(msgId,answer){
  return _changeEvent(msgId,m=>{
    // Keys are prefixed so the database never turns this into an array.
    const mine='u'+me.number;
    const rsvp=Object.assign({},m.rsvp);
    if(rsvp[mine]===answer) delete rsvp[mine]; else rsvp[mine]=answer;
    m.rsvp=rsvp;
  });
}
function cancelEvent(msgId){
  if(!confirm('Cancel this event for everyone?')) return;
  return _changeEvent(msgId,m=>{ if(m.from===me.number) m.evtCancelled=true; });
}

// -- CALENDAR FILE ---------------------------------------------------------------
function _icsText(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/([,;])/g,'\\$1'); }
function _icsTime(ms){ return new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''); }
function buildEventIcs(id,data){
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//SoCloudyBro//Events//EN','BEGIN:VEVENT',
    'UID:'+id+'@socloudybro','DTSTAMP:'+_icsTime(Date.now()),'DTSTART:'+_icsTime(data.start),
    'DTEND:'+_icsTime(data.start+60*60*1000),'SUMMARY:'+_icsText(data.title),
    data.place?'LOCATION:'+_icsText(data.place):'','END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n');
}
function downloadEventIcs(id,data){
  const url=URL.createObjectURL(new Blob([buildEventIcs(id,data)],{type:'text/calendar'}));
  const a=document.createElement('a');
  a.href=url; a.download='event.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// -- CARD --------------------------------------------------------------------------
function renderEventCard(m,body){
  const data=msgEventData(m);
  const card=document.createElement('div');
  card.className='event-card';
  body.appendChild(card);
  const add=(tag,cls,text,parent)=>{
    const el=document.createElement(tag);
    if(cls) el.className=cls;
    if(text!=null) el.textContent=text;
    (parent||card).appendChild(el);
    return el;
  };
  if(!data){ add('div','event-title','Event unavailable'); return; }
  const cancelled=!!m.evtCancelled;
  const over=!cancelled&&Date.now()>data.start+EVENT_OVER_AFTER_MS;
  card.classList.toggle('event-closed',cancelled||over);
  add('div','event-kicker',cancelled?'Event cancelled':over?'Event ended':'Event');
  add('div','event-title',data.title);
  add('div','event-line',new Date(data.start).toLocaleString([],{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}));
  if(data.place) add('div','event-line',data.place);
  const rsvp=m.rsvp||{};
  const answers=add('div','event-answers');
  EVENT_ANSWERS.forEach(([value,label])=>{
    const people=Object.keys(rsvp).filter(k=>rsvp[k]===value).map(k=>Number(k.slice(1)));
    const b=add('button','event-answer',label+(people.length?' · '+people.length:''),answers);
    b.type='button';
    b.disabled=cancelled||over;
    b.setAttribute('aria-pressed',rsvp['u'+me.number]===value?'true':'false');
    if(people.length) b.title=people.map(n=>dec((lookupUser(n)||{}).name)||('#'+n)).join(', ');
    b.onclick=()=>answerEvent(m.id,value);
  });
  if(cancelled||over) return;
  const links=add('div','event-links');
  const cal=add('button','event-link','Add to calendar',links);
  cal.type='button'; cal.onclick=()=>downloadEventIcs(m.id,data);
  if(m.from===me.number){
    const stop=add('button','event-link event-cancel','Cancel event',links);
    stop.type='button'; stop.onclick=()=>cancelEvent(m.id);
  }
}

(function(){
  const button=document.getElementById('event-compose-btn');
  if(button) button.onclick=openEventModal;
})();
