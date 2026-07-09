// App 入口 —— 编排 6 个真实检测模块，接判断引擎评分，驱动诊断仪三态 UI。
//
// 编排骨架保留自旧版：IP 先行（DNS/Device/WebRTC 依赖它的 country/ip），
// Stability 后台并行（30s，无依赖），其余快模块串行，全程 cancelled 可中断。
// 评分/建议全部走 @tknc/engine 的 public 副本（app/engine/*，由 scripts/sync-engine.sh 同步）。
// UI 换成单容器三态（console.js）+ 原型报告渲染（ui/report.js）。

import { state, bus, resetState } from './state.js';
import { api } from './api.js?v=6';

import { runIp } from './modules/ip.js?v=7';
import { runDns } from './modules/dns.js';
import { runWebRTC } from './modules/webrtc.js';
import { runStability } from './modules/stability.js';
import { runDevice } from './modules/device.js';
import { runReachability } from './modules/reachability.js';

import {
  evaluate, resolveConfig,
  scoreIp, scoreDns, scoreWebRTC, scoreStability, scoreDevice, scoreReachability
} from './engine/index.js';

import { startScan, markScanRow, creepGauge, showReport, resetConsole } from './ui/console.js';
import { renderReport } from './ui/report.js?v=9';
import { mountSponsors } from './ui/sponsors.js';
import { mountWechat, mountFaq, copyText } from './ui/wechat.js';
import { mountLiveTicker } from './ui/liveticker.js?v=4';

const CFG = resolveConfig();

// 单模块分数 → 扫描行状态点（即时反馈）。与引擎打分同源，不会与总报告漂移。
function markFromScore(name, score) {
  markScanRow(name, score >= 70 ? 'ok' : score >= 50 ? 'warn' : 'fail');
}

// tier 分档权重定义的模块顺序，用于进度中让仪表按"已完成模块的加权均分"爬升。
const WEIGHTS = CFG.weights;

// ── 编排 ────────────────────────────────────────────────────────
let running = false;

async function runAllModules() {
  state.startedAt = Date.now();
  state.cancelled = false;

  // 进度中让仪表爬升：用"已完成模块的加权均分"作为瞬时目标（视觉反馈，非最终分）。
  const doneScores = {};
  const creep = () => {
    let sw = 0, ss = 0;
    for (const k of Object.keys(doneScores)) { sw += WEIGHTS[k]; ss += doneScores[k] * WEIGHTS[k]; }
    if (sw > 0) creepGauge(Math.round(ss / sw));
  };
  const settle = (name, result, score) => {
    state.results[name] = result;
    state.scores[name] = score;
    doneScores[name] = score;
    markFromScore(name, score);
    creep();
  };

  // IP 先行
  markScanRow('ip', 'running');
  const ipPromise = runIp();

  // Stability 后台并行（长任务）
  markScanRow('stability', 'running');
  let stabilityResult = null;
  const stabilityPromise = runStability(() => {}).then(r => { stabilityResult = r; });

  const ipResult = await ipPromise;
  if (state.cancelled) return;
  settle('ip', ipResult, scoreIp(ipResult, CFG));

  // DNS（依赖 IP 国家）
  markScanRow('dns', 'running');
  const dnsResult = await runDns(ipResult.country, ipResult.countryName);
  if (state.cancelled) return;
  settle('dns', dnsResult, scoreDns(dnsResult, CFG));

  // WebRTC（依赖 IP）
  markScanRow('webrtc', 'running');
  const webrtcResult = await runWebRTC(ipResult.ip);
  if (state.cancelled) return;
  settle('webrtc', webrtcResult, scoreWebRTC(webrtcResult, CFG));

  // Device（依赖 IP 国家）
  markScanRow('device', 'running');
  const deviceResult = await runDevice(ipResult.country);
  if (state.cancelled) return;
  settle('device', deviceResult, scoreDevice(deviceResult, CFG));

  // Reachability（快，与仍在跑的 stability 并行）
  markScanRow('reachability', 'running');
  const reachabilityResult = await runReachability();
  if (state.cancelled) return;
  settle('reachability', reachabilityResult, scoreReachability(reachabilityResult, CFG));

  // 等 stability 收尾
  await stabilityPromise;
  if (state.cancelled) return;
  settle('stability', stabilityResult, scoreStability(stabilityResult, CFG));

  // 用引擎门面出总报告（唯一评分事实源；同源，不会与上面的即时分漂移）
  const report = evaluate(state.results, { config: CFG });
  state.scores = report.scores;                 // 含 overall
  state.recommendations = report.recommendations;
  state.tier = report.tier;
  state.topIssues = report.topIssues;
  state.configVersion = report.configVersion;

  // 渲染报告 + 定格仪表
  const payload = buildPayloadForRender();
  const T = renderReport(document.getElementById('report'), payload);
  showReport(report.overall, T);
  running = false;
}

function buildPayloadForRender() {
  const dur = Math.round((Date.now() - state.startedAt) / 1000);
  return {
    scores: { ...state.scores },
    results: { ...state.results },
    recommendations: [...(state.recommendations || [])],
    topIssues: state.topIssues,
    tier: state.tier,
    overall: state.scores.overall,
    configVersion: state.configVersion,
    meta: `检测于 ${new Date(state.startedAt).toLocaleString('zh-CN')} · 耗时 ${dur}s`
  };
}

