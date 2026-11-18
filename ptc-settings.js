/* ==========================================================================
   Poe Trade Watcher — shared settings schema
   --------------------------------------------------------------------------
   One source of truth for every setting, loaded by the background service
   worker, the side panel, the item viewer and the trade-page content script.

   Exposes `globalThis.PTC_SETTINGS`:
     .defaults        – the full default settings object
     .normalize(raw)  – a validated copy of `raw` merged over the defaults
     .TEXT_SIZES      – allowed text size values
     .THEMES          – allowed theme ids
     .PRICE_DISPLAYS  – allowed price display modes
   ========================================================================== */

(function (root) {
  'use strict';

  const TEXT_SIZES = ['small', 'medium', 'large', 'xlarge'];
  const THEMES = ['auto', 'midnight', 'graphite', 'ember', 'forest', 'daylight', 'sand'];
  const PRICE_DISPLAYS = ['divine-exalted', 'divine', 'chaos', 'exalted'];
  const WATCH_INTERVALS = [1, 2, 5, 10, 15, 30, 60];

  const defaults = {
    /* general */
    defaultGame: 'poe2',
    fallbackLeague: { poe2: '', poe1: '' },
    leagueMode: 'auto',
    textSize: 'large',
    theme: 'graphite',

    /* results */
    priceDisplay: 'divine-exalted',
    showConversions: true,
    showIgn: true,
    highlightStats: true,
    fuzzyResults: true,
    showWikiLinks: true,
    coeIncludeDesecrated: true,
    modDomainLabels: true,
    blacklistEnabled: true,
    blacklist: [],
    valueSortPage: false,
    sellerAlerts: '',
    league: '',
    hardcore: false,
    /* Per-game manual league choice. The legacy league/hardcore/leagueMode
       fields above mirror the PoE 2 slot so older readers stay correct. */
    leagueByGame: { poe2: '', poe1: '' },
    hardcoreByGame: { poe2: false, poe1: false },
    leagueModeByGame: { poe2: 'auto', poe1: 'auto' },

    /* watchers */
    watcherInterval: 5,
    watcherNotifications: true,
    watcherSound: true,
    discordWebhook: '',
    ntfyUrl: '',

    /* data */
    syncEnabled: false,
    onboardingDone: false,
    sellerAlertsEnabled: true,
    priceIndexEnabled: true,
    scamDetectionEnabled: true,
    /* Off by default: the box floats over the trade page, and the site's own
       search is the better place to narrow a search. It can be switched on in
       the panel for the times a local filter is handy. */
    searchFilterEnabled: false,
  };

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function cleanText(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max || 500) : '';
  }

  function normalize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const result = Object.assign({}, defaults, source);

    result.defaultGame = source.defaultGame === 'poe1' ? 'poe1' : 'poe2';
    result.textSize = TEXT_SIZES.indexOf(source.textSize) !== -1 ? source.textSize : defaults.textSize;
    result.theme = THEMES.indexOf(source.theme) !== -1 ? source.theme : defaults.theme;
    result.priceDisplay = PRICE_DISPLAYS.indexOf(source.priceDisplay) !== -1 ? source.priceDisplay : defaults.priceDisplay;
    result.fallbackLeague = {
      poe2: cleanText(source.fallbackLeague && source.fallbackLeague.poe2, 80),
      poe1: cleanText(source.fallbackLeague && source.fallbackLeague.poe1, 80),
    };
    result.blacklist = asArray(source.blacklist).map((entry) => cleanText(entry, 80)).filter(Boolean).slice(0, 500);
    result.watcherInterval = Math.min(60, Math.max(1, Math.round(Number(source.watcherInterval) || defaults.watcherInterval)));

    /* Per-game manual league prefs. PoE 2 inherits the legacy single-league
       fields on first run so existing installs keep their choice. */
    const srcLeagueBy = source.leagueByGame && typeof source.leagueByGame === 'object' ? source.leagueByGame : {};
    const srcHcBy = source.hardcoreByGame && typeof source.hardcoreByGame === 'object' ? source.hardcoreByGame : {};
    const srcModeBy = source.leagueModeByGame && typeof source.leagueModeByGame === 'object' ? source.leagueModeByGame : {};
    const legacyLeague = cleanText(source.league, 80);
    const legacyMode = source.leagueMode === 'manual' ? 'manual' : 'auto';
    result.leagueByGame = {
      poe2: cleanText(srcLeagueBy.poe2 != null ? srcLeagueBy.poe2 : legacyLeague, 80),
      poe1: cleanText(srcLeagueBy.poe1, 80),
    };
    result.hardcoreByGame = {
      poe2: srcHcBy.poe2 != null ? !!srcHcBy.poe2 : !!source.hardcore,
      poe1: !!srcHcBy.poe1,
    };
    result.leagueModeByGame = {
      poe2: (srcModeBy.poe2 != null ? srcModeBy.poe2 : legacyMode) === 'manual' ? 'manual' : 'auto',
      poe1: srcModeBy.poe1 === 'manual' ? 'manual' : 'auto',
    };
    result.league = result.leagueByGame.poe2;
    result.hardcore = result.hardcoreByGame.poe2;
    result.leagueMode = result.leagueModeByGame.poe2;

    result.discordWebhook = cleanText(source.discordWebhook, 500);
    result.ntfyUrl = cleanText(source.ntfyUrl, 300);
    result.sellerAlerts = cleanText(source.sellerAlerts, 2000);

    ['showConversions', 'showIgn', 'highlightStats', 'fuzzyResults', 'showWikiLinks',
      'coeIncludeDesecrated', 'modDomainLabels', 'blacklistEnabled', 'valueSortPage',
      'watcherNotifications', 'watcherSound', 'syncEnabled', 'onboardingDone', 'sellerAlertsEnabled',
      'priceIndexEnabled', 'scamDetectionEnabled', 'searchFilterEnabled',
    ].forEach((key) => {
      result[key] = source[key] == null ? !!defaults[key] : !!source[key];
    });

    /* legacy key kept alive so old installs keep their league */
    if (!result.leagueByGame.poe2 && source.fallbackLeague && source.fallbackLeague.poe2) {
      result.leagueByGame.poe2 = cleanText(source.fallbackLeague.poe2, 80);
      result.league = result.leagueByGame.poe2;
    }

    return result;
  }

  /* Manual league prefs for one game, with the legacy PoE 2 fields as a
     fallback for settings saved before the per-game split. */
  function leaguePrefs(settings, game) {
    const g = game === 'poe1' ? 'poe1' : 'poe2';
    const s = settings && typeof settings === 'object' ? settings : {};
    const byGame = s.leagueByGame && typeof s.leagueByGame === 'object' ? s.leagueByGame : {};
    const hcBy = s.hardcoreByGame && typeof s.hardcoreByGame === 'object' ? s.hardcoreByGame : {};
    const modeBy = s.leagueModeByGame && typeof s.leagueModeByGame === 'object' ? s.leagueModeByGame : {};
    const league = cleanText(byGame[g] != null ? byGame[g] : (g === 'poe2' ? s.league : ''), 80);
    const hardcore = hcBy[g] != null ? !!hcBy[g] : (g === 'poe2' ? !!s.hardcore : false);
    const mode = (modeBy[g] != null ? modeBy[g] : (g === 'poe2' ? s.leagueMode : 'auto')) === 'manual' ? 'manual' : 'auto';
    return { league, hardcore, mode };
  }

  const api = { defaults, normalize, leaguePrefs, TEXT_SIZES, THEMES, PRICE_DISPLAYS, WATCH_INTERVALS };
  root.PTC_SETTINGS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
