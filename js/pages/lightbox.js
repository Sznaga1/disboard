'use strict';
/* ==========================================================================
   Disboard — ekrany: podgląd grafik (lightbox)
   (dawny js/pages.js; wspólne funkcje w js/pages/common.js)
   ========================================================================== */

/* ---------- lightbox dla grafik ---------- */
const Lightbox = (() => {
  let list = [], i = 0, el = null;
  const draw = () => {
    const p = list[i];
    el.querySelector('img').src = p.full;
    el.querySelector('.lb-cap').textContent = `${p.label} · ${i + 1}/${list.length}`;
  };
  function open(pics, start) {
    list = pics; i = start;
    if (!el) {
      el = document.createElement('div');
      el.className = 'lightbox';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.innerHTML = `<button class="icon-btn lb-x" type="button" aria-label="Zamknij">${ICON.x}</button>
        <button class="icon-btn lb-prev" type="button" aria-label="Poprzednia">${ICON.chevron}</button>
        <img alt=""><button class="icon-btn lb-next" type="button" aria-label="Następna">${ICON.chevron}</button><p class="lb-cap"></p>`;
      document.body.append(el);
      el.addEventListener('click', (ev) => {
        if (ev.target === el || ev.target.closest('.lb-x')) close();
        else if (ev.target.closest('.lb-prev')) { i = (i - 1 + list.length) % list.length; draw(); }
        else if (ev.target.closest('.lb-next')) { i = (i + 1) % list.length; draw(); }
      });
      document.addEventListener('keydown', (ev) => {
        if (el.hidden) return;
        if (ev.key === 'Escape') close();
        if (ev.key === 'ArrowRight') { i = (i + 1) % list.length; draw(); }
        if (ev.key === 'ArrowLeft') { i = (i - 1 + list.length) % list.length; draw(); }
      });
    }
    el.hidden = false;
    draw();
    el.querySelector('.lb-x').focus();
  }
  function close() { if (el) el.hidden = true; }
  return { open, close };
})();
