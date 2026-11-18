/*
 * Watcher simulation: runs the shipped background worker in a sandbox with a
 * fake browser (storage, alarms, notifications, tabs) and a fake trade api, so
 * the whole cycle can be checked without a single network request:
 *
 *   add -> same price -> price drop -> listing gone -> expired
 *
 *   node tests/watcher-sim.js
 *
 * It exists because of a real bug: the price was compared as display text, and
 * "3 divine" (the trade row) against "3 x Divine" (the api answer) made every
 * new watcher report a price change on its first check.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;

function ok(value, message) {
  if (!value) throw new Error('FAILED: ' + message);
  passed += 1;
  console.log('ok   ' + message);
}

function eq(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('FAILED: ' + message + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
  }
  passed += 1;
  console.log('ok   ' + message);
}

/* ---------------------------------------------------------------- browser */

function createBrowser() {
  const store = {};
  const alarms = new Map();
  const notifications = [];
  const soundRequests = [];
  const state = { fetchMode: 'available', fetchCalls: 0, discordPosts: [], fetchUrls: [], storageWrites: 0 };

  const localGet = (keys) => Promise.resolve((() => {
    const out = {};
    if (keys == null) return Object.assign(out, store);
    const list = typeof keys === 'string' ? [keys] : (Array.isArray(keys) ? keys : Object.keys(keys));
    list.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
      else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[key] = keys[key];
    });
    return out;
  })());

  const messageListeners = [];
  const chrome = {
    runtime: {
      id: 'sandbox',
      lastError: null,
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onSuspend: { addListener() {} },
      sendMessage: (msg, cb) => {
        if (msg && msg.target === 'ptc-offscreen') soundRequests.push(msg.type);
        if (cb) cb({ ok: true });
        return Promise.resolve({ ok: true });
      },
      getContexts: () => Promise.resolve([]),
      getURL: (p) => 'chrome-extension://sandbox/' + p,
    },
    storage: {
      local: {
        get: localGet,
        set: (obj) => {
          state.storageWrites += 1;
          Object.assign(store, obj);
          return Promise.resolve();
        },
      },
      sync: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      onChanged: { addListener() {} },
    },
    alarms: {
      create: (name, info) => { alarms.set(name, info); },
      get: (name) => Promise.resolve(alarms.get(name) ? { name, ...alarms.get(name) } : undefined),
      clear: (name) => { alarms.delete(name); return Promise.resolve(true); },
      onAlarm: { addListener() {} },
    },
    action: {
      setBadgeText: () => Promise.resolve(),
      setBadgeBackgroundColor: () => Promise.resolve(),
      setTitle: () => Promise.resolve(),
    },
    notifications: {
      create: (id, options) => {
        notifications.push({ id, title: options && options.title });
        return Promise.resolve(id);
      },
      onClicked: { addListener() {} },
    },
    tabs: {
      query: () => Promise.resolve([]),
      create: () => Promise.resolve({ id: 1 }),
      remove: () => Promise.resolve(),
      sendMessage: () => Promise.resolve(null),
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
    },
    permissions: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true) },
    offscreen: { createDocument: (options) => Promise.resolve(options) },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    scripting: { executeScript: () => Promise.resolve([]) },
    windows: { getCurrent: () => Promise.resolve({ id: 1 }) },
  };

  const listing = (price, id) => ({
    result: [{
      id: id || 'listing-1',
      item: { name: 'Skull Song', baseType: 'Sacred Focus', frameType: 2, ilvl: 82 },
      listing: {
        price: price ? { amount: price, currency: 'divine' } : undefined,
        account: { name: 'Numaru5', lastCharacterName: 'Numaru5' },
        whisper: 'hi',
        whisper_token: 'tok',
      },
    }],
  });

  const fetch = async (url, options) => {
    state.fetchCalls += 1;
    state.fetchUrls.push(String(url));
    if (String(url).includes('discord.com/api/webhooks')) {
      state.discordPosts.push(JSON.parse((options && options.body) || '{}'));
      return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
    }
    if (!String(url).includes('/api/trade')) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }
    if (state.fetchMode === 'sold') return { ok: true, status: 200, json: async () => ({ result: [] }) };
    const price = state.fetchMode === 'cheaper' ? 2 : state.fetchMode === 'cheap' ? 30 : 3;
    const fetched = /\/fetch\/([^?]+)/.exec(String(url));
    const ids = fetched ? decodeURIComponent(fetched[1]).split(',').filter(Boolean) : [];
    return { ok: true, status: 200, json: async () => listing(price, ids[0]) };
  };

  const sandbox = {
    chrome, console, fetch, setTimeout, clearTimeout, setInterval, clearInterval,
    AbortController, TextEncoder, TextDecoder, URL, URLSearchParams,
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['ptc-games.js', 'ptc-poe1.js', 'ptc-poe2.js', 'ptc-settings.js', 'ptc-modtext.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  }
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), sandbox, { filename: 'background.js' });

  return {
    store,
    alarms,
    notifications,
    soundRequests,
    state,
    run: (code) => vm.runInContext(code, sandbox),
    dispatch: (message) => new Promise((resolve) => {
      const listener = messageListeners[0];
      if (!listener) { resolve(null); return; }
      listener(message, {}, resolve);
    }),
  };
}

