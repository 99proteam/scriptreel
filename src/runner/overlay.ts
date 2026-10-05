/**
 * Script injected into every page when running with --headed, so you can watch the demo with the
 * same animated cursor that appears in the video. It is hidden in screenshots; the video cursor
 * is drawn by the compositor along the exact same path.
 */
export const CURSOR_ELEMENT_ID = '__scriptreel_cursor';

export const overlayScript = `(() => {
  if (window.__scriptreel) return;
  const ID = ${JSON.stringify(CURSOR_ELEMENT_ID)};
  const state = { x: innerWidth / 2, y: innerHeight / 2 };
  try {
    const saved = JSON.parse(sessionStorage.getItem(ID) || 'null');
    if (saved) Object.assign(state, saved);
  } catch {}
  let el;
  const place = () => {
    if (el) el.style.transform = 'translate(' + state.x + 'px,' + state.y + 'px)';
    try { sessionStorage.setItem(ID, JSON.stringify(state)); } catch {}
  };
  const install = () => {
    if (document.getElementById(ID)) return;
    el = document.createElement('div');
    el.id = ID;
    el.innerHTML = '<svg width="26" height="26" viewBox="-2 -2 16 22"><path d="M0 0V16.2L4.1 12.6L6.9 18.6L9.5 17.4L6.8 11.6H12Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;margin:-2px 0 0 -2px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))';
    const style = document.createElement('style');
    style.textContent = '*{cursor:none!important}';
    document.documentElement.append(style, el);
    place();
  };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const bez = (a, b, c, d, t) => {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  };
  window.__scriptreel = {
    set(x, y) { state.x = x; state.y = y; place(); },
    move(p0, c1, c2, p1, ms) {
      const start = performance.now();
      const tick = (now) => {
        const t = ease(Math.min(1, (now - start) / ms));
        state.x = bez(p0.x, c1.x, c2.x, p1.x, t);
        state.y = bez(p0.y, c1.y, c2.y, p1.y, t);
        place();
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();`;
