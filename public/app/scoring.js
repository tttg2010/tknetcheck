// Central scoring rules for all 6 modules + weighted overall score.
//
// Each scorer takes the result object from the corresponding detection module
// (see /js/modules/*.js) and returns an integer 0-100.

import { clamp, linearScore } from './util/stats.js';

// Module weights (must sum to 100)
export const WEIGHTS = {
  ip: 25,
  dns: 15,
  webrtc: 15,
  stability: 25,
  device: 10,
  reachability: 10
};

// IDC / hosting ASN names — incomplete but covers the most common cheap proxies.
const IDC_ASN_PATTERNS = [
  /amazon/i, /aws/i, /google/i, /microsoft|azure/i, /ovh/i, /digitalocean/i,
  /linode/i, /akamai/i, /vultr/i, /hetzner/i, /datacamp|m247/i, /choopa/i,
  /leaseweb/i, /alibaba|aliyun/i, /tencent/i, /huawei/i, /oracle/i, /server/i,
  /hosting/i, /idc/i, /\bcdn\b/i
];

// TikTok-friendly default country whitelist. User can adjust later.
const TIKTOK_FRIENDLY = ['US', 'JP', 'KR', 'GB', 'CA', 'AU', 'NZ', 'SG', 'TW', 'HK', 'MO', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'SE', 'NO', 'FI', 'DK', 'IE', 'CH', 'AT', 'TH', 'VN', 'PH', 'MY', 'ID', 'BR', 'MX'];

export function scoreIp(r) {
  if (!r || !r.ok) return 0;
  let s = 100;
  if (r.isHosting || isIdcAsn(r.org) || isIdcAsn(r.asn)) s -= 40;
  if (r.isProxy) s -= 20;
  if (typeof r.riskScore === 'number') {
    if (r.riskScore >= 75) s -= 30;
    else if (r.riskScore >= 25) s -= 15;
  }
  if (r.country && !TIKTOK_FRIENDLY.includes(r.country.toUpperCase())) s -= 10;
  return clamp(s, 0, 100);
}

function isIdcAsn(name) {
  if (!name) return false;
  return IDC_ASN_PATTERNS.some(re => re.test(name));
}

export function scoreDns(r) {
  if (!r || !r.ok) return 0;
  // MVP cap at 90 — honest disclosure that full DNS leak detection unavailable.
  let s = 70;

  // DoH reachability: penalize when one provider is unreachable (likely filtering).
  if (r.bothDohReachable) s += 10;
  else if (r.googleReachable || r.cloudflareReachable) s -= 10;
  else s -= 30;

  // Real consistency check on the non-CDN baseline domain.
  // (We deliberately do NOT compare CDN domain IPs — they differ by design.)
  if (r.baselineConsistent === false) s -= 30;
  // If null (insufficient data), no penalty — honest about uncertainty.

  // Timezone vs IP country (only meaningful when IP country is known).
  if (r.tzCountryMatch === true) s += 20;
  else if (r.tzCountryMatch === false) s -= 30;

  return clamp(s, 0, 90);
}

export function scoreWebRTC(r) {
  if (!r || !r.ok) return 0;
  let s = 100;
  if (r.hasWebRtcLeak) s -= 50;
  if (r.hasIpv6Leak) s -= 30;
  if (r.realLocalIps && r.realLocalIps.length) s -= 10;
  // When IP module failed we have no reference to detect a leak against.
  // Cap the score to make clear the result is incomplete.
  if (!r.referenced) s = Math.min(s, 60);
  return clamp(s, 0, 100);
}

export function scoreStability(r) {
  if (!r || !r.ok) return 0;
  const o = r.overall || {};
  // Compute available sub-scores. If a dimension is null (unmeasured), drop it
  // from the average rather than treating it as either 0 or perfect.
  const sub = [];
  if (typeof o.latency === 'number' && o.latency > 0) sub.push(linearScore(o.latency, 150, 800));
  if (typeof o.jitter  === 'number' && o.jitter  > 0) sub.push(linearScore(o.jitter, 30, 200));
  if (typeof o.tls     === 'number' && o.tls     > 0) sub.push(linearScore(o.tls, 200, 1000));
  if (typeof o.loss    === 'number')                  sub.push(linearScore(o.loss, 0, 20));
  if (sub.length === 0) return 0;
  const avg = sub.reduce((a, b) => a + b, 0) / sub.length;
  // Coarse mode penalty (less reliable measurement)
  return clamp(Math.round(avg) - (r.coarse ? 5 : 0), 0, 100);
}

export function scoreDevice(r) {
  if (!r || !r.ok) return 0;
  // If we don't have an IP country, we can't run the two most important
  // cross-checks. Cap the score to make clear the result is incomplete.
  const hasIp = !!r.ipCountry;
  let s = 100;
  if (r.tzCountryMatch === false) s -= 30;
  if (r.langCountryMatch === false) s -= 20;
  if (r.uaScreenMatch === false) s -= 10;
  if (!hasIp) s = Math.min(s, 60);  // cap when cross-check not performed
  return clamp(s, 0, 100);
}

export function scoreReachability(r) {
  if (!r || !r.ok) return 0;
  if (!r.allOk && r.successes === 0) return 0;
  // 100 base, -25 per retry (across all probes)
  return clamp(100 - 25 * (r.totalRetries || 0), 0, 100);
}

// Compute weighted overall.
export function overall(scores) {
  const w = WEIGHTS;
  const total =
    scores.ip * w.ip +
    scores.dns * w.dns +
    scores.webrtc * w.webrtc +
    scores.stability * w.stability +
    scores.device * w.device +
    scores.reachability * w.reachability;
  return Math.round(total / 100);
}

export function tierOf(score) {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'warning';
  return 'danger';
}
