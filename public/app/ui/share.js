// share.html bootstrap — loads a report by shareId from URL.

import { api } from '../api.js';
import { renderReport } from './report.js';

(async function init() {
  const root = document.getElementById('share-root');
  const params = new URLSearchParams(location.search);
  const id = params.get('id');

  if (!id) {
    root.innerHTML = errorCard('缺少分享 ID');
    return;
  }

  try {
    const res = await api.getReport(id);
    if (!res || !res.report) {
      root.innerHTML = errorCard('未找到该报告，可能已过期。');
      return;
    }
    root.innerHTML = scaffold();
    renderReport(root, res.report);
  } catch (e) {
    root.innerHTML = errorCard(`加载失败：${(e && e.message) || e}`);
  }
})();

function errorCard(msg) {
  return `<div class="card center"><div class="alert alert-warn"><span class="alert-icon">⚠️</span><div>${escapeHtml(msg)}</div></div></div>`;
}

function scaffold() {
  return `
    <div class="score-circle-wrap">
      <div class="score-circle" id="overall-ring">
        <svg width="180" height="180" viewBox="0 0 180 180">
          <circle class="bg-ring" cx="90" cy="90" r="80" stroke-width="10" fill="none"/>
          <circle class="fg-ring" cx="90" cy="90" r="80" stroke-width="10" fill="none"
                  stroke-dasharray="502.65" stroke-dashoffset="502.65"/>
        </svg>
        <div class="score-value">
          <div class="num" id="overall-score">--</div>
          <div class="grade">总分</div>
        </div>
      </div>
      <div class="tier-label" id="overall-tier-label">--</div>
      <div class="report-meta" id="report-meta"></div>
    </div>
    <div id="report-sections"></div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
