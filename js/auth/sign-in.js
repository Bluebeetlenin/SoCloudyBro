/* ===== EMAIL VERIFICATION GATE =====
   A new account must confirm its email before it can do anything. There's no
   backend here capable of sending a real email to an arbitrary address (the
   only outbound-email tool, Web3Forms, is tied to the admin's own inbox), so
   verification instead means linking a Google account whose email Google
   itself reports as verified — real, honest confirmation that a real person
   with a genuine email is behind the account, using infrastructure this app
   already has (Google Identity Services + the ID-token verify Worker), no
   new backend required. Grandfathered: only accounts created from this
   feature's rollout onward are gated, so existing accounts aren't locked out
   retroactively. ===== */
const EMAIL_VERIFY_GATE_SINCE=new Date('2026-09-30T00:00:00Z').getTime();
function needsEmailVerification(u){
  // If Google sign-in isn't configured on this deployment at all, there is no
  // way to verify — gating would just lock every new signup out permanently.
  if(!googleSignInConfigured()) return false;
  return !!(u&&u.createdAt&&u.createdAt>=EMAIL_VERIFY_GATE_SINCE&&!u.emailVerified);
}
function googleSignInConfigured(){ return typeof GOOGLE_CLIENT_ID==='string' && GOOGLE_CLIENT_ID.trim().length>0; }
// True once the owner has deployed google-verify-proxy/worker.js and pasted its
// URL into GOOGLE_VERIFY_ENDPOINT — i.e. once ID tokens are genuinely verified
// server-side instead of merely decoded here. Everything that used to caveat
// "not verified" is gated on this.
function googleVerifyConfigured(){ return typeof GOOGLE_VERIFY_ENDPOINT==='string' && GOOGLE_VERIFY_ENDPOINT.trim().length>0; }
function googleGsiLoaded(){
  return !!(window.google && window.google.accounts && window.google.accounts.id);
}

/**
 * Decodes the payload of a Google ID token WITHOUT verifying its signature.
 * This is the FALLBACK path only, used when GOOGLE_VERIFY_ENDPOINT is unset —
 * see state 2 in the honesty note at the top of this section. Returns the claims
 * object, or null if the token is missing, malformed, expired, or was issued for
 * a different client/issuer. When GOOGLE_VERIFY_ENDPOINT is set, nothing calls
 * this: verifyGoogleCredential() asks the Worker instead and the Worker's
 * answer is the only thing trusted.
 */
function decodeGoogleIdToken(jwt){
  try{
    if(typeof jwt!=='string') return null;
    const parts=jwt.split('.');
    if(parts.length!==3) return null;
    // base64url -> base64, then decode as UTF-8 (names can contain non-ASCII,
    // and atob alone would mangle them into mojibake).
    let b64=parts[1].replace(/-/g,'+').replace(/_/g,'/');
    while(b64.length%4) b64+='=';
    const bytes=Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
    const claims=JSON.parse(new TextDecoder('utf-8').decode(bytes));
    if(!claims || typeof claims!=='object') return null;
    // Sanity checks only (NOT security — the signature is unverifiable here):
    // a token whose audience is another app, or whose issuer isn't Google, or
    // which has expired, is a bug or a mix-up and shouldn't be acted on.
    if(claims.aud!==GOOGLE_CLIENT_ID) return null;
    if(claims.iss!=='accounts.google.com' && claims.iss!=='https://accounts.google.com') return null;
    const exp=Number(claims.exp);
    if(Number.isFinite(exp) && Date.now()>exp*1000) return null;
    if(typeof claims.sub!=='string' || !claims.sub) return null;
    return claims;
  }catch(e){
    console.warn('Google ID token could not be decoded', e);
    return null;
  }
}

// The GIS script is loaded async/defer, so it may not be there when this runs.
// Poll briefly rather than racing it, and give up cleanly so the UI can say so
// instead of waiting forever.
function whenGoogleIdentityReady(cb){
  if(googleGsiLoaded()){ cb(true); return; }
  const deadline=Date.now()+8000;
  const tick=setInterval(()=>{
    if(googleGsiLoaded()){ clearInterval(tick); cb(true); }
    else if(Date.now()>deadline){ clearInterval(tick); _googleGsiTimedOut=true; cb(false); }
  }, 200);
}

