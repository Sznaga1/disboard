'use strict';
/* ==========================================================================
   Disboard — tłumacz wiadomości z japońskiego na angielski
   1) Tłumacz wbudowany w Chrome (Translator API, Chrome 138+ na komputerze):
      działa lokalnie, bez limitu; model pobiera się raz, po kliknięciu.
   2) Zapas: MyMemory (bez konta ok. 5000 znaków dziennie).
   Tłumaczenia trafiają do pamięci podręcznej, więc każdy nagłówek tłumaczy się raz.
   ========================================================================== */

const Tr = (() => {
  const JP = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
  const isJa = (s) => JP.test(String(s || ''));
  const PAIR = { sourceLanguage: 'ja', targetLanguage: 'en' };
  const mem = new Map();
  let chrome = null;
  let chromeState = 'unknown'; // unsupported | unavailable | downloadable | downloading | available | ready
  let mmBlockedUntil = 0;
  let lastEngine = null;
  let mmChain = Promise.resolve();
  const key = (s) => 'tr:ja-en:' + hashStr(s);

  function decodeEntities(s) {
    const t = document.createElement('template');
    t.innerHTML = String(s);
    return (t.content.textContent || '').trim();
  }

  const hasApi = () => !!(self.Translator && typeof self.Translator.availability === 'function');
  const withTimeout = (p, ms, fb) => Promise.race([p, new Promise((r) => setTimeout(() => r(fb), ms))]);

  async function availability() {
    if (!hasApi()) return (chromeState = 'unsupported');
    if (chromeState === 'ready' || chromeState === 'downloading') return chromeState;
    try { chromeState = await withTimeout(self.Translator.availability(PAIR), 4000, 'unavailable'); } catch { chromeState = 'unavailable'; }
    return chromeState;
  }

  // wywoływane z kliknięcia: przeglądarka wymaga gestu, żeby pobrać model
  async function enableChrome(onProgress) {
    if (!hasApi()) throw new Error('Ta przeglądarka nie ma wbudowanego tłumacza. Działa w Chrome 138 lub nowszym na komputerze.');
    chromeState = 'downloading';
    emit('translator', { state: chromeState });
    try {
      chrome = await self.Translator.create({
        ...PAIR,
        monitor(m) { m.addEventListener('downloadprogress', (e) => { if (onProgress) onProgress(e.loaded); }); },
      });
      chromeState = 'ready';
    } catch (e) {
      chromeState = 'unavailable';
      throw new Error('Chrome nie pobrał tłumacza. Aplikacja dalej tłumaczy przez MyMemory.');
    } finally {
      emit('translator', { state: chromeState });
    }
    return chrome;
  }

  async function viaChrome(text) {
    if (!chrome) {
      if (chromeState === 'unknown') await availability();
      if (chromeState !== 'available') return null; // bez pobranego modelu nie tworzymy go w tle
      try { chrome = await withTimeout(self.Translator.create(PAIR), 8000, null); } catch { chrome = null; }
      if (!chrome) { chromeState = 'unavailable'; return null; }
      chromeState = 'ready';
    }
    try { return await withTimeout(chrome.translate(text), 8000, null); } catch { return null; }
  }

  function viaMyMemory(text) {
    // po jednym zapytaniu naraz, z krótką przerwą
    const run = async () => {
      if (Date.now() < mmBlockedUntil) return null;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=ja|en`;
      let res;
      try { res = await fetch(url); } catch { return null; }
      if (res.status === 429) { mmBlockedUntil = Date.now() + 3600e3; return null; }
      if (!res.ok) return null;
      const j = await res.json().catch(() => null);
      const out = j && j.responseData && j.responseData.translatedText;
      if (!out || j.quotaFinished || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) {
        mmBlockedUntil = Date.now() + 6 * 3600e3;
        return null;
      }
      await sleep(150);
      return decodeEntities(out);
    };
    const p = mmChain.then(run);
    mmChain = p.catch(() => null);
    return p;
  }

  async function translate(text) {
    text = String(text || '').trim();
    if (!text || !isJa(text)) return null;
    if (mem.has(text)) return mem.get(text);
    const hit = await IDB.get('cache', key(text));
    if (hit && hit.data) { mem.set(text, hit.data); return hit.data; }
    let out = await viaChrome(text);
    let engine = 'chrome';
    if (!out) { out = await viaMyMemory(text); engine = 'mymemory'; }
    if (!out) return null;
    const val = { t: out, engine };
    lastEngine = engine;
    mem.set(text, val);
    await IDB.set('cache', key(text), { t: Date.now(), data: val });
    return val;
  }

  // Tłumaczy nagłówki i streszczenia listy wiadomości; ustawia it.tr. onUpdate — odśwież widok.
  async function items(list, { onUpdate } = {}) {
    if (!S.settings.translate) return 0;
    let pending = 0, done = 0, last = Date.now();
    for (const it of list) {
      if (it.tr || !(isJa(it.title) || isJa(it.summary))) continue;
      const [t, s] = await Promise.all([translate(it.title), it.summary ? translate(it.summary) : null]);
      if (t || s) {
        it.tr = { title: t ? t.t : null, summary: s ? s.t : null, engine: (t || s).engine };
        pending++; done++;
      }
      if (onUpdate && pending && Date.now() - last > 500) { onUpdate(); pending = 0; last = Date.now(); }
    }
    if (onUpdate && pending) onUpdate();
    return done;
  }

  // natychmiast: tłumaczenia już znane z pamięci (bez czekania na sieć)
  function applyKnown(list) {
    if (!S.settings.translate) return;
    for (const it of list) {
      if (it.tr) continue;
      const t = mem.get(String(it.title || '').trim());
      const s = it.summary ? mem.get(String(it.summary).trim()) : null;
      if (t || s) it.tr = { title: t ? t.t : null, summary: s ? s.t : null, engine: (t || s).engine };
    }
  }

  const engineLabel = (e) => (e === 'chrome' ? 'tłumacz Chrome' : e === 'mymemory' ? 'MyMemory' : 'tłumacz');
  const state = () => ({ chrome: chromeState, lastEngine, mmBlocked: Date.now() < mmBlockedUntil });
  const pageUrl = (url) => `https://translate.google.com/translate?sl=ja&tl=en&u=${encodeURIComponent(url)}`;

  return { isJa, availability, enableChrome, translate, items, applyKnown, engineLabel, state, pageUrl };
})();
