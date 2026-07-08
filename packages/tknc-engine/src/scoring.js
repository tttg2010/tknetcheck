// 小白兔TKNC 判断引擎 —— 核心打分器（平台无关 / 纯函数）。
//
// 每个 scorer 接收对应探测模块产出的 result 对象（结构见 docs/JUDGMENT.md），
// 加上一份已合并好的 config，返回 0-100 整数。
//
// 设计原则（与原前端 scoring.js 逐字等价，只做抽取 + 参数化）：
//   1. 零浏览器依赖：不碰 DOM / fetch / performance。输入 result，输出分数。
//   2. 阈值全部来自 config，不再硬编码。
//   3. 保留原有克制处理：null ≠ 0（不确定就不下结论），失败模块封顶而非猜测。

import { clamp, linearScore } from './math.js';

// 把 config.ip.idcAsnPatterns（字符串数组）编译成 RegExp 数组。
// 为避免每次调用重编译，用一个基于数组引用的 WeakMap 缓存。
const _idcCache = new WeakMap();
function idcRegexes(patterns) {
  if (_idcCache.has(patterns)) return _idcCache.get(patterns);
  const res = patterns.map((p) => new RegExp(p, 'i'));
  _idcCache.set(patterns, res);
  return res;
}

function isIdcAsn(name, patterns) {
  if (!name) return false;
  return idcRegexes(patterns).some((re) => re.test(name));
}

// ── IP 身份 ──────────────────────────────────────────────────────
export function scoreIp(r, config) {
  const c = config.ip;
  if (!r || !r.ok) return 0;
  let s = 100;
  if (r.isHosting || isIdcAsn(r.org, c.idcAsnPatterns) || isIdcAsn(r.asn, c.idcAsnPatterns)) {
    s -= c.hostingPenalty;
  }
  if (r.isProxy) s -= c.proxyPenalty;
  if (typeof r.riskScore === 'number') {
    if (r.riskScore >= c.riskHighAt) s -= c.riskHighPenalty;
    else if (r.riskScore >= c.riskMidAt) s -= c.riskMidPenalty;
  }
  if (r.country && !c.friendlyCountries.includes(r.country.toUpperCase())) {
    s -= c.nonWhitelistCountryPenalty;
  }
  return clamp(s, 0, 100);
}

// ── DNS（降级版）──────────────────────────────────────────────────
export function scoreDns(r, config) {
  const c = config.dns;
  if (!r || !r.ok) return 0;
  let s = c.base;

  // DoH 可达性：一家不可达（可能过滤）扣分；都不可达重扣。
  if (r.bothDohReachable) s += c.bothDohBonus;
  else if (r.googleReachable || r.cloudflareReachable) s -= c.oneDohUnreachablePenalty;
  else s -= c.noDohPenalty;

  // 非CDN基准域的双源一致性检查（CDN 域故意分流，不比对）。
  if (r.baselineConsistent === false) s -= c.baselineInconsistentPenalty;
  // === null（数据不足）→ 不扣分，诚实对待不确定性。

  // 时区 vs IP 国家（仅当 IP 国家已知时有意义）。
  if (r.tzCountryMatch === true) s += c.tzMatchBonus;
  else if (r.tzCountryMatch === false) s -= c.tzMismatchPenalty;

  return clamp(s, 0, c.cap);
}

// ── WebRTC / IPv6 泄漏 ───────────────────────────────────────────
export function scoreWebRTC(r, config) {
  const c = config.webrtc;
  if (!r || !r.ok) return 0;
  let s = 100;
  if (r.hasWebRtcLeak) s -= c.leakPenalty;
  if (r.hasIpv6Leak) s -= c.ipv6LeakPenalty;
  if (r.realLocalIps && r.realLocalIps.length) s -= c.localIpPenalty;
  // IP 模块失败时没有对比基准，封顶以示结果不完整。
  if (!r.referenced) s = Math.min(s, c.unreferencedCap);
  return clamp(s, 0, 100);
}

// ── 网络稳定性 ────────────────────────────────────────────────────
export function scoreStability(r, config) {
  const c = config.stability;
  if (!r || !r.ok) return 0;
  const o = r.overall || {};
  // 逐维度打分。某维度为 null（未测量）时从平均中剔除，而不是当作 0 或满分。
  const sub = [];
  if (typeof o.latency === 'number' && o.latency > 0) sub.push(linearScore(o.latency, c.latency.low, c.latency.high));
  if (typeof o.jitter === 'number' && o.jitter > 0) sub.push(linearScore(o.jitter, c.jitter.low, c.jitter.high));
  if (typeof o.tls === 'number' && o.tls > 0) sub.push(linearScore(o.tls, c.tls.low, c.tls.high));
  if (typeof o.loss === 'number') sub.push(linearScore(o.loss, c.loss.low, c.loss.high));
  if (sub.length === 0) return 0;
  const avg = sub.reduce((a, b) => a + b, 0) / sub.length;
  // 粗测模式（测量精度较低）额外扣分。
  return clamp(Math.round(avg) - (r.coarse ? c.coarsePenalty : 0), 0, 100);
}

// ── 设备一致性 ────────────────────────────────────────────────────
export function scoreDevice(r, config) {
  const c = config.device;
  if (!r || !r.ok) return 0;
  // 没有 IP 国家就无法跑最重要的两个交叉校验，封顶以示不完整。
  const hasIp = !!r.ipCountry;
  let s = 100;
  if (r.tzCountryMatch === false) s -= c.tzMismatchPenalty;
  if (r.langCountryMatch === false) s -= c.langMismatchPenalty;
  if (r.uaScreenMatch === false) s -= c.uaScreenMismatchPenalty;
  if (!hasIp) s = Math.min(s, c.noIpCap);
  return clamp(s, 0, 100);
}

// ── TikTok 可达性 ────────────────────────────────────────────────
export function scoreReachability(r, config) {
  const c = config.reachability;
  if (!r || !r.ok) return 0;
  if (!r.allOk && r.successes === 0) return 0;
  // 100 基础，每次重试扣 retryPenaltyPer。
  return clamp(100 - c.retryPenaltyPer * (r.totalRetries || 0), 0, 100);
}

// ── 加权总分 ──────────────────────────────────────────────────────
export function overall(scores, config) {
  const w = config.weights;
  const total =
    scores.ip * w.ip +
    scores.dns * w.dns +
    scores.webrtc * w.webrtc +
    scores.stability * w.stability +
    scores.device * w.device +
    scores.reachability * w.reachability;
  const wsum = w.ip + w.dns + w.webrtc + w.stability + w.device + w.reachability;
  // 原实现除以 100（权重之和恒为 100）。这里除以真实权重之和，
  // 使校准时若临时改动权重不至于让总分溢出/缩水；默认配置下结果与原实现完全一致。
  return Math.round(total / wsum);
}

export function tierOf(score, config) {
  const t = config.tiers;
  if (score >= t.excellentAt) return 'excellent';
  if (score >= t.goodAt) return 'good';
  if (score >= t.warningAt) return 'warning';
  return 'danger';
}