function ensureGoogleInitialized(){
  if(_googleInitDone) return true;
  if(!googleSignInConfigured() || !googleGsiLoaded()) return false;
  try{
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID.trim(),
      callback: handleGoogleCredentialResponse,
      // No silent auto-sign-in: signing in is always something the person did on
      // purpose, which also keeps this from fighting the PIN lock screen.
      auto_select: false,
      cancel_on_tap_outside: true
    });
    _googleInitDone=true;
    return true;
  }catch(e){
    console.warn('Google Identity Services initialize() failed', e);
    return false;
  }
}

// Renders Google's own official button into a container. Google's branding terms
// require their button rather than a look-alike, and its click is also the only
// reliably-available entry point (One Tap can be suppressed by the browser).
function renderGoogleButton(containerId, opts){
  const el=document.getElementById(containerId);
  if(!el || !ensureGoogleInitialized()) return false;
  try{
    el.innerHTML='';
    window.google.accounts.id.renderButton(el, Object.assign({
      theme: (document.body.classList.contains('dark')||document.documentElement.classList.contains('dark')) ? 'filled_black' : 'outline',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      logo_alignment: 'left'
    }, opts||{}));
    return true;
  }catch(e){
    console.warn('Google button render failed for #'+containerId, e);
    return false;
  }
}

// Paints the two login-screen blocks: real Google buttons when it's configured
// and loaded, otherwise a visibly-disabled button plus a note that says exactly
// why. Never leaves a button that looks live but does nothing.
function initGoogleSignIn(){
  const views=[
    {holder:'google-btn-signup', fallback:'google-fallback-signup', note:'google-note-signup'},
    {holder:'google-btn-login',  fallback:'google-fallback-login',  note:'google-note-login'}
  ];
  function showNote(text){
    views.forEach(v=>{
      const h=document.getElementById(v.holder), f=document.getElementById(v.fallback), n=document.getElementById(v.note);
      if(h){ h.innerHTML=''; h.style.display='none'; }
      if(f){ f.style.display='block'; f.disabled=true; }
      if(n){ n.textContent=text; n.style.display='block'; }
    });
  }
  if(!googleSignInConfigured()){
    showNote('Google sign-in isn\'t set up on this site yet. Use the form above — everything works without it.');
    return;
  }
  // Check if the current origin is likely unauthorized (e.g. a Vercel preview URL not yet
  // added to the Google Cloud Console authorized origins list). A mismatch would cause
  // Google to show an "Access blocked: Authorization Error" page inside the popup — not
  // a good experience — so we detect it early and show a plain message instead.
  const _origin=location.origin;
  const _knownOrigins=['http://localhost','https://socloudybro','https://cubeleap'];
  const _originOk=_knownOrigins.some(o=>_origin.startsWith(o))||_origin.startsWith('file://');
  if(!_originOk){
    showNote('Google sign-in is disabled on this URL ('+_origin+'). To enable it, add this origin to your Google Cloud Console → Credentials → Authorized JavaScript origins, then reload. You can still sign in with your number and name above.');
    return;
  }
  whenGoogleIdentityReady(ready=>{
    if(!ready){
      showNote('Google sign-in couldn\'t load (it may be blocked on this network). Use the form above instead.');
      return;
    }
    let anyRendered=false;
    // When the verification Worker isn't deployed yet, the button still works —
    // but it runs on the client-only decode, so the note stays visible (beside a
    // live button, rather than instead of it) and says so plainly. Once
    // GOOGLE_VERIFY_ENDPOINT is configured, tokens really are verified and this
    // caveat would be stale, so it isn't shown at all.
    const unverifiedNote=googleVerifyConfigured()
      ? ''
      : 'Note: this site can\'t yet confirm a Google sign-in with Google itself, so treat it as a convenience rather than proof of identity. (Site owner: fill in GOOGLE_VERIFY_ENDPOINT.)';
    views.forEach(v=>{
      const n=document.getElementById(v.note), f=document.getElementById(v.fallback), h=document.getElementById(v.holder);
      if(h) h.style.display='flex';
      if(n){
        if(unverifiedNote){ n.textContent=unverifiedNote; n.style.display='block'; }
        else{ n.textContent=''; n.style.display='none'; }
      }
      if(f) f.style.display='none';
      if(renderGoogleButton(v.holder)) anyRendered=true;
    });
    if(!anyRendered) showNote('Google sign-in couldn\'t start on this device. Use the form above instead.');
  });
}

