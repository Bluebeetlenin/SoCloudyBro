// -- CHANNELS (text + voice, per group) -----------------------------------------
let activeChannelId='general';
function ensureChannels(c){
  if(!c.channels||!c.channels.length){
    c.channels=c.isServer
      ?[{id:'general',name:'general',type:'text',order:0},{id:'announcements',name:'announcements',type:'text',order:1},{id:'voice',name:'Voice Chat',type:'voice',order:2}]
      :[{id:'general',name:'general',type:'text',order:0},{id:'voice',name:'Voice Chat',type:'voice',order:1}];
    return true; // caller should persist
  }
  return false;
}
function sortedChannels(c){ return (c.channels||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0)); }
function pickDefaultChannel(c){
  ensureChannels(c);
  const chans=sortedChannels(c);
  const text=chans.find(ch=>ch.type==='text');
  return text?text.id:(chans[0]?chans[0].id:'general');
}
function getActiveConvoObj(){
  return activeConvo&&convosCache?convosCache.find(x=>x&&x.key===activeConvo.key):null;
}
function renderChannelBar(c){
  const bar=document.getElementById('channel-bar');
  if(!bar) return;
  ensureChannels(c);
  const admin=isGroupAdmin();
  const chans=sortedChannels(c);
  bar.innerHTML=chans.map((ch,i)=>{
    const icon=ch.emoji||(ch.type==='voice'?'🔊':'#');
    const active=ch.type==='text'&&ch.id===activeChannelId;
    const countBadge=ch.type==='voice'?'<span class="ch-voice-count" data-ch="'+ch.id+'" style="opacity:.7"></span>':'';
    let adminBtns='';
    if(admin){
      adminBtns='<span class="ch-mini-btn" data-ch-id="'+ch.id+'" onclick="event.stopPropagation();moveChannel(this.dataset.chId,-1)" title="Move left">◀</span>'
        +'<span class="ch-mini-btn" data-ch-id="'+ch.id+'" onclick="event.stopPropagation();moveChannel(this.dataset.chId,1)" title="Move right">▶</span>'
        +'<span class="ch-mini-btn" data-ch-id="'+ch.id+'" onclick="event.stopPropagation();changeChannelIcon(this.dataset.chId)" title="Change icon">🎨</span>'
        +'<span class="ch-mini-btn" data-ch-id="'+ch.id+'" onclick="event.stopPropagation();renameChannelPrompt(this.dataset.chId)" title="Rename">✏️</span>'
        +(chans.length>1?'<span class="ch-mini-btn" data-ch-id="'+ch.id+'" onclick="event.stopPropagation();deleteChannelConfirm(this.dataset.chId)" title="Delete">🗑️</span>':'');
    }
    return '<span class="channel-group"><span class="channel-pill'+(active?' active':'')+'" data-ch-id="'+ch.id+'" data-ch-type="'+ch.type+'" data-act="channelPill">'+icon+' '+esc(ch.name)+countBadge+'</span>'+adminBtns+'</span>';
  }).join('')
  + (admin?'<span class="channel-add-btn" onclick="openAddChannelModal()" title="Add channel">+</span>':'');
}
async function changeChannelIcon(id){
  if(!isGroupAdmin()) return;
  const conv=getActiveConvoObj();
  if(!conv) return;
  const ch=(conv.channels||[]).find(c=>c.id===id);
  if(!ch) return;
  const val=prompt('Set a custom icon for #'+ch.name+' (paste any single emoji, or leave blank to reset to default)',ch.emoji||'');
  if(val===null) return;
  ch.emoji=val.trim().slice(0,4)||null;
  try{ await saveConvos(); renderChannelBar(conv); }
  catch(e){ showToast('Failed',scbErr('SCB-GRP-04','That channel change couldn\'t be saved — the server rejected the write.',(e.message||''))); }
}
function switchChannel(id){
  const conv=getActiveConvoObj();
  if(!conv) return;
  activeChannelId=id;
  renderChannelBar(conv);
  renderPinnedBanner(conv);
  renderCrossChannelTyping(conv);
  lastMsgHash='';
  renderMessages(conv.messages);
}
function openAddChannelModal(){
  if(!isGroupAdmin()){ showToast('Admins only',scbErr('SCB-GRP-05','Only group admins can add channels.')); return; }
  document.getElementById('add-channel-name').value='';
  document.getElementById('add-channel-type').value='text';
  document.getElementById('add-channel-error').textContent='';
  openModal('add-channel-modal');
}
async function submitAddChannel(){
  const conv=getActiveConvoObj();
  if(!conv) return;
  // Same asymmetry as submitAddGroupMembers: openAddChannelModal() checks
  // admin, the actual write did not. Every other channel mutation
  // (rename/delete/move/icon) already re-checks here.
  if(!isGroupAdmin()){ document.getElementById('add-channel-error').textContent=scbErr('SCB-GRP-06','Only group admins can add channels.'); return; }
  const name=document.getElementById('add-channel-name').value.trim();
  const type=document.getElementById('add-channel-type').value;
  const err=document.getElementById('add-channel-error');
  if(!name){err.textContent=scbErr('SCB-GRP-07','Enter a channel name.');return;}
  ensureChannels(conv);
  const id=(type==='voice'?'voice_':'text_')+Date.now().toString(36);
  const maxOrder=Math.max(-1,...conv.channels.map(c=>c.order||0));
  conv.channels.push({id,name,type,order:maxOrder+1});
  try{
    await saveConvos();
    closeModal('add-channel-modal');
    renderChannelBar(conv);
    if(type==='text') switchChannel(id);
    refreshVoiceParticipantCounts(conv);
  }catch(e){ err.textContent=scbErr('SCB-GRP-08','That channel couldn\'t be created — the server rejected the write.',e.message); }
}
async function renameChannelPrompt(id){
  if(!isGroupAdmin()) return;
  const conv=getActiveConvoObj();
  if(!conv) return;
  const ch=(conv.channels||[]).find(c=>c.id===id);
  if(!ch) return;
  const name=prompt('Rename channel',ch.name);
  if(!name||!name.trim()) return;
  ch.name=name.trim();
  try{ await saveConvos(); renderChannelBar(conv); }
  catch(e){ showToast('Rename failed',scbErr('SCB-GRP-09','That channel couldn\'t be renamed — the server rejected the write.',(e.message||''))); }
}
async function deleteChannelConfirm(id){
  if(!isGroupAdmin()) return;
  const conv=getActiveConvoObj();
  if(!conv||!conv.channels||conv.channels.length<=1) return;
  const ch=conv.channels.find(c=>c.id===id);
  if(!ch) return;
  if(!confirm('Delete #'+ch.name+'? '+(ch.type==='text'?'Messages in it will stay in the database but be hidden from the channel bar.':'Anyone currently in this voice channel will be disconnected.'))) return;
  conv.channels=conv.channels.filter(c=>c.id!==id);
  if(ch.type==='voice'&&voiceChannelActive&&voiceChannelActive.channelId===id) leaveVoiceChannel();
  try{
    await saveConvos();
    if(activeChannelId===id) activeChannelId=pickDefaultChannel(conv);
    renderChannelBar(conv);
    lastMsgHash=''; renderMessages(conv.messages);
  }catch(e){ showToast('Delete failed',scbErr('SCB-GRP-10','That channel couldn\'t be deleted — the server rejected the write.',(e.message||''))); }
}
async function moveChannel(id,dir){
  if(!isGroupAdmin()) return;
  const conv=getActiveConvoObj();
  if(!conv) return;
  const chans=sortedChannels(conv);
  const idx=chans.findIndex(c=>c.id===id);
  const swapIdx=idx+dir;
  if(idx<0||swapIdx<0||swapIdx>=chans.length) return;
  const a=chans[idx], b=chans[swapIdx];
  const tmp=a.order; a.order=b.order; b.order=tmp;
  try{ await saveConvos(); renderChannelBar(conv); }
  catch(e){ showToast('Reorder failed',scbErr('SCB-GRP-11','The channel order couldn\'t be saved — the server rejected the write.',(e.message||''))); }
}

