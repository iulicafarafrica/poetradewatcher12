const ITEMS_KEY = 'savedItems';
const COLLECTIONS_KEY = 'collections';
const FOLDERS_KEY = 'bookmarkFolders';
const BOOKMARKS_KEY = 'bookmarks';
const MULTI_KEY = 'multiLive';
const WATCHED_KEY = 'watchedItems';
const HISTORY_KEY = 'searchHistory';
const SETTINGS_KEY = 'ptcSettings';
const PRICES_KEY = 'ptcPriceCache';
const ACTIVE_KEY = 'activeTrade';
const LAST_LEAGUE_KEY = 'ptcLastLeague';
const LEAGUES_KEY = 'ptcLeagues';
const PRICE_INDEX_KEY = 'ptcPriceIndex';
const SEARCH_WATCHES_KEY = 'ptcSearchWatches';
const PRESETS_KEY = 'ptcPresets';
const PRICE_HISTORY_KEY = 'ptcMarketHistory';

const MAX_ITEMS = 2000;
const MAX_COLLECTIONS = 200;
const MAX_FOLDERS = 500;
const MAX_BOOKMARKS = 2000;
const MAX_WATCHED = 300;
const MAX_HISTORY = 600;
const MAX_MULTI = 50;
const MAX_SEARCH_WATCHES = 50;
const MAX_PRESETS = 100;

/* Name of the recurring alarm that drives the background watcher checks. */
const WATCH_ALARM = 'ptc-watch-check';
/* Name of the recurring alarm that re-runs the watched searches. */
const SEARCH_WATCH_ALARM = 'ptc-search-watch';
/* How long one search-watch pass may run: a service worker is stopped after
   five minutes, so the loop stops with the remaining watches still due. */
const SEARCH_WATCH_BUDGET_MS = 4 * 60 * 1000;
/* How long a poe.ninja currency snapshot stays fresh, in milliseconds. */
const PRICE_TTL = 15 * 60 * 1000;
/* How long the list of PoE2 trade leagues stays fresh, in milliseconds. */
/* The league list is a small public endpoint that only really changes when a
   new league goes live. A 6 hour cache kept a just-restarted PoE 1 (empty PC
   list, then a new challenge league) looking dead for hours, so keep it short. */
const LEAGUE_TTL = 30 * 60 * 1000;

if (typeof importScripts === 'function') importScripts('ptc-games.js', 'ptc-poe1.js', 'ptc-poe2.js', 'ptc-settings.js', 'ptc-modtext.js', 'coe.js');
else if (typeof require === 'function') { require('./ptc-games.js'); require('./ptc-settings.js'); }

/* The trade site's status value for "Instant Buyout and In Person". Measured on
   the live site (both games): `available` is that option, while `securable` is
   "Instant Buyout" - the API names do not match the labels. */
const SEARCH_STATUS = (globalThis.PTC_GAMES && globalThis.PTC_GAMES.TRADE_STATUS
  && globalThis.PTC_GAMES.TRADE_STATUS.instantAndInPerson) || 'available';
const SEARCH_STATUS_ANY = (globalThis.PTC_GAMES && globalThis.PTC_GAMES.TRADE_STATUS
  && globalThis.PTC_GAMES.TRADE_STATUS.any) || 'any';

/* Chrome opens the side panel from the toolbar button. Firefox has no side
   panel API, so the same click toggles the sidebar instead; the two browsers
   share one source and only this branch differs. */
const HAS_SIDE_PANEL = !!(chrome.sidePanel && chrome.sidePanel.setPanelBehavior);
try {
  if (HAS_SIDE_PANEL) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
} catch (_) {}
if (!HAS_SIDE_PANEL && chrome.action && chrome.action.onClicked && chrome.sidebarAction) {
  chrome.action.onClicked.addListener(() => {
    /* Firefox reports the click instead of opening the sidebar itself, so this
       has to behave like Chrome's panel button: open when it is closed, close
       when it is open. */
    let settled = false;
    const apply = (isOpen) => {
      if (settled) return;
      settled = true;
      try {
        const call = isOpen ? chrome.sidebarAction.close() : chrome.sidebarAction.open();
        if (call && typeof call.catch === 'function') call.catch(() => {});
      } catch (error) {
        /* nothing else can toggle it */
      }
    };
    try {
      /* Promise in one namespace, callback in the other; both are answered. */
      if (!chrome.sidebarAction.isOpen) {
        apply(false);
        return;
      }
      const known = chrome.sidebarAction.isOpen({}, apply);
      if (known && typeof known.then === 'function') known.then(apply).catch(() => apply(false));
    } catch (error) {
      apply(false);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Helpers and storage access                                         */
/* ------------------------------------------------------------------ */

const SYNC_PREFIX = 'ptcSync';
const SYNC_CHUNK = 4000;

/* Settings live in ptc-settings.js so the worker, the side panel, the
   viewer and the trade page all agree on the same schema. */
const DEFAULT_SETTINGS = globalThis.PTC_SETTINGS.defaults;

function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = DEFAULT_SETTINGS;
  const layouts = ['classic', 'compact', 'minimal'];
  const actions = ['search-current', 'search-new', 'live-current', 'live-new'];
  const result = globalThis.PTC_SETTINGS.normalize(source);

  /* legacy import: the old two-currency display mode */
  if (!source.priceDisplayMigrated && source.priceDisplay === 'chaos-divine') {
    result.priceDisplay = 'divine-exalted';
  }
  result.priceDisplayMigrated = true;

  /* bookmark options are kept in storage for backwards compatibility */
  result.bookmarkLayout = layouts.includes(source.bookmarkLayout) ? source.bookmarkLayout : base.bookmarkLayout;
  result.bookmarkDefaultAction = { ...base.bookmarkDefaultAction };
  const rawActions = source.bookmarkDefaultAction && typeof source.bookmarkDefaultAction === 'object'
    ? source.bookmarkDefaultAction
    : {};
  layouts.forEach((layout) => {
    const value = rawActions[layout];
    if (actions.includes(value)) result.bookmarkDefaultAction[layout] = value;
  });

  return result;
}

function updateBadge(items) {
  const count = Array.isArray(items) ? items.length : 0;
  chrome.action.setBadgeText({ text: count ? String(count > 999 ? '999+' : count) : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#8a6d2f' }).catch(() => {});
  chrome.action.setTitle({
    title: count ? `Poe Trade Watcher - ${count} items saved` : 'Open Poe Trade Watcher',
  }).catch(() => {});
}

getItems().then(updateBadge).catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[ITEMS_KEY]) return;
  updateBadge(asArray(changes[ITEMS_KEY].newValue));
});

function cleanString(value, max = 4000) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function cleanText(value, max = 200) {
  return cleanString(value, max).replace(/\s+/g, ' ').trim();
}

function cleanId(value, max = 200) {
  return cleanString(value, max).replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);
}

/*
 * PoE2 search ids are base64url gzip blobs ("H4sIAAAAAAAAA…") and run to nearly
 * three hundred characters. Shortening one produces a URL the trade site answers
 * with "Failed to load search state. The search is no longer valid.", so ids are
 * never cut like an ordinary record id.
 */
function cleanQueryId(value) {
  return cleanString(value, 4000).replace(/[^A-Za-z0-9_\-=]/g, '');
}

function cleanName(value) {
  return cleanText(value, 80);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function gameOf(value) {
  return globalThis.PTC_GAMES.normalizeGame(value);
}

function makeId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function cleanItemText(value) {
  return cleanText(value).replace(/\[([^\]|]+)(?:\|([^\]]+))?\]/g, (match, key, display) => display || key);
}

/*
 * The item text as the game shows it: markup like "[Resistances|Cold
 * Resistance]" becomes "Cold Resistance". This is the copy item-utils.js uses
 * for the tooltip and the Craft of Exile paste; the worker is a separate
 * script that never loads item-utils, so the same function lives here. No length
 * cap: a truncated modifier line cannot be matched against the site's templates.
 */
function cleanGameText(value) {
  return String(value == null ? '' : value)
    .replace(/<<[^>]*>>/g, ' ')
    .replace(/\[([^\]|]+)(?:\|([^\]]+))?\]/g, (match, key, display) => display || key)
    .replace(/\s+/g, ' ')
    .trim();
}

function itemLabel(item) {
  const source = item && typeof item === 'object' ? item : {};
  const name = cleanItemText(source.name);
  const typeLine = cleanItemText(source.typeLine);
  if (name && typeLine && name !== typeLine) return name + ' - ' + typeLine;
  return name || typeLine || 'Item';
}

let queue = Promise.resolve();

function enqueue(task) {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
}

function parseTradeUrl(url) {
  return globalThis.PTC_GAMES.parseTradeUrl(url);
}

/*
 * Builds the URL of a trade search. The trade site has used both
 * "/<league>/<id>" and "/<league>?q=<id>", so the URL of the trade tab that
 * is already open is used as a template whenever there is one: only the
 * query id changes, so the shape is always the one the site itself uses.
 */
function buildTradeUrl(game, league, queryId, live, templateUrl) {
  return globalThis.PTC_GAMES.buildTradeUrl(game, league, queryId, live, templateUrl);
}

/* The URL of the trade tab that is currently open, used as a URL template. */
async function tradeUrlTemplate() {
  try {
    const stored = await chrome.storage.local.get({ [ACTIVE_KEY]: null });
    const active = stored && stored[ACTIVE_KEY];
    return active && active.url ? active.url : '';
  } catch (error) {
    return '';
  }
}

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || 12000);
  try {
    return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function getItems() {
  const data = await chrome.storage.local.get({ [ITEMS_KEY]: [] });
  return asArray(data[ITEMS_KEY]);
}

async function setItems(items) {
  await chrome.storage.local.set({ [ITEMS_KEY]: items });
}

async function getCollections() {
  const data = await chrome.storage.local.get({ [COLLECTIONS_KEY]: [] });
  return asArray(data[COLLECTIONS_KEY]);
}

async function setCollections(collections) {
  await chrome.storage.local.set({ [COLLECTIONS_KEY]: collections });
}

async function getFolders() {
  const data = await chrome.storage.local.get({ [FOLDERS_KEY]: [] });
  return asArray(data[FOLDERS_KEY]);
}

async function getBookmarks() {
  const data = await chrome.storage.local.get({ [BOOKMARKS_KEY]: [] });
  return asArray(data[BOOKMARKS_KEY]);
}

async function getMultiLive() {
  const data = await chrome.storage.local.get({ [MULTI_KEY]: [] });
  return asArray(data[MULTI_KEY]);
}

async function getWatched() {
  const data = await chrome.storage.local.get({ [WATCHED_KEY]: [] });
  return asArray(data[WATCHED_KEY]);
}

async function getHistory() {
  const data = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  return asArray(data[HISTORY_KEY]);
}

async function getSettings() {
  const data = await chrome.storage.local.get({ [SETTINGS_KEY]: {} });
  return normalizeSettings(data[SETTINGS_KEY]);
}

async function setSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  await ensureWatchAlarm(normalized);
  if (normalized.syncEnabled) queueSyncPush();
  return normalized;
}

/* ------------------------------------------------------------------ */
/* Saved items and builds                                              */
/* ------------------------------------------------------------------ */

function sanitizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const id = cleanString(record.id, 200);
  const item = record.item;
  if (!id || !item || typeof item !== 'object') return null;
  return {
    schemaVersion: 2,
    id,
    savedAt: Number(record.savedAt) || Date.now(),
    item,
    listing: record.listing && typeof record.listing === 'object' ? record.listing : {},
    icon: cleanString(record.icon, 2000),
    name: cleanString(record.name, 400),
    typeLine: cleanString(record.typeLine, 400),
    rarity: Number.isInteger(record.rarity) ? record.rarity : null,
    priceText: cleanString(record.priceText, 120),
    priceAmount: typeof record.priceAmount === 'number' ? record.priceAmount : null,
    priceCurrency: cleanString(record.priceCurrency, 60),
    account: cleanString(record.account, 120),
    ign: cleanString(record.ign, 120),
    whisper: cleanString(record.whisper, 1000),
    whisperToken: cleanString(record.whisperToken || (record.listing && record.listing.whisper_token), 200),
    stash: sanitizeStash(record.stash || (record.listing && record.listing.stash)),
    league: cleanString(record.league, 120),
    game: gameOf(record.game || (parseTradeUrl(record.searchUrl) || {}).game),
    queryId: cleanQueryId(record.queryId),
    searchUrl: cleanString(record.searchUrl, 2000),
    sourceUrl: cleanString(record.sourceUrl, 2000),
    coeMods: sanitizeCoeMods(record.coeMods),
    collectionId: cleanString(record.collectionId, 100),
    targetOf: cleanString(record.targetOf, 100),
    priceHistory: sanitizePriceHistory(record.priceHistory),
  };
}

function sanitizeCoeMods(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object' && cleanText(entry.text, 300))
    .slice(0, 24)
    .map((entry) => ({
      kind: ['explicit', 'crafted', 'fractured', 'desecrated', 'rune', 'implicit', 'enchant'].includes(entry.kind)
        ? entry.kind
        : 'explicit',
      text: cleanText(entry.text, 300),
      type: entry.type === 'suffix' ? 'suffix' : entry.type === 'prefix' ? 'prefix' : '',
      tier: Number.isFinite(Number(entry.tier)) && Number(entry.tier) > 0 ? Math.trunc(Number(entry.tier)) : 0,
      name: cleanText(entry.name, 120),
      statText: cleanText(entry.statText, 300),
      min: entry.min == null || entry.min === '' ? null
        : (Number.isFinite(Number(entry.min)) ? Number(entry.min) : null),
      max: entry.max == null || entry.max === '' ? null
        : (Number.isFinite(Number(entry.max)) ? Number(entry.max) : null),
    }));
}

function sanitizeStash(value) {
  if (!value || typeof value !== 'object') return null;
  const tab = cleanText(value.tab || value.name, 120);
  if (!tab) return null;
  return {
    tab,
    x: Number.isFinite(value.x) ? Math.trunc(value.x) : null,
    y: Number.isFinite(value.y) ? Math.trunc(value.y) : null,
  };
}

function sanitizePriceHistory(value) {
  const out = [];
  (Array.isArray(value) ? value : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const at = Number(entry.at) || 0;
    if (!at) return;
    out.push({
      at,
      priceText: cleanText(entry.priceText, 60),
      priceAmount: typeof entry.priceAmount === 'number' ? entry.priceAmount : null,
      priceCurrency: cleanText(entry.priceCurrency, 40),
    });
  });
  return out.slice(-50);
}

function pushPriceHistory(record, priceText, priceAmount, priceCurrency) {
  if (!record || !priceText) return;
  const list = Array.isArray(record.priceHistory) ? record.priceHistory : [];
  const last = list[list.length - 1];
  if (last && last.priceText === priceText) return;
  list.push({
    at: Date.now(),
    priceText,
    priceAmount: typeof priceAmount === 'number' ? priceAmount : null,
    priceCurrency: cleanText(priceCurrency, 40),
  });
  record.priceHistory = list.slice(-50);
}

function makeCollectionId() {
  return makeId('col');
}

function handleSave(record) {
  return enqueue(async () => {
    const rec = sanitizeRecord(record);
    if (!rec) return { ok: false, error: 'Invalid item data.' };
    // Seed the price history with the first listed price so the chart starts
    // at save time; later refreshes keep appending to it.
    if (!rec.priceHistory.length && Number.isFinite(Number(rec.priceAmount)) && Number(rec.priceAmount) > 0 && rec.priceText) {
      rec.priceHistory = [{
        at: rec.savedAt,
        priceText: rec.priceText,
        priceAmount: Number(rec.priceAmount),
        priceCurrency: rec.priceCurrency,
      }];
    }
    let unsorted = false;
    if (rec.collectionId) {
      const collections = await getCollections();
      if (!collections.some((entry) => entry.id === rec.collectionId)) {
        rec.collectionId = '';
        unsorted = true;
      }
    }
    const items = await getItems();
    if (items.some((entry) => entry.id === rec.id)) {
      return { ok: true, duplicate: true, count: items.length };
    }
    if (items.length >= MAX_ITEMS) {
      return { ok: false, error: 'Collection is full. Delete a few items or export your collection.' };
    }
    items.unshift(rec);
    try {
      await setItems(items);
    } catch (error) {
      return { ok: false, error: 'Storage is full. Delete a few items or export your collection.' };
    }
    return { ok: true, duplicate: false, count: items.length, unsorted, collectionId: rec.collectionId };
  });
}

  // Build codes from Mobalytics / pobb.in no longer carry {prefix}/{suffix}
  // tags on the items of an equipped set, so their modifier lines arrive with no
  // prefix/suffix type. The save flow captures that from the trade site, and it
  // is exactly what Craft of Exile needs in the eimport paste (a bare affix line
  // without a "{ Prefix/Suffix Modifier }" header is dropped there, leaving a
  // blank base). This re-derives the type for imported items only, using CoE's
  // own per-class mod pools (the same data.json the site loads, fetched through
  // the cached coeFetchText). Never touches the save flow. Returns
  // { records, classified, needsPermission }.
  // The affix header Craft of Exile needs is name-based: saved items get the
  // name from the trade API, build imports never do. resolveMod looks the name
  // (and the prefix/suffix type) up in the site's own mod pool for this base.
  function enrichRecordModNames(index, rec) {
    const item = rec.item || {};
    const base = cleanTradeBase(item.baseType || item.typeLine);
    /* Craft of Exile has its own item classes and its own spelling of the
       base items. The paste needs those, not the trade site's names, or the
       site cannot resolve the base and refuses the whole paste. */
    if (typeof COE !== 'undefined' && COE.baseName && COE.className) {
      const coeName = COE.baseName(index, base);
      if (coeName) item.coeBaseType = coeName;
      const coeItem = index && index.items && index.items.get(COE.normalizeName(base));
      const coeClass = coeItem ? COE.className(index, coeItem.class) : '';
      if (coeClass) item.coeItemClass = coeClass;
    }
    const list = Array.isArray(rec.coeMods) ? rec.coeMods : [];
    let changed = 0;
    rec.coeMods = list.map((mod) => {
      if (!mod || !mod.text) return mod;
      if (mod.kind !== 'explicit' && mod.kind !== 'crafted' && mod.kind !== 'fractured' && mod.kind !== 'desecrated') return mod;
      const named = mod.name && mod.name !== 'modifier';
      if (mod.type && named) return mod;
      const found = COE.resolveMod(index, base, mod.text);
      if (!found) return mod;
      changed += 1;
      // The ranges are what the site shows as "(Tier: n) 45(45-50)" and what the
      // item card shows next to the roll, exactly like a saved item.
      const numeric = (value) => (value == null || value === '' ? null
        : (Number.isFinite(Number(value)) ? Number(value) : null));
      const ownMin = numeric(mod.min);
      const ownMax = numeric(mod.max);
      // Older imports stored 0/0 for "no range", which is also a valid range for
      // fixed-value mods, so only fill it when the pool knows better.
      const noRange = ownMin === 0 && ownMax === 0;
      const min = ownMin != null && !noRange ? ownMin : found.min;
      const max = ownMax != null && !noRange ? ownMax : found.max;
      return { ...mod, type: found.type, name: found.name, tier: found.tier || 0, statText: found.template || '', min: min, max: max };
    });
    return changed;
  }

  async function enrichImportedModTypes(records, game) {
    if (!records.length) return { records: records, classified: false, needsPermission: false };
    if (typeof COE === 'undefined' || !COE.loadIndex || !COE.resolveMod) return { records: records, classified: false, needsPermission: false };
    let granted = true;
    if (chrome.permissions && chrome.permissions.contains) {
      try {
        granted = await chrome.permissions.contains({ origins: ['https://beta.craftofexile.com/*'] });
      } catch (_) { granted = false; }
    }
    if (!granted) return { records: records, classified: false, needsPermission: true };
    let index = null;
    try {
      index = await COE.loadIndex((url) => coeFetchText(url), gameOf(game));
    } catch (_) {
      return { records: records, classified: false, needsPermission: false }; // offline / data changed — keep the record as parsed.
    }
    if (!index) return { records: records, classified: false, needsPermission: false };
    let any = false;
    records.forEach((rec) => {
      if (enrichRecordModNames(index, rec) > 0) any = true;
    });
    return { records: records, classified: any, needsPermission: false };
  }