/**
 * Turns the raw credential GIS handed us into an identity we are willing to act
 * on. This is the single place where the trust decision lives, for BOTH the
 * login path and the Settings-linking path.
 *
 * Returns one of:
 *   {ok:true,  identity:{sub,email,name,picture,emailVerified}, verified:true}
 *       — the Worker verified the token's signature and claims. These are the
 *         Worker's claims, not the page's decode of them.
 *   {ok:true,  identity:{...}, verified:false}
 *       — GOOGLE_VERIFY_ENDPOINT is unset, so this is the old client-only
 *         decode. Usable, but provably nothing more than "the token says so".
 *   {ok:false, code, message}
 *       — refuse the sign-in. Notably this includes the Worker answering
 *         {status:'error'}: a token that fails verification must NOT be treated
 *         as a valid sign-in, and must NOT silently fall back to the unverified
 *         decode, because that would make the verification pointless.
 */
async function verifyGoogleCredential(credential){
  if(typeof credential!=='string' || !credential){
    return {ok:false, code:'unreadable', message:'That Google response couldn\'t be read. Please try again.'};
  }

  // --- Fallback: no Worker deployed yet (see state 2 in the note above) ------
  // The ONLY case where the unverified client-side decode is accepted. It is not
  // dressed up as verification anywhere: `verified:false` travels with it and
  // the UI keeps showing the "not server-verified" note.
  if(!googleVerifyConfigured()){
    const claims=decodeGoogleIdToken(credential);
    if(!claims) return {ok:false, code:'unreadable', message:'That Google response couldn\'t be read. Please try again.'};
    return {ok:true, verified:false, identity:{
      sub:claims.sub,
      email:(claims.email||'').toLowerCase(),
      name:claims.name||'',
      picture:claims.picture||'',
      emailVerified:!!claims.email_verified
    }};
  }

  // --- Real verification ----------------------------------------------------
  let res, data;
  try{
    res=await fetch(GOOGLE_VERIFY_ENDPOINT.trim(), {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({credential:credential})
    });
    data=await res.json();
  }catch(e){
    // Couldn't reach the Worker, or it didn't answer JSON. This is an outage,
    // not a verdict — but it is still NOT a pass: without an answer we have no
    // verification, so the sign-in is refused rather than downgraded.
    return {ok:false, code:'unreachable', message:'Google sign-in couldn\'t be checked right now — the verification service didn\'t answer. Please try again in a moment.', detail:(e&&e.message)||''};
  }
  if(!data || typeof data!=='object'){
    return {ok:false, code:'unreachable', message:'Google sign-in couldn\'t be checked right now — the verification service gave an unexpected answer.'};
  }
  if(data.status!=='ok'){
    return {ok:false, code:'rejected', message:'Google couldn\'t confirm that sign-in, so it wasn\'t accepted.', detail:String(data.message||'verification failed')};
  }
  if(typeof data.sub!=='string' || !data.sub){
    return {ok:false, code:'rejected', message:'Google couldn\'t confirm that sign-in, so it wasn\'t accepted.', detail:'verified response carried no subject id'};
  }
  // Verified claims — these, and only these, are what the rest of the flow uses.
  return {ok:true, verified:true, identity:{
    sub:data.sub,
    email:String(data.email||'').toLowerCase(),
    name:String(data.name||''),
    picture:String(data.picture||''),
    emailVerified:!!data.emailVerified
  }};
}

/**
 * The single GIS callback, for BOTH jobs. Which one it is doesn't need a mode
 * flag: if someone is signed in, this can only have come from Settings →
 * Connected Accounts (Settings is unreachable otherwise), and if nobody is
 * signed in it can only have come from the login screen.
 *
 * Both jobs go through verifyGoogleCredential() first, so neither of them can
 * ever see an identity that wasn't either verified by the Worker or explicitly
 * marked unverified because no Worker is configured.
 */
async function handleGoogleCredentialResponse(resp){
  // Cached for finishLogin() to mint a real auth token with — see
  // _loginGoogleCredential's own comment. Harmless to set even when
  // verification below ends up failing or this is a link-to-existing-
  // account flow rather than a login: finishLogin() only ever runs after a
  // genuine login succeeds, and _tryUpgradeToCustomAuth() independently
  // re-verifies this credential server-side regardless.
  _loginGoogleCredential = resp && resp.credential;
  // Clear any stale password from an earlier login this session — see the
  // matching comment in submitLogin(). finishLogin() checks _loginRawPwd
  // first, so a leftover password from a previous (possibly different)
  // account would otherwise silently shadow this Google credential and the
  // upgrade attempt would use the wrong proof entirely.
  _loginRawPwd = null;
  const outcome=await verifyGoogleCredential(resp && resp.credential);
  if(!outcome.ok){
    // One rejection, reported on whichever surface the person is looking at.
    const code=(outcome.code==='rejected') ? 'SCB-LINK-19'
             : (outcome.code==='unreachable') ? 'SCB-LINK-20'
             : (me ? 'SCB-LINK-01' : 'SCB-LINK-02');
    const msg=outcome.detail ? scbErr(code, outcome.message, outcome.detail) : scbErr(code, outcome.message);
    if(me) showToast('Google sign-in failed', msg);
    else{
      const err=document.getElementById('login-error');
      if(err) err.textContent=msg; else showToast('Google sign-in failed', msg);
    }
    return;
  }
  if(me){ await linkGoogleToCurrentAccount(outcome.identity); return; }
  await googleAuthenticate(outcome.identity);
}

