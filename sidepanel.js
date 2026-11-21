'use strict';

const {
  createEl: el,
  text,
  normalizeText: norm,
  getModGroups: modGroups,
  getRarity: rarityInfo,
  hasCrafted,
  hasFractured,
  safeIconUrl: safeIcon,
  safePoeUrl: safePoeLink,
  getDisplayName: displayName,
  buildItemText: itemToText,
  buildCoePaste: coePaste,
  renderItemTooltip: buildTooltip,
  timeAgo,
  timeUntil,
  formatDate: fullDate,
  listedAt,
  priceValue,
  valueScore,
  formatValueScore,
  parsePriceText,
  convertPrice,
  formatConversion,
  buildTradeUrl,
  wikiLinks,
  coeImportSummary,
  buildCoeImportUrl,
  stripWhisperTokens,
  getIgn,
  matchesBlacklist,
  parseTradeUrl,
  savedSearchUsable,
  parseCompareStats,
  priceHistoryPoints,
  formatPriceAmount,
  buildPriceChart,
  itemClassFromBase,
  searchModLines,
} = window.PTC;

const DEFAULT_SETTINGS = globalThis.PTC_SETTINGS
  ? globalThis.PTC_SETTINGS.defaults
  : {
    defaultGame: 'poe2',
    fallbackLeague: { poe2: '' },
    textSize: 'large',
    theme: 'graphite',
    priceDisplay: 'divine-exalted',
    showConversions: true,
    showIgn: true,
    highlightStats: true,
    fuzzyResults: true,
    blacklistEnabled: true,
    blacklist: [],
    watcherInterval: 5,
    watcherNotifications: true,
    coeIncludeDesecrated: true,
    modDomainLabels: true,
    showWikiLinks: true,
    syncEnabled: false,
    onboardingDone: false,
    discordWebhook: '',
    ntfyUrl: '',
    sellerAlerts: '',
    valueSortPage: false,
    league: '',
    hardcore: false,
  };

/* Available colour themes. `swatch` holds the three colours used by the
   little preview inside the theme picker. */
const THEMES = [
  { id: 'auto', name: 'Match system', swatch: ['#11141b', '#5b8cff', '#e4e9f1'] },
  { id: 'midnight', name: 'Midnight', swatch: ['#11141b', '#262d3a', '#5b8cff'] },
  { id: 'graphite', name: 'Graphite', swatch: ['#131315', '#2a2a2f', '#7fb3e8'] },
  { id: 'ember', name: 'Ember', swatch: ['#16110d', '#312823', '#ff9a4d'] },
  { id: 'forest', name: 'Forest', swatch: ['#0f1512', '#27332c', '#a8d95a'] },
  { id: 'daylight', name: 'Daylight', swatch: ['#e4e9f1', '#fbfcfe', '#2f6bdd'] },
  { id: 'sand', name: 'Sand', swatch: ['#ebe3d5', '#fffdf8', '#8a5a12'] },
];

const THEME_IDS = THEMES.map((theme) => theme.id);

const state = {
  tab: 'items',
  items: [],
  collections: [],
  folders: [],
  bookmarks: [],
  multiLive: [],
  watched: [],
  history: [],
  presets: [],
  searchWatches: [],
  leagues: [],
  priceIndex: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  activeTrade: null,
  prices: {},
  search: '',
  filter: 'all',
  sort: 'new',
  openId: null,
  modalAssignItemId: null,
  bookmarkSearch: '',
  showArchived: false,
  collapsed: new Set(),
  drag: null,
  watchDrag: null,
  alertChannelsTouched: false,
};

const $ = (id) => document.getElementById(id);
const countLabel = $('countLabel');
const searchInput = $('search');
const sortSelect = $('sort');
const newCollectionBtn = $('newCollectionBtn');
const manageCollectionsBtn = $('manageCollectionsBtn');
const chipsBox = $('chips');
const listBox = $('list');
const emptyBox = $('empty');
const buildList = $('buildList');
const buildEmpty = $('buildEmpty');
const controls = $('controls');
const detailBox = $('detail');
const detailBody = $('detailBody');
const backBtn = $('backBtn');
const backLabel = $('backLabel');
const restoreFile = $('restoreFile');
const clearBtn = $('clearBtn');
const clearAllBtn = $('clearAllBtn');
const toastBox = $('toast');
const modal = $('modal');
const modalBody = $('modalBody');
const modalTitle = $('modalTitle');
const modalClose = $('modalClose');
const tabs = $('tabs');
const views = {
  items: $('view-items'),
  pob: $('view-pob'),
  builds: $('view-builds'),
  alerts: $('view-alerts'),
  tools: $('view-tools'),
  settings: $('view-settings'),
};
const watcherList = $('watcherList');
const watcherEmpty = $('watcherEmpty');
const watcherCount = $('watcherCount');
const watcherInterval = $('watcherInterval');
const alertChannelsForm = $('alertChannelsForm');
const watcherTestBtn = $('watcherTestBtn');
const alertChannelsStatus = $('alertChannelsStatus');
const watcherHint = $('watcherHint');
const alertChannelsBlock = $('alertChannelsBlock');
const alertChannelsSummary = $('alertChannelsSummary');
const alertsBadge = $('alertsBadge');
/* history and search-watch elements removed with their sections */
const historyEmpty = $('historyEmpty');

const searchWatchEmpty = $('searchWatchEmpty');
const leagueSelect = $('leagueSelect');
const leagueHint = $('leagueHint');
const settingsForm = $('settingsForm');
const settingsStatus = $('settingsStatus');
const themeBtn = $('themeBtn');
const themePopover = $('themePopover');
const themeGrid = $('themeGrid');
const themeClose = $('themeClose');
const themeSelect = $('themeSelect');
const gameSwitch = $('gameSwitch');
const leagueQuickBtn = $('leagueQuickBtn');
const leagueQuickLabel = $('leagueQuickLabel');
const leaguePopover = $('leaguePopover');

let toastTimer = 0;
let priceQueue = new Set();

function toast(message, isError, ms) {
  toastBox.textContent = message;
  toastBox.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  // An error needs longer on screen than a confirmation to be read.
  toastTimer = setTimeout(() => toastBox.classList.remove('show'), ms || (isError ? 7000 : 2800));
}

/* Keeps a message on screen for as long as a slow job runs. */
function toastWhileWorking(message) {
  toastBox.textContent = message;
  toastBox.className = 'toast show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastBox.classList.remove('show'), 60000);
}

function send(type, extra) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, ...(extra || {}) }, (response) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(response || { ok: false, error: 'No response.' });
      });
    } catch (error) {
      resolve({ ok: false, error: String(error && error.message ? error.message : error) });
    }
  });
}

function optionEl(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function addIcon(wrap, rec) {
  const url = safeIcon(rec && (rec.icon || (rec.item && rec.item.icon)));
  if (!url) {
    wrap.classList.add('no-icon');
    return;
  }
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => {
    img.remove();
    wrap.classList.add('no-icon');
  });
  wrap.appendChild(img);
}

function gameLabel(game) {
  return globalThis.PTC_GAMES.config(game).label;
}

function recordGame(rec) {
  return globalThis.PTC_GAMES.normalizeGame(rec);
}

/* The game selected in the header switcher. Every list and every new search
   is scoped to it, so PoE 1 and PoE 2 keep separate spaces. */
function activeGame() {
  return globalThis.PTC_GAMES.normalizeGame(state.settings && state.settings.defaultGame);
}
function gameItems() { return state.items.filter((rec) => recordGame(rec) === activeGame()); }
/* Saved: a listing from the trade site. Imported: gear from a build code, which
   belongs to a build and is listed in PoB Builds instead. */
function savedRecords() { return gameItems().filter((rec) => !rec.targetOf); }
function importedRecords() { return gameItems().filter((rec) => !!rec.targetOf); }
function gameWatched() { return state.watched.filter((rec) => recordGame(rec) === activeGame()); }
function gamePresets() { return state.presets.filter((rec) => recordGame(rec) === activeGame()); }
function gameHistory() { return state.history.filter((rec) => recordGame(rec) === activeGame()); }
function gameSearchWatches() { return state.searchWatches.filter((rec) => recordGame(rec) === activeGame()); }
function gameMultiLive() { return state.multiLive.filter((rec) => recordGame(rec) === activeGame()); }
function gameCollections() { return state.collections.filter((rec) => recordGame(rec) === activeGame()); }

/* Switches the whole panel to another game: persists the choice, resets the
   scoped view state, reloads leagues and prices, and re-renders the tab. */
async function switchGame(game) {
  const resolved = globalThis.PTC_GAMES.normalizeGame(game);
  syncGameSelect();
  if (resolved === activeGame()) return;
  const settings = { ...state.settings, defaultGame: resolved };
  const response = await send('ptc:settings:set', { settings });
  state.settings = normalizeSettings(response && response.ok ? response.settings : settings);
  state.openId = null;
  await refreshAll();
  setTab(state.tab);
  loadLeagues(false);
  preloadPrices();
}

/* The two-way game switch: the current game is pressed, the other is not. */
function syncGameSelect() {
  if (!gameSwitch) return;
  const current = activeGame();
  gameSwitch.querySelectorAll('[data-game]').forEach((button) => {
    const active = button.dataset.game === current;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function closeLeaguePopover() {
  if (!leaguePopover) return;
  leaguePopover.hidden = true;
  if (leagueQuickBtn) leagueQuickBtn.setAttribute('aria-expanded', 'false');
}

function openLeaguePopover() {
  if (!leaguePopover) return;
  fillLeagueQuick();
  leaguePopover.hidden = false;
  if (leagueQuickBtn) leagueQuickBtn.setAttribute('aria-expanded', 'true');
  const active = leaguePopover.querySelector('[aria-selected="true"]') || leaguePopover.querySelector('button');
  if (active) active.focus();
}

/* Manual league prefs (league / hardcore / mode) for the active game. */
function activeLeaguePrefs() {
  return globalThis.PTC_SETTINGS.leaguePrefs(state.settings, activeGame());
}

/* The ascendancy classes of one game, with their icons. */
/* Ascendancy artwork may only come from the item databases; the value can come
   from a restored build, which is a file the user can edit. */
const ASCENDANCY_ICON_HOSTS = ['cdn.poe2db.tw', 'cdn.poedb.tw'];

function safeAscendancyIcon(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    return ASCENDANCY_ICON_HOSTS.indexOf(url.hostname.toLowerCase()) !== -1 ? raw : '';
  } catch (error) {
    return '';
  }
}

function ascendancyClassesFor(game) {
  if (globalThis.PTC_ASCENDANCIES && globalThis.PTC_ASCENDANCIES.ascendanciesFor) {
    return globalThis.PTC_ASCENDANCIES.ascendanciesFor(game);
  }
  return typeof POE2_ASCENDANCIES !== 'undefined' ? POE2_ASCENDANCIES : [];
}

function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  if (globalThis.PTC_SETTINGS) return globalThis.PTC_SETTINGS.normalize(source);
  const result = {
    ...DEFAULT_SETTINGS,
    ...source,
    fallbackLeague: {
      poe2: text(source.fallbackLeague && source.fallbackLeague.poe2),
      poe1: text(source.fallbackLeague && source.fallbackLeague.poe1),
    },
    blacklist: Array.isArray(source.blacklist) ? source.blacklist : [],
  };
  result.defaultGame = source.defaultGame === 'poe1' ? 'poe1' : 'poe2';
  if (!['small', 'medium', 'large', 'xlarge'].includes(result.textSize)) result.textSize = 'large';
  if (!THEME_IDS.includes(result.theme)) result.theme = DEFAULT_SETTINGS.theme;
  return result;
}

function applyTextSize() {
  document.body.dataset.textSize = state.settings.textSize;
}

/* ------------------------------ themes ------------------------------- */

const themeMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

function resolveTheme(theme) {
  if (theme !== 'auto') return theme;
  return themeMedia && themeMedia.matches ? 'daylight' : 'midnight';
}

function applyTheme() {
  const resolved = resolveTheme(state.settings.theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = state.settings.theme;
  syncThemeControls();
}

function syncThemeControls() {
  const current = state.settings.theme;
  if (themeSelect) themeSelect.value = current;
  if (!themeGrid) return;
  themeGrid.querySelectorAll('[data-theme-id]').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.themeId === current ? 'true' : 'false');
  });
}

function buildThemeControls() {
  if (themeSelect) {
    themeSelect.textContent = '';
    THEMES.forEach((theme) => {
      const option = document.createElement('option');
      option.value = theme.id;
      option.textContent = theme.name;
      themeSelect.appendChild(option);
    });
    themeSelect.value = state.settings.theme;
  }

  if (!themeGrid) return;
  themeGrid.textContent = '';
  THEMES.forEach((theme) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-option';
    button.dataset.themeId = theme.id;
    button.setAttribute('aria-pressed', 'false');

    const swatch = document.createElement('span');
    swatch.className = theme.id === 'auto' ? 'theme-auto-swatch' : 'theme-swatch';
    theme.swatch.forEach((colour) => {
      const part = document.createElement('i');
      part.style.background = colour;
      swatch.appendChild(part);
    });

    const name = document.createElement('span');
    name.className = 'theme-option-name';
    name.textContent = theme.name;

    const check = document.createElement('span');
    check.className = 'theme-option-check';
    check.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="m5 13 4 4L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    button.append(swatch, name, check);
    button.addEventListener('click', () => {
      setTheme(theme.id);
      closeThemePopover();
    });
    themeGrid.appendChild(button);
  });
}

async function setTheme(theme) {
  if (!THEME_IDS.includes(theme)) return;
  state.settings = { ...state.settings, theme };
  applyTheme();
  const response = await send('ptc:settings:set', { settings: state.settings });
  if (response && response.ok && response.settings) {
    state.settings = normalizeSettings(response.settings);
    applyTheme();
  }
}

function openThemePopover() {
  if (!themePopover) return;
  syncThemeControls();
  themePopover.hidden = false;
  themeBtn.setAttribute('aria-expanded', 'true');
  document.addEventListener('click', onDocumentClick, true);
  document.addEventListener('keydown', onPopoverKeydown, true);
}

function closeThemePopover() {
  if (!themePopover || themePopover.hidden) return;
  themePopover.hidden = true;
  themeBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', onDocumentClick, true);
  document.removeEventListener('keydown', onPopoverKeydown, true);
}

function onDocumentClick(event) {
  if (!themePopover) return;
  if (themePopover.contains(event.target) || (themeBtn && themeBtn.contains(event.target))) return;
  closeThemePopover();
}

function onPopoverKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeThemePopover();
    if (themeBtn) themeBtn.focus();
  }
}

/* -------------------------------- tabs --------------------------------- */