function handleTargetImport(payload) {
  return enqueue(async () => {
    const list = Array.isArray(payload && payload.items) ? payload.items : [];
    const collectionId = cleanId(payload && payload.collectionId);
    if (!collectionId) return { ok: false, error: 'Build not found.' };
    const collections = await getCollections();
    if (!collections.some((entry) => entry.id === collectionId)) {
      return { ok: false, error: 'Build not found.' };
    }
    const game = gameOf(payload && payload.game);
    // A build imported without a league would otherwise store none and every search for
    // it would fall back to Standard, so resolve the league the user is actually in.
    const league = cleanText(payload && payload.league, 120) || await resolveLeague(game, '');
    const items = await getItems();
    const next = items.filter((entry) => entry.targetOf !== collectionId);
    const removed = items.length - next.length;
    const enriched = await enrichImportedModTypes(list, game);
    const incoming = enriched.records;
    const coeNeedsPermission = enriched.needsPermission;
    let saved = 0;
    for (const entry of incoming) {
      if (next.length >= MAX_ITEMS) break;
      const rec = sanitizeRecord({
        ...entry,
        collectionId,
        targetOf: collectionId,
        game,
        league: entry.league || league,
      });
      if (!rec) continue;
      if (items.some((existing) => existing.id === rec.id)) continue;
      next.unshift(rec);
      saved += 1;
    }
      await setItems(next);
      notifySyncPush();
      // No automatic artwork: the icon lookup creates a search for the item,
      // and for a build import that search is a broad base search whose cheapest
      // listing (and therefore artwork) is unrelated to the imported item, so
      // the "icons" that landed were wrong. Imported items simply keep no icon;
      // "Read page" (Mobalytics capture) can still fill in real artwork. Any
      // leftover jobs from the old behaviour are dropped so they cannot attach
      // bad icons to the fresh records either.
      await setIconQueue([]).catch(() => {});
      // Keep the imported gear on the build so the trade page can show whether a
      // listing is an upgrade, a sidegrade or a downgrade for that slot.
      const buildList = await getCollections();
      const target = buildList.find((entry) => entry.id === collectionId);
      if (target) {
        const gear = incoming
          .filter((entry) => entry && entry.item && entry.item.baseType)
          .map((entry) => ({
            id: entry.id,
            name: entry.name || '',
            baseType: entry.item.baseType || '',
            slot: entry.item.slot || '',
            itemClass: entry.item.itemClass || '',
            rarity: entry.rarity || '',
            ilvl: entry.item.ilvl || 0,
            stats: entry.stats && typeof entry.stats === 'object' ? entry.stats : {},
            mods: Array.isArray(entry.item.explicitMods)
              ? entry.item.explicitMods.map((mod) => (typeof mod === 'string' ? mod : ((mod && (mod.description || mod.text)) || ''))).filter(Boolean)
              : [],
          }));
        if (gear.length) {
          target.gear = gear;
          target.updatedAt = Date.now();
          await setCollections(buildList);
        }
      }
      return { ok: true, saved: saved, removed: removed, coeNeedsPermission: coeNeedsPermission };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Trade site API: real search links and item artwork                  */
  /* ------------------------------------------------------------------ */

  // The search endpoint allows 5 requests per 10 seconds and 15 per minute per
  // IP, so every search created here is spaced out to stay under that limit.
  // A build import walks a short ladder of filters (up to six requests) and the
  // user may click again while it runs, so the gap is set for roughly twelve
  // requests a minute rather than sitting on the limit itself.
  const TRADE_SEARCH_GAP = 5000;
  const TRADE_RETRY_WAIT = 6500;
  const ICON_CACHE_KEY = 'ptcIconCache';
  const ICON_CACHE_LIMIT = 600;
  let lastTradeSearchAt = 0;
  let lastTrade429At = 0;
  const iconMemo = new Map();

  /*
   * The trade site answers an over-eager client with "Please wait N seconds
   * before trying again". That penalty is per IP and lasts for minutes, not
   * seconds, so every request that touches the trade API has to stop while it
   * is active. Without this the extension would keep knocking on a door that
   * is already closed and make the block longer.
   */
  const TRADE_BLOCK_MIN = 30 * 1000;
  const TRADE_BLOCK_MAX = 60 * 60 * 1000;
  /* The block is keyed to the IP, not to this worker, so it is written down:
     Chrome stops the service worker after a few idle minutes, and a forgotten
     cooldown means the next click walks straight back into the same penalty. */
  const TRADE_BLOCK_KEY = 'ptcTradeBlockedUntil';
  let tradeBlockedUntil = 0;
  let tradeBlockedFor = 0;

  function tradeBlockRemaining() {
    return Math.max(0, tradeBlockedUntil - Date.now());
  }

  function tradeBlockMessage() {
    const remaining = tradeBlockRemaining();
    if (!remaining) return '';
    const minutes = Math.ceil(remaining / 60000);
    return 'The trade site is rate limiting this IP. It asked us to wait '
      + Math.ceil(remaining / 1000) + ' seconds'
      + (minutes > 1 ? ' (about ' + minutes + ' minutes)' : '') + '.';
  }

  /*
   * The trade API sends the limits and the current usage on every response:
   *   X-Rate-Limit-Ip:       8:10:60,15:60:120,60:300:1800,600:10800:3600
   *   X-Rate-Limit-Ip-State: 1:10:0,1:60:0,1:300:0,17:10800:0
   * Each entry is limit:windowSeconds:penaltySeconds (the state says how many
   * of that window are used), so the next request can be paced before it turns
   * into a 429 instead of after.
   */
  const RATE_HEADER_PAIRS = [
    ['x-rate-limit-ip', 'x-rate-limit-ip-state'],
    ['x-rate-limit-account', 'x-rate-limit-account-state'],
  ];

  function rateLimitEntries(value) {
    return String(value || '')
      .split(',')
      .map((entry) => entry.split(':').map((part) => Number(part.trim())))
      .filter((parts) => parts.length >= 2 && parts.every((part) => Number.isFinite(part)));
  }

  function rateLimitWaitFromHeaders(headers) {
    if (!headers || typeof headers.get !== 'function') return 0;
    let wait = 0;
    const retry = headers.get('retry-after');
    if (retry) {
      const seconds = Number(retry);
      const retryMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now();
      if (Number.isFinite(retryMs) && retryMs > wait) wait = retryMs;
    }
    RATE_HEADER_PAIRS.forEach((pair) => {
      const limits = rateLimitEntries(headers.get(pair[0]));
      const states = rateLimitEntries(headers.get(pair[1]));
      limits.forEach((limit, index) => {
        const state = states[index];
        if (!state) return;
        const max = limit[0];
        const windowMs = limit[1] * 1000;
        const used = state[0];
        if (!Number.isFinite(max) || !Number.isFinite(used)) return;
        /* Full: nothing else fits in this window. Close: a short pause is
           enough to land the next request in the following window. */
        if (used >= max) wait = Math.max(wait, windowMs);
        else if (used >= max - 1) wait = Math.max(wait, 2000);
      });
    });
    return wait;
  }

  /* Pacing derived from the headers. It is not the penalty block: that one is
     for a 429 and is persisted; this is only "do not send yet". */
  let nextTradeRequestAt = 0;

  function noteRateLimitHeaders(response) {
    const wait = rateLimitWaitFromHeaders(response && response.headers);
    if (!wait) return 0;
    nextTradeRequestAt = Math.max(nextTradeRequestAt, Date.now() + Math.min(wait, 60000));
    return wait;
  }

  async function waitForTradePacing() {
    const wait = nextTradeRequestAt - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 60000)));
  }

  function noteTradeRateLimit(body, response) {
    const match = /wait (\d+) seconds/i.exec(String(body || ''));
    const fromBody = (match ? Number(match[1]) : 60) * 1000;
    const fromHeaders = rateLimitWaitFromHeaders(response && response.headers);
    const wait = Math.min(TRADE_BLOCK_MAX, Math.max(TRADE_BLOCK_MIN, Math.max(fromBody, fromHeaders)));
    tradeBlockedUntil = Date.now() + wait;
    tradeBlockedFor = wait;
    lastTrade429At = Date.now();
    chrome.storage.local.set({ [TRADE_BLOCK_KEY]: tradeBlockedUntil }).catch(() => {});
    return wait;
  }

  /* Reads back the cooldown a previous worker wrote, so the block survives the
     worker being stopped between two clicks. */
  async function restoreTradeBlock() {
    try {
      const stored = await chrome.storage.local.get({ [TRADE_BLOCK_KEY]: 0 });
      const until = Number(stored[TRADE_BLOCK_KEY]) || 0;
      if (until > Date.now() && until > tradeBlockedUntil) {
        tradeBlockedUntil = until;
        tradeBlockedFor = until - Date.now();
      }
    } catch (error) {
      /* storage unavailable */
    }
  }

  /* Throws before a request goes out when the site asked us to slow down. */
  function assertTradeNotBlocked() {
    const remaining = tradeBlockRemaining();
    if (!remaining) return;
    const error = new Error(tradeBlockMessage());
    error.rateLimited = true;
    error.retryAfter = remaining;
    throw error;
  }

  // Icon lookups are persisted in a queue: Chrome stops the service worker whenever
  // it feels idle, so an import of a dozen items must survive being interrupted in
  // the middle of a fetch instead of leaving the rest of the build without artwork.
  const ICON_QUEUE_KEY = 'ptcIconQueue';
  const ICON_MISS_KEY = 'ptcIconMiss';
  const ICON_QUEUE_LIMIT = 400;
  const ICON_RUN_LIMIT = 20;
  const ICON_JOB_ATTEMPTS = 4;
  const ICON_RETRY_BASE = 45000;
  const ICON_RETRY_MAX = 30 * 60 * 1000;
  const ICON_MISS_TTL = 7 * 24 * 60 * 60 * 1000;
  const ICON_COOLDOWN = 2 * 60 * 1000;
  const ICON_ALARM = 'ptc-icon-queue';
  let iconQueueRunning = false;

  function tradeApiRoot(game) {
    return globalThis.PTC_GAMES.config(game).apiRoot;
  }

  function tradeRealm(game) {
    const realm = globalThis.PTC_GAMES.config(game).realm;
    return realm ? realm + '/' : '';
  }

  /*
   * The league of every search, in order of trust: what the caller asked for, the league
   * configured in the settings, the league of the trade tab that is open right now, and
   * the last league a search actually succeeded in. Only then Standard, which is what
   * produced the useless .../search/poe2/Standard/ links for imported items.
   */
  async function resolveLeague(game, requested) {
    const version = gameOf(game);
    const explicit = cleanText(requested, 80);
    if (explicit) return explicit;
    let hardcore = false;
    try {
      const settings = await getSettings();
      const prefs = globalThis.PTC_SETTINGS.leaguePrefs(settings, version);
      hardcore = prefs.hardcore;
      if (prefs.mode === 'manual' && prefs.league) return prefs.league;
      const fallback = cleanText(settings.fallbackLeague && settings.fallbackLeague[version], 80);
      if (fallback) return fallback;
    } catch (error) {
      /* settings unavailable */
    }
    const stored = await chrome.storage.local.get({ [ACTIVE_KEY]: null, [LAST_LEAGUE_KEY]: {} }).catch(() => ({}));
    const active = stored[ACTIVE_KEY];
    if (active && gameOf(active.game) === version) {
      const league = cleanText(active.league, 80);
      if (league) return league;
    }
    const last = cleanText((stored[LAST_LEAGUE_KEY] && typeof stored[LAST_LEAGUE_KEY] === 'object')
      ? stored[LAST_LEAGUE_KEY][version]
      : '', 80);
    /* A remembered league that is just a permanent mode (Standard, Hardcore,
       and for PoE 1 also Ruthless) is not evidence of where the player is
       playing - it is what the old fallback stored whenever a search found
       nothing. The live league list knows the current challenge league, so
       that is what an automatic setup follows. */
    if (last && !globalThis.PTC_GAMES.isPermanentLeague(version, last)
      && !/^(hc\s+)?(standard|hardcore)$/i.test(last)) return last;
    try {
      const registry = await getLeagueRegistry(version);
      const picked = pickPreferredLeague(registry, hardcore);
      if (picked) return picked;
    } catch (error) {
      /* offline: the remembered value is the best that can be said */
    }
    return last;
  }

  /* ------------------------------------------------------------------ */
  /* League registry                                                      */
  /* ------------------------------------------------------------------ */

  /* The trade site publishes the list of playable leagues. Fetching it once
     removes the need to type a league name by hand and lets the extension
     offer the current league plus its Hardcore twin. */
  /* The registry is stored per game so switching games never shows the other
     game's leagues. Older installs kept a single slot; readLeagueMap migrates
     that shape on first read. */
  async function readLeagueMap() {
    const stored = await chrome.storage.local.get({ [LEAGUES_KEY]: null }).catch(() => ({}));
    const raw = stored && stored[LEAGUES_KEY];
    if (!raw || typeof raw !== 'object') return {};
    if (Array.isArray(raw.leagues)) return { [gameOf(raw.game)]: raw };
    return raw;
  }

  async function fetchLeagueRegistry(game) {
    const version = gameOf(game);
    const cfg = globalThis.PTC_GAMES.config(version);
    const url = globalThis.PTC_GAMES.leaguesApiUrl(version);
    const response = await fetchWithTimeout(url, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    }, 12000);
    if (!response.ok) throw new Error('trade site HTTP ' + response.status);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : (payload && payload.result) || [];
    /* PoE 1 publishes the same league names for pc, xbox and sony; only the PC
       realm is relevant here, otherwise the list is full of duplicates. */
    const wantRealm = cfg.leagueRealm;
    const leagues = [];
    rows.forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const realm = cleanText(row.realm, 20) || wantRealm;
      if (realm !== wantRealm) return;
      const id = cleanText(row.id, 80);
      if (!id) return;
      leagues.push({
        id,
        text: cleanText(row.text, 80) || id,
        realm,
        /* PoE 2 names hardcore leagues "HC …", PoE 1 names them "Hardcore …". */
        hardcore: /^(hc\s|hardcore\b)/i.test(id),
      });
    });
    if (!leagues.length) throw new Error('no leagues in response');
    const registry = {
      game: version,
      leagues,
      fetchedAt: Date.now(),
    };
    const map = await readLeagueMap();
    map[version] = registry;
    await chrome.storage.local.set({ [LEAGUES_KEY]: map });
    return registry;
  }

  async function getLeagueRegistry(game, force) {
    const version = gameOf(game);
    const map = await readLeagueMap();
    const registry = map[version];
    const fresh = !force && registry
      && Date.now() - (registry.fetchedAt || 0) < LEAGUE_TTL
      && Array.isArray(registry.leagues) && registry.leagues.length;
    let staleBecauseOfNewLeague = false;
    if (fresh) {
      /* The player is trading in a league the cached list does not know -
         a new league went live (or the list was cached across a restart).
         The cache is wrong by definition, so refresh instead of serving it. */
      try {
        const stored = await chrome.storage.local.get({ [ACTIVE_KEY]: null }).catch(() => ({}));
        const active = stored[ACTIVE_KEY];
        if (active && gameOf(active.game) === version) {
          const league = cleanText(active.league, 80);
          if (league && !registry.leagues.some((entry) => entry.id === league)) {
            staleBecauseOfNewLeague = true;
          }
        }
      } catch (error) {
        /* keep the cached list */
      }
    }
    if (fresh && !staleBecauseOfNewLeague) return registry;
    try {
      return await fetchLeagueRegistry(version);
    } catch (error) {
      if (registry && Array.isArray(registry.leagues) && registry.leagues.length) return registry;
      throw error;
    }
  }

  /* Picks the league the user most likely means: the current challenge league
     (the first entry that is not a permanent mode), matching the hardcore
     preference. When no challenge league is live yet - e.g. PoE 1 between
     leagues - it falls back to Standard rather than a permanent variant like
     Ruthless. */
  function pickPreferredLeague(registry, hardcore) {
    const list = (registry && registry.leagues) || [];
    const game = gameOf(registry && registry.game);
    const filtered = list.filter((entry) => entry.hardcore === !!hardcore);
    const pool = filtered.length ? filtered : list;
    if (!pool.length) return '';
    const standard = pool.find((entry) => /^standard$/i.test(entry.id));
    const challenge = pool.filter((entry) => !globalThis.PTC_GAMES.isPermanentLeague(game, entry.id));
    return (challenge[0] || standard || pool[0]).id;
  }

  function rememberLeague(game, league) {
    const version = gameOf(game);
    const value = cleanText(league, 80);
    if (!value) return;
    chrome.storage.local.get({ [LAST_LEAGUE_KEY]: {} }).then((stored) => {
      const current = stored[LAST_LEAGUE_KEY];
      const map = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
      if (map[version] === value) return;
      map[version] = value;
      return chrome.storage.local.set({ [LAST_LEAGUE_KEY]: map });
    }).catch(() => {});
  }

  async function tradeSearchThrottle() {
    await waitForTradePacing();
    const wait = TRADE_SEARCH_GAP - (Date.now() - lastTradeSearchAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastTradeSearchAt = Date.now();
  }

  function tradeApiMessage(status, body) {
    if (status === 429) return 'The trade site is rate limiting requests. Try again in a few seconds.';
    try {
      const parsed = JSON.parse(body);
      const message = parsed && parsed.error && parsed.error.message;
      if (message) return String(message);
    } catch (error) {
      /* not JSON */
    }
    return 'The trade site refused the search (HTTP ' + status + ').';
  }

  /*
   * Stat filters for items that only exist as text (Path of Building imports). The trade
   * site lists its modifiers at /data/stats as "+# to maximum Life"; a modifier line is
   * matched to them by text with the numbers replaced by "#", so the search can look for
   * the item itself instead of only its base type.
   */
  const TRADE_STATS_KEY = 'ptcTradeStatsV3';
  /* The trade site names every stat with an id that changes with every patch
     (a league restart changes them all), so a table that is a day old holds
     ids the site no longer knows - it then ignores the filters and the search
     shows every item of the base. Keep the table fresh. */
  const TRADE_STATS_TTL = 2 * 60 * 60 * 1000;
  const statsMemo = new Map();

  /* The site publishes the base types it knows. A build import carries the
     base name the build code has, and a small wording difference ("Grand
     Regalia" against "Grand Regalia" with a rune prefix, for example) makes
     the site answer "Unknown item base type". The list is also the only
     reliable source for the category a base belongs to. */
  const TRADE_ITEMS_TTL = 24 * 60 * 60 * 1000;
  let tradeItemsMemo = null;

  async function loadTradeItems(game) {
    const version = gameOf(game);
    if (tradeItemsMemo && tradeItemsMemo.game === version
      && Date.now() - tradeItemsMemo.at < TRADE_ITEMS_TTL) return tradeItemsMemo;
    const response = await fetchWithTimeout(tradeApiRoot(version) + '/data/items',
      { headers: { Accept: 'application/json' } }, 20000);
    if (!response.ok) throw new Error('Trade items unavailable (' + response.status + ').');
    const data = await response.json();
    const byType = new Map();
    const categories = new Map();
    asArray(data && data.result).forEach((group) => {
      const category = cleanText(group && group.id, 60);
      asArray(group && group.entries).forEach((entry) => {
        const type = cleanText(entry && entry.type, 140);
        if (!type) return;
        const key = type.toLowerCase();
        if (!byType.has(key)) byType.set(key, type);
        if (!categories.has(key)) categories.set(key, category);
      });
    });
    tradeItemsMemo = { game: version, at: Date.now(), byType: byType, categories: categories };
    return tradeItemsMemo;
  }

  async function resolveTradeBaseType(game, type) {
    const clean = cleanTradeBase(type);
    if (!clean) return { type: '', category: '' };
    try {
      const items = await loadTradeItems(game);
      const key = clean.toLowerCase();
      const hit = items.byType.get(key);
      if (hit) return { type: hit, category: items.categories.get(key) || '' };
      /* A base the build code names slightly differently ("Grand Regalia"
         against "Runemastered Grand Regalia") still finds its type, as long as
         exactly one base matches - a guess would search for the wrong item. */
      const matches = [];
      items.byType.forEach((value, other) => {
        if (matches.length > 1) return;
        if (other.indexOf(key) !== -1 || key.indexOf(other) !== -1) matches.push(other);
      });
      if (matches.length === 1) {
        const other = matches[0];
        return { type: items.byType.get(other), category: items.categories.get(other) || '' };
      }
      return { type: '', category: '' };
    } catch (error) {
      /* The list is a nicety; without it the search still runs. */
      return { type: clean, category: '' };
    }
  }

  function tradeStatKey(text) {
    /* The same canonical form the Craft of Exile lookup uses, so a modifier
       line written by Path of Building finds the trade site's stat as well. */
    if (typeof globalThis !== 'undefined' && globalThis.PTC_MODTEXT) {
      return globalThis.PTC_MODTEXT.canonical(text);
    }
    return String(text == null ? '' : text)
      .replace(/\[([^\]|]+)(?:\|([^\]]+))?\]/g, (match, key, display) => display || key)
      .toLowerCase()
      .replace(/\(local\)/g, '')
      .replace(/[0-9]+(?:\.[0-9]+)?/g, '#')
      .replace(/[^a-z0-9#]+/g, '');
  }

  async function loadTradeStats(game) {
    const version = gameOf(game);
    const memo = statsMemo.get(version);
    if (memo && Date.now() - memo.at < TRADE_STATS_TTL) return memo.table;
    const stored = await chrome.storage.local.get({ [TRADE_STATS_KEY]: {} }).catch(() => ({}));
    const saved = stored[TRADE_STATS_KEY] && stored[TRADE_STATS_KEY][version];
    if (saved && saved.table && Date.now() - (Number(saved.at) || 0) < TRADE_STATS_TTL) {
      statsMemo.set(version, saved);
      return saved.table;
    }
    const response = await fetchWithTimeout(tradeApiRoot(version) + '/data/stats',
      { credentials: 'include', headers: { Accept: 'application/json' } }, 20000);
    if (!response.ok) throw new Error('Trade stats unavailable (' + response.status + ').');
    const data = await response.json();
    const table = {};
    const allowedGroups = globalThis.PTC_GAMES.config(version).statsGroups || ['explicit', 'fractured', 'desecrated'];
    asArray(data && data.result).forEach((group) => {
      const groupId = String((group && group.id) || '').toLowerCase();
      if (allowedGroups.indexOf(groupId) === -1) return;
      asArray(group.entries).forEach((entry) => {
        if (!entry || !entry.id || !entry.text) return;
        const key = tradeStatKey(entry.text);
        if (!key) return;
        const keys = [key];
        // Items print "+188 to Energy Shield" while the site lists "to maximum Energy Shield";
        // the collapsed spelling lets both forms share one bucket.
        const collapsed = key.replace(/tomaximum/g, 'to');
        if (collapsed !== key) keys.push(collapsed);
        keys.forEach((lookupKey) => {
          const list = table[lookupKey] || (table[lookupKey] = { explicit: [], other: [] });
          const bucket = groupId === 'explicit' ? list.explicit : list.other;
          if (bucket.indexOf(entry.id) === -1) bucket.push(entry.id);
        });
      });
    });
    const record = { at: Date.now(), table: table };
    statsMemo.set(version, record);
    const all = stored[TRADE_STATS_KEY] && typeof stored[TRADE_STATS_KEY] === 'object' ? stored[TRADE_STATS_KEY] : {};
    all[version] = record;
    chrome.storage.local.set({ [TRADE_STATS_KEY]: all }).catch(() => {});
    return table;
  }

  // Turns plain modifier lines into the trade site's stat filters. Each entry keeps
  // every stat id the line can mean (the site lists some modifiers twice) and the
  // roll, so the caller decides how strict the search is. A line the site does not
  // know is simply left out.
  async function buildTradeStats(game, lines) {
    const table = await loadTradeStats(game);
    const resolved = [];
    lines.forEach((line) => {
      const text = cleanText(line, 240);
      /* A line written by Path of Building can use either spelling, so every
         plausible key is tried before the modifier is given up on. */
      let entry = null;
      const keys = typeof globalThis !== 'undefined' && globalThis.PTC_MODTEXT
        ? globalThis.PTC_MODTEXT.candidates(text)
        : [tradeStatKey(text)];
      for (let i = 0; i < keys.length; i += 1) {
        const found = table[keys[i]];
        if (found) { entry = found; break; }
      }
      if (!entry) return;
      const ids = entry.explicit.length ? entry.explicit : entry.other;
      if (!ids.length) return;
      const first = Number((text.match(/-?\d+(?:\.\d+)?/) || [])[0]);
      resolved.push({
        ids: ids,
        value: Number.isFinite(first) && first > 0 ? first : null,
      });
    });
    return resolved;
  }

  /*
   * The stat filters of one strictness level. These are what the trade site
   * shows in its "Stats" panel, so the search page looks and behaves like the
   * one a saved listing carries: the same modifiers, rolled down a little as the
   * search gets looser. "all" requires every modifier, "most" and "some" require
   * a share of them, "one" just asks for a similar item.
   */
  function tradeStatGroups(resolved, mode) {
    if (!resolved.length) return [];
    const scale = mode === 'all' ? 0.9 : mode === 'most' ? 0.85 : mode === 'some' ? 0.8 : 0.7;
    const exact = [];
    const either = [];
    resolved.forEach((stat) => {
      let value = {};
      if (stat.value != null) {
        const scaled = stat.value >= 10
          ? Math.floor(stat.value * scale)
          : Math.floor(stat.value * scale * 10) / 10;
        if (scaled > 0) value = { min: scaled };
      }
      const filters = stat.ids.map((id) => ({ id: id, value: value, disabled: false }));
      if (filters.length === 1) exact.push(filters[0]);
      else either.push({ type: 'count', filters: filters, value: { min: 1 } });
    });
    const groups = [];
    if (exact.length) {
      if (mode === 'all') {
        groups.push({ type: 'and', filters: exact });
      } else {
        const ratio = mode === 'most' ? 0.75 : mode === 'some' ? 0.5 : 0;
        groups.push({
          type: 'count',
          filters: exact,
          value: { min: Math.max(1, Math.ceil(exact.length * ratio)) },
        });
      }
    }
    return groups.concat(either);
  }

  /* The map itself belongs to the PoE 2 profile: a game without one simply
     searches by base type and rarity. */
  function tradeCategoryFor(itemClass, categories) {
    const value = cleanText(itemClass, 80).toLowerCase();
    if (!value || !categories) return '';
    if (categories[value]) return categories[value];
    // The trade API spells some classes in the singular ("Sceptre"), the site in the plural.
    if (value.endsWith('s') && categories[value.slice(0, -1)]) return categories[value.slice(0, -1)];
    if (categories[value + 's']) return categories[value + 's'];
    return '';
  }

  const TRADE_RARITY_KEYS = ['normal', 'magic', 'rare', 'unique'];

  function tradeRarityKey(source) {
    const text = cleanText(source.rarity, 12).toLowerCase();
    if (TRADE_RARITY_KEYS.indexOf(text) !== -1) return text;
    const frame = Number(source.frameType);
    if (Number.isFinite(frame) && frame >= 0 && frame < TRADE_RARITY_KEYS.length) return TRADE_RARITY_KEYS[frame];
    return '';
  }

  /*
   * Path of Building writes the quality prefix into the base name ("Superior
   * Ancestral Tiara"), which the trade site does not know: it answers
   * "Unknown item base type". Strip it before the base is sent anywhere.
   */
  function cleanTradeBase(value) {
    return cleanText(value, 140)
      .replace(/^(superior|synthesised|fractured|replica)\s+/i, '')
      .trim();
  }

  /*
   * Creates a real search on the trade site and returns its canonical URL:
   *   https://www.pathofexile.com/trade[2]/search/[poe2/]<league>/<queryId>
   * The league lives in the path, so opening it shows the actual results for
   * that item instead of an empty search page that relies on a URL hash.
   *
   * The PoE2 schema does accept the base type in "query.type" (verified against
   * the live API: "Ancestral Tiara" returns that base only, an unknown base is
   * refused with "Unknown item base type"), so imports are searched by the same
   * base the item really is instead of every item class on the site.
   *
   * Every search is created from a ladder of filters, from the most precise to
   * the broadest, and the first one with results wins. That is what keeps an
   * imported item from landing on an empty page: a rare with six perfect mods
   * matches nothing, its base type always does.
   */
  async function createTradeQuery(options) {
    const source = options && typeof options === 'object' ? options : {};
    const game = gameOf(source.game);
    const base = await resolveTradeBaseType(game, source.type);
    const type = base.type;
    const name = cleanText(source.name, 140);
    const unique = !!source.unique && !!name && name.toLowerCase() !== type.toLowerCase();
    if (!type) return { ok: false, permanent: true, error: 'This item has no base type to search for.' };
    const preferred = await resolveLeague(game, source.league);
    // A build import carries the base, its rarity, its level and its modifier
    // lines. The modifiers are now translated into the site's own stat ids, so
    // the search can start with them; the ladder below loosens the filters
    // step by step, so an over-strict search still lands on results.
    const simple = !!source.simple;
    const modLines = asArray(source.mods).filter((line) => typeof line === 'string' && line.trim()).slice(0, 14);
    const statFilters = modLines.length ? await buildTradeStats(game, modLines).catch(() => []) : [];
    const rarity = tradeRarityKey(source);
    const ilvl = Math.max(0, Math.floor(Number(source.ilvl) || 0));
    const quality = Math.max(0, Math.floor(Number(source.quality) || 0));
    const corrupted = typeof source.corrupted === 'boolean' ? source.corrupted : null;
    /* Only a game whose profile carries a category map asks the site for one. */
    const categoryMap = globalThis.PTC_GAMES.profile(game).tradeCategoryByClass;
    const category = categoryMap ? (tradeCategoryFor(source.itemClass, categoryMap) || base.category) : '';
    const online = source.online === false ? SEARCH_STATUS_ANY : SEARCH_STATUS;
    /* One league only. A search that silently moves to Standard when the player's
       league has no similar item is worse than an empty page: the prices, the
       sellers and even the bases are from a different economy, and the URL looks
       like a normal result page. Standard is used only when no league could be
       worked out at all. */
    const leagues = [];
    const wantedLeague = cleanText(preferred, 80);
    if (wantedLeague) leagues.push(wantedLeague);
    else {
      try {
        const registry = await getLeagueRegistry(game);
        const picked = pickPreferredLeague(registry, false);
        if (picked) leagues.push(picked);
      } catch (error) {
        /* offline: fall back to Standard below */
      }
      if (!leagues.length) leagues.push('Standard');
    }
    const endpoint = tradeApiRoot(game) + '/search/' + tradeRealm(game);

    const buildBody = (opts) => {
      const flag = (key) => !!opts[key];
      const query = { status: { option: online } };
      if (unique) {
        if (flag('name')) query.name = name;
        if (flag('type')) query.type = type;
        if (flag('rarity')) {
          query.filters = { type_filters: { filters: { rarity: { option: 'unique' } } } };
        }
        return JSON.stringify({ query: query, sort: { price: 'asc' } });
      }
      if (flag('type')) query.type = type;
      const typeFilters = {};
      // A category next to a known base only conflicts when the guess is wrong,
      // and the base already says everything the category could.
      if (!flag('type') && flag('category') && category) typeFilters.category = { option: category };
      if (flag('rarity') && rarity) typeFilters.rarity = { option: rarity };
      if (flag('ilvl') && ilvl > 0) typeFilters.ilvl = { min: ilvl };
      if (flag('quality') && quality > 0) typeFilters.quality = { min: quality };
      if (Object.keys(typeFilters).length) query.filters = { type_filters: { filters: typeFilters } };
      if (flag('corrupted') && corrupted != null) {
        query.filters = query.filters || {};
        query.filters.misc_filters = { filters: { corrupted: { option: corrupted ? 'true' : 'false' } } };
      }
      if (flag('stats') && statFilters.length) {
        const groups = tradeStatGroups(statFilters, opts.statsMode || 'all');
        if (groups.length) query.stats = groups;
      }
      return JSON.stringify({ query: query, sort: { price: 'asc' } });
    };

    // Most precise first. Each step drops one filter that commonly empties a
    // rare item search; the last steps only keep the base, which always exists.
    const variants = unique
      ? [
          { name: true, type: true },
          { name: true },
          { type: true, rarity: true },
          { rarity: true },
        ]
      : simple
        ? [
            /* A build import knows its modifier lines. The search walks from the
               strictest level that can still match down to a single modifier, so
               the results are always similar items and never an unfiltered base
               list. Where it starts depends on how many modifiers there are (see
               startMode below). */
            { type: true, rarity: true, ilvl: true, stats: true, statsMode: 'all' },
            { type: true, rarity: true, stats: true, statsMode: 'most' },
            { type: true, rarity: true, stats: true, statsMode: 'some' },
            { type: true, stats: true, statsMode: 'one' },
            { type: true, rarity: true },
            { type: true },
          ]
        : [
            { type: true, rarity: true, ilvl: true, quality: true, corrupted: true, stats: true, statsMode: 'all' },
            { type: true, rarity: true, ilvl: true, quality: true, corrupted: true },
            { type: true, rarity: true, ilvl: true },
            { type: true, rarity: true },
            { type: true },
            { category: true, rarity: true },
            { rarity: true },
          ];

    let message = 'Could not create the trade search.';
    let fallback = null;
    /* A rare item with five or six modifiers can never match "all of them",
       because that asks for every roll to land within 90% of the imported one.
       The site would answer zero, and the only thing the attempt buys is another
       five-second pause before the user sees a page, so the ladder starts at the
       step that has a real chance of matching instead. */
    const startMode = statFilters.length >= 7 ? 'some' : statFilters.length >= 5 ? 'most' : '';
    const startAt = simple && startMode
      ? Math.max(0, variants.findIndex((entry) => entry.stats && entry.statsMode === startMode))
      : 0;
    /* One league, one pass down the ladder. Nothing here ever switches league:
       the search the user asked for is the search they get, even when it has no
       results, because a page from another league is simply the wrong page. */
    for (let leagueIndex = 0; leagueIndex < leagues.length; leagueIndex += 1) {
      const league = leagues[leagueIndex];
      const first = leagueIndex === 0 ? startAt : Math.max(0, variants.length - 1);
      for (let variantIndex = first; variantIndex < variants.length; variantIndex += 1) {
        const opts = variants[variantIndex];
        const request = {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: buildBody(opts),
        };
        let response;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await tradeSearchThrottle();
          if (tradeBlockRemaining()) return { ok: false, error: tradeBlockMessage() };
          try {
            response = await fetchWithTimeout(endpoint + encodeURIComponent(league), request, 15000);
          } catch (error) {
            return { ok: false, error: 'The trade site did not answer. Check your connection and try again.' };
          }
          if (response.status === 429) {
            const text = await response.text().catch(() => '');
            const wait = noteTradeRateLimit(text);
            // A short penalty is worth waiting out, a long one is not: the site
            // wants this IP to go quiet for minutes.
            if (wait > TRADE_RETRY_WAIT) return { ok: false, error: tradeBlockMessage() };
          }
          if (response.status !== 429 || attempt > 0) break;
          // Rate limited: wait for the window to pass and try this step again.
          await new Promise((resolve) => setTimeout(resolve, TRADE_RETRY_WAIT));
        }
        if (response.ok) {
          const data = await response.json().catch(() => null);
          const queryId = cleanQueryId(data && data.id);
          if (!queryId) return { ok: false, error: 'The trade site returned an empty search.' };
          const ids = Array.isArray(data.result) ? data.result.filter(Boolean).slice(0, 12) : [];
          const total = Number.isFinite(Number(data.total)) ? Number(data.total) : ids.length;
          const built = {
            ok: true,
            filtered: !!opts.stats && statFilters.length > 0,
            game: game,
            league: league,
            queryId: queryId,
            ids: ids,
            total: total,
            url: buildTradeUrl(game, league, queryId, false, await tradeUrlTemplate()),
          };
          if (total > 0) {
            rememberLeague(game, league);
            return built;
          }
          /* Nothing matched this step. The looser steps below may still find a
             similar item, so the search keeps going; the widest query that did
             come back is remembered in case none of them matches either, so the
             page the user lands on lists items instead of being empty. */
          if (!fallback || total >= fallback.total) fallback = built;
          // This step is valid but empty; the next, looser step may list something.
          continue;
        }
        const bodyText = await response.text().catch(() => '');
        message = tradeApiMessage(response.status, bodyText);
        // A 400 means this step's filters are unknown to the site (base type,
        // category, ...), which is exactly what the next, looser step is for.
        // Any other failure is not about the filters, so report it right away.
        if (response.status !== 400) return { ok: false, error: message };
      }
    }
    if (fallback) {
      rememberLeague(game, fallback.league);
      return fallback;
    }
    return { ok: false, error: message };
  }

  function handleTradeOpen(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return createTradeQuery(source).then(async (result) => {
      if (!result.ok) return result;
      const id = cleanId(source.id, 200);
      if (!id) return result;
      // Keep the record pointing at the search that was just created, so the
      // "Find similar" link, the watcher and the viewer all reuse the same query.
      await enqueue(async () => {
        const items = await getItems();
        const rec = items.find((entry) => entry && entry.id === id);
        if (!rec) return;
        rec.searchUrl = result.url;
        rec.queryId = result.queryId;
        rec.league = result.league;
        rec.game = result.game;
        await setItems(items);
      });
      return result;
    });
  }

  async function loadIconCache() {
    if (iconMemo.size) return iconMemo;
    const stored = await chrome.storage.local.get({ [ICON_CACHE_KEY]: {} });
    const value = stored[ICON_CACHE_KEY];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.keys(value).forEach((key) => {
        const icon = cleanString(value[key], 2000);
        if (icon) iconMemo.set(key, icon);
      });
    }
    return iconMemo;
  }

  async function saveIconCache() {
    const entries = Array.from(iconMemo.entries()).slice(-ICON_CACHE_LIMIT);
    await chrome.storage.local.set({ [ICON_CACHE_KEY]: Object.fromEntries(entries) });
  }

  function iconCacheKey(game, league, type, name) {
    return [game, league || 'Standard', type, name || ''].join('|').toLowerCase();
  }

  /*
   * Path of Building stores no artwork, and the trade data endpoints do not
   * publish base type icons, so the icon is read from a real listing: create a
   * search for the item, fetch its cheapest result and keep that item's icon.
   */
  async function fetchTradeItemIcon(info) {
    const source = info && typeof info === 'object' ? info : {};
    const game = gameOf(source.game);
    const type = cleanText(source.type, 140);
    if (!type) return { icon: '', permanent: true };
    /* The site asked this IP to slow down: do not touch it at all. */
    if (tradeBlockRemaining()) return { icon: '', permanent: false };
    const unique = !!source.unique && !!cleanText(source.name, 140);
    const cache = await loadIconCache();
    const key = iconCacheKey(game, source.league, type, unique ? source.name : '');
    if (cache.has(key)) return { icon: cache.get(key), permanent: false };
    let permanent = false;
    const lookup = async (withName) => {
      const search = await createTradeQuery({
        game: game,
        league: source.league,
        type: type,
        name: withName ? source.name : '',
        unique: withName,
        online: false,
      });
      if (!search.ok) {
        if (search.permanent) permanent = true;
        return '';
      }
      if (!search.ids.length) return '';
      const url = tradeApiRoot(game) + '/fetch/' + encodeURIComponent(search.ids[0])
        + '?query=' + encodeURIComponent(search.queryId);
      try {
        const response = await fetchWithTimeout(url, { credentials: 'include', headers: { Accept: 'application/json' } }, 15000);
        if (!response.ok) return '';
        const data = await response.json();
        const entry = Array.isArray(data.result) ? data.result.find(Boolean) : null;
        return cleanString(entry && entry.item && entry.item.icon, 2000);
      } catch (error) {
        return '';
      }
    };
    let icon = await lookup(unique);
    // A unique that nobody lists in that league still has a base type icon.
    if (!icon && unique) icon = await lookup(false);
    if (icon) {
      cache.set(key, icon);
      await saveIconCache();
    }
    return { icon: icon, permanent: !icon && permanent };
  }

  function isUniqueRecord(rec) {
    if (!rec) return false;
    if (rec.item && rec.item.frameType === 3) return true;
    return rec.rarity === 3;
  }

  function targetIconLookup(rec) {
    const type = (rec && rec.item && rec.item.baseType) || (rec && rec.typeLine) || '';
    if (!type) return null;
    const unique = isUniqueRecord(rec);
    const name = unique ? ((rec.item && rec.item.name) || rec.name || '') : '';
    const league = rec.league || '';
    const game = gameOf(rec.game);
    return {
      key: iconCacheKey(game, league, type, name),
      info: { game: game, league: league, type: type, name: name, unique: unique },
    };
  }

  async function getIconQueue() {
    const stored = await chrome.storage.local.get({ [ICON_QUEUE_KEY]: [] });
    return asArray(stored[ICON_QUEUE_KEY])
      .filter((job) => job && typeof job === 'object' && typeof job.key === 'string' && job.key)
      .slice(0, ICON_QUEUE_LIMIT);
  }

  async function setIconQueue(queue) {
    await chrome.storage.local.set({ [ICON_QUEUE_KEY]: asArray(queue).slice(0, ICON_QUEUE_LIMIT) });
  }

  // Base types the trade site does not know (typos, rare-only names, removed bases) are
  // remembered for a week so every later import does not retry them from scratch.
  async function loadIconMisses() {
    const stored = await chrome.storage.local.get({ [ICON_MISS_KEY]: {} });
    const raw = stored[ICON_MISS_KEY];
    const misses = new Map();
    const now = Date.now();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      Object.keys(raw).forEach((key) => {
        const at = Number(raw[key]) || 0;
        if (at && now - at < ICON_MISS_TTL) misses.set(key, at);
      });
    }
    return misses;
  }

  async function saveIconMisses(misses) {
    const entries = Array.from(misses.entries()).slice(-ICON_CACHE_LIMIT);
    await chrome.storage.local.set({ [ICON_MISS_KEY]: Object.fromEntries(entries) });
  }

  async function markIconMiss(key) {
    if (!key) return;
    const misses = await loadIconMisses();
    misses.set(key, Date.now());
    await saveIconMisses(misses);
  }

  async function applyIconToRecords(key, icon) {
    if (!key || !icon) return 0;
    // Re-read right before writing so a concurrent save is not clobbered.
    const items = await getItems();
    let changed = 0;
    items.forEach((rec) => {
      if (!rec || rec.icon) return;
      const lookup = targetIconLookup(rec);
      if (!lookup || lookup.key !== key) return;
      rec.icon = icon;
      if (rec.item && typeof rec.item === 'object') rec.item.icon = icon;
      changed += 1;
    });
    if (changed) await setItems(items);
    return changed;
  }

  async function pruneIconQueue() {
    const queue = await getIconQueue();
    if (!queue.length) return 0;
    const items = await getItems();
    const keys = new Set();
    items.forEach((rec) => {
      if (!rec || rec.icon) return;
      const lookup = targetIconLookup(rec);
      if (lookup) keys.add(lookup.key);
    });
    const next = queue.filter((job) => keys.has(job.key));
    const removed = queue.length - next.length;
    if (removed) await setIconQueue(next);
    return removed;
  }

  async function scheduleIconQueue(hasWork) {
    try {
      const pending = hasWork == null ? (await getIconQueue()).length > 0 : !!hasWork;
      if (!pending) {
        await chrome.alarms.clear(ICON_ALARM);
        return;
      }
      const existing = await chrome.alarms.get(ICON_ALARM);
      if (!existing) await chrome.alarms.create(ICON_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
    } catch (error) {
      /* alarms unavailable */
    }
  }

  // Adds every target of a build that still has no artwork to the queue and starts
  // working through it. Cached icons are attached immediately, without any request.
  async function queueTargetIcons(collectionId) {
    const id = cleanId(collectionId);
    const items = await getItems();
    const targets = items.filter((rec) => rec && (!id || rec.targetOf === id) && !rec.icon);
    if (!targets.length) return 0;
    const queue = await getIconQueue();
    const known = new Set(queue.map((job) => job.key));
    const misses = await loadIconMisses();
    const cache = await loadIconCache();
    const now = Date.now();
    let added = 0;
    for (const rec of targets) {
      const lookup = targetIconLookup(rec);
      if (!lookup) continue;
      const cached = cache.get(lookup.key);
      if (cached) {
        await applyIconToRecords(lookup.key, cached);
        continue;
      }
      if (known.has(lookup.key) || misses.has(lookup.key)) continue;
      known.add(lookup.key);
      queue.push({ key: lookup.key, info: lookup.info, attempts: 0, nextAt: now, addedAt: now });
      added += 1;
      if (queue.length >= ICON_QUEUE_LIMIT) break;
    }
    if (!added) return 0;
    await setIconQueue(queue);
    await scheduleIconQueue(true);
    processIconQueue().catch(() => {});
    return added;
  }

  /*
   * Works through the queue one lookup at a time. Each job is claimed in storage before
   * the request is made, so a worker that dies mid-fetch resumes with backoff instead of
   * hammering the trade site; a rate-limit answer pauses the whole queue for a while.
   */
  async function processIconQueue() {
    if (iconQueueRunning) return { ok: true, busy: true, applied: 0 };
    iconQueueRunning = true;
    let applied = 0;
    let handled = 0;
    try {
      await pruneIconQueue();
      for (;;) {
        if (handled >= ICON_RUN_LIMIT) break;
        if (lastTrade429At && Date.now() - lastTrade429At < ICON_COOLDOWN) break;
        let queue = await getIconQueue();
        if (!queue.length) break;
        const now = Date.now();
        const index = queue.findIndex((job) => (Number(job.nextAt) || 0) <= now);
        if (index < 0) break;
        const job = queue[index];
        handled += 1;
        // Claim the job by pushing its window forward. It is not an attempt yet: a worker
        // that dies mid-fetch must not burn one of the four tries.
        queue[index] = { ...job, nextAt: now + TRADE_SEARCH_GAP };
        await setIconQueue(queue);
        const outcome = await fetchTradeItemIcon(job.info).catch(() => ({ icon: '', permanent: false }));
        const icon = (outcome && outcome.icon) || '';
        const permanent = !!(outcome && outcome.permanent);
        queue = await getIconQueue();
        const at = queue.findIndex((entry) => entry.key === job.key);
        if (at < 0) continue;
        if (icon) {
          applied += await applyIconToRecords(job.key, icon);
          queue.splice(at, 1);
          await setIconQueue(queue);
          continue;
        }
        const attempts = (Number(queue[at].attempts) || 0) + 1;
        // A base type the trade site does not know will never succeed, so stop immediately
        // instead of retrying it on every wake for the rest of the session.
        if (permanent || attempts >= ICON_JOB_ATTEMPTS) {
          queue.splice(at, 1);
          await setIconQueue(queue);
          await markIconMiss(job.key);
        } else {
          const backoff = Math.min(ICON_RETRY_MAX, ICON_RETRY_BASE * Math.pow(2, attempts - 1));
          queue[at] = { ...queue[at], attempts: attempts, nextAt: Date.now() + backoff };
          await setIconQueue(queue);
        }
      }
    } catch (error) {
      /* best-effort: a failed lookup just leaves the item without an icon */
    } finally {
      iconQueueRunning = false;
      await scheduleIconQueue((await getIconQueue().catch(() => [])).length > 0);
    }
    return { ok: true, busy: false, applied: applied, handled: handled };
  }

  async function resumeIconQueue() {
    await pruneIconQueue();
    return processIconQueue();
  }

  // "Retry" in the panel: forget the recorded misses for this build and queue it again.
  async function retryTargetIcons(collectionId) {
    const id = cleanId(collectionId);
    const items = await getItems();
    const misses = await loadIconMisses();
    let cleared = 0;
    items.forEach((rec) => {
      if (!rec || rec.icon || (id && rec.targetOf !== id)) return;
      const lookup = targetIconLookup(rec);
      if (lookup && misses.delete(lookup.key)) cleared += 1;
    });
    if (cleared) await saveIconMisses(misses);
    const added = await queueTargetIcons(id);
    processIconQueue().catch(() => {});
    return { ok: true, added: added, cleared: cleared };
  }

  // Chrome stops the service worker whenever it is idle, so pick the queue back up on
  // every start instead of leaving an interrupted import without half of its artwork.
  try {
    chrome.runtime.onStartup.addListener(() => { resumeIconQueue().catch(() => {}); });
  } catch (error) {
    /* startup listener unavailable */
  }
  resumeIconQueue().catch(() => {});

  /* ------------------------------------------------------------------ */
  /* Build page capture: links and artwork from the user's open tab      */
  /* ------------------------------------------------------------------ */

  const CAPTURE_ORIGINS = ['https://mobalytics.gg/*', 'https://*.mobalytics.gg/*'];
  const CAPTURE_PAGE_HOST = /^https?:\/\/([a-z0-9-]+\.)*mobalytics\.gg\//i;

  /*
   * Runs inside the build page. The planner already links every item to the trade
   * search it built for that item and shows its artwork, so both can be read from the
   * DOM with no request at all. Everything comes back as plain strings and is validated
   * again in the worker, because page content is untrusted.
   */
  function readBuildPageTradeLinks() {
    const text = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const out = [];
    const seen = new Set();
    const anchors = document.querySelectorAll('a[href*="pathofexile.com/trade"]');
    for (let i = 0; i < anchors.length && out.length < 80; i += 1) {
      const anchor = anchors[i];
      const url = anchor.href || '';
      if (!/^https:\/\/www\.pathofexile\.com\/trade/.test(url) || seen.has(url)) continue;
      let icon = '';
      let label = '';
      let alt = '';
      // Climb until the ancestor holds more than one trade link: that is the item card.
      let card = anchor.parentElement;
      for (let depth = 0; card && depth < 6; depth += 1) {
        if (card.querySelectorAll('a[href*="pathofexile.com/trade"]').length > 1) break;
        const img = card.querySelector('img');
        if (img) {
          const src = img.currentSrc || img.src || '';
          if (/^https:\/\/(?:[a-z0-9-]+\.)*poecdn\.com\//i.test(src)) icon = src;
          if (!alt) alt = text(img.alt);
        }
        const body = text(card.textContent);
        if (body) label = body.slice(0, 160);
        if (icon && label) break;
        card = card.parentElement;
      }
      seen.add(url);
      out.push({ url: url, icon: icon, label: label, alt: alt });
    }
    return { title: text(document.title).slice(0, 120), items: out };
  }

  function safeTradeUrl(value) {
    const url = cleanString(value, 2000);
    if (!/^https:\/\/www\.pathofexile\.com\/trade/i.test(url)) return '';
    return url;
  }

  function safePageIcon(value) {
    const url = cleanString(value, 2000);
    if (!/^https:\/\/(?:[a-z0-9-]+\.)*poecdn\.com\//i.test(url)) return '';
    return url;
  }

  async function captureBuildPage() {
    const granted = await chrome.permissions.contains({ origins: CAPTURE_ORIGINS }).catch(() => false);
    if (!granted) return { ok: false, needsPermission: true, error: 'Access to the build page is needed first.' };
    const tabs = await chrome.tabs.query({}).catch(() => []);
    const tab = asArray(tabs).find((entry) => entry && entry.id != null
      && typeof entry.url === 'string' && CAPTURE_PAGE_HOST.test(entry.url));
    if (!tab) return { ok: false, error: 'Open the build page on Mobalytics, then try again.' };
    let injected = null;
    try {
      injected = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readBuildPageTradeLinks });
    } catch (error) {
      return { ok: false, error: 'The build page could not be read. Reload it and try again.' };
    }
    const pageResult = asArray(injected)[0] && asArray(injected)[0].result;
    const items = asArray(pageResult && pageResult.items);
    if (!items.length) {
      return { ok: false, error: 'No trade links found on that page. Open the build tab and expand its items.' };
    }
    return { ok: true, title: cleanText(pageResult && pageResult.title, 120), items: items };
  }

  function normalizePageName(value) {
    return cleanText(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /*
   * Matches the page's item cards to the imported targets and stores their search link
   * and artwork, so an import from a build page needs no trade request at all.
   */
  async function applyBuildPageCapture(collectionId) {
    const captured = await captureBuildPage();
    if (!captured.ok) return captured;
    const id = cleanId(collectionId);
    const candidates = [];
    captured.items.forEach((entry) => {
      const url = safeTradeUrl(entry && entry.url);
      if (!url) return;
      candidates.push({ url: url, icon: safePageIcon(entry.icon), label: entry.label, alt: entry.alt });
    });
    if (!candidates.length) {
      return { ok: false, error: 'No trade links found on that page. Open the build tab and expand its items.' };
    }
    const items = await getItems();
    const used = new Set();
    let links = 0;
    let icons = 0;
    items.forEach((rec) => {
      if (!rec || (id && rec.targetOf !== id)) return;
      const base = normalizePageName((rec.item && rec.item.baseType) || rec.typeLine);
      const unique = normalizePageName((rec.item && rec.item.name) || rec.name);
      if (!base && !unique) return;
      let best = null;
      let bestScore = 0;
      candidates.forEach((entry) => {
        if (used.has(entry.url)) return;
        [normalizePageName(entry.label), normalizePageName(entry.alt)].forEach((label) => {
          if (label.length < 4) return;
          let score = 0;
          if (unique.length >= 4 && label === unique) score = 5;
          else if (base.length >= 4 && label === base) score = 4;
          else if (unique.length >= 4 && label.indexOf(unique) === 0) score = 3;
          else if (base.length >= 4 && label.indexOf(base) === 0) score = 2;
          else if (base.length >= 4 && label.indexOf(base) > 0) score = 1;
          if (score > bestScore) { bestScore = score; best = entry; }
        });
      });
      if (!best) return;
      used.add(best.url);
      rec.searchUrl = best.url;
      const parsed = parseTradeUrl(best.url);
      if (parsed && parsed.league) rec.league = parsed.league;
      if (parsed && parsed.game) rec.game = parsed.game;
      links += 1;
      const icon = best.icon;
      if (icon && !rec.icon) {
        rec.icon = icon;
        if (rec.item && typeof rec.item === 'object') rec.item.icon = icon;
        icons += 1;
      }
    });
    if (links || icons) await setItems(items);
    return { ok: true, links: links, icons: icons, found: captured.items.length, title: captured.title };
  }

  function handleDelete(id) {
  return enqueue(async () => {
    const items = await getItems();
    const next = items.filter((entry) => entry.id !== id);
    if (next.length !== items.length) await setItems(next);
    return { ok: true, count: next.length };
  });
}

function handleClear(game, options) {
  return enqueue(async () => {
    /* "Delete all saved items" keeps the gear imported from build codes alive:
       that gear lives in PoB Builds now, not in the list the button belongs to. */
    const keepImported = !!(options && options.keepImported);
    const items = await getItems();
    const survivor = (rec) => keepImported && rec && rec.targetOf;
    if (game == null || game === '') {
      const kept = items.filter(survivor);
      await setItems(kept);
      return { ok: true, count: kept.length };
    }
    const resolved = gameOf(game);
    const kept = items.filter((rec) => gameOf(rec) !== resolved || survivor(rec));
    await setItems(kept);
    return { ok: true, count: kept.length };
  });
}

function handleCollectionCreate(name, ascendancy, game) {
  return enqueue(async () => {
    const value = cleanName(name);
    if (!value) return { ok: false, error: 'Enter a build name.' };
    const resolved = gameOf(game);
    const collections = await getCollections();
    if (collections.length >= MAX_COLLECTIONS) {
      return { ok: false, error: 'Too many builds (max ' + MAX_COLLECTIONS + ').' };
    }
    if (collections.some((entry) => gameOf(entry) === resolved && entry.name.toLowerCase() === value.toLowerCase())) {
      return { ok: false, error: 'A build with this name already exists.' };
    }
    const collection = { id: makeCollectionId(), name: value, game: resolved, createdAt: Date.now(), updatedAt: Date.now() };
    const asc = sanitizeAscendancy(ascendancy);
    if (asc) collection.ascendancy = asc;
    collections.push(collection);
    await setCollections(collections);
    return { ok: true, collection };
  });
}

/* Ascendancy artwork comes from the two item databases. A backup file is
   user-editable, so any other address is dropped instead of being loaded. */
const ASCENDANCY_ICON_HOSTS = ['cdn.poe2db.tw', 'cdn.poedb.tw'];

function safeAscendancyIcon(value) {
  const raw = cleanString(value, 500);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase();
    return ASCENDANCY_ICON_HOSTS.indexOf(host) !== -1 ? raw : '';
  } catch (error) {
    return '';
  }
}

function sanitizeAscendancy(value) {
  if (!value || typeof value !== 'object') return null;
  const name = cleanName(value.ascendancy);
  if (!name) return null;
  return {
    ascendancy: name,
    ascendancyClass: cleanName(value.ascendancyClass),
    ascendancyIcon: safeAscendancyIcon(value.ascendancyIcon),
  };
}

function handleCollectionRename(id, name) {
  return enqueue(async () => {
    const value = cleanName(name);
    if (!value) return { ok: false, error: 'Enter a build name.' };
    const collections = await getCollections();
    const collection = collections.find((entry) => entry.id === id);
    if (!collection) return { ok: false, error: 'Build not found.' };
    if (collections.some((entry) => entry.id !== id && entry.name.toLowerCase() === value.toLowerCase())) {
      return { ok: false, error: 'A build with this name already exists.' };
    }
    collection.name = value;
    collection.updatedAt = Date.now();
    await setCollections(collections);
    return { ok: true, collection };
  });
}

function sanitizeCollection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  const collection = {
    id: cleanId(raw.id) || makeCollectionId(),
    name: name,
    game: gameOf(raw.game),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
  };
  const asc = sanitizeAscendancy(raw.ascendancy);
  if (asc) collection.ascendancy = asc;
  if (typeof raw.notes === 'string') collection.notes = cleanText(raw.notes, 2000);
  const goals = sanitizeGoals(raw.goals);
  if (goals.length) collection.goals = goals;
  const gear = sanitizeGear(raw.gear);
  if (gear.length) collection.gear = gear;
  return collection;
}

function sanitizeGoals(value) {
  const out = [];
  (Array.isArray(value) ? value : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const name = cleanName(entry.name);
    if (!name) return;
    out.push({
      id: cleanId(entry.id) || makeId('gl'),
      name,
      done: !!entry.done,
    });
    if (out.length >= 50) return;
  });
  return out;
}

