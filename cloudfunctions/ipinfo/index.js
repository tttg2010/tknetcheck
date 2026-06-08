// Cloud function: ipinfo
//
// Aggregates IP intelligence from three sources (ipinfo.io, ip-api.com,
// scamalytics.com) and returns a normalized record. Keeps API keys server-side.
//
// Triggered via tcb.callFunction or HTTP gateway.
// Env vars (set via `tcb fn config update ipinfo --envParams ...`):
//   IPINFO_TOKEN     — required, free tier 50k/mo from ipinfo.io
//   SCAMALYTICS_KEY  — optional, omits scraping fallback when present
//   SCAMALYTICS_USER — optional, username for scamalytics API

const axios = require('axios');

// Tiny in-memory LRU cache (per warm function instance)
const CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

function cacheGet(key) {
  const v = CACHE.get(key);
  if (!v) return null;
  if (Date.now() - v.at > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return v.data;
}
function cacheSet(key, data) {
  if (CACHE.size >= CACHE_MAX) {
    const firstKey = CACHE.keys().next().value;
    CACHE.delete(firstKey);
  }
  CACHE.set(key, { at: Date.now(), data });
}

// Rate limit: per caller IP, 10 calls / minute
const RL = new Map();
function rateLimit(callerIp) {
  if (!callerIp) return true;
  const now = Date.now();
  const window = 60 * 1000;
  const max = 10;
  const arr = (RL.get(callerIp) || []).filter(ts => now - ts < window);
  if (arr.length >= max) return false;
  arr.push(now);
  RL.set(callerIp, arr);
  return true;
}

// Normalize the event whether called via HTTP Access Service
// (payload is a JSON string in event.body) or via callFunction (event IS the data).
function parseEvent(event) {
  event = event || {};
  if (typeof event.body === 'string') {
    let body = {};
    try { body = JSON.parse(event.body) || {}; } catch (_) {}
    return { data: body, headers: event.headers || {} };
  }
  return { data: event, headers: event.headers || {} };
}

exports.main = async (event, context) => {
  const { data: reqData, headers } = parseEvent(event);

  // Caller IP: from HTTP headers (HTTP Access Service) or context (callFunction)
  const callerIp = (headers['x-forwarded-for'] || headers['x-real-ip'] || '').split(',')[0].trim()
    || (context && (context.SOURCE_IP || context.clientIP))
    || '';

  // The browser passes the user's detected public IP in `ip`; fall back to caller IP.
  const targetIp = reqData.ip || callerIp;
  if (!targetIp) {
    return { code: 400, message: '无法获取 IP（请在请求体中传入 ip 字段）' };
  }

  if (!rateLimit(targetIp)) {
    return { code: 429, message: '请求过于频繁，请稍后再试' };
  }

  const cached = cacheGet(targetIp);
  if (cached) {
    return { code: 0, data: { ...cached, cached: true } };
  }

  // Fan out to data sources
  const tasks = [];
  if (process.env.IPINFO_TOKEN) tasks.push(callIpinfo(targetIp));
  else tasks.push(Promise.resolve(null));
  tasks.push(callIpApi(targetIp));
  tasks.push(callScamalytics(targetIp));

  const [ipinfoData, ipApiData, scamData] = await Promise.allSettled(tasks)
    .then(rs => rs.map(r => r.status === 'fulfilled' ? r.value : null));

  // Normalize / merge
  const data = mergeSources({ targetIp, ipinfoData, ipApiData, scamData });
  cacheSet(targetIp, data);
  return { code: 0, data };
};

// ── Sources ─────────────────────────────────────────────────────────────────

async function callIpinfo(ip) {
  try {
    const url = `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${process.env.IPINFO_TOKEN}`;
    const r = await axios.get(url, { timeout: 5000 });
    return r.data;
  } catch (e) {
    console.warn('[ipinfo.io] failed', e && e.message);
    return null;
  }
}

async function callIpApi(ip) {
  try {
    // bitmask 66842623 = country, countryCode, region, regionName, city, zip,
    //                   lat, lon, timezone, isp, org, as, asname, mobile, proxy, hosting, query
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=66842623`;
    const r = await axios.get(url, { timeout: 5000 });
    return r.data;
  } catch (e) {
    console.warn('[ip-api.com] failed', e && e.message);
    return null;
  }
}

async function callScamalytics(ip) {
  try {
    if (process.env.SCAMALYTICS_USER && process.env.SCAMALYTICS_KEY) {
      const url = `https://api.scamalytics.com/${process.env.SCAMALYTICS_USER}/?key=${process.env.SCAMALYTICS_KEY}&ip=${encodeURIComponent(ip)}`;
      const r = await axios.get(url, { timeout: 5000 });
      return r.data;
    }
    // Best-effort scrape fallback — parse free public page
    const url = `https://scamalytics.com/ip/${encodeURIComponent(ip)}`;
    const r = await axios.get(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0 小白兔TKNC/1.0' } });
    const m = String(r.data).match(/Fraud Score:[^>]*>\s*(\d+)/i);
    if (m) return { score: parseInt(m[1], 10), source: 'scrape' };
    return null;
  } catch (e) {
    console.warn('[scamalytics] failed', e && e.message);
    return null;
  }
}

// ── Merge ───────────────────────────────────────────────────────────────────

function mergeSources({ targetIp, ipinfoData, ipApiData, scamData }) {
  const ii = ipinfoData || {};
  const ia = ipApiData || {};
  const sc = scamData || {};

  // Country / region / city — prefer ipinfo.io when available
  const country = (ii.country || ia.countryCode || '').toUpperCase();
  const countryName = ia.country || (ii.country ? ii.country : '');
  const city = ii.city || ia.city || '';
  const region = ii.region || ia.regionName || '';
  // ASN
  const asn = ii.org || ia.as || '';        // ipinfo "AS15169 Google LLC" or ip-api "AS15169 Google LLC"
  const org = ia.isp || ia.org || ii.org || '';

  // Booleans
  const isHosting = !!(ia.hosting === true);
  const isProxy   = !!(ia.proxy === true);
  const isMobile  = !!(ia.mobile === true);
  const isResidential = !isHosting && !isProxy && !isMobile;

  // Risk score (Scamalytics, 0-100)
  let riskScore = null;
  if (typeof sc.score === 'number') riskScore = sc.score;
  else if (sc.scamalytics && typeof sc.scamalytics.scamalytics_score === 'number') riskScore = sc.scamalytics.scamalytics_score;

  return {
    ip: targetIp,
    country, countryName, city, region,
    asn, org,
    isHosting, isProxy, isMobile, isResidential,
    riskScore,
    raw: {
      ipinfo: pickKeys(ii, ['org', 'asn', 'company', 'privacy', 'abuse', 'domains']),
      ipapi:  pickKeys(ia, ['isp', 'org', 'as', 'asname', 'mobile', 'proxy', 'hosting']),
      scam:   sc
    }
  };
}

function pickKeys(obj, keys) {
  const out = {};
  if (!obj) return out;
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
