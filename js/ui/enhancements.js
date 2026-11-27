/* =============================================================================
   FEATURE PACK — DOM INJECTION
   Everything new is built here rather than hand-edited into the markup above,
   so the existing layout is left exactly as it was.
   ========================================================================== */
function injectFeatureDom(){
  // --- sidebar tabs: Chats (static, first, already .active), Unread, Favourites,
  // Groups, Servers (both static), Calls, Archived (static, last) ------------
  // Ordered by how often each view is actually used — triage views (Unread,
  // Favourites) right next to the default Chats tab, structural containers
  // (Groups/Servers) in the middle, the log-style Calls view and the
  // intentionally-tucked-away Archived view at the end.
  const tabs=document.getElementById('sb-tabs');
  const chatsTab=tabs ? tabs.querySelector('.sb-tab') : null; // first static tab = Chats
  if(tabs && chatsTab && !document.getElementById('sb-tab-unread')){
    const btn=document.createElement('button');
    btn.className='sb-tab'; btn.id='sb-tab-unread'; btn.setAttribute('data-tab','unread'); btn.draggable=true;
    btn.setAttribute('data-i18n','tab_unread');
    btn.textContent=scbT('tab_unread');
    btn.onclick=function(){ switchTab('unread',this); };
    tabs.insertBefore(btn, chatsTab.nextSibling);
  }
  if(tabs && !document.getElementById('sb-tab-fav')){
    const unreadTab=document.getElementById('sb-tab-unread');
    const btn=document.createElement('button');
    btn.className='sb-tab'; btn.id='sb-tab-fav'; btn.setAttribute('data-tab','favourites'); btn.draggable=true;
    btn.setAttribute('data-i18n','tab_favourites');
    btn.textContent=scbT('tab_favourites');
    btn.onclick=function(){ switchTab('favourites', this); };
    tabs.insertBefore(btn, unreadTab?unreadTab.nextSibling:tabs.firstChild.nextSibling);
  }
  if(tabs && !document.getElementById('sb-tab-calls')){
    const archived=tabs.querySelector('.sb-tab:last-child');
    const btn=document.createElement('button');
    btn.className='sb-tab'; btn.id='sb-tab-calls'; btn.setAttribute('data-tab','calls'); btn.draggable=true;
    btn.setAttribute('data-i18n','tab_calls');
    btn.textContent=scbT('tab_calls');
    btn.onclick=function(){ switchTab('calls',this); };
    tabs.insertBefore(btn, archived);
  }
  // --- favourite entries in the two existing menus ---------------------------
  const headerMenu=document.getElementById('chat-header-menu');
  if(headerMenu && !document.getElementById('favorite-menu-item')){
    const item=document.createElement('div');
    item.className='ctx-item'; item.id='favorite-menu-item';
    item.textContent='☆ '+scbT('add_favourite');
    item.onclick=function(){ hideHeaderMenu(); favoriteToggle(); };
    headerMenu.insertBefore(item, headerMenu.firstChild);
  }
  const ctxMenu=document.getElementById('contact-ctx-menu');
  if(ctxMenu && !document.getElementById('favorite-ctx-item')){
    const item=document.createElement('div');
    item.className='ctx-item'; item.id='favorite-ctx-item';
    item.textContent='☆ '+scbT('add_favourite');
    item.onclick=favoriteContactFromCtx;
    ctxMenu.insertBefore(item, ctxMenu.firstChild);
  }
  // --- tab bar above the chat panel -----------------------------------------
  const main=document.getElementById('main');
  if(main && !document.getElementById('scb-tab-bar')){
    const bar=document.createElement('div');
    bar.id='scb-tab-bar';
    main.insertBefore(bar, main.firstChild);
  }
  // --- typing suggestion bar, directly above the compose row -----------------
  const footer=document.getElementById('chat-footer');
  const composeRow=document.getElementById('compose-row');
  if(footer && composeRow && !document.getElementById('scb-suggest-bar')){
    const bar=document.createElement('div');
    bar.id='scb-suggest-bar';
    footer.insertBefore(bar, composeRow.parentNode===footer?composeRow:footer.firstChild);
  }
  // --- Meetings button in the sidebar's bottom nav ---------------------------
  // Placed in the "feature panels" group, right after Cloudy — not just
  // before whatever happens to be last, which used to land it next to
  // Settings for no reason other than insertion order.
  const bottom=document.getElementById('sb-bottom');
  if(bottom && !document.getElementById('scb-meetings-nav-btn')){
    const b=document.createElement('button');
    b.className='icon-btn'; b.id='scb-meetings-nav-btn';
    b.title=scbT('meetings'); b.setAttribute('aria-label',b.title);
    b.innerHTML='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 7l-7 5 7 5z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>';
    b.onclick=openMeetingsPanel;
    const cloudyBtn=document.getElementById('cloudy-btn');
    bottom.insertBefore(b, cloudyBtn?cloudyBtn.nextSibling:bottom.lastChild);
  }
  // --- "Start meeting" entry in the chat header menu (groups) ----------------
  if(headerMenu && !document.getElementById('scb-group-meeting-item')){
    const item=document.createElement('div');
    item.className='ctx-item'; item.id='scb-group-meeting-item';
    item.textContent='🎥 '+scbT('start_meeting');
    item.onclick=function(){ hideHeaderMenu(); startMeetingForActiveGroup(); };
    headerMenu.insertBefore(item, headerMenu.children[1]||null);
  }
  // --- tag the existing chrome for translation ------------------------------
  // The original markup has no string ids, so the handful of labels worth
  // translating get tagged here by position/selector instead of being rewritten
  // in place.
  const tagged=[
    ['#sb-tab-chats','tab_chats'],
    ['#sb-tab-groups','tab_groups'],
    ['#sb-tabs .sb-tab:last-child','tab_archived'],
    ['#settings-header div','settings']
  ];
  tagged.forEach(pair=>{
    const el=document.querySelector(pair[0]);
    if(el) el.setAttribute('data-i18n', pair[1]);
  });
  const msgInput=document.getElementById('msg-input');
  if(msgInput) msgInput.setAttribute('data-i18n-ph','type_message');
  const forgot=document.getElementById('login-forgot-password-link');
  if(forgot) forgot.setAttribute('data-i18n','forgot_password');
  injectFeatureSettings();
  injectFeatureModals();
  applyLanguage();
  initJumpToBottomBtn();
  initChatDragDrop();
  initMsgSelectMode();
  initSidebarResize();
  _applyStoredSidebarWidth();
  _applyStoredTabOrder();
  initTabDragReorder();
}

