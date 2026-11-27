/* =============================================================================
   RESTRICTION ENFORCEMENT — the flags a parent sets are checked at the real
   entry points, not just displayed.
   ========================================================================== */
const _origOpenChatForRestrictions = openChat;
openChat = async function(c){
  if(c && c.type!=='group' && blockIfRestricted('noDm','Direct messages are turned off for your account.')) return;
  if(c && c.type==='group' && blockIfRestricted('noGroups','Group chats are turned off for your account.')) return;
  // Tab capacity is checked BEFORE opening, so hitting the limit leaves the
  // current conversation alone instead of opening an untabbed one.
  if(!addTabFor(c)) return;
  const r = await _origOpenChatForRestrictions(c);
  updateFavoriteMenuItem();
  renderTabBar();
  renderSuggestionBar([]);
  return r;
};
const _origStartDirectCall = startDirectCall;
startDirectCall = function(contact){
  if(blockIfRestricted('noCalls','Calling is turned off for your account.')) return;
  return _origStartDirectCall(contact);
};
const _origAcceptIncomingCall = acceptIncomingCall;
acceptIncomingCall = function(){
  if(blockIfRestricted('noCalls','Calling is turned off for your account.')){ declineIncomingCall(); return; }
  return _origAcceptIncomingCall();
};
const _origSubmitNewGroup = submitNewGroup;
submitNewGroup = function(){
  if(blockIfRestricted('noGroups','Creating groups is turned off for your account.')) return;
  return _origSubmitNewGroup();
};
const _origJoinVoiceChannel = joinVoiceChannel;
joinVoiceChannel = function(channelId){
  if(blockIfRestricted('noVoice','Voice chat is turned off for your account.')) return;
  return _origJoinVoiceChannel(channelId);
};

/* =============================================================================
   BOOT WIRING
   ========================================================================== */
// One-time nudge for accounts created before security questions existed — this
// is what makes "Forgot password?" usable for them.
function promptSecurityQuestionsOnce(){
  try{
    if(!me) return;
    if(localStorage.getItem('cc_secq_prompted_'+me.number)==='1') return;
    const u=(usersCache||[]).find(x=>x&&x.number===me.number);
    if(u && Array.isArray(u.secQuestions) && u.secQuestions.length===2) return;
    localStorage.setItem('cc_secq_prompted_'+me.number,'1');
    setTimeout(()=>{
      // Don't interrupt the welcome tutorial — new users will see this after they finish it
      if(shouldShowTutorial && shouldShowTutorial()) return;
      showToast('Set up account recovery','Security questions are the only way to reset your password if you forget it.');
      if(typeof openSecurityQuestionsSetup==='function') openSecurityQuestionsSetup();
    }, 2500);
  }catch(e){ console.warn('security question prompt failed', e); }
}
function featurePostLaunch(){
  const step=(name, fn)=>{ try{ fn(); }catch(e){ console.error('feature init failed:', name, e); } };
  step('initThemeColors', initThemeColors);
  step('applyLanguage', applyLanguage);
  step('initLargeTextMode', initLargeTextMode);
  step('initColorblindMode', initColorblindMode);
  step('renderTabBar', renderTabBar);
  step('showNeedsAttentionBanner', showNeedsAttentionBanner);
  step('hydrateConnectedAccountsFromRecord', hydrateConnectedAccountsFromRecord);
  step('updateFeatureSettingsUI', updateFeatureSettingsUI);
  step('promptSecurityQuestionsOnce', promptSecurityQuestionsOnce);
  step('startConvoRealtime', startConvoRealtime);
  checkParentLinkExpiry().catch(e=>console.warn('parent link check failed', e));
  // Delayed so it never competes with a higher-priority first-paint dialog
  // (email verification gate, tutorial, security-questions prompt).
  setTimeout(()=>{ try{ _maybeAutoShowChangelog(); }catch(e){} },2000);
  setTimeout(()=>{ _maybeAutoRotateE2EKeys().catch(e=>console.warn('Auto key rotation failed',e)); },3000);
  setTimeout(()=>{ _sweepSelfDestructAccounts().catch(e=>console.warn('Self-destruct sweep failed',e)); },4000);
  setTimeout(()=>{ _maybeShowComplianceNotice().catch(e=>console.warn('Compliance notice failed',e)); },5000);
}

/* =============================================================================
   6b. SPEED — push instead of poll for message delivery
   The 25s poll stays (it also refreshes users, reminders and read receipts),
   but waiting up to 25 seconds to see an incoming message was the single
   biggest source of "the app feels slow". A Firebase 'value' listener on the
   conversations node turns that into a push: when nothing is happening it
   costs nothing, and when a message lands it renders in well under a second.
   ========================================================================== */
