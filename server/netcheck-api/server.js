'use strict';
// 小白兔TKNC 自托管后端 —— 替代原 CloudBase 云函数。
//
// 部署在站点同一台服务器，nginx 反代 /api/ → 127.0.0.1:PORT，浏览器同源调用，
// 不再有跨域(CORS)问题、不依赖 CloudBase、无 quota。
//
// 路由（POST，body 为 JSON）：
//   /ipinfo      { ip? }               → { code:0, data:{...IP画像} }
//   /saveReport  { report }            → { code:0, shareId, expiresAt }
//   /getReport   { shareId }           → { code:0, report, ... } | { code:404/410 }
//
// 数据源：ip-api.com（免 key，给出 国家/城市/ASN/机房/代理/移动/住宅）为主；
//         ipinfo.io（设了 IPINFO_TOKEN 才启用）增强；scamalytics（设了账号才启用）给风险分。
// 零第三方依赖，仅用 Node 20 内置 http/fs/crypto + 全局 fetch。

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8096', 10);
const IPINFO_TOKEN = process.env.IPINFO_TOKEN || '';
const SCAM_USER = process.env.SCAMALYTICS_USER || '';
const SCAM_KEY = process.env.SCAMALYTICS_KEY || '';
const STORE_DIR = process.env.STORE_DIR || '/var/lib/netcheck/reports';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

fs.mkdirSync(STORE_DIR, { recursive: true });

// ── 进程内缓存 + 限流 ─────────────────────────────────────────────
const CACHE = new Map(); const CACHE_TTL = 10 * 60 * 1000, CACHE_MAX = 500;
const cacheGet = (k) => { const v = CACHE.get(k); if (!v) return null; if (Date.now() - v.at > CACHE_TTL) { CACHE.delete(k); return null; } return v.data; };
const cacheSet = (k, d) => { if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value); CACHE.set(k, { at: Date.now(), data: d }); };
const RL = new Map();
function rateLimit(ip) { if (!ip) return true; const now = Date.now(), win = 60000, max = 30; const a = (RL.get(ip) || []).filter(t => now - t < win); if (a.length >= max) return false; a.push(now); RL.set(ip, a); return true; }

