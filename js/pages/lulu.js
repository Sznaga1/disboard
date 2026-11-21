'use strict';
/* ==========================================================================
   Disboard — centrum Lulu (League of Legends)
   Dane: data/lulu.json, budowany co 6 godzin przez GitHub Actions
   (tools/build-lulu.mjs): CommunityDragon (serwer główny i PBE), notatki
   do patchy z leagueoflegends.com i Google News. Obrazki z CommunityDragon.
   Ukryte emotki: S.settings.lulu.hidden (synchronizują się i trafiają do kopii).
   Tylko ta zakładka — nic nie pokazuje się na stronie głównej ani w powiadomieniach.
   ========================================================================== */

const Lulu = (() => {
  const NEW_DAYS = 30;
  const CD = (where) => `https://raw.communitydragon.org/${where === 'pbe' ? 'pbe' : 'latest'}/plugins/rcp-be-lol-game-data/global/default/`;
  let cache = null, cacheAt = 0, inflight = null;

  function load(force = false) {
    if (cache && !force && Date.now() - cacheAt < 10 * 60e3) return Promise.resolve(cache);
    if (inflight) return inflight;
    inflight = fetch('data/lulu.json', { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`Nie udało się wczytać danych o Lulu (HTTP ${r.status}).`); return r.json(); })
      .then((d) => { cache = d; cacheAt = Date.now(); return d; })
      .finally(() => { inflight = null; });
    return inflight;
  }

  const img = (it, p = it.img) => (p ? CD(it.where) + p : '');
  const ts = (s) => (s ? Date.parse(s) || 0 : 0);
  const changedAt = (it) => Math.max(ts(it.first), ts(it.liveAt));
  const isNew = (it) => { const t = changedAt(it); return !!t && Date.now() - t < NEW_DAYS * 86400e3; };
  // najpierw PBE (zapowiedzi), potem od ostatnio wykrytych, na końcu od najwyższego numeru
  const byNewest = (a, b) => ((b.where === 'pbe') - (a.where === 'pbe')) || (changedAt(b) - changedAt(a)) || (b.id - a.id);

  const prefs = () => { if (!S.settings.lulu || typeof S.settings.lulu !== 'object') S.settings.lulu = { hidden: {} }; if (!S.settings.lulu.hidden) S.settings.lulu.hidden = {}; return S.settings.lulu; };
  const isHidden = (id) => !!prefs().hidden[id];
  function setHidden(ids, on) {
    const h = prefs().hidden;
    for (const id of ids) { if (on) h[id] = 1; else delete h[id]; }
    save();
    emit('settings', { lulu: true });
  }

  return { NEW_DAYS, load, img, changedAt, isNew, byNewest, isHidden, setHidden, hiddenCount: () => Object.keys(prefs().hidden).length };
})();

