'use strict';
/* Disboard — rozszerzenie, część działająca w tle: zapisuje zmiany z okienka
   (okienko może się zamknąć zaraz po kliknięciu „+1”), co 15 minut sprawdza
   listę i emisję odcinków, ustawia liczbę na ikonce. */
importScripts('core.js', 'sync.js');

let chain = Promise.resolve();
// wszystko po kolei: dwie operacje na liście nigdy nie biegną naraz
const queue = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

async function remember(e) {
  const error = e ? { msg: e.message || String(e), code: e.code || '', at: Date.now() } : null;
  await chrome.storage.local.set({ error });
}

async function refresh({ force = false } = {}) {
  const { auth, lastSync = 0, pending = [] } = await chrome.storage.local.get(['auth', 'lastSync', 'pending']);
  if (!auth) { await Sync.badge(); return; }
  try {
    if (pending.length) await Sync.applyPending();
    else if (force || Date.now() - lastSync > Sync.SYNC_EVERY) await Sync.sync();
    await Sync.refreshAiring(force).catch(() => {});
    await remember(null);
  } catch (e) {
    await remember(e);
  }
  await Sync.badge();
}

async function step(op) {
  const { pending = [] } = await chrome.storage.local.get('pending');
  pending.push({ ...op, key: crypto.randomUUID(), t: Date.now() });
  await chrome.storage.local.set({ pending });
  await Sync.badge();
  return queue(async () => {
    try {
      const results = await Sync.applyPending();
      await remember(null);
      await Sync.badge();
      return { ok: true, results };
    } catch (e) {
      await remember(e);
      await Sync.badge();
      // chwilowy kłopot (internet, przeciążona baza): zmiana czeka i pójdzie przy
      // następnej próbie; brak dostępu albo listy: zmian nie da się zapisać, porzucamy je
      if (!['offline', 'busy', 'fs'].includes(e.code)) {
        await chrome.storage.local.set({ pending: [] });
        await Sync.badge();
      }
      return { ok: false, error: e.message, code: e.code || '' };
    }
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const run = {
    refresh: () => queue(() => refresh({ force: !!msg.force })),
    step: () => step({ id: msg.id, from: msg.from, d: msg.d }),
    signin: () => queue(async () => {
      try {
        await Sync.signIn();
        await remember(null);
        await refresh({ force: true });
        return { ok: true };
      } catch (e) { await remember(e); return { ok: false, error: e.message }; }
    }),
    signout: () => queue(async () => { await Sync.signOut(); await Sync.badge(); return { ok: true }; }),
  }[msg && msg.type];
  if (!run) return false;
  run().then(reply, (e) => reply({ ok: false, error: e.message }));
  return true; // odpowiedź przyjdzie później
});

chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'tick') queue(() => refresh()); });
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 15 });
  queue(() => refresh({ force: true }));
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 15 });
  queue(() => refresh());
});
