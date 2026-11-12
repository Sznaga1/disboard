'use strict';
/* ==========================================================================
   Disboard — szybkie dodawanie z menu statusów
   • klik w „+”            → Planuję (w trybie uzupełniania: Obejrzane, bez daty)
   • najechanie na „+”     → po ~¼ s menu: Planuję / Oglądam / Obejrzane / Wstrzymane / Porzucone
   • przytrzymanie (dotyk) → to samo menu
   • odznaka statusu       → to samo menu (zmiana statusu, usunięcie z listy)
   • w menu: klawisze 1–5, Esc; przy „Oglądam” opcjonalny numer odcinka (Enter)
   ========================================================================== */

const QuickAdd = (() => {
  const HOVER_OPEN = 260;
  const HOVER_CLOSE = 280;
  const LONG_PRESS = 450;
  const ANCHORS = '[data-add][data-quick], [data-qmenu]';

  let el = null;          // element menu
  let anchor = null;      // przycisk, przy którym menu jest otwarte
  let id = null;          // AniList ID
  let openTimer = null, closeTimer = null, pressTimer = null;
  let suppressClickUntil = 0;
  let viaKeyboard = false;

  const mediaOf = (aid) => UI.media.get(aid) || (Lib.get(aid) && Lib.get(aid).media) || null;
  const isOpen = () => !!(el && !el.hidden);

  function build() {
    el = document.createElement('div');
    el.className = 'qa-menu';
    el.setAttribute('role', 'menu');
    el.hidden = true;
    document.body.append(el);
    el.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    el.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && !viaKeyboard) scheduleClose(); });
    el.addEventListener('click', onMenuClick);
    el.addEventListener('keydown', (ev) => {
      if (ev.target.id === 'qa-ep' && ev.key === 'Enter') { ev.preventDefault(); confirmEpisode(); }
    });
  }

  function renderMain() {
    const m = mediaOf(id);
    const e = Lib.get(id);
    const bf = !!S.settings.backfill;
    el.innerHTML = `
      <p class="qa-head"><span class="qa-t">${esc(m ? titleOf(m) : 'Anime')}</span>${e ? `<span class="qa-cur">Teraz: ${esc(LSTATUS_PL[e.status])}</span>` : ''}</p>
      ${LIST_STATUSES.slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((st, i) => `
        <button type="button" role="menuitemradio" aria-checked="${e && e.status === st}" class="qa-item st-${st}${e && e.status === st ? ' cur' : ''}" data-qs="${st}">
          <kbd>${i + 1}</kbd><i class="qa-dot" aria-hidden="true"></i><span>${esc(LSTATUS_PL[st])}</span>${st === 'watching' ? `<small>${ICON.chevron}</small>` : ''}
        </button>`).join('')}
      ${e ? `<hr><button type="button" role="menuitem" class="qa-item qa-remove" data-qs="remove">${ICON.x}<span>Usuń z listy</span></button>` : ''}
      ${bf ? '<p class="qa-note"><span class="bf-dot" aria-hidden="true"></span>Tryb uzupełniania: zapis bez daty</p>' : ''}`;
  }
  const ORDER = ['planning', 'watching', 'completed', 'paused', 'dropped'];

  function renderEpisode() {
    const m = mediaOf(id);
    const e = Lib.get(id);
    const total = (m && m.episodes) || null;
    const cur = e ? Lib.cur(e).progress : 0;
    el.innerHTML = `
      <p class="qa-head"><span class="qa-t">${esc(m ? titleOf(m) : 'Anime')}</span><span class="qa-cur">Oglądam</span></p>
      <label class="qa-ep-label" for="qa-ep">Na którym odcinku jesteś?</label>
      <div class="qa-ep">
        <button type="button" class="icon-btn sm" data-ep="-1" aria-label="Mniej">${ICON.minus}</button>
        <input id="qa-ep" type="number" inputmode="numeric" min="0" ${total ? `max="${total}"` : ''} value="${cur}">
        <span class="of num">/ ${total || '?'}</span>
        <button type="button" class="icon-btn sm" data-ep="1" aria-label="Więcej">${ICON.plus}</button>
      </div>
      <div class="qa-ep-actions">
        <button type="button" class="btn sm" data-qs="watching-ok">Zapisz <kbd>Enter</kbd></button>
        <button type="button" class="btn ghost sm" data-qs="watching-skip">${cur ? 'Bez zmiany' : 'Pomiń'}</button>
      </div>`;
    const inp = el.querySelector('#qa-ep');
    inp.focus({ preventScroll: true });
    inp.select();
  }

  function place() {
    const r = anchor.getBoundingClientRect();
    el.style.left = '0px';
    el.style.top = '0px';
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = r.right - w;
    if (left < 8) left = Math.min(r.left, vw - w - 8);
    left = clamp(left, 8, vw - w - 8);
    let top = r.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  function open(a, { keyboard = false } = {}) {
    if (!el) build();
    const aid = Number(a.dataset.add || a.dataset.qmenu);
    if (!aid || !mediaOf(aid)) return;
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if (anchor && anchor !== a) anchor.classList.remove('qa-open');
    anchor = a; id = aid; viaKeyboard = keyboard;
    anchor.classList.add('qa-open');
    anchor.setAttribute('aria-expanded', 'true');
    renderMain();
    el.hidden = false;
    place();
    if (keyboard) { const first = el.querySelector('.qa-item'); if (first) first.focus({ preventScroll: true }); }
  }

  function close({ refocus = false } = {}) {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if (!el || el.hidden) return;
    el.hidden = true;
    if (anchor) {
      anchor.classList.remove('qa-open');
      anchor.setAttribute('aria-expanded', 'false');
      if (refocus && document.contains(anchor)) anchor.focus({ preventScroll: true });
    }
    anchor = null; viaKeyboard = false;
  }
  function scheduleClose() { clearTimeout(closeTimer); closeTimer = setTimeout(() => close(), HOVER_CLOSE); }

  /* ---------- akcje ---------- */
  function apply(status, episode = null) {
    const m = mediaOf(id);
    if (!m) return;
    const had = Lib.get(id);
    if (!had) Lib.add(m, status);
    else if (had.status !== status) Lib.setStatus(id, status);
    if (status === 'watching' && episode != null) {
      const cur = Lib.cur(Lib.get(id)).progress;
      if (episode !== cur) Lib.setProgress(id, episode);
    }
    const e = Lib.get(id);
    const ep = status === 'watching' && e ? ` (odc. ${Lib.cur(e).progress}${Lib.epTotal(e) ? `/${Lib.epTotal(e)}` : ''})` : '';
    const nodate = S.settings.backfill && status !== 'planning' ? ' · bez daty' : '';
    toast(`${had ? 'Zmieniono' : 'Dodano'}: ${titleOf(m)} → ${LSTATUS_PL[(e && e.status) || status]}${ep}${nodate}`, { kind: 'ok' });
    close({ refocus: viaKeyboard });
  }

  function confirmEpisode() {
    const inp = el.querySelector('#qa-ep');
    const m = mediaOf(id);
    let n = Math.max(0, Math.floor(Number(inp.value) || 0));
    if (m && m.episodes) n = Math.min(n, m.episodes);
    apply('watching', n);
  }

  function onMenuClick(ev) {
    const b = ev.target.closest('button');
    if (!b) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (b.dataset.ep) {
      const inp = el.querySelector('#qa-ep');
      const m = mediaOf(id);
      let v = Math.max(0, (Number(inp.value) || 0) + Number(b.dataset.ep));
      if (m && m.episodes) v = Math.min(v, m.episodes);
      inp.value = v;
      return;
    }
    const qs = b.dataset.qs;
    if (!qs) return;
    if (qs === 'remove') {
      const m = mediaOf(id);
      const snap = Lib.remove(id);
      toast(`Usunięto z listy: ${m ? titleOf(m) : ''}`, { action: { label: 'Cofnij', fn: () => Lib.restore(snap) } });
      close();
    } else if (qs === 'watching') {
      clearTimeout(closeTimer);
      renderEpisode();
      place();
    } else if (qs === 'watching-ok') confirmEpisode();
    else if (qs === 'watching-skip') apply('watching', null);
    else apply(qs);
  }

  /* ---------- zdarzenia: najechanie, przytrzymanie, klawiatura ---------- */
  function init() {
    document.addEventListener('pointerover', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      const a = ev.target.closest(ANCHORS);
      if (!a) return;
      clearTimeout(closeTimer);
      if (isOpen() && anchor === a) return;
      clearTimeout(openTimer);
      openTimer = setTimeout(() => { if (a.matches(':hover')) open(a); }, HOVER_OPEN);
    });
    document.addEventListener('pointerout', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      const a = ev.target.closest(ANCHORS);
      if (!a || (ev.relatedTarget && a.contains(ev.relatedTarget))) return;
      clearTimeout(openTimer);
      if (isOpen() && anchor === a && !viaKeyboard) scheduleClose();
    });
    // dotyk: przytrzymanie otwiera menu, zwykłe stuknięcie działa jak klik
    document.addEventListener('pointerdown', (ev) => {
      if (isOpen() && !el.contains(ev.target) && !(anchor && anchor.contains(ev.target))) close();
      if (ev.pointerType === 'mouse') return;
      const a = ev.target.closest(ANCHORS);
      if (!a) return;
      const x = ev.clientX, y = ev.clientY;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => { suppressClickUntil = Date.now() + 700; open(a); if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* */ } }, LONG_PRESS);
      const cancel = (e2) => {
        if (e2.type === 'pointermove' && Math.hypot(e2.clientX - x, e2.clientY - y) < 10) return;
        clearTimeout(pressTimer);
        document.removeEventListener('pointermove', cancel);
        document.removeEventListener('pointerup', cancel);
        document.removeEventListener('pointercancel', cancel);
      };
      document.addEventListener('pointermove', cancel);
      document.addEventListener('pointerup', cancel);
      document.addEventListener('pointercancel', cancel);
    });
    document.addEventListener('contextmenu', (ev) => { if (ev.target.closest(ANCHORS) && Date.now() < suppressClickUntil + 200) ev.preventDefault(); });
    // odznaka statusu: klik otwiera menu (bez najechania, np. na laptopie z touchpadem)
    document.addEventListener('click', (ev) => {
      const q = ev.target.closest('[data-qmenu]');
      if (!q) return;
      ev.preventDefault();
      if (isOpen() && anchor === q) close(); else open(q, { keyboard: ev.detail === 0 });
    });
    document.addEventListener('keydown', (ev) => {
      if (!isOpen()) {
        const a = document.activeElement && document.activeElement.closest && document.activeElement.closest(ANCHORS);
        if (a && (ev.key === 'ArrowDown' || ev.key === 'ContextMenu')) { ev.preventDefault(); open(a, { keyboard: true }); }
        return;
      }
      if (ev.key === 'Escape') { ev.preventDefault(); close({ refocus: true }); return; }
      if (ev.target && ev.target.id === 'qa-ep') return;
      // pisanie w innym polu (np. wyszukiwarce) nie może wybierać statusu
      if (ev.target && ev.target.matches && ev.target.matches('input, textarea, select, [contenteditable]')) return;
      if (/^[1-5]$/.test(ev.key) && !ev.altKey && !ev.ctrlKey && !ev.metaKey && el.querySelector('[data-qs="planning"]')) {
        ev.preventDefault();
        const st = ORDER[Number(ev.key) - 1];
        if (st === 'watching') { renderEpisode(); place(); } else apply(st);
        return;
      }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        const items = $$('.qa-item', el);
        const i = items.indexOf(document.activeElement);
        const next = items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
        if (next) { ev.preventDefault(); next.focus({ preventScroll: true }); }
      }
    });
    window.addEventListener('scroll', () => { if (isOpen()) close(); }, { passive: true });
    window.addEventListener('resize', () => { if (isOpen()) close(); });
    window.addEventListener('hashchange', () => close());
  }

  // klik w „+” po przytrzymaniu na dotyku nie może dodatkowo dodać do Planuję
  const shouldSuppressClick = () => Date.now() < suppressClickUntil;

  return { init, open, close, isOpen, shouldSuppressClick };
})();