// ── 带超时的 fetch ────────────────────────────────────────────────
async function jget(url, timeout = 5000, headers) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), timeout);
  try { return await fetch(url, { signal: c.signal, headers }); } finally { clearTimeout(t); }
}
async function callIpApi(ip) {
  // bitmask 66842623: country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting,query
  try { const r = await jget(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=66842623`); return await r.json(); }
  catch (e) { console.warn('[ip-api] fail', e && e.message); return null; }
}
async function callIpinfo(ip) {
  if (!IPINFO_TOKEN) return null;
  try { const r = await jget(`https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${IPINFO_TOKEN}`); return await r.json(); }
  catch (e) { console.warn('[ipinfo.io] fail', e && e.message); return null; }
}
async function callScam(ip) {
  try {
    if (SCAM_USER && SCAM_KEY) { const r = await jget(`https://api.scamalytics.com/${SCAM_USER}/?key=${SCAM_KEY}&ip=${encodeURIComponent(ip)}`); return await r.json(); }
    return null;
  } catch (e) { console.warn('[scamalytics] fail', e && e.message); return null; }
}

function pick(o, keys) { const out = {}; if (!o) return out; for (const k of keys) if (o[k] !== undefined) out[k] = o[k]; return out; }
function mergeSources(targetIp, ii, ia, sc) {
  ii = ii || {}; ia = ia || {}; sc = sc || {};
  const country = (ii.country || ia.countryCode || '').toUpperCase();
  const countryName = ia.country || (ii.country || '');
  const city = ii.city || ia.city || '';
  const region = ii.region || ia.regionName || '';
  const asn = ii.org || ia.as || '';
  const org = ia.isp || ia.org || ii.org || '';
  const isHosting = ia.hosting === true;
  const isProxy = ia.proxy === true;
  const isMobile = ia.mobile === true;
  const isResidential = !isHosting && !isProxy && !isMobile;
  let riskScore = null;
  if (typeof sc.score === 'number') riskScore = sc.score;
  else if (sc.scamalytics && typeof sc.scamalytics.scamalytics_score === 'number') riskScore = sc.scamalytics.scamalytics_score;
  return {
    ip: targetIp, country, countryName, city, region, asn, org,
    isHosting, isProxy, isMobile, isResidential, riskScore,
    raw: { ipapi: pick(ia, ['isp', 'org', 'as', 'asname', 'mobile', 'proxy', 'hosting']) }
  };
}

// 真实客户端 IP：浏览器传的优先（它探测到的代理出口 IP）；否则从 CF/nginx 头取。
function clientIp(req) {
  const h = req.headers;
  return (h['cf-connecting-ip'] || h['x-real-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || '').trim();
}

async function handleIpinfo(body, req) {
  const targetIp = (body && body.ip) || clientIp(req);
  if (!targetIp) return { code: 400, message: '无法获取 IP' };
  if (!rateLimit(targetIp)) return { code: 429, message: '请求过于频繁，请稍后再试' };
  const cached = cacheGet(targetIp);
  if (cached) return { code: 0, data: { ...cached, cached: true } };
  const [ii, ia, sc] = await Promise.all([callIpinfo(targetIp), callIpApi(targetIp), callScam(targetIp)]);
  const data = mergeSources(targetIp, ii, ia, sc);
  cacheSet(targetIp, data);
  return { code: 0, data };
}

// ── 分享报告存储（本地文件，7 天过期）─────────────────────────────
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
function makeShareId(len = 8) { let s = ''; const b = crypto.randomBytes(len); for (let i = 0; i < len; i++) s += ALPHABET[b[i] % ALPHABET.length]; return s; }
function stripReport(report) {
  if (report && report.results) {
    if (report.results.ip) { delete report.results.ip.ip; delete report.results.ip.raw; }
    if (report.results.webrtc) for (const k of ['srflxIps', 'hostCandidates', 'realLocalIps', 'referenceIp', 'ipv6Address']) delete report.results.webrtc[k];
  }
  return report;
}
function handleSave(body) {
  if (!body || !body.report) return { code: 400, message: '缺少 report 字段' };
  const report = stripReport(body.report);
  let id, file, tries = 0;
  do { id = makeShareId(8); file = path.join(STORE_DIR, id + '.json'); tries++; } while (fs.existsSync(file) && tries < 6);
  const now = Date.now(), expiresAt = now + TTL_MS;
  try { fs.writeFileSync(file, JSON.stringify({ shareId: id, report, createdAt: now, expiresAt })); }
  catch (e) { return { code: 500, message: '存储失败' }; }
  return { code: 0, shareId: id, expiresAt };
}
function handleGet(body) {
  const id = body && body.shareId;
  if (!id || typeof id !== 'string' || !/^[0-9A-Z]{1,16}$/.test(id)) return { code: 400, message: '缺少 shareId' };
  const file = path.join(STORE_DIR, id + '.json');
  if (!fs.existsSync(file)) return { code: 404, message: '未找到该报告' };
  let doc; try { doc = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { return { code: 500, message: '读取失败' }; }
  if (doc.expiresAt && Date.now() > doc.expiresAt) { try { fs.unlinkSync(file); } catch (_) {} return { code: 410, message: '报告已过期' }; }
  return { code: 0, shareId: doc.shareId, report: doc.report, createdAt: doc.createdAt, expiresAt: doc.expiresAt };
}

// 每 6 小时清理过期报告
setInterval(() => {
  try { for (const f of fs.readdirSync(STORE_DIR)) { if (!f.endsWith('.json')) continue; const p = path.join(STORE_DIR, f); try { const d = JSON.parse(fs.readFileSync(p, 'utf-8')); if (d.expiresAt && Date.now() > d.expiresAt) fs.unlinkSync(p); } catch (_) {} } } catch (_) {}
}, 6 * 60 * 60 * 1000);

// ── HTTP 服务 ─────────────────────────────────────────────────────
function readBody(req) { return new Promise((res) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => res(b)); req.on('error', () => res('')); }); }

const server = http.createServer(async (req, res) => {
  const send = (obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
  const url = req.url.replace(/\?.*$/, '').replace(/\/+$/, '') || '/';
  if (req.method === 'GET' && (url === '/health' || url === '/')) return send({ ok: true, service: 'netcheck-api' });
  if (req.method !== 'POST') return send({ code: 405, message: 'method not allowed' }, 405);
  const raw = await readBody(req);
  let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
  try {
    if (url === '/ipinfo') return send(await handleIpinfo(body, req));
    if (url === '/saveReport') return send(handleSave(body));
    if (url === '/getReport') return send(handleGet(body));
    return send({ code: 404, message: 'no such route' }, 404);
  } catch (e) { return send({ code: 500, message: String((e && e.message) || e) }, 500); }
});
server.listen(PORT, '127.0.0.1', () => console.log(`netcheck-api listening on 127.0.0.1:${PORT}`));
