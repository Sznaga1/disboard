'use strict';
/* ==========================================================================
   Disboard — wykresy w czystym HTML (ostre napisy, pełna responsywność)
   Słupki: cienkie, zaokrąglone 4px od strony wartości, 2px odstępu,
   siatka stonowana, podpowiedź po najechaniu, tabela danych w <details>.
   ========================================================================== */

const Charts = (() => {
  function niceStep(max, ticks = 4) {
    if (max <= 0) return 1;
    const raw = max / ticks;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    return step;
  }

  let tip = null;
  function tooltip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.hidden = true;
    document.body.append(tip);
    return tip;
  }
  function bindTips(root) {
    const t = tooltip();
    const show = (el, x, y) => {
      t.innerHTML = el.dataset.tip;
      t.hidden = false;
      const r = t.getBoundingClientRect();
      const left = clamp(x - r.width / 2, 8, window.innerWidth - r.width - 8);
      const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
      t.style.transform = `translate(${left}px, ${top}px)`;
    };
    root.addEventListener('pointermove', (ev) => {
      const el = ev.target.closest('[data-tip]');
      if (!el || !root.contains(el)) { t.hidden = true; return; }
      show(el, ev.clientX, ev.clientY);
    });
    root.addEventListener('pointerleave', () => { t.hidden = true; });
    root.addEventListener('focusin', (ev) => {
      const el = ev.target.closest('[data-tip]');
      if (!el) return;
      const r = el.getBoundingClientRect();
      show(el, r.left + r.width / 2, r.top);
    });
    root.addEventListener('focusout', () => { t.hidden = true; });
  }

  function table(rows, headers) {
    return `<details class="viz-table"><summary>Pokaż dane w tabeli</summary>
      <div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
  }

  // Kolumny: data = [{label, value, tip}]
  function columns(el, { data, format = (v) => NF1.format(v), axisFormat, color = 'var(--viz-1)', unitLabel = '', height = 200, empty = 'Brak danych w tym okresie.', table: withTable = true, xHeader = 'Okres', every = 0, minStep = 0 }) {
    const max = Math.max(0, ...data.map((d) => d.value));
    if (!data.length || max <= 0) {
      el.innerHTML = `<div class="viz-empty">${esc(empty)}</div>`;
      return;
    }
    const step = Math.max(minStep, niceStep(max)); // minStep: 1 dla liczebności (bez „0,5 tytułu”)
    const top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
    const af = axisFormat || format;
    const many = data.length > 14;
    // every: pokazuj co n-ty podpis osi X (np. godziny doby)
    const thin = (i) => (every ? i % every !== 0 : many && i % 2 && i !== data.length - 1);
    el.innerHTML = `
      <div class="viz-cols" style="--h:${height}px; --c:${color}" role="img" aria-label="${esc(unitLabel)}">
        <div class="viz-yaxis" aria-hidden="true">${ticks.slice().reverse().map((v) => `<span>${esc(af(v))}</span>`).join('')}</div>
        <div class="viz-plot">
          <div class="viz-grid" aria-hidden="true">${ticks.map((v) => `<i style="bottom:${(v / top) * 100}%"></i>`).join('')}</div>
          <div class="viz-bars" style="grid-template-columns:repeat(${data.length},minmax(0,1fr))">
            ${data.map((d, i) => `
              <div class="viz-col" tabindex="0" data-tip="${esc(`<b>${esc(d.label)}</b><br>${esc(d.tip || format(d.value))}`)}">
                <div class="viz-bar${d.hl ? ' hl' : ''}" style="height:${d.value > 0 ? Math.max(1.5, (d.value / top) * 100) : 0}%"></div>
                <span class="viz-x${thin(i) ? ' thin' : ''}">${esc(d.short || d.label)}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>
      ${withTable ? table(data.map((d) => [d.label, d.tip || format(d.value)]), [xHeader, unitLabel || 'Wartość']) : ''}`;
    bindTips(el);
  }

  // Poziome słupki z bezpośrednimi etykietami: data = [{label, value, text, href}]
  function hbars(el, { data, format = (v) => NF1.format(v), color = 'var(--viz-1)', empty = 'Brak danych.', header = ['Pozycja', 'Wartość'], table: withTable = true, max: fixedMax = null }) {
    // fixedMax: stała skala (np. 100 dla procentów), inaczej względem największej wartości
    const max = fixedMax || Math.max(0, ...data.map((d) => d.value));
    if (!data.length || max <= 0) { el.innerHTML = `<div class="viz-empty">${esc(empty)}</div>`; return; }
    el.innerHTML = `<ol class="viz-hbars" style="--c:${color}">
      ${data.map((d) => `
        <li data-tip="${esc(`<b>${esc(d.label)}</b><br>${esc(d.text || format(d.value))}`)}">
          <div class="viz-hl">${d.href ? `<a href="${esc(d.href)}">${esc(d.label)}</a>` : esc(d.label)}</div>
          <div class="viz-htrack"><div class="viz-hbar" style="width:${Math.max(1, (d.value / max) * 100)}%"></div></div>
          <div class="viz-hv">${esc(d.text || format(d.value))}</div>
        </li>`).join('')}
    </ol>${withTable ? table(data.map((d) => [d.label, d.text || format(d.value)]), header) : ''}`;
    bindTips(el);
  }

  // Pasek skumulowany z legendą i wartościami: data = [{label, value, color}]
  function stack(el, { data, empty = 'Lista jest pusta.', label = 'Podział listy według statusu', format }) {
    const total = data.reduce((a, d) => a + d.value, 0);
    if (!total) { el.innerHTML = `<div class="viz-empty">${esc(empty)}</div>`; return; }
    el.innerHTML = `
      <div class="viz-stack" role="img" aria-label="${esc(label)}">
        ${data.filter((d) => d.value).map((d) => `<div class="viz-seg" style="flex:${d.value};--c:${d.color}" data-tip="${esc(`<b>${esc(d.label)}</b><br>${NF.format(d.value)} (${NF1.format((d.value / total) * 100)}%)`)}"></div>`).join('')}
      </div>
      <ul class="viz-legend">
        ${data.map((d) => `<li><i style="--c:${d.color}"></i><span>${esc(d.label)}</span><b>${esc(format ? format(d.value, total) : NF.format(d.value))}</b></li>`).join('')}
      </ul>`;
    bindTips(el);
  }

  /* Kalendarz aktywności (jak na GitHubie): kolumny = tygodnie, wiersze = dni pon–nd.
     days: Map dayKey → { min, eps }. Progi w minutach są stałe, żeby legenda coś znaczyła. */
  const HM_LEVELS = [[0, 'brak'], [1, 'do 45 min'], [45, 'do 2 godz.'], [120, 'do 4 godz.'], [240, '4 godz. i więcej']];
  const hmLevel = (min) => (min >= 240 ? 4 : min >= 120 ? 3 : min >= 45 ? 2 : min > 0 ? 1 : 0);
  function heatmap(el, { days, weeks = 53, label = 'Kalendarz oglądania' }) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dow = (today.getDay() + 6) % 7;
    const start = new Date(today); start.setDate(today.getDate() - dow - (weeks - 1) * 7);
    const cells = [], months = [];
    let active = 0, total = 0, lastMonth = -1;
    const d = new Date(start);
    for (let w = 0; w < weeks; w++) {
      for (let r = 0; r < 7; r++) {
        if (d > today) { cells.push('<i class="hm-c out"></i>'); }
        else {
          const k = dayKey(d.getTime());
          const v = days.get(k);
          const min = v ? v.min : 0;
          if (min > 0) { active++; total += min; }
          const tip = `<b>${esc(DF.weekday.format(d))} ${d.getFullYear()}</b><br>${min ? `${esc(fmtDuration(min))} · ${v.eps} odc.` : 'nic nie obejrzano'}`;
          cells.push(`<i class="hm-c l${hmLevel(min)}${k === dayKey(Date.now()) ? ' today' : ''}" data-tip="${esc(tip)}"></i>`);
        }
        if (r === 0 && d.getMonth() !== lastMonth && d.getDate() <= 7) { months.push([w, d.getMonth(), d.getFullYear()]); lastMonth = d.getMonth(); }
        d.setDate(d.getDate() + 1);
      }
    }
    const mName = (m, y) => new Date(y, m, 1).toLocaleDateString('pl-PL', { month: 'short' }).replace('.', '');
    const rows = [...days.entries()].filter(([, v]) => v.min > 0).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    el.innerHTML = `<div class="hm-scroll"><div class="hm" style="--w:${weeks}" role="img" aria-label="${esc(`${label}: ${active} aktywnych dni w ostatnich ${weeks} tygodniach, razem ${fmtDuration(total) || '0 minut'}`)}">
        <div class="hm-months" aria-hidden="true">${months.map(([w, m, y]) => `<span style="grid-column:${w + 1} / span ${Math.min(4, weeks - w)}">${esc(mName(m, y))}</span>`).join('')}</div>
        <div class="hm-days" aria-hidden="true"><span>pn</span><span></span><span>śr</span><span></span><span>pt</span><span></span><span>nd</span></div>
        <div class="hm-grid">${cells.join('')}</div>
      </div></div>
      <div class="hm-legend" aria-hidden="true"><span>mniej</span>${HM_LEVELS.map((x, i) => `<i class="hm-c l${i}" title="${esc(x[1])}"></i>`).join('')}<span>więcej</span></div>
      ${rows.length ? table(rows.map(([k, v]) => [fmtDate(new Date(`${k}T12:00:00`).getTime()), `${fmtDuration(v.min)} · ${v.eps} odc.`]), ['Dzień', 'Czas']) : ''}`;
    bindTips(el);
    const sc = el.querySelector('.hm-scroll');
    if (sc) sc.scrollLeft = sc.scrollWidth;
  }

  return { columns, hbars, stack, heatmap };
})();
