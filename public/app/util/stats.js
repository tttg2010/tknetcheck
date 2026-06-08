// Numeric helpers used across detection modules.

export function mean(xs) {
  if (!xs || xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stddev(xs) {
  if (!xs || xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length);
}

export function percentile(xs, p) {
  if (!xs || xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// Linear interpolation score: at low → 100, at high → 0, clamped.
// If value ≤ low returns 100; if ≥ high returns 0; linear in between.
export function linearScore(value, low, high) {
  if (value <= low) return 100;
  if (value >= high) return 0;
  return Math.round(100 * (1 - (value - low) / (high - low)));
}

export function round(x, digits = 0) {
  const f = Math.pow(10, digits);
  return Math.round(x * f) / f;
}