// --- Login-screen path -----------------------------------------------------
// `identity` comes from verifyGoogleCredential(): the Worker's VERIFIED claims
// when GOOGLE_VERIFY_ENDPOINT is configured, otherwise the explicitly-unverified
// client-side decode. Either way the field names are the same, so this path
// doesn't need to care which — the trust decision was already made above.
async function googleAuthenticate(identity){
  const claims=identity;
  const err=document.getElementById('login-error');
  const setErr=(code,t,detail)=>{ const m=scbErr(code,t,detail); if(err){ err.textContent=m; } else showToast('Google sign-in', m); };
  if(err) err.textContent='';
  try{
    const users=await getUsers();
    // Matched on `sub` — Google's stable subject id — and never on email alone:
    // a Google account's email address can be changed by its owner, and two
    // different people can end up holding the same address over time.
    const user=users.find(u=>u&&u.googleSub&&u.googleSub===claims.sub);
    if(user){
      if(user.banned){ setErr('SCB-LINK-03','This account has been suspended.'); return; }
      if(user.deleted){ setErr('SCB-LINK-04','This account has been deleted.'); return; }
      // Backfill the email-verification gate: Google is telling us this login's
      // email is verified, so an account still waiting on that (created after
      // EMAIL_VERIFY_GATE_SINCE, previously logged in some other way) is
      // cleared right here, once, rather than needing a separate verify step
      // after this login completes.
      if(claims.emailVerified && !user.emailVerified){
        user.emailVerified=true;
        try{ await saveUsers(users); }catch(e){ console.warn('emailVerified backfill save failed',e); }
      }
      // Respect 2FA — Google sign-in is an alternative way in, not a bypass.
      // Route through the same TOTP / face-MFA gates as the password login path.
      const pwdToStore=user.pwd||'';
      // No password is ever entered on this path — this is the only secret
      // ensureE2EKeypair() has available to restore/sync this account's E2E
      // keypair on a device that signs in with Google only (see
      // _loginGoogleSub's definition for why that copy exists at all).
      _loginGoogleSub=claims.sub;
      if(user.totpEnabled && user.totpSecret && !(await isThisDeviceTrusted(user))){
        pending2fa={user, pwdToStore};
        document.getElementById('login-2fa-code').value='';
        document.getElementById('login-2fa-error').textContent='';
        showAuthView('login-2fa-view');
        return;
      } else if(user.faceMfaEnabled && user.faceDescriptor){
        pending2fa={user, pwdToStore};
        showAuthView('login-face-view');
        await startFaceLoginView();
        return;
      }
      await finishLogin(user, pwdToStore);
      showToast('Signed in with Google','Welcome back, '+(dec(user.name)||('#'+user.number))+'.');
      return;
    }
    // Nobody claims this Google account yet — create one, through the ordinary
    // sign-up form so all of its rules (unique number, age tiering, parental
    // consent) apply unchanged.
    // These three are what submitSetup() stamps onto the new account record, so
    // they are taken from the identity verifyGoogleCredential() returned — i.e.
    // the Worker's verified claims whenever verification is configured, never a
    // second client-side decode of the token.
    _pendingGoogleSignup={sub:claims.sub, email:(claims.email||'').toLowerCase(), name:claims.name||'', emailVerified:!!claims.emailVerified};
    switchAuthTab('signup');
    const banner=document.getElementById('google-signup-banner');
    const bannerSub=document.getElementById('google-signup-banner-sub');
    if(bannerSub) bannerSub.textContent='No SoCloudyBro account is linked to '
      +(_pendingGoogleSignup.email||'that Google account')
      +' yet. Finish the short form below to create one — pick your permanent number, and set a password so you can also sign in with your number if you ever lose access to Google.';
    if(banner) banner.style.display='block';
    const nameEl=document.getElementById('setup-name');
    const emailEl=document.getElementById('setup-email');
    if(nameEl && !nameEl.value.trim()) nameEl.value=(_pendingGoogleSignup.name||'').slice(0,24);
    if(emailEl && !emailEl.value.trim()) emailEl.value=_pendingGoogleSignup.email;
    const numEl=document.getElementById('setup-number');
    if(numEl) setTimeout(()=>{ try{ numEl.focus(); }catch(e){} }, 50);
  }catch(e){
    setErr('SCB-LINK-05','Google sign-in couldn\'t be completed — verifying that Google account failed.',(e.message||'Google sign-in failed.'));
  }
}
// Called by the "Use a different method" button on the sign-up banner.
function cancelGoogleSignup(){
  _pendingGoogleSignup=null;
  const banner=document.getElementById('google-signup-banner');
  if(banner) banner.style.display='none';
  try{ if(googleGsiLoaded()) window.google.accounts.id.disableAutoSelect(); }catch(e){}
}

