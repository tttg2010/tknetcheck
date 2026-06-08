// PerformanceObserver helpers and timing extraction.

// Subscribe to resource-timing entries. Returns an unsubscribe fn.
export function observeResources(onEntry) {
  let stopped = false;
  let observer = null;
  try {
    observer = new PerformanceObserver((list) => {
      if (stopped) return;
      for (const entry of list.getEntriesByType('resource')) {
        try { onEntry(entry); } catch (_) {}
      }
    });
    observer.observe({ type: 'resource', buffered: true });
  } catch (e) {
    // Older browsers may not support this — caller should fallback to fetch timing.
  }
  return () => {
    stopped = true;
    try { observer && observer.disconnect(); } catch (_) {}
  };
}

// Extract a normalized timing record from a PerformanceResourceTiming entry.
// Returns null if the entry has no useful data.
export function extractTiming(entry) {
  if (!entry || !entry.name) return null;
  const t = {
    name: entry.name,
    host: hostOf(entry.name),
    protocol: entry.nextHopProtocol || '',
    duration: entry.duration || 0,
    dns: safeDelta(entry.domainLookupEnd, entry.domainLookupStart),
    tcp: safeDelta(entry.connectEnd, entry.connectStart),
    tls: entry.secureConnectionStart > 0 ? safeDelta(entry.connectEnd, entry.secureConnectionStart) : 0,
    ttfb: safeDelta(entry.responseStart, entry.requestStart),
    download: safeDelta(entry.responseEnd, entry.responseStart),
    startTime: entry.startTime,
    responseEnd: entry.responseEnd,
    transferSize: entry.transferSize || 0
  };
  // If everything is zero (opaque resource with no TAO), still record duration so loss detection works.
  return t;
}

function safeDelta(a, b) {
  const x = (a || 0) - (b || 0);
  return x > 0 ? x : 0;
}

export function hostOf(url) {
  try { return new URL(url).hostname; } catch (_) { return ''; }
}

// Wait helper.
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Fetch with timeout via AbortController. Always uses no-cors + cache:no-store.
export async function pingFetch(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      redirect: 'follow',
      credentials: 'omit',
      signal: ctrl.signal
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'error' };
  } finally {
    clearTimeout(tid);
  }
}
