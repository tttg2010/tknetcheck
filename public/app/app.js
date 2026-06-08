// App entry — wires phases, runs the 6 detection modules.
//
// Phases swap via `hidden` on three <section> elements. Each phase module
// (landing/progress/report) owns its DOM and listens to the central event bus.

import { state, bus, resetState } from './state.js';
import { api } from './api.js';
import { t } from './util/i18n.js';

import { mountLanding } from './ui/landing.js';
import { mountProgress, resetProgress } from './ui/progress.js';
import { mountReport, renderReport } from './ui/report.js';

import { runIp } from './modules/ip.js';
import { runDns } from './modules/dns.js';
import { runWebRTC } from './modules/webrtc.js';
import { runStability } from './modules/stability.js';
import { runDevice } from './modules/device.js';
import { runReachability } from './modules/reachability.js';

import {
  scoreIp, scoreDns, scoreWebRTC, scoreStability, scoreDevice, scoreReachability, overall, tierOf
} from './scoring.js';
import { buildRecommendations } from './recommendations.js';

// ── Phase switching ─────────────────────────────────────────────────────────
function showPhase(name) {
  state.phase = name;
  for (const id of ['phase-landing', 'phase-progress', 'phase-report']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.hidden = id !== `phase-${name}`;
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ── Orchestrator ────────────────────────────────────────────────────────────
async function runAllModules() {
  state.startedAt = Date.now();
  state.cancelled = false;
  resetProgress();

  let doneCount = 0;
  const tick = () => bus.emit('progress:count', { done: ++doneCount, total: 6 });
  const mark = (m, s) => bus.emit('module:state', { name: m, state: s });
  const status = (txt) => bus.emit('module:status', { text: txt });

  // Run IP first because Dns + Device + WebRTC depend on its country/ip.
  // Run Stability in parallel with the rest (it takes 30s, no dependency).
  mark('ip', 'running');
  status(t.status.runningModule(t.module.ip));
  const ipPromise = runIp();

  // Kick off stability in the background — it's the long-running one.
  mark('stability', 'running');
  let stabilityResult = null;
  const stabilityPromise = runStability(({ elapsedMs, totalMs }) => {
    const sec = Math.round(elapsedMs / 1000);
    const total = Math.round(totalMs / 1000);
    status(t.status.stabilitySampling(sec, total));
  }).then(r => { stabilityResult = r; });

  const ipResult = await ipPromise;
  state.results.ip = ipResult;
  state.scores.ip = scoreIp(ipResult);
  mark('ip', state.scores.ip >= 70 ? 'ok' : state.scores.ip >= 50 ? 'warn' : 'fail');
  tick();
  if (state.cancelled) return;

  // DNS (depends on IP country)
  mark('dns', 'running');
  status(t.status.runningModule(t.module.dns));
  const dnsResult = await runDns(ipResult.country, ipResult.countryName);
  state.results.dns = dnsResult;
  state.scores.dns = scoreDns(dnsResult);
  mark('dns', state.scores.dns >= 70 ? 'ok' : state.scores.dns >= 50 ? 'warn' : 'fail');
  tick();
  if (state.cancelled) return;

  // WebRTC (depends on IP)
  mark('webrtc', 'running');
  status(t.status.runningModule(t.module.webrtc));
  const webrtcResult = await runWebRTC(ipResult.ip);
  state.results.webrtc = webrtcResult;
  state.scores.webrtc = scoreWebRTC(webrtcResult);
  mark('webrtc', state.scores.webrtc >= 70 ? 'ok' : state.scores.webrtc >= 50 ? 'warn' : 'fail');
  tick();
  if (state.cancelled) return;

  // Device (depends on IP country)
  mark('device', 'running');
  status(t.status.runningModule(t.module.device));
  const deviceResult = await runDevice(ipResult.country);
  state.results.device = deviceResult;
  state.scores.device = scoreDevice(deviceResult);
  mark('device', state.scores.device >= 70 ? 'ok' : state.scores.device >= 50 ? 'warn' : 'fail');
  tick();
  if (state.cancelled) return;

  // Reachability — quick, in parallel with the still-running stability
  mark('reachability', 'running');
  status(t.status.runningModule(t.module.reachability));
  const reachabilityResult = await runReachability();
  state.results.reachability = reachabilityResult;
  state.scores.reachability = scoreReachability(reachabilityResult);
  mark('reachability',
    state.scores.reachability >= 70 ? 'ok' :
    state.scores.reachability >= 50 ? 'warn' : 'fail');
  tick();
  if (state.cancelled) return;

  // Wait for stability to finish (likely still in flight)
  status(t.status.runningModule(t.module.stability));
  await stabilityPromise;
  state.results.stability = stabilityResult;
  state.scores.stability = scoreStability(stabilityResult);
  mark('stability',
    state.scores.stability >= 70 ? 'ok' :
    state.scores.stability >= 50 ? 'warn' : 'fail');
  tick();

  // Compute overall + recommendations
  state.scores.overall = overall(state.scores);
  state.recommendations = buildRecommendations(state.results, state.scores);
  status(t.status.finalizing);

  // Switch to report phase
  showPhase('report');
  const payload = buildPayloadForRender();
  renderReport(document.getElementById('phase-report'), payload);
}

function buildPayloadForRender() {
  const dur = Math.round((Date.now() - state.startedAt) / 1000);
  return {
    scores: { ...state.scores },
    results: { ...state.results },
    recommendations: [...state.recommendations],
    meta: `检测于 ${new Date(state.startedAt).toLocaleString('zh-CN')} · 耗时 ${dur}s`
  };
}

// ── Share flow ──────────────────────────────────────────────────────────────
async function onShare() {
  const shareResult = document.getElementById('share-result');
  const copyTextEl = document.getElementById('share-copy-text');
  const btn = document.getElementById('btn-share');
  btn.disabled = true;
  btn.textContent = t.share.generating;
  try {
    const payload = stripForStorage(buildPayloadForRender());
    const res = await api.saveReport(payload);
    if (!res || !res.shareId) throw new Error('无返回 shareId');
    state.shareId = res.shareId;
    state.shareExpiresAt = res.expiresAt || 0;
    const url = `${location.origin}${location.pathname.replace(/index\.html$/, '')}share.html?id=${encodeURIComponent(res.shareId)}`;

    // Build tier-aware share copy (hook + score + link), ready to paste into 朋友圈.
    const tier = tierOf(state.scores.overall);
    const copyText = (t.shareCopy[tier] || t.shareCopy.warning)
      .replace('{score}', String(state.scores.overall))
      .replace('{url}', url);

    // Show the copy text; stash both the copy and the bare url for the buttons.
    copyTextEl.textContent = copyText;
    copyTextEl.dataset.copy = copyText;
    copyTextEl.dataset.url = url;

    shareResult.hidden = false;
    btn.textContent = t.share.generated;
    shareResult.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    btn.disabled = false;
    btn.textContent = t.share.failed;
    const errorMsg = e && e.message ? e.message : String(e);
    console.error('[share]', errorMsg);
    // Show user-friendly error
    const hint = document.getElementById('share-hint');
    if (hint) {
      const orig = hint.textContent;
      hint.textContent = `❌ ${errorMsg}（请检查网络或稍后重试）`;
      setTimeout(() => { hint.textContent = orig; }, 5000);
    }
  }
}

// Strip identifying fields before storage — keep derived booleans only.
function stripForStorage(p) {
  const out = JSON.parse(JSON.stringify(p));
  const ip = out.results.ip;
  if (ip) {
    delete ip.ip;
    delete ip.raw;
  }
  const wr = out.results.webrtc;
  if (wr) {
    delete wr.referenceIp;
    delete wr.srflxIps;
    delete wr.hostCandidates;
    delete wr.realLocalIps;
    delete wr.ipv6Address;
  }
  const dev = out.results.device;
  if (dev) {
    // Keep canvasHash (already SHA-256) but trim UA for length.
    if (dev.ua) dev.ua = dev.ua.slice(0, 200);
  }
  return out;
}

// ── Bootstrap ───────────────────────────────────────────────────────────────
function bootstrap() {
  mountLanding({ onStart: () => { showPhase('progress'); runAllModules().catch(err => {
    console.error('[runAllModules]', err);
    bus.emit('module:status', { text: '检测出现错误：' + (err && err.message || '未知错误') });
  }); }});

  mountProgress({ onCancel: () => {
    state.cancelled = true;
    resetState();
    showPhase('landing');
  }});

  mountReport({
    onShare,
    onRerun: () => {
      resetState();
      // Re-mount landing & reset checkbox
      const consent = document.getElementById('consent');
      if (consent) consent.checked = false;
      const btnStart = document.getElementById('btn-start');
      if (btnStart) btnStart.disabled = true;
      const shareResult = document.getElementById('share-result');
      if (shareResult) shareResult.hidden = true;
      const btnShare = document.getElementById('btn-share');
      if (btnShare) { btnShare.disabled = false; btnShare.textContent = t.share.cta; }
      showPhase('landing');
    }
  });

  showPhase('landing');
}

bootstrap();