/* =============================================================================
   CONNECTED ACCOUNTS — Settings rows, linking and unlinking
   ========================================================================== */

// A device that was already signed in when these fields arrived (or that reloads
// the page rather than logging in fresh) never runs finishLogin(), so `me` can
// be missing them even though the server record has them. registerOrUpdate()
// falls back to the server value so nothing is lost either way, but the Settings
// rows would show "Not connected" until the next real login — so top `me` up
// from the authoritative record once per launch.
function hydrateConnectedAccountsFromRecord(){
  if(!me) return;
  const u=(usersCache||[]).find(x=>x&&x.number===me.number);
  if(!u) return;
  let changed=false;
  if(!me.googleSub && u.googleSub){ me.googleSub=u.googleSub; changed=true; }
  if(!me.googleEmail && u.googleEmail){ me.googleEmail=u.googleEmail; changed=true; }
  if(!me.linkedSyntaxAccount && u.linkedSyntaxAccount){ me.linkedSyntaxAccount=u.linkedSyntaxAccount; changed=true; }
  if(!me.linkedSyntaxAccountName && u.linkedSyntaxAccountName){ me.linkedSyntaxAccountName=u.linkedSyntaxAccountName; changed=true; }
  if(changed) try{ saveStorage(); }catch(e){}
}

