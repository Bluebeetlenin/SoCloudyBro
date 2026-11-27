// ── ONE-SIDED MESSAGING FIX ───────────────────────────────────────────────────
// Already handled by syncContactsFromConvos — but we also need to make sure
// when sendMsg is called, the convo is created with proper participants
// and the receiver will find it. This is already done via getOrMakeConvo.
// The extra fix: when sender sends a DM, ensure recipient's number is in participants.

// ── PATCH renderMessages TO SUPPORT REACTIONS + POLLS ────────────────────────
// We monkey-patch the existing renderMessages
// renderMessages fully replaced below
function renderFileBubble(bubble,fileData){
  const url=esc(fileData.url||'');
  const name=esc(fileData.name||'file');
  const type=fileData.type||'';
  const size=fmtFileSize(fileData.size);
  if(type.startsWith('image/')){
    bubble.className='bubble gif-bubble';
    bubble.innerHTML='<a href="'+url+'" target="_blank" rel="noopener"><img src="'+url+'" alt="'+name+'" loading="lazy"/></a>';
  }else if(type.startsWith('audio/')){
    bubble.className='bubble audio-bubble';
    const aid='au'+Math.random().toString(36).slice(2);
    bubble.innerHTML='<audio id="'+aid+'" controls preload="metadata" src="'+url+'"></audio>'
      +'<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">'
      +[0.75,1,1.5,2].map(s=>'<button data-aid="'+aid+'" data-speed="'+s+'" onclick="setAudioSpeed(this.dataset.aid,Number(this.dataset.speed),this)" style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:1px 7px;font-size:10px;cursor:pointer;color:var(--muted);transition:.1s" class="speed-btn'+(s===1?' speed-active':'')+'">'+(s===1?'1×':s+'×')+'</button>').join('')
      +'</div>';
  }else{
    bubble.className='bubble file-bubble';
    bubble.innerHTML='<span class="file-icon">📄</span><div class="file-info"><div class="file-name">'+name+'</div><div class="file-size">'+size+'</div></div><a class="file-dl" href="'+url+'" target="_blank" rel="noopener" download title="Download">⬇️</a>';
  }
}
function toggleMsgExpand(toggleEl){
  const bubble=toggleEl.closest('.bubble');
  const collapsed=bubble.querySelector('.msg-collapsed-body');
  const full=bubble.querySelector('.msg-full-body');
  const expanded=full.style.display!=='none';
  full.style.display=expanded?'none':'block';
  collapsed.style.display=expanded?'block':'none';
  toggleEl.textContent=expanded?'Show more':'Show less';
}
// Records that you've looked at a message. Local tracking drives your own unread
// badges and always happens. The shared `seen` list is what shows a read receipt
// to the other person, so it respects the Read Receipts setting.
function _markShown(m){
  _markLocallySeen(m.id);
  if(!getPrivacyPref('readReceipts',true)||(m.seen&&m.seen.includes(me.number))) return;
  if(!m.seen) m.seen=[];
  m.seen.push(me.number);
  _convosDirty=true; saveConvos().catch(e=>console.warn('read receipt save failed',e));
}
function renderMessages(msgs) {
  // Nothing is marked read or consumed while this is still a message request.
  const _isReq = !!(activeConvo && isRequestKey(activeConvo.key));
  // Security feature 25/32: shadow-mute. A shadow-muted sender's messages
  // are still shown to THEM (so they get no indication anything is wrong —
  // no ban notice, nothing), but never rendered for anyone else. The
  // message is still technically saved (msg.shadowMuted, set in sendMsg()),
  // just filtered out of every OTHER participant's render.
  if (me) {
    msgs = (msgs || []).filter(m => !m || !m.shadowMuted || m.from === me.number);
  }
  if (activeConvo && activeConvo.type === 'group') {
    const chId = activeChannelId || 'general';
    msgs = (msgs || []).filter(m => (m.channelId || 'general') === chId);
    // Security feature 29/32: a quarantined message stays visible to its
    // own sender and to the group's admins/mods (who need to see it to
    // approve), but hidden from everyone else until approved.
    if (me) msgs = (msgs || []).filter(m => !m || !m.quarantined || m.from === me.number || isGroupAdmin());
  }
  // Threads: a reply is a completely normal message (same array, same
  // encryption, same realtime sync — see openThread()/sendThreadReply()),
  // tagged with threadOf so it rides every existing pipeline for free.
  // Roll it up into a "N replies" pill on its parent here instead of
  // rendering it inline in the main channel.
  const _threadReplyCounts = {};
  (msgs || []).forEach(m => { if (m && m.threadOf) _threadReplyCounts[m.threadOf] = (_threadReplyCounts[m.threadOf] || 0) + 1; });
  msgs = (msgs || []).filter(m => !m || !m.threadOf);
  // Disappearing messages: hide expired ones; they'll be pruned on next save
  if (activeConvo && convosCache) {
    const _conv = convosCache.find(x => x && x.key === activeConvo.key);
    // Runs whenever EITHER mechanism could apply — the conversation has a
    // disappearAfter timer, or any message here carries its own zrExpireAt
    // (Zero Retention Mode) — not just the conv-wide timer alone, or a
    // zero-retention message in a conversation with no disappearAfter set
    // would never get filtered/pruned at all.
    const _hasZr = (msgs||[]).some(m=>m&&m.zrExpireAt);
    if (_conv && (_conv.disappearAfter || _hasZr)) {
      msgs = _applyDisappearingFilter(msgs || [], _conv.disappearAfter||0);
      // Schedule an actual prune+save when the next message would expire —
      // not just a re-render. _applyDisappearingFilter() only ever produced
      // a filtered VIEW for rendering; nothing forced the expired message
      // out of _conv.messages/Firebase at the moment it expired, so
      // deletion from storage was purely incidental, dependent on some
      // unrelated save happening to fire for this conversation afterward.
      // Until that happened, the "disappeared" message was still sitting in
      // the live database, readable by anyone with DB read access.
      const next = _nextDisappearTime(msgs, _conv.disappearAfter||0);
      if(next<Infinity){
        const delay=Math.max(1000,next-Date.now());
        clearTimeout(_disappearRenderTimer);
        _disappearRenderTimer=setTimeout(()=>{
          if(!_conv) return;
          const before=_conv.messages.length;
          _conv.messages=_applyDisappearingFilter(_conv.messages,_conv.disappearAfter||0);
          if(_conv.messages.length!==before){ _convosDirty=true; saveConvos().catch(()=>{}); }
          lastMsgHash=''; if(activeConvo&&_conv.key===activeConvo.key) renderMessages(_conv.messages);
        },delay);
      }
    }
  }
  const hash = JSON.stringify(msgs);
  if (hash === lastMsgHash) return;
  lastMsgHash = hash;
  // Decrypt any pending E2E-encrypted messages, then re-render once ready
  if (msgs && msgs.some(m => m && (m.ctext || m.cgif || m.cpoll || m.cfile || m.cevt) && !_decCache[m.id])) {
    const c = convosCache && activeConvo ? convosCache.find(x=>x&&x.key === activeConvo.key) : null;
    if (c) decryptConvoMessages(c).then(() => { lastMsgHash = ''; renderMessages(c.messages); });
  }
  const wrap = document.getElementById('messages-wrap');
  const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 100;
  wrap.innerHTML = '';
  if (!msgs || !msgs.length) {
    wrap.innerHTML = '<div id="chat-empty"><div class="icon">\uD83D\uDCAC</div><div class="empty-title">No messages yet</div><div class="empty-sub">Send the first message and say hello!</div></div>';
    return;
  }
  let lastDate = '';
  // Group runs of 3+ consecutive system messages ("X joined the group",
  // "Y left the group") so a busy group's join/leave churn doesn't flood
  // the chat — only the run's first index renders anything; the rest are
  // folded into that one collapsible summary.
  const _sysRunInfo = {};
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i] && msgs[i].type === 'system' && !(msgs[i-1] && msgs[i-1].type === 'system')) {
      let j = i; while (j < msgs.length && msgs[j] && msgs[j].type === 'system') j++;
      _sysRunInfo[i] = j - i;
    }
  }
  msgs.forEach((m, _msgIdx) => {
    try{
    if(!m) return; // skip null/undefined slots (Bug 3: prevents spurious SCB-MSG-15)
    if (m.type === 'system' && !_sysRunInfo[_msgIdx]) return; // folded into an earlier collapsed run
    const isMe = m.from === me.number;
    // Mark as read here, before the early returns below, so polls, games, pings
    // and events don't stay unread forever.
    if (!_isReq && !isMe && m.type !== 'system' && !m.selfDestruct) _markShown(m);
    const d = new Date(m.time);
    const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      const div = document.createElement('div'); div.className = 'date-divider'; div.innerHTML = '<span class="date-divider-label">' + dateStr + '</span>'; wrap.appendChild(div);
    }
    // System message — group membership changes etc. Runs of 3+ collapse
    // into one expandable summary (see _sysRunInfo above).
    if (m.type === 'system') {
      const runLen = _sysRunInfo[_msgIdx];
      if (runLen < 3) {
        const row = document.createElement('div'); row.className = 'call-event-row';
        const pill = document.createElement('div'); pill.className = 'call-event-pill';
        pill.style.cursor = 'default';
        pill.textContent = m.text || '';
        row.appendChild(pill); wrap.appendChild(row);
        return;
      }
      const runMsgs = msgs.slice(_msgIdx, _msgIdx + runLen);
      const summaryRow = document.createElement('div'); summaryRow.className = 'call-event-row';
      const summaryPill = document.createElement('div'); summaryPill.className = 'call-event-pill';
      summaryPill.innerHTML = '<span>' + runLen + ' group updates</span><span class="sys-collapse-caret">▾</span>';
      summaryRow.appendChild(summaryPill); wrap.appendChild(summaryRow);
      const detail = document.createElement('div'); detail.style.display = 'none';
      runMsgs.forEach(rm => {
        const r = document.createElement('div'); r.className = 'call-event-row';
        const p = document.createElement('div'); p.className = 'call-event-pill'; p.style.cursor = 'default';
        p.textContent = rm.text || '';
        r.appendChild(p); detail.appendChild(r);
      });
      wrap.appendChild(detail);
      summaryPill.onclick = () => {
        const open = detail.style.display !== 'none';
        detail.style.display = open ? 'none' : 'block';
        summaryPill.querySelector('.sys-collapse-caret').textContent = open ? '▾' : '▴';
      };
      return;
    }
    // Ping — a lightweight "hey" nudge, rendered as its own centered pill
    if (m.type === 'ping') {
      const isMePing = m.from === me.number;
      const other = isMePing ? (activeConvo && activeConvo.name) : (lookupUser(m.from)||{}).name;
      const timeStr3 = new Date(m.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      const row = document.createElement('div'); row.className = 'call-event-row';
      const pill = document.createElement('div'); pill.className = 'call-event-pill ping-event-pill';
      pill.innerHTML = '<span>🔔</span><span>' + esc(isMePing ? 'You pinged '+(dec(other)||'them') : (dec(other)||'Someone')+' pinged you') + '</span><span style="color:inherit;opacity:.7"> · ' + esc(timeStr3) + '</span>';
      row.appendChild(pill);
      wrap.appendChild(row);
      return;
    }
    // Call event message (WhatsApp-style)
    if (m.type === 'call') {
      const durStr = fmtCallDuration(m.duration||0);
      const timeStr2 = new Date(m.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      const iStarted = m.initiator==null || String(m.initiator)===String(me.number);
      let icon, labelHtml, isBad=false;
      if(m.callType==='declined'){
        icon='📞'; isBad=true;
        labelHtml='<span class="call-ev-missed">'+esc((iStarted?'Outgoing':'Incoming')+' call · Declined')+'</span>';
      } else if(m.callType==='no_answer'){
        icon='📞'; isBad=true;
        labelHtml='<span class="call-ev-missed">No answer</span>';
      } else if(m.missed){
        icon='📞'; isBad=true;
        labelHtml='<span class="call-ev-missed">'+esc(scbT('missed_call'))+'</span>';
      } else {
        icon='📞';
        labelHtml=esc(iStarted?'Outgoing call':scbT('voice_call'));
      }
      const detail = [timeStr2, durStr].filter(Boolean).join(' · ');
      const row = document.createElement('div'); row.className = 'call-event-row';
      const pill = document.createElement('div'); pill.className = 'call-event-pill';
      pill.innerHTML = '<span class="call-ev-icon'+(isBad?' call-ev-missed':'')+'">'+icon+'</span>'
        +'<span>'+labelHtml+(detail ? ' · <span style="color:var(--muted)">'+esc(detail)+'</span>' : '')+'</span>';
      pill.title = 'Tap to call';
      pill.onclick = function(){
        if(activeConvo && activeConvo.type !== 'group'){
          const c = contacts.find(x => x.key === activeConvo.key);
          if(c) startDirectCall(c);
        }
      };
      row.appendChild(pill);
      wrap.appendChild(row);
      return;
    }
    // Group event
    if (m.evt || m.cevt) {
      const row = document.createElement('div');
      row.className = 'msg-row ' + (isMe ? 'me' : 'them');
      row.setAttribute('data-msg-id', m.id);
      row.oncontextmenu = e => { e.preventDefault(); showCtxMenu(e, m); };
      const body = document.createElement('div'); body.className = 'msg-body';
      if (!isMe) { const sn = document.createElement('div'); sn.className = 'msg-sender-name'; sn.textContent = dec((lookupUser(m.from)||{}).name) || ('#' + m.from); body.appendChild(sn); }
      renderEventCard(m, body);
      row.appendChild(body); wrap.appendChild(row); return;
    }
    // Poll message
    if (m.poll || m.cpoll) {
      const row = document.createElement('div');
      row.className = 'msg-row ' + (isMe ? 'me' : 'them');
      row.setAttribute('data-msg-id', m.id);
      const body = document.createElement('div'); body.className = 'msg-body';
      const pollData = msgPollData(m);
      if (pollData) renderPoll(pollData, m.id, body);
      row.appendChild(body); wrap.appendChild(row); return;
    }
    // Mini-game message
    if (m.game) {
      const row = document.createElement('div');
      row.className = 'msg-row ' + (isMe ? 'me' : 'them');
      row.setAttribute('data-msg-id', m.id);
      const body = document.createElement('div'); body.className = 'msg-body';
      renderGame(m.game, m.id, body);
      row.appendChild(body); wrap.appendChild(row); return;
    }
    // /me narration — the slash-command palette promises "Narrate an action"
    // but this used to just send "/me waves hello" as a plain text bubble,
    // literal slash and all. Render it as a centered italic action line instead.
    const _meText = !m.poll && !m.cpoll && !m.game && !msgHasGif(m) && !msgFileData(m) ? msgText(m) : null;
    if (typeof _meText === 'string' && _meText.startsWith('/me ') && _meText.length > 4) {
      const actor = isMe ? 'You' : (dec((lookupUser(m.from)||{}).name || '') || ('#' + m.from));
      const action = _meText.slice(4).trim();
      const timeStrMe = new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const row = document.createElement('div'); row.className = 'call-event-row';
      const pill = document.createElement('div'); pill.className = 'call-event-pill'; pill.style.fontStyle = 'italic';
      pill.innerHTML = '<span>✱</span><span>' + esc(actor + ' ' + action) + '</span><span style="color:inherit;opacity:.7"> · ' + esc(timeStrMe) + '</span>';
      row.appendChild(pill); wrap.appendChild(row);
      return;
    }
    const row = document.createElement('div'); row.className = 'msg-row ' + (isMe ? 'me' : 'them') + (m.mentions && me && m.mentions.includes(me.number) ? ' mentioned-msg' : '');
    row.setAttribute('data-msg-id', m.id);
    if (activeConvo && activeConvo.type === 'group' && !isMe) {
      const u = lookupUser(m.from) || {};
      const avDiv = document.createElement('div'); avDiv.className = 'msg-avatar';
      avDiv.style.cssText = 'background:var(--accent);color:#fff;cursor:pointer;';
      avDiv.title = 'View profile';
      avDiv.onclick = (ev) => { ev.stopPropagation(); openUserProfile(m.from); };
      avDiv.addEventListener('mouseenter', () => scheduleUserHoverCard(m.from, avDiv));
      avDiv.addEventListener('mouseleave', cancelUserHoverCard);
      if (typeof u.avatar==='string' && (u.avatar.startsWith('data:image/')||u.avatar.startsWith('https://')) && u.avatar.length < 500000){ const img=document.createElement('img'); img.src=u.avatar; img.style.cssText='width:100%;height:100%;object-fit:cover;'; avDiv.appendChild(img); }
      else avDiv.textContent = (dec(u.name || '') || '?').charAt(0).toUpperCase();
      row.appendChild(avDiv);
    }
    const body = document.createElement('div'); body.className = 'msg-body';
    if (activeConvo && activeConvo.type === 'group' && !isMe) {
      const sn = document.createElement('div'); sn.className = 'msg-sender-name';
      sn.style.cssText = 'cursor:pointer;width:fit-content';
      sn.title = 'View profile';
      const u = lookupUser(m.from) || {}; sn.innerHTML = esc(dec(u.name || '') || '#' + m.from) + verifiedBadge(m.from) + equippedBadgeHtml(m.from);
      sn.onclick = (ev) => { ev.stopPropagation(); openUserProfile(m.from); };
      body.appendChild(sn);
    }
    if (m.forwarded) {
      const fwd = document.createElement('div'); fwd.style.cssText = 'font-size:10px;color:var(--muted);padding:0 4px;margin-bottom:2px;font-style:italic';
      fwd.textContent = '↪ Forwarded'; body.appendChild(fwd);
    }
    if (m.replyTo) {
      const rq = document.createElement('div'); rq.className = 'msg-reply-quote';
      rq.innerHTML = '<b>' + esc(m.replyTo.name || '') + '</b>: ' + esc(m.replyTo.snippet || '');
      rq.onclick = (ev) => { ev.stopPropagation(); scrollToMessage(m.replyTo.id); };
      body.appendChild(rq);
    }
    if (m.selfDestruct && isMe) {
      const sdBadge=document.createElement('div');
      sdBadge.style.cssText='font-size:10px;color:var(--muted);padding:0 4px;margin-bottom:2px;display:flex;align-items:center;gap:3px';
      sdBadge.innerHTML='💣 <span>View once</span>';
      body.appendChild(sdBadge);
    }
    const bubble = document.createElement('div');
    const fileData = msgFileData(m);
    if (_isReq && m.selfDestruct && !isMe) { bubble.className = 'bubble'; bubble.textContent = 'View-once message. Accept the request to open it.'; }
    else if (msgHasGif(m)) { const gifSrc = normalizeGifUrl(msgGifUrl(m)); bubble.className = 'bubble gif-bubble'; bubble.innerHTML = '<img src="' + esc(gifSrc) + '" alt="GIF" loading="lazy" data-gif-src="' + esc(gifSrc) + '" onerror="gifImgFail(this,this.dataset.gifSrc)"/>'; }
    else if (fileData) { renderFileBubble(bubble, fileData); }
    else {
      const _decFailed = _decCache[m.id]&&_decCache[m.id].textFailed;
      bubble.className = m.pending ? 'bubble pending-bubble' : _decFailed ? 'bubble decrypt-failed-bubble' : 'bubble';
      const rendered = renderMsgTextWithMentions(filterBadWords(msgText(m)));
      const plainLen = msgText(m).length;
      if (plainLen > 600) {
        // Long messages collapse to a preview with a "Show more" toggle rather
        // than pushing the whole chat log out of view for one message.
        const previewText = renderMsgTextWithMentions(filterBadWords(msgText(m).slice(0, 500)));
        bubble.innerHTML = `<div class="msg-collapsed-body">${previewText}\u2026</div><div class="msg-full-body" style="display:none">${rendered}</div><span class="msg-expand-toggle">Show more</span>`;
        const _expandBtn = bubble.querySelector('.msg-expand-toggle');
        if (_expandBtn) _expandBtn.onclick = e => { e.stopPropagation(); toggleMsgExpand(_expandBtn); };
      } else {
        bubble.innerHTML = rendered;
      }
    }
    bubble.oncontextmenu = e => { e.preventDefault(); showCtxMenu(e, m); };
    bubble.addEventListener('dblclick', e => showReactionPicker(e, m));
    const quickReactRow = document.createElement('div');
    quickReactRow.className = 'quick-react-row';
    // Reply action (Discord-style hover toolbar)
    const replyBtn = document.createElement('span');
    replyBtn.className = 'quick-react-btn';
    replyBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style="opacity:.7"><path d="M6.5 2L1 7l5.5 5V9.5c3.5 0 6 1 7.5 4.5C14 9 11.5 5 6.5 5V2z"/></svg>';
    replyBtn.title = 'Reply';
    replyBtn.onclick = e => { e.stopPropagation(); startReply(m); };
    quickReactRow.appendChild(replyBtn);
    // Divider
    const div = document.createElement('span');
    div.style.cssText = 'width:1px;height:14px;background:var(--border2);flex-shrink:0;margin:0 2px';
    quickReactRow.appendChild(div);
    ['👍','❤️','😂','😮','🙂'].forEach(emoji => {
      const qr = document.createElement('span');
      qr.className = 'quick-react-btn';
      qr.textContent = emoji;
      qr.title = 'React with ' + emoji;
      qr.onclick = e => { e.stopPropagation(); addReaction(m, emoji); };
      quickReactRow.appendChild(qr);
    });
    const morePicker = document.createElement('span');
    morePicker.className = 'quick-react-btn';
    morePicker.textContent = '➕';
    morePicker.title = 'More reactions';
    morePicker.onclick = e => { e.stopPropagation(); showReactionPicker(e, m); };
    quickReactRow.appendChild(morePicker);
    bubble.appendChild(quickReactRow);
    body.appendChild(bubble);
    // Reactions
    if (m.reactions && Object.keys(m.reactions).length) {
      renderReactions(m.reactions, m, body);
    }
    const meta = document.createElement('div'); meta.className = 'msg-meta';
    meta.innerHTML = '<span>' + fmtTime(m.time) + '</span>' + (m.pending ? '<span class="msg-seen" title="Will send once you\'re back online">\u23f3 pending</span>' : (isMe && m.seen && m.seen.length ? '<span class="msg-seen">\u2713 seen by ' + m.seen.length + '</span>' : ''));
    body.appendChild(meta);
    if (_threadReplyCounts[m.id]) {
      const threadPill = document.createElement('div');
      threadPill.className = 'thread-reply-pill';
      const n = _threadReplyCounts[m.id];
      threadPill.textContent = '\ud83d\udcac ' + n + ' repl' + (n === 1 ? 'y' : 'ies');
      threadPill.onclick = (ev) => { ev.stopPropagation(); openThread(m); };
      body.appendChild(threadPill);
    }
    row.appendChild(body); wrap.appendChild(row);
    // Swipe on mobile — action is user-configurable (Settings > Messaging),
    // defaults to reply (same as before this was made customizable).
    (function(row,m,isMe){
      let tx0=0,ty0=0,swiping=false,triggered=false;
      row.addEventListener('touchstart',function(e){
        if(e.touches.length!==1) return;
        tx0=e.touches[0].clientX; ty0=e.touches[0].clientY; swiping=true; triggered=false;
      },{passive:true});
      row.addEventListener('touchmove',function(e){
        if(!swiping||e.touches.length!==1) return;
        const dx=e.touches[0].clientX-tx0;
        const dy=e.touches[0].clientY-ty0;
        if(Math.abs(dy)>Math.abs(dx)*1.2){ swiping=false; return; }
        const dir=isMe?-1:1; // me swipes left, them swipes right
        const dist=dx*dir;
        if(dist>8) row.style.transform='translateX('+(dx*0.4)+'px)';
        if(dist>60&&!triggered){ triggered=true; runSwipeAction(m); }
      },{passive:true});
      row.addEventListener('touchend',function(){
        swiping=false;
        row.style.transition='transform 0.2s';
        row.style.transform='';
        setTimeout(()=>row.style.transition='',200);
      },{passive:true});
    })(row,m,isMe);
    // Self-destruct: recipient sees it once, then it's deleted
    if (!_isReq && !isMe && m.selfDestruct && (!m.seen || !m.seen.includes(me.number))) {
      if (!m.seen) m.seen = [];
      m.seen.push(me.number);
      const sourceConvoKey = activeConvo && activeConvo.key;
      setTimeout(async()=>{
        const conv=convosCache&&convosCache.find(x=>x&&x.key===sourceConvoKey);
        if(!conv) return;
        conv.messages=conv.messages.filter(x=>x&&x.id!==m.id);
        try{ await saveConvos(); if(activeConvo&&activeConvo.key===sourceConvoKey){ lastMsgHash=''; renderMessages(conv.messages); } }catch{}
      }, 3000);
    }
    }catch(e){ console.error('Failed to render message',m.id,e); const errDiv=document.createElement('div'); errDiv.style.cssText='font-size:11px;color:var(--danger);padding:4px 12px'; errDiv.textContent=scbErr('SCB-MSG-15','⚠️ One message in this chat couldn\'t be displayed.',(e.message||'')); wrap.appendChild(errDiv); }
  });
  if (atBottom) wrap.scrollTop = wrap.scrollHeight;
  if (activeConvo && convosCache) renderPinnedBanner(convosCache.find(x=>x&&x.key === activeConvo.key));
  if (typeof _updateJumpToBottomBtn === 'function') _updateJumpToBottomBtn();
  // Keep an open thread panel live — it's driven by the same convosCache
  // this function already re-renders from on every realtime update.
  if (activeThread && typeof renderThreadPanel === 'function') renderThreadPanel();
}

