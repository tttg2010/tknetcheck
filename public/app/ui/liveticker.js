// Hero 社会证明气泡：随机滚动展示"某地网友刚测出 XX 分"。
//
// 每次打开页面：城市/身份/分数/档位/时间全部随机生成，顺序也随机——
// 所以每个用户、每次刷新看到的都不一样。加权分布（良好/警告偏多）让它更真实，
// 不会全是满分或全是 0 分。纯前端造数据，不涉及任何真实用户信息。
//
// 检测中态 / 报告态由 CSS `:has()` 自动隐藏（见 components.css），本模块只管轮播。

const CITIES = ['深圳', '广州', '义乌', '杭州', '东莞', '福州', '泉州', '成都', '郑州', '长沙', '佛山', '宁波', '厦门', '南宁', '曼谷', '胡志明', '迪拜', '吉隆坡'];
const HANDLES = ['网友', '跨境卖家', '矩阵玩家', 'TK 运营', '独立卖家', '带货新手', '工作室', '老玩家'];
const TIMES = ['刚刚', '1 分钟前', '3 分钟前', '5 分钟前', '9 分钟前', '14 分钟前', '23 分钟前', '半小时前'];

// 四档结果模板 + 出现权重（良好/警告偏多，更贴近真实分布）。
const TIERS = [
  { w: 0.20, min: 90, max: 99, color: 'var(--good)', emoji: '😎', tags: ['住宅 IP，稳如老狗', '各项全绿，可放心发', '环境干净，直接起飞'] },
  { w: 0.30, min: 72, max: 88, color: 'var(--ok)',   emoji: '🙂', tags: ['整体不错，就抖动高了点', '良好，优化两项更稳', '基本达标，能发'] },
  { w: 0.28, min: 52, max: 68, color: 'var(--warn)', emoji: '😟', tags: ['时区对不上，踩坑了', '延迟偏高，线路该换', '有风险，先别急着发'] },
  { w: 0.22, min: 10, max: 46, color: 'var(--bad)',  emoji: '😱', tags: ['机房 IP，难怪 0 播放', 'WebRTC 泄漏了真实 IP', 'DNS 被劫持，危险'] }
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

function weightedTier() {
  let r = Math.random(), acc = 0;
  for (const t of TIERS) { acc += t.w; if (r < acc) return t; }
  return TIERS[TIERS.length - 1];
}

function genBubble() {
  const t = weightedTier();
  return {
    who: `${pick(CITIES)}·${pick(HANDLES)}`,
    score: t.min + Math.floor(Math.random() * (t.max - t.min + 1)),
    color: t.color,
    emoji: t.emoji,
    tag: pick(t.tags),
    time: pick(TIMES)
  };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render(el, b) {
  el.innerHTML =
    `<span class="lb-dot" style="background:${b.color}"></span>` +
    `<span class="lb-emoji">${b.emoji}</span>` +
    `<span class="lb-text"><b>${esc(b.who)}</b> 刚测出 <b class="lb-score" style="color:${b.color}">${b.score}</b> 分 · ${esc(b.tag)}</span>` +
    `<span class="lb-time">${esc(b.time)}</span>`;
}

// 轮播：淡出→换内容→淡入，每 ROTATE_MS 一次。
const ROTATE_MS = 4000;

export function mountLiveTicker() {
  const el = document.getElementById('liveTicker');
  if (!el) return;

  render(el, genBubble());
  el.classList.add('show');

  setInterval(() => {
    // 页面不可见时不折腾（省资源，回来再转）。
    if (document.hidden) return;
    el.classList.remove('show');
    setTimeout(() => {
      render(el, genBubble());
      el.classList.add('show');
    }, 320);
  }, ROTATE_MS);
}
