/*
 * Regression tests for the PoE 1 / PoE 2 split.
 *
 * Run them with:  node tests/run-tests.js
 *
 * The tests need node (18 or newer) and nothing else - the extension's own
 * files are loaded directly. The fixtures in this folder are real build codes:
 *
 *   mobalyticscode.txt  a Path of Building 2 build, exported from Mobalytics
 *   OccVortex.xml       a Path of Building 1 build from Path of Building's own test data
 *   jugg_tectonic.xml   a Path of Building 1 build from the poediscordbot project
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const HERE = __dirname;

global.window = globalThis;
global.pako = require(path.join(ROOT, 'pako.min.js'));

require(path.join(ROOT, 'ptc-games.js'));
require(path.join(ROOT, 'ptc-poe1.js'));
require(path.join(ROOT, 'ptc-poe2.js'));
require(path.join(ROOT, 'ptc-modtext.js'));
require(path.join(ROOT, 'ptc-settings.js'));
require(path.join(ROOT, 'item-utils.js'));
require(path.join(ROOT, 'coe.js'));
require(path.join(ROOT, 'ascendancies.js'));
require(path.join(ROOT, 'pob-import.js'));

const NEW = globalThis.POB_IMPORT;
/* The implementation that shipped with 2.7.2, kept in the backup folder so the
   PoE 2 result can be compared with it. When the backup is not there the
   comparison is simply skipped. */
const OLD_BACKUP = path.join(ROOT, 'backup/PoeTradeSite/pob2-import.js');
let OLD = null;
if (fs.existsSync(OLD_BACKUP)) {
  require(OLD_BACKUP);
  OLD = globalThis.POB2_IMPORT;
}

let passed = 0;
const ok = (cond, message) => { assert.ok(cond, message); passed++; };
const eq = (a, b, message) => { assert.strictEqual(a, b, message + ' (' + a + ' != ' + b + ')'); passed++; };

