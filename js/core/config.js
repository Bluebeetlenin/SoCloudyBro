// -- CONFIG -------------------------------------------------------------------
// Firebase project: SoCloudyBro (socloudybro-b8606)
const firebaseConfig = {
  apiKey: "AIzaSyDTwPFL7b3G6h-0V6__IXv_lGLhjbR0AWk",
  authDomain: "socloudybro-b8606.firebaseapp.com",
  databaseURL: "https://socloudybro-b8606-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "socloudybro-b8606",
  storageBucket: "socloudybro-b8606.firebasestorage.app",
  messagingSenderId: "1003311021367",
  appId: "1:1003311021367:web:53e06af5bcdde14fc1aeb2",
};
// Guard: if Firebase SDK scripts failed to load (SRI mismatch, ad-blocker,
// network error), `firebase` is undefined and calling it directly crashes
// the entire script block — init() is never reached and the splash freezes.
// Wrap so the page at least finishes parsing and init() can dismiss the splash.
if(typeof firebase==='undefined'){
  console.error('SCB: Firebase SDK failed to load — running in offline mode. Check browser console for blocked script errors.');
  window.firebase={
    auth:()=>({ onAuthStateChanged:(cb,eb)=>{ if(eb) eb(new Error('Firebase unavailable')); return ()=>{}; }, signInAnonymously:()=>Promise.reject(new Error('Firebase unavailable')), currentUser:null }),
    database:()=>({ ref:()=>({ get:()=>Promise.reject(new Error('Firebase unavailable')), once:()=>Promise.reject(new Error('Firebase unavailable')), on:()=>{}, off:()=>{}, set:()=>Promise.reject(new Error('Firebase unavailable')), update:()=>Promise.reject(new Error('Firebase unavailable')), remove:()=>Promise.reject(new Error('Firebase unavailable')), push:()=>({ key: 'offline-'+Date.now() }) }) }),
    storage:()=>({}),
    app:()=>({name:'offline-stub'}),
  };
}
// One-time reset of Firebase's cached "WebSocket failed" flag. While the CSP blocked
// the long-polling fallback, a single failed WebSocket attempt left this flag set for
// good, so the SDK tried the blocked fallback FIRST on every load: the realtime
// connection never came up and every database read waited ~10s for the REST fallback.
try{ if(!localStorage.getItem('scb_ws_reset_v2')){ localStorage.removeItem('firebase:previous_websocket_failure'); localStorage.setItem('scb_ws_reset_v2','1'); } }catch(e){}
try{ firebase.initializeApp(firebaseConfig); }catch(e){ console.warn('SCB: firebase.initializeApp failed:',e.message); }
let fbdb; try{ fbdb = firebase.database(); }catch(e){ console.warn('SCB: firebase.database() failed:',e.message); fbdb=firebase.database ? firebase.database() : null; }
// -- UNIVERSAL FIREBASE TIMEOUT GUARD -----------------------------------------
// This file has ~110 direct fbdb.ref(...) calls, and a stalled connection
// (ad-blocker/firewall/VPN blocking the SDK's WebSocket — the same class of
// bug fixed piecemeal elsewhere in this file for getUsers(), getConvos() and
// the System Status checks) leaves ANY of them neither resolved nor
// rejected. Rather than keep finding and patching one call site at a time
// every time a new one surfaces as "X is stuck/doesn't load", patch the
// handful of SDK methods those calls actually funnel through, ONCE, here —
// every fbdb.ref(...).get()/.once()/.set()/.update()/.remove() anywhere in
// this file (current or future) is covered automatically, including the few
// that go through firebase.database().ref(...) directly instead of the fbdb
// alias, since both return instances of the exact same underlying classes.
// _withFirebaseTimeout() itself is defined further down this same <script>
// block as a `function` declaration, so it's already hoisted and callable
// from here.
//
// Deliberately NOT wrapped:
//  - .on()/.off()    — persistent listeners meant to stay alive for the rest
//                      of the session; a reject-after-N-seconds wrapper is
//                      simply the wrong shape for them.
//  - .transaction()  — has its own retry/conflict-resolution semantics.
//  - .onDisconnect() — registers a server-side action for later, not a
//                      request this session is waiting on right now.
//  - .push()         — dual-mode: push() called with NO argument is a
//                      synchronous, local-only operation that returns a new
//                      child Reference (so the caller can read its generated
//                      .key immediately) and makes no network request at
//                      all; forcing it to always return a Promise would
//                      break every caller using that form.
(function(){
  // Guarded with its own try/catch, deliberately — this runs unconditionally
  // on every single page load, before anything else, so a future SDK
  // version quirk here must degrade to "no guard installed" (the pre-patch
  // behavior) rather than ever taking down page load entirely.
  try{
    const probe=fbdb.ref('scb_timeout_guard_probe'); // no '.', '#', '$', '[' or ']' — Firebase paths reject those
    const queryProto=Object.getPrototypeOf(Object.getPrototypeOf(probe)); // get/once live here, shared by every Query AND Reference
    const refProto=Object.getPrototypeOf(probe); // set/update/remove are Reference-only, one level down
    function guard(proto,method,ms){
      const orig=proto[method];
      if(typeof orig!=='function') return;
      proto[method]=function(...args){
        return _withFirebaseTimeout(orig.apply(this,args),'Firebase '+method,ms);
      };
    }
    guard(queryProto,'get',10000);
    guard(queryProto,'once',10000);
    guard(refProto,'set',12000);
    guard(refProto,'update',12000);
    guard(refProto,'remove',10000);
  }catch(e){ console.warn('SCB: Firebase timeout guard could not be installed (non-fatal):',e.message); }
})();
let fbstorage = null;
try{ fbstorage = firebase.storage(); }catch(e){ console.warn('SCB: Firebase Storage unavailable:', e.message); }
const MAX_UPLOAD_BYTES = 50*1024*1024; // 50MB cap on file/voice attachments
// Cloudinary unsigned upload — create a free account at cloudinary.com, then:
//   1. Copy your Cloud Name from the dashboard and paste it below
//   2. Go to Settings → Upload → Add upload preset → set Signing Mode to "Unsigned" → save
//   3. Paste the preset name below
const CLOUDINARY_CLOUD = 'qsy6cttq';
const CLOUDINARY_PRESET = 'SCB Uploads';
