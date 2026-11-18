(() => {
  'use strict';

  if (window.__ptcTradeInjected) return;
  window.__ptcTradeInjected = true;
  if (!window.PTC) return;

  const {
    text: cleanText,
    cleanGameText,
      parseTradeUrl,
    buildTradeUrl,
    buildLeagueSearchUrl,
    parsePriceText,
    convertPrice,
    formatConversion,
    fuzzyMatch,
    matchesBlacklist,
    safeIconUrl,
    formatValueScore,
    valueScore,
    discordText,
    parseListingDate,
  } = window.PTC;

  /* The trade site's "Instant Buyout and In Person" value, from TRADE_STATUS in
     ptc-games.js: measured on the live site, `available` is that option and
     `securable` is buyout only - the names do not match their labels. */
  const SEARCH_STATUS = (globalThis.PTC_GAMES && globalThis.PTC_GAMES.TRADE_STATUS
    && globalThis.PTC_GAMES.TRADE_STATUS.instantAndInPerson) || 'available';

  const DEFAULT_SETTINGS = globalThis.PTC_SETTINGS
    ? globalThis.PTC_SETTINGS.defaults
    : {
      priceDisplay: 'divine-exalted',
      showConversions: true,
      showIgn: true,
      highlightStats: true,
      fuzzyResults: true,
      blacklistEnabled: true,
      blacklist: [],
      showWikiLinks: true,
      coeIncludeDesecrated: true,
      modDomainLabels: true,
      fallbackLeague: { poe2: '', poe1: '' },
      sellerAlerts: '',
      valueSortPage: false,
      league: '',
      hardcore: false,
      searchFilterEnabled: true,
    };

  const state = {
    page: null,
    pageKey: '',
    settings: { ...DEFAULT_SETTINGS },
    prices: null,
    saved: new Set(),
    watched: new Map(),
    filterQuery: '',
    marksQuery: '',
    pricesFor: '',
    historySent: '',
    busyIds: new Set(),
  };

  function alive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (error) {
      return false;
    }
  }

  function send(message) {
    return new Promise((resolve) => {
      if (!alive()) {
        resolve(null);
        return;
      }
      /* The worker can be busy with a watcher check, or be restarted mid-message:
         without a deadline the callback may never fire and the button that asked
         stays on "Removing..." forever. */
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), 20000);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) finish(null);
          else finish(response);
        });
      } catch (error) {
        finish(null);
      }
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  let toastEl = null;
  let toastTimer = 0;

  function toast(message, kind) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'ptc-toast';
      (document.body || document.documentElement).appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.className = 'ptc-toast show ' + (kind || 'ok');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  function normalizeSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    if (globalThis.PTC_SETTINGS) return globalThis.PTC_SETTINGS.normalize(source);
    const result = { ...DEFAULT_SETTINGS, ...source };
    result.fallbackLeague = {
      poe2: cleanText(source.fallbackLeague && source.fallbackLeague.poe2) || '',
      poe1: cleanText(source.fallbackLeague && source.fallbackLeague.poe1) || '',
    };
    result.blacklist = Array.isArray(source.blacklist) ? source.blacklist : [];
    return result;
  }

  function pageInfo() {
    const info = parseTradeUrl(location.href);
    if (info) {
      if (!info.league) info.league = state.settings.fallbackLeague[info.game] || '';
      return info;
    }
    return null;
  }

  function baseSearchUrl() {
    try {
      const url = new URL(location.href);
      url.pathname = url.pathname.replace(/\/live(?=\/|$)/, '');
      url.hash = '';
      return url.href;
    } catch (error) {
      return location.href.split('#')[0];
    }
  }

  function deriveName() {
    const input = document.querySelector(
      '.search-panel input[type="text"], .search-panel input[type="search"], .search-panel .multiselect__input'
    );
    const value = cleanText(input && input.value);
    if (value) return value.slice(0, 70);
    const info = state.page;
    if (info && info.league) return info.league + ' search';
    return 'Trade search';
  }

  function keyFor(id) {
    const game = state.page ? state.page.game : 'poe2';
    return game + ':' + id;
  }

  /* -------------------------------- rows --------------------------------- */

  function topRows() {
    const out = [];
    document.querySelectorAll('.resultset .row[data-id]').forEach((row) => {
      if (row.parentElement && row.parentElement.closest('.row')) return;
      if (!row.closest('.resultset')) return;
      out.push(row);
    });
    return out;
  }

  function rowId(row) {
    return row.getAttribute('data-id') || '';
  }

  function rowAccount(row) {
    const node = row.querySelector('.account .profile-link, .account a') || row.querySelector('.account');
    return cleanText(node && node.textContent);
  }

  function rowItemNames(row) {
    const name = row.querySelector('.itemHeader .itemName');
    const type = row.querySelector('.itemHeader .itemType');
    return {
      name: cleanGameText(name && name.textContent),
      type: cleanGameText(type && type.textContent),
    };
  }

  function exactPrice(row) {
    const record = row && row.__ptcRecord;
    const price = record && record.listing && record.listing.price;
    if (!price || typeof price.amount !== 'number' || !Number.isFinite(price.amount)) return null;
    const currency = cleanText(price.currency || price.currencyName || '');
    if (!currency) return null;
    return { amount: price.amount, currencyName: currency };
  }

  function rowPriceText(row) {
    if (row.dataset.ptcPrice) return row.dataset.ptcPrice;
    const price = row.querySelector('.price');
    if (!price) return '';
    const clone = price.cloneNode(true);
    clone.querySelectorAll('.ptc-actions').forEach((node) => node.remove());
    const value = cleanText(clone.textContent);
    row.dataset.ptcPrice = value;
    return value;
  }

  function buildActions() {
    const box = document.createElement('div');
    box.className = 'ptc-actions';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'ptc-row-btn ptc-save';
    save.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h12a2 2 0 0 1 2 2v18l-7-4-7 4V3a2 2 0 0 1 2-2z"/></svg><span class="ptc-label">Save</span>';
    save.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onSaveClick(save).catch(() => {});
    });
    box.appendChild(save);

    const watch = document.createElement('button');
    watch.type = 'button';
    watch.className = 'ptc-row-btn ptc-watch';
    watch.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z"/></svg><span class="ptc-wlabel">Watch</span>';
    watch.title = 'Watch this listing for price changes or removal';
    watch.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onWatchClick(watch).catch(() => {});
    });
    box.appendChild(watch);

    const discord = document.createElement('button');
    discord.type = 'button';
    discord.className = 'ptc-row-btn ptc-discord';
    discord.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.3 5.6A16 16 0 0 0 15.4 4.4l-.2.4a14.7 14.7 0 0 1 3.4 1.7 12.9 12.9 0 0 0-11.2 0A14.7 14.7 0 0 1 10.8 4.8l-.2-.4A16 16 0 0 0 6.7 5.6C4.2 9.3 3.4 12.9 3.7 16.4A16 16 0 0 0 8.5 19l1-1.6c-.7-.3-1.4-.6-2-1l.5-.4a11.4 11.4 0 0 0 10 0l.5.4c-.6.4-1.3.7-2 1l1 1.6a16 16 0 0 0 4.8-2.6c.4-4-.6-7.4-3-10.8ZM9.3 14.3c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Zm5.4 0c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Z"/></svg><span class="ptc-dlabel">Send to Discord</span>';
    discord.title = 'Send this item to your Discord webhook; copies the message when no webhook is set';
    discord.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onDiscordClick(discord).catch(() => {});
    });
    box.appendChild(discord);

    const ign = document.createElement('span');
    ign.className = 'ptc-ign';
    box.appendChild(ign);

    const meta = document.createElement('span');
    meta.className = 'ptc-meta';
    box.appendChild(meta);

    return box;
  }

  /*
   * The colours the trade site gives the different kinds of modifiers. PoE 2
   * has desecrated and rune mods, PoE 1 has veiled and scourge mods instead,
   * so every game gets its own legend.
   */
  /* The legend follows the game of the page that is open, and the entries come
     from that game's profile. */
  function modLegend() {
    const profile = globalThis.PTC_GAMES.profile(state.page && state.page.game);
    return profile.modLegends || [];
  }

  let filterInput = null;

  function buildFilterBox() {
    if (filterInput || !state.settings.searchFilterEnabled) return filterInput;
    const wrap = document.createElement('div');
    wrap.className = 'ptc-filterbox';
    wrap.id = 'ptc-filterbox';

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'ptc-filter-input';
    input.placeholder = 'Filter results (fuzzy)';
    input.setAttribute('aria-label', 'Filter trade results');
    input.addEventListener('input', () => {
      state.filterQuery = input.value;
      applyFilterAndMarks();
      updateFilterCount();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        input.value = '';
        state.filterQuery = '';
        applyFilterAndMarks();
        updateFilterCount();
      }
    });

    const count = document.createElement('span');
    count.className = 'ptc-filter-count';
    count.id = 'ptc-filter-count';

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'ptc-filter-clear';
    clear.textContent = '\u00d7';
    clear.title = 'Clear the filter';
    clear.addEventListener('click', () => {
      input.value = '';
      state.filterQuery = '';
      applyFilterAndMarks();
      updateFilterCount();
    });

    wrap.append(input, count, clear);
    (document.body || document.documentElement).appendChild(wrap);
    filterInput = input;
    return wrap;
  }

  function updateFilterCount() {
    const node = document.getElementById('ptc-filter-count');
    if (!node) return;
    const query = state.filterQuery.trim();
    if (!query) {
      node.textContent = '';
      return;
    }
    const rows = topRows();
    const shown = rows.filter((row) => !row.classList.contains('ptc-hidden')).length;
    node.textContent = shown + ' / ' + rows.length;
  }

  function buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'ptc-toolbar ptc-legend';
    bar.id = 'ptc-bar';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'ptc-legend-head';
    head.title = 'What the mod colors mean';
    head.setAttribute('aria-expanded', 'false');
    const swatches = document.createElement('span');
    swatches.className = 'ptc-legend-strip';
    modLegend().forEach((entry) => {
      const dot = document.createElement('span');
      dot.className = 'ptc-legend-dot';
      dot.style.background = entry.color;
      dot.title = entry.label;
      swatches.appendChild(dot);
    });
    const title = document.createElement('span');
    title.className = 'ptc-legend-title';
    title.textContent = 'Mod colors';
    const caret = document.createElement('span');
    caret.className = 'ptc-legend-caret';
    caret.textContent = '\u25be';
    head.append(swatches, title, caret);

    const list = document.createElement('div');
    list.className = 'ptc-legend-list';
    modLegend().forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'ptc-legend-row';
      const swatch = document.createElement('span');
      swatch.className = 'ptc-legend-swatch';
      swatch.style.background = entry.color;
      const label = document.createElement('span');
      label.className = 'ptc-legend-label';
      label.textContent = entry.label;
      row.append(swatch, label);
      list.appendChild(row);
    });

    head.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = bar.classList.toggle('open');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    bar.append(head, list);
    (document.body || document.documentElement).appendChild(bar);
    positionLegend();
    return bar;
  }

  /* Rebuilds the legend when the page changes to the other game, because the
     two games colour their modifiers differently. */
  function refreshLegend() {
    const bar = document.getElementById('ptc-bar');
    if (!bar) return;
    const entries = modLegend();
    const strip = bar.querySelector('.ptc-legend-strip');
    if (strip) {
      strip.replaceChildren();
      entries.forEach((entry) => {
        const dot = document.createElement('span');
        dot.className = 'ptc-legend-dot';
        dot.style.background = entry.color;
        dot.title = entry.label;
        strip.appendChild(dot);
      });
    }
    const list = bar.querySelector('.ptc-legend-list');
    if (list) {
      list.replaceChildren();
      entries.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'ptc-legend-row';
        const swatch = document.createElement('span');
        swatch.className = 'ptc-legend-swatch';
        swatch.style.background = entry.color;
        const label = document.createElement('span');
        label.className = 'ptc-legend-label';
        label.textContent = entry.label;
        row.append(swatch, label);
        list.appendChild(row);
      });
    }
  }

  let historyNavEl = null;
  let legendListenersReady = false;

  const HISTORY_NAV_TARGETS = ['history', 'about', 'settings'];
  function findHistoryNav() {
    if (historyNavEl && document.contains(historyNavEl)) {
      const cached = historyNavEl.getBoundingClientRect();
      if (cached.width > 0 && cached.top >= 0) return historyNavEl;
    }
    historyNavEl = null;
    const nodes = document.querySelectorAll('a, button, span, div, li');
    for (const target of HISTORY_NAV_TARGETS) {
      for (const node of nodes) {
        if (node.childElementCount > 1) continue;
        if ((node.textContent || '').trim().toLowerCase() !== target) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.top >= 0) {
          historyNavEl = node;
          return node;
        }
      }
    }
    return null;
  }

  /*
   * The banner (with the Path of Exile logo) is the wide element pinned to the
   * top of the page; anchor the legend below it, centered.
   */
  function findHeaderBottom() {
    const candidates = [];
    const header = document.querySelector('header');
    if (header) candidates.push(header);
    const logo = document.querySelector('img[src*="logo" i], img[alt*="path of exile" i]');
    if (logo) candidates.push(logo);
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 200 && rect.top <= 5 && rect.height > 100) return rect.bottom;
    }
    return 0;
  }

  function positionLegend() {
    const bar = document.getElementById('ptc-bar');
    if (!bar) return;
    let top = 10;
    const headerBottom = findHeaderBottom();
    if (headerBottom) {
      top = headerBottom - 6;
    } else {
      const nav = findHistoryNav();
      if (nav) {
        const rect = nav.getBoundingClientRect();
        top = rect.top - bar.offsetHeight - 6;
      }
    }
    top = Math.max(8, Math.round(top));
    bar.style.setProperty('--ptc-legend-top', top + 'px');
    if (!legendListenersReady) {
      legendListenersReady = true;
      window.addEventListener('scroll', positionLegend, { passive: true });
      window.addEventListener('resize', positionLegend);
    }
  }

  function ensureToolbar() {
    if (!document.body) return;
    if (!document.getElementById('ptc-bar')) buildToolbar();
    if (state.settings.searchFilterEnabled && !filterInput) buildFilterBox();
  }

  function placeActions(row, box) {
    const price = row.querySelector('.price');
    if (price && !price.closest('.middle')) {
      price.appendChild(box);
    } else {
      box.classList.add('ptc-float');
      row.appendChild(box);
    }
  }

  function setText(node, value) {
    if (!node) return;
    const next = value == null ? '' : String(value);
    if (node.textContent !== next) node.textContent = next;
  }

  function updateSaveButton(button, id) {
    if (!button) return;
    const saved = state.saved.has(keyFor(id));
    button.classList.toggle('is-saved', saved);
    button.title = saved ? 'Remove this item from the collection' : 'Save this item with all mods and its link';
    const label = button.querySelector('.ptc-label');
    if (label && !button.dataset.busy) setText(label, saved ? 'Saved' : 'Save');
  }

  function updateWatchButton(button, id) {
    if (!button) return;
    const active = state.watched.get(keyFor(id));
    button.classList.toggle('is-watched', !!active);
    button.title = active ? 'Stop watching this listing' : 'Watch this listing for price changes or removal';
    const label = button.querySelector('.ptc-wlabel');
    if (label && !button.dataset.busy) setText(label, active ? 'Watching' : 'Watch');
  }

  function setButtonBusy(button, busy, label) {
    button.dataset.busy = busy ? '1' : '';
    button.classList.toggle('is-busy', busy);
    const node = button.querySelector('.ptc-label, .ptc-wlabel');
    if (node && busy) node.textContent = label || '...';
  }

  function applyBlacklist(row) {
    if (!state.settings.blacklistEnabled) {
      row.classList.remove('ptc-blacklisted');
      return;
    }
    const account = rowAccount(row);
    const ignored = matchesBlacklist(account, state.settings.blacklist);
    row.classList.toggle('ptc-blacklisted', ignored);
    if (ignored) row.dataset.ptcIgnored = '1';
    else delete row.dataset.ptcIgnored;
  }

  /* --------------------- value score / live / sellers ---------------------- */

  function queryKey() {
    const info = state.page;
    return info ? info.game + '|' + (info.league || '').toLowerCase() + '|' + (info.queryId || '') : '';
  }

  function normSeller(value) {
    return cleanText(value).toLowerCase().split('#')[0].trim();
  }

  function applySellerAlert(row) {
    const raw = state.settings.sellerAlerts || '';
    const list = raw.split(/\r?\n|,/).map((entry) => normSeller(entry)).filter(Boolean);
    if (!list.length) {
      row.classList.remove('ptc-seller-alert');
      return;
    }
    const account = normSeller(rowAccount(row));
    if (!account) {
      row.classList.remove('ptc-seller-alert');
      return;
    }
    const hit = list.indexOf(account) !== -1;
    row.classList.toggle('ptc-seller-alert', hit);
    if (!hit) return;
    const key = 'ptcSellerAlert:' + queryKey() + ':' + account;
    try {
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        const names = rowItemNames(row);
        toast('Whitelisted seller found: ' + rowAccount(row), 'ok');
        send({
          type: 'ptc:seller:alert',
          ign: rowAccount(row),
          itemName: names.name || '',
          ignKey: queryKey() + ':' + account,
        });
      }
    } catch (error) {
      /* sessionStorage unavailable */
    }
  }

  function trackNewRow(row, id) {
    if (!state.page) return;
    const key = 'ptcSeen:' + queryKey();
    let isNew = false;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        let seen;
        try {
          seen = new Set(JSON.parse(stored));
        } catch (error) {
          seen = new Set();
        }
        if (!seen.has(id)) {
          isNew = true;
          row.classList.add('ptc-new');
          setTimeout(() => row.classList.remove('ptc-new'), 8000);
        }
        seen.add(id);
        if (seen.size > 400) {
          let extra = seen.size - 400;
          for (const value of seen) {
            seen.delete(value);
            extra -= 1;
            if (!extra) break;
          }
        }
        sessionStorage.setItem(key, JSON.stringify([...seen]));
      } else {
        sessionStorage.setItem(key, JSON.stringify([id]));
      }
    } catch (error) {
      /* sessionStorage unavailable */
    }
    if (isNew) reportNewListing(row, id);
  }

  /* A new listing showed up in a search that is being watched. The trade tab
     reports them; the background decides whether they match. */
  function reportNewListing(row, id) {
    if (!state.page || !state.page.queryId) return;
    const header = row.querySelector('.itemHeader');
    const nameNode = row.querySelector('.itemName') || (header ? header.querySelector('span') : null);
    const typeNode = row.querySelector('.itemType');
    const priceNode = row.querySelector('.price');
    const price = priceNode ? cleanText(priceNode.textContent) : '';
    send({
      type: 'ptc:searchwatch:listing',
      payload: {
        queryId: state.page.queryId,
        league: state.page.league,
        id,
        name: cleanText(nameNode ? nameNode.textContent : ''),
        typeLine: cleanText(typeNode ? typeNode.textContent : ''),
        priceText: price,
        account: rowAccount(row),
        live: !!state.page.live,
      },
    });
  }

  /*
   * Every listing the user sees is a sample for the local market index, which
   * is what the side panel uses to tell a fair price from a suspiciously
   * cheap one. Only the price and the base type are sent, never the listing.
   */
  const PRICE_INDEX_SENT = new Set();

  function reportPriceSample(row, id) {
    if (!state.page || !state.page.league) return;
    if (PRICE_INDEX_SENT.has(id)) return;
    const typeNode = row.querySelector('.itemType');
    const base = cleanText(typeNode ? typeNode.textContent : '').replace(/^superior\s+/i, '').toLowerCase();
    if (!base) return;
    /* rowPriceText strips the buttons this extension adds to the price line;
       the raw text would end in "Save Watch" and the parser would drop it. */
    const priceText = rowPriceText(row);
    if (!priceText) return;
    const parsed = parsePriceText(priceText);
    if (!parsed) return;
    const conversion = convertPrice(parsed.amount, parsed.currencyName, state.prices);
    if (!conversion || conversion.primaryAmount == null) return;
    PRICE_INDEX_SENT.add(id);
    if (PRICE_INDEX_SENT.size > 800) {
      const first = PRICE_INDEX_SENT.values().next().value;
      PRICE_INDEX_SENT.delete(first);
    }
    send({
      type: 'ptc:priceindex:add',
      records: [{
        key: base + '|' + state.page.league.toLowerCase(),
        value: conversion.primaryAmount,
      }],
    });
  }

  const VALUE_FETCH_LIMIT = 12;
  let valueQueue = [];
  let valueWorking = false;

  function valueBadgeNode(row) {
    let badge = row.querySelector('.ptc-value');
    if (badge) return badge;
    badge = document.createElement('span');
    badge.className = 'ptc-value';
    const price = row.querySelector('.price');
    (price || row).appendChild(badge);
    return badge;
  }

  function renderValueBadge(row) {
    if (!state.settings.valueSortPage) {
      const badge = row.querySelector('.ptc-value');
      if (badge) badge.remove();
      return;
    }
    const score = row.__ptcValue;
    if (typeof score !== 'number' || !Number.isFinite(score)) return;
    const badge = valueBadgeNode(row);
    setText(badge, 'value ' + formatValueScore(score, state.prices));
    badge.title = 'Estimated value (price per quality, in chaos orbs) - lower is better';
  }

  function queueValue(row) {
    if (!state.settings.valueSortPage) return;
    const id = rowId(row);
    if (!id) return;
    if (typeof row.__ptcValue === 'number') {
      renderValueBadge(row);
      return;
    }
    if (row.__ptcRecord) {
      row.__ptcValue = valueScore(row.__ptcRecord, state.prices);
      renderValueBadge(row);
      applyNewBadge(row, row.__ptcRecord);
      applyValueSort();
      return;
    }
    if (!valueQueue.includes(id) && valueQueue.length < VALUE_FETCH_LIMIT) {
      valueQueue.push(id);
      pumpValueQueue();
    }
  }

  async function pumpValueQueue() {
    if (valueWorking) return;
    valueWorking = true;
    while (valueQueue.length) {
      /* While the trade site throttles this IP, the queue waits instead of
         knocking on a closed door. */
      if (tradeBlockRemaining()) {
        await sleep(Math.min(30000, tradeBlockRemaining()));
        if (tradeBlockRemaining()) {
          /* Still blocked. Keep the queue and come back when the penalty ends:
             breaking here leaves these ids in it with nothing to restart it,
             unless a new row happens to arrive. */
          valueWorking = false;
          setTimeout(pumpValueQueue, Math.min(30000, Math.max(1000, tradeBlockRemaining())));
          return;
        }
      }
      const id = valueQueue.shift();
      const row = findRow(id);
      if (!row) continue;
      try {
        const record = await hydrateRow(id, row);
        if (record) {
          row.__ptcValue = valueScore(record, state.prices);
          renderValueBadge(row);
          applyNewBadge(row, record);
          applyValueSort();
        }
      } catch (error) {
        /* item gone or rate limited */
      }
      await sleep(450);
    }
    valueWorking = false;
  }

  function findRow(id) {
    try {
      const row = document.querySelector('.row[data-id="' + CSS.escape(id) + '"]');
      return row && row.closest('.resultset') ? row : null;
    } catch (error) {
      return null;
    }
  }

  async function hydrateRow(id, knownRow) {
    const row = knownRow || findRow(id);
    if (!row) return null;
    if (row.__ptcRecord) return row.__ptcRecord;
    const entry = await fetchEntry(id);
    /* The site recycles rows: if this element now shows another listing, the
       record built from it belongs to nobody. */
    if (rowId(row) !== id) return null;
    const record = buildRecord(entry, id, row);
    row.__ptcRecord = record;
    const problems = compareRowWithApi(row, record);
    row.__ptcMismatch = problems;
    if (problems.length) {
      console.warn('[PTC] trade page and API disagree for listing ' + id, problems);
    }
    const box = row.querySelector('.ptc-actions');
    if (box) applyRecordMeta(row, box);
    applyNewBadge(row, record);
    return record;
  }

  function applyNewBadge(row, record) {
    let old = row.querySelector('.ptc-fresh');
    const listing = (record && record.listing) || {};
    const raw = listing.dateListed || listing.indexed || '';
    let age = null;
    if (raw) {
      const ts = parseListingDate(raw);
      if (ts != null) age = Date.now() - ts;
    }
    if (age != null && age >= -5 * 60 * 1000 && age <= 5 * 60 * 1000) {
      if (!old) {
        old = document.createElement('span');
        old.className = 'ptc-fresh';
        const header = row.querySelector('.itemHeader') || row;
        header.appendChild(old);
      }
      old.textContent = 'new';
      old.title = 'Listed in the last 5 minutes';
    } else if (old) {
      old.remove();
    }
  }

  function applyValueSort() {
    if (!state.settings.valueSortPage) return;
    const rows = topRows();
    if (rows.length < 2) return;
    const container = rows[0].parentElement;
    if (!container) return;
    const scored = rows.filter((row) => typeof row.__ptcValue === 'number')
      .sort((a, b) => a.__ptcValue - b.__ptcValue);
    if (scored.length < 2) return;
    const unscored = rows.filter((row) => typeof row.__ptcValue !== 'number');
    const expected = scored.concat(unscored);
    for (let index = 0; index < expected.length; index += 1) {
      if (rows[index] !== expected[index]) {
        expected.forEach((row) => container.appendChild(row));
        return;
      }
    }
  }

  function domNumbers(row) {
    const out = {};
    row.querySelectorAll('[data-field]').forEach((node) => {
      const field = node.getAttribute('data-field');
      if (!field) return;
      const match = /(-?\d+(?:\.\d+)?)/.exec(cleanText(node.textContent));
      if (match) out[field] = Number(match[1]);
    });
    return out;
  }

  function domModTexts(row) {
    const out = [];
    row.querySelectorAll('.item-mod').forEach((node) => {
      const text = cleanText((node.querySelector('.s.lc') || node).textContent);
      if (text) out.push(text.replace(/(-?\d+(?:\.\d+)?)/g, '#'));
    });
    return out;
  }

  function apiModTexts(record) {
    const out = [];
    const item = (record && record.item) || {};
    Object.keys(item).filter((key) => /Mods$/.test(key)).forEach((key) => {
      const value = item[key];
      const list = Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []);
      list.forEach((entry) => {
        const text = cleanText((entry && (entry.text || entry.description)) || '');
        if (text) out.push(text.replace(/(-?\d+(?:\.\d+)?)/g, '#'));
      });
    });
    return out;
  }

  function compareRowWithApi(row, record) {
    const problems = [];
    const dom = domNumbers(row);
    const item = (record && record.item) || {};
    if (Number.isFinite(Number(item.ilvl)) && Number.isFinite(dom.ilvl) && Number(item.ilvl) !== dom.ilvl) {
      problems.push('ilvl api ' + item.ilvl + ' vs dom ' + dom.ilvl);
    }
    const qualityProp = (item.properties || []).find((prop) => prop && /quality/i.test(String(prop.name || '')));
    if (qualityProp && Array.isArray(qualityProp.values) && qualityProp.values.length) {
      const apiQuality = Number(String(qualityProp.values[0][0] || '').replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(apiQuality) && Number.isFinite(dom.quality) && apiQuality !== dom.quality) {
        problems.push('quality api ' + apiQuality + ' vs dom ' + dom.quality);
      }
    }
    const domMods = domModTexts(row);
    const apiMods = apiModTexts(record);
    if (domMods.length && apiMods.length && domMods.length !== apiMods.length) {
      problems.push('modifier count api ' + apiMods.length + ' vs dom ' + domMods.length);
    }
    domMods.forEach((text) => {
      if (!apiMods.includes(text)) problems.push('modifier only in dom: ' + text);
    });
    const price = (record && record.listing && record.listing.price) || null;
    if (price && Number.isFinite(Number(price.amount))) {
      const domPrice = /(\d+(?:\.\d+)?)\s*[x×]/.exec(rowPriceText(row) || '');
      if (domPrice && Math.abs(Number(domPrice[1]) - Number(price.amount)) > 0.001) {
        problems.push('price api ' + price.amount + ' vs dom ' + domPrice[1]);
      }
    }
    return problems;
  }

  function applyRowMeta(row, box) {
    const meta = box.querySelector('.ptc-meta');
    if (!meta) return;
    const parts = [];
    const problems = row.__ptcMismatch;
    if (problems && problems.length) parts.push('⚠ ' + problems.length + ' api/dom mismatch');
    const record = row.__ptcRecord;
    if (record) {
      const item = record.item || {};
      const listing = record.listing || {};
      if (Number.isFinite(Number(item.ilvl))) parts.push('ilvl ' + item.ilvl);
      const qualityProp = (item.properties || []).find((prop) => prop && /quality/i.test(String(prop.name || '')));
      const qualityValue = qualityProp && Array.isArray(qualityProp.values) && qualityProp.values.length
        ? String(qualityProp.values[0][0] || '').replace(/^\+/, '')
        : '';
      if (qualityValue) parts.push('q' + qualityValue);
      if (listing.verified) parts.push('verified');
      if (listing.account && listing.account.online) parts.push('online');
      if (listing.stash && listing.stash.name) {
        const pos = listing.stash.x != null && listing.stash.y != null ? ' (' + listing.stash.x + ',' + listing.stash.y + ')' : '';
        parts.push('stash ' + listing.stash.name + pos);
      }
      if (Number.isFinite(Number(listing.fee)) && Number(listing.fee) > 0) parts.push('fee ' + Math.round(Number(listing.fee)));
    }
    setText(meta, parts.join(' · '));
  }

  function applyRecordMeta(row, box) {
    const rec = row.__ptcRecord;
    applyRowMeta(row, box);
    if (!rec) return;
    const ign = box.querySelector('.ptc-ign');
    if (ign) {
      const name = cleanText(rec.ign) || cleanText((rec.listing || {}).account && rec.listing.account.name);
      setText(ign, state.settings.showIgn && name ? 'IGN ' + name : '');
    }
  }

  function rowHaystack(row) {
    const parts = [];
    /* The trade sites show the item's name, its modifiers and its price in
       the popup that sits inside the row, so all of it is searchable. */
    row.querySelectorAll('.itemHeader, .itemStats, .item-popup__header-line, .item-mod, .price, .account').forEach((node) => {
      parts.push(node.textContent);
    });
    return parts.join(' ');
  }

  function clearMarks() {
    document.querySelectorAll('mark.ptc-hit').forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
  }

  function markNode(root, terms) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement && node.parentElement.closest('mark.ptc-hit, .ptc-actions')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const value = node.nodeValue;
      const lower = value.toLowerCase();
      let hit = null;
      for (const term of terms) {
        const index = lower.indexOf(term);
        if (index !== -1 && (!hit || index < hit.index)) hit = { index, length: term.length };
      }
      if (!hit) return;
      const before = value.slice(0, hit.index);
      const match = value.slice(hit.index, hit.index + hit.length);
      const after = value.slice(hit.index + hit.length);
      const mark = document.createElement('mark');
      mark.className = 'ptc-hit';
      mark.textContent = match;
      const parent = node.parentNode;
      if (!parent) return;
      if (before) parent.insertBefore(document.createTextNode(before), node);
      parent.insertBefore(mark, node);
      if (after) parent.insertBefore(document.createTextNode(after), node);
      parent.removeChild(node);
    });
  }

  function applyFilterAndMarks() {
    if (!state.page) return;
    const query = state.filterQuery.trim();
    const useFilter = state.settings.fuzzyResults && query.length >= 1;
    const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length >= 2);

    if (!useFilter) clearMarks();

    /* The marks belong to the query that made them: editing the filter has to
       drop them, or the old highlights stay while the new terms are ignored. */
    if (state.marksQuery !== query) {
      clearMarks();
      document.querySelectorAll('.ptc-row').forEach((row) => { delete row.dataset.ptcMarked; });
      state.marksQuery = query;
    }

    topRows().forEach((row) => {
      if (!useFilter) {
        row.classList.remove('ptc-hidden');
        return;
      }
      const match = fuzzyMatch(rowHaystack(row), query);
      row.classList.toggle('ptc-hidden', !match);
      if (match && state.settings.highlightStats && terms.length && !row.dataset.ptcMarked) {
        row.dataset.ptcMarked = '1';
        row.querySelectorAll('.itemHeader, .itemStats, .item-popup__header-line, .item-mod').forEach((node) => markNode(node, terms));
      }
    });

    if (!useFilter) {
      document.querySelectorAll('.ptc-row').forEach((row) => {
        delete row.dataset.ptcMarked;
        row.classList.remove('ptc-hidden');
      });
    }
  }

  function enhanceRow(row) {
    try {
      enhanceRowUnsafe(row);
    } catch (error) {
      console.warn('[PTC] could not enhance a row', error);
    }
  }

  function enhanceRowUnsafe(row) {
    const id = rowId(row);
    if (!id) return;
    row.classList.add('ptc-row');

    if (row.dataset.ptcId !== id) {
      row.dataset.ptcId = id;
      row.__ptcRecord = null;
      row.querySelectorAll('.ptc-actions').forEach((node) => node.remove());
      row.querySelectorAll('.ptc-hidden-by-ptc').forEach((node) => node.classList.remove('ptc-hidden-by-ptc'));
      delete row.dataset.ptcPrice;
      delete row.dataset.ptcMarked;
      /* The value badge and the row/API mismatch belong to the listing that used
         to be in this element; live searches reuse the same row for another id. */
      delete row.__ptcValue;
      delete row.__ptcMismatch;
      row.classList.remove('ptc-blacklisted');
    }

    let box = row.querySelector('.ptc-actions');
    if (!box || !box.isConnected) {
      box = buildActions();
      placeActions(row, box);
      updateSaveButton(box.querySelector('.ptc-save'), id);
      updateWatchButton(box.querySelector('.ptc-watch'), id);
    }

      updateSaveButton(box.querySelector('.ptc-save'), id);
      updateWatchButton(box.querySelector('.ptc-watch'), id);
    applyBlacklist(row);
    applyRecordMeta(row, box);
    applySellerAlert(row);
    trackNewRow(row, id);
    reportPriceSample(row, id);
    queueValue(row);
  }

  function fillSearchBox(term) {
    const input = document.querySelector('.search-panel input[type="text"], .search-panel input[type="search"]');
    if (!input) return;
    input.value = term;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const form = input.closest('form');
    if (form) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  /*
   * Older links opened a league page with "#ptc-search=<base>" and expected the
   * extension to type into the site's search box, which today's trade site
   * ignores. Instead, create a real search through the trade API and jump to
   * its canonical result URL.
   */
  async function applyHashSearch() {
    const hash = location.hash || '';
    const match = /[#&]ptc-search=([^&]+)/.exec(hash);
    if (!match) return;
    const decode = (value) => {
      try {
        return decodeURIComponent(value);
      } catch (error) {
        return value;
      }
    };
    const term = decode(match[1]).trim();
    // Build codes carry the quality prefix ("Superior Ancestral Tiara") and the
    // trade site refuses it as an unknown base type.
    const baseType = term.replace(/^(superior|synthesised|fractured|replica)\s+/i, '').trim() || term;
    if (!baseType) return;
    const info = parseTradeUrl(location.href);
    if (!info || !info.league) return;
    const handledKey = 'ptc-hash:' + location.pathname + hash;
    try {
      if (sessionStorage.getItem(handledKey)) return;
      sessionStorage.setItem(handledKey, '1');
    } catch (error) {
      /* sessionStorage unavailable */
    }
    const query = { status: { option: SEARCH_STATUS }, type: baseType };
    const nameMatch = /[#&]ptc-name=([^&]+)/.exec(hash);
    const uniqueName = nameMatch ? decode(nameMatch[1]).trim() : '';
    if (uniqueName && uniqueName.toLowerCase() !== baseType.toLowerCase()) query.name = uniqueName;
    const endpoint = globalThis.PTC_GAMES.searchApiUrl(info.game, info.league);
    const create = (body) => fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: body, sort: { price: 'asc' } }),
    });
    try {
      let response = await create(query);
      // A stored base can be stale (renamed, or an item class from an older
      // version). Fall back to a plain name search before giving up.
      if (!response.ok && uniqueName) response = await create({ status: { option: SEARCH_STATUS }, name: uniqueName });
      if (response.ok) {
        const data = await response.json();
        if (data && data.id) {
          /* Swap the id into the URL that is already open, so the link keeps
             the shape the trade site itself uses. */
          const current = location.origin + location.pathname.replace(/\/+$/, '');
          const oldId = info.queryId;
          let next = current;
          if (oldId) {
            const encodedOld = encodeURIComponent(oldId);
            if (current.indexOf(encodedOld) !== -1) next = current.split(encodedOld).join(encodeURIComponent(data.id));
            else if (current.indexOf(oldId) !== -1) next = current.split(oldId).join(data.id);
          }
          if (next === current) next = current + '/' + encodeURIComponent(data.id);
          location.replace(next);
          return;
        }
      }
    } catch (error) {
      /* fall through to the in-page search box */
    }
    fillSearchBox(baseType);
  }

  /*
   * v2 label test: besides the colour, write the domain (crafted / fractured /
   * desecrated) right next to the P1/S2 tier label inside the open item popup.
   * Both trade sites use the same popup markup, so the same labels work for
   * PoE 1 and PoE 2 - only the domains that exist differ.
   */
  const DOMAIN_MARKERS = {
    'item-mod--crafted': 'crafted',
    'item-mod--fractured': 'fractured',
    'item-mod--desecrated': 'desecrated',
    'item-mod--rune': 'rune',
    'item-mod--enchant': 'enchant',
    'item-mod--veiled': 'veiled',
    'item-mod--scourge': 'scourge',
    'item-mod--delve': 'delve',
    'item-mod--implicit': 'implicit',
  };

  function enhancePopup() {
    if (!state.page) return;
    if (state.settings.modDomainLabels === false) {
      document.querySelectorAll('.item-popup__content .ptc-domain').forEach((node) => node.remove());
      return;
    }
    const mods = document.querySelectorAll('.item-popup__content .item-mod');
    mods.forEach((node) => {
      const cls = String(node.className || '');
      let kind = null;
      for (const marker of Object.keys(DOMAIN_MARKERS)) {
        if (cls.indexOf(marker) !== -1) {
          kind = DOMAIN_MARKERS[marker];
          break;
        }
      }
      if (!kind) return;
      const tier = node.querySelector('.lc.l');
      if (!tier || tier.querySelector('.ptc-domain')) return;
      const span = document.createElement('span');
      span.className = 'ptc-domain';
      span.textContent = ' ' + kind;
      tier.appendChild(span);
    });
  }

  function enhanceAll() {
    if (!alive() || !state.page) return;
    ensureToolbar();
    topRows().forEach(enhanceRow);
    enhancePopup();
  }

  let frameScheduled = false;
  function scheduleEnhance() {
    if (frameScheduled) return;
    frameScheduled = true;
      requestAnimationFrame(() => {
        frameScheduled = false;
        enhanceAll();
        applyValueSort();
        positionLegend();
        if (state.filterQuery && state.settings.fuzzyResults) applyFilterAndMarks();
      });
  }

  /* ------------------------------- fetching ------------------------------ */

  function apiPrefix() {
    /* The path segment ("trade" / "trade2") belongs to the game configuration,
       not to a branch in here: one place decides it, ptc-games.js. */
    return globalThis.PTC_GAMES.config(state.page && state.page.game).tradePath;
  }

  /*
   * The trade site throttles by IP and answers an over-eager client with
   * "Please wait N seconds before trying again". The page itself keeps
   * searching, but every request the extension starts counts as well, so the
   * extension stops asking while the penalty is active.
   */
  let tradeBlockedUntil = 0;

  function tradeBlockRemaining() {
    return Math.max(0, tradeBlockedUntil - Date.now());
  }

  function noteTradeRateLimit(body) {
    const match = /wait (\d+) seconds/i.exec(String(body || ''));
    const seconds = match ? Number(match[1]) : 60;
    const wait = Math.min(60 * 60 * 1000, Math.max(30 * 1000, (seconds || 60) * 1000));
    tradeBlockedUntil = Date.now() + wait;
    return wait;
  }

  async function fetchEntry(itemId, queryId) {
    if (tradeBlockRemaining()) {
      throw new Error('the trade site is rate limiting this IP, try again in a few minutes');
    }
    const url = new URL('/api/' + apiPrefix() + '/fetch/' + encodeURIComponent(itemId), location.origin);
    const q = queryId || (state.page && state.page.queryId);
    if (q) url.searchParams.set('query', q);
    let response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      response = await fetch(url.toString(), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new Error('the API connection failed');
    }
    clearTimeout(timer);
    if (response.status === 429) {
      const text = await response.text().catch(() => '');
      const wait = noteTradeRateLimit(text);
      throw new Error('rate limited, the trade site asked us to wait ' + Math.round(wait / 1000) + ' seconds');
    }
    if (!response.ok) throw new Error('API responded with HTTP ' + response.status);
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error('invalid API response');
    }
    const results = Array.isArray(data && data.result) ? data.result : [];
    /* Only the answer about this id counts: a fallback to any result would save
       another listing's item under this row's id. */
    const entry = results.find((item) => item && item.id === itemId);
    if (!entry || !entry.item) throw new Error('the item is no longer listed');
    return entry;
  }

  function listingPrice(listing) {
    let price = listing && listing.price;
    if (!price && listing && Array.isArray(listing.offers)) {
      const offer = listing.offers.find((entry) => entry && entry.price);
      if (offer) price = offer.price;
    }
    if (!price) return { priceText: '', priceAmount: null, priceCurrency: '' };
    const raw = price.exchange || price;
    const amount = typeof raw.amount === 'number' ? raw.amount : null;
    let currency = raw.currency;
    if (currency && typeof currency === 'object') {
      currency = currency.currency || currency.name || currency.type || '';
    }
    currency = cleanText(currency);
    if (amount == null || !currency) {
      return { priceText: cleanText(price.type), priceAmount: null, priceCurrency: currency };
    }
    return {
      priceText: amount + ' x ' + currency.charAt(0).toUpperCase() + currency.slice(1),
      priceAmount: amount,
      priceCurrency: currency,
    };
  }

  function displayName(item) {
    const name = cleanGameText(item && item.name);
    const typeLine = cleanGameText(item && item.typeLine);
    if (name && typeLine && name !== typeLine) return name + ' - ' + typeLine;
    return name || typeLine || 'Item';
  }

  function stashInfo(stash) {
    if (!stash || typeof stash !== 'object') return null;
    const tab = cleanText(stash.name);
    if (!tab) return null;
    return {
      tab,
      x: Number.isFinite(stash.x) ? Math.trunc(stash.x) : null,
      y: Number.isFinite(stash.y) ? Math.trunc(stash.y) : null,
    };
  }

  function domModInfo(row) {
    if (!row || typeof row.querySelectorAll !== 'function') return [];
    const mods = [];
    row.querySelectorAll('.item-mod').forEach((node) => {
      const cls = String(node.className || '');
      let kind = 'explicit';
      if (cls.indexOf('item-mod--crafted') !== -1) kind = 'crafted';
      else if (cls.indexOf('item-mod--fractured') !== -1) kind = 'fractured';
      else if (cls.indexOf('item-mod--desecrated') !== -1) kind = 'desecrated';
      else if (cls.indexOf('item-mod--rune') !== -1) kind = 'rune';
      else if (cls.indexOf('item-mod--veiled') !== -1) kind = 'veiled';
      else if (cls.indexOf('item-mod--enchant') !== -1) kind = 'enchant';
      else if (cls.indexOf('item-mod--scourge') !== -1) kind = 'scourge';
      else if (cls.indexOf('item-mod--delve') !== -1) kind = 'delve';
      else if (cls.indexOf('item-mod--implicit') !== -1) kind = 'implicit';
      const textNode = node.querySelector('.s.lc');
      const text = cleanText(textNode && textNode.textContent);
      if (!text) return;
      const tierText = cleanText((node.querySelector('.lc.l') || {}).textContent);
      const nameText = cleanText((node.querySelector('.lc.r') || {}).textContent);
      const tierMatch = /([PS])(\d+)/.exec(tierText);
      const rangeMatch = /\[(\d+)[—–-](\d+)\]/.exec(tierText);
      const name = cleanText((nameText || '').split('(')[0] || '');
      // A line made of two affixes shows "P4 [45—50] + P4 [23—26]"; keep every tier.
      const tierParts = [];
      const tierPattern = /([PS])(\d+)\s*\[(\d+(?:\.\d+)?)[—–-](\d+(?:\.\d+)?)\]/g;
      const nameParts = (nameText || '').split('+').map((part) => cleanText(part.replace(/\([^)]*\)/g, '')));
      let tierHit = null;
      while ((tierHit = tierPattern.exec(tierText))) {
        tierParts.push({
          type: tierHit[1] === 'S' ? 'suffix' : 'prefix',
          tier: Number(tierHit[2]),
          min: Number(tierHit[3]),
          max: Number(tierHit[4]),
          name: nameParts[tierParts.length] || name,
        });
      }
      mods.push({
        sources: tierParts.length > 1 ? tierParts : undefined,
        kind: kind,
        text: text,
        type: tierMatch ? (tierMatch[1] === 'S' ? 'suffix' : 'prefix') : '',
        tier: tierMatch ? Number(tierMatch[2]) : 0,
        name: name,
        min: rangeMatch ? Number(rangeMatch[1]) : null,
        max: rangeMatch ? Number(rangeMatch[2]) : null,
      });
    });
    return mods;
  }

  function buildRecord(entry, id, row) {
    const item = entry.item;
    const listing = entry.listing && typeof entry.listing === 'object' ? entry.listing : {};
    const price = listingPrice(listing);
    const account = listing.account && typeof listing.account === 'object' ? listing.account : {};
    const ign = cleanText(account.lastCharacterName) || cleanText(account.name);
    const icon = safeIconUrl(item.icon);
    const searchUrl = baseSearchUrl();
    const info = state.page;
    return {
      schemaVersion: 2,
      id,
      savedAt: Date.now(),
      savedAtIso: new Date().toISOString(),
      game: info.game,
      item,
      listing,
      icon,
      name: displayName(item),
      typeLine: cleanGameText(item.typeLine),
      rarity: Number.isInteger(item.frameType) ? item.frameType : null,
      priceText: price.priceText,
      priceAmount: price.priceAmount,
      priceCurrency: price.priceCurrency,
      account: cleanText(account.name),
      ign,
      whisper: cleanText(listing.whisper),
      whisperToken: cleanText(listing.whisper_token),
      stash: stashInfo(listing.stash),
      league: info.league,
      queryId: info.queryId,
      live: !!info.live,
      searchUrl,
      coeMods: row ? domModInfo(row) : [],
      sourceUrl: location.href,
    };
  }

  function recordToWatcher(record) {
    return {
      itemId: record.id,
      game: record.game,
      league: record.league,
      queryId: record.queryId,
      live: record.live,
      name: record.name,
      icon: record.icon,
      priceText: record.priceText,
      priceAmount: record.priceAmount,
      priceCurrency: record.priceCurrency,
      account: record.account,
      ign: record.ign,
      whisper: record.whisper,
      whisperToken: record.whisperToken,
      stash: record.stash,
      searchUrl: record.searchUrl,
      coeMods: record.coeMods,
      item: record.item,
    };
  }

  /* ------------------------------- actions ------------------------------- */


  async function onSaveClick(button) {
    if (button.dataset.busy) return;
    const row = button.closest('.row');
    if (!row) return;
    const id = rowId(row);
    if (!id) return;

    if (state.saved.has(keyFor(id))) {
      setButtonBusy(button, true, 'Removing...');
      const response = await send({ type: 'ptc:delete', id });
      setButtonBusy(button, false);
      /* Whatever happened, the label goes back to the truth of the collection:
         a refused or timed-out delete used to leave "Removing..." on the row. */
      updateSaveButton(button, id);
      if (!response || !response.ok) {
        toast('Could not remove the item. The save is still there.', 'error');
      } else {
        state.saved.delete(keyFor(id));
        updateSaveButton(button, id);
        toast('Item removed from the collection.');
      }
      return;
    }

    setButtonBusy(button, true, 'Saving...');
    try {
      const entry = await fetchEntry(id);
      if (rowId(row) !== id) throw new Error('the listing changed, try again');
      /* Always Unsorted: the build selected in the panel is a filter (what you
         are looking at), not an instruction for where a new save goes. A saved
         item moves into a build when the player says so. */
      const record = buildRecord(entry, id, row);
      record.collectionId = '';
      const response = await send({ type: 'ptc:save', record });
      if (!response || !response.ok) throw new Error((response && response.error) || 'save failed');
      state.saved.add(keyFor(id));
      row.__ptcRecord = record;
      const box = row.querySelector('.ptc-actions');
      if (box) applyRecordMeta(row, box);
      updateSaveButton(button, id);
      if (response.duplicate) {
        toast('Item is already saved.');
      } else {
        toast('Item saved to Unsorted (' + (response.count || 1) + ' items). Assign it to a build from the panel.');
      }
    } catch (error) {
      toast('Could not save the item: ' + (error.message || 'unknown error'), 'error');
    } finally {
      setButtonBusy(button, false);
      updateSaveButton(button, id);
    }
  }

  async function onWatchClick(button) {
    if (button.dataset.busy) return;
    const row = button.closest('.row');
    if (!row) return;
    const id = rowId(row);
    if (!id) return;
    const existing = state.watched.get(keyFor(id));

    if (existing) {
      setButtonBusy(button, true, 'Stopping...');
      const response = await send({ type: 'ptc:watch:remove', id: existing.id });
      setButtonBusy(button, false);
      updateWatchButton(button, id);
      if (!response || !response.ok) {
        toast('Could not stop watching the item. The watcher is still there.', 'error');
      } else {
        state.watched.delete(keyFor(id));
        updateWatchButton(button, id);
        toast('Stopped watching.');
      }
      return;
    }

    setButtonBusy(button, true, 'Watching...');
    try {
      const entry = await fetchEntry(id);
      if (rowId(row) !== id) throw new Error('the listing changed, try again');
      const record = buildRecord(entry, id, row);
      const response = await send({ type: 'ptc:watch:add', record: recordToWatcher(record) });
      if (!response || !response.ok) throw new Error((response && response.error) || 'watch failed');
      state.watched.set(keyFor(id), response.watcher);
      row.__ptcRecord = record;
      const box = row.querySelector('.ptc-actions');
      if (box) applyRecordMeta(row, box);
      updateWatchButton(button, id);
      toast(response.duplicate ? 'This item is already watched.' : 'Watching this listing.');
    } catch (error) {
      toast('Could not watch the item: ' + (error.message || 'unknown error'), 'error');
    } finally {
      setButtonBusy(button, false);
      updateWatchButton(button, id);
    }
  }

  /* One click posts the item to the configured Discord webhook. Without one (or
     when Discord refuses it) the message is copied instead, so nothing is lost. */
  async function onDiscordClick(button) {
    if (button.dataset.busy) return;
    const row = button.closest('.row');
    if (!row) return;
    const id = rowId(row);
    if (!id) return;
    setButtonBusy(button, true, 'Sending...');
    try {
      const entry = await fetchEntry(id);
      const record = buildRecord(entry, id, row);
      const text = discordText(record);
      let result = null;
      try {
        result = await send({
          type: 'ptc:discord:send',
          title: record.name,
          message: text,
          icon: record.icon,
          corrupted: !!(record.item && (record.item.corrupted || record.item.doubleCorrupted)),
        });
      } catch (error) {
        result = null;
      }
      if (result && result.ok) {
        toast('Sent this item to your Discord channel.');
        return;
      }
      const copied = await copyToClipboard(text);
      if (result && result.configured) {
        toast('Discord rejected the message (' + (result.error || 'unknown error') + '). Copied it to the clipboard instead.', 'error');
      } else if (result && !result.configured) {
        toast('No Discord webhook is set. Add one in Settings, then try again: the message was copied to the clipboard.', 'warn');
      } else {
        toast(copied ? 'Copied a Discord message for this item.' : 'Could not copy to the clipboard.', copied ? 'ok' : 'error');
      }
    } catch (error) {
      toast('Could not send the item: ' + (error.message || 'unknown error'), 'error');
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      /* fall through to the textarea trick */
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (error) {
      return false;
    }
  }

  async function onWatchCheckRequest(message, sendResponse) {
    const items = Array.isArray(message.items) ? message.items : [];
    const results = [];
    for (const item of items) {
      if (!item || !item.itemId) continue;
      const url = new URL('/api/' + globalThis.PTC_GAMES.config(item.game).tradePath + '/fetch/' + encodeURIComponent(item.itemId), location.origin);
      if (item.queryId) url.searchParams.set('query', item.queryId);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(url.toString(), {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        if (!response.ok) {
          results.push({ id: item.itemId, error: 'HTTP ' + response.status });
        } else {
          results.push({ id: item.itemId, data: await response.json() });
        }
      } catch (error) {
        results.push({ id: item.itemId, error: 'network' });
      }
      await sleep(350);
    }
    sendResponse({ results });
  }

  /* -------------------------------- data --------------------------------- */

  function loadCollections() {
    if (!alive()) return;
    try {
      chrome.storage.local.get({
        savedItems: [],
        watchedItems: [],
        ptcSettings: {},
      }, (data) => {
        if (chrome.runtime.lastError) return;
        state.settings = normalizeSettings(data.ptcSettings);
        state.saved.clear();
        (Array.isArray(data.savedItems) ? data.savedItems : []).forEach((entry) => {
          if (entry && entry.id) state.saved.add(globalThis.PTC_GAMES.normalizeGame(entry.game) + ':' + entry.id);
        });
        state.watched.clear();
        (Array.isArray(data.watchedItems) ? data.watchedItems : []).forEach((entry) => {
          if (entry && entry.itemId) state.watched.set(globalThis.PTC_GAMES.normalizeGame(entry.game) + ':' + entry.itemId, entry);
        });
        refreshRows();
        applyFilterAndMarks();
      });
    } catch (error) {
      /* context invalidated */
    }
  }

  function refreshRows() {
    topRows().forEach((row) => {
      const id = rowId(row);
      if (!id) return;
      const box = row.querySelector('.ptc-actions');
      if (!box) return;
      updateSaveButton(box.querySelector('.ptc-save'), id);
      updateWatchButton(box.querySelector('.ptc-watch'), id);
      applyRecordMeta(row, box);
    });
  }

  async function loadPrices() {
    if (!state.page || !state.page.league || !state.settings.showConversions) return;
    const key = state.page.game + ':' + state.page.league.toLowerCase();
    if (state.pricesFor === key && state.prices) return;
    const response = await send({ type: 'ptc:prices:get', game: state.page.game, league: state.page.league });
    if (!response || !response.ok) return;
    state.prices = response.prices;
    state.pricesFor = key;
    refreshRows();
  }

  function sendHistory() {
    if (!state.page || !state.page.queryId) return;
    const key = baseSearchUrl();
    if (state.historySent === key) return;
    state.historySent = key;
    send({
      type: 'ptc:history:add',
      payload: {
        url: key,
        game: state.page.game,
        league: state.page.league,
        queryId: state.page.queryId,
        name: deriveName(),
      },
    });
  }

  function sendActive() {
    if (!state.page || !state.page.queryId) return;
    send({
      type: 'ptc:trade:active',
      url: baseSearchUrl(),
      name: deriveName(),
    });
  }

  /* ------------------------------ lifecycle ------------------------------ */

  function syncPage() {
    const info = pageInfo();
    const key = info ? [info.game, info.league, info.queryId, info.live].join('|') : '';
    if (key === state.pageKey) return;
    const previous = state.page;
    state.pageKey = key;
    state.page = info;
    if (!previous || previous.game !== (info && info.game)) refreshLegend();
    state.prices = null;
    state.pricesFor = '';
    state.historySent = '';
    state.filterQuery = '';
    state.marksQuery = '';
    /* The box would otherwise show a query that no longer filters anything. */
    if (filterInput) filterInput.value = '';
    if (!info) return;
    if (previous && previous.queryId && previous.queryId !== info.queryId) {
      send({
        type: 'ptc:watch:refresh-query',
        payload: {
          game: info.game,
          league: info.league,
          oldQueryId: previous.queryId,
          queryId: info.queryId,
          searchUrl: baseSearchUrl(),
          live: !!info.live,
        },
      });
    }
    loadCollections();
    loadPrices();
    sendActive();
    sendHistory();
    scheduleEnhance();
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.savedItems || changes.watchedItems || changes.ptcSettings) {
        loadCollections();
      }
    });
  } catch (error) {
    /* extension context invalidated */
  }

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== 'ptc:watch:check') return;
      onWatchCheckRequest(message, sendResponse);
      return true;
    });
  } catch (error) {
    /* extension context invalidated */
  }

  function searchLooksExpired() {
    if (!state.page || !state.page.queryId) return false;
    const body = document.body;
    if (!body) return false;
    let text = '';
    try {
      text = (body.textContent || '').toLowerCase();
    } catch (error) {
      return false;
    }
    if (!text) return false;
    return text.indexOf('no longer valid') !== -1
      || text.indexOf('failed to load search state') !== -1
      || text.indexOf('search state is invalid') !== -1;
  }

  function showExpiredSearchBanner() {
    if (document.querySelector('.ptc-expired-search')) return;
    const league = state.page && state.page.league ? state.page.league : '';
    const banner = document.createElement('div');
    banner.className = 'ptc-expired-search';
    banner.setAttribute('role', 'status');
    const text = document.createElement('div');
    text.className = 'ptc-expired-text';
    text.textContent = 'This saved search is no longer valid'
      + (league ? ' (' + league + ')' : '')
      + '. Path of Exile expired the search id, so the filters cannot be restored.';
    const actions = document.createElement('div');
    actions.className = 'ptc-expired-actions';
    const fresh = document.createElement('button');
    fresh.type = 'button';
    fresh.className = 'ptc-expired-btn';
    fresh.textContent = 'Open a fresh search';
    fresh.addEventListener('click', () => {
      const url = buildLeagueSearchUrl(state.page.game, state.page.league);
      if (url) location.href = url;
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'ptc-expired-btn ghost';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => banner.remove());
    actions.appendChild(fresh);
    actions.appendChild(dismiss);
    banner.appendChild(text);
    banner.appendChild(actions);
    document.body.appendChild(banner);
  }

  function checkExpiredSearch() {
    if (!searchLooksExpired()) return;
    showExpiredSearchBanner();
  }

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(syncPage, 1200);
  let expiredChecks = 0;
  const expiredTimer = setInterval(() => {
    expiredChecks += 1;
    if (expiredChecks > 20) {
      clearInterval(expiredTimer);
      return;
    }
    checkExpiredSearch();
  }, 2500);
  syncPage();
  scheduleEnhance();
  setTimeout(applyHashSearch, 600);
})();