function sanitizeGear(value) {
  const out = [];
  (Array.isArray(value) ? value : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const baseType = cleanName(entry.baseType);
    if (!baseType) return;
    const stats = entry.stats && typeof entry.stats === 'object' ? entry.stats : {};
    const cleanStats = {};
    ['life', 'es', 'mana', 'fireRes', 'coldRes', 'lightningRes', 'chaosRes', 'ilvl'].forEach((key) => {
      if (typeof stats[key] === 'number' && Number.isFinite(stats[key])) cleanStats[key] = stats[key];
    });
    out.push({
      slot: cleanText(entry.slot, 40),
      baseType: baseType,
      name: cleanName(entry.name) || baseType,
      rarity: cleanText(entry.rarity, 20),
      ilvl: typeof entry.ilvl === 'number' && Number.isFinite(entry.ilvl) ? entry.ilvl : (cleanStats.ilvl != null ? cleanStats.ilvl : null),
      stats: cleanStats,
    });
    if (out.length >= 30) return;
  });
  return out;
}

function handleCollectionUpdate(id, patch) {
  return enqueue(async () => {
    const collections = await getCollections();
    const collection = collections.find((entry) => entry.id === id);
    if (!collection) return { ok: false, error: 'Build not found.' };
    if (patch && typeof patch.notes === 'string') collection.notes = cleanText(patch.notes, 2000);
    if (patch && patch.game) collection.game = gameOf(patch.game);
    if (patch && patch.ascendancy !== undefined) {
      const asc = sanitizeAscendancy(patch.ascendancy);
      if (asc) collection.ascendancy = asc;
      else delete collection.ascendancy;
    }
    if (patch && Array.isArray(patch.goals)) collection.goals = sanitizeGoals(patch.goals);
    if (patch && Array.isArray(patch.gear)) collection.gear = sanitizeGear(patch.gear);
    else if (patch && patch.gear === null) delete collection.gear;
    if (patch && typeof patch.name === 'string' && cleanName(patch.name)) {
      const value = cleanName(patch.name);
      if (collections.some((entry) => entry.id !== id && entry.name.toLowerCase() === value.toLowerCase())) {
        return { ok: false, error: 'A build with this name already exists.' };
      }
      collection.name = value;
    }
    collection.updatedAt = Date.now();
    await setCollections(collections);
    return { ok: true, collection };
  });
}

