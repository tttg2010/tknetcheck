// Module 4: Network stability — 30-second sampler.
//
// Mechanism:
//   - For each TikTok-related domain, fire one fetch per second with
//     mode:'no-cors' + cache-busting query string.
//   - A PerformanceObserver records `resource` entries as they complete.
//   - Aggregate into per-target metrics: avg latency, jitter (stddev),
//     packet loss approximation, TLS handshake time.
//
// Notes:
//   - With no-cors opaque responses, browsers may return responseStart=0 if
//     the server doesn't send Timing-Allow-Origin. We detect this and fall
//     back to `duration` (responseEnd - startTime).
//   - "Packet loss" here is request loss: count fetches that didn't produce
//     any Performance entry within a window.

import { observeResources, extractTiming, pingFetch, hostOf, sleep } from '../util/perf.js';
import { mean, stddev, clamp } from '../util/stats.js';

export const TARGETS = [
  'https://www.tiktok.com/',
  'https://api16-normal-useast5.tiktokv.com/',
  'https://v16-webapp.tiktok.com/',
  'https://p16-sign-va.tiktokcdn.com/',
  'https://mon.tiktokv.com/'
];

const TOTAL_MS = 30000;
const INTERVAL_MS = 1000;
const PER_REQ_TIMEOUT = 8000;

// onProgress: ({elapsedMs, totalMs}) → for UI tick
export async function runStability(onProgress) {
  const startedAt = performance.now();

  // Bucket of timings by host
  const samples = new Map();              // host → array<timing>
  const dispatched = new Map();           // host → count of fetches we kicked off
  for (const url of TARGETS) {
    samples.set(hostOf(url), []);
    dispatched.set(hostOf(url), 0);
  }

  const stopObserver = observeResources((entry) => {
    const h = hostOf(entry.name);
    if (!samples.has(h)) return;
    const t = extractTiming(entry);
    if (t) samples.get(h).push(t);
  });

  // Drive sampler
  const start = performance.now();
  let tick = 0;
  while (performance.now() - start < TOTAL_MS) {
    tick++;
    for (const url of TARGETS) {
      const h = hostOf(url);
      dispatched.set(h, dispatched.get(h) + 1);
      // intentionally not awaiting — fire in parallel, observer collects
      pingFetch(`${url}?_=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, PER_REQ_TIMEOUT);
    }
    const elapsed = performance.now() - start;
    onProgress && onProgress({ elapsedMs: Math.min(elapsed, TOTAL_MS), totalMs: TOTAL_MS });
    await sleep(INTERVAL_MS);
  }

  // Give late entries a moment to register
  await sleep(500);
  stopObserver();

  // Compute per-target stats
  const perTarget = [];
  let anyCoarse = false;
  for (const url of TARGETS) {
    const h = hostOf(url);
    const arr = samples.get(h) || [];
    const expected = dispatched.get(h) || 0;
    const received = arr.length;
    const loss = expected > 0 ? clamp((expected - received) / expected, 0, 1) : 0;

    // Detect coarse mode: responseStart unavailable (>50% zeros) → use duration
    const ttfbValues = arr.map(t => t.ttfb).filter(x => x > 0);
    const zeroRate = arr.length > 0 ? (arr.length - ttfbValues.length) / arr.length : 0;
    const coarse = zeroRate > 0.5;
    if (coarse) anyCoarse = true;

    const latencies = coarse
      ? arr.map(t => t.duration).filter(x => x > 0)
      : ttfbValues;

    const latency = latencies.length ? mean(latencies) : 0;
    const jitter = latencies.length > 1 ? stddev(latencies) : 0;
    // tls/dns/tcp: null when no positive sample was recorded (opaque response
    // or browser didn't expose the timing). Distinguishing "0" from "unknown"
    // is essential — 0 should never look like a perfect score.
    const tlsSamples = arr.map(t => t.tls).filter(x => x > 0);
    const dnsSamples = arr.map(t => t.dns).filter(x => x > 0);
    const tcpSamples = arr.map(t => t.tcp).filter(x => x > 0);
    const tls = tlsSamples.length ? Math.round(mean(tlsSamples)) : null;
    const dns = dnsSamples.length ? Math.round(mean(dnsSamples)) : null;
    const tcp = tcpSamples.length ? Math.round(mean(tcpSamples)) : null;
    const protocols = Array.from(new Set(arr.map(t => t.protocol).filter(Boolean)));

    perTarget.push({
      host: h,
      latency: Math.round(latency),
      jitter: Math.round(jitter),
      tls,                // null = not measured
      dns,
      tcp,
      loss: +(loss * 100).toFixed(1),
      expected,
      received,
      coarse,
      protocols
    });
  }

  // Overall mean of per-target latency/jitter/loss. TLS is null when no target
  // has measurable TLS handshake time (opaque response without TAO header).
  const validLatencies = perTarget.map(p => p.latency).filter(x => x > 0);
  const validJitters = perTarget.map(p => p.jitter).filter(x => x > 0);
  const validTls = perTarget.map(p => p.tls).filter(x => x !== null && x > 0);
  const overall = {
    latency: validLatencies.length ? Math.round(mean(validLatencies)) : 0,
    jitter:  validJitters.length ? Math.round(mean(validJitters)) : 0,
    tls:     validTls.length ? Math.round(mean(validTls)) : null,   // null = unmeasured
    loss:    +mean(perTarget.map(p => p.loss)).toFixed(1)
  };

  return {
    ok: true,
    durationMs: Math.round(performance.now() - startedAt),
    totalMs: TOTAL_MS,
    perTarget,
    overall,
    coarse: anyCoarse
  };
}
