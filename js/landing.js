// Landing-page polish: sticky-nav, scroll-reveal, and all LP button/link bindings.
// Scoped entirely to #landing-page elements; harmless no-op once it's hidden.
(function(){
  const scroller=document.getElementById('landing-page');
  const nav=document.getElementById('lp-nav');
  if(!scroller||!nav) return;

  // Sticky nav shadow on scroll
  scroller.addEventListener('scroll',()=>{
    nav.classList.toggle('lp-nav-scrolled',scroller.scrollTop>4);
  },{passive:true});

  // Scroll-reveal sections
  const revealEls=scroller.querySelectorAll('.lp-reveal');
  if('IntersectionObserver' in window && revealEls.length){
    const io=new IntersectionObserver((entries)=>{
      entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('lp-in'); io.unobserve(e.target); } });
    },{root:scroller,threshold:0.15,rootMargin:'0px 0px -40px 0px'});
    revealEls.forEach(el=>io.observe(el));
  }else{
    revealEls.forEach(el=>el.classList.add('lp-in'));
  }

  // CTA / nav buttons — wired here so onclick= is not needed (CSP hash covers this block)
  function lpEnterApp(){
    document.getElementById('landing-page').style.display='none';
    document.getElementById('shell').style.display='';
    if(typeof openModal==='function') openModal('setup-modal');
  }
  ['lp-signin-btn','lp-getstarted-btn','lp-join-btn'].forEach(function(id){
    const el=document.getElementById(id);
    if(el) el.addEventListener('click',lpEnterApp);
  });
  const scrollBtn=document.getElementById('lp-scroll-btn');
  if(scrollBtn) scrollBtn.addEventListener('click',function(){
    if(typeof scrollToLpSection==='function') scrollToLpSection('lp-features');
  });

  // Footer links
  const footerMap={
    'lp-footer-privacy': function(){ if(typeof showPrivacyPolicy==='function') showPrivacyPolicy(); },
    'lp-footer-tos':     function(){ if(typeof showTermsOfService==='function') showTermsOfService(); },
    'lp-footer-a11y':    function(){ if(typeof openModal==='function') openModal('accessibility-modal'); },
    'lp-footer-contact': function(){ if(typeof openContactUs==='function') openContactUs(); }
  };
  Object.keys(footerMap).forEach(function(id){
    const el=document.getElementById(id);
    if(el) el.addEventListener('click',footerMap[id]);
  });
})();
