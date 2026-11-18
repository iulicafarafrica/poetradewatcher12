/*
 * Craft of Exile beta integration helpers.
 *
 * The beta site (https://beta.craftofexile.com) can import an item through the
 * documented "eimport" parameter, but it resolves modifiers by their display
 * text, so local and composite modifiers are dropped. The site also accepts a
 * "details" payload (the same one it produces itself) that references the
 * internal base id and the internal stat keys - that payload is what this
 * module builds, using the public data files the site itself loads.
 */
(() => {
  'use strict';

  const COE_BETA = 'https://beta.craftofexile.com';
  const COE_DATA_TTL = 12 * 60 * 60 * 1000;

  const indexCache = new Map();
  const indexPromises = new Map();

  function gameKey(game) {
    return globalThis.PTC_GAMES
      ? globalThis.PTC_GAMES.normalizeGame(game)
      : (String(game) === 'poe1' ? 'poe1' : 'poe2');
  }

  function normalizeTemplate(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[0-9]+(?:\.[0-9]+)?/g, '#')
      .replace(/[^a-z0-9#]+/g, '');
  }

  function normalizeName(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function firstNumber(text) {
    const match = /(-?\d+(?:\.\d+)?)/.exec(String(text || ''));
    return match ? Number(match[1]) : null;
  }

  /*
   * The site stores one value per stat of a modifier, in order, so
   * "Adds 10 to 20 Fire Damage" is [10, 20] and not [10].
   */
  function numbersFrom(text) {
    const out = [];
    const pattern = /(-?\d+(?:\.\d+)?)/g;
    let match = null;
    while ((match = pattern.exec(String(text || '')))) out.push(Number(match[1]));
    return out;
  }

  function parsePayload(text) {
    const trimmed = String(text || '').trim();
    const assignment = /=\s*([\{\[])/.exec(trimmed);
    const start = assignment ? assignment.index + assignment[0].length - 1 : 0;
    const open = trimmed[start];
    const close = open === '{' ? '}' : ']';
    const end = trimmed.lastIndexOf(close);
    if (end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('Unexpected Craft of Exile data format.');
  }

  /*
   * Craft of Exile names every affix with its tier ("{ Prefix Modifier
   * "Lacquered" (Tier: 10) }"). Without the tier the site cannot tell which
   * of the many affixes that share a name is meant, and it refuses the whole
   * paste with "the search is no longer valid". The tier is the number the
   * modifier's key ends with.
   */
  function tierFromKey(key) {
    const match = /(\d+)$/.exec(String(key == null ? '' : key));
    if (!match) return 0;
    const tier = Number(match[1]);
    return isFinite(tier) && tier >= 1 && tier <= 40 ? tier : 0;
  }

  function buildIndex(data, labels) {
    const items = new Map();
    const itemEntries = (data.items && data.items.entries) || [];
    itemEntries.forEach((entry) => {
      const name = labels[entry.label];
      if (!name) return;
      const key = normalizeName(name);
      if (!items.has(key)) items.set(key, { key: key, id: entry.id, class: entry.class, name: name, meta: entry.key || '' });
    });
    const statIds = {};
    Object.keys(data.stats || {}).forEach((groupKey) => {
      const stat = data.stats[groupKey];
      if (stat && stat.id) statIds[groupKey] = stat.id;
    });
    const templates = new Map();
    const modEntries = (data.mods && data.mods.entries) || [];
    modEntries.forEach((entry) => {
      (entry.stats || []).forEach((stat) => {
        const template = labels[stat.label];
        if (!template) return;
        /* The site writes a stat with alternatives as "[Resistances|Cold
           Resistance]" - the item itself says "Cold Resistance". Both forms
           are indexed, so the modifier of an item is found either way. */
        const keys = [normalizeTemplate(template)];
        const alt = poolTemplateKey(template);
        if (alt && keys.indexOf(alt) === -1) keys.push(alt);
        keys.forEach((key) => {
          const list = templates.get(key) || [];
          list.push({
            modKey: entry.key,
            statIndex: stat.index,
            min: stat.range ? stat.range[0] : null,
            max: stat.range ? stat.range[1] : null,
            statCount: (entry.stats || []).length,
          });
          templates.set(key, list);
        });
      });
    });
    const classes = {};
    const classEntries = (data.classes && data.classes.entries) || [];
    classEntries.forEach((entry) => {
      /* The class name lives in the localization table; "class" is only the
         numeric id, which is not what a paste needs. */
      classes[entry.id] = {
        group: entry.group,
        class: entry.class,
        name: labels[entry.label] || entry.label || '',
      };
    });
    // Per-class mod pools for classifyModType and for the affix names that Craft
    // of Exile needs in the paste (see resolveMod below).
    const classMods = new Map();
    const classModStats = new Map();
    /* Every modifier of the class as a whole: its stats in printed order, each
       with the wording and roll range. A hybrid affix ("#% increased Physical
       Damage / +# to Accuracy Rating") is one modifier with two stats, while the
       trade API prints it as two lines - which is what this map is for. */
    const classModForms = new Map();
    const modEntriesAll = (data.mods && data.mods.entries) || [];
    const modById = new Map();
    modEntriesAll.forEach((entry) => { if (entry && entry.id != null) modById.set(entry.id, entry); });
    const groupById = new Map();
    ((data.modgroups && data.modgroups.entries) || []).forEach((entry) => { if (entry && entry.id != null) groupById.set(entry.id, entry); });
    const pools = data.classmods;
    if (pools && typeof pools === 'object') {
      Object.keys(pools).forEach((classKey) => {
        const pool = pools[classKey];
        if (!pool || typeof pool !== 'object') return;
        let byText = classMods.get(Number(classKey));
        if (!byText) { byText = new Map(); classMods.set(Number(classKey), byText); }
        let statsByText = classModStats.get(Number(classKey));
        if (!statsByText) { statsByText = new Map(); classModStats.set(Number(classKey), statsByText); }
        let formsByKey = classModForms.get(Number(classKey));
        if (!formsByKey) { formsByKey = new Map(); classModForms.set(Number(classKey), formsByKey); }
        Object.keys(pool).forEach((key) => {
          const mod = modById.get(Number(key));
          if (!mod) return;
          const group = groupById.get(mod.group);
          if (!group || (group.type !== 1 && group.type !== 2)) return;
          const name = labels[mod.label] || '';
          let form = formsByKey.get(mod.key);
          if (!form) {
            form = {
              key: mod.key,
              name: name,
              type: group.type === 1 ? 'prefix' : 'suffix',
              tier: tierFromKey(mod.key),
              stats: [],
            };
            formsByKey.set(mod.key, form);
          }
          (mod.stats || []).forEach((stat, position) => {
            const template = labels[stat && stat.label];
            if (!template) return;
            const tkey = poolTemplateKey(template);
            if (!tkey) return;
            form.stats.push({
              templateKey: tkey,
              min: stat.range ? stat.range[0] : null,
              max: stat.range ? stat.range[1] : null,
            });
            let row = byText.get(tkey);
            if (!row) { row = { prefix: false, suffix: false }; byText.set(tkey, row); }
            row[group.type === 1 ? 'prefix' : 'suffix'] = true;
            // One entry per tier: a rolled value inside [min, max] picks the tier,
            // and its name is what the site matches the affix header against.
            let list = statsByText.get(tkey);
            if (!list) { list = []; statsByText.set(tkey, list); }
            list.push({
              name: name,
              type: group.type === 1 ? 'prefix' : 'suffix',
              min: stat.range ? stat.range[0] : null,
              max: stat.range ? stat.range[1] : null,
              key: mod.key,
              tier: tierFromKey(mod.key),
              /* How many numbers the modifier prints. A pure "+# to maximum Life"
                 prints one; a hybrid prints one per stat. The item line prints
                 the same count, which is what tells a hybrid from the pure
                 modifier when both share the first stat's wording. */
              statCount: (mod.stats || []).length,
              /* The site's own wording of the stat ("+#% to [Resistances|Cold
                 Resistance]"). A build import writes the same roll in Path of
                 Building's wording, which the site cannot match; the paste is
                 built from this template instead. */
              template: template,
            });
          });
        });
      });
    }
    return { items: items, statIds: statIds, templates: templates, classes: classes, classMods: classMods, classModStats: classModStats, classModForms: classModForms };
  }

  // CoE's own importer matches paste affixes against the per-class mod pools
  // (data.json: classmods -> mods -> modgroups.type 1/2). Its labels use
  // "[A|B]" = pick-one forms; the display form (B) is what players see on an
  // item, so classification keys normalize that way. Used only by the build
  // importer: build codes carry no {prefix}/{suffix} tags on equipped items,
  // and CoE drops plain affix lines that have no "… Modifier" header above them.
  function poolTemplateKey(value) {
    /* One canonical form for both sides of the comparison, so a modifier
       written by Path of Building finds the same pool entry the game uses. */
    if (typeof globalThis !== 'undefined' && globalThis.PTC_MODTEXT) {
      return globalThis.PTC_MODTEXT.canonical(value);
    }
    return String(value == null ? '' : value)
      .replace(/\[[^\]]*\|([^\]]*)\]/g, '$1')
      .replace(/\[[^\]]*\]/g, (match) => match.slice(1, -1))
      .toLowerCase()
      .replace(/[0-9.]+/g, '#')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function classifyModType(index, baseName, text) {
    const mod = resolveMod(index, baseName, text);
    if (mod) return mod.type;
    return '';
  }

  /*
   * Craft of Exile matches each affix of an imported paste by the name written in
   * its "{ Prefix/Suffix Modifier "…" }" header: the stat text alone is not
   * enough (measured on the live site - a paste with bare lines loads the base
   * but none of its mods). Saved items get that name from the trade API; build
   * imports never do, so it is resolved here from the site's own mod pool: the
   * template tells which affix, the rolled value tells which tier.
   */
  function resolveMod(index, baseName, text) {
    if (!index || !baseName || !text) return null;
    const item = index.items.get(normalizeName(baseName));
    if (!item) return null;
    const byText = index.classModStats && index.classModStats.get(item.class);
    if (!byText) return null;
    /* A line written by Path of Building can use either spelling, so every
       plausible key is tried before the modifier is given up on. */
    let list = null;
    const keys = typeof globalThis !== 'undefined' && globalThis.PTC_MODTEXT
      ? globalThis.PTC_MODTEXT.candidates(text)
      : [poolTemplateKey(text)];
    for (let i = 0; i < keys.length; i += 1) {
      const found = byText.get(keys[i]);
      if (found && found.length) { list = found; break; }
    }
    if (!list || !list.length) return null;
    let pick = list[0];
    if (list.length > 1) {
      const value = firstNumber(text);
      if (Number.isFinite(value)) {
        const inside = list.filter((entry) => entry.min != null && entry.max != null
          && value >= entry.min && value <= entry.max);
        if (inside.length) {
          // Several tiers can contain the value when their ranges overlap; the
          // narrowest one is the specific affix the item really rolled.
          pick = inside.reduce((best, entry) => (
            (entry.max - entry.min) < (best.max - best.min) ? entry : best), inside[0]);
        } else {
          // The roll can fall outside the current patch's table (an old item, or
          // a mod the site lists under another domain). The closest tier still
          // carries the right affix name.
          const distance = (entry) => (value < entry.min ? entry.min - value
            : value > entry.max ? value - entry.max : 0);
          pick = list.reduce((best, entry) => {
            if (entry.min == null || entry.max == null) return best;
            if (best.min == null || best.max == null) return entry;
            return distance(entry) < distance(best) ? entry : best;
          }, pick);
        }
      }
    }
    if (!pick || !pick.name) return null;
    return {
      name: pick.name,
      type: pick.type,
      tier: Number(pick.tier) || 0,
      template: String(pick.template || ''),
      min: Number.isFinite(pick.min) ? pick.min : null,
      max: Number.isFinite(pick.max) ? pick.max : null,
    };
  }

  function modFlags(entry) {
    const flags = (entry && entry.flags && typeof entry.flags === 'object') ? entry.flags : {};
    const domain = String((entry && entry.domain) || '').toLowerCase();
    const out = [];
    if (flags.fractured || domain === 'fractured') out.push('f');
    if (flags.crafted || domain === 'crafted') out.push('c');
    if (flags.desecrated || domain === 'desecrated') out.push('d');
    if (flags.enchant || domain === 'enchant') out.push('e');
    return out;
  }

  function detailsFromRecord(rec, index, helpers) {
    const clean = (helpers && helpers.cleanGameText) || ((value) => String(value == null ? '' : value).trim());
    const asArray = (helpers && helpers.asArray) || ((value) => (Array.isArray(value) ? value : []));
    const item = (rec && rec.item) || {};
    const typeLine = clean(item.typeLine) || clean(item.baseType);
    const base = index.items.get(normalizeName(typeLine));
    if (!base) return null;
    const classInfo = index.classes[base.class] || {};
    const mods = [];
    const version = gameKey(index.game);
    /* Which affix arrays the import reads is a property of the game, so it comes
       from that game's profile (ptc-poe1.js / ptc-poe2.js). The two lists are
       repeated below only as the fallback for a profile that failed to load: the
       import keeps working, and the other game is never consulted. */
    const gameProfile = globalThis.PTC_GAMES && globalThis.PTC_GAMES.profile
      ? globalThis.PTC_GAMES.profile(version) : null;
    const modKeys = (gameProfile && gameProfile.coeModKeys && gameProfile.coeModKeys.length)
      ? gameProfile.coeModKeys
      : (version === 'poe1'
        ? ['explicitMods', 'craftedMods', 'fracturedMods', 'enchantMods', 'veiledMods', 'scourgeMods', 'delveMods']
        : ['explicitMods', 'craftedMods', 'fracturedMods', 'desecratedMods', 'enchantMods']);
    modKeys.forEach((key) => {
      asArray(item[key]).forEach((entry) => {
        // Saved listings store mod objects; build imports store plain text lines,
        // which are explicit mods by definition.
        const isText = typeof entry === 'string';
        if (!isText && (!entry || typeof entry !== 'object')) return;
        const domain = isText ? 'explicit' : String(entry.domain || '').toLowerCase();
        if (domain === 'implicit' || domain === 'rune') return;
        /* PoE 2 entries carry the wording in "description"/"text", PoE 1 trade
           API entries in "value" - read all three or a PoE 1 item would import
           with no mods at all. */
        const text = clean(isText ? entry : (entry.description || entry.text || entry.value));
        if (!text) return;
        const values = numbersFrom(text);
        const value = values.length ? values[0] : null;
        /* A modifier with no number ("Cannot be Frozen", "Allocates ...") is
           still a modifier: it goes into the import with an empty value list
           instead of being dropped. */
        /* The site's wording and the item's wording can differ in the
           "pick one" form ("[Resistances|Cold Resistance]" against "Cold
           Resistance"), so both normalizations are tried. The pool of the
           item's own class comes first: the same stat text can belong to
           another class ("increased Spell Damage" is a weapon modifier), and
           only the class pool holds the modifier that fits this base. */
        const pool = index.classModStats && base.class != null
          ? index.classModStats.get(base.class) : null;
        let candidates = null;
        if (pool) {
          const list = pool.get(poolTemplateKey(text)) || pool.get(normalizeTemplate(text));
          if (list && list.length) {
            candidates = list.map((entry) => ({
              modKey: entry.key,
              statIndex: 0,
              min: entry.min,
              max: entry.max,
              statCount: entry.statCount,
            }));
          }
        }
        if (!candidates || !candidates.length) {
          candidates = index.templates.get(poolTemplateKey(text))
            || index.templates.get(normalizeTemplate(text))
            || [];
        }
        if (!candidates.length) return;
        /* A hybrid modifier ("#% increased Energy Shield, # to Spirit") prints
           two numbers and shares the first stat's wording with the pure one.
           The item line prints one number, so the modifier whose number count
           matches the line is the one the item actually has - without this the
           item silently gained the hybrid's second stat. */
        const fits = (candidate) => {
          if (value == null) return candidate.min == null || candidate.max == null;
          if (candidate.min == null || candidate.max == null) return true;
          return value >= candidate.min && value <= candidate.max;
        };
        const sameSize = (candidate) => candidate.statCount === values.length;
        /* A line with several numbers is one modifier with several stats ("Adds
           32 to 68 Physical Damage"), so its tier has to hold every number, not
           just the first one - the class forms carry the range of each stat. */
        if (values.length > 1 && index.classModForms && base.class != null) {
          const classForms = index.classModForms.get(base.class);
          const templateKey = poolTemplateKey(text);
          const multi = classForms ? Array.from(classForms.values()).find((form) => {
            if (form.stats.length !== values.length) return false;
            return form.stats.every((stat, position) => stat.templateKey === templateKey
              && (stat.min == null || stat.max == null
                || (values[position] >= stat.min && values[position] <= stat.max)));
          }) : null;
          if (multi) {
            const flagSource = isText
              ? { domain: String(key || '').replace(/Mods$/i, '').toLowerCase() }
              : entry;
            mods.push({ k: multi.key, v: values, f: modFlags(flagSource), p: null });
            return;
          }
        }
        const hit = candidates.find((candidate) => fits(candidate) && sameSize(candidate))
          || candidates.find(fits)
          || candidates.find(sameSize)
          || candidates[0];
        // Only a modifier key can be imported; the site resolves it against its own
        // modifier dictionary, so a bare stat id would silently break the import.
        const modKey = hit.modKey;
        if (!modKey) return;
        /* A build import keeps crafted / fractured / enchant mods as plain
           strings, so the flag has to come from the field the line came from. */
        const flagSource = isText
          ? { domain: String(key || '').replace(/Mods$/i, '').toLowerCase() }
          : entry;
        mods.push({ k: modKey, v: values, f: modFlags(flagSource), p: null });
      });
    });
    let quality = 0;
    const qualityProp = (item.properties || []).find((prop) => prop && /quality/i.test(String(prop.name || '')));
    if (qualityProp && Array.isArray(qualityProp.values) && qualityProp.values.length) {
      const parsed = parseInt(String(qualityProp.values[0][0] || '').replace(/[^0-9-]/g, ''), 10);
      if (Number.isFinite(parsed)) quality = parsed;
    } else if (item.quality != null && item.quality !== '') {
      // Build imports carry quality as a plain string instead of a property.
      const parsed = parseInt(String(item.quality).replace(/[^0-9-]/g, ''), 10);
      if (Number.isFinite(parsed)) quality = parsed;
    }
    const frame = Number.isInteger(item.frameType) ? item.frameType : 0;
    const rarity = frame === 3 ? 'unique' : frame === 2 ? 'rare' : frame === 1 ? 'magic' : 'normal';
    /*
     * Field for field the payload the site writes itself (GameItem.exportData):
     * ns is a socket count, p is left null so the site rolls the base properties,
     * and f never carries "a" or the imported item would be saved to the profile.
     */
    /* Saved listings carry the sockets as a "R-G-B" string, build imports as
       a count or an array - count the letters so the item keeps its sockets. */
    let socketCount = 0;
    if (Array.isArray(item.sockets)) socketCount = item.sockets.length;
    else {
      const letters = String(item.sockets == null ? '' : item.sockets).match(/[RGBY]/g) || [];
      socketCount = letters.length;
    }
    /* Item-level flags the site reads from `f`: corrupted, mirrored and split.
       They are part of the item, so a corrupted listing must import corrupted -
       otherwise the import looks clean and the crafting math is wrong. */
    const itemFlags = [];
    if (item.corrupted || item.doubleCorrupted) itemFlags.push('c');
    if (item.mirrored) itemFlags.push('m');
    if (item.split) itemFlags.push('p');
    const details = {
      i: base.key,
      m: mods,
      ns: socketCount,
      s: [],
      q: quality,
      qt: null,
      l: Number.isFinite(Number(item.ilvl)) ? Number(item.ilvl) : 0,
      r: rarity,
      if: [],
      ip: [],
      e: [],
      p: null,
      di: [],
      ig: 0,
      ms: 0,
      f: itemFlags,
      pt: null,
      id: null,
    };
    /* The site looks the payload's base up in its item dictionary by the
       metadata path ("Metadata/Items/Rings/Ring2"); a normalized name misses,
       and the mods would be dropped on import. The item id in the URL is
       authoritative for the base - the site applies the payload on top of the
       item selected by that id. */
    details.i = base.meta || details.i;
    const group = classInfo.group != null ? classInfo.group : 0;
    const cls = base.class != null ? base.class : 0;
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(details))));
    return {
      url: COE_BETA + '/?game=' + version + '&group=' + group + '&class=' + cls + '&item=' + base.id
        + '&details=' + encodeURIComponent(encoded) + '&method=0&flags=',
      mods: mods.length,
      base: base.key,
    };
  }

  /*
   * The beta site serves the planner of the game in the URL (?game=poe1/poe2).
   * Each game publishes its own patch under /json/<game>/, so the index and the
   * patch are read from the requested game's own page and data files.
   */
  async function loadIndex(fetchText, game) {
    const version = gameKey(game);
    const cached = indexCache.get(version);
    if (cached && Date.now() - cached.at < COE_DATA_TTL) return cached.index;
    if (indexPromises.has(version)) return indexPromises.get(version);
    const task = (async () => {
      const html = await fetchText(COE_BETA + '/?game=' + version);
      const patchMatch = /"patch":"([^"]+)"/.exec(html);
      if (!patchMatch) throw new Error('Could not read the Craft of Exile patch.');
      const patch = patchMatch[1];
      const [dataText, labelsText] = await Promise.all([
        fetchText(COE_BETA + '/json/' + version + '/' + patch + '/data.json'),
        fetchText(COE_BETA + '/json/' + version + '/' + patch + '/localization/english.json'),
      ]);
      const index = buildIndex(parsePayload(dataText), parsePayload(labelsText));
      index.game = version;
      indexCache.set(version, { patch: patch, at: Date.now(), index: index });
      return index;
    })();
    indexPromises.set(version, task);
    try {
      return await task;
    } finally {
      indexPromises.delete(version);
    }
  }

  const api = {
    COE_BETA: COE_BETA,
    normalizeTemplate: normalizeTemplate,
    normalizeName: normalizeName,
    firstNumber: firstNumber,
    numbersFrom: numbersFrom,
    parsePayload: parsePayload,
    buildIndex: buildIndex,
    modFlags: modFlags,
    classifyModType: classifyModType,
    resolveMod: resolveMod,
    detailsFromRecord: detailsFromRecord,
    loadIndex: loadIndex,
    /* Craft of Exile names its own item classes ("Body Armours (DEX/INT)"),
       which are not the trade site's names ("Body Armours"). The paste needs
       the Craft of Exile spelling. */
    className: function (index, classId) {
      const info = index && index.classes && index.classes[classId];
      if (!info) return '';
      return info.name || (info.class && typeof info.class === 'string' ? info.class : '');
    },
    baseName: function (index, baseType) {
      const item = index && index.items && index.items.get(normalizeName(baseType));
      return item && item.name ? String(item.name) : '';
    },
  };

  if (typeof globalThis !== 'undefined') globalThis.COE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
