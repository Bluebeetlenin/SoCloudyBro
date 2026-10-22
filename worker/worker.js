// Cloudflare Worker: Firebase Rules Manager + Custom Auth Token Minting
// Deploy at: socloudybro-firebase-rules.steveemil7.workers.dev
//
// Required secrets/vars:
//   FIREBASE_PROJECT_ID   = "socloudybro-b8606"   (plain var)
//   ADMIN_NUMBER          = "2015"                 (plain var)
//   SERVICE_ACCOUNT_JSON  = <full service account key JSON>  (SECRET)
//   EMAILJS_SERVICE_ID    = <EmailJS Service ID, e.g. "service_xxxxxxx">  (SECRET)
//   EMAILJS_TEMPLATE_ID   = <EmailJS Template ID, e.g. "template_xxxxxxx">  (SECRET)
//   EMAILJS_PUBLIC_KEY    = <EmailJS Public Key>  (SECRET)
//   EMAILJS_PRIVATE_KEY   = <EmailJS Private Key>  (SECRET)
//   WEB3FORMS_ACCESS_KEY  = <Web3Forms key>  (SECRET — moved from client source)
//
// CHANGES IN THIS VERSION:
//   - handleMintToken now also reads users_private/<number> for pwd,
//     backupPinHash, faceDescriptor (with backward-compat fallback to the
//     public users/<number> copy that older app versions still write).
//   - POST /report: proxy endpoint for Web3Forms submissions — keeps the
//     Web3Forms access key server-side as a Worker secret instead of
//     embedding it in the client HTML. Add WEB3FORMS_ACCESS_KEY as a
//     Worker secret in the Cloudflare dashboard.

// Accept production and any Vercel preview/branch deployment for this project.
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === 'https://socloudybro.vercel.app') return true;
  // Vercel preview URLs: https://<anything>.vercel.app where the subdomain
  // contains "socloudybro" (covers branch, PR, and team preview deployments).
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && u.hostname.endsWith('.vercel.app') &&
           u.hostname.includes('socloudybro');
  } catch { return false; }
}
const ALLOWED_ORIGIN = 'https://socloudybro.vercel.app';
const GOOGLE_CLIENT_ID = '838238846995-462tmfqv9p4mthurorumg30d2uq4qin1.apps.googleusercontent.com';
const FACE_MATCH_THRESHOLD = 0.42;

let _jwksCache = null;
let _jwksCacheAt = 0;
const JWKS_TTL_MS = 10 * 60 * 1000;

