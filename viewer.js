'use strict';

const {
  createEl: el,
  safeIconUrl: safeIcon,
  safePoeUrl: safePoeLink,
  getDisplayName: displayName,
  getRarity: rarityInfo,
  hasCrafted,
  hasFractured,
  renderItemTooltip,
  asModArray,
  buildItemText: itemToText,
  buildCoePaste: coePaste,
  buildCoeImportUrl,
  getModGroups: modGroups,
  timeAgo,
  formatDate: fullDate,
  parsePriceText,
  convertPrice,
  formatConversion,
  wikiLinks,
  coeImportSummary,
  stripWhisperTokens,
  getIgn,
  parseTradeUrl,
  savedSearchUsable,
  discordText,
} = window.PTC;

const app = document.getElementById('app');
const subtitle = document.getElementById('subtitle');
const copyItemBtn = document.getElementById('copyItemBtn');
const refreshBtn = document.getElementById('refreshBtn');
const watchBtn = document.getElementById('watchBtn');
const searchBtn = document.getElementById('searchBtn');
const toastBox = document.getElementById('toast');

let current = null;
let allCollections = [];
let watched = [];
let settings = { showWikiLinks: true, showConversions: true, priceDisplay: 'divine-exalted', theme: 'graphite' };
let prices = null;
let toastTimer = 0;

const THEME_IDS = ['auto', 'midnight', 'graphite', 'ember', 'forest', 'daylight', 'sand'];

function applyTheme(theme) {
  const chosen = THEME_IDS.includes(theme) ? theme : 'graphite';
  const resolved = chosen === 'auto'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'daylight' : 'midnight')
    : chosen;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = chosen;
}

function send(type, extra) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, ...(extra || {}) }, (response) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(response || { ok: false });
      });
    } catch (error) {
      resolve({ ok: false, error: String(error && error.message ? error.message : error) });
    }
  });
}

function toast(message, isError) {
  toastBox.textContent = message;
  toastBox.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastBox.classList.remove('show'), 2800);
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

async function copyItem(rec) {
  const ok = await copyText(itemToText(rec));
  toast(ok ? 'Item copied (in-game format).' : 'Copy failed.', !ok);
}

async function copyForTool(tool) {
  if (!current) return;
  const includeDesecrated = settings.coeIncludeDesecrated !== false;
  let body;
  if (tool === 'coe') body = coePaste(current, { includeDesecrated });
  else if (tool === 'discord') body = discordText(current);
  else body = itemToText(current);
  const ok = await copyText(body);
  const message = tool === 'coe' ? 'Copied in Craft of Exile import format.'
    : tool === 'discord' ? 'Copied for Discord.'
    : 'Copied for Path of Building.';
  toast(ok ? message : 'Copy failed.', !ok);
}

function sanitizeFilename(value) {
  return String(value || 'item')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'item';
}