function setTab(tab) {
  if (!views[tab]) tab = 'items';
  state.tab = tab;
  /* A section always opens on its list, never on an item that was being read. */
  state.openId = null;
  Object.entries(views).forEach(([key, node]) => node.classList.toggle('hidden', key !== tab));
  detailBox.classList.add('hidden');
  tabs.querySelectorAll('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    /* aria-current, not aria-selected: these are navigation buttons, and
       aria-selected is only allowed on tab / option / row roles. */
    if (active) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  const settingsBtn = $('openSettingsBtn');
  if (settingsBtn) {
    settingsBtn.setAttribute('aria-expanded', tab === 'settings' ? 'true' : 'false');
    settingsBtn.title = tab === 'settings' ? 'Close settings' : 'Settings';
  }
  if (tab === 'alerts') renderWatchers();
  else if (tab === 'settings') renderSettings();
  else if (tab === 'pob') renderPobTargets();
  else if (tab === 'builds') renderBuilds();
  else renderItems();
  checkTradeBlock();
}

/* Arrow keys, Home and End move through the tab list, as a tab list is
   expected to behave. The tabs themselves stay ordinary buttons: click, Enter
   and Space keep working exactly as before. */
tabs.addEventListener('keydown', (event) => {
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const list = Array.from(tabs.querySelectorAll('[data-tab]'));
  const index = list.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? list.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
  list[next].focus();
  setTab(list[next].dataset.tab);
});

/*
 * When the trade site throttles this IP the extension stops all trade
 * requests. Showing that is important, otherwise the alerts simply stop and
 * there is no explanation for it.
 */
async function checkTradeBlock() {
  const response = await send('ptc:status:get', {});
  const notice = $('tradeBlockNotice');
  if (!notice) return;
  if (response && response.ok && response.tradeBlocked) {
    notice.textContent = response.tradeMessage
      + ' No trade request is sent while this lasts, so the alerts pause until it is over.';
    notice.classList.remove('hidden');
  } else {
    notice.classList.add('hidden');
    notice.textContent = '';
  }
}

/* ------------------------------ collections ----------------------------- */

function collectionExists(id) {
  return !!id && state.collections.some((entry) => entry.id === id);
}

function countInCollection(id) {
  return gameItems().filter((rec) => (rec.collectionId || '') === id).length;
}

function collectionItemCount(collection) {
  if (!collection) return 0;
  const saved = countInCollection(collection.id);
  if (gameItems().some((rec) => rec.targetOf === collection.id)) return saved;
  const gear = Array.isArray(collection.gear) ? collection.gear.length : 0;
  return saved + gear;
}

function collectionName(id) {
  const collection = state.collections.find((entry) => entry.id === id);
  return collection ? collection.name : '';
}

async function createCollection(name, ascendancy) {
  const value = String(name || '').trim();
  if (!value) {
    toast('Enter a build name.', true);
    return null;
  }
  const response = await send('ptc:collection:create', { name: value, ascendancy: ascendancy || null, game: activeGame() });
  if (!response || !response.ok) {
    toast((response && response.error) || 'Could not create the build.', true);
    return null;
  }
  if (!response.collection) {
    toast('The build was created but could not be read back.', true);
    return null;
  }
  if (!state.collections.some((entry) => entry.id === response.collection.id)) {
    state.collections.push(response.collection);
  }
  await refreshAll();
  if (state.modalAssignItemId) await moveItem(state.modalAssignItemId, response.collection.id);
  else renderBuilds();
  toast('Build "' + response.collection.name + '" created.');
  return response.collection;
}

async function renameCollection(id, name) {
  const value = String(name || '').trim();
  if (!value) {
    toast('Enter a build name.', true);
    return false;
  }
  const response = await send('ptc:collection:rename', { id, name: value });
  if (!response.ok) {
    toast(response.error || 'Could not rename the build.', true);
    return false;
  }
  const collection = state.collections.find((entry) => entry.id === id);
  if (collection) collection.name = value;
  return true;
}

async function deleteCollection(collection) {
  const saved = state.items.filter((rec) => !rec.targetOf && rec.collectionId === collection.id).length;
  const imported = state.items.filter((rec) => rec.targetOf === collection.id).length;
  const parts = [];
  if (imported) {
    parts.push(imported === 1 ? '1 imported item is deleted' : imported + ' imported items are deleted');
  }
  if (saved) {
    parts.push(saved === 1 ? '1 saved item stays in Saved items' : saved + ' saved items stay in Saved items');
  }
  const detail = parts.length ? parts.join(' and ') + '.' : 'The build is empty.';
  if (!confirm('Delete build "' + collection.name + '"?\n\n' + detail)) return false;
  const response = await send('ptc:collection:delete', { id: collection.id });
  if (!response.ok) {
    toast(response.error || 'Could not delete the build.', true);
    return false;
  }
  state.collections = state.collections.filter((entry) => entry.id !== collection.id);
  state.items = state.items.filter((rec) => rec.targetOf !== collection.id);
  state.items.forEach((rec) => {
    if (rec.collectionId === collection.id) rec.collectionId = '';
  });
  renderBuilds();
  toast('Build deleted.' + (imported ? ' Its imported items are gone.' : ''));
  return true;
}

async function moveItem(itemId, collectionId) {
  const response = await send('ptc:item:move', { itemId, collectionId: collectionId || '' });
  if (!response.ok) {
    toast(response.error || 'Could not move the item.', true);
    return false;
  }
  const rec = state.items.find((entry) => entry.id === itemId);
  if (rec) rec.collectionId = collectionId || '';
  return true;
}

/* -------------------------------- items -------------------------------- */

function searchHaystack(rec) {
  const item = (rec && rec.item) || {};
  const parts = [
    rec.name,
    rec.typeLine,
    rec.priceText,
    rec.account,
    rec.ign,
    rec.league,
    item.name,
    item.typeLine,
    item.baseType,
    item.itemClass,
    collectionName(rec.collectionId),
  ];
  modGroups(item).forEach((group) => {
    parts.push(group.label);
    group.lines.forEach((line) => parts.push(line));
  });
  return norm(parts.filter(Boolean).join(' '));
}

function filteredItems() {
  let items = savedRecords();

  if (state.filter === 'crafted') items = items.filter(hasCrafted);
  else if (state.filter !== 'all') items = items.filter((rec) => rarityInfo(rec)[0] === state.filter);

  const query = norm(state.search);
  if (query) items = items.filter((rec) => searchHaystack(rec).includes(query));

  if (state.sort === 'old') items.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  else if (state.sort === 'name') items.sort((a, b) => displayName(a).name.localeCompare(displayName(b).name, 'en'));
  else if (state.sort === 'price') items.sort((a, b) => priceValue(b, state.prices[priceKey(b)]) - priceValue(a, state.prices[priceKey(a)]));
  else if (state.sort === 'value') items.sort((a, b) => {
    const sa = valueScore(a, state.prices[priceKey(a)]);
    const sb = valueScore(b, state.prices[priceKey(b)]);
    if (sa == null && sb == null) return (b.savedAt || 0) - (a.savedAt || 0);
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sa - sb;
  });
  else items.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return items;
}

function priceKey(rec) {
  return recordGame(rec) + ':' + String(rec.league || '').toLowerCase();
}

function conversionLabel(rec) {
  if (!state.settings.showConversions || !rec.priceText) return '';
  const prices = state.prices[priceKey(rec)];
  if (!prices) return '';
  const parsed = parsePriceText(rec.priceText);
  if (!parsed) return '';
  const conversion = convertPrice(parsed.amount, parsed.currencyName, prices);
  const value = formatConversion(conversion, state.settings.priceDisplay);
  if (!value) return '';
  /* The asking price and its conversion must not say the same thing twice: a
     listing already in the display unit ("35 x Divine" with "~ 35 div", or
     "3 x Exalted" with "~ 3 ex") gets no conversion tag at all. A conversion
     with a remainder ("35 div + 2 ex") still adds precision and stays. */
  if (conversion && String(value).indexOf('+') === -1) {
    const unit = conversionUnit(value);
    if (unit && unit === conversion.currencyId) {
      const amount = Number(String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/));
      if (Number.isFinite(amount) && Math.abs(amount - parsed.amount) < 0.5) return '';
    }
  }
  return '~ ' + value;
}

/* The unit a formatted conversion ends with ("35 div", "12 ex", "80 chaos"). */
function conversionUnit(value) {
  const text = String(value || '').toLowerCase();
  if (/chaos/.test(text)) return 'chaos';
  if (/ex\b|exalted/.test(text)) return 'exalted';
  if (/div/.test(text)) return 'divine';
  return '';
}

async function ensurePrice(rec) {
  if (!state.settings.showConversions || !rec.league) return;
  const key = priceKey(rec);
  if (state.prices[key] || priceQueue.has(key)) return;
  priceQueue.add(key);
  const response = await send('ptc:prices:get', { game: recordGame(rec), league: rec.league });
  priceQueue.delete(key);
  if (response.ok && response.prices) {
    state.prices[key] = response.prices;
    if (state.openId) renderItems();
  }
}

async function preloadPrices() {
  if (!state.settings.showConversions) return;
  const leagues = new Map();
  state.items.forEach((rec) => {
    if (rec.league) leagues.set(priceKey(rec), { game: recordGame(rec), league: rec.league });
  });
  let changed = false;
  let fetched = 0;
  for (const [key, info] of leagues) {
    if (state.prices[key] || priceQueue.has(key)) continue;
    if (fetched >= 6) break;
    fetched++;
    priceQueue.add(key);
    const response = await send('ptc:prices:get', info);
    priceQueue.delete(key);
    if (response.ok && response.prices) {
      state.prices[key] = response.prices;
      changed = true;
    }
  }
  if (changed && state.tab === 'items') renderItems();
}

function isBlacklisted(rec) {
  if (!state.settings.blacklistEnabled) return false;
  return matchesBlacklist(rec.account, state.settings.blacklist)
    || matchesBlacklist(getIgn(rec), state.settings.blacklist);
}

/* The explicit modifier lines of an item, in the order the game lists them.
   Works the same for a saved listing and for a build import. */
function explicitModLines(rec) {
  const item = (rec && rec.item) || {};
  const groups = modGroups(item);
  const group = groups.find((entry) => entry.key === 'explicit');
  if (group && group.lines && group.lines.length) return group.lines.slice();
  return (Array.isArray(item.explicitMods) ? item.explicitMods : [])
    .map((entry) => (typeof entry === 'string' ? entry : ((entry && (entry.description || entry.text)) || '')))
    .filter(Boolean);
}

/*
 * "Fair price" and scam hints. The index is built from the listings this
 * profile has already seen, so it is a local market sample, not a global feed.
 */
function marketHint(rec) {
  if (!globalThis.PTC_FEATURES || !state.priceIndex.size) return null;
  const prices = state.prices[priceKey(rec)];
  const value = priceValue(rec, prices);
  const proxy = { item: (rec && rec.item) || {}, priceValue: value, priceHistory: rec && rec.priceHistory };

  if (state.settings.scamDetectionEnabled) {
    const flags = globalThis.PTC_FEATURES.scamFlags(state.priceIndex, proxy, Date.now());
    const bait = flags.find((flag) => flag.id === 'price-mining');
    if (bait) {
      return {
        className: 'danger',
        text: 'Possible bait',
        title: bait.text + '. Items listed far below the market price are often bought and resold by the same account.',
      };
    }
  }

  if (state.settings.priceIndexEnabled) {
    const fair = globalThis.PTC_FEATURES.fairPrice(state.priceIndex, proxy);
    if (fair != null && value > 0) {
      const ratio = value / fair;
      const chaosFair = fair / (prices && prices.rates && prices.rates.chaos ? prices.rates.chaos : 0.6024);
      if (ratio <= 0.7) {
        return {
          className: 'target',
          text: 'Below market',
          title: 'About ' + chaosFair.toFixed(2) + ' chaos is the price of comparable listings you have seen.',
        };
      }
      if (ratio >= 1.5) {
        return {
          className: 'danger',
          text: 'Above market',
          title: 'About ' + chaosFair.toFixed(2) + ' chaos is the price of comparable listings you have seen.',
        };
      }
    }
  }
  return null;
}

function buildCard(rec) {
  const card = el('button', 'card'
    + (isBlacklisted(rec) ? ' blacklisted' : ''));
  card.type = 'button';

  const icon = el('div', 'card-icon');
  addIcon(icon, rec);

  const body = el('div', 'card-body');
  const named = displayName(rec);
  body.appendChild(el('div', 'card-name r-' + rarityInfo(rec)[0], named.name));
  if (named.type) body.appendChild(el('div', 'card-type', named.type));

  const tags = el('div', 'card-tags');
  if (rec.priceText) tags.appendChild(el('span', 'tag price', rec.priceText));
  const conv = conversionLabel(rec);
  if (conv) tags.appendChild(el('span', 'tag conversion', conv));
  tags.appendChild(el('span', 'tag game', gameLabel(recordGame(rec))));
  if (rec.league) tags.appendChild(el('span', 'tag', rec.league));
  if (rec.item && rec.item.ilvl) tags.appendChild(el('span', 'tag', 'ilvl ' + rec.item.ilvl));
  if (hasCrafted(rec)) tags.appendChild(el('span', 'tag crafted', 'Crafted'));
  if (hasFractured(rec)) tags.appendChild(el('span', 'tag fractured', 'Fractured'));
  const market = marketHint(rec);
  if (market) {
    const tag = el('span', 'tag ' + market.className, market.text);
    tag.title = market.title;
    tags.appendChild(tag);
  }
  const build = collectionName(rec.collectionId);
  if (build) tags.appendChild(el('span', 'tag collection', build));
  if (isBlacklisted(rec)) tags.appendChild(el('span', 'tag danger', 'Blacklisted'));
  if (tags.childElementCount) body.appendChild(tags);

  if (state.sort === 'value') {
    const prices = state.prices[priceKey(rec)];
    const score = valueScore(rec, prices);
    if (score != null) {
      const tag = el('span', 'tag value', 'value ' + formatValueScore(score, prices));
      tag.title = 'Price per quality, in chaos orbs (lower is better)';
      tags.appendChild(tag);
    }
  }

  const meta = el('div', 'card-meta');
  meta.appendChild(el('span', 'seller', getIgn(rec) || rec.account || 'unknown seller'));
  /* The seller's listing time, not the moment the item was saved: the age on a
     card is about the market, not about the collection. Records saved before
     the listing date was kept fall back to their saved date, and the tooltip
     says which one it is. */
  const listed = listedAt(rec);
  const stamp = el('span', 'date', timeAgo(listed != null ? listed : rec.savedAt));
  stamp.title = listed != null
    ? 'Listed by the seller ' + fullDate(listed) + ' - you saved it ' + fullDate(rec.savedAt)
    : 'Saved ' + fullDate(rec.savedAt) + ' - the listing date was not recorded';
  meta.appendChild(stamp);
  body.appendChild(meta);

  /* The card is a button: everything about the item (mods, price history, the
     seller, the search, Craft of Exile) is one click away. Say it, because a
     compact card does not look like it holds that much. */
  const more = el('span', 'card-more', 'Open for details');
  more.setAttribute('aria-hidden', 'true');
  body.appendChild(more);
  card.classList.add('has-more');

  card.appendChild(icon);
  card.appendChild(body);
  card.addEventListener('click', () => {
    openDetail(rec.id);
  });
  return card;
}

function rarityKey(rarity) {
  const r = String(rarity || '').toLowerCase();
  return r === 'rare' || r === 'magic' || r === 'unique' || r === 'normal' ? r : 'normal';
}

function gearReferenceCard(entry, game) {
  const card = el('div', 'card gear-ref');
  const body = el('div', 'card-body');
  const name = entry.name || entry.baseType || 'Item';
  body.appendChild(el('div', 'card-name r-' + rarityKey(entry.rarity), name));
  if (entry.baseType && entry.baseType !== name) body.appendChild(el('div', 'card-type', entry.baseType));
  const tags = el('div', 'card-tags');
  if (entry.slot) tags.appendChild(el('span', 'tag collection', entry.slot));
  if (entry.rarity) tags.appendChild(el('span', 'tag', String(entry.rarity).toUpperCase()));
  if (entry.ilvl != null) tags.appendChild(el('span', 'tag', 'ilvl ' + entry.ilvl));
  if (tags.childElementCount) body.appendChild(tags);
  const search = el('button', 'action', 'Search');
  search.type = 'button';
  search.title = 'Search this base type on the trade site';
  const rareKey = rarityKey(entry.rarity);
  search.addEventListener('click', () => openTradeSearch(entry.baseType || name, game, '', {
    name: rareKey === 'unique' ? name : '',
    unique: rareKey === 'unique',
  }));
  body.appendChild(search);
  card.appendChild(body);
  return card;
}

function renderChips() {
  const items = savedRecords();
  const counts = { all: items.length, unique: 0, rare: 0, magic: 0, normal: 0, crafted: 0 };
  items.forEach((rec) => {
    const key = rarityInfo(rec)[0];
    if (counts[key] != null) counts[key] += 1;
    if (hasCrafted(rec)) counts.crafted += 1;
  });
  const defs = [
    ['all', 'All'],
    ['unique', 'Unique'],
    ['rare', 'Rare'],
    ['magic', 'Magic'],
    ['normal', 'Normal'],
    ['crafted', 'Crafted'],
  ];
  chipsBox.replaceChildren();
  defs.forEach(([id, label]) => {
    const chip = el('button', 'chip' + (state.filter === id ? ' active' : ''));
    chip.type = 'button';
    chip.appendChild(document.createTextNode(label));
    chip.appendChild(el('b', '', String(counts[id] || 0)));
    chip.addEventListener('click', () => {
      state.filter = id;
      renderItems();
    });
    chipsBox.appendChild(chip);
  });
}

function renderList() {
  const items = filteredItems();
  listBox.replaceChildren();
  if (savedRecords().length && !items.length) {
    listBox.appendChild(el('div', 'no-results', 'No items match the current filters.'));
  } else {
    items.forEach((rec) => listBox.appendChild(buildCard(rec)));
  }
  updateSavedCount();
}

function updateSavedCount() {
  const total = savedRecords().length;
  countLabel.textContent = total === 1 ? '1 item saved' : total + ' items saved';
}

const CAPTURE_ORIGINS = ['https://mobalytics.gg/*', 'https://*.mobalytics.gg/*'];

async function readBuildPage(collectionId) {
  if (!collectionId) return;
  let granted = false;
  try {
    /* Asked straight away: an await in front of the request spends the click's
       user gesture, and Chrome then refuses the prompt, so "Read page" could
       never get access on first use. A granted origin answers without a prompt. */
    granted = await chrome.permissions.request({ origins: CAPTURE_ORIGINS });
  } catch (error) {
    granted = false;
  }
  if (!granted) {
    toast('Access to the build page is needed to read its links.', true);
    return;
  }
  const response = await send('ptc:page:capture', { collectionId: collectionId });
  if (!response.ok) {
    toast(response.error || 'The build page could not be read.', true);
    return;
  }
  await refreshAll();
  renderItems();
  const parts = [];
  if (response.links) parts.push(response.links + ' search link(s)');
  if (response.icons) parts.push(response.icons + ' item picture(s)');
  toast(parts.length ? 'Read ' + parts.join(' and ') + ' from the build page.' : 'Nothing on that page matched this build.');
}

/* --------------------------- POB build import --------------------------- */

const pobCodeArea = $('pobCode');
const pobParseBtn = $('pobParseBtn');
const pobClearBtn = $('pobClearBtn');
const pobResult = $('pobResult');
const pobBuildHead = $('pobBuildHead');
const pobTargetSelect = $('pobTargetSelect');
const pobNewNameWrap = $('pobNewNameWrap');
const pobNewName = $('pobNewName');
const pobImportBtn = $('pobImportBtn');
const pobList = $('pobList');

let pobParsed = null;

const RARITY_FRAME = { Normal: 0, Magic: 1, Rare: 2, Unique: 3 };
const RARITY_CLASS = { Normal: 'normal', Magic: 'magic', Rare: 'rare', Unique: 'unique' };
const MOD_ITEM_KEY = {
  implicit: 'implicitMods',
  enchant: 'enchantMods',
  rune: 'runeMods',
  explicit: 'explicitMods',
  crafted: 'craftedMods',
  fractured: 'fracturedMods',
  desecrated: 'desecratedMods',
  scourge: 'scourgeMods',
};