let _scbConvoWatchRef=null, _scbConvoWatchCb=null, _scbRtTimer=null;
// Mirrors the normalization getConvos() does, because this path gets the
// snapshot straight from the listener rather than issuing a second fetch for
// data we've already been handed. Keep the two in step if either changes.
function _scbApplyConvoSnapshot(d){
  // Support both legacy {conversations:[...]} and new per-key {<key>:{...}} format —
  // keep in step with getConvos() which has the same dual-format logic.
  let rawArr=[];
  if(d&&d.conversations!==undefined){
    rawArr=Array.isArray(d.conversations)?d.conversations:Object.values(d.conversations||{});
  } else if(d&&typeof d==='object'){
    rawArr=Object.values(d).filter(c=>c&&c.key);
  }
  convosCache=rawArr.filter(Boolean);
  convosCache.forEach(c=>{
    try{ _normalizeConvo(c); }catch(e){ console.error('Failed to normalize conversation', c&&c.key, e); }
  });
}
// CONVOS_BIN is the whole app's conversation tree, not just this user's —
// a `.on('value')` listener on it fires for EVERY write anywhere (someone
// else's message, reaction, pin, typing broadcast), on every connected
// client, regardless of whether that write touches a conversation the
// current user is even part of. Properly scoping this to only the
// conversations a user is actually in would mean restructuring how
// conversations are stored/indexed in Firebase — a real data-model
// migration touching nearly every read/write path in the app, which isn't
// something to do as a quick patch. This is the safe, contained mitigation:
// a cheap fingerprint restricted to the conversations the signed-in user is
// actually a participant/member of, computed BEFORE doing any of the
// expensive work (re-normalizing every conversation in the whole app,
// re-rendering the sidebar, re-rendering the open chat). A write anywhere
// this user has no stake in now costs one cheap string comparison instead
// of a full normalize-and-rerender.
let _scbLastMyConvoFingerprint=null;
function _scbMyConvoFingerprint(raw, myNumber){
  if(!myNumber) return '';
  let entries;
  if(raw&&raw.conversations!==undefined){
    entries=Array.isArray(raw.conversations)?raw.conversations:Object.values(raw.conversations||{});
  } else entries=Object.values(raw||{});
  const mine=entries.filter(c=>c&&c.key&&(c.participants||c.members||[]).map(Number).includes(Number(myNumber)));
  return JSON.stringify(mine);
}
function startConvoRealtime(){
  if(_scbConvoWatchRef) return;
  _scbLastMyConvoFingerprint=null; // force the first snapshot after (re)starting to always apply
  try{
    _scbConvoWatchRef=fbdb.ref(CONVOS_BIN);
    _scbConvoWatchCb=_scbConvoWatchRef.on('value',(snap)=>{
      if(_scbRtTimer) clearTimeout(_scbRtTimer);
      _scbRtTimer=setTimeout(()=>{ // 80ms — instant enough to feel live without hammering the renderer
        try{
          // Never overwrite local state while our own write is in flight or
          // while unsent messages are only held locally — those cases are the
          // outbox's job and the 25s poll already handles them.
          if(_saveConvosPending) return;
          if(!netOnline || outboxCount()>0) return;
          const raw=snap.val()||{};
          const fp=_scbMyConvoFingerprint(raw, me&&me.number);
          if(fp===_scbLastMyConvoFingerprint) return; // nothing this user is part of actually changed
          _scbLastMyConvoFingerprint=fp;
          _scbApplyConvoSnapshot(raw);
          syncContactsFromConvos();
          renderSidebar();
          if(activeConvo){
            const c=convosCache.find(x=>x&&x.key===activeConvo.key);
            if(c) renderMessages(c.messages);
          }
        }catch(e){ console.warn('realtime convo refresh failed', e); }
      }, 80);
    },(err)=>{ console.warn('realtime convo watch error', err); });
  }catch(e){
    _scbConvoWatchRef=null;
    console.warn('realtime convo watch unavailable — falling back to polling only', e);
  }
}
function stopConvoRealtime(){
  try{ if(_scbConvoWatchRef&&_scbConvoWatchCb) _scbConvoWatchRef.off('value',_scbConvoWatchCb); }catch(e){}
  _scbConvoWatchRef=null; _scbConvoWatchCb=null;
}
// Coming back to the tab shouldn't mean waiting for the next tick either.
document.addEventListener('visibilitychange',()=>{
  if(document.hidden||!me) return;
  getConvos().then(()=>{
    renderSidebar();
    if(activeConvo){
      const c=convosCache.find(x=>x&&x.key===activeConvo.key);
      if(c){ lastMsgHash=''; renderMessages(c.messages); }
    }
  }).catch(e=>console.warn('focus refresh failed', e));
});

const _origLaunch = launch;
launch = async function(){
  const r = await _origLaunch();
  featurePostLaunch();
  return r;
};
// Tidy up the meeting cleanly if the page goes away mid-call.
window.addEventListener('beforeunload', ()=>{ try{ if(meetingState) leaveMeeting(); }catch(e){} });

try{ injectFeatureDom(); }
catch(e){ console.error('feature DOM injection failed', e); }

/* ── Sidebar tab overflow indicator ── */
(function(){
  function checkTabOverflow(){
    const tabs=document.getElementById('sb-tabs');
    if(!tabs) return;
    const wrap=tabs.closest('.sb-tabs-wrap')||tabs.parentElement;
    if(!wrap) return;
    const overflows=tabs.scrollWidth>tabs.clientWidth+2;
    wrap.classList.toggle('overflows',overflows);
  }
  const obs=new ResizeObserver(checkTabOverflow);
  document.addEventListener('DOMContentLoaded',()=>{
    const tabs=document.getElementById('sb-tabs');
    if(tabs){ obs.observe(tabs); checkTabOverflow(); }
  });
})();

/* ── Browser tab title unread badge ── */
(function(){
  const _origTitle=document.title||'SoCloudyBro';
  function updateTabTitle(){
    if(!window.convosCache||!window.me) return;
    let total=0;
    // Your own chats only: the cache also holds conversations you aren't in.
    knownContacts().forEach(c=>{ total+=unreadMessagesIn(convoByKey(c.key)).length; });
    document.title=total>0?'('+total+') '+_origTitle:_origTitle;
  }
  const _savedConvos=window.saveConvos;
  if(typeof _savedConvos==='function'){
    window.saveConvos=async function(){
      const r=await _savedConvos.apply(this,arguments);
      try{updateTabTitle();}catch(e){}
      return r;
    };
  }
  setInterval(updateTabTitle,8000);
})();

/* =============================================================================
   FLOATING IN-CALL WIDGET ("call bubble")
   -----------------------------------------------------------------------------
   A small draggable card that is visible while EITHER calling system is live,
   so the user can keep browsing/chatting during a call:

     * the older direct-WebRTC voice system  -> global `voiceChannelActive`
       (group voice channels via joinVoiceChannel(), 1:1 DM calls via
       _beginDmCallSession()), muted flag `voiceMuted`, teardown
       leaveVoiceChannel(), mute toggle toggleVoiceMute().
     * the newer LiveKit/mesh Meetings system -> global `meetingState`,
       muted flag `!meetingState.micOn`, teardown leaveMeeting(), mute toggle
       toggleMeetingMic().

   The widget owns NO call state of its own. Every button calls straight into
   the function the existing UI uses, and every indicator is read back out of
   those same globals on each tick, so it can't desync from the real thing
   (e.g. the mute pill reflects `voiceMuted` / `meetingState.micOn`, which are
   the values the actual MediaStreamTrack.enabled flags were set from).

   "Call started / call ended" is not an event in either system — both are
   plain module-level variables reassigned from several places
   (_startVoiceSession / leaveVoiceChannel; connectToLiveKitRoom /
   connectToMeshRoom / joinMeeting's catch / leaveMeeting / the LiveKit
   Disconnected handler / the mesh-fallback reset). Rather than patch all of
   those, the widget polls those two variables on the same timer it already
   needs for the audio meters, which is inherently correct for every path in
   and out of a call, including the ones that fail half-way.
   ========================================================================== */

