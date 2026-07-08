// Module 1: IP identity detection.
//
// Architecture note: the `ipinfo` cloud function runs in a China datacenter and
// CANNOT see the user's real public IP through callFunction context. So the
// browser must first detect its own public IP (which, behind a proxy, is the
// proxy's IP — exactly what we want), then pass it to the cloud function for
// enrichment (ASN, hosting flag, risk score via token-protected APIs).

import { api } from '../api.js?v=3';

// CORS-friendly public-IP echo services. Tried in order until one works.
const IP_ECHO_SERVICES = [
  async () => {
    const r = await fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace', 4000);
    const text = await r.text();
    const m = text.match(/^ip=(.+)$/m);
    return m ? m[1].trim() : '';
  },
  async () => {
    const r = await fetchWithTimeout('https://api.ipify.org?format=json', 4000);
    const j = await r.json();
    return (j && j.ip) || '';
  },
  async () => {
    const r = await fetchWithTimeout('https://api64.ipify.org?format=json', 4000);
    const j = await r.json();
    return (j && j.ip) || '';
  }
];

async function fetchWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: 'no-store', signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

// Try each echo service until one returns an IP.
async function detectPublicIp() {
  for (const svc of IP_ECHO_SERVICES) {
    try {
      const ip = await svc();
      if (ip) return ip;
    } catch (_) { /* try next */ }
  }
  return '';
}

export async function runIp() {
  const startedAt = performance.now();
  try {
    // Step 1 — browser detects its own public (proxy) IP.
    const publicIp = await detectPublicIp();
    if (!publicIp) {
      // 拿不到公网 IP 分两种情况，且都是「网络本身」的信号，不是工具坏了：
      //   offline    —— 设备根本没联网
      //   restricted —— 在线，但连 Cloudflare / ipify 这些国际回显服务都到不了
      //                 → 国内直连（没开代理）或代理未生效。对 TikTok 而言这是高风险环境。
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
      return {
        ok: false,
        offline,
        restricted: !offline,
        durationMs: Math.round(performance.now() - startedAt),
        error: offline
          ? '设备未联网'
          : '国际网络不可达 — 当前可能是国内直连或代理未生效'
      };
    }

    // Step 2 — cloud function enriches the IP (ASN, hosting, risk score).
    const res = await api.ipinfo(publicIp);
    const data = (res && (res.data || res)) || {};

    // If the cloud function itself returned a non-zero code, surface it.
    if (res && typeof res.code === 'number' && res.code !== 0 && !data.country) {
      return {
        ok: false,
        durationMs: Math.round(performance.now() - startedAt),
        error: `云函数返回错误：${res.message || res.code}`,
        ip: publicIp
      };
    }

    return {
      ok: true,
      durationMs: Math.round(performance.now() - startedAt),
      // normalized fields (used by scoring + report)
      ip: data.ip || publicIp,
      country: data.country || '',
      countryName: data.countryName || '',
      city: data.city || '',
      region: data.region || '',
      asn: data.asn || '',
      org: data.org || data.isp || '',
      isHosting: !!data.isHosting,
      isProxy: !!data.isProxy,
      isMobile: !!data.isMobile,
      isResidential: !!data.isResidential,
      riskScore: typeof data.riskScore === 'number' ? data.riskScore : null,
      // raw payload for debugging in details view
      raw: data.raw || null
    };
  } catch (e) {
    return {
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      error: (e && e.message) || String(e)
    };
  }
}