function pobSuggestedName() {
  const build = (pobParsed && pobParsed.build) || {};
  return [build.className, build.ascendancy].filter(Boolean).join(' ').slice(0, 80);
}

// Shapes a parsed item the same way a saved trade record does, so the whole
// rest of the extension (detail view, icons, Craft of Exile, trade links)
// works on it unchanged.
function pobItemRecord(parsed, index) {
  const frameType = RARITY_FRAME[parsed.rarity] != null ? RARITY_FRAME[parsed.rarity] : 2;
  const typeLine = parsed.baseType && parsed.baseType !== parsed.name ? parsed.baseType : '';
  const item = {
    name: parsed.name,
    typeLine,
    baseType: parsed.baseType,
    frameType,
    properties: parsed.properties || [],
  };
  if ((parsed.requirements || []).length) item.requirements = parsed.requirements;
  if (parsed.ilvl != null) item.ilvl = parsed.ilvl;
  if ((parsed.sockets || []).length) item.sockets = parsed.sockets;
  if (parsed.corrupted) item.corrupted = true;
  if ((parsed.runes || []).length) item.note = 'Runes: ' + parsed.runes.join(', ');
  Object.entries(MOD_ITEM_KEY).forEach(([kind, key]) => {
    const lines = kind === 'implicit'
      ? (parsed.implicitMods || [])
      : (parsed.mods || []).filter((mod) => mod.kind === kind).map((mod) => mod.text);
    if (lines.length) item[key] = lines;
  });
  const coeMods = [];
  (parsed.implicitMods || []).forEach((line) => coeMods.push({ kind: 'implicit', text: line }));
  (parsed.mods || []).forEach((mod) => coeMods.push({ kind: mod.kind, text: mod.text, type: mod.type || '' }));
  // Build codes name the slot ("Helmet", "Ring 1") but never the item class the
  // trade site and Craft of Exile need; derive it from the base name. Without it
  // Craft of Exile gets "Item Class: Ancestral Tiara" and imports nothing.
  const slotClass = /helmet|helm/i.test(String(parsed.slot || '')) ? 'Helmets'
    : /body|chest/i.test(String(parsed.slot || '')) ? 'Body Armours'
      : /glove/i.test(String(parsed.slot || '')) ? 'Gloves'
        : /boot/i.test(String(parsed.slot || '')) ? 'Boots'
          : /ring/i.test(String(parsed.slot || '')) ? 'Rings'
            : /amulet/i.test(String(parsed.slot || '')) ? 'Amulets'
              : /belt/i.test(String(parsed.slot || '')) ? 'Belts'
                : /quiver/i.test(String(parsed.slot || '')) ? 'Quivers'
                  : /shield/i.test(String(parsed.slot || '')) ? 'Shields'
                    : /focus|off.?hand/i.test(String(parsed.slot || '')) ? 'Foci'
                      : '';
  const itemClass = itemClassFromBase(parsed.baseType) || slotClass;
  if (itemClass) item.itemClass = itemClass;
  if (parsed.slot) item.slot = String(parsed.slot);
  // Armour rolls its life, energy shield and resistances as modifiers, so the
  // same text parser the item comparison uses can read them straight off.
  const statLines = (parsed.implicitMods || [])
    .concat((parsed.mods || []).map((mod) => mod.text))
    .filter(Boolean);
  if (parsed.properties) statLines.push(parsed.properties);
  const stats = parseCompareStats(statLines.join('\n'));
  if (parsed.itemLevel) stats.ilvl = parsed.itemLevel;
  return {
    id: 'pob_' + Date.now().toString(36) + (index + 1) + Math.random().toString(36).slice(2, 6),
    savedAt: Date.now(),
    item,
    name: typeLine ? parsed.name + ' - ' + typeLine : parsed.name,
    typeLine,
    rarity: frameType,
    game: globalThis.PTC_GAMES.normalizeGame(parsed.game || activeGame()),
    coeMods,
    league: '',
    stats,
  };
}

function renderPobTargets() {
  const previous = pobTargetSelect.value;
  pobTargetSelect.replaceChildren();
  pobTargetSelect.appendChild(optionEl('__new__', 'New build…'));
  const collections = gameCollections();
  if (collections.length) {
    const group = document.createElement('optgroup');
    group.label = 'Existing builds';
    collections.forEach((collection) => group.appendChild(optionEl(collection.id, collection.name)));
    pobTargetSelect.appendChild(group);
  }
  const known = previous && previous !== '__new__' && collections.some((entry) => entry.id === previous);
  pobTargetSelect.value = known ? previous : '__new__';
  syncPobNewName();
  if (pobParsed && !pobNewName.value.trim()) pobNewName.value = pobSuggestedName();
}

function syncPobNewName() {
  pobNewNameWrap.classList.toggle('show', pobTargetSelect.value === '__new__');
}

function pobCard(item, index) {
  const rec = pobItemRecord(item, index);
  const card = el('div', 'pob-card');
  const head = el('div', 'pob-card-head');
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = true;
  check.addEventListener('change', () => { item.checked = check.checked; });
  check.addEventListener('click', (event) => event.stopPropagation());
  item.checked = true;
  head.appendChild(check);
  if (item.slot) head.appendChild(el('span', 'pob-card-slot', item.slot));
  head.appendChild(el('span', 'pob-card-name ' + (RARITY_CLASS[item.rarity] || 'rare'), item.name));
  if (item.baseType && item.baseType !== item.name) {
    const base = document.createElement('span');
    base.className = 'pob-card-name ' + (RARITY_CLASS[item.rarity] || 'rare');
    base.style.fontWeight = '400';
    base.style.opacity = '0.75';
    base.textContent = item.baseType;
    head.appendChild(base);
  }
  if (item.ilvl != null) head.appendChild(el('span', 'pob-card-ilvl', 'ilvl ' + item.ilvl));
  const search = el('button', 'mini-btn pob-card-search', 'Search');
  search.type = 'button';
  search.title = 'Search for similar items on the trade site';
  search.addEventListener('click', (event) => {
    event.stopPropagation();
    const unique = item.rarity === 'Unique';
    openTradeSearch(item.baseType || item.name, item.game || activeGame(), '', {
      name: unique ? item.name : '',
      unique,
      rarity: item.rarity || '',
      ilvl: item.ilvl != null ? item.ilvl : null,
      quality: item.quality != null ? item.quality : null,
      corrupted: !!item.corrupted,
      itemClass: itemClassFromBase(item.baseType) || '',
      mods: (item.mods || []).filter((mod) => mod.kind === 'explicit').map((mod) => mod.text),
      simple: true,
    });
  });
  head.appendChild(search);
  const toggle = el('button', 'pob-card-toggle', '\u25be');
  toggle.type = 'button';
  toggle.title = 'Show item details';
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    card.classList.toggle('open');
  });
  head.appendChild(toggle);
  head.addEventListener('click', () => { card.classList.toggle('open'); });
  card.appendChild(head);
  const body = el('div', 'pob-card-body');
  try { body.appendChild(buildTooltip(rec)); } catch (error) { body.appendChild(el('div', 'modal-hint', 'Details unavailable.')); }
  card.appendChild(body);
  return card;
}

function renderPobResult(parsed) {
  const build = parsed.build || {};
  const game = globalThis.PTC_GAMES.normalizeGame(parsed.game || activeGame());
  const title = [build.className, build.ascendancy].filter(Boolean).join(' ') || (game === 'poe1' ? 'Path of Building build' : 'Path of Building 2 build');
  pobBuildHead.replaceChildren();
  pobBuildHead.appendChild(el('span', 'pob-build-name', title));
  const meta = [];
  if (build.level) meta.push('Level ' + build.level);
  meta.push(parsed.items.length + (parsed.items.length === 1 ? ' gear item' : ' gear items'));
  pobBuildHead.appendChild(el('span', 'pob-build-meta', meta.join(' \u00b7 ')));
  renderPobTargets();
  pobList.replaceChildren();
  parsed.items.forEach((item, index) => pobList.appendChild(pobCard(item, index)));
  pobResult.classList.remove('hidden');
  pobClearBtn.disabled = false;
}

async function pobParse() {
  const code = pobCodeArea.value.trim();
  if (!code) { toast('Paste a build code first.', true); return; }
  const importer = window.POB_IMPORT || window.POB2_IMPORT;
  if (!importer) { toast('The build importer is not loaded.', true); return; }
  pobParseBtn.disabled = true;
  try {
    const parsed = await importer.parseCode(code);
    pobParsed = parsed;
    renderPobResult(parsed);
  } catch (error) {
    pobParsed = null;
    pobResult.classList.add('hidden');
    pobClearBtn.disabled = !pobCodeArea.value.trim();
    toast((error && error.message) || 'Could not read the build code.', true);
  } finally {
    pobParseBtn.disabled = false;
  }
}

/* Empties the pasted code and the parsed gear list, so the next build starts from
   a clean panel instead of on top of the previous one. */
function pobClearList() {
  pobParsed = null;
  pobList.replaceChildren();
  pobBuildHead.replaceChildren();
  pobResult.classList.add('hidden');
  pobCodeArea.value = '';
  pobTargetSelect.replaceChildren();
  pobNewName.value = '';
  pobNewNameWrap.classList.remove('show');
  pobClearBtn.disabled = true;
  toast('List cleared.');
}

async function pobImport() {
  if (!pobParsed) return;
  const game = globalThis.PTC_GAMES.normalizeGame(pobParsed.game || activeGame());
  const selected = pobParsed.items.filter((item) => item.checked);
  if (!selected.length) { toast('Select at least one item to import.', true); return; }
  let collectionId = pobTargetSelect.value;
  let collectionName = '';
  if (collectionId === '__new__') {
    const name = pobNewName.value.trim();
    if (!name) { toast('Enter a name for the new build.', true); return; }
    const build = pobParsed.build || {};
    const created = await send('ptc:collection:create', {
      name,
      ascendancy: build.ascendancy
        ? { ascendancy: build.ascendancy, ascendancyClass: build.className || '' }
        : null,
      game: game,
    });
    if (!created.ok) { toast(created.error || 'Could not create the build.', true); return; }
    collectionId = created.collection.id;
    collectionName = created.collection.name;
  } else {
    const collection = state.collections.find((entry) => entry.id === collectionId);
    collectionName = collection ? collection.name : '';
  }
  pobImportBtn.disabled = true;
  const records = selected.map((item, index) => pobItemRecord(item, index));
  const response = await send('ptc:targets:import', { collectionId: collectionId, game: game, league: currentLeagueFor(game), items: records });
  pobImportBtn.disabled = false;
  if (!response.ok) { toast(response.error || 'The import failed.', true); return; }
  await refreshAll();
  setTab('builds');
  const parts = [response.saved + (response.saved === 1 ? ' item imported' : ' items imported') + ' into \u201c' + collectionName + '\u201d'];
  if (response.removed) parts.push(response.removed + ' previously imported item(s) replaced');
  parts.push('no icons — use Search per item to find similar listings on the trade site');
  if (response.coeNeedsPermission) parts.push('Craft of Exile access not granted — “Open in Craft of Exile” will not match affixes until you allow it');
  toast(parts.join(' · ') + '.', false);
}

function renderItems() {
  renderChips();
  renderList();
  const open = state.openId ? state.items.find((entry) => entry.id === state.openId) : null;
  if (open) renderDetail(open);
  applyItemsVisibility();
}

function applyItemsVisibility() {
  const detailOpen = !!state.openId && state.tab === 'items';
  const count = savedRecords().length;
  controls.classList.toggle('hidden', detailOpen);
  listBox.classList.toggle('hidden', detailOpen || count === 0);
  emptyBox.classList.toggle('hidden', detailOpen || count > 0);
}

/* --------------------------------- builds -------------------------------- */

/* A build code is imported into a build, and its gear is listed there: a build
   is a set of items that a character wears, a saved item is a listing from the
   trade site, and one list made both of them harder to read. */
function buildItemRow(rec) {
  const row = el('button', 'build-item');
  row.type = 'button';
  const named = displayName(rec);
  row.appendChild(el('span', 'build-item-name r-' + rarityInfo(rec)[0], named.name));
  if (named.type && named.type !== named.name) row.appendChild(el('span', 'build-item-base', named.type));
  const meta = [];
  if (rec.item && rec.item.ilvl != null) meta.push('ilvl ' + rec.item.ilvl);
  if (meta.length) row.appendChild(el('span', 'build-item-meta', meta.join(' \u00b7 ')));
  row.title = 'Price check, crafting plan and details';
  row.addEventListener('click', () => openDetail(rec.id, 'builds'));
  return row;
}

function renderBuilds() {
  if (!buildList) return;
  buildList.replaceChildren();
  const builds = gameCollections();
  const imported = importedRecords();
  builds.forEach((collection) => {
    const gear = imported.filter((rec) => rec.targetOf === collection.id);
    const assigned = savedRecords().filter((rec) => rec.collectionId === collection.id);
    const placeholders = Array.isArray(collection.gear) ? collection.gear : [];
    const block = el('section', 'build-block');

    const head = el('div', 'build-head');
    head.appendChild(el('span', 'build-name', collection.name || 'Untitled build'));
    const remove = el('button', 'build-delete');
    remove.type = 'button';
    remove.title = 'Delete this build';
    remove.setAttribute('aria-label', 'Delete build ' + (collection.name || ''));
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2m-8 0 1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    remove.addEventListener('click', async (event) => {
      event.stopPropagation();
      await deleteCollection(collection);
    });
    head.appendChild(remove);
    head.appendChild(el('span', 'build-count', gear.length
      ? (gear.length === 1 ? '1 item' : gear.length + ' items')
      : 'No gear'));
    head.appendChild(el('span', 'build-spacer'));
    const asc = collection.ascendancy && (collection.ascendancy.ascendancy || collection.ascendancy);
    if (asc && typeof asc === 'string') head.appendChild(el('span', 'build-asc', asc));
    const send = el('button', 'mini-btn build-send', 'Send to Discord');
    send.type = 'button';
    send.title = 'Send this build to your Discord webhook';
    send.disabled = !gear.length && !assigned.length;
    send.addEventListener('click', () => sendBuildToDiscord(collection, send));
    head.appendChild(send);
    block.appendChild(head);

    if (gear.length) {
      block.appendChild(el('div', 'build-group', 'Imported from the build code'));
      gear.forEach((rec) => block.appendChild(buildItemRow(rec)));
    }
    if (assigned.length) {
      block.appendChild(el('div', 'build-group', 'Saved items assigned to this build'));
      assigned.forEach((rec) => block.appendChild(buildItemRow(rec)));
    }
    if (placeholders.length && !gear.length) {
      block.appendChild(el('div', 'build-group', 'Gear named by the build page'));
      placeholders.forEach((entry) => block.appendChild(gearReferenceCard(entry, collection.game)));
      const row = el('div', 'build-foot');
      row.appendChild(el('span', 'hint', 'Links and artwork from the build page'));
      const read = el('button', 'mini-btn', 'Read page');
      read.type = 'button';
      read.title = 'Read each item\u2019s trade link and picture from the open Mobalytics build tab';
      read.addEventListener('click', () => readBuildPage(collection.id));
      row.appendChild(read);
      block.appendChild(row);
    }
    if (!gear.length && !assigned.length && !placeholders.length) {
      block.appendChild(el('p', 'build-empty-hint', 'No gear in this build yet. Import a build code to fill it.'));
    }
    buildList.appendChild(block);
  });
  if (buildEmpty) buildEmpty.classList.toggle('hidden', builds.length > 0);
}

/* The whole build, one field per item, posted to the webhook from Settings. */
async function sendBuildToDiscord(collection, button) {
  const webhook = state.settings && state.settings.discordWebhook;
  if (!hasDiscordWebhook(webhook)) {
    toast('Add a Discord webhook in Settings → Watchers first.', true);
    return;
  }
  const granted = await ensureDiscordPermission();
  if (!granted) {
    toast('Allow access to discord.com to send the build.', true);
    return;
  }
  if (button) button.disabled = true;
  toastWhileWorking('Sending the build to Discord.');
  const response = await send('ptc:build:discord', { collectionId: collection.id }).catch(() => null);
  if (button) button.disabled = false;
  if (response && response.ok) {
    const messages = Number(response.messages) || 1;
    toast('Build sent to Discord: ' + response.items + ' items in ' + messages
      + (messages === 1 ? ' message.' : ' messages.'), false, 3500);
    return;
  }
  toast((response && response.error) || 'Could not send the build.', true, 8000);
}

/* ------------------------------- detail -------------------------------- */

function actionButton(label, action, disabled, extraClass) {
  const button = el('button', 'action' + (extraClass ? ' ' + extraClass : ''), label);
  button.type = 'button';
  button.dataset.action = action;
  if (disabled) button.disabled = true;
  return button;
}

