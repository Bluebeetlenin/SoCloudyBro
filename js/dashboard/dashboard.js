// -- BUSINESS ACCOUNTS ---------------------------------------------------------
function _bizData(){ return me.bizProfile || {}; }
function _saveBiz(patch){
  me.bizProfile = Object.assign(_bizData(), patch);
  saveStorage();
  registerOrUpdate().catch(()=>{});
}

function toggleBizMode(){
  const on = !!(me.bizProfile && me.bizProfile.enabled);
  _saveBiz({enabled: !on});
  _renderBizSettings();
  showToast(on ? 'Business mode off' : 'Business mode on', on ? 'Your profile is now personal' : 'Your profile now shows as a business');
}

function _renderBizSettings(){
  const biz = _bizData();
  const on = !!biz.enabled;
  const btn = document.getElementById('biz-mode-btn');
  const badge = document.getElementById('biz-mode-badge');
  const sub = document.getElementById('biz-mode-sub');
  const exp = document.getElementById('biz-settings-expanded');
  const botBtn = document.getElementById('biz-bot-toggle-btn');
  if(btn) btn.textContent = on ? 'Disable' : 'Enable';
  if(btn) btn.className = on ? 'btn btn-danger btn-sm' : 'btn btn-sm';
  if(badge) badge.style.display = on ? '' : 'none';
  if(sub) sub.textContent = on ? ('Business profile active — '+( biz.name || 'name not set')) : 'Turn your profile into a business page with product/website showcase';
  if(exp) exp.style.display = on ? '' : 'none';
  const pc = (biz.products || []).length;
  const prodSub = document.getElementById('biz-products-sub');
  if(prodSub) prodSub.textContent = pc ? pc+' item'+(pc===1?'':'s')+' on your profile' : 'No products added yet';
  const botSub = document.getElementById('biz-bot-sub');
  const botOn = !!(biz.botEnabled && (biz.botRules||[]).length);
  if(botSub) botSub.textContent = botOn ? ((biz.botRules||[]).length+' rule'+(biz.botRules.length===1?'':'s')+' active') : 'Automatically reply to DMs with keyword-based answers';
  if(botBtn) botBtn.textContent = botOn ? 'On' : 'Off';
}

function openBizProfileEditor(){
  const biz = _bizData();
  document.getElementById('biz-name-input').value = biz.name || '';
  document.getElementById('biz-category-input').value = biz.category || '';
  document.getElementById('biz-desc-input').value = biz.desc || '';
  document.getElementById('biz-website-input').value = biz.website || '';
  openModal('biz-profile-modal');
}
function saveBizProfile(){
  _saveBiz({
    name: document.getElementById('biz-name-input').value.trim(),
    category: document.getElementById('biz-category-input').value.trim(),
    desc: document.getElementById('biz-desc-input').value.trim(),
    website: document.getElementById('biz-website-input').value.trim()
  });
  closeModal('biz-profile-modal');
  _renderBizSettings();
  showToast('Business profile saved','');
}

let _bizNewProdImgData = null;
function bizProductImgSelected(input){
  const file = input.files && input.files[0];
  input.value = '';
  if(!file) return;
  const label = document.getElementById('biz-new-prod-img-name');
  if(label) label.textContent = file.name;
  const reader = new FileReader();
  reader.onload = e => { _bizNewProdImgData = e.target.result; };
  reader.readAsDataURL(file);
}
function openBizProductsEditor(){
  _bizNewProdImgData = null;
  _renderBizProductsList();
  openModal('biz-products-modal');
}
function _renderBizProductsList(){
  const products = _bizData().products || [];
  const list = document.getElementById('biz-products-list');
  if(!list) return;
  if(!products.length){ list.innerHTML='<div style="color:var(--muted);font-size:12px;padding:4px 0">No items yet</div>'; return; }
  list.innerHTML = products.map((p,i)=>`<div class="biz-bot-rule"><div style="flex:1;min-width:0"><div class="biz-product-name">${esc(p.name||'Untitled')}</div><div class="biz-product-desc">${esc(p.desc||'')}</div></div><button class="btn btn-ghost btn-sm" data-i="${i}" onclick="removeBizProduct(Number(this.dataset.i))">Remove</button></div>`).join('');
}
function addBizProduct(){
  const name = document.getElementById('biz-new-prod-name').value.trim();
  if(!name){ showToast('Name required',''); return; }
  const prod = { id: Date.now().toString(36), name, desc: document.getElementById('biz-new-prod-desc').value.trim(), url: document.getElementById('biz-new-prod-url').value.trim(), img: _bizNewProdImgData||'' };
  const prods = (_bizData().products || []).slice();
  prods.push(prod);
  _saveBiz({products: prods});
  document.getElementById('biz-new-prod-name').value='';
  document.getElementById('biz-new-prod-desc').value='';
  document.getElementById('biz-new-prod-url').value='';
  document.getElementById('biz-new-prod-img-name').textContent='None';
  _bizNewProdImgData = null;
  _renderBizProductsList();
}
function removeBizProduct(idx){
  const prods = (_bizData().products || []).slice();
  prods.splice(idx,1);
  _saveBiz({products: prods});
  _renderBizProductsList();
}
function saveBizProducts(){
  closeModal('biz-products-modal');
  _renderBizSettings();
  showToast('Products saved','');
}

function openBizBotEditor(){
  _renderBizBotRules();
  const biz = _bizData();
  document.getElementById('biz-bot-welcome-input').value = biz.botWelcome || '';
  openModal('biz-bot-modal');
}
function _renderBizBotRules(){
  const rules = _bizData().botRules || [];
  const list = document.getElementById('biz-bot-rules-list');
  if(!list) return;
  if(!rules.length){ list.innerHTML='<div style="color:var(--muted);font-size:12px;padding:4px 0">No rules yet — add one below</div>'; return; }
  list.innerHTML = rules.map((r,i)=>`<div class="biz-bot-rule"><span class="biz-bot-kw">${esc(r.keyword||'')}</span><span class="biz-bot-reply">${esc(r.reply||'')}</span><button class="btn btn-ghost btn-sm" data-i="${i}" data-act="removeBizBotRule">×</button></div>`).join('');
}
function addBizBotRule(){
  const kw = document.getElementById('biz-bot-kw-input').value.trim();
  const reply = document.getElementById('biz-bot-reply-input').value.trim();
  if(!kw || !reply){ showToast('Fill in keyword and reply',''); return; }
  const rules = (_bizData().botRules || []).slice();
  rules.push({keyword: kw.toLowerCase(), reply});
  _saveBiz({botRules: rules});
  document.getElementById('biz-bot-kw-input').value='';
  document.getElementById('biz-bot-reply-input').value='';
  _renderBizBotRules();
}
function removeBizBotRule(idx){
  const rules = (_bizData().botRules || []).slice();
  rules.splice(idx,1);
  _saveBiz({botRules: rules});
  _renderBizBotRules();
}
function saveBizBot(){
  const welcome = document.getElementById('biz-bot-welcome-input').value.trim();
  const rules = _bizData().botRules || [];
  _saveBiz({botEnabled: rules.length > 0, botWelcome: welcome});
  closeModal('biz-bot-modal');
  _renderBizSettings();
  showToast(rules.length ? 'Bot enabled' : 'No rules — bot is off', '');
}