// ===== JUMP-TO-BOTTOM FLOATING BUTTON =====
// Shows once you've scrolled up more than ~1 screen height in the open
// chat; click (or new message while scrolled up) scrolls back to the
// latest message. Wired once — #jump-to-bottom-btn and #messages-wrap are
// both static markup, never re-created.
function _isNearChatBottom(wrap){
  if(!wrap) return true;
  return wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 100;
}
function jumpToBottom(){
  const wrap=document.getElementById('messages-wrap');
  if(wrap) wrap.scrollTop=wrap.scrollHeight;
  const btn=document.getElementById('jump-to-bottom-btn');
  if(btn) btn.style.display='none';
}
function _updateJumpToBottomBtn(){
  const wrap=document.getElementById('messages-wrap');
  const btn=document.getElementById('jump-to-bottom-btn');
  if(!wrap||!btn) return;
  // Scrolled up far enough to be worth a shortcut, and there's actually
  // something to scroll (a short chat that fits on screen never shows it).
  const scrolledUp=wrap.scrollHeight-wrap.scrollTop-wrap.clientHeight>=400;
  btn.style.display=scrolledUp?'flex':'none';
}
function initJumpToBottomBtn(){
  const wrap=document.getElementById('messages-wrap');
  if(!wrap||wrap._jumpBtnWired) return;
  wrap._jumpBtnWired=true;
  wrap.addEventListener('scroll',_updateJumpToBottomBtn,{passive:true});
}

