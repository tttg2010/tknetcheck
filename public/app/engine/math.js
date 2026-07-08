// [GENERATED] 源自 packages/tknc-engine/src/math.js —— 勿手改；改事实源后运行 bash scripts/sync-engine.sh 同步。
// 纯数值工具。从 public/app/util/stats.js 抽取，保证引擎零外部依赖。
// 与前端版本保持逐字等价（clamp / linearScore），确保打分结果一致。

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// 线性插值打分：value<=low 得 100，value>=high 得 0，中间线性，四舍五入。
export function linearScore(value, low, high) {
  if (value <= low) return 100;
  if (value >= high) return 0;
  return Math.round(100 * (1 - (value - low) / (high - low)));
}
