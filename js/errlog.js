'use strict';
/* ==========================================================================
   Disboard — dziennik błędów
   Gdy coś się wysypie (błąd w kodzie, nieobsłużona obietnica, ekran, który
   się nie narysował, nieudany zapis), zapisuje szczegóły i pokazuje dymek
   „Coś poszło nie tak”. W Ustawieniach widać ostatnie błędy i przycisk
   „Kopiuj raport” do wklejenia w rozmowie z Claude.
   Dziennik leży w localStorage tej przeglądarki, osobno od listy: nie trafia
   do kopii zapasowych ani do synchronizacji. Ładuje się zaraz po util.js,
   żeby złapać także błędy przy starcie aplikacji.
   ========================================================================== */

const ErrLog = (() => {
  const KEY = 'disboard.errlog.v1';
  const MAX = 50;
  const TOAST_GAP = 20e3; // najwyżej jeden dymek na 20 s, nawet gdy błąd się powtarza
  const KIND_PL = { error: 'błąd', promise: 'błąd w tle', view: 'ekran', save: 'zapis', load: 'wczytywanie', message: 'komunikat' };
  let mem = null; // gdy localStorage nie działa (np. tryb prywatny), dziennik żyje do zamknięcia karty
  let lastToast = 0;

  function read() {
    if (mem) return mem;
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); mem = null; } catch { mem = list; }
  }

  const here = () => (typeof location !== 'undefined' ? location.hash || '#/' : '');
  // ścieżki plików w stosie bez adresu strony: „js/pages/list.js:120:5”
  function shortStack(stack) {
    if (!stack) return '';
    let s = String(stack);
    if (typeof location !== 'undefined' && location.href) {
      const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
      if (base) s = s.split(base).join('');
    }
    return s.split('\n').slice(0, 12).join('\n').slice(0, 2500);
  }

  function describe(err) {
    if (err == null) return { msg: 'Nieznany błąd (brak szczegółów)', stack: '' };
    if (typeof err === 'string') return { msg: err, stack: '' };
    const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
    const msg = err.message ? `${name}${err.message}` : (() => { try { return JSON.stringify(err).slice(0, 300); } catch { return String(err); } })();
    return { msg, stack: shortStack(err.stack) };
  }

  /* Zapisuje błąd. kind: error | promise | view | save | load | message.
     silent: bez dymka (np. gdy aplikacja i tak pokazała własny komunikat). */
  function add(err, { kind = 'error', where = '', silent = false } = {}) {
    const { msg, stack } = describe(err);
    const list = read();
    const t = Date.now();
    const last = list[list.length - 1];
    // ten sam błąd seriami (np. w pętli co sekundę) to jeden wpis z licznikiem
    if (last && last.msg === msg && last.kind === kind && t - last.last < 10 * 60e3) {
      last.n = (last.n || 1) + 1;
      last.last = t;
    } else {
      list.push({ t, last: t, kind, msg: msg.slice(0, 600), stack, where: where || '', at: here(), n: 1 });
      while (list.length > MAX) list.shift();
    }
    write(list);
    if (typeof emit === 'function') { try { emit('errlog'); } catch { /* */ } }
    if (!silent && kind !== 'message') notify();
  }

  function notify() {
    if (typeof toast !== 'function' || Date.now() - lastToast < TOAST_GAP) return;
    lastToast = Date.now();
    toast('Coś poszło nie tak. Szczegóły zapisałem w Ustawieniach, w dzienniku błędów.', {
      kind: 'error', ms: 7000, logged: true,
      action: { label: 'Pokaż', fn: () => { location.hash = '#/ustawienia?bledy'; } },
    });
  }

  // błędy, które nic nie znaczą albo są oczekiwane (brak sieci jest obsługiwany osobno)
  function ignorable(err, msg) {
    if (/ResizeObserver loop/i.test(msg || '')) return true;
    if (err && (err.name === 'AbortError' || (err.kind && ['network', 'rate', 'offline', 'notfound'].includes(err.kind)))) return true;
    return false;
  }

  function onError(ev) {
    const msg = ev.message || (ev.error && ev.error.message) || '';
    if (ignorable(ev.error, msg)) return;
    // „Script error.” bez szczegółów: skrypt z innej domeny (np. rozszerzenie przeglądarki)
    if (!ev.error && /^Script error\.?$/i.test(msg)) { add('Błąd w zewnętrznym skrypcie (bez szczegółów, np. rozszerzenie przeglądarki)', { kind: 'error', silent: true }); return; }
    const err = ev.error || { message: msg, stack: ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : '' };
    add(err, { kind: 'error' });
  }
  function onRejection(ev) {
    const r = ev.reason;
    if (ignorable(r, r && r.message)) return;
    add(r, { kind: 'promise' });
  }

  function list() { return read().slice().reverse(); }
  function clear() { write([]); if (typeof emit === 'function') emit('errlog'); }
  // „Cofnij” po wyczyszczeniu: przywraca wpisy (lista od najnowszego, jak z list())
  function restore(items) {
    const now = read();
    write(items.slice().reverse().concat(now).slice(-MAX));
    if (typeof emit === 'function') emit('errlog');
  }

  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

  // tekst do wklejenia w rozmowie: bez e-maila, notatek i tytułów z listy
  function report(extra = {}) {
    const items = list();
    const lines = [
      'Disboard — raport błędów',
      `Wygenerowano: ${stamp(Date.now())}`,
      typeof location !== 'undefined' && location.pathname ? `Adres: ${location.origin && location.origin !== 'null' ? location.origin : location.protocol}${location.pathname}${here()}` : '',
      typeof navigator !== 'undefined' && navigator.userAgent ? `Przeglądarka: ${navigator.userAgent}` : '',
      ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
      `Błędów w dzienniku: ${items.length}`,
    ].filter(Boolean);
    lines.push('');
    items.forEach((e, i) => {
      lines.push(`[${i + 1}] ${stamp(e.t)} · ${KIND_PL[e.kind] || e.kind}${e.n > 1 ? ` · ${e.n}× (ostatnio ${stamp(e.last)})` : ''} · ekran ${e.at || '?'}${e.where ? ` · ${e.where}` : ''}`);
      lines.push(e.msg);
      if (e.stack) {
        const st = e.stack.split('\n');
        // pierwsza linia stosu to zwykle ten sam komunikat
        if (st[0].includes(e.msg) || e.msg.includes(st[0].replace(/^\w*Error: /, ''))) st.shift();
        if (st.length) lines.push(st.join('\n'));
      }
      lines.push('');
    });
    return lines.join('\n').trim() + '\n';
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
  }

  return { add, list, clear, restore, report, KIND_PL, stamp };
})();
