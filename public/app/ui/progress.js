// Progress phase: shows the 6 module rows + status line.
// Subscribes to bus events emitted from app.js orchestrator.

import { bus } from '../state.js';
import { t } from '../util/i18n.js';

let cancelHandler = null;

export function mountProgress({ onCancel }) {
  cancelHandler = onCancel;
  document.getElementById('btn-cancel').addEventListener('click', () => {
    cancelHandler && cancelHandler();
  });

  bus.on('module:state', ({ name, state }) => setRow(name, state));
  bus.on('module:status', ({ text }) => setStatus(text));
  bus.on('progress:count', ({ done, total }) => setCount(done, total));
}

function setRow(name, state) {
  const row = document.querySelector(`.module-row[data-module="${name}"] .module-state`);
  if (!row) return;
  row.dataset.state = state;
  row.textContent = t.state[state] || state;
}

function setStatus(text) {
  const el = document.getElementById('status-line');
  if (el) el.innerHTML = text + '<span class="dots"></span>';
}

function setCount(done, total) {
  const el = document.getElementById('progress-count');
  if (el) el.textContent = String(done);
}

export function resetProgress() {
  for (const m of ['ip','dns','webrtc','stability','device','reachability']) {
    setRow(m, 'pending');
  }
  setCount(0, 6);
  setStatus(t.status.starting);
}
