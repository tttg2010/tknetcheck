// Cloud function: getReport
//
// Reads a report by shareId. Returns 404-equivalent if not found or expired.

const tcb = require('@cloudbase/node-sdk');

const COLLECTION = 'reports';

let app;
function getApp() {
  if (!app) app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
  return app;
}

// Normalize event for HTTP Access Service (event.body = Base64 JSON string) vs callFunction.
function parseEvent(event) {
  event = event || {};
  if (typeof event.body === 'string') {
    try {
      // HTTP Access Service sends body as Base64-encoded string
      const decoded = Buffer.from(event.body, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded) || {};
      return typeof parsed === 'object' ? parsed : { shareId: parsed };
    } catch (_) {
      try {
        // Fallback: try parsing as plain JSON
        const parsed = JSON.parse(event.body) || {};
        return typeof parsed === 'object' ? parsed : { shareId: parsed };
      } catch (__) {
        return {};
      }
    }
  }
  // Direct object (callFunction or already parsed)
  return typeof event === 'object' ? event : {};
}

exports.main = async (event) => {
  const data = parseEvent(event);
  const shareId = data && data.shareId;
  if (!shareId || typeof shareId !== 'string') {
    return { code: 400, message: '缺少 shareId' };
  }

  const db = getApp().database();
  try {
    const r = await db.collection(COLLECTION).where({ shareId }).limit(1).get();
    if (!r.data || r.data.length === 0) {
      return { code: 404, message: '未找到该报告' };
    }
    const doc = r.data[0];

    // Check expiry
    const exp = doc.expiresAt instanceof Date ? doc.expiresAt.getTime() : Date.parse(doc.expiresAt);
    if (exp && Date.now() > exp) {
      return { code: 410, message: '报告已过期' };
    }

    return {
      code: 0,
      shareId: doc.shareId,
      report: doc.report,
      createdAt: doc.createdAt,
      expiresAt: doc.expiresAt
    };
  } catch (e) {
    console.error('[getReport]', e);
    return { code: 500, message: '查询失败' };
  }
};
