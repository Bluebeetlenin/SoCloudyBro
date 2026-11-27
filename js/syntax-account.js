/*
 * Syntax Account SDK v1 — inlined directly into this file so there's one
 * less file to deploy alongside SoCloudyBro. Kept byte-for-byte identical
 * to the standalone syntax-account.js used by the games (Cube Leap!,
 * Jumpa!, Ultimo Chess) — if this SDK is ever updated, update both copies
 * together, or this file will drift out of sync with what the games use.
 * ----------------------------------------------------------------------
 * One shared account system for every Syntax Group game (Ultimo Chess,
 * Jumpa!, Cube Leap!, and future titles) plus SoCloudyBro's "Now Playing"
 * link.
 *
 * BACKEND: a single Firebase Realtime Database project shared by every
 * site. Set SYNTAX_DB_URL below to that project's database URL once it
 * exists — everything else in this file is backend-agnostic and needs no
 * other changes.
 *
 * DATA SHAPE (all top-level paths in the one shared database):
 *   /syntax_accounts/<number>        -> { number, name, pwd (salted hash),
 *                                          email, avatar, createdAt,
 *                                          linkedSoCloudyBro: <number>|null,
 *                                          nowPlaying: <see below>|absent }
 *     NOTE for external readers (e.g. SoCloudyBro, which GETs these two
 *     fields directly over REST rather than through this file): both
 *     `linkedSoCloudyBro` and `nowPlaying` are CLEARED by writing JSON null,
 *     which Firebase implements by deleting the key. So a raw GET of
 *     .../linkedSoCloudyBro or .../nowPlaying returns literal `null` when
 *     cleared, and the key is simply ABSENT from a GET of the whole account
 *     object — read them as "null or missing means none", never with a
 *     key-presence test.
 *     `nowPlaying` is an OBJECT, not a bare game-id string:
 *       { gameId: "<id>", since: <ms epoch, client clock> }
 *     Read `nowPlaying.gameId`; treat a stale `since` as no longer playing,
 *     since a player who closes the tab or signs out may leave the last
 *     value behind (logOut is local-only and does not clear it).
 *   /syntax_savedata/<number>/<gameId> -> arbitrary JSON the game wants to
 *                                          persist for that player (e.g.
 *                                          progress, settings, unlocks)
 *   /syntax_leaderboards/<gameId>/<number> -> { name, score, updatedAt }
 *     (one best-score entry per player per game; simplest shape that
 *     supports "top N" without needing a query index)
 *
 * This mirrors the same salted-SHA-256 password pattern and the same
 * Firebase REST GET/PUT approach already proven out in SoCloudyBro, for
 * consistency and because it's already been tested thoroughly there.
 * ----------------------------------------------------------------------
 */
