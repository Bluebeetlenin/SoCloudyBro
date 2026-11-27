// ---- Captcha ----------------------------------------------------------------
// ── Cloudflare Turnstile ──────────────────────────────────────────────────
let _turnstileToken = (location.search.indexOf('test=1')!==-1) ? 'test-bypass' : null;
function onTurnstileSuccess(token){ _turnstileToken = token; }
function onTurnstileExpired(){ if(location.search.indexOf('test=1')===-1) _turnstileToken = null; }
function resetTurnstile(){
  _turnstileToken = null;
  if(window.turnstile) turnstile.reset('#scb-turnstile');
}

// ---- Spam / bot detector ----------------------------------------------------
const _spamTimestamps = [];   // rolling window of send timestamps
let _spamMuteUntil = 0;       // epoch ms, 0 = not muted
let _spamLastText = '';
let _spamIdenticalRun = 0;
const SPAM_WARN_COUNT  = 8;   // msgs in 30s → toast warning
const SPAM_MUTE_COUNT  = 12;  // msgs in 30s → 5-min mute
const SPAM_IDENTICAL_WARN = 3; // same message in a row → warning
const SPAM_IDENTICAL_MUTE = 5; // same message in a row → 5-min mute
const SPAM_WINDOW_MS  = 30000; // sliding window size
const SPAM_MUTE_MS    = 5 * 60 * 1000;

// Returns true if send is allowed, false if blocked.
function checkSpamRate(text){
  if(!me || me.number === ADMIN_NUMBER) return true;
  const now = Date.now();
  // Check active mute
  if(now < _spamMuteUntil){
    const secsLeft = Math.ceil((_spamMuteUntil - now) / 1000);
    showToast('Slow down', 'You\'re muted for spam — '+secsLeft+'s remaining.');
    return false;
  }
  // Sliding window
  _spamTimestamps.push(now);
  const cutoff = now - SPAM_WINDOW_MS;
  while(_spamTimestamps.length && _spamTimestamps[0] < cutoff) _spamTimestamps.shift();
  const count = _spamTimestamps.length;
  // Identical message run
  const trimmed = (text||'').trim();
  if(trimmed && trimmed === _spamLastText){
    _spamIdenticalRun++;
  } else {
    _spamIdenticalRun = 1;
    _spamLastText = trimmed;
  }
  // Bot/spam heuristics — account age bonus: brand-new accounts get a tighter limit
  const acctAgeMs = me.createdAt ? now - me.createdAt : Infinity;
  const newAcctMultiplier = acctAgeMs < 5 * 60 * 1000 ? 0.6 : 1; // 40% stricter if < 5 min old
  const effectiveCount = Math.ceil(count / newAcctMultiplier);
  // Hard mute
  if(effectiveCount >= SPAM_MUTE_COUNT || _spamIdenticalRun >= SPAM_IDENTICAL_MUTE){
    _spamMuteUntil = now + SPAM_MUTE_MS;
    showToast('Spam detected', 'You\'ve been muted for 5 minutes.');
    _reportSpam(_spamIdenticalRun >= SPAM_IDENTICAL_MUTE ? 'identical_messages' : 'rate_limit', count, _spamIdenticalRun);
    return false;
  }
  // Warnings
  if(effectiveCount >= SPAM_WARN_COUNT){
    showToast('Slow down', 'You\'re sending messages too quickly.');
  } else if(_spamIdenticalRun >= SPAM_IDENTICAL_WARN){
    showToast('Heads up', 'Avoid sending the same message repeatedly.');
  }
  return true;
}

/* ===== MASS-REPORT SPIKE DETECTION (security feature 24/32) =====
   If the same account gets reported by several DIFFERENT people within a
   short window, that's flagged into the same spam_flags admin queue as
   the message-rate spam detector above — reusing its existing Spam tab UI
   and Ban action rather than building a separate surface for it. Counts
   distinct reporters, not raw report rows, so one person can't fake a
   "spike" by filing the same report repeatedly; debounced so a single
   spike doesn't push a new flag for every report past the threshold. ===== */
const MASS_REPORT_WINDOW_MS=60*60*1000; // 1 hour
const MASS_REPORT_THRESHOLD=3; // distinct reporters within the window
async function _checkMassReportSpike(reportedNumber,reportedName,allReports){
  if(!reportedNumber) return;
  try{
    const cutoff=Date.now()-MASS_REPORT_WINDOW_MS;
    const recent=(allReports||[]).filter(r=>r&&r.reportedNumber===reportedNumber&&r.time>cutoff);
    const distinctReporters=new Set(recent.map(r=>r.reporterNumber)).size;
    if(distinctReporters<MASS_REPORT_THRESHOLD) return;
    // Debounce: don't push another flag if an unresolved one for this
    // account already exists from within the current window.
    const snap=await fbdb.ref('spam_flags').orderByChild('number').equalTo(reportedNumber).get();
    let alreadyFlagged=false;
    snap.forEach(child=>{ const v=child.val(); if(v&&v.type==='mass_reported'&&!v.resolved&&v.at>cutoff) alreadyFlagged=true; });
    if(alreadyFlagged) return;
    // .push() isn't covered by the global Firebase timeout guard (see its
    // installer comment near `const fbdb=...`) — guarded individually here.
    await _withFirebaseTimeout(fbdb.ref('spam_flags').push({
      number:reportedNumber,
      name:reportedName||'',
      type:'mass_reported',
      reportCount:distinctReporters,
      at:Date.now(),
      resolved:false
    }),'Spam flag write',10000);
  }catch(e){ console.warn('Mass-report spike check failed (non-fatal):',e.message); }
}
async function _reportSpam(type, msgCount, identicalRun){
  if(!me) return;
  try{
    await _withFirebaseTimeout(fbdb.ref('spam_flags').push({
      number: me.number,
      name: me.name||'',
      type,           // 'rate_limit' | 'identical_messages'
      msgCount,
      identicalRun,
      at: Date.now(),
      resolved: false
    }),'Spam flag write',10000);
  }catch{}
}

// Patch sendMsg to run spam check before sending
const _origSendMsgForSpam = sendMsg;
sendMsg = async function(gifUrl){
  // Only skip spam check for non-string arguments (accidental event-object calls)
  if(gifUrl && typeof gifUrl !== 'string') return _origSendMsgForSpam.apply(this, arguments);
  const input = document.getElementById('msg-input');
  const text = gifUrl ? '[GIF]' : (input ? input.value.trim() : '');
  if(!checkSpamRate(text)){
    return;
  }
  return _origSendMsgForSpam.apply(this, arguments);
};

// ---- Admin Spam tab ---------------------------------------------------------
async function renderAdminSpamTab(){
  if(!hasPermission('users_view')){ const b=document.getElementById('admin-dashboard-body'); if(b) b.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted)">Access denied.</div>'; return; }
  const body = document.getElementById('admin-dashboard-body');
  if(!body) return;
  body.innerHTML = '<div style="padding:8px 0;color:var(--muted);font-size:13px">Loading spam reports…</div>';
  try{
    const snap = await fbdb.ref('spam_flags').orderByChild('at').limitToLast(50).get();
    const flags = [];
    if(snap.exists()){
      snap.forEach(child=>{ flags.unshift({_key:child.key, ...child.val()}); });
    }
    if(!flags.length){
      body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">No spam reports yet.</div>';
      return;
    }
    const rows = flags.map(f=>{
      const when = f.at ? new Date(f.at).toLocaleString() : '—';
      const typeLabel = f.type==='identical_messages' ? '🔁 Repeated messages' : f.type==='mass_reported' ? '🚩 Mass-reported' : '⚡ Rate limit';
      const detail = f.type==='identical_messages'
        ? f.identicalRun+' identical in a row'
        : f.type==='mass_reported'
        ? 'reported by '+f.reportCount+' different people within an hour'
        : f.msgCount+' msgs / 30s';
      const resolvedBadge = f.resolved ? '<span style="font-size:10px;background:var(--success-soft);color:var(--success);padding:2px 6px;border-radius:999px;margin-left:6px">Resolved</span>' : '';
      return `<div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">#${esc(String(f.number))} ${esc(f.name||'')}${resolvedBadge}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${typeLabel} · ${esc(detail)} · ${esc(when)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${(!f.resolved&&hasPermission('spam_resolve'))?`<button class="btn btn-ghost btn-sm" data-key="${esc(f._key)}" onclick="resolveSpamFlag(this.dataset.key,this)">Dismiss</button>`:''}
          ${hasPermission('users_ban')?`<button class="btn btn-ghost btn-sm" style="color:var(--danger)" data-number="${f.number}" onclick="adminBan(Number(this.dataset.number))">Ban</button>`:''}
        </div>
      </div>`;
    }).join('');
    body.innerHTML = `<div style="padding:0 4px"><div style="font-size:12px;color:var(--muted);margin-bottom:8px">${flags.length} flag(s) — most recent first</div>${rows}</div>`;
  }catch(e){
    body.innerHTML = '<div style="color:var(--danger);padding:16px">Failed to load spam reports: '+esc(e.message||String(e))+'</div>';
  }
}