// ── PATCH sendMsg TO FILTER BAD WORDS ────────────────────────────────────────
// sendMsg fully replaced below
// Same trust question the sendMsg() membership guard answers, factored out so
// the OTHER paths that push a message into a conversation ask it too. sendMsg()
// was hardened after a real cross-account leak, but sendFileMsg() and
// submitPoll() write into a conversation object chosen from in-memory state
// (`activeConvo` / `pendingPollConvoKey`) with no check that the signed-in
// account is actually in it — exactly the same assumption, just a different
// entry point.
function isConvoMemberOf(c, isGroup){
  if(!c || !me) return false;
  const roster = isGroup
    ? (c.members || c.participants || [])
    : (c.participants || c.members || []);
  return roster.map(Number).includes(Number(me.number));
}
async function sendMsg(gifUrl) {
  // Defense in depth: this function has been called with a raw DOM event object
  // before (see the cancelEdit() onclick-wiring bug this was found alongside) —
  // a truthy check alone let an Event masquerade as a GIF URL and silently
  // discarded the user's actual typed message. Requiring an actual string here
  // means any future accidental `.onclick=sendMsg`-style mis-wiring elsewhere
  // fails safe (falls through to the plain-text path) instead of corrupting
  // whatever the user typed.
  if (gifUrl && typeof gifUrl !== 'string') gifUrl = null;
  const input = document.getElementById('msg-input');
  if (!input) return;
  const rawText = input.value.trim();
  if (!rawText && !gifUrl) return;
  if (!activeConvo || !me) return;
  // Parental restrictions were only enforced by openChat()'s wrapper — i.e.
  // at navigation time, not at the point of actually sending. A DM/group tab
  // left open from before a restriction was turned on stayed sendable
  // without ever re-opening it, and sendMsg() itself was reachable directly
  // (e.g. from devtools) with no restriction check at all. Mirror exactly
  // what openChat enforces, here, at the actual send.
  if (activeConvo.type!=='group' && blockIfRestricted('noDm','Direct messages are turned off for your account.')) return;
  if (activeConvo.type==='group' && blockIfRestricted('noGroups','Group chats are turned off for your account.')) return;
  if (activeConvo.type!=='group' && isBlockedEitherWay(activeConvo.number)) { showToast('Cannot send', scbErr('SCB-MSG-16','This conversation is blocked.')); return; }
  // Server verification level
  if(activeConvo.type==='group'&&convosCache){
    const _vConv=convosCache.find(x=>x&&x.key===activeConvo.key);
    if(_vConv&&_vConv.verifyLevel&&_vConv.verifyLevel!=='none'&&!isGroupAdmin()){
      const _vl=_vConv.verifyLevel;
      const _auth=typeof firebase!=='undefined'&&firebase.auth&&firebase.auth().currentUser;
      const _isCustom=_auth&&_auth.providerData&&_auth.providerData.some(p=>p.providerId==='custom');
      if(_vl==='member'&&!_isCustom){ showToast('Verification required','You must be signed in to send messages here.'); return; }
      if(_vl==='verified'){const _em=me&&(me.email||me.phone);if(!_em){ showToast('Verification required','This server requires a verified account to chat.'); return; }}
      if(_vl==='new_wait'){const _jAt=(_vConv.memberJoinedAt||{})[me.number];if(_jAt&&Date.now()-_jAt<600000){ showToast('Too new','You must be a member for 10 minutes before chatting here.'); return; }}
    }
  }
  // Security feature 22/32: scan for risky links BEFORE sending, not just
  // when the recipient later clicks one (linkifySegment's existing
  // warning badge covers that side already).
  if(rawText){
    const _urlsInMsg=rawText.match(URL_RE)||[];
    for(const _rawUrl of _urlsInMsg){
      const _url=_rawUrl.replace(/[.,!?;:)\]}]+$/,'');
      const _reasons=scanUrlRisk(_url);
      if(_reasons.length){
        if(!confirm('This message contains a link that looks suspicious:\n\n'+_url+'\n\n'+_reasons.map(r=>'• '+r).join('\n')+'\n\nSend it anyway?')) return;
        break; // one confirmation covers the whole message
      }
    }
  }
  const _originalText = rawText; // for undo-send toast
  input.value = ''; autoResize(input);
  if(typeof _saveDraft==='function') _saveDraft(); // clear saved draft immediately on send
  document.getElementById('gif-picker')?.classList.remove('visible');
  const _sendBtn = document.getElementById('send-btn');
  if (_sendBtn) {
    _sendBtn.disabled = true;
    _sendBtn.classList.remove('sent-pop');
    void _sendBtn.offsetWidth;
    _sendBtn.classList.add('sent-pop');
  }
  try {
    if (!convosCache) await getConvos();
    const key = activeConvo.key;
    let c = convosCache.find(x=>x&&x.key === key);
    if (!c) { c = { key, participants: activeConvo.members || [me.number, activeConvo.number], messages: [] }; convosCache.push(c); }
    // Hard membership guard: `activeConvo` is a plain in-memory variable, not
    // re-verified against who's actually signed in. A message has been found
    // in live data from an account that isn't a member of the conversation it
    // landed in (most likely stale `activeConvo` state surviving an account
    // switch that didn't go through a real page reload, e.g. scripted/manual
    // testing that swapped accounts via localStorage directly). This can't
    // happen through the normal UI (logOut()/forceLocalLogout() both do a
    // full location.reload(), which wipes activeConvo), but refusing to send
    // into a conversation the signed-in account isn't actually part of closes
    // the door on it regardless of cause, instead of trusting activeConvo.
    const _toArr=v=>Array.isArray(v)?v:(v&&typeof v==='object'?Object.values(v).filter(n=>n!=null):[]);
    const isMember = activeConvo.type === 'group'
      ? (_toArr(c.members).length?_toArr(c.members):_toArr(activeConvo.members).length?_toArr(activeConvo.members):_toArr(c.participants)).includes(me.number)
      : (_toArr(c.participants).concat(_toArr(c.members)).concat(_toArr(activeConvo.members)).concat([me.number, activeConvo.number])).includes(me.number);
    if (!isMember) {
      console.error('Blocked sending into a conversation the signed-in account is not a member of', {convoKey: key, me: me.number});
      showToast('Could not send', scbErr('SCB-MSG-17','This chat is no longer open correctly — please reopen it from your chat list.'));
      document.getElementById('send-btn').disabled = false;
      return;
    }
    const msg = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), from: me.number, time: Date.now(), seen: [] };
    if (me.shadowMuted) msg.shadowMuted = true; // security feature 25/32 — silently never delivered, no notice to the sender
    const _zr = _zrExpireAt(); if (_zr) msg.zrExpireAt = _zr; // Zero Retention Mode
    if (activeConvo.type === 'group') {
      msg.channelId = activeChannelId || 'general';
      // Security feature 29/32: held for mod approval if this group has
      // quarantine on and this sender hasn't been approved yet.
      if (Array.isArray(c.pendingApproval) && c.pendingApproval.includes(me.number)) msg.quarantined = true;
    }
    if (replyingTo) { msg.replyTo = replyingTo; }
    const aesKey = await getConvoAesKey(c);
    if (!aesKey && isSelfKey(key)) { input.value = _originalText; showToast('Not saved', 'This device can\'t encrypt your note.'); return; }
    if (gifUrl) {
      const wrapped = aesKey ? await aesEnc(aesKey, gifUrl) : null;
      if (wrapped) { msg.cgif = wrapped; _decCache[msg.id] = { gif: gifUrl }; }
      else { msg.gif = gifUrl; }
    } else {
      const clean = filterBadWords(rawText);
      const wrapped = aesKey ? await aesEnc(aesKey, clean) : null;
      if (wrapped) { msg.ctext = wrapped; _decCache[msg.id] = { text: clean }; }
      else { msg.text = enc(clean); }
      const mentions = parseMentions(rawText);
      if (mentions.length) msg.mentions = mentions;
    }
    c.messages.push(msg); _convosDirty=true;
    // Server-scoped message count, for the "message_count" badge criteria
    // (see _checkAutoBadges) — only tracked for servers, since badges are
    // server-only. A running per-member counter rather than counting
    // c.messages itself: that array is capped at 100 and trimmed from the
    // front a few lines below, so it could never reflect a lifetime total.
    if(c.isServer){
      if(!c.memberMsgCount) c.memberMsgCount={};
      c.memberMsgCount[me.number]=(c.memberMsgCount[me.number]||0)+1;
      if(Array.isArray(c.badges)&&c.badges.length) _checkAutoBadges(c);
    }
    if (replyingTo) cancelReply();
    if (c.typingByChannel) {
      const chKey = activeConvo.type==='group' ? (activeChannelId||'general') : '_dm';
      if (c.typingByChannel[chKey]) delete c.typingByChannel[chKey][me.number];
      lastTypingBroadcast = 0;
    }
    if (c.messages.length > 100) c.messages.splice(0, c.messages.length - 100);
    if (!netOnline) {
      // Offline: render immediately as "pending" and queue for auto-send on reconnect
      msg.pending = true;
      queueOutboxMsg(key, msg.id);
      updateOfflineBanner();
      lastMsgHash = ''; renderMessages(c.messages);
    } else {
      // Optimistic UI: paint the message immediately with a pending indicator,
      // then clear the indicator once the Firebase write actually lands. The
      // send used to block on the round-trip before showing anything, which on
      // a slow connection looked like the app had swallowed the message.
      msg.pending = true;
      lastMsgHash = ''; renderMessages(c.messages);
      try {
        await saveConvos();
        delete msg.pending;
        lastMsgHash = ''; renderMessages(c.messages);
        if (_originalText && !gifUrl) showUndoSendToast(_originalText, msg, c);
      } catch (e) {
        // Save failed (likely a connectivity blip) -- keep the message locally and queue it
        msg.pending = true;
        queueOutboxMsg(key, msg.id);
        updateOfflineBanner();
        lastMsgHash = ''; renderMessages(c.messages);
        showToast('Message queued', 'Will send automatically once back online.');
      }
    }
  } catch (e) {
    const { healed, note } = await selfHeal('SCB-MSG-18', e, { context: 'sendMsg' });
    if (!healed) showToast('Send failed', scbErr('SCB-MSG-18', note));
  }
  finally { document.getElementById('send-btn').disabled = false; input.focus(); }
}