/* ---- speaking detection ---------------------------------------------------
   One AnalyserNode per participant, tapping the MediaStream each system
   ALREADY has (nothing is captured or played a second time):
     old system : local  -> voiceLocalStream
                  remote -> the <audio id="voice-audio-NNN"> element that
                            ensureVoicePeer()'s ontrack already points at the
                            remote stream
     meetings   : local  -> meetingState.localStream
                  remote -> meetingState.peers[id].stream (the same shape for
                            both the LiveKit and the mesh transports)
   RMS over a time-domain window; above the threshold the person is "speaking",
   with a short hold so normal gaps between words don't strobe the ring. The
   analyser feeds a zero-gain GainNode into the destination purely so the graph
   is guaranteed to be pulled by the audio thread — it adds no audible sound.
   A muted local mic has track.enabled=false, so its RMS is 0 and "you" can
   never appear to be speaking while muted. */
const CW_SPEAK_RMS = 0.022;     // ~ -33 dBFS; above room noise, below speech
const CW_SPEAK_HOLD_MS = 320;   // keep the ring lit through short gaps
let _cwAudioCtx = null;
let _cwSink = null;
const _cwMeters = {};           // key -> {stream, sig, src, analyser, buf, until}
let _cwSys = null;              // 'voice' | 'meeting' | null
const _cwPrev = {v:false, m:false};
let _cwLastSig = '';
let _cwTimer = null;

function _cwCtx(){
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    if(!_cwAudioCtx){
      _cwAudioCtx = new AC();
      _cwSink = _cwAudioCtx.createGain();
      _cwSink.gain.value = 0;                 // silent: analysis only
      _cwSink.connect(_cwAudioCtx.destination);
    }
    if(_cwAudioCtx.state === 'suspended') _cwAudioCtx.resume().catch(()=>{});
    return _cwAudioCtx;
  }catch(e){ return null; }
}
function _cwTrackSig(stream){
  if(!stream || !stream.getAudioTracks) return '';
  return stream.getAudioTracks().map(t=>t.id).join(',');
}
function _cwDropMeter(key){
  const m = _cwMeters[key];
  if(!m) return;
  try{ m.src.disconnect(); }catch(e){}
  try{ m.analyser.disconnect(); }catch(e){}
  delete _cwMeters[key];
}
function _cwDropAllMeters(){ Object.keys(_cwMeters).forEach(_cwDropMeter); }
// A MediaStreamAudioSourceNode is bound to the tracks the stream held when it
// was created, so it is rebuilt whenever the stream object OR its audio-track
// set changes (LiveKit adds each subscribed track to the peer's stream after
// the fact, and the mesh path does the same in ontrack).
function _cwMeter(key, stream){
  const sig = _cwTrackSig(stream);
  const cur = _cwMeters[key];
  if(cur && cur.stream === stream && cur.sig === sig) return cur;
  if(cur) _cwDropMeter(key);
  if(!sig) return null;
  const ctx = _cwCtx();
  if(!ctx) return null;
  let src;
  try{ src = ctx.createMediaStreamSource(stream); }
  catch(e){ return null; }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.3;
  try{ src.connect(analyser); analyser.connect(_cwSink); }catch(e){}
  const m = {stream, sig, src, analyser, buf:new Float32Array(analyser.fftSize), until:0};
  _cwMeters[key] = m;
  return m;
}
function _cwSpeaking(key, stream){
  const m = _cwMeter(key, stream);
  if(!m) return false;
  const now = Date.now();
  try{
    if(m.analyser.getFloatTimeDomainData) m.analyser.getFloatTimeDomainData(m.buf);
    else return false;
  }catch(e){ return false; }
  let sum = 0;
  for(let i=0;i<m.buf.length;i++) sum += m.buf[i]*m.buf[i];
  const rms = Math.sqrt(sum/m.buf.length);
  if(rms > CW_SPEAK_RMS) m.until = now + CW_SPEAK_HOLD_MS;
  return m.until > now;
}

/* ---- who is in the call --------------------------------------------------- */
function _cwVoiceRoster(){
  const myNum = (me && me.number) || 0;
  const rows = [{key:'me', name:'You', stream:(typeof voiceLocalStream!=='undefined'?voiceLocalStream:null),
                 isMe:true, tag:(voiceMuted ? 'muted' : '')}];
  const snap = _cwVoiceParticipants || {};
  const nums = new Set();
  Object.keys(snap).forEach(n=>{ if(Number(n)!==myNum) nums.add(Number(n)); });
  Object.keys(voicePeers||{}).forEach(n=>{ if(Number(n)!==myNum) nums.add(Number(n)); });
  if(voiceChannelActive && voiceChannelActive.isDm && voiceChannelActive.otherNum){
    nums.add(Number(voiceChannelActive.otherNum));
  }
  Array.from(nums).sort((a,b)=>a-b).forEach(n=>{
    const p = snap[n] || {};
    const u = (typeof lookupUser==='function') ? lookupUser(n) : null;
    const name = p.name || (u && dec(u.name)) || ('#'+n);
    const el = document.getElementById('voice-audio-'+n);
    rows.push({key:'v'+n, name:name, stream:(el?el.srcObject:null), isMe:false,
               tag:(voicePeers && voicePeers[n]) ? '' : 'connecting'});
  });
  return rows;
}
function _cwMeetingRoster(){
  const rows = [{key:'me', name:'You', stream:meetingState.localStream, isMe:true,
                 tag:(meetingState.micOn ? '' : 'muted')}];
  Object.keys(meetingState.peers||{}).forEach(id=>{
    const e = meetingState.peers[id] || {};
    // Same labelling renderMeetingGrid() uses, so the two views agree.
    const label = e.label || (String(id).split('_')[0]==='anon' ? 'Guest' : ('#'+String(id).split('_')[0]));
    rows.push({key:'m'+id, name:label, stream:e.stream, isMe:false, tag:''});
  });
  return rows;
}
function _cwRoster(){
  if(_cwSys === 'meeting') return _cwMeetingRoster();
  if(_cwSys === 'voice') return _cwVoiceRoster();
  return [];
}
function _cwTitle(){
  if(_cwSys === 'meeting') return '🎥 ' + (meetingState.id || 'Meeting');
  if(_cwSys === 'voice') return (voiceChannelActive && voiceChannelActive.label) || '🔊 Voice';
  return '';
}
function _cwIsMuted(){
  if(_cwSys === 'meeting') return !meetingState.micOn;
  if(_cwSys === 'voice') return !!voiceMuted;
  return false;
}