function handleCollectionDelete(id) {
  return enqueue(async () => {
    const collections = await getCollections();
    const nextCollections = collections.filter((entry) => entry.id !== id);
    if (nextCollections.length === collections.length) return { ok: true, moved: 0, removed: 0 };
    await setCollections(nextCollections);
    const items = await getItems();
    let moved = 0;
    let removed = 0;
    /* Imported gear belongs to the build: without the build it would have no
       home in the panel (PoB Builds lists it per build, Saved items filters it
       out), so it goes with the build. Saved listings that were assigned to it
       stay, unsorted. */
    const nextItems = [];
    items.forEach((entry) => {
      if (entry.targetOf === id) { removed += 1; return; }
      if (entry.collectionId === id) {
        moved += 1;
        nextItems.push({ ...entry, collectionId: '' });
        return;
      }
      nextItems.push(entry);
    });
    if (moved || removed) await setItems(nextItems);
    return { ok: true, moved, removed };
  });
}

const COE_TEXT_KEY = 'ptcCoeText';
const COE_TEXT_TTL = 12 * 60 * 60 * 1000;

/*
 * Reads a Craft of Exile data file (the site's own public files) and keeps it in the
 * profile for 12 hours so opening several items does not download it every time.
 */
async function coeFetchText(url) {
  const target = cleanString(url, 400);
  if (!/^https:\/\/beta\.craftofexile\.com\//i.test(target)) {
    throw new Error('Unexpected Craft of Exile data link.');
  }
  const cached = await chrome.storage.local.get({ [COE_TEXT_KEY]: {} });
  const store = cached[COE_TEXT_KEY] && typeof cached[COE_TEXT_KEY] === 'object' ? cached[COE_TEXT_KEY] : {};
  const hit = store[target];
  if (hit && typeof hit.text === 'string' && Date.now() - (Number(hit.at) || 0) < COE_TEXT_TTL) return hit.text;
  const response = await fetchWithTimeout(target, { headers: { Accept: 'text/plain, application/json' } }, 30000);
  if (!response.ok) throw new Error('Craft of Exile data HTTP ' + response.status);
  const text = await response.text();
  if (!text || text.length < 100) throw new Error('Craft of Exile returned an empty data file.');
  store[target] = { at: Date.now(), text: text };
  const keys = Object.keys(store).sort((a, b) => (store[b].at || 0) - (store[a].at || 0));
  keys.slice(6).forEach((key) => delete store[key]);
  await chrome.storage.local.set({ [COE_TEXT_KEY]: store });
  return text;
}

async function coeAccessGranted() {
  const origin = 'https://beta.craftofexile.com/*';
  if (!chrome.permissions || !chrome.permissions.contains) return true;
  try {
    return await chrome.permissions.contains({ origins: [origin] });
  } catch (error) {
    return false;
  }
}

  /*
   * The trade site reads the query id of a search url as the gzip of the query
   * JSON, in base64url - the same way it writes it. Encoding one here means a
   * search can be opened without asking the api anything: the site reads the
   * query out of the url and runs it itself. The site's own CompressionStream
   * is used, so the id is written exactly the way the site writes it.
   */
  async function encodeTradeQueryId(query) {
    try {
      if (typeof CompressionStream !== 'function' || typeof TextEncoder !== 'function') return '';
      const bytes = new TextEncoder().encode(JSON.stringify(query));
      const stream = new CompressionStream('gzip');
      const writer = stream.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const chunks = [];
      const reader = stream.readable.getReader();
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
      }
      let total = 0;
      chunks.forEach((chunk) => { total += chunk.length; });
      const out = new Uint8Array(total);
      let at = 0;
      chunks.forEach((chunk) => { out.set(chunk, at); at += chunk.length; });
      let bin = '';
      for (let i = 0; i < out.length; i += 1) bin += String.fromCharCode(out[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (error) {
      return '';
    }
  }

  /* The modifier lines of an item, as the trade site writes them. */
  /*
   * The modifier lines a search can use. Rune effects are deliberately absent:
   * runes sit in sockets and the player can add them to any item they buy, so
   * searching for them excludes the items that do not happen to carry the same
   * rune. A record that still holds a rune line among its modifiers (an old
   * import, or "Bonded:" wording) is filtered out here as well.
   */
  const RUNE_LINE = /^(?:Bonded|Rune):/i;

  function itemModLines(item) {
    const out = [];
    ['explicitMods', 'craftedMods', 'fracturedMods', 'desecratedMods', 'enchantMods', 'veiledMods', 'scourgeMods', 'delveMods']
      .forEach((key) => {
        asArray(item && item[key]).forEach((entry) => {
          if (typeof entry === 'string') {
            const line = cleanText(entry, 240);
            if (line && !RUNE_LINE.test(line)) out.push(line);
            return;
          }
          if (!entry || typeof entry !== 'object') return;
          /* PoE 2 entries carry the wording in "description"/"text", PoE 1
             trade API entries in "value". */
          const line = cleanText(entry.description || entry.text || entry.value || '', 240);
          if (line && !RUNE_LINE.test(line)) out.push(line);
        });
      });
    return out;
  }

  /*
   * How much of the item's own roll a listing has to reach to count as the same
   * modifier. Measured on a five affix helmet in Covens: 90% left three
   * listings (the item and two others), 80% nine, so 80% is what makes a price
   * worth reading without letting in a different item. The number of modifiers
   * matched is the strict part of the search, not this.
   */
  const SEARCH_ROLL_SCALE = 0.8;

  /*
   * The stat filters of an item, written from the stat ids the item itself
   * carries ("hash": "stat.explicit.stat_..."). The trade site hands them out
   * with every listing, so nothing has to be guessed from the printed line and
   * every id is one the site knows. Implicit modifiers belong to the base, not
   * to the item's affixes, so they are left out.
   */
  function itemStatFilters(item, game) {
    const profile = globalThis.PTC_GAMES.profile(game);
    const out = [];
    const seen = {};
    asArray(profile.searchModLists).forEach((key) => {
      asArray(item && item[key]).forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const parts = /^stat\.([a-z]+)\.([\w.]+)$/.exec(String(entry.hash || ''));
        if (!parts) return;
        /* A game that files desecrated modifiers as explicit stats says so in
           its profile; the site writes them the same way. Runes are always
           skipped: they are socketable, not part of what is being bought. */
        const domain = (profile.desecratedAsExplicit && parts[1] === 'desecrated') ? 'explicit' : parts[1];
        if (asArray(profile.skippedStatDomains).indexOf(domain) !== -1) return;
        const id = domain + '.' + parts[2];
        if (seen[id]) return;
        seen[id] = true;
        const numbers = (String(entry.description || entry.value || '').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        let value = {};
        const roll = numbers.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)[0];
        if (roll != null) {
          const scaled = roll >= 10 ? Math.floor(roll * SEARCH_ROLL_SCALE) : Math.floor(roll * SEARCH_ROLL_SCALE * 10) / 10;
          if (scaled > 0) value = { min: scaled };
        }
        out.push({ id: id, value: value, disabled: false });
      });
    });
    return out;
  }

  /*
   * The search url of one item: its base type and its own modifiers, in the
   * league the listing was saved from. The query is written into the url and
   * the site runs it - no api call, no waiting, and the url can be shared like
   * any other search url.
   *
   * The site names a base with "type" (PoE 1 and PoE 2 alike) and a unique with
   * "term" - measured from the urls the site writes itself. A base written into
   * "term" is read as an item name and returns nothing.
   */
  async function handleTradeUrl(record) {
    const rec = record && typeof record === 'object' ? record : null;
    if (!rec || !rec.item) return { ok: false, error: 'No item to search for.' };
    const game = gameOf(rec.game);
    const item = rec.item;
    const name = cleanText(item.name, 140);
    const frame = Number.isInteger(item.frameType) ? item.frameType : 0;
    const unique = frame === 3 && !!name;
    const base = await resolveTradeBaseType(game, item.baseType || item.typeLine || name || '');
    const type = base.type;
    if (!type && !unique) return { ok: false, error: 'This item has no base type to search for.' };

    /* A unique is its name; its modifiers are the same on every listing, so the
       name alone is the search the site itself builds for one. */
    if (unique) {
      const query = { status: { option: SEARCH_STATUS }, term: name, stats: [{ type: 'and', filters: [] }] };
      const id = await encodeTradeQueryId(query);
      if (!id) return { ok: false, error: 'Could not build the search link.' };
      const league = cleanText(rec.league, 80) || await resolveLeague(game, '') || 'Standard';
      const url = globalThis.PTC_GAMES.buildTradeUrl(game, league, id, false);
      if (!url) return { ok: false, error: 'Could not build the search link.' };
      return { ok: true, url: url, mods: 0, mode: 'unique' };
    }

    let filters = itemStatFilters(item, game);
    /* The lines that define a build rather than decorate an item: a modifier
       that grants levels to a skill. For an import these are required, so the
       search cannot drift into items that share the other modifiers but not the
       one the item was made for. */
    let coreFilters = [];
    if (!filters.length) {
      /* An item saved before the site shipped the stat ids carries only the
         printed lines; they are matched against the live stat table instead. */
      const lines = itemModLines(item);
      /* The stats a build is built around, kept apart from the rest: they are
         required, so an item with "+2 to Level of all Minion Skills" only shows
         listings that have it too. */
      const isCore = (line) => /to Level of all [^,]*Skills/i.test(line);
      const coreLines = lines.filter(isCore);
      const resolved = await buildTradeStats(game, lines).catch(() => []);
      if (coreLines.length) {
        const coreResolved = await buildTradeStats(game, coreLines).catch(() => []);
        coreResolved.forEach((stat) => {
          stat.ids.slice(0, 1).forEach((id) => coreFilters.push({ id: id, value: {}, disabled: false }));
        });
      }
      filters = [];
      resolved.forEach((stat) => {
        let value = {};
        if (stat.value != null) {
          const scaled = stat.value >= 10 ? Math.floor(stat.value * SEARCH_ROLL_SCALE) : Math.floor(stat.value * SEARCH_ROLL_SCALE * 10) / 10;
          if (scaled > 0) value = { min: scaled };
        }
        stat.ids.slice(0, 1).forEach((id) => filters.push({ id: id, value: value, disabled: false }));
      });
    }

    /* A saved listing is on the market, so "all of them but one" finds it next
       to the items that share its prefixes and suffixes, and the roll values
       (80% of its own) keep the quality in the same league.

       A build import is not on the market: its modifiers come from Path of
       Building, may be tier ranges ("+(21-25)"), and demanding seven of eight
       exact stats only ever returns nothing - which used to end on a page of
       every item of the base. Half of the modifiers, with no roll minimum,
       describes the item and still shows its neighbours. */
    const imported = !!rec.targetOf;
    let groups = [];
    if (imported) {
      /* A build import: the stats it is built around are required, and the rest
         has to match all but one - "the same filters, plus or minus one". No
         roll minimum is asked for (an import carries tier ranges, not rolls), and
         a stat listed twice (a crafted and an explicit line of the same thing)
         is one filter. */
      const seenIds = new Set();
      const unique = (list) => list.filter((filter) => {
        if (seenIds.has(filter.id)) return false;
        seenIds.add(filter.id);
        return true;
      });
      const core = unique(coreFilters);
      const rest = unique(filters.map((filter) => ({ id: filter.id, value: {}, disabled: false })));
      if (core.length) groups.push({ type: 'and', filters: core });
      if (rest.length) {
        const need = rest.length >= 2 ? rest.length - 1 : rest.length;
        groups.push(need >= rest.length
          ? { type: 'and', filters: rest }
          : { type: 'count', filters: rest, value: { min: need } });
      }
    } else if (filters.length) {
      const need = filters.length >= 4 ? filters.length - 1 : filters.length;
      groups = need >= filters.length
        ? [{ type: 'and', filters: filters }]
        : [{ type: 'count', filters: filters, value: { min: need } }];
    }

    const query = { status: { option: SEARCH_STATUS } };
    if (type) query.type = type;
    if (groups.length) query.stats = groups;
    const id = await encodeTradeQueryId(query);
    if (!id) return { ok: false, error: 'Could not build the search link.' };
    const league = cleanText(rec.league, 80) || await resolveLeague(game, '') || 'Standard';
    const url = globalThis.PTC_GAMES.buildTradeUrl(game, league, id, false);
    if (!url) return { ok: false, error: 'Could not build the search link.' };
    return { ok: true, url: url, mods: filters.length, mode: groups.length ? groups[0].type : 'base' };
  }

async function handleCoeUrl(record) {
  if (!await coeAccessGranted()) {
    return { ok: false, error: 'Craft of Exile access was not granted.', needsPermission: true };
  }
  return (async () => {
    try {
      if (typeof COE === 'undefined') return { ok: false, error: 'Craft of Exile data module missing.' };
      const index = await COE.loadIndex((url) => coeFetchText(url), gameOf(record && record.game));
      /* cleanGameText, the helper defined at the top of this file: the one in
         item-utils.js is a separate script the worker never loads, and naming
         that one threw a ReferenceError, so the PoE 1 details import always
         fell back to the paste. */
      const built = COE.detailsFromRecord(record, index, { cleanGameText: cleanGameText, asArray: asArray });
      if (!built) return { ok: false, error: 'Base item not found in Craft of Exile data.' };
      return { ok: true, url: built.url, mods: built.mods, base: built.base, method: 'details' };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  })();
}

/*
 * Fills the affix names a build import never carries, so its Craft of Exile
 * paste is identical in shape to the one a saved item produces. The result is
 * written back to storage, so the next click is instant.
 */
async function handleCoePrepare(record) {
  const rec = record && typeof record === 'object' ? record : null;
  if (!rec || !rec.item) return { ok: false, error: 'No item to prepare.' };
  if (!await coeAccessGranted()) {
    return { ok: false, error: 'Craft of Exile access was not granted.', needsPermission: true };
  }
  if (typeof COE === 'undefined' || !COE.loadIndex || !COE.resolveMod) {
    return { ok: false, error: 'Craft of Exile data module missing.' };
  }
  let index = null;
  try {
    index = await COE.loadIndex((url) => coeFetchText(url), gameOf(rec.game));
  } catch (error) {
    return { ok: false, error: 'Could not load the Craft of Exile data.' };
  }
  if (!index) return { ok: false, error: 'Could not load the Craft of Exile data.' };
  const changed = enrichRecordModNames(index, rec);
  /* The affix names and the Craft of Exile item class are both needed for the
     paste, and both are worth keeping so the next click is instant. */
  const itemChanged = !!(rec.item && (rec.item.coeItemClass || rec.item.coeBaseType));
  if (changed || itemChanged) {
    try {
      await enqueue(async () => {
        const items = await getItems();
        const at = items.findIndex((entry) => entry && entry.id === rec.id);
        if (at < 0) return;
        items[at].coeMods = rec.coeMods;
        if (items[at].item && rec.item) {
          items[at].item.coeItemClass = rec.item.coeItemClass;
          items[at].item.coeBaseType = rec.item.coeBaseType;
        }
        await setItems(items);
      });
    } catch (error) {
      /* the url still works for this click; storage stays as it was */
    }
  }
  return { ok: true, record: rec, changed: changed };
}

/* ------------------------------------------------------------------ */
/* Bookmark folders and searches                                       */
/* ------------------------------------------------------------------ */

function handleItemMove(itemId, collectionId) {
  return enqueue(async () => {
    const items = await getItems();
    const record = items.find((entry) => entry.id === itemId);
    if (!record) return { ok: false, error: 'Item not found.' };
    const target = cleanId(collectionId, 100);
    if (target) {
      const collections = await getCollections();
      if (!collections.some((entry) => entry.id === target)) return { ok: false, error: 'Build not found.' };
    }
    record.collectionId = target;
    await setItems(items);
    return { ok: true, item: record };
  });
}


function sanitizeFolder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  return {
    id: cleanId(raw.id) || makeId('fld'),
    parentId: cleanId(raw.parentId),
    name,
    icon: /^[a-z0-9_-]{1,32}$/.test(raw.icon || '') ? raw.icon : 'folder',
    game: gameOf(raw.game),
    order: Number.isFinite(raw.order) ? raw.order : Date.now(),
    archived: !!raw.archived,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function sanitizeBookmark(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const isItem = raw.mode === 'item';
  const queryId = cleanQueryId(raw.queryId);
  const baseType = cleanText(raw.baseType, 120);
  if (!queryId && !(isItem && baseType)) return null;
  return {
    id: cleanId(raw.id) || makeId('bm'),
    folderId: cleanId(raw.folderId),
    name: cleanName(raw.name) || 'Saved search',
    game: gameOf(raw.game),
    league: cleanText(raw.league, 80),
    leagueMode: raw.leagueMode === 'fixed' ? 'fixed' : 'auto',
    queryId,
    baseType,
    mode: isItem ? 'item' : (raw.mode === 'live' ? 'live' : 'search'),
    done: !!raw.done,
    archived: !!raw.archived,
    category: cleanName(raw.category || ''),
    order: Number.isFinite(raw.order) ? raw.order : Date.now(),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function descendantFolderIds(folders, id) {
  const result = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    folders.forEach((folder) => {
      if (folder.parentId === current && !result.includes(folder.id)) {
        result.push(folder.id);
        stack.push(folder.id);
      }
    });
  }
  return result;
}

function folderOrRoot(folders, id) {
  return id ? folders.find((folder) => folder.id === id) : null;
}

function nextOrder(list, predicate) {
  const values = list.filter(predicate).map((entry) => Number(entry.order) || 0);
  return values.length ? Math.max.apply(null, values) + 1 : Date.now();
}

function notifySyncPush() {
  getSettings().then((settings) => {
    if (settings.syncEnabled) queueSyncPush();
  }).catch(() => {});
}

function handleFolderCreate(payload) {
  return enqueue(async () => {
    const folders = await getFolders();
    if (folders.length >= MAX_FOLDERS) {
      return { ok: false, error: 'Too many folders (max ' + MAX_FOLDERS + ').' };
    }
    const parentId = cleanId(payload && payload.parentId);
    const parent = folderOrRoot(folders, parentId);
    if (parentId && !parent) return { ok: false, error: 'Parent folder not found.' };
    const folder = sanitizeFolder({
      ...payload,
      id: makeId('fld'),
      parentId,
      game: parent ? parent.game : gameOf(payload && payload.game),
      order: nextOrder(folders, (entry) => entry.parentId === parentId),
    });
    if (!folder) return { ok: false, error: 'Enter a folder name.' };
    folders.push(folder);
    await chrome.storage.local.set({ [FOLDERS_KEY]: folders });
    notifySyncPush();
    return { ok: true, folder };
  });
}

function handleFolderUpdate(id, patch) {
  return enqueue(async () => {
    const folders = await getFolders();
    const folder = folders.find((entry) => entry.id === id);
    if (!folder) return { ok: false, error: 'Folder not found.' };
    const targetParentId = patch && patch.parentId !== undefined
      ? cleanId(patch.parentId)
      : folder.parentId;
    if (targetParentId) {
      if (folders.some((entry) => entry.id === folder.id && entry.id === targetParentId)) {
        return { ok: false, error: 'A folder cannot contain itself.' };
      }
      if (descendantFolderIds(folders, folder.id).includes(targetParentId)) {
        return { ok: false, error: 'A folder cannot be moved inside its own subfolder.' };
      }
      const parent = folderOrRoot(folders, targetParentId);
      if (!parent) return { ok: false, error: 'Parent folder not found.' };
      if (parent.game !== folder.game) {
        return { ok: false, error: 'Folders from different games cannot be nested.' };
      }
    }
    if (patch && typeof patch.name === 'string') {
      const name = cleanName(patch.name);
      if (!name) return { ok: false, error: 'Enter a folder name.' };
      folder.name = name;
    }
    if (patch && typeof patch.icon === 'string' && /^[a-z0-9_-]{1,32}$/.test(patch.icon)) {
      folder.icon = patch.icon;
    }
    if (patch && typeof patch.archived === 'boolean') folder.archived = patch.archived;
    if (patch && patch.parentId !== undefined) {
      folder.parentId = targetParentId;
      folder.order = nextOrder(folders, (entry) => entry.id !== folder.id && entry.parentId === targetParentId);
    }
    if (patch && Number.isFinite(patch.order)) folder.order = patch.order;
    folder.updatedAt = Date.now();
    await chrome.storage.local.set({ [FOLDERS_KEY]: folders });
    notifySyncPush();
    return { ok: true, folder };
  });
}

function handleFolderDelete(id) {
  return enqueue(async () => {
    const folders = await getFolders();
    const folder = folders.find((entry) => entry.id === id);
    if (!folder) return { ok: false, error: 'Folder not found.' };
    const removeIds = new Set([id, ...descendantFolderIds(folders, id)]);
    const keptFolders = folders.filter((entry) => !removeIds.has(entry.id));
    const bookmarks = await getBookmarks();
    const keptBookmarks = bookmarks.filter((entry) => !removeIds.has(entry.folderId));
    await chrome.storage.local.set({
      [FOLDERS_KEY]: keptFolders,
      [BOOKMARKS_KEY]: keptBookmarks,
    });
    notifySyncPush();
    return {
      ok: true,
      folders: folders.length - keptFolders.length,
      bookmarks: bookmarks.length - keptBookmarks.length,
    };
  });
}

function handleFolderDuplicate(id) {
  return enqueue(async () => {
    const folders = await getFolders();
    const bookmarks = await getBookmarks();
    const source = folders.find((entry) => entry.id === id);
    if (!source) return { ok: false, error: 'Folder not found.' };
    if (folders.length >= MAX_FOLDERS) return { ok: false, error: 'Too many folders.' };
    const ids = [id, ...descendantFolderIds(folders, id)];
    const idMap = new Map();
    const clones = [];
    const now = Date.now();
    ids.forEach((sourceId, index) => {
      const original = folders.find((entry) => entry.id === sourceId);
      if (!original) return;
      const cloneId = makeId('fld');
      idMap.set(sourceId, cloneId);
      clones.push({
        ...original,
        id: cloneId,
        parentId: index === 0 ? source.parentId : (idMap.get(original.parentId) || source.parentId),
        name: index === 0 ? (original.name + ' (copy)').slice(0, 60) : original.name,
        order: index === 0 ? nextOrder(folders, (entry) => entry.parentId === source.parentId) : original.order + now,
        createdAt: now,
        updatedAt: now,
      });
    });
    const clonedBookmarks = bookmarks
      .filter((entry) => ids.includes(entry.folderId))
      .map((entry) => ({
        ...entry,
        id: makeId('bm'),
        folderId: idMap.get(entry.folderId) || '',
        order: Number(entry.order) + now,
        createdAt: now,
        updatedAt: now,
      }));
    await chrome.storage.local.set({
      [FOLDERS_KEY]: folders.concat(clones),
      [BOOKMARKS_KEY]: bookmarks.concat(clonedBookmarks),
    });
    notifySyncPush();
    return { ok: true, folder: clones[0], folders: clones.length, bookmarks: clonedBookmarks.length };
  });
}

function handleBookmarkCreate(payload) {
  return enqueue(async () => {
    const bookmarks = await getBookmarks();
    if (bookmarks.length >= MAX_BOOKMARKS) {
      return { ok: false, error: 'Too many bookmarks (max ' + MAX_BOOKMARKS + ').' };
    }
    const folderId = cleanId(payload && payload.folderId);
    const folders = await getFolders();
    const folder = folderOrRoot(folders, folderId);
    if (folderId && !folder) return { ok: false, error: 'Folder not found.' };
    const game = folder ? folder.game : gameOf(payload && payload.game);
    const bookmark = sanitizeBookmark({
      ...payload,
      id: makeId('bm'),
      folderId,
      game,
      order: nextOrder(bookmarks, (entry) => entry.folderId === folderId),
    });
    if (!bookmark) return { ok: false, error: 'Invalid search bookmark.' };
    const duplicate = bookmarks.find((entry) => entry.game === bookmark.game
      && entry.queryId === bookmark.queryId
      && (entry.league || '').toLowerCase() === (bookmark.league || '').toLowerCase()
      && (bookmark.mode !== 'item' || (entry.baseType || '').toLowerCase() === (bookmark.baseType || '').toLowerCase()));
    if (duplicate) return { ok: true, duplicate: true, bookmark: duplicate };
    bookmarks.push(bookmark);
    await chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks });
    notifySyncPush();
    return { ok: true, bookmark };
  });
}

function handleBookmarkImport(payload) {
  return enqueue(async () => {
    const list = Array.isArray(payload && payload.items) ? payload.items : [];
    if (!list.length) return { ok: true, saved: 0, duplicate: 0, errors: 0 };
    const folderId = cleanId(payload && payload.folderId);
    const folders = await getFolders();
    const folder = folderOrRoot(folders, folderId);
    const game = folder ? folder.game : gameOf(payload && payload.game);
    const bookmarks = await getBookmarks();
    let saved = 0;
    let duplicate = 0;
    let errors = 0;
    for (const entry of list) {
      if (bookmarks.length >= MAX_BOOKMARKS) { errors += 1; continue; }
      const candidate = sanitizeBookmark({
        ...entry,
        id: makeId('bm'),
        folderId,
        game,
        order: nextOrder(bookmarks, (existing) => existing.folderId === folderId),
      });
      if (!candidate) { errors += 1; continue; }
      const dup = bookmarks.find((existing) => existing.game === candidate.game
        && existing.queryId === candidate.queryId
        && (existing.league || '').toLowerCase() === (candidate.league || '').toLowerCase()
        && (candidate.mode !== 'item' || (existing.baseType || '').toLowerCase() === (candidate.baseType || '').toLowerCase()));
      if (dup) { duplicate += 1; continue; }
      bookmarks.push(candidate);
      saved += 1;
    }
    if (saved) {
      await chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks });
      notifySyncPush();
    }
    return { ok: true, saved: saved, duplicate: duplicate, errors: errors };
  });
}

