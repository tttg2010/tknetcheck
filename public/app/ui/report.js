// 报告渲染器（首页报告态 + share.html 共用）。
//
// 输入 payload = { scores, results, recommendations, meta, tier?, overall? }：
//   - scores/results 形状对齐各模块 result 对象（见 docs/prototype/report-content-spec.md）
//   - recommendations 每条带 { module, severity, title, body }（引擎输出，module 由引擎给出）
//   - tier/overall 若缺省则由引擎 tierOf 兜底推导（share.html 存的 payload 里可能没带）
//
// 逻辑主体逐字移植自 docs/prototype/index.html 的 buildModules()/renderReport()，
// 改动：① recs 按 rec.module 精确归类（取代原型 groupRecs 关键词猜测）；
//       ② 所有来自真实 result 的动态值经 escapeHtml 转义（真实 UA/org/IP 可能含特殊字符）。

import { tierOf, resolveConfig } from '../engine/index.js';

const CFG = resolveConfig();

// ── 小工具 ────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const TIERS = {
  excellent: { txt: '优秀 · 可放心养号发布',     color: 'var(--good)', emoji: '😎', verdict: ['网络环境优秀，起飞没问题 🚀', '各项指标全部通过'] },
  good:      { txt: '良好 · 建议优化少数项',     color: 'var(--ok)',   emoji: '🙂', verdict: ['整体不错，优化几项就能起飞 ✨', '大部分检测通过，关注标黄项'] },
  warning:   { txt: '警告 · 存在风险，不建议发布', color: 'var(--warn)', emoji: '😟', verdict: ['存在风险，建议先处理再发视频', '多项指标需要改善'] },
  danger:    { txt: '危险 · 严重问题，立即停止',   color: 'var(--bad)',  emoji: '😰', verdict: ['严重问题，请立即排查网络环境', '多项检测未通过'] }
};
export function tierName(s) { return tierOf(s, CFG); }
function sevColor(s) { return s === 'danger' ? 'var(--bad)' : s === 'warn' ? 'var(--warn)' : s === 'ok' ? 'var(--good)' : 'var(--ok)'; }
export function scoreColor(s) { return TIERS[tierName(s)].color; }
export function emojiFor(s) { return TIERS[tierName(s)].emoji; }
function mk(sev) { const c = sevColor(sev); const ch = sev === 'danger' ? '✕' : sev === 'warn' ? '!' : sev === 'info' ? 'i' : '✓'; return `<span class="mk" style="background:${c}">${ch}</span>`; }
function dot(sev) { return `<span class="mod-stdot" style="background:${sevColor(sev)}"></span>`; }
function worst(sevs) { if (sevs.includes('danger')) return 'danger'; if (sevs.includes('warn')) return 'warn'; return 'ok'; }
function ipType(r) { return r.isHosting ? '机房 / IDC' : r.isProxy ? '代理' : r.isMobile ? '移动网络' : r.isResidential ? '住宅宽带' : '未知'; }

// ping0 风格的"IP 身份牌"：纯净度 / TikTok 适用度 / IP 类型。
// 纯净度优先用风控库欺诈分（100-fraud）；没有第三方分时按 IP 类型估算，并标注来源。
function ipPurity(r) {
  if (typeof r.riskScore === 'number') return { pct: Math.max(0, Math.min(100, 100 - r.riskScore)), src: '风控库' };
  const base = r.isHosting ? 28 : r.isProxy ? 42 : r.isMobile ? 72 : r.isResidential ? 88 : 58;
  return { pct: base, src: '估算' };
}
function purityColor(p) { return p >= 70 ? 'var(--good)' : p >= 45 ? 'var(--warn)' : 'var(--bad)'; }
function ipTypeColor(r) { return r.isHosting ? 'var(--bad)' : (r.isProxy || r.isMobile) ? 'var(--warn)' : r.isResidential ? 'var(--good)' : 'var(--ink-3)'; }
function ipStars(score) { return Math.max(0, Math.min(5, Math.round((score || 0) / 20))); }
function ipIdCardHtml(r, ipScore) {
  const pur = ipPurity(r), pcol = purityColor(pur.pct), tcol = ipTypeColor(r);
  const n = ipStars(ipScore);
  const stars = Array.from({ length: 5 }, (_, i) => `<span class="st${i < n ? ' on' : ''}">★</span>`).join('');
  return `<div class="ip-idcard">
    <div class="ipc-purity">
      <div class="ipc-top"><span class="ipc-k">IP 纯净度</span><span class="ipc-src">${pur.src}</span><span class="ipc-pct" style="color:${pcol}">${pur.pct}%</span></div>
      <div class="ipc-bar"><span style="width:${pur.pct}%;background:${pcol}"></span></div>
    </div>
    <div class="ipc-grid">
      <div class="ipc-cell"><span class="ipc-k">TikTok 适用度</span><span class="ipc-stars" style="color:${scoreColor(ipScore || 0)}">${stars}</span></div>
      <div class="ipc-cell"><span class="ipc-k">IP 类型</span><span class="ipc-pill" style="color:${tcol};border-color:${tcol}55;background:${tcol}14">${ipType(r)}</span></div>
    </div>
  </div>`;
}

