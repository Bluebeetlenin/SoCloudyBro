(function(){
  var CONSENT_KEY='scb_storage_consent';
  var banner=document.getElementById('scb-cookie-banner');
  var stored=null;
  try{ stored=localStorage.getItem(CONSENT_KEY); }catch(e){}
  if(!stored && banner){ banner.style.display='flex'; }

  window.scbAcceptCookies=function(){
    try{ localStorage.setItem(CONSENT_KEY,'accepted'); }catch(e){}
    if(banner) banner.style.display='none';
  };
  window.scbDeclineCookies=function(){
    // Decline: hide banner, clear all SCB storage, reload to a clean state.
    try{
      Object.keys(localStorage).filter(function(k){ return k.startsWith('scb'); })
        .forEach(function(k){ localStorage.removeItem(k); });
    }catch(e){}
    if(banner) banner.style.display='none';
    // Persist decline to localStorage so the banner doesn't reappear on reload.
    try{ localStorage.setItem(CONSENT_KEY,'declined'); }catch(e){}
    // Also set in sessionStorage for this tab's lifetime (belt-and-suspenders).
    try{ sessionStorage.setItem(CONSENT_KEY,'declined'); }catch(e){}
  };
})();