// -- VOICE CHANNELS (WebRTC mesh, signaled over Firebase) -----------------------
// Best-effort peer-to-peer mesh suited to small groups (a handful of people per
// channel). This previously used STUN only, with a comment claiming that was
// "good enough for normal home/mobile connections" — that assumption was wrong.
// STUN alone cannot traverse symmetric NAT, which is exactly what most mobile
// carriers use (CGNAT) and what a lot of ordinary home routers use too. Without
// a TURN server to relay media when a direct peer-to-peer connection can't be
// established, calls between two people on typical networks (e.g. one on mobile
// data) will silently fail to connect — this is almost certainly why calls/voice
// chat haven't been working reliably. Added the Open Relay Project's public demo
// TURN server below (its username/password are intentionally public, meant to be
// embedded exactly like this for testing/small projects — not a leaked secret).
// This is a genuine fix, but it's a shared free relay with no uptime or bandwidth
// guarantee — fine for now, but a real production TURN provider (Twilio, Metered,
// Xirsys, Cloudflare Calls, or a self-hosted coturn instance) is worth moving to
// once this app has real usage, since a shared demo relay can get rate-limited or
// go down without notice.
const RTC_ICE_SERVERS=[
  {urls:'stun:stun.l.google.com:19302'},
  {urls:'stun:stun1.l.google.com:19302'},
  {urls:'stun:stun.cloudflare.com:3478'},
  {urls:'stun:stun.relay.metered.ca:80'},
  {urls:'turn:global.relay.metered.ca:80',username:'openrelayproject',credential:'openrelayproject'},
  {urls:'turn:global.relay.metered.ca:80?transport=tcp',username:'openrelayproject',credential:'openrelayproject'},
  {urls:'turn:global.relay.metered.ca:443',username:'openrelayproject',credential:'openrelayproject'},
  {urls:'turns:global.relay.metered.ca:443?transport=tcp',username:'openrelayproject',credential:'openrelayproject'},
  // legacy fallback
  {urls:'turn:openrelay.metered.ca:443',username:'openrelayproject',credential:'openrelayproject'},
  {urls:'turn:openrelay.metered.ca:443?transport=tcp',username:'openrelayproject',credential:'openrelayproject'}
];
let voiceChannelActive=null; // {convoKey, channelId, path}
let voicePeers={}; // number -> RTCPeerConnection
let voiceLocalStream=null;
let voiceMuted=false;
let _voiceRefs=[]; // firebase refs+handlers to detach on leave
function voicePath(convoKey,channelId){ return 'voice/'+convoKey.replace(/[^a-zA-Z0-9_]/g,'_')+'_'+channelId; }
// This attached a fresh, never-detached Firebase 'value' listener for every
// voice channel on every call — and it is called from the channel-bar render,
// so opening/switching a group repeatedly piled up duplicate live listeners
// on the same paths (each one re-writing the same count). Track them per path
// and detach the ones that no longer belong to the conversation on screen.
const _voiceCountListeners={}; // path -> {ref,handler}
function _dropVoiceCountListeners(keepPaths){
  Object.keys(_voiceCountListeners).forEach(p=>{
    if(keepPaths&&keepPaths.has(p)) return;
    const l=_voiceCountListeners[p];
    try{ l.ref.off('value',l.handler); }catch(e){}
    delete _voiceCountListeners[p];
  });
}
function refreshVoiceParticipantCounts(conv){
  ensureChannels(conv);
  const wanted=new Set();
  sortedChannels(conv).filter(ch=>ch.type==='voice').forEach(ch=>{
    const path=voicePath(conv.key,ch.id);
    wanted.add(path);
  });
  _dropVoiceCountListeners(wanted);
  sortedChannels(conv).filter(ch=>ch.type==='voice').forEach(ch=>{
    const path=voicePath(conv.key,ch.id);
    if(_voiceCountListeners[path]) return; // already watching this channel
    const ref=fbdb.ref(path+'/participants');
    const handler=ref.on('value',snap=>{
      const val=snap.val()||{};
      const n=Object.keys(val).length;
      const el=document.querySelector('.ch-voice-count[data-ch="'+ch.id+'"]');
      if(el){
        el.textContent=n?(' · '+n):'';
        if(n){
          const names=Object.values(val).map(p=>{const nm=typeof p==='object'&&p.name?dec(p.name):'';return nm||'?';}).slice(0,6).join(', ');
          el.title=names+(n>6?' and '+(n-6)+' more':'');
        } else { el.title=''; }
      }
    },err=>{ console.warn('voice count listener error',err); });
    _voiceCountListeners[path]={ref,handler};
  });
}
async function joinVoiceChannel(channelId){
  const conv=getActiveConvoObj();
  if(!conv||!me) return;
  if(voiceChannelActive){
    if(!voiceChannelActive.isDm&&voiceChannelActive.channelId===channelId) return; // already in it
    leaveVoiceChannel();
  }
  const chName=((conv.channels||[]).find(c=>c.id===channelId)||{}).name||'Voice';
  const path=voicePath(conv.key,channelId);
  const ok=await _startVoiceSession(path,'🔊 '+chName);
  if(!ok) return;
  voiceChannelActive.convoKey=conv.key;
  voiceChannelActive.channelId=channelId;
  voiceChannelActive.isDm=false;
  renderChannelBar(conv);
  showToast('Joined voice','🔊 '+chName);
}
// Shared low-level connector used by both group voice channels and direct
// (DM) calls — sets up the mic, the Firebase-signaled peer mesh, and the
// voice bar. Callers set convoKey/channelId/isDm on voiceChannelActive after.
let _startingVoiceSession=false;
async function _startVoiceSession(path,label){
  // Reentrancy guard: voiceChannelActive (the check right below) is only
  // assigned once getUserMedia resolves, further down — it stays null for
  // the whole span a mic-permission prompt or a slow Firebase round-trip can
  // take. Without this, a fast double-click/tap on "join voice" starts two
  // concurrent sessions: two getUserMedia streams, two voicePeers maps. The
  // loser's assignment to voiceChannelActive/voicePeers gets clobbered by
  // whichever finishes last, and nothing ever .stop()s the loser's stream or
  // .close()s its peer connections — the mic indicator stays on even after
  // the user leaves.
  if(_startingVoiceSession) return false;
  _startingVoiceSession=true;
  // Never start a second session on top of a live one. joinVoiceChannel() did
  // this itself, but the DM-call path did not: accepting an incoming call
  // while already in one replaced voiceChannelActive and reset voicePeers={}
  // without tearing the first call down — its RTCPeerConnections stayed open
  // (mic audio still flowing to the first call), its Firebase listeners stayed
  // attached, its participants entry was never removed, and its calls/<pair>
  // record stayed "active" forever.
  if(voiceChannelActive) leaveVoiceChannel();
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    showToast('Not supported',scbErr('SCB-CALL-01','Voice needs microphone access (try https).'));
    _startingVoiceSession=false;
    return false;
  }
  try{
    const noiseSuppressOn=localStorage.getItem('cc_noise_suppress')!=='0'; // on by default
    voiceLocalStream=await navigator.mediaDevices.getUserMedia({audio:{
      noiseSuppression:noiseSuppressOn,
      echoCancellation:true,
      autoGainControl:true
    }});
  }catch(e){
    const {note}=await selfHeal('SCB-CALL-02',e,{context:'_startVoiceSession',silent:true});
    showToast('Microphone unavailable',scbErr('SCB-CALL-02',note));
    _startingVoiceSession=false;
    return false;
  }
  const sessionStart=Date.now();
  voiceChannelActive={path,label,sessionStart};
  voicePeers={};
  _startingVoiceSession=false; // voiceChannelActive now guards future calls
  const myRef=fbdb.ref(path+'/participants/'+me.number);
  await myRef.set({name:me.name,joinedAt:Date.now()});
  myRef.onDisconnect().remove();
  // The signalling path is derived from the conversation + channel, so it is
  // IDENTICAL for every call ever placed between the same two people (or in
  // the same voice channel). leaveVoiceChannel() clears my own inbox, but a
  // peer that died abnormally (tab closed, network drop) never cleared what it
  // had written into mine — so the next session's fresh listener immediately
  // read a previous call's offer and ICE candidates (pc._appliedSdpV is unset
  // on a new RTCPeerConnection, so nothing suppressed them), answered it, and
  // poisoned the new negotiation. Clearing my own inbox before attaching the
  // listener, plus an onDisconnect() so an abnormal exit clears it too, means
  // no session can ever be handed a previous one's signalling data.
  const sigMineRef=fbdb.ref(path+'/signals/'+me.number);
  try{ await sigMineRef.remove(); }catch(e){}
  try{ sigMineRef.onDisconnect().remove(); }catch(e){}
  // React to participant list changes: connect to anyone new.
  const partRef=fbdb.ref(path+'/participants');
  const partHandler=partRef.on('value',snap=>{
    // Session-scoped for the same reason as the signalling handler below: a
    // participants event from a previous session must not drive this one's
    // peer mesh, and must never reach the "everyone left, hang up" branch and
    // end a different, live call.
    if(!voiceChannelActive||voiceChannelActive.path!==path||voiceChannelActive.sessionStart!==sessionStart) return;
    const val=snap.val()||{};
    renderVoiceBar(val);
    Object.keys(val).map(Number).forEach(num=>{
      if(num===me.number||voicePeers[num]) return;
      ensureVoicePeer(path,num);
    });
    Object.keys(voicePeers).map(Number).forEach(num=>{
      if(!val[num]) teardownVoicePeer(num);
    });
    // 1:1 calls end for both sides once the other person leaves (but not
    // before they've actually joined in the first place).
    if(voiceChannelActive&&voiceChannelActive.isDm){
      const othersLeft=Object.keys(val).map(Number).filter(n=>n!==me.number);
      if(othersLeft.length) voiceChannelActive._hadOtherParticipant=true;
      else if(voiceChannelActive._hadOtherParticipant){
        showToast('Call ended','');
        leaveVoiceChannel();
      }
    }
  },err=>{ console.warn('voice participants listener error',err); });
  _voiceRefs.push({ref:partRef,event:'value',handler:partHandler});
  // Listen for signals addressed to me. Uses the standard WebRTC "perfect
  // negotiation" pattern (polite/impolite by number comparison) so either
  // side can safely trigger renegotiation later — needed for screen share.
  const sigRef=sigMineRef;
  const sigHandler=sigRef.on('value',async snap=>{
    // Every delivery is re-scoped to the session that asked for it. A handler
    // that outlives its session (a failed .off(), or an async hop that lands
    // after the user switched channels/calls) would otherwise apply one call's
    // offers and ICE candidates to whatever session happens to be active.
    if(!voiceChannelActive||voiceChannelActive.path!==path||voiceChannelActive.sessionStart!==sessionStart) return;
    const val=snap.val()||{};
    for(const fromStr of Object.keys(val)){
      const from=Number(fromStr);
      const entry=val[fromStr];
      if(!entry) continue;
      const pc=ensureVoicePeer(path,from);
      // Belt and braces alongside the inbox wipe above: an SDP stamped before
      // this session started belongs to an earlier call and is never applied.
      if(entry.sdp && entry.sdp._v!==pc._appliedSdpV && !(Number(entry.sdp._v)<sessionStart-5000)){
        const desc=entry.sdp;
        pc._appliedSdpV=desc._v;
        const isOffer=desc.type==='offer';
        const collision=isOffer&&(pc._makingOffer||pc.signalingState!=='stable');
        const ignoreOffer=pc._polite===false&&collision;
        if(!ignoreOffer){
          try{
            if(collision){ await Promise.all([pc.setLocalDescription({type:'rollback'}),pc.setRemoteDescription(desc)]); }
            else{ await pc.setRemoteDescription(desc); }
            if(isOffer){
              const answer=await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await fbdb.ref(path+'/signals/'+from+'/'+me.number+'/sdp').set({type:answer.type,sdp:answer.sdp,_v:Date.now()});
            }
          }catch(e){}
        }
      }
      if(entry.candidates){
        pc._seenCandidates=pc._seenCandidates||{};
        for(const cid of Object.keys(entry.candidates)){
          if(pc._seenCandidates[cid]) continue;
          pc._seenCandidates[cid]=true;
          const cand=entry.candidates[cid];
          if(cand){ try{ await pc.addIceCandidate(cand); }catch(e){} }
        }
      }
    }
  },err=>{ console.warn('voice signalling listener error',err); });
  _voiceRefs.push({ref:sigRef,event:'value',handler:sigHandler});
  document.getElementById('voice-bar').style.display='flex';
  return true;
}
function ensureVoicePeer(path,otherNum){
  if(voicePeers[otherNum]) return voicePeers[otherNum];
  const pc=new RTCPeerConnection({iceServers:RTC_ICE_SERVERS});
  pc._polite=me.number>otherNum; // deterministic tie-break, same on both ends
  pc._makingOffer=false;
  voicePeers[otherNum]=pc;
  if(voiceLocalStream) voiceLocalStream.getTracks().forEach(t=>pc.addTrack(t,voiceLocalStream));
  if(localScreenStream) localScreenStream.getTracks().forEach(t=>pc.addTrack(t,localScreenStream));
  pc.onicecandidate=e=>{
    if(e.candidate) fbdb.ref(path+'/signals/'+otherNum+'/'+me.number+'/candidates').push(e.candidate.toJSON());
  };
  pc.oniceconnectionstatechange=()=>{
    const s=pc.iceConnectionState;
    if(s==='failed'){
      try{ pc.restartIce(); }catch(e){}
      showToast('Call quality issue','Reconnecting…');
    } else if(s==='disconnected'){
      // give 8 s for auto-recovery before notifying
      setTimeout(()=>{ if(pc.iceConnectionState==='disconnected') showToast('Call interrupted','Connection dropped — waiting to recover…'); },8000);
    }
  };
  pc.ontrack=e=>{
    if(e.track.kind==='video'){
      showRemoteScreenTile(otherNum,e.streams[0]);
      e.track.onended=()=>removeRemoteScreenTile(otherNum);
    }else{
      let audioEl=document.getElementById('voice-audio-'+otherNum);
      if(!audioEl){
        audioEl=document.createElement('audio');
        audioEl.id='voice-audio-'+otherNum;
        audioEl.autoplay=true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject=e.streams[0];
    }
  };
  pc.onnegotiationneeded=async()=>{
    try{
      pc._makingOffer=true;
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      await fbdb.ref(path+'/signals/'+otherNum+'/'+me.number+'/sdp').set({type:offer.type,sdp:offer.sdp,_v:Date.now()});
    }catch(e){}
    finally{ pc._makingOffer=false; }
  };
  return pc;
}
function teardownVoicePeer(num){
  const pc=voicePeers[num];
  if(pc){ try{ pc.close(); }catch(e){} delete voicePeers[num]; }
  const audioEl=document.getElementById('voice-audio-'+num);
  if(audioEl) audioEl.remove();
  removeRemoteScreenTile(num);
}
function renderVoiceBar(participants){
  const bar=document.getElementById('voice-bar');
  if(!bar||!voiceChannelActive) return;
  const names=Object.keys(participants).map(n=>{
    const p=participants[n];
    const isMe=Number(n)===me.number;
    return '<span class="voice-participant'+(isMe&&voiceMuted?' muted':'')+'">'+(isMe?'🎙️ You'+(voiceMuted?' (muted)':''):'🔊 '+esc(p.name||('#'+n)))+'</span>';
  }).join('');
  bar.innerHTML='<b style="font-size:12px">'+esc(voiceChannelActive.label||'Voice')+'</b>'+names
    +'<button class="btn btn-ghost btn-sm" onclick="toggleVoiceMute()">'+(voiceMuted?'🎙️ Unmute':'🔇 Mute')+'</button>'
    +'<button class="btn btn-ghost btn-sm" onclick="toggleScreenShare()">'+(localScreenStream?'🛑 Stop sharing':'🖥️ Share screen')+'</button>'
    +'<button class="btn btn-danger btn-sm" onclick="leaveVoiceChannel()">'+(voiceChannelActive.isDm?'Hang up':'Leave')+'</button>'
    +'<div id="screen-share-grid"></div>';
  if(localScreenStream) showLocalScreenTile();
  Object.keys(_remoteScreenStreams).forEach(num=>showRemoteScreenTile(Number(num),_remoteScreenStreams[num]));
}
function toggleVoiceMute(){
  if(!voiceLocalStream||!voiceChannelActive) return;
  voiceMuted=!voiceMuted;
  voiceLocalStream.getAudioTracks().forEach(t=>t.enabled=!voiceMuted);
  refreshVoiceBarNow();
}

// -- SCREEN SHARING (adds a video track to the existing voice-channel peers) ----
let localScreenStream=null;
const _remoteScreenStreams={};
let _startingScreenShare=false;
async function toggleScreenShare(){
  if(localScreenStream){ stopScreenShare(); return; }
  if(!voiceChannelActive){ showToast('Join a voice channel first',scbErr('SCB-CALL-03','Join a voice channel before sharing your screen.')); return; }
  if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){
    showToast('Not supported',scbErr('SCB-CALL-04','Screen sharing needs a desktop browser with getDisplayMedia support.'));
    return;
  }
  // Reentrancy guard: localScreenStream isn't assigned until getDisplayMedia
  // resolves, so a double-click while the OS screen-picker is open could
  // otherwise start a second capture before the first one's picker closes —
  // whichever resolves last wins the assignment, orphaning the other
  // capture's tracks (never stopped, so the browser's "sharing" indicator
  // can stay on even after the user clicks "Stop sharing").
  if(_startingScreenShare) return;
  _startingScreenShare=true;
  try{
    localScreenStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
  }catch(e){ return; } // user cancelled the picker
  finally{ _startingScreenShare=false; }
  const track=localScreenStream.getVideoTracks()[0];
  track.onended=()=>stopScreenShare();
  Object.values(voicePeers).forEach(pc=>pc.addTrack(track,localScreenStream));
  refreshVoiceBarNow();
}
function stopScreenShare(){
  if(!localScreenStream) return;
  const track=localScreenStream.getVideoTracks()[0];
  Object.values(voicePeers).forEach(pc=>{
    const sender=pc.getSenders().find(s=>s.track===track);
    if(sender){ try{ pc.removeTrack(sender); }catch(e){} }
  });
  localScreenStream.getTracks().forEach(t=>t.stop());
  localScreenStream=null;
  removeLocalScreenTile();
  refreshVoiceBarNow();
}
function refreshVoiceBarNow(){
  if(!voiceChannelActive) return;
  fbdb.ref(voiceChannelActive.path+'/participants').get().then(s=>renderVoiceBar(s.val()||{}));
}
function showLocalScreenTile(){
  const grid=document.getElementById('screen-share-grid');
  if(!grid) return;
  let tile=document.getElementById('screen-tile-me');
  if(!tile){
    tile=document.createElement('div'); tile.id='screen-tile-me'; tile.className='screen-tile';
    tile.innerHTML='<div class="screen-tile-label">You (sharing)</div><video autoplay muted playsinline></video>';
    grid.appendChild(tile);
  }
  const v=tile.querySelector('video');
  if(v.srcObject!==localScreenStream) v.srcObject=localScreenStream;
}
function removeLocalScreenTile(){
  const tile=document.getElementById('screen-tile-me');
  if(tile) tile.remove();
}
function showRemoteScreenTile(num,stream){
  _remoteScreenStreams[num]=stream;
  const grid=document.getElementById('screen-share-grid');
  if(!grid) return;
  let tile=document.getElementById('screen-tile-'+num);
  if(!tile){
    tile=document.createElement('div'); tile.id='screen-tile-'+num; tile.className='screen-tile';
    const u=lookupUser(num)||{};
    tile.innerHTML='<div class="screen-tile-label">'+esc(dec(u.name)||'#'+num)+'</div><video autoplay playsinline></video>';
    grid.appendChild(tile);
  }
  const v=tile.querySelector('video');
  if(v.srcObject!==stream) v.srcObject=stream;
}
function removeRemoteScreenTile(num){
  delete _remoteScreenStreams[num];
  const tile=document.getElementById('screen-tile-'+num);
  if(tile) tile.remove();
}
function leaveVoiceChannel(){
  if(!voiceChannelActive) return;
  const {path,isDm,pairKey}=voiceChannelActive;
  // Capture call tracking state before clearing
  const wasOutgoing=_dmCallIsOutgoing;
  const callConvKey=_dmCallConvKey;
  const callStart=_dmCallStartTime;
  const callOtherNum=_dmCallOtherNum;
  if(localScreenStream) stopScreenShare();
  _voiceRefs.forEach(({ref,event,handler})=>{ try{ ref.off(event,handler); }catch(e){} });
  _voiceRefs=[];
  Object.keys(voicePeers).map(Number).forEach(teardownVoicePeer);
  voicePeers={};
  if(voiceLocalStream){ voiceLocalStream.getTracks().forEach(t=>t.stop()); voiceLocalStream=null; }
  try{ fbdb.ref(path+'/participants/'+me.number).remove(); }catch(e){}
  try{ fbdb.ref(path+'/signals/'+me.number).remove(); }catch(e){}
  if(isDm&&pairKey){ try{ fbdb.ref('calls/'+pairKey).remove(); }catch(e){} }
  voiceChannelActive=null; voiceMuted=false;
  _dmCallStartTime=null; _dmCallOtherNum=null; _dmCallConvKey=null; _dmCallIsOutgoing=false;
  const bar=document.getElementById('voice-bar');
  if(bar){ bar.style.display='none'; bar.innerHTML=''; }
  if(!isDm){ const conv=getActiveConvoObj(); if(conv) renderChannelBar(conv); }
  // Caller injects chat message (avoid duplicate — receiver only logs to history)
  if(isDm && wasOutgoing && callConvKey && callStart){
    const durSecs=Math.round((Date.now()-callStart)/1000);
    const otherContact=contacts?contacts.find(x=>x.type!=='group'&&String(x.number)===String(callOtherNum)):null;
    logCallHistory({dir:'out',number:callOtherNum||0,name:otherContact?otherContact.name:'',time:callStart,duration:durSecs,initiator:me.number});
    injectCallEventMsg(callConvKey,'voice',durSecs,false,me.number);
  } else if(isDm && !wasOutgoing && callConvKey && callStart){
    const durSecs=Math.round((Date.now()-callStart)/1000);
    const otherContact=contacts?contacts.find(x=>x.type!=='group'&&String(x.number)===String(callOtherNum)):null;
    logCallHistory({dir:'in',number:callOtherNum||0,name:otherContact?otherContact.name:'',time:callStart,duration:durSecs,initiator:callOtherNum||0});
  }
}