// -- THREADS -----------------------------------------------------------------
// A thread reply is a completely normal message object pushed into the same
// c.messages array as everything else (same channelId, same E2E encryption
// via getConvoAesKey/aesEnc, same realtime listener, same offline queueing),
// just tagged with threadOf — so it rides every existing pipeline for free
// instead of needing a parallel storage/sync system. renderMessages() rolls
// these up into a "N replies" pill on their parent instead of rendering them
// inline (see the _threadReplyCounts block there).
let activeThread = null; // { parentId, convoKey }
function openThread(parent) {
  if (!activeConvo || !convosCache || !parent) return;
  const c = convosCache.find(x => x && x.key === activeConvo.key);
  if (!c) return;
  activeThread = { parentId: parent.id, convoKey: c.key };
  const input = document.getElementById('thread-reply-input');
  if (input) input.value = '';
  openModal('thread-modal');
  renderThreadPanel();
  setTimeout(() => document.getElementById('thread-reply-input')?.focus(), 50);
}
function closeThreadPanel() {
  activeThread = null;
  closeModal('thread-modal');
}
function renderThreadPanel() {
  if (!activeThread) return;
  const c = convosCache && convosCache.find(x => x && x.key === activeThread.convoKey);
  if (!c) { closeThreadPanel(); return; }
  const parent = (c.messages || []).find(m => m && m.id === activeThread.parentId);
  if (!parent) { closeThreadPanel(); return; } // parent was deleted out from under the open thread
  const quoteEl = document.getElementById('thread-parent-quote');
  if (quoteEl) {
    const pu = lookupUser(parent.from) || {};
    const pIsMe = parent.from === me.number;
    const pname = pIsMe ? 'You' : (dec(pu.name || '') || '#' + parent.from);
    const pnameHtml = pIsMe ? esc(pname) : '<span style="cursor:pointer" title="View profile" data-number="' + parent.from + '" onclick="event.stopPropagation();openUserProfile(Number(this.dataset.number))">' + esc(pname) + '</span>';
    quoteEl.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:3px">' + pnameHtml + ' · ' + fmtTime(parent.time) + '</div>'
      + '<div style="font-size:13px;color:var(--text2)">' + renderMsgTextWithMentions(filterBadWords(msgText(parent))) + '</div>';
  }
  // Same shadow-mute rule as the main channel: a shadow-muted sender still
  // sees their own thread replies, nobody else does.
  const replies = (c.messages || [])
    .filter(m => m && m.threadOf === activeThread.parentId && (!m.shadowMuted || m.from === me.number))
    .sort((a, b) => a.time - b.time);
  const wrap = document.getElementById('thread-messages-wrap');
  if (!wrap) return;
  if (!replies.length) {
    wrap.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:16px 0">No replies yet — start the thread.</div>';
    return;
  }
  const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 100;
  wrap.innerHTML = '';
  replies.forEach(m => {
    const isMe = m.from === me.number;
    const u = lookupUser(m.from) || {};
    const name = isMe ? 'You' : (dec(u.name || '') || '#' + m.from);
    const nameHtml = isMe ? esc(name) : '<span style="cursor:pointer" title="View profile" data-number="' + m.from + '" onclick="event.stopPropagation();openUserProfile(Number(this.dataset.number))">' + esc(name) + '</span>';
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:10px';
    row.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:2px">' + nameHtml + ' · ' + fmtTime(m.time) + '</div>'
      + '<div class="bubble" style="display:inline-block;max-width:100%">' + renderMsgTextWithMentions(filterBadWords(msgText(m))) + '</div>';
    wrap.appendChild(row);
  });
  if (atBottom) wrap.scrollTop = wrap.scrollHeight;
}
async function sendThreadReply() {
  if (!activeThread || !me) return;
  const input = document.getElementById('thread-reply-input');
  if (!input) return;
  const rawText = input.value.trim();
  if (!rawText) return;
  const c = convosCache && convosCache.find(x => x && x.key === activeThread.convoKey);
  if (!c) return;
  const parent = (c.messages || []).find(m => m && m.id === activeThread.parentId);
  if (!parent) { closeThreadPanel(); return; }
  input.value = '';
  try {
    const msg = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), from: me.number, time: Date.now(), seen: [], threadOf: activeThread.parentId };
    if (me.shadowMuted) msg.shadowMuted = true;
    if (activeConvo.type === 'group') msg.channelId = parent.channelId || activeChannelId || 'general';
    const aesKey = await getConvoAesKey(c);
    const clean = filterBadWords(rawText);
    const wrapped = aesKey ? await aesEnc(aesKey, clean) : null;
    if (wrapped) { msg.ctext = wrapped; _decCache[msg.id] = { text: clean }; }
    else { msg.text = enc(clean); }
    const mentions = parseMentions(rawText);
    if (mentions.length) msg.mentions = mentions;
    c.messages.push(msg); _convosDirty = true;
    if (c.messages.length > 100) c.messages.splice(0, c.messages.length - 100);
    renderThreadPanel();
    lastMsgHash = ''; renderMessages(c.messages); // refreshes the parent's reply-count pill too
    await saveConvos();
  } catch (e) {
    showToast('Send failed', 'Your thread reply couldn\'t be sent.');
  }
}

