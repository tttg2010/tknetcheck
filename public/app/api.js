// 后端调用 —— 同源自托管后端（nginx 反代 /api/ → 本机 netcheck-api 服务）。
//
// 原先绕道 CloudBase 云函数会跨域(CORS)且依赖外部服务；现在站点和后端在同一台
// 服务器，直接同源调用 /api/ipinfo、/api/saveReport、/api/getReport，
// 无跨域、无 quota、无第三方依赖。后端实现见 server/netcheck-api/server.js。
//
// 可用 window.__API_BASE__ 覆盖（例如本地调试指向别的地址）。默认同源 /api。
const HTTP_BASE = window.__API_BASE__ || '/api';

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
    // 把实际请求地址写进报错，方便一眼判断是新码(/api)还是旧缓存(tcloudbase)。
    throw new Error(`无法连接后端 ${HTTP_BASE}/${name}（${(e && e.message) || e}）`);
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
  getReport: (shareId) => callFn('getReport', { shareId }),
  // 社会证明气泡：匿名记一条结果 / 拉近期结果
  recordResult: (r) => callFn('recordResult', r),
  recentResults: (n) => callFn('recentResults', { n }),
  // 管理：凭口令拉访问日志
  adminLogs: (password, n) => callFn('adminLogs', { password, n })
};
