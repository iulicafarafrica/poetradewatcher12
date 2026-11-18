/* ==========================================================================
   Poe Trade Watcher — per-game configuration (PoE 1 + PoE 2)
   --------------------------------------------------------------------------
   One source of truth for everything that differs between the two games:
   trade API roots, site URL shapes, league realms, permanent leagues, the
   poe.ninja economy endpoint, Craft of Exile game key, stat groups and wiki /
   database links. Loaded by the background service worker, the trade-page
   content script, the side panel and the item viewer.

   Game-specific *data and rules* are not in this file: they live in
   ptc-poe1.js and ptc-poe2.js, one profile per game, and this registry hands
   each caller the profile of the game it is working on (`profile(game)`). A
   shared file reads `profile.field`; it never spells out a PoE 1 or a PoE 2
   value itself, so a mistake in one game's profile cannot change the other.

   Exposes `globalThis.PTC_GAMES`. PoE 2 is the default everywhere so existing
   behaviour is preserved exactly when no game is specified.
   ========================================================================== */

(function (root) {
  'use strict';

  const GAMES = {
    poe2: {
      id: 'poe2',
      label: 'PoE 2',
      short: 'PoE2',
      apiRoot: 'https://www.pathofexile.com/api/trade2',
      tradePath: 'trade2',
      /* Path segment between /search/ and the league on the website + API. */
      realm: 'poe2',
      /* Realm filter for the published league list. */
      leagueRealm: 'poe2',
      /* Permanent modes that are never the "current challenge league". */
      permanentLeagues: ['standard', 'hardcore'],
      ninjaUrl: 'https://poe.ninja/poe2/api/economy/exchange/current/overview',
      coeGame: 'poe2',
      statsGroups: ['explicit', 'fractured', 'desecrated'],
      wikiBase: 'https://poe2wiki.net/wiki/',
      dbBase: 'https://poe2db.tw/us/',
      tabPattern: 'https://www.pathofexile.com/trade2/*',
    },
    poe1: {
      id: 'poe1',
      label: 'PoE 1',
      short: 'PoE1',
      apiRoot: 'https://www.pathofexile.com/api/trade',
      tradePath: 'trade',
      /* PC trade has no realm segment: /trade/search/<league>/<id>. */
      realm: '',
      leagueRealm: 'pc',
      permanentLeagues: ['standard', 'hardcore', 'ruthless', 'hardcore ruthless'],
      ninjaUrl: 'https://poe.ninja/poe1/api/economy/exchange/current/overview',
      coeGame: 'poe1',
      statsGroups: ['explicit', 'implicit', 'fractured', 'crafted', 'veiled', 'enchant', 'scourge', 'delve'],
      wikiBase: 'https://www.poewiki.net/wiki/',
      dbBase: 'https://poedb.tw/us/',
      tabPattern: 'https://www.pathofexile.com/trade/*',
    },
  };

  const ORDER = ['poe2', 'poe1'];

  /*
   * The per-game profile: the data and the rules that are only true of that
   * game, kept in ptc-poe1.js and ptc-poe2.js. This registry is the only place
   * that picks between them, and it never throws: a profile that failed to load
   * (or is broken) is replaced by the empty one, so a problem in PoE 1 leaves
   * PoE 2 untouched and the other way around.
   */
  const EMPTY_PROFILE = Object.freeze({
    id: '',
    label: '',
    searchModLists: [],
    desecratedAsExplicit: false,
    skippedStatDomains: ['implicit', 'rune', 'enchant'],
    coeModKeys: [],
    coeDetailsImport: false,
    tradeCategoryByClass: null,
    defaultCurrency: '',
    currencyWeight: null,
    modLegends: [],
    tierCurrency: [],
  });

  function profile(game) {
    const id = normalizeGame(game);
    const found = id === 'poe1' ? root.PTC_POE1 : root.PTC_POE2;
    return found && typeof found === 'object' ? found : EMPTY_PROFILE;
  }

  function normalizeGame(value) {
    let raw = value;
    if (raw && typeof raw === 'object') raw = raw.game;
    raw = String(raw == null ? '' : raw).toLowerCase().trim();
    if (raw === 'poe1' || raw === 'poe' || raw === '1' || raw === 'trade') return 'poe1';
    return 'poe2';
  }

  function config(game) {
    return GAMES[normalizeGame(game)];
  }

  function list() {
    return ORDER.map((id) => GAMES[id]);
  }

  function isPermanentLeague(game, id) {
    const value = String(id == null ? '' : id).toLowerCase().trim();
    return config(game).permanentLeagues.indexOf(value) !== -1;
  }

  /* Accepts both games' search and exchange URLs, with or without a realm
     segment, and with the query id in the path or the "q" parameter. */
  function parseTradeUrl(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'www.pathofexile.com') return null;
      const parts = parsed.pathname.split('/').filter(Boolean);
      let game = null;
      let leagueIndex = -1;
      let realm = '';
      if (parts[0] === 'trade2' && (parts[1] === 'search' || parts[1] === 'exchange')) {
        game = 'poe2';
        realm = 'poe2';
        leagueIndex = 3; /* trade2 / search / poe2 / <league> / <id> */
      } else if (parts[0] === 'trade' && (parts[1] === 'search' || parts[1] === 'exchange')) {
        game = 'poe1';
        realm = 'pc';
        leagueIndex = 2; /* trade / search / <league> / <id> */
        if (parts[2] === 'xbox' || parts[2] === 'sony' || parts[2] === 'pc') {
          realm = parts[2];
          leagueIndex = 3;
        }
      }
      if (!game) return null;
      let queryId = parsed.searchParams.get('q') || '';
      if (!queryId) {
        const tail = parts.slice(leagueIndex + 1).filter((part) => part !== 'live');
        queryId = tail.length ? decodeURIComponent(tail[0]) : '';
      }
      return {
        game,
        realm,
        league: decodeURIComponent(parts[leagueIndex] || ''),
        queryId,
        live: parts.indexOf('live') !== -1 || parsed.searchParams.has('live'),
        url: parsed.href,
      };
    } catch (error) {
      return null;
    }
  }

  function gameFromUrl(url) {
    const info = parseTradeUrl(url);
    return info ? info.game : 'poe2';
  }

  function siteSearchBase(game) {
    const cfg = config(game);
    return 'https://www.pathofexile.com/' + cfg.tradePath + '/search/'
      + (cfg.realm ? cfg.realm + '/' : '');
  }

  /* Builds a search URL. The open trade tab's URL is used as a template when
     available so the shape always matches what the site itself uses. */
  function buildTradeUrl(game, league, queryId, live, templateUrl) {
    const cleanLeague = String(league == null ? '' : league).trim();
    const cleanId = String(queryId == null ? '' : queryId).trim();
    if (!cleanLeague || !cleanId) return '';
    const encodedId = encodeURIComponent(cleanId);
    if (templateUrl) {
      const template = String(templateUrl);
      const info = parseTradeUrl(template);
      /* The template also carries its own league and realm, and only the query id
         is swapped below, so it may only be used for the same game and league. */
      if (info && info.queryId
        && info.game === normalizeGame(game)
        && String(info.league || '').toLowerCase() === cleanLeague.toLowerCase()) {
        const oldEncoded = encodeURIComponent(info.queryId);
        let out = '';
        if (template.indexOf(oldEncoded) !== -1) out = template.split(oldEncoded).join(encodedId);
        else if (template.indexOf(info.queryId) !== -1) out = template.split(info.queryId).join(cleanId);
        if (out) {
          if (live && !/\/live(\/|$|\?|&)/.test(out)) {
            if (/[?&]q=/.test(out)) out += (out.indexOf('?') !== -1 ? '&' : '?') + 'live=1';
            else out = out.replace(/([?&#].*)?$/, '/live$1');
          }
          return out;
        }
      }
    }
    return siteSearchBase(game) + encodeURIComponent(cleanLeague) + '/' + encodedId
      + (live ? '/live' : '');
  }

  function buildLeagueSearchUrl(game, league) {
    const cleanLeague = String(league == null ? '' : league).trim();
    if (!cleanLeague) return '';
    return siteSearchBase(game) + encodeURIComponent(cleanLeague);
  }

  function searchApiUrl(game, league) {
    const cfg = config(game);
    return cfg.apiRoot + '/search/' + (cfg.realm ? cfg.realm + '/' : '')
      + encodeURIComponent(String(league == null ? '' : league).trim());
  }

  function fetchApiUrl(game, ids, queryId) {
    const cfg = config(game);
    const list = Array.isArray(ids)
      ? ids.map((id) => encodeURIComponent(String(id))).join(',')
      : encodeURIComponent(String(ids == null ? '' : ids));
    let url = cfg.apiRoot + '/fetch/' + list;
    if (queryId) url += '?query=' + encodeURIComponent(String(queryId));
    return url;
  }

  function leaguesApiUrl(game) {
    return config(game).apiRoot + '/data/leagues';
  }

  function dataApiUrl(game, kind) {
    return config(game).apiRoot + '/data/' + kind;
  }

  /*
   * The trade site's status filter values, measured on the live site by creating
   * one search per value and reading the label it displays:
   *
   *   available      -> "Instant Buyout and In Person"
   *   securable      -> "Instant Buyout"
   *   online         -> "In Person (Online)"
   *   onlineleague   -> "In Person (Online in League)"
   *   any            -> "Any"
   *
   * The names are the site's own and do not match their labels: `available` is
   * the option that includes in-person trades, `securable` is buyout only.
   */
  const TRADE_STATUS = {
    instantAndInPerson: 'available',
    instant: 'securable',
    online: 'online',
    onlineLeague: 'onlineleague',
    any: 'any',
  };

  const api = {
    GAMES,
    ORDER,
    EMPTY_PROFILE,
    TRADE_STATUS,
    profile,
    normalizeGame,
    config,
    list,
    isPermanentLeague,
    parseTradeUrl,
    gameFromUrl,
    buildTradeUrl,
    buildLeagueSearchUrl,
    siteSearchBase,
    searchApiUrl,
    fetchApiUrl,
    leaguesApiUrl,
    dataApiUrl,
  };

  root.PTC_GAMES = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);