// -- USER PROFILE CARD --------------------------------------------------------
// A lightweight "who is this" card reachable from anywhere a sender's name
// or avatar appears next to a message (group chat rows, thread replies) —
// not just from the sidebar/admin panel like before. lookupUser() is the
// same usersCache-backed source every other sender-identity display in the
// app already reads from (message rows, reactions, call logs), so this
// stays in sync with the real record the same way those do.
let _userProfileTarget = null;
function openUserProfile(number) {
  if (!number || !me) return;
  const u = lookupUser(number);
  if (!u) { showToast('User not found', ''); return; }
  _userProfileTarget = number;
  const isSelf = number === me.number;
  const avEl = document.getElementById('user-profile-avatar');
  if (avEl) { avEl.innerHTML = ''; renderAvatar(avEl, { name: dec(u.name || ''), avatar: u.avatar || '' }, 84); }
  const name = dec(u.name || '') || ('#' + number);
  document.getElementById('user-profile-name').innerHTML = esc(name) + verifiedBadge(number) + equippedBadgeHtml(number);
  document.getElementById('user-profile-number').textContent = '#' + number;
  const statusEl = document.getElementById('user-profile-status');
  const online = isOnline(u.lastSeen);
  statusEl.innerHTML = online
    ? '<span style="color:#3ba55d">● Online</span>'
    : (u.lastSeen ? '<span style="color:var(--muted)">Last seen ' + fmtTime(u.lastSeen) + '</span>' : '');
  const bio = dec(u.bio || '');
  document.getElementById('user-profile-bio').textContent = bio || (u.customStatus ? dec(u.customStatus) : '');
  const joinedEl = document.getElementById('user-profile-joined');
  joinedEl.textContent = u.createdAt ? 'Joined ' + new Date(u.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '';
  renderProfileBadges(document.getElementById('user-profile-badges'), number, false);
  const msgBtn = document.getElementById('user-profile-msg-btn');
  // Messaging yourself isn't a real action — nothing else in the app
  // offers a "DM yourself" flow, so hide it rather than letting it error.
  if (msgBtn) msgBtn.style.display = isSelf ? 'none' : 'block';
  openModal('user-profile-modal');
}
// Opens (creating if needed) a DM with this user — same "find or create the
// contact, then openChat()" logic adminMessage() already uses for the admin
// panel's Message button, just without the admin-only gate, since any user
// should be able to start a chat with anyone whose message they can see.
function quickMessageUser(number) {
  if (!number || !me || number === me.number) return;
  closeModal('user-profile-modal');
  const existing = contacts.find(c => c.type !== 'group' && c.number === number);
  if (existing) { openChat(existing); return; }
  getUsers().then(users => {
    const u = users.find(x => x.number === number);
    if (!u) { showToast('User not found', ''); return; }
    const c = { type: 'dm', number, name: dec(u.name) || '#' + number, avatar: u.avatar || '', key: 'dm_' + [me.number, number].sort((a, b) => a - b).join('_') };
    contacts.push(c); saveStorage(); openChat(c);
  }).catch(e => showToast('Error', e.message));
}

// -- USER HOVER CARD -----------------------------------------------------------
// Discord-style "hover the profile picture" preview, layered on top of the
// click-to-open full profile card above (that stays exactly as it was).
// Gated to real mouse/trackpad input via (hover:hover) — a touch device has
// no hover state at all, so a "hover" listener there would need an extra
// phantom first tap before a real tap registered, making every avatar
// effectively harder to use. Those devices keep tap-to-open as their only,
// unchanged path.
const _supportsHoverCard = typeof window.matchMedia === 'function' && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
let _userHoverCardTarget = null, _hoverCardShowTimer = null, _hoverCardHideTimer = null;
function scheduleUserHoverCard(number, anchorEl) {
  if (!_supportsHoverCard) return;
  clearTimeout(_hoverCardHideTimer);
  clearTimeout(_hoverCardShowTimer);
  _hoverCardShowTimer = setTimeout(() => showUserHoverCard(number, anchorEl), 350);
}
// Called on mouseleave of the avatar/name AND of the card itself — a short
// grace delay so moving the mouse from the avatar into the card to click
// Message doesn't immediately close it out from under the cursor.
function cancelUserHoverCard() {
  clearTimeout(_hoverCardShowTimer);
  clearTimeout(_hoverCardHideTimer);
  _hoverCardHideTimer = setTimeout(hideUserHoverCard, 200);
}
function showUserHoverCard(number, anchorEl) {
  if (!number || !me || !anchorEl) return;
  const u = lookupUser(number);
  if (!u) return;
  _userHoverCardTarget = number;
  const card = document.getElementById('user-hover-card');
  if (!card) return;
  const avEl = document.getElementById('user-hover-card-avatar');
  avEl.innerHTML = ''; renderAvatar(avEl, { name: dec(u.name || ''), avatar: u.avatar || '' }, 52);
  const name = dec(u.name || '') || ('#' + number);
  document.getElementById('user-hover-card-name').innerHTML = esc(name) + verifiedBadge(number) + equippedBadgeHtml(number);
  renderProfileBadges(document.getElementById('user-hover-card-badges'), number, true);
  const online = isOnline(u.lastSeen);
  document.getElementById('user-hover-card-status').innerHTML = online
    ? '<span style="color:#3ba55d">● Online</span>'
    : (u.lastSeen ? '<span style="color:var(--muted)">Last seen ' + fmtTime(u.lastSeen) + '</span>' : '');
  const bio = dec(u.bio || '') || (u.customStatus ? dec(u.customStatus) : '');
  const bioEl = document.getElementById('user-hover-card-bio');
  bioEl.textContent = bio; bioEl.style.display = bio ? 'block' : 'none';
  const msgBtn = document.getElementById('user-hover-card-msg-btn');
  msgBtn.style.display = number === me.number ? 'none' : 'block';
  // Position below the avatar by default, flipping above it if there isn't
  // room, and clamped horizontally so it never runs off either edge.
  const rect = anchorEl.getBoundingClientRect();
  card.classList.add('visible'); // needs real layout for offsetHeight below
  const cardW = card.offsetWidth || 240, cardH = card.offsetHeight || 100;
  let top = rect.bottom + 6;
  if (top + cardH > window.innerHeight - 8) top = rect.top - cardH - 6;
  card.style.top = Math.max(8, top) + 'px';
  card.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - cardW - 8)) + 'px';
}
function hideUserHoverCard() {
  const card = document.getElementById('user-hover-card');
  if (card) card.classList.remove('visible');
}
(() => {
  const card = document.getElementById('user-hover-card');
  if (card) {
    card.addEventListener('mouseenter', () => clearTimeout(_hoverCardHideTimer));
    card.addEventListener('mouseleave', cancelUserHoverCard);
  }
})();