function handleBookmarkUpdate(id, patch) {
  return enqueue(async () => {
    const bookmarks = await getBookmarks();
    const bookmark = bookmarks.find((entry) => entry.id === id);
    if (!bookmark) return { ok: false, error: 'Bookmark not found.' };
    if (patch && typeof patch.name === 'string') {
      const name = cleanName(patch.name);
      if (!name) return { ok: false, error: 'Enter a bookmark name.' };
      bookmark.name = name;
    }
    if (patch && typeof patch.league === 'string') bookmark.league = cleanText(patch.league, 80);
    if (patch && (patch.leagueMode === 'fixed' || patch.leagueMode === 'auto')) {
      bookmark.leagueMode = patch.leagueMode;
    }
    if (patch && (patch.mode === 'search' || patch.mode === 'live')) bookmark.mode = patch.mode;
    if (patch && typeof patch.done === 'boolean') bookmark.done = patch.done;
    if (patch && typeof patch.archived === 'boolean') bookmark.archived = patch.archived;
    if (patch && typeof patch.category === 'string') bookmark.category = cleanName(patch.category);
    if (patch && patch.folderId !== undefined) {
      const folderId = cleanId(patch.folderId);
      const folders = await getFolders();
      const folder = folderOrRoot(folders, folderId);
      if (folderId && !folder) return { ok: false, error: 'Folder not found.' };
      if (folder && folder.game !== bookmark.game) {
        return { ok: false, error: 'Bookmarks and folders must belong to the same game.' };
      }
      bookmark.folderId = folderId;
      bookmark.order = nextOrder(bookmarks, (entry) => entry.id !== id && entry.folderId === folderId);
    }
    if (patch && Number.isFinite(patch.order)) bookmark.order = patch.order;
    bookmark.updatedAt = Date.now();
    await chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks });
    notifySyncPush();
    return { ok: true, bookmark };
  });
}

function handleBookmarkDelete(id) {
  return enqueue(async () => {
    const bookmarks = await getBookmarks();
    const next = bookmarks.filter((entry) => entry.id !== id);
    await chrome.storage.local.set({ [BOOKMARKS_KEY]: next });
    notifySyncPush();
    return { ok: true, count: next.length };
  });
}

function handleBookmarkDuplicate(id) {
  return enqueue(async () => {
    const bookmarks = await getBookmarks();
    const bookmark = bookmarks.find((entry) => entry.id === id);
    if (!bookmark) return { ok: false, error: 'Bookmark not found.' };
    if (bookmarks.length >= MAX_BOOKMARKS) return { ok: false, error: 'Too many bookmarks.' };
    const clone = {
      ...bookmark,
      id: makeId('bm'),
      name: (bookmark.name + ' (copy)').slice(0, 60),
      order: nextOrder(bookmarks, (entry) => entry.folderId === bookmark.folderId),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    bookmarks.push(clone);
    await chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks });
    notifySyncPush();
    return { ok: true, bookmark: clone };
  });
}

function handleBookmarkMove(id, folderId, order) {
  return enqueue(async () => {
    const bookmarks = await getBookmarks();
    const bookmark = bookmarks.find((entry) => entry.id === id);
    if (!bookmark) return { ok: false, error: 'Bookmark not found.' };
    const targetId = cleanId(folderId);
    if (targetId) {
      const folders = await getFolders();
      const folder = folderOrRoot(folders, targetId);
      if (!folder) return { ok: false, error: 'Folder not found.' };
      if (folder.game !== bookmark.game) {
        return { ok: false, error: 'Bookmarks and folders must belong to the same game.' };
      }
    }
    bookmark.folderId = targetId;
    bookmark.order = Number.isFinite(order) ? order : nextOrder(bookmarks, (entry) => entry.id !== id && entry.folderId === targetId);
    bookmark.updatedAt = Date.now();
    await chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks });
    notifySyncPush();
    return { ok: true, bookmark };
  });
}

function handleBookmarkCurrent(payload) {
  return enqueue(async () => {
    const info = parseTradeUrl(payload && payload.url);
    if (!info || !info.queryId) {
      return { ok: false, error: 'Open a saved trade search first.' };
    }
    const bookmarks = await getBookmarks();
    const existing = bookmarks.find((entry) => entry.game === info.game
      && entry.queryId === info.queryId
      && (entry.league || '').toLowerCase() === (info.league || '').toLowerCase());
    if (existing) return { ok: true, duplicate: true, bookmark: existing };
    if (bookmarks.length >= MAX_BOOKMARKS) return { ok: false, error: 'Too many bookmarks.' };
    const bookmark = sanitizeBookmark({
      id: makeId('bm'),
      folderId: '',
      name: cleanName(payload && payload.name) || (info.league ? info.league + ' search' : 'Trade search'),
      game: info.game,
      league: info.league,
      leagueMode: 'auto',
      queryId: info.queryId,
      mode: info.live ? 'live' : 'search',
      order: nextOrder(bookmarks, (entry) => entry.folderId === ''),
    });
    bookmarks.push(bookmark);
    await chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks });
    notifySyncPush();
    return { ok: true, bookmark };
  });
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function folderExportString(id) {
  return enqueue(async () => {
    const folders = await getFolders();
    const folder = folders.find((entry) => entry.id === id);
    if (!folder) return { ok: false, error: 'Folder not found.' };
    const ids = [id, ...descendantFolderIds(folders, id)];
    const bookmarks = await getBookmarks();
    const payload = {
      app: 'ptc-folder',
      version: 1,
      exportedAt: new Date().toISOString(),
      folder,
      folders: folders.filter((entry) => ids.includes(entry.id)),
      bookmarks: bookmarks.filter((entry) => ids.includes(entry.folderId)),
    };
    return { ok: true, string: 'PTC1:' + utf8ToBase64(JSON.stringify(payload)) };
  });
}

function importFolderPayload(payload, parentId) {
  const folders = [];
  const bookmarks = [];
  const idMap = new Map();
  const now = Date.now();
  const sourceFolders = asArray(payload && payload.folders);
  const root = payload && payload.folder;
  if (!root || typeof root !== 'object') throw new Error('Invalid folder string.');
  const ordered = [root].concat(sourceFolders.filter((entry) => entry && entry.id !== root.id));
  ordered.forEach((raw, index) => {
    const folder = sanitizeFolder({
      ...raw,
      parentId: index === 0 ? parentId : (idMap.get(raw.parentId) || parentId),
      order: now + index,
      createdAt: now,
      updatedAt: now,
    });
    if (!folder) return;
    folder.id = makeId('fld');
    idMap.set(raw.id, folder.id);
    folders.push(folder);
  });
  asArray(payload && payload.bookmarks).forEach((raw, index) => {
    const bookmark = sanitizeBookmark({
      ...raw,
      id: makeId('bm'),
      folderId: idMap.get(raw.folderId) || parentId,
      order: now + index,
      createdAt: now,
      updatedAt: now,
    });
    if (bookmark) bookmarks.push(bookmark);
  });
  return { folders, bookmarks };
}

function handleFolderImport(text, parentId) {
  return enqueue(async () => {
    const value = String(text || '').trim();
    if (!value) return { ok: false, error: 'Paste a folder backup string first.' };
    let payload;
    try {
      payload = JSON.parse(base64ToUtf8(value.replace(/^PTC1:/, '')));
    } catch (error) {
      return { ok: false, error: 'Invalid folder backup string.' };
    }
    const existingFolders = await getFolders();
    const existingBookmarks = await getBookmarks();
    const targetId = cleanId(parentId);
    const parent = folderOrRoot(existingFolders, targetId);
    if (targetId && !parent) return { ok: false, error: 'Target folder not found.' };
    let imported;
    try {
      imported = importFolderPayload(payload, targetId);
    } catch (error) {
      return { ok: false, error: error.message || 'Invalid folder backup.' };
    }
    if (existingFolders.length + imported.folders.length > MAX_FOLDERS) {
      return { ok: false, error: 'Too many folders.' };
    }
    if (existingBookmarks.length + imported.bookmarks.length > MAX_BOOKMARKS) {
      return { ok: false, error: 'Too many bookmarks.' };
    }
    await chrome.storage.local.set({
      [FOLDERS_KEY]: existingFolders.concat(imported.folders),
      [BOOKMARKS_KEY]: existingBookmarks.concat(imported.bookmarks),
    });
    notifySyncPush();
    return { ok: true, folders: imported.folders.length, bookmarks: imported.bookmarks.length };
  });
}

/* ------------------------------------------------------------------ */
/* Multi live search                                                   */
/* ------------------------------------------------------------------ */

function sanitizeMultiEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const queryId = cleanQueryId(raw.queryId);
  if (!queryId) return null;
  return {
    id: cleanId(raw.id) || makeId('ml'),
    game: gameOf(raw.game),
    league: cleanText(raw.league, 80),
    queryId,
    name: cleanName(raw.name) || 'Live search',
    enabled: raw.enabled !== false,
    tabId: Number.isInteger(raw.tabId) ? raw.tabId : null,
    addedAt: Number(raw.addedAt) || Date.now(),
  };
}

async function closeTabIfPossible(tabId) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    /* already gone */
  }
}

async function openLiveTab(entry, windowId) {
  /* The template carries the site's url shape, but PTC_GAMES.buildTradeUrl keeps
     its league and game: it is only usable when the open tab is in the same
     place as this watcher. */
  const template = await tradeUrlTemplate();
  const fromTab = template ? parseTradeUrl(template) : null;
  const samePlace = !!(fromTab && fromTab.game === gameOf(entry.game)
    && String(fromTab.league || '').toLowerCase() === String(entry.league || '').toLowerCase());
  const url = buildTradeUrl(entry.game, entry.league, entry.queryId, true, samePlace ? template : '');
  if (!url) return null;
  try {
    const options = { url, active: false };
    if (Number.isInteger(windowId)) options.windowId = windowId;
    const tab = await chrome.tabs.create(options);
    return tab && Number.isInteger(tab.id) ? tab.id : null;
  } catch (error) {
    return null;
  }
}

function handleMultiLiveToggle(payload) {
  return enqueue(async () => {
    const entries = await getMultiLive();
    const info = parseTradeUrl(payload && payload.url);
    const queryId = cleanQueryId((payload && payload.queryId) || (info && info.queryId));
    if (!queryId) return { ok: false, error: 'Open a saved trade search first.' };
    const game = gameOf((payload && payload.game) || (info && info.game));
    const league = cleanText((payload && payload.league) || (info && info.league), 80);
    const existing = entries.find((entry) => entry.game === game
      && entry.queryId === queryId
      && (entry.league || '').toLowerCase() === league.toLowerCase());
    const windowId = Number.isInteger(payload && payload.windowId) ? payload.windowId : null;

    if (existing) {
      if (existing.enabled) {
        existing.enabled = false;
        await closeTabIfPossible(existing.tabId);
        existing.tabId = null;
      } else {
        existing.enabled = true;
        existing.tabId = await openLiveTab(existing, windowId);
      }
      await chrome.storage.local.set({ [MULTI_KEY]: entries });
      return { ok: true, enabled: existing.enabled, entry: existing };
    }

    if (entries.length >= MAX_MULTI) return { ok: false, error: 'Too many multi live searches.' };
    const entry = sanitizeMultiEntry({
      game,
      league,
      queryId,
      name: cleanName(payload && payload.name)
        || (info && info.league ? info.league + ' live search' : 'Live search'),
      enabled: true,
      addedAt: Date.now(),
    });
    entry.tabId = await openLiveTab(entry, windowId);
    entries.push(entry);
    await chrome.storage.local.set({ [MULTI_KEY]: entries });
    return { ok: true, enabled: true, entry };
  });
}

function handleMultiLiveRemove(id) {
  return enqueue(async () => {
    const entries = await getMultiLive();
    const entry = entries.find((item) => item.id === id);
    if (entry) await closeTabIfPossible(entry.tabId);
    const next = entries.filter((item) => item.id !== id);
    await chrome.storage.local.set({ [MULTI_KEY]: next });
    return { ok: true, count: next.length };
  });
}

function handleMultiLiveSetEnabled(id, enabled) {
  return enqueue(async () => {
    const entries = await getMultiLive();
    const entry = entries.find((item) => item.id === id);
    if (!entry) return { ok: false, error: 'Live search not found.' };
    if (enabled) {
      entry.enabled = true;
      if (!Number.isInteger(entry.tabId)) entry.tabId = await openLiveTab(entry, null);
    } else {
      entry.enabled = false;
      await closeTabIfPossible(entry.tabId);
      entry.tabId = null;
    }
    await chrome.storage.local.set({ [MULTI_KEY]: entries });
    return { ok: true, entry };
  });
}

function handleMultiLiveAll(enabled) {
  return enqueue(async () => {
    const entries = await getMultiLive();
    for (const entry of entries) {
      if (enabled) {
        if (!Number.isInteger(entry.tabId)) entry.tabId = await openLiveTab(entry, null);
        entry.enabled = true;
      } else {
        await closeTabIfPossible(entry.tabId);
        entry.tabId = null;
        entry.enabled = false;
      }
    }
    await chrome.storage.local.set({ [MULTI_KEY]: entries });
    return { ok: true, count: entries.length };
  });
}

function handleMultiLiveClear() {
  return enqueue(async () => {
    const entries = await getMultiLive();
    for (const entry of entries) await closeTabIfPossible(entry.tabId);
    await chrome.storage.local.set({ [MULTI_KEY]: [] });
    return { ok: true };
  });
}

async function reconcileMultiLive() {
  const entries = await getMultiLive();
  let changed = false;
  for (const entry of entries) {
    if (!entry.enabled || !Number.isInteger(entry.tabId)) continue;
    try {
      await chrome.tabs.get(entry.tabId);
    } catch (error) {
      entry.tabId = null;
      entry.enabled = false;
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ [MULTI_KEY]: entries });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  getMultiLive().then((entries) => {
    let changed = false;
    entries.forEach((entry) => {
      if (entry.tabId === tabId) {
        entry.tabId = null;
        entry.enabled = false;
        changed = true;
      }
    });
    if (changed) chrome.storage.local.set({ [MULTI_KEY]: entries }).catch(() => {});
  }).catch(() => {});
});

/* ------------------------------------------------------------------ */
/* Watchers                                                            */
/* ------------------------------------------------------------------ */

function sanitizeWatched(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const itemId = cleanString(raw.itemId || raw.id, 200);
  if (!itemId) return null;
  return {
    id: cleanId(raw.id) || makeId('wch'),
    itemId,
    game: gameOf(raw.game),
    league: cleanText(raw.league, 80),
    queryId: cleanQueryId(raw.queryId),
    live: !!raw.live,
    name: cleanString(raw.name, 200) || 'Watched item',
    icon: cleanString(raw.icon, 2000),
    priceText: cleanString(raw.priceText, 120),
    priceAmount: typeof raw.priceAmount === 'number' ? raw.priceAmount : null,
    priceCurrency: cleanString(raw.priceCurrency, 60),
    previousPriceText: cleanString(raw.previousPriceText, 120),
    previousPriceAmount: typeof raw.previousPriceAmount === 'number' ? raw.previousPriceAmount : null,
    previousPriceCurrency: cleanString(raw.previousPriceCurrency, 60),
    account: cleanString(raw.account, 120),
    ign: cleanString(raw.ign, 120),
    whisper: cleanString(raw.whisper, 1000),
    whisperToken: cleanString(raw.whisperToken, 200),
    stash: sanitizeStash(raw.stash),
    searchUrl: cleanString(raw.searchUrl, 2000),
    coeMods: sanitizeCoeMods(raw.coeMods),
    item: raw.item && typeof raw.item === 'object' ? raw.item : null,
    status: ['available', 'sold', 'price-changed', 'target-reached', 'expired', 'unknown'].includes(raw.status)
      ? raw.status
      : 'unknown',
    enabled: raw.enabled !== false,
    notifiedSold: !!raw.notifiedSold,
    targetReached: !!raw.targetReached,
    lastNotifiedPrice: cleanString(raw.lastNotifiedPrice, 120),
    targetPrice: Number.isFinite(raw.targetPrice) && raw.targetPrice > 0 ? raw.targetPrice : null,
    targetCurrency: cleanText(raw.targetCurrency, 40),
    expiresAt: Number(raw.expiresAt) > 0 ? Number(raw.expiresAt) : null,
    lastChecked: Number(raw.lastChecked) || 0,
    addedAt: Number(raw.addedAt) || Date.now(),
    order: Number.isFinite(raw.order) ? raw.order : Date.now(),
    priceHistory: sanitizePriceHistory(raw.priceHistory),
  };
}

function handleWatchRefreshQuery(payload) {
  return enqueue(async () => {
    const source = payload && typeof payload === 'object' ? payload : {};
    const queryId = cleanQueryId(source.queryId);
    if (!queryId) return { ok: false, error: 'Missing query id.' };
    const oldQueryId = cleanQueryId(source.oldQueryId);
    const game = gameOf(source.game);
    const league = cleanText(source.league, 80);
    const searchUrl = cleanString(source.searchUrl, 2000);
    const live = !!source.live;
    const watched = await getWatched();
    let changed = 0;
    const next = watched.map((entry) => {
      if (entry.game !== game) return entry;
      if (oldQueryId && entry.queryId !== oldQueryId) return entry;
      if (!oldQueryId && entry.queryId !== queryId) return entry;
      changed += 1;
      return {
        ...entry,
        queryId,
        league: league || entry.league,
        searchUrl: searchUrl || entry.searchUrl,
        live,
      };
    });
    if (changed) {
      await chrome.storage.local.set({ [WATCHED_KEY]: next });
    }
    return { ok: true, changed };
  });
}

function handleWatchAdd(record) {
  return enqueue(async () => {
    const watched = await getWatched();
    const rec = sanitizeWatched(record);
    if (!rec) return { ok: false, error: 'Invalid watched item.' };
    const existing = watched.find((entry) => entry.game === rec.game && entry.itemId === rec.itemId);
    if (existing) {
      Object.assign(existing, {
        name: rec.name || existing.name,
        priceText: rec.priceText || existing.priceText,
        priceAmount: rec.priceAmount != null ? rec.priceAmount : existing.priceAmount,
        priceCurrency: rec.priceCurrency || existing.priceCurrency,
        previousPriceText: rec.previousPriceText || existing.previousPriceText,
        previousPriceAmount: rec.previousPriceAmount != null ? rec.previousPriceAmount : existing.previousPriceAmount,
        previousPriceCurrency: rec.previousPriceCurrency || existing.previousPriceCurrency,
        account: rec.account || existing.account,
        ign: rec.ign || existing.ign,
        whisper: rec.whisper || existing.whisper,
        whisperToken: rec.whisperToken || existing.whisperToken,
        stash: rec.stash || existing.stash,
        searchUrl: rec.searchUrl || existing.searchUrl,
        queryId: rec.queryId || existing.queryId,
        live: rec.live || existing.live,
        coeMods: (rec.coeMods && rec.coeMods.length) ? rec.coeMods : existing.coeMods,
        item: rec.item || existing.item,
        enabled: true,
        status: existing.status === 'sold' ? 'sold' : existing.status,
      });
      await chrome.storage.local.set({ [WATCHED_KEY]: watched });
      await ensureWatchAlarm();
      return { ok: true, duplicate: true, watcher: existing };
    }
    if (watched.length >= MAX_WATCHED) {
      return { ok: false, error: 'Too many watched items (max ' + MAX_WATCHED + ').' };
    }
    rec.order = nextOrder(watched, () => true);
    watched.push(rec);
    await chrome.storage.local.set({ [WATCHED_KEY]: watched });
    await ensureWatchAlarm();
    return { ok: true, watcher: rec };
  });
}

function handleWatchRemove(id) {
  return enqueue(async () => {
    const watched = await getWatched();
    const next = watched.filter((entry) => entry.id !== id && entry.itemId !== id);
    await chrome.storage.local.set({ [WATCHED_KEY]: next });
    return { ok: true, count: next.length };
  });
}

function handleWatchUpdate(id, patch) {
  return enqueue(async () => {
    const watched = await getWatched();
    const watcher = watched.find((entry) => entry.id === id || entry.itemId === id);
    if (!watcher) return { ok: false, error: 'Watched item not found.' };
    if (patch && typeof patch.enabled === 'boolean') watcher.enabled = patch.enabled;
    if (patch && typeof patch.name === 'string' && cleanName(patch.name)) watcher.name = cleanName(patch.name);
    if (patch && patch.targetPrice !== undefined) {
      const nextTarget = (typeof patch.targetPrice === 'number' && patch.targetPrice > 0) ? patch.targetPrice : null;
      if (nextTarget !== watcher.targetPrice) watcher.targetReached = false;
      watcher.targetPrice = nextTarget;
    }
    if (patch && typeof patch.targetCurrency === 'string') watcher.targetCurrency = cleanText(patch.targetCurrency, 40);
    if (patch && patch.expiresAt !== undefined) {
      watcher.expiresAt = Number(patch.expiresAt) > 0 ? Number(patch.expiresAt) : null;
    }
    await chrome.storage.local.set({ [WATCHED_KEY]: watched });
    return { ok: true, watcher };
  });
}

function handleWatchReorder(ids) {
  return enqueue(async () => {
    const watched = await getWatched();
    const order = new Map(asArray(ids).map((id, index) => [id, index]));
    watched.forEach((entry, index) => {
      entry.order = order.has(entry.id) ? order.get(entry.id) : order.size + index;
    });
    watched.sort((a, b) => a.order - b.order);
    await chrome.storage.local.set({ [WATCHED_KEY]: watched });
    return { ok: true };
  });
}

