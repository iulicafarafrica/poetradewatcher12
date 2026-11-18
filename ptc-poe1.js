/* ==========================================================================
   Poe Trade Watcher — Path of Exile 1 profile
   --------------------------------------------------------------------------
   Everything that is only true of PoE 1 lives in this file, and everything that
   is only true of PoE 2 lives in ptc-poe2.js. The two files have exactly the
   same shape, so the shared code never asks "which game is this?" for a value
   that belongs to a game: it asks PTC_GAMES.profile(game) for one profile and
   reads the field.

   The rule that keeps the games apart:
     - a shared file may read `profile.x`; it may not contain a PoE 1 or a PoE 2
       value of its own (no game name in a table, no game-specific regex);
     - a profile only ever describes its own game, so a wrong value or a thrown
       error in here can only affect PoE 1;
     - if this file is missing or broken, PTC_GAMES.profile('poe1') returns the
       empty profile (no modifier lists, no category map, no currency) and PoE 2
       carries on unchanged — the feature degrades, it does not crash, and it
       never reaches into the other game.

   Fields (same in ptc-poe2.js):
     id                    canonical game id
     label                 the name used in the ui
     searchModLists        stored modifier arrays that become trade stat filters
     desecratedAsExplicit  whether a desecrated modifier is searched as explicit
     skippedStatDomains    stat domains that never become a filter
     coeModKeys            modifier arrays the Craft of Exile import reads
     coeDetailsImport      whether Craft of Exile opens the item by its own id
     tradeCategoryByClass  item class -> trade site category id, or null
     defaultCurrency       the currency prices are expressed in
     currencyWeight        offline fallback value of one unit, in the default currency
     modLegends            the colours the site gives the modifier kinds
     tierCurrency          rough tier -> currency ladder for the craft estimate
   ========================================================================== */

(function (root) {
  'use strict';

  const profile = {
    id: 'poe1',
    label: 'PoE 1',

    /* PoE 1 lists no desecrated modifiers: explicit, crafted and fractured are
       the affixes a search can ask for. */
    searchModLists: ['explicitMods', 'craftedMods', 'fracturedMods'],
    desecratedAsExplicit: false,
    skippedStatDomains: ['implicit', 'rune', 'enchant'],

    /* The Craft of Exile importer takes the affix lines as the game writes them,
       including the ones Path of Building keeps apart. */
    coeModKeys: ['explicitMods', 'craftedMods', 'fracturedMods', 'enchantMods',
      'veiledMods', 'scourgeMods', 'delveMods'],

    /* PoE 1 opens the item by its own base id: the paste importer matches the
       base by name and can land on another base. */
    coeDetailsImport: true,

    /* The site's category filter is a PoE 2 convenience here; PoE 1 searches use
       the base type only. */
    tradeCategoryByClass: null,

    defaultCurrency: 'chaos',

    /* Fallback values in chaos orbs, used only when poe.ninja is unreachable.
       Rough offline approximations: Standard ratios drift between leagues. */
    currencyWeight: {
      chaos: 1,
      divine: 200,
      exalted: 10,
      alch: 0.5,
      regal: 0.5,
      annul: 5,
      vaal: 1,
      chance: 0.1,
      transmute: 0.05,
      aug: 0.05,
      wisdom: 0.01,
      mirror: 100000,
      alt: 0.1,
      scour: 0.5,
      fusing: 0.5,
      jewellers: 0.2,
      chromatic: 0.1,
      gcp: 5,
      blessed: 1,
    },

    /* The colours the trade site gives the modifier kinds. */
    modLegends: [
      { color: '#4fc98a', label: 'default (from the base)' },
      { color: '#86b6ff', label: 'crafted' },
      { color: '#e3bd57', label: 'fractured' },
      { color: '#d98ae0', label: 'veiled / tainted' },
      { color: '#55c8c8', label: 'enchant / soul core' },
      { color: '#9fb0a4', label: 'implicit' },
    ],

    /* PoE 1 crafting leans on alterations and exalts rather than PoE 2's
       regal/vaal ladder, so the rough tier-to-currency guess differs. */
    tierCurrency: [
      { tier: 1, currency: 'transmute' },
      { tier: 2, currency: 'aug' },
      { tier: 3, currency: 'alt' },
      { tier: 4, currency: 'alch' },
      { tier: 5, currency: 'chaos' },
      { tier: 6, currency: 'exalted' },
    ],
  };

  root.PTC_POE1 = profile;
  if (typeof module !== 'undefined' && module.exports) module.exports = profile;
})(typeof globalThis !== 'undefined' ? globalThis : this);