function toCode(xml) {
  return zlib.deflateSync(Buffer.from(xml, 'utf8'), { level: 9 })
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function testGames() {
  const GAMES = globalThis.PTC_GAMES;
  eq(GAMES.normalizeGame(undefined), 'poe2', 'no game means PoE 2');
  eq(GAMES.normalizeGame('poe1'), 'poe1', 'poe1');
  eq(GAMES.normalizeGame('PoE1'), 'poe1', 'the name is case insensitive');
  eq(GAMES.normalizeGame('nonsense'), 'poe2', 'anything unknown means PoE 2');
  eq(GAMES.config('poe1').apiRoot, 'https://www.pathofexile.com/api/trade', 'the PoE 1 API root');
  eq(GAMES.config('poe2').apiRoot, 'https://www.pathofexile.com/api/trade2', 'the PoE 2 API root');
  eq(GAMES.config('poe1').realm, '', 'the PC realm has no segment');
  eq(GAMES.config('poe2').realm, 'poe2', 'PoE 2 keeps its realm segment');
  eq(GAMES.leaguesApiUrl('poe1'), 'https://www.pathofexile.com/api/trade/data/leagues', 'the PoE 1 league list');
  eq(GAMES.leaguesApiUrl('poe2'), 'https://www.pathofexile.com/api/trade2/data/leagues', 'the PoE 2 league list');
  eq(GAMES.config('poe1').ninjaUrl, 'https://poe.ninja/poe1/api/economy/exchange/current/overview', 'the PoE 1 economy');
  eq(GAMES.config('poe2').ninjaUrl, 'https://poe.ninja/poe2/api/economy/exchange/current/overview', 'the PoE 2 economy');
  eq(GAMES.config('poe1').coeGame, 'poe1', 'the PoE 1 Craft of Exile game');
  /* The trade site's status values, measured by creating one search per value
     on the live site and reading the label it displays. */
  eq(GAMES.TRADE_STATUS.instantAndInPerson, 'available',
    'the value the site labels "Instant Buyout and In Person"');
  eq(GAMES.TRADE_STATUS.instant, 'securable',
    'the value the site labels "Instant Buyout"');
  eq(GAMES.config('poe1').tabPattern, 'https://www.pathofexile.com/trade/*', 'the PoE 1 trade tab');

  /* The permanent modes are never the current challenge league. */
  ok(GAMES.isPermanentLeague('poe1', 'Ruthless'), 'Ruthless is permanent in PoE 1');
  ok(GAMES.isPermanentLeague('poe1', 'Hardcore Ruthless'), 'Hardcore Ruthless is permanent in PoE 1');
  ok(GAMES.isPermanentLeague('poe1', 'Standard'), 'Standard is permanent');
  ok(!GAMES.isPermanentLeague('poe1', 'Covens of Umbra'), 'a challenge league is not permanent');
  ok(!GAMES.isPermanentLeague('poe2', 'Forbidden Rites'), 'Forbidden Rites is not permanent');
  ok(!GAMES.isPermanentLeague('poe2', 'Ruthless'), 'Ruthless is not a PoE 2 mode');

  /* --- the trade URLs of both games --- */
  const poe1 = GAMES.parseTradeUrl('https://www.pathofexile.com/trade/search/Standard/abc123');
  eq(poe1.game, 'poe1', 'the PoE 1 URL is recognised');
  eq(poe1.league, 'Standard', 'the PoE 1 league');
  eq(poe1.queryId, 'abc123', 'the PoE 1 query id');
  eq(GAMES.buildTradeUrl('poe1', 'Standard', 'abc123', false), 'https://www.pathofexile.com/trade/search/Standard/abc123', 'a PoE 1 search URL');
  eq(GAMES.buildTradeUrl('poe2', 'Forbidden Rites', 'xyz', false), 'https://www.pathofexile.com/trade2/search/poe2/Forbidden%20Rites/xyz', 'a PoE 2 search URL');
  eq(GAMES.buildLeagueSearchUrl('poe1', 'Covens of Umbra'), 'https://www.pathofexile.com/trade/search/Covens%20of%20Umbra', 'a PoE 1 league page');
  eq(GAMES.parseTradeUrl('https://www.pathofexile.com/trade2/search/poe2/Forbidden%20Rites/xyz').game, 'poe2', 'the PoE 2 URL is recognised');
  eq(GAMES.parseTradeUrl('https://www.pathofexile.com/trade/search/xbox/Standard/abc').realm, 'xbox', 'the console realm is read');
  eq(GAMES.parseTradeUrl('https://example.com/trade/search/Standard/abc'), null, 'a foreign host is not a trade URL');
}

/* A search query id is the gzip of the query JSON, in base64url - the same
   shape the trade site puts in its URLs. */
function toQueryId(query) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(query), 'utf8'))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function testSavedSearch() {
  const PTC = globalThis.PTC;
  const defaultId = toQueryId({ status: { option: 'securable' }, stats: [{ type: 'and', filters: [] }] });
  const typeId = toQueryId({ status: { option: 'online' }, type: 'Vaal Greaves' });
  const statsId = toQueryId({ status: { option: 'online' }, type: 'Coral Ring',
    stats: [{ type: 'and', filters: [{ id: 'explicit.stat_1', value: { min: 10 }, disabled: false }] }] });
  const nameId = toQueryId({ status: { option: 'online' }, name: 'The Stormwall', type: 'Titan Gauntlets' });
  const statsOnlyId = toQueryId({ status: { option: 'online' },
    stats: [{ type: 'and', filters: [{ id: 'explicit.stat_1', value: { min: 10 }, disabled: false }] }] });
  const categoryOnlyId = toQueryId({ status: { option: 'online' }, category: 'Ring', rarity: 'rare' });
  /* A listing saved while only the price was set: the query holds no item at
     all, only the market filter. */
  const priceOnlyId = toQueryId({ status: { option: 'securable' }, stats: [{ type: 'and', filters: [] }],
    filters: { trade_filters: { filters: { price: { min: 3, option: 'divine' } } } } });
  const pricedTypeId = toQueryId({ status: { option: 'online' }, type: 'Vaal Greaves',
    filters: { trade_filters: { filters: { price: { min: 3, option: 'divine' } } } } });
  const poe1 = (id) => 'https://www.pathofexile.com/trade/search/Standard/' + id;
  const poe2 = (id) => 'https://www.pathofexile.com/trade2/search/poe2/Standard/' + id;

  eq(JSON.stringify(PTC.decodeSearchQuery(typeId)),
    JSON.stringify({ status: { option: 'online' }, type: 'Vaal Greaves' }),
    'the query id decodes back to its query');
  eq(JSON.stringify(PTC.decodeSearchQuery(PTC.encodeSearchQuery({ status: { option: 'online' }, type: 'Vaal Greaves' }))),
    JSON.stringify({ status: { option: 'online' }, type: 'Vaal Greaves' }),
    'a written query id reads back as the same query');

  /* A saved search that really searches for something is a real search; the
     site's default search has no filters at all. */
  eq(PTC.savedSearchHasFilters(PTC.decodeSearchQuery(typeId)), true, 'a search on a base has filters');
  eq(PTC.savedSearchHasFilters(PTC.decodeSearchQuery(statsId)), true, 'a search with stat filters has filters');
  eq(PTC.savedSearchHasFilters(PTC.decodeSearchQuery(statsOnlyId)), true, 'a search with stat filters only has filters');
  eq(PTC.savedSearchHasFilters(PTC.decodeSearchQuery(nameId)), true, 'a search for a unique has filters');
  eq(PTC.savedSearchHasFilters(PTC.decodeSearchQuery(categoryOnlyId)), true, 'a search with a category has filters');
  eq(PTC.savedSearchHasFilters(PTC.decodeSearchQuery(priceOnlyId)), false, 'a price filter alone does not search for an item');
  eq(PTC.savedSearchHasFilters(PTC.decodeSearchQuery(pricedTypeId)), true, 'a base with a price filter still has the item');
  eq(PTC.savedSearchHasFilters(PTC.decodeSearchQuery(defaultId)), false, 'the site default search has no filters');
  eq(PTC.savedSearchHasFilters(null), false, 'no query means no filters');

  /* Only a search that really searches for something is opened as saved. */
  eq(PTC.savedSearchUsable(poe1(typeId)), true, 'a search on a base is usable');
  eq(PTC.savedSearchUsable(poe1(statsId)), true, 'a search with stat filters is usable');
  eq(PTC.savedSearchUsable(poe1(statsOnlyId)), true, 'a search with stat filters only is usable');
  eq(PTC.savedSearchUsable(poe1(nameId)), true, 'a search for a unique is usable');
  eq(PTC.savedSearchUsable(poe1(categoryOnlyId)), true, 'a search with a category is usable');
  eq(PTC.savedSearchUsable(poe2(statsId)), true, 'the PoE 2 URL shape is decoded too');
  eq(PTC.savedSearchUsable(poe1(priceOnlyId)), false, 'a search that only sets a price is not usable');
  eq(PTC.savedSearchUsable(poe1(pricedTypeId)), true, 'a search on a base with a price is usable');
  eq(PTC.savedSearchUsable(poe1(defaultId)), false, 'the site default search is not usable');
  eq(PTC.savedSearchUsable(poe2(defaultId)), false, 'the site default search is not usable in PoE 2 either');
  eq(PTC.savedSearchUsable('https://www.pathofexile.com/trade/search/Standard'), false, 'a plain league page (no id) is not usable');
  eq(PTC.savedSearchUsable(poe1('!!!not-base64!!!')), false, 'a garbage id is not usable');
  eq(PTC.savedSearchUsable(''), false, 'an empty url is not usable');
}