// ── PATCH submitReport TO INCLUDE ADMIN LINK ─────────────────────────────────

// ── PATCH openChat TO CHECK BAN + CLOUDY ─────────────────────────────────────
async function openChat(c) {
  // Cloudy AI chat — short-circuit Firebase entirely
  if(c && c._isCloudy){
    activeConvo = {...CLOUDY_CONTACT};
    lastMsgHash = '';
    hideAll();
    document.getElementById('chat-panel').classList.add('visible');
    if(document.body.classList.contains('device-phone')) document.body.classList.add('chat-open');
    // Header name + avatar
    const nameEl = document.getElementById('chat-header-name');
    if(nameEl) nameEl.innerHTML = '☁️ Cloudy';
    const subEl = document.getElementById('chat-header-sub');
    if(subEl){ subEl.textContent = 'AI Assistant · always online'; subEl.className = 'online'; }
    const haEl = document.getElementById('chat-header-av');
    if(haEl){
      haEl.style.cssText = 'border-radius:50%;background:linear-gradient(135deg,#60a5fa,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:22px;';
      haEl.textContent = '☁️';
    }
    // Hide call/group buttons (Cloudy has its own logic)
    const callBtn = document.getElementById('call-btn'); if(callBtn) callBtn.style.display='none';
    const pollBtn = document.getElementById('poll-compose-btn'); if(pollBtn) pollBtn.style.display='none';
    const eventBtn = document.getElementById('event-compose-btn'); if(eventBtn) eventBtn.style.display='none';
    const chBar = document.getElementById('channel-bar'); if(chBar) chBar.style.display='none';
    const voiceBar = document.getElementById('voice-bar'); if(voiceBar) voiceBar.style.display='none';
    // Render local Cloudy messages (use window.* — functions live inside an IIFE)
    if(typeof window._renderCloudyChat==='function') window._renderCloudyChat();
    const _inp = document.getElementById('msg-input');
    if(_inp){ _inp.placeholder = 'Message Cloudy…'; _inp.focus(); }
    // Send welcome if first time
    const store = JSON.parse(localStorage.getItem('cc_cloudy_msgs')||'[]');
    if(!store.length){
      setTimeout(()=>{
        const h = new Date().getHours();
        const tod = h<12?'Good morning':h<17?'Good afternoon':'Good evening';
        if(typeof window._cloudyDeliverMsg==='function') window._cloudyDeliverMsg(`${tod}! ☁️ Message or call someone, open a chat, set a reminder, switch themes, or do quick math — just ask.`,['📞 Call someone','⏰ Set a reminder','🧮 12 * 7 + 5','🎲 Roll a dice','😄 Tell me a joke','💡 What can you do?']);
      }, 400);
    }
    return;
  }
  const u = lookupUser(c.number || 0) || {};
  if (u.banned && me && me.number !== ADMIN_NUMBER) {
    showToast('This account has been suspended', scbErr('SCB-AUTH-24','Your account was suspended, so you have been signed out.'));
    return;
  }
  // Reset msg-input placeholder for normal chats
  const _inp2 = document.getElementById('msg-input');
  if(_inp2) _inp2.placeholder = 'Type a message…';
  return _origOpenChat(c);
}