Pages.lulu = (ctx) => {
  ctx.title('Lulu');
  const TABS = [['nowosci', 'Nowości'], ['skiny', 'Skiny i chromy'], ['emotki', 'Emotki'], ['ikony', 'Ikony i totemy'], ['patche', 'Patche i wiadomości']];
  const tab = TABS.some(([k]) => k === ctx.params.tab) ? ctx.params.tab : 'nowosci';
  ctx.el.innerHTML = `<div class="page lulu-page">
    <nav class="tabs" aria-label="Centrum Lulu">${TABS.map(([k, l]) => `<a class="tab${k === tab ? ' on' : ''}" href="#/lulu/${k}"${k === tab ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <div id="lu-out">${UI.skeletonCards(12)}</div></div>`;
  const out = $('#lu-out');
  const go = (force) => Lulu.load(force).then((d) => {
    if (!ctx.alive()) return;
    out.innerHTML = luHead(d) + '<div id="lu-body"></div>';
    const body = $('#lu-body');
    ({ nowosci: luNews, skiny: luSkins, emotki: luEmotes, ikony: luIcons, patche: luPatches })[tab](ctx, d, body);
  }).catch((err) => {
    if (!ctx.alive()) return;
    out.innerHTML = UI.errorBox(err, 'lu-retry');
    const b = $('#lu-retry');
    if (b) b.addEventListener('click', () => { out.innerHTML = UI.skeletonCards(12); go(true); });
  });
  go(false);
};

/* ---------- wspólne ---------- */
function luHead(d) {
  const bad = (d.sources || []).filter((s) => !s.ok);
  return `<div class="lu-head">
    <span class="lu-badge" aria-hidden="true">${ICON.wand}</span>
    <p class="lu-meta">Serwer główny: <b class="num">${esc(d.versions && d.versions.live || '?')}</b> · PBE: <b class="num">${esc(d.versions && d.versions.pbe || '?')}</b>
      · zmiana danych ${esc(relTime(Date.parse(d.updatedAt)))} · śledzę od ${esc(fmtDateShort(Date.parse(d.trackedSince)))}</p>
    ${bad.length ? `<p class="lu-warn">Nie odpowiedziało przy ostatnim sprawdzeniu: ${bad.map((s) => esc(s.name)).join(', ')}. Reszta danych jest aktualna.</p>` : ''}
  </div>`;
}

const LU_KIND = { skin: 'Skin', chroma: 'Chroma', icon: 'Ikona', ward: 'Totem', emote: 'Emotka' };

function luFlags(it) {
  if (it.where === 'pbe') return '<span class="lu-flag pbe" title="Jest na serwerze testowym (PBE), w grze jeszcze nie">PBE</span>';
  if (Lulu.isNew(it)) return `<span class="badge-new" title="${it.liveAt ? 'Trafiło do gry' : 'Pierwszy raz wykryte'} ${esc(fmtDateShort(Lulu.changedAt(it)))}">NOWE</span>`;
  return '';
}

// kafelek do „Nowości”: dowolna rzecz z obrazkiem
function luTile(it, kind) {
  const emote = kind === 'emote';
  const tag = emote ? 'button' : 'div';
  const when = Lulu.changedAt(it);
  return `<${tag} class="lu-tile k-${kind}"${emote ? ` type="button" data-hide="${it.id}" title="${esc(it.name)} — kliknij, żeby ukryć tę emotkę"` : ` title="${esc(it.desc || it.name)}"`}>
    <span class="lu-tile-img">${it.img ? `<img src="${esc(Lulu.img(it))}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
    <span class="lu-tile-name">${esc(it.name)}</span>
    <span class="lu-tile-meta">${LU_KIND[kind]}${when ? ` · ${esc(fmtDateShort(when))}` : ''} ${luFlags(it)}</span>
  </${tag}>`;
}

/* ---------- Nowości ---------- */
function luNews(ctx, d, out) {
  const all = [
    ...d.skins.filter((s) => !s.base).map((it) => [it, 'skin']),
    ...d.chromas.map((it) => [it, 'chroma']),
    ...d.icons.map((it) => [it, 'icon']),
    ...(d.wards || []).map((it) => [it, 'ward']),
    ...d.emotes.filter((e) => !Lulu.isHidden(e.id)).map((it) => [it, 'emote']),
  ];
  const sort = (a, b) => Lulu.byNewest(a[0], b[0]);
  const pbe = all.filter(([it]) => it.where === 'pbe').sort(sort);
  const fresh = all.filter(([it]) => it.where !== 'pbe' && Lulu.isNew(it)).sort(sort);
  const grid = (arr) => `<div class="lu-tiles">${arr.map(([it, k]) => luTile(it, k)).join('')}</div>`;
  const patches = (d.patches || []).filter((p) => p.mentions.length).slice(0, 2);
  const news = (d.news || []).slice(0, 5);
  out.innerHTML = (pbe.length ? UI.section(`Na PBE, wkrótce w grze <span class="count">${pbe.length}</span>`, grid(pbe), { sub: 'Rzeczy z serwera testowego. Zwykle trafiają do gry w ciągu 2–3 tygodni.' }) : '')
    + (fresh.length ? UI.section(`Nowe w grze <span class="count">${fresh.length}</span>`, grid(fresh), { sub: `Wykryte w ostatnich ${Lulu.NEW_DAYS} dniach` }) : '')
    + (!pbe.length && !fresh.length ? UI.empty('Na razie nic nowego', `Serwer główny i PBE sprawdzam co 6 godzin. Gdy pojawi się nowy skin, chroma, ikona, totem albo emotka, zobaczysz to tutaj. Ukryte emotki się tu nie pokazują.`) : '')
    + (patches.length ? UI.section('Lulu w ostatnich notatkach do patchy', patches.map(luPatch).join(''), { more: '#/lulu/patche', moreLabel: 'Wszystkie patche' }) : '')
    + (news.length ? UI.section('Wiadomości', `<div class="news-list">${news.map(luNewsItem).join('')}</div>`, { more: '#/lulu/patche', moreLabel: 'Więcej' }) : '');
  out.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-hide]');
    if (!b) return;
    const id = Number(b.dataset.hide);
    Lulu.setHidden([id], true);
    b.remove();
    toast('Ukryto emotkę.', { action: { label: 'Cofnij', fn: () => { Lulu.setHidden([id], false); luNews(ctx, d, out); } } });
  });
}