function renderConnectedAccounts(){
  const gSub=document.getElementById('scb-google-link-sub');
  const gGsi=document.getElementById('scb-google-gsi-btn');
  const gFallback=document.getElementById('scb-google-connect-fallback');
  const gDisc=document.getElementById('scb-google-disconnect-btn');
  const sSub=document.getElementById('scb-syntax-link-sub');
  const sConn=document.getElementById('scb-syntax-connect-btn');
  const sDisc=document.getElementById('scb-syntax-disconnect-btn');
  const noteRow=document.getElementById('scb-connected-note-row');
  const note=document.getElementById('scb-connected-note');
  if(!gSub||!sSub) return;
  const notes=[];

  // ---- Google row ----
  // The honesty caveat is tied to GOOGLE_VERIFY_ENDPOINT, not to Google sign-in
  // being switched on: with the verification Worker deployed, sign-ins are
  // genuinely checked with Google and saying otherwise would be inaccurate, so
  // this note appears only while that endpoint is unset.
  if(googleSignInConfigured() && !googleVerifyConfigured()){
    notes.push('Heads up: Google sign-ins on this site aren\'t confirmed with Google server-side yet, so a connected Google account is a convenience rather than proof of identity. (Site owner: fill in GOOGLE_VERIFY_ENDPOINT.)');
  }
  if(me && me.googleSub){
    gSub.textContent='Connected'+(me.googleEmail?(' — '+me.googleEmail):'')+'. You can sign in with this Google account.'
      +(googleVerifyConfigured()?' Sign-ins with it are verified with Google.':'');
    if(gGsi){ gGsi.innerHTML=''; gGsi.style.display='none'; }
    if(gFallback) gFallback.style.display='none';
    if(gDisc) gDisc.style.display='inline-flex';
  }else{
    gSub.textContent='Not connected. Connect one to sign in with Google instead of typing your password.';
    if(gDisc) gDisc.style.display='none';
    if(!googleSignInConfigured()){
      if(gGsi){ gGsi.innerHTML=''; gGsi.style.display='none'; }
      if(gFallback){ gFallback.style.display='inline-flex'; gFallback.disabled=true; }
      notes.push('Google sign-in isn\'t set up on this site yet, so there\'s nothing to connect to. (Site owner: fill in GOOGLE_CLIENT_ID.)');
    }else if(!googleGsiLoaded()){
      if(gGsi){ gGsi.innerHTML=''; gGsi.style.display='none'; }
      if(gFallback){ gFallback.style.display='inline-flex'; gFallback.disabled=true; }
      notes.push(_googleGsiTimedOut
        ? 'Google\'s sign-in script couldn\'t load (it may be blocked on this network), so connecting a Google account isn\'t possible right now.'
        : 'Google\'s sign-in script is still loading — reopen Settings in a moment.');
      // If it is merely still loading, repaint once it arrives.
      if(!_googleGsiTimedOut) whenGoogleIdentityReady(()=>{ try{ renderConnectedAccounts(); }catch(e){} });
    }else{
      if(gFallback) gFallback.style.display='none';
      if(gGsi){
        gGsi.style.display='block';
        // A small button, sized for a settings row rather than a login form.
        if(!renderGoogleButton('scb-google-gsi-btn',{size:'medium', text:'signin_with', shape:'rectangular'})){
          gGsi.style.display='none';
          if(gFallback){ gFallback.style.display='inline-flex'; gFallback.disabled=true; }
          notes.push('Google\'s button couldn\'t be shown on this device.');
        }
      }
    }
  }

  // ---- Syntax Account row ----
  const syntaxSdk=(typeof window.SyntaxAccount!=='undefined') ? window.SyntaxAccount : null;
  if(me && me.linkedSyntaxAccount){
    sSub.textContent='Connected — Syntax Account #'+me.linkedSyntaxAccount
      +(me.linkedSyntaxAccountName?(' ('+me.linkedSyntaxAccountName+')'):'')
      +'. Contacts can see what you\'re playing in Cube Leap, Jumpa! and Ultimo Chess.';
    if(sConn) sConn.style.display='none';
    if(sDisc) sDisc.style.display='inline-flex';
  }else{
    sSub.textContent='Not connected. Link the account you use in Cube Leap, Jumpa! and Ultimo Chess to show a “Playing…” badge to your contacts.';
    if(sDisc) sDisc.style.display='none';
    if(sConn){
      sConn.style.display='inline-flex';
      sConn.disabled=!syntaxSdk;
    }
    if(!syntaxSdk) notes.push('The Syntax Account SDK (syntax-account.js) didn\'t load, so linking isn\'t possible right now.');
  }

  if(note && noteRow){
    note.textContent=notes.join(' ');
    noteRow.style.display=notes.length?'flex':'none';
  }
}

// --- Google: link to the account that's signed in right now ----------------
// `identity` comes from verifyGoogleCredential() — the Worker's VERIFIED claims
// when GOOGLE_VERIFY_ENDPOINT is configured, otherwise the explicitly-unverified
// client-side decode. `googleSub`/`googleEmail` below are written from it, so a
// verified link stores verified values.
async function linkGoogleToCurrentAccount(identity){
  const claims=identity;
  if(!me) return;
  try{
    const users=await getUsers();
    const clash=users.find(u=>u&&u.googleSub&&u.googleSub===claims.sub&&u.number!==me.number);
    if(clash){
      showToast('Already linked',scbErr('SCB-LINK-06','That Google account is connected to SoCloudyBro #'+clash.number+'. Disconnect it there first.'));
      return;
    }
    const mine=users.find(u=>u&&u.number===me.number);
    if(mine && mine.googleSub && mine.googleSub!==claims.sub){
      showToast('Already connected',scbErr('SCB-LINK-07','This account already has a different Google account connected. Disconnect that one first.'));
      return;
    }
    me.googleSub=claims.sub;
    me.googleEmail=(claims.email||'').toLowerCase();
    const resolvedVerification=!me.emailVerified&&!!claims.emailVerified;
    if(claims.emailVerified) me.emailVerified=true;
    try{ saveStorage(); }catch(e){}
    // Backfill the Google-slot E2E key copy right away — this session already
    // holds the real keypair (from the password login that got us here), but
    // the opportunistic sync in ensureE2EKeypair() only runs once per session
    // and already fired before this link existed, so without this explicit
    // call a device that later signs in with only this Google account would
    // have nothing to restore and would silently mint a fresh, non-matching
    // keypair (the exact bug this whole mechanism exists to prevent).
    _loginGoogleSub=claims.sub;
    try{
      const privStored=localStorage.getItem('cc_e2e_priv_'+me.number);
      if(privStored) await _syncE2EKeyToCloudGoogle(claims.sub,me.number,JSON.parse(privStored));
    }catch(e){}
    // Saved through registerOrUpdate() rather than a direct write, so it goes
    // through the one save path every other per-account field uses and shows up
    // on this account's other devices — same as saveThemeColors() does.
    await registerOrUpdate();
    renderConnectedAccounts(); // self-guards if the Settings panel isn't in the DOM yet
    showToast('Google account connected', (me.googleEmail||'Your Google account')+' can now be used to sign in.');
    // `launched` is already true by the time the email-verify gate can be
    // showing (launch() sets it before checking needsEmailVerification()), so
    // simply calling launch() again would hit its own re-entrancy guard and
    // do nothing. Reload instead — the same resume pattern logOut()/
    // forceLocalLogout() already use — so launch() runs its normal flow from
    // a clean slate and this device's fresh `emailVerified:true` is read back
    // from cc_me/the server rather than relying on in-memory state surviving.
    // showEmailVerifyGate()/hideEmailVerifyGate() toggle this element via
    // inline style.display, never a 'visible' class — check the property
    // that's actually ever set, not one nothing in the file adds, or this
    // never fires and the person has to click "Check again" themselves.
    const _emailGateEl=document.getElementById('email-verify-gate');
    if(resolvedVerification && _emailGateEl && _emailGateEl.style.display!=='none'){
      location.reload();
    }
  }catch(e){
    // Don't leave `me` claiming a link that never reached the server.
    me.googleSub=null; me.googleEmail='';
    try{ saveStorage(); }catch(err){}
    renderConnectedAccounts();
    showToast('Couldn\'t connect',scbErr('SCB-LINK-08','Your Google account couldn\'t be connected — saving the link failed.',(e.message||'the link could not be saved.')));
  }
}

