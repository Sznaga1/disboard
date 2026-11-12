'use strict';
/* ==========================================================================
   Disboard — motywy i „Bajery” (eksperymentalne efekty).
   Wszystko za przełącznikiem w Ustawieniach (skrót Alt+B), każdy efekt osobno.
   Bez bajerów aplikacja wygląda i działa dokładnie jak wcześniej.
   Klasy na <html>: „fx” + „fx-<efekt>” dla włączonych; elementy tworzone przez
   ten moduł mają przedrostek „fxe-”, żeby nie mylić ich z klasami efektów.
   ========================================================================== */

const THEMES = [
  { k: 'disboard', l: 'Disboard', d: 'Atrament, róż Sory, turkus Shiro', c: ['#0c0914', '#141021', '#ff4f8b', '#5fe3e0', '#ffc65c', '#f2eeff'] },
  { k: 'exmachina', l: 'Ex Machina', d: 'Chłodny granat i obwody Schwi', c: ['#060a10', '#0c131d', '#3dbdff', '#b7a2ff', '#ffd37a', '#e7f1ff'] },
  { k: 'flugel', l: 'Flügel', d: 'Śliwka i złota aureola Jibril', c: ['#100710', '#1a0d1a', '#ff7ac4', '#7df0c8', '#ffd98a', '#fff0fb'] },
  { k: 'werebeast', l: 'Werebeast', d: 'Ciepły brąz i bursztyn Izuny', c: ['#0e0906', '#18110c', '#ff8a3d', '#5fd4a3', '#ffd166', '#fff3e6'] },
  { k: 'zero', l: 'Zero', d: 'Popiół wojny, przygaszone okładki', c: ['#0b0b0b', '#141312', '#ee5a4f', '#a3b8cc', '#d9b56e', '#ece6e0'] },
  { k: 'oled', l: 'OLED', d: 'Czysta czerń, oszczędza baterię', c: ['#000000', '#0a090d', '#ff4f8b', '#5fe3e0', '#ffc65c', '#f2eeff'] },
];

// m: efekt ruchu (wyłącza go systemowe „ogranicz ruch”); demo: przycisk „Pokaż”
const FX_LIST = [
  { k: 'vt', g: 'Przejścia', l: 'Płynne przejścia między stronami', d: 'Stara strona odpływa, nowa wjeżdża, zamiast mignąć.', m: 1 },
  { k: 'morph', g: 'Przejścia', l: 'Przelot okładki', d: 'Kliknięta okładka rośnie w nagłówek strony anime, a przy powrocie wraca na miejsce.', m: 1 },
  { k: 'swap', g: 'Przejścia', l: 'Kołowa zmiana motywu', d: 'Nowy motyw rozlewa się kołem od miejsca kliknięcia.', m: 1 },
  { k: 'reveal', g: 'Przejścia', l: 'Wjazd przy przewijaniu', d: 'Karty i sekcje spoza ekranu wjeżdżają, gdy do nich dojedziesz.', m: 1 },
  { k: 'scramble', g: 'Przejścia', l: 'Dekodowane tytuły', d: 'Tytuł strony i nazwa anime „rozszyfrowują się” z katakany.', m: 1 },
  { k: 'tint', g: 'Kolor', l: 'Strona anime w kolorze okładki', d: 'Poświata, pasek postępu i zaznaczenie biorą kolor okładki z AniList.' },
  { k: 'dyn', g: 'Kolor', l: 'Przyciski w kolorze anime', d: 'Na stronie anime przyciski i akcenty przejmują kolor okładki.' },
  { k: 'glow', g: 'Kolor', l: 'Poświata okładek', d: 'Okładka pod kursorem świeci własnym kolorem.' },
  { k: 'aurora', g: 'Kolor', l: 'Zorza w tle', d: 'Powoli dryfujące plamy światła w kolorach motywu.', m: 1 },
  { k: 'grain', g: 'Kolor', l: 'Ziarno filmowe', d: 'Delikatny szum na całym ekranie, jak na taśmie.' },
  { k: 'tilt', g: 'Karty', l: 'Przechył 3D okładek', d: 'Okładka pod kursorem przechyla się w jego stronę.', m: 1 },
  { k: 'holo', g: 'Karty', l: 'Holograficzne ulubione', d: 'Ulubione mają folię jak rzadka karta kolekcjonerska; mieni się za kursorem.' },
  { k: 'shine', g: 'Karty', l: 'Błysk na okładce', d: 'Po najechaniu przez okładkę przechodzi refleks światła.', m: 1 },
  { k: 'spot', g: 'Karty', l: 'Reflektor', d: 'Karty i panele podświetlają się tam, gdzie jest kursor.' },
  { k: 'confetti', g: 'Reakcje', l: 'Figury szachowe przy ukończeniu', d: 'Ukończenie serii wystrzeliwuje figury; 1., 10., 25., 50., 100. ukończone anime to większy pokaz.', m: 1, demo: [['finish', 'Pokaż'], ['milestone', 'Kamień milowy']] },
  { k: 'stars', g: 'Reakcje', l: 'Gwiazdy przy ocenie 10', d: 'Dziesiątka sypie złotymi gwiazdami.', m: 1, demo: [['ten', 'Pokaż']] },
  { k: 'odo', g: 'Reakcje', l: 'Licznik jak odometr', d: 'Po „+1” numer odcinka przewija się w górę, a pasek postępu dopełnia z błyskiem.', m: 1 },
  { k: 'countup', g: 'Reakcje', l: 'Odliczane liczby w statystykach', d: 'Kafelki statystyk liczą od zera, gdy pojawią się na ekranie.', m: 1 },
  { k: 'ripple', g: 'Reakcje', l: 'Fala po kliknięciu', d: 'Przyciski rozchodzą się falą od miejsca kliknięcia.', m: 1 },
  { k: 'progress', g: 'Nawigacja', l: 'Pasek przewinięcia', d: 'Cienki pasek u góry ekranu pokazuje, ile strony już przewinąłeś.' },
  { k: 'parallax', g: 'Nawigacja', l: 'Paralaksa banera', d: 'Baner na stronie anime przesuwa się wolniej niż treść.', m: 1 },
  { k: 'tabs', g: 'Nawigacja', l: 'Przesuwany wskaźnik zakładek', d: 'Podkreślenie aktywnej zakładki przejeżdża do nowej.', m: 1 },
  { k: 'logo', g: 'Nawigacja', l: 'Żywe logo', d: 'Połówki logo obracają się przy najechaniu i przy zmianie strony.', m: 1 },
  { k: 'ring', g: 'NGNL', l: 'Pierścień Sory i Shiro', d: 'Licznik czekania na 2. sezon ma obracającą się obwódkę, a plansza NGNL dryfuje.', m: 1 },
  { k: 'intro', g: 'NGNL', l: 'Intro Disboard', d: 'Szachownica i logo przy pierwszym otwarciu dnia. Kliknięcie pomija.', m: 1, demo: [['intro', 'Pokaż']] },
  { k: 'eggs', g: 'NGNL', l: 'Easter eggi', d: 'Ukryte niespodzianki. Podpowiedź: słowo przysięgi, stary kod z gier i nerwowe klikanie w logo.', demo: [['aschente', 'Aschente'], ['blank', 'Tryb Blank']] },
  { k: 'cursor', g: 'NGNL', l: 'Kursor Disboard', d: 'Własna strzałka w kolorach motywu.' },
];