async function testSettings() {
  const SETTINGS = globalThis.PTC_SETTINGS;
  const normalized = SETTINGS.normalize({
    defaultGame: 'poe1',
    fallbackLeague: { poe2: 'Forbidden Rites', poe1: 'Covens of Umbra' },
    leagueByGame: { poe2: 'Runes of Aldur', poe1: 'Covens of Umbra' },
    leagueModeByGame: { poe2: 'auto', poe1: 'manual' },
  });
  eq(normalized.defaultGame, 'poe1', 'the chosen game survives');
  eq(normalized.fallbackLeague.poe1, 'Covens of Umbra', 'the PoE 1 fallback league');
  eq(normalized.fallbackLeague.poe2, 'Forbidden Rites', 'the PoE 2 fallback league');
  eq(SETTINGS.normalize({}).defaultGame, 'poe2', 'PoE 2 is the default');
  eq(SETTINGS.normalize({ defaultGame: 'nonsense' }).defaultGame, 'poe2', 'a broken game falls back to PoE 2');
  eq(SETTINGS.leaguePrefs(normalized, 'poe1').league, 'Covens of Umbra', 'the PoE 1 league prefs');
  eq(SETTINGS.leaguePrefs(normalized, 'poe1').mode, 'manual', 'the PoE 1 league mode');
  eq(SETTINGS.leaguePrefs(normalized, 'poe2').league, 'Runes of Aldur', 'the PoE 2 league prefs');
  eq(SETTINGS.leaguePrefs({}, 'poe1').mode, 'auto', 'PoE 1 starts in automatic mode');

  /* An install that only knew PoE 2 keeps its league after the split. */
  const legacy = SETTINGS.normalize({ league: 'Runes of Aldur', leagueMode: 'manual', hardcore: true });
  eq(SETTINGS.leaguePrefs(legacy, 'poe2').league, 'Runes of Aldur', 'the old league is kept for PoE 2');
  eq(SETTINGS.leaguePrefs(legacy, 'poe2').mode, 'manual', 'the old mode is kept for PoE 2');
  eq(SETTINGS.leaguePrefs(legacy, 'poe2').hardcore, true, 'the old hardcore flag is kept');
  eq(SETTINGS.leaguePrefs(legacy, 'poe1').league, '', 'PoE 1 starts empty');
  eq(SETTINGS.leaguePrefs(legacy, 'poe1').mode, 'auto', 'PoE 1 starts in automatic mode');
}