/* ---------- Skiny i chromy ---------- */
function luSkins(ctx, d, out) {
  const skins = [...d.skins].sort((a, b) => (a.base ? 1 : 0) - (b.base ? 1 : 0) || (a.where === 'pbe' ? -1 : 0) - (b.where === 'pbe' ? -1 : 0) || b.id - a.id);
  const chromasOf = new Map();
  for (const c of d.chromas) { if (!chromasOf.has(c.skin)) chromasOf.set(c.skin, []); chromasOf.get(c.skin).push(c); }
  const nChroma = d.chromas.length;
  out.innerHTML = `<p class="list-sum">${skins.length} skinów (z podstawowym) i ${nChroma} chrom. Kliknij obrazek, żeby zobaczyć pełną grafikę, a kółko koloru, żeby zobaczyć chromę.</p>
    <div class="lu-skins">${skins.map((s) => {
      const ch = chromasOf.get(s.id) || [];
      const meta = [s.base ? 'Podstawowy' : s.rarity, s.line, s.legacy ? 'Legacy' : ''].filter(Boolean).join(' · ');
      return `<article class="lu-skin${s.where === 'pbe' ? ' is-pbe' : ''}">
        <button class="lu-skin-img" type="button" data-splash="${s.id}" aria-label="Pełna grafika: ${esc(s.name)}">${s.tile ? `<img src="${esc(Lulu.img(s, s.tile))}" alt="" loading="lazy">` : ''}</button>
        <div class="lu-skin-body">
          <h3>${esc(s.name)} ${luFlags(s)}</h3>
          ${meta ? `<p class="lu-skin-meta">${esc(meta)}</p>` : ''}
          ${s.desc ? `<p class="lu-skin-desc">${esc(s.desc)}</p>` : ''}
          ${ch.length ? `<div class="lu-chromas" role="group" aria-label="Chromy">${ch.map((c, i) => {
            const [a, b] = c.colors.length ? c.colors : ['#888', '#888'];
            const nw = c.where === 'pbe' || Lulu.isNew(c);
            return `<button type="button" class="lu-chroma${nw ? ' is-new' : ''}" data-chroma="${s.id}" data-i="${i}" style="--a:${esc(UI.safeColor(a, '#888'))};--b:${esc(UI.safeColor(b || a, '#888'))}" title="${esc(c.name)}${c.where === 'pbe' ? ' (PBE)' : nw ? ' (nowa)' : ''}${c.desc ? ' — ' + esc(c.desc) : ''}" aria-label="${esc(c.name)}"></button>`;
          }).join('')}</div>` : ''}
        </div>
      </article>`;
    }).join('')}</div>`;
  out.addEventListener('click', (ev) => {
    const sp = ev.target.closest('[data-splash]');
    if (sp) {
      const pics = skins.filter((s) => s.splash).map((s) => ({ full: Lulu.img(s, s.splash), label: s.name }));
      const i = pics.findIndex((p, k) => skins.filter((s) => s.splash)[k].id === Number(sp.dataset.splash));
      Lightbox.open(pics, Math.max(0, i));
      return;
    }
    const cb = ev.target.closest('[data-chroma]');
    if (cb) {
      const ch = chromasOf.get(Number(cb.dataset.chroma)) || [];
      Lightbox.open(ch.map((c) => ({ full: Lulu.img(c), label: c.name })), Number(cb.dataset.i) || 0);
    }
  });
}