// Auto-reply bot — called ONLY from the poll loop, never from renderMessages
let _botRepliedIds = new Set();
let _botBusy = false;
async function maybeRunBizBot(conv){
  if(_botBusy) return;
  if(!me || !me.bizProfile || !me.bizProfile.enabled || !me.bizProfile.botEnabled) return;
  if(!conv || conv.type==='group') return;
  const rules = me.bizProfile.botRules || [];
  const msgs = conv.messages || [];
  // Only fire when the last message is from the other person
  const last = msgs[msgs.length-1];
  if(!last || last.from === me.number) return;
  if(_botRepliedIds.has(last.id)) return;
  // Try keyword match
  const rawText = last.text ? (typeof dec==='function' ? dec(last.text) : last.text) : '';
  const text = rawText.toLowerCase();
  let reply = null;
  for(const r of rules){
    if(text.includes(r.keyword.toLowerCase())){ reply=r.reply; break; }
  }
  // Welcome message: no prior message from me in this convo
  if(!reply){
    const welcome = me.bizProfile.botWelcome;
    if(welcome && !_botRepliedIds.has('welcome_'+conv.key)){
      const hasMine = msgs.some(m=>m.from===me.number);
      if(!hasMine) reply = welcome, _botRepliedIds.add('welcome_'+conv.key);
    }
  }
  if(!reply) return;
  _botRepliedIds.add(last.id);
  _botBusy = true;
  setTimeout(async ()=>{
    try{
      const botMsg = { id: Date.now().toString(36)+Math.random().toString(36).slice(2,5), from: me.number, time: Date.now(), seen: [], text: enc(reply) };
      conv.messages.push(botMsg);
      if(conv.messages.length>100) conv.messages.splice(0, conv.messages.length-100);
      await saveConvos().catch(()=>{});
      renderSidebar();
    }finally{ _botBusy = false; }
  }, 900 + Math.random()*500);
}

