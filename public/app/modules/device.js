// Module 5: Device environment consistency.
//
// Reads timezone, language, UA, screen, Canvas hash, WebGL renderer.
// Cross-checks against IP country (from Module 1).
//
// Privacy: Canvas data URL is hashed (SHA-256) before being kept; the raw image
// data never leaves this function.

export async function runDevice(ipCountry) {
  const startedAt = performance.now();

  const tz = safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  const tzRegion = (tz.split('/')[0] || '').toLowerCase();
  const lang = (navigator.language || '').toLowerCase();
  const langs = Array.isArray(navigator.languages) ? navigator.languages.map(x => x.toLowerCase()) : [lang];
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const cores = navigator.hardwareConcurrency || 0;
  const memory = navigator.deviceMemory || 0;
  const connType = (navigator.connection && navigator.connection.effectiveType) || '';
  const screenInfo = {
    w: screen.width,
    h: screen.height,
    colorDepth: screen.colorDepth,
    devicePixelRatio: window.devicePixelRatio || 1
  };

  const canvasHash = await safeAsync(canvasFingerprint, '');
  const webglRenderer = safe(getWebGLRenderer, '');

  const tzCountryMatch = matchTimezoneToCountry(tzRegion, ipCountry);
  const langCountryMatch = matchLanguageToCountry(lang, ipCountry);
  const uaScreenMatch = matchUaToScreen(ua, screenInfo);

  return {
    ok: true,
    durationMs: Math.round(performance.now() - startedAt),
    timezone: tz,
    language: lang,
    languages: langs,
    ua,
    platform,
    cores,
    memory,
    connType,
    screen: screenInfo,
    canvasHash,
    webglRenderer,
    ipCountry: ipCountry || '',
    tzCountryMatch,
    langCountryMatch,
    uaScreenMatch
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function safe(fn, dflt = null) {
  try { return fn(); } catch (_) { return dflt; }
}
async function safeAsync(fn, dflt = null) {
  try { return await fn(); } catch (_) { return dflt; }
}

async function canvasFingerprint() {
  const c = document.createElement('canvas');
  c.width = 280; c.height = 60;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.textBaseline = 'top';
  ctx.font = "14px 'Arial'";
  ctx.fillStyle = '#f60';
  ctx.fillRect(0, 0, 280, 60);
  ctx.fillStyle = '#069';
  ctx.fillText('小白兔TKNC ✨🛰️ 测试 ABCxyz 123', 4, 10);
  ctx.fillStyle = 'rgba(102,204,0,0.7)';
  ctx.fillText('小白兔TKNC ✨🛰️ 测试 ABCxyz 123', 8, 30);
  const dataUrl = c.toDataURL();
  return await sha256(dataUrl);
}

async function sha256(str) {
  if (window.crypto && crypto.subtle) {
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback: simple non-crypto hash (only used if SubtleCrypto unavailable)
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

function getWebGLRenderer() {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
  if (!gl) return '';
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (!dbg) return gl.getParameter(gl.RENDERER) || '';
  return gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
}

// ── Cross-checks ────────────────────────────────────────────────────────────

function matchTimezoneToCountry(region, country) {
  if (!region || !country) return null;
  const cc = country.toUpperCase();
  const map = {
    'america': ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'VE'],
    'europe':  ['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'SE', 'NO', 'FI', 'DK', 'PL', 'PT', 'IE', 'CH', 'AT', 'CZ', 'GR', 'HU', 'RO'],
    'asia':    ['CN', 'JP', 'KR', 'SG', 'TW', 'HK', 'TH', 'VN', 'PH', 'MY', 'ID', 'IN', 'AE', 'IL', 'TR'],
    'australia': ['AU', 'NZ'],
    'africa':  ['EG', 'ZA', 'NG', 'KE', 'MA'],
    'pacific': ['AU', 'NZ', 'FJ']
  };
  const expected = map[region];
  if (!expected) return null;
  return expected.includes(cc);
}

function matchLanguageToCountry(lang, country) {
  if (!lang || !country) return null;
  const cc = country.toUpperCase();
  const primary = lang.split('-')[0];
  const expectedByLang = {
    'en':  ['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'SG', 'HK'],
    'zh':  ['CN', 'TW', 'HK', 'SG', 'MO'],
    'ja':  ['JP'],
    'ko':  ['KR'],
    'es':  ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE'],
    'fr':  ['FR', 'CA', 'BE', 'CH'],
    'de':  ['DE', 'AT', 'CH'],
    'pt':  ['PT', 'BR'],
    'ru':  ['RU'],
    'vi':  ['VN'],
    'th':  ['TH'],
    'id':  ['ID']
  };
  const ex = expectedByLang[primary];
  if (!ex) return null;
  return ex.includes(cc);
}

function matchUaToScreen(ua, screenInfo) {
  if (!ua) return null;
  const isMobileUa = /iPhone|iPod|Android|Mobile/.test(ua);
  const minDim = Math.min(screenInfo.w, screenInfo.h);
  const isPhoneScreen = minDim <= 600;
  // True if UA agrees with screen dimensions
  if (isMobileUa && !isPhoneScreen) return false;
  if (!isMobileUa && isPhoneScreen) return false;
  return true;
}
