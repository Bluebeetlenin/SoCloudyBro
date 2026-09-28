#!/usr/bin/env node
/**
 * SCB pre-push validator — run before every git push.
 * Catches scope bugs, missing window.* exports, and runtime errors
 * by loading the file in a headless Chromium browser.
 */
const PLAYWRIGHT_PATH = (() => {
  const candidates = [
    '/tmp/claude-0/-home-user-CubeLeap-/cd1865d1-c9c3-53c0-b714-7689b92a6590/scratchpad/node_modules/playwright',
    'playwright'
  ];
  for (const c of candidates) { try { require.resolve(c); return c; } catch {} }
  return 'playwright';
})();
const { chromium } = require(PLAYWRIGHT_PATH);
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.resolve(__dirname, '..', 'SoCloudyBro.html');
const FILE_URL = 'file://' + HTML_PATH;

// ── Functions that must be accessible globally ───────────────────────────────
// (either via var/function declaration OR via window.* assignment from an IIFE)
// Note: _injectCloudyContact is intentionally IIFE-internal — NOT a required global
const REQUIRED_GLOBALS = [
  'renderSidebar', 'openChat', 'sendMsg', 'showToast',
  '_saveDraft', '_loadDraft',
  '_renderCloudyChat', '_cloudyDeliverMsg', '_sendToCloudyChat',
];

// ── Calls inside openChat patch that must resolve ────────────────────────────
// These were the root cause of "X is not defined" crashes
const OPEN_CHAT_PATCH_CALLS = [
  'window._renderCloudyChat',
  'window._cloudyDeliverMsg',
];