/* ---- the buttons: straight through to the live system --------------------- */
function cwToggleMute(){
  // No local mute flag of its own: these are the same functions the voice bar
  // and the meeting control strip call, and they are what actually flips
  // track.enabled on the real outgoing MediaStreamTrack.
  if(_cwSys === 'meeting') toggleMeetingMic();
  else if(_cwSys === 'voice') toggleVoiceMute();
  _cwRender(true);
}
function cwHangUp(){
  if(_cwSys === 'meeting') leaveMeeting();          // LiveKit disconnect / mesh teardown
  else if(_cwSys === 'voice') leaveVoiceChannel();  // peers, mic, presence, calls/<pair>
  _cwRender(true);
}
function cwExpand(){
  // Meetings have a full-screen room; re-show it without touching meetingState.
  const room = document.getElementById('scb-meeting-room');
  if(_cwSys === 'meeting' && room) room.classList.add('visible');
}
function cwToggleCollapse(){
  const w = document.getElementById('call-widget');
  if(!w) return;
  const next = !w.classList.contains('collapsed');
  w.classList.toggle('collapsed', next);
  try{ localStorage.setItem('cw_collapsed', next ? '1' : '0'); }catch(e){}
  const b = document.getElementById('cw-collapse-btn');
  if(b){ b.textContent = next ? '▴' : '▾'; b.title = next ? 'Expand' : 'Collapse'; }
  _cwClamp();
}

/* ---- minimise the meeting room (so the widget has a job to do) ------------ */
function minimizeMeetingRoom(){
  const room = document.getElementById('scb-meeting-room');
  if(room) room.classList.remove('visible');
  if(typeof meetingState!=='undefined' && meetingState){
    showToast('Meeting minimised','Use the call bubble to come back or leave.');
  }
}

/* ---- invite -------------------------------------------------------------- */
// What each system can ACTUALLY do:
//  * Meetings (LiveKit or mesh): rooms are joinable at any time by code, up to
//    effectiveMaxParticipants(), so a real late-join invite is possible. There
//    is no pre-existing invite mechanism (joinMeeting only toasts the code),
//    so this sends the code to a contact/group as a normal message.
//  * Old group voice channel: a third person joins by tapping the channel in
//    that group's channel bar — so the honest action is to announce it in the
//    group. Someone who is not a member of the group cannot be added at all.
//  * Old 1:1 DM call: it genuinely CANNOT take a third person. The signalling
//    path is callPath(dmKey(a,b)) — derived from exactly two numbers — the
//    ring/accept record lives at calls/<pairKey> (also a pair), and
//    startDirectCall() refuses outright while voiceChannelActive is set. There
//    is no discovery path by which a third client could ever find or join that
//    room. So no "add person" button is offered for it; instead the sheet says
//    so and offers the one thing that does work: move the conversation into a
//    Meetings room, messaging both the current caller and the new person the
//    code, then hanging up the 1:1 and joining that room.
let _cwInviteMode = null;
function cwInvite(){
  if(_cwSys === 'meeting') _cwOpenInvite('meeting');
  else if(_cwSys === 'voice') _cwOpenInvite(voiceChannelActive && voiceChannelActive.isDm ? 'dm' : 'channel');
}
function _cwOpenInvite(mode){
  _cwInviteMode = mode;
  const h = document.getElementById('cw-invite-title');
  const note = document.getElementById('cw-invite-note');
  const list = document.getElementById('cw-invite-list');
  const extra = document.getElementById('cw-invite-extra');
  if(!h || !note || !list || !extra) return;
  list.innerHTML = '';
  extra.innerHTML = '';
  if(mode === 'meeting'){
    h.textContent = 'Invite to this meeting';
    note.textContent = 'Anyone can join at any time with the code ' + (meetingState.id||'') +
      ' (Meetings → Join Meeting). Room holds ' + effectiveMaxParticipants() + ' people.';
    _cwFillContacts(list, c=>_cwInviteToMeeting(c));
  }else if(mode === 'channel'){
    h.textContent = 'Share this voice channel';
    note.textContent = 'Anyone in this group joins by tapping ' +
      ((voiceChannelActive && voiceChannelActive.label) || 'the voice channel') +
      ' in the channel bar. People outside the group can\'t be added to it.';
    const btn = document.createElement('button');
    btn.className = 'btn btn-full';
    btn.textContent = '📣 Post “join me” in this group';
    btn.onclick = _cwAnnounceVoiceChannel;
    extra.appendChild(btn);
  }else{
    h.textContent = 'Add someone to this call';
    note.textContent = 'A 1:1 call can\'t take a third person — it is signalled over a ' +
      'path derived from just the two numbers, so nobody else can join it. ' +
      'Pick someone below to move everyone into a Meetings room instead: they and ' +
      (_cwOtherName() || 'the other person') + ' both get the code, then this call hangs up and the room opens.';
    _cwFillContacts(list, c=>_cwUpgradeDmToMeeting(c), true);
  }
  openModal('cw-invite-modal');
}
function _cwOtherName(){
  if(!voiceChannelActive || !voiceChannelActive.otherNum) return '';
  const u = (typeof lookupUser==='function') ? lookupUser(Number(voiceChannelActive.otherNum)) : null;
  return (u && dec(u.name)) || ('#'+voiceChannelActive.otherNum);
}
// Same row markup/behaviour as openForwardModal()'s picker.
function _cwFillContacts(list, pick, dmOnly){
  const items = (contacts||[]).filter(c=>{
    if(!c) return false;
    if(c.type === 'channel') return false;
    if(dmOnly && c.type === 'group') return false;
    if(c.type !== 'group' && voiceChannelActive && Number(c.number) === Number(voiceChannelActive.otherNum)) return false;
    return true;
  });
  if(!items.length){
    list.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px">No contacts or groups yet.</div>';
    return;
  }
  items.forEach(c=>{
    const row = document.createElement('div');
    row.className = 'sb-item';
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--r-sm);cursor:pointer';
    const av = document.createElement('div');
    av.className = c.type==='group' ? 'group-avatar' : 'avatar';
    av.style.cssText = 'width:36px;height:36px;font-size:14px;background:linear-gradient(135deg,#4C46C4,#7C5FD4);color:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:50%';
    const _pickAv=(lookupUser(c.number)||{}).avatar||c.avatar||'';
    if(_pickAv && (String(_pickAv).startsWith('data:image/')||String(_pickAv).startsWith('https://'))) av.innerHTML = '<img src="'+esc(_pickAv)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    else av.textContent = c.type==='group' ? '👥' : (dec(c.name)||'?').charAt(0).toUpperCase();
    const nm = document.createElement('div');
    nm.style.cssText = 'font-size:13px;font-weight:500';
    nm.textContent = dec(c.name) || 'Unknown';   // textContent — user data
    row.appendChild(av); row.appendChild(nm);
    row.onclick = ()=>pick(c);
    list.appendChild(row);
  });
}
// Writes a normal message into the target conversation, exactly the way
// forwardToTarget() does (getOrMakeConvo + enc + saveConvos), so it goes
// through the same storage/normalisation path as any other message.
async function _cwPostMessage(c, text){
  if(!me) throw new Error('Not signed in');
  const key = c.key || dmKey(me.number, c.number);
  const conv = await getOrMakeConvo(key, c.type==='group' ? (c.members||c.participants||[]) : [me.number, c.number]);
  conv.messages.push({
    id: Date.now().toString(36)+Math.random().toString(36).slice(2,5),
    from: me.number, time: Date.now(), seen: [], text: enc(text)
  });
  if(conv.messages.length > 500) conv.messages.splice(0, conv.messages.length-500);
  await saveConvos();
  if(activeConvo && activeConvo.key === key){
    renderMessages(conv.messages);
    lastMsgHash = JSON.stringify(conv.messages);
  }
}
async function _cwInviteToMeeting(c){
  if(!meetingState){ closeModal('cw-invite-modal'); return; }
  closeModal('cw-invite-modal');
  const code = meetingState.id;
  try{
    await _cwPostMessage(c, '🎥 Join my meeting on SoCloudyBro: ' + meetingLink(code));
    showToast('Invite sent', (dec(c.name)||'Contact') + ' got the code ' + code + '.');
  }catch(e){ showToast('Invite failed', scbErr('SCB-GRP-30','That invite couldn\'t be sent — the server rejected the write.',(e.message||''))); }
}
async function _cwAnnounceVoiceChannel(){
  closeModal('cw-invite-modal');
  // Deliberately NOT getActiveConvoObj(): the whole point of this widget is
  // that the user can wander off to another chat while the call runs, so the
  // announcement has to go to the group the channel actually belongs to —
  // joinVoiceChannel() records that as voiceChannelActive.convoKey.
  const key = voiceChannelActive && voiceChannelActive.convoKey;
  const conv = (key && convosCache) ? convosCache.find(x=>x && x.key===key) : null;
  if(!conv || !voiceChannelActive){ showToast('Nothing to share',scbErr('SCB-GRP-31','Couldn\'t find the group this channel belongs to.')); return; }
  try{
    await _cwPostMessage({key:conv.key, type:'group', members:(conv.members||conv.participants||[]), name:conv.name},
      '📣 I\'m in ' + (voiceChannelActive.label||'the voice channel') + ' — tap it in the channel bar to join me.');
    showToast('Posted','Everyone in the group can see it.');
  }catch(e){ showToast('Couldn\'t post', scbErr('SCB-GRP-32','That couldn\'t be posted to the group — the server rejected the write.',(e.message||''))); }
}
async function _cwUpgradeDmToMeeting(c){
  closeModal('cw-invite-modal');
  if(!voiceChannelActive || !voiceChannelActive.isDm) return;
  const otherNum = Number(voiceChannelActive.otherNum);
  const code = newMeetingId();
  const msg = '🎥 Moving our call to a meeting room so more people can join: ' + meetingLink(code);
  const targets = [c];
  const otherContact = (contacts||[]).find(x=>x && x.type!=='group' && Number(x.number)===otherNum);
  if(otherContact) targets.push(otherContact);
  else if(otherNum) targets.push({number:otherNum, name:_cwOtherName()});
  for(const t of targets){
    try{ await _cwPostMessage(t, msg); }
    catch(e){ console.warn('[call-widget] meeting invite message failed', e); }
  }
  // Only hang up once the invites are out, so nobody is dropped with no code.
  try{ leaveVoiceChannel(); }catch(e){}
  try{ await joinMeeting(code); }
  catch(e){ showToast('Couldn\'t open the room', scbErr('SCB-MEET-09','That meeting room couldn\'t be opened.',(e.message||''))); }
}