// ── PATCH chat header name to be clickable ────────────────────────────────────
// Handle #privacy hash so https://socloudybro.vercel.app/#privacy opens the policy directly
window.addEventListener('hashchange', () => { if(location.hash==='#privacy') showPrivacyPolicy(); });
if(location.hash==='#privacy') document.addEventListener('DOMContentLoaded', () => setTimeout(showPrivacyPolicy, 600));

document.addEventListener('DOMContentLoaded', () => {
  const nameEl = document.getElementById('chat-header-name');
  if (nameEl) { nameEl.style.cursor = 'pointer'; nameEl.title = 'Click for info'; nameEl.addEventListener('click', () => { if (activeConvo) { if (activeConvo.type === 'group') openGroupPanel(); else openContactPanel(); } }); }
  // Position search results under search bar
  const sbSearch = document.getElementById('sb-search');
  const searchResults = document.getElementById('msg-search-results');
  if (sbSearch && searchResults) { sbSearch.style.position = 'relative'; sbSearch.appendChild(searchResults); }
  // Check admin panel on load
  setTimeout(checkAdminPanel, 1000);
  initFullscreenControl();
  // Mobile keyboard: lift compose bar with visual viewport
  if (window.visualViewport) {
    const composeArea = document.getElementById('compose-area') || document.getElementById('compose-row');
    function onVPResize() {
      const vv = window.visualViewport;
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      const px = gap > 10 ? gap + 'px' : '';
      if (composeArea) {
        composeArea.style.paddingBottom = px;
        // Also set as a custom property — the <640px media query's
        // padding:0!important for #compose-row reads --kb-gap instead of
        // fighting the plain inline style it always used to win against.
        composeArea.style.setProperty('--kb-gap', px || '0px');
      }
    }
    window.visualViewport.addEventListener('resize', onVPResize);
    window.visualViewport.addEventListener('scroll', onVPResize);
  }
});

// ── POLL/REACTION CSS ─────────────────────────────────────────────────────────
const extraCSS = document.createElement('style');
extraCSS.textContent = `
.game-card{background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:14px;min-width:200px;max-width:240px}
.game-title{font-size:13px;font-weight:600;margin-bottom:4px}
.game-status{font-size:12px;color:var(--muted);margin-bottom:10px}
.game-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.game-cell{aspect-ratio:1;border:1px solid var(--border2);border-radius:8px;background:var(--surface);font-size:22px;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text);transition:background .15s}
.game-cell:not(:disabled):hover{background:var(--surface2)}
.game-cell:disabled{cursor:default}
.game-cell.filled{color:var(--accent)}
#chat-header-name:hover{text-decoration:underline;text-underline-offset:3px}
`;
document.head.appendChild(extraCSS);


// ===== NEW FEATURES =====

