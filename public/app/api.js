// Cloud function calls via CloudBase HTTP Access Service.
//
// We deliberately do NOT use the CloudBase JS SDK / callFunction:
// this CloudBase edition does not let anonymous users invoke functions through
// callFunction (PERMISSION_DENIED). Instead each function is exposed as an HTTP
// route, and we call it with a plain fetch().
//
// Console setup required (one-time):
//   环境管理 → HTTP 访问服务 → 路由管理：add routes /ipinfo /saveReport /getReport
//   环境管理 → HTTP 访问服务 → 跨域设置：add the static hosting domain
//
// Note: we use Content-Type text/plain to keep the request a CORS "simple
// request" — no OPTIONS preflight, fewer ways for CORS config to break.

// HTTP Access Service base URL.
// From tcloudbaseapp.com domain, derive the ap-shanghai.app.tcloudbase.com gateway.
// Example: tk-netcheck-prod-d8es2vm0d40fecd-1259354505.tcloudbaseapp.com
//       → tk-netcheck-prod-d8es2vm0d40fecd-1259354505.ap-shanghai.app.tcloudbase.com
const HTTP_BASE = window.__CB_HTTP_BASE__
  || (() => {
    const h = location.hostname;
    if (h.includes('tcloudbaseapp.com')) {
      const base = h.replace('tcloudbaseapp.com', 'ap-shanghai.app.tcloudbase.com');
      return `https://${base}`;
    }
    if (h.includes('tcb.qcloud.la')) {
      const base = h.replace('tcb.qcloud.la', 'ap-shanghai.app.tcloudbase.com');
      return `https://${base}`;
    }
    return 'https://tk-netcheck-prod-d8es2vm0d40fecd-1259354505.ap-shanghai.app.tcloudbase.com';
  })();

// Call a cloud function via its HTTP route. Returns the parsed JSON the
// function returned (e.g. { code: 0, data: {...} }).
export async function callFn(name, data = {}) {
  let r;
  try {
    r = await fetch(`${HTTP_BASE}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(data)
    });
  } catch (e) {
    throw new Error(`网络错误：无法连接云函数 ${name}（${(e && e.message) || e}）`);
  }
  if (!r.ok) {
    throw new Error(`云函数 ${name} 返回 HTTP ${r.status}`);
  }
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    throw new Error(`云函数 ${name} 返回非 JSON：${text.slice(0, 120)}`);
  }
  return json;
}

// Convenience wrappers
export const api = {
  // The browser detects its own public IP and passes it in — the cloud function
  // cannot reliably see the caller IP.
  ipinfo: (ip) => callFn('ipinfo', ip ? { ip } : {}),
  saveReport: (report) => callFn('saveReport', { report }),
  getReport: (shareId) => callFn('getReport', { shareId })
};