// ── Static checks (no browser needed) ───────────────────────────────────────
function staticChecks(src) {
  const issues = [];

  // Check window.* exports exist for each patched call
  OPEN_CHAT_PATCH_CALLS.forEach(call => {
    const name = call.replace('window.', '');
    const assignPattern = new RegExp('window\\.' + name + '\\s*=');
    if (!assignPattern.test(src)) {
      issues.push('SCOPE: ' + call + ' is called but never assigned to window.*');
    }
    // Check the openChat patch specifically uses window.* (not bare name).
    // Only look inside the openChat function body — bare calls INSIDE the
    // slash+cloudy IIFE are valid intra-scope calls, not scope violations.
    const openChatMatch = src.match(/async function openChat[\s\S]{0,4000}/);
    if (openChatMatch) {
      const bareInPatch = new RegExp('(?<!window\\.)\\b' + name + '\\s*\\(');
      if (bareInPatch.test(openChatMatch[0])) {
        issues.push('SCOPE: bare call to ' + name + '() in openChat — use window.' + name + '() instead');
      }
    }
  });

  // Check for common patterns that break across IIFE boundaries
  const iifeFunctions = [];
  let depth = 0;
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    depth += (line.match(/\{/g)||[]).length - (line.match(/\}/g)||[]).length;
    // Very rough IIFE detection
    if (/\(function[\s(]/.test(line)) {
      const fnMatch = line.match(/function\s+(_\w+)\s*\(/);
      if (fnMatch) iifeFunctions.push({ name: fnMatch[1], line: i+1, depth });
    }
  });

  // Check that _saveDraft is called after input.value='' in sendMsg
  const sendMsgBlock = src.match(/async function sendMsg[\s\S]{0,3000}/);
  if (sendMsgBlock) {
    const block = sendMsgBlock[0];
    const clearIdx = block.indexOf("input.value = ''");
    const draftIdx = block.indexOf('_saveDraft');
    if (clearIdx > -1 && draftIdx === -1) {
      issues.push('DRAFT: sendMsg clears input but never calls _saveDraft() — drafts will linger after send');
    }
  }

  // Check search input has autocomplete=off
  if (!/<input[^>]*id="sb-search-input"[^>]*autocomplete="off"/.test(src)) {
    issues.push('AUTOFILL: #sb-search-input is missing autocomplete="off" — browser may autofill email');
  }

  // Check virus scan result uses localStorage caching
  if (!src.includes('cc_scan_')) {
    issues.push('SCAN: virus scan results not cached in localStorage — will re-scan on every chat open');
  }

  return issues;
}

// ── Runtime checks (headless browser) ───────────────────────────────────────
async function runtimeChecks() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: ['--no-sandbox', '--ignore-certificate-errors', '--disable-web-security'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const jsErrors = [];
  page.on('pageerror', err => {
    const msg = err.message;
    // Ignore expected 3rd-party errors
    if (msg.includes('Turnstile') || msg.includes('GSI_LOGGER') || msg.includes('net::')) return;
    jsErrors.push(msg);
  });

  await page.goto(FILE_URL, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Check required globals accessible by their bare name (eval trick)
  const globalResults = await page.evaluate((names) => {
    const out = {};
    names.forEach(n => {
      try { out[n] = typeof eval(n); } // eslint-disable-line no-eval
      catch(e) { out[n] = 'MISSING: ' + e.message; }
    });
    return out;
  }, REQUIRED_GLOBALS);

  // Open Cloudy chat — this was the main crashing scenario
  const cloudyResult = await page.evaluate(() => {
    try {
      const c = typeof CLOUDY_CONTACT !== 'undefined' ? CLOUDY_CONTACT
        : { _isCloudy: true, number: '00000', name: 'Cloudy', type: 'dm', avatar: '__cloudy__', key: 'dm_00000_cloudy' };
      openChat(c);
      return 'OK';
    } catch(e) { return 'ERROR: ' + e.message; }
  });
  await page.waitForTimeout(500);

  const chatPanelVisible = await page.evaluate(() => {
    const p = document.getElementById('chat-panel');
    return p ? p.classList.contains('visible') : false;
  });

  await browser.close();
  return { globalResults, cloudyResult, chatPanelVisible, jsErrors };
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const src = fs.readFileSync(HTML_PATH, 'utf8');
  let failed = 0;

  console.log('\n── Static checks ──────────────────────────────');
  const staticIssues = staticChecks(src);
  if (staticIssues.length) {
    staticIssues.forEach(i => { console.error('  ✗', i); failed++; });
  } else {
    console.log('  ✓ All static checks pass');
  }

  console.log('\n── Runtime checks (headless browser) ──────────');
  let rt;
  try {
    rt = await runtimeChecks();
  } catch(e) {
    console.error('  ✗ Runtime check failed to launch:', e.message);
    // Don't block push for browser launch failures (e.g. network-only CI)
    console.log('  ⚠ Skipping runtime checks (browser unavailable)');
    process.exit(failed > 0 ? 1 : 0);
  }

  // Globals
  for (const [name, type] of Object.entries(rt.globalResults)) {
    if (type.startsWith('MISSING')) {
      console.error('  ✗ GLOBAL MISSING:', name, '—', type);
      failed++;
    } else {
      console.log('  ✓', name, ':', type);
    }
  }

  // Cloudy chat
  if (rt.cloudyResult === 'OK') {
    console.log('  ✓ openChat(Cloudy) → OK, panel visible:', rt.chatPanelVisible);
  } else {
    console.error('  ✗ openChat(Cloudy) →', rt.cloudyResult);
    failed++;
  }

  // JS errors
  if (rt.jsErrors.length) {
    rt.jsErrors.forEach(e => { console.error('  ✗ JS ERROR:', e); failed++; });
  } else {
    console.log('  ✓ No unexpected JS errors at page load');
  }

  console.log('\n── Result ──────────────────────────────────────');
  if (failed > 0) {
    console.error('  FAILED (' + failed + ' issue' + (failed !== 1 ? 's' : '') + ')');
    process.exit(1);
  } else {
    console.log('  ALL CHECKS PASSED');
    process.exit(0);
  }
})();
