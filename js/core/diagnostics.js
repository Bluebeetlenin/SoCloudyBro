// -- SCB DIAGNOSTICS ENGINE --------------------------------------------------
// Self-test suite: each check returns {pass, warn, detail}.
// pass=false → red FAIL; warn=true && pass=true → yellow WARN; else green PASS.
// Fetches this page's own response headers, cached briefly so multiple
// header checks in one diagnostics run don't each re-fetch the page.
let _scbHeaderCache=null, _scbHeaderCacheAt=0;
async function _scbFetchSelfHeaders(){
  if(_scbHeaderCache && (Date.now()-_scbHeaderCacheAt)<5000) return _scbHeaderCache;
  const res=await fetch(window.location.href,{method:'GET',cache:'no-store'});
  _scbHeaderCache=res.headers;
  _scbHeaderCacheAt=Date.now();
  return _scbHeaderCache;
}

// ── CDN / DEPENDENCY INTEGRITY MONITORING (security item #50) ──────────────
// Every externally-hosted script with a version-pinned URL also carries a
// real SRI `integrity=` attribute in the HTML (see the <script> tags near
// the top of this file) — the browser itself refuses to execute the script
// if a CDN ever serves different bytes than what was audited. This section
// re-verifies the SAME hashes live, from the admin diagnostics panel, by
// re-fetching each pinned CDN resource and re-hashing it — catching a CDN
// compromise or a stale pin even on a browser that ignores SRI mismatches
// silently in some edge case, and giving admins visible proof the pins are
// still correct. Google Sign-In's and Cloudflare Turnstile's scripts are
// intentionally NOT hash-pinned — both are designed to update frequently
// (security patches) at a fixed URL, so SRI would break them on any
// legitimate update; those get a lighter reachability check instead.
const SCB_SRI_PINS = [
  { id:'cryptojs', label:'CryptoJS 4.2.0 (cdnjs)', url:'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js', hash:'sha384-mgWScxWVKP8F7PBbpNp7i/aSb17kN0LcifBpahAplF3Mn0GR4/u1oMpWIm2rD8yY' },
  { id:'fb-app', label:'Firebase App 10.13.0', url:'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js', hash:'sha384-1hBNr0agKHNFwbheHcAJzeLri4PPLTLbaXUH5d9CauwS3A/PrkIt2tzxBJK3bHjY' },
  { id:'fb-db', label:'Firebase Database 10.13.0', url:'https://www.gstatic.com/firebasejs/10.13.0/firebase-database-compat.js', hash:'sha384-fXPb0uemoXlFCqQMtM0MOAv7FM0LsMegbR6x22q7lfnohaCNmTQzgA8BTrR8WqGx' },
  { id:'fb-storage', label:'Firebase Storage 10.13.0', url:'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage-compat.js', hash:'sha384-I6aFwEp+2h4APt6+0RW32Ej4KnvuY3aO+maGRYNKNZtt2W2Hz/pEiyd+VJSm9QvQ' },
  { id:'fb-auth', label:'Firebase Auth 10.13.0', url:'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js', hash:'sha384-QCZO5nLB2oUUv0yv01wZHylPt2CPzKdo0YnmSYCTIOo8XPPIlsIP3f1cikv2oiJ1' },
  { id:'livekit', label:'livekit-client 2.22.3 (jsdelivr)', url:'https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/dist/livekit-client.umd.min.js', hash:'sha384-MveBYLjjZe2VXnKzvBbPfyh5MEbiqNDeta9nzIGbtqnXmC+CwX/mLE5+M9PDIcPy' },
];
async function _scbSha384Base64(buf){
  const digest=await crypto.subtle.digest('SHA-384', buf);
  const bytes=new Uint8Array(digest);
  let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
  return btoa(bin);
}
async function _checkSriPin(pin){
  try{
    const res=await fetch(pin.url,{cache:'no-store'});
    if(!res.ok) return {pass:false,detail:'HTTP '+res.status+' fetching '+pin.url};
    const buf=await res.arrayBuffer();
    const actual='sha384-'+await _scbSha384Base64(buf);
    const match=actual===pin.hash;
    return {pass:match,detail:match?'Live hash matches the pinned SRI value':'MISMATCH — the CDN is serving different content than what was audited! expected '+pin.hash.slice(0,20)+'… got '+actual.slice(0,20)+'…'};
  }catch(e){return {pass:false,detail:'Fetch failed: '+e.message};}
}

