// Central app state + minimal event bus.
// Replaces a framework's reactive store with explicit re-render per phase.

const listeners = new Map();

export const state = {
  startedAt: 0,
  phase: 'landing',                       // 'landing' | 'progress' | 'report'
  cancelled: false,
  results: {
    ip: null,
    dns: null,
    webrtc: null,
    stability: null,
    device: null,
    reachability: null
  },
  scores: {
    ip: 0, dns: 0, webrtc: 0, stability: 0, device: 0, reachability: 0,
    overall: 0
  },
  recommendations: [],
  errors: {},
  shareId: null,
  shareExpiresAt: null
};

export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  },
  emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.error('[bus]', event, e); }
    }
  }
};

// Reset state for a re-run.
export function resetState() {
  state.startedAt = 0;
  state.phase = 'landing';
  state.cancelled = false;
  state.shareId = null;
  state.shareExpiresAt = null;
  state.recommendations = [];
  for (const k of Object.keys(state.results)) state.results[k] = null;
  for (const k of Object.keys(state.scores)) state.scores[k] = 0;
  state.errors = {};
}
