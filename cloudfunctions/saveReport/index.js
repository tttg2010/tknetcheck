// Cloud function: saveReport
//
// Persists a checked report to CloudBase DB collection `reports`,
// returns a short shareId (8-char base32). TTL is 7 days; expiry is enforced
// by the daily `cleanupReports` function (CloudBase DB has no native TTL).

const tcb = require('@cloudbase/node-sdk');

const COLLECTION = 'reports';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

let app;
function getApp() {
  if (!app) app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
  return app;
}

// Crockford base32 (no I, L, O, U) for human-friendly share IDs
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function randomShareId(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// Normalize event for HTTP Access Service (event.body = Base64 JSON string) vs callFunction.
function parseEvent(event) {
  event = event || {};
  if (typeof event.body === 'string') {
    try {
      // HTTP Access Service sends body as Base64-encoded string
      const decoded = Buffer.from(event.body, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded) || {};
      return typeof parsed === 'object' ? parsed : { report: parsed };
    } catch (_) {
      try {
        // Fallback: try parsing as plain JSON
        const parsed = JSON.parse(event.body) || {};
        return typeof parsed === 'object' ? parsed : { report: parsed };
      } catch (__) {
        return {};
      }
    }
  }
  // Direct object (callFunction or already parsed)
  return typeof event === 'object' ? event : {};
}

exports.main = async (event, context) => {
  const data = parseEvent(event);
  if (!data || !data.report) {
    return { code: 400, message: '缺少 report 字段' };
  }
  const report = data.report;

  // Drop any keys that look like identifying info that may have slipped through.
  if (report.results && report.results.ip) {
    delete report.results.ip.ip;
    delete report.results.ip.raw;
  }
  if (report.results && report.results.webrtc) {
    delete report.results.webrtc.srflxIps;
    delete report.results.webrtc.hostCandidates;
    delete report.results.webrtc.realLocalIps;
    delete report.results.webrtc.referenceIp;
    delete report.results.webrtc.ipv6Address;
  }

  const db = getApp().database();
  const now = Date.now();
  const expiresAt = now + TTL_MS;

  // Retry on shareId collision (rare but possible)
  let shareId = '';
  let inserted = false;
  for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
    shareId = randomShareId(8);
    try {
      await db.collection(COLLECTION).add({
        shareId,
        report,
        createdAt: new Date(now),
        expiresAt: new Date(expiresAt),
        schemaVersion: 1
      });
      inserted = true;
    } catch (e) {
      // duplicate? retry
      console.warn('[saveReport] retry', e && e.message);
    }
  }
  if (!inserted) return { code: 500, message: '存储失败' };

  return {
    code: 0,
    shareId,
    expiresAt
  };
};
