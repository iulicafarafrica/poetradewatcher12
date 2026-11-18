# Poe Trade Watcher

A Chrome extension (Manifest V3) that sits next to the Path of Exile 1 and
Path of Exile 2 trade sites: it puts Save / Watch / Send to Discord on every
search result, collects the items you keep in a side panel, imports Path of
Building builds, and watches listings for price changes and sales.

Current version: **2.9.51** — see [CHANGELOG.md](CHANGELOG.md) for the full
history and [RELEASE-NOTES.md](RELEASE-NOTES.md) for the grouped summary of the
2.9.x series.

## What it does

**On the trade site**

- Save, Watch and Send to Discord on each result row, with item meta (ilvl,
  quality, seller online state, stash position, fee, price conversions).
- Copy item, blacklist, seller alerts, a warning when the page and the API
  disagree about a listing, and a banner for an expired search.
- A corrupted item is marked **CORRUPTED** in red, both in the panel and in the
  Discord embed.

**In the side panel**

- **Saved items** — everything kept from the trade site, with the seller's
  listing time, price conversions and a detail panel (price check, Craft of
  Exile, watch, copy, seller profile).
- **Import POB** — paste a Path of Building, pobb.in or Mobalytics code, preview
  the gear, import it into a new or existing build. PoE 1 and PoE 2 codes both
  work, decoded on your own device.
- **PoB Builds** — each build with its imported gear, a per-build Discord
  export, ascendancy and notes/goals.
- **Watchers** — watched listings and watched searches, checked by an alarm,
  with Discord webhook and ntfy notifications (desktop notification and an
  optional two-tone sound too).
- **Tools** — price history, settings, themes and the rest.

PoE 1 and PoE 2 are kept apart: separate leagues, separate trade endpoints,
separate item rules. Nothing done in one game changes the other.

## Install

**From source** — open `chrome://extensions`, enable Developer mode, choose
"Load unpacked" and pick this folder. Everything runs from here; there is no
build step.

**From the Chrome Web Store** — the packaged build is the same code with the
files listed in [`.gitignore`](.gitignore) left out (the `.zip` packages and the
local `backup/` folder are not part of the extension).

## Project layout

| File | Role |
| --- | --- |
| `background.js` | Service worker: message router, storage, watchers and alarms, trade API calls, rate limiting, Discord/ntfy posting, backup restore |
| `sidepanel.html/.css/.js` | The whole interface (Saved items, Import POB, PoB Builds, Watchers, Tools) |
| `content.js` / `content.css` | The widgets injected into the trade result rows |
| `ptc-games.js` | Per-game profiles: endpoints, trade status values, leagues |
| `ptc-poe1.js`, `ptc-poe2.js` | Game-specific item and search rules |
| `item-utils.js` | Item parsing, price text, listing dates, Discord formatting |
| `coe.js` | Craft of Exile index and import payload |
| `pob-import.js` | Build code decoding and gear extraction |
| `ptc-settings.js`, `ptc-features.js`, `ptc-modtext.js` | Settings, feature flags, modifier text |
| `themes.css` | The six themes |
| `viewer.html/.js` | Standalone item viewer |
| `privacy.html` | The privacy policy shipped with the extension |
| `tests/` | Node harnesses (see below) |

## Tests

No dependencies, no network. Each harness loads the real source into a small
`chrome` stub and runs against it:

```
node tests/run-tests.js     # item parsing, schema, Craft of Exile, build-code limits
node tests/watcher-sim.js   # worker: watcher cycles, alerts, ordering, rate-limit headers, restore
node tests/search-sim.js    # search query rules for both games
```

## Notes on the trade API

The extension only makes the requests the user asks for: a search when they
click, a fetch for the listings they watch. It reads the API's rate-limit
headers (`X-Rate-Limit-Ip`, `X-Rate-Limit-Ip-State`, `Retry-After`) and slows
down before a `429`, and it keeps a persisted block when the site does ask it to
wait. Watched searches run at most every 15 minutes; watched items at the
interval chosen in the panel, up to 20 per check, oldest first.

## Privacy

The extension has no server of its own. Searches go to the official trade API of
the game you are using; everything else it talks to is listed in
[privacy.html](privacy.html) (item databases, poe.ninja, Craft of Exile,
Mobalytics, Discord and ntfy only when you configure them).

## Licence

Not published under an open-source licence. The code is here for review and for
the Chrome Web Store listing; all rights reserved.