// ===== RESIZABLE SIDEBAR =====
// Desktop only (hidden on phone/tablet via CSS — those already force their
// own width with !important media queries, so a stored desktop width would
// have no visible effect there anyway, and dragging makes no sense on a
// single-pane phone layout). Width persists in localStorage and reapplies
// on every launch.
const SB_MIN_WIDTH=320, SB_MAX_WIDTH=720;
function _applyStoredSidebarWidth(){
  try{
    const saved=parseInt(localStorage.getItem('cc_sidebar_width'));
    if(saved && saved>=SB_MIN_WIDTH && saved<=SB_MAX_WIDTH){
      const sb=document.getElementById('sidebar');
      if(sb) sb.style.width=saved+'px';
    }
  }catch(e){}
}
function initSidebarResize(){
  const handle=document.getElementById('sb-resize-handle');
  const sidebar=document.getElementById('sidebar');
  if(!handle||!sidebar||handle._wired) return;
  handle._wired=true;
  let dragging=false, startX=0, startW=0;
  handle.addEventListener('mousedown',e=>{
    if(document.body.classList.contains('device-phone')||document.body.classList.contains('device-tablet')) return;
    dragging=true; startX=e.clientX; startW=sidebar.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.userSelect='none';
    e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{
    if(!dragging) return;
    const w=Math.max(SB_MIN_WIDTH,Math.min(SB_MAX_WIDTH,startW+(e.clientX-startX)));
    sidebar.style.width=w+'px';
  });
  document.addEventListener('mouseup',()=>{
    if(!dragging) return;
    dragging=false;
    handle.classList.remove('dragging');
    document.body.style.userSelect='';
    try{ localStorage.setItem('cc_sidebar_width',Math.round(sidebar.getBoundingClientRect().width)); }catch(e){}
  });
}

// ===== DRAG-TO-REORDER SIDEBAR TABS =====
// Native HTML5 drag-and-drop on the .sb-tab buttons. Order persists as an
// array of data-tab values; reapplied on launch by physically reordering
// the existing DOM nodes to match (never removes/recreates a tab — just
// moves the elements that are already there).
function _applyStoredTabOrder(){
  try{
    const order=JSON.parse(localStorage.getItem('cc_sidebar_tab_order')||'null');
    const tabs=document.getElementById('sb-tabs');
    if(!Array.isArray(order)||!tabs) return;
    order.forEach(tabId=>{
      const el=tabs.querySelector('.sb-tab[data-tab="'+tabId+'"]');
      if(el) tabs.appendChild(el); // appendChild on an existing child MOVES it to the end, in order
    });
  }catch(e){}
}
function _saveTabOrder(){
  try{
    const order=[...document.querySelectorAll('#sb-tabs .sb-tab')].map(el=>el.getAttribute('data-tab')).filter(Boolean);
    localStorage.setItem('cc_sidebar_tab_order',JSON.stringify(order));
  }catch(e){}
}
function initTabDragReorder(){
  const tabs=document.getElementById('sb-tabs');
  if(!tabs||tabs._dragWired) return;
  tabs._dragWired=true;
  let draggedEl=null;
  tabs.addEventListener('dragstart',e=>{
    const btn=e.target.closest('.sb-tab');
    if(!btn) return;
    draggedEl=btn;
    btn.classList.add('dragging');
    e.dataTransfer.effectAllowed='move';
  });
  tabs.addEventListener('dragover',e=>{
    if(!draggedEl) return;
    e.preventDefault();
    const over=e.target.closest('.sb-tab');
    if(!over||over===draggedEl) return;
    const rect=over.getBoundingClientRect();
    const before=(e.clientX-rect.left)<rect.width/2;
    tabs.insertBefore(draggedEl, before?over:over.nextSibling);
  });
  tabs.addEventListener('dragend',()=>{
    if(draggedEl) draggedEl.classList.remove('dragging');
    draggedEl=null;
    _saveTabOrder();
  });
}

// ===== MESSAGE MULTI-SELECT (bulk delete/forward) =====
// Entered via the per-message context menu's "☑️ Select" action (works on
// both right-click and long-press, since the browser fires 'contextmenu'
// for a long-press on touch devices the same as a right-click on desktop).
let msgSelectMode=false;
const selectedMsgIds=new Set();
function enterMsgSelectMode(firstId){
  msgSelectMode=true;
  selectedMsgIds.clear();
  if(firstId) selectedMsgIds.add(firstId);
  const wrap=document.getElementById('messages-wrap');
  if(wrap) wrap.classList.add('select-mode');
  const row=firstId&&wrap?wrap.querySelector('[data-msg-id="'+CSS.escape(firstId)+'"]'):null;
  if(row) row.classList.add('selected');
  updateMsgSelectBar();
}
function exitMsgSelectMode(){
  if(!msgSelectMode) return;
  msgSelectMode=false;
  selectedMsgIds.clear();
  const wrap=document.getElementById('messages-wrap');
  if(wrap) wrap.classList.remove('select-mode');
  document.querySelectorAll('.msg-row.selected').forEach(r=>r.classList.remove('selected'));
  updateMsgSelectBar();
}
function toggleMsgSelected(id){
  if(selectedMsgIds.has(id)) selectedMsgIds.delete(id);
  else selectedMsgIds.add(id);
  const row=document.querySelector('[data-msg-id="'+CSS.escape(id)+'"]');
  if(row) row.classList.toggle('selected',selectedMsgIds.has(id));
  if(selectedMsgIds.size===0){ exitMsgSelectMode(); return; }
  updateMsgSelectBar();
}
function updateMsgSelectBar(){
  const bar=document.getElementById('msg-select-bar');
  if(!bar) return;
  bar.style.display=msgSelectMode?'flex':'none';
  const countEl=document.getElementById('msg-select-count');
  if(countEl) countEl.textContent=selectedMsgIds.size+(selectedMsgIds.size===1?' selected':' selected');
}
function _getSelectedConvoAndMessages(){
  if(!activeConvo||!convosCache) return {c:null,msgs:[]};
  const c=convosCache.find(x=>x&&x.key===activeConvo.key);
  if(!c||!c.messages) return {c:null,msgs:[]};
  return {c,msgs:c.messages.filter(m=>m&&selectedMsgIds.has(m.id))};
}
function msgSelectForward(){
  const {msgs}=_getSelectedConvoAndMessages();
  if(!msgs.length) return;
  openForwardModal(msgs); // exitMsgSelectMode() runs once the forward completes, see forwardToTarget()
}
async function msgSelectDelete(){
  const {c,msgs}=_getSelectedConvoAndMessages();
  if(!c||!msgs.length) return;
  if(!confirm('Delete '+msgs.length+' message'+(msgs.length===1?'':'s')+'? This can\'t be undone.')) return;
  const idsToDelete=new Set(msgs.map(m=>m.id));
  c.messages=c.messages.filter(m=>!idsToDelete.has(m.id));
  exitMsgSelectMode();
  try{
    await saveConvos();
  }catch(e){
    showToast('Delete failed',scbErr('SCB-MSG-26','Those messages couldn\'t be deleted — the server rejected the write.',(e.message||'')));
  }
  lastMsgHash='';
  renderMessages(c.messages);
}
function initMsgSelectMode(){
  const wrap=document.getElementById('messages-wrap');
  if(!wrap||wrap._selectWired) return;
  wrap._selectWired=true;
  // Capture phase: intercepts the click before it reaches any onclick handler
  // inside the bubble (links, poll options, etc.) while selecting is active.
  wrap.addEventListener('click',e=>{
    if(!msgSelectMode) return;
    const row=e.target.closest('.msg-row');
    const id=row&&row.getAttribute('data-msg-id');
    if(!id) return;
    e.preventDefault(); e.stopPropagation();
    toggleMsgSelected(id);
  },true);
}

// ===== DRAG-AND-DROP FILE SHARING =====
// Dropping a file (or several) anywhere on the open chat uploads and sends
// each one via the same uploadAndSendFile() the paperclip/attach button
// already uses — same size limit, block check, and new-account cooldown.
function initChatDragDrop(){
  const zone=document.getElementById('chat-bg-wrapper');
  const overlay=document.getElementById('chat-drop-overlay');
  if(!zone||!overlay||zone._dropWired) return;
  zone._dropWired=true;
  let dragDepth=0; // tracks nested dragenter/dragleave on child elements so the overlay doesn't flicker off while still dragging over a child
  const hasFiles=e=>e.dataTransfer&&[...(e.dataTransfer.types||[])].includes('Files');
  zone.addEventListener('dragenter',e=>{
    if(!hasFiles(e)||!activeConvo) return;
    e.preventDefault();
    dragDepth++;
    overlay.classList.add('active');
  });
  zone.addEventListener('dragover',e=>{
    if(!hasFiles(e)||!activeConvo) return;
    e.preventDefault(); // required for drop to fire at all
  });
  zone.addEventListener('dragleave',e=>{
    if(!hasFiles(e)) return;
    dragDepth=Math.max(0,dragDepth-1);
    if(dragDepth===0) overlay.classList.remove('active');
  });
  zone.addEventListener('drop',e=>{
    if(!hasFiles(e)) return;
    e.preventDefault();
    dragDepth=0;
    overlay.classList.remove('active');
    if(!activeConvo) return;
    const files=[...(e.dataTransfer.files||[])];
    files.forEach(f=>uploadAndSendFile(f));
  });
}

// ===== CHANGELOG / "WHAT'S NEW" =====
// Newest entry first. Bump CHANGELOG_VERSION whenever a new entry is added
// so the modal auto-opens once for everyone, the first time they launch
// after an update — same pattern as the tutorial-seen / cc_* one-time flags
// already used elsewhere in this file.
const CHANGELOG_VERSION='2026.10.1';
const CHANGELOG=[
  {version:'2026.10.1',items:[
    'Jump-to-bottom button in chat — appears when you scroll up, one click back to the latest message',
    'Group join/leave updates now show in the chat itself, collapsing into one summary when there are several in a row',
    'Fixed the admin shield icon disappearing for delegated admins a second after it showed up',
    'Cross-device message decryption now works for accounts that sign in with Google only, not just password logins',
    'Reorganized Settings, the sidebar, the dashboard, and the admin panel for clarity',
    'Removed the unfinished Stickers tab',
  ]},
];
function renderChangelog(){
  const body=document.getElementById('changelog-body');
  if(!body) return;
  body.innerHTML=CHANGELOG.map(entry=>
    '<div style="margin-bottom:16px">'+
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:8px">'+esc(entry.version)+'</div>'+
      '<ul style="margin:0;padding-left:18px;font-size:13px;color:var(--text);line-height:1.6">'+
        entry.items.map(i=>'<li>'+esc(i)+'</li>').join('')+
      '</ul>'+
    '</div>'
  ).join('');
}
function openChangelog(){
  renderChangelog();
  openModal('changelog-modal');
  try{ localStorage.setItem('cc_changelog_seen',CHANGELOG_VERSION); }catch(e){}
}
function _maybeAutoShowChangelog(){
  try{
    if(localStorage.getItem('cc_changelog_seen')===CHANGELOG_VERSION) return;
    // Never interrupt a brand-new account's first launch with "what's new"
    // — only show it to returning users who've been on an older version.
    if(!localStorage.getItem('cc_changelog_seen')){
      localStorage.setItem('cc_changelog_seen',CHANGELOG_VERSION);
      return;
    }
    openChangelog();
  }catch(e){}
}

function injectFeatureSettings(){
  const scroll=document.getElementById('settings-scroll');
  if(!scroll || document.getElementById('scb-settings-block')) return;
  // Theme Colours used to be its own standalone section — merged into the
  // static Appearance section below instead, since both are "how the app
  // looks" and showing them as two disconnected boxes was only an artifact
  // of this content being built here rather than written in place.
  const appearanceSection=document.getElementById('appearance-section');
  if(appearanceSection && !document.getElementById('scb-primary-color')){
    appearanceSection.insertAdjacentHTML('beforeend',
      '<h3 data-i18n="theme_colors">Theme Colours</h3>'+
      '<div class="scb-presets" id="scb-presets" role="group" aria-label="Colour themes"></div>'+
      '<div class="settings-row">'+
        '<div class="settings-row-main"><div class="settings-row-label" data-i18n="primary_color">Primary colour</div><div class="settings-row-sub">Used for buttons, your message bubbles, badges and highlights</div></div>'+
        '<div class="settings-row-actions"><input type="color" class="scb-color-input" id="scb-primary-color" value="#5A52D5" aria-label="Primary colour"/></div>'+
      '</div>'+
      '<div class="settings-row">'+
        '<div class="settings-row-main"><div class="settings-row-label" data-i18n="secondary_color">Secondary colour</div><div class="settings-row-sub">The far end of every gradient in the app\'s chrome</div></div>'+
        '<div class="settings-row-actions"><input type="color" class="scb-color-input" id="scb-secondary-color" value="#7C5FD4" aria-label="Secondary colour"/></div>'+
      '</div>'+
      '<div style="display:flex;gap:8px;padding:8px 18px 16px">'+
        '<button class="btn btn-sm" id="scb-colors-save">Apply</button>'+
        '<button class="btn btn-ghost btn-sm" id="scb-colors-reset" data-i18n="reset" style="margin:0">Reset</button>'+
      '</div>'
    );
  }
  const block=document.createElement('div');
  block.id='scb-settings-block';
  block.innerHTML=
  '<div class="settings-section" data-settings-tab="looks">'+
    '<h3 data-i18n="language">Language</h3>'+
    '<div class="settings-row">'+
      '<div class="settings-row-main"><div class="settings-row-label" data-i18n="language">Language</div><div class="settings-row-sub">Translates the main navigation, settings and common buttons</div></div>'+
      '<div class="settings-row-actions"><select id="scb-language-select" style="min-width:130px"></select></div>'+
    '</div>'+
  '</div>'+
  '<div class="settings-section" id="scb-accessibility-section" data-settings-tab="looks" style="display:none">'+
    '<h3>Accessibility</h3>'+
    '<div class="settings-row">'+
      '<div class="settings-row-main"><div class="settings-row-label" data-i18n="large_text">Simplified, larger text</div><div class="settings-row-sub">Bigger text and roomier buttons throughout. Optional — off unless you turn it on.</div></div>'+
      '<div class="settings-row-actions"><label class="switch"><input type="checkbox" id="scb-large-text-toggle"><span class="switch-slider"></span></label></div>'+
    '</div>'+
  '</div>'+
  '<div class="settings-section" data-settings-tab="security">'+
    '<h3>Game Status</h3>'+
    '<div class="settings-row">'+
      '<div class="settings-row-main"><div class="settings-row-label">Show what contacts are playing</div><div class="settings-row-sub">If a contact has linked a Syntax Account (Cube Leap, Jumpa, Ultimo Chess), show a "🎮 Playing…" pill on their profile. Read-only — nothing about you is shared by this setting.</div></div>'+
      '<div class="settings-row-actions"><label class="switch"><input type="checkbox" id="scb-now-playing-toggle"><span class="switch-slider"></span></label></div>'+
    '</div>'+
  '</div>'+
  // ---- Connected Accounts --------------------------------------------------
  // For accounts that signed up with just a number/email + password and want to
  // attach a Google account or a Syntax Account afterwards. Both rows are
  // rendered by renderConnectedAccounts(), which runs every time Settings opens
  // so the state is never stale.
  '<div class="settings-section" id="scb-connected-accounts-section" data-settings-tab="profile">'+
    '<h3>Connected Accounts</h3>'+
    '<div class="settings-row" id="scb-google-link-row">'+
      '<div class="settings-row-main">'+
        '<div class="settings-row-label">Google Account</div>'+
        '<div class="settings-row-sub" id="scb-google-link-sub">Not connected</div>'+
      '</div>'+
      '<div class="settings-row-actions">'+
        // Google renders its official button into this holder when a link is
        // possible; the plain button next to it is the disabled state shown when
        // Google sign-in isn't configured or its script didn't load.
        '<div id="scb-google-gsi-btn"></div>'+
        '<button class="btn btn-ghost btn-sm" id="scb-google-connect-fallback" style="display:none" disabled>Connect</button>'+
        '<button class="btn btn-ghost btn-sm" id="scb-google-disconnect-btn" style="display:none">Disconnect</button>'+
      '</div>'+
    '</div>'+
    '<div class="settings-row" id="scb-syntax-link-row">'+
      '<div class="settings-row-main">'+
        '<div class="settings-row-label">Syntax Account</div>'+
        '<div class="settings-row-sub" id="scb-syntax-link-sub">Not connected</div>'+
      '</div>'+
      '<div class="settings-row-actions">'+
        '<button class="btn btn-ghost btn-sm" id="scb-syntax-connect-btn">Connect</button>'+
        '<button class="btn btn-ghost btn-sm" id="scb-syntax-disconnect-btn" style="display:none">Disconnect</button>'+
      '</div>'+
    '</div>'+
    '<div class="settings-row" id="scb-connected-note-row" style="display:none">'+
      '<div class="settings-row-main"><div class="settings-row-sub" id="scb-connected-note" style="max-width:none"></div></div>'+
    '</div>'+
  '</div>'+
  '<div class="settings-section" id="scb-music-section" data-settings-tab="profile">'+
    '<h3>Music</h3>'+
    '<div class="settings-row" id="scb-spotify-row">'+
      '<div class="settings-row-main">'+
        '<div class="settings-row-label">Spotify</div>'+
        '<div class="settings-row-sub" id="scb-spotify-sub">Not connected</div>'+
      '</div>'+
      '<div class="settings-row-actions">'+
        '<button class="btn btn-ghost btn-sm" id="scb-spotify-connect-btn">Connect</button>'+
        '<button class="btn btn-ghost btn-sm" id="scb-spotify-disconnect-btn" style="display:none">Disconnect</button>'+
      '</div>'+
    '</div>'+
    '<div class="settings-row" id="scb-lastfm-row">'+
      '<div class="settings-row-main">'+
        '<div class="settings-row-label">Last.fm</div>'+
        '<div class="settings-row-sub" id="scb-lastfm-sub">Not connected — enter your Last.fm username so contacts can see what you\'re listening to</div>'+
      '</div>'+
      '<div class="settings-row-actions" style="gap:6px;flex-wrap:wrap">'+
        '<input id="scb-lastfm-input" placeholder="Username" style="height:32px;border:1px solid var(--border);border-radius:7px;padding:0 10px;font-size:13px;background:var(--bg);color:var(--text);width:120px">'+
        '<button class="btn btn-ghost btn-sm" id="scb-lastfm-connect-btn">Connect</button>'+
        '<button class="btn btn-ghost btn-sm" id="scb-lastfm-disconnect-btn" style="display:none">Disconnect</button>'+
      '</div>'+
    '</div>'+
  '</div>'+
  '<div class="settings-section" id="scb-family-section" data-settings-tab="profile">'+
    '<h3>Family &amp; Parental Controls</h3>'+
    '<div class="settings-row" id="scb-child-accounts-row" style="display:none;cursor:pointer">'+
      '<div class="settings-row-main"><div class="settings-row-label" data-i18n="parent_controls">Manage Child Accounts</div><div class="settings-row-sub">Create a profile for a child under 8 and choose what they can do</div></div>'+
      '<div class="settings-row-actions"><button class="btn btn-ghost btn-sm" id="scb-child-accounts-btn" data-i18n="open">Open</button></div>'+
    '</div>'+
    '<div class="settings-row" id="scb-linked-accounts-row" style="display:none;cursor:pointer">'+
      '<div class="settings-row-main"><div class="settings-row-label" data-i18n="linked_accounts">Manage Linked Accounts</div><div class="settings-row-sub">Restrictions for the under-18s who have linked you as their parent</div></div>'+
      '<div class="settings-row-actions"><button class="btn btn-ghost btn-sm" id="scb-linked-accounts-btn" data-i18n="open">Open</button></div>'+
    '</div>'+
    '<div class="settings-row" id="scb-link-parent-row" style="display:none;cursor:pointer">'+
      '<div class="settings-row-main"><div class="settings-row-label">Link a parent account</div><div class="settings-row-sub" id="scb-link-parent-sub">Optional. Verifies a parent and lets them manage what your account can do.</div></div>'+
      '<div class="settings-row-actions"><button class="btn btn-ghost btn-sm" id="scb-link-parent-btn" data-i18n="open">Open</button></div>'+
    '</div>'+
    '<div class="settings-row" id="scb-family-none-row">'+
      '<div class="settings-row-main"><div class="settings-row-sub" id="scb-family-none-text">Nothing to manage on this account.</div></div>'+
    '</div>'+
  '</div>'+
  '<div class="settings-section" data-settings-tab="more" id="scb-status-section" style="display:none">'+
    '<h3 data-i18n="system_status">System Status</h3>'+
    '<div class="settings-row" style="cursor:pointer" id="scb-status-row">'+
      '<div class="settings-row-main"><div class="settings-row-label" data-i18n="system_status">System Status</div><div class="settings-row-sub">Live check of messaging, Firebase, calls, the weather widget and the admin panel</div></div>'+
      '<div class="settings-row-actions"><button class="btn btn-ghost btn-sm" id="scb-status-btn" data-i18n="open">Open</button></div>'+
    '</div>'+
  '</div>'+
  '<div class="settings-section" data-settings-tab="more">'+
    '<h3>What\'s New</h3>'+
    '<div class="settings-row" style="cursor:pointer" id="scb-changelog-row">'+
      '<div class="settings-row-main"><div class="settings-row-label">Changelog</div><div class="settings-row-sub">See what\'s changed recently</div></div>'+
      '<div class="settings-row-actions"><button class="btn btn-ghost btn-sm">Open</button></div>'+
    '</div>'+
  '</div>'+
  '<div class="settings-section" data-settings-tab="more">'+
    '<h3 data-i18n="meetings">Meetings</h3>'+
    '<div class="settings-row" style="cursor:pointer" id="scb-meetings-row">'+
      '<div class="settings-row-main"><div class="settings-row-label" data-i18n="start_meeting">Start Meeting</div><div class="settings-row-sub">Video, voice, screen share and chat — up to '+effectiveMaxParticipants()+' people per room</div></div>'+
      '<div class="settings-row-actions"><button class="btn btn-ghost btn-sm" id="scb-meetings-btn" data-i18n="open">Open</button></div>'+
    '</div>'+
  '</div>'+
  '<div class="settings-section" data-settings-tab="more">'+
    '<h3 data-i18n="rules">Rules &amp; Guidelines</h3>'+
    '<div class="settings-row" style="cursor:pointer" id="scb-rules-row">'+
      '<div class="settings-row-main"><div class="settings-row-label" data-i18n="rules">Rules &amp; Guidelines</div><div class="settings-row-sub">What\'s expected here, how to report a problem, and what happens next</div></div>'+
      '<div class="settings-row-actions"><button class="btn btn-ghost btn-sm" id="scb-rules-btn" data-i18n="open">Open</button></div>'+
    '</div>'+
  '</div>';
  scroll.appendChild(block);

  // Wire every control explicitly (no inline onclick strings to go stale).
  document.getElementById('scb-colors-save').onclick=saveThemeColors;
  document.getElementById('scb-colors-reset').onclick=resetThemeColors;
  renderThemePresets();
  document.getElementById('scb-status-row').onclick=openSystemStatus;
  document.getElementById('scb-changelog-row').onclick=openChangelog;
  document.getElementById('scb-meetings-row').onclick=openMeetingsPanel;
  document.getElementById('scb-rules-row').onclick=openRulesModal;
  document.getElementById('scb-child-accounts-row').onclick=openChildAccountsModal;
  document.getElementById('scb-linked-accounts-row').onclick=openChildAccountsModal;
  document.getElementById('scb-link-parent-row').onclick=openLinkParentModal;
  document.getElementById('scb-large-text-toggle').onchange=function(){ toggleLargeTextMode(this.checked); };
  const npToggle=document.getElementById('scb-now-playing-toggle');
  if(npToggle){
    npToggle.checked=nowPlayingEnabled();
    npToggle.onchange=function(){
      scbSave('cc_now_playing_enabled', !!this.checked);
      // Drop the cache so turning it back on doesn't show a stale result and
      // turning it off doesn't keep one around.
      Object.keys(_nowPlayingCache).forEach(k=>delete _nowPlayingCache[k]);
    };
  }
  document.getElementById('scb-google-disconnect-btn').onclick=disconnectGoogleAccount;
  document.getElementById('scb-syntax-connect-btn').onclick=openSyntaxLinkModal;
  document.getElementById('scb-syntax-disconnect-btn').onclick=disconnectSyntaxAccount;
  const sel=document.getElementById('scb-language-select');
  Object.keys(I18N).forEach(code=>{
    const o=document.createElement('option');
    o.value=code; o.textContent=I18N[code]._name;
    sel.appendChild(o);
  });
  sel.value=getLanguage();
  sel.onchange=function(){ setLanguage(this.value); };
}

// Which family rows make sense depends on the tier, so it's recomputed whenever
// Settings opens rather than only once at boot.
function updateFeatureSettingsUI(){
  const tier=myTier();
  const acc=document.getElementById('scb-accessibility-section');
  if(acc) acc.style.display=(tier==='elderly')?'block':'none';
  const childRow=document.getElementById('scb-child-accounts-row');
  const linkedRow=document.getElementById('scb-linked-accounts-row');
  const linkRow=document.getElementById('scb-link-parent-row');
  const noneRow=document.getElementById('scb-family-none-row');
  const isAdult=(tier==='adult'||tier==='elderly');
  if(childRow) childRow.style.display=isAdult?'flex':'none';
  if(linkedRow) linkedRow.style.display=isAdult?'flex':'none';
  if(linkRow) linkRow.style.display=(tier==='minor')?'flex':'none';
  const sub=document.getElementById('scb-link-parent-sub');
  if(sub && me) sub.textContent = me.linkedParent
    ? ('Linked to #'+me.linkedParent+'. Unlinking needs your parental PIN.')
    : 'Optional. Verifies a parent and lets them manage what your account can do.';
  if(noneRow) noneRow.style.display=(isAdult||tier==='minor')?'none':'flex';
  // System Status surfaces live internal infrastructure state (e.g. "Meetings
  // (LiveKit): token proxy responded with 500") that every signed-in user
  // could otherwise see — restrict it to the same admins who can see the
  // Admin Dashboard's own Diagnostics tab (head admin, or any delegated
  // admin with at least one granted permission).
  const statusSection=document.getElementById('scb-status-section');
  if(statusSection) statusSection.style.display=hasAnyAdminAccess()?'':'none';
  const cb=document.getElementById('scb-large-text-toggle');
  if(cb) cb.checked=document.body.classList.contains('scb-large-text');
  const np=document.getElementById('scb-now-playing-toggle');
  if(np) np.checked=nowPlayingEnabled();
  try{ renderConnectedAccounts(); }catch(e){ console.warn('connected accounts render failed', e); }
  try{ renderMusicSettings(); }catch(e){}
}
const _origShowSettings = showSettings;
showSettings = function(){
  _origShowSettings();
  try{ updateFeatureSettingsUI(); initThemeColors(); }catch(e){ console.warn('settings refresh failed', e); }
  // Re-apply tab visibility after feature settings update (updateFeatureSettingsUI uses inline styles that override tab display)
  try{ const t=localStorage.getItem('cc_settings_tab')||'profile'; switchSettingsTab(t); }catch(e){}
};

function injectFeatureModals(){
  if(document.getElementById('scb-status-modal')) return;
  const wrap=document.createElement('div');
  wrap.id='scb-feature-modals';
  wrap.innerHTML=
  // ---- System status -------------------------------------------------------
  '<div class="overlay" id="scb-status-modal"><div class="modal" style="max-width:520px">'+
    '<div class="modal-header"><h2 data-i18n="system_status">System Status</h2><p>A live check of the parts of SoCloudyBro that can fail independently.</p></div>'+
    '<div class="modal-body" style="padding-bottom:14px"><div id="scb-status-body"></div>'+
      '<div id="scb-status-stamp" style="font-size:11px;color:var(--muted);margin-top:10px"></div></div>'+
    '<div class="modal-footer"><button class="btn" id="scb-status-recheck" data-i18n="recheck_now">Recheck now</button>'+
      '<button class="btn btn-ghost" id="scb-status-close" data-i18n="close">Close</button></div>'+
  '</div></div>'+
  // ---- Rules & guidelines --------------------------------------------------
  '<div class="overlay" id="scb-rules-modal"><div class="modal" style="max-width:560px">'+
    '<div class="modal-header"><h2 data-i18n="rules">Rules &amp; Guidelines</h2><p>These apply to every chat, group, meeting and profile on SoCloudyBro.</p></div>'+
    '<div class="modal-body scb-rules-body" style="padding-bottom:14px;max-height:60vh;overflow-y:auto">'+
      '<h4>1. Treat people well</h4>'+
      '<p>Talk to people the way you\'d want to be talked to. Disagreeing is fine; insults, mocking, pile-ons and deliberately trying to upset someone are not. If someone asks you to stop messaging them, stop.</p>'+
      '<h4>2. No harassment, hate or threats</h4>'+
      '<p>Never post content that attacks or demeans someone for who they are — race, ethnicity, religion, disability, gender, sexual orientation, age or nationality. Threats of violence, encouraging self-harm, stalking, doxxing (posting someone\'s address, school, workplace or phone number) and sexual harassment all result in immediate removal.</p>'+
      '<h4>3. No spam, scams or phishing</h4>'+
      '<p>Don\'t send bulk unsolicited messages, chain messages, referral spam or fake giveaways. Never ask anyone for their password, login code, PIN, gift-card codes, crypto wallet details or payment information — no legitimate person will. SoCloudyBro staff will never ask for your password.</p>'+
      '<p>Messages that look like scams get an automatic warning banner. That warning is a hint, not a guarantee: judge for yourself, and when in doubt, don\'t click.</p>'+
      '<h4>4. Age-appropriate content in mixed spaces</h4>'+
      '<p>SoCloudyBro is used by children, teenagers and adults, often in the same group. Keep content in any group you don\'t control to what you\'d be comfortable with a 10-year-old reading. No sexual content, graphic violence, gore, drugs or alcohol promotion in mixed groups. Sexual content involving minors is never permitted anywhere, will be removed and will be reported.</p>'+
      '<h4>5. Respect privacy</h4>'+
      '<p>Don\'t share other people\'s messages, photos or personal details outside the conversation they were shared in without permission. Don\'t record calls or meetings without telling the people in them.</p>'+
      '<h4>6. Keep your account yours</h4>'+
      '<p>One person per account. Don\'t share logins, don\'t impersonate someone else, and don\'t create accounts to get around a suspension. Child profiles must be created and owned by a parent or guardian from their own account.</p>'+
      '<h4>7. Files and links</h4>'+
      '<p>Only download files from people you trust. Automatic malware scanning is not enabled on this site, so nothing here has been checked for you. Don\'t send executables to people who didn\'t ask for them.</p>'+
      '<h4>8. How to report a problem</h4>'+
      '<ul>'+
        '<li>Open the chat, tap <b>⋯ → 🚩 Report</b>, and describe what happened.</li>'+
        '<li>Block the person from the same menu if you don\'t want further contact.</li>'+
        '<li>Reports go to the moderation team and include the account number involved.</li>'+
        '<li>If someone is in immediate danger, contact your local emergency services first — we can\'t respond to emergencies.</li>'+
      '</ul>'+
      '<h4>9. What happens when rules are broken</h4>'+
      '<p>Depending on severity and history: a warning, removal of the content, a temporary restriction on messaging or groups, or a permanent ban of the account. Serious cases — threats, sexual content involving minors, fraud — skip straight to a ban. Bans apply to the person, not just the account number.</p>'+
      '<h4>10. Appeals</h4>'+
      '<p>If you think a decision was wrong, submit a report explaining why and it will be reviewed by a moderator who wasn\'t involved in the original decision.</p>'+
    '</div>'+
    '<div class="modal-footer"><button class="btn btn-full" id="scb-rules-close" data-i18n="close">Close</button></div>'+
  '</div></div>'+
  // ---- Child accounts ------------------------------------------------------
  '<div class="overlay" id="scb-child-modal"><div class="modal" style="max-width:480px">'+
    '<div class="modal-header"><h2 data-i18n="parent_controls">Manage Child Accounts</h2><p>Create and control profiles for children under 8, and set restrictions for any under-18 who has linked you as their parent.</p></div>'+
    '<div class="modal-body" style="padding-bottom:14px;max-height:56vh;overflow-y:auto">'+
      '<div id="scb-managed-list"></div>'+
      '<h4 class="scb-subhead">Add a child profile</h4>'+
      '<div class="field"><label>Child\'s display name</label><input type="text" id="scb-child-name" maxlength="24" placeholder="e.g. Sam"/></div>'+
      '<div class="field"><label>Account number</label><input type="number" id="scb-child-number" min="1000" max="99999" placeholder="e.g. 4821"/></div>'+
      '<div class="field"><label>Password</label><div class="pwd-field-wrap"><input type="password" id="scb-child-password" placeholder="At least 8 characters"/><button type="button" class="pwd-toggle-btn" id="scb-child-pwd-toggle" tabindex="-1" aria-label="Show password">👁️</button></div></div>'+
      '<div class="field"><label>Date of birth</label><input type="date" id="scb-child-birthdate"/></div>'+
      '<div class="error-text" id="scb-child-error"></div>'+
      '<button class="btn btn-full" id="scb-child-create-btn">Create child profile</button>'+
    '</div>'+
    '<div class="modal-footer"><button class="btn btn-ghost btn-full" id="scb-child-close" data-i18n="close">Close</button></div>'+
  '</div></div>'+
  // ---- Link a parent -------------------------------------------------------
  '<div class="overlay" id="scb-link-parent-modal"><div class="modal" style="max-width:420px">'+
    '<div class="modal-header"><h2>Link a parent account</h2><p>Optional. A linked parent can turn individual features off for your account.</p></div>'+
    '<div class="modal-body" style="padding-bottom:14px">'+
      '<div id="scb-link-form">'+
        '<div class="field"><label>Parent\'s account number</label><input type="number" id="scb-link-parent-number" min="1000" max="99999"/></div>'+
        '<div class="field"><label>Parent\'s account password</label><div class="pwd-field-wrap"><input type="password" id="scb-link-parent-password"/><button type="button" class="pwd-toggle-btn" id="scb-link-parent-pwd-toggle" tabindex="-1" aria-label="Show password">👁️</button></div><div class="field-hint">Your parent enters this themselves — it proves it\'s really them and is never stored.</div></div>'+
        '<div class="field"><label>Choose a parental PIN</label><input type="text" id="scb-link-pin" inputmode="numeric" maxlength="8" placeholder="4–8 digits"/><div class="field-hint">Separate from your password. You\'ll need it to unlink later.</div></div>'+
        '<div class="error-text" id="scb-link-error"></div>'+
        '<button class="btn btn-full" id="scb-link-submit">Link parent</button>'+
      '</div>'+
      '<div id="scb-link-linked" style="display:none">'+
        '<p style="font-size:13px;color:var(--text2);margin-bottom:10px">Currently linked to <b id="scb-link-current"></b>. The link ends automatically when you turn 18.</p>'+
        '<div class="field"><label>Parental PIN</label><input type="text" id="scb-link-unlink-pin" inputmode="numeric" maxlength="8"/></div>'+
        '<div class="error-text" id="scb-unlink-error"></div>'+
        '<button class="btn btn-full btn-danger" id="scb-unlink-submit">Unlink parent</button>'+
      '</div>'+
    '</div>'+
    '<div class="modal-footer"><button class="btn btn-ghost btn-full" id="scb-link-close" data-i18n="close">Close</button></div>'+
  '</div></div>'+
  // ---- Link a Syntax Account -----------------------------------------------
  // Number + password, matching SyntaxAccount.logIn()'s shape exactly. Nothing
  // is created here — this links an account the player already has.
  '<div class="overlay" id="scb-syntax-link-modal"><div class="modal" style="max-width:380px">'+
    '<div class="modal-header"><h2>🎮 Connect Syntax Account</h2><p>Sign in to the Syntax Account you use in Cube Leap, Jumpa! and Ultimo Chess to link it to this SoCloudyBro account.</p></div>'+
    '<div class="modal-body" style="padding-bottom:14px">'+
      '<div class="field"><label>Syntax Account number</label><input type="number" id="scb-syntax-number" placeholder="e.g. 4821" min="1000" max="99999"/>'+
        '<div class="field-hint">1000–99999. This is a separate number from your SoCloudyBro number — it may or may not be the same digits.</div></div>'+
      '<div class="field"><label>Password</label><div class="pwd-field-wrap"><input type="password" id="scb-syntax-password" placeholder="Your Syntax Account password"/><button type="button" class="pwd-toggle-btn" id="scb-syntax-pwd-toggle" tabindex="-1" aria-label="Show password">👁️</button></div></div>'+
      '<div class="error-text" id="scb-syntax-link-error"></div>'+
      '<button class="btn btn-full" id="scb-syntax-link-submit">Connect ↗</button>'+
      '<div style="font-size:11px;color:var(--muted);margin-top:10px;line-height:1.5">Your Syntax Account password is checked by the Syntax Account system and is never stored here. Linking lets your contacts see a “🎮 Playing…” badge while you\'re in one of those games, if they have that setting on.</div>'+
    '</div>'+
    '<div class="modal-footer"><button class="btn btn-ghost btn-full" id="scb-syntax-link-close">Close</button></div>'+
  '</div></div>'+
  // ---- Meeting lobby -------------------------------------------------------
  '<div class="overlay" id="scb-meeting-lobby"><div class="modal" style="max-width:400px">'+
    '<div class="modal-header"><h2 data-i18n="meetings">Meetings</h2><p>Video, voice, screen sharing and chat in one room.</p></div>'+
    '<div class="modal-body" style="padding-bottom:14px">'+
      '<button class="btn btn-full" id="scb-meeting-start-btn" data-i18n="start_meeting">Start Meeting</button>'+
      '<button class="btn btn-ghost btn-full" id="scb-meeting-link-btn" style="margin-top:8px">Create a call link</button>'+
      '<div class="field" style="margin-top:14px"><label>Or join with a code</label><input type="text" id="scb-meeting-code" placeholder="ABCD-EFGH-JKLM" maxlength="24"/></div>'+
      '<div class="error-text" id="scb-meeting-lobby-error"></div>'+
      '<button class="btn btn-ghost btn-full" id="scb-meeting-join-btn" data-i18n="join_meeting">Join Meeting</button>'+
      '<div id="scb-meeting-cap-note" style="font-size:11px;color:var(--muted);margin-top:10px;line-height:1.5"></div>'+
    '</div>'+
    '<div class="modal-footer"><button class="btn btn-ghost btn-full" id="scb-meeting-lobby-close" data-i18n="close">Close</button></div>'+
  '</div></div>'+
  // ---- Meeting room --------------------------------------------------------
  '<div id="scb-meeting-room">'+
    '<div id="scb-meeting-top"><span>🎥</span><span id="scb-meeting-id-label"></span><span id="scb-meeting-count"></span>'+
      '<button class="btn btn-ghost btn-sm" id="scb-meeting-copy-btn" style="margin-left:auto">Copy link</button>'+
      '<button class="btn btn-ghost btn-sm" id="scb-meeting-min-btn" title="Keep the meeting running and go back to the app">\u2935 Minimise</button>'+
      '<button class="btn btn-danger btn-sm" id="scb-meeting-leave-btn" data-i18n="leave_meeting">Leave</button></div>'+
    '<div id="scb-meeting-main">'+
      '<div id="scb-meeting-grid"></div>'+
      '<div id="scb-meeting-chat">'+
        '<div id="scb-meeting-chat-log"></div>'+
        '<div id="scb-meeting-chat-form"><input type="text" id="scb-meeting-chat-input" placeholder="Message…" style="flex:1"/>'+
          '<button class="btn btn-sm" id="scb-meeting-chat-send" data-i18n="send">Send</button></div>'+
      '</div>'+
    '</div>'+
    '<div id="scb-meeting-controls">'+
      '<button class="btn btn-ghost btn-sm" id="scb-meet-mic-btn">🎙 Mute</button>'+
      '<button class="btn btn-ghost btn-sm" id="scb-meet-cam-btn">📹 Camera</button>'+
      '<button class="btn btn-ghost btn-sm" id="scb-meet-screen-btn">🖥 Share screen</button>'+
    '</div>'+
  '</div>';
  document.body.appendChild(wrap);

  // Wiring
  document.getElementById('scb-status-recheck').onclick=runSystemStatusChecks;
  document.getElementById('scb-status-close').onclick=function(){ closeModal('scb-status-modal'); };
  document.getElementById('scb-rules-close').onclick=function(){ closeModal('scb-rules-modal'); };
  document.getElementById('scb-child-pwd-toggle').onclick=function(){ togglePwd('scb-child-password',this); };
  document.getElementById('scb-link-parent-pwd-toggle').onclick=function(){ togglePwd('scb-link-parent-password',this); };
  document.getElementById('scb-syntax-pwd-toggle').onclick=function(){ togglePwd('scb-syntax-password',this); };
  document.getElementById('scb-child-create-btn').onclick=createChildProfile;
  document.getElementById('scb-child-close').onclick=function(){ closeModal('scb-child-modal'); };
  document.getElementById('scb-link-submit').onclick=submitLinkParent;
  document.getElementById('scb-unlink-submit').onclick=submitUnlinkParent;
  document.getElementById('scb-link-close').onclick=function(){ closeModal('scb-link-parent-modal'); };
  document.getElementById('scb-syntax-link-submit').onclick=submitSyntaxLink;
  document.getElementById('scb-syntax-link-close').onclick=function(){ closeModal('scb-syntax-link-modal'); };
  document.getElementById('scb-meeting-start-btn').onclick=startNewMeeting;
  document.getElementById('scb-meeting-join-btn').onclick=joinMeetingFromLobby;
  document.getElementById('scb-meeting-link-btn').onclick=()=>createCallLink();
  document.getElementById('scb-meeting-copy-btn').onclick=()=>{ if(meetingState) shareCallLink(meetingState.id); };
  document.getElementById('scb-meeting-lobby-close').onclick=function(){ closeModal('scb-meeting-lobby'); };
  document.getElementById('scb-meeting-leave-btn').onclick=leaveMeeting;
  document.getElementById('scb-meeting-min-btn').onclick=minimizeMeetingRoom;
  document.getElementById('scb-meeting-chat-send').onclick=sendMeetingChat;
  document.getElementById('scb-meeting-chat-input').onkeydown=meetingChatKeydown;
  document.getElementById('scb-meet-mic-btn').onclick=toggleMeetingMic;
  document.getElementById('scb-meet-cam-btn').onclick=toggleMeetingCam;
  document.getElementById('scb-meet-screen-btn').onclick=toggleMeetingScreenShare;
}

/* =============================================================================
   GOOGLE SIGN-IN + CONNECTED ACCOUNTS
   -----------------------------------------------------------------------------
   Two related things, sharing one Google Identity Services (GIS) setup:

     1. "Sign in with Google" on the login/sign-up screen. Signs into the
        SoCloudyBro account whose record carries this Google account's `sub`, or,
        if no account claims it yet, walks the person through the normal sign-up
        form with their Google name/email prefilled.
     2. Settings → Connected Accounts, where an account created the ordinary way
        (number/email + password) can attach a Google account and/or a Syntax
        Account after the fact, and detach either again.

   ---------------------------------------------------------------------------
   HOW MUCH THE GOOGLE ID TOKEN IS ACTUALLY WORTH HERE — READ THIS
   ---------------------------------------------------------------------------
   A Google ID token is a JWT signed by Google. Proving it is genuine means
   fetching Google's public keys and verifying that signature — and doing that
   somewhere the user cannot tamper with, i.e. not in this page, because any
   check this page runs is run by code the user could have replaced.

   There are therefore TWO states here, and which one you are in depends
   entirely on whether GOOGLE_VERIFY_ENDPOINT (in the OWNER-CONFIGURABLE
   PLACEHOLDERS block) is filled in:

   1. GOOGLE_VERIFY_ENDPOINT IS SET — tokens are really verified.
      verifyGoogleCredential() POSTs the raw credential to the Cloudflare Worker
      in google-verify-proxy/worker.js, which checks the RS256 signature against
      Google's JWKS plus the issuer/audience/expiry claims, and answers with the
      verified identity or a rejection. Everything downstream (the account match
      on `googleSub`, the sign-up prefill, the Settings link) uses the claims the
      WORKER returned, never the page's own decode. A token the Worker rejects is
      refused outright — it is never quietly accepted, since accepting it would
      defeat the whole point of the check.
      (Note this verifies *who the Google account is*. It is not a session
      server: the rest of this app's rules — requireAdmin() and friends — are
      still client-side against an openly-readable Firebase database, exactly as
      before. Google sign-in is now a verified identity, not a new security tier
      for the whole app.)

   2. GOOGLE_VERIFY_ENDPOINT IS EMPTY — fallback, and honestly labelled.
      With no Worker to ask, the only thing left is decodeGoogleIdToken() below,
      which just base64-decodes the token's payload and reads its claims. Its
      `aud`/`iss`/`exp` checks catch a token meant for a different app, or an
      expired/garbled one — they are sanity checks, NOT a security boundary.
      Someone editing this page's JavaScript in their own browser could feed a
      hand-made "token" to the callback and be treated as that Google account.
      The UI says so in this state (a note on the sign-in screen and in Settings
      → Connected Accounts), and that note disappears only once the endpoint is
      actually configured and verification is genuinely happening.

   The GIS library itself performs the real OAuth flow correctly against Google,
   in the browser, over TLS, in both states: a normal user pressing the button
   does get a genuine token for a genuine Google account. State 1 is what lets us
   *prove* that to ourselves; state 2 is the honest admission that we cannot.
   ========================================================================== */

// Set while a Google sign-in found no linked account and the sign-up form is
// being used to create one. submitSetup() reads it to stamp `googleSub` onto the
// new account record.
let _pendingGoogleSignup=null;
let _googleInitDone=false;      // google.accounts.id.initialize() called once
let _googleGsiTimedOut=false;   // the GIS script never showed up