export default {
  async fetch(req, env) {
    const reqOrigin = req.headers.get('Origin') || '';
    const corsHeaders = {
      'Access-Control-Allow-Origin': isAllowedOrigin(reqOrigin) ? reqOrigin : ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Number',
      'Vary': 'Origin',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!env.SERVICE_ACCOUNT_JSON) {
      return new Response(JSON.stringify({ error: 'SERVICE_ACCOUNT_JSON secret not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (!env.FIREBASE_PROJECT_ID) {
      return new Response(JSON.stringify({ error: 'FIREBASE_PROJECT_ID not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    try {
      if (path === '/mint-token' && req.method === 'POST') {
        return await handleMintToken(req, env, corsHeaders);
      }
      if (path === '/send-otp' && req.method === 'POST') {
        return await handleSendOtp(req, env, corsHeaders);
      }
      if (path === '/verify-otp' && req.method === 'POST') {
        return await handleVerifyOtp(req, env, corsHeaders);
      }
      if (path === '/passkey-challenge' && req.method === 'GET') {
        return await handlePasskeyChallenge(req, env, corsHeaders);
      }
      if (path === '/report' && req.method === 'POST') {
        return await handleReport(req, env, corsHeaders);
      }
      if (path === '/giphy' && req.method === 'GET') {
        return await handleGiphy(req, env, corsHeaders);
      }
      if (path === '/csp-report' && req.method === 'POST') {
        return await handleCspReport(req, env, corsHeaders);
      }

      const adminNum = req.headers.get('X-Admin-Number');
      if (!adminNum || adminNum !== (env.ADMIN_NUMBER || '2015')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const token = await getAccessToken(env.SERVICE_ACCOUNT_JSON);
      const rulesUrl = `${dbBaseUrl(env)}/.settings/rules.json`;

      if (path === '/get' && req.method === 'GET') {
        const r = await fetch(`${rulesUrl}?access_token=${token}`);
        if (!r.ok) {
          const body = await r.text();
          throw new Error(`Firebase rules GET failed (${r.status}): ${body}`);
        }
        const data = await r.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (path === '/set' && req.method === 'POST') {
        const body = await req.json();
        if (!body.rules) {
          return new Response(JSON.stringify({ error: 'Missing rules field' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const r = await fetch(`${rulesUrl}?access_token=${token}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body.rules)
        });
        if (!r.ok) {
          const errBody = await r.text();
          throw new Error(`Firebase rules PUT failed (${r.status}): ${errBody}`);
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch(e) {
      console.error('Worker error:', e.message);
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

async function handleMintToken(req, env, corsHeaders) {
  let body;
  try { body = await req.json(); } catch (e) {
    return jsonResp({ error: 'Expected JSON body' }, 400, corsHeaders);
  }
  const number = body && body.number;
  const password = body && body.password;
  const googleCredential = body && body.googleCredential;
  const passkeyAssertion = body && body.passkeyAssertion;
  const faceDescriptor = body && body.faceDescriptor;
  const backupPin = body && body.backupPin;
  const secAnswers = body && body.secAnswers;

  const hasProof = typeof password === 'string' || typeof googleCredential === 'string' ||
    (passkeyAssertion && typeof passkeyAssertion === 'object') ||
    isValidFaceDescriptor(faceDescriptor) || typeof backupPin === 'string' ||
    isValidSecAnswers(secAnswers);
  if (!number || !hasProof) {
    return jsonResp({ error: 'Missing number and a recognized proof' }, 400, corsHeaders);
  }

  const accessToken = await getAccessToken(env.SERVICE_ACCOUNT_JSON);

  // Server-side rate limiting
  const attemptsUrl = `${dbBaseUrl(env)}/rate_limits/login_attempts/${encodeURIComponent(number)}.json?access_token=${accessToken}`;
  let attempts = null;
  try {
    const attemptsRes = await fetch(attemptsUrl);
    if (attemptsRes.ok) attempts = await attemptsRes.json();
  } catch (e) {}
  const now = Date.now();
  if (attempts && attempts.lockUntil && attempts.lockUntil > now) {
    const waitSec = Math.ceil((attempts.lockUntil - now) / 1000);
    return jsonResp({ error: `Too many attempts. Try again in ${waitSec} second(s).` }, 429, corsHeaders);
  }

  const userUrl = `${dbBaseUrl(env)}/users/${encodeURIComponent(number)}.json?access_token=${accessToken}`;
  const userRes = await fetch(userUrl);
  if (!userRes.ok) {
    return jsonResp({ error: 'Could not look up account' }, 502, corsHeaders);
  }
  const user = await userRes.json();
  if (user && (user.banned || user.deleted)) {
    return jsonResp({ error: 'Account is not available' }, 403, corsHeaders);
  }

  // Overlay sensitive auth fields from users_private (not client-readable).
  // Falls back to the public-node copy during the migration window when older
  // app versions haven't yet written to users_private.
  if (user) {
    try {
      const privUrl = `${dbBaseUrl(env)}/users_private/${encodeURIComponent(number)}.json?access_token=${accessToken}`;
      const privRes = await fetch(privUrl);
      if (privRes.ok) {
        const priv = await privRes.json();
        if (priv) {
          if (priv.pwd           !== undefined) user.pwd            = priv.pwd;
          if (priv.backupPinHash !== undefined) user.backupPinHash  = priv.backupPinHash;
          if (priv.faceDescriptor!== undefined) user.faceDescriptor = priv.faceDescriptor;
        }
      }
    } catch (e) {
      // best-effort — fall through to the public-node value already in user.*
    }
  }

  const verified = user ? await verifyMintProof(user, { password, googleCredential, passkeyAssertion, faceDescriptor, backupPin, secAnswers }, env) : false;

  if (!verified) {
    const count = (attempts && attempts.count || 0) + 1;
    const MAX_ATTEMPTS = 5, LOCKOUT_MS = 5 * 60 * 1000;
    const justLockedOut = count >= MAX_ATTEMPTS;
    const next = justLockedOut ? { count: 0, lockUntil: now + LOCKOUT_MS } : { count, lockUntil: null };
    try {
      await fetch(attemptsUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
    } catch (e) {}
    if (justLockedOut && user) {
      try {
        await fetch(`${dbBaseUrl(env)}/users/${encodeURIComponent(number)}/lastLockoutAt.json?access_token=${accessToken}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(now) });
      } catch (e) {}
    }
    return jsonResp({ error: 'Invalid credentials' }, 401, corsHeaders);
  }

  if (attempts) {
    try { await fetch(attemptsUrl, { method: 'DELETE' }); } catch (e) {}
  }

  const customToken = await mintFirebaseCustomToken(env.SERVICE_ACCOUNT_JSON, 'u' + number, { number: String(number), email: (user.email || '').toLowerCase() });
  return jsonResp({ token: customToken }, 200, corsHeaders);
}

// POST /report — proxies Web3Forms submissions server-side so the
// WEB3FORMS_ACCESS_KEY secret never appears in client HTML. Accepts only a
// known field allowlist to prevent open relay abuse. Add WEB3FORMS_ACCESS_KEY
// as a Worker secret in the Cloudflare dashboard.
async function handleReport(req, env, corsHeaders) {
  if (!env.WEB3FORMS_ACCESS_KEY) {
    return jsonResp({ error: 'Report endpoint not configured — WEB3FORMS_ACCESS_KEY secret missing' }, 500, corsHeaders);
  }
  let body;
  try { body = await req.json(); } catch (e) {
    return jsonResp({ error: 'Expected JSON body' }, 400, corsHeaders);
  }
  const ALLOWED_FIELDS = ['subject','message','from_name','name','email','reportedNumber','reporterNumber','reportType','botcheck',
    'total_users','active_week','new_week','messages_week','reports_open','top_reports','time'];
  const fields = {};
  for (const k of ALLOWED_FIELDS) {
    if (body[k] !== undefined) fields[k] = String(body[k]).slice(0, 4000);
  }
  const payload = { access_key: env.WEB3FORMS_ACCESS_KEY, ...fields };
  let r;
  try {
    r = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return jsonResp({ error: 'Could not reach report service' }, 502, corsHeaders);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.success) return jsonResp({ error: data.message || 'Submission failed' }, 502, corsHeaders);
  return jsonResp({ ok: true }, 200, corsHeaders);
}

// GET /giphy?endpoint=trending|search&q=<query>&limit=<n>&rating=g
// Proxies Giphy API requests server-side so the GIPHY_KEY secret never
// appears in client HTML. Add GIPHY_KEY as a Worker secret (plain var is fine
// too — it's not sensitive enough to warrant encryption, but keeping it
// server-side prevents abuse via key scraping). Enforces rating=g always.
async function handleGiphy(req, env, corsHeaders) {
  if (!env.GIPHY_KEY) {
    return jsonResp({ error: 'Giphy not configured' }, 500, corsHeaders);
  }
  const url = new URL(req.url);
  const endpoint = url.searchParams.get('endpoint') === 'search' ? 'search' : 'trending';
  const q = (url.searchParams.get('q') || '').slice(0, 200);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '12', 10) || 12, 50);
  const giphyUrl = new URL(`https://api.giphy.com/v1/gifs/${endpoint}`);
  giphyUrl.searchParams.set('api_key', env.GIPHY_KEY);
  giphyUrl.searchParams.set('limit', String(limit));
  giphyUrl.searchParams.set('rating', 'g');
  if (endpoint === 'search' && q) giphyUrl.searchParams.set('q', q);
  let r;
  try { r = await fetch(giphyUrl.toString()); } catch (e) {
    return jsonResp({ error: 'Could not reach Giphy' }, 502, corsHeaders);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return jsonResp({ error: 'Giphy error' }, 502, corsHeaders);
  return jsonResp(data, 200, corsHeaders);
}

// POST /csp-report — receives Content-Security-Policy violation reports from
// browsers and logs them to the Firebase errors node for admin review.
async function handleCspReport(req, env, corsHeaders) {
  let body;
  try { body = await req.json(); } catch (e) { return new Response(null, { status: 204, headers: corsHeaders }); }
  const report = body['csp-report'] || body;
  if (env.SERVICE_ACCOUNT_JSON && env.FIREBASE_PROJECT_ID) {
    try {
      const accessToken = await getAccessToken(env.SERVICE_ACCOUNT_JSON);
      const entry = { type: 'csp-violation', at: Date.now(), report };
      await fetch(`${dbBaseUrl(env)}/errors.json?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
    } catch (e) { /* best-effort */ }
  }
  return new Response(null, { status: 204, headers: corsHeaders });
}

async function verifyMintProof(user, { password, googleCredential, passkeyAssertion, faceDescriptor, backupPin, secAnswers }, env) {
  try {
    if (typeof googleCredential === 'string' && googleCredential) {
      if (!user.googleSub) return false;
      const claims = await verifyGoogleIdToken(googleCredential);
      return claims.sub === user.googleSub;
    } else if (passkeyAssertion && typeof passkeyAssertion === 'object') {
      return await verifyPasskeyAssertionServer(passkeyAssertion, user, env);
    } else if (isValidFaceDescriptor(faceDescriptor)) {
      if (!Array.isArray(user.faceDescriptor) || !user.faceDescriptor.length) return false;
      const dist = euclideanDistance(faceDescriptor, user.faceDescriptor);
      return dist < FACE_MATCH_THRESHOLD;
    } else if (typeof backupPin === 'string' && backupPin) {
      if (!user.backupPinHash) return false;
      return await verifyPasswordHash(backupPin, user.backupPinHash);
    } else if (isValidSecAnswers(secAnswers)) {
      if (!Array.isArray(user.secQuestions) || user.secQuestions.length !== 2) return false;
      const ok1 = await verifyPasswordHash(normalizeSecAnswer(secAnswers[0]), user.secQuestions[0].hash);
      const ok2 = await verifyPasswordHash(normalizeSecAnswer(secAnswers[1]), user.secQuestions[1].hash);
      return ok1 && ok2;
    } else {
      if (!user.pwd) return false;
      return await verifyPasswordHash(password, user.pwd);
    }
  } catch (e) {
    return false;
  }
}
function isValidSecAnswers(a) {
  return Array.isArray(a) && a.length === 2 && a.every(x => typeof x === 'string' && x.length > 0 && x.length <= 200);
}
function normalizeSecAnswer(a) {
  return String(a || '').trim().toLowerCase();
}

const OTP_TTL_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleSendOtp(req, env, corsHeaders) {
  const missing = ['EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY'].filter(k => !env[k]);
  if (missing.length) {
    return jsonResp({ error: 'Email sending is not configured (' + missing.join(', ') + ' missing)' }, 500, corsHeaders);
  }
  let body;
  try { body = await req.json(); } catch (e) {
    return jsonResp({ error: 'Expected JSON body' }, 400, corsHeaders);
  }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return jsonResp({ error: 'Enter a valid email address' }, 400, corsHeaders);
  }

  const codeBytes = new Uint32Array(1);
  crypto.getRandomValues(codeBytes);
  const secureCode = String(100000 + (codeBytes[0] % 900000));

  const exp = Date.now() + OTP_TTL_MS;
  const codeHash = await sha256Hex(secureCode);
  const challenge = await signOtpChallenge(env, { email, codeHash, exp });

  const sendRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: env.EMAILJS_SERVICE_ID,
      template_id: env.EMAILJS_TEMPLATE_ID,
      user_id: env.EMAILJS_PUBLIC_KEY,
      accessToken: env.EMAILJS_PRIVATE_KEY,
      template_params: { to_email: email, name: email, code: secureCode },
    }),
  });
  if (!sendRes.ok) {
    const errBody = await sendRes.text().catch(() => '');
    return jsonResp({ error: 'Could not send the verification email: ' + errBody }, 502, corsHeaders);
  }
  return jsonResp({ challenge }, 200, corsHeaders);
}

async function handleVerifyOtp(req, env, corsHeaders) {
  let body;
  try { body = await req.json(); } catch (e) {
    return jsonResp({ error: 'Expected JSON body' }, 400, corsHeaders);
  }
  const challenge = typeof body?.challenge === 'string' ? body.challenge : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!challenge || !/^\d{6}$/.test(code)) {
    return jsonResp({ error: 'Enter the 6-digit code' }, 400, corsHeaders);
  }
  let payload;
  try {
    payload = await verifyOtpChallenge(env, challenge);
  } catch (e) {
    return jsonResp({ error: 'That code has expired — request a new one' }, 401, corsHeaders);
  }
  if (Date.now() > payload.exp) {
    return jsonResp({ error: 'That code has expired — request a new one' }, 401, corsHeaders);
  }
  const codeHash = await sha256Hex(code);
  if (codeHash !== payload.codeHash) {
    return jsonResp({ error: 'Incorrect code' }, 401, corsHeaders);
  }
  return jsonResp({ ok: true, email: payload.email }, 200, corsHeaders);
}

async function getOtpHmacKey(env) {
  const sa = parseServiceAccount(env.SERVICE_ACCOUNT_JSON);
  const keyMaterial = new TextEncoder().encode('scb-otp-v1:' + sa.private_key);
  return crypto.subtle.importKey('raw', keyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signOtpChallenge(env, payload) {
  const key = await getOtpHmacKey(env);
  const json = JSON.stringify(payload);
  const payloadB64 = b64u(json);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64u(sig)}`;
}
async function verifyOtpChallenge(env, challenge) {
  const parts = challenge.split('.');
  if (parts.length !== 2) throw new Error('Malformed challenge');
  const [payloadB64, sigB64] = parts;
  const key = await getOtpHmacKey(env);
  const sig = base64urlDecodeToBuffer(sigB64);
  const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(payloadB64));
  if (!valid) throw new Error('Invalid signature');
  return JSON.parse(base64urlDecodeToString(payloadB64));
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPasswordHash(password, stored) {
  if (typeof stored !== 'string') return false;
  if (stored.indexOf('v2$') === 0) {
    const parts = stored.split('$');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const saltB64 = parts[2];
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    let saltBytes;
    try { saltBytes = b64DecodeToBuffer(saltB64); } catch (e) { return false; }
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new Uint8Array(saltBytes), iterations, hash: 'SHA-256' }, key, 256);
    const hex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    return ('v2$' + iterations + '$' + saltB64 + '$' + hex) === stored;
  }
  if (stored.indexOf('$') === -1) return false;
  const salt = stored.split('$')[0];
  const data = new TextEncoder().encode(salt + ':' + password);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return (salt + '$' + hex) === stored;
}

async function verifyGoogleIdToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed credential');
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64urlDecodeToString(headerB64));
  const claims = JSON.parse(base64urlDecodeToString(payloadB64));
  if (header.alg !== 'RS256') throw new Error('Unexpected signing algorithm: ' + header.alg);
  const jwks = await getGoogleJwks();
  const jwk = jwks.keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('No matching signing key found');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signingInput = new TextEncoder().encode(headerB64 + '.' + payloadB64);
  const signature = base64urlDecodeToBuffer(signatureB64);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signingInput);
  if (!valid) throw new Error('Invalid signature');
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp < now) throw new Error('Token has expired');
  if (typeof claims.iat !== 'number' || claims.iat > now + 60) throw new Error('Token issued-at time is in the future');
  const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
  if (!validIssuers.includes(claims.iss)) throw new Error('Unexpected issuer: ' + claims.iss);
  if (claims.aud !== GOOGLE_CLIENT_ID) throw new Error('Token was not issued for this app');
  if (!claims.sub) throw new Error('Token missing subject (sub) claim');
  return claims;
}

async function getGoogleJwks() {
  if (_jwksCache && Date.now() - _jwksCacheAt < JWKS_TTL_MS) return _jwksCache;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error('Could not fetch Google signing keys (' + res.status + ')');
  const jwks = await res.json();
  _jwksCache = jwks;
  _jwksCacheAt = Date.now();
  return jwks;
}

function derToRawEcdsaSig(derBuf) {
  const b = new Uint8Array(derBuf);
  let p = 0;
  function readLen() { let len = b[p++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = (len << 8) | b[p++]; } return len; }
  function readInt() {
    if (b[p++] !== 0x02) throw new Error('bad DER signature');
    let len = readLen();
    let bytes = Array.from(b.slice(p, p + len)); p += len;
    while (bytes.length > 32 && bytes[0] === 0) bytes.shift();
    if (bytes.length < 32) { const pad = new Array(32 - bytes.length).fill(0); bytes = pad.concat(bytes); }
    return bytes;
  }
  if (b[p++] !== 0x30) throw new Error('bad DER signature');
  readLen();
  const r = readInt(), s = readInt();
  return new Uint8Array(r.concat(s)).buffer;
}
// GET /passkey-challenge — issues a one-time 32-byte challenge signed with an
// HMAC token (60-second TTL). The client passes the token back in the
// /mint-token body alongside the assertion so the Worker can verify the
// challenge was freshly issued by itself and not replayed.
const PASSKEY_CHALLENGE_TTL_MS = 60 * 1000;
async function handlePasskeyChallenge(req, env, corsHeaders) {
  const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
  const challengeB64u = b64u(challengeBytes.buffer);
  const exp = Date.now() + PASSKEY_CHALLENGE_TTL_MS;
  const challengeToken = await signPasskeyChallenge(env, { challengeB64u, exp });
  return jsonResp({ challenge: challengeB64u, challengeToken }, 200, corsHeaders);
}

async function getPasskeyChallengeKey(env) {
  const sa = parseServiceAccount(env.SERVICE_ACCOUNT_JSON);
  const keyMaterial = new TextEncoder().encode('scb-passkey-challenge-v1:' + sa.private_key);
  return crypto.subtle.importKey('raw', keyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signPasskeyChallenge(env, payload) {
  const key = await getPasskeyChallengeKey(env);
  const payloadB64 = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64u(sig)}`;
}
async function verifyPasskeyChallengeToken(env, token) {
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('Malformed challenge token');
  const [payloadB64, sigB64] = parts;
  const key = await getPasskeyChallengeKey(env);
  const sig = base64urlDecodeToBuffer(sigB64);
  const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(payloadB64));
  if (!valid) throw new Error('Invalid challenge token signature');
  const payload = JSON.parse(base64urlDecodeToString(payloadB64));
  if (Date.now() > payload.exp) throw new Error('Challenge token expired');
  return payload;
}

async function verifyPasskeyAssertionServer(assertion, user, env) {
  if (typeof assertion.credentialId !== 'string' || typeof assertion.clientDataJSON !== 'string' ||
      typeof assertion.authenticatorData !== 'string' || typeof assertion.signature !== 'string') {
    return false;
  }
  // Verify the server-issued challenge token — prevents replay of captured assertions.
  if (typeof assertion.challengeToken !== 'string') return false;
  let challengePayload;
  try {
    challengePayload = await verifyPasskeyChallengeToken(env, assertion.challengeToken);
  } catch (e) {
    return false;
  }
  const passkeys = Array.isArray(user.passkeys) ? user.passkeys : [];
  const matched = passkeys.find(p => p && p.id === assertion.credentialId);
  if (!matched || !matched.publicKeySpki) return false;
  const clientDataBuf = b64DecodeToBuffer(assertion.clientDataJSON);
  const authDataBuf = b64DecodeToBuffer(assertion.authenticatorData);
  const sigBuf = b64DecodeToBuffer(assertion.signature);
  const spkiBuf = b64DecodeToBuffer(matched.publicKeySpki);
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBuf));
  if (clientData.type !== 'webauthn.get') return false;
  if (!isAllowedOrigin(clientData.origin)) return false;
  // Verify the challenge in clientDataJSON matches what the Worker issued.
  if (clientData.challenge !== challengePayload.challengeB64u) return false;
  const pubKey = await crypto.subtle.importKey('spki', spkiBuf, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataBuf);
  const signedData = new Uint8Array(authDataBuf.byteLength + clientDataHash.byteLength);
  signedData.set(new Uint8Array(authDataBuf), 0);
  signedData.set(new Uint8Array(clientDataHash), authDataBuf.byteLength);
  const rawSig = derToRawEcdsaSig(sigBuf);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, rawSig, signedData.buffer);
}

function isValidFaceDescriptor(d) {
  return Array.isArray(d) && d.length > 0 && d.length <= 512 && d.every(x => typeof x === 'number' && Number.isFinite(x));
}
function euclideanDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
  return Math.sqrt(sum);
}

function base64urlDecodeToString(str) {
  return new TextDecoder().decode(base64urlDecodeToBuffer(str));
}
function base64urlDecodeToBuffer(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + (4 - (str.length % 4 || 4)) % 4, '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function b64DecodeToBuffer(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(serviceAccountJson) {
  const sa = parseServiceAccount(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const jwt = await signServiceAccountJwt(sa, claim);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const data = await r.json();
  if (!data.access_token) {
    throw new Error('Token exchange failed: ' + JSON.stringify(data));
  }
  return data.access_token;
}

async function mintFirebaseCustomToken(serviceAccountJson, uid, customClaims) {
  const sa = parseServiceAccount(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
    claims: customClaims || {},
  };
  return signServiceAccountJwt(sa, claim);
}

function dbBaseUrl(env) {
  return `https://${env.FIREBASE_PROJECT_ID}-default-rtdb.europe-west1.firebasedatabase.app`;
}

function parseServiceAccount(serviceAccountJson) {
  let sa;
  try {
    sa = JSON.parse(serviceAccountJson);
  } catch(e) {
    throw new Error('SERVICE_ACCOUNT_JSON is not valid JSON: ' + e.message);
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error('SERVICE_ACCOUNT_JSON missing client_email or private_key fields');
  }
  return sa;
}

async function signServiceAccountJwt(sa, claim) {
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify(claim));
  const unsigned = `${header}.${payload}`;
  const keyPem = sa.private_key.replace(/\\n/g, '\n');
  const keyData = keyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  let keyBuf;
  try {
    keyBuf = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  } catch(e) {
    throw new Error('Failed to decode private_key base64: ' + e.message);
  }
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBuf.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  const sig = b64u(sigBuf);
  return `${unsigned}.${sig}`;
}

function b64u(input) {
  const str = typeof input === 'string' ? input : String.fromCharCode(...new Uint8Array(input));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonResp(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
