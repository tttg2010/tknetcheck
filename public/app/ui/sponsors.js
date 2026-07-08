// 赞助商横条渲染。
//
// 数据源：public/sponsors.json（管理员手改，前端只读）。
// schema: { id, name, slogan, desc, emoji, url, tier, order, startAt, endAt }
// 过滤：只显示 startAt <= 今天 <= endAt 的项；排序：tier(gold>silver>bronze) → order。
// 拉取失败时静默降级（横条只留"你的品牌"占位），不影响主检测流程。

const TIER_RANK = { gold: 0, silver: 1, bronze: 2 };

function today() {
  // 用本地日期（YYYY-MM-DD），与 sponsors.json 里的日期字符串同口径比较。
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function activeSponsors(list) {
  const t = today();
  return (list || [])
    .filter(s => s && s.startAt <= t && s.endAt >= t)
    .sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || (a.order - b.order));
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// onEmptyClick：点击"你的品牌"占位卡时的回调（打开微信弹窗）。
export async function mountSponsors({ onEmptyClick } = {}) {
  const box = document.getElementById('spList');
  if (!box) return;

  let list = [];
  try {
    const res = await fetch('sponsors.json', { cache: 'no-cache' });
    if (res.ok) list = await res.json();
  } catch (e) {
    console.warn('[sponsors] 加载 sponsors.json 失败，使用空列表', e && e.message);
  }

  // 紧凑横排卡：logo(图片优先，emoji 兜底) + 名称 + slogan；desc 收进 title 悬浮提示。
  const cards = activeSponsors(list).map(s => `
    <a class="sp-card" href="${esc(s.url || '#')}" target="_blank" rel="noopener" title="${esc(s.desc || '')}">
      <div class="sp-logo">${s.logo
        ? `<img src="${esc(s.logo)}" alt="${esc(s.name)}">`
        : esc(s.emoji || '⭐')}</div>
      <div class="sp-txt">
        <div class="sp-name">${esc(s.name)}</div>
        <div class="sp-slogan">${esc(s.slogan || '')}</div>
      </div>
    </a>`).join('');

  box.innerHTML = cards + `<div class="sp-empty" id="spEmpty"><span class="plus">＋</span><span>你的品牌</span></div>`;
  const empty = document.getElementById('spEmpty');
  if (empty && onEmptyClick) empty.onclick = onEmptyClick;
}
