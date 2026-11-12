'use strict';
/* ==========================================================================
   Disboard — ekrany: ustawienia, kopie, import
   (dawny js/pages.js; wspólne funkcje w js/pages/common.js)
   ========================================================================== */

/* ==========================================================================
   USTAWIENIA, KOPIE, IMPORT
   ========================================================================== */
Pages.settings = (ctx) => {
  ctx.title('Ustawienia i kopie');

  /* ---------- przeniesienie obejrzeń do przeszłości ---------- */
  const earliest = () => {
    let t = Infinity;
    for (const h of S.history) if ((h.k === 'ep' && !h.past) || ['start', 'finish', 'rewatch'].includes(h.k)) t = Math.min(t, h.t);
    for (const e of Object.values(S.entries)) for (const x of e.sessions) if (!x.past) [x.startedAt, x.finishedAt].forEach((v) => { if (v) t = Math.min(t, v); });
    return Number.isFinite(t) ? t : Date.now();
  };
  const PRESETS = {
    today: () => [startOfDay(Date.now()), Date.now()],
    week: () => [startOfDay(Date.now() - 6 * 86400e3), Date.now()],
    all: () => [startOfDay(earliest()), Date.now()],
  };
  const rs = { from: null, to: null, preset: 'all', off: new Set() };
  const applyPreset = (k) => {
    const [a, b] = PRESETS[k]();
    rs.preset = k;
    rs.from = fromInputDateTime(toInputDateTime(a));
    rs.to = fromInputDateTime(toInputDateTime(b)) + 59999; // cała ostatnia minuta
    rs.off.clear();
  };
  applyPreset('all');

  const resetRows = () => (rs.from != null && rs.to != null && rs.from <= rs.to ? Lib.resetScan(rs.from, rs.to) : null);
  const resetSummary = (rows) => {
    const sel = rows.filter((r) => !rs.off.has(r.id));
    const eps = sel.reduce((a, r) => a + r.eps, 0);
    const mins = sel.reduce((a, r) => a + r.minutes, 0);
    return { sel, html: `Zaznaczone: <b>${sel.length} z ${rows.length}</b> anime · <b>${NF.format(eps)}</b> ${unit(eps, 'episode')} · <b>${esc(mins ? fmtDuration(mins, { short: true }) : '0 min')}</b> trafi do „bez daty”. Łączny czas oglądania się nie zmieni.` };
  };
  const renderLast = () => {
    const host = $('#rs-last');
    if (!host) return;
    const r = S.meta.lastReset;
    host.innerHTML = r ? `<div class="rs-last"><span>Ostatnio przeniesiono ${esc(fmtDateTime(r.t))}: ${nUnit(r.count, 'title')}, ${NF.format(r.eps)} ${unit(r.eps, 'episode')} (zakres ${esc(fmtDateTime(r.from))} – ${esc(fmtDateTime(r.to))}).</span><button class="btn ghost sm" type="button" id="rs-undo">${ICON.repeat}Cofnij</button></div>` : '';
    const u = $('#rs-undo');
    if (u) u.addEventListener('click', () => { if (Lib.undoReset()) { toast('Cofnięto przeniesienie. Daty wróciły na swoje miejsce.', { kind: 'ok' }); renderReset(); renderLast(); } });
  };
  const renderReset = () => {
    const host = $('#rs-host');
    if (!host) return;
    $$('[data-preset]').forEach((b) => b.classList.toggle('on', b.dataset.preset === rs.preset));
    const rows = resetRows();
    if (!rows) { host.innerHTML = '<p class="rs-warn">Początek zakresu musi być wcześniejszy niż jego koniec.</p>'; return; }
    if (!rows.length) {
      host.innerHTML = UI.empty('Brak obejrzeń z datą w tym zakresie', 'Zmień daty albo wybierz „Od początku”. Obejrzenia, którym sam wpisałeś datę, nie są tu brane pod uwagę.');
      return;
    }
    const sum = resetSummary(rows);
    host.innerHTML = `
      <p class="rs-sum" id="rs-sum">${sum.html}</p>
      <div class="rs-tools">
        <button class="btn ghost sm" type="button" id="rs-all">Zaznacz wszystkie</button>
        <button class="btn ghost sm" type="button" id="rs-none">Odznacz wszystkie</button>
        <span class="muted">Odznacz to, co naprawdę oglądałeś w tym czasie.</span>
      </div>
      <div class="table-wrap rs-table"><table>
        <thead><tr><th scope="col"><span class="sr">Zaznacz</span></th><th scope="col">Anime</th><th scope="col" class="num">Odcinki</th><th scope="col" class="num rs-opt">Czas</th><th scope="col" class="rs-opt">Ostatni wpis</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${rs.off.has(r.id) ? 'off' : ''}">
          <td><input type="checkbox" id="rs-c-${r.id}" data-rs="${r.id}" ${rs.off.has(r.id) ? '' : 'checked'}></td>
          <th scope="row"><label for="rs-c-${r.id}" class="rs-anime">${UI.cover(r.e.media, 'xs')}<span>${esc(titleOf(r.e.media))}${r.sessions > 1 ? `<small>${r.sessions} obejrzenia</small>` : ''}</span></label></th>
          <td class="num">${r.eps ? (r.epMin === r.epMax ? `odc. ${r.epMin}` : `${r.eps} <small>(odc. ${r.epMin}–${r.epMax})</small>`) : '<small>tylko daty</small>'}</td>
          <td class="num rs-opt">${r.minutes ? esc(fmtDuration(r.minutes, { short: true })) : '—'}</td>
          <td class="num rs-opt">${esc(fmtDateTime(r.last))}</td>
        </tr>`).join('')}</tbody></table></div>
      <div class="btn-row"><button class="btn" type="button" id="rs-go" ${sum.sel.length ? '' : 'disabled'}>${ICON.history}Przenieś do przeszłości: ${nUnit(sum.sel.length, 'title')}</button></div>`;
    const refreshSum = () => {
      const s2 = resetSummary(rows);
      $('#rs-sum').innerHTML = s2.html;
      const go = $('#rs-go');
      go.disabled = !s2.sel.length;
      go.innerHTML = `${ICON.history}Przenieś do przeszłości: ${nUnit(s2.sel.length, 'title')}`;
    };
    host.querySelector('tbody').addEventListener('change', (ev) => {
      const c = ev.target.closest('[data-rs]');
      if (!c) return;
      const id = Number(c.dataset.rs);
      if (c.checked) rs.off.delete(id); else rs.off.add(id);
      c.closest('tr').classList.toggle('off', !c.checked);
      refreshSum();
    });
    $('#rs-all').addEventListener('click', () => { rs.off.clear(); renderReset(); });
    $('#rs-none').addEventListener('click', () => { rows.forEach((r) => rs.off.add(r.id)); renderReset(); });
    $('#rs-go').addEventListener('click', () => {
      const ids = rows.filter((r) => !rs.off.has(r.id)).map((r) => r.id);
      const res = Lib.resetToPast(rs.from, rs.to, ids);
      if (!res) return;
      toast(`Przeniesiono do przeszłości: ${nUnit(res.count, 'title')}, ${NF.format(res.eps)} ${unit(res.eps, 'episode')}.`, {
        kind: 'ok', action: { label: 'Cofnij', fn: () => { Lib.undoReset(); toast('Cofnięto przeniesienie.', { kind: 'ok' }); renderReset(); renderLast(); } },
      });
      rs.off.clear();
      renderReset();
      renderLast();
    });
  };

  const render = async () => {
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
    const backups = await listBackups();
    if (!ctx.alive()) return;
    const w = S.settings.wait;
    const kinds = [['episode', 'Nowy odcinek oglądanego anime'], ['premiere', 'Premiera lub zmiana daty planowanego anime'], ['sequel', 'Kontynuacja obejrzanego anime (radar)'], ['news', 'Nowa informacja o No Game No Life'], ['merch', 'Nowy merch No Game No Life'], ['change', 'Inne zmiany (koniec emisji, liczba odcinków)']];
    ctx.el.innerHTML = `<div class="page settings">
      ${FX.settingsHtml()}

      <section class="card bf-card">
        <h2 class="card-h">Tryb uzupełniania listy</h2>
        <p class="card-sub">Włącz, gdy dodajesz anime obejrzane dawniej. Odcinki, ukończenia i rewatche zapiszą się wtedy bez daty, więc nie zaśmiecą statystyk z dzisiejszego dnia. Przycisk „+” na okładkach doda tytuł od razu jako Obejrzane.</p>
        <div class="bf-row">
          <label class="switch"><input type="checkbox" id="bf-toggle" ${S.settings.backfill ? 'checked' : ''}><span>Tryb uzupełniania</span></label>
          <span class="muted">Skrót na każdej stronie: <kbd>Alt+U</kbd></span>
        </div>
      </section>

      <section class="card bf-card sf-card">
        <h2 class="card-h">Pomijanie fillerów</h2>
        <p class="card-sub">Plusik przy odcinkach przeskakuje odcinki oznaczone w MyAnimeList jako filler albo recap. Pominięte nie liczą się do czasu oglądania. Fillery obejrzane wcześniej zostają policzone. Dane o fillerach pobierają się same dla oglądanych serii.</p>
        <div class="bf-row">
          <label class="switch"><input type="checkbox" id="sf-toggle" ${S.settings.skipFiller ? 'checked' : ''}><span>Pomijaj fillery</span></label>
          <span class="muted">Skrót na każdej stronie: <kbd>Alt+P</kbd></span>
        </div>
      </section>

      <section class="card" id="rs-card">
        <h2 class="card-h">Przenieś obejrzenia do przeszłości</h2>
        <p class="card-sub">Dla anime dodanych jako obejrzane, zanim był tryb uzupełniania. Odcinki z wybranego okresu tracą datę: znikają z wykresów miesięcznych i z „ostatnio obejrzanych”, ale nadal liczą się do łącznego czasu, liczby odcinków i rewatchy. Statusy, postęp, oceny i notatki zostają bez zmian.</p>
        <div class="rs-range">
          <label class="field"><span class="lbl">Od</span><input type="datetime-local" id="rs-from" value="${toInputDateTime(rs.from)}"></label>
          <label class="field"><span class="lbl">Do</span><input type="datetime-local" id="rs-to" value="${toInputDateTime(rs.to)}"></label>
          <div class="chips rs-presets" role="group" aria-label="Szybki wybór zakresu">
            <button type="button" class="chip-btn" data-preset="today">Dziś</button>
            <button type="button" class="chip-btn" data-preset="week">Ostatnie 7 dni</button>
            <button type="button" class="chip-btn" data-preset="all">Od początku</button>
          </div>
        </div>
        <div id="rs-host"></div>
        <div id="rs-last"></div>
      </section>

      <section class="card">
        <h2 class="card-h">Kopia zapasowa i przenoszenie</h2>
        <p class="card-sub">Lista zapisuje się w tej przeglądarce. Eksport to Twoja polisa: plik JSON odtworzy wszystko, także historię i rewatche.
          ${S.meta.lastExportAt ? `Ostatni eksport: ${esc(fmtDateTime(S.meta.lastExportAt))}.` : '<b>Nie zrobiłeś jeszcze eksportu.</b>'}</p>
        <div class="btn-row">
          <button class="btn" type="button" id="x-json">${ICON.download}Pełna kopia (JSON)</button>
          <button class="btn ghost" type="button" id="x-csv">${ICON.download}Lista do Excela (CSV)</button>
          <button class="btn ghost" type="button" id="x-mal">${ICON.download}Format MyAnimeList (XML)</button>
        </div>
        <h3 class="sub-h">Import</h3>
        <div class="import-grid">
          <label class="drop"><input type="file" id="i-json" accept=".json,application/json"><b>Kopia Disboard (JSON)</b><span>przywrócenie lub scalenie</span></label>
          <label class="drop"><input type="file" id="i-mal" accept=".xml,text/xml,application/xml"><b>Eksport z MyAnimeList (XML)</b><span>myanimelist.net → Export</span></label>
          <label class="drop"><input type="file" id="i-csv" accept=".csv,text/csv"><b>Plik CSV</b><span>kolumny „AniList ID” lub „MAL ID”</span></label>
        </div>
        <div class="field-row"><span class="lbl">Import JSON:</span>
          <label class="radio"><input type="radio" name="i-mode" value="merge" checked> dodaj brakujące pozycje</label>
          <label class="radio"><input type="radio" name="i-mode" value="replace"> zastąp całą bibliotekę</label></div>
        <div id="i-status" class="import-status" role="status"></div>
        <h3 class="sub-h">Automatyczna kopia do folderu na dysku</h3>
        <div id="fb-host"></div>
        <h3 class="sub-h">Automatyczne kopie w przeglądarce</h3>
        <p class="card-sub">Raz na godzinę, do 7 dni wstecz. Chronią przed pomyłką, nie przed wyczyszczeniem danych przeglądarki.</p>
        ${backups.length ? `<ul class="backups">${backups.map((b) => `<li><span>${esc(fmtDateTime(b.t))}${b.label ? ` · ${esc(b.label)}` : ""}</span><span>${nUnit(b.count, 'title')}</span><button class="btn ghost sm" type="button" data-restore="${esc(b.key)}">Przywróć</button></li>`).join('')}</ul>` : '<p class="muted">Jeszcze brak kopii.</p>'}
        <div id="restore-confirm" hidden class="confirm">Przywrócić kopię z <b id="rc-date"></b>? Obecna lista zostanie zastąpiona. <button class="btn danger sm" type="button" id="rc-yes">Przywróć</button> <button class="btn ghost sm" type="button" id="rc-no">Anuluj</button></div>
        <p class="card-sub">Trwała pamięć przeglądarki: <b>${persisted ? 'włączona' : 'niepotwierdzona'}</b>${persisted ? '' : ' <button class="btn ghost sm" type="button" id="persist">Poproś o trwałą pamięć</button>'}</p>
      </section>

      <section class="card">
        <h2 class="card-h">Powiadomienia</h2>
        <p class="card-sub">Zawsze trafiają na dzwonek w aplikacji. Powiadomienia systemowe działają, gdy aplikacja jest otwarta, także w tle na karcie.</p>
        <label class="switch"><input type="checkbox" id="n-sys" ${S.settings.sysNotify && perm === 'granted' ? 'checked' : ''} ${perm === 'unsupported' || perm === 'denied' ? 'disabled' : ''}><span>Powiadomienia systemowe ${perm === 'denied' ? '(zablokowane w przeglądarce)' : perm === 'unsupported' ? '(niedostępne w tej przeglądarce)' : ''}</span></label>
        <fieldset class="checks"><legend class="lbl">Rodzaje</legend>${kinds.map(([k, l]) => `<label class="check"><input type="checkbox" data-kind="${k}" ${S.settings.notifyKinds[k] !== false ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset>
        <button class="btn ghost sm" type="button" id="n-test">Wyślij powiadomienie testowe</button>
      </section>

      <section class="card">
        <h2 class="card-h">Licznik „Jak długo czekam na drugi sezon No Game No Life”</h2>
        <fieldset class="checks">
          <label class="radio"><input type="radio" name="w-mode" value="s1end" ${w.mode !== 'custom' ? 'checked' : ''}> od emisji ostatniego odcinka 1. sezonu (z AniList)</label>
          <label class="radio"><input type="radio" name="w-mode" value="custom" ${w.mode === 'custom' ? 'checked' : ''}> od mojej daty:</label>
          <input type="datetime-local" id="w-custom" value="${w.custom ? new Date(w.custom - new Date(w.custom).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}" aria-label="Data początku czekania">
        </fieldset>
        <label class="switch"><input type="checkbox" id="w-show" ${w.hidden ? '' : 'checked'}><span>Pokazuj licznik w rogu ekranu</span></label>
      </section>

      <section class="card">
        <h2 class="card-h">Wyświetlanie</h2>
        <label class="field"><span class="lbl">Język tytułów</span><select id="s-lang">
          <option value="english" ${S.settings.titleLang === 'english' ? 'selected' : ''}>Angielski (gdy brak: romaji)</option>
          <option value="romaji" ${S.settings.titleLang === 'romaji' ? 'selected' : ''}>Romaji, jak na Shinden i MAL</option>
          <option value="native" ${S.settings.titleLang === 'native' ? 'selected' : ''}>Japoński</option></select></label>
        <label class="switch"><input type="checkbox" id="s-spoil" ${S.settings.hideSpoilers ? 'checked' : ''}><span>Ukrywaj tagi ze spoilerami</span></label>
        <label class="switch"><input type="checkbox" id="s-adult" ${S.settings.adult ? 'checked' : ''}><span>Pokazuj anime 18+ w wyszukiwarce</span></label>
        <p class="src-note">Premiery, harmonogram, zapowiedzi i powiadomienia zawsze pomijają pozycje 18+. Te z Twojej listy liczą się normalnie w statystykach.</p>
        <label class="switch"><input type="checkbox" id="s-tr" ${S.settings.translate ? 'checked' : ''}><span>Tłumacz japońskie wiadomości NGNL na angielski</span></label>
        <div class="tr-status" id="s-tr-status"></div>
      </section>

      <section class="card">
        <h2 class="card-h">Dane z internetu</h2>
        <p class="card-sub">Ostatnie odświeżenie listy: ${S.meta.lastRefresh ? esc(fmtDateTime(S.meta.lastRefresh)) : 'jeszcze nie'}. Emitowane tytuły odświeżają się co 45 min, reszta raz w tygodniu.</p>
        <div class="btn-row">
          <button class="btn ghost" type="button" id="d-refresh">${ICON.refresh}Odśwież całą listę teraz</button>
          <button class="btn ghost" type="button" id="d-clear">Wyczyść pamięć podręczną API</button>
        </div>
        <label class="field"><span class="lbl">Adres feedu RSS z newsami NGNL (JSON)</span><input type="text" id="d-feed" value="${esc(S.settings.feedUrl)}" placeholder="data/ngnl-feed.json"></label>
        <p class="src-note">Feed buduje darmowy workflow GitHub Actions z tego projektu. Instrukcja jest w README.</p>
      </section>

      <section class="card" id="diag">
        <h2 class="card-h">Test połączenia</h2>
        <p class="card-sub">Sprawdza po kolei każde zapytanie do AniList i MyAnimeList. Jeśli coś nie działa, skopiuj wynik i wklej go w rozmowie z Claude.</p>
        <div class="btn-row"><button class="btn" type="button" id="diag-run">${ICON.refresh}Uruchom test</button><button class="btn ghost" type="button" id="diag-copy" hidden>Kopiuj wynik</button></div>
        <ul class="diag" id="diag-out"></ul>
        <p class="diag-verdict" id="diag-verdict" role="status"></p>
        <textarea id="diag-raw" class="diag-raw" rows="6" readonly hidden aria-label="Wynik testu do skopiowania"></textarea>
      </section>

      <section class="card about">
        <h2 class="card-h">O aplikacji</h2>
        <p>Dane o anime pochodzą z <a href="https://anilist.co" target="_blank" rel="noopener">AniList</a>. Newsy, promo i producenci pochodzą z <a href="https://myanimelist.net" target="_blank" rel="noopener">MyAnimeList</a> przez <a href="https://jikan.moe" target="_blank" rel="noopener">Jikan</a>. Aplikacja nie ma własnego serwera: Twoja lista nigdzie nie wychodzi poza tę przeglądarkę.</p>
        <p class="muted">Pozycji na liście: ${Object.keys(S.entries).length} · zdarzeń w historii: ${NF.format(S.history.length)} · rozmiar danych: ${NF1.format(JSON.stringify(S).length / 1024)} kB · zapis: ${storageInfo()}</p>
      </section>
    </div>`;
    FX.bindSettings(ctx.el);
    bind();
    renderFolder();
  };

  const status = (html, kind = '') => { const el = $('#i-status'); if (el) { el.className = `import-status ${kind}`; el.innerHTML = html; } };
  const bind = () => {
    $('#bf-toggle').addEventListener('change', (ev) => Backfill.set(ev.target.checked));
    $('#sf-toggle').addEventListener('change', (ev) => SkipFill.set(ev.target.checked));
    const onRange = () => {
      rs.from = fromInputDateTime($('#rs-from').value);
      const t = fromInputDateTime($('#rs-to').value);
      rs.to = t == null ? null : t + 59999;
      rs.preset = null;
      renderReset();
    };
    $('#rs-from').addEventListener('change', onRange);
    $('#rs-to').addEventListener('change', onRange);
    $$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      applyPreset(b.dataset.preset);
      $('#rs-from').value = toInputDateTime(rs.from);
      $('#rs-to').value = toInputDateTime(rs.to);
      renderReset();
    }));
    renderReset();
    renderLast();
    const renderTr = async () => {
      const box = $('#s-tr-status');
      if (!box) return;
      const stt = await Tr.availability();
      if (!ctx.alive() || !$('#s-tr-status')) return;
      const msg = {
        ready: 'Silnik: tłumacz wbudowany w Chrome. Działa lokalnie, bez limitu.',
        available: 'Silnik: tłumacz wbudowany w Chrome. Działa lokalnie, bez limitu.',
        downloadable: 'Silnik: MyMemory (ok. 5000 znaków dziennie). Chrome może tłumaczyć lokalnie i bez limitu po jednorazowym pobraniu modelu.',
        downloading: 'Chrome pobiera model tłumacza…',
        unsupported: 'Silnik: MyMemory (ok. 5000 znaków dziennie). Ta przeglądarka nie ma wbudowanego tłumacza; ma go Chrome 138+ na komputerze.',
        unavailable: 'Silnik: MyMemory (ok. 5000 znaków dziennie). Tłumacz Chrome jest na tym urządzeniu niedostępny.',
      }[stt] || '';
      box.innerHTML = `<p class="src-note">${esc(msg)}</p>${stt === 'downloadable' ? '<button class="btn ghost sm" type="button" id="s-tr-dl">Pobierz tłumacza Chrome</button>' : ''}`;
      const dl = $('#s-tr-dl');
      if (dl) dl.addEventListener('click', async () => {
        dl.disabled = true;
        try {
          await Tr.enableChrome((p) => { dl.textContent = `Pobieram… ${Math.round(p * 100)}%`; });
          toast('Tłumacz Chrome gotowy.', { kind: 'ok' });
        } catch (err) { toast(err.message, { kind: 'warn', ms: 6000 }); }
        renderTr();
      });
    };
    renderTr();
    $('#s-tr').addEventListener('change', (ev) => {
      S.settings.translate = ev.target.checked;
      save();
      toast(ev.target.checked ? 'Japońskie wiadomości będą tłumaczone na angielski.' : 'Tłumaczenie wiadomości wyłączone.', { kind: 'ok' });
    });
    $('#s-adult').addEventListener('change', (ev) => {
      S.settings.adult = ev.target.checked;
      save();
      toast(ev.target.checked ? 'Wyszukiwarka pokazuje teraz także anime 18+.' : 'Wyszukiwarka ukrywa anime 18+.', { kind: 'ok' });
    });
    $('#x-json').addEventListener('click', () => { IO.exportJSON(); toast('Zapisano pełną kopię JSON.', { kind: 'ok' }); render(); });
    $('#x-csv').addEventListener('click', () => { IO.exportCSV(); toast('Zapisano listę CSV.', { kind: 'ok' }); });
    $('#x-mal').addEventListener('click', () => {
      const r = IO.exportMAL();
      toast(`Wyeksportowano ${r.exported} anime do formatu MAL.${r.skipped ? ` ${r.skipped} bez ID w MAL pominięto.` : ''}`, { kind: 'ok', ms: 6000 });
    });
    const handle = (inputId, fn) => $(inputId).addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      status('Wczytuję plik…');
      try {
        const text = await readFileText(f);
        const r = await fn(text, (msg) => status(esc(msg)));
        status(`${r.replaced ? 'Biblioteka zastąpiona kopią.' : `Dodano ${nUnit(r.added, 'item')}.`}${r.skipped ? ` Pominięto ${r.skipped} (już były na liście).` : ''}${r.missing && r.missing.length ? `<br>Nie znaleziono w AniList: ${r.missing.slice(0, 20).map(esc).join(', ')}${r.missing.length > 20 ? '…' : ''}` : ''}`, 'ok');
      } catch (err) {
        status(esc(err.message), 'bad');
      }
      ev.target.value = '';
    });
    handle('#i-json', (t) => IO.importJSON(t, ($('input[name="i-mode"]:checked') || {}).value || 'merge'));
    handle('#i-mal', (t, p) => IO.importMAL(t, p));
    handle('#i-csv', (t, p) => IO.importCSV(t, p));

    let restoreKey = null;
    $$('[data-restore]').forEach((b) => b.addEventListener('click', () => {
      restoreKey = b.dataset.restore;
      $('#rc-date').textContent = b.parentNode.firstElementChild.textContent;
      $('#restore-confirm').hidden = false;
    }));
    $('#rc-no').addEventListener('click', () => { $('#restore-confirm').hidden = true; });
    $('#rc-yes').addEventListener('click', async () => {
      try { await restoreBackup(restoreKey); toast('Przywrócono kopię.', { kind: 'ok' }); render(); } catch (err) { toast(err.message, { kind: 'error' }); }
    });
    const ps = $('#persist');
    if (ps) ps.addEventListener('click', async () => { const ok = await requestPersistence(); toast(ok ? 'Przeglądarka zgodziła się na trwałą pamięć.' : 'Przeglądarka nie potwierdziła trwałej pamięci. Regularny eksport JSON nadal chroni dane.', { kind: ok ? 'ok' : 'warn', ms: 6000 }); render(); });

    $('#n-sys').addEventListener('change', async (ev) => {
      if (ev.target.checked) {
        const p = await Notification.requestPermission();
        S.settings.sysNotify = p === 'granted';
        if (p !== 'granted') toast('Przeglądarka nie zezwoliła na powiadomienia.', { kind: 'warn' });
      } else S.settings.sysNotify = false;
      save(); render();
    });
    $$('[data-kind]').forEach((c) => c.addEventListener('change', () => { S.settings.notifyKinds[c.dataset.kind] = c.checked; save(); emit('notifs'); }));
    $('#n-test').addEventListener('click', () => {
      Lib.notify({ kind: 'change', title: 'Powiadomienie testowe', body: 'Tak będą wyglądać informacje o nowych odcinkach i premierach.', link: '#/' });
      toast('Wysłano powiadomienie testowe. Sprawdź dzwonek.', { kind: 'ok' });
    });

    $$('input[name="w-mode"]').forEach((r) => r.addEventListener('change', () => { S.settings.wait.mode = r.value; save(); Wait.render(); }));
    $('#w-custom').addEventListener('change', (ev) => {
      const v = ev.target.value ? new Date(ev.target.value).getTime() : null;
      S.settings.wait.custom = v; if (v) S.settings.wait.mode = 'custom';
      save(); Wait.render(); render();
    });
    $('#w-show').addEventListener('change', (ev) => { S.settings.wait.hidden = !ev.target.checked; save(); Wait.render(); });

    $('#s-lang').addEventListener('change', (ev) => { S.settings.titleLang = ev.target.value; save(); emit('library', { kind: 'lang' }); toast('Zmieniono język tytułów.', { kind: 'ok' }); });
    $('#s-spoil').addEventListener('change', (ev) => { S.settings.hideSpoilers = ev.target.checked; save(); });
    $('#d-refresh').addEventListener('click', async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Odświeżam…';
      try { const r = await Lib.refresh({ force: true }); toast(r.stale ? 'AniList nie odpowiada. Zostają ostatnie dane.' : `Zaktualizowano ${r.updated} pozycji.`, { kind: r.stale ? 'warn' : 'ok' }); } catch (err) { toast(err.message, { kind: 'error' }); }
      render();
    });
    $('#d-clear').addEventListener('click', async () => { await clearApiCache(); toast('Wyczyszczono pamięć podręczną. Twoja lista została nietknięta.', { kind: 'ok' }); });
    $('#d-feed').addEventListener('change', (ev) => { S.settings.feedUrl = ev.target.value.trim(); save(); toast('Zapisano adres feedu.', { kind: 'ok' }); });

    let diagReport = null;
    const drawDiag = (rows) => {
      $('#diag-out').innerHTML = rows.map((r) => `<li class="${r.ok ? 'ok' : 'bad'}"><b>${esc(r.name)}</b><span>${r.ok ? `działa · ${r.ms} ms` : esc(r.msg)}</span></li>`).join('');
    };
    $('#diag-run').addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      $('#diag-verdict').textContent = 'Testuję… (kilkanaście sekund, AniList pozwala na ograniczoną liczbę zapytań)';
      diagReport = await diagnoseApis(drawDiag);
      if (!ctx.alive()) return;
      const r = diagReport.results;
      const ani = r.filter((x) => x.name.startsWith('AniList'));
      const minimal = ani[0];
      let v;
      if (ani.every((x) => x.ok)) v = 'AniList działa w całości. Jeśli wcześniej był błąd, była to chwilowa awaria po ich stronie.';
      else if (ani.every((x) => !x.ok && x.kind === 'network')) v = 'Brak połączenia z AniList. Sprawdź internet, a także blokadę reklam, antywirusa lub zaporę, które mogą blokować graphql.anilist.co.';
      else if (!minimal.ok && minimal.kind === 'server') v = 'Serwer AniList ma teraz awarię i odrzuca nawet najprostsze zapytanie. To problem po ich stronie. Aplikacja pokazuje zapisane dane i sama spróbuje ponownie.';
      else if (!minimal.ok) v = `AniList odpowiada błędem na każde zapytanie (${minimal.msg}). Skopiuj wynik i wyślij go Claude.`;
      else v = 'AniList działa, ale odrzuca część zapytań aplikacji. Skopiuj wynik i wyślij go Claude, żeby poprawić konkretne zapytanie. Do tego czasu aplikacja używa wersji lekkiej, jeśli ta przechodzi.';
      $('#diag-verdict').textContent = v;
      $('#diag-raw').value = JSON.stringify(diagReport, null, 1);
      $('#diag-copy').hidden = false;
      b.disabled = false;
    });
    $('#diag-copy').addEventListener('click', async () => {
      const raw = $('#diag-raw');
      try { await navigator.clipboard.writeText(raw.value); toast('Skopiowano wynik testu.', { kind: 'ok' }); }
      catch { raw.hidden = false; raw.focus(); raw.select(); toast('Zaznaczyłem wynik. Skopiuj go skrótem Ctrl+C.', { kind: 'warn' }); }
    });
  };
  /* ---------- kopia do folderu na dysku ---------- */
  const renderFolder = async () => {
    const host = $('#fb-host');
    if (!host) return;
    const st = await FolderBackup.status();
    if (!ctx.alive() || !host.isConnected) return;
    if (!st.supported && !st.on) {
      // Brave ma tę funkcję, ale domyślnie wyłączoną; strona nie może jej włączyć sama
      if (navigator.brave) {
        const flag = 'brave://flags/#file-system-access-api';
        host.innerHTML = `<p class="card-sub">Brave domyślnie blokuje zapis do folderów. Włączysz go raz, w ustawieniach Brave:</p>
          <ol class="card-sub fb-steps">
            <li>Skopiuj adres <code>${flag}</code> i wklej go w nowej karcie.</li>
            <li>Przy „File System Access API” ustaw <b>Enabled</b>.</li>
            <li>Kliknij <b>Relaunch</b> na dole strony (Brave uruchomi się ponownie, karty wrócą).</li>
            <li>Wróć tutaj: pojawi się przycisk „Wybierz folder…”.</li>
          </ol>
          <div class="btn-row"><button class="btn" type="button" id="fb-flag">Kopiuj adres ustawienia</button></div>`;
        $('#fb-flag', host).addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(flag); toast('Skopiowano. Wklej adres w nowej karcie Brave.', { kind: 'ok' }); }
          catch { toast(`Skopiuj ręcznie: ${flag}`, { kind: 'warn', ms: 10000 }); }
        });
        return;
      }
      host.innerHTML = '<p class="card-sub">Ta przeglądarka nie potrafi zapisywać do folderu (działa w Chrome i Edge na komputerze, a w Brave po włączeniu jednej opcji). Rób regularnie pełną kopię JSON.</p>';
      return;
    }
    if (!st.on) {
      host.innerHTML = `<p class="card-sub">Aplikacja sama zapisze kopię listy do folderu na dysku: po zmianach (najpóźniej po 2 minutach) i co godzinę, jeden plik na dzień, 30 ostatnich. Przetrwa nawet wyczyszczenie danych przeglądarki.<br>
        W oknie wyboru wskaż folder, w którym ma powstać „${esc(FolderBackup.DIR_NAME)}”, np. <b>D:\\App\\disboard</b>.</p>
        <div class="btn-row"><button class="btn" type="button" id="fb-choose">${ICON.download}Wybierz folder…</button></div>`;
    } else {
      const where = st.dirName === st.rootName ? st.dirName : `${st.rootName}\\${st.dirName}`;
      const state = st.permission !== 'granted'
        ? '<b>czeka na Twoją zgodę</b> (po restarcie przeglądarki może zapytać ponownie)'
        : st.lastAt ? `ostatnia kopia: <b>${esc(fmtDateTime(st.lastAt))}</b> (${esc(st.lastFile)})` : 'jeszcze bez kopii';
      host.innerHTML = `<p class="card-sub">Folder: <b>${esc(where)}</b> · ${state}. Trzymam ${st.keep} ostatnich dni, starsze pliki usuwam sama. Przywracasz je przez Import → Kopia Disboard (JSON).${st.lastError ? `<br>Ostatni błąd: ${esc(st.lastError)}` : ''}</p>
        <div class="btn-row">
          <button class="btn" type="button" id="fb-now">${ICON.download}${st.permission !== 'granted' ? 'Zezwól i zapisz kopię' : 'Zrób kopię teraz'}</button>
          <button class="btn ghost" type="button" id="fb-choose">Zmień folder…</button>
          <button class="btn ghost" type="button" id="fb-off">Wyłącz</button>
        </div>`;
    }
    const choose = $('#fb-choose', host);
    if (choose) choose.addEventListener('click', async () => {
      try {
        const r = await FolderBackup.choose();
        if (r && r.file) { toast(`Kopia do folderu włączona. Zapisano ${r.file}.`, { kind: 'ok', ms: 6000 }); FolderBackup.init(); }
      } catch (err) { toast(err.message, { kind: 'error', ms: 10000 }); }
      renderFolder();
    });
    const now = $('#fb-now', host);
    if (now) now.addEventListener('click', async () => {
      try {
        const r = await FolderBackup.backupNow();
        if (r.needsPermission) toast('Bez zgody przeglądarki nie zapiszę kopii do folderu.', { kind: 'warn' });
        else toast(r.unchanged ? `Kopia jest aktualna (${r.file}).` : `Zapisano ${r.file}.`, { kind: 'ok' });
      } catch (err) { toast(`Nie udało się zapisać kopii: ${err.message}`, { kind: 'error', ms: 8000 }); }
      renderFolder();
    });
    const off = $('#fb-off', host);
    if (off) off.addEventListener('click', async () => {
      await FolderBackup.disconnect();
      toast('Kopia do folderu wyłączona. Pliki w folderze zostały.', { kind: 'ok' });
      renderFolder();
    });
  };
  ctx.on('folder-backup', renderFolder);

  render();
  ctx.on('settings', () => {
    const c = $('#bf-toggle'); if (c) c.checked = !!S.settings.backfill;
    const f = $('#sf-toggle'); if (f) f.checked = !!S.settings.skipFiller;
  });
  // import lub przywrócenie kopii zmienia historię → odśwież podgląd zakresu
  ctx.onLibrary((d) => { if (d && (d.kind === 'import' || d.kind === 'replace')) renderReset(); });
};