(function(global){
  'use strict';

  // ---- CONFIGURE THIS ----------------------------------------------------
  // Replace with your Syntax Group Firebase Realtime Database URL, e.g.
  // "https://syntax-group-default-rtdb.firebaseio.com". Every game that
  // includes this file points at the SAME project, which is what makes one
  // account work everywhere.
  const SYNTAX_DB_URL = 'https://syntaxgroup-default-rtdb.europe-west1.firebasedatabase.app';
  // -------------------------------------------------------------------------

  const LOCAL_KEY = 'syntax_account_session';

  // -- low-level Firebase REST helpers --------------------------------------
  async function dbGet(path){
    const res = await fetch(`${SYNTAX_DB_URL}/${path}.json`);
    if(!res.ok) throw new Error(`Syntax Account: GET ${path} failed (${res.status})`);
    const data = await res.json();
    return data === null ? undefined : data;
  }
  async function dbPut(path, value){
    const res = await fetch(`${SYNTAX_DB_URL}/${path}.json`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(value)
    });
    if(!res.ok) throw new Error(`Syntax Account: PUT ${path} failed (${res.status})`);
    return res.json();
  }
  // Same as dbGet, but also asks Firebase for the current ETag of the data
  // at `path` so a caller can do a conditional write with dbPutIfMatch and
  // avoid a check-then-act race against another client writing the same
  // path in between the read and the write.
  async function dbGetWithETag(path){
    const res = await fetch(`${SYNTAX_DB_URL}/${path}.json`, {
      headers: {'X-Firebase-ETag': 'true'}
    });
    if(!res.ok) throw new Error(`Syntax Account: GET ${path} failed (${res.status})`);
    const data = await res.json();
    return { value: data === null ? undefined : data, etag: res.headers.get('ETag') };
  }
  // Writes value to path only if the data there still matches `etag` (i.e.
  // nobody else has written to it since it was read). Returns false (instead
  // of throwing) on a 412 Precondition Failed so callers can decide how to
  // handle losing the race, and throws for any other failure.
  async function dbPutIfMatch(path, value, etag){
    const res = await fetch(`${SYNTAX_DB_URL}/${path}.json`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json', 'if-match': etag || 'null_etag'},
      body: JSON.stringify(value)
    });
    if(res.status === 412) return false;
    if(!res.ok) throw new Error(`Syntax Account: PUT ${path} failed (${res.status})`);
    return true;
  }

  // -- input validation --------------------------------------------------
  // Strictly validates a Syntax Account / SoCloudyBro number: must be a
  // plain base-10 integer string in 1000-99999 with no extra characters
  // (rejects things like "0x10", "1000abc", "  123", floats, NaN, etc. that
  // parseInt() alone would silently accept or truncate).
  function parseAccountNumber(raw){
    if(typeof raw === 'number' && Number.isInteger(raw)) raw = String(raw);
    if(typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return NaN;
    const n = parseInt(raw.trim(), 10);
    return (n < 1000 || n > 99999) ? NaN : n;
  }
  // gameId is interpolated directly into Firebase REST paths. It must be a
  // non-empty string with no '/' or other characters Firebase keys forbid
  // ('.', '$', '#', '[', ']') — an empty or slash-containing gameId would
  // otherwise collapse or redirect the path (e.g. an empty gameId turns
  // `syntax_savedata/<number>/` into `syntax_savedata/<number>`, silently
  // overwriting ALL of that player's save data for every game).
  function isValidGameId(id){
    return typeof id === 'string' && id.length > 0 && /^[A-Za-z0-9_-]+$/.test(id);
  }

  // -- password hashing (same scheme as SoCloudyBro's own hashPasswordV2) --
  function b64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
  function unb64(str){ const s=atob(str); const b=new Uint8Array(s.length); for(let i=0;i<s.length;i++) b[i]=s.charCodeAt(i); return b; }
  async function hashPassword(p, existingSalt){
    if(!global.crypto || !global.crypto.subtle){
      throw new Error('Syntax Account: password hashing needs the Web Crypto API, which requires HTTPS (or localhost).');
    }
    const salt = existingSalt || b64(crypto.getRandomValues(new Uint8Array(16)));
    const data = new TextEncoder().encode(salt + ':' + p);
    const buf = await crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    return salt + '$' + hex;
  }
  // PBKDF2-HMAC-SHA256, 210000 iterations — same format/reasoning as
  // hashPasswordV2() in the main SoCloudyBro script (single-round salted
  // SHA-256 above is fast enough to brute-force at GPU speed if this
  // account store ever leaked). Kept as a local copy rather than calling
  // the main script's hashPasswordV2() directly: this module is a
  // self-contained IIFE that doesn't assume script load order relative to
  // the rest of the page, and duplicating ~8 lines is cheaper than a load-
  // order dependency bug.
  const PBKDF2_ITERATIONS = 210000;
  async function hashPasswordV2(p, existingSaltB64, iterations){
    iterations = iterations || PBKDF2_ITERATIONS;
    const saltBytes = existingSaltB64 ? unb64(existingSaltB64) : crypto.getRandomValues(new Uint8Array(16));
    const saltB64 = existingSaltB64 || b64(saltBytes.buffer);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(p), {name:'PBKDF2'}, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({name:'PBKDF2', salt:saltBytes, iterations, hash:'SHA-256'}, key, 256);
    const hex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2,'0')).join('');
    return 'v2$'+iterations+'$'+saltB64+'$'+hex;
  }
  async function verifyPassword(p, stored){
    // `p` must be an actual string: anything else (undefined, a number, an
    // array) would otherwise be stringified into the digest input, so e.g.
    // logIn(number) with no password at all would hash the literal text
    // "undefined" and succeed against an account whose password is that word.
    if(typeof p !== 'string' || typeof stored !== 'string') return false;
    if(stored.indexOf('v2$') === 0){
      const parts = stored.split('$');
      const iterations = parseInt(parts[1],10);
      const salt = parts[2];
      return (await hashPasswordV2(p, salt, iterations)) === stored;
    }
    if(stored.indexOf('$') === -1) {
      // Plaintext password fallback removed — accounts with unhashed passwords must reset.
      return false;
    }
    const salt = stored.split('$')[0];
    return (await hashPassword(p, salt)) === stored;
  }

  // -- session ---------------------------------------------------------------
  function getSession(){
    try{
      const raw = localStorage.getItem(LOCAL_KEY);
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      // Guard against corrupted/foreign localStorage content (e.g. a stray
      // string or an object missing `number`) being treated as a session.
      if(!parsed || typeof parsed !== 'object') return null;
      // `session.number` is interpolated straight into Firebase REST paths by
      // every write below, exactly like `gameId` is — so it has to survive the
      // same strict validation a number typed into the UI does. localStorage
      // is not trusted input: a truthy-but-malformed value such as
      // "1000/linkedSoCloudyBro" or "1000/../9999" would otherwise redirect a
      // saveGameData/setNowPlaying/link write to a different path or node.
      const number = parseAccountNumber(parsed.number);
      if(!number) return null;
      parsed.number = number; // normalized (integer) form used for all paths
      return parsed;
    }
    catch{ return null; }
  }
  function setSession(account){
    try{ localStorage.setItem(LOCAL_KEY, JSON.stringify(account)); }
    catch(e){ throw new Error('Syntax Account: could not save the session locally (' + e.message + ').'); }
  }
  function clearSession(){
    try{ localStorage.removeItem(LOCAL_KEY); }
    catch{ /* nothing usable to clear anyway */ }
  }

  // -- public API --------------------------------------------------------------
  const SyntaxAccount = {

    /** Currently signed-in account (from local session), or null. */
    current(){ return getSession(); },

    /**
     * Create a new Syntax Account. `number` is the player's permanent
     * handle across every Syntax Group game (1000-99999, same range and
     * convention as SoCloudyBro numbers, though these are a separate
     * namespace — a Syntax Account is not automatically a SoCloudyBro
     * account; the two link explicitly via linkToSoCloudyBro below).
     */
    async signUp(number, name, password){
      number = parseAccountNumber(number);
      if(!number) throw new Error('Number must be between 1000 and 99999.');
      if(!name || !name.trim()) throw new Error('Enter a name.');
      if(typeof password !== 'string' || password.length < 8) throw new Error('Password must be at least 8 characters.');

      // Read the current data + ETag for this number, then write with
      // if-match on that ETag. If another client signs up with the same
      // number in between (a check-then-act race, since Firebase gives no
      // other way to enforce uniqueness over plain REST GET/PUT), the write
      // is rejected with 412 instead of silently clobbering their account.
      const { value: existing, etag } = await dbGetWithETag(`syntax_accounts/${number}`);
      if(existing) throw new Error(`#${number} is already taken.`);

      const account = {
        number, name: name.trim(),
        pwd: await hashPasswordV2(password),
        email: '', avatar: '',
        createdAt: Date.now(),
        linkedSoCloudyBro: null
      };
      const wrote = await dbPutIfMatch(`syntax_accounts/${number}`, account, etag);
      if(!wrote) throw new Error(`#${number} is already taken.`);
      const { pwd, ...publicAccount } = account;
      setSession(publicAccount);
      return publicAccount;
    },

    async logIn(number, password){
      number = parseAccountNumber(number);
      if(!number) throw new Error('Enter a valid Syntax Account number (1000-99999).');
      const account = await dbGet(`syntax_accounts/${number}`);
      if(!account) throw new Error('No Syntax Account found with that number.');
      if(!(await verifyPassword(password, account.pwd))) throw new Error('Incorrect password.');
      // Transparently upgrade a pre-PBKDF2 hash on successful login — same
      // reasoning as the main SoCloudyBro script's equivalent step. Never
      // blocks or fails the login itself.
      if(account.pwd.indexOf('v2$')!==0){
        hashPasswordV2(password).then(v2=>dbPut(`syntax_accounts/${number}/pwd`,v2)).catch(()=>{});
      }
      const { pwd, ...publicAccount } = account;
      // Pin the session to the number that was just validated and
      // authenticated against, NOT to the record's own `number` field. That
      // field is stored data: if it is missing or malformed (a legacy or
      // hand-edited record), getSession() would reject the session it was
      // just handed, so a caller doing `await logIn(); await
      // linkToSoCloudyBro(n)` — exactly SoCloudyBro's "Connect Syntax
      // Account" flow — would get "Not signed in" straight after a
      // successful log in. Worse, if it disagrees with the path key, every
      // later write (link/nowPlaying/savedata/score) would be aimed at
      // somebody else's account node.
      publicAccount.number = number;
      setSession(publicAccount);
      return publicAccount;
    },

    logOut(){ clearSession(); },

    /** Link this Syntax Account to a SoCloudyBro number, for "Now Playing". */
    async linkToSoCloudyBro(soCloudyBroNumber){
      const session = getSession();
      if(!session) throw new Error('Not signed in to a Syntax Account.');
      soCloudyBroNumber = parseAccountNumber(soCloudyBroNumber);
      if(!soCloudyBroNumber) throw new Error('Enter a valid SoCloudyBro number (1000-99999).');
      await dbPut(`syntax_accounts/${session.number}/linkedSoCloudyBro`, soCloudyBroNumber);
      session.linkedSoCloudyBro = soCloudyBroNumber;
      setSession(session);
      return session;
    },
    async unlinkSoCloudyBro(){
      const session = getSession();
      if(!session) throw new Error('Not signed in to a Syntax Account.');
      await dbPut(`syntax_accounts/${session.number}/linkedSoCloudyBro`, null);
      session.linkedSoCloudyBro = null;
      setSession(session);
      return session;
    },

    /**
     * Announce "now playing <gameId>" — a game calls this on load, and
     * clears it (call with gameId=null) when the player leaves/closes it.
     * SoCloudyBro's own code reads this path to show "Now Playing" status
     * for any of its users who have a linked Syntax Account; it is not
     * pushed to SoCloudyBro, only stored for it to read.
     */
    async setNowPlaying(gameId){
      const session = getSession();
      if(!session) return; // not signed in — nothing to announce
      // Validated for consistency with saveGameData/submitScore: a falsy
      // gameId still means "clear", but a non-string or otherwise malformed
      // one must not be stored for SoCloudyBro to read back.
      if(gameId && !isValidGameId(gameId)) throw new Error('Invalid gameId.');
      await dbPut(`syntax_accounts/${session.number}/nowPlaying`,
        gameId ? { gameId, since: Date.now() } : null);
    },

    /** Save arbitrary per-game data for the signed-in account. */
    async saveGameData(gameId, data){
      const session = getSession();
      if(!session) throw new Error('Not signed in to a Syntax Account.');
      if(!isValidGameId(gameId)) throw new Error('Invalid gameId.');
      await dbPut(`syntax_savedata/${session.number}/${gameId}`, data);
    },

    /** Load this account's saved data for a game. Returns undefined if none. */
    async loadGameData(gameId){
      const session = getSession();
      if(!session) return undefined;
      if(!isValidGameId(gameId)) throw new Error('Invalid gameId.');
      return dbGet(`syntax_savedata/${session.number}/${gameId}`);
    },

    /** Submit a score. Only overwrites the player's stored best if higher. */
    async submitScore(gameId, score){
      const session = getSession();
      if(!session) throw new Error('Not signed in to a Syntax Account.');
      if(!isValidGameId(gameId)) throw new Error('Invalid gameId.');
      // A non-finite score (NaN/Infinity, or undefined from a miscalculated
      // game loop) would be JSON.stringify'd to null and stored as a null
      // score, corrupting the player's entry and the leaderboard sort.
      const numericScore = Number(score);
      if(!Number.isFinite(numericScore)) throw new Error('Score must be a finite number.');
      score = numericScore;
      const path = `syntax_leaderboards/${gameId}/${session.number}`;
      // Read-then-write is a check-then-act race if the same player submits
      // scores from two devices/tabs at once; use if-match so a losing
      // write is retried against fresh data instead of silently clobbering
      // (or being clobbered by) the other write.
      for(let attempt = 0; attempt < 3; attempt++){
        const { value: existing, etag } = await dbGetWithETag(path);
        // Treat a corrupt/missing stored score as "no best yet" rather than
        // comparing against it — otherwise a single bad entry (e.g. a string
        // score, or null from an older write) can permanently block the
        // player from ever recording a new best.
        const existingScore = (existing && typeof existing === 'object') ? Number(existing.score) : NaN;
        if(Number.isFinite(existingScore) && existingScore >= score) return existing; // not a new best, no write needed
        const entry = { name: session.name, score, updatedAt: Date.now() };
        const wrote = await dbPutIfMatch(path, entry, etag);
        if(wrote) return entry;
        // someone else wrote to this entry between our GET and PUT — retry
      }
      throw new Error('Syntax Account: could not submit score, please try again.');
    },

    /** Top N scores for a game, highest first. */
    async getLeaderboard(gameId, limit){
      if(!isValidGameId(gameId)) throw new Error('Invalid gameId.');
      // `limit` was only defaulted, never validated: a negative limit made
      // slice(0, -n) drop the last n entries and return almost the WHOLE
      // leaderboard, and a non-numeric limit made slice return nothing or
      // everything depending on coercion.
      const wanted = Math.floor(Number(limit));
      limit = (Number.isFinite(wanted) && wanted > 0) ? wanted : 10;
      const all = await dbGet(`syntax_leaderboards/${gameId}`);
      if(!all || typeof all !== 'object') return [];
      return Object.entries(all)
        // Drop malformed entries so one corrupt row can't produce NaN
        // comparisons and scramble the ordering of every other row.
        .filter(([, entry]) => entry && typeof entry === 'object' &&
          entry.score !== null && entry.score !== '' && Number.isFinite(Number(entry.score)))
        // `number` is spread-over LAST on purpose: a stored entry that
        // happens to carry its own `number` field must not override the one
        // derived from the path key, or a row could be attributed to the
        // wrong player.
        .map(([number, entry]) => ({ ...entry, number: parseInt(number, 10), score: Number(entry.score) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    }
  };

  global.SyntaxAccount = SyntaxAccount;
})(window);