/* ---------- Emotki: wszystkie z gry, kliknięcie ukrywa ---------- */
function luEmotes(ctx, d, out) {
  const emotes = [...d.emotes].sort(Lulu.byNewest);
  const nLulu = emotes.filter((e) => e.lulu).length;
  let view = 'visible', q = '';
  const undo = []; // [{ ids, hidden }]
  out.innerHTML = `<div class="lu-emo-help">
      <p><b>Kliknij emotkę, żeby zniknęła.</b> Ukryte trafiają do „Ukryte”, tam kliknięcie przywraca. Nowe emotki z gry zawsze się pokażą, nawet jeśli resztę ukryjesz.
      Wybór zapisuje się z listą (synchronizacja i kopie).</p>
    </div>
    <div class="lu-emo-tools">
      <div class="chips" role="group" aria-label="Które emotki pokazać" id="lu-views"></div>
      <label class="field grow lu-emo-q">${ICON.search}<input type="search" id="lu-q" placeholder="Szukaj emotki po nazwie lub opisie" autocomplete="off"></label>
      <div class="btn-row">
        <button class="btn ghost sm" type="button" id="lu-undo" disabled>${ICON.repeat}Cofnij</button>
        <button class="btn ghost sm" type="button" id="lu-bulk"></button>
      </div>
    </div>
    <p class="list-sum" id="lu-sum"></p>
    <div class="lu-emotes" id="lu-grid"></div>`;
  const grid = $('#lu-grid', out);

  const match = (e) => !q || `${e.name} ${e.desc || ''}`.toLowerCase().includes(q);
  const inView = (e, v = view) => {
    const h = Lulu.isHidden(e.id);
    if (v === 'hidden') return h;
    if (h) return false;
    if (v === 'lulu') return e.lulu;
    if (v === 'new') return e.where === 'pbe' || Lulu.isNew(e);
    return true;
  };
  const shown = () => emotes.filter((e) => inView(e) && match(e));

  const renderTools = () => {
    const VIEWS = [['visible', 'Widoczne'], ['lulu', 'Z Lulu'], ['new', 'Nowe i PBE'], ['hidden', 'Ukryte']];
    $('#lu-views', out).innerHTML = VIEWS.map(([k, l]) => `<button type="button" class="chip-btn${k === view ? ' on' : ''}" data-view="${k}" aria-pressed="${k === view}">${l} <span>${emotes.filter((e) => inView(e, k)).length}</span></button>`).join('');
    const n = grid.children.length;
    const bulk = $('#lu-bulk', out);
    bulk.innerHTML = view === 'hidden' ? `${ICON.check}Przywróć pokazane (${NF.format(n)})` : `${ICON.x}Ukryj pokazane (${NF.format(n)})`;
    bulk.disabled = !n;
    $('#lu-undo', out).disabled = !undo.length;
    $('#lu-sum', out).textContent = view === 'hidden'
      ? `Ukrytych: ${NF.format(n)}${q ? ' pasujących do wyszukiwania' : ''}. Kliknij, żeby przywrócić.`
      : `Pokazuję ${NF.format(n)} z ${NF.format(emotes.length)} emotek w grze${nLulu ? ` (z Lulu: ${nLulu})` : ''}. Od najnowszych.`;
  };
  const renderGrid = () => {
    const arr = shown();
    grid.innerHTML = arr.length ? arr.map((e) => `<button type="button" class="lu-emo${e.lulu ? ' is-lulu' : ''}" data-id="${e.id}" title="${esc(e.name)}${e.desc ? ' — ' + esc(e.desc) : ''}">
        <img src="${esc(Lulu.img(e))}" alt="" loading="lazy" width="96" height="96">
        <span class="lu-emo-name">${esc(e.name)}</span>${luFlags(e)}
      </button>`).join('')
      : `<div class="lu-emo-empty">${UI.empty(view === 'hidden' ? 'Nic nie jest ukryte' : 'Brak emotek', q ? 'Żadna emotka nie pasuje do wyszukiwania.' : view === 'hidden' ? 'Kliknij emotkę w „Widoczne”, żeby ją tu przenieść.' : 'Wszystkie emotki z tego widoku są ukryte.')}</div>`;
    renderTools();
  };

  const apply = (ids, hidden, label) => {
    if (!ids.length) return;
    Lulu.setHidden(ids, hidden);
    undo.push({ ids, hidden });
    if (undo.length > 50) undo.shift();
    if (label) toast(label, { action: { label: 'Cofnij', fn: doUndo } });
  };
  const doUndo = () => {
    const u = undo.pop();
    if (!u) return;
    Lulu.setHidden(u.ids, !u.hidden);
    renderGrid();
  };

  grid.addEventListener('click', (ev) => {
    const b = ev.target.closest('.lu-emo');
    if (!b) return;
    const id = Number(b.dataset.id);
    apply([id], view !== 'hidden');
    b.classList.add('gone');
    b.disabled = true;
    // krótka animacja, potem znika z siatki (bez przerysowania całości)
    setTimeout(() => { b.remove(); if (!grid.children.length) renderGrid(); else renderTools(); }, 140);
  });
  $('#lu-views', out).addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-view]');
    if (!b || b.dataset.view === view) return;
    view = b.dataset.view;
    renderGrid();
  });
  let qt = null;
  $('#lu-q', out).addEventListener('input', (ev) => {
    clearTimeout(qt);
    qt = setTimeout(() => { q = ev.target.value.trim().toLowerCase(); renderGrid(); }, 120);
  });
  $('#lu-undo', out).addEventListener('click', doUndo);
  $('#lu-bulk', out).addEventListener('click', () => {
    const ids = shown().map((e) => e.id);
    const hide = view !== 'hidden';
    apply(ids, hide, hide ? `Ukryto ${NF.format(ids.length)} emotek.` : `Przywrócono ${NF.format(ids.length)} emotek.`);
    renderGrid();
  });
  // Ctrl+Z cofa ostatnie ukrycie (poza polem wyszukiwania)
  const onKey = (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z' && !ev.target.closest('input, textarea, [contenteditable]') && undo.length) {
      ev.preventDefault();
      doUndo();
    }
  };
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => document.removeEventListener('keydown', onKey));
  renderGrid();
}

