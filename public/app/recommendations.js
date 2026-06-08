// Translates module findings into actionable Chinese advice.
// Each recommendation is { severity: 'info'|'warn'|'danger', title, body }.

export function buildRecommendations(results, scores) {
  const recs = [];

  // ── IP ────────────────────────────────────────────────────────────────────
  const ip = results.ip;
  if (ip && ip.ok) {
    if (ip.isHosting) {
      recs.push({
        severity: 'danger',
        title: '检测到 IDC / 机房 IP',
        body: '你当前使用的是数据中心 IP（如 AWS、Vultr、DigitalOcean 等）。TikTok 算法对此类 IP 非常敏感，强烈建议切换到住宅代理（Residential Proxy）。'
      });
    }
    if (ip.isProxy && !ip.isHosting) {
      recs.push({
        severity: 'warn',
        title: 'IP 被标记为代理',
        body: '当前 IP 在第三方风险库中被识别为代理。考虑更换更干净的住宅 IP，或使用独享 IP 池。'
      });
    }
    if (typeof ip.riskScore === 'number' && ip.riskScore >= 25) {
      recs.push({
        severity: ip.riskScore >= 75 ? 'danger' : 'warn',
        title: `IP 风险评分偏高（${ip.riskScore}）`,
        body: '风险评分 >25 时养号难度增大。换 IP 后重新检测。'
      });
    }
  } else if (ip && !ip.ok) {
    recs.push({
      severity: 'warn',
      title: 'IP 信息查询失败',
      body: 'IP 信息查询失败，可能是网络问题或云函数 quota 超限。请稍后重试。'
    });
  }

  // ── DNS ───────────────────────────────────────────────────────────────────
  const dns = results.dns;
  if (dns && dns.ok) {
    if (!dns.bothDohReachable && (dns.googleReachable || dns.cloudflareReachable)) {
      const unreachable = dns.googleReachable ? 'Cloudflare' : 'Google';
      recs.push({
        severity: 'warn',
        title: `${unreachable} DoH 不可达`,
        body: `${unreachable} 的 DoH 服务被屏蔽。这通常意味着网络层有过滤策略。如果是中国直连，属于预期；如果开了代理，建议检查代理是否覆盖到 DNS 流量。`
      });
    } else if (!dns.googleReachable && !dns.cloudflareReachable) {
      recs.push({
        severity: 'danger',
        title: 'DoH 全部不可达',
        body: 'Google 和 Cloudflare 的 DoH 服务都无法访问。说明你的网络对 DNS 流量有严格过滤。这种环境下 TikTok 几乎无法正常使用。'
      });
    }
    if (dns.baselineConsistent === false) {
      recs.push({
        severity: 'danger',
        title: `${dns.baselineTarget} 双源解析不一致`,
        body: `Google 与 Cloudflare 对非 CDN 基准域名 ${dns.baselineTarget} 解析出不同 IP。这是 DNS 劫持的强信号。建议在代理软件中启用"远程 DNS"，或更换 DNS 服务器为 8.8.8.8 / 1.1.1.1。`
      });
    }
    if (dns.tzCountryMatch === false) {
      recs.push({
        severity: 'danger',
        title: '时区与 IP 国家不匹配',
        body: `你的浏览器时区是 ${dns.timezone}，但 IP 在 ${dns.ipCountryName || dns.ipCountry}。TikTok 会通过这种异常组合识别"代理痕迹"。建议：把手机系统时区改为 IP 对应的时区，或更换匹配的代理位置。`
      });
    }
    // Always remind about the degraded nature
    recs.push({
      severity: 'info',
      title: '完整 DNS 检测需付费版',
      body: 'MVP 版仅做 DoH 可达性 + 非 CDN 基准对比 + 时区交叉校验。完整的 DNS 泄漏检测需要使用付费版工具（自建权威 DNS 服务器）。'
    });
  }

  // ── WebRTC ────────────────────────────────────────────────────────────────
  const webrtc = results.webrtc;
  if (webrtc && webrtc.ok) {
    if (!webrtc.referenced) {
      recs.push({
        severity: 'info',
        title: 'WebRTC 泄漏判定未执行',
        body: 'IP 模块失败导致 WebRTC 缺少对比基准。如需检测代理是否覆盖到 WebRTC 流量，请先解决 IP 模块的问题。'
      });
    }
    if (webrtc.hasWebRtcLeak) {
      recs.push({
        severity: 'danger',
        title: 'WebRTC 泄漏真实 IP',
        body: `WebRTC 探测到的公网 IP 与代理 IP 不一致。这意味着 TikTok 可以绕过代理获取你的真实 IP。解决方案：在浏览器或 App 设置中关闭 WebRTC，或使用强制 WebRTC 走代理的工具（如 Surge / Quantumult X）。`
      });
    }
    if (webrtc.hasIpv6Leak) {
      recs.push({
        severity: 'warn',
        title: '检测到 IPv6 出口',
        body: 'IPv6 流量未经代理直连。如果代理仅代理 IPv4，建议禁用系统 IPv6 或换支持 IPv6 的代理。'
      });
    }
    if (webrtc.realLocalIps && webrtc.realLocalIps.length) {
      recs.push({
        severity: 'info',
        title: '局域网 IP 可见',
        body: '浏览器没有匿名化 mDNS host 候选，暴露了内网 IP。这本身不严重，但说明浏览器隐私设置较宽松。'
      });
    }
  }

  // ── Stability ─────────────────────────────────────────────────────────────
  const st = results.stability;
  if (st && st.ok) {
    const o = st.overall;
    if (o.latency > 400) {
      recs.push({
        severity: 'warn',
        title: `延迟过高（${o.latency}ms）`,
        body: 'TikTok 域名平均 TTFB 超过 400ms。可能是代理线路绕路过多或上游负载高。建议更换上游线路，或在非晚高峰时段重试。'
      });
    }
    if (o.jitter > 80) {
      recs.push({
        severity: 'warn',
        title: `抖动偏高（${o.jitter}ms）`,
        body: '延迟波动过大会导致视频播放断断续续。建议检查软路由/分流策略，避免与下载等大流量任务共用线路。'
      });
    }
    if (o.loss > 2) {
      recs.push({
        severity: 'danger',
        title: `丢包率 ${o.loss}%`,
        body: '丢包率超过 2% 会导致视频上传失败、直播掉线。立即排查代理稳定性。'
      });
    }
    if (typeof o.tls === 'number' && o.tls > 700) {
      recs.push({
        severity: 'warn',
        title: `TLS 握手慢（${o.tls}ms）`,
        body: '握手时间过长意味着代理与 TikTok CDN 之间的连接建立有瓶颈。考虑切换到更接近 CDN 节点的代理出口。'
      });
    }
    if (st.coarse) {
      recs.push({
        severity: 'info',
        title: '浏览器粗略测量模式',
        body: '当前浏览器对跨域 opaque 响应不提供完整 Performance API 时序（Safari、Firefox 默认如此）。延迟数据采用了 duration 兜底，精度略低。在 Chrome / Edge 中复测可获得更精确数据。'
      });
    }
  }

  // ── Device consistency ────────────────────────────────────────────────────
  const dev = results.device;
  if (dev && dev.ok) {
    if (!dev.ipCountry) {
      recs.push({
        severity: 'info',
        title: '设备一致性交叉校验未执行',
        body: 'IP 模块失败，时区/语言与 IP 国家的交叉校验无法进行。请先解决 IP 模块的问题，再以本机重新检测。'
      });
    }
    if (dev.tzCountryMatch === false) {
      recs.push({
        severity: 'danger',
        title: '系统时区与 IP 国家冲突',
        body: `时区 ${dev.timezone} 与 IP 国家 ${dev.ipCountry} 不一致。建议把手机系统时区调成与代理一致。`
      });
    }
    if (dev.langCountryMatch === false) {
      recs.push({
        severity: 'warn',
        title: '系统语言与 IP 国家不符',
        body: `当前语言是 ${dev.language}，但 IP 在 ${dev.ipCountry}。把手机系统语言切到 IP 国家常用语言（如美国账号用 English）。`
      });
    }
    if (dev.uaScreenMatch === false) {
      recs.push({
        severity: 'info',
        title: 'UA 与屏幕尺寸不符',
        body: '用户代理声明的设备类型与实际屏幕尺寸不匹配。这通常出现在桌面浏览器开了手机模拟，或使用了某些指纹修改工具。'
      });
    }
  }

  // ── Reachability ──────────────────────────────────────────────────────────
  const rh = results.reachability;
  if (rh && rh.ok) {
    if (!rh.allOk && rh.successes === 0) {
      recs.push({
        severity: 'danger',
        title: 'TikTok 全部域名不可达',
        body: '主站、API、CDN 三个探针全部失败。代理可能已断开，或网络被运营商封禁。检查代理软件是否在运行。'
      });
    } else if (rh.totalRetries > 0) {
      recs.push({
        severity: 'warn',
        title: `部分域名需要重试（${rh.totalRetries} 次）`,
        body: '连接 TikTok 域名时偶发失败。说明代理稳定性不足，可能影响视频上传与发布。'
      });
    }
  }

  return recs;
}

// Pick the top N "critical issues" for the summary card at the top of the report.
export function topIssues(recs, n = 3) {
  const order = { danger: 0, warn: 1, info: 2 };
  return [...recs]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, n);
}
