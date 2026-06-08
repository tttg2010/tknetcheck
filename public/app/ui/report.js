// Report phase: renders the full report from state.

import { tierOf } from '../scoring.js';
import { t } from '../util/i18n.js';

const RING_CIRC = 502.65;  // 2 * Math.PI * 80

export function mountReport({ onShare, onRerun }) {
  document.getElementById('btn-share').addEventListener('click', onShare);
  document.getElementById('btn-rerun').addEventListener('click', onRerun);

  // Copy the full share copy (hook + score + link) — for pasting into 朋友圈.
  wireCopyButton('btn-copy-copy', t.share.copyCopy, () => {
    const el = document.getElementById('share-copy-text');
    return el ? el.dataset.copy || el.textContent : '';
  });

  // Copy just the link.
  wireCopyButton('btn-copy-link', t.share.copyLink, () => {
    const el = document.getElementById('share-copy-text');
    return el ? el.dataset.url || '' : '';
  });
}

// Generic copy-to-clipboard button wiring with success feedback.
function wireCopyButton(id, label, getText) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const text = getText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // Fallback for older / non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (__) {}
      document.body.removeChild(ta);
    }
    const original = btn.textContent;
    btn.textContent = t.share.copied;
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = label; btn.classList.remove('copied'); }, 2000);
  });
}

// Render the entire report panel.
// Used both by the live phase 3 view and by share.html.
export function renderReport(rootEl, payload) {
  const { scores, results, recommendations, meta } = payload;

  // Overall score ring + tier
  const overallEl = rootEl.querySelector('#overall-score');
  const overallRing = rootEl.querySelector('#overall-ring');
  const overallTier = rootEl.querySelector('#overall-tier-label');
  const overallMeta = rootEl.querySelector('#report-meta');

  if (overallEl) overallEl.textContent = String(scores.overall);
  if (overallRing) {
    const tier = tierOf(scores.overall);
    overallRing.classList.remove('tier-excellent','tier-good','tier-warning','tier-danger','indeterminate');
    overallRing.classList.add(`tier-${tier}`);
    const fg = overallRing.querySelector('.fg-ring');
    if (fg) {
      const offset = RING_CIRC * (1 - scores.overall / 100);
      fg.setAttribute('stroke-dasharray', String(RING_CIRC));
      fg.setAttribute('stroke-dashoffset', String(offset));
    }
  }
  if (overallTier) {
    const tier = tierOf(scores.overall);
    overallTier.className = 'tier-label tier-' + tier;
    overallTier.textContent = t.tier[tier];
  }
  // Quotable verdict line — the screenshot-worthy one-liner.
  const verdictEl = rootEl.querySelector('#verdict-line');
  if (verdictEl) {
    const tier = tierOf(scores.overall);
    verdictEl.className = 'verdict-line tier-' + tier;
    verdictEl.textContent = t.verdict[tier];
  }
  if (overallMeta && meta) overallMeta.textContent = meta;

  // Sections
  const sectionsEl = rootEl.querySelector('#report-sections');
  if (sectionsEl) {
    sectionsEl.innerHTML = '';
    sectionsEl.appendChild(buildSection('ip',           '🌐', 'IP 身份',           scores.ip,           results.ip,           recommendations));
    sectionsEl.appendChild(buildSection('dns',          '🧭', 'DNS（降级版）',     scores.dns,          results.dns,          recommendations));
    sectionsEl.appendChild(buildSection('webrtc',       '🛰️', 'WebRTC / IPv6 泄漏', scores.webrtc,       results.webrtc,       recommendations));
    sectionsEl.appendChild(buildSection('stability',    '📈', '网络稳定性',         scores.stability,    results.stability,    recommendations));
    sectionsEl.appendChild(buildSection('device',       '📱', '设备一致性',         scores.device,       results.device,       recommendations));
    sectionsEl.appendChild(buildSection('reachability', '🎯', 'TikTok 可达性',      scores.reachability, results.reachability, recommendations));
  }
}