async function ensureWatchAlarm(settings) {
  try {
    const current = settings || await getSettings();
    const interval = Math.min(60, Math.max(1, Number(current.watcherInterval) || 5));
    const alarm = await chrome.alarms.get(WATCH_ALARM);
    if (!alarm || alarm.periodInMinutes !== interval) {
      await chrome.alarms.create(WATCH_ALARM, { periodInMinutes: interval, delayInMinutes: interval });
    }
    /* The search watches run on the same schedule. */
    const searchAlarm = await chrome.alarms.get(SEARCH_WATCH_ALARM);
    if (!searchAlarm || searchAlarm.periodInMinutes !== interval) {
      await chrome.alarms.create(SEARCH_WATCH_ALARM, { periodInMinutes: interval, delayInMinutes: interval });
    }
  } catch (error) {
    /* alarms unavailable */
  }
}

/* A short tone through an offscreen document: the service worker itself has no
   audio, and a watched price change is worth hearing when the panel is closed. */
const SOUND_COOLDOWN = 5000;
let lastSoundAt = 0;

async function playWatchSound() {
  if (Date.now() - lastSoundAt < SOUND_COOLDOWN) return;
  lastSoundAt = Date.now();
  try {
    if (chrome.offscreen && chrome.offscreen.createDocument) {
      const contexts = chrome.runtime.getContexts
        ? await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
        : [];
      if (!contexts || !contexts.length) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['AUDIO_PLAYBACK'],
          justification: 'Play a short alert when a watched price changes.',
        });
      }
      await chrome.runtime.sendMessage({ target: 'ptc-offscreen', type: 'ptc:sound' });
      return;
    }
    /* Firefox has no offscreen document: the sidebar, or a trade tab that is
       open, plays the tone instead. With neither open there is no sound. */
    await chrome.runtime.sendMessage({ target: 'ptc-sound-page', type: 'ptc:sound' });
  } catch (error) {
    /* the sound is a nicety; a failure never blocks the alert */
  }
}

function notify(title, message, key) {
  try {
    chrome.notifications.create('ptc-' + key + '-' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: 1,
    }).catch(() => {});
  } catch (error) {
    /* notifications unavailable */
  }
}

async function hasDiscordPermission(url) {
  if (!chrome.permissions || !chrome.permissions.contains) return true;
  try {
    const origin = new URL(url).origin + '/*';
    return await chrome.permissions.contains({ origins: [origin] });
  } catch (error) {
    return true;
  }
}

/* The webhook pieces shared by the alerts and the build export. */
async function discordTarget(settings) {
  const url = cleanString(settings && settings.discordWebhook, 500);
  if (!url) return { configured: false, ok: false, error: 'Not configured' };
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url)) {
    return { configured: true, ok: false, error: 'Invalid webhook URL' };
  }
  if (!(await hasDiscordPermission(url))) {
    return { configured: true, ok: false, error: 'Permission for discord.com not granted' };
  }
  return { configured: true, ok: true, url: url };
}

async function postDiscordJson(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 160);
      } catch (error) {
        /* body unavailable */
      }
      return { configured: true, ok: false, error: 'HTTP ' + response.status + (detail ? ' - ' + detail : '') };
    }
    return { configured: true, ok: true };
  } catch (error) {
    return { configured: true, ok: false, error: error && error.name === 'AbortError' ? 'Timed out' : 'Network error' };
  } finally {
    clearTimeout(timer);
  }
}

async function postDiscord(settings, title, message, color, icon) {
  const target = await discordTarget(settings);
  if (!target.ok) return target;
  const embed = { title: title, description: message, color: color || 0xd8b56a };
  const thumb = cleanString(icon, 500);
  if (/^https:\/\//.test(thumb)) embed.thumbnail = { url: thumb };
  /* Item text comes from the trade site, so it is not ours to trust. Mentions
     inside an embed do not ping today, but saying so explicitly costs nothing
     and keeps it true whatever Discord does with embeds later. */
  return postDiscordJson(target.url, {
    username: 'Poe Trade Watcher',
    allowed_mentions: { parse: [] },
    embeds: [embed],
  });
}

/* A build pasted into Discord should read like the build page: the build name
   as the title, the ascendancy above it, one field per item with the base and
   the best rolls. Long builds are split into the messages Discord accepts. */
function discordClip(value, limit) {
  const text = cleanString(value, limit + 60);
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

function buildDiscordEmbeds(collection, records) {
  const asc = collection.ascendancy
    ? cleanString(collection.ascendancy.ascendancy || collection.ascendancy, 60)
    : '';
  const name = cleanString(collection.name, 120) || 'Imported build';
  const fields = records.map((rec) => {
    const item = (rec && rec.item) || {};
    const itemName = cleanString(item.name, 100);
    const base = cleanString(item.typeLine || item.baseType || rec.typeLine, 100);
    const label = itemName && base && itemName !== base ? itemName + ' — ' + base : (base || itemName || 'Item');
    const meta = [];
    const frame = Number.isInteger(item.frameType) ? item.frameType : Number(rec.rarity);
    const rarity = ['Normal', 'Magic', 'Rare', 'Unique'][frame];
    if (rarity) meta.push(rarity);
    if (item.corrupted || item.doubleCorrupted) meta.push('Corrupted');
    if (item.ilvl != null) meta.push('ilvl ' + item.ilvl);
    if (rec.league) meta.push(cleanString(rec.league, 40));
    const lines = itemModLines(item).slice(0, 4).map((line) => discordClip(line, 90)).filter(Boolean);
    const value = [meta.join(' · ')].concat(lines).filter(Boolean).join('\n');
    return { name: discordClip(label, 250), value: discordClip(value, 1000) || '—', inline: false };
  });
  const chunks = [];
  for (let index = 0; index < fields.length; index += 20) chunks.push(fields.slice(index, index + 20));
  return chunks.map((group, index) => {
    const embed = {
      title: discordClip(chunks.length > 1 ? name + ' (' + (index + 1) + '/' + chunks.length + ')' : name, 250),
      color: 0xd8b56a,
      fields: group,
      footer: { text: 'Poe Trade Watcher' },
    };
    if (asc) embed.author = { name: asc };
    if (index === 0) {
      embed.description = records.length + (records.length === 1 ? ' item' : ' items') + ' · imported from a build code';
    }
    return embed;
  });
}

async function handleBuildDiscord(collectionId) {
  const id = cleanString(collectionId, 100);
  if (!id) return { ok: false, error: 'Build not found.' };
  const settings = await getSettings();
  const target = await discordTarget(settings);
  if (!target.ok) {
    return {
      ok: false,
      error: target.configured ? target.error : 'Add a Discord webhook in Settings → Watchers first.',
    };
  }
  const collections = await getCollections();
  const collection = collections.find((entry) => entry && entry.id === id);
  if (!collection) return { ok: false, error: 'Build not found.' };
  const items = await getItems();
  const records = items.filter((rec) => rec && (rec.targetOf === id || (!rec.targetOf && rec.collectionId === id)));
  if (!records.length) return { ok: false, error: 'This build has no items to send.' };
  const embeds = buildDiscordEmbeds(collection, records);

  /* Ten embeds and 6000 characters per message: keep each payload well inside
     both, so a build with every slot filled still arrives in one piece. */
  const messages = [];
  let current = [];
  let size = 0;
  embeds.forEach((embed) => {
    const length = JSON.stringify(embed).length;
    if (current.length && (current.length >= 8 || size + length > 4800)) {
      messages.push(current);
      current = [];
      size = 0;
    }
    current.push(embed);
    size += length;
  });
  if (current.length) messages.push(current);

  for (const group of messages) {
    const posted = await postDiscordJson(target.url, {
      username: 'Poe Trade Watcher',
      allowed_mentions: { parse: [] },
      embeds: group,
    });
    if (!posted.ok) return { ok: false, error: posted.error };
  }
  return { ok: true, items: records.length, messages: messages.length };
}

async function webhookAlert(title, message, color) {
  const settings = await getSettings();
  return (await postDiscord(settings, title, message, color)).ok;
}

function ntfyTarget(raw) {
  const value = cleanString(raw, 300).trim();
  if (!value) return null;
  let url;
  try {
    if (/^https?:\/\//i.test(value)) url = new URL(value);
    else if (/^[A-Za-z0-9_-]{1,64}$/.test(value)) url = new URL('https://ntfy.sh/' + value);
    else return null;
  } catch (error) {
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname))) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  let topic = '';
  try {
    topic = decodeURIComponent(segments.pop() || '');
  } catch (error) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) return null;
  return { endpoint: url.origin + (segments.length ? '/' + segments.join('/') : ''), topic };
}

async function postNtfy(settings, title, message) {
  const raw = cleanString(settings.ntfyUrl, 300);
  const target = ntfyTarget(raw);
  if (!target) return { configured: !!raw, ok: false, error: raw ? 'Invalid ntfy URL or topic' : 'Not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(target.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topic: target.topic,
        title: String(title).slice(0, 120),
        message: String(message).slice(0, 1000),
        priority: 3,
        tags: ['game_die'],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 160);
      } catch (error) {
        /* body unavailable */
      }
      return { configured: true, ok: false, error: 'HTTP ' + response.status + (detail ? ' - ' + detail : '') };
    }
    return { configured: true, ok: true };
  } catch (error) {
    return { configured: true, ok: false, error: error && error.name === 'AbortError' ? 'Timed out' : 'Network error' };
  } finally {
    clearTimeout(timer);
  }
}

async function ntfyAlert(title, message) {
  const settings = await getSettings();
  return (await postNtfy(settings, title, message)).ok;
}

async function broadcastAlert(title, message, color) {
  const [discord, ntfy] = await Promise.all([
    webhookAlert(title, message, color),
    ntfyAlert(title, message),
  ]);
  return { discord: discord === true, ntfy: ntfy === true };
}

function getPricesCache() {
  return chrome.storage.local.get({ [PRICES_KEY]: {} })
    .then((data) => (data[PRICES_KEY] && typeof data[PRICES_KEY] === 'object' ? data[PRICES_KEY] : {}));
}

function toPrimary(amount, currency, priceCache, game, league) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || !currency || !priceCache) return null;
  /* The cache holds up to six leagues from both games; the watcher's own league
     has to be the one whose rates are used. */
  const wanted = game && league ? game + ':' + String(league).toLowerCase() : '';
  const entries = wanted && priceCache[wanted] ? [priceCache[wanted]] : Object.values(priceCache);
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !entry.rates) continue;
    const primary = entry.primary || 'divine';
    const rate = entry.rates[String(currency).toLowerCase()];
    const primaryRate = entry.rates[String(primary).toLowerCase()] || 1;
    if (typeof rate === 'number' && rate > 0) return (amount * rate) / primaryRate;
  }
  return null;
}

async function findTradeTab(game) {
  const patterns = [globalThis.PTC_GAMES.config(game).tabPattern];
  try {
    const tabs = await chrome.tabs.query({ url: patterns });
    if (!tabs.length) return null;
    const active = tabs.find((tab) => tab.active);
    return active || tabs[0];
  } catch (error) {
    return null;
  }
}

function sendTabMessage(tabId, message, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs || 25000);
    chrome.tabs.sendMessage(tabId, message).then((response) => {
      clearTimeout(timer);
      resolve(response);
    }).catch(() => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function backgroundFetchWatch(items) {
  const results = [];
  for (const item of items) {
    /* While the site asks this IP to slow down, no request goes out at all. */
    if (tradeBlockRemaining()) break;
    const url = globalThis.PTC_GAMES.fetchApiUrl(item.game, item.itemId, item.queryId);
    await waitForTradePacing();
    try {
      const response = await fetchWithTimeout(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      }, 15000);
      if (!response.ok) {
        if (response.status === 429) {
          const text = await response.text().catch(() => '');
          noteTradeRateLimit(text, response);
          break;
        }
        results.push({ id: item.itemId, error: 'HTTP ' + response.status });
      } else {
        noteRateLimitHeaders(response);
        const data = await response.json();
        results.push({ id: item.itemId, data });
      }
    } catch (error) {
      results.push({ id: item.itemId, error: 'network' });
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return results;
}

function extractListing(data) {
  const result = data && Array.isArray(data.result) ? data.result : [];
  const entry = result.find(Boolean);
  if (!entry || !entry.listing) return null;
  const listing = entry.listing;
  const price = listing.price || (Array.isArray(listing.offers) && listing.offers[0] && listing.offers[0].price) || null;
  const account = listing.account && typeof listing.account === 'object' ? listing.account : {};
  return {
    item: entry.item || null,
    price,
    accountName: cleanString(account.name, 120),
    ign: cleanString(account.lastCharacterName, 120) || cleanString(account.name, 120),
    whisper: cleanString(listing.whisper, 1000),
    whisperToken: cleanString(listing.whisper_token, 200),
    stash: sanitizeStash(listing.stash),
  };
}

function handleItemRefresh(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return enqueue(async () => {
    const info = parseTradeUrl(source.searchUrl || source.sourceUrl || '');
    const id = cleanId(source.id || source.itemId, 200);
    if (!id) return { ok: false, error: 'Missing item ID.' };
    const game = gameOf(source.game || (info && info.game));
    const queryId = cleanQueryId(source.queryId || (info && info.queryId));
    if (!queryId) return { ok: false, error: 'Missing search query for this item.' };

    const request = { itemId: id, game, queryId };
    let results = null;
    const tab = await findTradeTab(game);
    if (tab) {
      const response = await sendTabMessage(tab.id, {
        type: 'ptc:watch:check',
        items: [request],
      });
      if (response && Array.isArray(response.results)) results = response.results;
    }
    if (!results || !results.length) results = await backgroundFetchWatch([request]);

    const result = results.find((entry) => entry.id === id) || results[0];
    if (!result || result.error || !result.data) {
      return { ok: false, error: 'Could not refresh this listing. Open a trade tab or try again later.' };
    }
    const listing = extractListing(result.data);
    if (!listing || !listing.item) {
      return { ok: false, error: 'This listing is no longer available.' };
    }

    const stored = await chrome.storage.local.get({ [ITEMS_KEY]: [], [WATCHED_KEY]: [] });
    const items = asArray(stored[ITEMS_KEY]);
    const watched = asArray(stored[WATCHED_KEY]);
    let changed = false;

    items.forEach((record) => {
      if (!record || record.id !== id || gameOf(record.game) !== game) return;
      mergeListing(record, listing);
      record.refreshedAt = Date.now();
      changed = true;
    });

    watched.forEach((record) => {
      if (!record || record.itemId !== id || gameOf(record.game) !== game) return;
      mergeListing(record, listing);
      record.refreshedAt = Date.now();
      changed = true;
    });

    if (changed) {
      await chrome.storage.local.set({ [ITEMS_KEY]: items, [WATCHED_KEY]: watched });
    }
    return {
      ok: true,
      item: listing.item,
      priceText: priceString(listing.price),
      refreshed: changed,
    };
  });
}

function priceString(price) {
  if (!price) return '';
  const amount = typeof price.amount === 'number' ? price.amount : null;
  let currency = price.currency;
  if (currency && typeof currency === 'object') currency = currency.currency || currency.name || '';
  currency = cleanText(currency, 40);
  if (amount == null || !currency) return '';
  return amount + ' x ' + currency.charAt(0).toUpperCase() + currency.slice(1);
}

function mergeListing(record, listing) {
  if (!record || !listing) return;
  if (listing.item) record.item = listing.item;
  if (listing.item) record.name = itemLabel(listing.item);
  if (listing.item && listing.item.icon) record.icon = cleanString(listing.item.icon, 1000);
  if (listing.accountName) record.account = listing.accountName;
  if (listing.ign) record.ign = listing.ign;
  if (listing.whisper) record.whisper = listing.whisper;
  if (listing.whisperToken) record.whisperToken = listing.whisperToken;
  if (listing.stash) record.stash = listing.stash;
  const nextPrice = priceString(listing.price);
  if (!nextPrice) return;
  record.priceText = nextPrice;
  record.priceAmount = listing.price && typeof listing.price.amount === 'number'
    ? listing.price.amount
    : null;
  let currency = listing.price && listing.price.currency;
  if (currency && typeof currency === 'object') currency = currency.currency || currency.name || currency.type || '';
  record.priceCurrency = cleanText(currency, 40) || record.priceCurrency || '';
  pushPriceHistory(record, nextPrice, record.priceAmount, record.priceCurrency);
}

async function applyWatchResult(watcher, payload, settings, priceCache) {
  watcher.lastChecked = Date.now();
  if (watcher.expiresAt && Date.now() > watcher.expiresAt) {
    if (watcher.status !== 'expired') {
      watcher.status = 'expired';
      watcher.enabled = false;
      if (settings.watcherNotifications) {
        notify('Watcher expired', watcher.name + ' stopped watching (expired).', watcher.id);
      }
    }
    return;
  }
  if (!payload || payload.error || !payload.data) {
    watcher.status = watcher.status === 'sold' ? 'sold' : 'unknown';
    return;
  }
  const listing = extractListing(payload.data);
  if (!listing) {
    watcher.status = 'sold';
    if (!watcher.notifiedSold && settings.watcherNotifications) {
      watcher.notifiedSold = true;
      notify('Watched item sold or removed', watcher.name + ' is no longer listed.', watcher.id);
      broadcastAlert('Watched item sold or removed', watcher.name + ' is no longer listed.', 0x7fa86b).catch(() => {});
    }
    return;
  }
  const previousPrice = watcher.priceText;
  const previousAmount = watcher.priceAmount;
  const previousCurrency = watcher.priceCurrency;
  /* A listing that comes back after "sold" is a new offer: the sold alert may
     fire again when it disappears a second time. */
  const wasSold = watcher.status === 'sold';
  watcher.status = 'available';
  mergeListing(watcher, listing);
  if (wasSold) watcher.notifiedSold = false;
  const nextPrice = watcher.priceText;
  /* The same price in two spellings is not a price change: the row the item was
     watched from says "3 divine" and the api answer formats it "3 x Divine".
     Amount and currency are what a price is, so they are what is compared; the
     text is only used when one of the two sides has no amount. */
  const sameAmount = previousAmount != null && watcher.priceAmount != null
    && Number(previousAmount) === Number(watcher.priceAmount)
    && String(previousCurrency || '').toLowerCase() === String(watcher.priceCurrency || '').toLowerCase();
  const priceChanged = nextPrice && previousPrice
    && (sameAmount ? false : (previousAmount != null && watcher.priceAmount != null ? true : nextPrice !== previousPrice));
  if (priceChanged) {
    watcher.status = 'price-changed';
    watcher.previousPriceText = previousPrice;
    watcher.previousPriceAmount = previousAmount;
    watcher.previousPriceCurrency = previousCurrency;
    if (settings.watcherNotifications && watcher.lastNotifiedPrice !== nextPrice) {
      watcher.lastNotifiedPrice = nextPrice;
      notify('Watched item price changed', watcher.name + ': ' + previousPrice + ' -> ' + nextPrice, watcher.id);
      broadcastAlert('Watched item price changed', watcher.name + ': ' + previousPrice + ' -> ' + nextPrice, 0xd8a95c);
      if (settings.watcherSound !== false) playWatchSound();
    }
  }
  if (watcher.targetPrice != null
    && (watcher.status === 'available' || watcher.status === 'price-changed')) {
    const targetIn = toPrimary(watcher.targetPrice, watcher.targetCurrency || watcher.priceCurrency, priceCache, gameOf(watcher.game), watcher.league);
    const nowIn = toPrimary(watcher.priceAmount, watcher.priceCurrency, priceCache, gameOf(watcher.game), watcher.league);
    /* The price went back above the target: the next drop is worth an alert. */
    if (watcher.targetReached && targetIn != null && nowIn != null && nowIn > targetIn) {
      watcher.targetReached = false;
      watcher.lastNotifiedPrice = nextPrice;
    }
    if (!watcher.targetReached && targetIn != null && nowIn != null && nowIn <= targetIn) {
      watcher.targetReached = true;
      watcher.status = 'target-reached';
      if (settings.watcherNotifications) {
        notify('Target price reached', watcher.name + ': ' + nextPrice
          + ' (target ' + watcher.targetPrice + ' ' + (watcher.targetCurrency || watcher.priceCurrency || '') + ')', watcher.id + '-tgt');
        broadcastAlert('Target price reached', watcher.name + ': ' + nextPrice
          + ' (target ' + watcher.targetPrice + ' ' + (watcher.targetCurrency || watcher.priceCurrency || '') + ')', 0x8b84c9).catch(() => {});
      }
    }
  }
}
/* The check reads the list, then spends seconds on the network. Writing that
   snapshot back would undo a watcher the user added, edited or deleted in the
   meantime, so the fresh list is what gets stored: only the fields the check
   owns are copied onto the entries that are still there. */
const WATCH_RUNTIME_FIELDS = ['lastChecked', 'status', 'notifiedSold',
  'targetReached', 'lastNotifiedPrice', 'priceText', 'priceAmount', 'priceCurrency',
  'priceHistory', 'previousPriceText', 'previousPriceAmount', 'previousPriceCurrency',
  'item', 'name', 'icon', 'account', 'ign', 'whisper', 'whisperToken', 'stash'];

async function saveWatchResults(checked) {
  const byId = new Map(checked.map((entry) => [entry.id, entry]));
  const fresh = await getWatched();
  const merged = fresh.map((entry) => {
    const result = byId.get(entry.id);
    if (!result) return entry;
    const next = { ...entry };
    WATCH_RUNTIME_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(result, field)) next[field] = result[field];
    });
    return next;
  });
  await chrome.storage.local.set({ [WATCHED_KEY]: merged });
}

async function checkWatchers(force) {
  const watched = await getWatched();
  const settings = await getSettings();
  const intervalMs = Math.max(1, Number(settings.watcherInterval) || 5) * 60000;
  /* Oldest first: with more than twenty watchers, taking the list in its
     display order would keep re-checking the same first twenty and starve the
     rest. */
  const due = watched
    .filter((entry) => entry.enabled)
    .filter((entry) => force || !entry.lastChecked || Date.now() - entry.lastChecked >= intervalMs * 0.8)
    .sort((a, b) => (Number(a.lastChecked) || 0) - (Number(b.lastChecked) || 0))
    .slice(0, 20);
  if (!due.length) return { checked: 0 };

  const groups = { poe2: [], poe1: [] };
  due.forEach((entry) => groups[gameOf(entry.game)].push(entry));
  let priceCache = {};
  try {
    priceCache = await getPricesCache();
  } catch (error) {
    priceCache = {};
  }

  for (const game of ['poe2', 'poe1']) {
    const group = groups[game];
    if (!group.length) continue;
    let results = null;
    const tab = await findTradeTab(game);
    if (tab) {
      const response = await sendTabMessage(tab.id, {
        type: 'ptc:watch:check',
        items: group.map((entry) => ({ itemId: entry.itemId, queryId: entry.queryId, game })),
      });
      if (response && Array.isArray(response.results)) results = response.results;
    }
    if (!results) {
      results = await backgroundFetchWatch(group.map((entry) => ({
        itemId: entry.itemId,
        queryId: entry.queryId,
        game,
      })));
    }
    const byId = new Map(results.map((entry) => [entry.id, entry]));
    for (const watcher of group) {
      await applyWatchResult(watcher, byId.get(watcher.itemId), settings, priceCache);
    }
  }

  await saveWatchResults(watched);
  return { checked: due.length };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === WATCH_ALARM) checkWatchers(false).catch(() => {});
  if (alarm && alarm.name === SEARCH_WATCH_ALARM) checkSearchWatches(false).catch(() => {});
  if (alarm && alarm.name === ICON_ALARM) resumeIconQueue().catch(() => {});
});

/* ------------------------------------------------------------------ */
/* Search history                                                      */
/* ------------------------------------------------------------------ */

function handleHistoryAdd(payload) {
  return enqueue(async () => {
    const info = parseTradeUrl(payload && payload.url);
    const game = gameOf((payload && payload.game) || (info && info.game));
    const league = cleanText((payload && payload.league) || (info && info.league), 80);
    const queryId = cleanQueryId((payload && payload.queryId) || (info && info.queryId));
    if (!queryId || !league) return { ok: false };
    const history = await getHistory();
    const existing = history.find((entry) => entry.game === game
      && entry.queryId === queryId
      && (entry.league || '').toLowerCase() === league.toLowerCase());
    if (existing) {
      existing.visitedAt = Date.now();
      existing.visits = (Number(existing.visits) || 1) + 1;
      if (payload && payload.name && cleanName(payload.name)) existing.name = cleanName(payload.name);
    } else {
      history.push({
        id: makeId('hs'),
        game,
        league,
        queryId,
        name: cleanName(payload && payload.name) || (league + ' search'),
        url: cleanString(payload && payload.url, 2000),
        visitedAt: Date.now(),
        visits: 1,
      });
    }
    history.sort((a, b) => (b.visitedAt || 0) - (a.visitedAt || 0));
    const trimmed = [];
    const counts = { poe2: 0, poe1: 0 };
    history.forEach((entry) => {
      const limit = MAX_HISTORY / 2;
      const g = gameOf(entry.game);
      if (counts[g] >= limit) return;
      counts[g] += 1;
      trimmed.push(entry);
    });
    await chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
    return { ok: true };
  });
}

