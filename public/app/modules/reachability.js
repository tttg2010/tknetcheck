// Module 6: TikTok reachability.
//
// Three target probes: main site, API host, CDN host. Each tried up to 3 times
// with an 8s timeout. We don't actually need a successful CORS response —
// fetch resolving without aborting is sufficient signal.

import { pingFetch } from '../util/perf.js';

const PROBES = [
  { kind: 'site', url: 'https://www.tiktok.com/' },
  { kind: 'api',  url: 'https://api16-normal-useast5.tiktokv.com/' },
  { kind: 'cdn',  url: 'https://p16-sign-va.tiktokcdn.com/' }
];

const TIMEOUT_MS = 8000;
const MAX_RETRIES = 3;

export async function runReachability() {
  const startedAt = performance.now();
  const results = [];

  for (const probe of PROBES) {
    let attempts = 0;
    let ok = false;
    let lastError = '';
    let firstAttemptMs = 0;
    while (attempts < MAX_RETRIES && !ok) {
      attempts++;
      const t0 = performance.now();
      const r = await pingFetch(`${probe.url}?_=${Date.now()}_${attempts}`, TIMEOUT_MS);
      const dt = performance.now() - t0;
      if (attempts === 1) firstAttemptMs = Math.round(dt);
      if (r.ok) { ok = true; break; }
      lastError = r.error || '';
    }
    results.push({
      kind: probe.kind,
      host: hostOf(probe.url),
      ok,
      attempts,
      firstAttemptMs,
      lastError
    });
  }

  const totalProbes = results.length;
  const allOk = results.every(r => r.ok);
  const totalRetries = results.reduce((a, r) => a + (r.attempts - 1), 0);

  return {
    ok: true,
    durationMs: Math.round(performance.now() - startedAt),
    totalProbes,
    successes: results.filter(r => r.ok).length,
    totalRetries,
    allOk,
    probes: results
  };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (_) { return url; }
}
