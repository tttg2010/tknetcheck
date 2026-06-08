// Module 2: DNS detection (degraded MVP).
//
// Without a self-hosted authoritative DNS server we cannot observe which resolver
// the user's network actually queried. MVP signals:
//
//   1. DoH reachability: are Google DoH and Cloudflare DoH both reachable?
//      If either is blocked, the user's network may be doing DNS filtering.
//   2. Non-CDN baseline DoH comparison: ask both DoH providers to resolve
//      a non-CDN reference domain (example.com — IANA stable A records).
//      If they disagree here, real DNS manipulation is suspected.
//      We do NOT compare IPs for CDN domains like www.tiktok.com, since
//      CDNs intentionally return different nodes per resolver location.
//   3. Timezone ↔ IP country cross-check: a strong proxy signal for the
//      "DNS country mismatch" symptom users report.

const TIMEOUT_MS = 5000;
const TIKTOK_TARGET = 'www.tiktok.com';      // CDN domain — for display only
const BASELINE_TARGET = 'example.com';        // non-CDN, IANA-stable A records — used for the actual consistency check

// ── Public API ────────────────────────────────────────────────────────────────
export async function runDns(ipCountry, ipCountryName) {
  const startedAt = performance.now();

  // 1. DoH lookups — TikTok for display, example.com for consistency check
  const [gTikTok, cTikTok, gBaseline, cBaseline] = await Promise.allSettled([
    dohGoogle(TIKTOK_TARGET),
    dohCloudflare(TIKTOK_TARGET),
    dohGoogle(BASELINE_TARGET),
    dohCloudflare(BASELINE_TARGET)
  ]);

  const tiktokGoogleIps     = pickARecords(gTikTok.status === 'fulfilled' ? gTikTok.value : null);
  const tiktokCloudflareIps = pickARecords(cTikTok.status === 'fulfilled' ? cTikTok.value : null);
  const baselineGoogleIps     = pickARecords(gBaseline.status === 'fulfilled' ? gBaseline.value : null);
  const baselineCloudflareIps = pickARecords(cBaseline.status === 'fulfilled' ? cBaseline.value : null);

  const googleReachable = gTikTok.status === 'fulfilled' || gBaseline.status === 'fulfilled';
  const cloudflareReachable = cTikTok.status === 'fulfilled' || cBaseline.status === 'fulfilled';
  const dohWorked = googleReachable || cloudflareReachable;
  const bothDohReachable = googleReachable && cloudflareReachable;

  // Baseline consistency: do both DoH providers return overlapping A records
  // for a NON-CDN domain? Only meaningful if both providers replied.
  let baselineConsistent = null;
  if (baselineGoogleIps.length > 0 && baselineCloudflareIps.length > 0) {
    baselineConsistent = intersect(baselineGoogleIps, baselineCloudflareIps).length > 0;
  }

  // 2. Timezone vs IP country
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
  const tzRegion = (tz.split('/')[0] || '').toLowerCase();
  const tzCountryMatch = ipCountry ? matchTimezoneToCountry(tzRegion, ipCountry) : null;

  return {
    ok: true,
    durationMs: Math.round(performance.now() - startedAt),
    target: TIKTOK_TARGET,
    baselineTarget: BASELINE_TARGET,
    // For display (informational; CDN domains diverge by design)
    tiktokGoogleIps,
    tiktokCloudflareIps,
    // Reachability signal (we actually score on this)
    googleReachable,
    cloudflareReachable,
    bothDohReachable,
    dohWorked,
    // Real consistency check on non-CDN baseline
    baselineGoogleIps,
    baselineCloudflareIps,
    baselineConsistent,                    // true / false / null (insufficient data)
    // Timezone cross-check
    timezone: tz,
    ipCountry: ipCountry || '',
    ipCountryName: ipCountryName || '',
    ipCountryKnown: !!ipCountry,
    tzCountryMatch,                         // true / false / null
    degraded: true
  };
}

// ── DoH calls ────────────────────────────────────────────────────────────────
async function dohGoogle(name) {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=A`;
  return fetchJson(url, { 'Accept': 'application/dns-json' });
}

async function dohCloudflare(name) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=A`;
  return fetchJson(url, { 'Accept': 'application/dns-json' });
}

async function fetchJson(url, headers) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(tid);
  }
}

// Extract A record IPs from a DoH JSON response.
function pickARecords(payload) {
  if (!payload || !Array.isArray(payload.Answer)) return [];
  return payload.Answer.filter(a => a.type === 1).map(a => (a.data || '').trim()).filter(Boolean);
}

function intersect(a, b) {
  const set = new Set(b);
  return a.filter(x => set.has(x));
}

// Timezone region (e.g. "asia", "america", "europe") to country-code rough mapping.
// Returns true if the IP country is plausible for the timezone region.
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
  if (!expected) return null;  // unknown region → don't penalize
  return expected.includes(cc);
}