const SCB_CHECKS = [

  // ── CONFIG ─────────────────────────────────────────────────────────────────
  { id:'cfg.admin', cat:'Config', name:'Admin number set',
    run:()=>ADMIN_NUMBER===2015?{pass:true,detail:'#'+ADMIN_NUMBER}:{pass:false,detail:'ADMIN_NUMBER is '+ADMIN_NUMBER} },

  { id:'cfg.siteurl', cat:'Config', name:'SITE_URL matches deployment',
    run:()=>{
      const expected=window.location.origin;
      const ok=SITE_URL&&SITE_URL.includes(expected.replace(/^https?:\/\//,'').split('/')[0]);
      return {pass:!!ok, warn:!ok, detail:'SITE_URL='+SITE_URL+' page='+expected};
    }
  },
  { id:'cfg.spotify_redirect', cat:'Config', name:'Spotify redirect URI matches page',
    run:()=>{
      const cur=window.location.origin+window.location.pathname;
      const ok=typeof SPOTIFY_REDIRECT_URI==='string'&&SPOTIFY_REDIRECT_URI===cur;
      return {pass:ok, warn:!ok, detail:'URI='+SPOTIFY_REDIRECT_URI};
    }
  },
  { id:'cfg.spotify_id', cat:'Config', name:'Spotify Client ID present',
    run:()=>({pass:!!SPOTIFY_CLIENT_ID&&SPOTIFY_CLIENT_ID.length>10,detail:SPOTIFY_CLIENT_ID?'present':'MISSING'}) },
  { id:'cfg.lastfm', cat:'Config', name:'Last.fm API key present',
    run:()=>({pass:!!LASTFM_API_KEY&&LASTFM_API_KEY.length>10,detail:LASTFM_API_KEY?'present':'MISSING'}) },
  { id:'cfg.web3forms', cat:'Config', name:'Report Worker endpoint reachable',
    run:()=>({pass:!!MINT_TOKEN_ENDPOINT,detail:MINT_TOKEN_ENDPOINT?'Worker endpoint configured (key is server-side secret)':'MISSING'}) },

  // ── FIREBASE ───────────────────────────────────────────────────────────────
  { id:'fb.sdk', cat:'Firebase', name:'Firebase SDK loaded',
    run:()=>({pass:typeof firebase!=='undefined'&&typeof firebase.database==='function',detail:typeof firebase==='undefined'?'firebase global missing':'OK'}) },
  { id:'fb.app', cat:'Firebase', name:'Firebase App initialised',
    run:()=>{try{const a=firebase.app();return {pass:!!a,detail:a?a.name:'not initialised'};}catch(e){return {pass:false,detail:e.message};}} },
  { id:'fb.db', cat:'Firebase', name:'Firebase Realtime DB accessible',
    run:()=>{try{const d=firebase.database();return {pass:!!d,detail:d?'OK':'null'};}catch(e){return {pass:false,detail:e.message};}} },
  { id:'fb.dburl', cat:'Firebase', name:'DB URL points to europe-west1',
    run:()=>{
      try{
        const url=firebase.database().ref().toString();
        const ok=url.includes('europe-west1');
        return {pass:ok,warn:!ok,detail:url};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },
  { id:'fb.read', cat:'Firebase', name:'Can read users/ from Firebase',
    async:true,
    run:async()=>{
      try{
        const snap=await firebase.database().ref('users').limitToFirst(1).once('value');
        return {pass:true,detail:'Got '+(snap.numChildren?snap.numChildren():Object.keys(snap.val()||{}).length)+' record(s)'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },
  { id:'fb.write', cat:'Firebase', name:'Can write heartbeat to Firebase',
    async:true,
    run:async()=>{
      if(!me||!me.number) return {pass:false,detail:'Not signed in'};
      try{
        await firebase.database().ref('users/'+me.number+'/lastSeen').set(Date.now());
        return {pass:true,detail:'Write succeeded'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },
  { id:'fb.rules_errors', cat:'Firebase', name:'errors/ path is writable',
    async:true, warn:true,
    run:async()=>{
      if(!me||!me.number) return {pass:true,detail:'Not signed in — skipped'};
      try{
        const ref=firebase.database().ref('errors').push();
        await ref.set({ts:Date.now(),code:'DIAG-TEST',user:me.number});
        await ref.remove();
        return {pass:true,detail:'Write+delete succeeded'};
      }catch(e){return {pass:true,detail:'errors/ path not writable (optional) — '+e.message};}
    }
  },

  // ── SECURITY HEADERS ───────────────────────────────────────────────────────
  // Self-checks the actual HTTP response headers this page was served with
  // (configured in vercel.json) — catches a misconfigured/missing CSP or
  // other security header directly from the live deployment, not just the
  // source file. Skipped (pass, with a note) when run from file:// since
  // headers only exist once the page is actually served over HTTP(S).
  { id:'hdr.csp', cat:'Security Headers', name:'Content-Security-Policy header present', async:true,
    run:async()=>{
      if(window.location.protocol==='file:') return {pass:true,warn:true,detail:'Skipped — running from file://; headers only exist when served over HTTP(S)'};
      try{
        const h=await _scbFetchSelfHeaders();
        const csp=h.get('content-security-policy');
        return {pass:!!csp,detail:csp?csp.slice(0,100)+(csp.length>100?'…':''):'MISSING — add via vercel.json headers config'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },
  { id:'hdr.xcto', cat:'Security Headers', name:'X-Content-Type-Options: nosniff present', async:true,
    run:async()=>{
      if(window.location.protocol==='file:') return {pass:true,warn:true,detail:'Skipped — file://'};
      try{
        const h=await _scbFetchSelfHeaders();
        const v=h.get('x-content-type-options');
        return {pass:/nosniff/i.test(v||''),detail:v||'MISSING'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },
  { id:'hdr.xfo', cat:'Security Headers', name:'Clickjacking protection (X-Frame-Options or frame-ancestors)', async:true,
    run:async()=>{
      if(window.location.protocol==='file:') return {pass:true,warn:true,detail:'Skipped — file://'};
      try{
        const h=await _scbFetchSelfHeaders();
        const xfo=h.get('x-frame-options');
        const csp=h.get('content-security-policy')||'';
        const hasFrameAncestors=/frame-ancestors/i.test(csp);
        return {pass:!!xfo||hasFrameAncestors,detail:xfo?('X-Frame-Options: '+xfo):hasFrameAncestors?'via CSP frame-ancestors':'MISSING'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },
  { id:'hdr.hsts', cat:'Security Headers', name:'Strict-Transport-Security present', async:true,
    run:async()=>{
      if(window.location.protocol==='file:') return {pass:true,warn:true,detail:'Skipped — file://'};
      try{
        const h=await _scbFetchSelfHeaders();
        const v=h.get('strict-transport-security');
        return {pass:!!v,detail:v||'MISSING'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },
  { id:'hdr.referrer', cat:'Security Headers', name:'Referrer-Policy present', async:true, warn:true,
    run:async()=>{
      if(window.location.protocol==='file:') return {pass:true,warn:true,detail:'Skipped — file://'};
      try{
        const h=await _scbFetchSelfHeaders();
        const v=h.get('referrer-policy');
        return {pass:true,warn:!v,detail:v||'MISSING (optional but recommended)'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },
  { id:'hdr.permissions', cat:'Security Headers', name:'Permissions-Policy present', async:true, warn:true,
    run:async()=>{
      if(window.location.protocol==='file:') return {pass:true,warn:true,detail:'Skipped — file://'};
      try{
        const h=await _scbFetchSelfHeaders();
        const v=h.get('permissions-policy');
        return {pass:true,warn:!v,detail:v||'MISSING (optional but recommended)'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },

  // ── CDN / DEPENDENCY INTEGRITY ─────────────────────────────────────────────
  { id:'cdn.tags_match_pins', cat:'CDN Integrity', name:'Script tags carry the expected SRI hashes',
    run:()=>{
      const scripts=[...document.querySelectorAll('script[src]')];
      const mismatches=SCB_SRI_PINS.filter(pin=>{
        const tag=scripts.find(s=>s.src===pin.url);
        return !tag || tag.getAttribute('integrity')!==pin.hash;
      });
      return {pass:mismatches.length===0, detail:mismatches.length? mismatches.map(p=>p.label).join(', ')+' — missing or mismatched integrity attribute in the HTML' : 'All '+SCB_SRI_PINS.length+' pinned script tags carry the correct integrity attribute'};
    }
  },
  ...SCB_SRI_PINS.map(pin=>({
    id:'cdn.'+pin.id, cat:'CDN Integrity', name:pin.label+' — live CDN content matches pinned hash', async:true,
    run:()=>_checkSriPin(pin),
  })),
  // Google Sign-In's and Cloudflare Turnstile's scripts are intentionally
  // not SRI-pinned (see the note above SCB_SRI_PINS) and their reachability
  // checks only ever produced a non-actionable informational warning, so
  // they're not surfaced as diagnostic checks here.

  // ── AUTH / SESSION ─────────────────────────────────────────────────────────
  { id:'auth.firebase', cat:'Auth', name:'Firebase Auth session active',
    run:()=>{
      const u=firebase.auth&&firebase.auth().currentUser;
      return {pass:!!u,detail:u?'uid='+u.uid:'No Firebase currentUser'};
    }
  },
  { id:'auth.me', cat:'Auth', name:'me object is set',
    run:()=>({pass:!!(me&&me.number),detail:me?'#'+me.number+' '+me.name:'me is null'}) },
  { id:'auth.me_name', cat:'Auth', name:'me.name is set',
    run:()=>({pass:!!(me&&me.name),warn:!!(me&&!me.name),detail:me&&me.name?me.name:'Empty name — display issues likely'}) },
  { id:'auth.me_storage', cat:'Auth', name:'cc_me in localStorage is valid',
    run:()=>{
      try{
        const raw=localStorage.getItem('cc_me');
        if(!raw) return {pass:false,detail:'cc_me is missing'};
        const obj=JSON.parse(raw);
        return {pass:!!(obj&&obj.number),detail:'#'+(obj&&obj.number)};
      }catch(e){return {pass:false,detail:'JSON parse failed: '+e.message};}
    }
  },

  // ── E2E ENCRYPTION ─────────────────────────────────────────────────────────
  { id:'e2e.priv_local', cat:'E2E Crypto', name:'Private key in localStorage',
    run:()=>{
      if(!me||!me.number) return {pass:false,detail:'Not signed in'};
      const raw=localStorage.getItem('cc_e2e_priv_'+me.number);
      return {pass:!!raw,detail:raw?'Present ('+raw.length+' chars)':'Missing — messages on new devices cannot decrypt'};
    }
  },
  { id:'e2e.pub_fb', cat:'E2E Crypto', name:'Public key in Firebase',
    async:true,
    run:async()=>{
      if(!me||!me.number) return {pass:false,detail:'Not signed in'};
      try{
        const snap=await firebase.database().ref('users/'+me.number+'/pubkey').once('value');
        return {pass:snap.exists(),detail:snap.exists()?'Present':'Missing — recipients cannot encrypt to you'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },
  { id:'e2e.import', cat:'E2E Crypto', name:'Private key is importable',
    async:true,
    run:async()=>{
      if(!me||!me.number) return {pass:false,detail:'Not signed in'};
      const raw=localStorage.getItem('cc_e2e_priv_'+me.number);
      if(!raw) return {pass:false,detail:'No key to import'};
      try{
        const jwk=JSON.parse(raw);
        await crypto.subtle.importKey('jwk',jwk,{name:'ECDH',namedCurve:'P-256'},false,['deriveKey']);
        return {pass:true,detail:'ECDH P-256 key imported OK'};
      }catch(e){return {pass:false,detail:'Import failed: '+e.message};}
    }
  },
  { id:'e2e.cloud_backup', cat:'E2E Crypto', name:'Encrypted key backup in Firebase',
    async:true,
    run:async()=>{
      if(!me||!me.number) return {pass:false,detail:'Not signed in'};
      try{
        const snap=await firebase.database().ref('users/'+me.number+'/e2eEnc').once('value');
        return {pass:snap.exists(),warn:!snap.exists(),detail:snap.exists()?'Backup present':'No cloud backup — cross-device E2E will fail'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },

  // ── CONTACTS & USERS ───────────────────────────────────────────────────────
  { id:'contacts.cache', cat:'Contacts', name:'usersCache is populated',
    run:()=>({pass:Array.isArray(usersCache)&&usersCache.length>0,detail:Array.isArray(usersCache)?usersCache.length+' users':'usersCache is not an array'}) },
  { id:'contacts.list', cat:'Contacts', name:'contacts array has entries',
    run:()=>({pass:Array.isArray(contacts)&&contacts.length>0,warn:Array.isArray(contacts)&&contacts.length===0,detail:Array.isArray(contacts)?contacts.length+' contacts':'contacts is not an array'}) },
  { id:'contacts.phantom', cat:'Contacts', name:'No phantom contacts (unknown users)',
    run:()=>{
      if(!Array.isArray(contacts)||!Array.isArray(usersCache)) return {pass:false,detail:'Arrays not ready'};
      const phantoms=contacts.filter(c=>c.type!=='group'&&c.number&&String(c.number)!==CLOUDY_NUMBER&&!lookupUser(c.number));
      return {pass:phantoms.length===0,warn:phantoms.length>0,detail:phantoms.length>0?phantoms.length+' phantom(s): '+phantoms.map(c=>'#'+c.number).join(', '):'All contacts verified'};
    }
  },
  { id:'contacts.keys', cat:'Contacts', name:'All contact keys are well-formed',
    run:()=>{
      if(!Array.isArray(contacts)) return {pass:true,detail:'No contacts'};
      const bad=contacts.filter(c=>!c.key||typeof c.key!=='string');
      return {pass:bad.length===0,warn:bad.length>0,detail:bad.length>0?bad.length+' contacts missing keys':'OK'};
    }
  },
  { id:'contacts.my_record', cat:'Contacts', name:'My user record in usersCache',
    run:()=>{
      if(!me||!me.number) return {pass:false,detail:'Not signed in'};
      const u=lookupUser(me.number);
      return {pass:!!u,detail:u?'Found: '+dec(u.name||''):'Not in usersCache — profile may not save correctly'};
    }
  },

  // ── STORAGE ────────────────────────────────────────────────────────────────
  { id:'storage.accessible', cat:'Storage', name:'localStorage accessible',
    run:()=>{
      try{localStorage.setItem('__scb_diag__','1');localStorage.removeItem('__scb_diag__');return {pass:true,detail:'OK'};}
      catch(e){return {pass:false,detail:e.message};}
    }
  },
  { id:'storage.quota', cat:'Storage', name:'localStorage not near quota',
    run:()=>{
      try{
        let used=0;
        for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);used+=(k.length+(localStorage.getItem(k)||'').length)*2;}
        const kb=Math.round(used/1024);
        const warn=kb>4000;
        return {pass:!warn||kb<5000,warn:warn,detail:kb+' KB used (limit ≈5 MB)'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },
  { id:'storage.contacts_json', cat:'Storage', name:'cc_contacts parses correctly',
    run:()=>{
      try{
        const raw=localStorage.getItem('cc_contacts');
        if(!raw) return {pass:true,warn:true,detail:'cc_contacts not in localStorage (using in-memory)'};
        JSON.parse(raw);
        return {pass:true,detail:'Parseable — '+JSON.parse(raw).length+' entries'};
      }catch(e){return {pass:false,detail:'JSON error: '+e.message};}
    }
  },

  // ── CRITICAL FUNCTIONS ─────────────────────────────────────────────────────
  { id:'fn.core', cat:'Functions', name:'Core functions exist',
    run:()=>{
      const needed=['sendMsg','renderSidebar','openChat','getUsers','lookupUser',
                    'showToast','selfHeal','ensureE2EKeypair','saveStorage',
                    'loadPrefsFromFirebase','syncContactsFromConvos',
                    '_tryUpgradeToCustomAuth','isFeatureEnabled','finishLogin'];
      const missing=needed.filter(f=>typeof window[f]!=='function');
      return {pass:missing.length===0,detail:missing.length?'Missing: '+missing.join(', '):'All '+needed.length+' present'};
    }
  },
  { id:'fn.enc', cat:'Functions', name:'enc/dec helpers work',
    run:()=>{
      try{
        const test='hello SCB'; const encoded=enc(test);
        return {pass:typeof encoded==='string'&&encoded.length>0,detail:'enc("'+test+'")="'+encoded.slice(0,30)+'"'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },
  { id:'fn.lookupUser', cat:'Functions', name:'lookupUser finds signed-in user by number',
    run:()=>{
      if(!me||!me.number) return {pass:false,detail:'Not signed in'};
      const u=lookupUser(me.number);
      if(!u) return {pass:false,detail:'lookupUser('+me.number+') returned null — user missing from cache'};
      const nameMatch=u.number===me.number||Number(u.number)===Number(me.number);
      return {pass:nameMatch,detail:nameMatch?'Found: '+dec(u.name||'')+'  (#'+u.number+')':'Number mismatch: got #'+u.number+' expected #'+me.number};
    }
  },
  { id:'fn.esc', cat:'Functions', name:'esc() prevents XSS injection',
    run:()=>{
      try{
        const out=esc('<script>alert(1)<\/script>');
        const safe=!out.includes('<script>');
        return {pass:safe,detail:safe?'Escaped OK → '+out.slice(0,40):'UNSAFE — XSS risk'};
      }catch(e){return {pass:false,detail:e.message};}
    }
  },

  // ── SECURITY ───────────────────────────────────────────────────────────────
  { id:'sec.pin', cat:'Security', name:'PIN or 2FA configured',
    run:()=>{
      const hasPIN=!!localStorage.getItem('cc_pin');
      return {pass:hasPIN,warn:!hasPIN,detail:hasPIN?'PIN set':'No PIN — account less protected'};
    }
  },
  { id:'sec.blocked_list', cat:'Security', name:'blocked list is valid',
    run:()=>{
      const b=me&&me.blocked;
      if(!b) return {pass:true,detail:'Empty (no blocks)'};
      return {pass:Array.isArray(b),warn:!Array.isArray(b),detail:Array.isArray(b)?b.length+' blocked numbers':'blocked is not an array: '+typeof b};
    }
  },
  { id:'sec.admin_rules_hardened', cat:'Security', name:'Admin-sensitive paths still require real identity',
    // Guards against the exact regression class this app has hit before
    // (admin_site's write rule was plain "auth != null" — ANY authenticated
    // session, including the free anonymous one every visitor gets, could
    // overwrite reserved_numbers/feature_flags/the audit log — fixed in the
    // rules compile). A blanket "flag every auth != null rule" linter would
    // be mostly noise: several paths (calls, voice, feedback, updates,
    // errors) are LEGITIMATELY that open by design. Instead this checks the
    // specific paths that are supposed to require real ownership/admin
    // proof still do, in the canonical rules copy this admin keeps synced
    // with the live deployed rules (see "Load canonical rules" in Owner
    // Tools) — it can't see the LIVE rules directly (no public read access
    // to Firebase's rules endpoint), so this is a check on intent, not
    // literal live-server state; still catches an accidental copy-paste
    // regression in the canonical source before it ever gets pushed.
    run:()=>{
      try{
        const admin=JSON.stringify(SCB_CANONICAL_RULES.rules.admin_site[".write"]||'');
        const users=JSON.stringify(SCB_CANONICAL_RULES.rules.users.$uid[".write"]||'');
        const convos=JSON.stringify(SCB_CANONICAL_RULES.rules.conversations[".write"]||'');
        const problems=[];
        if(admin.indexOf('adminAccess')===-1) problems.push('admin_site');
        if(users.indexOf('adminAccess')===-1) problems.push('users/$uid');
        if(convos.indexOf('sign_in_provider')===-1) problems.push('conversations');
        return {pass:!problems.length,detail:problems.length?'Missing the expected identity check: '+problems.join(', '):'All three still require real identity proof, not just auth != null'};
      }catch(e){ return {pass:false,detail:'Could not inspect SCB_CANONICAL_RULES: '+e.message}; }
    }
  },

  // ── UI ─────────────────────────────────────────────────────────────────────
  { id:'ui.sidebar', cat:'UI', name:'Sidebar DOM element present',
    run:()=>{const el=document.getElementById('sidebar');return {pass:!!el,detail:el?'Found':'#sidebar missing'};} },
  { id:'ui.toast', cat:'UI', name:'Toast system works',
    run:()=>{
      try{showToast('Diagnostics','Self-test toast check');return {pass:true,detail:'Toast dispatched'};}
      catch(e){return {pass:false,detail:e.message};}
    }
  },

  // ── WORKERS (Cloudflare) ────────────────────────────────────────────────────
  // Each is a deliberately-invalid request that the Worker should reject
  // cleanly and fast (4xx) — proves the route is actually deployed and
  // routing, not just that the edge answers at all. A 5xx means the
  // Worker's own code is broken even though it's reachable; a thrown
  // exception/timeout means it isn't reachable at all. Timeout-guarded the
  // same way _tryUpgradeToCustomAuth()'s own fetch to this Worker is.
  { id:'worker.mint_token', cat:'Workers', name:'mint-token endpoint reachable',
    async:true,
    run:async()=>{
      try{
        // _runSCBChecks() runs every check strictly sequentially, and
        // worker.otp right below reuses checkRulesWorker() (its own 8s
        // timeout) — a shorter cap here keeps the worst-case combined wait
        // for both Worker checks during an actual outage closer to ~13s
        // than ~16s, without the larger, riskier change of parallelizing
        // the whole 40-check diagnostics runner for this.
        const ctl=(typeof AbortController!=='undefined')?new AbortController():null;
        const timer=ctl?setTimeout(()=>{try{ctl.abort();}catch(e){}},5000):null;
        const t0=Date.now();
        let res;
        try{ res=await fetch(MINT_TOKEN_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',...(ctl?{signal:ctl.signal}:{})}); }
        finally{ if(timer) clearTimeout(timer); }
        const ms=Date.now()-t0;
        if(res.status>=500) return {pass:false,detail:'Worker returned HTTP '+res.status+' ('+ms+'ms) — its own code is erroring'};
        return {pass:true,detail:'Responded HTTP '+res.status+' in '+ms+'ms'};
      }catch(e){ return {pass:false,detail:'Unreachable: '+((e&&e.message)||'network error')}; }
    }
  },
  { id:'worker.otp', cat:'Workers', name:'send-otp / verify-otp endpoints reachable',
    async:true,
    // Calls the SAME function the public System Status widget and Owner
    // Tools' service-status panel use (checkRulesWorker()) — one
    // implementation of this probe, not a second copy that could silently
    // drift from it.
    run:async()=>{
      const r=await checkRulesWorker();
      return {pass:r.state==='green'||r.state==='yellow',warn:r.state==='yellow',detail:r.msg};
    }
  },

  // ── CODE HEALTH ──────────────────────────────────────────────────────────────
  { id:'code.recent_errors', cat:'Code Health', name:'Client error rate (last 24h)',
    async:true, warn:true,
    run:async()=>{
      try{
        const cutoff=Date.now()-86400000;
        const snap=await firebase.database().ref('errors').orderByChild('ts').startAt(cutoff).limitToLast(500).once('value');
        const counts={};
        let total=0;
        // Excludes this very diagnostics run's own "DIAG-*" entries (every
        // failed check gets logged to errors/ by _runSCBChecks — including
        // a failure of THIS check) — otherwise re-running diagnostics while
        // the count is already high inflates the very number it's measuring,
        // and this check's own code climbs its own "top codes" list.
        if(snap.exists()) snap.forEach(c=>{ const v=c.val(); if(!v) return; const code=v.code||'unknown'; if(code.indexOf('DIAG-')===0) return; total++; counts[code]=(counts[code]||0)+1; });
        const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>k+' ×'+v).join(', ');
        // No fixed "healthy" threshold exists for this app (traffic varies),
        // so this warns rather than fails once there's a non-trivial volume
        // to look at, and always shows the top codes so an admin can judge
        // for themselves rather than trusting an arbitrary number here.
        return {pass:total<50,warn:total>=10,detail:total===0?'No errors logged in the last 24h':total+' error(s) — top: '+(top||'n/a')};
      }catch(e){ return {pass:true,warn:true,detail:'Could not read errors/: '+((e&&e.message)||'')}; }
    }
  },
];

// Run all checks (async-aware) and return result array
async function _runSCBChecks(onProgress){
  const results=[];
  for(let i=0;i<SCB_CHECKS.length;i++){
    const chk=SCB_CHECKS[i];
    if(onProgress) onProgress(i, SCB_CHECKS.length, chk.name);
    let r;
    try{
      r=chk.async ? await chk.run() : chk.run();
    }catch(e){
      r={pass:false,detail:'Check threw: '+e.message};
    }
    results.push({...chk, ...r});
    // Log failures to error log
    if(!r.pass) _logError('DIAG-'+chk.id.toUpperCase().replace('.','_'), chk.name+' — '+r.detail, chk.cat, 'diagnostics', false);
  }
  return results;
}

async function renderAdminDiagnosticsTab(){
  const body=document.getElementById('admin-dashboard-body');
  if(!body) return;
  body.innerHTML='<div style="padding:16px;text-align:center;color:var(--muted)"><div style="font-size:28px">🔍</div><div style="margin-top:8px">Click <strong>Run Diagnostics</strong> to scan for errors.</div>'
    +'<button class="btn" style="margin-top:14px" onclick="_launchDiagnostics()">▶ Run Diagnostics</button></div>';
}
window._launchDiagnostics = async function(){
  const body=document.getElementById('admin-dashboard-body');
  if(!body) return;
  let prog=0;
  const total=SCB_CHECKS.length;
  const bar=(n,t,name)=>{
    const pct=Math.round(n/t*100);
    const bEl=document.getElementById('diag-progbar');
    const tEl=document.getElementById('diag-progtext');
    if(bEl) bEl.style.width=pct+'%';
    if(tEl) tEl.textContent='Running: '+name+' ('+n+'/'+t+')';
  };
  body.innerHTML=`<div style="padding:16px">
    <div style="font-size:13px;color:var(--muted);margin-bottom:8px" id="diag-progtext">Starting…</div>
    <div style="background:var(--surface2);border-radius:4px;height:8px;overflow:hidden;margin-bottom:16px">
      <div id="diag-progbar" style="height:100%;background:linear-gradient(90deg,#4f8ef7,#6b5de8);width:0%;transition:width .2s"></div>
    </div>
    <div id="diag-results" style="font-size:13px;color:var(--muted)">Scanning…</div>
  </div>`;
  const results=await _runSCBChecks(bar);
  // Summary
  const fails=results.filter(r=>!r.pass);
  const warns=results.filter(r=>r.pass&&r.warn);
  const passes=results.filter(r=>r.pass&&!r.warn);
  const cats=[...new Set(results.map(r=>r.cat))];
  const catHTML=cats.map(cat=>{
    const items=results.filter(r=>r.cat===cat);
    const rows=items.map(r=>{
      const icon=r.pass?(r.warn?'⚠️':'✅'):'❌';
      const bg=r.pass?(r.warn?'rgba(255,193,7,.08)':'rgba(39,174,96,.08)'):'rgba(231,76,60,.08)';
      const col=r.pass?(r.warn?'#f39c12':'var(--success,#27ae60)'):'var(--danger,#e74c3c)';
      return `<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 6px;border-radius:6px;margin-bottom:2px;background:${bg}">
        <span style="font-size:15px;flex-shrink:0;margin-top:-1px">${icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;color:var(--text)">${esc(r.name)}</div>
          <div style="font-size:11px;color:${col};word-break:break-word">${esc(r.detail||'')}</div>
        </div>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${esc(cat)}</div>
      ${rows}
    </div>`;
  }).join('');
  const summaryColor=fails.length?'var(--danger,#e74c3c)':warns.length?'#f39c12':'var(--success,#27ae60)';
  const summaryLabel=fails.length?fails.length+' failure'+(fails.length>1?'s':''):warns.length?warns.length+' warning'+(warns.length>1?'s':''):'All clear';
  const _diagResultsEl=document.getElementById('diag-results');
  if(!_diagResultsEl) return;
  _diagResultsEl.innerHTML=`
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      <div style="background:var(--surface2);border-radius:8px;padding:10px 14px;flex:1;min-width:80px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:var(--success,#27ae60)">${passes.length}</div>
        <div style="font-size:10px;color:var(--muted)">Passed</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:10px 14px;flex:1;min-width:80px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#f39c12">${warns.length}</div>
        <div style="font-size:10px;color:var(--muted)">Warnings</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:10px 14px;flex:1;min-width:80px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:${summaryColor}">${fails.length}</div>
        <div style="font-size:10px;color:var(--muted)">Failures</div>
      </div>
    </div>
    <div style="font-size:13px;font-weight:600;color:${summaryColor};margin-bottom:14px">
      ${fails.length?'❌':'⚠️'} ${esc(summaryLabel)} in ${results.length} checks
      <button class="btn btn-sm btn-ghost" style="float:right;font-size:11px" onclick="_launchDiagnostics()">↻ Re-run</button>
    </div>
    ${catHTML}`;
};
// -- END DIAGNOSTICS ENGINE --------------------------------------------------


