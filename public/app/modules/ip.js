// Module 1: IP identity detection.
//
// Architecture note: the `ipinfo` cloud function runs in a China datacenter and
// CANNOT see the user's real public IP through callFunction context. So the
// browser must first detect its own public IP (which, behind a proxy, is the
// proxy's IP — exactly what we want), then pass it to the cloud function for
// enrichment (ASN, hosting flag, risk score via token-protected APIs).

import { api } from '../api.js?v=6';

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
    // Step 1 — 浏览器尝试用国际回显服务拿到自己的公网(代理)IP。
    // 拿不到不代表失败：国内直连/代理未生效时够不到国际回显——此时改用后端
    // 从 Cloudflare 侧看到的出口 IP（CF-Connecting-IP）兜底，这样也能出 IP 画像。
    const publicIp = await detectPublicIp();
    const intlEchoFailed = !publicIp;

    // Step 2 — 后端富化。传到浏览器探到的 IP 优先；没探到则不传，后端用 CF-IP 兜底。
    let res;
    try {
      res = await api.ipinfo(publicIp || null);
    } catch (e) {
      // 后端也连不上：区分未联网 / 国际网络受限。
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
      return {
        ok: false, offline, restricted: !offline,
        durationMs: Math.round(performance.now() - startedAt),
        error: offline ? '设备未联网'
          : (intlEchoFailed ? '国际网络不可达 — 当前可能是国内直连或代理未生效' : (e && e.message) || String(e))
      };
    }
    const data = (res && (res.data || res)) || {};

    // 后端也没能定位到 IP（无 country）→ 退回受限判定。
    if (!data.country && !data.ip) {
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
      return {
        ok: false, offline, restricted: !offline && intlEchoFailed,
        durationMs: Math.round(performance.now() - startedAt),
        error: intlEchoFailed ? '国际网络不可达 — 当前可能是国内直连或代理未生效' : `后端返回错误：${res && (res.message || res.code)}`
      };
    }

    return {
      ok: true,
      intlEchoFailed,               // true = 浏览器够不到国际回显，IP 取自服务器侧
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