function downloadJson(items, collections, filename) {
  const payload = {
    app: 'poe-trade-collection',
    version: 3,
    exportedAt: new Date().toISOString(),
    collections,
    items,
  };
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

function exportItem(rec) {
  downloadJson([stripWhisperTokens(rec)], allCollections, 'poe-item-' + sanitizeFilename(displayName(rec).name) + '.json');
  toast('Item exported as JSON.');
}

function action(label, disabled, onClick) {
  const button = el('button', 'action', label);
  button.type = 'button';
  if (disabled) button.disabled = true;
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

/* Opens a url in a new tab. window.open is refused once the click's activation
   has expired behind an await, which is what the search and Craft of Exile
   paths do, so the tab is created through the browser instead. */
function openTab(url) {
  if (!url) return;
  chrome.tabs.create({ url: url, active: true });
}

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

async function openCoeLink(event, rec, fallbackUrl) {
  event.preventDefault();
  event.stopPropagation();
  // Craft of Exile's paste importer refuses uniques ("Unsupported rarity") and
  // drops the modifiers of a PoE 2 rare (measured on the live site), so both
  // games go through the details payload: it pins the base and attaches the
  // modifiers by their own keys. The paste stays as the fallback.
  const unique = rarityInfo(rec)[0] === 'unique';
  if (!unique && !coeNeedsModNames(rec)
    && globalThis.PTC_GAMES.profile(gameOf(rec)).coeDetailsImport) {
    // The details URL pins the base by its internal id, so the item cannot land
    // on another base, and the mods are attached by the site's own modifier
    // keys - measured on the live site (PoE 1 3.30, PoE 2 0.5.5.5), this is the
    // path that imports cleanly in both games.
    const granted = await ensureCoePermission();
    if (granted) {
      const response = await send('ptc:coe:url', { record: rec });
      if (response && response.ok && response.url) {
        openTab(response.url);
        return;
      }
    }
    // Could not build the details URL: fall through to the paste.
  }
  if (!unique) {
    // A build import carries no affix names, so the paste is completed with
    // the Craft of Exile data before it is opened. Saved items already have
    // their names and skip this.
    if (coeNeedsModNames(rec)) {
      const granted = await ensureCoePermission();
      if (granted) {
        const prepared = await send('ptc:coe:prepare', { record: rec });
        if (prepared && prepared.ok && prepared.record) {
          rec.coeMods = prepared.record.coeMods;
          const url = buildCoeImportUrl(rec, gameOf(rec), {
            includeDesecrated: settings.coeIncludeDesecrated !== false,
          });
          if (url) {
            openTab(url);
            return;
          }
        }
      }
    }
    if (fallbackUrl) openTab(fallbackUrl);
    return;
  }
  const granted = await ensureCoePermission();
  if (granted) {
    const response = await send('ptc:coe:url', { record: rec });
    if (response && response.ok && response.url) {
      openTab(response.url);
      return;
    }
  }
  if (fallbackUrl) openTab(fallbackUrl);
}

/* Does this item still need the affix names Craft of Exile needs? */
function coeNeedsModNames(rec) {
  const list = Array.isArray(rec && rec.coeMods) ? rec.coeMods : [];
  return list.some((mod) => mod && mod.text
    && (mod.kind === 'explicit' || mod.kind === 'crafted' || mod.kind === 'fractured' || mod.kind === 'desecrated')
    && (!mod.type || !mod.name || mod.name === 'modifier'));
}

function linkAction(label, href) {
  const link = el('a', 'action', label);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function gameOf(rec) {
  return globalThis.PTC_GAMES.normalizeGame(rec);
}

function gameLabel(game) {
  return globalThis.PTC_GAMES.config(game).label;
}

function viewerIcon(rec) {
  const box = el('div', 'viewer-icon');
  const url = safeIcon(rec && (rec.icon || (rec.item && rec.item.icon)));
  if (!url) {
    box.classList.add('no-icon');
    return box;
  }
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = 'Open item art';
  link.appendChild(img);
  img.addEventListener('error', () => {
    link.remove();
    box.classList.add('no-icon');
  });
  box.appendChild(link);
  return box;
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

function watcherFor(rec) {
  return watched.find((entry) => entry.itemId === rec.id && gameOf(entry) === gameOf(rec));
}

function conversionLabel(rec) {
  if (!settings.showConversions || !prices || !rec.priceText) return '';
  const parsed = parsePriceText(rec.priceText);
  if (!parsed) return '';
  const value = formatConversion(convertPrice(parsed.amount, parsed.currencyName, prices), settings.priceDisplay);
  return value ? '~ ' + value : '';
}

function priceHistoryBlock(rec) {
  const history = Array.isArray(rec.priceHistory) ? rec.priceHistory : [];
  if (!history.length) return null;
  const block = el('div', 'price-history');
  block.appendChild(el('h3', '', 'Price history'));
  const points = history
    .map((entry) => ({ at: Number(entry.at) || 0, amount: Number(entry.priceAmount), text: entry.priceText || '' }))
    .filter((entry) => Number.isFinite(entry.amount) && entry.amount > 0);

  if (points.length >= 2) {
    const values = points.map((entry) => entry.amount);
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const width = 220;
    const height = 44;
    const pad = 4;
    const span = max - min || 1;
    const step = (width - pad * 2) / (points.length - 1);
    const coords = values.map((value, index) => {
      const x = pad + index * step;
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('class', 'sparkline');
    const path = document.createElementNS(svgNS, 'polyline');
    path.setAttribute('points', coords.join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    svg.appendChild(path);
    const lastX = Number(coords[coords.length - 1].split(',')[0]);
    const lastY = Number(coords[coords.length - 1].split(',')[1]);
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', String(lastX));
    dot.setAttribute('cy', String(lastY));
    dot.setAttribute('r', '2.4');
    dot.setAttribute('fill', 'currentColor');
    svg.appendChild(dot);
    block.appendChild(svg);

    const first = values[0];
    const last = values[values.length - 1];
    const delta = last - first;
    const pct = first > 0 ? Math.round((delta / first) * 100) : 0;
    let trend = 'steady';
    let trendClass = 'flat';
    if (delta > 0) {
      trend = '+ ' + pct + '%';
      trendClass = 'up';
    } else if (delta < 0) {
      trend = '- ' + Math.abs(pct) + '%';
      trendClass = 'down';
    }
    const caption = el('div', 'ph-caption');
    caption.appendChild(el('span', 'ph-trend ' + trendClass, trend));
    caption.appendChild(el('span', 'ph-detail', points.length + ' checks \u00b7 now ' + points[points.length - 1].text));
    block.appendChild(caption);
  } else {
    const only = history[0];
    block.appendChild(el('p', 'ph-single', 'Baseline ' + (only.priceText || '') + ' \u00b7 ' + timeAgo(only.at)));
  }
  return block;
}

async function ensurePrices(rec) {
  if (!settings.showConversions || prices || !rec.league) return;
  const response = await send('ptc:prices:get', { game: gameOf(rec), league: rec.league });
  if (response.ok && response.prices && current && current.id === rec.id) {
    prices = response.prices;
    render(current, allCollections);
  }
}

function watcherRecord(rec) {
  return {
    itemId: rec.id,
    game: gameOf(rec),
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

const REFRESH_RETRY_MS = 30000;

function queryIdFor(rec) {
  if (rec && rec.queryId) return rec.queryId;
  const info = parseTradeUrl((rec && (rec.searchUrl || rec.sourceUrl)) || '');
  return info ? info.queryId : '';
}

function hasItemDetails(rec) {
  const item = rec && rec.item;
  if (!item) return false;
  const modKeys = ['implicitMods', 'enchantMods', 'runeMods', 'explicitMods', 'craftedMods',
    'fracturedMods', 'desecratedMods', 'scourgeMods', 'utilityMods', 'bondedMods'];
  const hasModLines = modKeys.some((key) => asModArray(item[key]).length > 0);
  const hasModField = modKeys.some((key) => Object.prototype.hasOwnProperty.call(item, key));
  const realItem = (Array.isArray(item.properties) && item.properties.length)
    || (Array.isArray(item.requirements) && item.requirements.length);
  if (realItem && !hasModLines && !hasModField) return false;
  return hasModLines || hasModField
    || (Array.isArray(item.grantedSkills) && item.grantedSkills.length > 0);
}

async function refreshItem(silent) {
  if (!current || refreshBtn.dataset.busy) return false;
  const target = current;
  refreshBtn.dataset.busy = '1';
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing...';
  const response = await send('ptc:item:refresh', {
    id: target.id,
    game: gameOf(target),
    queryId: queryIdFor(target),
    searchUrl: target.searchUrl || target.sourceUrl,
  });
  delete refreshBtn.dataset.busy;
  refreshBtn.textContent = 'Refresh item';
  refreshBtn.disabled = false;
  if (!response || !response.ok) {
    toast((response && response.error) || 'Could not refresh this item.', true);
    return false;
  }
  const updated = {
    ...target,
    item: response.item || target.item,
    priceText: response.priceText || target.priceText,
    refreshedAt: Date.now(),
  };
  try {
    const fresh = await chrome.storage.local.get({ watchedItems: [] });
    if (Array.isArray(fresh.watchedItems)) watched = fresh.watchedItems;
  } catch (error) {
    /* keep current list */
  }
  render(updated, allCollections);
  if (!silent) toast('Item details refreshed.');
  return true;
}

function maybeRefresh(rec) {
  if (!rec || !rec.id || hasItemDetails(rec)) return;
  if (!queryIdFor(rec)) return;
  const key = 'ptcRefresh:' + rec.id;
  try {
    const last = Number(sessionStorage.getItem(key)) || 0;
    if (last && Date.now() - last < REFRESH_RETRY_MS) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch (error) {
    return;
  }
  setTimeout(() => {
    if (current && current.id === rec.id) refreshItem(true);
  }, 60);
}

async function toggleWatch() {
  if (!current) return;
  const existing = watcherFor(current);
  watchBtn.disabled = true;
  let response;
  if (existing) {
    response = await send('ptc:watch:remove', { id: existing.id });
  } else {
    response = await send('ptc:watch:add', { record: watcherRecord(current) });
  }
  watchBtn.disabled = false;
  if (!response.ok) {
    toast(response.error || 'Could not update the watcher.', true);
    return;
  }
  const data = await chrome.storage.local.get({ watchedItems: [] });
  watched = Array.isArray(data.watchedItems) ? data.watchedItems : [];
  toast(existing ? 'Stopped watching.' : (response.duplicate ? 'Already watched.' : 'Watching this item.'));
  render(current, allCollections);
}

function render(rec, collections) {
  current = rec;
  allCollections = collections;

  const named = displayName(rec);
  const rarity = rarityInfo(rec);
  const game = gameOf(rec);
  const build = collections.find((entry) => entry.id === rec.collectionId);
  const saved = !!(rec.savedAt && rec.savedAt > 0);
  const watchEntry = watcherFor(rec);

  document.title = named.name + ' - Poe Trade Watcher';
  subtitle.textContent = (saved ? 'Saved ' + timeAgo(rec.savedAt) : 'Watched item')
    + (rec.league ? ' \u00b7 ' + rec.league : '');

  const searchUrl = safePoeLink(rec.searchUrl || rec.sourceUrl);
  const sellerUrl = rec.account
    ? 'https://www.pathofexile.com/account/view-profile/' + encodeURIComponent(rec.account)
    : '';

  copyItemBtn.disabled = false;
  /* The query id can be read from the saved url, which is what refresh uses. */
  refreshBtn.disabled = !(rec.id && queryIdFor(rec));
  refreshBtn.title = refreshBtn.disabled
    ? 'Refresh is unavailable without a search query.'
    : 'Fetch the full listing again from the trade API.';
  watchBtn.disabled = false;
  watchBtn.textContent = watchEntry ? 'Stop watching' : 'Watch';
  searchBtn.onclick = null;
  /* viewer.html renders the button hidden and every branch below relies on it
     being visible; without this line the item viewer has no search action at all. */
  searchBtn.hidden = false;
  const base = (rec.item && (rec.item.baseType || rec.item.typeLine)) || rec.typeLine || '';
  let searchIsSavedLink = false;
  if (!rec.targetOf && searchUrl) {
    if (savedSearchUsable(searchUrl)) {
      // The search the item was saved from is the search that found it, so it
      // holds the item: it is opened exactly as it is, instantly, with the item
      // and the other items with the same modifiers in its results.
      searchBtn.href = searchUrl;
      searchBtn.title = 'Open the search this item was saved from';
      searchBtn.textContent = 'Price check';
      searchIsSavedLink = true;
    } else {
      // The saved search does not describe the item, so a search is built for
      // it: base type and its own modifiers, in the league it was listed in.
      // A click that builds it, because the url does not exist before that - and
      // a failed build says so instead of opening the search that misses it.
      searchBtn.removeAttribute('href');
      searchBtn.title = 'Search for this item and the items that share its modifiers';
      searchBtn.textContent = 'Price check';
      searchBtn.onclick = async (event) => {
        event.preventDefault();
        searchBtn.textContent = 'Preparing...';
        const response = await send('ptc:trade:url', { record: rec });
        searchBtn.textContent = 'Price check';
        if (response && response.ok && response.url) {
          openTab(response.url);
          return;
        }
        toast((response && response.error) || 'The search for this item could not be built.', true);
      };
    }
  } else if (base) {
    // A build import has no search of its own, so the button builds a search
    // for the item itself.
    searchBtn.removeAttribute('href');
    const rarityKey = rarity[0];
    const qualityProp = ((rec.item && rec.item.properties) || []).find((entry) => entry && /quality/i.test(String(entry.name || '')));
    const qualityValue = qualityProp && Array.isArray(qualityProp.values) && qualityProp.values.length
      ? parseInt(String(qualityProp.values[0][0] || '').replace(/[^0-9-]/g, ''), 10)
      : parseInt(String((rec.item && rec.item.quality) || '').replace(/[^0-9-]/g, ''), 10);
    searchBtn.title = 'Create a trade search for this item and open it';
    searchBtn.textContent = 'Search item';
    searchBtn.onclick = async (event) => {
      event.preventDefault();
      // Wrapped in "payload" so the base type in "type" cannot clobber the message type.
      /* The same builder the side panel uses: the query is written into the url
         and the site runs it, so the click costs no trade request. */
      const frame = rarityKey === 'unique' ? 3 : rarityKey === 'magic' ? 1 : rarityKey === 'normal' ? 0 : 2;
      const response = await send('ptc:trade:url', { record: {
        id: rec.id,
        game: game,
        // A build import has no league of its own; the search belongs where the
        // player is now. A saved listing belongs in the league it was listed in.
        league: rec.targetOf ? '' : (rec.league || ''),
        targetOf: rec.targetOf || '',
        name: rarityKey === 'unique' ? ((rec.item && rec.item.name) || rec.name || '') : base,
        typeLine: base,
        rarity: frame,
        item: {
          name: rarityKey === 'unique' ? ((rec.item && rec.item.name) || rec.name || '') : '',
          baseType: base,
          typeLine: base,
          frameType: frame,
          ilvl: (rec.item && rec.item.ilvl) || null,
          itemClass: (rec.item && (rec.item.itemClass || rec.item.baseType)) || base,
          corrupted: !!(rec.item && (rec.item.corrupted || rec.item.doubleCorrupted)),
          /* Every modifier the search may use, not only the explicit ones: a
             crafted or desecrated line is part of what makes the item. */
          explicitMods: globalThis.PTC.searchModLines(rec.item),
          properties: Number.isFinite(qualityValue) && qualityValue > 0
            ? [{ name: 'Quality', values: [[String(qualityValue) + '%', 0]] }] : [],
        },
      } });
      if (!(response && response.ok && response.url)) {
        toast((response && response.error) || 'The search for this item could not be built.', true);
        return;
      }
      openTab(response.url);
    };
  } else if (searchUrl) {
    searchBtn.href = searchUrl;
    searchBtn.title = 'Open the search page this item was saved from';
    searchBtn.textContent = 'Open search';
  } else {
    searchBtn.hidden = true;
  }

  const grid = el('div', 'viewer-grid');
  const side = el('section', 'viewer-side');

  const hero = el('div', 'viewer-hero');
  hero.appendChild(viewerIcon(rec));

  const titles = el('div', 'viewer-titles');
  titles.appendChild(el('h1', 'viewer-name r-' + rarity[0], named.name));
  if (named.type) titles.appendChild(el('p', 'viewer-type', named.type));

  const tags = el('div', 'viewer-tags');
  if (rec.priceText) tags.appendChild(el('span', 'tag price', rec.priceText));
  const conv = conversionLabel(rec);
  if (conv) tags.appendChild(el('span', 'tag conversion', conv));
  tags.appendChild(el('span', 'tag game', gameLabel(game)));
  if (rec.league) tags.appendChild(el('span', 'tag', rec.league));
  if (hasCrafted(rec)) tags.appendChild(el('span', 'tag crafted', 'Crafted'));
  if (hasFractured(rec)) tags.appendChild(el('span', 'tag fractured', 'Fractured'));
  if (build) tags.appendChild(el('span', 'tag collection', build.name));
  if (watchEntry && watchEntry.status) tags.appendChild(el('span', 'tag', watchEntry.status));
  if (tags.childElementCount) titles.appendChild(tags);

  hero.appendChild(titles);
  side.appendChild(hero);

  const actions = el('div', 'viewer-actions');
  /* The button above is already this saved search when searchIsSavedLink, so
     the "Original search" row only appears when the button builds a different
     search and this is the page the item was saved from. */
  if (searchUrl && !searchIsSavedLink) actions.appendChild(linkAction('Original search', searchUrl));
  else if (!searchUrl) actions.appendChild(action('No search link', true));
  if (sellerUrl) actions.appendChild(linkAction('Seller profile', sellerUrl));
  else actions.appendChild(action('No seller', true));

  if (settings.showWikiLinks) {
    const links = wikiLinks(rec, game, { includeDesecrated: settings.coeIncludeDesecrated !== false });
    links.forEach((entry) => {
      const link = linkAction(entry.label, entry.url);
      if (entry.coe) {
        link.classList.add('coe-link');
        const summary = coeImportSummary(rec);
        link.title = (summary.included
          ? 'Open in Craft of Exile (beta) - base, quality, item level and ' + summary.included + ' modifier(s) imported.'
          : 'Open in Craft of Exile (beta) - base, quality and item level imported.')
          + (rarityInfo(rec)[0] === 'unique'
            ? ' Unique rarity uses the site item data (Chrome asks for access once).'
            : ' Sent through the site paste import.');
        if (summary.skipped) link.title += ' (not imported: ' + (summary.skippedTexts || []).join(' | ') + ')';
        link.addEventListener('click', (event) => openCoeLink(event, rec, entry.url));
      }
      actions.appendChild(link);
    });
  }

  const coeBtn = action('Copy for Craft of Exile', false, () => copyForTool('coe'));
  coeBtn.classList.add('wide');
  actions.appendChild(coeBtn);
  if (game === 'poe2') {
    const pobBtn = action('Copy for Path of Building', false, () => copyForTool('pob'));
    pobBtn.classList.add('wide');
    actions.appendChild(pobBtn);
  }
  const discordBtn = action('Copy for Discord', false, () => copyForTool('discord'));
  discordBtn.classList.add('wide');
  actions.appendChild(discordBtn);

  const exportBtn = action('Export item JSON', false, () => exportItem(rec));
  exportBtn.classList.add('wide');
  actions.appendChild(exportBtn);
  side.appendChild(actions);

  if (rec.whisper || (rec.stash && rec.stash.tab)) {
    const whisper = el('div', 'viewer-whisper');
    whisper.appendChild(el('h3', '', 'Whisper'));
    if (rec.whisper) whisper.appendChild(el('pre', '', rec.whisper));
    if (rec.stash && rec.stash.tab) {
      const pos = rec.stash.x != null && rec.stash.y != null
        ? ' (' + rec.stash.x + ', ' + rec.stash.y + ')'
        : '';
      whisper.appendChild(el('div', 'viewer-stash', 'Stash: ' + rec.stash.tab + pos));
    }
    side.appendChild(whisper);
  }

  const historyBlock = priceHistoryBlock(rec);
  if (historyBlock) side.appendChild(historyBlock);

  const meta = el('div', 'meta');
  meta.appendChild(metaRow('Game', gameLabel(game)));
  meta.appendChild(metaRow('Price', rec.priceText || 'not specified'));
  if (conv) meta.appendChild(metaRow('Converted', conv.replace(/^~ /, '')));
  meta.appendChild(metaRow('League', rec.league || '-'));
  meta.appendChild(metaRow('Seller', rec.account || '-'));
  meta.appendChild(metaRow('IGN', getIgn(rec) || '-'));
  meta.appendChild(metaRow('Build', build ? build.name : 'Unsorted'));
  if (saved) meta.appendChild(metaRow('Saved', fullDate(rec.savedAt)));
  if (watchEntry) {
    meta.appendChild(metaRow('Watch status', watchEntry.status || 'unknown'));
    meta.appendChild(metaRow('Last checked', watchEntry.lastChecked ? fullDate(watchEntry.lastChecked) : '-'));
  }
  meta.appendChild(metaRow('Listing ID', el('code', '', rec.id || '-')));
  /* The button above is this saved search, so the row would only repeat it. */
  if (searchUrl && !searchIsSavedLink) {
    meta.appendChild(metaRow('Original search', searchUrl, true));
  }
  side.appendChild(meta);

  const tooltip = el('section', 'viewer-tooltip');
  tooltip.appendChild(renderItemTooltip(rec));

  grid.appendChild(side);
  grid.appendChild(tooltip);
  app.replaceChildren(grid);

  ensurePrices(rec);
  maybeRefresh(rec);
}

function showMissing(message) {
  document.title = 'Item not found - Poe Trade Watcher';
  subtitle.textContent = 'Item not found';
  copyItemBtn.disabled = true;
  refreshBtn.disabled = true;
  watchBtn.disabled = true;
  searchBtn.hidden = true;

  const box = el('div', 'viewer-missing');
  box.appendChild(el('h2', '', 'Item not found'));
  box.appendChild(el('p', '', message || 'This item may have been deleted. Open the extension side panel to see your collection.'));
  app.replaceChildren(box);
}

async function loadStore() {
  const data = await chrome.storage.local.get({
    savedItems: [],
    collections: [],
    watchedItems: [],
    ptcSettings: {},
  });
  watched = Array.isArray(data.watchedItems) ? data.watchedItems : [];
  settings = { ...settings, ...(data.ptcSettings || {}) };
  applyTheme(settings.theme);
  return {
    items: Array.isArray(data.savedItems) ? data.savedItems : [],
    collections: Array.isArray(data.collections) ? data.collections : [],
  };
}

async function init() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || '';
  const watchId = params.get('watch') || '';

  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    showMissing('The viewer only works inside the extension. Open it from the item details in the side panel.');
    return;
  }

  let store;
  try {
    store = await loadStore();
  } catch (error) {
    showMissing('The saved collection could not be loaded.');
    return;
  }

  let rec = store.items.find((entry) => entry.id === id);
  if (!rec && watchId) {
    const entry = watched.find((item) => item.itemId === watchId || item.id === watchId);
    if (entry) {
      rec = {
        ...entry,
        id: entry.itemId,
        savedAt: entry.addedAt || 0,
        collectionId: '',
      };
    }
  }
  if (!rec) {
    showMissing();
    return;
  }
  render(rec, store.collections);

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (!changes.savedItems && !changes.collections && !changes.watchedItems && !changes.ptcSettings) return;
    let nextStore;
    let freshWatched = watched;
    try {
      nextStore = await loadStore();
      const fresh = await chrome.storage.local.get({ watchedItems: [] });
      if (Array.isArray(fresh.watchedItems)) {
        freshWatched = fresh.watchedItems;
        watched = freshWatched;
      }
    } catch (error) {
      return;
    }
    const next = nextStore.items.find((entry) => entry.id === id)
      || (() => {
        const entry = freshWatched.find((item) => item.itemId === (id || watchId) || item.id === watchId);
        return entry ? { ...entry, id: entry.itemId, savedAt: entry.addedAt || 0, collectionId: '' } : null;
      })();
    if (!next) {
      current = null;
      showMissing();
      return;
    }
    render(next, nextStore.collections);
  });
}

copyItemBtn.addEventListener('click', () => {
  if (current) copyItem(current);
});

refreshBtn.addEventListener('click', () => {
  if (current) refreshItem(false);
});

watchBtn.addEventListener('click', () => {
  if (current) toggleWatch();
});

init();