// -- THEME ------------------------------------------------------------------
// Fullscreen: real, working browser API on this standalone page, but iOS
// Safari doesn't implement the general Fullscreen API at all -- feature
// detect and hide the control entirely there rather than show one that
// silently does nothing.
function fullscreenSupported(){
  return !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
}
function toggleFullscreen(){
  if(!document.fullscreenElement && !document.webkitFullscreenElement){
    const el = document.documentElement;
    (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen()).catch(()=>{});
  } else {
    (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen()).catch(()=>{});
  }
}
function syncFullscreenUI(){
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  const btn = document.getElementById('fullscreen-toggle-btn');
  if(btn) btn.textContent = isFs ? '⛶ Exit' : '⛶ Toggle';
}
document.addEventListener('fullscreenchange', syncFullscreenUI);
document.addEventListener('webkitfullscreenchange', syncFullscreenUI);
function initFullscreenControl(){
  const row = document.getElementById('fullscreen-row');
  if(row && fullscreenSupported()) row.style.display = 'flex';
}

// Sun while dark (switch to light), moon while light.
function _themeIcon(dark){
  return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">'+(dark
    ? '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>'
    : '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>')+'</svg>';
}
function setTheme(mode){
  localStorage.setItem('cc_theme', mode);
  applyTheme(mode);
  const labels={light:'Light mode',dark:'Dark mode',auto:'Follows system',schedule:'On a schedule'};
  const el=document.getElementById('theme-sub-text');
  if(el) el.textContent=labels[mode]||'Follows system';
  ['light','dark','auto','schedule'].forEach(m=>{
    const b=document.getElementById('theme-'+m+'-btn');
    if(b) b.style.background=m===mode?'var(--accent)':''
    if(b) b.style.color=m===mode?'#fff':''
  });
  const scheduleRow=document.getElementById('theme-schedule-row');
  if(scheduleRow) scheduleRow.style.display=mode==='schedule'?'flex':'none';
}
function saveThemeSchedule(){
  const start=document.getElementById('theme-schedule-start').value||'20:00';
  const end=document.getElementById('theme-schedule-end').value||'07:00';
  localStorage.setItem('cc_theme_schedule',JSON.stringify({start,end}));
  if(localStorage.getItem('cc_theme')==='schedule') applyTheme('schedule');
}
// A corrupt cc_theme_schedule value used to throw straight out of
// isWithinDarkSchedule()/initTheme(), which left the app with no theme applied
// at all. Parse defensively and fall back to the documented default instead.
function readThemeSchedule(){
  const def={start:'20:00',end:'07:00'};
  try{
    const raw=localStorage.getItem('cc_theme_schedule');
    if(!raw) return def;
    const v=JSON.parse(raw);
    if(!v||typeof v!=='object') return def;
    const ok=(t)=>typeof t==='string'&&/^\d{1,2}:\d{2}$/.test(t);
    return {start:ok(v.start)?v.start:def.start, end:ok(v.end)?v.end:def.end};
  }catch(e){ return def; }
}
function isWithinDarkSchedule(){
  const {start,end}=readThemeSchedule();
  const now=new Date();
  const nowMins=now.getHours()*60+now.getMinutes();
  const [sh,sm]=start.split(':').map(Number), [eh,em]=end.split(':').map(Number);
  const startMins=sh*60+sm, endMins=eh*60+em;
  // handles overnight ranges (e.g. 20:00 -> 07:00) as well as same-day ranges
  return startMins<=endMins ? (nowMins>=startMins&&nowMins<endMins) : (nowMins>=startMins||nowMins<endMins);
}
let _themeScheduleTimer=null;
function applyTheme(mode){
  if(mode==='schedule'){
    const dark=isWithinDarkSchedule();
    document.documentElement.setAttribute('data-theme',dark?'dark':'light');
    const fbtn=document.getElementById('theme-toggle-btn');
    if(fbtn) fbtn.innerHTML=_themeIcon(dark);
    // Re-check every minute so the switch actually happens live while the app
    // stays open, rather than only on next reload/reopen.
    if(_themeScheduleTimer) clearInterval(_themeScheduleTimer);
    _themeScheduleTimer=setInterval(()=>{ if(localStorage.getItem('cc_theme')==='schedule') applyTheme('schedule'); },60000);
    return;
  }
  if(_themeScheduleTimer){ clearInterval(_themeScheduleTimer); _themeScheduleTimer=null; }
  if(mode==='dark') document.documentElement.setAttribute('data-theme','dark');
  else if(mode==='light') document.documentElement.setAttribute('data-theme','light');
  else document.documentElement.removeAttribute('data-theme');
  const isDark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme:dark)').matches);
  const fbtn = document.getElementById('theme-toggle-btn');
  if (fbtn) fbtn.innerHTML = _themeIcon(isDark);
}
function initTheme(){
  const saved=localStorage.getItem('cc_theme')||'auto';
  applyTheme(saved);
  const labels={light:'Light mode',dark:'Dark mode',auto:'Follows system',schedule:'On a schedule'};
  const el=document.getElementById('theme-sub-text');
  if(el) el.textContent=labels[saved];
  ['light','dark','auto','schedule'].forEach(m=>{
    const b=document.getElementById('theme-'+m+'-btn');
    if(b&&m===saved){b.style.background='var(--accent)';b.style.color='#fff';}
  });
  const scheduleRow=document.getElementById('theme-schedule-row');
  if(scheduleRow) scheduleRow.style.display=saved==='schedule'?'flex':'none';
  const {start,end}=readThemeSchedule();
  const startInput=document.getElementById('theme-schedule-start');
  const endInput=document.getElementById('theme-schedule-end');
  if(startInput) startInput.value=start;
  if(endInput) endInput.value=end;
}

// -- BAD WORD FILTER (uses _bw defined above) --

// -- REACTIONS -------------------------------------------------------------
const QUICK_REACTIONS=['\uD83D\uDC4D','\u2764\uFE0F','\uD83D\uDE02','\uD83D\uDE2E','\uD83D\uDE22','\uD83D\uDE21','\uD83C\uDF89','\uD83D\uDD25'];
const EMOJI_CATEGORIES={
  'Smileys':['😀','😁','😂','🤣','😅','😊','😇','🙂','😉','😍','😘','😜','🤔','😐','😴','🥱','😭','😡','🥳','😱','🤯','🥴','😎','🤩','😏','😬','🙄','😤','🤗','🤫'],
  'Gestures':['👍','👎','👏','🙌','🙏','💪','🤝','✌️','🤞','👌','🤙','👋','🫡','🖕','✋','👊','🤛','🤜','💅','🤌'],
  'Hearts':['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','💕','💞','💓','💗','💖','💘','💝'],
  'Animals':['🐶','🐱','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🦆','🦉','🐺','🐴','🦄','🐝','🐛','🦋','🐢','🐍','🐙','🦑','🐳'],
  'Food':['🍏','🍎','🍕','🍔','🍟','🌭','🌮','🍿','🍩','🍪','🎂','🍰','🍫','🍬','🍭','🍦','☕','🍺','🍷','🥂','🍾','🍉','🍇','🍓','🍑','🥑','🍜','🍣','🍗','🥓'],
  'Activities':['⚽','🏀','🏈','⚾','🎾','🏐','🎱','🏓','🎮','🕹️','🎲','🎯','🎳','🎸','🎧','🎤','🎨','🎬','🏆','🥇'],
  'Objects':['💯','✨','🔥','⭐','💥','💤','💡','🔔','🔒','🎁','📌','📎','💰','💎','⚡','🌈','☀️','🌙','☁️','⛄'],
  'Symbols':['✅','❌','❓','❗','⚠️','🚫','🔁','🔀','⬆️','⬇️','▶️','⏸️','⏹️','🆗','🆕','💬','🗨️','🚀','🎉','💯']
};
let emojiPickerCat='Smileys';
let reactionTargetMsg=null;
function showReactionPicker(e,msg){
  e.stopPropagation();
  reactionTargetMsg=msg;
  const picker=document.getElementById('reaction-picker');
  picker.innerHTML='';
  picker.style.display='flex';
  picker.style.flexDirection='column';
  picker.style.width='260px';
  picker.style.maxHeight='260px';
  const tabs=document.createElement('div');
  tabs.style.cssText='display:flex;gap:2px;overflow-x:auto;padding-bottom:4px;margin-bottom:4px;border-bottom:1px solid var(--border);flex-shrink:0';
  Object.keys(EMOJI_CATEGORIES).forEach(cat=>{
    const t=document.createElement('span');
    t.textContent=EMOJI_CATEGORIES[cat][0];
    t.title=cat;
    t.style.cssText='cursor:pointer;padding:3px 5px;border-radius:6px;flex-shrink:0'+(cat===emojiPickerCat?';background:var(--surface2)':'');
    t.onclick=(ev)=>{ ev.stopPropagation(); emojiPickerCat=cat; showReactionPicker(e,msg); };
    tabs.appendChild(t);
  });
  picker.appendChild(tabs);
  const grid=document.createElement('div');
  grid.style.cssText='display:grid;grid-template-columns:repeat(8,1fr);gap:2px;overflow-y:auto';
  EMOJI_CATEGORIES[emojiPickerCat].forEach(emoji=>{
    const btn=document.createElement('span');
    btn.textContent=emoji;
    btn.style.cssText='cursor:pointer;transition:transform 0.1s;display:flex;align-items:center;justify-content:center;padding:4px;font-size:18px;border-radius:6px';
    btn.onmouseenter=()=>{btn.style.transform='scale(1.25)';};
    btn.onmouseleave=()=>{btn.style.transform='scale(1)';};
    btn.onclick=(ev)=>{ ev.stopPropagation(); addReaction(msg,emoji);picker.style.display='none'; };
    grid.appendChild(btn);
  });
  picker.appendChild(grid);
  const rect=e.target.getBoundingClientRect();
  picker.style.left=Math.min(rect.left,window.innerWidth-270)+'px';
  picker.style.top=Math.max(8,rect.top-270)+'px';
  setTimeout(()=>document.addEventListener('click',(ev)=>{ if(!picker.contains(ev.target)) picker.style.display='none'; },{once:true}),400);
}
async function addReaction(msg,emoji){
  if(!convosCache||!activeConvo||!me) return;
  if(isRequestKey(activeConvo.key)){ showToast('Message request','Accept it before reacting.'); return; }
  const c=convosCache.find(x=>x&&x.key===activeConvo.key);
  if(!c) return;
  const m=c.messages.find(x=>x.id===msg.id);
  if(!m) return;
  if(!m.reactions) m.reactions={};
  if(!m.reactions[emoji]) m.reactions[emoji]=[];
  const idx=m.reactions[emoji].indexOf(me.number);
  if(idx>-1) m.reactions[emoji].splice(idx,1);
  else m.reactions[emoji].push(me.number);
  if(m.reactions[emoji].length===0) delete m.reactions[emoji];
  lastMsgHash='';
  await saveConvos();
  renderMessages(c.messages);
}
function renderReactions(reactions,msg,body){
  if(!reactions||!Object.keys(reactions).length) return;
  const bar=document.createElement('div');bar.className='reaction-bar';
  Object.entries(reactions).forEach(([emoji,users])=>{
    if(!Array.isArray(users)||!users.length) return;
    const chip=document.createElement('div');
    chip.className='reaction-chip'+(users.includes(me.number)?' mine':'');
    const names=users.map(n=>{const u=lookupUser(n)||{};return dec(u.name)||'#'+n;}).join(', ');
    chip.title=names;
    chip.innerHTML=`${emoji} <span class="rc-count">${users.length}</span>`;
    chip.onclick=()=>addReaction(msg,emoji);
    bar.appendChild(chip);
  });
  body.appendChild(bar);
}