function actionLink(label, href) {
  const link = el('a', 'action', label);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

const DISCORD_ORIGINS = ['https://discord.com/*', 'https://discordapp.com/*'];
const COE_ORIGIN = 'https://beta.craftofexile.com/*';

async function ensureCoePermission() {
  if (!chrome.permissions || !chrome.permissions.request) return true;
  try {
    /* Asked straight away instead of after a "contains" check: the request has
       to happen inside the click's own task, and an await in front of it spends
       the user gesture, which turns the request into a failure. Chrome answers
       without a prompt when the origin is already granted. */
    return await chrome.permissions.request({ origins: [COE_ORIGIN] });
  } catch (error) {
    return false;
  }
}

// A saved item carries the real affix names from the trade API. A build import
// only carries the printed lines, and Craft of Exile matches affixes by name, so
// those need to be filled in before the paste is built (background does it and
// stores the result).
function coeNeedsModNames(rec) {
  const list = Array.isArray(rec && rec.coeMods) ? rec.coeMods : [];
  return list.some((mod) => mod && mod.text
    && (mod.kind === 'explicit' || mod.kind === 'crafted' || mod.kind === 'fractured' || mod.kind === 'desecrated')
    && (!mod.type || !mod.name || mod.name === 'modifier'));
}

// Opening a tab after an await no longer counts as a click for the popup
// blocker, so the async paths use chrome.tabs.create instead of window.open.
function openCoeTab(url) {
  if (!url) return;
  chrome.tabs.create({ url: url, active: true });
}

/* The action that opens the item in Craft of Exile with its affixes. */
function coeActionLink(rec, entry) {
  const link = actionLink('Open in Craft of Exile', entry.url);
  link.classList.add('coe-link');
  const summary = coeImportSummary(rec);
  link.title = (summary.included
    ? 'Open in Craft of Exile (beta) - base, quality, item level and ' + summary.included + ' modifier(s) imported.'
    : 'Open in Craft of Exile (beta) - base, quality and item level imported.')
    + (rarityInfo(rec)[0] === 'unique'
      ? ' Unique rarity uses the site item data (Chrome asks for access once).'
      : ' Sent through the site item data (Chrome asks for access once).');
  if (summary.skipped) link.title += ' (not imported: ' + (summary.skippedTexts || []).join(' | ') + ')';
  link.addEventListener('click', (event) => openCoeLink(event, rec, entry.url));
  return link;
}

/* The first time Craft of Exile is opened, the user gets one short screen that
   says what the site is (a simulator, not a crafting service), what to do there
   and what is not imported. Clicking its button is the gesture the permission
   prompt needs, so it also keeps the access request working. */
const COE_HINT_KEY = 'ptcCoeHintSeen';

function coeHintSeen() {
  try {
    return chrome.storage.local.get({ [COE_HINT_KEY]: false })
      .then((data) => !!(data && data[COE_HINT_KEY]))
      .catch(() => true);
  } catch (error) {
    return Promise.resolve(true);
  }
}

function showCoeHint(next) {
  const intro = el('p', 'hint', 'Craft of Exile is a crafting simulator: it does not make the item, it estimates the cost and the odds of a plan.');
  const steps = el('ol', 'coe-steps');
  [
    'The item is already loaded: its base, quality, item level and modifiers.',
    'There, pick a currency (Chaos Orb, Orb of Alteration…) and the modifier you are aiming for, then press Simulate.',
    'Runes are not imported and the base defences are rolled by the site, so a number can differ from the item.',
  ].forEach((line) => steps.appendChild(el('li', '', line)));
  const row = el('div', 'button-row');
  const open = el('button', 'primary-btn', 'Open Craft of Exile');
  open.type = 'button';
  open.addEventListener('click', () => {
    try { chrome.storage.local.set({ [COE_HINT_KEY]: true }); } catch (error) { /* storage unavailable */ }
    closeModal();
    next();
  });
  const cancel = el('button', 'ghost-btn', 'Not now');
  cancel.type = 'button';
  cancel.addEventListener('click', closeModal);
  row.append(open, cancel);
  showModal('Crafting in Craft of Exile', [intro, steps, row]);
}

async function openCoeLink(event, rec, fallbackUrl) {
  event.preventDefault();
  event.stopPropagation();
  if (!(await coeHintSeen())) {
    showCoeHint(() => openCoeNow(rec, fallbackUrl));
    return;
  }
  await openCoeNow(rec, fallbackUrl);
}

async function openCoeNow(rec, fallbackUrl) {
  // Craft of Exile's paste importer refuses uniques ("Unsupported rarity") and
  // drops the modifiers of a PoE 2 rare (measured on the live site), so the
  // details payload is used for both games: it pins the base and attaches the
  // modifiers by their own keys. The paste stays as the fallback.
  const unique = rarityInfo(rec)[0] === 'unique';
  if (!unique && !coeNeedsModNames(rec)
    && globalThis.PTC_GAMES.profile(activeGame()).coeDetailsImport) {
    // The details URL pins the base by its internal id, so the item cannot land
    // on another base, and the mods are attached by the site's own modifier
    // keys - measured on the live site (PoE 1 3.30, PoE 2 0.5.5.5), this is the
    // path that imports cleanly in both games.
    const granted = await ensureCoePermission();
    if (granted) {
      const response = await send('ptc:coe:url', { record: rec });
      if (response && response.ok && response.url) {
        openCoeTab(response.url);
        return;
      }
    }
    // Could not build the details URL (offline, base missing): fall through
    // to the paste below.
  }
  if (unique || coeNeedsModNames(rec)) {
    const granted = await ensureCoePermission();
    if (granted) {
      if (unique) {
        const response = await send('ptc:coe:url', { record: rec });
        if (response && response.ok && response.url) {
          openCoeTab(response.url);
          return;
        }
      } else {
        const response = await send('ptc:coe:prepare', { record: rec });
        if (response && response.ok && response.record) {
          rec.coeMods = response.record.coeMods;
          const url = buildCoeImportUrl(rec, activeGame(), {
            includeDesecrated: state.settings.coeIncludeDesecrated !== false,
          });
          openCoeTab(url || fallbackUrl);
          return;
        }
      }
    }
  }
  openCoeTab(fallbackUrl);
}
const NTFY_ORIGIN = 'https://ntfy.sh/*';

async function ensureDiscordPermission() {
  if (!chrome.permissions || !chrome.permissions.request) return true;
  try {
    return await chrome.permissions.request({ origins: DISCORD_ORIGINS });
  } catch (error) {
    return false;
  }
}

async function ensureNtfyPermission(value) {
  if (!chrome.permissions || !chrome.permissions.request) return true;
  const raw = String(value || '').trim();
  if (!raw) return true;
  let host = '';
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://ntfy.sh/' + raw).hostname.toLowerCase();
  } catch (error) {
    return true;
  }
  if (host !== 'ntfy.sh') return true;
  try {
    /* Same rule as the other permission prompts: request first, or the click's
       gesture is already spent when the prompt would be shown. */
    return await chrome.permissions.request({ origins: [NTFY_ORIGIN] });
  } catch (error) {
    return false;
  }
}

function hasDiscordWebhook(value) {
  return /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(String(value || '').trim());
}

function metaRow(label, value, isLink) {
  const row = el('div', 'meta-row');
  row.appendChild(el('span', '', label));
  if (isLink && value) {
    const link = el('a', '', 'open');
    link.href = value;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    row.appendChild(link);
  } else if (value && value.nodeType) {
    row.appendChild(value);
  } else {
    row.appendChild(el('b', '', value || '-'));
  }
  return row;
}

function buildAssignRow(rec) {
  const row = el('div', 'assign-row');
  row.appendChild(el('label', '', 'Build'));
  const select = document.createElement('select');
  select.appendChild(optionEl('', 'Unsorted'));
  state.collections.forEach((collection) => select.appendChild(optionEl(collection.id, collection.name)));
  select.appendChild(optionEl('__new', '+ New build...'));
  const current = collectionExists(rec.collectionId) ? rec.collectionId : '';
  select.value = current;
  select.addEventListener('change', async () => {
    if (select.value === '__new') {
      select.value = current;
      openCollectionsModal(rec.id);
      return;
    }
    select.disabled = true;
    const ok = await moveItem(rec.id, select.value);
    select.disabled = false;
    if (ok) {
      toast(select.value ? 'Item moved to build.' : 'Item moved to Unsorted.');
      renderItems();
    } else {
      select.value = current;
    }
  });
  row.appendChild(select);
  return row;
}

function watcherFor(rec) {
  return state.watched.find((entry) => entry.itemId === rec.id && recordGame(entry) === recordGame(rec));
}

function buildWatcherRecord(rec) {
  return {
    itemId: rec.id,
    game: recordGame(rec),
    league: rec.league || '',
    queryId: rec.queryId || '',
    name: displayName(rec).name,
    icon: rec.icon || (rec.item && rec.item.icon) || '',
    priceText: rec.priceText || '',
    priceAmount: typeof rec.priceAmount === 'number' ? rec.priceAmount : null,
    priceCurrency: rec.priceCurrency || '',
    account: rec.account || '',
    ign: getIgn(rec),
    whisper: rec.whisper || '',
    searchUrl: rec.searchUrl || rec.sourceUrl || '',
    item: rec.item || null,
  };
}

async function toggleWatch(rec) {
  const current = watcherFor(rec);
  if (current) {
    const response = await send('ptc:watch:remove', { id: current.id });
    if (!response.ok) {
      toast(response.error || 'Could not stop watching.', true);
      return false;
    }
    toast('Stopped watching.');
    return true;
  }
  const response = await send('ptc:watch:add', { record: buildWatcherRecord(rec) });
  if (!response.ok) {
    toast(response.error || 'Could not watch the item.', true);
    return false;
  }
  toast(response.duplicate ? 'This item is already watched.' : 'Watching this item.');
  return true;
}