// View another user's business profile
function openBizViewModal(user){
  if(!user) return;
  const biz = user.bizProfile || {};
  const av = document.getElementById('biz-view-avatar');
  if(av) renderAvatar(av, {name: dec(user.name)||'?', avatar: user.avatar||''}, 52);
  const nameEl = document.getElementById('biz-view-name');
  if(nameEl) nameEl.textContent = biz.name || dec(user.name) || '';
  const catEl = document.getElementById('biz-view-category');
  if(catEl) catEl.textContent = biz.category || '';
  const descEl = document.getElementById('biz-view-desc');
  if(descEl) descEl.textContent = biz.desc || '';
  const webEl = document.getElementById('biz-view-website');
  if(webEl){ const safeWeb=(biz.website&&/^https?:\/\//i.test(biz.website.trim()))?biz.website.trim():''; webEl.style.display=safeWeb?'':'none'; webEl.href=safeWeb||'#'; webEl.textContent=safeWeb||''; }
  const products = biz.products || [];
  const sec = document.getElementById('biz-view-products-section');
  const grid = document.getElementById('biz-view-product-grid');
  if(sec) sec.style.display = products.length ? '' : 'none';
  if(grid){
    grid.innerHTML='';
    products.forEach(p=>{
      const card=document.createElement('div');
      card.className='biz-product-card';
      // Validate URL before using in click handler — only allow http/https to prevent javascript: injection
      const safeUrl=(p.url&&/^https?:\/\//i.test(p.url.trim()))?p.url.trim():'';
      if(safeUrl) card.onclick=()=>window.open(safeUrl,'_blank','noopener,noreferrer');
      const imgDiv=document.createElement('div');
      imgDiv.className='biz-product-img';
      if(p.img){
        const imgEl=document.createElement('img');
        imgEl.src=p.img;
        imgEl.style.cssText='width:100%;height:100%;object-fit:cover';
        imgEl.alt='';
        imgDiv.appendChild(imgEl);
      }else{
        imgDiv.textContent='📦';
      }
      const infoDiv=document.createElement('div');
      infoDiv.className='biz-product-info';
      const nameDiv=document.createElement('div');
      nameDiv.className='biz-product-name';
      nameDiv.textContent=p.name||'';
      const descDiv=document.createElement('div');
      descDiv.className='biz-product-desc';
      descDiv.textContent=p.desc||'';
      infoDiv.appendChild(nameDiv);
      infoDiv.appendChild(descDiv);
      card.appendChild(imgDiv);
      card.appendChild(infoDiv);
      grid.appendChild(card);
    });
  }
  _bizViewUser = user;
  openModal('biz-view-modal');
}
let _bizViewUser = null;
function startDmFromBizView(){
  closeModal('biz-view-modal');
  if(!_bizViewUser) return;
  const c={number:_bizViewUser.number, name:dec(_bizViewUser.name)||('#'+_bizViewUser.number), key:'dm_'+[me.number,_bizViewUser.number].sort().join('_')};
  openChat(c);
}

// -- ACCOUNT DELETE ------------------------------------------------------------
async function confirmDeleteAccount(){
  if(!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
  try{
    const users=await getUsers();
    const filtered=users.filter(u=>u.number!==me.number);
    await saveUsers(filtered);
  }catch{}
  localStorage.clear();
  location.reload();
}

// -- SETTINGS / UPDATES --------------------------------------------------------
function showSettings(){hideAll();document.getElementById('settings-panel').classList.add('visible');updateSettingsPanel();updateSettingsBgSelection();_initPrivacyToggles();renderSecurityScore();renderSecurityPasskeysList();renderTrustedDevicesList();renderBackupPinStatus();try{const t=localStorage.getItem('cc_settings_tab')||'profile';switchSettingsTab(t);}catch(e){}}
function switchSettingsTab(tab){
  const all=document.querySelectorAll('[data-settings-tab]');
  all.forEach(s=>{s.style.display=s.getAttribute('data-settings-tab')===tab?'':'none';});
  document.querySelectorAll('.stab').forEach(b=>b.classList.toggle('active',b.getAttribute('data-tab')===tab));
  try{localStorage.setItem('cc_settings_tab',tab);}catch(e){}
  // Render saved accounts when profile tab is shown
  if(tab==='profile') try{renderSavedAccounts();}catch(e){}
  // Re-apply feature-specific section visibility AFTER the bulk show/hide
  // so sections like scb-accessibility-section that are conditionally hidden
  // don't get re-shown by the loop above.
  try{updateFeatureSettingsUI();}catch(e){}
}
// Multi-account: save current account to cc_accounts
function _saveAccountToAccounts(meObj){
  if(!meObj||!meObj.number) return;
  try{
    const acc=JSON.parse(localStorage.getItem('cc_accounts')||'{}');
    acc[meObj.number]={number:meObj.number,name:meObj.name||'User',avatar:meObj.avatar||'',bio:meObj.bio||'',savedAt:Date.now()};
    localStorage.setItem('cc_accounts',JSON.stringify(acc));
  }catch(e){}
}
function renderSavedAccounts(){
  const list=document.getElementById('scb-accounts-list');
  if(!list) return;
  let acc={};
  try{acc=JSON.parse(localStorage.getItem('cc_accounts')||'{}');}catch(e){}
  const others=Object.values(acc).filter(a=>!me||a.number!==me.number);
  if(!others.length){list.innerHTML='<div style="font-size:12px;color:var(--muted)">No other accounts saved.</div>';return;}
  list.innerHTML=others.map(a=>{
    const initials=(a.name||'U').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const av=a.avatar?`<img src="${a.avatar}" alt="">`:initials;
    return `<div class="saved-acct-item">
      <div class="saved-acct-av">${av}</div>
      <div class="saved-acct-info"><div class="saved-acct-name">${esc(a.name||'User')}</div><div class="saved-acct-num">#${a.number}</div></div>
      <button class="btn btn-ghost btn-sm" data-number="${a.number}" onclick="switchAccount(this.dataset.number)">Switch</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-number="${a.number}" onclick="forgetAccount(this.dataset.number)">✕</button>
    </div>`;
  }).join('');
}
function switchAccount(number){
  if(!confirm('Switch to account #'+number+'? You\'ll be logged out of the current account.')) return;
  try{
    // Save current account first
    if(me) _saveAccountToAccounts(me);
    // Set switch flag and log out
    localStorage.setItem('cc_switch_to',number);
  }catch(e){}
  logOut();
}
function forgetAccount(number){
  try{
    const acc=JSON.parse(localStorage.getItem('cc_accounts')||'{}');
    delete acc[number];
    localStorage.setItem('cc_accounts',JSON.stringify(acc));
    renderSavedAccounts();
    showToast('Account removed','Account #'+number+' removed from saved accounts.');
  }catch(e){}
}
function addAnotherAccount(){
  if(me) _saveAccountToAccounts(me);
  localStorage.setItem('cc_after_login_switch','1');
  logOut();
}
function hideSettings(){hideAll();showMainEmpty();}
function showUpdates(){hideAll();document.getElementById('updates-panel').classList.add('visible');loadUpdates();}
function hideUpdates(){hideAll();showMainEmpty();}
// -- HOME DASHBOARD (grid-based, drag-and-drop + resize, customizable in Settings) --
const DASH_COLS=4;
const DASH_ROW_PX=150;
// Grouped by purpose, highest-value first, so the bin-packer in
// defaultLayout() naturally clusters related widgets instead of scattering
// them (it walks these keys in order and fills the grid greedily). This is
// also the order the "add widget" tray lists them in.
const DASHBOARD_WIDGETS={
  // message activity — most people check this first, every time
  unread:{icon:'',label:'Unread Messages',defaultW:1,defaultH:2,hero:true},
  recent:{icon:'',label:'Recent Activity',defaultW:2,defaultH:2},
  pinned:{icon:'',label:'Pinned Messages',defaultW:1,defaultH:2},
  // people
  online:{icon:'',label:'Contacts',defaultW:1,defaultH:2},
  groups:{icon:'',label:'Groups',defaultW:1,defaultH:2},
  // calls & voice
  voice:{icon:'🔊',label:'Voice Channels',defaultW:2,defaultH:1},
  missedcalls:{icon:'',label:'Missed Calls',defaultW:1,defaultH:2},
  cloudyvoice:{icon:'',label:'Cloudy Assistant',defaultW:2,defaultH:1},
  // decorative/utility — last, not hero-styled
  clock:{icon:'',label:'Clock & Weather',defaultW:1,defaultH:2}
};
function cellsOverlap(a,b){ return a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y; }
function findFreeSpot(layout,w,h){
  const occ=layout.filter(x=>x.enabled);
  for(let y=0;y<50;y++){
    for(let x=0;x<=DASH_COLS-w;x++){
      const cand={x,y,w,h};
      if(!occ.some(o=>cellsOverlap(cand,o))) return {x,y};
    }
  }
  return {x:0,y:50};
}
function defaultLayout(){
  const layout=[];
  Object.keys(DASHBOARD_WIDGETS).forEach(id=>{
    const def=DASHBOARD_WIDGETS[id];
    const spot=findFreeSpot(layout,def.defaultW,def.defaultH);
    layout.push({id,enabled:true,x:spot.x,y:spot.y,w:def.defaultW,h:def.defaultH});
  });
  return layout;
}
function sanitizeWidgetEntry(w,def){
  const clampW=Math.max(1,Math.min(DASH_COLS,Number.isFinite(w.w)?Math.round(w.w):def.defaultW));
  const clampH=Math.max(1,Math.min(3,Number.isFinite(w.h)?Math.round(w.h):def.defaultH));
  const clampX=Math.max(0,Math.min(DASH_COLS-clampW,Number.isFinite(w.x)?Math.round(w.x):0));
  const clampY=Math.max(0,Number.isFinite(w.y)?Math.round(w.y):0);
  return {id:w.id,enabled:w.enabled!==false,x:clampX,y:clampY,w:clampW,h:clampH};
}
function getDashboardLayout(){
  try{
    const saved=JSON.parse(localStorage.getItem('cc_dashboard_layout_v2')||'null');
    if(Array.isArray(saved)&&saved.length){
      if(!localStorage.getItem('cc_dashboard_size_migrated_v1')){
        // One-time upgrade: widgets used to default to a cramped 1x1. Re-lay-out
        // whatever was enabled at the new, bigger default sizes instead of
        // leaving existing saves stuck small forever.
        const enabledIds=new Set(saved.filter(w=>w&&w.enabled!==false).map(w=>w.id));
        const fresh=[];
        Object.keys(DASHBOARD_WIDGETS).forEach(id=>{
          const def=DASHBOARD_WIDGETS[id];
          if(enabledIds.has(id)){
            const spot=findFreeSpot(fresh,def.defaultW,def.defaultH);
            fresh.push({id,enabled:true,x:spot.x,y:spot.y,w:def.defaultW,h:def.defaultH});
          }else{
            fresh.push({id,enabled:false,x:0,y:0,w:def.defaultW,h:def.defaultH});
          }
        });
        localStorage.setItem('cc_dashboard_size_migrated_v1','1');
        saveDashboardLayout(fresh);
        return fresh;
      }
      // Sanitize every entry — guards against NaN/undefined/out-of-range values
      // (e.g. from an interrupted drag) silently making a widget disappear.
      const clean=saved.filter(w=>w&&w.id&&DASHBOARD_WIDGETS[w.id]).map(w=>sanitizeWidgetEntry(w,DASHBOARD_WIDGETS[w.id]));
      // Clamping each entry independently (above) can still leave two
      // widgets genuinely overlapping — e.g. a layout saved on a wider
      // screen's column count, then clamped down for a narrower one, can
      // clamp two different widgets' x into the same slot. Resolve that
      // here: keep each widget in its saved spot unless it collides with
      // one already placed, in which case bump it to the next free spot
      // instead of silently rendering stacked/overlapping cards.
      const resolved=[];
      for(const w of clean){
        const collides=resolved.some(r=>r.enabled&&w.enabled&&cellsOverlap(w,r));
        if(collides){ const spot=findFreeSpot(resolved,w.w,w.h); resolved.push({...w,x:spot.x,y:spot.y}); }
        else resolved.push(w);
      }
      Object.keys(DASHBOARD_WIDGETS).forEach(id=>{
        if(!resolved.find(w=>w.id===id)){
          const def=DASHBOARD_WIDGETS[id];
          const spot=findFreeSpot(resolved,def.defaultW,def.defaultH);
          resolved.push({id,enabled:true,x:spot.x,y:spot.y,w:def.defaultW,h:def.defaultH});
        }
      });
      return resolved;
    }
  }catch(e){}
  localStorage.setItem('cc_dashboard_size_migrated_v1','1');
  return defaultLayout();
}
function saveDashboardLayout(layout){ localStorage.setItem('cc_dashboard_layout_v2',JSON.stringify(layout)); }
function showMainEmpty(){
  document.getElementById('main-empty').style.display='flex';
  // .visible is purely a marker for the phone CSS's :has(#main-empty.visible)
  // selectors (see that rule's comment) — display is still controlled by the
  // inline style above, same as always, on every device.
  document.getElementById('main-empty').classList.add('visible');
  if(me) renderDashboard();
}
// On phones, returns from the home dashboard back to the sidebar — same
// role as closeChatToSidebar(), driven by the same #main-empty.visible
// class the phone CSS's :has() selectors key off of.
function closeHomeToSidebar(){
  document.getElementById('main-empty').classList.remove('visible');
  document.getElementById('main-empty').style.display='none';
}
// Safety net: if the dashboard is on screen, re-render it whenever the tab
// regains focus/visibility. This guarantees it reflects whatever's actually
// saved rather than only refreshing after a trip through the editor.
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&me){
    const el=document.getElementById('main-empty');
    if(el&&el.style.display!=='none') renderDashboard();
  }
});
window.addEventListener('focus',()=>{
  if(me){
    const el=document.getElementById('main-empty');
    if(el&&el.style.display!=='none') renderDashboard();
  }
});
function renderWelcomeBanner(){
  // Greeting
  const hour=new Date().getHours();
  const greet=hour<5?'Up late':hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
  const firstName=me?(dec(me.name)||(''+me.number)).split(/[\s_]/)[0]:'';
  const greetEl=document.getElementById('welcome-greeting');
  if(greetEl) greetEl.textContent=greet+(firstName?' '+firstName:'')+' ☁️';

  // Unread chip
  let unread=0;
  if(convosCache) contacts.forEach(c=>{
    const conv=convosCache.find(x=>x&&x.key===c.key);
    if(!conv||!conv.messages) return;
    unread+=conv.messages.filter(m=>m.type!=='system'&&m.from!==me.number&&(!m.seen||!m.seen.includes(me.number))&&!_isLocallySeen(m.id)).length;
  });
  const uchip=document.getElementById('wchip-unread');
  if(uchip) uchip.textContent=unread>0?'✉️ '+unread+' unread':'✉️ All caught up';

  // Online chip
  const online=contacts.filter(c=>c.type!=='group'&&isOnline((lookupUser(c.number)||{}).lastSeen)).length;
  const ochip=document.getElementById('wchip-online');
  if(ochip) ochip.textContent='● '+(online||'No')+' online';
}
function renderDashboard(){
  renderWelcomeBanner();
  const grid=document.getElementById('dashboard-grid');
  if(!grid||!me) return;
  const layout=getDashboardLayout().filter(w=>w.enabled&&DASHBOARD_WIDGETS[w.id]).sort((a,b)=>(a.y-b.y)||(a.x-b.x));
  grid.innerHTML='';
  layout.forEach(w=>{
    const def=DASHBOARD_WIDGETS[w.id];
    const card=document.createElement('div'); card.className='dash-widget'+(def.hero?' hero':'');
    card.style.gridColumn=(w.x+1)+' / span '+w.w;
    card.style.gridRow=(w.y+1)+' / span '+w.h;
    card.innerHTML='<div class="dash-widget-title">'+def.icon+' '+def.label+'</div><div class="dash-widget-body" id="dash-body-'+w.id+'"><div class="dash-widget-empty">Loading…</div></div>';
    grid.appendChild(card);
    renderDashboardWidget(w.id);
  });
  if(!layout.length){ grid.innerHTML='<div class="dash-widget-empty" style="grid-column:1/-1;text-align:center">No widgets — open Settings → Customize UI to add some.</div>'; }
}
function renderDashboardWidget(id){
  const body=document.getElementById('dash-body-'+id);
  if(!body) return;
  if(id==='pinned') return renderPinnedWidget(body);
  if(id==='online') return renderOnlineWidget(body);
  if(id==='voice') return renderVoiceWidget(body);
  if(id==='recent') return renderRecentWidget(body);
  if(id==='clock') return renderClockWeatherWidget(body);
  if(id==='groups') return renderGroupsWidget(body);
  if(id==='unread') return renderUnreadWidget(body);
  if(id==='missedcalls') return renderMissedCallsWidget(body);
  if(id==='cloudyvoice') return renderCloudyVoiceWidget(body);
}
function _dashArt(paths,label){
  return '<div class="dash-empty-art"><svg width="64" height="48" viewBox="0 0 64 48" fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">'+paths+'</svg><span>'+label+'</span></div>';
}
const _DART={
  pinned:_dashArt('<path d="M32 8 L36 24 L44 24 L44 28 L35 28 L35 42 L29 42 L29 28 L20 28 L20 24 L28 24 Z" stroke-width="1.8"/><circle cx="32" cy="7" r="3" stroke-width="1.8"/><line x1="26" y1="16" x2="38" y2="16" stroke-width="1.5"/>','Nothing pinned yet'),
  online_empty:_dashArt('<circle cx="26" cy="18" r="7" stroke-width="1.8"/><path d="M12 40 Q12 30 26 30 Q40 30 40 40" stroke-width="1.8"/><circle cx="44" cy="18" r="5" stroke-width="1.6"/><path d="M38 35 Q40 30 48 30 Q56 32 56 38" stroke-width="1.6"/>','No contacts yet'),
  voice_empty:_dashArt('<path d="M22 8 L22 24 Q22 30 28 30 Q34 30 34 24 L34 8 Q34 2 28 2 Q22 2 22 8 Z" stroke-width="1.8"/><path d="M16 22 Q16 36 28 36 Q40 36 40 22" stroke-width="1.8"/><line x1="28" y1="36" x2="28" y2="44" stroke-width="1.8"/><line x1="20" y1="44" x2="36" y2="44" stroke-width="1.8"/>','No voice channels'),
  recent_empty:_dashArt('<rect x="8" y="10" width="32" height="24" rx="4" stroke-width="1.8"/><line x1="14" y1="18" x2="34" y2="18" stroke-width="1.8"/><line x1="14" y1="24" x2="28" y2="24" stroke-width="1.8"/><path d="M40 18 L50 10 L54 22 Q48 26 40 26 Z" stroke-width="1.8"/><circle cx="47" cy="40" r="5" stroke-width="1.8"/><line x1="47" y1="30" x2="47" y2="35" stroke-width="1.8"/>','No recent activity'),
  groups_empty:_dashArt('<circle cx="20" cy="16" r="6" stroke-width="1.8"/><path d="M8 38 Q8 27 20 27 Q32 27 32 38" stroke-width="1.8"/><circle cx="42" cy="18" r="5" stroke-width="1.6"/><path d="M34 36 Q36 28 44 28 Q52 30 52 38" stroke-width="1.6"/><line x1="30" y1="10" x2="38" y2="6" stroke-width="1.5" stroke-dasharray="2 2"/>','No groups yet'),
  unread_ok:_dashArt('<rect x="10" y="14" width="44" height="28" rx="4" stroke-width="1.8"/><path d="M10 18 L32 30 L54 18" stroke-width="1.8"/><path d="M44 8 L50 14 M50 8 L44 14" stroke-width="2"/><circle cx="52" cy="6" r="6" stroke-width="1.8"/><path d="M49 6 L51 8 L55 4" stroke-width="1.8"/>','All caught up ✓'),
  missed_empty:_dashArt('<path d="M18 12 Q18 8 22 8 L28 10 L30 16 Q26 18 25 22 Q30 30 38 34 Q41 33 45 30 L51 32 Q52 36 50 38 Q46 42 40 40 Q22 36 14 18 Q12 12 18 12 Z" stroke-width="1.8"/><line x1="46" y1="8" x2="54" y2="4" stroke-width="1.8"/><line x1="50" y1="14" x2="58" y2="12" stroke-width="1.8"/>','No missed calls'),
  clock_empty:_dashArt('<circle cx="32" cy="24" r="18" stroke-width="1.8"/><line x1="32" y1="24" x2="32" y2="14" stroke-width="2"/><line x1="32" y1="24" x2="40" y2="30" stroke-width="2"/><circle cx="32" cy="24" r="2" fill="white" stroke="none"/>','Clock')
};
function renderPinnedWidget(body){
  if(!convosCache){ body.innerHTML=_DART.pinned; return; }
  const items=[];
  convosCache.forEach(c=>{
    const map=c.pinnedByChannel||(c.pinned?{general:c.pinned}:{});
    Object.entries(map).forEach(([chId,msgId])=>{
      if(!msgId) return;
      const msg=(c.messages||[]).find(m=>m.id===msgId);
      if(!msg) return;
      const contact=contacts.find(x=>x&&x.key===c.key);
      if(!contact) return;
      const u=msg.from===me.number?me:(lookupUser(msg.from)||{});
      const preview=msgHasGif(msg)?'GIF':msgHasPoll(msg)?'Poll':msgText(msg);
      items.push({contact,chId,time:msg.time,text:(dec(u.name)||('#'+msg.from))+': '+preview});
    });
  });
  items.sort((a,b)=>b.time-a.time);
  if(!items.length){ body.innerHTML=_DART.pinned; return; }
  body.innerHTML=items.slice(0,5).map(it=>'<div class="dash-list-item" data-key="'+esc(it.contact.key)+'" data-ch-id="'+esc(it.chId)+'" data-act="dashOpenChat"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(it.contact.name)+' — '+esc(it.text.substring(0,40))+'</span></div>').join('');
}
function renderOnlineWidget(body){
  const dms=contacts.filter(c=>c.type!=='group');
  const withStatus=dms.map(c=>({c,online:isOnline((lookupUser(c.number)||{}).lastSeen)}));
  withStatus.sort((a,b)=>(b.online-a.online));
  if(!withStatus.length){ body.innerHTML=_DART.online_empty; return; }
  body.innerHTML=withStatus.slice(0,8).map(x=>{
    const _name=dec(x.c.name)||('#'+x.c.number);const _init=_name.charAt(0).toUpperCase();
    const av=x.c.avatar&&x.c.avatar!=='__cloudy__'?'<div class="dash-avatar"><img src="'+esc(x.c.avatar)+'" loading="lazy" data-init-fallback="'+esc(_init)+'"/></div>':'<div class="dash-avatar" style="background:var(--accent)">'+_init+'</div>';
    const pill=x.online?'<span class="dash-online-pill">● online</span>':'';
    return '<div class="dash-list-item" data-key="'+esc(x.c.key)+'" onclick="dashOpenChat(this.dataset.key)">'+av+'<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">'+esc(x.c.name)+verifiedBadge(x.c.number)+equippedBadgeHtml(x.c.number)+'</span>'+pill+'</div>';
  }).join('');
}
async function renderVoiceWidget(body){
  const groups=contacts.filter(c=>c.type==='group');
  if(!convosCache) await getConvos();
  const rows=[];
  groups.forEach(g=>{
    const conv=convosCache.find(x=>x&&x.key===g.key);
    if(!conv) return;
    (conv.channels||[]).filter(ch=>ch.type==='voice').forEach(ch=>{
      rows.push({group:g,ch});
    });
  });
  if(!rows.length){ body.innerHTML=_DART.voice_empty; return; }
  body.innerHTML=rows.slice(0,6).map(r=>'<div class="dash-list-item" data-key="'+esc(r.group.key)+'" data-ch-id="'+esc(r.ch.id)+'" data-act="dashJoinVoice">🔊 '+esc(r.group.name)+' — '+esc(r.ch.name)+' <span class="dash-widget-empty" id="dash-vc-count-'+r.ch.id+'" style="margin-left:auto"></span></div>').join('');
  rows.forEach(r=>{
    fbdb.ref(voicePath(r.group.key,r.ch.id)+'/participants').get().then(snap=>{
      const n=Object.keys(snap.val()||{}).length;
      const el=document.getElementById('dash-vc-count-'+r.ch.id);
      if(el&&n) el.textContent=n+' in call';
    }).catch(()=>{});
  });
}
function renderRecentWidget(body){
  if(!convosCache){ body.innerHTML=_DART.recent_empty; return; }
  const items=[];
  contacts.forEach(c=>{
    const conv=convosCache.find(x=>x&&x.key===c.key);
    if(!conv||!conv.messages||!conv.messages.length) return;
    const last=conv.messages[conv.messages.length-1];
    const u=last.from===me.number?me:(lookupUser(last.from)||{});
    const preview=msgHasGif(last)?'GIF':msgHasPoll(last)?'Poll':msgFileData(last)?'Attachment':msgText(last);
    items.push({c,time:last.time,text:(dec(u.name)||('#'+last.from))+': '+preview});
  });
  items.sort((a,b)=>b.time-a.time);
  if(!items.length){ body.innerHTML=_DART.recent_empty; return; }
  body.innerHTML=items.slice(0,6).map(it=>{
    const _name=dec(it.c.name)||('#'+it.c.number);const _init=_name.charAt(0).toUpperCase();
    const av=it.c.avatar&&it.c.avatar!=='__cloudy__'?'<div class="dash-avatar"><img src="'+esc(it.c.avatar)+'" loading="lazy" data-init-fallback="'+esc(_init)+'"/></div>':'<div class="dash-avatar">'+_init+'</div>';
    return '<div class="dash-list-item" data-key="'+esc(it.c.key)+'" onclick="dashOpenChat(this.dataset.key)">'+av+'<div style="flex:1;overflow:hidden"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(it.c.name)+'</div><div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(it.text.substring(0,40))+'</div></div></div>';
  }).join('');
}
function renderGroupsWidget(body){
  const groups=contacts.filter(c=>c.type==='group'&&!c.isServer);
  if(!groups.length){ body.innerHTML=_DART.groups_empty; return; }
  body.innerHTML=groups.slice(0,8).map(g=>{
    const conv=convosCache?convosCache.find(x=>x&&x.key===g.key):null;
    const memberCount=conv?(conv.participants||conv.members||[]).length:0;
    return '<div class="dash-list-item" data-key="'+esc(g.key)+'" onclick="dashOpenChat(this.dataset.key)"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(g.name)+'</span><span class="dash-widget-empty" style="margin-left:auto">'+memberCount+'</span></div>';
  }).join('');
}
function renderUnreadWidget(body){
  if(!convosCache){ body.innerHTML=_DART.unread_ok; return; }
  const items=[];
  contacts.forEach(c=>{
    const conv=convosCache.find(x=>x&&x.key===c.key);
    if(!conv||!conv.messages) return;
    const unread=conv.messages.filter(m=>m.type!=='system'&&m.from!==me.number&&(!m.seen||!m.seen.includes(me.number))&&!_isLocallySeen(m.id)).length;
    if(unread>0) items.push({c,unread});
  });
  items.sort((a,b)=>b.unread-a.unread);
  if(!items.length){ body.innerHTML=_DART.unread_ok; return; }
  body.innerHTML=items.slice(0,8).map(it=>{
    const conv=convosCache&&convosCache.find(x=>x&&x.key===it.c.key);
    const last=conv&&conv.messages&&conv.messages.length?conv.messages[conv.messages.length-1]:null;
    const preview=last?(msgHasGif(last)?'GIF':msgHasPoll(last)?'Poll':msgFileData(last)?'Attachment':msgText(last).substring(0,28)):'';
    return '<div class="dash-list-item" data-key="'+esc(it.c.key)+'" onclick="dashOpenChat(this.dataset.key)" style="flex-direction:column;align-items:flex-start;gap:2px"><div style="display:flex;width:100%;align-items:center;gap:6px"><span style="font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(it.c.name)+'</span><span class="dash-unread-badge">'+it.unread+'</span></div>'+(preview?'<span style="font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;padding-left:0">'+esc(preview)+'</span>':'')+'</div>';
  }).join('');
}
function logCallHistory(entry){
  try{
    const log=JSON.parse(localStorage.getItem('cc_call_log')||'[]');
    log.push(entry);
    localStorage.setItem('cc_call_log',JSON.stringify(log.slice(-100)));
  }catch(e){}
}
function getCallLog(){
  try{ return JSON.parse(localStorage.getItem('cc_call_log')||'[]'); }catch(e){ return []; }
}
function fmtCallDuration(secs){
  if(!secs||secs<1) return '';
  const m=Math.floor(secs/60), s=secs%60;
  return m>0 ? m+':'+(s<10?'0':'')+s : s+'s';
}
function injectCallEventMsg(convKey, callType, durationSecs, missed, initiatorNum){
  if(!me||!convKey||!convosCache) return;
  const conv=convosCache.find(x=>x&&x.key===convKey);
  if(!conv) return;
  if(!Array.isArray(conv.messages)) conv.messages=[];
  const msgId='call_'+convKey+'_'+Date.now();
  const msg={id:msgId,type:'call',callType:callType||'voice',duration:durationSecs||0,missed:!!missed,from:me.number,initiator:initiatorNum||me.number,time:Date.now()};
  conv.messages.push(msg);
  saveConvos().catch(()=>{});
  if(activeConvo&&activeConvo.key===convKey) renderMessages(conv.messages);
}
function logMissedCall(fromNum,fromName){
  try{
    const log=JSON.parse(localStorage.getItem('cc_missed_calls')||'[]');
    log.push({from:fromNum,fromName,time:Date.now()});
    localStorage.setItem('cc_missed_calls',JSON.stringify(log.slice(-30)));
  }catch(e){}
  logCallHistory({dir:'missed',number:fromNum,name:fromName,time:Date.now(),duration:0,initiator:fromNum});
  if(me){
    const convKey=dmKey(me.number,fromNum);
    injectCallEventMsg(convKey,'voice',0,true,fromNum);
  }
}
function renderMissedCallsWidget(body){
  let log=[];
  try{ log=JSON.parse(localStorage.getItem('cc_missed_calls')||'[]'); }catch(e){}
  if(!log.length){ body.innerHTML=_DART.missed_empty; return; }
  body.innerHTML=log.slice(-6).reverse().map(l=>'<div class="dash-list-item" data-number="'+l.from+'" data-act="dashOpenChatByNumber"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(l.fromName||('#'+l.from))+'</span><span class="dash-widget-empty" style="margin-left:auto">'+new Date(l.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'</span></div>').join('');
}
function dashOpenChatByNumber(num){
  const c=contacts.find(x=>x.type!=='group'&&x.number===num);
  if(c) dashOpenChat(c.key);
}
// Real audio waveform: genuine mic amplitude while Cloudy is listening (via a
// separate AnalyserNode — Web Speech API doesn't expose raw audio, so this
// needs its own getUserMedia grant, a second permission prompt on top of the
// one for speech recognition). While Cloudy is *speaking*, browsers don't
// expose the built-in text-to-speech engine's audio for analysis at all, so
// that state is an animated synthetic wave, not real amplitude — flagging
// that honestly rather than pretending it's live.
let _cloudyAudioCtx=null,_cloudyAnalyser=null,_cloudyMicStream=null,_cloudyVizLoopActive=false;
async function startCloudyVizMic(){
  if(_cloudyAnalyser) return;
  try{
    _cloudyMicStream=await navigator.mediaDevices.getUserMedia({audio:true});
    _cloudyAudioCtx=new (window.AudioContext||window.webkitAudioContext)();
    const source=_cloudyAudioCtx.createMediaStreamSource(_cloudyMicStream);
    _cloudyAnalyser=_cloudyAudioCtx.createAnalyser();
    _cloudyAnalyser.fftSize=256;
    source.connect(_cloudyAnalyser);
  }catch(e){ /* mic denied — waveform falls back to the synthetic animation */ }
}
function stopCloudyVizMic(){
  if(_cloudyMicStream){ _cloudyMicStream.getTracks().forEach(t=>t.stop()); _cloudyMicStream=null; }
  if(_cloudyAudioCtx){ try{ _cloudyAudioCtx.close(); }catch(e){} _cloudyAudioCtx=null; }
  _cloudyAnalyser=null;
}
function renderCloudyVoiceWidget(body){
  body.innerHTML='<canvas id="cloudy-wave-canvas" width="240" height="52" style="width:100%;height:52px;display:block"></canvas><div style="text-align:center;font-size:11px;color:var(--muted);margin-top:4px" id="cloudy-voice-state">Idle</div>';
  updateCloudyVizState();
  startCloudyVizLoop();
}
function startCloudyVizLoop(){
  if(_cloudyVizLoopActive) return;
  _cloudyVizLoopActive=true;
  const draw=()=>{
    const canvas=document.getElementById('cloudy-wave-canvas');
    if(!canvas){ _cloudyVizLoopActive=false; return; } // widget left the screen — stop the loop
    const ctx=canvas.getContext('2d');
    const w=canvas.width,h=canvas.height;
    ctx.clearRect(0,0,w,h);
    const accent=(getComputedStyle(document.documentElement).getPropertyValue('--accent')||'').trim()||'#6b5de8';
    const state=(typeof cloudyListening!=='undefined'&&cloudyListening)?'listening':(typeof cloudySpeaking!=='undefined'&&cloudySpeaking)?'speaking':'idle';
    let freqData=null;
    if(state==='listening'&&_cloudyAnalyser){
      freqData=new Uint8Array(_cloudyAnalyser.fftSize);
      _cloudyAnalyser.getByteTimeDomainData(freqData);
    }
    ctx.lineWidth=2.2;
    ctx.strokeStyle=accent;
    ctx.beginPath();
    const N=64;
    const t=Date.now();
    for(let i=0;i<N;i++){
      const x=(i/(N-1))*w;
      let v;
      if(freqData){
        const idx=Math.floor((i/N)*freqData.length);
        v=(freqData[idx]-128)/128; // real mic amplitude, -1..1
      }else if(state==='speaking'){
        v=Math.sin(i*0.5+t/110)*0.55*Math.sin(t/280+i*0.15); // lively synthetic wave
      }else{
        v=Math.sin(i*0.35+t/900)*0.1; // gentle idle breathing
      }
      const y=h/2+v*(h/2-6);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
function updateCloudyVizState(){
  const label=document.getElementById('cloudy-voice-state');
  if(!label) return;
  const state=(typeof cloudyListening!=='undefined'&&cloudyListening)?'listening':(typeof cloudySpeaking!=='undefined'&&cloudySpeaking)?'speaking':'idle';
  label.textContent=state==='listening'?'Listening…':state==='speaking'?'Speaking…':'Idle';
}
// -- Clock & Weather (Open-Meteo — free, no API key) ---------------------------
const WEATHER_CODE_ICONS={0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌦️',61:'🌧️',63:'🌧️',65:'🌧️',71:'🌨️',73:'🌨️',75:'🌨️',80:'🌦️',81:'🌧️',82:'⛈️',95:'⛈️',96:'⛈️',99:'⛈️'};
let _clockTimer=null,_weatherCache=null;
async function _autoDetectWeatherLocation(){
  // One-shot: if ipapi.co already failed once this session, don't retry.
  if(localStorage.getItem('cc_weather_autodetect_tried')) return null;
  try{
    localStorage.setItem('cc_weather_autodetect_tried','1');
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),5000);
    let res; try{ res=await fetch('https://ipapi.co/json/',{signal:ctrl.signal}); }finally{ clearTimeout(t); }
    if(!res||!res.ok) return null;
    const d=await res.json();
    if(!d||!Number.isFinite(d.latitude)||!Number.isFinite(d.longitude)) return null;
    const loc={name:(d.city?d.city+', ':'')+(d.country_name||d.country_code||''),lat:d.latitude,lon:d.longitude};
    localStorage.setItem('cc_weather_location',JSON.stringify(loc));
    return loc;
  }catch{ return null; }
}
// The saved location is widget *data*, not just layout, and it goes straight
// into a URL and (via loc.name) into the DOM — so validate its shape here
// rather than trusting whatever is in localStorage. A partially-written or
// hand-edited value used to produce "latitude=undefined" requests, or a
// non-string name for esc() to choke on.
function getWeatherLocation(){
  try{
    const v=JSON.parse(localStorage.getItem('cc_weather_location')||'null');
    if(!v||typeof v!=='object') return null;
    const lat=Number(v.lat), lon=Number(v.lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)) return null;
    if(lat<-90||lat>90||lon<-180||lon>180) return null;
    return {name:typeof v.name==='string'?v.name:'', lat, lon};
  }catch(e){ return null; }
}
async function saveWeatherLocation(){
  const input=document.getElementById('weather-location-input').value.trim();
  const err=document.getElementById('weather-location-error');
  if(err) err.textContent='';
  if(!input){ if(err) err.textContent=scbErr('SCB-SET-02','Enter a country or city.'); return; }
  try{
    const r=await fetch('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(input)+'&count=1');
    const d=await r.json();
    if(!d.results||!d.results.length){ if(err) err.textContent=scbErr('SCB-SET-03','Location not found.'); return; }
    const res=d.results[0];
    const loc={name:res.name+(res.country?', '+res.country:''),lat:res.latitude,lon:res.longitude};
    localStorage.setItem('cc_weather_location',JSON.stringify(loc));
    _weatherCache=null;
    showToast('Location saved',loc.name);
    renderDashboardWidget('clock');
  }catch(e){ if(err) err.textContent=scbErr('SCB-SET-04','That location couldn\'t be looked up — the weather service request failed.',e.message); }
}
async function renderClockWeatherWidget(body){
  if(!body) return;
  let loc=getWeatherLocation();
  // Silently auto-detect on first render if the user hasn't set a location yet.
  if(!loc) loc=await _autoDetectWeatherLocation();
  body.innerHTML='<div id="dash-clock-time" style="font-size:38px;font-weight:600;letter-spacing:-.5px">--:--</div><div id="dash-clock-date" style="font-size:12px;opacity:.85;margin-bottom:8px"></div><div id="dash-clock-weather" style="font-size:14px;font-weight:500;opacity:.95">'+(loc?'Loading weather…':'Set your country in Settings → Customize UI')+'</div>';
  if(_clockTimer){ clearInterval(_clockTimer); _clockTimer=null; }
  let utcOffsetSec=null;
  if(loc){
    try{
      // Cache key was latitude only, so two saved locations on the same
      // parallel (e.g. Tokyo and Los Angeles) served each other's weather.
      if(!_weatherCache||_weatherCache.lat!==loc.lat||_weatherCache.lon!==loc.lon||Date.now()-_weatherCache.fetchedAt>15*60*1000){
        const r=await fetch('https://api.open-meteo.com/v1/forecast?latitude='+loc.lat+'&longitude='+loc.lon+'&current_weather=true&timezone=auto');
        const d=await r.json();
        // Don't cache an error/empty payload for 15 minutes — that turned one
        // failed request into a quarter-hour of "Weather unavailable".
        if(!d||!d.current_weather) throw new Error('no weather data');
        _weatherCache={lat:loc.lat,lon:loc.lon,data:d,fetchedAt:Date.now()};
      }
      const d=_weatherCache.data;
      utcOffsetSec=d.utc_offset_seconds;
      const cw=d.current_weather;
      const wEl=document.getElementById('dash-clock-weather');
      if(wEl) wEl.innerHTML=Math.round(cw.temperature)+'°C — '+esc(loc.name);
    }catch(e){
      const wEl=document.getElementById('dash-clock-weather');
      if(wEl) wEl.textContent='Weather unavailable';
    }
  }
  const tick=()=>{
    const tEl=document.getElementById('dash-clock-time'); const dEl=document.getElementById('dash-clock-date');
    if(!tEl) return;
    if(utcOffsetSec!=null){
      const target=new Date(Date.now()+utcOffsetSec*1000);
      tEl.textContent=String(target.getUTCHours()).padStart(2,'0')+':'+String(target.getUTCMinutes()).padStart(2,'0');
      if(dEl) dEl.textContent=target.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'});
    }else{
      const now=new Date();
      tEl.textContent=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      if(dEl) dEl.textContent=now.toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'});
    }
  };
  tick();
  _clockTimer=setInterval(tick,10000);
}
function dashOpenChat(key,channelId){
  const c=contacts.find(x=>x&&x.key===key);
  if(!c) return;
  openChat(c).then(()=>{ if(channelId&&c.type==='group') switchChannel(channelId); });
}
function dashJoinVoice(groupKey,channelId){
  const c=contacts.find(x=>x&&x.key===groupKey);
  if(!c) return;
  openChat(c).then(()=>joinVoiceChannel(channelId));
}

// -- CUSTOMIZE UI: drag-and-drop + resize widget editor (pointer events, works on touch) --
let _editorCellW=160;
function computeEditorGeometry(){
  const grid=document.getElementById('editor-grid');
  if(!grid) return;
  _editorCellW=(grid.clientWidth-(DASH_COLS-1)*10)/DASH_COLS;
}
function openCustomizeUI(){
  openModal('customize-ui-modal');
  requestAnimationFrame(()=>{ computeEditorGeometry(); renderEditorGrid(); renderWidgetTray(); });
}
function closeCustomizeUI(){
  closeModal('customize-ui-modal');
  renderDashboard();
}
function renderEditorGrid(){
  computeEditorGeometry();
  const grid=document.getElementById('editor-grid');
  if(!grid) return;
  const layout=getDashboardLayout();
  grid.innerHTML='';
  layout.filter(w=>w.enabled).forEach(w=>{
    const def=DASHBOARD_WIDGETS[w.id]; if(!def) return;
    const tile=document.createElement('div'); tile.className='editor-tile'; tile.dataset.wid=w.id;
    tile.style.gridColumn=(w.x+1)+' / span '+w.w;
    tile.style.gridRow=(w.y+1)+' / span '+w.h;
    tile.innerHTML='<div class="editor-tile-head"><span>'+def.icon+' '+def.label+'</span><span class="editor-tile-remove" title="Remove">✕</span></div><div class="editor-resize-handle" title="Drag to resize">↘</div>';
    tile.querySelector('.editor-tile-remove').addEventListener('click',(e)=>{ e.stopPropagation(); removeWidgetFromLayout(w.id); });
    tile.querySelector('.editor-resize-handle').addEventListener('pointerdown',(e)=>editorResizeDown(e,w.id));
    tile.addEventListener('pointerdown',(e)=>{ if(e.target.closest('.editor-resize-handle')||e.target.closest('.editor-tile-remove')) return; editorTileDown(e,w.id); });
    grid.appendChild(tile);
  });
}
function renderWidgetTray(){
  const tray=document.getElementById('widget-tray');
  if(!tray) return;
  const layout=getDashboardLayout();
  const available=Object.keys(DASHBOARD_WIDGETS).filter(id=>{ const w=layout.find(x=>x.id===id); return !w||!w.enabled; });
  if(!available.length){ tray.innerHTML='<div class="dash-widget-empty">All widgets are placed — remove one to add something else.</div>'; return; }
  tray.innerHTML=available.map(id=>{
    const def=DASHBOARD_WIDGETS[id];
    return '<div class="tray-item" data-id="'+esc(id)+'" onclick="addWidgetToLayout(this.dataset.id)">'+def.icon+' '+def.label+' <span style="opacity:.6">+ Add</span></div>';
  }).join('');
}
function addWidgetToLayout(id){
  const layout=getDashboardLayout();
  const def=DASHBOARD_WIDGETS[id];
  let w=layout.find(x=>x.id===id);
  const spot=findFreeSpot(layout,def.defaultW,def.defaultH);
  if(w){ w.enabled=true; w.x=spot.x; w.y=spot.y; w.w=def.defaultW; w.h=def.defaultH; }
  else{ layout.push({id,enabled:true,x:spot.x,y:spot.y,w:def.defaultW,h:def.defaultH}); }
  saveDashboardLayout(layout);
  renderEditorGrid(); renderWidgetTray();
}
function removeWidgetFromLayout(id){
  const layout=getDashboardLayout();
  const w=layout.find(x=>x.id===id);
  if(w) w.enabled=false;
  saveDashboardLayout(layout);
  renderEditorGrid(); renderWidgetTray();
}
let _dragState=null;
function editorTileDown(e,id){
  e.preventDefault();
  const layout=getDashboardLayout();
  const w=layout.find(x=>x.id===id);
  if(!w) return;
  const tile=e.currentTarget;
  _dragState={id,mode:'move',startX:e.clientX,startY:e.clientY,orig:{...w},layout,tile};
  tile.classList.add('dragging-tile');
  try{ tile.setPointerCapture(e.pointerId); }catch(err){}
  document.addEventListener('pointermove',editorPointerMove);
  document.addEventListener('pointerup',editorPointerUp);
}
function editorResizeDown(e,id){
  e.preventDefault(); e.stopPropagation();
  const layout=getDashboardLayout();
  const w=layout.find(x=>x.id===id);
  if(!w) return;
  const tile=document.querySelector('.editor-tile[data-wid="'+id+'"]');
  _dragState={id,mode:'resize',startX:e.clientX,startY:e.clientY,orig:{...w},layout,tile};
  try{ e.currentTarget.setPointerCapture(e.pointerId); }catch(err){}
  document.addEventListener('pointermove',editorPointerMove);
  document.addEventListener('pointerup',editorPointerUp);
}
function editorPointerMove(e){
  if(!_dragState) return;
  const {mode,orig,tile}=_dragState;
  const gap=10;
  const dx=e.clientX-_dragState.startX, dy=e.clientY-_dragState.startY;
  if(mode==='move'){
    const cellDx=Math.round(dx/(_editorCellW+gap));
    const cellDy=Math.round(dy/(DASH_ROW_PX+gap));
    const nx=Math.max(0,Math.min(DASH_COLS-orig.w,orig.x+cellDx));
    const ny=Math.max(0,orig.y+cellDy);
    tile.style.gridColumn=(nx+1)+' / span '+orig.w;
    tile.style.gridRow=(ny+1)+' / span '+orig.h;
    tile.dataset.pendingX=nx; tile.dataset.pendingY=ny;
  }else{
    const cellDw=Math.round(dx/(_editorCellW+gap));
    const cellDh=Math.round(dy/(DASH_ROW_PX+gap));
    const nw=Math.max(1,Math.min(DASH_COLS-orig.x,orig.w+cellDw));
    const nh=Math.max(1,Math.min(3,orig.h+cellDh));
    tile.style.gridColumn=(orig.x+1)+' / span '+nw;
    tile.style.gridRow=(orig.y+1)+' / span '+nh;
    tile.dataset.pendingW=nw; tile.dataset.pendingH=nh;
  }
}
function editorPointerUp(){
  if(!_dragState) return;
  const {id,mode,orig,layout,tile}=_dragState;
  const w=layout.find(x=>x.id===id);
  // Defensive: the drop handler assumed the dragged widget was still in the
  // layout array. Object.assign(undefined, ...) would throw out of a pointerup
  // listener and leave the listeners attached with the tile stuck mid-drag.
  if(!w||!tile){
    document.removeEventListener('pointermove',editorPointerMove);
    document.removeEventListener('pointerup',editorPointerUp);
    _dragState=null; renderEditorGrid(); return;
  }
  const candidate={...orig};
  if(mode==='move'){
    candidate.x=tile.dataset.pendingX!=null?Number(tile.dataset.pendingX):orig.x;
    candidate.y=tile.dataset.pendingY!=null?Number(tile.dataset.pendingY):orig.y;
  }else{
    candidate.w=tile.dataset.pendingW!=null?Number(tile.dataset.pendingW):orig.w;
    candidate.h=tile.dataset.pendingH!=null?Number(tile.dataset.pendingH):orig.h;
  }
  const others=layout.filter(x=>x.id!==id&&x.enabled);
  const collides=others.some(o=>cellsOverlap(candidate,o));
  if(!collides) Object.assign(w,candidate);
  saveDashboardLayout(layout);
  tile.classList.remove('dragging-tile');
  document.removeEventListener('pointermove',editorPointerMove);
  document.removeEventListener('pointerup',editorPointerUp);
  _dragState=null;
  renderEditorGrid();
}

// -- Accent color feature removed (use Theme Colors instead) --

function hideAll(){
  document.getElementById('main-empty').style.display='none';
  document.getElementById('main-empty').classList.remove('visible');
  document.getElementById('chat-panel').classList.remove('visible');
  document.getElementById('settings-panel').classList.remove('visible');
  document.getElementById('updates-panel').classList.remove('visible');
  document.body.classList.remove('chat-open');
}

// -- GAME UPDATES --------------------------------------------------------------
async function loadUpdates(){
  const feed=document.getElementById('updates-feed');
  feed.innerHTML='<div class="section-empty">Loading…</div>';
  try{
    const d=await getBin(UPDATES_BIN);
    updatesCache=(d.channels||[]).flatMap(ch=>(ch.posts||[]).map(p=>({...p,channel:ch.name})));
    const welcomePost=localStorage.getItem('cc_welcome_post');
    if(welcomePost){ try{ updatesCache.push(JSON.parse(welcomePost)); }catch{} }
    try{ const bdayPosts=JSON.parse(localStorage.getItem('cc_birthday_posts')||'[]'); updatesCache.push(...bdayPosts); }catch{}
    updatesCache.sort((a,b)=>b.time-a.time);
    renderUpdates();
  }catch{feed.innerHTML='<div class="section-empty">Could not load updates.</div>';}
}
function renderUpdates(){
  const feed=document.getElementById('updates-feed');feed.innerHTML='';
  const items=updatesFilter==='all'?updatesCache:(updatesCache||[]).filter(u=>u.channel===updatesFilter);
  if(!items||!items.length){feed.innerHTML='<div class="section-empty">No updates yet.</div>';return;}
  items.forEach((u,i)=>{
    const card=document.createElement('div');card.className='update-card';
    const versionHtml=u.updateNumber?`<div class="update-card-version">Update #${esc(String(u.updateNumber))}</div>`:'';
    const featuresHtml=(Array.isArray(u.features)&&u.features.length)
      ?`<ul class="update-card-features">${u.features.map(f=>`<li>${esc(f)}</li>`).join('')}</ul>` : '';
    const tryBtnHtml=(u.tryTarget&&u.tryTarget!=='none')
      ?`<button class="update-try-btn" data-i="${i}" onclick="tryFeatureUpdate(Number(this.dataset.i))">🧪 Try it out</button>` : '';
    card.innerHTML=`<div class="update-card-channel">${esc(u.channel)}</div>${versionHtml}<div class="update-card-title">${esc(u.title||'')}</div><div class="update-card-body">${esc(u.body||'')}</div>${featuresHtml}<div class="update-card-time">${new Date(u.time).toLocaleString()}</div>${tryBtnHtml}`;
    feed.appendChild(card);
  });
}
function tryFeatureUpdate(i){
  const items=updatesFilter==='all'?updatesCache:(updatesCache||[]).filter(u=>u.channel===updatesFilter);
  const post=items&&items[i];
  if(!post) return;
  if(post.tryTarget==='chat'){
    openTryItChatPicker();
  }else if(post.tryTarget==='settings'){
    hideUpdates();showSettings();
  }else{
    hideUpdates();showMainEmpty();
  }
}
function openTryItChatPicker(){
  const list=document.getElementById('tryit-chat-list');
  list.innerHTML='';
  if(!contacts||!contacts.length){
    list.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px">No contacts or groups yet \u2014 add one first.</div>';
  }else{
    contacts.forEach(c=>{
      const row=document.createElement('div');
      row.className='sb-item';
      row.style.cssText='display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--r-sm);cursor:pointer';
      const av=document.createElement('div');
      av.className=c.type==='group'?'group-avatar':'avatar';
      av.style.cssText='width:36px;height:36px;font-size:14px;background:linear-gradient(135deg,#0078d4,#6264a0);color:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:50%';
      const _tryAv=(lookupUser(c.number)||{}).avatar||c.avatar||'';
      if(_tryAv&&(String(_tryAv).startsWith('data:image/')||String(_tryAv).startsWith('https://'))) av.innerHTML='<img src="'+esc(_tryAv)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
      else av.textContent=c.type==='group'?'👥':(dec(c.name)||'?').charAt(0).toUpperCase();
      const name=document.createElement('div');
      name.style.cssText='font-size:13px;font-weight:500';
      name.textContent=dec(c.name)||'Unknown';
      row.appendChild(av);row.appendChild(name);
      row.onclick=()=>{ closeModal('tryit-chat-modal'); hideUpdates(); openChat(c); };
      list.appendChild(row);
    });
  }
  openModal('tryit-chat-modal');
}
function filterUpdates(ch,btn){
  updatesFilter=ch;
  document.querySelectorAll('.update-ch-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');renderUpdates();
}