/* ---- drag + position ----------------------------------------------------- */
const CW_POS_KEY = 'cw_widget_pos';
let _cwDrag = null;
function _cwSavePos(left, top){
  try{ localStorage.setItem(CW_POS_KEY, JSON.stringify({left:Math.round(left), top:Math.round(top)})); }catch(e){}
}
function _cwLoadPos(){
  try{
    const v = JSON.parse(localStorage.getItem(CW_POS_KEY)||'null');
    if(v && typeof v.left==='number' && typeof v.top==='number') return v;
  }catch(e){}
  return null;
}
// Keeps the whole card on screen (after a drag, a rotate, a resize, or a
// collapse that changed its height), and never lets the handle go off-screen.
function _cwClamp(){
  const w = document.getElementById('call-widget');
  if(!w || !w.classList.contains('visible')) return;
  const r = w.getBoundingClientRect();
  const maxL = Math.max(8, window.innerWidth  - r.width  - 8);
  const maxT = Math.max(8, window.innerHeight - r.height - 8);
  const left = Math.min(Math.max(parseFloat(w.style.left)||0, 8), maxL);
  const top  = Math.min(Math.max(parseFloat(w.style.top)||0, 8), maxT);
  w.style.left = left+'px';
  w.style.top  = top+'px';
  _cwSavePos(left, top);
}
function _cwPlace(){
  const w = document.getElementById('call-widget');
  if(!w) return;
  const saved = _cwLoadPos();
  const r = w.getBoundingClientRect();
  if(saved){ w.style.left = saved.left+'px'; w.style.top = saved.top+'px'; }
  else{
    // Bottom-right by default, lifted clear of the compose box / bottom bar.
    w.style.left = Math.max(8, window.innerWidth - r.width - 16) + 'px';
    w.style.top  = Math.max(8, window.innerHeight - r.height - 132) + 'px';
  }
  _cwClamp();
}
function _cwDragStart(e){
  if(e.target && e.target.closest && e.target.closest('button')) return; // let the head buttons work
  const w = document.getElementById('call-widget');
  if(!w) return;
  const r = w.getBoundingClientRect();
  _cwDrag = {dx:e.clientX - r.left, dy:e.clientY - r.top, id:e.pointerId};
  w.classList.add('dragging');
  try{ e.currentTarget.setPointerCapture(e.pointerId); }catch(err){}
  e.preventDefault();
}
function _cwDragMove(e){
  if(!_cwDrag || e.pointerId !== _cwDrag.id) return;
  const w = document.getElementById('call-widget');
  if(!w) return;
  const r = w.getBoundingClientRect();
  const maxL = Math.max(8, window.innerWidth  - r.width  - 8);
  const maxT = Math.max(8, window.innerHeight - r.height - 8);
  w.style.left = Math.min(Math.max(e.clientX - _cwDrag.dx, 8), maxL) + 'px';
  w.style.top  = Math.min(Math.max(e.clientY - _cwDrag.dy, 8), maxT) + 'px';
  e.preventDefault();
}
function _cwDragEnd(e){
  if(!_cwDrag) return;
  const w = document.getElementById('call-widget');
  _cwDrag = null;
  if(w) w.classList.remove('dragging');
  try{ e.currentTarget.releasePointerCapture(e.pointerId); }catch(err){}
  _cwClamp();
}

