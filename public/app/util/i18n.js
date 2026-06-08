// Centralized zh-CN strings. Keeps copy out of logic modules.
export const t = {
  app: {
    name: '小白兔TKNC',
    tagline: '网络体检报告'
  },
  phase: {
    landing: '准备开始',
    progress: '检测中',
    report: '报告'
  },
  module: {
    ip: 'IP 身份',
    dns: 'DNS 检测',
    webrtc: 'WebRTC / IPv6 泄漏',
    stability: '网络稳定性',
    device: '设备一致性',
    reachability: 'TikTok 可达性'
  },
  tier: {
    excellent: '优秀 · 可放心养号发布',
    good: '良好 · 建议优化少数项',
    warning: '警告 · 存在风险，不建议发布新视频',
    danger: '危险 · 严重问题，立即停止使用'
  },
  // Punchy one-liner shown big under the score — designed to be quotable in screenshots.
  verdict: {
    excellent: '网络环境优秀，可以放心养号发布 🚀',
    good: '网络环境良好，优化几项就能起飞 ✨',
    warning: '网络环境存在风险，发视频前建议先优化 ⚠️',
    danger: '网络环境严重不达标，继续发可能 0 播放 🚨'
  },
  // Tier-aware share copy. {score} and {url} are replaced at runtime.
  // Designed to paste straight into 微信朋友圈 / 私聊。
  shareCopy: {
    excellent: '我的 TikTok 网络环境体检 {score} 分 🟢\n6 项全测完，环境干净。TikTok 创作者来测测自己的 👇\n{url}',
    good: '我的 TikTok 网络环境体检 {score} 分 🟡\n还差几项就满分了。你的网络扛得住吗？30 秒出报告 👇\n{url}',
    warning: '我的 TikTok 网络环境只有 {score} 分 🟠\n存在风险，怪不得数据起不来…… 你的呢？测一测 👇\n{url}',
    danger: '我的 TikTok 网络环境 {score} 分 🔴 严重不达标\n难怪 0 播放。TikTok 创作者赶紧测一下，别白忙 👇\n{url}'
  },
  state: {
    pending: '等待',
    running: '检测中',
    ok: '通过',
    warn: '注意',
    fail: '失败'
  },
  status: {
    starting: '正在准备',
    runningModule: (name) => `正在检测：${name}`,
    stabilitySampling: (sec, total) => `网络稳定性采样中 ${sec}/${total}s`,
    finalizing: '正在生成报告',
    done: '检测完成',
    cancelled: '已取消'
  },
  share: {
    cta: '生成我的分享报告',
    generating: '正在生成…',
    generated: '报告已生成 ✓',
    success: '分享链接已生成',
    failed: '生成失败，请重试',
    copied: '已复制 ✓',
    copyCopy: '复制分享文案',
    copyLink: '复制链接',
    hint: '截图本页保存，或复制文案发朋友圈',
    expiry: '分享链接 7 天内有效'
  },
  dnsDisclaimer: '完整 DNS 泄漏检测需要自建权威 DNS 服务器，当前为降级版（DoH 跨源对比 + 时区交叉校验），分数封顶 90。',
  privacyNote: '不存储原始 IP、不存储泄漏的真实地址，仅保留派生指标',
  fallback: {
    iosCoarse: 'iOS Safari 限制：部分指标采用粗略模式'
  }
};