function priceHistorySection(rec) {
  const points = priceHistoryPoints(rec);
  if (!points.length) return null;
  const section = el('section', 'price-history');
  section.appendChild(el('h3', '', 'Price history'));
  if (points.length < 2) {
    section.appendChild(el('p', 'ph-single', 'Baseline ' + points[0].text + ' \u00b7 ' + timeAgo(points[0].at) + ' \u2014 refresh the item to start the chart.'));
    return section;
  }
  const chart = buildPriceChart(rec);
  if (chart) section.appendChild(chart);
  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.amount - first.amount;
  const pct = first.amount > 0 ? Math.round((delta / first.amount) * 100) : 0;
  const caption = el('div', 'ph-caption');
  caption.appendChild(el('span', 'ph-trend ' + (delta < 0 ? 'down' : delta > 0 ? 'up' : 'flat'),
    (delta > 0 ? '+ ' : delta < 0 ? '\u2212 ' : '') + Math.abs(pct) + '%'));
  const rangeLabel = new Date(first.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    + ' \u2192 ' + new Date(last.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  caption.appendChild(el('span', 'ph-detail', points.length + ' checks \u00b7 now ' + last.text + ' \u00b7 ' + rangeLabel));
  section.appendChild(caption);
  const list = el('div', 'ph-list');
  const start = points.length > 5 ? points.length - 5 : 0;
  for (let i = points.length - 1; i >= start; i -= 1) {
    const entry = points[i];
    const prev = i > 0 ? points[i - 1] : null;
    const diff = prev ? entry.amount - prev.amount : 0;
    const row = el('div', 'ph-row');
    row.appendChild(el('span', 'ph-date', new Date(entry.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })));
    row.appendChild(el('span', 'ph-price', entry.text));
    row.appendChild(el('span', 'ph-delta ' + (prev ? (diff > 0 ? 'up' : diff < 0 ? 'down' : '') : ''),
      prev ? (diff > 0 ? '+ ' : diff < 0 ? '\u2212 ' : '') + formatPriceAmount(Math.abs(diff)) : ''));
    list.appendChild(row);
  }
  section.appendChild(list);
  return section;
}

function buildDetail(rec) {
  const frag = document.createDocumentFragment();
  const rarity = rarityInfo(rec);
  const game = recordGame(rec);

  const hero = el('div', 'hero');
  const heroIcon = el('div', 'hero-icon');
  addIcon(heroIcon, rec);

  const heroText = el('div', 'hero-text');
  const named = displayName(rec);
  heroText.appendChild(el('div', 'hero-name r-' + rarity[0], named.name));
  if (named.type) heroText.appendChild(el('div', 'hero-type', named.type));

  const heroTags = el('div', 'hero-tags');
  if (rec.priceText) heroTags.appendChild(el('span', 'tag price', rec.priceText));
  const conv = conversionLabel(rec);
  if (conv) heroTags.appendChild(el('span', 'tag conversion', conv));
  heroTags.appendChild(el('span', 'tag game', gameLabel(game)));
  if (rec.league) heroTags.appendChild(el('span', 'tag', rec.league));
  if (hasCrafted(rec)) heroTags.appendChild(el('span', 'tag crafted', 'Crafted'));
  if (hasFractured(rec)) heroTags.appendChild(el('span', 'tag fractured', 'Fractured'));
  const build = collectionName(rec.targetOf || rec.collectionId);
  if (build) heroTags.appendChild(el('span', 'tag collection', build));
  if (isBlacklisted(rec)) heroTags.appendChild(el('span', 'tag danger', 'Blacklisted seller'));
  if (heroTags.childElementCount) heroText.appendChild(heroTags);

  hero.appendChild(heroIcon);
  hero.appendChild(heroText);
  frag.appendChild(hero);

  const sellerUrl = rec.account
    ? 'https://www.pathofexile.com/account/view-profile/' + encodeURIComponent(rec.account)
    : '';
  const searchUrl = safePoeLink(rec.searchUrl || rec.sourceUrl);
  const watched = !!watcherFor(rec);

  const actions = el('div', 'actions');
  const targetBase = (rec.item && (rec.item.baseType || rec.item.typeLine)) || rec.typeLine || '';
  let searchIsSavedLink = false;
  if (!rec.targetOf && searchUrl) {
    if (savedSearchUsable(searchUrl)) {
      /* The search the item was saved from is the search that found it, so it
         holds the item: it is opened exactly as it is, instantly, with the item
         and the other items with the same modifiers in its results. */
      const savedLink = actionLink('Price check', searchUrl);
      savedLink.title = 'Open the search this item was saved from';
      actions.appendChild(savedLink);
      searchIsSavedLink = true;
    } else {
      /* The saved search does not describe the item (the site's default search,
         or one the player ran with only a price filter set): opening it would
         list every item in the league, so a search is built for the item
         instead - its base type and its own modifiers, in the league the
         listing was saved from. A button, not a link, because the url does not
         exist until it is built; and when the build fails nothing is opened and
         the reason is shown, instead of quietly opening the search that does not
         find the item. */
      const findBtn = actionButton('Price check', 'find-similar');
      findBtn.title = 'Search for this item and the items that share its modifiers';
      findBtn.addEventListener('click', async () => {
        findBtn.disabled = true;
        toastWhileWorking('Preparing the search for this item.');
        const response = await send('ptc:trade:url', { record: rec }).catch(() => null);
        findBtn.disabled = false;
        if (response && response.ok && response.url) {
          toast('Opening the search.', false, 1600);
          chrome.tabs.create({ url: response.url, active: true });
          return;
        }
        toast((response && response.error) || 'The search for this item could not be built.', true);
      });
      actions.appendChild(findBtn);
    }
  } else if (targetBase) {
    /* A build import has no search of its own, so the button builds a search
       for the item itself: base type, rarity, level and its own modifiers,
       in the league the player is in. */
    const searchBtn = actionButton('Price check', 'trade-search');
    searchBtn.title = 'Search for this item and the items that share its modifiers';
    const searchOptions = {
      name: rarity[0] === 'unique' ? ((rec.item && rec.item.name) || rec.name || '') : '',
      unique: rarity[0] === 'unique',
      rarity: rarity[0],
      ilvl: (rec.item && rec.item.ilvl) || null,
      quality: itemQualityValue(rec),
      corrupted: !!(rec.item && (rec.item.corrupted || rec.item.doubleCorrupted)),
      itemClass: (rec.item && rec.item.itemClass) || itemClassFromBase(targetBase) || '',
      /* The modifier lines come from the same reader the item tooltip uses, so
         a build import and a saved listing produce the same search. */
      mods: searchModLines(rec.item),
      id: rec.id,
      /* The worker builds a different group for an import than for a listing. */
      targetOf: rec.targetOf || '',
      simple: true,
    };
    if (rec.targetOf) {
      /* The league is deliberately not taken from the record: a build import is
         not played in one league, it is played wherever the player is now. A
         stored league (especially a Standard left over from an old import) would
         send the search to an economy the player is not in. */
      searchBtn.addEventListener('click', () => openTradeSearch(targetBase, game, '', searchOptions));
    } else {
      /* A saved listing lives in the league it was listed in, so the search for
         it belongs in that league. */
      searchBtn.addEventListener('click', () => openTradeSearch(targetBase, game, rec.league || '', searchOptions));
    }
    actions.appendChild(searchBtn);
  } else if (searchUrl) actions.appendChild(actionLink('Open search', searchUrl));
  else actions.appendChild(actionButton('No search link', 'noop', true));
  /* The order the panel is used in: the price check first, then the crafting
     plan, then the rest; Delete stays last. */
  const wiki = wikiLinks(rec, game, { includeDesecrated: state.settings.coeIncludeDesecrated !== false });
  const coeEntry = wiki.find((entry) => entry && entry.coe) || null;
  if (coeEntry) actions.appendChild(coeActionLink(rec, coeEntry));
  actions.appendChild(actionButton(watched ? 'Stop watching' : 'Watch listing', 'watch', !!rec.targetOf, watched ? 'active' : ''));
  actions.appendChild(actionButton('Copy item', 'copy-item'));
  if (sellerUrl) actions.appendChild(actionLink('Seller profile', sellerUrl));
  else actions.appendChild(actionButton('No seller', 'noop', true));
  actions.appendChild(actionButton('Delete', 'delete', false, 'danger'));
  frag.appendChild(actions);

  const wikiOnly = wiki.filter((entry) => !entry.coe);
  if (state.settings.showWikiLinks && wikiOnly.length) {
    const links = el('div', 'wiki-links');
    links.appendChild(el('span', 'muted', 'Wiki:'));
    wikiOnly.forEach((entry) => links.appendChild(actionLink(entry.label, entry.url)));
    frag.appendChild(links);
  }

  /* An imported item already belongs to the build its code was imported into;
     moving it to another build would leave it filed under the wrong one. */
  if (!rec.targetOf) frag.appendChild(buildAssignRow(rec));
  frag.appendChild(buildTooltip(rec));

  const meta = el('div', 'meta');
  meta.appendChild(metaRow('Game', gameLabel(game)));
  meta.appendChild(metaRow('Price', rec.priceText || 'not specified'));
  const fee = Number((rec.listing || {}).fee);
  if (Number.isFinite(fee) && fee > 0) meta.appendChild(metaRow('Trade fee', String(Math.round(fee))));
  meta.appendChild(metaRow('League', rec.league || '-'));
  meta.appendChild(metaRow('Seller', rec.account || '-'));
  meta.appendChild(metaRow('IGN', getIgn(rec) || '-'));
  meta.appendChild(metaRow('Build', build || 'Unsorted'));
  meta.appendChild(metaRow('Saved', fullDate(rec.savedAt)));
  meta.appendChild(metaRow('Listing ID', el('code', '', rec.id || '-')));
  /* When the action above is already this saved search, the row would just
     repeat it, so it only shows when the button builds a different search. */
  /* The button above is this saved search, so the row would only repeat it. */
  if (searchUrl && !searchIsSavedLink) {
    meta.appendChild(metaRow('Original search', searchUrl, true));
  }
  frag.appendChild(meta);

  const priceHistory = priceHistorySection(rec);
  if (priceHistory) frag.appendChild(priceHistory);

  return frag;
}

function renderDetail(rec) {
  detailBody.replaceChildren(buildDetail(rec));
  ensurePrice(rec);
}

/* One detail panel for both sections, drawn over the list it came from. */
function paintLayout() {
  const open = !!state.openId;
  Object.entries(views).forEach(([key, node]) => {
    node.classList.toggle('hidden', key !== state.tab || open);
  });
  detailBox.classList.toggle('hidden', !open);
}

function openDetail(id, from) {
  const rec = state.items.find((entry) => entry.id === id);
  if (!rec) return;
  state.openId = id;
  state.tab = from === 'builds' ? 'builds' : 'items';
  if (backLabel) backLabel.textContent = state.tab === 'builds' ? 'Back to builds' : 'Back to items';
  renderDetail(rec);
  paintLayout();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function showList() {
  state.openId = null;
  if (state.tab === 'builds') renderBuilds();
  else renderItems();
  paintLayout();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function openViewer(id) {
  try {
    chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html?id=' + encodeURIComponent(id)) });
  } catch (error) {
    toast('Could not open the full view.', true);
  }
}

/* -------------------------------- modal -------------------------------- */

function closeModal() {
  modal.classList.add('hidden');
  state.modalAssignItemId = null;
  modalBody.replaceChildren();
  if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') modalReturnFocus.focus();
  modalReturnFocus = null;
}

let modalReturnFocus = null;

function focusableInModal() {
  return Array.from(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter((node) => !node.disabled && node.getClientRects().length > 0);
}

function focusModal() {
  modalReturnFocus = document.activeElement;
  requestAnimationFrame(() => {
    const first = focusableInModal()[0];
    if (first) first.focus();
  });
}

function showModal(title, nodes) {
  modalTitle.textContent = title;
  modalBody.replaceChildren();
  (Array.isArray(nodes) ? nodes : [nodes]).forEach((node) => {
    if (node) modalBody.appendChild(node);
  });
  modal.classList.remove('hidden');
  focusModal();
}

/*
 * The league a new search should use, in the same order of trust the worker
 * uses (resolveLeague): the league picked in the header or in settings, the
 * league typed into the fallback field, then the league of the trade tab the
 * user is working in.
 *
 * The header picker writes leagueByGame / leagueModeByGame, not fallbackLeague,
 * so reading only the fallback sent every PoE 1 build import to Standard even
 * when a league was selected in the header.
 */
function currentLeagueFor(game) {
  const resolved = globalThis.PTC_GAMES.normalizeGame(game);
  const prefs = globalThis.PTC_SETTINGS
    ? globalThis.PTC_SETTINGS.leaguePrefs(state.settings, resolved)
    : { league: '', mode: 'auto', hardcore: false };
  if (prefs.mode === 'manual' && prefs.league) return prefs.league;
  const configured = state.settings && state.settings.fallbackLeague
    && state.settings.fallbackLeague[resolved];
  if (configured) return configured;
  const active = state.activeTrade;
  if (active && globalThis.PTC_GAMES.normalizeGame(active.game) === resolved && active.league) return active.league;
  return '';
}

function baseTypeSearchUrl(game, league, baseType, name) {
  // The preview copy is shared with content.js, which understands this hash and
  // turns it into a real query; the quality prefix must not reach the API.
  const base = String(baseType || '').replace(/^(superior|synthesised|fractured|replica)\s+/i, '').trim() || String(baseType || '');
  const resolved = globalThis.PTC_GAMES.normalizeGame(game);
  let url = globalThis.PTC_GAMES.buildLeagueSearchUrl(resolved, league || 'Standard')
    + '#ptc-search=' + encodeURIComponent(base);
  if (name && String(name).toLowerCase() !== base.toLowerCase()) {
    url += '&ptc-name=' + encodeURIComponent(name);
  }
  return url;
}

// Quality arrives either as a property (saved listings) or a plain string (PoB imports).
function itemQualityValue(rec) {
  const item = (rec && rec.item) || {};
  const prop = (item.properties || []).find((entry) => entry && /quality/i.test(String(entry.name || '')));
  if (prop && Array.isArray(prop.values) && prop.values.length) {
    const parsed = parseInt(String(prop.values[0][0] || '').replace(/[^0-9-]/g, ''), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const parsed = parseInt(String(item.quality || '').replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/*
 * Asks the background to create a real trade search and opens its canonical
 * URL, so the site itself shows the results for this item and league. The old
 * league page (with the #ptc-search hint) stays as a fallback for offline use.
 */
async function openTradeSearch(baseType, game, league, options) {
  const extra = options && typeof options === 'object' ? options : {};
  const resolved = globalThis.PTC_GAMES.normalizeGame(game || activeGame());
  const preferred = league || currentLeagueFor(resolved);
  const unique = !!extra.unique && !!extra.name;
  const rarityKey = String(extra.rarity || '').toLowerCase();
  /* The same builder the saved items use: the query is written into the url and
     the site runs it, so the click costs no trade request and the page shows the
     item's base with its own modifiers. */
  const frame = unique || rarityKey === 'unique' ? 3
    : rarityKey === 'magic' ? 1
      : rarityKey === 'normal' ? 0 : 2;
  const record = {
    id: extra.id || '',
    game: resolved,
    league: preferred,
    targetOf: extra.targetOf || '',
    name: unique ? extra.name : baseType,
    typeLine: baseType,
    rarity: frame,
    item: {
      name: unique ? extra.name : '',
      baseType: baseType,
      typeLine: baseType,
      frameType: frame,
      ilvl: extra.ilvl != null ? extra.ilvl : null,
      itemClass: extra.itemClass || '',
      corrupted: extra.corrupted === true,
      explicitMods: Array.isArray(extra.mods) ? extra.mods : [],
      properties: extra.quality ? [{ name: 'Quality', values: [[String(extra.quality) + '%', 0]] }] : [],
    },
  };
  toastWhileWorking('Preparing the search for this item.');
  const response = await send('ptc:trade:url', { record: record }).catch(() => null);
  if (response && response.ok && response.url) {
    toast('Opening the search.', false, 1400);
    chrome.tabs.create({ url: response.url, active: true });
    return;
  }
  /* No fallback to a search without the modifiers: that page lists every item
     of the base, which reads as "random items" and hides the failure. */
  toast((response && response.error) || 'The search for this item could not be built.', true, 9000);
}


function openCollectionsModal(assignItemId) {
  state.modalAssignItemId = assignItemId || null;
  modalTitle.textContent = state.modalAssignItemId ? 'Add item to a build' : 'Builds';
  modal.classList.remove('hidden');
  renderCollectionsModal();
  focusModal();
}

function startRename(row, collection) {
  row.replaceChildren();
  const input = document.createElement('input');
  input.className = 'modal-input';
  input.type = 'text';
  input.maxLength = 60;
  input.value = collection.name;
  const save = el('button', 'primary-btn', 'Save');
  save.type = 'button';
  const cancel = el('button', 'ghost-btn', 'Cancel');
  cancel.type = 'button';
  row.append(input, save, cancel);
  input.focus();
  input.select();
  const commit = async () => {
    if (await renameCollection(collection.id, input.value)) {
      toast('Build renamed.');
      renderCollectionsModal();
      renderItems();
    }
  };
  save.addEventListener('click', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') renderCollectionsModal();
  });
  cancel.addEventListener('click', renderCollectionsModal);
}

function collectionItemNode(collection) {
  const row = el('div', 'collection-item');
  const info = el('div', 'collection-info');
  const nameRow = el('div', 'collection-name-row');
  const ascendancyIcon = collection.ascendancy && safeAscendancyIcon(collection.ascendancy.ascendancyIcon);
  if (ascendancyIcon) {
    const icon = document.createElement('img');
    icon.className = 'ascendancy-icon';
    icon.src = ascendancyIcon;
    icon.alt = '';
    icon.title = collection.ascendancy.ascendancyClass + ' - ' + collection.ascendancy.ascendancy;
    nameRow.appendChild(icon);
  }
  nameRow.appendChild(el('div', 'collection-name', collection.name));
  info.appendChild(nameRow);
  if (collection.ascendancy && collection.ascendancy.ascendancy) {
    info.appendChild(el('div', 'collection-ascendancy', collection.ascendancy.ascendancy
      + (collection.ascendancy.ascendancyClass ? ' (' + collection.ascendancy.ascendancyClass + ')' : '')));
  }
  const count = collectionItemCount(collection);
  const goals = Array.isArray(collection.goals) ? collection.goals.length : 0;
  const meta = [count === 1 ? '1 item' : count + ' items'];
  if (goals) meta.push(goals === 1 ? '1 goal' : goals + ' goals');
  info.appendChild(el('div', 'collection-meta', meta.join(' · ')));
  row.appendChild(info);

  const actions = el('div', 'collection-actions');
  if (state.modalAssignItemId) {
    const add = el('button', 'mini-btn primary', 'Add here');
    add.type = 'button';
    add.addEventListener('click', async () => {
      if (await moveItem(state.modalAssignItemId, collection.id)) {
        toast('Item added to "' + collection.name + '".');
        closeModal();
        renderItems();
      }
    });
    actions.appendChild(add);
  } else {
    const open = el('button', 'mini-btn primary', 'Open');
    open.type = 'button';
    open.title = 'Show the items of this build';
    open.addEventListener('click', () => {
      closeModal();
      setTab('builds');
    });
    actions.appendChild(open);
  }
  const sheet = el('button', 'mini-btn', 'Notes & goals');
  sheet.type = 'button';
  sheet.title = 'Notes, goals and progress for this build';
  sheet.addEventListener('click', () => openBuildSheetModal(collection.id));
  actions.appendChild(sheet);
  const rename = el('button', 'mini-btn', 'Rename');
  rename.type = 'button';
  rename.addEventListener('click', () => startRename(row, collection));
  actions.appendChild(rename);
  const remove = el('button', 'mini-btn', 'Delete');
  remove.type = 'button';
  remove.addEventListener('click', async () => {
    if (await deleteCollection(collection)) {
      renderCollectionsModal();
      renderItems();
    }
  });
  actions.appendChild(remove);
  row.appendChild(actions);
  return row;
}

function buildAscendancyPicker() {
  const wrap = el('div', 'ascendancy-picker');
  const label = el('label', 'field', 'Ascendancy (optional)');
  const select = document.createElement('select');
  select.className = 'modal-input';
  select.id = 'ascendancySelect';
  const none = optionEl('', 'No ascendancy');
  select.appendChild(none);
  const classes = ascendancyClassesFor(activeGame());
  classes.forEach((entry) => {
    const group = document.createElement('optgroup');
    group.label = entry.class;
    entry.ascendancies.forEach((name) => {
      group.appendChild(optionEl(entry.class + '|' + name, name));
    });
    select.appendChild(group);
  });
  const preview = document.createElement('img');
  preview.className = 'ascendancy-preview';
  preview.alt = '';
  preview.hidden = true;
  const updatePreview = () => {
    const value = select.value;
    if (!value) {
      preview.hidden = true;
      preview.removeAttribute('src');
      return;
    }
    const cls = value.split('|')[0];
    const found = classes.find((entry) => entry.class === cls);
    const icon = found && safeAscendancyIcon(found.icon);
    if (icon) {
      preview.src = icon;
      preview.hidden = false;
    }
  };
  select.addEventListener('change', updatePreview);
  label.appendChild(select);
  wrap.append(label, preview);
  wrap.getValue = () => {
    const value = select.value;
    if (!value) return null;
    const parts = value.split('|');
    const found = classes.find((entry) => entry.class === parts[0]);
    return {
      ascendancy: parts[1] || '',
      ascendancyClass: parts[0] || '',
      ascendancyIcon: safeAscendancyIcon(found && found.icon),
    };
  };
  return wrap;
}

function ascendancyIconFor(className) {
  const classes = ascendancyClassesFor(activeGame());
  const found = classes.find((entry) => entry.class === className);
  return (found && found.icon) || '';
}

function renderCollectionsModal() {
  modalBody.replaceChildren();
  const collections = gameCollections().slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));

  /* The list is what the dialog is for; creating a build is a button away, not
     a form that pushes the list down every time it opens. */
  const head = el('div', 'builds-head');
  head.appendChild(el('h3', 'builds-title',
    collections.length === 1 ? '1 build' : collections.length + ' builds'));
  const newBtn = el('button', 'mini-btn', '+ New build');
  newBtn.type = 'button';
  head.appendChild(newBtn);
  modalBody.appendChild(head);

  const form = el('form', 'create-row hidden');
  const input = document.createElement('input');
  input.className = 'modal-input';
  input.type = 'text';
  input.maxLength = 60;
  input.placeholder = 'New build name...';
  const create = el('button', 'primary-btn', 'Create');
  create.type = 'submit';
  const picker = buildAscendancyPicker();
  form.append(input, picker, create);
  const doCreate = async () => {
    const wasAssigning = !!state.modalAssignItemId;
    const ascendancy = picker.getValue();
    try {
      if (await createCollection(input.value, ascendancy)) {
        input.value = '';
        closeModal();
        renderItems();
      }
    } catch (error) {
      toast((error && error.message) || 'Could not create the build.', true);
    }
  };
  create.type = 'button';
  create.addEventListener('click', doCreate);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await doCreate();
  });
  form.addEventListener('submit', (event) => event.preventDefault());
  modalBody.appendChild(form);
  newBtn.addEventListener('click', () => {
    const opening = form.classList.contains('hidden');
    form.classList.toggle('hidden', !opening);
    if (opening) input.focus();
  });
  if (state.modalAssignItemId) modalBody.appendChild(el('p', 'modal-hint', 'Pick a build for this item, or create a new one.'));
  if (!collections.length) form.classList.remove('hidden');
  const list = el('div', 'collection-list');
  if (!collections.length) list.appendChild(el('p', 'modal-empty', 'No builds yet. Create one to group items and track goals.'));
  collections.forEach((collection) => list.appendChild(collectionItemNode(collection)));
  modalBody.appendChild(list);
}

function openBuildSheetModal(collectionId) {
  const collection = state.collections.find((entry) => entry.id === collectionId);
  if (!collection) return;

  const wrap = el('div', 'build-sheet');
  wrap.appendChild(el('h3', '', collection.name));

  const progress = el('div', 'bs-progress');
  const bar = el('div', 'bs-bar');
  const fill = el('div', 'bs-fill');
  bar.appendChild(fill);
  progress.appendChild(bar);
  const label = el('span', 'bs-label', '');
  progress.appendChild(label);
  wrap.appendChild(progress);

  const notesField = el('label', 'field');
  const notesArea = document.createElement('textarea');
  notesArea.rows = 4;
  notesArea.spellcheck = false;
  notesArea.placeholder = 'Crafting notes, target build, what you are looking for...';
  notesArea.value = collection.notes || '';
  notesField.append('Notes', notesArea);
  wrap.appendChild(notesField);

  const goalsWrap = el('div', 'bs-goals');
  goalsWrap.appendChild(el('h4', '', 'Goals'));
  const goalList = el('div', 'bs-goal-list');
  goalsWrap.appendChild(goalList);

  const addRow = el('div', 'bs-goal-add');
  const addInput = document.createElement('input');
  addInput.className = 'modal-input';
  addInput.type = 'text';
  addInput.maxLength = 60;
  addInput.placeholder = 'New goal (e.g. 20c Vaal Claw)...';
  const addBtn = el('button', 'mini-btn', 'Add');
  addBtn.type = 'button';
  addRow.append(addInput, addBtn);
  goalsWrap.appendChild(addRow);
  wrap.appendChild(goalsWrap);

  const actions = el('div', 'button-row');
  const save = el('button', 'primary-btn', 'Save notes');
  save.type = 'button';
  save.addEventListener('click', async () => {
    const response = await send('ptc:collection:update', { id: collectionId, patch: { notes: notesArea.value } });
    if (response.ok) toast('Build sheet saved.');
    else toast(response.error || 'Could not save.', true);
  });
  const back = el('button', 'ghost-btn', 'Close');
  back.type = 'button';
  back.addEventListener('click', closeModal);
  actions.append(save, back);
  wrap.appendChild(actions);

  function liveCollection() {
    return state.collections.find((entry) => entry.id === collectionId) || null;
  }

  function renderDynamic() {
    const current = liveCollection();
    if (!current) return;
    const goals = Array.isArray(current.goals) ? current.goals : [];
    const doneCount = goals.filter((goal) => goal.done).length;
    const itemCount = collectionItemCount(current);
    fill.style.width = goals.length ? Math.round((doneCount / goals.length) * 100) + '%' : '0%';
    label.textContent = goals.length
      ? doneCount + '/' + goals.length + ' goals \u00b7 ' + itemCount + ' items'
      : itemCount + (itemCount === 1 ? ' item' : ' items') + ' \u00b7 no goals yet';
    goalList.replaceChildren();
    if (!goals.length) {
      goalList.appendChild(el('p', 'modal-hint', 'Add goals and check them off yourself. A watched listing that disappears only sends an alert; it does not mean you bought it.'));
    }
    goals.forEach((goal) => {
      const li = el('label', 'bs-goal' + (goal.done ? ' done' : ''));
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = !!goal.done;
      check.addEventListener('change', async () => {
        const next = liveCollection();
        if (!next) return;
        const liveGoals = Array.isArray(next.goals) ? next.goals : [];
        const target = liveGoals.find((entry) => entry.id === goal.id);
        if (target) target.done = check.checked;
        const response = await send('ptc:collection:update', { id: collectionId, patch: { goals: liveGoals } });
        if (response.ok) await refreshAll();
        renderDynamic();
      });
      const span = el('span', '', goal.name);
      const baseMatch = /\[([^\]]+)\]\s*$/.exec(goal.name || '');
      if (baseMatch) {
        const search = el('button', 'bs-goal-search', 'Search');
        search.type = 'button';
        search.title = 'Search this base type on the trade site';
        search.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openTradeSearch(baseMatch[1], current.game, current.league || '', {});
        });
        span.appendChild(search);
      }
      const del = el('button', 'bs-goal-del', '\u00d7');
      del.type = 'button';
      del.title = 'Remove goal';
      del.addEventListener('click', async () => {
        const next = liveCollection();
        if (!next) return;
        const nextGoals = (Array.isArray(next.goals) ? next.goals : []).filter((entry) => entry.id !== goal.id);
        const response = await send('ptc:collection:update', { id: collectionId, patch: { goals: nextGoals } });
        if (response.ok) await refreshAll();
        renderDynamic();
      });
      li.append(check, span, del);
      goalList.appendChild(li);
    });
  }

  addBtn.addEventListener('click', async () => {
    const value = addInput.value.trim();
    if (!value) return;
    const current = liveCollection();
    if (!current) return;
    const liveGoals = Array.isArray(current.goals) ? current.goals : [];
    if (liveGoals.length >= 50) {
      toast('Too many goals (max 50).', true);
      return;
    }
    liveGoals.push({ id: 'gl-' + Date.now().toString(36), name: value, done: false });
    addInput.value = '';
    const response = await send('ptc:collection:update', { id: collectionId, patch: { goals: liveGoals } });
    if (response.ok) await refreshAll();
    renderDynamic();
  });
  addInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addBtn.click();
    }
  });

  renderDynamic();
  showModal('Build sheet', wrap);
}