const FX = (() => {
  const html = document.documentElement;
  const LOOK_KEY = 'disboard.look';
  const INTRO_KEY = 'disboard.fx.intro';
  const rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const DEF = new Map(FX_LIST.map((f) => [f.k, f]));
  const cfg = () => S.settings.fx || { on: false, off: {}, rm: false };
  const master = () => !!cfg().on;
  const motionOK = () => !rmq.matches || !!cfg().rm;
  const vtOK = () => typeof document.startViewTransition === 'function';
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function enabled(k) {
    if (!master()) return false;
    const f = DEF.get(k);
    if (!f || (cfg().off || {})[k]) return false;
    return !(f.m && !motionOK());
  }
  const themeOf = () => THEMES.find((t) => t.k === S.settings.theme) || THEMES[0];

  /* ---------- zastosowanie ustawień ---------- */
  function apply() {
    const t = themeOf();
    if (t.k === 'disboard') html.removeAttribute('data-theme'); else html.setAttribute('data-theme', t.k);
    const want = master() ? ['fx', ...FX_LIST.filter((f) => enabled(f.k)).map((f) => `fx-${f.k}`)] : [];
    [...html.classList].filter((c) => (c === 'fx' || c.startsWith('fx-')) && c !== 'fx-blank' && !c.startsWith('fx-vt-')).forEach((c) => { if (!want.includes(c)) html.classList.remove(c); });
    want.forEach((c) => html.classList.add(c));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t.c[0];
    try { localStorage.setItem(LOOK_KEY, JSON.stringify({ t: t.k, c: want.join(' '), i: t.c[0] })); } catch { /* prywatny tryb */ }
    if (enabled('cursor')) html.style.setProperty('--fxe-cursor', cursorUrl(t)); else html.style.removeProperty('--fxe-cursor');
    $$('#fx-card [data-theme-pick]').forEach((btn) => { const onT = btn.dataset.themePick === t.k; btn.classList.toggle('on', onT); btn.setAttribute('aria-checked', String(onT)); });
    applyTint();
    syncTabs(false);
    onScroll();
  }

  /* ---------- kolory pomocnicze ---------- */
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function hsl(h, s, l) { return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`; }
  // kolor okładki bywa bardzo ciemny albo szary: podnosimy jasność i nasycenie, żeby działał jako akcent
  function accentOf(hex) {
    const [h, s0, l0] = hexToHsl(hex);
    const s = s0 < 0.12 ? s0 : Math.max(0.5, Math.min(0.92, s0));
    const l = Math.max(0.6, Math.min(0.72, l0));
    return { base: hsl(h, s, l), hi: hsl(h, s, Math.min(0.82, l + 0.1)), ink: hsl(h, 0.6, 0.09) };
  }
  const cssVar = (name, el = html) => getComputedStyle(el).getPropertyValue(name).trim();
  const palette = () => {
    const v = document.getElementById('view') || html;
    return ['--sora', '--shiro', '--crown', '--text'].map((p) => cssVar(p, v) || '#fff');
  };

  function cursorUrl(t) {
    const [, , a, b, , txt] = t.c;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><path d="M3 2v19l5.2-4.8 3.6 7.6 3.4-1.6-3.6-7.5H19z" fill="${a}" stroke="${txt}" stroke-width="1.4" stroke-linejoin="round"/><circle cx="20.5" cy="20.5" r="3" fill="${b}" stroke="${txt}" stroke-width="1"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 3 2`;
  }

  /* ---------- przejścia między stronami (View Transitions) ---------- */
  let morphFrom = null;
  let routeInfo = { name: '', params: {} };
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const findCardCover = (id) => $$(`#view :is(.acard, .ecard, .erow)[data-id="${id}"] .cover`).find(inView) || null;

  document.addEventListener('click', (ev) => {
    const a = ev.target.closest && ev.target.closest('a[href^="#/anime/"]');
    if (!a || !enabled('morph') || !vtOK()) { morphFrom = null; return; }
    const holder = a.querySelector('.cover') ? a : a.closest('article, li, .erow, .wo-row, .nx, .hit');
    const cov = holder && holder.querySelector('.cover');
    const m = a.getAttribute('href').match(/^#\/anime\/(\d+)/);
    morphFrom = cov && m && inView(cov) ? { el: cov, id: Number(m[1]) } : null;
  }, true);

  function clearNames() { $$('[style*="view-transition-name"]').forEach((x) => { x.style.viewTransitionName = ''; }); }

  // app.js woła to przy każdej zmianie widoku; paint() rysuje nową stronę
  function navigate(paint, { from = '', to = '', name = '', params = {}, query = null } = {}) {
    const changed = from !== to;
    const post = () => { routeInfo = { name, params }; afterRoute(changed); };
    const want = changed && from && enabled('vt') && vtOK() && !document.hidden && !(query && query.has('typed'));
    if (!want) { morphFrom = null; paint(); post(); return; }
    let hero = null;
    if (enabled('morph')) {
      if (morphFrom && morphFrom.el.isConnected && name === 'anime' && Number(params.id) === morphFrom.id) {
        morphFrom.el.style.viewTransitionName = 'fxe-cover';
        hero = { back: false, id: morphFrom.id };
      } else if (/^anime:/.test(from)) {
        const c = document.querySelector('#view .d-head .cover');
        const id = Number((from.match(/"id":"(\d+)"/) || [])[1]);
        if (c && id && inView(c)) { c.style.viewTransitionName = 'fxe-cover'; hero = { back: true, id }; }
      }
    }
    morphFrom = null;
    // stara strona zniknie za chwilę: litera wpisana w tym momencie nie może trafić do jej pola
    const ae = document.activeElement;
    if (ae && ae !== document.body && document.getElementById('view').contains(ae)) ae.blur();
    let tr;
    try {
      tr = document.startViewTransition(() => {
        paint();
        if (hero) {
          const target = hero.back ? findCardCover(hero.id) : document.querySelector('#view .d-head .cover');
          if (target) target.style.viewTransitionName = 'fxe-cover';
        }
      });
    } catch {
      clearNames(); paint(); post(); return;
    }
    tr.updateCallbackDone.then(post, post);
    tr.finished.then(clearNames, clearNames);
  }

  /* ---------- motyw: kołowe odsłonięcie ---------- */
  function setTheme(k, origin) {
    if (!THEMES.some((t) => t.k === k) || k === themeOf().k) return;
    const doit = () => { S.settings.theme = k; save(); apply(); emit('settings', { theme: k }); };
    if (!enabled('swap') || !vtOK() || document.hidden) { doit(); return; }
    let x = innerWidth / 2, y = innerHeight / 2;
    if (origin && origin.getBoundingClientRect) { const r = origin.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
    const rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    html.classList.add('fx-vt-theme');
    let tr;
    try { tr = document.startViewTransition(doit); } catch { html.classList.remove('fx-vt-theme'); doit(); return; }
    tr.ready.then(() => {
      try {
        html.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${rad}px at ${x}px ${y}px)`] },
          { duration: 700, easing: 'cubic-bezier(.3,.7,.2,1)', pseudoElement: '::view-transition-new(root)' });
      } catch { /* starsza przeglądarka: zwykłe przenikanie */ }
    }).catch(() => {});
    tr.finished.finally(() => html.classList.remove('fx-vt-theme'));
  }

  /* ---------- strona anime w kolorze okładki ---------- */
  function applyTint() {
    const view = document.getElementById('view');
    const root = document.getElementById('d-root');
    const cov = root && root.querySelector('.d-head .cover');
    const raw = cov ? cov.style.getPropertyValue('--cc').trim() : '';
    const valid = /^#[0-9a-f]{6}$/i.test(raw) && raw.toLowerCase() !== '#2a2340';
    const head = root && root.querySelector('.d-head');
    if (head) {
      const e = Lib.get(Number(routeInfo.params && routeInfo.params.id));
      head.classList.toggle('is-fav', !!(e && e.favorite));
    }
    const drop = () => { ['--sora', '--sora-hi', '--sora-ink'].forEach((p) => view && view.style.removeProperty(p)); };
    if (!valid || !(enabled('tint') || enabled('dyn'))) {
      html.style.removeProperty('--tint'); html.removeAttribute('data-tint'); drop();
      return;
    }
    const acc = accentOf(raw);
    html.style.setProperty('--tint', acc.base);
    html.setAttribute('data-tint', '');
    if (enabled('dyn') && view) {
      view.style.setProperty('--sora', acc.base); view.style.setProperty('--sora-hi', acc.hi); view.style.setProperty('--sora-ink', acc.ink);
    } else drop();
  }

  /* ---------- efekty pod kursorem: przechył, holo, reflektor ---------- */
  const TILT_SEL = '.acard-media, .ecard-cover, .d-head .cover.lg';
  const SPOT_SEL = '.card, .ecard, .tracker, .tile:not(.hero), .erow:not(.head), .wo-row';
  let hot = null, lit = null, pe = null, praf = 0;
  const lastDown = { x: innerWidth / 2, y: innerHeight / 3, t: 0 };
  function resetHot() {
    if (!hot) return;
    hot.classList.remove('fxe-hot');
    ['--rx', '--ry', '--mx', '--my'].forEach((p) => hot.style.removeProperty(p));
    hot = null;
  }
  function resetLit() {
    if (!lit) return;
    lit.classList.remove('fxe-lit');
    lit.style.removeProperty('--sx'); lit.style.removeProperty('--sy');
    lit = null;
  }
  function pointerFrame() {
    praf = 0;
    const ev = pe;
    if (!ev) return;
    const t = ev.target instanceof Element ? ev.target : null;
    const tiltOn = (enabled('tilt') || enabled('holo')) && fine.matches;
    const want = tiltOn && t ? t.closest(TILT_SEL) : null;
    if (hot && hot !== want) resetHot();
    if (want) {
      const r = want.getBoundingClientRect();
      const px = clamp01((ev.clientX - r.left) / r.width), py = clamp01((ev.clientY - r.top) / r.height);
      hot = want;
      want.classList.add('fxe-hot');
      want.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
      want.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
      if (enabled('tilt')) {
        want.style.setProperty('--rx', `${((0.5 - py) * 16).toFixed(2)}deg`);
        want.style.setProperty('--ry', `${((px - 0.5) * 18).toFixed(2)}deg`);
      }
    }
    const sp = enabled('spot') && fine.matches && t ? t.closest(SPOT_SEL) : null;
    if (lit && lit !== sp) resetLit();
    if (sp) {
      const r = sp.getBoundingClientRect();
      lit = sp;
      sp.classList.add('fxe-lit');
      sp.style.setProperty('--sx', `${Math.round(ev.clientX - r.left)}px`);
      sp.style.setProperty('--sy', `${Math.round(ev.clientY - r.top)}px`);
    }
  }
  document.addEventListener('pointermove', (ev) => {
    if (!master()) return;
    pe = ev;
    if (!praf) praf = requestAnimationFrame(pointerFrame);
  }, { passive: true });
  document.addEventListener('pointerleave', () => { resetHot(); resetLit(); });
  window.addEventListener('blur', () => { resetHot(); resetLit(); });

  /* ---------- fala po kliknięciu ---------- */
  const RIP_SEL = '.btn, .icon-btn:not(.bell), .chip-btn, .btn-inc, .fav-btn, .rate-toggle, .acard-add, .wo-st, .seg button, .fxe-theme';
  document.addEventListener('pointerdown', (ev) => {
    lastDown.x = ev.clientX; lastDown.y = ev.clientY; lastDown.t = Date.now();
    if (!enabled('ripple') || ev.button !== 0) return;
    const host = ev.target.closest && ev.target.closest(RIP_SEL);
    if (!host || host.disabled) return;
    const r = host.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const dot = document.createElement('span');
    dot.className = 'fxe-ripple';
    dot.style.cssText = `width:${size}px;height:${size}px;left:${ev.clientX - r.left - size / 2}px;top:${ev.clientY - r.top - size / 2}px`;
    if (getComputedStyle(host).position === 'static') host.classList.add('fxe-rel');
    host.classList.add('fxe-rip');
    host.append(dot);
    setTimeout(() => {
      dot.remove();
      if (!host.querySelector('.fxe-ripple')) host.classList.remove('fxe-rip', 'fxe-rel');
    }, 650);
  }, true);

  /* ---------- cząstki: figury szachowe i gwiazdy ---------- */
  const Burst = (() => {
    let cv = null, cx = null, parts = [], raf = 0;
    function resize() {
      if (!cv) return;
      const d = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d);
      cx.setTransform(d, 0, 0, d, 0, 0);
    }
    function ensure() {
      if (cv && cv.isConnected) return;
      cv = document.createElement('canvas');
      cv.className = 'fxe-canvas';
      cv.setAttribute('aria-hidden', 'true');
      document.body.append(cv);
      cx = cv.getContext('2d');
      resize();
    }
    window.addEventListener('resize', resize);
    function fire({ x = innerWidth / 2, y = innerHeight / 2, n = 60, glyphs = '♚♛♜♝♞♟', colors = palette(), speed = 10, size = [16, 30], spread = Math.PI * 2, angle = -Math.PI / 2, gravity = 0.3, life = 2300 } = {}) {
      ensure();
      const now = performance.now();
      for (let i = 0; i < n; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const v = speed * (0.4 + Math.random() * 0.8);
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: glyphs[Math.floor(Math.random() * glyphs.length)], c: colors[i % colors.length], s: size[0] + Math.random() * (size[1] - size[0]), r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.25, grav: gravity, t0: now, life: life * (0.7 + Math.random() * 0.5) });
      }
      if (!raf) raf = requestAnimationFrame(step);
    }
    function step(now) {
      cx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter((p) => now - p.t0 < p.life && p.y < innerHeight + 60);
      for (const p of parts) {
        p.vy += p.grav; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        const k = (now - p.t0) / p.life;
        cx.globalAlpha = k > 0.72 ? Math.max(0, (1 - k) / 0.28) : 1;
        cx.save();
        cx.translate(p.x, p.y); cx.rotate(p.r);
        cx.fillStyle = p.c;
        cx.shadowColor = p.c; cx.shadowBlur = 8;
        cx.font = `${p.s}px "Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", "Apple Symbols", serif`;
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(p.g, 0, 0);
        cx.restore();
      }
      cx.globalAlpha = 1;
      raf = parts.length ? requestAnimationFrame(step) : 0;
      if (!raf) cx.clearRect(0, 0, innerWidth, innerHeight);
    }
    return { fire };
  })();
  const origin = () => (Date.now() - lastDown.t < 4000 ? { x: lastDown.x, y: lastDown.y } : { x: innerWidth / 2, y: innerHeight * 0.45 });

  function overlay(cls, inner, ms, { click = false } = {}) {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = inner;
    document.body.append(el);
    let gone = false;
    const close = () => {
      if (gone) return; gone = true;
      el.classList.add('out');
      setTimeout(() => el.remove(), 450);
      document.removeEventListener('keydown', key, true);
    };
    const key = (ev) => { if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); close(); } };
    if (click) { el.addEventListener('click', close); document.addEventListener('keydown', key, true); }
    setTimeout(close, ms);
    return el;
  }

  function celebrateFinish(count, at = origin()) {
    Burst.fire({ ...at, n: 70, speed: 11 });
    const mile = count === 1 || count === 10 || count === 25 || (count >= 50 && count % 50 === 0) || (count > 10 && count < 50 && count % 10 === 0);
    if (!mile) return;
    const W = innerWidth, H = innerHeight;
    setTimeout(() => {
      Burst.fire({ x: 0, y: H, n: 90, angle: -Math.PI / 3, spread: 0.7, speed: 19, gravity: 0.34, life: 2800 });
      Burst.fire({ x: W, y: H, n: 90, angle: -Math.PI * 2 / 3, spread: 0.7, speed: 19, gravity: 0.34, life: 2800 });
    }, 180);
    overlay('fxe-mile', `<span class="fxe-mile-crown" aria-hidden="true">♛</span><b class="fxe-mile-n">${count}.</b><span class="fxe-mile-t">${count === 1 ? 'pierwsze ukończone anime' : 'ukończone anime'}</span>`, 2900);
  }
  function celebrateTen(at = origin()) {
    Burst.fire({ ...at, n: 46, glyphs: '★✦✧★', colors: [cssVar('--crown'), '#fff4c9', cssVar('--crown')], speed: 8, gravity: 0.16, size: [12, 26], life: 1900 });
  }

  /* ---------- obserwacja listy: ukończenia, dziesiątki, „+1” ---------- */
  const snap = new Map();
  const snapOf = (e) => ({ st: e.status, sc: e.score, p: Lib.cur(e).progress, fav: !!e.favorite });
  function resnap() { snap.clear(); Object.values(S.entries).forEach((e) => snap.set(e.id, snapOf(e))); }
  function onLibrary(d) {
    if (!d || d.kind || !d.id || d.refresh) { resnap(); return; }
    const e = S.entries[d.id];
    const prev = snap.get(d.id);
    if (!e) { snap.delete(d.id); return; }
    const cur = snapOf(e);
    snap.set(d.id, cur);
    if (!prev || !master()) return;
    if (cur.st === 'completed' && prev.st !== 'completed' && !S.settings.backfill && enabled('confetti')) {
      celebrateFinish(Object.values(S.entries).filter((x) => x.status === 'completed').length);
    }
    if (cur.sc === 10 && prev.sc !== 10 && enabled('stars')) celebrateTen();
    if (cur.p > prev.p && enabled('odo')) requestAnimationFrame(() => requestAnimationFrame(() => odometer(e, prev.p, cur.p)));
  }

  function odometer(e, from, to) {
    const id = e.id;
    $$(`.ecard[data-id="${id}"] .ecard-prog-row .num, .acard[data-id="${id}"] .acard-onlist .num, .erow[data-id="${id}"] .erow-prog .num`).forEach((el) => {
      const tn = el.firstChild;
      if (!tn || tn.nodeType !== 3) return;
      const m = tn.data.match(/^(\d+)([\s\S]*)$/);
      if (!m || Number(m[1]) !== to) return;
      const box = document.createElement('span');
      box.className = 'fxe-odo';
      box.innerHTML = `<span class="fxe-odo-in"><span>${from}</span><span>${to}</span></span>`;
      tn.data = m[2];
      el.insertBefore(box, tn);
      setTimeout(() => { if (box.isConnected) box.replaceWith(document.createTextNode(String(to))); }, 750);
    });
    const total = Lib.epTotal(e);
    const bars = $$(`:is(.ecard, .erow)[data-id="${id}"] .pbar`);
    if (routeInfo.name === 'anime' && Number(routeInfo.params.id) === id) {
      const tb = document.querySelector('#d-tracker .pbar');
      if (tb) bars.push(tb);
      const inp = document.getElementById('tr-prog');
      if (inp) { inp.classList.remove('fxe-bump'); void inp.offsetWidth; inp.classList.add('fxe-bump'); }
    }
    bars.forEach((bar) => {
      const i = bar.querySelector('i');
      if (!i) return;
      const target = i.style.width;
      if (total) {
        i.style.transition = 'none';
        i.style.width = `${Math.min(100, (from / total) * 100)}%`;
        void i.offsetWidth;
        i.style.transition = '';
        i.style.width = target;
      }
      bar.classList.remove('fxe-sweep'); void bar.offsetWidth; bar.classList.add('fxe-sweep');
      setTimeout(() => bar.classList.remove('fxe-sweep'), 1100);
    });
  }

  /* ---------- odliczanie liczb w statystykach ---------- */
  const CU_SEL = '#view :is(.tile-v, .nt-v > b, .stat-big b, .stat-units dd)';
  const NUM_RE = /^(\d{1,3}(?:[   ]\d{3})+|\d+)(,\d+)?/;
  let cuIO = null;
  function countUp(el) {
    const tn = el.firstChild;
    if (!tn || tn.nodeType !== 3) return;
    const orig = tn.data;
    const m = orig.match(NUM_RE);
    if (!m) return;
    const dec = m[2] ? m[2].length - 1 : 0;
    const target = Number(m[1].replace(/[   ]/g, '') + (m[2] ? `.${m[2].slice(1)}` : ''));
    if (!target) return;
    const rest = orig.slice(m[0].length);
    if (/\d/.test(rest)) return; // „2 godz. 18 min”: liczenie samych godzin wygląda dziwnie — zostawiamy
    const nf = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const t0 = performance.now(), dur = 900 + Math.min(700, Math.log10(target + 1) * 180);
    const tick = (now) => {
      if (!tn.isConnected) return;
      const k = Math.min(1, (now - t0) / dur);
      const v = target * (1 - (1 - k) ** 3);
      tn.data = k < 1 ? nf.format(v) + rest : orig;
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function scanCountUp() {
    if (!enabled('countup') || !('IntersectionObserver' in window)) return;
    if (!cuIO) {
      cuIO = new IntersectionObserver((ents) => ents.forEach((en) => {
        if (!en.isIntersecting) return;
        cuIO.unobserve(en.target);
        countUp(en.target);
      }), { threshold: 0.4 });
    }
    $$(`${CU_SEL}:not([data-fxc])`).forEach((el) => { el.setAttribute('data-fxc', ''); cuIO.observe(el); });
  }

  /* ---------- wjazd przy przewijaniu ---------- */
  const RV_SEL = '#view :is(.sec, .grid-cards > *, .grid-entries > *, .tiles > *, .ntiles > *, .erows > .erow:not(.head), .news, .wo-row, .tl-it, .stats-grid > *, .settings > .card, .rels > *)';
  let rvIO = null;
  function scanReveal() {
    if (!enabled('reveal') || !('IntersectionObserver' in window)) return;
    if (!rvIO) {
      rvIO = new IntersectionObserver((ents) => {
        let i = 0;
        ents.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target;
          rvIO.unobserve(el);
          el.style.setProperty('--fxd', `${Math.min(i++, 8) * 45}ms`);
          el.classList.add('fxe-rv-in');
          setTimeout(() => { el.classList.remove('fxe-rv', 'fxe-rv-in'); el.style.removeProperty('--fxd'); }, 900);
        });
      }, { rootMargin: '0px 0px -6% 0px' });
    }
    const vh = innerHeight;
    $$(`${RV_SEL}:not([data-fxr])`).forEach((el) => {
      el.setAttribute('data-fxr', '');
      if (el.parentElement && el.parentElement.closest('.fxe-rv')) return;
      if (el.getBoundingClientRect().top < vh * 0.94) return; // widoczne od razu — bez animacji
      el.classList.add('fxe-rv');
      rvIO.observe(el);
    });
  }

  /* ---------- przesuwany wskaźnik zakładek ---------- */
  const inkMem = new Map();
  function syncTabs(animate = true) {
    $$('#view .tabs').forEach((nav) => {
      const key = nav.getAttribute('aria-label') || 'tabs';
      let ink = nav.querySelector(':scope > .fxe-ink');
      if (!enabled('tabs')) { if (ink) ink.remove(); return; }
      const act = nav.querySelector('.tab.on');
      if (!act) { if (ink) ink.remove(); return; }
      const pos = { l: act.offsetLeft + 10, w: Math.max(8, act.offsetWidth - 20) };
      const fresh = !ink;
      if (fresh) {
        ink = document.createElement('span');
        ink.className = 'fxe-ink';
        ink.setAttribute('aria-hidden', 'true');
        nav.append(ink);
      }
      const prev = inkMem.get(key);
      if (fresh && animate && prev && (prev.l !== pos.l || prev.w !== pos.w)) {
        ink.style.transition = 'none';
        ink.style.left = `${prev.l}px`; ink.style.width = `${prev.w}px`;
        void ink.offsetWidth;
        ink.style.transition = '';
      }
      ink.style.left = `${pos.l}px`; ink.style.width = `${pos.w}px`;
      inkMem.set(key, pos);
    });
  }

  /* ---------- dekodowane tytuły ---------- */
  const KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';
  const scrambling = new WeakMap();
  function scramble(el, text = el.textContent) {
    if (!el || !text || !enabled('scramble')) return;
    const prev = scrambling.get(el);
    if (prev && prev.raf) cancelAnimationFrame(prev.raf);
    const t0 = performance.now(), dur = Math.min(900, 260 + text.length * 22);
    const st = { raf: 0, text, written: null };
    scrambling.set(el, st);
    const frame = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const shown = Math.floor(text.length * k);
      let out = text.slice(0, shown);
      for (let i = shown; i < text.length; i++) out += /\s/.test(text[i]) ? text[i] : KANA[Math.floor(Math.random() * KANA.length)];
      st.written = k < 1 ? out : text;
      el.textContent = st.written;
      // po końcu stan zostaje: obserwator rozpozna ostatni zapis i nie zacznie od nowa
      if (k < 1) st.raf = requestAnimationFrame(frame); else st.raf = 0;
    };
    st.raf = requestAnimationFrame(frame);
  }
  const titleEl = document.getElementById('page-title');
  if (titleEl && 'MutationObserver' in window) {
    // obserwator odpala się po fakcie: własne zapisy rozpoznajemy po treści
    new MutationObserver(() => {
      const st = scrambling.get(titleEl);
      const now = titleEl.textContent;
      if (st && (now === st.written || now === st.text)) return;
      if (st && st.raf) cancelAnimationFrame(st.raf);
      scramble(titleEl, now);
    }).observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  /* ---------- przewijanie: pasek postępu i paralaksa ---------- */
  let bar = null, sraf = 0;
  function onScroll() {
    if (sraf) return;
    sraf = requestAnimationFrame(() => {
      sraf = 0;
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'fxe-progress';
        bar.setAttribute('aria-hidden', 'true');
        document.body.append(bar);
      }
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 40 ? clamp01(scrollY / max).toFixed(4) : 0})`;
      const ban = enabled('parallax') ? document.querySelector('#view .d-banner') : null;
      if (ban) ban.style.setProperty('--fxe-py', `${Math.round(Math.min(scrollY, 700) * 0.42)}px`);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { onScroll(); syncTabs(false); });

  /* ---------- po każdej zmianie strony i treści ---------- */
  let flipT = 0;
  function afterRoute(changed) {
    applyTint();
    syncTabs(true);
    onScroll();
    if (changed && enabled('logo')) {
      $$('.brand-mark').forEach((b) => { b.classList.remove('fxe-flip'); void b.getBoundingClientRect(); b.classList.add('fxe-flip'); });
      clearTimeout(flipT);
      flipT = setTimeout(() => $$('.brand-mark').forEach((b) => b.classList.remove('fxe-flip')), 800);
    }
    scanView();
  }
  let dTitleFor = '';
  function scanView() {
    if (!master()) return;
    scanReveal();
    scanCountUp();
    applyTint();
    if (!document.querySelector('#view .tabs > .fxe-ink')) syncTabs(true);
    const dt = document.querySelector('#view .d-title');
    const key = `${routeInfo.name}:${routeInfo.params && routeInfo.params.id}`;
    if (dt && routeInfo.name === 'anime' && dTitleFor !== key) { dTitleFor = key; scramble(dt); }
    if (routeInfo.name !== 'anime') dTitleFor = '';
  }
  let mraf = 0;
  const view = document.getElementById('view');
  if (view && 'MutationObserver' in window) {
    new MutationObserver(() => {
      if (!master() || mraf) return;
      mraf = requestAnimationFrame(() => { mraf = 0; scanView(); });
    }).observe(view, { childList: true, subtree: true });
  }

  /* ---------- intro ---------- */
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function intro(force = false) {
    if (!force && (!enabled('intro') || document.hidden)) return;
    if (!force) {
      try { if (localStorage.getItem(INTRO_KEY) === today()) return; localStorage.setItem(INTRO_KEY, today()); } catch { return; }
    }
    const tiles = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const dx = (c - 3.5) / 3.5, dy = (r - 3.5) / 3.5;
        tiles.push(`<i class="${(r + c) % 2 ? 'b' : 'a'}" style="--d:${(r + c) * 28}ms;--x:${dx.toFixed(2)};--y:${dy.toFixed(2)}"></i>`);
      }
    }
    const mark = (document.querySelector('.brand-mark') || { outerHTML: '' }).outerHTML;
    const el = overlay('fxe-intro', `<div class="fxe-board">${tiles.join('')}</div><div class="fxe-intro-logo">${mark}<b>Disboard</b><small>plansza gotowa</small></div>`, 2100, { click: true });
    setTimeout(() => el.classList.add('go'), 1350);
  }

  /* ---------- easter eggi ---------- */
  function aschente() {
    const word = 'ASCHENTE'.split('').map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('');
    overlay('fxe-egg', `<div class="fxe-egg-ring" aria-hidden="true"></div><p class="fxe-egg-word" aria-label="Aschente">${word}</p><p class="fxe-egg-sub">Przysięga złożona. Niech gra się zacznie.</p>`, 3600, { click: true });
    const W = innerWidth, H = innerHeight;
    setTimeout(() => Burst.fire({ x: W / 2, y: H / 2, n: 110, glyphs: '♔♕♖♗♘♙♚♛♜♝♞♟', speed: 15, gravity: 0.22, life: 3000 }), 380);
  }
  function blank(force) {
    const onNow = force == null ? !html.classList.contains('fx-blank') : force;
    html.classList.toggle('fx-blank', onNow);
    let crt = document.querySelector('.fxe-crt');
    if (onNow && !crt) { crt = document.createElement('div'); crt.className = 'fxe-crt'; crt.setAttribute('aria-hidden', 'true'); document.body.append(crt); }
    if (!onNow && crt) crt.remove();
    toast(onNow ? '【　】 Tryb Blank włączony. Ten sam kod wyłącza.' : 'Tryb Blank wyłączony.', { kind: 'ok', ms: 3200 });
  }
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let typed = '', kpos = 0, from = [];
  window.addEventListener('keydown', (ev) => {
    if (!enabled('eggs') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key && ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    kpos = k === KONAMI[kpos] ? kpos + 1 : (k === KONAMI[0] ? 1 : 0);
    if (kpos === KONAMI.length) { kpos = 0; blank(); return; }
    if (!k || k.length !== 1) return;
    typed = (typed + k).slice(-12);
    from = from.concat(location.hash).slice(-12);
    if (!typed.endsWith('aschente')) return;
    const start = from[from.length - 8] || '';
    typed = ''; from = [];
    aschente();
    // litery trafiły do wyszukiwarki (pisanie w dowolnym miejscu) — sprzątamy i wracamy tam, gdzie zacząłeś
    setTimeout(() => {
      const inp = document.getElementById('s-q');
      if (inp && /aschente$/i.test(inp.value)) {
        inp.value = inp.value.replace(/aschente$/i, '');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        if (!inp.value && start && !/^#\/szukaj/.test(start)) location.hash = start;
      }
    }, 60);
  }, true);
  let logoHits = [];
  document.addEventListener('click', (ev) => {
    if (!enabled('eggs') || !ev.target.closest || !ev.target.closest('.brand-mark')) return;
    const now = Date.now();
    logoHits = logoHits.filter((t) => now - t < 2500).concat(now);
    if (logoHits.length >= 5) {
      logoHits = [];
      ev.preventDefault();
      const r = ev.target.closest('.brand-mark').getBoundingClientRect();
      Burst.fire({ x: r.left + r.width / 2, y: r.top + r.height / 2, n: 60, glyphs: '♚♔', speed: 12, gravity: 0.3 });
      toast('Szach i mat.', { kind: 'ok', ms: 2200 });
    }
  }, true);

  /* ---------- ustawienia ---------- */
  function set(k, v) { S.settings.fx.off = S.settings.fx.off || {}; if (v) delete S.settings.fx.off[k]; else S.settings.fx.off[k] = true; save(); apply(); emit('settings', { fx: k }); }
  function setMaster(v, { silent = true } = {}) {
    S.settings.fx.on = !!v;
    save();
    apply();
    emit('settings', { fx: 'master' });
    if (!silent) toast(v ? 'Bajery włączone. Alt+B wyłącza, a pojedyncze efekty są w Ustawieniach.' : 'Bajery wyłączone. Alt+B włącza je z powrotem.', { kind: 'ok', ms: 3200 });
    if (v) scanView();
  }

  function settingsHtml() {
    const t = themeOf().k;
    const c = cfg();
    const groups = [...new Set(FX_LIST.map((f) => f.g))];
    const rmNote = rmq.matches ? `<p class="fxe-rm">Twój system prosi o ograniczenie animacji, więc efekty ruchu są wyłączone.
        <label class="check"><input type="checkbox" id="fx-rm" ${c.rm ? 'checked' : ''}> Mimo to pokazuj animacje w Disboardzie</label></p>` : '';
    return `<section class="card fxe-card" id="fx-card">
      <h2 class="card-h">Wygląd i bajery</h2>
      <p class="card-sub">Motyw zmienia kolory całej aplikacji. Bajery to eksperymentalne animacje i efekty: włącz, przejrzyj i zdecyduj, co zostaje. Każdy efekt da się wyłączyć osobno.</p>
      <div class="fxe-themes" role="radiogroup" aria-label="Motyw">${THEMES.map((th) => `
        <button type="button" class="fxe-theme${th.k === t ? ' on' : ''}" role="radio" aria-checked="${th.k === t}" data-theme-pick="${th.k}"
          style="--p0:${th.c[0]};--p1:${th.c[1]};--p2:${th.c[2]};--p3:${th.c[3]};--p4:${th.c[4]};--p5:${th.c[5]}">
          <span class="fxe-pv" aria-hidden="true"><span class="fxe-pv-card"><i></i><span><b></b><em></em><u></u></span></span><span class="fxe-pv-dots"><i></i><i></i><i></i></span></span>
          <span class="fxe-theme-n">${esc(th.l)}</span><span class="fxe-theme-d">${esc(th.d)}</span>
        </button>`).join('')}
      </div>
      <div class="bf-row fxe-master">
        <label class="switch"><input type="checkbox" id="fx-on" ${c.on ? 'checked' : ''}><span>Bajery (eksperymentalne)</span></label>
        <span class="muted">Szybkie porównanie z bajerami i bez nich: <kbd>Alt+B</kbd></span>
      </div>
      ${rmNote}
      <div class="fxe-groups${c.on ? '' : ' off'}">${groups.map((g) => `
        <fieldset class="fxe-group"><legend>${esc(g)}</legend>${FX_LIST.filter((f) => f.g === g).map((f) => `
          <div class="fxe-item">
            <label><input type="checkbox" data-fx="${f.k}" ${(c.off || {})[f.k] ? '' : 'checked'}><span><b>${esc(f.l)}</b><small>${esc(f.d)}</small></span></label>
            ${f.demo ? `<span class="fxe-demos">${f.demo.map(([k, l]) => `<button type="button" class="btn ghost sm" data-fx-demo="${k}">${esc(l)}</button>`).join('')}</span>` : ''}
          </div>`).join('')}
        </fieldset>`).join('')}
      </div>
      <div class="btn-row">
        <button class="btn ghost sm" type="button" data-fx-all="1">Zaznacz wszystkie efekty</button>
        <button class="btn ghost sm" type="button" data-fx-all="0">Odznacz wszystkie</button>
      </div>
    </section>`;
  }
  function demo(k, btn) {
    const r = btn.getBoundingClientRect();
    const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    if (k === 'finish') Burst.fire({ ...at, n: 70, speed: 11 });
    else if (k === 'milestone') celebrateFinish(50, at);
    else if (k === 'ten') celebrateTen(at);
    else if (k === 'intro') intro(true);
    else if (k === 'aschente') aschente();
    else if (k === 'blank') blank();
  }
  function bindSettings(root) {
    const card = root.querySelector('#fx-card');
    if (!card) return;
    const rerender = () => {
      const fresh = document.createElement('div');
      fresh.innerHTML = settingsHtml();
      const f = document.activeElement && document.activeElement.closest('#fx-card') ? (document.activeElement.dataset.fx || document.activeElement.id || document.activeElement.dataset.themePick) : null;
      card.replaceWith(fresh.firstElementChild);
      bindSettings(root);
      if (f) { const el = root.querySelector(`#fx-card [data-fx="${f}"], #fx-card #${CSS.escape(f)}, #fx-card [data-theme-pick="${f}"]`); if (el) el.focus({ preventScroll: true }); }
    };
    card.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.id === 'fx-on') { setMaster(t.checked); rerender(); } else if (t.id === 'fx-rm') { S.settings.fx.rm = t.checked; save(); apply(); rerender(); } else if (t.dataset.fx) set(t.dataset.fx, t.checked);
    });
    card.addEventListener('click', (ev) => {
      const th = ev.target.closest('[data-theme-pick]');
      if (th) { setTheme(th.dataset.themePick, th); return; }
      const d = ev.target.closest('[data-fx-demo]');
      if (d) { demo(d.dataset.fxDemo, d); return; }
      const all = ev.target.closest('[data-fx-all]');
      if (all) { S.settings.fx.off = all.dataset.fxAll === '1' ? {} : Object.fromEntries(FX_LIST.map((f) => [f.k, true])); save(); apply(); rerender(); }
    });
  }

  /* ---------- start ---------- */
  function init() {
    if (!S.settings.fx) S.settings.fx = { on: false, off: {}, rm: false };
    apply();
    resnap();
    on('library', onLibrary);
    on('settings', () => apply());
    if (rmq.addEventListener) rmq.addEventListener('change', apply);
    if (fine.addEventListener) fine.addEventListener('change', apply);
    document.addEventListener('keydown', (ev) => {
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && ev.code === 'KeyB') {
        ev.preventDefault();
        setMaster(!master(), { silent: false });
        const c = document.getElementById('fx-card');
        if (c) { const box = c.querySelector('#fx-on'); if (box) box.checked = master(); c.querySelector('.fxe-groups').classList.toggle('off', !master()); }
      }
    });
    setTimeout(() => intro(false), 60);
  }

  return {
    init, apply, navigate, setTheme, settingsHtml, bindSettings, on: enabled, master,
    themes: THEMES, list: FX_LIST, burst: (o) => Burst.fire(o), demo,
  };
})();