function buildSection(key, icon, title, score, result, allRecs) {
  const el = document.createElement('section');
  el.className = 'section';
  el.setAttribute('data-module', key);

  const tier = tierOf(score);

  const head = document.createElement('div');
  head.className = 'section-head';
  head.innerHTML = `
    <div class="section-title">
      <div class="section-icon">${icon}</div>
      <div>${title}</div>
    </div>
    <div class="sub-score tier-${tier}">${score}</div>
  `;
  el.appendChild(head);

  // Body: findings + KV
  const body = document.createElement('div');
  body.appendChild(buildFindings(key, result));
  body.appendChild(buildKV(key, result));
  el.appendChild(body);

  // Per-module recommendations (filter from full list — match by heuristics on text)
  const recsForModule = filterRecsForModule(key, allRecs);
  if (recsForModule.length) {
    const recs = document.createElement('div');
    recs.className = 'recs';
    recs.innerHTML = '<h5>建议</h5><ol>' +
      recsForModule.map(r => `<li><strong>${escapeHtml(r.title)}</strong> — ${escapeHtml(r.body)}</li>`).join('') +
      '</ol>';
    el.appendChild(recs);
  }

  return el;
}

function buildFindings(key, r) {
  const ul = document.createElement('ul');
  ul.className = 'findings';

  const add = (severity, text) => {
    const li = document.createElement('li');
    const mark = severity === 'ok' ? '✓' : severity === 'warn' ? '!' : severity === 'danger' ? '✕' : 'ℹ';
    li.innerHTML = `<span class="marker ${severity}">${mark}</span><span>${escapeHtml(text)}</span>`;
    ul.appendChild(li);
  };

  if (!r) { add('warn', '检测未完成'); return ul; }
  if (!r.ok) { add('danger', `检测失败：${r.error || '未知错误'}`); return ul; }

  switch (key) {
    case 'ip':
      add('info', `${r.countryName || r.country || '未知国家'} · ${r.city || '?'}`);
      add('info', `${r.org || r.asn || '未知运营商'}`);
      add(r.isHosting ? 'danger' : 'ok', r.isHosting ? '机房 / IDC IP' : '非机房 IP');
      add(r.isProxy ? 'warn' : 'ok', r.isProxy ? '在风险库中被标记为代理' : '未被标记为代理');
      if (typeof r.riskScore === 'number') {
        add(r.riskScore >= 75 ? 'danger' : r.riskScore >= 25 ? 'warn' : 'ok',
            `风险评分 ${r.riskScore}/100`);
      }
      break;
    case 'dns':
      // DoH reachability
      if (r.bothDohReachable) add('ok', 'DoH 双源可达（Google + Cloudflare）');
      else if (r.googleReachable || r.cloudflareReachable) {
        add('warn', `仅 ${r.googleReachable ? 'Google' : 'Cloudflare'} DoH 可达，另一家被屏蔽`);
      } else {
        add('danger', 'Google / Cloudflare DoH 均不可达，可能被网络层过滤');
      }
      // Non-CDN baseline consistency (the actual reliable signal)
      if (r.baselineConsistent === true) {
        add('ok', `${r.baselineTarget} 双源解析一致（非 CDN 基准）`);
      } else if (r.baselineConsistent === false) {
        add('danger', `${r.baselineTarget} 双源解析不一致 — 疑似 DNS 劫持`);
      }
      // Timezone vs IP country
      if (r.tzCountryMatch === true) add('ok', '时区与 IP 国家一致');
      else if (r.tzCountryMatch === false) add('danger', '时区与 IP 国家不一致');
      else if (!r.ipCountryKnown) add('info', '时区交叉校验：未执行（IP 国家未知）');
      // Informational: TikTok CDN nodes
      if (r.tiktokGoogleIps.length || r.tiktokCloudflareIps.length) {
        const all = [...r.tiktokGoogleIps, ...r.tiktokCloudflareIps];
        add('info', `${r.target} 解析到 ${all.length} 个 CDN 节点（CDN 多节点为正常）`);
      }
      add('info', '完整 DNS 泄漏检测需付费版');
      break;
    case 'webrtc':
      if (!r.referenced) {
        add('info', `WebRTC 探测完成（采集到 ${r.srflxIps ? r.srflxIps.length : 0} 个公网候选）`);
        add('info', '泄漏判定：未执行（缺少 IP 基准，需先完成模块 1）');
      } else {
        add(r.hasWebRtcLeak ? 'danger' : 'ok',
            r.hasWebRtcLeak ? 'WebRTC 公网 IP 泄漏' : '无 WebRTC 公网 IP 泄漏');
      }
      add(r.ipv6Detected ? 'warn' : 'ok', r.ipv6Detected ? '检测到 IPv6 直连' : '未检测到 IPv6');
      if (r.realLocalIps && r.realLocalIps.length) add('info', `暴露内网 IP：${r.realLocalIps.length} 个`);
      else add('ok', '内网 IP 已被浏览器匿名化');
      break;
    case 'stability': {
      const o = r.overall || {};
      add(o.latency <= 300 ? 'ok' : o.latency <= 500 ? 'warn' : 'danger', `平均延迟 ${o.latency}ms`);
      add(o.jitter  <= 50 ? 'ok' : o.jitter  <= 100 ? 'warn' : 'danger', `抖动 ${o.jitter}ms`);
      add(o.loss    <= 1  ? 'ok' : o.loss    <= 3   ? 'warn' : 'danger', `丢包率 ${o.loss}%`);
      if (o.tls === null) add('info', 'TLS 握手时间：未测量（浏览器未暴露 Timing-Allow-Origin）');
      else add(o.tls <= 400 ? 'ok' : o.tls <= 700 ? 'warn' : 'danger', `TLS 握手 ${o.tls}ms`);
      if (r.coarse) add('info', '浏览器粗略模式（Performance API 未暴露 Timing-Allow-Origin）');
      break;
    }
    case 'device': {
      const hasIp = !!r.ipCountry;
      // Timezone
      if (r.tzCountryMatch === true) add('ok', `时区与 IP 国家一致：${r.timezone || '?'}`);
      else if (r.tzCountryMatch === false) add('danger', `时区与 IP 国家不一致：${r.timezone || '?'} vs ${r.ipCountry}`);
      else if (!hasIp) add('info', `时区：${r.timezone || '?'}（未与 IP 国家交叉校验：IP 信息缺失）`);
      else add('info', `时区：${r.timezone || '?'}（未知时区对应国家）`);
      // Language
      if (r.langCountryMatch === true) add('ok', `语言与 IP 国家一致：${r.language || '?'}`);
      else if (r.langCountryMatch === false) add('warn', `语言与 IP 国家不一致：${r.language || '?'} vs ${r.ipCountry}`);
      else if (!hasIp) add('info', `语言：${r.language || '?'}（未与 IP 国家交叉校验）`);
      else add('info', `语言：${r.language || '?'}`);
      // UA vs screen
      if (r.uaScreenMatch === false) add('warn', `屏幕：${r.screen ? `${r.screen.w}×${r.screen.h}` : '?'}（与 UA 不匹配）`);
      else add('ok', `屏幕：${r.screen ? `${r.screen.w}×${r.screen.h}` : '?'}`);
      if (r.webglRenderer) add('info', `GPU：${r.webglRenderer.slice(0, 80)}`);
      break;
    }
    case 'reachability':
      for (const p of (r.probes || [])) {
        add(p.ok ? 'ok' : 'danger',
            `${p.host}：${p.ok ? `成功（${p.attempts > 1 ? p.attempts + ' 次' : '一次过'}）` : `失败（${p.attempts} 次后放弃）`}`);
      }
      break;
  }
  return ul;
}

