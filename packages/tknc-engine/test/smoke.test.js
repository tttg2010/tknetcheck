// 冒烟 + 等价性测试。零依赖，直接 `node test/smoke.test.js` 运行。
// 目的：
//   1. 证明引擎是纯函数、Node 里能跑（零浏览器依赖）。
//   2. 用手算的期望值锁死"抽取后行为与原前端 scoring.js 等价"。
//   3. 覆盖 null / 失败模块 / 未引用等克制处理分支。
//   4. 证明 config 覆盖能改变结果（校准接口有效）。

import assert from 'node:assert';
import { evaluate, resolveConfig, scoreIp, scoreStability, DEFAULT_CONFIG } from '../src/index.js';

let pass = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  pass++;
  console.log('  ✓ ' + name);
}

// ── 1. IP 打分等价性 ─────────────────────────────────────────────
const cfg = resolveConfig();

// 干净住宅 IP（美国、非机房、无风险）→ 100
ok('cleanResidentialIp=100',
  scoreIp({ ok: true, country: 'US', isHosting: false, isProxy: false, riskScore: 0 }, cfg) === 100);

// 机房 IP（AWS）→ 100-40=60
ok('hostingIp=60',
  scoreIp({ ok: true, country: 'US', org: 'Amazon AWS', isHosting: true, riskScore: 0 }, cfg) === 60);

// 机房 + 代理 + 高风险 + 非白名单：100-40-20-30-10=0（clamp 到 0）
ok('worstIp=0',
  scoreIp({ ok: true, country: 'RU', org: 'Vultr', isHosting: true, isProxy: true, riskScore: 90 }, cfg) === 0);

// org 命中 IDC 正则但 isHosting=false，仍应扣 40（100-40=60）
ok('idcByOrgRegex=60',
  scoreIp({ ok: true, country: 'US', org: 'Leaseweb Hosting', isHosting: false, riskScore: 0 }, cfg) === 60);

// riskScore=null（未知）→ 不扣风险分
ok('riskNull_noPenalty=100',
  scoreIp({ ok: true, country: 'US', isHosting: false, riskScore: null }, cfg) === 100);

// 失败模块 → 0
ok('ipFail=0', scoreIp({ ok: false }, cfg) === 0);

// ── 2. 稳定性 null≠0 处理 ────────────────────────────────────────
// latency 极佳、jitter/tls/loss 全 null → 只用 latency 维度，应=100
ok('stabilityOnlyLatency=100',
  scoreStability({ ok: true, overall: { latency: 100, jitter: null, tls: null, loss: null } }, cfg) === 100);

// 全 null（无任何可测维度）→ 0
ok('stabilityAllNull=0',
  scoreStability({ ok: true, overall: { latency: 0, jitter: null, tls: null, loss: null } }, cfg) === 0);

// ── 3. evaluate 门面 + tier + overall 等价性 ─────────────────────
const results = {
  ip: { ok: true, country: 'US', isHosting: false, isProxy: false, riskScore: 0 },      // 100
  dns: { ok: true, bothDohReachable: true, baselineConsistent: true, tzCountryMatch: true }, // 70+10+20=100→cap90
  webrtc: { ok: true, referenced: true, hasWebRtcLeak: false, hasIpv6Leak: false, realLocalIps: [] }, // 100
  stability: { ok: true, coarse: false, overall: { latency: 150, jitter: 30, tls: 200, loss: 0 } },  // 100
  device: { ok: true, ipCountry: 'US', tzCountryMatch: true, langCountryMatch: true, uaScreenMatch: true }, // 100
  reachability: { ok: true, allOk: true, successes: 3, totalRetries: 0 }                 // 100
};
const rep = evaluate(results);
// overall = (100*25 + 90*15 + 100*15 + 100*25 + 100*10 + 100*10)/100 = 98.5 → round 99... 手算：
// 100*25=2500, 90*15=1350, 100*15=1500, 100*25=2500, 100*10=1000, 100*10=1000 → 9850/100=98.5→99? Math.round(98.5)=99? 实际 98.5→99
ok('evaluate.overall=99', rep.overall === 99);
ok('evaluate.tier=excellent', rep.tier === 'excellent');
ok('evaluate.dns cap 90', rep.scores.dns === 90);
ok('evaluate has recommendations', Array.isArray(rep.recommendations));
ok('evaluate.configVersion set', rep.configVersion === DEFAULT_CONFIG.version);

// ── 4. config 覆盖有效（校准接口）──────────────────────────────
// 把机房扣分从 40 改成 10，机房 IP 分应变成 90
const custom = { ip: { hostingPenalty: 10 } };
ok('configOverride.hostingPenalty',
  scoreIp({ ok: true, country: 'US', org: 'Amazon', isHosting: true, riskScore: 0 }, resolveConfig(custom)) === 90);

// 覆盖不应污染默认配置（深合并不可变）
ok('defaultConfig untouched', DEFAULT_CONFIG.ip.hostingPenalty === 40);

// 改 tier 边界
const rep2 = evaluate(results, { config: { tiers: { excellentAt: 100 } } });
ok('configOverride.tierBoundary', rep2.tier === 'good');

console.log(`\n全部 ${pass} 条断言通过 ✓`);