/* ------------------------------- watchers -------------------------------- */

function watcherSearchUrl(entry) {
  const game = recordGame(entry);
  const stored = entry.searchUrl ? parseTradeUrl(entry.searchUrl) : null;
  const league = (stored && stored.league) || entry.league;
  const queryId = (stored && stored.queryId) || entry.queryId;
  return buildTradeUrl(game, league, queryId, !!entry.live);
}

/* Both interval selects (the panel header and the settings form) are built from
   the schema, so a new value is one edit in ptc-settings.js. */
function fillIntervalOptions() {
  const minutes = (globalThis.PTC_SETTINGS && globalThis.PTC_SETTINGS.WATCH_INTERVALS) || [1, 2, 5, 10, 15, 30, 60];
  document.querySelectorAll('select[name="watcherInterval"], #watcherInterval').forEach((select) => {
    if (select.dataset.schema === '1') return;
    const current = select.value;
    select.replaceChildren();
    minutes.forEach((value) => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = value === 1 ? '1 minute' : value + ' minutes';
      select.appendChild(option);
    });
    select.dataset.schema = '1';
    if (current) select.value = current;
  });
}

function updateWatcherHint() {
  if (!watcherHint) return;
  const minutes = Number(state.settings.watcherInterval) || 5;
  watcherHint.textContent = 'Checked every ' + minutes + (minutes === 1 ? ' minute' : ' minutes')
    + ', up to 20 listings per check, oldest first: the extension asks the trade site whether the price changed,'
    + ' the listing sold, or your target price was reached. Watched searches left from older versions run at most every 15 minutes.';
}

function renderWatchers() {
  const watched = gameWatched();
  fillAlertChannels();
  updateWatcherHint();
  watcherCount.textContent = watched.length === 1 ? '1 watcher' : watched.length + ' watchers';
  watcherInterval.value = String(state.settings.watcherInterval);
  watcherList.replaceChildren();
  if (!watched.length) {
    watcherEmpty.classList.remove('hidden');
    return;
  }
  watcherEmpty.classList.add('hidden');
  const sorted = watched.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  sorted.forEach((entry) => watcherList.appendChild(watcherCard(entry)));
}

function watcherCard(entry) {
  const card = el('div', 'watcher status-' + (entry.status || 'unknown'));
  card.draggable = true;
  card.tabIndex = 0;
  card.title = 'Drag to reorder watchers (or press Alt+ArrowUp / Alt+ArrowDown)';
  card.addEventListener('keydown', (event) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    moveWatcher(entry.id, event.key === 'ArrowUp' ? -1 : 1);
  });
  card.addEventListener('dragstart', (event) => {
    state.watchDrag = entry.id;
    event.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => { state.watchDrag = null; });
  card.addEventListener('dragover', (event) => {
    if (!state.watchDrag || state.watchDrag === entry.id) return;
    event.preventDefault();
    card.classList.add('drop-target');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
  card.addEventListener('drop', (event) => {
    event.preventDefault();
    card.classList.remove('drop-target');
    reorderWatchers(state.watchDrag, entry.id);
  });
  const icon = el('div', 'watcher-icon');
  addIcon(icon, { icon: entry.icon, item: entry.item });
  card.appendChild(icon);

  const body = el('div', 'watcher-body');
  const head = el('div', 'watcher-head');
  head.appendChild(el('span', 'watcher-name', entry.name || 'Watched item'));
  head.appendChild(el('span', 'watcher-status', entry.status || 'unknown'));
  body.appendChild(head);

  const tags = el('div', 'card-tags');
  if (entry.priceText) tags.appendChild(el('span', 'tag price', entry.priceText));
  if (entry.previousPriceText && entry.priceText && entry.previousPriceText !== entry.priceText
    && (entry.status === 'price-changed' || entry.status === 'target-reached')) {
    tags.appendChild(el('span', 'tag price-change', entry.previousPriceText + ' → ' + entry.priceText));
  }
  if (entry.targetPrice != null) {
    tags.appendChild(el('span', 'tag target', 'target ' + entry.targetPrice + ' ' + (entry.targetCurrency || entry.priceCurrency || '')));
  }
  tags.appendChild(el('span', 'tag game', gameLabel(recordGame(entry))));
  if (entry.league) tags.appendChild(el('span', 'tag', entry.league));
  if (entry.ign) tags.appendChild(el('span', 'tag', 'IGN ' + entry.ign));
  if (entry.expiresAt) tags.appendChild(el('span', 'tag expires', 'expires ' + timeUntil(entry.expiresAt)));
  if (!entry.enabled && entry.status !== 'expired') tags.appendChild(el('span', 'tag', 'paused'));
  if (tags.childElementCount) body.appendChild(tags);

  const meta = el('div', 'watcher-meta');
  meta.appendChild(el('span', '', entry.lastChecked ? 'checked ' + timeAgo(entry.lastChecked) : 'not checked yet'));
  if (entry.account) meta.appendChild(el('span', '', entry.account));
  if (entry.stash && entry.stash.tab) {
    const pos = entry.stash.x != null && entry.stash.y != null
      ? ' (' + entry.stash.x + ', ' + entry.stash.y + ')'
      : '';
    meta.appendChild(el('span', '', 'stash: ' + entry.stash.tab + pos));
  }
  body.appendChild(meta);

  const actions = el('div', 'watcher-actions');
  const url = watcherSearchUrl(entry);
  if (url) {
    /* The row's actions are small buttons; a search that opens in a tab is the
       same size, or it sits lower than its neighbours. */
    const search = el('a', 'mini-btn', 'Search');
    search.href = url;
    search.target = '_blank';
    search.rel = 'noopener noreferrer';
    search.title = 'Open this search on the trade site';
    actions.appendChild(search);
  }
  const targetBtn = el('button', 'mini-btn', 'Target');
  targetBtn.type = 'button';
  targetBtn.addEventListener('click', () => openWatcherTargetModal(entry));
  actions.appendChild(targetBtn);
  const toggle = el('button', 'mini-btn', entry.enabled ? 'Pause' : 'Resume');
  toggle.type = 'button';
  toggle.addEventListener('click', async () => {
    const response = await send('ptc:watch:update', { id: entry.id, patch: { enabled: !entry.enabled } });
    if (!response.ok) toast(response.error || 'Could not update the watcher.', true);
    await refreshAll();
    renderWatchers();
  });
  actions.appendChild(toggle);
  const remove = el('button', 'mini-btn danger', 'Remove');
  remove.type = 'button';
  remove.addEventListener('click', async () => {
    if (!confirm('Stop watching "' + (entry.name || 'this item') + '"?')) return;
    const response = await send('ptc:watch:remove', { id: entry.id });
    if (!response.ok) toast(response.error || 'Could not remove the watcher.', true);
    await refreshAll();
    renderWatchers();
  });
  actions.appendChild(remove);
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

function openWatcherTargetModal(entry) {
  const form = el('form', 'modal-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const elements = form.elements;
    const rawPrice = Number.parseFloat(elements.targetPrice.value);
    const patch = {
      targetPrice: (Number.isFinite(rawPrice) && rawPrice > 0) ? Math.round(rawPrice * 100) / 100 : null,
      targetCurrency: String(elements.targetCurrency.value || '').trim(),
    };
    const span = Number(elements.expire.value);
    patch.expiresAt = span > 0 ? Date.now() + span * 60000 : null;
    const response = await send('ptc:watch:update', { id: entry.id, patch });
    if (!response.ok) {
      toast(response.error || 'Could not update the watcher.', true);
      return;
    }
    closeModal();
    toast('Watcher updated.');
    await refreshAll();
    renderWatchers();
  });

  const priceRow = el('div', 'modal-grid-2');
  const priceField = el('label', 'field');
  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.min = '0';
  priceInput.step = '0.01';
  /* The submit handler reads form.elements.targetPrice, so the control needs a
     name: without one the lookup is undefined and saving a target throws. */
  priceInput.name = 'targetPrice';
  priceInput.placeholder = entry.priceAmount != null ? String(entry.priceAmount) : 'e.g. 25';
  priceInput.value = entry.targetPrice != null ? String(entry.targetPrice) : '';
  priceField.append('Target price', priceInput);
  const curField = el('label', 'field');
  const curInput = document.createElement('input');
  curInput.type = 'text';
  curInput.name = 'targetCurrency';
  curInput.placeholder = entry.priceCurrency || 'divine';
  curInput.value = entry.targetCurrency || entry.priceCurrency || '';
  curField.append('Target currency', curInput);
  priceRow.append(priceField, curField);
  form.appendChild(priceRow);

  const expireField = el('label', 'field');
  const expireSelect = document.createElement('select');
  expireSelect.name = 'expire';
  const currentMs = entry.expiresAt ? Math.max(0, Math.round((entry.expiresAt - Date.now()) / 60000)) : 0;
  const options = [
    ['0', 'No expiry'],
    ['60', '1 hour'],
    ['1440', '1 day'],
    ['4320', '3 days'],
    ['10080', '7 days'],
  ];
  options.forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    expireSelect.appendChild(opt);
  });
  expireSelect.value = '0';
  if (currentMs > 0) {
    let best = '0';
    let bestDiff = Infinity;
    options.forEach(([value]) => {
      const diff = Math.abs(Number(value) - currentMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = value;
      }
    });
    expireSelect.value = best;
  }
  expireField.append('Stop watching after', expireSelect);
  form.appendChild(expireField);

  if (entry.targetPrice != null || entry.expiresAt) {
    const hint = el('p', 'modal-hint');
    const parts = [];
    if (entry.targetPrice != null) {
      parts.push('Alerts when the price reaches ' + entry.targetPrice + ' ' + (entry.targetCurrency || entry.priceCurrency || ''));
    }
    if (entry.expiresAt) parts.push('Auto-pauses ' + timeUntil(entry.expiresAt));
    if (entry.targetReached) parts.push('Target already reached.');
    hint.textContent = parts.join(' · ');
    form.appendChild(hint);
  }

  const actions = el('div', 'button-row');
  const save = el('button', 'primary-btn', 'Save');
  save.type = 'submit';
  const cancel = el('button', 'ghost-btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', closeModal);
  actions.append(save, cancel);
  form.appendChild(actions);

  showModal('Target & expiry - ' + (entry.name || 'watched item'), form);
}

async function moveWatcher(watcherId, direction) {
  const sorted = state.watched.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const ids = sorted.map((entry) => entry.id);
  const from = ids.indexOf(watcherId);
  if (from < 0) return;
  const to = from + direction;
  if (to < 0 || to >= ids.length) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  const response = await send('ptc:watch:reorder', { ids });
  if (!response || !response.ok) {
    toast((response && response.error) || 'Could not reorder the watchers.', true);
    return;
  }
  await refreshAll();
  renderWatchers();
  const cards = Array.from(watcherList.querySelectorAll('.watcher'));
  const index = ids.indexOf(watcherId);
  if (cards[index] && typeof cards[index].focus === 'function') cards[index].focus();
}

async function reorderWatchers(dragId, targetId) {
  state.watchDrag = null;
  if (!dragId || !targetId || dragId === targetId) return;
  const sorted = state.watched.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const ids = sorted.map((entry) => entry.id);
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  const response = await send('ptc:watch:reorder', { ids });
  if (!response || !response.ok) {
    toast((response && response.error) || 'Could not reorder the watchers.', true);
    return;
  }
  await refreshAll();
  renderWatchers();
}

/* -------------------------------- searches ------------------------------- */



async function openPreset(preset) {
  const url = preset.url || buildTradeUrl(preset.game, preset.league, preset.queryId, false);
  if (!url) {
    toast('This filter has no search link.', true);
    return;
  }
  openInTradeTab(preset.game, url, true);
}



/* ------------------------------ leagues -------------------------------- */

async function loadLeagues(force) {
  const response = await send('ptc:leagues:get', { game: activeGame(), force: !!force });
  if (!response.ok || !Array.isArray(response.leagues)) return [];
  state.leagues = response.leagues;
  fillLeagueSelect();
  fillLeagueQuick();
  return state.leagues;
}

function fillLeagueSelect() {
  if (!leagueSelect) return;
  const previous = leagueSelect.value;
  leagueSelect.replaceChildren();
  leagueSelect.appendChild(optionEl('', 'Detect automatically'));
  const prefs = activeLeaguePrefs();
  const hardcore = prefs.hardcore;
  const list = state.leagues.filter((entry) => !!entry.hardcore === hardcore);
  const pool = list.length ? list : state.leagues;
  pool.forEach((entry) => {
    leagueSelect.appendChild(optionEl(entry.id, entry.text || entry.id));
  });
  const wanted = prefs.league || previous;
  leagueSelect.value = pool.some((entry) => entry.id === wanted) ? wanted : '';
  if (leagueHint) {
    const label = globalThis.PTC_GAMES.config(activeGame()).label;
    if (!state.leagues.length) {
      leagueHint.textContent = 'The ' + label + ' league list could not be loaded. You can still type a league in the fallback field below.';
    } else {
      const count = pool.length;
      leagueHint.textContent = count + ' ' + label + ' league' + (count === 1 ? '' : 's') + ' available'
        + (hardcore ? ' (hardcore).' : '.');
    }
  }
}

/* The league picker in the header, next to the game switcher. It edits the same
   per-game prefs as the settings field, so a league is chosen without opening
   settings. The hardcore split only exists in settings; the header shows every
   league of the game and marks the hardcore ones in place. */
function fillLeagueQuick() {
  if (!leagueQuickLabel || !leaguePopover) return;
  const prefs = activeLeaguePrefs();
  const wanted = prefs.league;
  const leagues = (state.leagues || []);
  const known = leagues.some((entry) => entry.id === wanted);

  leagueQuickLabel.textContent = wanted
    ? (known ? ((leagues.find((entry) => entry.id === wanted) || {}).text || wanted) : wanted + ' (not in list)')
    : 'Auto league';

  leaguePopover.replaceChildren();
  const rows = [{ id: '', label: 'Auto league' }].concat(leagues.map((entry) => ({
    id: entry.id,
    label: entry.hardcore ? entry.text + ' (HC)' : (entry.text || entry.id),
  })));
  if (wanted && !known) rows.push({ id: wanted, label: wanted + ' (not in list)' });

  rows.forEach((row) => {
    const button = el('button', 'league-option', row.label);
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', row.id === (wanted || '') ? 'true' : 'false');
    button.addEventListener('click', async () => {
      closeLeaguePopover();
      await setQuickLeague(row.id);
    });
    leaguePopover.appendChild(button);
  });
}