function buildKV(key, r) {
  // Optional details — only show for stability (per-target table) for now
  if (key !== 'stability' || !r || !r.ok) return document.createDocumentFragment();
  const table = document.createElement('table');
  table.className = 'target-table';
  table.innerHTML = `
    <thead><tr><th>主机</th><th>延迟</th><th>抖动</th><th>TLS</th><th>丢包</th><th>协议</th></tr></thead>
    <tbody>${
      (r.perTarget || []).map(p => `
        <tr>
          <td class="host">${escapeHtml(p.host)}</td>
          <td>${p.latency}ms</td>
          <td>${p.jitter}ms</td>
          <td>${p.tls === null ? '−' : p.tls + 'ms'}</td>
          <td>${p.loss}%</td>
          <td>${p.protocols.join(',') || '−'}</td>
        </tr>`).join('')
    }</tbody>`;
  return table;
}

// Heuristic mapping of free-text recommendation titles back to modules.
function filterRecsForModule(key, recs) {
  if (!recs) return [];
  const keywords = {
    ip: ['IP 信息', 'IDC', '机房', 'IP 被标记', '风险评分'],
    dns: ['DNS', 'DoH', '双源解析', '时区与 IP 国家不匹配'],
    webrtc: ['WebRTC', 'IPv6', '局域网', '内网'],
    stability: ['延迟', '抖动', '丢包', 'TLS', '粗略测量', 'Safari'],
    device: ['系统时区', '系统语言', 'UA', '交叉校验'],
    reachability: ['TikTok 全部域名', '需要重试']
  };
  const list = keywords[key] || [];
  return recs.filter(r => list.some(k => r.title.includes(k)));
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
