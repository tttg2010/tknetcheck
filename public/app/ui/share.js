// share.html 引导 —— 按 URL 里的 id 拉取已存报告并渲染。
//
// 复用首页同一套报告渲染（ui/report.js）与视觉（css/report.css）。
// 分享页没有检测流程，所以自己画一个静态速度表（同原型样式），从 overall 定格。

import { api } from '../api.js?v=10';
import { renderReport, TIERS, tierName, emojiFor } from './report.js?v=11';

const ARC_LEN = 461.8;

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadingCard() { return '<div class="share-loading">正在加载报告…</div>'; }
function errorCard(msg) {
  return `<div class="share-error"><div class="ic">⚠️</div><div>${esc(msg)}</div></div>`;
}

// 分享页的报告骨架：静态速度表 + renderReport 需要的容器 id。
function scaffold() {
  return `
    <div class="console" style="padding-top:24px">
      <div class="eyebrow">TIKTOK 网络环境 · <b>体检报告</b></div>
      <div class="gauge-wrap">
        <div class="gauge">
          <svg viewBox="0 0 230 230">
            <circle class="arc-bg" cx="115" cy="115" r="98" stroke-dasharray="461.8 615.7" transform="rotate(135 115 115)"/>
            <circle class="arc-fg" id="arcFg" cx="115" cy="115" r="98" stroke="url(#gg)"
                    stroke-dasharray="461.8 615.7" stroke-dashoffset="461.8" transform="rotate(135 115 115)"/>
            <defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34e3b0"/><stop offset="1" stop-color="#37b6ff"/></linearGradient></defs>
          </svg>
          <div class="gauge-face">
            <div class="gauge-emoji" id="gEmoji">🐰</div>
            <div class="gauge-num" id="gNum">--</div>
            <div class="gauge-cap">综合评分</div>
          </div>
        </div>
        <div class="tier-pill" id="tierPill" style="display:none"><span class="tdot"></span><span id="tierTxt"></span></div>
      </div>
      <div class="report on">
        <div class="verdict">
          <h3 id="verdictH">--</h3>
          <p id="verdictP">--</p>
          <div class="meta" id="verdictMeta"></div>
        </div>
        <div class="topissues" id="topIssues"></div>
        <div id="modList"></div>
      </div>
    </div>
    <div class="share-cta"><a href="./" class="btn-primary" style="text-decoration:none">我也要检测 · 30 秒出报告</a></div>
  `;
}

function paintGauge(root, overall) {
  const t = tierName(overall);
  const T = TIERS[t] || TIERS.warning;
  const arc = root.querySelector('#arcFg');
  const num = root.querySelector('#gNum');
  const emoji = root.querySelector('#gEmoji');
  const pill = root.querySelector('#tierPill');
  if (arc) {
    arc.style.strokeDashoffset = ARC_LEN * (1 - overall / 100);
    arc.style.stroke = overall >= 90 ? 'var(--good)' : overall >= 70 ? 'var(--ok)' : overall >= 50 ? 'var(--warn)' : 'var(--bad)';
  }
  if (num) num.textContent = String(overall);
  if (emoji) emoji.textContent = emojiFor(overall);
  if (pill) {
    pill.style.display = 'inline-flex';
    pill.style.color = T.color;
    pill.style.borderColor = T.color + '55';
    pill.querySelector('.tdot').style.background = T.color;
    root.querySelector('#tierTxt').textContent = T.txt;
  }
}

(async function init() {
  const root = document.getElementById('share-root');
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { root.innerHTML = errorCard('缺少分享 ID'); return; }

  root.innerHTML = loadingCard();
  try {
    const res = await api.getReport(id);
    const report = res && (res.report || (res.data && res.data.report));
    if (!report) { root.innerHTML = errorCard('未找到该报告，可能已过期（分享链接 7 天有效）。'); return; }
    root.innerHTML = scaffold();
    const overall = report.overall != null ? report.overall : (report.scores ? report.scores.overall : 0);
    paintGauge(root, overall);
    renderReport(root, report);
  } catch (e) {
    root.innerHTML = errorCard(`加载失败：${(e && e.message) || e}`);
  }
})();