function handleHistoryClear(game) {
  return enqueue(async () => {
    const history = await getHistory();
    const next = game ? history.filter((entry) => entry.game !== gameOf(game)) : [];
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Saved filter presets                                                */
/* ------------------------------------------------------------------ */

function getPresets() {
  return chrome.storage.local.get({ [PRESETS_KEY]: [] }).then((data) => asArray(data[PRESETS_KEY]));
}

function sanitizePreset(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const queryId = cleanQueryId(raw.queryId);
  const url = cleanString(raw.url, 2000);
  if (!queryId && !url) return null;
  return {
    id: cleanId(raw.id) || makeId('preset'),
    name: cleanName(raw.name) || 'Saved search',
    game: gameOf(raw.game),
    league: cleanText(raw.league, 80),
    queryId,
    url,
    filters: raw.filters && typeof raw.filters === 'object' ? raw.filters : null,
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

function handlePresetSave(payload) {
  return enqueue(async () => {
    const presets = await getPresets();
    const preset = sanitizePreset(payload);
    if (!preset) return { ok: false, error: 'Nothing to save.' };
    const existing = presets.findIndex((entry) => entry.queryId && entry.queryId === preset.queryId);
    if (existing !== -1) {
      preset.id = presets[existing].id;
      presets[existing] = preset;
    } else {
      /* Newest first: the oldest preset is the one to drop. */
      if (presets.length >= MAX_PRESETS) presets.pop();
      presets.unshift(preset);
    }
    await chrome.storage.local.set({ [PRESETS_KEY]: presets });
    return { ok: true, preset, count: presets.length };
  });
}

function handlePresetDelete(id) {
  return enqueue(async () => {
    const presets = await getPresets();
    const next = presets.filter((entry) => entry.id !== id);
    await chrome.storage.local.set({ [PRESETS_KEY]: next });
    return { ok: true, count: next.length };
  });
}

/* ------------------------------------------------------------------ */
/* Price index                                                         */
/* ------------------------------------------------------------------ */

/* Every listing the user sees or saves becomes a sample for the local
   market index, which powers the "fair price" hints. */
function handlePriceIndexAdd(records) {
  return enqueue(async () => {
    const rows = asArray(records).slice(0, 500);
    if (!rows.length) return { ok: true, count: 0 };
    const stored = await chrome.storage.local.get({ [PRICE_INDEX_KEY]: {} });
    const index = stored[PRICE_INDEX_KEY] && typeof stored[PRICE_INDEX_KEY] === 'object'
      ? stored[PRICE_INDEX_KEY] : {};
    let added = 0;
    rows.forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const key = cleanString(row.key, 200);
      const value = Number(row.value);
      if (!key || !isFinite(value) || value <= 0) return;
      const list = asArray(index[key]).filter((v) => isFinite(Number(v)) && Number(v) > 0);
      list.push(value);
      while (list.length > 40) list.shift();
      index[key] = list;
      added += 1;
    });
    const keys = Object.keys(index);
    while (keys.length > 400) delete index[keys.shift()];
    await chrome.storage.local.set({ [PRICE_INDEX_KEY]: index });
    return { ok: true, count: added };
  });
}

/* ------------------------------------------------------------------ */
/* Search watchers ("watch this search")                              */
/* ------------------------------------------------------------------ */

/*
 * A PoE2 trade query id is base64(gzip(query)). The site uses it to restore a
 * shared search, so the extension can decode any link the user has and run the
 * very same query again without the trade tab being open.
 */
async function decodeTradeQuery(queryId) {
  const raw = cleanText(queryId, 4000);
  if (!raw) return null;
  let bytes;
  try {
    const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } catch (error) {
    return null;
  }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

/* Runs a decoded query again and returns the current result ids. */
async function runTradeSearch(game, league, query, sort) {
  assertTradeNotBlocked();
  const url = globalThis.PTC_GAMES.searchApiUrl(game, league || 'Standard');
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: query, sort: sort || { price: 'asc' } }),
  }, 15000);
  if (!response.ok) {
    if (response.status === 429) {
      const body = await response.text().catch(() => '');
      noteTradeRateLimit(body, response);
      const error = new Error(tradeBlockMessage());
      error.rateLimited = true;
      throw error;
    }
    throw new Error('trade search HTTP ' + response.status);
  }
  noteRateLimitHeaders(response);
  const data = await response.json().catch(() => null);
  if (!data) throw new Error('empty trade search response');
  return {
    queryId: cleanText(data.id, 4000),
    ids: (Array.isArray(data.result) ? data.result : []).filter((id) => typeof id === 'string' && id),
  };
}

/* Reads the listing details (item, price, seller) for a set of result ids. */
async function fetchTradeListings(game, queryId, ids) {
  if (!ids.length) return [];
  assertTradeNotBlocked();
  const url = globalThis.PTC_GAMES.fetchApiUrl(game, ids, queryId);
  const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 15000);
  if (!response.ok) {
    if (response.status === 429) {
      const body = await response.text().catch(() => '');
      noteTradeRateLimit(body, response);
      const error = new Error(tradeBlockMessage());
      error.rateLimited = true;
      throw error;
    }
    throw new Error('trade fetch HTTP ' + response.status);
  }
  noteRateLimitHeaders(response);
  const data = await response.json().catch(() => null);
  return Array.isArray(data && data.result) ? data.result : [];
}

function listingToPayload(entry) {
  const item = (entry && entry.item) || {};
  const listing = (entry && entry.listing) || {};
  const price = listing.price || {};
  const account = listing.account || {};
  return {
    id: cleanText(entry && entry.id, 200),
    name: cleanText(item.name || item.typeLine, 120),
    typeLine: cleanText(item.typeLine, 120),
    priceText: price.amount != null ? cleanText(String(price.amount) + ' ' + (price.currency || ''), 60) : '',
    priceAmount: Number(price.amount) || 0,
    priceCurrency: cleanText(price.currency, 60),
    account: cleanText(account.name || '', 80),
    ilvl: Number(item.ilvl) || 0,
    rarity: cleanText(item.rarity, 20),
    listedAt: Number(listing.indexed || listing.dateListed) || 0,
  };
}

/* "12 divine" / "1.5 exalted" as the trade site writes it. */
function parsePriceAmount(value) {
  const raw = cleanText(value, 60);
  if (!raw) return null;
  const match = raw.match(/(\d[\d.,\s]*)\s*([A-Za-z][A-Za-z'\- ]*)$/);
  if (!match) return null;
  const amount = Number(match[1].replace(/[,\s]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currency = cleanText(match[2], 40);
  if (!currency) return null;
  return { amount: amount, currency: currency };
}

/* The poe.ninja id for a currency name ("divine orb" -> "divine"). */
function priceRateId(name, prices) {
  const full = cleanText(name, 40).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!full) return '';
  const reduced = full.replace(/\b(of|orb|orbs)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const names = (prices && prices.names) || {};
  if (names[full]) return names[full];
  if (names[reduced]) return names[reduced];
  return reduced.replace(/\s+/g, '-');
}

/* A price in the primary currency of the snapshot, or null when no rate is known. */
function divineValue(amount, currency, prices) {
  if (!prices || !prices.rates || typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const rate = prices.rates[priceRateId(currency, prices)];
  if (typeof rate !== 'number' || rate <= 0) return null;
  const primary = prices.primary || 'divine';
  const primaryAmount = amount * rate;
  if (primary === 'divine') return primaryAmount;
  return prices.rates.divine ? primaryAmount / prices.rates.divine : null;
}

/* Does this listing pass the criteria of the watch? */
function matchesSearchWatch(watch, payload, prices) {
  const nameFilter = cleanText(watch.filters && watch.filters.name, 120).toLowerCase();
  if (nameFilter) {
    const haystack = (cleanText(payload.name) + ' ' + cleanText(payload.typeLine)).toLowerCase();
    if (haystack.indexOf(nameFilter) === -1) return false;
  }
  const maxPrice = Number(watch.maxPrice) || 0;
  if (maxPrice > 0 && prices) {
    const parsed = parsePriceAmount(payload.priceText);
    if (parsed) {
      const value = divineValue(parsed.amount, parsed.currency, prices);
      if (value != null && value > maxPrice) return false;
    }
  }
  return true;
}

function getSearchWatches() {
  return chrome.storage.local.get({ [SEARCH_WATCHES_KEY]: [] }).then((data) => asArray(data[SEARCH_WATCHES_KEY]));
}

function sanitizeSearchWatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const queryId = cleanQueryId(raw.queryId);
  if (!queryId) return null;
  return {
    id: cleanId(raw.id) || makeId('sw'),
    name: cleanName(raw.name) || 'Search watch',
    game: gameOf(raw.game),
    league: cleanText(raw.league, 80),
    queryId,
    filters: raw.filters && typeof raw.filters === 'object' ? raw.filters : null,
    maxPrice: Number(raw.maxPrice) || 0,
    enabled: raw.enabled !== false,
    seen: raw.seen && typeof raw.seen === 'object' ? raw.seen : {},
    notified: raw.notified && typeof raw.notified === 'object' ? raw.notified : {},
    addedAt: Number(raw.addedAt) || Date.now(),
    lastChecked: Number(raw.lastChecked) || 0,
    lastFound: Number(raw.lastFound) || 0,
  };
}

function handleSearchWatchAdd(payload) {
  return enqueue(async () => {
    const watches = await getSearchWatches();
    const watch = sanitizeSearchWatch(payload);
    if (!watch) return { ok: false, error: 'This search cannot be watched.' };
    const existing = watches.findIndex((entry) => entry.queryId === watch.queryId
      && (entry.league || '').toLowerCase() === (watch.league || '').toLowerCase());
    if (existing !== -1) {
      watch.id = watches[existing].id;
      watch.seen = watches[existing].seen || {};
      watch.notified = watches[existing].notified || {};
      watches[existing] = watch;
    } else {
      if (watches.length >= MAX_SEARCH_WATCHES) return { ok: false, error: 'Too many search watches.' };
      watches.unshift(watch);
    }
    await chrome.storage.local.set({ [SEARCH_WATCHES_KEY]: watches });
    return { ok: true, watch, count: watches.length };
  });
}

function handleSearchWatchRemove(id) {
  return enqueue(async () => {
    const watches = await getSearchWatches();
    const next = watches.filter((entry) => entry.id !== id);
    await chrome.storage.local.set({ [SEARCH_WATCHES_KEY]: next });
    return { ok: true, count: next.length };
  });
}

function handleSearchWatchUpdate(id, patch) {
  return enqueue(async () => {
    const watches = await getSearchWatches();
    const watch = watches.find((entry) => entry.id === id);
    if (!watch) return { ok: false, error: 'Watch not found.' };
    if (patch && typeof patch === 'object') {
      if (typeof patch.enabled === 'boolean') watch.enabled = patch.enabled;
      if (patch.maxPrice != null) watch.maxPrice = Number(patch.maxPrice) || 0;
      if (patch.filters !== undefined) {
        watch.filters = patch.filters && typeof patch.filters === 'object' ? patch.filters : null;
      }
      if (patch.name) watch.name = cleanName(patch.name);
    }
    await chrome.storage.local.set({ [SEARCH_WATCHES_KEY]: watches });
    return { ok: true, watch };
  });
}

/*
 * Runs every enabled search watch: it replays the stored query on the trade
 * site and reports the listings that were not there the last time. This runs
 * without any trade tab open, which is what makes the feature useful.
 */
/* The same rule as the item watchers: the list is re-read before it is stored,
   and only the fields of the check are copied onto it. */
const SEARCH_WATCH_RUNTIME_FIELDS = ['lastChecked', 'lastFound', 'seen', 'notified'];

async function saveSearchWatchResults(checked) {
  const byId = new Map(checked.map((entry) => [entry.id, entry]));
  const fresh = await getSearchWatches();
  const merged = fresh.map((entry) => {
    const result = byId.get(entry.id);
    if (!result) return entry;
    const next = { ...entry };
    SEARCH_WATCH_RUNTIME_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(result, field)) next[field] = result[field];
    });
    return next;
  });
  await chrome.storage.local.set({ [SEARCH_WATCHES_KEY]: merged });
}

async function checkSearchWatches(force) {
  const watches = await getSearchWatches();
  if (!watches.length) return { checked: 0, notified: 0 };
  const settings = await getSettings();
  /* A search watch is the expensive check: a real search plus a fetch of its
     newest listings, every cycle. The item watchers can afford to run every
     minute, a search watch cannot - it gets a floor of fifteen minutes so the
     shared request budget is not spent in an afternoon. */
  const intervalMs = Math.max(15, Number(settings.watcherInterval) || 5) * 60000;
  let notified = 0;
  let checked = 0;

  const startedAt = Date.now();
  for (const watch of watches) {
    if (Date.now() - startedAt > SEARCH_WATCH_BUDGET_MS) break;
    if (!watch.enabled) continue;
    /* While the site asks this IP to slow down, nothing goes out. */
    if (tradeBlockRemaining()) break;
    if (!force && watch.lastChecked && Date.now() - watch.lastChecked < intervalMs) continue;
    watch.lastChecked = Date.now();
    checked += 1;
    const game = gameOf(watch.game);
    try {
      const query = await decodeTradeQuery(watch.queryId);
      if (!query) continue;
      /* Newest first: the top of the result set is where a fresh listing shows
         up, so a price sorted page would keep showing the same cheap items. */
      let search = null;
      try {
        search = await runTradeSearch(game, watch.league, query, { indexed: 'desc' });
      } catch (error) {
        /* A rate limit is not a reason to try again right away. */
        if (error && error.rateLimited) break;
        search = await runTradeSearch(game, watch.league, query, { price: 'asc' });
      }
      if (!search.ids.length) continue;

      const seen = watch.seen && typeof watch.seen === 'object' ? watch.seen : {};
      const fresh = search.ids.filter((id) => !seen[id]);
      if (!fresh.length) continue;

      /* The first run only establishes the baseline, otherwise every existing
         listing would be reported as new. */
      if (!Object.keys(seen).length) {
        search.ids.forEach((id) => { seen[id] = Date.now(); });
        watch.seen = seen;
        continue;
      }

      let prices = null;
      try {
        const response = await handlePrices(game, watch.league, false);
        if (response && response.ok) prices = response.prices;
      } catch (error) {
        /* no rates */
      }

      const listings = await fetchTradeListings(game, search.queryId, fresh.slice(0, 20));
      listings.forEach((entry) => {
        const payload = listingToPayload(entry);
        if (!payload.id) return;
        seen[payload.id] = Date.now();
        if (!matchesSearchWatch(watch, payload, prices)) return;
        const message = payload.priceText
          ? payload.name + ' — ' + payload.priceText + (payload.account ? ' — ' + payload.account : '')
          : payload.name;
        if (settings.watcherNotifications !== false) {
          notify('New listing in a watched search', message, 'sw-' + watch.id);
          broadcastAlert('New listing: ' + watch.name, message, 0x6d8cff).catch(() => {});
        }
        notified += 1;
      });

      /* Anything the fetch did not return is still worth remembering. */
      fresh.forEach((id) => { if (!seen[id]) seen[id] = Date.now(); });
      const keys = Object.keys(seen);
      while (keys.length > 600) delete seen[keys.shift()];
      watch.seen = seen;
      watch.lastFound = Date.now();
    } catch (error) {
      /* a failed check is not fatal; the next run tries again */
    } finally {
      /* Saved after every watch: if the worker is stopped mid-loop, what was
         already seen stays seen and the next run does not notify twice. */
      await saveSearchWatchResults(watches);
      await tradeSearchThrottle();
    }
  }

  return { checked: checked, notified: notified };
}

/*
 * A new listing showed up in a search that is being watched. The trade tab
 * reports every listing it sees; the background decides whether it matches the
 * watch criteria and has not been reported before. This is the instant path:
 * the polling above is what covers the case where no tab is open.
 */
function handleSearchWatchListing(payload) {
  return enqueue(async () => {
    const watches = await getSearchWatches();
    if (!watches.length) return { ok: true, matched: 0 };
    const queryId = cleanQueryId(payload && payload.queryId);
    const league = cleanText(payload && payload.league, 80);
    const listingId = cleanId(payload && payload.id, 200);
    if (!queryId || !listingId) return { ok: true, matched: 0 };

    const matching = watches.filter((entry) => entry.enabled
      && entry.queryId === queryId
      && (!entry.league || !league || (entry.league || '').toLowerCase() === league.toLowerCase()));
    if (!matching.length) return { ok: true, matched: 0 };

    const game = gameOf((matching[0] && matching[0].game) || (payload && payload.game));
    const settings = await getSettings();
    let prices = null;
    if (matching.some((entry) => Number(entry.maxPrice) > 0)) {
      try {
        const response = await handlePrices(game, league, false);
        if (response && response.ok) prices = response.prices;
      } catch (error) {
        /* no rates available */
      }
    }

    let notified = 0;
    for (const watch of matching) {
      if (watch.notified && watch.notified[listingId]) continue;
      if (!matchesSearchWatch(watch, payload, prices)) continue;
      watch.notified[listingId] = Date.now();
      const keys = Object.keys(watch.notified);
      while (keys.length > 200) delete watch.notified[keys.shift()];
      notified += 1;

      const name = cleanText(payload.name, 120) || 'New listing';
      const price = cleanText(payload.priceText, 60);
      const message = price
        ? name + ' — ' + price + ' — ' + cleanText(payload.account, 80)
        : name + ' — ' + cleanText(payload.account, 80);
      if (settings.watcherNotifications !== false) {
        notify('New listing in a watched search', message, 'sw-' + watch.id);
        await broadcastAlert('New listing: ' + watch.name, message, 0x6d8cff).catch(() => {});
      }
    }

    if (notified) await chrome.storage.local.set({ [SEARCH_WATCHES_KEY]: watches });
    return { ok: true, matched: notified };
  });
}

/* ------------------------------------------------------------------ */
/* Crafting cost                                                       */
/* ------------------------------------------------------------------ */

/*
 * Estimates what the item would cost to craft by hand: the price of the base
 * plus one currency roll per crafted modifier. The Craft of Exile data gives
 * the affix tiers, poe.ninja gives the currency prices.
 */
function handleCraftCost(payload) {
  return enqueue(async () => {
    const rec = payload && payload.record;
    if (!rec || !rec.item) return { ok: false, error: 'No item.' };
    const game = gameOf(rec);
    const league = cleanText(payload.league, 80) || await resolveLeague(game, '');
    let prices = null;
    try {
      const response = await handlePrices(game, league, false);
      if (response && response.ok) prices = response.prices;
    } catch (error) {
      /* no rates */
    }
    if (!prices) return { ok: false, error: 'No currency rates available yet.' };

    let index = null;
    try {
      index = await COE.loadIndex((url) => coeFetchText(url), game);
    } catch (error) {
      index = null;
    }
    if (!index) return { ok: false, error: 'The Craft of Exile data is not available yet.' };

    const item = rec.item || {};
    const base = cleanText(item.baseType || item.typeLine || item.name).replace(/^superior\s+/i, '');
    const crafted = Array.isArray(item.craftedMods) ? item.craftedMods : [];
    const fractured = Array.isArray(item.fracturedMods) ? item.fracturedMods : [];

    const rolls = [];
    let modCost = 0;
    crafted.concat(fractured).forEach((entry) => {
      const text = cleanText(entry && (entry.text || entry.description));
      if (!text) return;
      const mod = COE.resolveMod(index, base, text);
      const tier = mod && Number.isFinite(mod.tier) ? mod.tier : 3;
      const currency = tierCurrencyId(tier, game);
      const cost = currencyPriceInChaos(prices, currency);
      modCost += cost;
      rolls.push({ text, affix: (mod && mod.name) || '', tier, currency, cost });
    });

    /* The base price comes from the local market index when the base was seen. */
    const samples = await getPriceIndexSamples();
    const baseKey = base.toLowerCase();
    let baseCost = null;
    if (samples[baseKey] && samples[baseKey].length >= 3) {
      const sorted = samples[baseKey].slice().sort((a, b) => a - b);
      baseCost = sorted[Math.floor(sorted.length / 2)];
    }

    const total = baseCost != null ? baseCost + modCost : null;
    const price = Number(payload.priceValue) || 0;
    return {
      ok: true,
      base,
      baseCost,
      modCost,
      total,
      rolls,
      known: total != null,
      cheaperToCraft: total != null && price > 0 ? total < price : null,
      price,
    };
  });
}

/* The tier-to-currency ladder is a property of the game and lives in its
   profile (PoE 1 leans on alterations and exalts, PoE 2 on regal and vaal). */
function tierCurrencyId(tier, game) {
  const table = globalThis.PTC_GAMES.profile(game).tierCurrency || [];
  if (!table.length) return 'chaos';
  let choice = table[0];
  table.forEach((entry) => { if (tier >= entry.tier) choice = entry; });
  return choice.currency;
}

function currencyPriceInChaos(prices, id) {
  if (!prices || !prices.rates) return 0;
  const rate = prices.rates[id];
  const chaos = prices.rates.chaos;
  if (!isFinite(rate) || !isFinite(chaos) || chaos <= 0) return 0;
  return rate / chaos;
}

function getPriceIndexSamples() {
  return chrome.storage.local.get({ [PRICE_INDEX_KEY]: {} })
    .then((data) => (data[PRICE_INDEX_KEY] && typeof data[PRICE_INDEX_KEY] === 'object' ? data[PRICE_INDEX_KEY] : {}));
}

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

function handlePrices(game, league, force) {
  return (async () => {
    const targetGame = gameOf(game);
    const targetLeague = cleanText(league, 80) || await resolveLeague(targetGame, '') || 'Standard';
    const data = await chrome.storage.local.get({ [PRICES_KEY]: {} });
    const cache = data[PRICES_KEY] && typeof data[PRICES_KEY] === 'object' ? data[PRICES_KEY] : {};
    const key = targetGame + ':' + targetLeague.toLowerCase();
    const cached = cache[key];
    if (!force && cached && Date.now() - (cached.fetchedAt || 0) < PRICE_TTL) {
      return { ok: true, prices: cached };
    }
    const url = 'https://poe.ninja/' + targetGame + '/api/economy/exchange/current/overview'
      + '?league=' + encodeURIComponent(targetLeague) + '&type=Currency';
    try {
      const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 12000);
      if (!response.ok) return { ok: false, error: 'poe.ninja HTTP ' + response.status };
      const payload = await response.json();
      const rates = {};
      asArray(payload.lines).forEach((line) => {
        if (line && typeof line.id === 'string' && typeof line.primaryValue === 'number') {
          rates[line.id] = line.primaryValue;
        }
      });
      const names = {};
      asArray(payload.items).forEach((entry) => {
        if (entry && typeof entry.name === 'string' && typeof entry.id === 'string') {
          names[entry.name.toLowerCase().trim()] = entry.id;
        }
      });
      const defaultPrimary = globalThis.PTC_GAMES.profile(targetGame).defaultCurrency
        || (targetGame === 'poe1' ? 'chaos' : 'divine');
      const prices = {
        game: targetGame,
        league: targetLeague,
        primary: payload.core && payload.core.primary ? payload.core.primary : defaultPrimary,
        secondary: payload.core && payload.core.secondary ? payload.core.secondary : defaultPrimary,
        rates,
        names,
        fetchedAt: Date.now(),
      };
      cache[key] = prices;
      const keys = Object.keys(cache).sort((a, b) => (cache[b].fetchedAt || 0) - (cache[a].fetchedAt || 0));
      keys.slice(6).forEach((oldKey) => delete cache[oldKey]);
      await chrome.storage.local.set({ [PRICES_KEY]: cache });
      return { ok: true, prices };
    } catch (error) {
      return { ok: false, error: 'Could not load poe.ninja prices.' };
    }
  })();
}

/* ------------------------------------------------------------------ */
/* Backup, restore, sync                                               */
/* ------------------------------------------------------------------ */

async function buildBackup() {
  const data = await chrome.storage.local.get({
    [ITEMS_KEY]: [],
    [COLLECTIONS_KEY]: [],
    [FOLDERS_KEY]: [],
    [BOOKMARKS_KEY]: [],
    [MULTI_KEY]: [],
    [WATCHED_KEY]: [],
    [SETTINGS_KEY]: {},
    [HISTORY_KEY]: [],
    [PRESETS_KEY]: [],
    [SEARCH_WATCHES_KEY]: [],
  });
  return {
    app: 'poe-trade-collection',
    version: 4,
    exportedAt: new Date().toISOString(),
    items: asArray(data[ITEMS_KEY]).map((entry) => stripWhisperTokens(entry)),
    collections: data[COLLECTIONS_KEY],
    folders: data[FOLDERS_KEY],
    bookmarks: data[BOOKMARKS_KEY],
    multiLive: asArray(data[MULTI_KEY]).map((entry) => ({ ...entry, tabId: null, enabled: false })),
    watched: asArray(data[WATCHED_KEY]).map((entry) => stripWhisperTokens({ ...entry, lastChecked: 0 })),
    settings: { ...data[SETTINGS_KEY], discordWebhook: '', ntfyUrl: '' },
    history: data[HISTORY_KEY],
    presets: asArray(data[PRESETS_KEY]),
    searchWatches: asArray(data[SEARCH_WATCHES_KEY]).map((entry) => ({ ...entry, notified: {} })),
  };
}

function stripWhisperTokens(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const copy = { ...entry };
  delete copy.whisperToken;
  if (copy.listing && typeof copy.listing === 'object') {
    const listing = { ...copy.listing };
    delete listing.whisper_token;
    copy.listing = listing;
  }
  return copy;
}

function handleRestore(payload) {
  return enqueue(() => restorePayload(payload));
}

/* The work without the queue. The legacy importer already runs inside enqueue
   and would deadlock waiting for a second turn of the same promise chain. */
async function restorePayload(payload) {
  {
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Invalid backup file.' };
    const updates = {};
    if (Array.isArray(payload.items)) {
      updates[ITEMS_KEY] = payload.items.map(sanitizeRecord).filter(Boolean).slice(0, MAX_ITEMS);
    }
    if (Array.isArray(payload.collections)) {
      updates[COLLECTIONS_KEY] = payload.collections
        .map(sanitizeCollection)
        .filter(Boolean)
        .slice(0, MAX_COLLECTIONS);
    }
    if (Array.isArray(payload.folders)) {
      updates[FOLDERS_KEY] = payload.folders.map(sanitizeFolder).filter(Boolean).slice(0, MAX_FOLDERS);
    }
    if (Array.isArray(payload.bookmarks)) {
      updates[BOOKMARKS_KEY] = payload.bookmarks.map(sanitizeBookmark).filter(Boolean).slice(0, MAX_BOOKMARKS);
    }
    if (Array.isArray(payload.watched)) {
      updates[WATCHED_KEY] = payload.watched.map(sanitizeWatched).filter(Boolean).slice(0, MAX_WATCHED);
    }
    if (payload.settings && typeof payload.settings === 'object') {
      /* A backup never carries the Discord webhook or the ntfy topic (they are
         secrets, stripped on export), so a restore keeps the local ones instead
         of blanking them and silently stopping every alert. */
      const local = await getSettings();
      updates[SETTINGS_KEY] = normalizeSettings({
        ...payload.settings,
        discordWebhook: local.discordWebhook,
        ntfyUrl: local.ntfyUrl,
      });
    }
    if (Array.isArray(payload.history)) {
      updates[HISTORY_KEY] = payload.history
        .filter((entry) => entry && entry.game && entry.queryId)
        .map((entry) => ({
          id: cleanId(entry.id) || makeId('hs'),
          game: gameOf(entry.game),
          league: cleanText(entry.league, 80),
          queryId: cleanQueryId(entry.queryId),
          name: cleanName(entry.name) || 'Search',
          /* Only a trade URL this extension understands gets stored; a backup
             is a file the extension did not write. */
          url: parseTradeUrl(entry.url) ? cleanString(entry.url, 2000) : '',
          visitedAt: Number(entry.visitedAt) || Date.now(),
          visits: Number(entry.visits) || 1,
        }))
        .slice(0, MAX_HISTORY);
    }
    if (Array.isArray(payload.multiLive)) {
      updates[MULTI_KEY] = payload.multiLive.map(sanitizeMultiEntry).filter(Boolean).map((entry) => ({
        ...entry,
        enabled: false,
        tabId: null,
      }));
    }
    if (Array.isArray(payload.presets)) {
      updates[PRESETS_KEY] = payload.presets.map(sanitizePreset).filter(Boolean).slice(0, MAX_PRESETS);
    }
    if (Array.isArray(payload.searchWatches)) {
      updates[SEARCH_WATCHES_KEY] = payload.searchWatches.map(sanitizeSearchWatch).filter(Boolean).slice(0, MAX_SEARCH_WATCHES);
    }
    await chrome.storage.local.set(updates);
    if (updates[SETTINGS_KEY]) await ensureWatchAlarm(updates[SETTINGS_KEY]);
    return {
      ok: true,
      items: (updates[ITEMS_KEY] || []).length,
      folders: (updates[FOLDERS_KEY] || []).length,
      bookmarks: (updates[BOOKMARKS_KEY] || []).length,
    };
  }
}

function handleLegacyImport(text) {
  return enqueue(async () => {
    const raw = String(text || '').trim();
    if (!raw) return { ok: false, error: 'Paste a backup first.' };
    if (raw.startsWith('{')) {
      try {
        return await restorePayload(JSON.parse(raw));
      } catch (error) {
        return { ok: false, error: 'Invalid JSON backup.' };
      }
    }
    const folders = await getFolders();
    const bookmarks = await getBookmarks();
    const created = { folders: 0, bookmarks: 0 };
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/https?:\/\/\S+/);
      if (!match) continue;
      const url = match[0].replace(/[),.;]+$/, '');
      const info = parseTradeUrl(url);
      if (!info || !info.queryId) continue;
      const before = line.slice(0, match.index).replace(/[\-|>\t]+$/g, '').trim();
      let folderPath = '';
      let name = before;
      const bracket = before.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (bracket) {
        folderPath = bracket[1];
        name = bracket[2];
      } else if (/\s+[|>]\s+/.test(before)) {
        const parts = before.split(/\s+[|>]\s+/);
        if (parts.length > 1) {
          folderPath = parts.slice(0, -1).join(' / ');
          name = parts[parts.length - 1];
        }
      } else if (before.includes('/')) {
        const parts = before.split('/').map((part) => part.trim()).filter(Boolean);
        if (parts.length > 1) {
          folderPath = parts.slice(0, -1).join(' / ');
          name = parts[parts.length - 1];
        }
      }
      let parentId = '';
      if (folderPath) {
        for (const part of folderPath.split('/').map((value) => cleanName(value)).filter(Boolean)) {
          let folder = folders.find((entry) => entry.parentId === parentId
            && entry.game === info.game
            && entry.name.toLowerCase() === part.toLowerCase());
          if (!folder) {
            folder = sanitizeFolder({
              id: makeId('fld'),
              parentId,
              name: part,
              icon: 'folder',
              game: info.game,
              order: nextOrder(folders, (entry) => entry.parentId === parentId),
            });
            folders.push(folder);
            created.folders += 1;
          }
          parentId = folder.id;
        }
      }
      if (bookmarks.some((entry) => entry.game === info.game
        && entry.queryId === info.queryId
        && (entry.league || '').toLowerCase() === info.league.toLowerCase())) continue;
      const bookmark = sanitizeBookmark({
        id: makeId('bm'),
        folderId: parentId,
        name: cleanName(name) || info.league + ' search',
        game: info.game,
        league: info.league,
        leagueMode: 'auto',
        queryId: info.queryId,
        mode: info.live ? 'live' : 'search',
        order: nextOrder(bookmarks, (entry) => entry.folderId === parentId),
      });
      if (bookmark) {
        bookmarks.push(bookmark);
        created.bookmarks += 1;
      }
    }
    if (!created.bookmarks) return { ok: false, error: 'No trade search URLs were found.' };
    await chrome.storage.local.set({
      [FOLDERS_KEY]: folders,
      [BOOKMARKS_KEY]: bookmarks,
    });
    notifySyncPush();
    return { ok: true, ...created };
  });
}