async function resolveSpamFlag(key, btn){
  if(!requirePermission('spam_resolve')) return;
  if(btn) btn.disabled = true;
  try{
    await fbdb.ref('spam_flags/'+key+'/resolved').set(true);
    await fbdb.ref('spam_flags/'+key+'/resolvedAt').set(Date.now());
    showToast('Dismissed','');
    renderAdminSpamTab();
  }catch(e){
    if(btn) btn.disabled = false;
    showToast('Failed', e.message||'');
  }
}

// ── MODERATION SLA DASHBOARD ─────────────────────────────────────────────────
const MODERATION_SLA_TARGET_MS = 24*60*60*1000; // 24h response target
function _moderationSlaStats(items){
  // items: [{time, resolvedAt, status/resolved}]
  const now=Date.now();
  const open=items.filter(i=>!i._isResolved);
  const resolved=items.filter(i=>i._isResolved && i.resolvedAt && i.time);
  const resolveTimes=resolved.map(i=>i.resolvedAt-i.time).filter(ms=>ms>=0);
  const avgMs=resolveTimes.length?resolveTimes.reduce((a,b)=>a+b,0)/resolveTimes.length:null;
  const withinSla=resolveTimes.filter(ms=>ms<=MODERATION_SLA_TARGET_MS).length;
  const slaPct=resolveTimes.length?Math.round(withinSla/resolveTimes.length*100):null;
  const oldestOpenMs=open.length?Math.max(...open.map(i=>now-(i.time||now))):0;
  const overdueOpen=open.filter(i=>i.time&&(now-i.time)>MODERATION_SLA_TARGET_MS).length;
  return { openCount:open.length, resolvedCount:resolved.length, avgMs, slaPct, oldestOpenMs, overdueOpen };
}
function _fmtDuration(ms){
  if(ms==null) return '—';
  const h=ms/3600000;
  if(h<1) return Math.round(ms/60000)+'m';
  if(h<48) return h.toFixed(1)+'h';
  return (h/24).toFixed(1)+'d';
}
async function renderAdminModerationSlaTab(){
  if(!hasPermission('reports_view')){ const b=document.getElementById('admin-dashboard-body'); if(b) b.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted)">Access denied.</div>'; return; }
  const body=document.getElementById('admin-dashboard-body');
  body.innerHTML='<div style="padding:10px;color:var(--muted)">Loading moderation SLA stats…</div>';
  try{
    const [reports, spamSnap]=await Promise.all([
      getReports().catch(()=>[]),
      fbdb.ref('spam_flags').orderByChild('at').limitToLast(200).get().catch(()=>({exists:()=>false})),
    ]);
    const reportItems=(reports||[]).map(r=>({ time:r.time, resolvedAt:r.resolvedAt, _isResolved:r.status==='resolved' }));
    const spamItems=[];
    if(spamSnap && spamSnap.exists && spamSnap.exists()) spamSnap.forEach(child=>{ const v=child.val(); spamItems.push({ time:v.at, resolvedAt:v.resolvedAt, _isResolved:!!v.resolved }); });

    const reportStats=_moderationSlaStats(reportItems);
    const spamStats=_moderationSlaStats(spamItems);
    const combinedStats=_moderationSlaStats(reportItems.concat(spamItems));

    const card=(label,value,sub,color)=>`<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:12px 14px">
      <div style="font-size:22px;font-weight:700;${color?`color:${color}`:''}">${value}</div>
      <div style="font-size:11px;color:var(--text2);font-weight:600">${label}</div>
      ${sub?`<div style="font-size:10px;color:var(--muted);margin-top:2px">${sub}</div>`:''}
    </div>`;

    const section=(title,stats)=>`
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:8px">${title}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px">
        ${card('Open now',stats.openCount,stats.overdueOpen?stats.overdueOpen+' overdue (>24h)':'',stats.overdueOpen?'var(--danger)':undefined)}
        ${card('Avg. time to resolve',_fmtDuration(stats.avgMs),stats.resolvedCount+' resolved on record')}
        ${card('Resolved within 24h',stats.slaPct==null?'—':stats.slaPct+'%','SLA target: 24h')}
        ${card('Oldest open item',stats.openCount?_fmtDuration(stats.oldestOpenMs):'—','age of the longest-waiting open item')}
      </div>`;

    body.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:11px;color:var(--muted)">Response-time health for reports &amp; spam flags — refreshes each time you open this tab</div>
        <button class="btn btn-ghost btn-sm" onclick="renderAdminModerationSlaTab()">↻ Refresh</button>
      </div>
      ${section('Combined (reports + spam flags)',combinedStats)}
      ${section('User reports',reportStats)}
      ${section('Automated spam flags',spamStats)}
      ${combinedStats.overdueOpen?`<div style="padding:10px 12px;border:1px solid var(--danger);border-radius:var(--r-sm);background:rgba(220,50,50,0.07);font-size:12px;color:var(--danger)">⚠️ ${combinedStats.overdueOpen} item(s) have been open for more than 24 hours and need attention.</div>`:''}
    `;
  }catch(e){
    selfHeal('SCB-ADMIN-23', e, { context: 'renderAdminModerationSlaTab' });
    body.innerHTML='<div style="padding:10px;color:var(--danger)">'+esc(scbErr('SCB-ADMIN-23','The moderation SLA stats couldn\'t be loaded.',(e&&e.message)||''))+'</div>';
  }
}

// ---- Check Turnstile token in submitSetup (patched after DOMContentLoaded) -
document.addEventListener('DOMContentLoaded', ()=>{
  const _origSubmitSetup = typeof submitSetup === 'function' ? submitSetup : null;
  if(!_origSubmitSetup) return;
  submitSetup = async function(){
    const err = document.getElementById('setup-error');
    // Only require Turnstile on signup (not login)
    const signupView = document.getElementById('signup-view');
    if(!signupView || signupView.style.display !== 'none'){
      if(!_turnstileToken){
        if(err) err.textContent = scbErr('SCB-SIGNUP-CAP','Please complete the security check.');
        return;
      }
    }
    return _origSubmitSetup.apply(this, arguments);
  };
});

/* =============================================================================
   11. MULTI-LANGUAGE SUPPORT (i18n)
   Covers the main chrome — nav, sidebar tabs, settings headings and the
   buttons/notices people see most. It deliberately does NOT try to translate
   every string in the file; untranslated strings stay in English rather than
   being machine-mangled.
   ========================================================================== */
const I18N = {
  en:{_name:'English',
    tab_chats:'Chats', tab_groups:'Groups', tab_archived:'Archived', tab_favourites:'★ Favourites',
    tab_calls:'📞 Calls', tab_unread:'Unread',
    settings:'Settings', profile:'Profile', appearance:'Appearance', messaging:'Messaging',
    notifications:'Notifications', security:'Security', account:'Account', language:'Language',
    theme_colors:'Theme Colours', primary_color:'Primary colour', secondary_color:'Secondary colour',
    reset:'Reset', save:'Save', cancel:'Cancel', close:'Close', open:'Open', enable:'Enable', disable:'Disable',
    send:'Send', log_out:'Log Out', delete_account:'Delete Account',
    system_status:'System Status', recheck_now:'Recheck now', last_checked:'Last checked',
    rules:'Rules & Guidelines', meetings:'Meetings', start_meeting:'Start Meeting', join_meeting:'Join Meeting',
    leave_meeting:'Leave', mute:'Mute', unmute:'Unmute', camera:'Camera', share_screen:'Share screen',
    stop_sharing:'Stop sharing', chat:'Chat', suggestions:'Suggestions',
    favourites:'Favourites', add_favourite:'Add to Favourites', remove_favourite:'Remove from Favourites',
    suspicious_msg:'This message looks suspicious', show_anyway:'Show anyway',
    restricted:'This is restricted on your account', forgot_password:'Forgot password?',
    parent_controls:'Manage Child Accounts', linked_accounts:'Manage Linked Accounts',
    large_text:'Simplified, larger text', type_message:'Type a message…',
    voice_call:'Voice call', missed_call:'Missed call', call_back:'Call back',
    no_calls:'No call history yet.', no_unread:'You\'re all caught up! ✅'},
  es:{_name:'Español',
    tab_chats:'Chats', tab_groups:'Grupos', tab_archived:'Archivados', tab_favourites:'★ Favoritos',
    tab_calls:'📞 Llamadas', tab_unread:'No leídos',
    settings:'Ajustes', profile:'Perfil', appearance:'Apariencia', messaging:'Mensajería',
    notifications:'Notificaciones', security:'Seguridad', account:'Cuenta', language:'Idioma',
    theme_colors:'Colores del tema', primary_color:'Color principal', secondary_color:'Color secundario',
    reset:'Restablecer', save:'Guardar', cancel:'Cancelar', close:'Cerrar', open:'Abrir', enable:'Activar', disable:'Desactivar',
    send:'Enviar', log_out:'Cerrar sesión', delete_account:'Eliminar cuenta',
    system_status:'Estado del sistema', recheck_now:'Comprobar de nuevo', last_checked:'Última comprobación',
    rules:'Normas y directrices', meetings:'Reuniones', start_meeting:'Iniciar reunión', join_meeting:'Unirse a la reunión',
    leave_meeting:'Salir', mute:'Silenciar', unmute:'Activar micrófono', camera:'Cámara', share_screen:'Compartir pantalla',
    stop_sharing:'Dejar de compartir', chat:'Chat', suggestions:'Sugerencias',
    favourites:'Favoritos', add_favourite:'Añadir a favoritos', remove_favourite:'Quitar de favoritos',
    suspicious_msg:'Este mensaje parece sospechoso', show_anyway:'Mostrar de todos modos',
    restricted:'Esto está restringido en tu cuenta', forgot_password:'¿Olvidaste tu contraseña?',
    parent_controls:'Gestionar cuentas infantiles', linked_accounts:'Gestionar cuentas vinculadas',
    large_text:'Texto más grande y sencillo', type_message:'Escribe un mensaje…',
    voice_call:'Llamada de voz', missed_call:'Llamada perdida', call_back:'Devolver llamada',
    no_calls:'Aún no hay historial de llamadas.', no_unread:'¡Estás al día! ✅'},
  fr:{_name:'Français',
    tab_chats:'Discussions', tab_groups:'Groupes', tab_archived:'Archivés', tab_favourites:'★ Favoris',
    tab_calls:'📞 Appels', tab_unread:'Non lus',
    settings:'Paramètres', profile:'Profil', appearance:'Apparence', messaging:'Messagerie',
    notifications:'Notifications', security:'Sécurité', account:'Compte', language:'Langue',
    theme_colors:'Couleurs du thème', primary_color:'Couleur principale', secondary_color:'Couleur secondaire',
    reset:'Réinitialiser', save:'Enregistrer', cancel:'Annuler', close:'Fermer', open:'Ouvrir', enable:'Activer', disable:'Désactiver',
    send:'Envoyer', log_out:'Se déconnecter', delete_account:'Supprimer le compte',
    system_status:'État du système', recheck_now:'Vérifier à nouveau', last_checked:'Dernière vérification',
    rules:'Règles et directives', meetings:'Réunions', start_meeting:'Démarrer une réunion', join_meeting:'Rejoindre la réunion',
    leave_meeting:'Quitter', mute:'Couper le micro', unmute:'Activer le micro', camera:'Caméra', share_screen:'Partager l\'écran',
    stop_sharing:'Arrêter le partage', chat:'Discussion', suggestions:'Suggestions',
    favourites:'Favoris', add_favourite:'Ajouter aux favoris', remove_favourite:'Retirer des favoris',
    suspicious_msg:'Ce message semble suspect', show_anyway:'Afficher quand même',
    restricted:'Ceci est restreint sur votre compte', forgot_password:'Mot de passe oublié ?',
    parent_controls:'Gérer les comptes enfants', linked_accounts:'Gérer les comptes liés',
    large_text:'Texte simplifié et plus grand', type_message:'Écrivez un message…',
    voice_call:'Appel vocal', missed_call:'Appel manqué', call_back:'Rappeler',
    no_calls:'Aucun historique d\'appels.', no_unread:'Vous êtes à jour ! ✅'},
  de:{_name:'Deutsch',
    tab_chats:'Chats', tab_groups:'Gruppen', tab_archived:'Archiviert', tab_favourites:'★ Favoriten',
    tab_calls:'📞 Anrufe', tab_unread:'Ungelesen',
    settings:'Einstellungen', profile:'Profil', appearance:'Darstellung', messaging:'Nachrichten',
    notifications:'Benachrichtigungen', security:'Sicherheit', account:'Konto', language:'Sprache',
    theme_colors:'Themenfarben', primary_color:'Primärfarbe', secondary_color:'Sekundärfarbe',
    reset:'Zurücksetzen', save:'Speichern', cancel:'Abbrechen', close:'Schließen', open:'Öffnen', enable:'Aktivieren', disable:'Deaktivieren',
    send:'Senden', log_out:'Abmelden', delete_account:'Konto löschen',
    system_status:'Systemstatus', recheck_now:'Erneut prüfen', last_checked:'Zuletzt geprüft',
    rules:'Regeln & Richtlinien', meetings:'Meetings', start_meeting:'Meeting starten', join_meeting:'Meeting beitreten',
    leave_meeting:'Verlassen', mute:'Stummschalten', unmute:'Stummschaltung aufheben', camera:'Kamera', share_screen:'Bildschirm teilen',
    stop_sharing:'Teilen beenden', chat:'Chat', suggestions:'Vorschläge',
    favourites:'Favoriten', add_favourite:'Zu Favoriten hinzufügen', remove_favourite:'Aus Favoriten entfernen',
    suspicious_msg:'Diese Nachricht sieht verdächtig aus', show_anyway:'Trotzdem anzeigen',
    restricted:'Das ist für dein Konto gesperrt', forgot_password:'Passwort vergessen?',
    parent_controls:'Kinderkonten verwalten', linked_accounts:'Verknüpfte Konten verwalten',
    large_text:'Vereinfachter, größerer Text', type_message:'Nachricht schreiben…',
    voice_call:'Sprachanruf', missed_call:'Verpasster Anruf', call_back:'Zurückrufen',
    no_calls:'Noch kein Anrufverlauf.', no_unread:'Alles gelesen! ✅'}
};
let _scbLang = localStorage.getItem('cc_language') || 'en';
function getLanguage(){ return I18N[_scbLang] ? _scbLang : 'en'; }
function scbT(key){
  const lang = I18N[getLanguage()] || I18N.en;
  return (lang && lang[key]) || I18N.en[key] || key;
}
function setLanguage(code){
  if(!I18N[code]) code='en';
  _scbLang = code;
  try{ localStorage.setItem('cc_language', code); }catch(e){}
  if(me){ me.language = code; try{ saveStorage(); }catch(e){} }
  applyLanguage();
  // Re-render all dynamic UI so translated strings appear everywhere
  try{ if(typeof updateSettingsPanel==='function') updateSettingsPanel(); }catch(e){}
  try{ if(typeof renderSidebar==='function') renderSidebar(); }catch(e){}
  try{ if(typeof renderMyCard==='function') renderMyCard(); }catch(e){}
  try{ if(typeof _renderBizSettings==='function') _renderBizSettings(); }catch(e){}
  // Keep the language select in sync
  try{ const sel=document.getElementById('scb-language-select'); if(sel) sel.value=code; }catch(e){}
  showToast(scbT('language'), I18N[code]._name);
}
// Anything carrying data-i18n gets its text swapped; placeholders use
// data-i18n-ph. Elements added later just call applyLanguage() again.
function applyLanguage(){
  try{
    document.querySelectorAll('[data-i18n]').forEach(el=>{
      const k=el.getAttribute('data-i18n'); if(k) el.textContent=scbT(k);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el=>{
      const k=el.getAttribute('data-i18n-ph'); if(k) el.setAttribute('placeholder', scbT(k));
    });
    document.documentElement.setAttribute('lang', getLanguage());
  }catch(e){ console.warn('applyLanguage failed', e); }
}

/* =============================================================================
   2. CUSTOMIZATION — PRIMARY / SECONDARY THEME COLOURS
   The app's chrome already reads --accent / --accent2 / --accent-grad, so
   setting those on :root re-skins buttons, bubbles, pills and badges live with
   no reload. A small injected stylesheet covers the handful of places that
   hardcode a gradient inline (avatars, group avatars, the chat header avatar).
   ========================================================================== */
const SCB_DEFAULT_COLORS = { primary:'#5A52D5', secondary:'#7C5FD4' };
function _scbShade(hex, pct){
  try{
    const h=String(hex).replace('#','');
    const n=parseInt(h.length===3?h.split('').map(c=>c+c).join(''):h,16);
    let r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    r=Math.max(0,Math.min(255,Math.round(r+(pct/100)*255)));
    g=Math.max(0,Math.min(255,Math.round(g+(pct/100)*255)));
    b=Math.max(0,Math.min(255,Math.round(b+(pct/100)*255)));
    return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
  }catch(e){ return hex; }
}
function getThemeColors(){
  const stored = scbLoad('cc_theme_colors', null);
  if(stored && stored.primary && stored.secondary) return stored;
  if(me && me.themeColors && me.themeColors.primary) return me.themeColors;
  return null;
}
function applyThemeColors(primary, secondary){
  if(!primary) return;
  secondary = secondary || primary;
  const root = document.documentElement;
  root.style.setProperty('--accent', primary);
  root.style.setProperty('--accent2', secondary);
  root.style.setProperty('--accent-hover', _scbShade(primary, 8));
  root.style.setProperty('--accent-grad', 'linear-gradient(135deg,'+primary+' 0%,'+secondary+' 100%)');
  root.style.setProperty('--accent-bright', _scbShade(primary, 16));
  document.body.classList.add('scb-custom-colors');
  markThemePreset(primary, secondary);
}
// One-tap colour themes. The first entry is the app's default.
const SCB_THEME_PRESETS = [
  ['Classic', SCB_DEFAULT_COLORS.primary, SCB_DEFAULT_COLORS.secondary],
  ['Ocean',   '#0a6fb8', '#0e8f8a'],
  ['Forest',  '#1f7a45', '#4d7c0f'],
  ['Sunset',  '#c2410c', '#be185d'],
  ['Rose',    '#be185d', '#9333ea'],
  ['Midnight','#3949ab', '#1e293b'],
  ['Slate',   '#475569', '#64748b']
];
function markThemePreset(primary, secondary){
  document.querySelectorAll('.scb-preset').forEach(b=>{
    const on=b.dataset.colors===(primary+','+secondary).toLowerCase();
    b.setAttribute('aria-pressed', on?'true':'false');
  });
}
function renderThemePresets(){
  const box=document.getElementById('scb-presets');
  if(!box) return;
  box.innerHTML='';
  SCB_THEME_PRESETS.forEach(([name,primary,secondary],i)=>{
    const b=document.createElement('button');
    b.type='button'; b.className='scb-preset'; b.title=name;
    b.setAttribute('aria-label', name+' theme');
    b.dataset.colors=(primary+','+secondary).toLowerCase();
    b.style.background='linear-gradient(135deg,'+primary+','+secondary+')';
    b.onclick=()=>{
      if(i===0){ resetThemeColors(); return; }
      document.getElementById('scb-primary-color').value=primary;
      document.getElementById('scb-secondary-color').value=secondary;
      saveThemeColors();
    };
    box.appendChild(b);
  });
  const c=getThemeColors()||SCB_DEFAULT_COLORS;
  markThemePreset(c.primary, c.secondary);
}
function saveThemeColors(){
  const p=document.getElementById('scb-primary-color');
  const s=document.getElementById('scb-secondary-color');
  if(!p||!s) return;
  const colors={primary:p.value, secondary:s.value};
  scbSave('cc_theme_colors', colors);
  if(me){
    me.themeColors=colors;
    try{ saveStorage(); }catch(e){}
    // Persist to the account record the same way every other per-account
    // setting here does, so it follows the user to their other devices.
    registerOrUpdate().catch(e=>console.warn('theme colour sync failed', e));
  }
  applyThemeColors(colors.primary, colors.secondary);
  showToast(scbT('theme_colors'), 'Applied.');
}
function resetThemeColors(){
  try{ localStorage.removeItem('cc_theme_colors'); }catch(e){}
  if(me){ me.themeColors=null; try{ saveStorage(); }catch(e){} }
  const root=document.documentElement;
  ['--accent','--accent2','--accent-hover','--accent-grad','--accent-bright'].forEach(v=>root.style.removeProperty(v));
  document.body.classList.remove('scb-custom-colors');
  const p=document.getElementById('scb-primary-color'), s=document.getElementById('scb-secondary-color');
  if(p) p.value=SCB_DEFAULT_COLORS.primary;
  if(s) s.value=SCB_DEFAULT_COLORS.secondary;
  markThemePreset(SCB_DEFAULT_COLORS.primary, SCB_DEFAULT_COLORS.secondary);
  showToast(scbT('theme_colors'), 'Reset to default.');
}
function initThemeColors(){
  const c=getThemeColors();
  const p=document.getElementById('scb-primary-color'), s=document.getElementById('scb-secondary-color');
  if(c){
    applyThemeColors(c.primary, c.secondary);
    if(p) p.value=c.primary;
    if(s) s.value=c.secondary;
  }else{
    if(p) p.value=SCB_DEFAULT_COLORS.primary;
    if(s) s.value=SCB_DEFAULT_COLORS.secondary;
  }
}

/* =============================================================================
   3. FAVOURITES (chats and groups)
   Stored exactly like mute/archive: a {convoKey:true} map in localStorage,
   toggled from the chat header menu and the sidebar context menu, with its own
   filter tab at the top of the chat list.
   ========================================================================== */
let favoriteChats = scbLoad('cc_favorites', {});
function saveFavorites(){ scbSave('cc_favorites', favoriteChats); }
function isFavorite(key){ return !!favoriteChats[key]; }
function toggleFavoriteKey(key, name){
  if(!key) return;
  if(favoriteChats[key]){ delete favoriteChats[key]; showToast(scbT('remove_favourite'), name||''); }
  else { favoriteChats[key]=true; showToast(scbT('add_favourite'), name||''); }
  saveFavorites();
  updateFavoriteMenuItem();
  renderSidebar();
}
function favoriteToggle(){
  if(!activeConvo) return;
  toggleFavoriteKey(activeConvo.key, activeConvo.name);
}
function favoriteContactFromCtx(){
  if(typeof ctxContact==='undefined' || !ctxContact || !me) return;
  const key = ctxContact.key || dmKey(me.number, ctxContact.number);
  toggleFavoriteKey(key, ctxContact.name);
}
function updateFavoriteMenuItem(){
  const item=document.getElementById('favorite-menu-item');
  if(item) item.textContent = (activeConvo && isFavorite(activeConvo.key)) ? ('★ '+scbT('remove_favourite')) : ('☆ '+scbT('add_favourite'));
  const ctxItem=document.getElementById('favorite-ctx-item');
  if(ctxItem && typeof ctxContact!=='undefined' && ctxContact && me){
    const key=ctxContact.key||dmKey(me.number, ctxContact.number);
    ctxItem.textContent = isFavorite(key) ? ('★ '+scbT('remove_favourite')) : ('☆ '+scbT('add_favourite'));
  }
}

// Sidebar re-implemented (rather than wrapped) so the favourites filter and the
// per-row star can be part of the same single render pass.
// (original renderSidebar is fully replaced below rather than wrapped)
renderSidebar = function(){
  const list=document.getElementById('sb-list');
  if(!list) return;
  list.innerHTML='';
  if(!me){ list.innerHTML='<div class="section-empty">Set up your account first.</div>'; return; }

  // ── Calls tab ──────────────────────────────────────────────────────────────
  if(currentTab==='calls'){
    const log=getCallLog().slice().reverse();
    if(!log.length){ list.innerHTML='<div class="section-empty">'+esc(scbT('no_calls'))+'</div>'; return; }
    log.forEach(entry=>{
      const num=entry.number||entry.from||0;
      const name=entry.name||entry.fromName||('#'+num);
      const _badDir=entry.dir==='missed'||entry.dir==='declined_out'||entry.dir==='declined_in'||entry.dir==='no_answer'||entry.dir==='cancelled';
      const icon=entry.dir==='in'?'📲':_badDir?'📞':'📤';
      const color=_badDir?'color:#e74c3c':'';
      const durStr=fmtCallDuration(entry.duration||0);
      const timeStr=entry.time?new Date(entry.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
      const dirLabel=entry.dir==='missed'?scbT('missed_call'):entry.dir==='declined_out'?'Declined':entry.dir==='declined_in'?'You declined':entry.dir==='no_answer'?'No answer':entry.dir==='cancelled'?'Cancelled':entry.dir==='in'?'Incoming':'Outgoing';
      const metaStr=[dirLabel,durStr,timeStr].filter(Boolean).join(' · ');
      const div=document.createElement('div'); div.className='call-log-item';
      div.innerHTML='<div class="call-log-icon" style="'+color+'">'+icon+'</div>'
        +'<div class="call-log-info"><div class="call-log-name" style="'+color+'">'+esc(name)+'</div>'
        +'<div class="call-log-meta">'+esc(metaStr)+'</div></div>'
        +'<button class="call-log-callback" data-number="'+num+'" data-act="callLogCallback">'+esc(scbT('call_back'))+'</button>';
      list.appendChild(div);
    });
    return;
  }

  // ── Unread tab ─────────────────────────────────────────────────────────────
  if(currentTab==='unread'){
    const unreadItems=[];
    contacts.forEach(c=>{
      const key=c.key||dmKey(me.number,c.number);
      if(archivedContacts[key]) return;
      const conv=convosCache?convosCache.find(x=>x&&x.key===key):null;
      if(!conv||!conv.messages) return;
      const unread=conv.messages.filter(m=>m&&m.from!==me.number&&m.type!=='call'&&m.type!=='system'&&(!m.seen||!m.seen.includes(me.number))&&!_isLocallySeen(m.id)).length;
      if(unread>0) unreadItems.push({c,unread,key,conv});
    });
    unreadItems.sort((a,b)=>b.unread-a.unread);
    if(!unreadItems.length){ list.innerHTML='<div class="section-empty">'+esc(scbT('no_unread'))+'</div>'; return; }
    unreadItems.forEach(({c,unread,key,conv})=>{
      const isActive=activeConvo&&activeConvo.key===key;
      const lastMsg=conv.messages.length?conv.messages[conv.messages.length-1]:null;
      const preview=lockedChats[key]?'🔒 Locked chat':lastMsg?(lastMsg.gif?'🖼 GIF':lastMsg.type==='ping'?'🔔 Ping':(msgText(lastMsg)||'')).substring(0,32):'';
      const timeStr=lastMsg?fmtTime(lastMsg.time):'';
      const online=c.type!=='group'?isOnline((lookupUser(c.number)||{}).lastSeen):false;
      const div=document.createElement('div'); div.className='sb-item unread'+(isActive?' active':'');
      div.onclick=()=>openChat(c);
      const _freshU0=c.type!=='group'?lookupUser(c.number):null;
      const _liveAv0=(_freshU0&&_freshU0.avatar)||c.avatar||'';
      const hasImg=typeof _liveAv0==='string'&&(_liveAv0.startsWith('data:image/')||_liveAv0.startsWith('https://'));
      const avDiv=c.type==='group'
        ?'<div class="group-avatar" style="background:'+(c.isServer?'linear-gradient(135deg,#5865f2,#3ba55d)':'var(--accent)')+';color:#fff;font-size:16px;">'+(c.avatar?'<img src="'+esc(c.avatar)+'" style="width:100%;height:100%;object-fit:cover;">':(c.isServer?'🖥️':'👥'))+'</div>'
        :'<div style="position:relative"><div class="avatar" style="width:38px;height:38px;font-size:14px;background:var(--accent);color:#fff;'+(hasImg?'background:none;':'')+'">'+(hasImg?'<img src="'+esc(_liveAv0)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">':esc((c.name||'?').charAt(0).toUpperCase()))+'</div><div class="'+(online?'online-ring':'offline-ring')+'"></div></div>';
      div.innerHTML=avDiv+'<div class="sb-item-info"><div class="sb-item-top"><span class="sb-item-name">'+esc(c.name)+'</span><span class="sb-item-time">'+esc(timeStr)+'</span></div>'
        +'<div class="sb-item-preview">'+esc(preview)+'</div></div>'
        +renderUnreadBadgeHtml(unread);
      list.appendChild(div);
    });
    return;
  }

  // ── Standard tabs ──────────────────────────────────────────────────────────
  let items=contacts.filter(c=>{
    const key=c.key||dmKey(me.number,c.number);
    const isArchived=archivedContacts[key];
    if(currentTab==='favourites') return isFavorite(key) && !isArchived;
    if(currentTab==='archived') return isArchived;
    if(currentTab==='chats') return !isArchived&&c.type!=='group';
    if(currentTab==='groups') return !isArchived&&c.type==='group'&&!c.isServer;
    if(currentTab==='servers') return !isArchived&&c.type==='group'&&!!c.isServer;
    return false;
  });
  if(searchQ){ items=items.filter(c=>c.name.toLowerCase().includes(searchQ.toLowerCase())||(c.number&&String(c.number).includes(searchQ))); }
  if(!items.length){
    const empty = currentTab==='favourites' ? 'No favourites yet — tap the ☆ next to a chat.'
      : currentTab==='archived' ? 'No archived chats.'
      : currentTab==='groups' ? 'No groups yet.'
      : currentTab==='servers' ? 'No servers yet — create one or join with an invite code.' : 'No contacts yet.';
    list.innerHTML='<div class="section-empty">'+esc(empty)+'</div>';
    return;
  }
  items.forEach(c=>{
    const key=c.key||dmKey(me.number,c.number);
    const isActive=activeConvo&&activeConvo.key===key;
    const conv=convosCache?convosCache.find(x=>x&&x.key===key):null;
    const lastMsg=conv&&conv.messages&&conv.messages.length?conv.messages[conv.messages.length-1]:null;
    const preview=lockedChats[key]?'🔒 Locked chat':lastMsg?(lastMsg.gif?'🖼 GIF':lastMsg.type==='ping'?'🔔 Ping':lastMsg.type==='call'?'📞 '+scbT(lastMsg.missed?'missed_call':'voice_call'):(msgText(lastMsg)||'')).substring(0,32):'';
    const timeStr=lastMsg?fmtTime(lastMsg.time):'';
    const online=c.type!=='group'?isOnline((lookupUser(c.number)||{}).lastSeen):false;
    const inCall=c.type!=='group'&&_numbersInActiveCall.has(Number(c.number));
    const div=document.createElement('div');
    const unread=(!isActive&&conv&&conv.messages)?conv.messages.filter(m=>m&&m.from!==me.number&&m.type!=='call'&&m.type!=='system'&&(!m.seen||!m.seen.includes(me.number))&&!_isLocallySeen(m.id)).length:0;
    div.className='sb-item'+(isActive?' active':'')+(unread?' unread':'');
    div.onclick=()=>openChat(c);
    div.oncontextmenu=(e)=>{e.preventDefault();showContactCtxMenu(e,c);};
    const _freshU=c.type!=='group'?lookupUser(c.number):null;
    const _liveAv=(_freshU&&_freshU.avatar)||c.avatar||'';
    const hasImg = typeof _liveAv==='string' && (_liveAv.startsWith('data:image/')||_liveAv.startsWith('https://'));
    const avDiv = c.type==='group'
      ? '<div class="group-avatar" style="background:'+(c.isServer?'linear-gradient(135deg,#5865f2,#3ba55d)':'var(--accent)')+';color:#fff;font-size:16px;">'+(c.avatar?'<img src="'+esc(c.avatar)+'" style="width:100%;height:100%;object-fit:cover;">':(c.isServer?'🖥️':'👥'))+'</div>'
      : '<div style="position:relative"><div class="avatar" style="width:38px;height:38px;font-size:14px;background:var(--accent);color:#fff;'+(hasImg?'background:none;':'')+'">'+(hasImg?'<img src="'+esc(_liveAv)+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">':esc((c.name||'?').charAt(0).toUpperCase()))+'</div><div class="'+(online?'online-ring':'offline-ring')+'"></div></div>';
    div.innerHTML = avDiv +
      '<div class="sb-item-info"><div class="sb-item-top"><span class="sb-item-name">'+esc(c.name)+
      (c.type!=='group'?verifiedBadge(c.number)+equippedBadgeHtml(c.number):'')+
      (inCall?' <span title="In a call now" style="color:var(--success)">☎</span>':'')+
      '</span><span class="sb-item-time">'+esc(timeStr)+'</span></div>'+
      '<div class="sb-item-preview">'+esc(preview)+'</div></div>'+
      renderUnreadBadgeHtml(unread)+
      '<span class="sb-fav-star'+(isFavorite(key)?' on':'')+'" title="'+(isFavorite(key)?esc(scbT('remove_favourite')):esc(scbT('add_favourite')))+'">'+(isFavorite(key)?'★':'☆')+'</span>';
    const star=div.querySelector('.sb-fav-star');
    if(star) star.onclick=(e)=>{ e.stopPropagation(); toggleFavoriteKey(key, c.name); };
    list.appendChild(div);
  });
};

/* =============================================================================
   4. TABS — up to MAX_OPEN_TABS conversations open at once
   ========================================================================== */
const MAX_OPEN_TABS = 20;
// Array.isArray guard: a corrupt cc_open_tabs value used to throw here, and
// because this runs at the top level it took the whole feature script with it.
let openTabs = (()=>{ const v=scbLoad('cc_open_tabs', []); return Array.isArray(v)?v.filter(x=>x&&x.key).slice(0, MAX_OPEN_TABS):[]; })();
let activeTabKey = null;
function saveOpenTabs(){ scbSave('cc_open_tabs', openTabs); }
function tabLabelFor(c){
  const n=(c&&c.name)||'';
  if(n) return n.length>14 ? n.slice(0,13)+'…' : n;
  return '#'+((c&&c.number)||'');
}
function addTabFor(c){
  if(!c || !me) return true;
  const key=c.key||dmKey(me.number,c.number);
  const existing=openTabs.find(x=>x.key===key);
  if(existing){ activeTabKey=key; renderTabBar(); return true; }
  if(openTabs.length>=MAX_OPEN_TABS){
    showToast('Too many tabs open', scbErr('SCB-MSG-19','You can have '+MAX_OPEN_TABS+' conversations open at once — close one first.'));
    return false;
  }
  openTabs.push({key, name:c.name||('#'+(c.number||'')), type:c.type||'dm', number:c.number||null});
  activeTabKey=key;
  saveOpenTabs(); renderTabBar();
  return true;
}
function closeTab(key, ev){
  if(ev) ev.stopPropagation();
  openTabs=openTabs.filter(x=>x.key!==key);
  saveOpenTabs();
  if(activeTabKey===key){
    activeTabKey=null;
    if(activeConvo && activeConvo.key===key){
      const next=openTabs[openTabs.length-1];
      if(next) switchToTab(next.key);
      else { activeConvo=null; hideAll(); showMainEmpty(); }
    }
  }
  renderTabBar();
}
function switchToTab(key){
  const tab=openTabs.find(x=>x.key===key);
  if(!tab) return;
  activeTabKey=key;
  const c = contacts.find(x=>(x.key||(me?dmKey(me.number,x.number):''))===key);
  if(c) openChat(c);
  else { showToast('Chat unavailable', scbErr('SCB-MSG-20','That conversation is no longer in your list.')); closeTab(key); }
  renderTabBar();
}
function renderTabBar(){
  const bar=document.getElementById('scb-tab-bar');
  if(!bar) return;
  if(!openTabs.length){ bar.style.display='none'; bar.innerHTML=''; return; }
  bar.style.display='flex';
  bar.innerHTML='';
  openTabs.forEach(tab=>{
    const el=document.createElement('div');
    el.className='scb-tab'+((activeConvo&&activeConvo.key===tab.key)?' active':'');
    el.title=tab.name||'';
    el.innerHTML='<span class="scb-tab-label">'+esc(tabLabelFor(tab))+'</span><span class="scb-tab-close" title="Close">×</span>';
    el.onclick=()=>switchToTab(tab.key);
    el.querySelector('.scb-tab-close').onclick=(e)=>closeTab(tab.key, e);
    bar.appendChild(el);
  });
}

/* =============================================================================
   1. TYPING SUGGESTIONS
   Two sources, both local: the words/short phrases this user actually uses in
   the open conversation (frequency map built from convosCache), and a small
   fixed list of common replies. Debounced so it doesn't run per keystroke.
   ========================================================================== */
const COMMON_PHRASES = ['Sounds good','On my way','Thanks!','Talk soon','Be right back','Sure thing','See you then','No worries','Good morning','Good night','Let me check','Will do'];
let _suggestTimer=null;
let _suggestFreqCache={key:null, phrases:[]};
const SUGGEST_STOPWORDS = new Set(['the','a','an','and','or','but','to','of','in','on','at','is','it','i','you','we','my','me','so','do','be','for','that','this','with','was','are','he','she','they']);
function buildSuggestionCorpus(convoKey){
  if(_suggestFreqCache.key===convoKey && _suggestFreqCache.phrases.length) return _suggestFreqCache.phrases;
  const phrases=[];
  try{
    const c=(convosCache||[]).find(x=>x&&x.key===convoKey);
    if(c && Array.isArray(c.messages) && me){
      const freq=Object.create(null);
      c.messages.filter(m=>m.from===me.number).slice(-120).forEach(m=>{
        const txt=(msgText(m)||'').trim();
        if(!txt || txt.length>60) return;
        // Whole short messages this user repeats are the best suggestions.
        if(txt.split(/\s+/).length<=5){ const k=txt; freq[k]=(freq[k]||0)+2; }
        txt.split(/\s+/).forEach(w=>{
          const clean=w.replace(/[^A-Za-z''-]/g,'');
          if(clean.length>3 && !SUGGEST_STOPWORDS.has(clean.toLowerCase())) freq[clean]=(freq[clean]||0)+1;
        });
      });
      Object.keys(freq).sort((a,b)=>freq[b]-freq[a]).slice(0,60).forEach(k=>{ if(freq[k]>1) phrases.push(k); });
    }
  }catch(e){ console.warn('suggestion corpus failed', e); }
  _suggestFreqCache={key:convoKey, phrases};
  return phrases;
}
function computeSuggestions(text){
  const raw=String(text||'');
  const trimmed=raw.trim();
  const lastWord=(trimmed.split(/\s+/).pop()||'').toLowerCase();
  const pool=[].concat(buildSuggestionCorpus(activeConvo?activeConvo.key:null), COMMON_PHRASES);
  const out=[];
  const seen=new Set();
  const push=(v)=>{ const k=v.toLowerCase(); if(!seen.has(k)&&out.length<4){ seen.add(k); out.push(v); } };
  if(!trimmed){
    COMMON_PHRASES.slice(0,4).forEach(push);
    return out;
  }
  if(lastWord.length<2) return out;
  // Prefix matches first, then loose contains matches.
  pool.forEach(p=>{ if(p.toLowerCase().startsWith(lastWord) && p.toLowerCase()!==lastWord) push(p); });
  pool.forEach(p=>{ if(p.toLowerCase().includes(lastWord) && p.toLowerCase()!==lastWord) push(p); });
  return out;
}
function renderSuggestionBar(list){
  const bar=document.getElementById('scb-suggest-bar');
  if(!bar) return;
  if(!list || !list.length){ bar.style.display='none'; bar.innerHTML=''; return; }
  bar.innerHTML='';
  list.forEach(s=>{
    const b=document.createElement('button');
    b.type='button';
    b.className='scb-suggest-chip';
    b.textContent=s;              // textContent, never innerHTML — this text can come from message history
    b.onclick=()=>applySuggestion(s);
    bar.appendChild(b);
  });
  bar.style.display='flex';
}
function applySuggestion(s){
  const input=document.getElementById('msg-input');
  if(!input) return;
  const val=input.value;
  const trimmedEnd=val.replace(/\s+$/,'');
  if(!trimmedEnd){ input.value=s+' '; }
  else{
    const parts=trimmedEnd.split(/\s+/);
    const last=parts[parts.length-1]||'';
    if(s.toLowerCase().startsWith(last.toLowerCase())){ parts[parts.length-1]=s; input.value=parts.join(' ')+' '; }
    else { input.value=trimmedEnd+' '+s+' '; }
  }
  if(typeof autoResize==='function') autoResize(input);
  input.focus();
  renderSuggestionBar([]);
}
function scheduleTypingSuggest(el){
  if(_suggestTimer) clearTimeout(_suggestTimer);
  _suggestTimer=setTimeout(()=>{
    try{
      if(!activeConvo){ renderSuggestionBar([]); return; }
      renderSuggestionBar(computeSuggestions(el?el.value:''));
    }catch(e){ console.warn('typing suggestions failed', e); renderSuggestionBar([]); }
  }, 250);
}
const _origOnMsgInput = onMsgInput;
onMsgInput = function(el){
  try{ _origOnMsgInput(el); }catch(e){ console.error('onMsgInput failed', e); }
  scheduleTypingSuggest(el);
};

/* =============================================================================
   8. SPAM / SCAM / PHISHING HEURISTICS
   Deliberately conservative: a message needs a real combination of signals
   before it gets a warning, because a false positive on an ordinary message is
   worse here than missing a borderline one. Nothing is ever blocked — the
   content is one click away behind a banner.
   ========================================================================== */
const SCAM_PATTERNS = [
  {re:/verify (your )?(account|identity|details)/i,           w:2, why:'asks you to "verify your account"'},
  {re:/(claim|collect) (your )?(prize|reward|gift|winnings)/i, w:3, why:'promises a prize or reward'},
  {re:/you'?ve? (won|been selected)/i,                         w:3, why:'claims you have won something'},
  {re:/act now|urgent(ly)?|immediately|within 24 hours|final notice/i, w:2, why:'uses urgency pressure'},
  {re:/(account|card) (has been )?(suspended|locked|limited|closed)/i, w:3, why:'claims your account is suspended'},
  {re:/(send|transfer) (me )?(\$|£|€|\d+\s*(usd|gbp|eur|dollars))/i,  w:2, why:'asks for money'},
  {re:/(seed phrase|private key|wallet address|crypto investment|bitcoin doubl)/i, w:3, why:'crypto-scam wording'},
  {re:/(gift ?card|steam code|itunes code|google play code)/i,  w:2, why:'asks for gift-card codes'},
  {re:/(free|cheap) (robux|v-?bucks|followers|nitro)/i,         w:3, why:'classic "free currency" bait'},
  {re:/(password|otp|one[- ]time code|2fa code|verification code)/i, w:3, why:'asks for a password or login code'},
  {re:/click (here|this link) (now|to)/i,                       w:1, why:'pushes you to click a link'},
  {re:/dear (customer|user|sir\/madam)/i,                       w:1, why:'generic mass-mail greeting'}
];
const SCAM_LOOKALIKE_RE = /[а-яА-ЯΑ-ω]/; // Cyrillic/Greek mixed into Latin text
function assessMessageRisk(text, links){
  const out={suspicious:false, score:0, reasons:[]};
  const s=String(text||'');
  if(!s || s.length<12) return out;
  SCAM_PATTERNS.forEach(p=>{ if(p.re.test(s)){ out.score+=p.w; out.reasons.push(p.why); } });
  const hasLink=/\bhttps?:\/\//i.test(s) || (links&&links.length);
  if(hasLink && out.score>0) out.score+=1;      // a link plus scam wording is the real signal
  // Display text that doesn't match where the link actually goes.
  (links||[]).forEach(a=>{
    try{
      const shown=(a.textContent||'').trim();
      if(/^https?:\/\//i.test(shown)){
        const shownHost=new URL(shown).hostname.replace(/^www\./,'');
        const realHost=new URL(a.href).hostname.replace(/^www\./,'');
        if(shownHost && realHost && shownHost!==realHost){ out.score+=3; out.reasons.push('the link text points somewhere different from the actual link'); }
      }
    }catch(e){}
  });
  // Lookalike characters only count when mixed into otherwise-Latin text.
  if(SCAM_LOOKALIKE_RE.test(s) && /[A-Za-z]{4,}/.test(s) && out.score>0){
    out.score+=2; out.reasons.push('mixes lookalike characters from another alphabet');
  }
  out.suspicious = out.score>=4;   // needs a genuine combination, not one keyword
  return out;
}
let _scamShown = {};   // msgId -> true once the reader chooses "Show anyway"
function scamShowAnyway(msgId, btn){
  if(msgId) _scamShown[msgId]=true;
  const row=btn && btn.closest('.msg-row');
  if(row){
    const hidden=row.querySelector('.scb-scam-hidden');
    if(hidden) hidden.style.display='';
    const warn=row.querySelector('.scb-scam-warn');
    if(warn) warn.remove();
  }
}
// Applied as a post-pass over what renderMessages() just drew, so the large
// existing render function is left untouched.
function applyScamChecks(){
  try{
    const wrap=document.getElementById('messages-wrap');
    if(!wrap) return;
    wrap.querySelectorAll('.msg-row').forEach(row=>{
      if(row.classList.contains('me')) return;
      if(row.getAttribute('data-scam-checked')==='1') return;
      row.setAttribute('data-scam-checked','1');
      const id=row.getAttribute('data-msg-id')||'';
      // Guard on a real id: a blank one would make a single "Show anyway"
      // silently un-warn every other message that also lacks an id.
      if(id && _scamShown[id]) return;
      const bubble=row.querySelector('.bubble');
      if(!bubble) return;
      const links=Array.from(bubble.querySelectorAll('a[href]'));
      const risk=assessMessageRisk(bubble.textContent||'', links);
      if(!risk.suspicious) return;
      bubble.classList.add('scb-scam-hidden');
      bubble.style.display='none';
      const warn=document.createElement('div');
      warn.className='scb-scam-warn';
      warn.innerHTML='<div class="scb-scam-title">⚠️ '+esc(scbT('suspicious_msg'))+'</div>'+
        '<div class="scb-scam-why">'+esc(risk.reasons.slice(0,2).join('; '))+'</div>'+
        '<button type="button" class="scb-scam-btn">'+esc(scbT('show_anyway'))+'</button>';
      warn.querySelector('.scb-scam-btn').onclick=function(){ scamShowAnyway(id, this); };
      const body=row.querySelector('.msg-body')||row;
      body.insertBefore(warn, bubble);
    });
  }catch(e){ console.warn('scam check failed', e); }
}
const _scbPrevRenderMessages = renderMessages;
renderMessages = function(msgs){
  const r=_scbPrevRenderMessages(msgs);
  applyScamChecks();
  return r;
};

/* =============================================================================
   FILE THREAT SCANNING — calls the site's own proxy (see VIRUS_SCAN_API_ENDPOINT
   at the top), which is the only thing that ever holds the real VirusTotal key.
   ========================================================================== */
async function scanFileForThreats(fileBlobOrUrl){
  if(!VIRUS_SCAN_API_ENDPOINT){
    // Honest answer: nothing was scanned. Callers must not present this as clean.
    return {status:'unconfigured', message:'Automatic scanning isn\'t configured on this site.'};
  }
  try{
    const body=new FormData();
    if(typeof fileBlobOrUrl==='string') body.append('url', fileBlobOrUrl);
    else body.append('file', fileBlobOrUrl, (fileBlobOrUrl&&fileBlobOrUrl.name)||'upload');
    // A hung request used to leave the in-bubble note stuck on "Scanning..."
    // forever, so the call is given a hard deadline.
    const ctl = (typeof AbortController!=='undefined') ? new AbortController() : null;
    const timer = ctl ? setTimeout(()=>{ try{ ctl.abort(); }catch(e){} }, 20000) : null;
    let res;
    try{
      res = await fetch(VIRUS_SCAN_API_ENDPOINT, ctl ? {method:'POST', body, signal:ctl.signal} : {method:'POST', body});
    } finally {
      if(timer) clearTimeout(timer);
    }
    const data=await res.json().catch(()=>({}));
    // VirusTotal's free tier is 4 requests/minute, so 429 is an expected
    // outcome rather than a failure, and is reported as its own state.
    if(res.status===429) return {status:'rate_limited', message:data.message||'Scanner is rate limited right now'};
    if(!res.ok) return {status:'error', message:data.message||('Scanner returned '+res.status)};
    if(data && (data.status==='rate_limited'||data.status==='ratelimited'||data.status==='quota_exceeded')){
      return {status:'rate_limited', message:data.message||'Scanner is rate limited right now'};
    }
    const submitted = data && data.status ? data : {status:'submitted', data};
    // Poll for the real verdict instead of stopping at "submitted" — the
    // proxy never used to have a way to report malicious/suspicious/clean at
    // all, so no file could ever actually be flagged no matter what it was.
    // Gracefully degrades to the old "submitted" result if the deployed
    // proxy doesn't have the polling endpoint yet (older worker version) or
    // VirusTotal just hasn't finished analyzing it within the short window.
    const analysisId = submitted && submitted.data && submitted.data.data && submitted.data.data.id;
    if(analysisId){
      const verdict = await _pollScanVerdict(analysisId);
      if(verdict) return verdict;
    }
    return submitted;
  }catch(e){
    const aborted = e && (e.name==='AbortError' || /abort/i.test(e.message||''));
    return {status:'error', message: aborted ? 'Scan timed out' : (e.message||'Scan request failed')};
  }
}
// Polls the proxy's GET ?id=<analysisId> endpoint for a real verdict.
// Returns null (not a verdict) on 404/old-proxy/timeout so the caller falls
// back to the plain "submitted" result rather than treating "we don't know
// yet" as any particular verdict.
async function _pollScanVerdict(analysisId){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    try{
      const ctl = (typeof AbortController!=='undefined') ? new AbortController() : null;
      const timer = ctl ? setTimeout(()=>{ try{ ctl.abort(); }catch(e){} }, 8000) : null;
      let res;
      try{
        res = await fetch(VIRUS_SCAN_API_ENDPOINT+'?id='+encodeURIComponent(analysisId), ctl?{signal:ctl.signal}:{});
      } finally { if(timer) clearTimeout(timer); }
      if(!res.ok) return null; // proxy doesn't support polling yet (404) or errored — don't guess
      const data=await res.json().catch(()=>null);
      if(!data||!data.status) return null;
      if(data.status==='malicious') return {status:'malicious', stats:data.stats};
      if(data.status==='suspicious') return {status:'suspicious', stats:data.stats};
      if(data.status==='clean') return {status:'clean', stats:data.stats};
      if(data.status==='rate_limited') return {status:'rate_limited', message:'Scanner is rate limited right now'};
      // 'queued' — still analyzing, wait and poll again within the deadline
    }catch(e){ return null; }
    await new Promise(r=>setTimeout(r,3000));
  }
  return null; // gave up within the window — caller shows "submitted", not a false "clean"
}
// Results are cached per file for the lifetime of the page. renderMessages()
// redraws the whole thread whenever any message changes, so without this every
// file attachment in an open conversation was re-submitted on every redraw --
// which blows through a 4-requests-per-minute quota almost immediately.
const _scbScanCache = Object.create(null);

function _scanNoteText(r){
  r = r || {};
  // These three are real verdicts from VirusTotal (via _pollScanVerdict) —
  // previously no status value here was EVER reachable except
  // submitted/unconfigured/rate_limited/a generic error, so no file could
  // ever actually be flagged, no matter what it was.
  if(r.status==='malicious') return '🚨 This file was flagged as malicious by '+((r.stats&&r.stats.malicious)||'multiple')+' security engines — do not open it.';
  if(r.status==='suspicious') return '⚠️ This file was flagged as suspicious by a security scanner — be cautious before opening it.';
  if(r.status==='clean') return '✅ Scanned — no threats detected.';
  if(r.status==='submitted') return '✅ Submitted for scanning — always be cautious with files from people you don\'t know.';
  if(r.status==='unconfigured') return scbErr('SCB-SCAN-03','⚠️ Automatic scanning isn\'t configured yet — only download files from people you trust.');
  if(r.status==='rate_limited') return scbErr('SCB-SCAN-04','⚠️ Scanner is busy right now, so this file wasn\'t checked — only download files from people you trust.');
  return scbErr('SCB-SCAN-05','Scan unavailable — only download files from people you trust.',(r.message||'error'));
}

// Only these are actually stable/final — safe to persist across reloads
// forever. 'submitted'/'rate_limited'/'error' are NOT final: with polling
// now in place (see _pollScanVerdict), caching one of those permanently
// used to mean a file's note stayed stuck on "Submitted for scanning"
// forever even if the real verdict would later have been malicious —
// there was no re-check mechanism at all. Leaving them uncached means the
// next time this bubble renders, it tries again instead of staying stuck.
const _SCB_SCAN_FINAL_STATES = new Set(['malicious','suspicious','clean','unconfigured']);
function scanFileForThreatsCached(target, cacheKey){
  const k = cacheKey || (typeof target==='string' ? target : '');
  if(!k) return scanFileForThreats(target);
  // Check persistent localStorage cache first — never re-scan a file already checked this session or prior
  const lsKey = 'cc_scan_' + k.slice(0,120);
  try{
    const saved = localStorage.getItem(lsKey);
    if(saved){ const r=JSON.parse(saved); _scbScanCache[k]=Promise.resolve(r); return _scbScanCache[k]; }
  }catch(e){}
  if(!_scbScanCache[k]){
    _scbScanCache[k] = scanFileForThreats(target)
      .then(r=>{ try{ if(r&&_SCB_SCAN_FINAL_STATES.has(r.status)) localStorage.setItem(lsKey, JSON.stringify(r)); }catch(e){} return r; })
      .catch(e=>({status:'error', message:(e&&e.message)||'Scan request failed'}));
  }
  return _scbScanCache[k];
}

// Every non-image/audio file bubble shows a scan notice once; result is cached in
// localStorage so re-opening the chat never re-scans.
const _origRenderFileBubble = renderFileBubble;
renderFileBubble = function(bubble, fileData){
  _origRenderFileBubble(bubble, fileData);
  try{
    // Used to skip scanning entirely for anything whose declared type
    // started with image/ or audio/ — but fileData.type is just the
    // browser-reported file.type, which is attacker-controlled (trivially
    // spoofed by renaming a file or constructing a File object with a fake
    // type in devtools/a script). A malicious payload uploaded with a faked
    // image/png type used to skip both the scan attempt AND the warning
    // note every other file type gets. VirusTotal itself inspects the
    // actual file bytes regardless of the declared type, so there's no
    // need to special-case these — just always show the note.
    // If a note is already attached (same render pass) don't double-up
    if(bubble.querySelector('.scb-file-scan-note')) return;
    const note=document.createElement('div');
    note.className='scb-file-scan-note';
    bubble.appendChild(note);
    if(!VIRUS_SCAN_API_ENDPOINT){
      note.textContent=scbErr('SCB-SCAN-01','⚠️ Automatic scanning isn\'t configured yet — only download files from people you trust.');
      return;
    }
    const target=(fileData&&(fileData.url||fileData.blob))||null;
    if(!target){ note.textContent=scbErr('SCB-SCAN-02','⚠️ Nothing to scan — only download files from people you trust.'); return; }
    const cacheKey=(fileData&&(fileData.url||((fileData.name||'')+':'+(fileData.size||0))))||'';
    // Check in-memory cache synchronously — if resolved, show result immediately (no ⏳ flash)
    const lsKey = 'cc_scan_' + cacheKey.slice(0,120);
    try{
      const saved = localStorage.getItem(lsKey);
      if(saved){ note.textContent=_scanNoteText(JSON.parse(saved)); return; }
    }catch(e){}
    note.textContent='⏳ Scanning for threats…';
    scanFileForThreatsCached(target, cacheKey)
      .then(r=>{ note.textContent=_scanNoteText(r); })
      .catch(()=>{ note.textContent=scbErr('SCB-SCAN-06','⚠️ Scan unavailable — only download files from people you trust.'); });
  }catch(e){ console.warn('file scan notice failed', e); }
};

/* =============================================================================
   6. SELF-HEALING — retry with backoff, automatic recovery, honest escalation
   ========================================================================== */
// Anything that looks like a configuration/permission/credential problem is NOT
// retried: retrying can't fix it, and it's exactly the class of failure a human
// has to look at.
function isConfigFailure(e){
  const m=((e&&(e.message||e.code))||'').toString().toLowerCase();
  return m.includes('permission') || m.includes('denied') || m.includes('unauthorized') ||
         m.includes('api key') || m.includes('credential') || m.includes('invalid_token');
}
// Retryability and "is this a config problem" are NOT the same question, and
// conflating them got one case wrong: putBin() raises "data too large (likely a
// profile picture)" for an oversized payload. That is not a config failure (so
// the "check your Firebase rules" escalation would be misleading), but retrying
// the identical oversized payload three times with backoff can never succeed
// either — it just delays the honest error the user needs to see and then
// triggers a pointless cache wipe. Keep isConfigFailure() for what it says on
// the tin; decide retries with this.
function isUnretryable(e){
  if(isConfigFailure(e)) return true;
  const m=((e&&(e.message||e.code))||'').toString().toLowerCase();
  return m.includes('too large');
}
function scbSleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
async function withRetry(fn, label, attempts){
  attempts = attempts || 3;
  let lastErr=null;
  for(let i=0;i<attempts;i++){
    try{ return await fn(); }
    catch(e){
      lastErr=e;
      if(isUnretryable(e)) break;                 // no point retrying this
      if(i<attempts-1) await scbSleep(400*Math.pow(2,i));   // 400ms, 800ms
    }
  }
  handleSubsystemFailure(label, lastErr);
  throw lastErr;
}
// Recovery ladder: things the app can fix by itself, it fixes. Things it can't,
// it says so — in-app on next login, plus an admin email once that's configured.
// (_selfHealNotifiedFor, shared with selfHeal() above, is declared up near
// selfHeal's own definition now — see the comment there.)
function handleSubsystemFailure(label, err){
  const msg=(err&&err.message)||'Unknown error';
  console.error('[self-heal] '+label+' failed after retries:', msg);
  if(isConfigFailure(err)){
    flagNeedsAttention(scbErr('SCB-SYS-03','SoCloudyBro can\'t reach its database because the request was rejected (permission or configuration problem). The site owner needs to check the Firebase database rules.',label));
    if(!_selfHealNotifiedFor[label]){
      _selfHealNotifiedFor[label]=true;
      notifyAdminByEmail('SoCloudyBro: Firebase rejected requests ('+label+')',
        'Subsystem: '+label+'\nError: '+msg+'\nUser: #'+((me&&me.number)||'unknown')+'\nTime: '+new Date().toISOString()+
        '\n\nThis is a configuration/permission failure — retries cannot fix it. Check that the Realtime Database rules are published and valid.');
    }
    return;
  }
  if(isUnretryable(err)){
    // Real, permanent, but not a config problem (e.g. an oversized payload).
    // Clearing caches can't help; the caller already surfaces the message.
    console.warn('[self-heal] '+label+' failed permanently, not retryable and not a config problem:', msg);
    return;
  }
  // Transient-but-persistent: try the one automatic recovery available here —
  // drop the local caches so the next poll refetches everything cleanly.
  selfHealClearCaches();
  if(!_selfHealNotifiedFor[label]){
    _selfHealNotifiedFor[label]=true;
    notifyAdminByEmail('SoCloudyBro: repeated failures in '+label,
      'Subsystem: '+label+'\nError: '+msg+'\nUser: #'+((me&&me.number)||'unknown')+'\nTime: '+new Date().toISOString()+
      '\n\nRetries with backoff were exhausted. Local caches were cleared and a refetch will be attempted.');
  }
}
function selfHealClearCaches(){
  try{
    // Never touch queued outgoing messages or the session — only derived caches
    // that can be rebuilt from the server on the next poll.
    // The outbox only stores message IDs; the message OBJECTS themselves live
    // in convosCache and nowhere else. Nulling convosCache while the outbox is
    // non-empty therefore destroyed the very messages it claims to protect:
    // the next flushOutbox() refetched a clean copy from the server, failed to
    // find those IDs, and cleared the outbox — so a message the user was told
    // would "send automatically once back online" was silently dropped. If
    // anything is queued, keep convosCache and clear only the user cache.
    if(outboxCount()>0){
      usersCache=[]; lastMsgHash='';
      console.info('[self-heal] kept convo cache (unsent messages queued); cleared user cache only');
      return;
    }
    convosCache=null; usersCache=[];
    lastMsgHash='';
    console.info('[self-heal] cleared local caches; next poll will refetch');
  }catch(e){ console.warn('[self-heal] cache clear failed', e); }
}
// Self-heal alerts ride on the same Web3Forms access key that reports and the
// weekly digest already use, so there's nothing extra to configure. Field shape
// matches those calls (subject / message / time).
// The in-app "needs attention" banner stays as a backup rather than an
// either/or: email can fail too — not least when Web3Forms is the thing that's
// down — so a failed send always falls back to the banner. Nothing here throws,
// so a failure in the monitoring can never take down the thing it monitors.
function notifyAdminByEmail(subject, details){
  try{
    return sendWeb3Form({
      subject: '⚠️ SoCloudyBro self-heal alert: '+subject,
      message: details,
      time: new Date().toLocaleString(),
      // This alert has no admin-configured dashboard template to preserve
      // (unlike the report/digest emails), so it's safe to make `message`
      // itself the styled card rather than just adding an extra field.
      summary_html:_scbEmailCard({
        emoji:'⚠️', title:'Self-Heal Alert', accentColor:'#ca5010',
        rows:[
          {label:'Issue',value:subject},
          {label:'Details',value:details},
          {label:'Time',value:new Date().toLocaleString()},
        ],
        footerNote:'The app attempted automatic recovery — this alert means it could not fully resolve the issue on its own.',
      }),
    }).then(()=>({sent:true}))
      .catch(e=>{
        console.warn('[notifyAdminByEmail] send failed', e);
        flagNeedsAttention(scbErr('SCB-SYS-04','Something went wrong that the app couldn\'t fix by itself, and the alert email couldn\'t be sent either. Details were logged for the site owner.',(e&&e.message)||'send failed'));
        return {sent:false, reason:(e&&e.message)||'send failed'};
      });
  }catch(e){
    console.warn('[notifyAdminByEmail] unexpected failure', e);
    flagNeedsAttention(scbErr('SCB-SYS-05','Something went wrong that the app couldn\'t fix by itself. Details were logged for the site owner.',(e&&e.message)||'exception'));
    return Promise.resolve({sent:false, reason:'exception'});
  }
}
