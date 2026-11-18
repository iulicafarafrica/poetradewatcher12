(() => {
  'use strict';

  const RARITY = {
    0: ['normal', 'Normal'],
    1: ['magic', 'Magic'],
    2: ['rare', 'Rare'],
    3: ['unique', 'Unique'],
    4: ['gem', 'Gem'],
    5: ['currency', 'Currency'],
    6: ['divination', 'Divination Card'],
    7: ['quest', 'Quest'],
    8: ['prophecy', 'Prophecy'],
    9: ['relic', 'Relic'],
  };

  const MOD_GROUPS = [
    { key: 'implicitMods', label: 'Implicit', kind: 'implicit' },
    { key: 'enchantMods', label: 'Enchant', kind: 'enchant' },
    { key: 'runeMods', label: 'Rune', kind: 'rune' },
    { key: 'explicitMods', label: 'Explicit', kind: 'explicit' },
    { key: 'craftedMods', label: 'Crafted', kind: 'crafted' },
    { key: 'fracturedMods', label: 'Fractured', kind: 'fractured' },
    { key: 'desecratedMods', label: 'Desecrated', kind: 'desecrated' },
    { key: 'scourgeMods', label: 'Scourge', kind: 'scourge' },
    { key: 'utilityMods', label: 'Utility', kind: 'utility' },
    { key: 'bondedMods', label: 'Bonded', kind: 'bonded' },
  ];

  /* The offline fallback values live in the game's own profile (ptc-poe1.js /
     ptc-poe2.js). A profile that failed to load yields no table: values fall
     back to the smallest weight instead of borrowing the other game's economy. */
  function fallbackWeightTable(game) {
    const profile = globalThis.PTC_GAMES && globalThis.PTC_GAMES.profile
      ? globalThis.PTC_GAMES.profile(game) : null;
    return (profile && profile.currencyWeight) || {};
  }

  function createEl(tag, className, textValue) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue != null) node.textContent = textValue;
    return node;
  }

  function text(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  }

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function cleanGameText(value) {
    return String(value == null ? '' : value)
      .replace(/<<[^>]*>>/g, ' ')
      .replace(/\[([^\]|]+)(?:\|([^\]]+))?\]/g, (match, key, display) => display || key)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanMod(value) {
    let raw = '';
    if (typeof value === 'string') raw = value;
    else if (value && typeof value === 'object') {
      raw = value.text || value.description || value.string || value.name || value.label || value.value || '';
    }
    return cleanGameText(raw);
  }

  function modDomainKind(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const flags = entry.flags && typeof entry.flags === 'object' ? entry.flags : {};
    const map = {
      implicit: 'implicit',
      explicit: 'explicit',
      crafted: 'crafted',
      fractured: 'fractured',
      desecrated: 'desecrated',
      rune: 'rune',
      enchant: 'enchant',
      scourge: 'scourge',
      veiled: 'veiled',
      delve: 'delve',
      skill: 'explicit',
    };
    const domain = String(entry.domain || '').toLowerCase();
    if (map[domain]) return map[domain];
    if (flags.fractured) return 'fractured';
    if (flags.crafted) return 'crafted';
    if (flags.desecrated) return 'desecrated';
    if (flags.rune) return 'rune';
    if (flags.veiled) return 'veiled';
    return null;
  }

  function asModArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) return [value];
    if (value && typeof value === 'object') {
      if (value.text || value.description || value.string || value.name || value.label) return [value];
      const values = Object.values(value).filter((entry) => typeof entry === 'string');
      if (values.length) return values;
    }
    return [];
  }

  function modLines(entries) {
    const lines = [];
    const lineKinds = [];
    const used = [];
    (entries || []).forEach((entry) => {
      const line = cleanMod(entry);
      if (!line) return;
      lines.push(line);
      lineKinds.push(modDomainKind(entry));
      used.push(entry);
    });
    return { lines, lineKinds, entries: used };
  }

  function getModGroups(item) {
    if (!item || typeof item !== 'object') return [];
    const groups = [];
    const known = new Set();

    MOD_GROUPS.forEach((group) => {
      known.add(group.key);
      const { lines, lineKinds, entries } = modLines(asModArray(item[group.key]));
      if (lines.length) groups.push({ key: group.key, label: group.label, kind: group.kind, lines, lineKinds, entries });
    });

    Object.keys(item).forEach((key) => {
      if (known.has(key) || !/Mods$/.test(key)) return;
      const { lines, lineKinds, entries } = modLines(asModArray(item[key]));
      if (!lines.length) return;
      const base = key.replace(/Mods$/, '');
      groups.push({
        key,
        label: base.replace(/([a-z])([A-Z])/g, '$1 $2'),
        kind: base.toLowerCase(),
        lines,
        lineKinds,
        entries,
      });
    });

    return groups;
  }

  /*
   * Every modifier line a trade search may use, as text: explicit, crafted,
   * fractured, desecrated and the rest. Runes are left out - they sit in sockets
   * and the player can add them to any item they buy - and so is a "Bonded:" or
   * "Rune:" line wherever it appears.
   */
  const SEARCH_MOD_KEYS = ['explicitMods', 'craftedMods', 'fracturedMods', 'desecratedMods',
    'enchantMods', 'veiledMods', 'scourgeMods', 'delveMods'];
  const RUNE_LINE = /^(?:Bonded|Rune):/i;

  function searchModLines(item) {
    const lines = [];
    const seen = new Set();
    SEARCH_MOD_KEYS.forEach((key) => {
      asModArray(item && item[key]).forEach((entry) => {
        const text = typeof entry === 'string'
          ? entry
          : ((entry && (entry.description || entry.text || entry.value)) || '');
        const line = cleanGameText(text);
        if (!line || RUNE_LINE.test(line) || seen.has(line.toLowerCase())) return;
        seen.add(line.toLowerCase());
        lines.push(line);
      });
    });
    return lines;
  }

  function getRarity(rec) {
    const item = rec && rec.item ? rec.item : {};
    const frame = Number.isInteger(item.frameType) ? item.frameType : rec && rec.rarity;
    return RARITY[frame] || RARITY[0];
  }

  function hasCrafted(rec) {
    return !!(rec && rec.item && Array.isArray(rec.item.craftedMods) && rec.item.craftedMods.length);
  }

  function hasFractured(rec) {
    return !!(rec && rec.item && Array.isArray(rec.item.fracturedMods) && rec.item.fracturedMods.length);
  }

  function safeIconUrl(url) {
    const value = typeof url === 'string' ? url.trim() : '';
    if (!/^https:\/\//i.test(value)) return '';
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      if (host === 'web.poecdn.com' || host.endsWith('.poecdn.com') || host === 'www.pathofexile.com') {
        return parsed.href;
      }
    } catch (error) {
      /* ignore */
    }
    return '';
  }

  function safePoeUrl(url) {
    const value = typeof url === 'string' ? url.trim() : '';
    if (!/^https:\/\//i.test(value)) return '';
    try {
      const parsed = new URL(value);
      if (parsed.hostname.toLowerCase() === 'www.pathofexile.com') return parsed.href;
    } catch (error) {
      /* ignore */
    }
    return '';
  }

  function getDisplayName(rec) {
    const item = (rec && rec.item) || {};
    const name = cleanGameText(item.name);
    const typeLine = cleanGameText(item.typeLine);
    if (name && typeLine && name !== typeLine) return { name, type: typeLine };
    return { name: typeLine || name || cleanGameText(rec && rec.name) || 'Item', type: '' };
  }

  function propValues(prop) {
    const values = Array.isArray(prop && prop.values) ? prop.values : [];
    return values
      .map((value) => {
        if (Array.isArray(value)) return { text: cleanMod(value[0]), type: value[1] };
        return { text: cleanMod(value), type: 0 };
      })
      .filter((value) => value.text);
  }

  function propToText(prop) {
    const name = cleanGameText(prop && prop.name);
    const values = propValues(prop);
    const joined = values.map((value) => value.text).join(', ');
    const augmented = values.some((value) => value.type === 1);
    let line = name ? (joined ? name + ': ' + joined : name) : joined;
    if (line && augmented) line += ' (augmented)';
    return line;
  }

  const SOCKET_LETTERS = {
    rune: 'S',
    soul_core: 'S',
    soulcore: 'S',
    abyss: 'A',
    abyssal: 'A',
    eldritch: 'E',
    defining: 'D',
    normal: 'W',
    white: 'W',
  };

  function socketText(sockets) {
    if (!Array.isArray(sockets) || !sockets.length) return '';
    const letters = sockets
      .map((socket) => {
        if (!socket) return '';
        const type = String(socket.type || '').toLowerCase();
        if (SOCKET_LETTERS[type]) return SOCKET_LETTERS[type];
        const colour = socket.sColour || socket.colour || socket.color || socket.type;
        return text(colour).toUpperCase().slice(0, 1);
      })
      .filter(Boolean);
    return letters.join('-');
  }

  function buildItemText(rec, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const includeDesecrated = opts.includeDesecrated !== false;
    const item = (rec && rec.item) || {};
    const out = [];
    const itemClass = cleanGameText(item.itemClass) || cleanGameText(item.baseType);
    if (itemClass) out.push('Item Class: ' + itemClass);
    out.push('Rarity: ' + getRarity(rec)[1]);

    const name = cleanGameText(item.name);
    const typeLine = cleanGameText(item.typeLine);
    if (name && name !== typeLine) out.push(name);
    if (typeLine) out.push(typeLine);
    else if (name) out.push(name);

    const pushSection = (lines) => {
      const clean = (lines || []).filter((line) => line != null && String(line).trim() !== '');
      if (!clean.length) return;
      out.push('--------', ...clean);
    };

    pushSection((item.properties || []).map(propToText).filter(Boolean));

    const requirements = (item.requirements || []).map(propToText).filter(Boolean);
    if (requirements.length) pushSection(['Requirements:'].concat(requirements));

    const nextLevel = (item.nextLevelRequirements || []).map(propToText).filter(Boolean);
    if (nextLevel.length) pushSection(['Next Level Requirements:'].concat(nextLevel));

    const granted = (item.grantedSkills || []).map(propToText).filter(Boolean);
    if (granted.length) pushSection(granted);

    const sockets = socketText(item.sockets);
    if (sockets) pushSection(['Sockets: ' + sockets]);

    if (item.ilvl) pushSection(['Item Level: ' + item.ilvl]);
    if (typeof item.stackSize === 'number' && item.stackSize > 1) {
      pushSection(['Stack Size: ' + item.stackSize]);
    }

    getModGroups(item).forEach((group) => {
      let lines = group.lines;
      if (!includeDesecrated) {
        lines = group.lines.filter((line, index) => group.lineKinds[index] !== 'desecrated');
      }
      pushSection(lines);
    });

    const flavour = Array.isArray(item.flavourText) ? item.flavourText : (item.flavourText ? [item.flavourText] : []);
    const flavourLines = flavour.map(cleanMod).filter(Boolean);
    if (flavourLines.length) pushSection(flavourLines);

    if (item.identified === false) pushSection(['Unidentified']);
    if (item.mirrored) pushSection(['Mirrored']);
    if (item.corrupted || item.doubleCorrupted) {
      out.push('--------', item.doubleCorrupted ? 'Double Corrupted' : 'Corrupted');
    }

    const note = cleanGameText(item.note);
    if (note) out.push(note);

    return out.join('\n');
  }

  function propertyRow(prop) {
    const row = createEl('div', 'tt-row');
    const name = cleanGameText(prop && prop.name);
    const values = propValues(prop);
    if (!name && !values.length) return null;

    if (name) row.appendChild(createEl('span', 'tt-prop-name', name));
    const valueBox = createEl('span', 'tt-prop-val' + (name ? '' : ' full'));
    values.forEach((value, index) => {
      const span = createEl('span', value.type === 1 ? 'aug' : '', (index ? ', ' : '') + value.text);
      valueBox.appendChild(span);
    });
    row.appendChild(valueBox);
    return row;
  }

  function renderItemTooltip(rec) {
    const item = (rec && rec.item) || {};
    const rarity = getRarity(rec)[0];
    const box = createEl('div', 'poe-tt tt-' + rarity);

    const header = createEl('div', 'tt-header');
    const named = getDisplayName(rec);
    header.appendChild(createEl('div', 'tt-name', named.name));
    if (named.type) header.appendChild(createEl('div', 'tt-type', named.type));
    const baseType = cleanGameText(item.baseType);
    if (baseType && baseType !== named.name && baseType !== named.type) {
      header.appendChild(createEl('div', 'tt-type', baseType));
    }
    box.appendChild(header);

    const props = (item.properties || []).map(propertyRow).filter(Boolean);
    if (props.length) {
      const section = createEl('div', 'tt-section');
      props.forEach((row) => section.appendChild(row));
      box.appendChild(section);
    }

    if (Array.isArray(item.requirements) && item.requirements.length) {
      const section = createEl('div', 'tt-section');
      section.appendChild(createEl('div', 'tt-sec-title', 'Requires:'));
      item.requirements.forEach((req) => {
        const row = propertyRow(req);
        if (row) section.appendChild(row);
      });
      box.appendChild(section);
    }

    if (Array.isArray(item.nextLevelRequirements) && item.nextLevelRequirements.length) {
      const section = createEl('div', 'tt-section');
      section.appendChild(createEl('div', 'tt-sec-title', 'Next Level Requirements:'));
      item.nextLevelRequirements.forEach((req) => {
        const row = propertyRow(req);
        if (row) section.appendChild(row);
      });
      box.appendChild(section);
    }

    if (Array.isArray(item.grantedSkills) && item.grantedSkills.length) {
      const section = createEl('div', 'tt-section');
      item.grantedSkills.forEach((skill) => {
        const row = propertyRow(skill);
        if (row) section.appendChild(row);
      });
      if (section.childElementCount) box.appendChild(section);
    }

    const sockets = socketText(item.sockets);
    if (sockets) {
      const section = createEl('div', 'tt-section');
      section.appendChild(createEl('div', 'tt-row', 'Sockets: ' + sockets));
      box.appendChild(section);
    }

    if (typeof item.stackSize === 'number' && item.stackSize > 1) {
      box.appendChild(createEl('div', 'tt-ilvl', 'Stack Size: ' + item.stackSize));
    }

    if (item.ilvl) {
      box.appendChild(createEl('div', 'tt-ilvl', 'Item Level: ' + item.ilvl));
    }

    getModGroups(item).forEach((group) => {
      const section = createEl('div', 'tt-mods');
      if (group.kind !== 'explicit') {
        section.appendChild(createEl('div', 'tt-mod-label', group.label));
      }
      group.lines.forEach((line, index) => {
        const kind = (group.lineKinds && group.lineKinds[index]) || group.kind;
        section.appendChild(createEl('div', 'tt-mod tt-mod--' + kind, line));
      });
      box.appendChild(section);
    });

    const flavour = Array.isArray(item.flavourText) ? item.flavourText : (item.flavourText ? [item.flavourText] : []);
    const flavourLines = flavour.map(cleanMod).filter(Boolean);
    if (flavourLines.length) {
      box.appendChild(createEl('div', 'tt-flavour', flavourLines.join(' ')));
    }

    if (item.identified === false) box.appendChild(createEl('div', 'tt-flag', 'Unidentified'));
    if (item.mirrored) box.appendChild(createEl('div', 'tt-flag', 'Mirrored'));
    if (item.corrupted || item.doubleCorrupted) {
      box.appendChild(
        createEl('div', 'tt-flag corrupted', item.doubleCorrupted ? 'Double Corrupted' : 'Corrupted')
      );
    }

    const note = cleanGameText(item.note);
    if (note) box.appendChild(createEl('div', 'tt-note', note));

    return box;
  }

  function timeAgo(ts) {
    const value = Number(ts) || 0;
    const diff = Date.now() - value;
    if (diff < 60000) return 'just now';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days < 30) return days + 'd ago';
    return new Date(value).toLocaleDateString('en-GB');
  }

  /*
   * When the seller put the listing up, not when the player saved it. The trade
   * API sends `listing.indexed` as an ISO timestamp; the page can also print a
   * "15/11/2026 12:34" date, so both forms are read.
   */
  function parseListingDate(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    /* The trade site prints the date in the page's own locale: month first by
       default, day first in some of them. A number above 12 says which one it
       is. Parsed here, before Date.parse, because the engine reads that shape as
       local time and would shift it by the timezone. */
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
    if (match) {
      let month = +match[1];
      let day = +match[2];
      if (month > 12 && day <= 12) {
        month = +match[2];
        day = +match[1];
      }
      const stamp = Date.UTC(+match[3], month - 1, day, +match[4], +match[5], +(match[6] || 0));
      return Number.isFinite(stamp) ? stamp : null;
    }
    const iso = Date.parse(raw);
    return Number.isFinite(iso) ? iso : null;
  }

  /* The listing time of a saved record, or null when it was never recorded. */
  function listedAt(rec) {
    const listing = (rec && rec.listing) || {};
    return parseListingDate(listing.indexed || listing.dateListed || '');
  }

  function timeUntil(ts) {
    const value = Number(ts) || 0;
    const diff = value - Date.now();
    if (diff <= 0) return 'expired';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return 'in ' + minutes + 'm';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return 'in ' + hours + 'h';
    const days = Math.floor(hours / 24);
    if (days < 30) return 'in ' + days + 'd';
    return new Date(value).toLocaleDateString('en-GB');
  }

  function formatDate(ts) {
    const value = Number(ts);
    if (!value) return '-';
    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /* Value of one unit of `currency` in Divine Orbs. Uses the live poe.ninja
     table when it is available so that the ranking stays correct even when
     the chaos/divine/exalted ratio changes between leagues. */
  function currencyWeight(currency, priceData) {
    if (priceData && priceData.rates) {
      const id = currencyId(currency, priceData);
      const rate = priceData.rates[id];
      if (typeof rate === 'number' && rate > 0) return rate;
    }
    const id = currencyId(currency, null);
    const table = fallbackWeightTable(priceData && priceData.game);
    if (table[id] != null) return table[id];
    return 0.01;
  }

  function priceValue(rec, priceData) {
    if (!rec || typeof rec.priceAmount !== 'number') return -1;
    return rec.priceAmount * currencyWeight(rec.priceCurrency, priceData);
  }

  function valueScore(rec, priceData) {
    const price = priceValue(rec, priceData);
    if (price < 0) return null;
    const item = (rec && rec.item) || {};
    let modCount = 0;
    getModGroups(item).forEach((group) => {
      modCount += (group.lines || []).length;
    });
    const ilvl = Math.max(0, Math.min(95, Number(item.ilvl) || 0));
    const quality = (1 + Math.min(8, modCount) / 4) * (1 + ilvl / 150);
    return Math.round((price / quality) * 10000) / 10000;
  }

  /* The value score is a "price per quality" number, so it only makes sense
     next to a unit. Chaos orbs are the community reference point. */
  function formatValueScore(score, priceData) {
    if (score == null || !isFinite(score)) return '';
    const perChaos = (priceData && priceData.rates && priceData.rates.chaos)
      ? priceData.rates.chaos
      : fallbackWeightTable(priceData && priceData.game).chaos;
    const chaos = score / (perChaos || 1);
    const abs = Math.abs(chaos);
    if (abs >= 100) return String(Math.round(chaos));
    if (abs >= 10) return String(Math.round(chaos * 10) / 10);
    if (abs >= 1) return String(Math.round(chaos * 100) / 100);
    if (abs >= 0.01) return String(Math.round(chaos * 1000) / 1000);
    return String(Math.round(chaos * 10000) / 10000);
  }

  const CURRENCY_ALIASES = {
    chaos: 'chaos',
    'chaos orb': 'chaos',
    divine: 'divine',
    'divine orb': 'divine',
    exalted: 'exalted',
    'exalted orb': 'exalted',
    exalt: 'exalted',
    mirror: 'mirror',
    'mirror of kalandra': 'mirror',
    'mirror kalandra': 'mirror',
    'orb of alchemy': 'alch',
    alchemy: 'alch',
    alch: 'alch',
    'orb of annulment': 'annul',
    annulment: 'annul',
    annul: 'annul',
    'vaal orb': 'vaal',
    vaal: 'vaal',
    'regal orb': 'regal',
    regal: 'regal',
    'orb of augmentation': 'aug',
    augmentation: 'aug',
    aug: 'aug',
    'orb of transmutation': 'transmute',
    transmutation: 'transmute',
    transmute: 'transmute',
    'orb of alteration': 'alt',
    alteration: 'alt',
    alt: 'alt',
    'orb of scouring': 'scour',
    scouring: 'scour',
    scour: 'scour',
    'orb of chance': 'chance',
    chance: 'chance',
    'scroll of wisdom': 'wisdom',
    wisdom: 'wisdom',
    'orb of fusing': 'fusing',
    fusing: 'fusing',
    "jeweller's orb": 'jewellers',
    jewellers: 'jewellers',
    'chromatic orb': 'chromatic',
    chromatic: 'chromatic',
    "gemcutter's prism": 'gcp',
    gcp: 'gcp',
    'blessed orb': 'blessed',
    blessed: 'blessed',
    'orb of regret': 'regret',
    regret: 'regret',
    gold: 'gold',
  };

  function parseTradeUrl(url) {
    return globalThis.PTC_GAMES.parseTradeUrl(url);
  }

  /*
   * Builds the search URL. The trade site has used both "/<league>/<id>" and
   * "/<league>?q=<id>" over time, and a URL in the wrong shape is answered
   * with "Failed to load search state". So the URL of the trade tab that is
   * already open is used as the template whenever there is one: only the
   * query id is swapped, so the shape is always the one the site itself uses.
   */
  function buildTradeUrl(game, league, queryId, live, templateUrl) {
    return globalThis.PTC_GAMES.buildTradeUrl(game, league, queryId, live, templateUrl);
  }

  function buildLeagueSearchUrl(game, league) {
    return globalThis.PTC_GAMES.buildLeagueSearchUrl(game, league);
  }

  /*
   * A saved search URL carries the query id of the search that was on screen
   * - a gzip-compressed query JSON in base64url. The trade site opens with a
   * default search that has no filters at all, and a listing saved from that
   * page would link to "every securable item" instead of the item itself.
   * Decoding the id tells the two apart.
   */
  function decodeSearchQuery(queryId) {
    try {
      const pako = globalThis.pako;
      if (!pako || typeof pako.ungzip !== 'function') return null;
      const chars = String(queryId == null ? '' : queryId).replace(/\s+/g, '');
      if (!chars) return null;
      const b64 = chars.replace(/-/g, '+').replace(/_/g, '/');
      const bin = typeof atob === 'function'
        ? atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
        : Buffer.from(b64, 'base64').toString('binary');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const attempts = [() => pako.ungzip(bytes), () => pako.inflate(bytes), () => pako.inflateRaw(bytes)];
      let raw = null;
      for (let i = 0; i < attempts.length; i += 1) {
        try {
          const result = attempts[i]();
          if (result && result.length) { raw = result; break; }
        } catch (error) { /* try the next wrapper */ }
      }
      if (!raw) return null;
      const text = new TextDecoder().decode(raw);
      let query = JSON.parse(text);
      if (typeof query === 'string') query = JSON.parse(query);
      return query && typeof query === 'object' ? query : null;
    } catch (error) {
      return null;
    }
  }

  /*
   * The other half of decodeSearchQuery: the trade site reads the query id of
   * a search URL as the gzip of the query JSON, in base64url. Writing one back
   * lets a search be changed without asking anybody: the site reads the query
   * out of the URL and runs it itself.
   */
  function encodeSearchQuery(query) {
    try {
      const pako = globalThis.pako;
      if (!pako || typeof pako.gzip !== 'function') return '';
      const json = JSON.stringify(query);
      /* UTF-8, not one byte per code unit: a query with an accented name would
         otherwise gzip bytes the site cannot read back. */
      const bytes = new TextEncoder().encode(json);
      const out = pako.gzip(bytes, { level: 9, mtime: 0 });
      let bin = '';
      for (let i = 0; i < out.length; i += 1) bin += String.fromCharCode(out[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (error) {
      return '';
    }
  }

  /*
   * Does the saved search really search for something? The trade site opens
   * with a default search that has no filters at all ("every securable item
   * of the league"), and a listing saved from that page would link to it.
   * A saved search that carries filters is the search the player used, so it
   * holds the item and the other items with the same modifiers.
   */
  /*
   * Is the saved search a real search? A url without a query id, or with the
   * site's default query (no filters at all), would open a page of every item
   * in the league instead of the item and the items that share its modifiers.
   */
  function savedSearchUsable(url) {
    if (!url) return false;
    const info = globalThis.PTC_GAMES ? globalThis.PTC_GAMES.parseTradeUrl(url) : null;
    if (!info || !info.queryId) return false;
    return savedSearchHasFilters(decodeSearchQuery(info.queryId));
  }

  /* Filters that narrow the market (price, sale type, indexed date) but say
     nothing about which item is searched, so they do not make a saved search
     hold the item: a listing saved while the player had only a price filter
     set would open every item above that price. */
  const SEARCH_MARKET_BUCKETS = { trade_filters: true };

  function savedSearchHasFilters(query) {
    if (!query || typeof query !== 'object') return false;
    if (query.term && String(query.term).trim()) return true;
    if (query.type && String(query.type).trim()) return true;
    if (query.name && String(query.name).trim()) return true;
    if (query.category && String(query.category).trim()) return true;
    if (query.rarity && String(query.rarity).trim()) return true;
    if (Array.isArray(query.stats) && query.stats.some((group) => (
      Array.isArray(group && group.filters) && group.filters.length
    ))) return true;
    const filters = query.filters;
    if (filters && typeof filters === 'object') {
      const buckets = Object.keys(filters);
      for (let i = 0; i < buckets.length; i += 1) {
        if (SEARCH_MARKET_BUCKETS[buckets[i]]) continue;
        const inner = filters[buckets[i]] && filters[buckets[i]].filters;
        if (inner && typeof inner === 'object' && Object.keys(inner).length) return true;
      }
    }
    return false;
  }

  function gameFromUrl(url) {
    return globalThis.PTC_GAMES.gameFromUrl(url);
  }

  function currencyId(name, priceData) {
    const full = normalizeText(name).replace(/\s+/g, ' ').trim();
    if (CURRENCY_ALIASES[full]) return CURRENCY_ALIASES[full];
    const reduced = full.replace(/\b(of|orb|orbs)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (CURRENCY_ALIASES[reduced]) return CURRENCY_ALIASES[reduced];
    if (priceData && priceData.names) {
      if (priceData.names[full]) return priceData.names[full];
      if (priceData.names[reduced]) return priceData.names[reduced];
    }
    return reduced.replace(/\s+/g, '-');
  }

  function parsePriceText(value) {
    const raw = text(value).replace(/^~?\s*(price|b\/o|buyout)\s*:?\s*/i, '');
    const match = raw.match(/(\d[\d.,\s]*)\s*(?:x|×)?\s*([A-Za-z][A-Za-z'’\- ]*)$/);
    if (!match) return null;
    const amount = Number(match[1].replace(/[,\s]/g, ''));
    if (!isFinite(amount) || amount <= 0) return null;
    const name = text(match[2]);
    if (!name) return null;
    return { amount, currencyName: name };
  }

  function convertPrice(amount, currencyName, priceData) {
    if (!priceData || !priceData.rates || !isFinite(amount)) return null;
    const id = currencyId(currencyName, priceData);
    const rate = priceData.rates[id];
    if (typeof rate !== 'number' || rate <= 0) return null;
    const primary = priceData.primary || 'chaos';
    const primaryAmount = amount * rate;
    const divine = primary === 'divine'
      ? primaryAmount
      : (priceData.rates.divine ? primaryAmount / priceData.rates.divine : null);
    const chaos = primary === 'chaos'
      ? primaryAmount
      : (priceData.rates.chaos ? primaryAmount / priceData.rates.chaos : null);
    const exalted = primary === 'exalted'
      ? primaryAmount
      : (priceData.rates.exalted ? primaryAmount / priceData.rates.exalted : null);
    return { primary, primaryAmount, divine, chaos, exalted, currencyId: id };
  }

  function formatNumber(value, maxDigits) {
    if (!isFinite(value)) return '';
    const digits = maxDigits == null ? 2 : maxDigits;
    if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString('en-GB');
    if (Math.abs(value) >= 100) return String(Math.round(value));
    if (Math.abs(value) >= 10) return String(Math.round(value * 10) / 10);
    return String(Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits));
  }

  function exaltedPerDivine(conversion) {
    if (!conversion || conversion.divine == null || conversion.exalted == null) return null;
    if (!isFinite(conversion.divine) || conversion.divine <= 0) return null;
    return conversion.exalted / conversion.divine;
  }

  function formatConversion(conversion, display) {
    if (!conversion) return '';
    const divine = conversion.divine;
    const chaos = conversion.chaos;
    const mode = display || 'divine-exalted';
    if (mode === 'divine-exalted') {
      if (divine != null && divine >= 1) {
        const whole = Math.floor(divine);
        const exPerDiv = exaltedPerDivine(conversion);
        const rest = exPerDiv != null ? (divine - whole) * exPerDiv : 0;
        const base = whole + ' div';
        return rest >= 0.5 ? base + ' + ' + formatNumber(rest, 1) + ' ex' : base;
      }
      if (conversion.exalted != null) return formatNumber(conversion.exalted, 1) + ' ex';
      if (divine != null) return formatNumber(divine, 2) + ' div';
      if (chaos != null) return formatNumber(chaos, 1) + ' chaos';
      return '';
    }
    if (mode === 'divine' && divine != null) return formatNumber(divine, 2) + ' div';
    if (mode === 'chaos' && chaos != null) return formatNumber(chaos, 1) + ' chaos';
    if (mode === 'exalted' && conversion.exalted != null) {
      return formatNumber(conversion.exalted, 2) + ' ex';
    }
    if (divine != null && chaos != null && divine >= 1) {
      const whole = Math.floor(divine);
      const rest = chaos - whole * (chaos / divine);
      const base = whole + ' div';
      return rest >= 0.5 ? base + ' + ' + formatNumber(rest, 1) + ' chaos' : base;
    }
    if (chaos != null) return formatNumber(chaos, 1) + ' chaos';
    if (divine != null) return formatNumber(divine, 2) + ' div';
    if (conversion.exalted != null) return formatNumber(conversion.exalted, 2) + ' ex';
    return '';
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let previous = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j += 1) previous[j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      }
      previous = current;
    }
    return previous[b.length];
  }

  function fuzzyMatch(value, query) {
    const haystack = normalizeText(value);
    const needle = normalizeText(query).replace(/\s+/g, ' ').trim();
    if (!needle) return true;
    if (haystack.includes(needle)) return true;
    const terms = needle.split(' ').filter(Boolean);
    const words = haystack.split(/[^a-z0-9%+\-.]+/).filter(Boolean);
    return terms.every((term) => {
      if (haystack.includes(term)) return true;
      return words.some((word) => {
        if (word === term) return true;
        if (term.length < 4) return false;
        if (Math.abs(word.length - term.length) > 2) return false;
        return levenshtein(word, term) <= (term.length >= 7 ? 2 : 1);
      });
    });
  }

  /*
   * Build imports only carry a base type ("Ancestral Tiara", "Runeforged Gold
   * Gloves"), never the item class the trade site and Craft of Exile need:
   * Craft of Exile refuses a paste whose "Item Class" line is the base name, and
   * the trade category filter stays empty. The class is stored in the base name
   * suffix, so it is derived here once and shared by both paths.
   */
  const BASE_CLASS_RULES = [
    [/\b(two.?hand(?:ed)?[a-z\s-]*axe)\b/i, 'Two Hand Axes'],
    [/\b(two.?hand(?:ed)?[a-z\s-]*mace)\b/i, 'Two Hand Maces'],
    [/\b(two.?hand(?:ed)?[a-z\s-]*sword)\b/i, 'Two Hand Swords'],
    [/\b(crossbow)\b/i, 'Crossbows'],
    [/\b(quarterstaff|warstaff)\b/i, 'Quarterstaves'],
    [/\b(bow)\b/i, 'Bows'],
    [/\b(sceptre)\b/i, 'Sceptres'],
    [/\b(wand)\b/i, 'Wands'],
    [/\b(dagger)\b/i, 'Daggers'],
    [/\b(claw)\b/i, 'Claws'],
    [/\b(flail)\b/i, 'Flails'],
    [/\b(spear)\b/i, 'Spears'],
    [/\b(staff)\b/i, 'Staves'],
    [/\b(sword)\b/i, 'One Hand Swords'],
    [/\b(axe)\b/i, 'One Hand Axes'],
    [/\b(mace|maul|hammer)\b/i, 'One Hand Maces'],
    [/\b(tiara|helm|cap|crown|mask|hood|burgonet|armet|bascinet|sallet|circlet|mitre|coif)\b/i, 'Helmets'],
    [/\b(gloves|gauntlets|mitts|bracers)\b/i, 'Gloves'],
    [/\b(boots|sandals|shoes|greaves|slippers)\b/i, 'Boots'],
    [/\b(robe|vest|plate|regalia|coat|jacket|garb|tunic|cuirass|brigandine|armour|armor|mail|raiment|doublet|wraps)\b/i, 'Body Armours'],
    [/\b(buckler|shield)\b/i, 'Shields'],
    [/\b(focus|foci)\b/i, 'Foci'],
    [/\b(quiver)\b/i, 'Quivers'],
    [/\b(ring)\b/i, 'Rings'],
    [/\b(amulet|talisman|pendant)\b/i, 'Amulets'],
    [/\b(belt|sash|girdle)\b/i, 'Belts'],
    [/\b(jewel)\b/i, 'Jewels'],
    [/\b(flask)\b/i, 'Flasks'],
    [/\b(waystone)\b/i, 'Waystones'],
  ];

  function itemClassFromBase(value) {
    const base = cleanGameText(value || '').replace(/^(superior|synthesised|fractured|replica)\s+/i, '');
    if (!base) return '';
    for (let i = 0; i < BASE_CLASS_RULES.length; i += 1) {
      if (BASE_CLASS_RULES[i][0].test(base)) return BASE_CLASS_RULES[i][1];
    }
    return '';
  }

  function maxSockets(item) {
    const cls = normalizeText(item && item.itemClass);
    if (!cls) return 0;
    if (/body armou?r/.test(cls)) return 6;
    if (/two hand|bow|staff/.test(cls)) return 6;
    if (/helmet|gloves|boots|shield/.test(cls)) return 4;
    if (/one hand|claw|dagger|wand|sceptre|sword|axe|mace/.test(cls)) return 3;
    return 0;
  }

  function buildCoeImportUrl(rec, game, options) {
    const version = globalThis.PTC_GAMES.normalizeGame((rec && rec.game) || game);
    const item = (rec && rec.item) || {};
    const base = cleanGameText(item.baseType || item.typeLine || item.name || '').replace(/^superior\s+/i, '');
    if (!base) return '';
    let paste = '';
    try {
      paste = buildCoePaste(rec, options && typeof options === 'object' ? options : {});
    } catch (error) {
      return '';
    }
    if (!paste || paste.indexOf('--------') === -1) return '';
    const lines = paste.split('\n');
    const separator = lines.indexOf('--------');
    if (separator < 3) return '';
    return 'https://beta.craftofexile.com/?game=' + version + '&eimport=' + encodeURIComponent(paste);
  }

  function coePlainDescription(description) {
    return cleanGameText(description);
  }

  function coeModKind(entry) {
    const domain = String((entry && entry.domain) || '').toLowerCase();
    const flags = (entry && entry.flags && typeof entry.flags === 'object') ? entry.flags : {};
    if (flags.desecrated || domain === 'desecrated') return 'desecrated';
    if (flags.fractured || domain === 'fractured') return 'fractured';
    if (flags.crafted || domain === 'crafted') return 'crafted';
    if (flags.enchant || domain === 'enchant') return 'enchant';
    if (flags.rune || domain === 'rune') return 'rune';
    if (flags.implicit || domain === 'implicit') return 'implicit';
    return 'explicit';
  }

  const COE_NUMBER = /-?\d+(?:\.\d+)?/g;

  function coeNumbers(text) {
    return (String(text == null ? '' : text).match(COE_NUMBER) || []).map(Number);
  }

  function coeFormatNumber(value) {
    return String(Math.round(Number(value) * 100) / 100);
  }

  /*
   * A line such as "69% increased Spirit" with two tiers (P4 + P4) is really two affixes
   * rolled into one displayed value, and each one takes an affix slot. Split the shown
   * total back into one value per affix, each inside its own tier range, so every affix
   * can be imported on its own. Returns null when no valid split exists.
   */
  function coeSplitTotals(totals, sourceRanges) {
    const count = sourceRanges.length;
    const out = sourceRanges.map(() => []);
    const eps = 0.051;
    for (let k = 0; k < totals.length; k += 1) {
      let remaining = totals[k];
      for (let i = 0; i < count; i += 1) {
        const own = sourceRanges[i][k];
        if (!own || !Number.isFinite(own.min) || !Number.isFinite(own.max)) return null;
        let restMin = 0;
        let restMax = 0;
        for (let j = i + 1; j < count; j += 1) {
          const other = sourceRanges[j][k];
          if (!other || !Number.isFinite(other.min) || !Number.isFinite(other.max)) return null;
          restMin += other.min;
          restMax += other.max;
        }
        const lowest = Math.max(own.min, remaining - restMax);
        const highest = Math.min(own.max, remaining - restMin);
        if (lowest > highest + eps) return null;
        const value = i === count - 1 ? remaining : Math.min(lowest, own.max);
        if (value < own.min - eps || value > own.max + eps) return null;
        out[i].push(value);
        remaining -= value;
      }
    }
    return out;
  }

  function coeSplitText(text, valuesPerSource) {
    return valuesPerSource.map((values) => {
      let index = 0;
      return String(text).replace(COE_NUMBER, (num) => (index < values.length ? coeFormatNumber(values[index++]) : num));
    });
  }

  function coeModsFromEntry(entry) {
    if (!entry || typeof entry !== 'object') return [];
    const kind = coeModKind(entry);
    if (kind === 'rune' || kind === 'implicit') return [];
    const sources = (Array.isArray(entry.mods) ? entry.mods : []).filter((src) => src && src.tier);
    if (!sources.length) return [];
    /* Trade-API entries carry the wording in "value"; DOM-derived ones use
       "description"/"text". Reading all three keeps both shapes working. */
    const text = coePlainDescription(entry.description || entry.text || entry.value);
    if (!text) return [];
    const tiers = sources.map((src) => /^([PS])(\d+)$/i.exec(String(src.tier)));
    if (tiers.some((match) => !match)) return [];
    const ranges = sources.map((src) => (Array.isArray(src.magnitudes) ? src.magnitudes : []).map((m) => ({
      min: m ? Number(m.min) : NaN,
      max: m ? Number(m.max) : NaN,
    })));
    let texts = sources.map(() => text);
    if (sources.length > 1) {
      const totals = coeNumbers(text);
      if (!totals.length || ranges.some((list) => list.length !== totals.length)) return [];
      const split = coeSplitTotals(totals, ranges);
      if (!split) return [];
      texts = coeSplitText(text, split);
    }
    return sources.map((src, i) => {
      const type = tiers[i][1].toUpperCase() === 'S' ? 'suffix' : 'prefix';
      const first = ranges[i][0];
      // Craft of Exile cannot resolve the base item class of crafted (essence /
      // Verisium) suffixes, so they never match by text; they are only kept when
      // the item has no other affixes (see buildCoePaste).
      return {
        kind: kind,
        type: type,
        tier: Number(tiers[i][2]) || 0,
        name: cleanGameText(src.name || '') || 'modifier',
        text: texts[i],
        min: first && Number.isFinite(first.min) ? first.min : null,
        max: first && Number.isFinite(first.max) ? first.max : null,
        ranges: ranges[i],
        dropWhenMixed: kind === 'crafted' && type === 'suffix',
      };
    });
  }

  function coeModsFromDom(mod) {
    if (!mod || !mod.text) return [];
    const text = cleanGameText(mod.text);
    const sources = Array.isArray(mod.sources) && mod.sources.length > 1 ? mod.sources : null;
    if (sources) {
      const totals = coeNumbers(text);
      if (totals.length !== 1) return [];
      const split = coeSplitTotals(totals, sources.map((src) => [{ min: Number(src.min), max: Number(src.max) }]));
      if (!split) return [];
      const texts = coeSplitText(text, split);
      return sources.map((src, i) => ({
        kind: mod.kind || 'explicit',
        type: src.type,
        tier: Number(src.tier) || 0,
        name: cleanGameText(src.name || mod.name || '') || 'modifier',
        text: texts[i],
        min: Number(src.min),
        max: Number(src.max),
        ranges: [],
      }));
    }
    if (mod.type !== 'prefix' && mod.type !== 'suffix') return [];
    return [{
      kind: mod.kind || 'explicit',
      type: mod.type,
      tier: Number(mod.tier) || 0,
      name: cleanGameText(mod.name || '') || 'modifier',
      text: text,
      /* The site's own wording of the stat, so a build import does not have to
         match PoB's spelling against the modifier pool. */
      statText: mod.statText ? String(mod.statText) : '',
      min: Number.isFinite(Number(mod.min)) && mod.min !== null ? Number(mod.min) : null,
      max: Number.isFinite(Number(mod.max)) && mod.max !== null ? Number(mod.max) : null,
    }];
  }

  function collectApiMods(item) {
    const out = [];
    /* Union of both games' craftable domains: PoE2 has desecrated, PoE1 has
       veiled / scourge / delve. The absent arrays simply contribute nothing. */
    ['explicitMods', 'craftedMods', 'fracturedMods', 'desecratedMods', 'enchantMods', 'veiledMods', 'scourgeMods', 'delveMods'].forEach((key) => {
      asModArray(item[key]).forEach((entry) => {
        if (entry && typeof entry === 'object') out.push(entry);
      });
    });
    return out;
  }

  function coeLabel(mod) {
    let prefix = '';
    if (mod.kind === 'crafted') prefix = 'Crafted ';
    else if (mod.kind === 'fractured') prefix = 'Fractured ';
    else if (mod.kind === 'desecrated') prefix = 'Desecrated ';
    const tier = Number(mod.tier) > 0 ? ' (Tier: ' + Math.floor(Number(mod.tier)) + ')' : '';
    return '{ ' + prefix + (mod.type === 'suffix' ? 'Suffix' : 'Prefix') + ' Modifier "' + mod.name + '"' + tier + ' }';
  }

  // Mods with several rolled values ("Adds 10 to 20 Physical Damage") need a range
  // on every number, exactly like the in-game advanced copy. Returns '' when the
  // numbers in the text do not line up one to one with the known ranges.
  function coeAnnotateAll(rawText, ranges) {
    if (!Array.isArray(ranges) || ranges.length < 2) return '';
    const line = String(rawText).split("\n").map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join(', ');
    const pattern = /-?\d+(?:\.\d+)?/g;
    if ((line.match(pattern) || []).length !== ranges.length) return '';
    let i = 0;
    return line.replace(pattern, (num) => {
      const r = ranges[i++];
      if (!r || !Number.isFinite(r.min) || !Number.isFinite(r.max) || r.min === r.max) return num;
      return num + '(' + r.min + '-' + r.max + ')';
    });
  }

  /*
   * Craft of Exile matches every stat line against its own localized label
   * ("+#% to [Resistances|Cold Resistance]"). A modifier written by Path of
   * Building is the same roll in another wording ("+15% to Increased Cold
   * Resistance"), and the site answers those with "Could not find a valid
   * affix (might be a legacy modifier)". So the resolved label is used and the
   * roll is put back into it, which is exactly the line a saved listing sends.
   */
  function coeTemplateLine(template, text, min, max) {
    const display = cleanGameText(template);
    if (!display) return '';
    const holes = (display.match(/#/g) || []).length;
    if (!holes) return '';
    const numbers = String(text == null ? '' : text).match(COE_NUMBER) || [];
    /* A modifier such as "+10 to Strength and Dexterity" rolls one number and
       the game prints it once, while the site's label has a slot for each stat.
       Repeating the single roll fills both, which is what the item really says. */
    const repeat = numbers.length === 1 && holes > 1;
    if (!repeat && numbers.length !== holes) return '';
    const low = Number(min);
    const high = Number(max);
    const range = Number.isFinite(low) && Number.isFinite(high) && low !== high && high > 0
      ? '(' + low + '-' + high + ')'
      : '';
    let used = 0;
    let annotated = false;
    return display.replace(/#/g, () => {
      const value = repeat ? numbers[0] : numbers[used];
      used += 1;
      // The range is cosmetic, so it goes on the first slot only - and only when
      // there is one slot, where it cannot be read as a second roll.
      if (!annotated && holes === 1 && range) {
        annotated = true;
        return value + range;
      }
      return value;
    });
  }

  function coeTextWithRange(text, min, max, ranges) {
    const rawText = String(text == null ? '' : text);
    const all = coeAnnotateAll(rawText, ranges);
    if (all) return all;
    // Multi-stat affixes must reach the site as separate stat lines (see
    // buildCoePaste); cleanGameText would squash the line break and the
    // site's matcher would no longer find the mod in its pool.
    if (rawText.indexOf("\n") !== -1) {
      const parts = rawText.split("\n").map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const first = parts[0] || '';
      const rest = parts.slice(1).join(', ');
      const low = Number(min);
      const high = Number(max);
      const m = /(-?\d+(?:\.\d+)?)/.exec(first);
      const head = m && Number.isFinite(low) && Number.isFinite(high) && low !== high
        ? first.replace(m[1], m[1] + '(' + low + '-' + high + ')')
        : first;
      return head + (rest ? "\n" + rest : '');
    }
    const line = cleanGameText(rawText);
    if (!line) return '';
    const low2 = Number(min);
    const high2 = Number(max);
    if (!Number.isFinite(low2) || !Number.isFinite(high2) || low2 === high2) return line;
    const match = /(-?\d+(?:\.\d+)?)/.exec(line);
    if (!match) return line;
    return line.replace(match[1], match[1] + '(' + low2 + '-' + high2 + ')');
  }

  function coeImportSummary(rec) {
    const item = (rec && rec.item) || {};
    const included = [];
    const skipped = [];
    const apiMods = collectApiMods(item);
    if (apiMods.length) {
      apiMods.forEach((entry) => {
        const parts = coeModsFromEntry(entry);
        if (parts.length) parts.forEach((mod) => included.push(mod.text));
        else skipped.push(coePlainDescription((entry && entry.description) || (entry && entry.text) || ''));
      });
    } else if (!(Array.isArray(rec && rec.coeMods) && rec.coeMods.length)) {
      ['explicitMods', 'craftedMods', 'fracturedMods', 'desecratedMods', 'enchantMods', 'veiledMods', 'scourgeMods', 'delveMods'].forEach((key) => {
        asModArray(item[key]).forEach((entry) => {
          if (typeof entry !== 'string') return;
          const line = cleanGameText(entry);
          if (line) included.push(line);
        });
      });
    } else {
      (Array.isArray(rec && rec.coeMods) ? rec.coeMods : []).forEach((entry) => {
        const parts = coeModsFromDom(entry);
        if (parts.length) parts.forEach((mod) => included.push(mod.text));
        else skipped.push(cleanGameText((entry && entry.text) || ''));
      });
    }
    return {
      included: included.length,
      skipped: skipped.length,
      includedTexts: included,
      skippedTexts: skipped.filter(Boolean),
    };
  }

  function buildCoePaste(rec, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const includeDesecrated = opts.includeDesecrated !== false;
    const item = (rec && rec.item) || {};
    const typeLine = cleanGameText(item.typeLine);
    const name = cleanGameText(item.name);
    /* Craft of Exile knows the base item and its class under its own names.
       A build import carries the trade site's names, so the enriched record
       keeps the Craft of Exile spelling next to them. */
    const base = cleanGameText(item.coeBaseType || item.baseType || typeLine || name);
    const itemClass = cleanGameText(item.coeItemClass || item.itemClass)
      || itemClassFromBase(item.baseType || typeLine || item.name)
      || base || typeLine;
    if (!itemClass) return '';
    const header = ['Item Class: ' + itemClass, 'Rarity: ' + getRarity(rec)[1]];
    if (name && name !== typeLine) header.push(name);
    header.push(base || typeLine || name);
    if (header.length < 3) return '';

    const blocks = [];
    const socketCount = Array.isArray(item.sockets) ? item.sockets.length : 0;
    const properties = (item.properties || [])
      .filter((prop) => prop && Array.isArray(prop.values) && prop.values.length)
      .map(propToText)
      .filter(Boolean);
    if (properties.length) blocks.push(properties.join('\n'));

    const requirements = [];
    (item.requirements || []).forEach((req) => {
      const reqName = cleanGameText(req && req.name);
      const values = propValues(req);
      if (!reqName || !values.length) return;
      const value = values[0].text;
      if (!value) return;
      if (/^level$/i.test(reqName)) requirements.push('Level ' + value);
      else requirements.push(value + ' ' + reqName);
    });
    if (requirements.length) blocks.push('Requires: ' + requirements.join(', '));

    // Craft of Exile counts sockets by splitting the line on "S", so colours
    // ("R-G-B") would read as zero sockets; its own export writes "S" for each.
    if (socketCount > 0) blocks.push('Sockets: ' + new Array(socketCount).fill('S').join(' '));
    if (item.ilvl) blocks.push('Item Level: ' + item.ilvl);
    const grantedSkills = (item.grantedSkills || []).map(propToText).filter(Boolean);
    if (grantedSkills.length) blocks.push(grantedSkills.join('\n'));

    /*
     * Socketed runes are deliberately not sent. Craft of Exile matches a socketable
     * against its own per-item-class table (an Owl Idol is only known for "Medium
     * Relics" and helm bases), so for any other base the line is rejected with
     * "Could not find match for socketable ..." even though the stat text is right.
     * The socket count is still sent, so the item imports cleanly with empty sockets.
     */
    const modLinesOut = [];
    const apiMods = collectApiMods(item)
      .reduce((all, entry) => all.concat(coeModsFromEntry(entry)), []);
    const domMods = Array.isArray(rec && rec.coeMods)
      ? rec.coeMods.reduce((all, entry) => all.concat(coeModsFromDom(entry)), []) : [];
    /* The DOM capture is the proven source (it carries the affix names and the
       site's own stat wording), so it wins whenever it has anything. The API
       mods are the fallback for records whose page did not yield a DOM capture
       - without them the paste would import the item with no affixes at all. */
    let mods = domMods.length ? domMods : apiMods;
    // Unmatchable crafted suffixes (see coeModFromEntry) are dropped when the
    // item has other affixes; kept when they are the only ones, so the item
    // still imports with something on it.
    if (mods.length > 1) mods = mods.filter((mod) => !mod.dropWhenMixed);
    // The game lists every prefix first (desecrated ones included), then every suffix.
    mods = mods.filter((mod) => mod.type !== 'suffix').concat(mods.filter((mod) => mod.type === 'suffix'));
    mods.forEach((mod) => {
      if (mod.kind === 'rune' || mod.kind === 'implicit' || mod.kind === 'enchant') return;
      if (mod.kind === 'desecrated' && !includeDesecrated) return;
      modLinesOut.push(coeLabel(mod));
      const statText = mod.statText
        ? (coeTemplateLine(mod.statText, mod.text, mod.min, mod.max)
          || coeTextWithRange(mod.text, mod.min, mod.max, mod.ranges))
        : coeTextWithRange(mod.text, mod.min, mod.max, mod.ranges);
      // Multi-stat affixes (two stat lines) are joined with ", " so the site's
      // importer reassembles the same string its mod pool is built from.
      modLinesOut.push(statText.replace(/\n/g, ', '));
    });
    // Items imported from Path of Building only have the plain modifier lines, with no
    // tiers or ranges. The site matches those against its modifier pool by text.
    if (!mods.length) {
      ['explicitMods', 'craftedMods', 'fracturedMods', 'desecratedMods', 'enchantMods', 'veiledMods', 'scourgeMods', 'delveMods'].forEach((key) => {
        asModArray(item[key]).forEach((entry) => {
          if (typeof entry !== 'string') return;
          const line = cleanGameText(entry);
          if (line) modLinesOut.push(line);
        });
      });
    }
    if (modLinesOut.length) blocks.push(modLinesOut.join('\n'));

    if (item.identified === false) blocks.push('Unidentified');
    if (item.mirrored) blocks.push('Mirrored');
    if (item.corrupted || item.doubleCorrupted) blocks.push(item.doubleCorrupted ? 'Double Corrupted' : 'Corrupted');
    if (item.fractured || (Array.isArray(item.fracturedMods) && item.fracturedMods.length)) blocks.push('Fractured Item');

    if (!blocks.length) return '';
    return header.join('\n') + '\n--------\n' + blocks.join('\n--------\n');
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

  function wikiLinks(rec, game, options) {
    const item = (rec && rec.item) || {};
    /* A unique is titled after its name: linking the base would open the page of
       the base item instead of the unique that uses it. */
    const uniqueName = Number(item.frameType) === 3 ? cleanGameText(item.name) : '';
    const base = cleanGameText(uniqueName || item.baseType || item.typeLine || item.name || (rec && rec.name))
      .replace(/^superior\s+/i, '');
    if (!base) return [];
    const version = globalThis.PTC_GAMES.normalizeGame((rec && rec.game) || game);
    const cfg = globalThis.PTC_GAMES.config(version);
    const slug = encodeURIComponent(base.replace(/\s+/g, '_'));
    return [
      {
        label: 'Open in Craft of Exile',
        url: buildCoeImportUrl(rec, version, options) || 'https://beta.craftofexile.com/?game=' + version,
        coe: true,
      },
      { label: version === 'poe1' ? 'poedb' : 'poe2db', url: cfg.dbBase + slug },
      { label: version === 'poe1' ? 'PoE Wiki' : 'PoE2 Wiki', url: cfg.wikiBase + slug },
    ];
  }

  function getIgn(rec) {
    if (!rec) return '';
    return text(rec.ign || rec.characterName
      || (rec.listing && rec.listing.account && rec.listing.account.lastCharacterName)
      || rec.account || '');
  }

  function matchesBlacklist(name, blacklist) {
    const target = normalizeText(name).trim();
    if (!target || !Array.isArray(blacklist)) return false;
    return blacklist.some((entry) => {
      const value = normalizeText(entry).trim();
      return value && (target === value || target.includes(value));
    });
  }

  // ---- stat comparison (rows on the trade page are read into these totals) ----
  const COMPARE_STAT_KEYS = ['life', 'es', 'mana', 'fireRes', 'coldRes', 'lightningRes', 'chaosRes'];
  const COMPARE_STAT_LABELS = {
    life: 'Life', es: 'Energy Shield', mana: 'Mana',
    fireRes: 'Fire Res', coldRes: 'Cold Res', lightningRes: 'Lightning Res', chaosRes: 'Chaos Res',
  };

  function parseCompareStats(text) {
    const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const totals = {};
    const found = {};
    const numberIn = (line) => {
      const match = /([+-]?\d+(?:\.\d+)?)/.exec(line);
      return match ? Number(match[1]) : null;
    };
    lines.forEach((line) => {
      if (/^Item Level:/i.test(line)) {
        const value = numberIn(line);
        if (value != null) totals.ilvl = value;
        return;
      }
      const value = numberIn(line);
      if (value == null) return;
      if (/to (maximum )?Life\b/i.test(line)) { totals.life = (totals.life || 0) + value; found.life = true; }
      else if (/to (maximum )?Energy Shield\b/i.test(line)) { totals.es = (totals.es || 0) + value; found.es = true; }
      else if (/to (maximum )?Mana\b/i.test(line)) { totals.mana = (totals.mana || 0) + value; found.mana = true; }
      else if (/to Fire Resistance/i.test(line)) { totals.fireRes = (totals.fireRes || 0) + value; found.fireRes = true; }
      else if (/to Cold Resistance/i.test(line)) { totals.coldRes = (totals.coldRes || 0) + value; found.coldRes = true; }
      else if (/to Lightning Resistance/i.test(line)) { totals.lightningRes = (totals.lightningRes || 0) + value; found.lightningRes = true; }
      else if (/to Chaos Resistance/i.test(line)) { totals.chaosRes = (totals.chaosRes || 0) + value; found.chaosRes = true; }
    });
    const result = { ilvl: totals.ilvl != null ? totals.ilvl : null };
    COMPARE_STAT_KEYS.forEach((key) => { if (found[key]) result[key] = totals[key]; });
    return result;
  }

  /* A compact message that can be pasted straight into a Discord channel. */
  function discordText(rec) {
    const named = getDisplayName(rec);
    const rarity = getRarity(rec);
    const item = (rec && rec.item) || {};
    const lines = [];
    lines.push('**' + (named.name || 'Item') + '**' + (named.type ? ' - ' + named.type : ''));
    const metaBits = [rarity[1]];
    if (item.ilvl) metaBits.push('ilvl ' + item.ilvl);
    if (rec.league) metaBits.push(rec.league);
    if (rec.priceText) metaBits.push('asked ' + rec.priceText);
    lines.push(metaBits.join(' \u00b7 '));
    if (rec.account) lines.push('Seller: ' + rec.account);
    lines.push('');
    getModGroups(item).forEach((group) => {
      (group.lines || []).forEach((line) => {
        lines.push('- ' + line);
      });
    });
    if ((item.grantedSkills || []).length) {
      lines.push('');
      (item.grantedSkills || []).forEach((skill) => {
        lines.push('- Skill: ' + (skill.name || ''));
      });
    }
    /* Discord has no coloured markdown, but it renders ANSI inside an ```ansi
       block: that is the only way to print the corruption in red, and a
       corrupted item must be obvious to whoever reads the message. */
    if (item.corrupted || item.doubleCorrupted) {
      lines.push('');
      lines.push('```ansi');
      lines.push('\u001b[0;31mCORRUPTED\u001b[0m');
      lines.push('```');
    }
    return lines.join('\n');
  }

  /*
   * The price history for saved listings. Entries land in priceHistory at save time
   * and on every refresh; the chart plots them against real time.
   */
  function priceHistoryPoints(rec) {
    const list = rec && Array.isArray(rec.priceHistory) ? rec.priceHistory : [];
    const points = list
      .map((entry) => ({
        at: Number(entry && entry.at) || 0,
        amount: Number(entry && entry.priceAmount),
        text: entry && entry.priceText || '',
        currency: entry && entry.priceCurrency || '',
      }))
      .filter((entry) => entry.at > 0 && Number.isFinite(entry.amount) && entry.amount > 0);
    points.sort((a, b) => a.at - b.at);
    return points;
  }

  function formatPriceAmount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value == null ? '' : value);
    return (Math.round(number * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function buildPriceChart(rec, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const all = priceHistoryPoints(rec);
    if (all.length < 2) return null;
    // A listing can change currency over time; plot the currency it uses now
    // (the most common one when the current one has too few samples).
    let points = all;
    const lastCurrency = String(all[all.length - 1].currency || '').toLowerCase();
    if (lastCurrency) {
      const same = all.filter((entry) => String(entry.currency || '').toLowerCase() === lastCurrency);
      if (same.length >= 2) points = same;
    }
    if (points.length < 2) return null;
    const width = Number(opts.width) || 280;
    const height = Number(opts.height) || 72;
    const padX = 8;
    const padTop = 10;
    const padBottom = 8;
    const t0 = points[0].at;
    const t1 = points[points.length - 1].at;
    const span = Math.max(1, t1 - t0);
    const values = points.map((entry) => entry.amount);
    let min = Math.min.apply(null, values);
    let max = Math.max.apply(null, values);
    if (max - min < 1e-9) { min -= 1; max += 1; }
    const padValue = (max - min) * 0.12;
    min -= padValue;
    max += padValue;
    const range = max - min;
    const x = (time) => padX + ((time - t0) / span) * (width - padX * 2);
    const y = (value) => padTop + (1 - (value - min) / range) * (height - padTop - padBottom);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('class', 'price-chart-svg');
    svg.setAttribute('preserveAspectRatio', 'none');
    const gridLow = document.createElementNS(NS, 'line');
    gridLow.setAttribute('x1', String(padX));
    gridLow.setAttribute('x2', String(width - padX));
    gridLow.setAttribute('y1', (height - padBottom).toFixed(1));
    gridLow.setAttribute('y2', (height - padBottom).toFixed(1));
    gridLow.setAttribute('class', 'pc-grid');
    svg.appendChild(gridLow);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', points.map((entry, index) => (index ? 'L' : 'M') + x(entry.at).toFixed(1) + ' ' + y(entry.amount).toFixed(1)).join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(path);
    points.forEach((entry) => {
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', x(entry.at).toFixed(1));
      dot.setAttribute('cy', y(entry.amount).toFixed(1));
      dot.setAttribute('r', '2.2');
      dot.setAttribute('fill', 'currentColor');
      dot.setAttribute('vector-effect', 'non-scaling-stroke');
      const title = document.createElementNS(NS, 'title');
      title.textContent = entry.text + ' \u00b7 ' + new Date(entry.at).toLocaleString();
      dot.appendChild(title);
      svg.appendChild(dot);
    });
    const first = values[0];
    const last = values[values.length - 1];
    const delta = last - first;
    const wrap = document.createElement('div');
    wrap.className = 'price-chart' + (delta < 0 ? ' is-down' : delta > 0 ? ' is-up' : ' is-flat');
    wrap.appendChild(svg);
    return wrap;
  }

  window.PTC = {
    createEl,
    text,
    normalizeText,
    cleanGameText,
    cleanMod,
    asModArray,
    getModGroups,
    getRarity,
    searchModLines,
    hasCrafted,
    hasFractured,
    safeIconUrl,
    safePoeUrl,
    getDisplayName,
    buildItemText,
    buildCoePaste,
    coeImportSummary,
    coeTemplateLine,
    coeTextWithRange,
    renderItemTooltip,
    timeAgo,
    timeUntil,
    formatDate,
    parseListingDate,
    listedAt,
    priceValue,
    formatValueScore,
    discordText,
    valueScore,
    parseTradeUrl,
    buildTradeUrl,
    buildLeagueSearchUrl,
    decodeSearchQuery,
    encodeSearchQuery,
    savedSearchHasFilters,
    savedSearchUsable,
    gameFromUrl,
    currencyId,
    parsePriceText,
    convertPrice,
    formatConversion,
    formatNumber,
    fuzzyMatch,
    maxSockets,
    itemClassFromBase,
    wikiLinks,
    stripWhisperTokens,
    buildCoeImportUrl,
    getIgn,
    matchesBlacklist,
    parseCompareStats,
    priceHistoryPoints,
    formatPriceAmount,
    buildPriceChart,
  };
})();