// -- POLLS -----------------------------------------------------------------
let pendingPollConvoKey=null;
function openPollModal(presetQuestion){
  if(!activeConvo||activeConvo.type!=='group'){showToast('Polls are group only',scbErr('SCB-GRP-24','Polls can only be created in a group chat.'));return;}
  document.getElementById('poll-question').value=presetQuestion||'';
  document.getElementById('poll-error').textContent='';
  const wrap=document.getElementById('poll-options-wrap');
  wrap.innerHTML='';
  for(let i=0;i<2;i++){const inp=document.createElement('input');inp.type='text';inp.className='poll-opt';inp.placeholder='Option '+(i+1);inp.maxLength=60;inp.style.marginBottom='6px';wrap.appendChild(inp);}
  pendingPollConvoKey=activeConvo.key;
  openModal('poll-modal');
}
function addPollOption(){
  const wrap=document.getElementById('poll-options-wrap');
  if(wrap.children.length>=6){showToast('Max 6 options',scbErr('SCB-GRP-25','A poll can have at most 6 options.'));return;}
  const inp=document.createElement('input');inp.type='text';inp.className='poll-opt';
  inp.placeholder='Option '+(wrap.children.length+1);inp.maxLength=60;inp.style.marginBottom='6px';
  wrap.appendChild(inp);
}
async function submitPoll(){
  const q=document.getElementById('poll-question').value.trim();
  const opts=Array.from(document.querySelectorAll('.poll-opt')).map(i=>i.value.trim()).filter(Boolean);
  const err=document.getElementById('poll-error');err.textContent='';
  if(!q){err.textContent=scbErr('SCB-GRP-26','Enter a question.');return;}
  if(opts.length<2){err.textContent=scbErr('SCB-GRP-27','Add at least 2 options.');return;}
  if(!convosCache) await getConvos();
  const c=convosCache.find(x=>x&&x.key===pendingPollConvoKey);
  if(!c){closeModal('poll-modal');return;}
  if(!isConvoMemberOf(c, c.type==='group'||String(c.key||'').startsWith('grp_'))){
    err.textContent=scbErr('SCB-GRP-28','You\'re not a member of that conversation.');
    return;
  }
  const _isGrp=c.type==='group'||String(c.key||'').startsWith('grp_');
  if(_isGrp && blockIfRestricted('noGroups','Group chats are turned off for your account.')){ return; }
  if(!_isGrp && blockIfRestricted('noDm','Direct messages are turned off for your account.')){ return; }
  const msg={id:'msg_'+Date.now().toString(36),from:me.number,time:Date.now(),seen:[]};
  if (Array.isArray(c.pendingApproval) && c.pendingApproval.includes(me.number)) msg.quarantined = true;
  const aesKey=await getConvoAesKey(c);
  if(aesKey){
    const cq=await aesEnc(aesKey,q);
    const options=[];
    for(const o of opts){ options.push({ctext:await aesEnc(aesKey,o),votes:[]}); }
    msg.cpoll={cq,options,creator:me.number};
    _decCache[msg.id]={poll:{question:q,options:opts.map(o=>({text:o,votes:[]})),creator:me.number}};
  }else{
    msg.poll={type:'poll',id:'poll_'+Date.now().toString(36),question:enc(q),options:opts.map(o=>({text:enc(o),votes:[]})),creator:me.number};
  }
  c.messages.push(msg);
  await saveConvos();
  closeModal('poll-modal');
  lastMsgHash='';
  renderMessages(c.messages);
}
async function votePoll(msgId,optIdx){
  if(!convosCache||!activeConvo||!me) return;
  const c=convosCache.find(x=>x&&x.key===activeConvo.key);
  if(!c) return;
  const m=c.messages.find(x=>x.id===msgId);
  if(!m) return;
  const optsArr=m.cpoll?m.cpoll.options:(m.poll?m.poll.options:null);
  if(!optsArr) return;
  // Remove existing vote (votes stay plaintext numeric arrays -- avoids decrypt/re-encrypt races)
  optsArr.forEach(o=>{const i=o.votes.indexOf(me.number);if(i>-1)o.votes.splice(i,1);});
  optsArr[optIdx].votes.push(me.number);
  if(_decCache[m.id]&&_decCache[m.id].poll){
    _decCache[m.id].poll.options.forEach((o,i)=>{ if(optsArr[i]) o.votes=optsArr[i].votes; });
  }
  lastMsgHash='';
  await saveConvos();
  renderMessages(c.messages);
}
function renderPoll(poll,msgId,body){
  if(!poll||!Array.isArray(poll.options)){const card=document.createElement('div');card.className='poll-card';card.textContent='Poll unavailable.';body.appendChild(card);return;}
  const card=document.createElement('div');card.className='poll-card';
  const qEl=document.createElement('div');qEl.className='poll-question';qEl.textContent=poll.question||'Poll';
  card.appendChild(qEl);
  const total=poll.options.reduce((s,o)=>s+(Array.isArray(o.votes)?o.votes.length:0),0);
  poll.options.forEach((opt,i)=>{
    const votes=Array.isArray(opt.votes)?opt.votes:[];
    const pct=total?Math.round(votes.length/total*100):0;
    const row=document.createElement('div');row.className='poll-opt-row';
    row.onclick=()=>votePoll(msgId,i);
    const barWrap=document.createElement('div');barWrap.className='poll-opt-bar-wrap';
    const bar=document.createElement('div');bar.className='poll-opt-bar';bar.style.width=pct+'%';
    const label=document.createElement('div');label.className='poll-opt-label';
    const voted=votes.includes(me.number);
    label.innerHTML=`<span>${voted?'✓ ':' '}${esc(opt.text||'')}</span><span>${pct}%</span>`;
    barWrap.appendChild(bar);barWrap.appendChild(label);
    // Mini avatars of voters
    if(votes.length){
      const avWrap=document.createElement('div');avWrap.className='poll-opt-avatars';
      votes.slice(0,5).forEach(num=>{
        const u=lookupUser(num)||{};
        const av=document.createElement('div');av.className='poll-opt-av';
        av.textContent=(dec(u.name)||'?').charAt(0).toUpperCase();
        avWrap.appendChild(av);
      });
      row.appendChild(barWrap);row.appendChild(avWrap);
    }else{row.appendChild(barWrap);}
    card.appendChild(row);
  });
  const tot=document.createElement('div');tot.className='poll-total';tot.textContent=total+' vote'+(total!==1?'s':'');
  card.appendChild(tot);
  body.appendChild(card);
}