/* ---- render -------------------------------------------------------------- */
function _cwRender(force){
  const w = document.getElementById('call-widget');
  if(!w || !_cwSys) return;
  const roster = _cwRoster();
  const muted = _cwIsMuted();
  const title = _cwTitle();
  // Rebuild the rows only when the people/labels actually change; every tick
  // just moves the .speaking class around.
  const sig = _cwSys+'|'+title+'|'+muted+'|'+roster.map(p=>p.key+':'+p.name+':'+p.tag).join('|');
  if(force || sig !== _cwLastSig){
    _cwLastSig = sig;
    const t = document.getElementById('cw-title');
    if(t) t.textContent = title;
    const ex = document.getElementById('cw-expand-btn');
    if(ex) ex.style.display = (_cwSys === 'meeting') ? '' : 'none';
    const mb = document.getElementById('cw-mute-btn');
    if(mb){
      mb.textContent = muted ? '🎙️ Unmute' : '🔇 Mute';
      mb.classList.toggle('cw-on', muted);
    }
    const list = document.getElementById('cw-people');
    if(list){
      const keep = {};
      Array.from(list.children).forEach(el=>{ keep[el.dataset.k] = el; });
      list.innerHTML = '';
      roster.forEach(p=>{
        let row = keep[p.key];
        if(!row){
          row = document.createElement('div');
          row.className = 'cw-person';
          row.dataset.k = p.key;
          row.innerHTML = '<div class="cw-av"></div><div class="cw-name"></div><div class="cw-tag"></div>';
        }
        row.querySelector('.cw-av').textContent = (p.name||'?').replace(/^\W+\s*/,'').charAt(0).toUpperCase() || '?';
        row.querySelector('.cw-name').textContent = p.name;          // textContent — user data
        row.querySelector('.cw-tag').textContent = p.tag || '';
        list.appendChild(row);
      });
      if(roster.length === 1){
        const hint = document.createElement('div');
        hint.className = 'cw-hint';
        hint.textContent = 'Waiting for someone to join…';
        list.appendChild(hint);
      }
    }
  }
  // Per-tick: speaking rings.
  const list = document.getElementById('cw-people');
  if(!list) return;
  const live = {};
  roster.forEach(p=>{
    live[p.key] = true;
    const row = list.querySelector('.cw-person[data-k="'+p.key.replace(/"/g,'\\"')+'"]');
    if(!row) return;
    const on = _cwSpeaking(p.key, p.stream);
    if(on !== row.classList.contains('speaking')) row.classList.toggle('speaking', on);
  });
  Object.keys(_cwMeters).forEach(k=>{ if(!live[k]) _cwDropMeter(k); });
}
function _cwTick(){
  const w = document.getElementById('call-widget');
  if(!w) return;
  const vOn = (typeof voiceChannelActive !== 'undefined') && !!voiceChannelActive;
  const mOn = (typeof meetingState !== 'undefined') && !!meetingState;
  // Whichever system most recently came up is the one the widget controls, so
  // the buttons can never target a call the user isn't looking at. (They are
  // near-exclusive in practice — joinMeeting() refuses while meetingState is
  // set and _startVoiceSession() tears down any live voice session first —
  // but a voice call and a meeting can technically overlap.)
  if(mOn && !_cwPrev.m) _cwSys = 'meeting';
  else if(vOn && !_cwPrev.v) _cwSys = 'voice';
  if(_cwSys === 'meeting' && !mOn) _cwSys = vOn ? 'voice' : null;
  if(_cwSys === 'voice' && !vOn) _cwSys = mOn ? 'meeting' : null;
  if(!_cwSys) _cwSys = mOn ? 'meeting' : (vOn ? 'voice' : null);
  _cwPrev.v = vOn; _cwPrev.m = mOn;
  if(!_cwSys){
    if(w.classList.contains('visible')){
      w.classList.remove('visible');
      _cwDropAllMeters();
      _cwLastSig = '';
      _cwVoiceParticipants = null;
    }
    return;
  }
  if(!w.classList.contains('visible')){
    w.classList.add('visible');
    _cwLastSig = '';
    _cwPlace();
  }
  _cwRender(false);
}

/* ---- init ---------------------------------------------------------------- */
// renderVoiceBar() is the one place the old system is handed the live
// participants snapshot (names included). Wrapping it — the same pattern this
// file already uses for launch() — gives the widget those names without
// re-reading Firebase or duplicating the listener.
let _cwVoiceParticipants = null;
function _cwHookVoiceBar(){
  if(typeof renderVoiceBar !== 'function' || renderVoiceBar._cwWrapped) return;
  const orig = renderVoiceBar;
  renderVoiceBar = function(participants){
    _cwVoiceParticipants = participants || {};
    return orig.apply(this, arguments);
  };
  renderVoiceBar._cwWrapped = true;
}
function initCallWidget(){
  if(document.getElementById('call-widget')) return;
  const style = document.createElement('style');
  style.textContent = `
/* ── FLOATING IN-CALL WIDGET ──
   Uses the app's own tokens (surface/border/shadow-lg/r-card and the .btn
   family) so it reads as the same small floating card as .dash-widget, not a
   modal. z-index sits under .overlay (200) and under #scb-meeting-room (480),
   so incoming-call dialogs and the full meeting view still win. */
#call-widget{position:fixed;left:0;top:0;z-index:170;width:238px;max-width:calc(100vw - 16px);
  background:var(--surface);border:1px solid var(--border2);border-radius:var(--r-card);
  box-shadow:var(--shadow-lg);color:var(--text);font-family:'Inter',sans-serif;
  display:none;overflow:hidden;-webkit-user-select:none;user-select:none}
#call-widget.visible{display:block}
#cw-head{display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--surface2);
  border-bottom:1px solid var(--border);cursor:grab;touch-action:none}
#call-widget.dragging #cw-head{cursor:grabbing}
#call-widget.collapsed #cw-head{border-bottom:none}
#cw-dot{width:8px;height:8px;border-radius:var(--r-pill);background:var(--success);flex-shrink:0;
  animation:cwLive 1.8s ease-in-out infinite}
@keyframes cwLive{0%,100%{opacity:1}50%{opacity:.3}}
#cw-title{flex:1;min-width:0;font-size:11px;font-weight:700;letter-spacing:.04em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cw-icon-btn{background:transparent;border:none;color:var(--muted);font-size:12px;line-height:1;
  cursor:pointer;padding:4px 6px;border-radius:var(--r-xs);transition:background .15s,color .15s}
.cw-icon-btn:hover{background:var(--surface3);color:var(--text)}
#cw-body{padding:9px 10px 10px}
#call-widget.collapsed #cw-body{display:none}
#cw-people{display:flex;flex-direction:column;gap:7px;max-height:168px;overflow-y:auto}
#cw-people::-webkit-scrollbar{width:4px}
#cw-people::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}
.cw-person{display:flex;align-items:center;gap:8px;min-width:0}
.cw-av{width:28px;height:28px;border-radius:var(--r-pill);flex-shrink:0;display:flex;align-items:center;
  justify-content:center;font-size:11px;font-weight:600;color:#fff;background:var(--accent);
  box-shadow:0 0 0 0 rgba(19,161,14,0);transition:box-shadow .12s linear}
/* Speaking = live audio above the RMS threshold, not merely "connected". */
.cw-person.speaking .cw-av{box-shadow:0 0 0 3px var(--success),0 0 12px rgba(19,161,14,.5);
  animation:cwSpeak 1s var(--ease-fluent-soft) infinite}
@keyframes cwSpeak{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
.cw-name{flex:1;min-width:0;font-size:12px;color:var(--text2);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cw-person.speaking .cw-name{color:var(--text);font-weight:600}
.cw-tag{font-size:10px;color:var(--muted2);flex-shrink:0}
.cw-hint{font-size:11px;color:var(--muted2);padding:2px 0}
#cw-actions{display:flex;gap:6px;margin-top:10px}
#cw-actions .btn{flex:1;padding:7px 4px;font-size:12px;min-width:0}
#cw-mute-btn.cw-on{background:var(--warn-soft);border-color:var(--warn);color:var(--warn-text)}
@media(max-width:700px){
  /* Small enough to sit beside the compose box, and it starts above it. */
  #call-widget{width:206px}
  #cw-body{padding:8px}
  .cw-av{width:26px;height:26px;font-size:10px}
  #cw-people{max-height:132px}
  #cw-actions .btn{font-size:11px;padding:8px 2px}
}
`;
  document.head.appendChild(style);

  const w = document.createElement('div');
  w.id = 'call-widget';
  w.innerHTML =
    '<div id="cw-head">' +
      '<span id="cw-dot"></span>' +
      '<span id="cw-title"></span>' +
      '<button class="cw-icon-btn" id="cw-expand-btn" title="Open meeting">⤢</button>' +
      '<button class="cw-icon-btn" id="cw-collapse-btn" title="Collapse">▾</button>' +
    '</div>' +
    '<div id="cw-body">' +
      '<div id="cw-people"></div>' +
      '<div id="cw-actions">' +
        '<button class="btn btn-ghost btn-sm" id="cw-mute-btn">🎙️ Mute</button>' +
        '<button class="btn btn-ghost btn-sm" id="cw-invite-btn" title="Invite someone">➕</button>' +
        '<button class="btn btn-danger btn-sm" id="cw-hangup-btn" title="End call">📴</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(w);

  const inv = document.createElement('div');
  inv.className = 'overlay';
  inv.id = 'cw-invite-modal';
  inv.innerHTML =
    '<div class="modal" style="max-width:360px">' +
      '<div class="modal-header"><h2 id="cw-invite-title">Invite</h2>' +
        '<p id="cw-invite-note"></p></div>' +
      '<div class="modal-body" style="padding-bottom:14px">' +
        '<div id="cw-invite-extra"></div><div id="cw-invite-list"></div></div>' +
      '<div class="modal-footer"><button class="btn btn-ghost btn-full" id="cw-invite-cancel">Cancel</button></div>' +
    '</div>';
  document.body.appendChild(inv);

  const head = document.getElementById('cw-head');
  head.addEventListener('pointerdown', _cwDragStart);
  head.addEventListener('pointermove', _cwDragMove);
  head.addEventListener('pointerup', _cwDragEnd);
  head.addEventListener('pointercancel', _cwDragEnd);
  document.getElementById('cw-collapse-btn').onclick = cwToggleCollapse;
  document.getElementById('cw-expand-btn').onclick = cwExpand;
  document.getElementById('cw-mute-btn').onclick = cwToggleMute;
  document.getElementById('cw-invite-btn').onclick = cwInvite;
  document.getElementById('cw-hangup-btn').onclick = cwHangUp;
  document.getElementById('cw-invite-cancel').onclick = function(){ closeModal('cw-invite-modal'); };
  try{
    if(localStorage.getItem('cw_collapsed') === '1'){
      w.classList.add('collapsed');
      document.getElementById('cw-collapse-btn').textContent = '▴';
    }
  }catch(e){}

  window.addEventListener('resize', _cwClamp);
  window.addEventListener('orientationchange', ()=>setTimeout(_cwClamp, 250));
  _cwHookVoiceBar();
  if(_cwTimer) clearInterval(_cwTimer);
  // One timer does both jobs: watching the two call-state globals (cheap) and
  // sampling the analysers while a call is up.
  _cwTimer = setInterval(()=>{ try{ _cwTick(); }catch(e){ console.warn('[call-widget] tick failed', e); } }, 180);
}

try{ initCallWidget(); }
catch(e){ console.error('call widget init failed', e); }

try{ initThemeColors(); applyLanguage(); }
catch(e){ console.error('feature theme/lang init failed', e); }
// Paints the login screen's Google buttons (or their honest disabled state).
// Safe to run whether or not anyone is signed in: if they are, the login modal
// isn't on screen and this is a no-op beyond the lookups.
try{ initGoogleSignIn(); }
catch(e){ console.error('Google sign-in init failed', e); }

// Delegated click handler for JS-built UI. Dynamic `onclick="…"` strings in
// innerHTML are not covered by the CSP hashes (console spam), so those
// elements carry data-act instead and are dispatched here.
document.addEventListener('click', function(e){
  const t = e.target.closest && e.target.closest('[data-act]');
  if(!t) return;
  const d = t.dataset;
  switch(d.act){
    case 'bizView': openBizViewModal(lookupUser(Number(d.number))); break;
    case 'dismissGroupDesc': dismissGroupDescBanner(d.key); break;
    case 'removeMember': removeMember(t.closest('.chip').dataset.num); break;
    case 'toggleAddGroupMember': toggleAddGroupMember(t.closest('.chip').dataset.num); break;
    case 'removeBizBotRule': removeBizBotRule(Number(d.i)); break;
    case 'dashOpenChat': dashOpenChat(d.key, d.chId); break;
    case 'dashJoinVoice': dashJoinVoice(d.key, d.chId); break;
    case 'dashOpenChatByNumber': dashOpenChatByNumber(Number(d.number)); break;
    case 'channelPill': (d.chType==='voice' ? joinVoiceChannel : switchChannel)(d.chId); break;
    case 'closeModalById': closeModal(d.modal); break;
    case 'openBadgeDetail': openBadgeDetail(d.cat, Number(d.badgeNumber)); break;
    case 'copyEmail':
      navigator.clipboard.writeText(d.email)
        .then(function(){ showToast('Copied','Email address copied to clipboard.'); })
        .catch(function(){ showToast('Copy failed','Please copy manually: '+d.email); });
      break;
    case 'callLogCallback': {
      const c = contacts.find(function(x){ return x.type!=='group' && String(x.number)===d.number; });
      if(c) startDirectCall(c); else showToast('Not in contacts','');
      break;
    }
    case 'copyCloseDlg': {
      const dlg = t.closest('div[style*=fixed]');
      const ta = dlg && dlg.querySelector('textarea');
      if(ta) navigator.clipboard.writeText(ta.value).then(function(){ showToast('Copied!',''); });
      if(dlg) dlg.remove();
      break;
    }
    case 'closeDlg': { const dlg = t.closest('div[style*=fixed]'); if(dlg) dlg.remove(); break; }
  }
});
// Change events (selects) and image-load failures for JS-built UI, for the
// same reason as the click handler above.
document.addEventListener('change', function(e){
  const t = e.target.closest && e.target.closest('[data-change]');
  if(!t) return;
  if(t.dataset.change==='shadowMuteHours' && t.value){
    adminShadowMuteForHours(Number(t.dataset.number), Number(t.value));
    t.value='';
  }
});
// 'error' does not bubble, so listen in the capture phase.
document.addEventListener('error', function(e){
  const t = e.target;
  if(t && t.tagName==='IMG' && t.dataset && t.dataset.initFallback!==undefined && t.parentNode){
    t.parentNode.textContent = t.dataset.initFallback;
  }
}, true);

// Accessibility pass for the static markup: dialog semantics for every modal,
// accessible names for icon-only buttons, and a polite live region for toasts.
(function a11yEnhance(){
  try{
    document.querySelectorAll('.overlay').forEach(function(ov){
      if(!ov.hasAttribute('role')) ov.setAttribute('role','dialog');
      if(!ov.hasAttribute('aria-modal')) ov.setAttribute('aria-modal','true');
      if(!ov.hasAttribute('aria-labelledby')&&!ov.hasAttribute('aria-label')){
        const h=ov.querySelector('h1,h2,h3');
        if(h){ if(!h.id) h.id=(ov.id||'modal')+'-title'; ov.setAttribute('aria-labelledby',h.id); }
      }
    });
    const names={'✕':'Close','✖':'Close','×':'Close','←':'Back','→':'Next','➤':'Send','+':'Add','⋮':'More options','☰':'Menu','🔍':'Search'};
    document.querySelectorAll('button:not([aria-label])').forEach(function(b){
      const txt=(b.textContent||'').trim();
      if(txt.length>2) return;
      const nm=b.getAttribute('title')||names[txt];
      if(nm) b.setAttribute('aria-label',nm);
    });
    const regen=document.getElementById('gp-invite-regen-btn');
    if(regen&&!regen.hasAttribute('aria-label')) regen.setAttribute('aria-label','Regenerate invite code');
    // Honeypot field: must stay invisible to people and assistive tech.
    const hp=document.getElementById('hp-website');
    if(hp){ hp.setAttribute('aria-hidden','true'); hp.setAttribute('tabindex','-1'); hp.setAttribute('autocomplete','off'); }
    // Give every unlabeled text-like control an accessible name: a preceding
    // <label>, else PIN-digit position, else a readable form of its id.
    const skip={hidden:1,checkbox:1,radio:1,file:1,submit:1,button:1};
    document.querySelectorAll('input,textarea,select').forEach(function(c){
      if(skip[c.type]||c.id==='hp-website') return;
      if(c.getAttribute('aria-label')||c.getAttribute('aria-labelledby')||c.placeholder||c.title||c.closest('label')) return;
      if(c.id&&document.querySelector('label[for="'+c.id+'"]')) return;
      let nm='';
      const prev=c.previousElementSibling;
      if(prev&&prev.tagName==='LABEL') nm=prev.textContent.trim();
      if(!nm&&c.type==='password'&&c.maxLength===1){
        const grp=Array.prototype.filter.call(c.parentElement.children,function(n){ return n.tagName==='INPUT'&&n.maxLength===1; });
        nm='PIN digit '+(grp.indexOf(c)+1)+' of '+grp.length;
      }
      if(!nm&&c.id) nm=c.id.replace(/-(select|input)$/,'').replace(/[-_]+/g,' ').trim();
      if(!nm&&c.type==='password') nm='Password';
      if(nm) c.setAttribute('aria-label',nm.charAt(0).toUpperCase()+nm.slice(1));
    });
    const toast=document.getElementById('toast');
    if(toast){
      toast.setAttribute('role','status');
      toast.setAttribute('aria-live','polite');
      toast.setAttribute('aria-atomic','false');
    }
  }catch(e){ console.warn('a11y enhance failed',e); }
})();

// Keep Tab inside the topmost open modal so focus can't wander to the page
// behind it.
document.addEventListener('keydown',function(e){
  if(e.key!=='Tab'||e.defaultPrevented||!_modalZStack.length) return;
  const top=document.getElementById(_modalZStack[_modalZStack.length-1].id);
  if(!top||!top.classList.contains('visible')) return;
  const f=Array.prototype.filter.call(
    top.querySelectorAll('a[href],button,input,select,textarea,[tabindex]'),
    function(n){ return n.tabIndex>=0&&!n.disabled&&n.type!=='hidden'&&n.offsetParent!==null; });
  if(!f.length){ e.preventDefault(); return; }
  const first=f[0], last=f[f.length-1], ae=document.activeElement;
  if(!top.contains(ae)){ e.preventDefault(); first.focus(); }
  else if(e.shiftKey&&(ae===first||ae===top.querySelector('.modal'))){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey&&ae===last){ e.preventDefault(); first.focus(); }
});

// Wait for every script file before starting the app.
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>init());
else init();