/* ------------------------------------------------------------------- test */

(async () => {
  const browser = createBrowser();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const { run, store, alarms, notifications, state, soundRequests } = browser;
  const watcher = () => (store.watchedItems || [])[0] || {};

  const record = {
    itemId: 'listing-1', game: 'poe2', league: 'Forbidden Rites', queryId: 'H4sIAAAA',
    name: 'Skull Song - Sacred Focus', priceText: '3 divine', priceAmount: 3, priceCurrency: 'divine',
    account: 'Numaru5', ign: 'Numaru5', whisper: 'hi', whisperToken: 'tok',
    item: { name: 'Skull Song', baseType: 'Sacred Focus', frameType: 2, ilvl: 82 },
  };

  const added = await run('handleWatchAdd(' + JSON.stringify(record) + ')');
  ok(added && added.ok, 'the watcher is added');
  eq((store.watchedItems || []).length, 1, 'it is stored');
  ok(alarms.has('ptc-watch-check'), 'the check alarm is scheduled');
  eq(alarms.get('ptc-watch-check').periodInMinutes, 5, 'the alarm follows the watcher interval');

  notifications.length = 0;
  state.fetchMode = 'available';
  const first = await run('checkWatchers(true)');
  eq(first.checked, 1, 'one watcher is checked');
  eq(state.fetchCalls, 1, 'one request per watcher');
  eq(watcher().status, 'available', 'the same price is not a price change');
  eq(watcher().previousPriceText, '', 'no previous price is invented');
  eq(notifications.length, 0, 'no alert without a change');
  eq(soundRequests.length, 0, 'and no sound either');
  ok(!!watcher().lastChecked, 'the check time is recorded');

  notifications.length = 0;
  state.fetchMode = 'cheaper';
  await run('checkWatchers(true)');
  eq(watcher().status, 'price-changed', 'a cheaper listing is a price change');
  eq(watcher().previousPriceText, '3 x Divine', 'the old price is kept');
  eq(watcher().priceText, '2 x Divine', 'the new price is stored');
  eq(notifications.map((n) => n.title), ['Watched item price changed'], 'the user is told once');
  eq(soundRequests, ['ptc:sound'], 'and a sound is played');
  soundRequests.length = 0;

  notifications.length = 0;
  state.fetchMode = 'sold';
  await run('checkWatchers(true)');
  eq(watcher().status, 'sold', 'a listing that is gone is marked sold');
  eq(notifications.map((n) => n.title), ['Watched item sold or removed'], 'the user is told');
  notifications.length = 0;
  await run('checkWatchers(true)');
  eq(notifications.length, 0, 'the sold alert is not repeated');

  const expired = store.watchedItems;
  expired[0].expiresAt = Date.now() - 1000;
  await run('chrome.storage.local.set({ watchedItems: ' + JSON.stringify(expired) + ' })');
  notifications.length = 0;
  await run('checkWatchers(true)');
  eq(watcher().status, 'expired', 'an expired watcher stops');
  eq(watcher().enabled, false, 'and is switched off');
  eq(notifications.map((n) => n.title), ['Watcher expired'], 'the user is told');

  /* A search watch costs a search plus a fetch per cycle, so it has a floor of
     fifteen minutes even when the item watchers are set to one. */
  const searchWatch = (lastChecked) => JSON.stringify([{
    id: 'sw1', name: 'watch', enabled: true, game: 'poe2', league: 'Forbidden Rites',
    queryId: 'not-a-query', lastChecked, seen: { a: 1 }, notified: {},
  }]);
  await run('chrome.storage.local.set({ ptcSearchWatches: ' + searchWatch(Date.now() - 10 * 60000) + ' })');
  const early = await run('checkSearchWatches(false)');
  eq(early.checked, 0, 'a watched search is not checked again before 15 minutes');
  await run('chrome.storage.local.set({ ptcSearchWatches: ' + searchWatch(Date.now() - 20 * 60000) + ' })');
  const due = await run('checkSearchWatches(false)');
  eq(due.checked, 1, 'after 15 minutes it is checked');

  /* ---- target price ---- */
  const cache = {
    'poe2:forbidden rites': {
      game: 'poe2', league: 'Forbidden Rites', primary: 'divine',
      rates: { divine: 1, chaos: 0.6 }, names: {}, fetchedAt: Date.now(),
    },
  };
  const withTarget = (target) => ({
    ...record,
    itemId: 'listing-2',
    priceText: '45 x Divine',
    priceAmount: 45,
    priceCurrency: 'divine',
    targetPrice: target,
    targetCurrency: 'divine',
  });
  const fresh = async (target) => {
    await run('chrome.storage.local.set({ ptcPriceCache: ' + JSON.stringify(cache) + ', watchedItems: [] })');
    await run('handleWatchAdd(' + JSON.stringify(withTarget(target)) + ')');
    state.fetchMode = 'cheap'; /* the listing is back at 30 divine */
    notifications.length = 0;
    await run('checkWatchers(true)');
    return watcher();
  };

  const reached = await fresh(40);
  eq(reached.targetReached, true, 'a listing below the target flips the flag');
  eq(reached.status, 'target-reached', 'and the status says so');
  eq(reached.priceText, '30 x Divine', 'the new price is stored');
  ok(notifications.some((n) => n.title === 'Target price reached'), 'the user is told the target was reached');

  const notReached = await fresh(20);
  eq(notReached.targetReached, false, 'a target below the listing price is not reached');
  ok(!notifications.some((n) => n.title === 'Target price reached'), 'and nothing is announced');

  /* "Delete all saved items" belongs to the Items list, so the gear imported
     from build codes - which lives in PoB Builds - has to survive it. */
  await run('chrome.storage.local.set({ savedItems: ' + JSON.stringify([
    { id: 'listing-a', game: 'poe2', targetOf: '', item: { name: 'Listing' } },
    { id: 'imported-b', game: 'poe2', targetOf: 'col_1', item: { name: 'Imported' } },
  ]) + ' })');
  const cleared = await run('handleClear("poe2", { keepImported: true })');
  eq(cleared.count, 1, 'deleting the saved items keeps the imported gear');
  eq((store.savedItems || []).map((rec) => rec.id), ['imported-b'], 'only the saved listing was deleted');

  const clearedAll = await run('handleClear("poe2", {})');
  eq(clearedAll.count, 0, 'without the flag everything of that game goes');

  /* ---- the build export to Discord ---- */
  const discordSettings = { discordWebhook: 'https://discord.com/api/webhooks/123/abc' };
  const collection = [{ id: 'col_1', name: 'Minion build', game: 'poe2', ascendancy: { ascendancy: 'Infernalist' } }];
  const gearItems = [
    { id: 'g1', game: 'poe2', targetOf: 'col_1', item: { name: 'The Dark Defiler', typeLine: 'Sacred Focus', frameType: 3, ilvl: 84, explicitMods: ['+2 to Level of all Minion Skills', '+80 to maximum Energy Shield'] } },
    { id: 'g2', game: 'poe2', targetOf: 'col_1', item: { name: '', typeLine: 'Expert Keth Raiment', baseType: 'Expert Keth Raiment', frameType: 2, ilvl: 80, explicitMods: ['+90 to maximum Life'] } },
  ];
  await run('chrome.storage.local.set({ ptcSettings: ' + JSON.stringify(discordSettings)
    + ', collections: ' + JSON.stringify(collection)
    + ', savedItems: ' + JSON.stringify(gearItems) + ' })');
  state.discordPosts.length = 0;
  const sentBuild = await run('handleBuildDiscord("col_1")');
  ok(sentBuild && sentBuild.ok, 'the build is sent to Discord' + (sentBuild && sentBuild.error ? ' [' + sentBuild.error + ']' : ''));
  eq(sentBuild.items, 2, 'both items are in the message');
  eq(state.discordPosts.length, 1, 'two items fit in one message');
  const embed = ((state.discordPosts[0] || {}).embeds || [])[0] || {};
  eq(embed.title, 'Minion build', 'the build name is the title');
  eq(embed.author && embed.author.name, 'Infernalist', 'the ascendancy sits above it');
  eq((embed.fields || []).map((field) => field.name), ['The Dark Defiler — Sacred Focus', 'Expert Keth Raiment'], 'one field per item, name and base');
  ok(/\+2 to Level of all Minion Skills/.test(embed.fields[0].value), 'the rolls are in the field');
  ok(/ilvl 84/.test(embed.fields[0].value), 'and the item level');

  await run('chrome.storage.local.set({ ptcSettings: {} })');
  const noHook = await run('handleBuildDiscord("col_1")');
  ok(noHook && !noHook.ok && /Settings/.test(noHook.error), 'without a webhook the user is told where to add it');

  /* The trade page's "Send to Discord" button goes through the same router. */
  await run('chrome.storage.local.set({ ptcSettings: ' + JSON.stringify(discordSettings) + ' })');
  state.discordPosts.length = 0;
  const itemSent = await browser.dispatch({
    type: 'ptc:discord:send',
    title: 'Gloom March',
    message: '**Gloom March** - Sekhema Sandals',
  });
  ok(itemSent && itemSent.ok, 'a single item can be sent to Discord from the trade page');
  eq(state.discordPosts.length, 1, 'one request reached the webhook');

  /* A corrupted item gets the red bar in Discord, not the gold one. */
  state.discordPosts.length = 0;
  await browser.dispatch({
    type: 'ptc:discord:send',
    title: 'Gloom March',
    message: '**Gloom March** - Sekhema Sandals',
    corrupted: true,
  });
  const corruptEmbed = ((state.discordPosts[0] || {}).embeds || [])[0] || {};
  eq(corruptEmbed.color, 0xb0413a, 'a corrupted item colours the Discord embed red');

  /* Deleting a build takes its imported gear with it and frees the saved
     listing that was assigned to it. */
  await run('chrome.storage.local.set({ collections: ' + JSON.stringify([{ id: 'col_1', name: 'Minion build', game: 'poe2' }])
    + ', savedItems: ' + JSON.stringify([
      { id: 'imp-x', game: 'poe2', targetOf: 'col_1', item: { name: 'Imported' } },
      { id: 'saved-x', game: 'poe2', collectionId: 'col_1', item: { name: 'Saved' } },
      { id: 'other', game: 'poe2', item: { name: 'Other' } },
    ]) + ' })');
  const deleted = await run('handleCollectionDelete("col_1")');
  eq(deleted.removed, 1, 'deleting a build removes its imported gear');
  eq(deleted.moved, 1, 'and frees the saved listing assigned to it');
  eq((store.savedItems || []).length, 2, 'the other items stay');
  ok((store.savedItems || []).every((rec) => rec.targetOf !== 'col_1'), 'no item keeps the deleted build');
  ok((store.savedItems || []).some((rec) => rec.id === 'saved-x' && rec.collectionId === ''), 'the saved listing is unsorted');

  /* ---- 5. one-time flags reset when the situation changes ---- */
  const currentWatcher = (itemId) => (store.watchedItems || []).find((entry) => entry.itemId === itemId) || {};
  const cycleRecord = { ...record, itemId: 'cycle-1', name: 'Cycle item' };
  await run('chrome.storage.local.set({ watchedItems: [], ptcPriceCache: {} })');
  await run('handleWatchAdd(' + JSON.stringify(cycleRecord) + ')');
  state.fetchMode = 'sold';
  notifications.length = 0;
  await run('checkWatchers(true)');
  eq(currentWatcher('cycle-1').status, 'sold', 'the listing is sold');
  eq(currentWatcher('cycle-1').notifiedSold, true, 'and the sale is announced once');

  state.fetchMode = 'available';
  await run('checkWatchers(true)');
  eq(currentWatcher('cycle-1').notifiedSold, false, 'a relisted item can announce a sale again');
  state.fetchMode = 'sold';
  notifications.length = 0;
  await run('checkWatchers(true)');
  ok(notifications.some((entry) => entry.title === 'Watched item sold or removed'),
    'the second disappearance is announced too');

  /* target reached, price goes back above it, the next drop alerts again */
  const targetRecord = {
    ...record,
    itemId: 'target-2',
    name: 'Target item',
    priceText: '3 x Divine',
    priceAmount: 3,
    priceCurrency: 'divine',
    targetPrice: 2.5,
    targetCurrency: 'divine',
  };
  await run('chrome.storage.local.set({ watchedItems: [], ptcPriceCache: ' + JSON.stringify(cache) + ' })');
  await run('handleWatchAdd(' + JSON.stringify(targetRecord) + ')');
  state.fetchMode = 'cheaper';
  await run('checkWatchers(true)');
  eq(currentWatcher('target-2').targetReached, true, 'the target is reached on the cheap listing');
  state.fetchMode = 'available';
  await run('checkWatchers(true)');
  eq(currentWatcher('target-2').targetReached, false, 'a price back above the target re-arms it');
  state.fetchMode = 'cheaper';
  notifications.length = 0;
  await run('checkWatchers(true)');
  ok(notifications.some((entry) => entry.title === 'Target price reached'),
    'the next drop reaches the target again');

  /* ---- 9. a disappearance does not tick a build goal ---- */
  await run('chrome.storage.local.set({ collections: ' + JSON.stringify([{
    id: 'gc1', name: 'Build', game: 'poe2', goals: [{ id: 'g1', name: 'Target item', done: false }],
  }]) + ' })');
  state.fetchMode = 'sold';
  await run('checkWatchers(true)');
  eq((store.collections[0].goals || [])[0].done, false,
    'a listing that disappears never checks a goal off');

  /* ---- 3. with more than twenty watchers, the oldest go first ---- */
  const many = [];
  for (let i = 1; i <= 25; i += 1) {
    many.push({
      id: 'mw' + i, itemId: 'item-' + i, game: 'poe2', league: 'Forbidden Rites',
      queryId: 'H4sIAAAA', name: 'Item ' + i, priceText: '3 x Divine', priceAmount: 3,
      priceCurrency: 'divine', status: 'available', enabled: true,
      lastChecked: Date.now() - (26 - i) * 60000,
      item: { name: 'Item ' + i, typeLine: 'Sacred Focus', frameType: 2, ilvl: 80 },
    });
  }
  await run('chrome.storage.local.set({ watchedItems: ' + JSON.stringify(many) + ', ptcPriceCache: {} })');
  state.fetchUrls.length = 0;
  state.fetchMode = 'available';
  await run('checkWatchers(true)');
  const fetchedIds = state.fetchUrls
    .map((url) => { const hit = /\/fetch\/([^?]+)/.exec(url); return hit ? decodeURIComponent(hit[1]).split(',')[0] : ''; })
    .filter(Boolean);
  eq(fetchedIds.length, 20, 'the tick still checks at most twenty listings');
  eq(fetchedIds.join('|'), many.slice(0, 20).map((entry) => entry.itemId).join('|'),
    'and it takes the twenty with the oldest lastChecked');

  /* ---- 4. search watches are saved as each one is checked ---- */
  await run('chrome.storage.local.set({ ptcSearchWatches: ' + JSON.stringify([
    { id: 'sw-a', game: 'poe2', league: 'Forbidden Rites', queryId: 'H4sIAAAA', enabled: true, seen: {}, lastChecked: 0 },
    { id: 'sw-b', game: 'poe2', league: 'Forbidden Rites', queryId: 'H4sIAAAA', enabled: true, seen: {}, lastChecked: 0 },
  ]) + ' })');
  state.storageWrites = 0;
  await run('checkSearchWatches(true)');
  ok(state.storageWrites >= 2, 'the search-watch state is written during the loop, not only at the end');

  /* ---- 6. the rate-limit headers are read, longest wait wins ---- */
  const headerWait = (headers) => run('rateLimitWaitFromHeaders({ get: function (name) { var h = '
    + JSON.stringify(headers) + '; return h[name] || null; } })');
  eq(await headerWait({ 'x-rate-limit-ip': '8:10:60', 'x-rate-limit-ip-state': '8:10:0' }), 10000,
    'a full window waits the window');
  eq(await headerWait({ 'x-rate-limit-ip': '8:10:60', 'x-rate-limit-ip-state': '7:10:0' }), 2000,
    'one slot left slows the next request down');
  eq(await headerWait({ 'retry-after': '5' }), 5000, 'Retry-After is read');
  eq(await headerWait({
    'x-rate-limit-ip': '8:10:60,15:60:120',
    'x-rate-limit-ip-state': '7:10:0,15:60:0',
    'retry-after': '3',
  }), 60000, 'the longest signal wins: the minute window is full');

  /* ---- 8. a restored build is sanitized, icons only from the databases ---- */
  const cleaned = await run('sanitizeCollection(' + JSON.stringify({
    id: 'c9',
    name: '  My Build ',
    game: 'poe1',
    ascendancy: { ascendancy: 'Witch', ascendancyClass: 'Witch', ascendancyIcon: 'https://evil.example/a.png' },
    goals: [{ id: 'g', name: 'Goal', done: true }, { id: 'x' }],
    gear: [{ baseType: 'Vaal Regalia', stats: { life: 80 }, slot: 'Body Armour' }],
    notes: 'hi',
  }) + ')');
  eq(cleaned.name, 'My Build', 'the build name is trimmed');
  eq(cleaned.ascendancy.ascendancyIcon, '', 'an icon from anywhere else is dropped');
  eq(cleaned.goals.length, 1, 'nameless goals are dropped');
  eq(cleaned.gear.length, 1, 'gear is kept and cleaned');
  const goodIcon = await run('sanitizeCollection(' + JSON.stringify({
    id: 'c10', name: 'B', game: 'poe2',
    ascendancy: { ascendancy: 'Witch', ascendancyIcon: 'https://cdn.poe2db.tw/x.webp' },
  }) + ')');
  eq(goodIcon.ascendancy.ascendancyIcon, 'https://cdn.poe2db.tw/x.webp', 'the item database icon is kept');

  console.log('PASS ' + passed + ' assertions');
})().catch((error) => {
  console.error('FAIL:', error && error.message);
  process.exit(1);
});
