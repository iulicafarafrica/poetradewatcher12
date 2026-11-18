/*
 * Search builder simulation: runs the shipped worker in a sandbox (fake storage,
 * fake stat table, no network) and checks the rules an item's search follows:
 *
 *   - rune effects are never searched (they are socketable, not part of the item)
 *   - an import requires its build-defining stats and half-matches the rest
 *   - a saved listing searches all of its modifiers but one, with its rolls
 *
 *   node tests/search-sim.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

global.window = globalThis;
global.pako = require(path.join(ROOT, 'pako.min.js'));
require(path.join(ROOT, 'ptc-games.js'));
require(path.join(ROOT, 'ptc-poe1.js'));
require(path.join(ROOT, 'ptc-poe2.js'));
require(path.join(ROOT, 'ptc-settings.js'));
require(path.join(ROOT, 'ptc-modtext.js'));
require(path.join(ROOT, 'item-utils.js'));
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

/* A minimal PoE 2 stat table: the same text can be filed under several ids, and
   the rune version of a modifier has its own domain. */
const STAT_ROWS = [
  { id: 'explicit.stat_3489782002', text: '+# to maximum Energy Shield', type: 'explicit' },
  { id: 'explicit.stat_4015621042', text: '#% increased Energy Shield', type: 'explicit' },
  { id: 'explicit.stat_1050105434', text: '+# to maximum Mana', type: 'explicit' },
  { id: 'explicit.stat_328541901', text: '+# to Intelligence', type: 'explicit' },
  { id: 'explicit.stat_3372524247', text: '+#% to Lightning Resistance', type: 'explicit' },
  { id: 'explicit.stat_2162097452', text: '+# to Level of all Minion Skills', type: 'explicit' },
  { id: 'explicit.stat_2250533757', text: '#% increased Movement Speed', type: 'explicit' },
  { id: 'rune.stat_3523867985', text: '#% increased Armour, Evasion and Energy Shield', type: 'rune' },
  { id: 'rune.stat_2280525771', text: '+# to maximum Life', type: 'rune' },
];
const STATS_PAYLOAD = {
  result: ['explicit', 'rune'].map((group) => ({
    id: group,
    entries: STAT_ROWS.filter((row) => row.type === group)
      .map((row) => ({ id: row.id, text: row.text, type: row.type })),
  })),
};

function createWorker() {
  const store = {};
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

  const chrome = {
    runtime: {
      id: 'sandbox', lastError: null,
      onMessage: { addListener() {} }, onInstalled: { addListener() {} },
      onStartup: { addListener() {} }, onSuspend: { addListener() {} },
      sendMessage: (msg, cb) => { if (cb) cb({ ok: true }); return Promise.resolve({ ok: true }); },
      getURL: (p) => 'chrome-extension://sandbox/' + p,
    },
    storage: {
      local: { get: localGet, set: (obj) => { Object.assign(store, obj); return Promise.resolve(); } },
      sync: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      onChanged: { addListener() {} },
    },
    alarms: { create() {}, get: () => Promise.resolve(undefined), clear: () => Promise.resolve(true), onAlarm: { addListener() {} } },
    action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve(), setTitle: () => Promise.resolve() },
    notifications: { create: () => Promise.resolve('id'), onClicked: { addListener() {} } },
    tabs: { query: () => Promise.resolve([]), create: () => Promise.resolve({ id: 1 }), remove: () => Promise.resolve(), sendMessage: () => Promise.resolve(null), onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    permissions: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true) },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    scripting: { executeScript: () => Promise.resolve([]) },
    windows: { getCurrent: () => Promise.resolve({ id: 1 }) },
  };

  const itemsPayload = { result: [{ id: 'armour.focus', entries: [{ type: 'Sacred Focus' }] }] };
  const fetch = async (url) => {
    if (String(url).endsWith('/data/stats')) return { ok: true, status: 200, json: async () => STATS_PAYLOAD };
    if (String(url).endsWith('/data/items')) return { ok: true, status: 200, json: async () => itemsPayload };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };

  const sandbox = {
    chrome, console, fetch, setTimeout, clearTimeout, setInterval, clearInterval,
    AbortController, TextEncoder, TextDecoder, URL, URLSearchParams,
    CompressionStream, DecompressionStream, Blob, Response, btoa, atob,
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
  return { run: (code) => vm.runInContext(code, sandbox), store };
}

