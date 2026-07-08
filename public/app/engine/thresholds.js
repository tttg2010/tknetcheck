// [GENERATED] 源自 packages/tknc-engine/src/thresholds.js —— 勿手改；改事实源后运行 bash scripts/sync-engine.sh 同步。
// 小白兔TKNC 判断引擎 —— 默认阈值配置（唯一的"魔法数字"来源）
//
// 这里收纳了引擎里所有原本硬编码在 scoring.js 的经验值：模块权重、各模块扣分值、
// 延迟/抖动/丢包/TLS 的打分区间、IP 风险分档、IDC ASN 正则表、国家白名单、
// 时区/语言映射表、tier 边界。
//
// ⚠️ 全部标注为「经验值·待校准」。任务2 的校准产物就是覆盖这份 config 的某些字段。
// 引擎的每个函数都接受可选的 config 覆盖，见 index.js 的 mergeConfig()。
//
// 版本号用于阈值配置的版本化与灰度（见 docs/CALIBRATION.md）。
export const CONFIG_VERSION = 'v0-empirical';

export const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,

  // 模块权重（必须加总为 100）。经验值·待校准。
  // 校准目标：用真实发布结果反推每个信号对"0播放/限流"的预测力，重排权重。
  weights: {
    ip: 25,
    dns: 15,
    webrtc: 15,
    stability: 25,
    device: 10,
    reachability: 10
  },

  // ── IP 身份模块 ────────────────────────────────────────────────
  ip: {
    // 机房/IDC IP 扣分（最重）。经验值·待校准。
    hostingPenalty: 40,
    // 被第三方风险库标记为代理扣分。经验值·待校准。
    proxyPenalty: 20,
    // 风险分分档与对应扣分。经验值·待校准。
    // riskScore >= riskHighAt → 扣 riskHighPenalty；>= riskMidAt → 扣 riskMidPenalty。
    riskHighAt: 75,
    riskHighPenalty: 30,
    riskMidAt: 25,
    riskMidPenalty: 15,
    // 国家不在白名单扣分。经验值·待校准。
    nonWhitelistCountryPenalty: 10,
    // TikTok 友好国家白名单。经验值·待校准（可能过宽/过窄）。
    friendlyCountries: [
      'US', 'JP', 'KR', 'GB', 'CA', 'AU', 'NZ', 'SG', 'TW', 'HK', 'MO',
      'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'SE', 'NO', 'FI', 'DK', 'IE',
      'CH', 'AT', 'TH', 'VN', 'PH', 'MY', 'ID', 'BR', 'MX'
    ],
    // IDC / hosting ASN 名称正则（匹配 org 或 asn 字段）。经验值·待校准（易误伤/漏判）。
    // 注意：存为字符串数组以便 JSON 序列化 / 版本化 / 远程下发；引擎内部编译成 RegExp。
    idcAsnPatterns: [
      'amazon', 'aws', 'google', 'microsoft|azure', 'ovh', 'digitalocean',
      'linode', 'akamai', 'vultr', 'hetzner', 'datacamp|m247', 'choopa',
      'leaseweb', 'alibaba|aliyun', 'tencent', 'huawei', 'oracle', 'server',
      'hosting', 'idc', '\\bcdn\\b'
    ]
  },

  // ── DNS 模块（降级版）────────────────────────────────────────────
  dns: {
    base: 70,          // 基础分（诚实披露：完整 DNS 泄漏检测未做）。经验值·待校准。
    cap: 90,           // 上限（同上，honest disclosure）。经验值·待校准。
    bothDohBonus: 10,        // 两家 DoH 都可达加分。经验值·待校准。
    oneDohUnreachablePenalty: 10,  // 仅一家可达扣分。经验值·待校准。
    noDohPenalty: 30,        // 两家都不可达扣分。经验值·待校准。
    baselineInconsistentPenalty: 30,  // 非CDN基准域双源解析不一致扣分（DNS劫持强信号）。经验值·待校准。
    tzMatchBonus: 20,        // 时区与IP国家匹配加分。经验值·待校准。
    tzMismatchPenalty: 30    // 时区与IP国家不匹配扣分。经验值·待校准。
  },

  // ── WebRTC 模块 ───────────────────────────────────────────────
  webrtc: {
    leakPenalty: 50,          // WebRTC 泄漏真实IP扣分。经验值·待校准。
    ipv6LeakPenalty: 30,      // IPv6 直连扣分。经验值·待校准。
    localIpPenalty: 10,       // 暴露内网IP扣分。经验值·待校准。
    unreferencedCap: 60       // 无IP基准可对比时的封顶（诚实：无法判定泄漏）。经验值·待校准。
  },

  // ── 稳定性模块 ────────────────────────────────────────────────
  // 每个维度用 linearScore(value, low, high)：<=low 得100，>=high 得0，中间线性。
  // 经验值·待校准（这是最该用真实数据校准的一组区间）。
  stability: {
    latency: { low: 150, high: 800 },  // ms（TTFB）
    jitter:  { low: 30,  high: 200 },  // ms（stddev）
    tls:     { low: 200, high: 1000 }, // ms（握手）
    loss:    { low: 0,   high: 20 },   // %（请求丢失率）
    coarsePenalty: 5   // 浏览器粗测模式（duration兜底）额外扣分。经验值·待校准。
  },

  // 稳定性"文案提示"触发阈值（离散提示，独立于上面的连续打分区间）。
  // 沿用原前端文案里的字面值。经验值·待校准。
  stabilityAdviceAt: {
    latency: 400,  // ms，超过则提示"延迟过高"
    jitter: 80,    // ms，超过则提示"抖动偏高"
    loss: 2,       // %，超过则提示"丢包率过高"
    tls: 700       // ms，超过则提示"TLS 握手慢"
  },

  // ── 设备一致性模块 ──────────────────────────────────────────────
  device: {
    tzMismatchPenalty: 30,   // 时区与IP国家冲突扣分。经验值·待校准。
    langMismatchPenalty: 20, // 语言与IP国家不符扣分。经验值·待校准。
    uaScreenMismatchPenalty: 10, // UA与屏幕尺寸不符扣分。经验值·待校准。
    noIpCap: 60              // 无IP国家、无法交叉校验时的封顶（诚实）。经验值·待校准。
  },

  // ── 可达性模块 ────────────────────────────────────────────────
  reachability: {
    retryPenaltyPer: 25      // 每次重试扣分。经验值·待校准。
  },

  // ── tier 分级边界 ─────────────────────────────────────────────
  // score >= excellentAt → excellent；>= goodAt → good；>= warningAt → warning；否则 danger。
  // 经验值·待校准（风险分档 25/75、tier 边界都没被真实数据验证过）。
  tiers: {
    excellentAt: 90,
    goodAt: 70,
    warningAt: 50
  }
};

export default DEFAULT_CONFIG;
