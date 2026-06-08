// Module 3: WebRTC / IPv6 leak detection.
//
// Strategy:
//   1. Open RTCPeerConnection with public STUN servers. Collect ICE candidates
//      for ~3 seconds. Parse for `srflx` (server-reflexive = public IP seen
//      by STUN) candidates. Compare with the IP from Module 1. Any srflx that
//      doesn't match → leak.
//   2. mDNS host candidates (`*.local`) in modern Chrome are anonymized; they
//      do NOT count as a leak. Only real RFC1918 / public IPs do.
//   3. IPv6 probe: try fetching an IPv6-only endpoint with a short timeout.
//      Presence of an IPv6 connection isn't automatically a leak — only if it
//      reveals a different country than the IPv4. We can't reliably geolocate
//      the IPv6 from the browser, so for MVP we just flag "IPv6 detected" as
//      informational unless the user's proxy chain is IPv4-only.

const COLLECT_MS = 3000;
const IPV6_TIMEOUT_MS = 3000;

export async function runWebRTC(publicIp) {
  const startedAt = performance.now();

  const [rtc, ipv6] = await Promise.all([
    collectIceCandidates(),
    probeIpv6()
  ]);

  const srflxIps = rtc.srflx;
  const realLocalIps = rtc.host.filter(isRealLocal);    // not mDNS / not RFC1918 — i.e. real LAN exposure

  // Without a reference IP from Module 1, we cannot determine if WebRTC's
  // observed public IP differs from the user's "expected" public IP. We can
  // still tell *if a public IP was exposed at all*, but not whether it's a leak.
  const referenced = !!publicIp;
  const hasWebRtcLeak = referenced
    ? srflxIps.some(ip => ip && ip !== publicIp)
    : false;  // unknown without reference — never claim "leak" when uncertain

  return {
    ok: true,
    durationMs: Math.round(performance.now() - startedAt),
    referenced,                              // false = no IP basis to cross-check
    referenceIp: publicIp || '',
    srflxIps,
    hostCandidates: rtc.host,
    realLocalIps,
    hasWebRtcLeak,
    ipv6Detected: ipv6.detected,
    ipv6Address: ipv6.address,
    hasIpv6Leak: ipv6.detected  // conservatively report as informational; report layer can downgrade severity
  };
}

// ── ICE collection ──────────────────────────────────────────────────────────
function collectIceCandidates() {
  return new Promise((resolve) => {
    const result = { srflx: [], host: [] };
    let pc;
    try {
      pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' }
        ]
      });
    } catch (e) {
      return resolve(result);  // WebRTC unavailable
    }

    try { pc.createDataChannel('tk-probe'); } catch (_) {}

    pc.onicecandidate = (ev) => {
      if (!ev || !ev.candidate) return;
      const c = ev.candidate.candidate || '';
      // candidate format: "candidate:foundation comp proto pri IP PORT typ TYPE ..."
      const m = c.match(/ ([0-9a-fA-F:.]+) \d+ typ (\w+)/);
      if (!m) return;
      const ip = m[1];
      const typ = m[2];
      if (typ === 'srflx' || typ === 'prflx') {
        if (!result.srflx.includes(ip)) result.srflx.push(ip);
      } else if (typ === 'host') {
        if (!result.host.includes(ip)) result.host.push(ip);
      }
    };

    pc.createOffer({ offerToReceiveAudio: 1 })
      .then(o => pc.setLocalDescription(o))
      .catch(() => {});

    setTimeout(() => {
      try { pc.close(); } catch (_) {}
      resolve(result);
    }, COLLECT_MS);
  });
}

// Returns true if the candidate IP represents a real network address (not mDNS).
function isRealLocal(ip) {
  if (!ip) return false;
  if (ip.endsWith('.local')) return false;     // mDNS anonymized — fine
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.match(/^172\.(1[6-9]|2\d|3[01])\./)) return true;
  if (ip.includes(':')) return true;            // IPv6
  return true;
}

// ── IPv6 probe ──────────────────────────────────────────────────────────────
async function probeIpv6() {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), IPV6_TIMEOUT_MS);
  try {
    // ipv6.icanhazip.com only resolves to AAAA, so this fails on v4-only paths.
    const r = await fetch('https://ipv6.icanhazip.com/', {
      cache: 'no-store',
      signal: ctrl.signal
    });
    if (!r.ok) return { detected: false, address: '' };
    const text = (await r.text()).trim();
    if (text.includes(':')) return { detected: true, address: text };
    return { detected: false, address: '' };
  } catch (_) {
    return { detected: false, address: '' };
  } finally {
    clearTimeout(tid);
  }
}