async function testAscendancies() {
  const ASC = globalThis.PTC_ASCENDANCIES;
  const poe1Classes = ASC.ascendanciesFor('poe1');
  const poe2Classes = ASC.ascendanciesFor('poe2');
  eq(poe1Classes.length, 8, 'PoE 1 has seven classes plus the bloodlines');
  eq(poe2Classes.length, 8, 'PoE 2 has eight classes');
  ok(poe1Classes.some((entry) => entry.class === 'Marauder'), 'Marauder is a PoE 1 class');
  ok(poe1Classes.some((entry) => entry.ascendancies.indexOf('Juggernaut') !== -1), 'Juggernaut is a Marauder ascendancy');
  ok(poe1Classes.some((entry) => entry.class === 'Scion'), 'Scion is a PoE 1 class');
  ok(poe1Classes.some((entry) => entry.class === 'Bloodline'), 'the bloodlines have their own group');
  ok(poe2Classes.every((entry) => entry.class !== 'Scion'), 'Scion does not exist in PoE 2');
  ok(poe2Classes.every((entry) => entry.class !== 'Bloodline'), 'the bloodlines are a PoE 1 thing');
  eq(ASC.ascendanciesFor(undefined).length, 8, 'no game means the PoE 2 list');
  ok(poe1Classes.every((entry) => !entry.icon || /^https:\/\//.test(entry.icon)), 'every icon is an https url');
}

async function testImporter() {
  /* ------------------------------------------------------------------ */
  /* PoE 2 - the real Mobalytics build code                              */
  /* ------------------------------------------------------------------ */
  const code = fs.readFileSync(path.join(ROOT, 'poze promo/mobalyticscode.txt'), 'utf8').trim();
  const newResult = await NEW.parseCode(code);

  ok(newResult.game === 'poe2', 'game detected as poe2, got ' + newResult.game);
  if (OLD) {
    const oldResult = await OLD.parseCode(code);
    /* The new importer only adds the game name and fixes the "Crafted: true"
       flag - everything else has to stay byte for byte the same for PoE 2. */
    const withoutGame = (result) => JSON.parse(JSON.stringify(result, (key, value) => (key === 'game' ? undefined : value)));
    const oldPlain = withoutGame(oldResult);
    const newPlain = withoutGame(newResult);
    oldPlain.items.forEach((item, index) => { item.crafted = undefined; newPlain.items[index].crafted = undefined; });
    assert.deepStrictEqual(newPlain, oldPlain, 'PoE 2 result differs from the old importer');
    passed++;
    ok(oldResult.items.some((item) => item.crafted === false) && newResult.items.some((item) => item.crafted === true),
      'the "Crafted: true" flag is now read from the item text');
    eq(newResult.items.length, oldResult.items.length, 'same number of items');
  }

  eq(newResult.build.className, 'Sorceress', 'class name: ' + newResult.build.className);
  eq(newResult.build.ascendancy, 'Disciple of Varashta', 'ascendancy: ' + newResult.build.ascendancy);
  eq(newResult.build.level, '97', 'level: ' + newResult.build.level);
  ok(newResult.items.length > 5, 'the build has gear: ' + newResult.items.length);
  const robe = newResult.items.find((item) => item.baseType === 'Vile Robe');
  ok(!!robe, 'Vile Robe found');
  eq(robe.rarity, 'Rare', 'rarity: ' + robe.rarity);
  eq(robe.name, 'Phoenix Ward', 'rare name: ' + robe.name);
  eq(robe.sockets.length, 2, 'two sockets, got ' + robe.sockets.length);
  ok(robe.sockets.every((socket) => socket.type === 'rune'), 'the sockets are rune sockets');
  eq(robe.quality, 20, 'quality: ' + robe.quality);
  ok(newResult.items.every((item) => item.game === 'poe2'), 'every item carries its game');
  ok(newResult.items.every((item) => !/^Flask/.test(item.slot || '')), 'no flasks imported');

  /* ------------------------------------------------------------------ */
  /* PoE 1 - Path of Building's own test build                            */
  /* ------------------------------------------------------------------ */
  const occ = fs.readFileSync(path.join(HERE, 'OccVortex.xml'), 'utf8');
  const poe1 = await NEW.parseCode(toCode(occ));
  eq(poe1.game, 'poe1', 'game detected as poe1, got ' + poe1.game);
  eq(poe1.build.className, 'Witch', 'class name: ' + poe1.build.className);
  eq(poe1.build.ascendancy, 'Occultist', 'ascendancy: ' + poe1.build.ascendancy);
  eq(poe1.build.level, '99', 'level: ' + poe1.build.level);
  eq(poe1.build.targetVersion, '3_0', 'target version: ' + poe1.build.targetVersion);

  const loath = poe1.items.find((item) => item.name.indexOf('Loath Sanctuary') === 0);
  ok(!!loath, 'the rare "Loath Sanctuary" was imported');
  eq(loath.baseType, 'Vaal Spirit Shield', 'base type: ' + loath.baseType);
  eq(loath.rarity, 'Rare', 'rarity: ' + loath.rarity);
  eq(loath.ilvl, 83, 'item level: ' + loath.ilvl);
  ok(loath.sockets.length === 3 && loath.sockets.every((s) => s.sColour === 'B'), 'three blue sockets');
  eq(loath.levelReq, 70, 'level requirement: ' + loath.levelReq);
  eq(loath.implicitMods.length, 1, 'one implicit: ' + JSON.stringify(loath.implicitMods));
  eq(loath.implicitMods[0], '9% increased Spell Damage', 'the implicit: ' + loath.implicitMods[0]);
  eq(loath.mods.length, 6, 'six explicit mods, got ' + loath.mods.length);
  ok(loath.corrupted === true, 'the item is corrupted');

  const noose = poe1.items.find((item) => item.baseType === 'Citrine Amulet');
  ok(!!noose, 'Citrine Amulet found');
  eq(noose.name, 'Apocalypse Noose', 'rare name: ' + noose.name);
  eq(noose.mods.filter((mod) => mod.kind === 'crafted').length, 2, 'the two crafted modifiers');
  eq(noose.implicitMods.length, 1, 'the tagged modifier is not an implicit');

  const heretic = poe1.items.find((item) => item.baseType === 'Deicide Mask');
  ok(!!heretic, 'Deicide Mask found');
  eq(heretic.name, "Heretic's Veil", 'the apostrophe survived: ' + heretic.name);
  eq(heretic.sockets.length, 4, 'four sockets, got ' + heretic.sockets.length);
  eq(heretic.sockets.map((s) => s.sColour).join(''), 'RBGB', 'socket colours: ' + heretic.sockets.map((s) => s.sColour).join(''));

  /* Only gear is imported, never flasks, and abyssal sockets stay empty. */
  ok(poe1.items.every((item) => !/^Flask/.test(item.slot || '')), 'no flasks imported');
  ok(poe1.items.every((item) => !/Abyssal Socket/.test(item.slot || '')), 'no abyssal sockets imported');
  ok(poe1.items.every((item) => item.game === 'poe1'), 'every item carries its game');

  /* ------------------------------------------------------------------ */
  /* PoE 1 - a community build with crafted rares                        */
  /* ------------------------------------------------------------------ */
  const jugg = fs.readFileSync(path.join(HERE, 'jugg_tectonic.xml'), 'utf8');
  const poe1b = await NEW.parseCode(toCode(jugg));
  eq(poe1b.game, 'poe1', 'game detected as poe1');
  eq(poe1b.build.className, 'Marauder', 'class name: ' + poe1b.build.className);
  eq(poe1b.build.ascendancy, 'Juggernaut', 'ascendancy: ' + poe1b.build.ascendancy);
  eq(poe1b.build.level, '91', 'level: ' + poe1b.build.level);

  const stormwall = poe1b.items.find((item) => item.baseType === 'Royal Staff');
  ok(!!stormwall, 'The Stormwall was imported');
  eq(stormwall.name, 'The Stormwall', 'unique name: ' + stormwall.name);
  eq(stormwall.sockets.length, 6, 'six sockets, got ' + stormwall.sockets.length);
  eq(stormwall.sockets.map((s) => s.sColour).join(''), 'RRRBBR', 'socket colours: ' + stormwall.sockets.map((s) => s.sColour).join(''));

  const gloves = poe1b.items.find((item) => item.baseType === 'Titan Gauntlets');
  ok(!!gloves, 'the crafted Titan Gauntlets were imported');
  ok(gloves.crafted === true, 'the crafted flag');
  eq(gloves.sockets.map((s) => s.sColour).join(''), 'RGGG', 'socket colours: ' + gloves.sockets.map((s) => s.sColour).join(''));

  const coral = poe1b.items.find((item) => item.baseType === 'Coral Ring');
  ok(!!coral, 'the crafted Coral Ring was imported');
  ok(coral.crafted === true, 'the crafted flag');
  ok(coral.mods.some((mod) => mod.kind === 'crafted'), 'the crafted modifier');
  eq(coral.implicitMods.length, 1, 'one implicit, got ' + coral.implicitMods.length);

  /* ------------------------------------------------------------------ */
  /* The old importer must not understand a PoE 1 build                   */
  /* ------------------------------------------------------------------ */
  if (OLD) {
    let oldFailed = false;
    try {
      await OLD.parseCode(toCode(occ));
    } catch (error) {
      oldFailed = true;
    }
    ok(oldFailed, 'the old importer really cannot read a PoE 1 build');
  }
}

/*
 * The per-game split: every field a shared file is allowed to read exists in
 * both profiles, the values that differ really differ, and a profile that is
 * missing degrades to the empty one instead of reaching into the other game.
 */
async function testGameProfiles() {
  const GAMES = globalThis.PTC_GAMES;
  const one = GAMES.profile('poe1');
  const two = GAMES.profile('poe2');
  const fields = ['id', 'label', 'searchModLists', 'desecratedAsExplicit',
    'skippedStatDomains', 'coeModKeys', 'coeDetailsImport', 'tradeCategoryByClass',
    'defaultCurrency', 'currencyWeight', 'modLegends', 'tierCurrency'];
  const shape = (p) => JSON.stringify(Object.keys(p).sort());

  eq(shape(one), shape(two), 'both profiles carry the same fields');
  eq(JSON.stringify(Object.keys(one).sort()), JSON.stringify(fields.slice().sort()),
    'the profile shape is the documented one');

  eq(one.id, 'poe1', 'the PoE 1 profile names its game');
  eq(two.id, 'poe2', 'the PoE 2 profile names its game');
  eq(GAMES.profile().id, 'poe2', 'no game means PoE 2');

  eq(one.desecratedAsExplicit, false, 'PoE 1 does not file desecrated stats as explicit');
  eq(two.desecratedAsExplicit, true, 'PoE 2 does file desecrated stats as explicit');
  ok(one.searchModLists.indexOf('desecratedMods') === -1, 'PoE 1 searches no desecrated array');
  ok(two.searchModLists.indexOf('desecratedMods') !== -1, 'PoE 2 searches the desecrated array');

  ok(one.tradeCategoryByClass === null, 'PoE 1 asks the site for no category');
  eq(two.tradeCategoryByClass['body armours'], 'armour.chest', 'PoE 2 maps an item class to a category');
  eq(two.tradeCategoryByClass.foci, 'armour.focus', 'PoE 2 maps foci');

  eq(one.defaultCurrency, 'chaos', 'PoE 1 prices in chaos');
  eq(two.defaultCurrency, 'divine', 'PoE 2 prices in divine');
  ok(one.coeModKeys.indexOf('desecratedMods') === -1, 'the PoE 1 Craft of Exile import ignores desecrated');
  ok(two.coeModKeys.indexOf('desecratedMods') !== -1, 'the PoE 2 Craft of Exile import reads desecrated');

  /* The Craft of Exile path differs by game: PoE 1 opens the item by its own
     base id, PoE 2 goes through the site's paste importer. */
  eq(one.coeDetailsImport, true, 'PoE 1 imports into Craft of Exile by details');
  eq(two.coeDetailsImport, true, 'PoE 2 imports into Craft of Exile by details too');

  /* The offline currency tables are per game and are expressed in the currency
     that game prices in. */
  eq(one.currencyWeight.chaos, 1, 'PoE 1 weights are expressed in chaos');
  eq(two.currencyWeight.divine, 1, 'PoE 2 weights are expressed in divine');
  ok(one.currencyWeight.divine > two.currencyWeight.divine, 'one divine is worth more than 1 in PoE 1 terms');
  eq(one.currencyWeight.alt, 0.1, 'PoE 1 knows alteration orbs');
  ok(two.currencyWeight.alt === undefined, 'PoE 2 has no alteration weight of its own');

  /* The legend names the modifier kinds each game actually has. */
  ok(one.modLegends.some((entry) => /veiled/.test(entry.label)), 'the PoE 1 legend names veiled mods');
  ok(two.modLegends.some((entry) => /desecrated/.test(entry.label)), 'the PoE 2 legend names desecrated mods');
  eq(one.modLegends.length, 6, 'six legend entries in PoE 1');

  /* The craft estimate ladder differs at the top end. */
  eq(one.tierCurrency[5].currency, 'exalted', 'PoE 1 tops the ladder with exalts');
  eq(two.tierCurrency[5].currency, 'vaal', 'PoE 2 tops the ladder with vaal orbs');

  /* Isolation: with the PoE 1 profile gone, PoE 1 falls back to the empty
     profile and PoE 2 keeps working, unchanged. */
  const saved = globalThis.PTC_POE1;
  delete globalThis.PTC_POE1;
  eq(GAMES.profile('poe1').searchModLists.length, 0, 'a missing PoE 1 profile degrades to the empty one');
  eq(GAMES.profile('poe1').id, '', 'the empty profile has no id');
  eq(GAMES.profile('poe2').id, 'poe2', 'a missing PoE 1 profile leaves PoE 2 alone');
  eq(GAMES.profile('poe2').defaultCurrency, 'divine', 'PoE 2 values survive');
  eq(GAMES.profile('poe1').currencyWeight, null, 'the empty profile has no currency table of its own');
  ok(GAMES.profile('poe1').modLegends.length === 0, 'the empty profile has no legend');
  eq(GAMES.profile('poe2').currencyWeight.divine, 1, 'PoE 2 keeps its weight table');
  globalThis.PTC_POE1 = saved;
  eq(GAMES.profile('poe1').searchModLists.length, 3, 'the profile is back');
}

/*
 * The text Path of Building exports for an item: the influence line sits between
 * the name and the metadata, and must never become the base type; a range in a
 * modifier line must look like a single number to the stat lookup.
 */
async function testImportText() {
  const POB = globalThis.POB_IMPORT;
  const xml = [
    '<PathOfBuilding><Build level="90"/><Items activeItemSet="1"><ItemSet id="1">',
    '<Slot name="Belt" itemId="1"/><Slot name="Ring 1" itemId="2"/>',
    '</ItemSet></Items>',
    '<Item id="1">',
    'Rarity: RARE',
    'Cord Belt',
    'Elder Item',
    'Item Level: 84',
    'Implicits: 0',
    '+131 to maximum Life',
    '</Item>',
    '<Item id="2">',
    'Rarity: UNIQUE',
    'The Taming',
    'Prismatic Ring',
    'Item Level: 82',
    'Implicits: 1',
    '+(20-30)% to all Elemental Resistances',
    '10% chance to Freeze, Shock and Ignite',
    '</Item>',
    '</PathOfBuilding>',
  ].join('\n');
  const parsed = POB.parseBuildXml(xml);
  const list = parsed && (parsed.items || parsed);
  const items = Array.isArray(list) ? list : Object.values(list || {});
  const belt = items.find((entry) => (entry.item || entry).slot === 'Belt');
  const ring = items.find((entry) => (entry.item || entry).slot === 'Ring 1');
  const beltItem = belt && (belt.item || belt);
  const ringItem = ring && (ring.item || ring);

  ok(!!beltItem, 'the influenced rare is imported');
  eq(beltItem.baseType, 'Cord Belt', 'the influence line is not the base type');
  eq(beltItem.ilvl, 84, 'the item level is read');
  ok(!!ringItem, 'the unique is imported');
  eq(ringItem.name, 'The Taming', 'the unique keeps its own name');
  eq(ringItem.baseType, 'Prismatic Ring', 'the unique keeps its base type');

  const MT = globalThis.PTC_MODTEXT;
  eq(MT.canonical('+(21-25) to Strength and Dexterity'), MT.canonical('+# to Strength and Dexterity'),
    'a range reads like a single number');
  eq(MT.canonical('(25-25)% of Physical Damage Converted to Lightning Damage'),
    MT.canonical('#% of Physical Damage Converted to Lightning Damage'),
    'a fixed range reads like a single number');
}

/*
 * The card shows when the seller listed the item, so the listing timestamp has
 * to be read from both shapes the trade side sends, and a record without one
 * must not invent a date.
 */
function testListingDate() {
  const PTC = globalThis.PTC;
  const day = Date.UTC(2026, 10, 15, 10, 20, 0);
  eq(PTC.parseListingDate('2026-11-15T10:20:00Z'), day, 'an ISO listing date is read');
  eq(PTC.parseListingDate('11/15/2026 10:20'), day, 'the page date format (month first) is read');
  eq(PTC.parseListingDate('15/11/2026 10:20'), day, 'and the day-first form of it');
  eq(PTC.parseListingDate(''), null, 'an empty date is not a date');
  eq(PTC.parseListingDate('not a date'), null, 'garbage is not a date');
  eq(PTC.listedAt({ listing: { indexed: '2026-11-15T10:20:00Z' } }), day,
    'the listing time comes from the listing');
  eq(PTC.listedAt({ savedAt: Date.now() }), null,
    'a record without a listing date has none');

  /* A corrupted item has to say so, in red, in the Discord message. */
  const clean = { item: { typeLine: 'Sekhema Sandals', frameType: 2, ilvl: 81, explicitMods: ['+10 to maximum Life'] } };
  ok(!PTC.discordText(clean).includes('CORRUPTED'), 'a normal item is not marked corrupted');
  const corrupted = { item: { ...clean.item, corrupted: true } };
  const text = PTC.discordText(corrupted);
  ok(text.includes('```ansi'), 'a corrupted item adds an ANSI block');
  ok(text.includes('\u001b[0;31mCORRUPTED\u001b[0m'), 'and the word is red');
}

/*
 * A build code is untrusted input: it may come from a pobb.in link. The
 * decompression must stop at the ceiling instead of allocating whatever the
 * stream claims, and a huge pasted string must be refused before decoding.
 */
async function testPobLimits() {
  const IMPORT = globalThis.POB_IMPORT;
  const toCode = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const xml = '<?xml version="1.0"?><PathOfBuilding><Build level="1"/></PathOfBuilding>';
  const normal = await IMPORT.decodeCode(toCode(zlib.gzipSync(Buffer.from(xml, 'utf8'))));
  ok(normal.indexOf('PathOfBuilding') !== -1, 'a normal build code still decodes');

  const bomb = toCode(zlib.gzipSync(Buffer.alloc(40 * 1024 * 1024, 0), { level: 9 }));
  let bombError = null;
  try { await IMPORT.decodeCode(bomb); } catch (error) { bombError = error; }
  ok(bombError && /too large/i.test(bombError.message),
    'a decompression bomb is stopped at the 32 MB ceiling');

  let longError = null;
  try { await IMPORT.decodeCode('A'.repeat(400001)); } catch (error) { longError = error; }
  ok(longError && /too long/i.test(longError.message),
    'an oversized code is rejected before decoding');
}

function testCoeImport() {
  const COE = globalThis.COE;
  const labels = [
    'Body Armours (INT)',
    'Test Robe',
    '#% increased Energy Shield',
    'Padded',
    'Medved\'s',
    '# to Spirit',
    'Adds # to # Physical Damage',
    'Honed',
    'Tempered',
  ];
  const data = {
    classes: { entries: [{ id: 3, group: 0, class: 3, label: 0 }] },
    items: { entries: [{ id: 100, key: 'Metadata/Items/Armours/BodyArmours/TestRobe', label: 1, class: 3 }] },
    modgroups: { entries: [{ id: 10, type: 1 }, { id: 11, type: 1 }] },
    mods: {
      entries: [
        { id: 20, key: 'IncreasedEnergyShield7', label: 3, group: 10, stats: [{ label: 2, index: 0, range: [1, 30] }] },
        {
          id: 21, key: 'HybridEnergyShieldSpirit', label: 4, group: 11,
          stats: [{ label: 2, index: 0, range: [6, 52] }, { label: 5, index: 1, range: [1, 24] }],
        },
        {
          id: 22, key: 'AddedPhysLow', label: 7, group: 10,
          stats: [{ label: 6, index: 0, range: [13, 17] }, { label: 6, index: 1, range: [28, 32] }],
        },
        {
          id: 23, key: 'AddedPhysHigh', label: 8, group: 10,
          stats: [{ label: 6, index: 0, range: [30, 40] }, { label: 6, index: 1, range: [63, 73] }],
        },
      ],
    },
    classmods: { 3: { 20: 1, 21: 1, 22: 1, 23: 1 } },
    stats: {},
  };
  const index = COE.buildIndex(data, labels);
  index.game = 'poe2';
  const rec = {
    id: 'coe-1',
    game: 'poe2',
    item: {
      typeLine: 'Test Robe', baseType: 'Test Robe', frameType: 2, ilvl: 82,
      corrupted: true,
      sockets: ['S'],
      explicitMods: ['18% increased Energy Shield'],
    },
  };
  const built = COE.detailsFromRecord(rec, index, {
    cleanGameText: (value) => String(value == null ? '' : value).trim(),
    asArray: (value) => (Array.isArray(value) ? value : []),
  });
  ok(!!built, 'a PoE 2 rare builds a Craft of Exile payload');
  const payload = JSON.parse(Buffer.from(new URL(built.url).searchParams.get('details'), 'base64').toString('utf8'));
  eq(payload.m.map((entry) => entry.k).join('|'), 'IncreasedEnergyShield7',
    'the pure modifier wins over the hybrid that shares its wording');
  eq(payload.f.join('|'), 'c', 'a corrupted item imports corrupted');
  eq(payload.ns, 1, 'and keeps its socket count');
  ok(built.url.indexOf('game=poe2') !== -1, 'the URL opens the PoE 2 planner');
  ok(built.url.indexOf('details=') !== -1, 'and carries the details payload');

  /* A line with two numbers ("Adds 32 to 68 Physical Damage") must land on the
     tier whose ranges hold both, not the first one that holds 32. */
  const added = COE.detailsFromRecord({
    id: 'coe-2',
    game: 'poe2',
    item: {
      typeLine: 'Test Robe', baseType: 'Test Robe', frameType: 2, ilvl: 82,
      explicitMods: ['Adds 32 to 68 Physical Damage'],
    },
  }, index, {
    cleanGameText: (value) => String(value == null ? '' : value).trim(),
    asArray: (value) => (Array.isArray(value) ? value : []),
  });
  const addedPayload = JSON.parse(Buffer.from(new URL(added.url).searchParams.get('details'), 'base64').toString('utf8'));
  eq(addedPayload.m.map((entry) => entry.k).join('|'), 'AddedPhysHigh',
    'a two-number line picks the tier whose ranges hold both numbers');
  eq(addedPayload.m[0].v.join(','), '32,68', 'and keeps both numbers');
}

async function main() {
  await testGames();
  await testGameProfiles();
  await testImportText();
  await testCoeImport();
  await testPobLimits();
  await testListingDate();
  await testSavedSearch();
  await testSettings();
  await testAscendancies();
  await testImporter();
  console.log('PASS ' + passed + ' assertions');
}

main().catch((error) => {
  console.error('FAIL:', error && error.message);
  if (error && error.stack) console.error(error.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