// 建议按 module 精确归类（引擎已在每条 rec 上标了 module）。
function groupRecs(recs) {
  const g = {};
  for (const r of (recs || [])) {
    const k = r.module || 'ip';
    (g[k] = g[k] || []).push(r);
  }
  return g;
}

// ── 逐模块报告块（findings + KV + 表格 + 建议）──────────────────────
// 每个模块对 result 缺失/失败做兜底：result 为 null 或 ok:false 时只给一条状态 finding，
// 不访问后续字段——保证 IP 失败降级时报告不崩。
function buildModules(rep) {
  const R = rep.results || {}, S = rep.scores || {}, recsByMod = groupRecs(rep.recommendations);
  const M = [];

  const failFindings = (r) => r ? [['danger', `检测失败：${esc(r.error || '未知错误')}`]] : [['warn', '检测未完成']];

  // IP
  (() => {
    const r = R.ip;
    if (!r || !r.ok) {
      let sum = 'IP 信息不可用', findings = failFindings(r);
      if (r && (r.restricted || r.offline)) {
        sum = r.offline ? '设备未联网' : '国际网络不可达 · 高风险';
        findings = [
          ['danger', esc(r.error || '国际网络不可达')],
          ['info', '这本身就是强风险信号：TikTok 需要能访问国际网络的环境']
        ];
      }
      M.push({ key: 'ip', ic: '🌐', nm: 'IP 身份', score: S.ip || 0, sum, findings }); return;
    }
    const f = [
      ['info', `地理位置 <b>${esc(r.countryName || r.country || '未知')} · ${esc(r.city || '?')}</b>`],
      ['info', `运营商 <b>${esc(r.org || r.asn || '未知')}</b>`],
      [r.isHosting ? 'danger' : 'ok', r.isHosting ? '检测到机房 / IDC IP' : '非机房 IP，来源为真实住宅宽带'],
      [r.isProxy ? 'warn' : 'ok', r.isProxy ? '在风险库中被标记为代理' : '未被标记为代理']
    ];
    if (typeof r.riskScore === 'number') {
      f.push([r.riskScore >= 75 ? 'danger' : r.riskScore >= 25 ? 'warn' : 'ok', `风险评分 ${r.riskScore}/100（越低越好）`]);
    }
    const pur = ipPurity(r);
    M.push({
      key: 'ip', ic: '🌐', nm: 'IP 身份', score: S.ip || 0,
      sum: `${esc(r.city || '?')} · ${ipType(r)} · 纯净度 ${pur.pct}%`,
      topHtml: ipIdCardHtml(r, S.ip || 0),
      findings: f,
      kv: [['IP 类型', ipType(r)], ['公网 IP', esc(r.ip || '?')], ['国家 / 地区', `${esc(r.country || '?')} · ${esc(r.region || '?')}`], ['ASN', esc(r.asn || '?')], ['住宅 IP', r.isResidential ? '是' : '否']]
    });
  })();

  // DNS
  (() => {
    const r = R.dns;
    if (!r || !r.ok) { M.push({ key: 'dns', ic: '🧭', nm: 'DNS 检测', score: S.dns || 0, sum: 'DNS 检测不可用', findings: failFindings(r) }); return; }
    const gips = r.tiktokGoogleIps || [], cips = r.tiktokCloudflareIps || [];
    const cdnN = new Set([...gips, ...cips]).size;
    const f = [
      [r.bothDohReachable ? 'ok' : (r.googleReachable || r.cloudflareReachable) ? 'warn' : 'danger',
        r.bothDohReachable ? 'DoH 双源可达（Google + Cloudflare）' : (r.googleReachable || r.cloudflareReachable) ? `仅 ${r.googleReachable ? 'Google' : 'Cloudflare'} DoH 可达，另一家被屏蔽` : 'Google / Cloudflare DoH 均不可达，可能被网络层过滤']
    ];
    if (r.baselineConsistent != null) {
      f.push([r.baselineConsistent ? 'ok' : 'danger', r.baselineConsistent ? `${esc(r.baselineTarget)} 双源解析一致（非 CDN 基准）` : `${esc(r.baselineTarget)} 双源解析不一致 — 疑似 DNS 劫持`]);
    }
    if (r.tzCountryMatch === true) f.push(['ok', '时区与 IP 国家一致']);
    else if (r.tzCountryMatch === false) f.push(['danger', '时区与 IP 国家不一致']);
    else if (!r.ipCountryKnown) f.push(['info', '时区交叉校验：未执行（IP 国家未知）']);
    if (gips.length || cips.length) f.push(['info', `${esc(r.target)} 解析到 ${cdnN} 个 CDN 节点（多节点为正常）`]);
    f.push(['info', '完整 DNS 泄漏检测需付费版']);
    M.push({
      key: 'dns', ic: '🧭', nm: 'DNS 检测', score: S.dns || 0,
      sum: `${r.bothDohReachable ? '双源可达' : '单源'} · ${r.tzCountryMatch ? '时区匹配' : '时区异常'} · ${cdnN} CDN 节点`,
      findings: f,
      kv: [
        ['Google→tiktok', esc(gips.join(', ') || '（无）')],
        ['CF→tiktok', esc(cips.join(', ') || '（无）')],
        ['Google→基准', esc((r.baselineGoogleIps || []).join(', ') || '（无）')],
        ['CF→基准', esc((r.baselineCloudflareIps || []).join(', ') || '（无）')],
        ['浏览器时区', esc(r.timezone || '?')]
      ]
    });
  })();

  // WebRTC
  (() => {
    const r = R.webrtc;
    if (!r || !r.ok) { M.push({ key: 'webrtc', ic: '🛰️', nm: 'WebRTC / IPv6 泄漏', score: S.webrtc || 0, sum: 'WebRTC 检测不可用', findings: failFindings(r) }); return; }
    const srflx = r.srflxIps || [], local = r.realLocalIps || [], hosts = r.hostCandidates || [];
    const f = [
      [r.hasWebRtcLeak ? 'danger' : 'ok', r.referenced ? (r.hasWebRtcLeak ? 'WebRTC 泄漏真实公网 IP' : '无 WebRTC 公网 IP 泄漏，与代理 IP 一致') : `WebRTC 采集到 ${srflx.length} 个公网候选（缺少 IP 基准，未判定泄漏）`],
      [r.ipv6Detected ? 'warn' : 'ok', r.ipv6Detected ? '检测到 IPv6 直连' : '未检测到 IPv6 直连'],
      [local.length ? 'info' : 'ok', local.length ? `暴露内网 IP：${local.length} 个` : '内网 IP 已被浏览器匿名化（mDNS）']
    ];
    M.push({
      key: 'webrtc', ic: '🛰️', nm: 'WebRTC / IPv6 泄漏', score: S.webrtc || 0,
      sum: `${r.hasWebRtcLeak ? '有泄漏' : '无泄漏'} · ${r.ipv6Detected ? 'IPv6直连' : '无 IPv6'} · 内网${local.length ? '暴露' : '已匿名'}`,
      findings: f,
      kv: [
        ['srflx 候选', esc(srflx.join(', ') || '（无）')],
        ['对比基准 IP', esc(r.referenceIp || '（无）')],
        ['IPv6 地址', esc(r.ipv6Address || '（无）')],
        ['host 候选', esc(hosts.join(', ') || '（无）')]
      ]
    });
  })();

  // Stability
  (() => {
    const r = R.stability;
    if (!r || !r.ok) { M.push({ key: 'stability', ic: '📈', nm: '网络稳定性', score: S.stability || 0, sum: '稳定性采样不可用', findings: failFindings(r) }); return; }
    const o = r.overall || {};
    const f = [
      [o.latency <= 300 ? 'ok' : o.latency <= 500 ? 'warn' : 'danger', `平均延迟 ${o.latency}ms`],
      [o.jitter <= 50 ? 'ok' : o.jitter <= 100 ? 'warn' : 'danger', `抖动 ${o.jitter}ms`],
      [o.loss <= 1 ? 'ok' : o.loss <= 3 ? 'warn' : 'danger', `丢包率 ${o.loss}%`],
      [o.tls == null ? 'info' : o.tls <= 400 ? 'ok' : o.tls <= 700 ? 'warn' : 'danger', o.tls == null ? 'TLS 握手：未测量' : `TLS 握手 ${o.tls}ms`]
    ];
    if (r.coarse) f.push(['info', '浏览器粗略测量模式（精度略低）']);
    const cell = (v, g, w) => `<td class="${v <= g ? 'cell-good' : v <= w ? 'cell-warn' : 'cell-bad'}">${v}</td>`;
    const rows = (r.perTarget || []).map(p =>
      `<tr><td>${esc(p.host)}</td>${cell(p.latency, 300, 500)}${cell(p.jitter, 50, 100)}<td>${p.tls == null ? '−' : p.tls}</td>${cell(p.loss, 1, 3)}<td>${esc((p.protocols || []).join('/') || '−')}</td></tr>`
    ).join('');
    const tbl = `<div class="tbl-scroll"><table class="perf"><thead><tr><th>域名</th><th>延迟</th><th>抖动</th><th>TLS</th><th>丢包%</th><th>协议</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    M.push({
      key: 'stability', ic: '📈', nm: '网络稳定性', score: S.stability || 0,
      sum: `延迟 ${o.latency}ms · 抖动 ${o.jitter}ms · 丢包 ${o.loss}%`,
      findings: f, table: tbl
    });
  })();

  // Device
  (() => {
    const r = R.device;
    if (!r || !r.ok) { M.push({ key: 'device', ic: '📱', nm: '设备一致性', score: S.device || 0, sum: '设备检测不可用', findings: failFindings(r) }); return; }
    const sc = r.screen || {};
    const f = [];
    if (r.tzCountryMatch === true) f.push(['ok', `时区与 IP 国家一致：${esc(r.timezone || '?')}`]);
    else if (r.tzCountryMatch === false) f.push(['danger', `时区与 IP 国家不一致：${esc(r.timezone || '?')} vs ${esc(r.ipCountry)}`]);
    else f.push(['info', `时区：${esc(r.timezone || '?')}（未与 IP 国家交叉校验）`]);
    if (r.langCountryMatch === true) f.push(['ok', `语言与 IP 国家一致：${esc(r.language || '?')}`]);
    else if (r.langCountryMatch === false) f.push(['warn', `语言与 IP 国家不一致：${esc(r.language || '?')} vs ${esc(r.ipCountry)}`]);
    else f.push(['info', `语言：${esc(r.language || '?')}`]);
    if (r.uaScreenMatch === false) f.push(['warn', `UA 与屏幕不匹配：${sc.w}×${sc.h}`]);
    else f.push(['ok', `UA 与屏幕匹配：${sc.w}×${sc.h}`]);
    if (r.webglRenderer) f.push(['info', `GPU：${esc(String(r.webglRenderer).slice(0, 80))}`]);
    M.push({
      key: 'device', ic: '📱', nm: '设备一致性', score: S.device || 0,
      sum: `时区/语言/UA ${(r.tzCountryMatch && r.langCountryMatch && r.uaScreenMatch) ? '全部匹配' : '有异常'} · ${esc(r.platform || '?')}`,
      findings: f,
      kv: [
        ['User-Agent', esc(r.ua || '?')], ['平台', esc(r.platform || '?')], ['语言', esc((r.languages || []).join(', ') || '?')],
        ['CPU / 内存', `${r.cores ?? '?'} 核 / ${r.memory ?? '?'}GB`], ['网络类型', esc(r.connType || '?')],
        ['屏幕', `${sc.w}×${sc.h} @${sc.devicePixelRatio}x · ${sc.colorDepth}bit`],
        ['Canvas 指纹', esc(String(r.canvasHash || '').slice(0, 32) + (r.canvasHash ? '…' : ''))],
        ['WebGL', esc(r.webglRenderer || '?')]
      ]
    });
  })();

  // Reachability
  (() => {
    const r = R.reachability;
    if (!r || !r.ok) { M.push({ key: 'reachability', ic: '🎯', nm: 'TikTok 可达性', score: S.reachability || 0, sum: '可达性探测不可用', findings: failFindings(r) }); return; }
    const probes = r.probes || [];
    const f = probes.map(p => [p.ok ? 'ok' : 'danger', `${esc(p.host)}：${p.ok ? `成功（${p.attempts === 1 ? '一次过' : p.attempts + ' 次'}）` : `失败（${p.attempts} 次后放弃）`}`]);
    M.push({
      key: 'reachability', ic: '🎯', nm: 'TikTok 可达性', score: S.reachability || 0,
      sum: `${r.successes}/${r.totalProbes} 探针通 · 重试 ${r.totalRetries} 次`,
      findings: f,
      kv: probes.map(p => [(p.kind || '?').toUpperCase() + ' 首次耗时', `${p.firstAttemptMs}ms`]).concat([['总重试次数', String(r.totalRetries)]])
    });
  })();

  return M.map(m => ({ ...m, recs: recsByMod[m.key] || [] }));
}

// ── 顶层渲染：把 payload 画进 rootEl（需含 #verdictH #verdictP #verdictMeta #topIssues #modList）──
export function renderReport(rootEl, rep) {
  const overall = rep.overall != null ? rep.overall : (rep.scores ? rep.scores.overall : 0);
  const t = rep.tier || tierName(overall);
  const T = TIERS[t] || TIERS.warning;

  const q = (sel) => rootEl.querySelector(sel);
  // 国际网络受限/未联网时，顶部判词直接点破风险，不用泛泛的分数判词。
  const ipR = (rep.results || {}).ip;
  const restricted = ipR && (ipR.restricted || ipR.offline);
  const vH = restricted ? (ipR.offline ? '设备未联网，无法检测' : '你的网络无法访问国际服务') : T.verdict[0];
  const vP = restricted ? (ipR.offline ? '请检查网络连接后重试' : '这是高风险环境——TikTok 需要能访问国际网络。请开启代理、连上要发视频的网络后重测') : T.verdict[1];
  if (q('#verdictH')) q('#verdictH').textContent = vH;
  if (q('#verdictP')) q('#verdictP').textContent = vP;
  if (q('#verdictMeta')) q('#verdictMeta').textContent = rep.meta || '';

  // 受限（非未联网）时露出"解决方案"引导卡，顺势把高意向用户导到顶部赞助商。
  const fix = q('#fixCta');
  if (fix) {
    const showFix = restricted && !ipR.offline;
    fix.hidden = !showFix;
    if (showFix && !fix.dataset.wired) {
      fix.dataset.wired = '1';
      const btn = fix.querySelector('#fixCtaBtn');
      if (btn) btn.onclick = () => {
        const sp = document.querySelector('.sponsors');
        if (sp) {
          sp.scrollIntoView({ behavior: 'smooth', block: 'center' });
          sp.classList.remove('pulse'); void sp.offsetWidth; sp.classList.add('pulse');
        }
      };
    }
  }

  // Top issues — 引擎 topIssues 或前端按 severity 排序取前 3
  const order = { danger: 0, warn: 1, info: 2 };
  const top = (rep.topIssues && rep.topIssues.length ? rep.topIssues : [...(rep.recommendations || [])].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 3));
  const tiEl = q('#topIssues');
  if (tiEl) {
    tiEl.innerHTML = top.length ? (
      `<h4>${mk('warn')} 关键提醒 · TOP ${top.length}</h4>` +
      top.map(r => {
        const c = sevColor(r.severity === 'info' ? 'info' : r.severity);
        const lbl = r.severity === 'danger' ? '严重' : r.severity === 'warn' ? '注意' : '说明';
        return `<div class="ti-row"><span class="ti-badge" style="color:${c};background:${c}1f">${lbl}</span><span class="ti-txt"><b>${esc(r.title)}</b> · <span>${esc(r.body)}</span></span></div>`;
      }).join('')
    ) : '';
  }

  // Modules
  const modList = q('#modList');
  if (modList) {
    const mods = buildModules(rep);
    modList.innerHTML = mods.map((m, i) => {
      const st = worst(m.findings.map(f => f[0]));
      const recTag = m.recs.length ? `<span class="rec-tag">${m.recs.length} 条建议</span>` : '';
      const findings = m.findings.map(f => `<div class="finding">${mk(f[0])}<span class="ftx">${f[1]}</span></div>`).join('');
      const kv = m.kv ? `<dl class="kv">${m.kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : '';
      const tbl = m.table || '';
      const recs = m.recs.length ? `<div class="recs">${m.recs.map(r => `<div class="rec ${esc(r.severity)}"><b>${esc(r.title)}</b><span>${esc(r.body)}</span></div>`).join('')}</div>` : '';
      return `<div class="modcard ${i === 0 ? 'open' : ''}" data-mi="${i}">
        <div class="mod-head">
          <span class="mod-ic">${m.ic}</span>
          <div class="mod-main"><div class="mod-nm">${m.nm} ${recTag}</div><div class="mod-sum">${m.sum}</div></div>
          <span class="mod-score" style="color:${scoreColor(m.score)}">${m.score}</span>
          ${dot(st)}
          <span class="mod-chev">▼</span>
        </div>
        <div class="mod-body"><div class="mod-inner">
          ${m.topHtml || ''}<div class="findings">${findings}</div>${kv}${tbl}${recs}
        </div></div>
      </div>`;
    }).join('');
    modList.querySelectorAll('.mod-head').forEach(h => {
      h.onclick = () => h.parentElement.classList.toggle('open');
    });
  }

  return T; // 供调用方（首页）拿 tier 文案/颜色去点亮仪表 pill
}

export { TIERS };