/* ---------- Ikony i totemy ---------- */
function luIcons(ctx, d, out) {
  const icons = [...d.icons].sort(Lulu.byNewest);
  const wards = [...(d.wards || [])].sort(Lulu.byNewest);
  const tiles = (arr) => `<div class="lu-icons">${arr.map((it) => `<figure class="lu-icon" title="${esc(it.desc || it.name)}">
      <img src="${esc(Lulu.img(it))}" alt="" loading="lazy" onerror="this.remove()">
      <figcaption><span>${esc(it.name)}</span><small>${it.year ? `${it.year} ` : ''}${luFlags(it)}</small></figcaption></figure>`).join('')}</div>`;
  out.innerHTML = UI.section(`Ikony przywoływacza <span class="count">${icons.length}</span>`, icons.length ? tiles(icons) : UI.empty('Brak ikon z Lulu'), { sub: 'Wszystkie ikony, w których nazwie lub opisie pada imię Lulu' })
    + UI.section(`Totemy <span class="count">${wards.length}</span>`, wards.length ? tiles(wards) : UI.empty('Na razie nie ma totemu z Lulu', 'Sprawdzam przy każdej aktualizacji. Gdy się pojawi, będzie tutaj i w „Nowościach”.'));
}

/* ---------- Patche i wiadomości ---------- */
function luPatch(p) {
  return `<article class="lu-patch">
    <header><a href="${escUrl(p.url)}" target="_blank" rel="noopener">${esc(p.title)} ${ICON.ext}</a>${p.date ? ` <time class="num">${esc(fmtDateShort(Date.parse(p.date)))}</time>` : ''}</header>
    ${p.mentions.map((m) => `<div class="lu-mention${m.kind === 'balance' ? ' bal' : ''}">
      <p class="lu-mention-h">${m.kind === 'balance' ? 'Zmiany Lulu' : 'Wzmianka'}${m.section ? ` · ${esc(m.section)}` : ''}</p>
      <ul>${m.lines.map((l) => `<li class="${/^•/.test(l) ? 'pt' : /^[QWER] - |^Passive - |^Base Stats/i.test(l) ? 'ab' : ''}">${esc(l.replace(/^•\s*/, ''))}</li>`).join('')}</ul>
    </div>`).join('')}
  </article>`;
}

function luNewsItem(n) {
  return `<article class="news compact"><div class="news-body">
    <div class="news-top">${n.date ? `<time>${esc(fmtDateShort(Date.parse(n.date)))}</time>` : ''}<span class="news-cat">${esc(n.source || '')}</span></div>
    <a class="news-title" href="${escUrl(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
  </div></article>`;
}

function luPatches(ctx, d, out) {
  const withLulu = (d.patches || []).filter((p) => p.mentions.length);
  const without = (d.patches || []).filter((p) => !p.mentions.length);
  out.innerHTML = UI.section('Lulu w notatkach do patchy', (withLulu.length ? withLulu.map(luPatch).join('') : UI.empty('W ostatnich patchach nie ma nic o Lulu'))
      + (without.length ? `<p class="list-sum lu-nolulu">Bez Lulu: ${without.map((p) => `<a href="${escUrl(p.url)}" target="_blank" rel="noopener">${esc(p.patch || p.title)}</a>`).join(', ')}</p>` : ''),
    { sub: `Ostatnie ${(d.patches || []).length} notatek z leagueoflegends.com: zmiany balansu, poprawki błędów i zapowiedzi skinów` })
    + UI.section(`Wiadomości <span class="count">${(d.news || []).length}</span>`, (d.news || []).length ? `<div class="news-list">${d.news.map(luNewsItem).join('')}</div>` : UI.empty('Brak wiadomości'), { sub: 'Artykuły z Lulu w tytule: Google News i leagueoflegends.com' });
}
