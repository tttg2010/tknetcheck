// 微信联系弹窗 + FAQ 手风琴的事件绑定（纯 UI，无业务逻辑）。

const WX_ID = 'zac201299';

export function mountWechat() {
  const mask = document.getElementById('wxMask');
  if (!mask) return;
  const open = () => mask.classList.add('on');
  const close = () => mask.classList.remove('on');

  const spCta = document.getElementById('spCta');
  const footWx = document.getElementById('footWx');
  const wxClose = document.getElementById('wxClose');
  const wxCopy = document.getElementById('wxCopy');

  if (spCta) spCta.onclick = open;
  if (footWx) footWx.onclick = (e) => { e.preventDefault(); open(); };
  if (wxClose) wxClose.onclick = close;
  mask.onclick = (e) => { if (e.target.id === 'wxMask') close(); };

  if (wxCopy) {
    wxCopy.onclick = async () => {
      await copyText(WX_ID);
      wxCopy.textContent = '已复制 ✓';
      wxCopy.classList.add('done');
      setTimeout(() => { wxCopy.textContent = '复制'; wxCopy.classList.remove('done'); }, 1800);
    };
  }

  return { open, close };
}

// FAQ 手风琴（内容已在 HTML 静态渲染，这里只绑展开）。
export function mountFaq() {
  document.querySelectorAll('.faq-q').forEach(b => {
    b.onclick = () => b.parentElement.classList.toggle('open');
  });
}

// 复制到剪贴板，带非安全上下文兜底（http / 老浏览器）。
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (__) {
      return false;
    }
  }
}
