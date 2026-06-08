// Cloud function: cleanupReports
//
// Triggered daily by CloudBase timer. Deletes reports whose expiresAt < now.

const tcb = require('@cloudbase/node-sdk');

const COLLECTION = 'reports';

let app;
function getApp() {
  if (!app) app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
  return app;
}

exports.main = async () => {
  const db = getApp().database();
  const _ = db.command;
  try {
    const res = await db.collection(COLLECTION)
      .where({ expiresAt: _.lt(new Date()) })
      .remove();
    return { code: 0, deleted: (res && res.deleted) || 0 };
  } catch (e) {
    console.error('[cleanupReports]', e);
    return { code: 500, message: e && e.message };
  }
};
