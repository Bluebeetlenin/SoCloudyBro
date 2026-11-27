// -- WELCOME MESSAGE -------------------------------------------------------
// Posts a one-time welcome message into the SoCloudyBro channel of the
// existing Game Updates feed (not as a chat). Stored locally so it shows
// up alongside official updates without writing to the shared updates bin.
function sendWelcomeMessage(){
  try{
    if(localStorage.getItem('cc_welcomed')) return;
    localStorage.setItem('cc_welcomed','1');
    localStorage.setItem('cc_welcome_post',JSON.stringify({
      title:'Welcome',
      body:'Welcome to SoCloudyBro! Make sure to be kind and respectful to everyone! ☀️',
      time:Date.now(),
      channel:'SoCloudyBro'
    }));
  }catch(e){console.warn('Welcome message failed:',e);}
}

// -- CLOUDY VOICE ASSISTANT ----------------------------------------------------
// Wake-word assistant: say "Hey Cloudy, <command>" (also hears "OK Cloudy",
// "Cloudy", and common mishearings like "Cloud E" / "Claudia"). Supported:
//   "send a message / tell / text <name> saying|that|: <text>"
//   "switch / turn on / enable to light|dark|auto mode"
//   "change / update / set my bio to <text>"
//   "change / update / set my name to <text>"
//   "open / go to chat with <name>"
//   "open settings" / "open updates" / "open channels" / "new chat"
//   "call / phone / dial <name>" / "hang up"
//   "mute" / "unmute" / "share my screen" / "stop sharing"
//   "join voice channel <name>" / "leave voice"
//   "switch to channel <name>" (text channels inside a group)
//   "block / unblock <name>"
//   "search for <text>"
//   "archive / unarchive this chat"
//   "lock / unlock this chat"
//   "read my messages" / "what's the time" / "stop listening"
let cloudyRecognition=null, cloudyListening=false;
function getCloudySpeechRecognition(){ return window.SpeechRecognition||window.webkitSpeechRecognition||null; }
// Builds a JSGF grammar from every contact AND group display name (the
// `contacts` array holds both) so the recognizer is biased toward hearing
// them correctly — e.g. "Alice" instead of "a less", or "Game Night" intact.
function buildCloudyGrammarList(){
  const SGL=window.SpeechGrammarList||window.webkitSpeechGrammarList;
  if(!SGL) return null;
  const names=[];
  (contacts||[]).forEach(c=>{
    if(!c||!c.name) return;
    const clean=c.name.replace(/[^a-zA-Z0-9' ]/g,' ').replace(/\s+/g,' ').trim();
    if(clean&&!names.includes(clean)) names.push(clean);
  });
  if(!names.length) return null;
  try{
    const list=new SGL();
    const grammar='#JSGF V1.0; grammar cloudyNames; public <name> = '+names.join(' | ')+' ;';
    list.addFromString(grammar,1);
    return list;
  }catch{ return null; }
}
let cloudySpeaking=false;
function cloudySpeak(text){
  try{
    if(!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.rate=1; u.pitch=1;
    u.onstart=()=>{ cloudySpeaking=true; updateCloudyVizState(); };
    u.onend=()=>{ cloudySpeaking=false; updateCloudyVizState(); };
    u.onerror=()=>{ cloudySpeaking=false; updateCloudyVizState(); };
    window.speechSynthesis.speak(u);
  }catch{}
}
function toggleCloudy(btn){
  if(cloudyListening){ stopCloudy(btn); return; }
  const SR=getCloudySpeechRecognition();
  if(!SR){ showToast('Voice not supported',scbErr('SCB-ASST-01','Your browser does not support speech recognition.')); return; }
  if(!me){ showToast('Set up first',scbErr('SCB-ASST-02','Finish setting up your account before using Cloudy.')); return; }
  try{
    cloudyRecognition=new SR();
    cloudyRecognition.continuous=true;
    cloudyRecognition.interimResults=false;
    cloudyRecognition.maxAlternatives=5;
    cloudyRecognition.lang='en-US';
    const grammarList=buildCloudyGrammarList();
    if(grammarList) cloudyRecognition.grammars=grammarList;
    cloudyRecognition.onresult=(e)=>{
      const res=e.results[e.results.length-1];
      // Try every alternative the engine offers and use the first one that
      // looks like it's actually addressed to Cloudy — speech recognition
      // often mishears "Cloudy", so giving alternatives a chance helps a lot.
      let best=null;
      for(let i=0;i<res.length;i++){
        const t=(res[i].transcript||'').trim().toLowerCase();
        if(!t) continue;
        if(best===null) best=t;
        if(extractCloudyCommand(t)!==null){ best=t; break; }
      }
      if(best) handleCloudyTranscript(best);
    };
    cloudyRecognition.onerror=(e)=>{
      console.warn('Cloudy recognition error:',e.error);
      // Permission denied / mic unavailable — stop instead of looping,
      // since restarting just re-triggers the browser's permission prompt.
      if(e.error==='not-allowed'||e.error==='service-not-allowed'||e.error==='audio-capture'){
        cloudyListening=false;
        showToast('Cloudy needs microphone access',scbErr('SCB-ASST-03','Allow microphone access for this site in your browser settings, then try again.'));
        if(cloudyRecognition){ try{ cloudyRecognition.onend=null; }catch{} cloudyRecognition=null; }
        const b=btn||document.getElementById('cloudy-btn');
        if(b) b.classList.remove('listening');
      }
    };
    cloudyRecognition.onend=()=>{
      if(!cloudyListening) return;
      // Small delay before restarting — restarting instantly can cause the
      // browser to keep re-showing the microphone permission popup.
      setTimeout(()=>{ if(cloudyListening&&cloudyRecognition){ try{ cloudyRecognition.start(); }catch{} } },350);
    };
    cloudyRecognition.start();
    cloudyListening=true;
    updateCloudyVizState();
    startCloudyVizMic();
    if(btn) btn.classList.add('listening');
    showToast('Cloudy is listening 🎙️','Say "Hey Cloudy…" then a command — try "what can you do?" to hear the full list.');
  }catch(e){ showToast('Could not start Cloudy',scbErr('SCB-ASST-04','Cloudy couldn\'t start listening.',e.message)); }
}
function stopCloudy(btn){
  cloudyListening=false;
  updateCloudyVizState();
  stopCloudyVizMic();
  if(cloudyRecognition){ try{ cloudyRecognition.onend=null; cloudyRecognition.stop(); }catch{} cloudyRecognition=null; }
  const b=btn||document.getElementById('cloudy-btn');
  if(b) b.classList.remove('listening');
  showToast('Cloudy stopped','Voice assistant turned off.');
}
// Pulls the command portion out of a transcript by locating the wake word.
// Tolerant of "hey/ok/hi cloudy", bare "cloudy", and common mis-hearings
// such as "cloud e", "cloudie", "claudia", "klaudi" — returns null if no
// wake word is found anywhere near the start of the sentence.
function extractCloudyCommand(t){
  // "cloudy" gets misheard a lot — also catch "cloud", "claudia", "klaudi",
  // "crowdy/crowd", "loudy/loud", "proudy/proud", "glowdy", "cloudia" etc,
  // optionally preceded by a wake phrase like "hey/hi/ok/yo".
  const m=t.match(/\b(?:hey|hi|hay|ok|okay|yo|oh|a)?\s*(?:cloud|claud|klaud|clowd|crowd|crowdy|loud|loudy|proud|proudy|glowd|cloudia)\w*/i);
  if(!m||m.index>22) return null;
  let rest=t.slice(m.index+m[0].length);
  // speech engines sometimes split "cloudy" into "cloud" + "e"/"y"/"ie"
  rest=rest.replace(/^\s*(?:y|ie|ee|e|i|ia)\b/,'');
  rest=rest.replace(/^[\s,.:;-]+/,'');
  rest=rest.trim();
  // sometimes the wake word is repeated or trails into the command start
  rest=rest.replace(/^(?:cloud|claud|klaud)\w*[\s,.:;-]*/i,'');
  return rest.trim();
}
function handleCloudyTranscript(transcript){
  const cmd=extractCloudyCommand(transcript);
  if(cmd===null||!cmd) return;
  const c=cmd.replace(/[.!?]+$/,'').trim();
  if(!c) return;
  // "poll" gets misheard as "pole"/"poles"/"pol" — normalize before matching
  const cNorm=c.replace(/\bpoles\b/gi,'polls').replace(/\bpole\b/gi,'poll').replace(/\bpols\b/gi,'polls').replace(/\bpol\b/gi,'poll');

  // group-specific commands first, so "the group X" isn't swallowed by the
  // generic contact-message/open patterns below
  let m=cNorm.match(/^(?:create|start|make|begin)(?: a)? poll(?:s)? in(?: the)?(?: group)? (.+?) (?:about|asking|called|titled|on|for|saying) (.+)$/i)
       ||cNorm.match(/^(?:create|start|make|begin)(?: a)? (?:group )?poll(?:s)? for(?: the)?(?: group)? (.+?) (?:about|asking|called|titled|on|saying) (.+)$/i);
  if(m){ cloudyCreatePoll(m[1].trim(),m[2].trim()); return; }
  m=cNorm.match(/^(?:create|start|make|begin)(?: a)? poll(?:s)? in(?: the)?(?: group)? (.+)$/i);
  if(m){ cloudyCreatePoll(m[1].trim(),''); return; }
  if(/^(?:create|start|make|begin|open)(?: a)? poll$/i.test(cNorm)){
    if(activeConvo&&activeConvo.type==='group'){ openPollModal(); showToast('Cloudy','Starting a poll — type your question and options.'); }
    else showToast('Cloudy 🤔',scbErr('SCB-ASST-05','Open a group chat first — polls are group-only.'));
    return;
  }

  m=c.match(/^(?:please )?(?:send|write|tell|message|text|dm)(?: a)?(?: message)? to(?: the)? group (.+?)(?:,)? (?:saying|that says|saying that|that|:) (.+)$/i)
       ||c.match(/^(?:please )?(?:tell|message|text) the group (.+?) (?:that|saying|:) (.+)$/i)
       ||c.match(/^(?:please )?(?:tell|message) the group (.+?), (.+)$/i);
  if(m){ cloudySendGroupMessage(m[1].trim(),m[2].trim()); return; }

  m=c.match(/^(?:open|go to|show|switch to|pull up)(?: the| my)? group (.+)$/i)
   ||c.match(/^(?:open|go to|talk to)(?: the| my)? (.+) group$/i);
  if(m){ cloudyOpenGroup(m[1].trim()); return; }

  m=c.match(/^(?:please )?(?:send|write|fire off)?\s*(?:a |an )?(?:message|text|note|dm) to (.+?)(?:,)? (?:saying|that says|saying that|saying:|:|that|with the message|with) (.+)$/i)
       ||c.match(/^(?:please )?(?:tell|text|message|dm|notify|let) (.+?) (?:that|saying|know|to know|:) (.+)$/i)
       ||c.match(/^(?:please )?(?:tell|text|message|dm) (.+?), (.+)$/i);
  if(m){ cloudySendMessage(m[1].trim(),m[2].trim()); return; }

  // "say [message] to [name]" — message comes first, name second
  m=c.match(/^(?:please )?say (.+) to ([^,]+)$/i);
  if(m){ cloudySendMessage(m[2].trim(),m[1].trim()); return; }

  m=c.match(/^(?:please )?(?:switch|change|set|go|turn(?: it)?(?: on)?|enable|activate|make it|i want|put (?:it|me) in)(?: to| on| into)? (light|dark|auto|night|day)(?: mode)?$/i)
   ||c.match(/^(light|dark|auto|night|day) mode(?: please)?$/i);
  if(m){
    let mode=m[1].toLowerCase();
    if(mode==='night') mode='dark';
    if(mode==='day') mode='light';
    setTheme(mode);
    showToast('Cloudy 🌤','Switched to '+mode+' mode.');
    cloudySpeak('Switched to '+mode+' mode.');
    return;
  }

  // -- Calls, voice channels, screen share, block --------------------------
  m=c.match(/^(?:call|phone|dial|voice call|start a call with) (.+)$/i);
  if(m){ cloudyStartCall(m[1].trim()); return; }
  if(/^(?:hang up|end(?: the| this)? call|leave(?: the)? call)$/i.test(c)){ cloudyHangUp(); return; }
  if(/^mute(?: myself| my mic| the mic)?$/i.test(c)){ cloudySetMute(true); return; }
  if(/^unmute(?: myself| my mic)?$/i.test(c)){ cloudySetMute(false); return; }
  if(/^(?:share|start sharing)(?: my)? screen$/i.test(c)){ cloudyShareScreen(true); return; }
  if(/^stop (?:sharing|screen sharing|my screen|the screen share)$/i.test(c)){ cloudyShareScreen(false); return; }
  m=c.match(/^join(?: the)? voice(?: channel)?(?: called| named)? ?(.*)$/i);
  if(m){ cloudyJoinVoiceChannel(m[1].trim()); return; }
  if(/^leave(?: the)? voice(?: channel)?$/i.test(c)){ cloudyHangUp(); return; }
  m=c.match(/^(?:switch to|go to|open)(?: the)? channel (.+)$/i);
  if(m){ cloudySwitchChannel(m[1].trim()); return; }
  m=c.match(/^block (.+)$/i);
  if(m){ cloudyBlockToggle(m[1].trim(),true); return; }
  m=c.match(/^unblock (.+)$/i);
  if(m){ cloudyBlockToggle(m[1].trim(),false); return; }
  m=c.match(/^remind (?:us|everyone|me)\s+(in \d+\s*(?:minutes?|min|hours?|hr)s?|every \w+ at [\d: ]+(?:am|pm)?|tomorrow at [\d: ]+(?:am|pm)?|at [\d: ]+(?:am|pm)?)\s+(?:to|about|that) (.+)$/i);
  if(m){ cloudySetReminder(m[1].trim(),m[2].trim()); return; }

  m=c.match(/^(?:change|update|set|make) my bio (?:to|say|read)?\s*(.+)$/i)
   ||c.match(/^my bio (?:is now|should be|should say) (.+)$/i);
  if(m){ cloudyChangeBio(m[1].trim()); return; }

  m=c.match(/^(?:change|update|set|make) my (?:name|display name|username) (?:to|be)?\s*(.+)$/i)
   ||c.match(/^my name (?:is now|should be) (.+)$/i);
  if(m){ cloudyChangeName(m[1].trim()); return; }

  if(/^(?:open|show|go to|pull up)(?: the| my)? settings$/i.test(c)){ showSettings(); showToast('Cloudy','Opening settings.'); return; }
  if(/^(?:open|show|go to|pull up)(?: the| my)? (?:game )?(?:updates|channels?)$/i.test(c)){ showUpdates(); showToast('Cloudy','Opening channels.'); return; }
  if(/^(?:start|open|create|begin)(?: a)? new (?:chat|conversation|message)$/i.test(c)){ openAddContact(); showToast('Cloudy','Starting a new chat.'); return; }
  if(/^(?:archive|unarchive|move)(?: this| the)? chat(?: away)?$/i.test(c)){ cloudyArchive(); return; }
  if(/^(?:lock|unlock)(?: this| the)? (?:chat|conversation)$/i.test(c)){ cloudyLock(); return; }
  if(/^read (?:my |the |out )?(?:last |latest |new |recent )?messages?(?: to me| out loud| out)?$/i.test(c)){ cloudyReadMessages(); return; }

  m=c.match(/^(?:open|go to|switch to|start|show|pull up)(?: a)?(?: my)?(?: the)? (?:chat|conversation) with (.+)$/i)
   ||c.match(/^(?:open|go to|talk to|message|find|chat with|pull up|show me) (.+)$/i);
  if(m){ cloudyOpenChat(m[1].trim()); return; }

  m=c.match(/^(?:search|look|find)(?: for| up)? (.+)$/i);
  if(m){ cloudySearch(m[1].trim()); return; }

  if(/^what(?:'?s| is) the time(?: now)?\??$/i.test(c)||/^(?:tell me the time|what time is it)\??$/i.test(c)){
    const now=new Date(),h=now.getHours(),mins=now.getMinutes().toString().padStart(2,'0');
    const period=h>=12?'PM':'AM',h12=((h+11)%12)+1;
    const phrase='It\'s '+h12+':'+mins+' '+period;
    showToast('Cloudy 🕐',phrase); cloudySpeak(phrase);
    return;
  }
  if(/^(?:what(?:'?s| is) (?:today'?s )?(?:the )?date|what day is it)\??$/i.test(c)){
    const phrase='Today is '+new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
    showToast('Cloudy 📅',phrase); cloudySpeak(phrase);
    return;
  }
  if(/^(?:what can you do|help|what commands (?:do you have|can i use)|list commands)\??$/i.test(c)){
    const phrase='You can ask me to send messages or open chats with people or groups, start a poll in a group, call someone or hang up, mute or unmute, share or stop sharing your screen, join a voice channel or switch text channels, block or unblock someone, set a reminder like "remind us every friday at 8pm about game night", switch light or dark mode, change your name or bio, search, archive or lock a chat, read your messages, or tell you the time and date.';
    showToast('Cloudy 💡',phrase); cloudySpeak(phrase);
    return;
  }
  if(/^(?:stop listening|go to sleep|that'?s all|never ?mind|cancel|goodbye|bye|stop|quiet)$/i.test(c)){ stopCloudy(); return; }

  showToast('Cloudy 🤔',scbErr('SCB-ASST-06','I didn\'t understand: "'+c+'"'));
  cloudySpeak('Sorry, I didn\'t catch that.');
}
function cloudyFindContact(name){
  const n=name.toLowerCase().trim();
  return contacts.find(c=>c.type!=='group'&&c.type!=='channel'&&c.name&&c.name.toLowerCase()===n)
      ||contacts.find(c=>c.type!=='group'&&c.type!=='channel'&&c.name&&c.name.toLowerCase().includes(n));
}
// openChat() can return early WITHOUT opening anything — a parental noDm/noGroups
// restriction, a banned counterparty, or simply hitting MAX_OPEN_TABS all just
// `return` from the wrapper. Cloudy's voice commands used to `await openChat(t)`
// and then immediately type into #msg-input and call sendMsg(), which sends into
// whatever conversation is STILL open. Saying "Cloudy, message Alice: <secret>"
// while a chat with Bob was open and the tab limit was reached would send the
// message to Bob. Confirm the intended conversation is actually the active one
// before typing anything into it.
function cloudyConvoOpened(target){
  const key=(target&&target.key)||(me&&target?dmKey(me.number,target.number):null);
  // A locked chat does set activeConvo (so the lock overlay knows what to
  // unlock) but never actually opens the chat — sending into it from a voice
  // command would walk straight past the PIN the user set on it.
  if(key && lockedChats[key]){
    showToast('Cloudy — chat locked',scbErr('SCB-ASST-07','That chat is locked. Open it and enter the PIN first.'));
    return false;
  }
  if(activeConvo && key && activeConvo.key===key) return true;
  showToast('Cloudy \u2014 couldn\'t send',scbErr('SCB-ASST-08','I couldn\'t open that chat, so I didn\'t send anything.'));
  return false;
}
async function cloudySendMessage(name,text){
  if(!text){ showToast('Cloudy 🤔',scbErr('SCB-ASST-09','I didn\'t catch what to say.')); return; }
  const target=cloudyFindContact(name);
  if(!target){ showToast('Cloudy 🤔',scbErr('SCB-ASST-10','I couldn\'t find a contact named "'+name+'".')); return; }
  try{
    await openChat(target);
    if(!cloudyConvoOpened(target)) return;
    const input=document.getElementById('msg-input');
    input.value=text;
    autoResize(input);
    await sendMsg();
    showToast('Cloudy ✅','Sent your message to '+target.name+'.');
  }catch(e){ showToast('Cloudy — send failed',scbErr('SCB-ASST-11','Cloudy couldn\'t send your message.',e.message)); }
}
async function cloudyOpenChat(name){
  const target=cloudyFindContact(name);
  if(!target){ showToast('Cloudy 🤔',scbErr('SCB-ASST-12','I couldn\'t find a contact named "'+name+'".')); return; }
  await openChat(target);
  showToast('Cloudy','Opened your chat with '+target.name+'.');
}
function cloudyFindGroup(name){
  const n=name.toLowerCase().trim().replace(/^(?:the |a |my )+/,'').replace(/ (?:group|chat)$/,'').trim();
  return contacts.find(c=>c.type==='group'&&c.name&&c.name.toLowerCase()===n)
      ||contacts.find(c=>c.type==='group'&&c.name&&c.name.toLowerCase().includes(n));
}
async function cloudyOpenGroup(name){
  const target=cloudyFindGroup(name);
  if(!target){ showToast('Cloudy 🤔',scbErr('SCB-ASST-13','I couldn\'t find a group named "'+name+'".')); return; }
  await openChat(target);
  showToast('Cloudy','Opened the group '+target.name+'.');
}
async function cloudySendGroupMessage(name,text){
  if(!text){ showToast('Cloudy 🤔',scbErr('SCB-ASST-14','I didn\'t catch what to say.')); return; }
  const target=cloudyFindGroup(name);
  if(!target){ showToast('Cloudy 🤔',scbErr('SCB-ASST-15','I couldn\'t find a group named "'+name+'".')); return; }
  try{
    await openChat(target);
    if(!cloudyConvoOpened(target)) return;
    const input=document.getElementById('msg-input');
    input.value=text;
    autoResize(input);
    await sendMsg();
    showToast('Cloudy ✅','Sent your message to the group '+target.name+'.');
  }catch(e){ showToast('Cloudy — send failed',scbErr('SCB-ASST-16','Cloudy couldn\'t send your message to that group.',e.message)); }
}
async function cloudyCreatePoll(groupName,question){
  const target=cloudyFindGroup(groupName);
  if(!target){ showToast('Cloudy 🤔',scbErr('SCB-ASST-17','I couldn\'t find a group named "'+groupName+'".')); return; }
  await openChat(target);
  if(!cloudyConvoOpened(target)) return;
  openPollModal();
  const qInput=document.getElementById('poll-question');
  if(qInput&&question) qInput.value=question;
  showToast('Cloudy','Started a poll in '+target.name+(question?' — fill in the options and create it.':' — type your question and options.'));
}
async function cloudyChangeBio(text){
  if(!me) return;
  // Match the limits the edit-profile form's maxlength attribute enforces
  // (editProfile's <textarea id="edit-bio"> is capped at 120) — this path
  // bypasses that input entirely, so it's the only thing stopping an
  // arbitrarily long voice/chat-typed bio from being persisted. Also reject
  // empty/whitespace-only text, which used to pass this function's `!text`
  // check (a non-empty-but-blank string is still truthy).
  text=String(text||'').trim().slice(0,120);
  if(!text) return;
  me.bio=text;
  saveStorage();
  renderMyCard();
  const bioDisp=document.getElementById('settings-bio-disp');
  if(bioDisp) bioDisp.textContent=text||'No bio set';
  try{ await registerOrUpdate(); }catch{}
  showToast('Cloudy ✅','Updated your bio.');
}
async function cloudyChangeName(text){
  if(!me||!text) return;
  // Same reasoning as cloudyChangeBio: match the edit-profile form's
  // maxlength (<input id="edit-name"> is capped at 24), which this
  // voice/chat path bypasses entirely.
  text=String(text).trim().slice(0,24);
  if(!text) return;
  me.name=text;
  saveStorage();
  renderMyCard();
  try{ await registerOrUpdate(); }catch{}
  showToast('Cloudy ✅','Updated your name to '+text+'.');
}
function cloudySearch(q){
  searchQ=q;
  const input=document.getElementById('sb-search-input')||document.querySelector('#sb-search input');
  if(input) input.value=q;
  renderSidebar();
  showToast('Cloudy','Searching for "'+q+'".');
}
function cloudyStartCall(name){
  const c=cloudyFindContact(name);
  if(!c){ showToast('Cloudy 🤔',scbErr('SCB-ASST-18','I couldn\'t find a contact named "'+name+'".')); cloudySpeak('I could not find that contact.'); return; }
  startDirectCall(c);
  showToast('Cloudy 📞','Calling '+c.name+'…');
  cloudySpeak('Calling '+c.name);
}
function cloudyHangUp(){
  if(!voiceChannelActive){ showToast('Cloudy',scbErr('SCB-ASST-19','You\'re not in a call.')); cloudySpeak('You are not in a call.'); return; }
  leaveVoiceChannel();
  showToast('Cloudy','Call ended.'); cloudySpeak('Call ended.');
}
function cloudySetMute(wantMuted){
  if(!voiceChannelActive){ showToast('Cloudy',scbErr('SCB-ASST-20','You\'re not in a call.')); cloudySpeak('You are not in a call.'); return; }
  if(voiceMuted!==wantMuted) toggleVoiceMute();
  showToast('Cloudy',wantMuted?'Muted.':'Unmuted.');
  cloudySpeak(wantMuted?'Muted':'Unmuted');
}
function cloudyShareScreen(share){
  if(!voiceChannelActive){ showToast('Cloudy',scbErr('SCB-ASST-21','Join a call or voice channel first.')); cloudySpeak('Join a call first.'); return; }
  if(share&&!localScreenStream) toggleScreenShare();
  else if(!share&&localScreenStream) toggleScreenShare();
  else showToast('Cloudy',share?'Already sharing.':'Not currently sharing.');
}
function cloudyJoinVoiceChannel(name){
  if(!activeConvo||activeConvo.type!=='group'){ showToast('Cloudy',scbErr('SCB-ASST-22','Open a group first — voice channels are group-only.')); cloudySpeak('Open a group chat first.'); return; }
  const conv=getActiveConvoObj();
  if(!conv) return;
  const chans=sortedChannels(conv).filter(ch=>ch.type==='voice');
  let ch;
  if(name){ const nl=name.toLowerCase(); ch=chans.find(x=>x.name.toLowerCase().includes(nl)); }
  if(!ch) ch=chans[0];
  if(!ch){ showToast('Cloudy',scbErr('SCB-ASST-23','This group has no voice channels.')); cloudySpeak('This group has no voice channels.'); return; }
  joinVoiceChannel(ch.id);
  showToast('Cloudy 🔊','Joining '+ch.name+'…');
}
function cloudySwitchChannel(name){
  if(!activeConvo||activeConvo.type!=='group'){ showToast('Cloudy','Open a group first.'); cloudySpeak('Open a group chat first.'); return; }
  const conv=getActiveConvoObj();
  if(!conv) return;
  const chans=sortedChannels(conv).filter(ch=>ch.type==='text');
  const nl=name.toLowerCase();
  const ch=chans.find(x=>x.name.toLowerCase().includes(nl));
  if(!ch){ showToast('Cloudy 🤔',scbErr('SCB-ASST-24','No channel named "'+name+'" in this group.')); cloudySpeak('I could not find that channel.'); return; }
  switchChannel(ch.id);
  showToast('Cloudy','Switched to #'+ch.name);
  cloudySpeak('Switched to '+ch.name);
}
function cloudyBlockToggle(name,block){
  const c=cloudyFindContact(name);
  if(!c){ showToast('Cloudy 🤔',scbErr('SCB-ASST-25','I couldn\'t find a contact named "'+name+'".')); cloudySpeak('I could not find that contact.'); return; }
  if(!me.blocked) me.blocked=[];
  const idx=me.blocked.indexOf(c.number);
  // Same confirmation toggleBlockUser() requires from the sidebar menu —
  // this voice/chat path reimplemented the block logic inline instead of
  // calling that function, which skipped its confirm() entirely, so saying
  // "Cloudy, block <name>" blocked someone immediately with no "are you
  // sure" step.
  if(block&&idx===-1){
    if(!confirm('Block '+c.name+'? They won\'t be able to message you, and you won\'t be able to message them.')) return;
    me.blocked.push(c.number);
  }
  else if(!block&&idx!==-1){ me.blocked.splice(idx,1); }
  else{ showToast('Cloudy',block?(c.name+' is already blocked.'):(c.name+' is not blocked.')); return; }
  saveStorage();
  registerOrUpdate(me.blocked).then(()=>{
    if(activeConvo&&activeConvo.number===c.number){
      const btn=document.getElementById('block-menu-item');
      if(btn){ btn.innerHTML=block?'✅ Unblock':'⛔ Block'; }
    }
  });
  showToast('Cloudy',block?('Blocked '+c.name+'.'):('Unblocked '+c.name+'.'));
  cloudySpeak(block?('Blocked '+c.name):('Unblocked '+c.name));
}
// -- REMINDERS (via Cloudy) -----------------------------------------------------
const REMINDER_WEEKDAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
function nextWeekdayAt(day,h,mins){
  const d=new Date(); d.setHours(h,mins,0,0);
  let diff=(day-d.getDay()+7)%7;
  if(diff===0&&d.getTime()<=Date.now()) diff=7;
  d.setDate(d.getDate()+diff);
  return d.getTime();
}
// Validates an hour/minute pair BEFORE it reaches setHours()/setDate(),
// which silently normalize out-of-range values by rolling the date forward
// (setHours(25,...) quietly becomes 1 AM the next day) instead of erroring —
// so a misheard digit (speech-to-text) or a typo used to create a reminder
// silently scheduled for the wrong day/time with no error shown. `ap` is the
// am/pm suffix actually typed/spoken, if any: with one given, the hour must
// be a valid 12-hour-clock value (1-12); without one, it must be 24-hour (0-23).
function _validReminderHM(hRaw,mins,ap){
  if(!Number.isInteger(mins)||mins<0||mins>59) return false;
  if(ap){ return Number.isInteger(hRaw)&&hRaw>=1&&hRaw<=12; }
  return Number.isInteger(hRaw)&&hRaw>=0&&hRaw<=23;
}
function parseReminderTime(str){
  str=str.trim().toLowerCase();
  let m=str.match(/^in (\d+)\s*(minute|min|hour|hr)s?$/);
  if(m){ const n=parseInt(m[1]); const ms=(m[2].startsWith('h')?3600000:60000)*n; return {next:Date.now()+ms,recurDay:null}; }
  m=str.match(/^every (sunday|monday|tuesday|wednesday|thursday|friday|saturday) at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if(m){
    const day=REMINDER_WEEKDAYS.indexOf(m[1]);
    let h=parseInt(m[2]); const mins=m[3]?parseInt(m[3]):0; const ap=m[4];
    if(!_validReminderHM(h,mins,ap)) return null;
    if(ap==='pm'&&h<12) h+=12; if(ap==='am'&&h===12) h=0;
    return {next:nextWeekdayAt(day,h,mins),recurDay:day,recurHour:h,recurMin:mins};
  }
  m=str.match(/^tomorrow at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if(m){
    let h=parseInt(m[1]); const mins=m[2]?parseInt(m[2]):0; const ap=m[3];
    if(!_validReminderHM(h,mins,ap)) return null;
    if(ap==='pm'&&h<12) h+=12; if(ap==='am'&&h===12) h=0;
    const d=new Date(); d.setDate(d.getDate()+1); d.setHours(h,mins,0,0);
    return {next:d.getTime(),recurDay:null};
  }
  m=str.match(/^at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if(m){
    let h=parseInt(m[1]); const mins=m[2]?parseInt(m[2]):0; const ap=m[3];
    if(!_validReminderHM(h,mins,ap)) return null;
    if(ap==='pm'&&h<12) h+=12; if(ap==='am'&&h===12) h=0;
    const d=new Date(); d.setHours(h,mins,0,0);
    if(d.getTime()<=Date.now()) d.setDate(d.getDate()+1);
    return {next:d.getTime(),recurDay:null};
  }
  return null;
}
async function cloudySetReminder(whenStr,text){
  if(!activeConvo){ showToast('Cloudy',scbErr('SCB-ASST-26','Open a chat first.')); return; }
  const parsed=parseReminderTime(whenStr);
  if(!parsed){ showToast('Cloudy 🤔',scbErr('SCB-ASST-27','I couldn\'t understand that time — try "in 10 minutes", "tomorrow at 3pm", or "every friday at 8pm".')); cloudySpeak('I could not understand that time.'); return; }
  if(!convosCache) await getConvos();
  const c=convosCache.find(x=>x&&x.key===activeConvo.key);
  if(!c) return;
  if(!c.reminders) c.reminders=[];
  c.reminders.push({
    id:Date.now().toString(36)+Math.random().toString(36).slice(2,5),
    text, next:parsed.next, recurDay:parsed.recurDay, recurHour:parsed.recurHour, recurMin:parsed.recurMin,
    channelId:activeConvo.type==='group'?(activeChannelId||'general'):null,
    createdBy:me.number
  });
  try{
    await saveConvos();
    showToast('Cloudy ⏰','Reminder set for '+new Date(parsed.next).toLocaleString()+(parsed.recurDay!=null?' (repeats weekly)':'')+'.');
    cloudySpeak('Reminder set.');
  }catch(e){ showToast('Failed',scbErr('SCB-ASST-28','Your reminder couldn\'t be saved.',(e.message||''))); }
}
// Checked once per poll cycle (~25s). Small honest caveat: since every
// client independently polls and there's no server-side lock, it's
// possible (rare, low-stakes) for a reminder to post twice if two people's
// clients both catch it in the same window.
async function checkReminders(){
  if(!convosCache||!me) return;
  const now=Date.now();
  let changed=false;
  for(const c of convosCache){
    if(!c) continue; // defensive: a stray null/undefined entry must never break the whole reminder sweep
    if(!c.reminders||!c.reminders.length) continue;
    const participants=c.participants||c.members||[];
    if(participants.length&&!participants.includes(me.number)) continue;
    for(const r of c.reminders){
      if(!r.next||r.next>now) continue;
      const msg={id:'rem_'+Date.now().toString(36)+Math.random().toString(36).slice(2,4),from:me.number,time:Date.now(),seen:[],system:true,text:enc('⏰ Reminder: '+r.text)};
      if(c.channels) msg.channelId=r.channelId||'general';
      c.messages.push(msg);
      changed=true;
      r.next = (r.recurDay!=null) ? nextWeekdayAt(r.recurDay,r.recurHour,r.recurMin) : null;
      showToast('⏰ Reminder',r.text);
      if(document.hidden) sendNotif('⏰ Reminder',r.text);
    }
  }
  if(changed){ try{ await saveConvos(); if(activeConvo){ const c=convosCache.find(x=>x&&x.key===activeConvo.key); if(c){ lastMsgHash=''; renderMessages(c.messages); } } }catch(e){} }
}
function cloudyArchive(){
  if(!activeConvo){ showToast('Cloudy 🤔',scbErr('SCB-ASST-29','Open a chat first.')); return; }
  archiveToggle();
  showToast('Cloudy','Done.');
}
function cloudyLock(){
  if(!activeConvo){ showToast('Cloudy 🤔',scbErr('SCB-ASST-30','Open a chat first.')); return; }
  lockChatToggle();
}
function cloudyReadMessages(){
  if(!activeConvo){ showToast('Cloudy 🤔',scbErr('SCB-ASST-31','Open a chat first.')); return; }
  const conv=convosCache?convosCache.find(x=>x&&x.key===activeConvo.key):null;
  const msgs=conv?conv.messages:[];
  if(!msgs.length){ showToast('Cloudy',scbErr('SCB-ASST-32','There are no messages here yet.')); cloudySpeak('There are no messages here yet.'); return; }
  const last=msgs[msgs.length-1];
  const who=last.from===me.number?'You':(activeConvo.name||'They');
  const text=last.gif?'a GIF':dec(last.text||'');
  const phrase=who+' said: '+text;
  showToast('Cloudy 🔊',phrase);
  cloudySpeak(phrase);
}


/* =============================================================================
   SoCloudyBro FEATURE PACK
   Everything below is additive. Where an existing function needed new
   behaviour it is re-assigned here (never silently duplicated), keeping the
   original in a `_orig…` reference and calling through to it, which is the
   same patch pattern already used further up this file for openChat().
   ========================================================================== */

// -- SMALL SHARED HELPERS ----------------------------------------------------
// Every localStorage read in this pack goes through here: a corrupt or
// hand-edited value returns the fallback instead of throwing and taking a
// whole init step down with it (same defensive contract as loadStorage()).
function scbLoad(key, fallback){
  try{ const v=JSON.parse(localStorage.getItem(key)); return (v===null||v===undefined)?fallback:v; }
  catch{ return fallback; }
}
function scbSave(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch(e){ console.warn('scbSave failed for '+key, e); return false; }
}

// Purely local "have I personally looked at this message" tracking, kept
// separate from the `seen` array pushed into the shared Firebase message
// record. `seen` is also what powers read receipts shown to the OTHER
// person, and gets skipped entirely when the Read Receipts privacy toggle
// is off — which used to mean turning that toggle off also broke your own
// unread badges (sidebar previews, the browser tab title) forever, since
// they all counted off that same shared field. This set is local-only,
// never synced, and always updated regardless of that privacy setting.
const LOCALLY_SEEN_CAP=3000;
function _isLocallySeen(msgId){
  return scbLoad('cc_locally_seen',[]).includes(msgId);
}
function _markLocallySeen(msgId){
  if(!msgId) return;
  const seen=scbLoad('cc_locally_seen',[]);
  if(seen.includes(msgId)) return;
  seen.push(msgId);
  if(seen.length>LOCALLY_SEEN_CAP) seen.splice(0,seen.length-LOCALLY_SEEN_CAP);
  scbSave('cc_locally_seen',seen);
}

/* =============================================================================
   NOW PLAYING — read-only, best-effort cross-game status
   -----------------------------------------------------------------------------
   The Syntax game family (Cube Leap, Jumpa, Ultimo Chess) shares
   syntax-account.js, which lets a player link their Syntax Account to a
   SoCloudyBro number and announce what they're playing:
       syntax_accounts/<syntaxNumber>/linkedSoCloudyBro = <scbNumber>
       syntax_accounts/<syntaxNumber>/nowPlaying        = {gameId, since}
   Those live in a DIFFERENT Firebase project from this app (this app is
   socloudybro-b8606-…; the games are syntaxgroup-…), so there is no way to
   read them through the `fbdb` handle this file uses. A second Firebase SDK
   app instance would work, but for a read-only lookup on a database the games
   already read over plain unauthenticated REST, a `fetch` of the same REST
   endpoint is strictly simpler and adds no SDK state to keep in sync — same
   approach as syntax-account.js's own dbGet().

   Everything here is best-effort by design: unreachable project, no linked
   account, malformed record and stale timestamp all resolve to "show nothing".
   There is no error surface and no retry storm — see the notes on each guard.
   ========================================================================== */
const SYNTAX_DB_URL='https://syntaxgroup-default-rtdb.europe-west1.firebasedatabase.app';
const NOW_PLAYING_GAME_NAMES={'cube-leap':'Cube Leap','jumpa':'Jumpa','ultimo-chess':'Ultimo Chess'};
// A game that crashes or is closed by killing the tab may never clear its
// nowPlaying, so a timestamp is required and anything older than this is
// treated as "not actually playing" rather than showing a wrong status forever.
const NOW_PLAYING_MAX_AGE_MS=10*60*1000;
const NOW_PLAYING_TTL_MS=45*1000;      // positive/negative result cache
const _nowPlayingCache={};             // scbNumber -> {at, value|null}
const _nowPlayingInFlight={};          // scbNumber -> Promise (coalesce concurrent lookups)
function nowPlayingEnabled(){ return scbLoad('cc_now_playing_enabled', true)!==false; }
function nowPlayingGameLabel(gameId){
  if(typeof gameId!=='string') return null;
  if(NOW_PLAYING_GAME_NAMES[gameId]) return NOW_PLAYING_GAME_NAMES[gameId];
  // An unknown id is still shown, but only if it looks like a game id — never
  // rendered as whatever arbitrary string happened to be in the record.
  if(!/^[a-z0-9][a-z0-9-]{0,30}$/.test(gameId)) return null;
  return gameId.split('-').map(p=>p.charAt(0).toUpperCase()+p.slice(1)).join(' ');
}
// Returns {gameId, label, since} or null. Never throws, never shows an error.
async function lookupNowPlaying(scbNumber){
  scbNumber=Number(scbNumber);
  if(!nowPlayingEnabled()||!Number.isFinite(scbNumber)||scbNumber<=0) return null;
  const hit=_nowPlayingCache[scbNumber];
  if(hit&&Date.now()-hit.at<NOW_PLAYING_TTL_MS) return hit.value;
  if(_nowPlayingInFlight[scbNumber]) return _nowPlayingInFlight[scbNumber];
  const p=(async()=>{
    let value=null;
    try{
      // Reverse lookup: which Syntax Account claims this SCB number? Done as
      // an indexed REST query so one small response comes back instead of the
      // whole syntax_accounts table (which also holds password hashes).
      // Requires `.indexOn: ["linkedSoCloudyBro"]` on syntax_accounts in the
      // Syntax project's rules; without it Firebase 400s and this degrades to
      // showing nothing, which is the documented fallback, not a break.
      const url=SYNTAX_DB_URL+'/syntax_accounts.json?orderBy='+encodeURIComponent('"linkedSoCloudyBro"')
        +'&equalTo='+encodeURIComponent(String(scbNumber))+'&limitToFirst=5';
      const res=await fetch(url);
      if(res.ok){
        const all=await res.json();
        if(all&&typeof all==='object'){
          for(const acct of Object.values(all)){
            if(!acct||typeof acct!=='object') continue;
            if(Number(acct.linkedSoCloudyBro)!==scbNumber) continue; // don't trust the query alone
            const np=acct.nowPlaying;
            if(!np||typeof np!=='object') continue;
            const since=Number(np.since);
            if(!Number.isFinite(since)) continue;
            if(Date.now()-since>NOW_PLAYING_MAX_AGE_MS) continue; // stale => not playing
            if(since-Date.now()>NOW_PLAYING_MAX_AGE_MS) continue;  // clock-skewed future stamp
            const label=nowPlayingGameLabel(np.gameId);
            if(!label) continue;
            value={gameId:np.gameId,label,since};
            break;
          }
        }
      }
    }catch(e){
      // Offline, blocked, CORS, project down, rules changed — all the same
      // outcome: no pill. Cached as a negative result so a broken Syntax
      // project doesn't mean a fetch on every panel open.
      value=null;
    }
    _nowPlayingCache[scbNumber]={at:Date.now(),value};
    delete _nowPlayingInFlight[scbNumber];
    return value;
  })();
  _nowPlayingInFlight[scbNumber]=p;
  return p;
}
// Fills the pill in the contact panel. Only ever called for the contact whose
// panel is open, so the other project sees one request per panel open at most
// (and none at all within the cache TTL) rather than one per contact per render.
async function renderNowPlayingPill(scbNumber){
  const el=document.getElementById('cp-nowplaying');
  if(!el) return;
  el.style.display='none'; el.innerHTML='';
  if(!nowPlayingEnabled()) return;
  const np=await lookupNowPlaying(scbNumber);
  // The panel may have been closed or switched to another contact while the
  // request was in flight — re-check before painting, so a slow response can
  // never label the wrong person as playing something.
  if(!np||!activeConvo||Number(activeConvo.number)!==Number(scbNumber)) return;
  const overlay=document.getElementById('contact-panel-overlay');
  if(overlay&&!overlay.classList.contains('visible')) return;
  el.innerHTML='<span style="display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;'
    +'background:var(--accent);color:#fff">🎮 Playing '+esc(np.label)+'!</span>';
  el.style.display='block';
}
// Same patch pattern used elsewhere in this file rather than editing
// openContactPanel() in place, so the panel keeps working unchanged if this
// lookup (or the whole Syntax project) is ever removed.
const _origOpenContactPanelForNowPlaying=openContactPanel;
openContactPanel=function(){
  const r=_origOpenContactPanelForNowPlaying.apply(this,arguments);
  try{
    const el=document.getElementById('cp-nowplaying');
    if(el){ el.style.display='none'; el.innerHTML=''; }
    if(activeConvo&&activeConvo.type!=='group'&&activeConvo.number){
      renderNowPlayingPill(activeConvo.number).catch(()=>{});
    }
  }catch(e){ /* best-effort only — never block the panel */ }
  return r;
};

/* =============================================================================
   MUSIC NOW PLAYING — Spotify + Last.fm
   Polls the signed-in user's current track every 30 s and writes it to
   users/<myNumber>/musicNowPlaying in Firebase so contacts can see it.
   Contacts' music status is read directly from Firebase when their panel opens.
   ========================================================================== */
const SPOTIFY_CLIENT_ID = 'c0528b9e158b4bfab6a1135e3ec2d0e8';
const SPOTIFY_REDIRECT_URI = SITE_URL + '/';
const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state';
let LASTFM_API_KEY = '3f2d804a4670e778decdc44f3c8bb43e';
const MUSIC_NP_PATH = 'musicNowPlaying';
const MUSIC_NP_MAX_AGE_MS = 5 * 60 * 1000;
let _musicPollTimer = null;
let _lastMusicTrackKey = null;

// -- Spotify PKCE helpers --
function _musicRandStr(len){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(len))).map(x=>chars[x%chars.length]).join('');
}
async function _pkceChallenge(v){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

function getSpotifyTokens(){ try{const r=localStorage.getItem('scb_spotify_tokens');return r?JSON.parse(r):null;}catch{return null;} }
function setSpotifyTokens(t){ try{localStorage.setItem('scb_spotify_tokens',JSON.stringify(t));}catch{} }
function clearSpotifyTokens(){ try{localStorage.removeItem('scb_spotify_tokens');localStorage.removeItem('scb_spotify_pkce');}catch{} }
function getLastfmUsername(){ return localStorage.getItem('scb_lastfm_username')||''; }
function setLastfmUsername(u){ localStorage.setItem('scb_lastfm_username',u); }
function clearLastfmUsername(){ localStorage.removeItem('scb_lastfm_username'); }

async function _spotifyRefresh(refreshToken){
  const res=await fetch('https://accounts.spotify.com/api/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken,client_id:SPOTIFY_CLIENT_ID})});
  if(!res.ok) throw new Error('Spotify refresh failed');
  const d=await res.json();
  const t={access_token:d.access_token,refresh_token:d.refresh_token||refreshToken,expires_at:Date.now()+(d.expires_in||3600)*1000};
  setSpotifyTokens(t); return t;
}
async function _getSpotifyToken(){
  let t=getSpotifyTokens(); if(!t) return null;
  if(Date.now()>t.expires_at-60000){ try{t=await _spotifyRefresh(t.refresh_token);}catch{clearSpotifyTokens();return null;} }
  return t.access_token;
}

async function connectSpotify(){
  const v=_musicRandStr(128);
  localStorage.setItem('scb_spotify_pkce',v);
  const p=new URLSearchParams({client_id:SPOTIFY_CLIENT_ID,response_type:'code',redirect_uri:SPOTIFY_REDIRECT_URI,code_challenge_method:'S256',code_challenge:await _pkceChallenge(v),scope:SPOTIFY_SCOPES,state:'scb_spotify'});
  window.location.href='https://accounts.spotify.com/authorize?'+p;
}

async function handleSpotifyCallback(){
  const url=new URL(window.location.href);
  if(url.searchParams.get('state')!=='scb_spotify') return;
  const code=url.searchParams.get('code');
  url.searchParams.delete('code'); url.searchParams.delete('state'); url.searchParams.delete('error');
  window.history.replaceState({},'',url.toString());
  if(!code) return;
  const verifier=localStorage.getItem('scb_spotify_pkce');
  if(!verifier) return;
  localStorage.removeItem('scb_spotify_pkce');
  try{
    const res=await fetch('https://accounts.spotify.com/api/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:SPOTIFY_REDIRECT_URI,client_id:SPOTIFY_CLIENT_ID,code_verifier:verifier})});
    if(!res.ok) throw new Error('Token exchange failed');
    const d=await res.json();
    setSpotifyTokens({access_token:d.access_token,refresh_token:d.refresh_token,expires_at:Date.now()+(d.expires_in||3600)*1000});
    startMusicPolling();
    renderMusicSettings();
  }catch(e){ showToast('Spotify connect failed: '+e.message,''); }
}
handleSpotifyCallback().catch(()=>{});

async function pollSpotifyNP(){
  const token=await _getSpotifyToken(); if(!token) return null;
  try{
    const res=await fetch('https://api.spotify.com/v1/me/player/currently-playing',{headers:{Authorization:'Bearer '+token}});
    if(res.status===204||res.status===404) return null;
    if(!res.ok){ if(res.status===401){clearSpotifyTokens();} return null; }
    const d=await res.json();
    if(!d||!d.is_playing||!d.item) return null;
    return {platform:'spotify',track:d.item.name,artist:(d.item.artists||[]).map(a=>a.name).join(', '),albumArt:d.item.album?.images?.[1]?.url||d.item.album?.images?.[0]?.url||null,since:Date.now()};
  }catch{return null;}
}

async function pollLastfmNP(){
  const username=getLastfmUsername(); if(!username||!LASTFM_API_KEY) return null;
  try{
    const res=await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getRecentTracks&user=${encodeURIComponent(username)}&api_key=${LASTFM_API_KEY}&format=json&limit=1`);
    if(!res.ok) return null;
    const d=await res.json();
    const tracks=d?.recenttracks?.track; if(!tracks) return null;
    const t=Array.isArray(tracks)?tracks[0]:tracks;
    if(!t?.['@attr']?.nowplaying) return null;
    const artist=typeof t.artist==='string'?t.artist:(t.artist?.['#text']||'');
    const albumArt=t.image?.find(i=>i.size==='medium')?.['#text']||null;
    return {platform:'lastfm',track:t.name,artist,albumArt:albumArt||null,since:Date.now()};
  }catch{return null;}
}

async function pollAndUpdateMusicNP(){
  if(!me) return;
  let np=await pollSpotifyNP();
  if(!np) np=await pollLastfmNP();
  const key=np?np.track+'|'+np.artist:null;
  if(key===_lastMusicTrackKey) return; // unchanged
  _lastMusicTrackKey=key;
  try{
    const ref=fbdb.ref(USERS_BIN+'/'+me.number+'/'+MUSIC_NP_PATH);
    if(np) await ref.set(np); else await ref.remove();
  }catch{}
}

function startMusicPolling(){
  stopMusicPolling();
  pollAndUpdateMusicNP();
  _musicPollTimer=setInterval(pollAndUpdateMusicNP,30000);
}
function stopMusicPolling(){ clearInterval(_musicPollTimer); _musicPollTimer=null; }

// Show contact's music status in their contact panel
async function renderMusicPill(scbNumber){
  const el=document.getElementById('cp-music');
  if(!el) return;
  el.style.display='none'; el.innerHTML='';
  try{
    const snap=await fbdb.ref(USERS_BIN+'/'+scbNumber+'/'+MUSIC_NP_PATH).get();
    const np=snap.val();
    if(!np||!np.track) return;
    if(Date.now()-np.since>MUSIC_NP_MAX_AGE_MS) return;
    if(!activeConvo||Number(activeConvo.number)!==Number(scbNumber)) return;
    const overlay=document.getElementById('contact-panel-overlay');
    if(overlay&&!overlay.classList.contains('visible')) return;
    const green='#1ed760'; const red='#c0392b';
    const bg=np.platform==='spotify'?'linear-gradient(90deg,#1ed760,#0d9944)':'linear-gradient(90deg,#d51007,#9e0906)';
    el.innerHTML='<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;background:'+bg+';color:#fff">'
      +'🎵 '+esc(np.track)+(np.artist?' · '+esc(np.artist):'')+'</span>';
    el.style.display='block';
  }catch{}
}
// Patch openContactPanel to also load music pill
const _origOpenContactPanelForMusic=openContactPanel;
openContactPanel=function(){
  const r=_origOpenContactPanelForMusic.apply(this,arguments);
  try{
    const el=document.getElementById('cp-music');
    if(el){ el.style.display='none'; el.innerHTML=''; }
    if(activeConvo&&activeConvo.type!=='group'&&activeConvo.number){
      renderMusicPill(activeConvo.number).catch(()=>{});
    }
  }catch(e){}
  return r;
};

function renderMusicSettings(){
  // Spotify row
  const spTokens=getSpotifyTokens();
  const spConn=document.getElementById('scb-spotify-connect-btn');
  const spDisc=document.getElementById('scb-spotify-disconnect-btn');
  const spSub=document.getElementById('scb-spotify-sub');
  if(spConn&&spDisc&&spSub){
    if(spTokens){
      spConn.style.display='none'; spDisc.style.display='';
      spSub.textContent='Connected — your current track is shared as your status';
    }else{
      spConn.style.display=''; spDisc.style.display='none';
      spSub.textContent='Not connected';
    }
    spConn.onclick=connectSpotify;
    spDisc.onclick=()=>{ clearSpotifyTokens(); stopMusicPolling(); renderMusicSettings(); if(me) fbdb.ref(USERS_BIN+'/'+me.number+'/'+MUSIC_NP_PATH).remove().catch(()=>{}); };
  }
  // Last.fm row
  const lfmUser=getLastfmUsername();
  const lfmInput=document.getElementById('scb-lastfm-input');
  const lfmConn=document.getElementById('scb-lastfm-connect-btn');
  const lfmDisc=document.getElementById('scb-lastfm-disconnect-btn');
  const lfmSub=document.getElementById('scb-lastfm-sub');
  if(lfmConn&&lfmDisc){
    if(lfmUser){
      if(lfmInput) lfmInput.style.display='none';
      lfmConn.style.display='none'; lfmDisc.style.display='';
      if(lfmSub) lfmSub.textContent='Connected as @'+lfmUser;
    }else{
      if(lfmInput) lfmInput.style.display='';
      lfmConn.style.display=''; lfmDisc.style.display='none';
      if(lfmSub) lfmSub.textContent='Not connected — enter your Last.fm username so contacts can see what you\'re listening to';
    }
    lfmConn.onclick=()=>{
      const u=(lfmInput?.value||'').trim();
      if(!u){ showToast('Enter your Last.fm username',''); return; }
      setLastfmUsername(u); startMusicPolling(); renderMusicSettings();
    };
    lfmDisc.onclick=()=>{ clearLastfmUsername(); renderMusicSettings(); if(me) fbdb.ref(USERS_BIN+'/'+me.number+'/'+MUSIC_NP_PATH).remove().catch(()=>{}); };
  }
}

/* =============================================================================
   BOT CAPTCHA + SPAM / BOT DETECTION
   Captcha: random arithmetic/logic puzzle shown on every signup, regenerated
   on each wrong attempt. Checked before any Firebase writes in submitSetup().
   Spam detector: sliding-window rate-limit in sendMsg(). Flags written to
   Firebase spam_flags/<push-id> for admin review.
   ========================================================================== */