// ── 启动检测 ────────────────────────────────────────────────────
function start() {
  if (running) return;
  running = true;
  resetState();
  state.startedAt = Date.now();
  startScan();
  runAllModules().catch(err => {
    console.error('[runAllModules]', err);
    // 兜底：不白屏。用已有 result 尽力出报告。
    running = false;
    try {
      const report = evaluate(state.results, { config: CFG });
      state.scores = report.scores;
      state.recommendations = report.recommendations;
      state.tier = report.tier;
      state.topIssues = report.topIssues;
      state.configVersion = report.configVersion;
      const payload = buildPayloadForRender();
      const T = renderReport(document.getElementById('report'), payload);
      showReport(report.overall, T);
    } catch (e2) {
      console.error('[fallback render]', e2);
    }
  });
}

function cancel() {
  state.cancelled = true;
  running = false;
  resetState();
  resetConsole();
}

function rerun() {
  resetState();
  resetConsole();
  const so = document.getElementById('shareOut');
  if (so) { so.classList.remove('on'); so.textContent = ''; so.dataset.copy = ''; }
  const bs = document.getElementById('btnShare');
  if (bs) { bs.disabled = false; bs.textContent = '生成分享文案'; }
}

// ── 分享闭环 ────────────────────────────────────────────────────
const SHARE_HOOK = {
  excellent: (s) => `我的 TikTok 网络环境 ${s} 分，优秀 😎 你敢测吗？`,
  good:      (s) => `我的 TikTok 网络环境体检 ${s} 分（良好）✨ 内容一样却 0 播放？先测测网络👇`,
  warning:   (s) => `我的 TikTok 网络环境才 ${s} 分⚠️ 难怪 0 播放，你的呢？`,
  danger:    (s) => `我的 TikTok 网络环境 ${s} 分，危险🚨 幸好测了。快查你的👇`
};

async function onShare() {
  const btn = document.getElementById('btnShare');
  const out = document.getElementById('shareOut');
  const hint = document.getElementById('shareHint');
  btn.disabled = true;
  btn.textContent = '正在生成…';

  const s = state.scores.overall;
  const tier = state.tier || 'warning';

  try {
    const payload = stripForStorage(buildPayloadForRender());
    const res = await api.saveReport(payload);
    if (!res || !(res.shareId || (res.data && res.data.shareId))) throw new Error('云函数未返回 shareId');
    const shareId = res.shareId || res.data.shareId;
    state.shareId = shareId;
    const url = `${location.origin}${location.pathname.replace(/index\.html$/, '')}share.html?id=${encodeURIComponent(shareId)}`;
    const hook = (SHARE_HOOK[tier] || SHARE_HOOK.warning)(s);
    const text = `${hook}\n🐰 小白兔TKNC · 6 项诊断 30 秒出报告\n${url}`;
    out.textContent = text;
    out.dataset.copy = text;
    out.classList.add('on');
    btn.textContent = '已生成 · 点此复制';
    btn.disabled = false;
    if (hint) hint.hidden = true;
  } catch (e) {
    // 云函数失败降级：本地生成不含分享链接的文案，用户仍可复制发圈。
    const hook = (SHARE_HOOK[tier] || SHARE_HOOK.warning)(s);
    const url = `${location.origin}${location.pathname.replace(/index\.html$/, '')}`;
    const text = `${hook}\n🐰 小白兔TKNC · 6 项诊断 30 秒出报告\n${url}`;
    out.textContent = text;
    out.dataset.copy = text;
    out.classList.add('on');
    btn.textContent = '已生成 · 点此复制';
    btn.disabled = false;
    console.warn('[share] 云函数不可用，降级为本地文案：', (e && e.message) || e);
    if (hint) { hint.hidden = false; hint.textContent = '分享链接暂不可用，已生成可复制文案'; }
  }
}

// 存储前剥离可标识字段——只保留派生布尔与匿名指标（隐私声明的技术兑现）。
function stripForStorage(p) {
  const out = JSON.parse(JSON.stringify(p));
  const ip = out.results && out.results.ip;
  if (ip) { delete ip.ip; delete ip.raw; }
  const wr = out.results && out.results.webrtc;
  if (wr) {
    delete wr.referenceIp; delete wr.srflxIps; delete wr.hostCandidates;
    delete wr.realLocalIps; delete wr.ipv6Address;
  }
  const dev = out.results && out.results.device;
  if (dev && dev.ua) dev.ua = dev.ua.slice(0, 200);
  return out;
}

// ── 引导 ────────────────────────────────────────────────────────
function bootstrap() {
  const wx = mountWechat();
  mountFaq();
  mountSponsors({ onEmptyClick: wx && wx.open });
  mountLiveTicker();

  document.getElementById('btnStart').onclick = start;
  document.getElementById('btnCancel').onclick = cancel;
  document.getElementById('btnRerun').onclick = rerun;

  // 分享按钮：首次点击生成，之后点击复制（文案已在 dataset.copy）。
  const btnShare = document.getElementById('btnShare');
  btnShare.onclick = async () => {
    const out = document.getElementById('shareOut');
    if (out && out.classList.contains('on') && out.dataset.copy) {
      const okc = await copyText(out.dataset.copy);
      btnShare.textContent = okc ? '已复制 ✓' : '复制失败，请手动长按';
      setTimeout(() => { btnShare.textContent = '已生成 · 点此复制'; }, 1800);
      return;
    }
    onShare();
  };
}

bootstrap();
