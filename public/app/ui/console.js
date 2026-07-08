// 检测控制台三态机（state A 待检测 / B 检测中 / C 报告）。
//
// 只负责单容器内的 DOM 切换 + 速度表爬升 + 扫描列表状态点亮。
// 不含任何检测/评分逻辑——那些在 app.js 编排、engine 评分。
//
// 与真实检测的对接点：
//   startScan()             进入检测中态，清空扫描列表
//   markScanRow(name,state) 某模块状态变化（running/ok/warn/fail），点亮对应行
//   creepGauge(score)       进度中让仪表向某个瞬时分数爬升（视觉反馈）
//   showReport(overall,T)   完成：仪表定格总分 + tier pill，切到报告态
//   resetConsole()          回到待检测态

import { emojiFor } from './report.js';

const ARC_LEN = 461.8;

const els = {};
function cache() {
  els.arc = document.getElementById('arcFg');
  els.gNum = document.getElementById('gNum');
  els.gEmoji = document.getElementById('gEmoji');
  els.cta = document.getElementById('ctaZone');
  els.cancel = document.getElementById('cancelZone');
  els.scanList = document.getElementById('scanList');
  els.report = document.getElementById('report');
  els.tierPill = document.getElementById('tierPill');
  els.tierTxt = document.getElementById('tierTxt');
}

function setGauge(score) {
  els.arc.style.strokeDashoffset = ARC_LEN * (1 - score / 100);
  els.arc.style.stroke = score >= 90 ? 'var(--good)' : score >= 70 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
  els.gEmoji.textContent = emojiFor(score);
}

let animRaf = 0;
function animateNum(from, to, ms) {
  cancelAnimationFrame(animRaf);
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    els.gNum.textContent = v;
    if (k < 1) animRaf = requestAnimationFrame(tick);
  };
  animRaf = requestAnimationFrame(tick);
}

let shown = 0;

export function startScan() {
  if (!els.arc) cache();
  els.cta.style.display = 'none';
  els.cancel.style.display = 'flex';
  els.report.classList.remove('on');
  els.scanList.classList.add('on');
  els.tierPill.style.display = 'none';
  shown = 0;
  els.gNum.textContent = '--';
  els.arc.style.strokeDashoffset = ARC_LEN;
  for (const r of els.scanList.querySelectorAll('.scan-row')) {
    r.className = 'scan-row';
    r.querySelector('.scan-st').textContent = '等待';
  }
}

// state: 'running' | 'ok' | 'warn' | 'fail'
export function markScanRow(name, state) {
  if (!els.scanList) return;
  const row = els.scanList.querySelector(`.scan-row[data-m="${name}"]`);
  if (!row) return;
  const st = row.querySelector('.scan-st');
  row.classList.remove('run', 'done', 'warn', 'fail');
  if (state === 'running') {
    row.classList.add('run');
    st.innerHTML = '<span class="sp-ring"></span>检测中';
  } else {
    row.classList.add('done');
    if (state === 'warn') row.classList.add('warn');
    if (state === 'fail') row.classList.add('fail');
    st.textContent = state === 'fail' ? '异常' : state === 'warn' ? '注意' : '完成';
  }
}

// 让仪表向 score 爬升（进度中的视觉反馈；不是最终定格）
export function creepGauge(score) {
  if (!els.arc) cache();
  animateNum(shown, score, 700);
  shown = score;
  setGauge(score);
}

// 完成：定格总分 + 点亮 tier pill + 切报告态。T 来自 report.js 的 TIERS[tier]。
export function showReport(overall, T) {
  animateNum(parseInt(els.gNum.textContent, 10) || 0, overall, 800);
  setGauge(overall);
  els.gNum.textContent = String(overall);
  els.cancel.style.display = 'none';
  els.scanList.classList.remove('on');
  const pill = els.tierPill;
  pill.style.display = 'inline-flex';
  pill.style.color = T.color;
  pill.style.borderColor = T.color + '55';
  pill.querySelector('.tdot').style.background = T.color;
  els.tierTxt.textContent = T.txt;
  els.report.classList.add('on');
}

export function resetConsole() {
  if (!els.arc) cache();
  cancelAnimationFrame(animRaf);
  els.report.classList.remove('on');
  els.scanList.classList.remove('on');
  els.cancel.style.display = 'none';
  els.cta.style.display = 'flex';
  els.tierPill.style.display = 'none';
  shown = 0;
  els.gNum.textContent = '--';
  els.gEmoji.textContent = '🐰';
  els.arc.style.strokeDashoffset = ARC_LEN;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
