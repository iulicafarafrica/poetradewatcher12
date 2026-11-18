/* ==========================================================================
   Poe Trade Watcher — Path of Exile 2 profile
   --------------------------------------------------------------------------
   Everything that is only true of PoE 2 lives in this file, and everything that
   is only true of PoE 1 lives in ptc-poe1.js. The two files have exactly the
   same shape; see ptc-poe1.js for the rule that keeps the games apart.

   If this file is missing or broken, PTC_GAMES.profile('poe2') returns the empty
   profile and PoE 1 carries on unchanged.
   ========================================================================== */

(function (root) {
  'use strict';

  /*
   * Trade site category ids for PoE 2, keyed by the item class name Path of
   * Building and the trade site use ("Body Armours", "Two Hand Axes", ...). A
   * class the site no longer knows simply drops the category filter and the
   * search continues without it.
   */
  const CATEGORY_BY_CLASS = {
    'body armours': 'armour.chest',
    'body armour': 'armour.chest',
    'boots': 'armour.boots',
    'gloves': 'armour.gloves',
    'helmets': 'armour.helmet',
    'shields': 'armour.shield',
    'belts': 'accessory.belt',
    'rings': 'accessory.ring',
    'amulets': 'accessory.amulet',
    'quivers': 'accessory.quiver',
    'flasks': 'consumable.flask',
    'maps': 'map',
    'map fragments': 'map.fragment',
    'jewels': 'jewel',
    'abyss jewels': 'jewel.abyss',
    'cluster jewels': 'jewel.cluster',
    'currency': 'currency',
    'divination cards': 'card.divination',
    'skill gems': 'gem.active',
    'support skill gems': 'gem.support',
    'fishing rods': 'weapon.fishingrod',
    'daggers': 'weapon.dagger',
    'claws': 'weapon.claw',
    'one hand swords': 'weapon.onesword',
    'two hand swords': 'weapon.twosword',
    'one hand axes': 'weapon.oneaxe',
    'two hand axes': 'weapon.twoaxe',
    'one hand maces': 'weapon.onemace',
    'two hand maces': 'weapon.twomace',
    'bows': 'weapon.bow',
    'staves': 'weapon.staff',
    'warstaves': 'weapon.warstaff',
    'wands': 'weapon.wand',
    'sceptres': 'weapon.sceptre',
    'rune daggers': 'weapon.runedagger',
    'thrusting one hand swords': 'weapon.thrustsword',
    'trinkets': 'trinket',
    'heist brooches': 'heist.brooch',
    'heist cloaks': 'heist.cloak',
    'heist tools': 'heist.tool',
    'heist contracts': 'heist.contract',
    'heist blueprints': 'heist.blueprint',
    'incubators': 'misc.incubator',
    'scarab': 'misc.scarab',
    'metamorph samples': 'misc.metamorph',
    'delve resonators': 'delve.resonator',
    'delve fossils': 'delve.fossil',
    'prophecies': 'prophecy',
    'vials': 'misc.vial',
    'watchstones': 'misc.watchstone',
    'sentinel': 'sentinel',
    'expedition logbooks': 'expedition.logbook',
    'expedition artifacts': 'expedition.artifact',
    'beasts': 'beast',
    'crossbows': 'weapon.crossbow',
    'quarterstaves': 'weapon.warstaff',
    'inscribed ultimatum': 'map.ultimatum',
    'trial coins': 'map.barya',
    'waystones': 'map.waystone',
    'tablet': 'map.tablet',
    'foci': 'armour.focus',
  };

  const profile = {
    id: 'poe2',
    label: 'PoE 2',

    /* PoE 2 keeps its desecrated affixes in their own array, and they are
       searched as explicit stats - that is how the site writes them itself. */
    searchModLists: ['explicitMods', 'craftedMods', 'fracturedMods', 'desecratedMods'],
    desecratedAsExplicit: true,
    skippedStatDomains: ['implicit', 'rune', 'enchant'],

    coeModKeys: ['explicitMods', 'craftedMods', 'fracturedMods', 'desecratedMods', 'enchantMods'],

    /* PoE 2 imports by details as well: measured on the live site (0.5.5.5),
       the paste importer drops every modifier of a rare ("issues encountered",
       no mods on the item), while the details payload imports the base, the
       quality, the item level and the modifiers with their tiers. The paste
       stays as the fallback when the details URL cannot be built. */
    coeDetailsImport: true,

    tradeCategoryByClass: CATEGORY_BY_CLASS,

    defaultCurrency: 'divine',

    /* Fallback values in divine orbs, used only when poe.ninja is unreachable.
       The live table is always preferred: 1 divine was worth about 1.7 chaos in
       Standard and about 9 chaos in Runes of Aldur. */
    currencyWeight: {
      divine: 1,
      chaos: 0.6024,
      exalted: 0.005253,
      alch: 0.01333,
      regal: 0.01205,
      annul: 0.3664,
      vaal: 0.07541,
      chance: 3.09,
      transmute: 0.1,
      aug: 0.1,
      wisdom: 0.0001051,
      mirror: 10292,
    },

    modLegends: [
      { color: '#4fc98a', label: 'default (from the base)' },
      { color: '#86b6ff', label: 'crafted' },
      { color: '#e3bd57', label: 'fractured' },
      { color: '#d98ae0', label: 'desecrated' },
      { color: '#55c8c8', label: 'rune / soul core' },
      { color: '#9fb0a4', label: 'implicit' },
    ],

    tierCurrency: [
      { tier: 1, currency: 'transmute' },
      { tier: 2, currency: 'aug' },
      { tier: 3, currency: 'alch' },
      { tier: 4, currency: 'regal' },
      { tier: 5, currency: 'chaos' },
      { tier: 6, currency: 'vaal' },
    ],
  };

  root.PTC_POE2 = profile;
  if (typeof module !== 'undefined' && module.exports) module.exports = profile;
})(typeof globalThis !== 'undefined' ? globalThis : this);