async function disconnectGoogleAccount(){
  if(!me||!me.googleSub) return;
  if(!confirm('Disconnect '+(me.googleEmail||'your Google account')+'? You\'ll need your SoCloudyBro email/number and password to sign in after this.')) return;
  try{
    // Cleared by writing the record directly. registerOrUpdate() deliberately
    // falls back to the stored value for these fields (so a stale device can't
    // wipe them), which means it can never be used to clear one — the same
    // reason submitUnlinkParent() writes linkedParent:null this way.
    const users=await getUsers();
    const mine=users.find(u=>u&&u.number===me.number);
    if(!mine){ showToast('Error',scbErr('SCB-LINK-09','Your account record wasn\'t found.')); return; }
    mine.googleSub=null; mine.googleEmail='';
    await saveUsers(users);
    me.googleSub=null; me.googleEmail='';
    try{ saveStorage(); }catch(e){}
    // Stops Google offering to sign this browser straight back in.
    try{ if(googleGsiLoaded()) window.google.accounts.id.disableAutoSelect(); }catch(e){}
    renderConnectedAccounts();
    showToast('Google account disconnected','Sign in with your email or number and password from now on.');
  }catch(e){ showToast('Couldn\'t disconnect',scbErr('SCB-LINK-10','Your Google account couldn\'t be disconnected — saving the change failed.',(e.message||'failed'))); }
}

// --- Syntax Account: link / unlink -----------------------------------------
function openSyntaxLinkModal(){
  if(!me) return;
  if(typeof window.SyntaxAccount==='undefined'){
    showToast('Unavailable',scbErr('SCB-LINK-11','The Syntax Account SDK (syntax-account.js) didn\'t load, so linking isn\'t possible right now.'));
    return;
  }
  const n=document.getElementById('scb-syntax-number');
  const p=document.getElementById('scb-syntax-password');
  const e=document.getElementById('scb-syntax-link-error');
  if(n) n.value=''; if(p) p.value=''; if(e) e.textContent='';
  openModal('scb-syntax-link-modal');
}