// -- QUICK (DIRECT) CALLS — WhatsApp-style ring/accept/decline on top of the
// same voice session plumbing used for group voice channels. ------------------
function callPath(dmKey){ return voicePath(dmKey,'call'); }
const CALL_PRESENCE_MAX_MS=6*60*60*1000; // 6h — past this an "active" call record is treated as orphaned
let _outgoingCallPairKey=null, _outgoingCallRef=null, _outgoingCallHandler=null, _outgoingCallContact=null, _outgoingCallTimeoutTimer=null;
const OUTGOING_CALL_RING_TIMEOUT_MS=45000; // auto no-answer if nobody picks up — don't rely solely on Firebase's own (slower, variable) onDisconnect detection to end a ringing call
let _incomingCallPairKey=null, _incomingCallFrom=null, _incomingCallFromName=null, _incomingCallRef=null, _incomingCallHandler=null;
const _seenIncomingCalls={};
async function startDirectCall(contact){
  if(!me||!contact||contact.type==='group'||!contact.number) return;
  if(voiceChannelActive){ showToast('Already in a call',scbErr('SCB-CALL-05','Hang up first.')); return; }
  // voiceChannelActive only covers an ANSWERED call — it stays unset for the
  // whole ringing phase (set only inside _beginDmCallSession, once the
  // callee accepts), so without this a second click/tap while still ringing
  // re-runs this whole function: it overwrites _outgoingCallHandler without
  // detaching the first listener and overwrites _outgoingCallTimeoutTimer
  // without clearing the first timer, so both eventually fire independently
  // against the same callee once they finally answer.
  if(_outgoingCallPairKey){ showToast('Already calling',scbErr('SCB-CALL-05','Cancel the current call before starting another.')); return; }
  if(isBlockedForCalls(contact.number)){ showToast('Cannot call',scbErr('SCB-CALL-06','Calls with this contact are blocked.')); return; }
  const pairKey=[me.number,contact.number].sort((a,b)=>a-b).join('_');
  const cRef=fbdb.ref('calls/'+pairKey);
  try{
    await cRef.set({from:me.number,to:contact.number,fromName:me.name,time:Date.now(),status:'ringing'});
    // Nothing but a clean hang-up (leaveVoiceChannel) ever removed this node,
    // so a caller whose tab closed or network dropped left calls/<pair> behind
    // — and because watchIncomingCalls derives the global "in a call" dot from
    // every status:'active' entry, BOTH numbers showed as permanently in a
    // call, to every user in the app, until someone called them again.
    try{ cRef.onDisconnect().remove(); }catch(e2){}
  }catch(e){
    showToast('Call failed',scbErr('SCB-CALL-07','That call couldn\'t be started.',e.code==='PERMISSION_DENIED'?'Firebase is blocking the "calls" path — check your Realtime Database rules.':(e.message||'')));
    return;
  }
  _outgoingCallPairKey=pairKey; _outgoingCallRef=cRef; _outgoingCallContact=contact;
  document.getElementById('outgoing-call-name').textContent=dec(contact.name)||contact.name;
  openModal('outgoing-call-modal');
  _outgoingCallHandler=cRef.on('value',async snap=>{
    const val=snap.val();
    if(!val){
      // Record deleted — other side's app closed or they never answered
      const _c=_outgoingCallContact;
      closeModal('outgoing-call-modal'); cleanupOutgoingWatcher();
      if(_c&&me){ logCallHistory({dir:'no_answer',number:_c.number,name:_c.name,time:Date.now(),duration:0,initiator:me.number}); }
      return;
    }
    if(val.status==='declined'){
      const _c=_outgoingCallContact;
      closeModal('outgoing-call-modal'); showToast('Call declined','');
      cleanupOutgoingWatcher(); cRef.remove();
      if(_c&&me){
        const convKey=dmKey(me.number,_c.number);
        logCallHistory({dir:'declined_out',number:_c.number,name:_c.name,time:Date.now(),duration:0,initiator:me.number});
        injectCallEventMsg(convKey,'declined',0,false,me.number);
      }
    }else if(val.status==='active'){
      cleanupOutgoingWatcher();
      closeModal('outgoing-call-modal');
      const dmKeyStr=dmKey(me.number,contact.number);
      _dmCallIsOutgoing=true;
      await _beginDmCallSession(dmKeyStr,contact.number,contact.name,pairKey);
    }
  },err=>{
    console.warn('outgoing call listener error',err);
    closeModal('outgoing-call-modal'); cleanupOutgoingWatcher();
    showToast('Call failed','Could not watch the call — check your connection.');
  });
  // Firebase's onDisconnect() only clears the record once it notices the
  // other side's connection is actually gone, which can take a while (or
  // never happen if their tab is merely backgrounded, not closed). Without
  // a client-side cap, a call nobody answers rings forever instead of
  // resolving to "no answer" — the exact same unbounded-wait shape as the
  // sign-in hang, just in a different feature.
  _outgoingCallTimeoutTimer=setTimeout(async()=>{
    if(_outgoingCallPairKey!==pairKey) return; // a newer call superseded this one
    // Re-read the live record before deleting it. If the callee's accept
    // landed on the server right around the 45s mark, this local timer can
    // otherwise win a race against the caller's own `value` listener
    // noticing it — deleting a call the callee already committed to
    // (acceptIncomingCall already flipped status to 'active' and called
    // _beginDmCallSession) and detaching the listener so it never sees the
    // acceptance even if that notification was only microseconds away,
    // leaving the callee stuck in an apparently-live call with no caller.
    try{
      const snap=await cRef.once('value');
      const val=snap.val();
      if(val&&val.status==='active') return; // already answered — let the 'active' handler above take it from here
    }catch(e){}
    if(_outgoingCallPairKey!==pairKey) return; // superseded while the re-check above was in flight
    showToast('No answer','');
    cRef.remove(); // also resolves the callee's incoming-call watcher
    cleanupOutgoingWatcher();
    closeModal('outgoing-call-modal');
  },OUTGOING_CALL_RING_TIMEOUT_MS);
}
function cleanupOutgoingWatcher(){
  if(_outgoingCallRef&&_outgoingCallHandler) _outgoingCallRef.off('value',_outgoingCallHandler);
  if(_outgoingCallTimeoutTimer){ clearTimeout(_outgoingCallTimeoutTimer); _outgoingCallTimeoutTimer=null; }
  _outgoingCallPairKey=null; _outgoingCallRef=null; _outgoingCallHandler=null; _outgoingCallContact=null;
}
function cancelOutgoingCall(){
  const _c=_outgoingCallContact;
  if(_outgoingCallPairKey) fbdb.ref('calls/'+_outgoingCallPairKey).remove();
  cleanupOutgoingWatcher();
  closeModal('outgoing-call-modal');
  if(_c&&me){ logCallHistory({dir:'cancelled',number:_c.number,name:_c.name,time:Date.now(),duration:0,initiator:me.number}); }
}
function watchIncomingCalls(){
  if(!me||_globalCallsHandler) return;
  const ref=fbdb.ref('calls');
  _globalCallsHandler=ref.on('value',snap=>{
    const all=snap.val()||{};
    Object.keys(all).forEach(pairKey=>{
      const c=all[pairKey];
      if(!c){ delete _seenIncomingCalls[pairKey]; return; }
      const stale=Date.now()-(c.time||0)>60000;
      if(Number(c.to)===Number(me.number)&&c.status==='ringing'&&!stale&&!_seenIncomingCalls[pairKey]){
        _seenIncomingCalls[pairKey]=true;
        showIncomingCallModal(pairKey,c);
      }
      if(c.status!=='ringing') delete _seenIncomingCalls[pairKey];
    });
    // Live "in a call" indicator (feature #27): rebuild the whole set fresh each
    // update rather than incrementally patching it, since call entries disappear
    // via Firebase .remove() (not a status flip) when a call ends — a diffing
    // approach would need to separately notice removals, whereas a full rebuild
    // from the current snapshot is naturally always correct.
    const prevSize=_numbersInActiveCall.size;
    _numbersInActiveCall=new Set();
    // Second line of defence behind the onDisconnect() handlers: if a record
    // is ever orphaned anyway (both tabs killed at once, onDisconnect lost),
    // don't advertise those two people as in a call for the rest of time.
    // Generous window so a genuinely long call is never cut off visually.
    Object.values(all).forEach(c=>{
      if(!c||c.status!=='active') return;
      if(c.time&&Date.now()-c.time>CALL_PRESENCE_MAX_MS) return;
      _numbersInActiveCall.add(Number(c.from)); _numbersInActiveCall.add(Number(c.to));
    });
    if(_numbersInActiveCall.size||prevSize) renderSidebar();
  },err=>{
    console.error('watchIncomingCalls permission/error:',err);
    showToast('Calls unavailable',scbErr('SCB-CALL-08','Firebase is blocking the "calls" path — check your Realtime Database rules.'));
  });
  _globalCallsRef=ref;
}
let _globalCallsHandler=null, _globalCallsRef=null;
let _numbersInActiveCall=new Set(); // live "currently in a call" presence, kept in sync by watchIncomingCalls' listener below
function showIncomingCallModal(pairKey,c){
  _incomingCallPairKey=pairKey; _incomingCallFrom=c.from; _incomingCallFromName=c.fromName||('#'+c.from);
  document.getElementById('incoming-call-name').textContent=_incomingCallFromName;
  openModal('incoming-call-modal');
  startCallRingtone();
  // The ringtone alone is easy to miss with the tab backgrounded/muted —
  // sendNotif() already no-ops unless the tab is actually hidden and
  // notification permission was granted, so this is safe to call always.
  sendNotif('📞 Incoming call',_incomingCallFromName+' is calling you');
  const ref=fbdb.ref('calls/'+pairKey);
  _incomingCallRef=ref;
  _incomingCallHandler=ref.on('value',snap=>{
    const v=snap.val();
    if(!v||v.status!=='ringing'){
      closeModal('incoming-call-modal');
      stopCallRingtone();
      cleanupIncomingWatcher();
      // Reaching here means the call ended without acceptIncomingCall() having
      // run (that path detaches this watcher first) — so it's a real miss.
      logMissedCall(c.from,c.fromName);
      renderDashboardWidget('missedcalls');
    }
  },err=>{ console.warn('incoming call listener error',err); });
}
function cleanupIncomingWatcher(){
  if(_incomingCallRef&&_incomingCallHandler) _incomingCallRef.off('value',_incomingCallHandler);
  _incomingCallRef=null; _incomingCallHandler=null;
}
async function acceptIncomingCall(){
  const pairKey=_incomingCallPairKey, otherNum=_incomingCallFrom, otherName=_incomingCallFromName;
  if(!pairKey) return;
  cleanupIncomingWatcher();
  closeModal('incoming-call-modal');
  stopCallRingtone();
  const cRef=fbdb.ref('calls/'+pairKey);
  await cRef.update({status:'active'});
  // Same stuck-"in a call" hazard as the caller side: the accepting side owns
  // this node too once the call is live, so it must disappear if this tab dies.
  try{ cRef.onDisconnect().remove(); }catch(e){}
  _dmCallIsOutgoing=false;
  await _beginDmCallSession(dmKey(me.number,otherNum),otherNum,otherName,pairKey);
}
function declineIncomingCall(){
  const pairKey=_incomingCallPairKey, fromNum=_incomingCallFrom, fromName=_incomingCallFromName;
  cleanupIncomingWatcher();
  closeModal('incoming-call-modal');
  stopCallRingtone();
  if(pairKey) fbdb.ref('calls/'+pairKey).update({status:'declined'});
  _incomingCallPairKey=null;
  if(me&&fromNum){ logCallHistory({dir:'declined_in',number:fromNum,name:fromName||('#'+fromNum),time:Date.now(),duration:0,initiator:fromNum}); }
}
let _dmCallStartTime=null, _dmCallOtherNum=null, _dmCallIsOutgoing=false, _dmCallConvKey=null;
async function _beginDmCallSession(dmKeyStr,otherNum,otherName,pairKey){
  const path=callPath(dmKeyStr);
  const ok=await _startVoiceSession(path,'📞 Call with '+otherName);
  if(!ok){
    // The call record was already flipped to 'active' by the caller/accepter
    // before we got here. Bailing out silently (mic permission denied, no
    // getUserMedia) left it active forever: the other party's UI sat in a
    // "connected" call with nobody on the line, and the global in-a-call dot
    // stuck on for both numbers. Tear the record down on the way out.
    if(pairKey){ try{ await fbdb.ref('calls/'+pairKey).remove(); }catch(e){} }
    showToast('Call ended',scbErr('SCB-CALL-09','Could not start audio on this device.'));
    _dmCallStartTime=null; _dmCallOtherNum=null; _dmCallConvKey=null;
    return;
  }
  _dmCallStartTime=Date.now();
  _dmCallOtherNum=otherNum;
  _dmCallConvKey=dmKeyStr;
  voiceChannelActive.isDm=true;
  voiceChannelActive.pairKey=pairKey;
  voiceChannelActive.otherNum=otherNum;
  showToast('Call connected','📞 '+otherName);
}

