// Hero 社会证明气泡：随机滚动展示"某人刚测完 XX 分"。
//
// 每次打开：署名/分数/句式/发现/时间全部随机生成，顺序也随机——每次刷新都不同。
// 造数据，不涉及任何真实用户信息。
//
// 文案由 Olive 重写（原版"太假"）。真实感三原则：**信息残缺**（不是每条都解释原因）、
// **语气平淡**（不拔高不惊呼、去广告腔）、**结构参差**（5 种句式随机，不是清一色
// "刚测出X分·tag"）。所以这里不用 emoji、不用"稳如老狗"这类解说词，只留一个状态点。
//
// 检测中态 / 报告态由 CSS `:has()` 自动隐藏（见 components.css），本模块只管轮播。

// 署名池：像真实用户名的脱敏昵称，不带"矩阵玩家"这类职业黑话。
const SIGNS = [
  '小张·义乌', 'wl888', '东莞阿辉', 'cc66', '曼谷的飞', '泰国·老陈', 'm_jj', '广州小吴',
  '深圳·阿K', 'xr1024', '独行侠888', '杭州·周哥', 'ay_tktk', '老林·BKK', 'zz9527', '佛山阿旺'
];

const TIMES = ['刚刚', '刚刚', '1 分钟前', '2 分钟前', '3 分钟前', '4 分钟前', '6 分钟前', '9 分钟前', '13 分钟前'];

// 四档：出现权重（良好/警告偏多，更真实）+ 分数区间 + 平淡的"发现"短语 + 单字反应。
const TIERS = [
  { w: 0.16, min: 85, max: 98, color: 'var(--good)',
    finds: ['IP 是住宅的', '时区对上了', '各项都绿了', '没漏，干净'],
    noun: ['IP 是住宅的', '时区对上了', '各项都绿了'],   // 供句式 D 用的短名词
    react: ['行了', '稳', '没事', '踏实了'] },
  { w: 0.30, min: 70, max: 84, color: 'var(--ok)',
    finds: ['大部分没问题，延迟稍微高了点', '基本过了，就 DNS 那里黄了', '还行，就是抖动有点', '不算完美，能用'],
    noun: ['延迟稍微高了点', 'DNS 那里有点黄', '抖动有点高'],
    react: ['还行', '能用', '凑合'] },
  { w: 0.30, min: 50, max: 69, color: 'var(--warn)',
    finds: ['时区对不上', 'WebRTC 那里亮了', '有一项没过', 'DNS 感觉不对，要查一下', '延迟高得有点奇怪'],
    noun: ['时区对不上', 'WebRTC 那里亮了', '延迟有点奇怪'],
    react: ['嗯…', '再看看', '悬'] },
  { w: 0.24, min: 28, max: 49, color: 'var(--bad)',
    finds: ['IP 是机房的', '漏了真实 IP', 'DNS 被改了', '全红，不能用这个', '换 IP 再测一次吧'],
    noun: ['IP 是机房的', '真实 IP 漏了', 'DNS 被改了'],
    react: ['完了', '麻了', '难怪'] }
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
function weightedTier() { let r = Math.random(), acc = 0; for (const t of TIERS) { acc += t.w; if (r < acc) return t; } return TIERS[TIERS.length - 1]; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
const num = (n, color) => `<b class="lb-score" style="color:${color}">${n}</b>`;

// 真实近期结果（后端匿名记录：分数+档位+国家+时间，无 IP）。有就优先用真的。
let realResults = [];
async function fetchReal() {
  try {
    const r = await fetch('/api/recentResults', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ n: 24 }) });
    const j = await r.json();
    if (j && j.code === 0 && Array.isArray(j.results)) realResults = j.results.filter(x => x && typeof x.score === 'number');
  } catch (_) { /* 拉不到就用假数据兜底 */ }
}
function tierByScore(s) { for (const t of TIERS) if (s >= t.min && s <= t.max) return t; return s >= 85 ? TIERS[0] : s >= 70 ? TIERS[1] : s >= 50 ? TIERS[2] : TIERS[3]; }
function relTime(at) {
  const m = Math.floor(Math.max(0, Date.now() - at) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}

// 5 种参差句式，随机挑一种生成 { html, color, time? }。
function genBubble() {
  // 有真实数据时，约 2/3 概率用真的一条（分数/时间为真，署名与句式仍随机以求参差）。
  if (realResults.length && Math.random() < 0.66) {
    const rr = realResults[Math.floor(Math.random() * realResults.length)];
    const t = tierByScore(rr.score), sign = esc(pick(SIGNS)), time = relTime(rr.at);
    const k = rnd(0, 2);
    if (k === 0) return { html: `<b>${sign}</b> 测完了，${num(rr.score, t.color)} 分`, color: t.color, time };
    if (k === 1) return { html: `<b>${sign}</b> 刚测，${num(rr.score, t.color)} 分，${esc(pick(t.react))}`, color: t.color, time };
    return { html: `<b>${sign}</b>：${num(rr.score, t.color)} 分，${esc(pick(t.finds))}`, color: t.color, time };
  }

  const sign = esc(pick(SIGNS));
  const kind = rnd(0, 4);

  // C：换环境复测，从差分到好分（before/after 故事）
  if (kind === 2) {
    const lo = rnd(30, 50);
    const hi = rnd(78, 93);
    const t = hi >= 85 ? TIERS[0] : TIERS[1];
    return { html: `<b>${sign}</b> 换了节点重新测，从 ${num(lo, 'var(--ink-3)')} 到 ${num(hi, t.color)}`, color: t.color };
  }

  const t = weightedTier();
  const score = rnd(t.min, t.max);

  // D：不报分数，只说一个发现（用短名词，读起来更自然）
  if (kind === 3) {
    return { html: `<b>${sign}</b>：${esc(pick(t.noun))}，之前没注意`, color: t.color };
  }
  // A：只报分数
  if (kind === 0) {
    return { html: `<b>${sign}</b> 测完了，${num(score, t.color)} 分`, color: t.color };
  }
  // E：分数 + 单字反应
  if (kind === 4) {
    return { html: `<b>${sign}</b> 刚测，${num(score, t.color)} 分，${esc(pick(t.react))}`, color: t.color };
  }
  // B：分数 + 一个平淡发现
  return { html: `<b>${sign}</b>：${num(score, t.color)} 分，${esc(pick(t.finds))}`, color: t.color };
}

function render(el, b) {
  el.innerHTML =
    `<span class="lb-dot" style="background:${b.color}"></span>` +
    `<span class="lb-text">${b.html}</span>` +
    `<span class="lb-time">${esc(b.time || pick(TIMES))}</span>`;
}

const ROTATE_MS = 4200;

export function mountLiveTicker() {
  const el = document.getElementById('liveTicker');
  if (!el) return;

  fetchReal();                              // 异步拉真实数据，来了下一轮就用上
  render(el, genBubble());
  el.classList.add('show');

  let ticks = 0;
  setInterval(() => {
    if (document.hidden) return;            // 页面不可见时不折腾
    if (++ticks % 30 === 0) fetchReal();    // 每 ~2 分钟刷新一次真实数据
    el.classList.remove('show');
    setTimeout(() => { render(el, genBubble()); el.classList.add('show'); }, 320);
  }, ROTATE_MS);
}