async function submitSyntaxLink(){
  const err=document.getElementById('scb-syntax-link-error');
  if(err) err.textContent='';
  if(!me) return;
  const sdk=window.SyntaxAccount;
  if(!sdk){ if(err) err.textContent=scbErr('SCB-LINK-12','The Syntax Account SDK isn\'t loaded.'); return; }
  const numRaw=(document.getElementById('scb-syntax-number')||{}).value;
  const pwd=(document.getElementById('scb-syntax-password')||{}).value||'';
  const num=parseInt(numRaw,10);
  if(!num||num<1000||num>99999){ if(err) err.textContent=scbErr('SCB-LINK-13','Enter a Syntax Account number between 1000 and 99999.'); return; }
  if(!pwd){ if(err) err.textContent=scbErr('SCB-LINK-14','Enter your Syntax Account password.'); return; }
  const btn=document.getElementById('scb-syntax-link-submit');
  if(btn){ btn.disabled=true; btn.innerHTML='<span class="spinner"></span>'; }
  try{
    // The SDK checks the password against the Syntax project and, on success,
    // stores its own local session — which is what lets linkToSoCloudyBro()
    // below write from the game side of the link.
    const acct=await sdk.logIn(num, pwd);
    // Warn rather than silently stealing the link from another SCB account.
    if(acct && acct.linkedSoCloudyBro && Number(acct.linkedSoCloudyBro)!==Number(me.number)){
      if(!confirm('Syntax Account #'+num+' is currently linked to SoCloudyBro #'+acct.linkedSoCloudyBro
        +'. Move the link to this account (#'+me.number+')?')){
        if(err) err.textContent=scbErr('SCB-LINK-15','Left unchanged.');
        return;
      }
    }
    // Game side of the link: syntax_accounts/<syntaxNumber>/linkedSoCloudyBro.
    // This is the field the "Now Playing" lookup searches by, so once this
    // write lands, contacts' badges start working with nothing else to do.
    await sdk.linkToSoCloudyBro(me.number);
    // SoCloudyBro side of the link. Stored here as well so this app's own UI can
    // show the connection without querying the Syntax project every time (and
    // so it survives the Syntax SDK being unavailable).
    me.linkedSyntaxAccount=num;
    me.linkedSyntaxAccountName=(acct&&acct.name)||'';
    try{ saveStorage(); }catch(e){}
    await registerOrUpdate();
    closeModal('scb-syntax-link-modal');
    renderConnectedAccounts();
    // A link changes what a "Now Playing" lookup for this number would return,
    // so drop any cached answer for it.
    try{ delete _nowPlayingCache[Number(me.number)]; }catch(e){}
    showToast('Syntax Account connected','Linked to Syntax Account #'+num+'. Your contacts will see what you\'re playing.');
  }catch(e){
    if(err) err.textContent=scbErr('SCB-LINK-16','That Syntax Account couldn\'t be linked.',(e.message||'could not link that account.'));
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Connect ↗'; }
  }
}

async function disconnectSyntaxAccount(){
  if(!me||!me.linkedSyntaxAccount) return;
  const num=me.linkedSyntaxAccount;
  if(!confirm('Disconnect Syntax Account #'+num+'? Your contacts will stop seeing what you\'re playing.')) return;
  try{
    const sdk=window.SyntaxAccount;
    const session=(sdk&&typeof sdk.current==='function')?sdk.current():null;
    // The Syntax side of the link can only be cleared from a signed-in Syntax
    // session, because unlinkSoCloudyBro() writes to that account's own record.
    // NOTE: if there's no active Syntax session here (the SDK didn't load, or
    // the player last signed into Syntax on a different device/browser), only
    // the SoCloudyBro side is cleared below. The Syntax-side
    // `linkedSoCloudyBro` field then still points at this number and must be
    // cleared separately — from a game, or by connecting again here and then
    // disconnecting while signed in. The user is told this, rather than being
    // shown a "disconnected" state that is only half true.
    let syntaxSideCleared=false;
    if(sdk && session && Number(session.number)===Number(num)){
      try{ await sdk.unlinkSoCloudyBro(); syntaxSideCleared=true; }
      catch(e){ console.warn('Syntax-side unlink failed', e); }
    }
    // SoCloudyBro side: written directly, for the same reason as the Google
    // disconnect above (registerOrUpdate() can't clear a field it falls back on).
    const users=await getUsers();
    const mine=users.find(u=>u&&u.number===me.number);
    if(!mine){ showToast('Error',scbErr('SCB-LINK-17','Your account record wasn\'t found.')); return; }
    mine.linkedSyntaxAccount=null; mine.linkedSyntaxAccountName='';
    await saveUsers(users);
    me.linkedSyntaxAccount=null; me.linkedSyntaxAccountName='';
    try{ saveStorage(); }catch(e){}
    try{ delete _nowPlayingCache[Number(me.number)]; }catch(e){}
    renderConnectedAccounts();
    showToast('Syntax Account disconnected', syntaxSideCleared
      ? 'Both sides of the link have been cleared.'
      : 'Cleared here. Sign in to Syntax Account #'+num+' in one of the games to finish removing the link on that side.');
  }catch(e){ showToast('Couldn\'t disconnect',scbErr('SCB-LINK-18','Your Syntax Account couldn\'t be disconnected — saving the change failed.',(e.message||'failed'))); }
}