async function setQuickLeague(value) {
  const game = activeGame();
  const settings = {
    ...state.settings,
    leagueByGame: { ...state.settings.leagueByGame, [game]: value },
    leagueModeByGame: { ...state.settings.leagueModeByGame, [game]: value ? 'manual' : 'auto' },
  };
  const response = await send('ptc:settings:set', { settings });
  if (response && response.ok) {
    state.settings = normalizeSettings(response.settings);
  }
  fillLeagueSelect();
  fillLeagueQuick();
  const label = value || 'Auto league';
  toast('League for ' + globalThis.PTC_GAMES.config(game).label + ': ' + label + '.');
}

/* ------------------------------ new tabs ------------------------------- */



/*
 * Watching a search means the extension re-runs that exact query on the trade
 * site on every check and reports the listings it has not seen before. A
 * budget in divine orbs turns it into a price alert. No trade tab is needed:
 * the query travels in the search link itself.
 */

/* ------------------------------------------------------------------ */
/* Crafting cost                                                       */
/* ------------------------------------------------------------------ */

async function openCraftCost(rec) {
  const prices = state.prices[priceKey(rec)];
  const response = await send('ptc:craft:cost', {
    record: {
      id: rec.id,
      item: rec.item,
      priceText: rec.priceText,
      priceAmount: rec.priceAmount,
      priceCurrency: rec.priceCurrency,
      priceValue: priceValue(rec, prices),
    },
    league: rec.league,
  });
  if (!response || !response.ok) {
    toast((response && response.error) || 'Could not estimate the crafting cost.', true);
    return;
  }
  const box = el('div', 'craft-sheet');
  box.appendChild(el('h3', '', response.base || 'Item'));

  const rows = el('div', 'craft-rows');
  const addRow = (label, value, note) => {
    const row = el('div', 'craft-row');
    row.appendChild(el('span', 'craft-label', label));
    row.appendChild(el('span', 'craft-value', value));
    if (note) row.appendChild(el('span', 'craft-note', note));
    rows.appendChild(row);
  };
  addRow('Base', response.baseCost != null ? response.baseCost.toFixed(3) + ' div' : 'unknown',
    response.baseCost != null ? 'median of the listings you saw' : 'no market price known for this base yet');
  addRow('Modifiers', response.modCost.toFixed(3) + ' div', response.rolls.length + ' crafted modifier(s)');
  if (response.total != null) {
    addRow('Total', response.total.toFixed(3) + ' div', 'base + modifiers');
  }
  box.appendChild(rows);

  if (response.rolls.length) {
    const list = el('ul', 'craft-rolls');
    response.rolls.forEach((roll) => {
      const item = el('li');
      item.appendChild(el('span', 'craft-affix', roll.affix || roll.text));
      item.appendChild(el('span', 'craft-tier', 'T' + roll.tier + ' · ' + roll.currency + ' · ' + roll.cost.toFixed(3)));
      list.appendChild(item);
    });
    box.appendChild(list);
  }

  if (response.cheaperToCraft != null) {
    const verdict = el('p', 'craft-verdict ' + (response.cheaperToCraft ? 'good' : 'bad'));
    verdict.textContent = response.cheaperToCraft
      ? 'Crafting it yourself is cheaper than buying it for ' + response.price.toFixed(3) + ' div.'
      : 'Buying this listing is cheaper than crafting it yourself.';
    box.appendChild(verdict);
  }

  box.appendChild(el('p', 'hint', 'The estimate uses the Craft of Exile affix tiers and live poe.ninja currency prices. It is an approximation: the cheapest roll is not always available.'));
  showModal('Crafting cost', box);
}

/* -------------------------------- settings ------------------------------ */

function fillSettingsForm() {
  const form = settingsForm.elements;
  form.textSize.value = state.settings.textSize;
  if (form.theme) form.theme.value = state.settings.theme;
  form.fallbackLeague.value = state.settings.fallbackLeague[activeGame()] || '';
  form.priceDisplay.value = state.settings.priceDisplay;
  form.showConversions.checked = !!state.settings.showConversions;
  form.showIgn.checked = !!state.settings.showIgn;
  form.highlightStats.checked = !!state.settings.highlightStats;
  form.showWikiLinks.checked = !!state.settings.showWikiLinks;
  form.coeIncludeDesecrated.checked = state.settings.coeIncludeDesecrated !== false;
  form.modDomainLabels.checked = state.settings.modDomainLabels !== false;
  form.searchFilterEnabled.checked = state.settings.searchFilterEnabled !== false;
  form.priceIndexEnabled.checked = state.settings.priceIndexEnabled !== false;
  form.scamDetectionEnabled.checked = state.settings.scamDetectionEnabled !== false;
  const leaguePrefs = activeLeaguePrefs();
  form.hardcore.checked = leaguePrefs.hardcore;
  if (form.league) form.league.value = leaguePrefs.league;
  form.blacklistEnabled.checked = !!state.settings.blacklistEnabled;
  form.blacklist.value = (state.settings.blacklist || []).join('\n');
  form.valueSortPage.checked = !!state.settings.valueSortPage;
  form.sellerAlertsEnabled.checked = state.settings.sellerAlertsEnabled !== false;
  form.sellerAlerts.value = state.settings.sellerAlerts || '';
  form.discordWebhook.value = state.settings.discordWebhook || '';
  form.ntfyUrl.value = state.settings.ntfyUrl || '';
  form.watcherInterval.value = String(state.settings.watcherInterval);
  form.watcherNotifications.checked = !!state.settings.watcherNotifications;
  if (form.watcherSound) form.watcherSound.checked = state.settings.watcherSound !== false;
  form.syncEnabled.checked = !!state.settings.syncEnabled;
}

/* What browser sync actually holds for this extension, read from its own meta. */
async function refreshSyncStatus() {
  const node = $('syncStatus');
  if (!node) return;
  if (!state.settings.syncEnabled) {
    node.textContent = 'Browser sync is off.';
    return;
  }
  try {
    const stored = await chrome.storage.sync.get('ptcSyncMeta');
    const meta = stored && stored.ptcSyncMeta;
    if (!meta || !meta.at) {
      node.textContent = 'Nothing pushed yet.';
      return;
    }
    node.textContent = 'Last pushed ' + timeAgo(meta.at) + ' · '
      + (meta.chunks === 1 ? '1 chunk' : meta.chunks + ' chunks') + ' · '
      + Math.round((Number(meta.size) || 0) / 1024) + ' KB of 100 KB.';
  } catch (error) {
    node.textContent = 'Browser sync is not available.';
  }
}

function renderSettings() {
  fillSettingsForm();
  settingsStatus.textContent = '';
  refreshSyncStatus();
}

function collectSettings() {
  const form = settingsForm.elements;
  const game = activeGame();
  const leagueValue = form.league ? form.league.value : activeLeaguePrefs().league;
  return {
    ...state.settings,
    textSize: form.textSize.value,
    theme: form.theme ? form.theme.value : state.settings.theme,
    fallbackLeague: {
      ...state.settings.fallbackLeague,
      [game]: form.fallbackLeague.value.trim(),
    },
    priceDisplay: form.priceDisplay.value,
    showConversions: form.showConversions.checked,
    showIgn: form.showIgn.checked,
    highlightStats: form.highlightStats.checked,
    showWikiLinks: form.showWikiLinks.checked,
    coeIncludeDesecrated: form.coeIncludeDesecrated.checked,
    modDomainLabels: form.modDomainLabels.checked,
    searchFilterEnabled: form.searchFilterEnabled.checked,
    priceIndexEnabled: form.priceIndexEnabled.checked,
    scamDetectionEnabled: form.scamDetectionEnabled.checked,
    leagueByGame: { ...state.settings.leagueByGame, [game]: leagueValue },
    hardcoreByGame: { ...state.settings.hardcoreByGame, [game]: form.hardcore.checked },
    leagueModeByGame: { ...state.settings.leagueModeByGame, [game]: leagueValue ? 'manual' : 'auto' },
    blacklistEnabled: form.blacklistEnabled.checked,
    blacklist: form.blacklist.value.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean),
    valueSortPage: form.valueSortPage.checked,
    sellerAlertsEnabled: form.sellerAlertsEnabled.checked,
    sellerAlerts: form.sellerAlerts.value,
    discordWebhook: form.discordWebhook.value.trim(),
    ntfyUrl: form.ntfyUrl.value.trim(),
    watcherInterval: Number(form.watcherInterval.value) || 5,
    watcherNotifications: form.watcherNotifications.checked,
    watcherSound: form.watcherSound ? form.watcherSound.checked : true,
    syncEnabled: form.syncEnabled.checked,
  };
}

/* The same rule the worker applies: a bare topic, or an https address whose
   last path segment is a topic. Self-hosted ntfy is allowed. */
/* A self-hosted ntfy server is contacted directly; without broad host
   permissions that only works when the server answers with CORS headers, so a
   failed test has to say so instead of looking like a broken address. */
function ntfyCorsNote(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const host = /^https?:\/\//i.test(raw) ? new URL(raw).hostname.toLowerCase() : 'ntfy.sh';
    return host === 'ntfy.sh' ? '' : ' (a self-hosted server must send CORS headers)';
  } catch (error) {
    return '';
  }
}

function looksLikeNtfy(value) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  if (/^[A-Za-z0-9_-]{1,64}$/.test(raw)) return true;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length >= 1 && /^[A-Za-z0-9_-]{1,64}$/.test(segments[segments.length - 1]);
  } catch (error) {
    return false;
  }
}

async function saveSettings(event) {
  if (event) event.preventDefault();
  const values = collectSettings();
  /* A refused permission is the reason alerts never arrive, so it is collected
     and shown after the save: setting the status now and then writing "Saved."
     over it told the player everything was fine. */
  const warnings = [];
  if (String(values.discordWebhook || '').trim() && !hasDiscordWebhook(values.discordWebhook)) {
    warnings.push('That is not a Discord webhook address.');
  } else if (hasDiscordWebhook(values.discordWebhook)) {
    const granted = await ensureDiscordPermission();
    if (!granted) warnings.push('Discord alerts need access to discord.com: allow it, then save again.');
  }
  if (String(values.ntfyUrl || '').trim()) {
    if (!looksLikeNtfy(values.ntfyUrl)) {
      warnings.push('The ntfy address must be an https:// URL (any ntfy server) or a topic name.');
    } else {
      const granted = await ensureNtfyPermission(values.ntfyUrl);
      if (!granted) warnings.push('Alerts to ntfy.sh need access to ntfy.sh: allow it, then save again.');
    }
  }
  const response = await send('ptc:settings:set', { settings: values });
  if (!response.ok) {
    settingsStatus.textContent = response.error || 'Could not save.';
    return;
  }
  state.settings = normalizeSettings(response.settings);
  applyTextSize();
  applyTheme();
  renderSettings();
  fillLeagueQuick();
  settingsStatus.textContent = warnings.length ? warnings.join(' ') : 'Saved.';
  toast(warnings.length ? 'Saved, but an alert channel is not allowed yet.' : 'Settings saved.', warnings.length > 0);
}

async function setWatcherInterval(value) {
  const settings = { ...state.settings, watcherInterval: Number(value) || 5 };
  const response = await send('ptc:settings:set', { settings });
  if (response.ok) {
    state.settings = normalizeSettings(response.settings);
    updateWatcherHint();
    toast('Watcher interval updated.');
  }
}

async function downloadBackup() {
  const response = await send('ptc:backup');
  if (!response.ok || !response.data) {
    toast(response.error || 'Could not build the backup.', true);
    return;
  }
  downloadJson(response.data, 'poe-trade-collection-' + new Date().toISOString().slice(0, 10) + '.json');
  toast('Backup downloaded.');
}

async function pushSync() {
  const response = await send('ptc:sync:push');
  toast(response.ok ? 'Bookmarks pushed to your browser account.' : (response.error || 'Sync push failed.'), !response.ok);
  refreshSyncStatus();
}

async function pullSync() {
  const response = await send('ptc:sync:pull');
  if (!response.ok) {
    toast(response.error || 'Sync pull failed.', true);
    return;
  }
  toast('Pulled ' + (response.bookmarks || 0) + ' bookmarks.');
  await refreshAll();
  refreshSyncStatus();
}

async function restoreBackupFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (error) {
    toast('The backup file is not valid JSON.', true);
    return;
  }
  if (!confirm('Restore this backup? Current items, bookmarks, watchers and settings will be replaced.')) return;
  const response = await send('ptc:restore', { data });
  if (!response.ok) {
    toast(response.error || 'Restore failed.', true);
    return;
  }
  toast('Backup restored.');
  await refreshAll();
  setTab('items');
}

/* -------------------------------- helpers ------------------------------- */

function tradeTabPatterns(game) {
  return [globalThis.PTC_GAMES.config(game).tabPattern];
}

function openInNewTab(url, background) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.create({ url, active: !background }, (tab) => resolve(tab && tab.id));
    } catch (error) {
      resolve(null);
    }
  });
}

function openInTradeTab(game, url, active) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ url: tradeTabPatterns(game) }, (tabs) => {
        if (chrome.runtime.lastError || !Array.isArray(tabs) || !tabs.length) {
          openInNewTab(url, !active).then(resolve);
          return;
        }
        const tab = tabs.find((entry) => entry.active) || tabs[0];
        chrome.tabs.update(tab.id, { url, active: !!active }, () => resolve(tab.id));
      });
    } catch (error) {
      openInNewTab(url, !active).then(resolve);
    }
  });
}

/* The Watchers tab carries the alert channels too: they are what the alerts use,
   and asking a player to hunt for them in Settings was the wrong place. The
   Settings form keeps the same two fields; both write the same settings, and
   each side refills from state when its tab is shown. */
function fillAlertChannels() {
  if (!alertChannelsForm) return;
  const channels = [];
  if (hasDiscordWebhook(state.settings.discordWebhook)) channels.push('Discord');
  if (String(state.settings.ntfyUrl || '').trim()) channels.push('ntfy');
  if (alertChannelsSummary) alertChannelsSummary.textContent = channels.length ? channels.join(' + ') : 'Not set';
  if (alertChannelsBlock && !state.alertChannelsTouched) alertChannelsBlock.open = channels.length === 0;
  if (alertChannelsForm.contains(document.activeElement)) return;
  alertChannelsForm.discordWebhook.value = state.settings.discordWebhook || '';
  alertChannelsForm.ntfyUrl.value = state.settings.ntfyUrl || '';
}

async function saveAlertChannels(options) {
  if (!alertChannelsForm) return false;
  const silent = !!(options && options.silent);
  const discord = String(alertChannelsForm.discordWebhook.value || '').trim();
  const ntfy = String(alertChannelsForm.ntfyUrl.value || '').trim();
  const say = (text) => { if (alertChannelsStatus) alertChannelsStatus.textContent = text; };
  if (discord && !hasDiscordWebhook(discord)) {
    say('That is not a Discord webhook address.');
    toast('That is not a Discord webhook address.', true);
    return false;
  }
  if (ntfy && !looksLikeNtfy(ntfy)) {
    say('The ntfy address must be an https:// URL (any ntfy server) or a topic name.');
    toast('The ntfy address must be an https:// URL (any ntfy server) or a topic name.', true);
    return false;
  }
  if (discord) {
    const granted = await ensureDiscordPermission();
    if (!granted) {
      say('Discord alerts need access to discord.com.');
      toast('Allow access to discord.com to send Discord alerts.', true);
      return false;
    }
  }
  if (ntfy) {
    const granted = await ensureNtfyPermission(ntfy);
    if (!granted) {
      say('Alerts to ntfy.sh need access to ntfy.sh.');
      toast('Allow access to ntfy.sh to send alerts to ntfy.sh.', true);
      return false;
    }
  }
  const response = await send('ptc:settings:set', {
    settings: { ...state.settings, discordWebhook: discord, ntfyUrl: ntfy },
  }).catch(() => null);
  if (!response || !response.ok) {
    say((response && response.error) || 'Could not save the alert channels.');
    return false;
  }
  state.settings = normalizeSettings(response.settings);
  say('');
  if (!silent) toast('Alert channels saved.');
  return true;
}

async function testAlertChannels() {
  if (!(await saveAlertChannels({ silent: true }))) return;
  if (alertChannelsStatus) alertChannelsStatus.textContent = 'Sending test...';
  const result = await send('ptc:webhook:test').catch(() => null);
  const channels = result && result.ok && Array.isArray(result.channels) ? result.channels : [];
  if (channels.length) {
    if (alertChannelsStatus) alertChannelsStatus.textContent = 'Test sent to ' + channels.join(' + ') + '.';
    toast('Test sent to ' + channels.join(' + ') + '.');
    return;
  }
  const problems = [];
  if (result && result.discord && result.discord.configured && !result.discord.ok) problems.push('Discord: ' + result.discord.error);
  if (result && result.ntfy && result.ntfy.configured && !result.ntfy.ok) {
    problems.push('ntfy: ' + result.ntfy.error + ntfyCorsNote(alertChannelsForm && alertChannelsForm.ntfyUrl.value));
  }
  const message = problems.length ? problems.join(' · ') : 'Add a Discord webhook or ntfy topic first.';
  if (alertChannelsStatus) alertChannelsStatus.textContent = message;
  toast(message, true);
}