let syncTimer = null;

function queueSyncPush() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    pushSync().catch(() => {});
  }, 2000);
}

async function pushSync() {
  const settings = await getSettings();
  if (!settings.syncEnabled) return { ok: false, error: 'Sync is disabled.' };
  const data = await chrome.storage.local.get({
    [FOLDERS_KEY]: [],
    [BOOKMARKS_KEY]: [],
  });
  const payload = {
    app: 'ptc-sync',
    version: 3,
    at: Date.now(),
    folders: data[FOLDERS_KEY],
    bookmarks: data[BOOKMARKS_KEY],
    settings: { ...settings, discordWebhook: '', ntfyUrl: '' },
  };
  const encoded = utf8ToBase64(JSON.stringify(payload));
  const chunks = [];
  for (let i = 0; i < encoded.length; i += SYNC_CHUNK) {
    chunks.push(encoded.slice(i, i + SYNC_CHUNK));
  }
  const meta = { version: 3, at: payload.at, chunks: chunks.length, size: encoded.length };
  const update = { [SYNC_PREFIX + 'Meta']: meta };
  chunks.forEach((chunk, index) => {
    update[SYNC_PREFIX + 'Chunk' + index] = chunk;
  });
  try {
    const existing = await chrome.storage.sync.get(null);
    const remove = Object.keys(existing).filter((key) => {
      if (!key.startsWith(SYNC_PREFIX + 'Chunk')) return false;
      const index = Number(key.slice((SYNC_PREFIX + 'Chunk').length));
      return Number.isFinite(index) && index >= chunks.length;
    });
    await chrome.storage.sync.set(update);
    if (remove.length) await chrome.storage.sync.remove(remove);
    return { ok: true, chunks: chunks.length, bytes: encoded.length };
  } catch (error) {
    return { ok: false, error: 'Browser sync storage is full or unavailable.' };
  }
}

async function pullSync() {
  const metaResult = await chrome.storage.sync.get(SYNC_PREFIX + 'Meta');
  const meta = metaResult[SYNC_PREFIX + 'Meta'];
  if (!meta || !Number.isInteger(meta.chunks)) {
    return { ok: false, error: 'No synced bookmarks found.' };
  }
  const keys = [];
  for (let i = 0; i < meta.chunks; i += 1) keys.push(SYNC_PREFIX + 'Chunk' + i);
  const chunks = await chrome.storage.sync.get(keys);
  const encoded = keys.map((key) => chunks[key] || '').join('');
  let payload;
  try {
    payload = JSON.parse(base64ToUtf8(encoded));
  } catch (error) {
    return { ok: false, error: 'Synced data is corrupted.' };
  }
  const folders = asArray(payload.folders).map(sanitizeFolder).filter(Boolean);
  const bookmarks = asArray(payload.bookmarks).map(sanitizeBookmark).filter(Boolean);
  const local = await getSettings();
  const settings = normalizeSettings({
    ...payload.settings,
    discordWebhook: local.discordWebhook,
    ntfyUrl: local.ntfyUrl,
  });
  await chrome.storage.local.set({
    [FOLDERS_KEY]: folders,
    [BOOKMARKS_KEY]: bookmarks,
    [SETTINGS_KEY]: settings,
  });
  await ensureWatchAlarm(settings);
  return { ok: true, folders: folders.length, bookmarks: bookmarks.length };
}

async function autoPullSync() {
  try {
    const data = await chrome.storage.local.get({ [FOLDERS_KEY]: [], [BOOKMARKS_KEY]: [] });
    if (asArray(data[FOLDERS_KEY]).length || asArray(data[BOOKMARKS_KEY]).length) return;
    await pullSync();
  } catch (error) {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle and message router                                        */
/* ------------------------------------------------------------------ */

async function repairBookmarkGames() {
  const folders = await getFolders();
  const bookmarks = await getBookmarks();
  const folderById = {};
  folders.forEach((folder) => { folderById[folder.id] = folder; });
  let changed = false;
  bookmarks.forEach((bookmark) => {
    const folder = folderById[bookmark.folderId];
    if (folder && bookmark.game !== folder.game) {
      bookmark.game = folder.game;
      changed = true;
    }
  });
  if (changed) await chrome.storage.local.set({ [BOOKMARKS_KEY]: bookmarks });
}

chrome.runtime.onInstalled.addListener((details) => {
  getSettings().then(async (settings) => {
    /* A fresh install starts with the large cards. onInstalled also fires for
       every update, and small / medium are valid choices, so the migration must
       not run again and undo what the user picked. */
    if (details && details.reason === 'install'
      && (settings.textSize === 'medium' || settings.textSize === 'small')) {
      settings.textSize = 'large';
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }
    return ensureWatchAlarm(settings);
  }).catch(() => {});
  repairBookmarkGames().catch(() => {});
  reconcileMultiLive().catch(() => {});
  autoPullSync().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureWatchAlarm().catch(() => {});
  reconcileMultiLive().catch(() => {});
  autoPullSync().catch(() => {});
});

/*
 * Build imports saved before 2.9.2 read Path of Building's influence line as the
 * item's base ("Elder Item"), so their trade search and their Craft of Exile
 * link both pointed at a base that does not exist. The item keeps its real name
 * in "item.name", so the base is restored from it once.
 */
const IMPORT_BASE_REPAIR_KEY = 'ptcMigrationImportBasesV2';
const INFLUENCE_TAG = /^(?:Elder|Shaper|Warlord|Crusader|Hunter|Redeemer|Synthesised|Searing Exarch|Eater of Worlds) Item$/i;

async function repairImportedBases() {
  try {
    const data = await chrome.storage.local.get({ [IMPORT_BASE_REPAIR_KEY]: false, [ITEMS_KEY]: [] });
    if (data[IMPORT_BASE_REPAIR_KEY]) return;
    const items = asArray(data[ITEMS_KEY]);
    let changed = 0;
    const next = items.map((rec) => {
      const item = rec && rec.item;
      if (!item || !INFLUENCE_TAG.test(cleanText(item.baseType, 80))) return rec;
      const base = cleanText(item.name, 140);
      if (!base || INFLUENCE_TAG.test(base)) return rec;
      changed += 1;
      const label = cleanText(rec.name, 400);
      const name = label.includes(' - ') ? label.split(' - ')[0].trim() : label;
      return {
        ...rec,
        name: name || base,
        typeLine: base,
        item: { ...item, baseType: base, typeLine: base },
      };
    });
    if (changed) await chrome.storage.local.set({ [ITEMS_KEY]: next });

    /* The build keeps its own copy of each import (the gear the trade page
       compares against), so the same repair has to reach it: the badge looks an
       item up by base type, and "Elder Item" matched no listing. */
    const collections = await getCollections();
    let gearChanged = 0;
    const nextCollections = collections.map((collection) => {
      const gear = asArray(collection && collection.gear);
      if (!gear.length) return collection;
      let touched = false;
      const fixedGear = gear.map((entry) => {
        if (!entry || !INFLUENCE_TAG.test(cleanText(entry.baseType, 80))) return entry;
        const label = cleanText(entry.name, 200) || cleanText(entry.baseType, 80);
        const base = label.includes(' - ') ? label.split(' - ')[0].trim() : label;
        if (!base || INFLUENCE_TAG.test(base)) return entry;
        touched = true;
        gearChanged += 1;
        return { ...entry, baseType: base, name: base };
      });
      return touched ? { ...collection, gear: fixedGear } : collection;
    });
    if (gearChanged) await setCollections(nextCollections);

    await chrome.storage.local.set({ [IMPORT_BASE_REPAIR_KEY]: true });
    if (changed) updateBadge(next);
  } catch (error) {
    /* storage unavailable: the next start tries again */
  }
}

/* The fuzzy filter box used to be on by default and floated over the trade page.
   It is off by default now, and this switches it off once for profiles that only
   ever had the old default. The flag makes it a one-time change: turning it back
   on in the panel stays on. */
const FILTER_MIGRATION_KEY = 'ptcMigrationFilterBoxOff';

async function migrateFilterBoxOff() {
  try {
    const data = await chrome.storage.local.get({ [FILTER_MIGRATION_KEY]: false, [SETTINGS_KEY]: {} });
    if (data[FILTER_MIGRATION_KEY]) return;
    const settings = data[SETTINGS_KEY] && typeof data[SETTINGS_KEY] === 'object' ? data[SETTINGS_KEY] : {};
    if (settings.searchFilterEnabled !== false) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, searchFilterEnabled: false } });
    }
    await chrome.storage.local.set({ [FILTER_MIGRATION_KEY]: true });
  } catch (error) {
    /* storage unavailable: the default still hides it on a fresh profile */
  }
}

ensureWatchAlarm().catch(() => {});
restoreTradeBlock().catch(() => {});
migrateFilterBoxOff().catch(() => {});
repairImportedBases().catch(() => {});

/* A message is data on a bus shared with every extension page and content
   script, so its shape is checked once here rather than trusted by 60 handlers:
   a record is an object, and no message is larger than the biggest thing a page
   can legitimately hand over. Only the extension's own scripts can post at all
   (there is no externally_connectable), so this guards against mistakes and
   runaway payloads, not against a hostile page. */
const MESSAGE_MAX_BYTES = 8 * 1024 * 1024;

function messageFitsBus(message) {
  const record = message.record;
  if (record != null && (typeof record !== 'object' || Array.isArray(record))) return false;
  try {
    const text = JSON.stringify(message);
    return typeof text === 'string' && text.length <= MESSAGE_MAX_BYTES;
  } catch (error) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;
  if (sender && sender.id && sender.id !== chrome.runtime.id) return;
  if (!messageFitsBus(message)) {
    sendResponse({ ok: false, error: 'The message is too large or malformed.' });
    return;
  }
  let task = null;
  switch (message.type) {
    case 'ptc:save':
      task = handleSave(message.record);
      break;
    case 'ptc:targets:import':
      task = handleTargetImport(message.payload || message);
      break;
    case 'ptc:trade:open':
      task = handleTradeOpen(message.payload || message);
      break;
    case 'ptc:trade:url':
      task = handleTradeUrl(message.record || message.payload || message);
      break;
    case 'ptc:icons:resume':
      task = resumeIconQueue();
      break;
    case 'ptc:icons:retry':
      task = retryTargetIcons(message.collectionId || message.id);
      break;
    case 'ptc:page:capture':
      task = applyBuildPageCapture(message.collectionId || message.id);
      break;
    case 'ptc:delete':
      task = handleDelete(cleanString(message.id, 200));
      break;
    case 'ptc:clear':
      task = handleClear(message.game, message);
      break;
    case 'ptc:collection:create':
      task = handleCollectionCreate(message.name, message.ascendancy, message.game);
      break;
    case 'ptc:collection:rename':
      task = handleCollectionRename(cleanString(message.id, 100), message.name);
      break;
    case 'ptc:collection:update':
      task = handleCollectionUpdate(cleanId(message.id), message.patch);
      break;
    case 'ptc:build:discord':
      task = handleBuildDiscord(message.collectionId);
      break;
    case 'ptc:webhook:test':
      task = (async () => {
        const settings = await getSettings();
        const message = 'Poe Trade Watcher alerts are working.';
        const [discord, ntfy] = await Promise.all([
          postDiscord(settings, 'Alert test', message, 0x7fa86b),
          postNtfy(settings, 'Alert test', message),
        ]);
        const channels = [];
        if (discord.ok) channels.push('Discord');
        if (ntfy.ok) channels.push('ntfy');
        return { ok: channels.length > 0, channels, discord, ntfy };
      })();
      break;
    case 'ptc:discord:send':
      /* The trade page's Discord button: post the item to the webhook already
         configured for alerts. "configured" is reported back so the content
         script can copy the message instead when there is nothing to send to. */
      task = (async () => {
        const settings = await getSettings();
        const title = cleanString(message.title, 200) || 'Trade item';
        const text = cleanString(message.message, 4000);
        const icon = cleanString(message.icon, 500);
        if (!text) return { configured: false, ok: false, error: 'Empty message.' };
        /* A corrupted item gets a red embed bar as well as the red word in the
           message. */
        return postDiscord(settings, title, text, message.corrupted ? 0xb0413a : 0xd8b56a, icon);
      })();
      break;
    case 'ptc:seller:alert':
      task = (async () => {
        const ign = cleanString(message.ign, 120);
        const itemName = cleanString(message.itemName, 200);
        if (!ign) return { ok: false, error: 'Missing seller.' };
        const settings = await getSettings();
        /* The switch exists: without it these alerts could not be turned off. */
        if (settings.sellerAlertsEnabled === false) return { ok: true, skipped: true };
        if (settings.watcherNotifications) {
          notify('Whitelisted seller found', itemName ? itemName + ' by ' + ign : ign + ' listed an item.', cleanId(message.ignKey, 100) || 'seller');
        }
        broadcastAlert('Whitelisted seller found', (itemName ? itemName + ' by ' : 'Seller: ') + ign, 0xc98b8b);
        return { ok: true };
      })();
      break;
    case 'ptc:collection:delete':
      task = handleCollectionDelete(cleanString(message.id, 100));
      break;
    case 'ptc:item:move':
      task = handleItemMove(cleanString(message.itemId, 200), message.collectionId);
      break;
    case 'ptc:item:refresh':
      task = handleItemRefresh(message.payload || message);
      break;
    case 'ptc:coe:url':
      task = handleCoeUrl(message.record || message.payload);
      break;
    case 'ptc:coe:prepare':
      task = handleCoePrepare(message.record || message.payload);
      break;    case 'ptc:folder:create':
      task = handleFolderCreate(message.payload || message);
      break;
    case 'ptc:folder:update':
      task = handleFolderUpdate(cleanString(message.id, 100), message.patch || {});
      break;
    case 'ptc:folder:delete':
      task = handleFolderDelete(cleanString(message.id, 100));
      break;
    case 'ptc:folder:duplicate':
      task = handleFolderDuplicate(cleanString(message.id, 100));
      break;
    case 'ptc:folder:export':
      task = folderExportString(cleanString(message.id, 100));
      break;
    case 'ptc:folder:import':
      task = handleFolderImport(message.text, message.parentId);
      break;
    case 'ptc:bookmark:create':
      task = handleBookmarkCreate(message.payload || message);
      break;
    case 'ptc:bookmarks:import':
      task = handleBookmarkImport(message.payload || message);
      break;
    case 'ptc:bookmark:current':
      task = handleBookmarkCurrent(message.payload || message);
      break;
    case 'ptc:bookmark:update':
      task = handleBookmarkUpdate(cleanString(message.id, 100), message.patch || {});
      break;
    case 'ptc:bookmark:delete':
      task = handleBookmarkDelete(cleanString(message.id, 100));
      break;
    case 'ptc:bookmark:duplicate':
      task = handleBookmarkDuplicate(cleanString(message.id, 100));
      break;
    case 'ptc:bookmark:move':
      task = handleBookmarkMove(cleanString(message.id, 100), message.folderId, message.order);
      break;
    case 'ptc:multilive:toggle':
      task = handleMultiLiveToggle({
        ...(message.payload || {}),
        windowId: Number.isInteger(message.windowId) ? message.windowId : (sender && sender.tab ? sender.tab.windowId : null),
      });
      break;
    case 'ptc:multilive:remove':
      task = handleMultiLiveRemove(cleanString(message.id, 100));
      break;
    case 'ptc:multilive:set':
      task = handleMultiLiveSetEnabled(cleanString(message.id, 100), !!message.enabled);
      break;
    case 'ptc:multilive:all':
      task = handleMultiLiveAll(!!message.enabled);
      break;
    case 'ptc:multilive:clear':
      task = handleMultiLiveClear();
      break;
    case 'ptc:watch:add':
      task = handleWatchAdd(message.record || message.payload);
      break;
    case 'ptc:watch:refresh-query':
      task = handleWatchRefreshQuery(message.payload || message);
      break;
    case 'ptc:watch:remove':
      task = handleWatchRemove(cleanString(message.id, 200));
      break;
    case 'ptc:watch:update':
      task = handleWatchUpdate(cleanString(message.id, 200), message.patch || {});
      break;
    case 'ptc:watch:reorder':
      task = handleWatchReorder(message.ids);
      break;
    case 'ptc:watch:check':
      task = checkWatchers(true);
      break;
    case 'ptc:history:add':
      task = handleHistoryAdd(message.payload || message);
      break;
    case 'ptc:history:clear':
      task = handleHistoryClear(message.game);
      break;
    case 'ptc:settings:get':
      task = getSettings().then((settings) => ({ ok: true, settings }));
      break;
    case 'ptc:settings:set':
      task = setSettings(message.patch && typeof message.patch === 'object'
        ? { ...(message.current || {}), ...message.patch }
        : message.settings).then((settings) => ({ ok: true, settings }));
      break;
    case 'ptc:prices:get':
      task = handlePrices(message.game, message.league, !!message.force);
      break;
    case 'ptc:leagues:get':
      task = getLeagueRegistry(message.game, !!message.force)
        .then((registry) => ({ ok: true, leagues: registry.leagues, fetchedAt: registry.fetchedAt }))
        .catch((error) => ({ ok: false, error: String(error && error.message ? error.message : error) }));
      break;
    case 'ptc:preset:save':
      task = handlePresetSave(message.preset || message.payload || message);
      break;
    case 'ptc:preset:delete':
      task = handlePresetDelete(cleanString(message.id, 100));
      break;
    case 'ptc:priceindex:add':
      task = handlePriceIndexAdd(message.records);
      break;
    case 'ptc:craft:cost':
      task = handleCraftCost(message.payload || message);
      break;
    case 'ptc:searchwatch:add':
      task = handleSearchWatchAdd(message.watch || message.payload || message);
      break;
    case 'ptc:searchwatch:remove':
      task = handleSearchWatchRemove(cleanString(message.id, 100));
      break;
    case 'ptc:searchwatch:update':
      task = handleSearchWatchUpdate(cleanString(message.id, 100), message.patch || {});
      break;
    case 'ptc:searchwatch:listing':
      task = handleSearchWatchListing(message.payload || message);
      break;
    case 'ptc:searchwatch:check':
      task = checkSearchWatches(message.force !== false).catch((error) => ({
        ok: false,
        error: String(error && error.message ? error.message : error),
      }));
      break;
    case 'ptc:searchwatch:preview':
      task = (async () => {
        const query = await decodeTradeQuery(cleanString(message.queryId, 4000));
        if (!query) return { ok: false, error: 'This search cannot be read.' };
        return { ok: true, query: query };
      })();
      break;
    case 'ptc:status:get':
      task = Promise.resolve({
        ok: true,
        tradeBlocked: tradeBlockRemaining() > 0,
        tradeBlockedFor: tradeBlockedFor,
        tradeBlockedRemaining: tradeBlockRemaining(),
        tradeMessage: tradeBlockMessage(),
      });
      break;
    case 'ptc:backup':
      task = buildBackup().then((data) => ({ ok: true, data }));
      break;
    case 'ptc:restore':
      task = handleRestore(message.data || message.payload);
      break;
    case 'ptc:import:legacy':
      task = handleLegacyImport(message.text);
      break;
    case 'ptc:sync:push':
      task = pushSync();
      break;
    case 'ptc:sync:pull':
      task = pullSync();
      break;
    case 'ptc:trade:active': {
      const info = parseTradeUrl(message.url);
      if (info) {
        rememberLeague(info.game, info.league);
        chrome.storage.local.set({
          [ACTIVE_KEY]: {
            game: info.game,
            league: info.league,
            queryId: info.queryId,
            live: info.live,
            url: message.url,
            name: cleanName(message.name) || '',
            at: Date.now(),
          },
        }).catch(() => {});
      }
      task = Promise.resolve({ ok: true });
      break;
    }
    default:
      break;
  }
  if (!task) return;
  task
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));
  return true;
});




