// [GENERATED] 源自 packages/tknc-engine/src/index.js —— 勿手改；改事实源后运行 bash scripts/sync-engine.sh 同步。
// 小白兔TKNC 判断引擎 —— 公共入口（ESM）。
//
// 平台无关：Node 后端（TJ-Social）与浏览器前端（小工具）共用同一套判断标准。
// 引擎不做任何探测采集，只接收各模块的 result 对象，输出 scores/overall/tier/recommendations。
//
// 用法：
//   import { evaluate } from '@tknc/engine';
//   const report = evaluate(results);                       // 用默认阈值
//   const report = evaluate(results, { config: myConfig }); // 用校准后的阈值覆盖
//
// 也可单独引用某个 scorer：
//   import { scoreIp, resolveConfig } from '@tknc/engine';
//   const s = scoreIp(results.ip, resolveConfig(myConfig));

import { DEFAULT_CONFIG } from './thresholds.js';
import {
  scoreIp, scoreDns, scoreWebRTC, scoreStability, scoreDevice, scoreReachability,
  overall, tierOf
} from './scoring.js';
import { buildRecommendations, topIssues } from './recommendations.js';

// ── 配置合并 ──────────────────────────────────────────────────────
// 深合并：用户 config 覆盖 DEFAULT_CONFIG。数组（如白名单、正则表）整体替换，
// 不做元素级合并——校准想改白名单就是整份替换，语义更清晰。
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(override)) {
    const b = base ? base[key] : undefined;
    const o = override[key];
    if (isPlainObject(b) && isPlainObject(o)) out[key] = deepMerge(b, o);
    else out[key] = o; // 标量 / 数组 / 新键 → 直接覆盖
  }
  return out;
}

// 把可选的用户 config 与默认阈值合并，得到一份完整可用的 config。
// 引擎内部所有 scorer 都要求"完整 config"，请先经过这里。
export function resolveConfig(userConfig) {
  if (!userConfig) return DEFAULT_CONFIG;
  return deepMerge(DEFAULT_CONFIG, userConfig);
}

// ── 顶层门面 ──────────────────────────────────────────────────────
// 输入：results = { ip, dns, webrtc, stability, device, reachability }
//       （每个是对应探测模块的 result 对象，可能为 null / {ok:false}）
// 输出：{ scores, overall, tier, recommendations, topIssues, configVersion }
//
// 纯函数：同样的 results + config 永远得到同样的输出，可直接用于回归测试与校准。
export function evaluate(results, opts = {}) {
  const config = resolveConfig(opts.config);
  const r = results || {};

  const scores = {
    ip: scoreIp(r.ip, config),
    dns: scoreDns(r.dns, config),
    webrtc: scoreWebRTC(r.webrtc, config),
    stability: scoreStability(r.stability, config),
    device: scoreDevice(r.device, config),
    reachability: scoreReachability(r.reachability, config)
  };

  const overallScore = overall(scores, config);
  scores.overall = overallScore;

  const tier = tierOf(overallScore, config);
  const recommendations = buildRecommendations(r, scores, config);

  return {
    scores,                       // { ip, dns, webrtc, stability, device, reachability, overall }
    overall: overallScore,        // 0-100
    tier,                         // 'excellent' | 'good' | 'warning' | 'danger'
    recommendations,              // [{ severity, title, body }]
    topIssues: topIssues(recommendations, opts.topN || 3),
    configVersion: config.version // 便于把评分结果与所用阈值版本一起落库（见校准文档）
  };
}

// ── 命名导出（供需要细粒度控制的调用方）──────────────────────────
export {
  DEFAULT_CONFIG,
  scoreIp, scoreDns, scoreWebRTC, scoreStability, scoreDevice, scoreReachability,
  overall, tierOf,
  buildRecommendations, topIssues
};

export default { evaluate, resolveConfig, DEFAULT_CONFIG };