async function checkWatchersNow() {
  const button = $('checkWatchersBtn');
  button.disabled = true;
  button.textContent = 'Checking...';
  /* One button for both kinds of alert: the player does not care which message
     goes where, they want the panel to be up to date. */
  const listing = await send('ptc:watch:check');
  const searches = await send('ptc:searchwatch:check', { force: true });
  button.disabled = false;
  button.textContent = 'Check now';
  const listingsChecked = listing && typeof listing.checked === 'number' ? listing.checked : 0;
  const searchesChecked = searches && typeof searches.checked === 'number' ? searches.checked : 0;
  const fresh = (listing && listing.checked ? 0 : 0) + (searches && searches.notified ? searches.notified : 0);
  if (!listingsChecked && !searchesChecked) {
    toast((listing && listing.error) || (searches && searches.error) || 'Nothing to check yet.', true);
  } else {
    toast('Checked ' + listingsChecked + ' listing(s) and ' + searchesChecked + ' search(es)'
      + (fresh ? ', ' + fresh + ' new one(s).' : '.'));
  }
  await refreshAll();
  renderWatchers();
}


async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (error) {
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (fallbackError) {
      return false;
    }
  }
}

function sanitizeFilename(value) {
  return String(value || 'item')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'item';
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function deleteItem(id) {
  const response = await send('ptc:delete', { id });
  if (!response.ok) throw new Error('delete failed');
}

async function clearAllItems() {
  const response = await send('ptc:clear', { game: activeGame(), keepImported: true });
  if (!response.ok) throw new Error('delete failed');
}

async function refreshAll() {
  let data;
  try {
    data = await chrome.storage.local.get({
      savedItems: [],
      collections: [],
      bookmarkFolders: [],
      bookmarks: [],
      multiLive: [],
      watchedItems: [],
      searchHistory: [],
      ptcSettings: {},
      ptcPresets: [],
      ptcPriceIndex: {},
      ptcSearchWatches: [],
      activeTrade: null,
    });
  } catch (error) {
    return;
  }
  state.items = Array.isArray(data.savedItems) ? data.savedItems : [];
  state.collections = Array.isArray(data.collections) ? data.collections : [];
  state.folders = Array.isArray(data.bookmarkFolders) ? data.bookmarkFolders : [];
  state.bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  state.multiLive = Array.isArray(data.multiLive) ? data.multiLive : [];
  state.watched = Array.isArray(data.watchedItems) ? data.watchedItems : [];
  state.history = Array.isArray(data.searchHistory) ? data.searchHistory : [];
  state.presets = Array.isArray(data.ptcPresets) ? data.ptcPresets : [];
  state.searchWatches = Array.isArray(data.ptcSearchWatches) ? data.ptcSearchWatches : [];
  state.activeTrade = data.activeTrade || null;
  state.settings = normalizeSettings(data.ptcSettings);
  rebuildPriceIndex();
  applyTextSize();
  applyTheme();
  syncGameSelect();
  updateBadges();
  checkStorageLimits();
}

/*
 * The local market index: every saved item contributes its price so that the
 * panel can tell a fair price from a suspiciously cheap one.
 */
function rebuildPriceIndex() {
  const summary = new Map();
  if (!globalThis.PTC_FEATURES) {
    state.priceIndex = summary;
    return;
  }
  const rows = state.items.map((rec) => {
    const prices = state.prices[priceKey(rec)];
    const value = priceValue(rec, prices);
    return { rec, value };
  });
  const grouped = new Map();
  rows.forEach((row) => {
    if (!isFinite(row.value) || row.value <= 0) return;
    const key = globalThis.PTC_FEATURES.indexKey(row.rec);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row.value);
  });
  grouped.forEach((values, key) => {
    summary.set(key, {
      count: values.length,
      median: globalThis.PTC_FEATURES.median(values),
      min: Math.min.apply(null, values),
      max: Math.max.apply(null, values),
    });
  });
  state.priceIndex = summary;
}

function checkStorageLimits() {
  const warnings = [];
  if (state.items.length >= 1900) warnings.push('You are close to the 2000 item limit.');
  if (state.watched.length >= 280) warnings.push('You are close to the 300 watcher limit.');
  if (state.collections.length >= 190) warnings.push('You are close to the 200 build limit.');
  if (warnings.length) {
    state.limitWarning = warnings.join(' ');
    if (state.tab === 'items') showLimitWarning();
  } else {
    state.limitWarning = '';
    hideLimitWarning();
  }
}

let limitWarningNode = null;

function showLimitWarning() {
  if (!state.limitWarning) return;
  if (!limitWarningNode) {
    limitWarningNode = el('div', 'limit-warning');
    limitWarningNode.id = 'limitWarning';
  }
  limitWarningNode.textContent = state.limitWarning;
  const controls = $('controls');
  if (controls && limitWarningNode.parentElement !== controls) controls.appendChild(limitWarningNode);
}

function hideLimitWarning() {
  if (limitWarningNode && limitWarningNode.parentElement) limitWarningNode.remove();
}

function updateBadges() {
  /* One badge for the tab: how many things are being watched right now, of
     either kind. */
  const count = gameWatched().filter((entry) => entry.enabled).length;
  if (alertsBadge) {
    alertsBadge.textContent = String(count);
    alertsBadge.classList.toggle('hidden', count === 0);
  }
  document.title = 'Poe Trade Watcher';
  updateSavedCount();
}

/* -------------------------------- events -------------------------------- */

let busyDetail = false;
let settingsReturnTab = 'items';

function bindEvents() {
  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) setTab(button.dataset.tab);
  });
  $('openSettingsBtn').addEventListener('click', () => {
    if (state.tab === 'settings') {
      setTab(views[settingsReturnTab] ? settingsReturnTab : 'items');
    } else {
      settingsReturnTab = state.tab;
      setTab('settings');
    }
  });
  if (gameSwitch) {
    gameSwitch.addEventListener('click', (event) => {
      const button = event.target.closest('[data-game]');
      if (button) switchGame(button.dataset.game);
    });
  }
  if (leagueQuickBtn) {
    leagueQuickBtn.addEventListener('click', () => {
      if (leaguePopover && leaguePopover.hidden) openLeaguePopover();
      else closeLeaguePopover();
    });
  }
  if (leaguePopover) {
    leaguePopover.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeLeaguePopover();
        if (leagueQuickBtn) leagueQuickBtn.focus();
      }
    });
  }
  document.addEventListener('click', (event) => {
    if (!leaguePopover || leaguePopover.hidden) return;
    if (event.target.closest('#leaguePopover') || event.target.closest('#leagueQuickBtn')) return;
    closeLeaguePopover();
  });
  if (leagueSelect) {
    leagueSelect.addEventListener('change', () => {
      const game = activeGame();
      state.settings.leagueByGame = { ...state.settings.leagueByGame, [game]: leagueSelect.value };
      state.settings.leagueModeByGame = { ...state.settings.leagueModeByGame, [game]: leagueSelect.value ? 'manual' : 'auto' };
    });
  }
  if (state.settings && settingsForm.elements.hardcore) {
    settingsForm.elements.hardcore.addEventListener('change', (event) => {
      const game = activeGame();
      state.settings.hardcoreByGame = { ...state.settings.hardcoreByGame, [game]: event.target.checked };
      fillLeagueSelect();
    });
  }
  const refreshLeaguesBtn = $('refreshLeaguesBtn');
  if (refreshLeaguesBtn) {
    refreshLeaguesBtn.addEventListener('click', async () => {
      refreshLeaguesBtn.disabled = true;
      const leagues = await loadLeagues(true);
      refreshLeaguesBtn.disabled = false;
      toast(leagues.length ? 'League list refreshed.' : 'Could not refresh the league list.', !leagues.length);
    });
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (themePopover && themePopover.hidden) openThemePopover();
      else closeThemePopover();
    });
  }
  if (themeClose) themeClose.addEventListener('click', closeThemePopover);
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      setTheme(themeSelect.value);
    });
  }
  if (themeMedia) {
    const onSystemThemeChange = () => {
      if (state.settings.theme === 'auto') applyTheme();
    };
    if (themeMedia.addEventListener) themeMedia.addEventListener('change', onSystemThemeChange);
    else if (themeMedia.addListener) themeMedia.addListener(onSystemThemeChange);
  }
  $('coffeeBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://ko-fi.com/nr5xdev', active: true });
  });
  views.tools.addEventListener('click', (event) => {
    const card = event.target.closest('.tool-card');
    if (card && card.dataset.url) chrome.tabs.create({ url: card.dataset.url, active: true });
  });
  /* The cards are clickable boxes, so they also answer Enter and Space: a
     pointer is not the only way into a link. */
  views.tools.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.tool-card');
    if (!card || !card.dataset.url) return;
    event.preventDefault();
    chrome.tabs.create({ url: card.dataset.url, active: true });
  });

  searchInput.addEventListener('input', () => {
    state.search = searchInput.value;
    renderList();
  });
  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
    renderList();
  });
  newCollectionBtn.addEventListener('click', () => openCollectionsModal(null));

  pobParseBtn.addEventListener('click', pobParse);
  pobClearBtn.addEventListener('click', pobClearList);
  pobTargetSelect.addEventListener('change', syncPobNewName);
  pobImportBtn.addEventListener('click', pobImport);
  pobCodeArea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      pobParse();
    }
  });
  pobCodeArea.addEventListener('input', () => {
    pobClearBtn.disabled = !pobCodeArea.value.trim() && !pobParsed;
  });
  manageCollectionsBtn.addEventListener('click', () => openCollectionsModal(null));
  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  backBtn.addEventListener('click', showList);

  detailBody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled || busyDetail) return;
    const rec = state.items.find((entry) => entry.id === state.openId);
    if (!rec) return;
    const action = button.dataset.action;
    if (action === 'copy-item') {
      const ok = await copyText(itemToText(rec));
      toast(ok ? 'Item copied (in-game format).' : 'Copy failed.', !ok);
    } else if (action === 'copy-coe') {
      const ok = await copyText(coePaste(rec, { includeDesecrated: state.settings.coeIncludeDesecrated !== false }));
      toast(ok ? 'Copied in Craft of Exile import format.' : 'Copy failed.', !ok);
    } else if (action === 'export-one') {
      downloadJson({ app: 'poe-trade-collection', version: 2, exportedAt: new Date().toISOString(), collections: state.collections, items: [stripWhisperTokens(rec)] }, 'poe-item-' + sanitizeFilename(displayName(rec).name) + '.json');
      toast('Item exported as JSON.');
    } else if (action === 'delete') {
      if (!confirm('Delete this item from the collection?')) return;
      try {
        await deleteItem(rec.id);
        toast('Item deleted.');
        showList();
      } catch (error) {
        toast('Could not delete the item.', true);
      }
    } else if (action === 'watch') {
      busyDetail = true;
      const ok = await toggleWatch(rec);
      busyDetail = false;
      if (ok) {
        await refreshAll();
        renderItems();
      }
    }
  });

  restoreFile.addEventListener('change', async () => {
    const file = restoreFile.files && restoreFile.files[0];
    restoreFile.value = '';
    if (!file) return;
    try {
      await restoreBackupFile(file);
    } catch (error) {
      toast('Restore failed.', true);
    }
  });
  const clearAllSaved = async () => {
    const count = savedRecords().length;
    if (!count) {
      toast('There are no saved items to delete.', true);
      return;
    }
    if (!confirm('Delete all ' + count + ' saved items? Builds and their imported gear are kept.')) return;
    try {
      await clearAllItems();
      toast('Saved items deleted.');
      showList();
    } catch (error) {
      toast('Could not delete the saved items.', true);
    }
  };
  clearBtn.addEventListener('click', clearAllSaved);
  if (clearAllBtn) clearAllBtn.addEventListener('click', clearAllSaved);

  $('checkWatchersBtn').addEventListener('click', checkWatchersNow);
  watcherInterval.addEventListener('change', () => setWatcherInterval(watcherInterval.value));
  if (alertChannelsForm) {
    alertChannelsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      saveAlertChannels();
    });
  }
  if (watcherTestBtn) watcherTestBtn.addEventListener('click', testAlertChannels);
  if (alertChannelsBlock) {
    alertChannelsBlock.addEventListener('toggle', () => { state.alertChannelsTouched = true; });
  }
  settingsForm.addEventListener('submit', saveSettings);
  $('pushSyncBtn').addEventListener('click', pushSync);
  $('pullSyncBtn').addEventListener('click', pullSync);
  $('testWebhookBtn').addEventListener('click', async () => {
    const values = collectSettings();
    if (hasDiscordWebhook(values.discordWebhook)) {
      const granted = await ensureDiscordPermission();
      if (!granted) {
        settingsStatus.textContent = 'Discord alerts need access to discord.com. Allow it to enable the webhook.';
        toast('Allow access to discord.com to send Discord alerts.', true);
      }
    }
    await ensureNtfyPermission(values.ntfyUrl);
    const saved = await send('ptc:settings:set', { settings: values });
    if (!saved.ok) {
      settingsStatus.textContent = saved.error || 'Could not save settings.';
      return;
    }
    state.settings = normalizeSettings(saved.settings);
    settingsStatus.textContent = 'Sending test...';
    const result = await send('ptc:webhook:test');
    if (result && result.ok) {
      settingsStatus.textContent = 'Test sent to ' + result.channels.join(' + ') + '.';
      return;
    }
    const problems = [];
    if (result && result.discord && result.discord.configured && !result.discord.ok) problems.push('Discord: ' + result.discord.error);
    if (result && result.ntfy && result.ntfy.configured && !result.ntfy.ok) {
      problems.push('ntfy: ' + result.ntfy.error + ntfyCorsNote(values.ntfyUrl));
    }
    settingsStatus.textContent = problems.length
      ? problems.join(' · ')
      : 'Add a Discord webhook or ntfy topic first.';
  });
  $('privacyBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('privacy.html') });
  });
  $('backupBtn').addEventListener('click', downloadBackup);
  $('restoreBtn').addEventListener('click', () => restoreFile.click());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!modal.classList.contains('hidden')) closeModal();
      else if (state.openId) showList();
      return;
    }
    if (!modal.classList.contains('hidden')) {
      if (event.key === 'Tab') {
        const items = focusableInModal();
        if (items.length) {
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      return;
    }
    if (event.key === '/' && state.tab === 'items' && !state.openId
      && document.activeElement !== searchInput && modal.classList.contains('hidden')) {
      event.preventDefault();
      searchInput.focus();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const keys = ['savedItems', 'collections', 'bookmarkFolders', 'bookmarks', 'multiLive', 'watchedItems', 'searchHistory', 'ptcSettings'];
    if (!keys.some((key) => changes[key])) return;
    refreshAll().then(() => {
      updateBadges();
      if (state.tab === 'items') {
        if (state.openId && !state.items.some((rec) => rec.id === state.openId)) state.openId = null;
        renderItems();
      } else if (state.tab === 'builds') {
        if (state.openId) {
          const rec = state.items.find((entry) => entry.id === state.openId);
          if (rec) renderDetail(rec);
          else state.openId = null;
        }
        renderBuilds();
        paintLayout();
      } else if (state.tab === 'alerts') renderWatchers();
      else if (state.tab === 'settings' && !state.openId
        /* A watcher check writes storage every few minutes; redrawing the
           settings form under the user's hands would wipe what they are typing. */
        && !(settingsForm && settingsForm.contains(document.activeElement))) renderSettings();
    });
  });
}

/* ------------------------------------------------------------------ */
/* Opening the panel in a tab                                          */
/* ------------------------------------------------------------------ */
/* Chrome docks the panel next to the page and Firefox puts it in the sidebar;
   in both the width is the browser's to decide. On a small screen the same
   page as a normal tab is the readable option, so Firefox gets a small button
   for it. The panel is already a tab there, hence the check. */
function currentTab() {
  return new Promise((resolve) => {
    try {
      if (!chrome.tabs || typeof chrome.tabs.getCurrent !== 'function') {
        resolve(null);
        return;
      }
      const answer = (tab) => resolve(tab || null);
      const maybe = chrome.tabs.getCurrent(answer);
      if (maybe && typeof maybe.then === 'function') maybe.then(answer).catch(() => resolve(null));
    } catch (error) {
      resolve(null);
    }
  });
}

async function addOpenInTabButton() {
  if (chrome.sidePanel) return;
  if (await currentTab()) return;

  const button = document.createElement('button');
  button.id = 'openTabBtn';
  button.type = 'button';
  button.className = 'icon-btn';
  button.title = 'Open in a tab';
  button.setAttribute('aria-label', 'Open in a tab');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4H20v5.5M20 4l-7.6 7.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  button.addEventListener('click', () => {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html'), active: true });
    } catch (error) {
      /* without the tabs API there is nowhere to open it */
    }
  });

  const anchor = $('coffeeBtn');
  if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(button, anchor);
}

/* The toolbar in the trade page comes from a content script, and one that was
   missing when the page loaded stays missing until the page is reloaded.
   Opening the panel is the moment the user expects to see it, so ask the
   background to inject it into the trade tabs that do not answer its ping. It
   costs one message when the script is already there. */
function ensurePageWidget() {
  send('ptc:content:ensure').catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) ensurePageWidget();
});

async function init() {
  buildThemeControls();
  bindEvents();
  await refreshAll();
  // Picks up item artwork that an interrupted import never finished.
  send('ptc:icons:resume');
  searchInput.value = '';
  fillIntervalOptions();
  watcherInterval.value = String(state.settings.watcherInterval);
  setTab('items');
  preloadPrices();
  loadLeagues(false);
  addOpenInTabButton();
  ensurePageWidget();
}

init();
