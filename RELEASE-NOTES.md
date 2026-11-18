# Poe Trade Watcher — release notes

Everything between 2.9.9 and 2.9.50, grouped by area rather than by version.
Current version: **2.9.52**.

---

## Trade page

- **Save / Watch / Send to Discord on every result row.** Save always goes to
  Unsorted (2.9.14); a build is assigned on purpose, not by the current filter.
- **"Send to Discord"** posts the item to the configured webhook. Without a
  webhook, or if Discord refuses, the formatted message is copied instead
  (2.9.44). A corrupted item says **CORRUPTED** in red (ANSI block) and gets a
  red embed bar (2.9.45).
- **Item meta on the row**: ilvl, quality, seller online state, stash tab and
  position, fee, price conversions, "new" badge for listings under 5 minutes.
- **Copy item, blacklist, seller alerts, API/DOM mismatch warning, expired
  search banner** — unchanged, still on the row.
- Removed: the Upgrade/Sidegrade/Downgrade badges and the build-gear feed behind
  them (2.9.36) — a verdict on every row was noise, and the reference could not
  always be matched.
- **No stuck labels**: messages give up after 20 s and the button returns to the
  truth of the collection (2.9.49).

## Side panel

- Five sections: **Saved items · Import POB · PoB Builds · Watchers · Tools**.
- **Saved items** lists only listings saved from the trade site. Each card shows
  the **seller's listing time** ("2h ago" = how old the offer is, with both dates
  in the tooltip), the price once (a conversion that repeats it is dropped), and
  **Open for details** in the top-right corner (2.9.38–2.9.39).
- **Delete all saved items** is a trash button in the toolbar; it keeps builds
  and their imported gear (2.9.36).
- The item panel keeps Price check, Open in Craft of Exile, Watch listing, Copy
  item, Seller profile, Delete. "Compare to build" and the Compare mode were
  removed (2.9.36–2.9.37).

## Builds and imports

- **Import POB** is the importer: paste a Path of Building / pobb.in / Mobalytics
  code, preview the gear, import into a new or existing build.
- **PoB Builds** lists each build with its imported gear. Items open the same
  detail panel as saved ones ("Back to builds").
- **Per-build delete** next to the name; imported gear is deleted with the build,
  assigned saved listings stay unsorted (2.9.47).
- **Send to Discord** per build: title, ascendancy, one field per item with base,
  rarity, ilvl, league and its best rolls; split across messages inside Discord
  limits (2.9.34).
- Imported items never mix with saved listings; no migration was needed.

## Watchers and alerts

- Watched listings only: price change, sold, target price, pause/resume, reorder.
- **Description in the tab**: checked every N minutes, what is compared, where
  alerts go (2.9.48/2.9.50).
- **Alert channels live in the tab** as a fold: Discord webhook, ntfy topic/URL,
  Save and Test. The same values exist in Settings and stay in sync.
- **ntfy on the phone**: install the app, subscribe to the same topic.
- **Status pills**: available (green), price changed (blue), target reached
  (warm), sold (red); names wrap to two lines.
- **Alert content**: title "Watched item price changed", message
  `Name - Base: old price -> new price`; also desktop notification and an
  optional two-tone sound. Verified live against Discord (204) and ntfy (200).
- Seller alerts (whitelisted sellers) now actually respect their switch (2.9.22).

## Craft of Exile

- **"Open in Craft of Exile"** (was "Plan the craft") with a one-time explainer:
  what the site is, what to do there, what is not imported (2.9.43).
- **Import by `details` payload in both games** — measured live: the paste
  importer drops every modifier of a PoE 2 rare and refuses uniques; the details
  payload imports base, quality, item level and every modifier with its tier
  (2.9.35).
- **Corrupted items import corrupted** (2.9.41).
- **Two-number modifiers pick the tier that holds both numbers** ("Adds 32 to 68
  Physical Damage" → the tier whose ranges are 30-40 / 63-73) (2.9.42).
- Known limits: socketed runes are not imported, the base defence roll is rolled
  by the site, hybrid affixes that the API prints on two lines can be split (the
  site keeps one per affix group), uniques import as their base.

## Search quality

- **Every search we create asks for "Instant Buyout and In Person"**: measured on
  the live site, that is `available`; `securable` is buyout only (2.9.35).
- **Saved listings search the league they were saved from**; imported items use
  the league picked in the header, then the typed fallback, then the open trade
  tab (2.9.32). The worker no longer pins Standard.
- **Imports keep every modifier line** (crafted, desecrated, fractured, …), not
  only explicit ones (2.9.12).
- **Build-defining stats are required, the rest match all but one**; a stat that
  appears twice counts once; runes are never searched (2.9.9–2.9.12).

## Header, logo, icon, themes

- **Context bar** under the header: a two-way PoE 2 / PoE 1 switch, a league pill
  with a list, and the saved-item count (2.9.24).
- **Logo lockup**: gold shield with an orange gem, "POE" in Cinzel (OFL, bundled
  locally), "TRADE WATCHER" below; no plate, no border, and the gold turns to
  bronze on the light themes (2.9.28–2.9.31).
- **Extension icon** is the same shield on transparency, 16/32/48/128, and the
  128 px file is the Chrome Web Store icon (2.9.31).
- **Six themes rebuilt on one palette system**, every text token above 4.5:1;
  the dark ones were lifted out of near-black and the light ones given a floor so
  cards are not white on white (2.9.23, 2.9.44). Default: **Graphite** (2.9.46).

## Data, backups, sync

- **Backup / restore** to JSON still covers items, builds, watchers, history and
  settings; secrets are stripped from backups.
- **Chrome Sync** carries folders, bookmarks and settings, with real quotas
  tested (100 KB total, 8 KB per item), stale chunks removed and secrets
  stripped; a status line shows "Last pushed 7m ago · 3 chunks · 11 KB of 100
  KB" (2.9.24).

## Reliability fixes worth knowing

- Stuck "Removing..." / "Stopping..." on the trade page (2.9.49).
- A refused Discord/ntfy permission is reported after saving instead of being
  hidden by "Saved." (2.9.21).
- Saving a webhook or ntfy address that cannot work is reported, not accepted
  (2.9.22).
- Deleting a build no longer leaves its imported items invisible in storage
  (2.9.47).
- Price conversion no longer prints the price twice (2.9.38).
- The watcher "Search" link matches the size of its neighbours (2.9.18).

## Tests

- 199 assertions: profiles, importer, CoE payload, dates, Discord text.
- 50 assertions: the worker — watchers, targets, sounds, build export, Discord
  send, build delete, clear-with-imports.
- 27 assertions: search rules — rune exclusion, the required/optional split,
  leagues, the status value.

## Privacy

No accounts, no analytics, no telemetry. Data stays in `chrome.storage.local`.
Network goes only to the official trade API and its image CDN, poe.ninja,
Craft of Exile (after permission), the build page you ask it to read, and the
Discord webhook / ntfy topic you configure.