const decode = (url) => JSON.parse(zlib.gunzipSync(Buffer.from(url.split('/').pop().replace(/-/g, '+').replace(/_/g, '/'), 'base64')).toString('utf8'));

/* The item from the report. */
const glyph = {
  id: 'imported', game: 'poe2', league: 'Forbidden Rites', targetOf: 'col_1', rarity: 2,
  name: 'Glyph Emblem', typeLine: 'Sacred Focus',
  item: {
    name: 'Glyph Emblem', baseType: 'Sacred Focus', typeLine: 'Sacred Focus', frameType: 2, ilvl: 80, itemClass: 'Foci',
    explicitMods: ['+80 to maximum Energy Shield', '34% increased Energy Shield', '+32 to maximum Mana',
      '+23 to Intelligence', '+31% to Lightning Resistance'],
    craftedMods: ['77% increased Energy Shield'],
    desecratedMods: ['+2 to Level of all Minion Skills'],
    runeMods: ['18% increased Armour, Evasion and Energy Shield', 'Bonded: +20 to maximum Life', 'Bonded: +20 to maximum Mana'],
  },
};

(async () => {
  const worker = createWorker();
  await new Promise((resolve) => setTimeout(resolve, 250));

  const lines = worker.run('itemModLines(' + JSON.stringify(glyph.item) + ')');
  ok(!lines.some((line) => /Armour, Evasion|Bonded/i.test(line)), 'rune effects are not among the searched lines');
  eq(lines.length, 7, 'five explicit, one crafted and one desecrated line');

  const sneaky = worker.run('itemModLines(' + JSON.stringify({
    explicitMods: ['+80 to maximum Energy Shield', 'Bonded: +20 to maximum Life', 'Rune: 18% increased Armour'],
  }) + ')');
  eq(sneaky, ['+80 to maximum Energy Shield'], 'a rune line inside the modifiers is dropped too');

  const panelRecord = JSON.parse(JSON.stringify(glyph));
  panelRecord.item.explicitMods = globalThis.PTC.searchModLines(glyph.item);
  delete panelRecord.item.craftedMods;
  delete panelRecord.item.desecratedMods;

  eq(panelRecord.item.explicitMods.length, 7, 'the panel sends every modifier line, not only the explicit ones');
  ok(panelRecord.item.explicitMods.indexOf('77% increased Energy Shield') !== -1, 'the crafted line is among them');
  ok(panelRecord.item.explicitMods.indexOf('+2 to Level of all Minion Skills') !== -1, 'and the desecrated one');

  const built = await worker.run('handleTradeUrl(' + JSON.stringify(panelRecord) + ')');
  ok(built.ok, 'the imported item builds a search' + (built.error ? ' [' + built.error + ']' : ''));
  const query = decode(built.url);
  /* Measured on the live trade site: `available` is the option labelled
     "Instant Buyout and In Person"; `securable` is "Instant Buyout". */
  eq(query.status && query.status.option, 'available', 'the search asks for Instant Buyout and In Person');
  eq(query.type, 'Sacred Focus', 'the base type is the search type');
  eq(query.stats.length, 2, 'a required group and a similarity group');
  eq(query.stats[0].type, 'and', 'the build-defining stat is required');
  eq(query.stats[0].filters.map((f) => f.id), ['explicit.stat_2162097452'], 'and it is the minion levels');
  eq(query.stats[1].type, 'count', 'the rest is a count group');
  eq(query.stats[1].value.min, 4, 'all but one of the remaining five');
  const ids = query.stats[1].filters.map((f) => f.id);
  eq(ids.length, 5, 'five filters after the duplicate is merged');
  eq(new Set(ids).size, ids.length, 'no stat is listed twice');
  ok(!ids.some((id) => /^rune\./.test(id)), 'no rune stat is asked for');
  ok(ids.indexOf('explicit.stat_2162097452') === -1, 'the required stat is not repeated in the count group');

  /* the same item as a listing with stat ids */
  const listing = {
    id: 'saved', game: 'poe2', league: 'Forbidden Rites', rarity: 2,
    item: {
      name: 'Glyph Emblem', baseType: 'Sacred Focus', typeLine: 'Sacred Focus', frameType: 2, ilvl: 80,
      explicitMods: [
        { description: '+80 to maximum Energy Shield', domain: 'explicit', hash: 'stat.explicit.stat_3489782002' },
        { description: '+2 to Level of all Minion Skills', domain: 'desecrated', hash: 'stat.desecrated.stat_2162097452' },
      ],
      runeMods: [{ description: '18% increased Armour, Evasion and Energy Shield', domain: 'rune', hash: 'stat.rune.stat_3523867985' }],
    },
  };
  const savedBuilt = await worker.run('handleTradeUrl(' + JSON.stringify(listing) + ')');
  const savedQuery = decode(savedBuilt.url);
  eq(savedQuery.stats[0].type, 'and', 'a listing with fewer than four stats requires all of them');
  eq(savedQuery.stats[0].filters.length, 2, 'the explicit and the desecrated stat');
  ok(!savedQuery.stats[0].filters.some((f) => /^rune\./.test(f.id)), 'the rune hash is not a filter');

  /* ---- the league the search opens in ---------------------------------- */
  /* A saved listing searches the league it was saved from; a build import has
     no league of its own and follows the one picked in the header. Reading
     only the fallback field sent PoE 1 imports to Standard even with a league
     selected, so both halves are asserted here. */
  const leagueOf = (url) => {
    const parts = decodeURIComponent(String(url).split('/search/')[1]).split('/');
    /* PoE 2 puts its realm in front of the league: /trade2/search/poe2/<league>/<id> */
    return parts.length >= 3 && parts[0] === 'poe2' ? parts[1] : parts[0];
  };
  eq(leagueOf(savedBuilt.url), 'Forbidden Rites', 'a saved listing searches the league it was saved from');

  const importRecord = {
    id: 'imp1', game: 'poe1', league: '', targetOf: 'col_1', rarity: 3,
    name: 'Tabula Rasa', typeLine: 'Simple Robe',
    item: { name: 'Tabula Rasa', baseType: 'Simple Robe', typeLine: 'Simple Robe', frameType: 3, itemClass: 'Body Armours' },
  };
  worker.store.ptcSettings = { leagueByGame: { poe1: 'Covens' }, leagueModeByGame: { poe1: 'manual' } };
  const importBuilt = await worker.run('handleTradeUrl(' + JSON.stringify(importRecord) + ')');
  ok(importBuilt.ok, 'a PoE 1 import builds a search' + (importBuilt.error ? ' [' + importBuilt.error + ']' : ''));
  eq(leagueOf(importBuilt.url), 'Covens', 'an import without a league uses the one picked in the header');

  const explicitBuilt = await worker.run('handleTradeUrl(' + JSON.stringify({ ...importRecord, league: 'Settlers' }) + ')');
  eq(leagueOf(explicitBuilt.url), 'Settlers', 'a league on the record wins over the header pick');

  const importPoe2 = {
    id: 'imp2', game: 'poe2', league: '', targetOf: 'col_1', rarity: 3,
    name: 'The Dark Defiler', typeLine: 'Sacred Focus',
    item: { name: 'The Dark Defiler', baseType: 'Sacred Focus', typeLine: 'Sacred Focus', frameType: 3, itemClass: 'Foci' },
  };
  worker.store.ptcSettings = { leagueByGame: { poe2: 'Forbidden Rites' }, leagueModeByGame: { poe2: 'manual' } };
  const importBuilt2 = await worker.run('handleTradeUrl(' + JSON.stringify(importPoe2) + ')');
  ok(importBuilt2.ok, 'a PoE 2 import builds a search' + (importBuilt2.error ? ' [' + importBuilt2.error + ']' : ''));
  eq(leagueOf(importBuilt2.url), 'Forbidden Rites', 'PoE 2 imports follow their own header league');

  console.log('PASS ' + passed + ' assertions');
})().catch((error) => {
  console.error('FAIL:', error && error.message);
  process.exit(1);
});
