/* ==========================================================================
   Poe Trade Watcher — market analysis helpers
   --------------------------------------------------------------------------
   Shared by the side panel and the trade-page content script.

   Exposes `globalThis.PTC_FEATURES`:
     .indexKey(rec)             – bucket key for the local price index
     .buildIndex(records)       – price index built from observed listings
     .fairPrice(index, rec)     – median price of comparable listings
     .valueRatio(index, rec)    – price / median (lower than 1 = cheap)
     .scamFlags(index, rec, now)– heuristics for bait / overpriced listings
     .craftCost(rec, coe, prices, index) – rough cost to craft the item
   ========================================================================== */

(function (root) {
  'use strict';

  const ILVL_BUCKETS = [0, 40, 60, 70, 80, 85, 90, 95];

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function baseTypeOf(rec) {
    const item = (rec && rec.item) || {};
    return clean(item.baseType || item.typeLine || item.name)
      .replace(/^superior\s+/i, '')
      .toLowerCase();
  }

  function rarityOf(rec) {
    const item = (rec && rec.item) || {};
    /* The trade API sends frameType as a number (1 magic, 2 rare, 3 unique) and no
       rarity string, so the number is read first: every listing used to be
       bucketed as "normal" and rare items were compared against uniques. */
    const frame = Number(item.frameType);
    if (Number.isFinite(frame) && frame > 0) {
      if (frame === 3) return 'unique';
      if (frame === 2) return 'rare';
      if (frame === 1) return 'magic';
      return 'normal';
    }
    const raw = clean(item.rarity || '').toLowerCase();
    if (raw.indexOf('unique') === 0) return 'unique';
    if (raw.indexOf('rare') === 0) return 'rare';
    if (raw.indexOf('magic') === 0) return 'magic';
    return 'normal';
  }

  function ilvlOf(rec) {
    const item = (rec && rec.item) || {};
    return Math.max(0, Math.min(100, Number(item.ilvl) || 0));
  }

  function ilvlBucket(ilvl) {
    let bucket = ILVL_BUCKETS[0];
    for (let i = 0; i < ILVL_BUCKETS.length; i += 1) {
      if (ilvl >= ILVL_BUCKETS[i]) bucket = ILVL_BUCKETS[i];
    }
    return bucket;
  }

  function indexKey(rec) {
    return [baseTypeOf(rec), rarityOf(rec), ilvlBucket(ilvlOf(rec))].join('|');
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /*
   * The price index is built from every listing the user has seen or saved.
   * It is a rough local market sample: not a global market feed, but enough to
   * tell a fair price from a suspiciously cheap one.
   */
  function buildIndex(records, priceOf) {
    const index = new Map();
    records.forEach((rec) => {
      const price = priceOf ? priceOf(rec) : Number(rec && rec.priceValue);
      if (!isFinite(price) || price <= 0) return;
      const key = indexKey(rec);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(price);
    });
    const summary = new Map();
    index.forEach((values, key) => {
      summary.set(key, {
        count: values.length,
        median: median(values),
        min: Math.min.apply(null, values),
        max: Math.max.apply(null, values),
      });
    });
    return summary;
  }

  function bucketFor(index, rec) {
    if (!index || typeof index.get !== 'function') return null;
    const exact = index.get(indexKey(rec));
    if (exact && exact.count >= 3) return exact;
    /* fall back to the same rarity and base with any ilvl bucket */
    const base = baseTypeOf(rec);
    const rarity = rarityOf(rec);
    let best = null;
    index.forEach((entry, key) => {
      const parts = key.split('|');
      if (parts[0] !== base || parts[1] !== rarity) return;
      if (!best || entry.count > best.count) best = entry;
    });
    return best;
  }

  function fairPrice(index, rec) {
    const bucket = bucketFor(index, rec);
    return bucket && bucket.count >= 3 ? bucket.median : null;
  }

  /* price / median. Below 1 means cheaper than what was seen so far. */
  function valueRatio(index, rec) {
    const median = fairPrice(index, rec);
    if (median == null || median <= 0) return null;
    const price = Number(rec && rec.priceValue);
    if (!isFinite(price) || price <= 0) return null;
    return price / median;
  }

  /*
   * Price mining: a seller lists an item far below the market price so other
   * players buy it instantly, and the seller buys it back from them at the
   * real price. The tell is a very fresh listing at an extreme discount.
   */
  function scamFlags(index, rec, now) {
    const flags = [];
    if (!rec) return flags;
    const ratio = valueRatio(index, rec);
    const listedAt = Number(rec.listedAt || rec.dateListed || 0);
    const ageMinutes = listedAt ? Math.max(0, (now - listedAt) / 60000) : null;

    if (ratio != null && ratio < 0.55) {
      flags.push({
        id: 'price-mining',
        level: ageMinutes != null && ageMinutes <= 10 ? 'high' : 'medium',
        text: 'Listed at ' + Math.round((1 - ratio) * 100) + '% below the observed price',
      });
    }

    const history = Array.isArray(rec.priceHistory) ? rec.priceHistory : [];
    if (history.length >= 3) {
      const prices = history.map((entry) => Number(entry && entry.priceAmount)).filter((v) => isFinite(v) && v > 0);
      if (prices.length >= 3) {
        const first = prices[0];
        const last = prices[prices.length - 1];
        if (first > 0 && last < first * 0.4) {
          flags.push({
            id: 'price-drop',
            level: 'medium',
            text: 'Price dropped ' + Math.round((1 - last / first) * 100) + '% since it was first seen',
          });
        }
      }
    }

    const expiry = Number(rec.expiresAt || 0);
    if (expiry && now > expiry) {
      flags.push({ id: 'expired', level: 'low', text: 'The listing has expired' });
    }

    return flags;
  }

  /* ------------------------------------------------------------------ */
  /* Crafting cost                                                       */
  /* ------------------------------------------------------------------ */

  /* Rough price of the currency used to roll a modifier of a given tier. The
     ladder itself is a property of the game and comes from its profile. */

  function currencyPrice(prices, id) {
    if (!prices || !prices.rates) return null;
    const rate = prices.rates[id];
    const chaosRate = prices.rates.chaos;
    if (!isFinite(rate) || !isFinite(chaosRate) || chaosRate <= 0) return null;
    return rate / chaosRate;
  }

  function tierCurrencyCost(tier, prices, game) {
    const table = globalThis.PTC_GAMES.profile(game).tierCurrency || [];
    let choice = table[0] || { currency: 'chaos' };
    table.forEach((entry) => { if (tier >= entry.tier) choice = entry; });
    const cost = currencyPrice(prices, choice.currency);
    return cost == null ? 0 : cost;
  }

  /*
   * Estimates what it would cost to craft the item from scratch:
   *   base price + one currency roll per crafted modifier.
   * The base price comes from the local market index when the base was seen
   * before, otherwise it is unknown and reported as such.
   */
  function craftCost(rec, coeIndex, prices, index) {
    const item = (rec && rec.item) || {};
    const result = {
      known: false,
      base: null,
      mods: 0,
      modCost: 0,
      total: null,
      cheaperToCraft: null,
      notes: [],
    };

    const base = baseTypeOf(rec);
    const bucket = index && typeof index.get === 'function' ? index.get(base + '|normal|0') : null;
    if (bucket && bucket.median) result.base = bucket.median;

    const crafted = Array.isArray(item.craftedMods) ? item.craftedMods : [];
    const fractured = Array.isArray(item.fracturedMods) ? item.fracturedMods : [];
    result.mods = crafted.length + fractured.length;

    if (crafted.length && coeIndex && prices) {
      crafted.forEach((entry) => {
        const text = clean(entry && entry.text);
        if (!text) return;
        const mod = typeof coeIndex.resolveMod === 'function' ? coeIndex.resolveMod(coeIndex, base, text) : null;
        const tier = mod && Number.isFinite(mod.tier) ? mod.tier : 3;
        result.modCost += tierCurrencyCost(tier, prices, rec.game);
      });
    } else if (crafted.length) {
      result.notes.push('Crafting prices need the Craft of Exile data, which is not loaded yet.');
    }

    if (result.base != null) {
      result.total = result.base + result.modCost;
      result.known = true;
      const price = Number(rec.priceValue);
      if (isFinite(price) && price > 0) {
        result.cheaperToCraft = result.total < price;
        result.notes.push(result.cheaperToCraft
          ? 'Crafting this yourself is cheaper than buying it.'
          : 'Buying this listing is cheaper than crafting it.');
      }
    } else {
      result.notes.push('No market price known for this base yet.');
    }

    return result;
  }

  const api = {
    ILVL_BUCKETS,
    baseTypeOf,
    rarityOf,
    ilvlOf,
    ilvlBucket,
    indexKey,
    median,
    buildIndex,
    fairPrice,
    valueRatio,
    scamFlags,
    craftCost,
  };

  root.PTC_FEATURES = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
