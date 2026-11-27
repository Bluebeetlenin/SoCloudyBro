// Button tooltips, loading spinners and colour theme presets.
// Loaded last, so every function it wraps already exists.

// -- TOOLTIPS ------------------------------------------------------------------
// Reuses each button's title text, shown faster and styled to match the app.
(function(){
  const SELECTOR='button, .icon-btn, .compose-btn, .sb-fav-star, .scb-preset';
  let tip=null, target=null, timer=null;

  function takeText(el){
    // Move title aside so the browser's own tooltip doesn't show as well. Code
    // that sets a new title later is picked up on the next hover.
    const title=el.getAttribute('title');
    if(title){
      el.dataset.tip=title;
      el.removeAttribute('title');
      if(el.dataset.tipLabel || (!el.hasAttribute('aria-label') && !/[a-z]{2}/i.test(el.textContent))){
        el.setAttribute('aria-label',title);
        el.dataset.tipLabel='1';
      }
    }
    return el.dataset.tip||'';
  }
  function hide(){
    clearTimeout(timer); target=null;
    if(tip) tip.classList.remove('show');
  }
  function show(el){
    const text=takeText(el);
    if(!text || !el.isConnected) return;
    if(!tip){
      tip=document.createElement('div');
      tip.id='scb-tip'; tip.setAttribute('aria-hidden','true');
      document.body.appendChild(tip);
    }
    tip.textContent=text;
    const r=el.getBoundingClientRect(), w=tip.offsetWidth, h=tip.offsetHeight;
    const left=Math.max(6,Math.min(r.left+r.width/2-w/2,window.innerWidth-w-6));
    const top=r.top-h-8>=6 ? r.top-h-8 : r.bottom+8;
    tip.style.left=left+'px'; tip.style.top=top+'px';
    tip.classList.add('show');
  }
  function queue(el,delay){
    hide(); target=el; takeText(el);
    timer=setTimeout(()=>show(el),delay);
  }
  document.addEventListener('pointerover',e=>{
    if(e.pointerType!=='mouse') return;
    const el=e.target.closest&&e.target.closest(SELECTOR);
    if(el===target) return;
    if(el && (el.hasAttribute('title')||el.dataset.tip)) queue(el,250); else hide();
  });
  document.addEventListener('focusin',e=>{
    const el=e.target;
    if(el.matches&&el.matches(SELECTOR)&&el.matches(':focus-visible')) queue(el,100);
  });
  document.addEventListener('focusout',hide);
  const dismiss=()=>{ clearTimeout(timer); if(tip) tip.classList.remove('show'); };
  document.addEventListener('pointerdown',dismiss,true);
  document.addEventListener('click',dismiss,true);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') hide(); },true);
  document.addEventListener('scroll',hide,true);
  document.documentElement.addEventListener('mouseleave',hide);
})();

// -- LOADING STATE -------------------------------------------------------------
// Shows a spinner on the clicked button until a slow action finishes, which
// also stops double clicks.
(function(){
  let clicked=null;
  document.addEventListener('click',e=>{
    clicked=e.target.closest&&e.target.closest('button');
    setTimeout(()=>{ clicked=null; },0);
  },true);
  ['sendEmailOtp','verifyEmailOtp','checkEmailVerifyStatus','checkParentalConsentStatus',
   'saveProfile','submitReport','submitJoinServer','loginWithPasskey'].forEach(name=>{
    const original=window[name];
    if(typeof original!=='function') return;
    window[name]=function(...args){
      const btn=clicked;
      const result=original.apply(this,args);
      if(btn && result && typeof result.finally==='function'){
        btn.classList.add('is-loading'); btn.setAttribute('aria-busy','true');
        result.finally(()=>{ btn.classList.remove('is-loading'); btn.removeAttribute('aria-busy'); }).catch(()=>{});
      }
      return result;
    };
  });
})();

// -- MORE MENU ON THE MESSAGE BAR ----------------------------------------------
(function(){
  const btn=document.getElementById('compose-more-btn');
  const menu=document.getElementById('compose-more');
  if(!btn||!menu) return;
  function setOpen(open){
    menu.hidden=!open;
    btn.setAttribute('aria-expanded',open?'true':'false');
  }
  btn.addEventListener('click',()=>{
    const open=menu.hidden;
    setOpen(open);
    if(open){
      const gif=document.getElementById('gif-picker');
      if(gif) gif.classList.remove('visible');
    }
  });
  // Close once an option has been picked, or on a click anywhere else.
  menu.addEventListener('click',e=>{ if(e.target.closest('button')) setOpen(false); });
  document.addEventListener('click',e=>{
    if(!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  },true);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && !menu.hidden){ e.stopPropagation(); setOpen(false); btn.focus(); }
  },true);
})();

// -- MARK ALL AS READ ----------------------------------------------------------
function _unreadMessages(){
  if(!me||!convosCache) return [];
  const found=[];
  contacts.forEach(c=>{
    const key=c.key||dmKey(me.number,c.number);
    if(archivedContacts[key]) return;
    const convo=convosCache.find(x=>x&&x.key===key);
    ((convo&&convo.messages)||[]).forEach(m=>{
      // View-once messages stay unread until actually opened.
      if(!m||m.from===me.number||m.type==='call'||m.type==='system'||m.selfDestruct) return;
      if((m.seen&&m.seen.includes(me.number))||_isLocallySeen(m.id)) return;
      found.push({m,key});
    });
  });
  return found;
}
function markAllRead(){
  const found=_unreadMessages();
  if(!found.length) return;
  const receipts=getPrivacyPref('readReceipts',true);
  let shared=false;
  found.forEach(({m,key})=>{
    _markLocallySeen(m.id);
    // Locked chats are cleared on this device only: nobody has read them.
    if(receipts && !lockedChats[key]){
      if(!m.seen) m.seen=[];
      m.seen.push(me.number);
      shared=true;
    }
  });
  if(shared){
    _convosDirty=true;
    Promise.resolve(saveConvos()).catch(e=>console.warn('mark all read: save failed',e));
  }
  renderSidebar();
  showToast('All caught up',found.length+(found.length===1?' message':' messages')+' marked as read.');
}
(function(){
  const render=renderSidebar;
  renderSidebar=function(){
    render.apply(this,arguments);
    const list=document.getElementById('sb-list');
    if(!list||(currentTab!=='chats'&&currentTab!=='unread'&&currentTab!=='groups'&&currentTab!=='servers')) return;
    const count=_unreadMessages().length;
    if(!count) return;
    const bar=document.createElement('div');
    bar.className='sb-readbar';
    bar.innerHTML='<span></span><button type="button">Mark all as read</button>';
    bar.firstChild.textContent=count+' unread';
    bar.lastChild.onclick=markAllRead;
    list.insertBefore(bar,list.firstChild);
  };
})();
