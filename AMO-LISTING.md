# AMO submission — Poe Trade Watcher 2.9.54

Everything needed for https://addons.mozilla.org/developers/ → **Submit a New Add-on**
→ **On this site**.

Fill the fields below in order. Items marked **TODO** need a value only the
owner has.

---

## Upload

- **File:** `poe_trade_watcher-2.9.54.zip` (from `PoeTradeFirefox/dist/`)
- **Platforms:** Desktop only. The interface is built for a side panel or a
  sidebar; Firefox for Android has neither.
- **Source code:** not needed. Every shipped file is plain, unminified
  JavaScript written for this add-on, except the vendored `pako.min.js`
  (see Notes for Reviewers).

## Listing fields

- **Name:** Poe Trade Watcher (listing name; the manifest name is now "Poe Trade Watcher - PoE 1 & 2 Trade Helper", which is what about:addons shows)
- **Add-on URL:** `poe-trade-watcher` → `https://addons.mozilla.org/firefox/addon/poe-trade-watcher/`
  (AMO warns if the slug is taken; `poe-trade-watcher-poe1-poe2` is the fallback)
- **Experimental:** no
- **Requires payment or non-free services:** no
- **Categories:** Games & Entertainment, Productivity
- **Support email:** **TODO — a real address; the form does not accept a link**
- **Support website:** https://github.com/iulicafarafrica/poetradewatcher12
- **License:** MIT (the repository carries the full text in `LICENSE`)
- **Privacy policy:** paste the text below into the field. AMO hosts it on the
  listing page; it does **not** take a URL. (A public HTML copy still exists at
  `docs/privacy.html` and can be used as the support site's policy page, but it
  is not required for submission.)

## Privacy policy (paste this text)

AMO hosts the policy itself, so this is plain text for the textarea. The HTML
version in `docs/privacy.html` says the same thing in more detail.

```text
Poe Trade Watcher - Privacy Policy
Last updated: 18 November 2026

Poe Trade Watcher is an unofficial fan-made browser extension for Chrome, Edge
and Firefox. It has no accounts, no analytics, no ads and does not sell or share
data with anyone.

What is stored on your device
Saved trade items, gear imported from a build, builds, watched listings, search
history, price history and settings are stored in your browser profile (the
extension's local storage: chrome.storage.local in Chrome and Edge,
browser.storage.local in Firefox). Price history keeps the last 50 checks of
each item. Nothing leaves your device unless you export a backup or turn on sync for your settings. Removing the extension deletes all of it.

What is transmitted, and where
- www.pathofexile.com: the public trade listings of the page you are viewing;
  the same public trade API is used to fetch one listing when you save it, watch
  it, copy its whisper or refresh its price, and a watched search is re-run on
  its own schedule. Your existing Path of Exile session is reused for those
  calls; nothing is sent anywhere else.
- web.poecdn.com: item icons, loaded by the browser itself.
- cdn.poe2db.tw and cdn.poedb.tw: ascendancy class icons.
- poe.ninja: public currency exchange rates.
- beta.craftofexile.com: only when you open a Craft of Exile link; downloads the
  public data files that site itself loads. Optional host permission, requested
  at that click.
- mobalytics.gg: only when you click "Read page"; reads a build tab you already
  have open. Optional host permission, requested at that click.
- Discord webhook or ntfy topic: only if you configure them. Alerts you enable
  contain the item name, price and seller character name. Optional host
  permissions, requested when you first use each.

What is never collected
No email, no passwords, no browsing history outside the trade searches you make
yourself, no location, no tracking and no telemetry. Build codes you paste are
decoded on your device and never uploaded. The Discord webhook URL, the ntfy
topic and whisper tokens stay in local storage, are left out of exported backups
and are never synced.

Your control
Clear the webhook or the ntfy topic to stop alerts; delete items and builds with
the delete button; export a backup at any time; remove the extension to erase
everything.

Contact
Questions or data requests: https://github.com/iulicafarafrica/poetradewatcher12/issues
```

## Summary

> Save Path of Exile 1 and 2 trade listings with every modifier, compare prices,
> track them, and get Discord or ntfy alerts when a price moves. Works in the
> side panel or sidebar.

## Description (Firefox listing)

```markdown
Save, watch and organize Path of Exile 1 and 2 trade listings, import your build from Path of Building, and get alerted when a price drops, an item sells or a target price is reached.

Poe Trade Watcher adds one-click actions and alerts directly on the official trade site and keeps your shortlist in the Firefox sidebar. No accounts, no analytics, no ads.

Up to date: ready for Covens, the current Path of Exile 1 league, and for the Path of Exile 2 leagues the trade site lists today. A compatibility update for the Path of Exile 2 major patch on 11 December 2026 is planned.

★ NEW IN 2.9.54

• First Firefox release, built from the same code as the Chrome and Edge versions
• The interface lives in the Firefox sidebar; the toolbar button opens and closes it
• "Open in a tab" button in the panel header, for when the sidebar is too narrow
• The alert tone is played by the sidebar or an open trade tab (Firefox has no background audio document, so there is no sound with both closed)
• Discord alerts declare no mentions, so a seller name can never ping a channel
• A restored backup keeps a search address only if it is a real trade link

★ ON THE TRADE PAGE

• Per-row actions: Save, Watch, Send to Discord. Save always goes to Unsorted, a build is assigned on purpose
• Item meta row: ilvl, quality, seller online status, stash tab and position, fee, price conversions
• "New" badge for listings under 5 minutes old
• Copy item, seller blacklist, and optional seller alerts for IGNs you follow
• Warning when the page shows stale data that disagrees with the trade API
• Expired search banner with one-click "open a fresh search"

★ SIDEBAR

Five sections: Saved items, Import POB, PoB Builds, Watchers, Tools.

• Saved items: only listings you saved from the trade site. Each card shows how old the seller's listing is ("2h ago", both dates in the tooltip), the price, and Open for details
• Item panel: price check, Open in Craft of Exile, watch listing, copy item, seller profile, delete
• Delete all saved items with one button; builds and their imported gear are kept

★ BUILDS AND IMPORT

• Import POB: paste a Path of Building, pobb.in or Mobalytics code, preview the gear, import into a new or existing build
• PoB Builds: every build with its imported gear, opening the same item panel as saved items
• Delete a build from next to its name. Imported gear goes with it, saved listings you assigned to it stay in Unsorted
• Send a whole build to Discord: title, ascendancy and one field per item with base, rarity, ilvl, league and best rolls. Long builds are split across messages
• Imported gear never mixes with your saved listings

★ WATCHERS AND ALERTS

• Watch a listing and get alerted on price change, sold, or target price. Pause, resume and reorder
• Status pills: available, price changed, target reached, sold
• Alert channels: desktop notification, Discord webhook, ntfy push to your phone, optional two-tone sound
• Discord and ntfy settings sit in the Watchers tab and stay in sync with Settings. Save and Test right there
• Alert text: "Watched item price changed" with Name - Base: old price -> new price
• Seller alerts for sellers you follow, and they respect their on/off switch

★ CRAFT OF EXILE

• "Open in Craft of Exile": a pre-filled import, with a one-time explainer of what the site is and what is not imported
• Works in PoE 1 and PoE 2
• Two-number modifiers pick the tier that holds both numbers ("Adds 32 to 68 Physical Damage" picks the 30-40 / 63-73 tier)
• Limits: socketed runes are not imported, uniques import as their base, and hybrid affixes printed on two lines can be split

★ SEARCH QUALITY

• Every search the extension creates asks for "Instant Buyout and In Person"
• Searches open in your league, never silently in Standard
• Imports keep every modifier line: crafted, desecrated, fractured and more
• Build-defining stats are required, the rest match all but one. Runes are never searched

★ BACKUP AND SYNC

• Backup and restore to a JSON file: items, builds, watchers, history and settings. Secrets (webhook, ntfy topic) are stripped from backups
• Optional sync of settings, folders and bookmarks through your browser account (Chrome Sync in Chrome and Edge, Firefox Sync in Firefox), with a status line showing when it last pushed and how much of the quota is used. Secrets are never synced

★ PRIVACY AND YOUR DATA

• No servers, no accounts, no analytics, no telemetry, no trackers
• Everything is stored locally in your browser profile; removing the extension deletes it
• Network goes only to the official trade API and its image CDN, poe.ninja, Craft of Exile (after the browser asks for permission), the build page you ask it to read, and the Discord webhook or ntfy topic you configure

★ HOW TO USE
Open pathofexile.com/trade2 (or the PoE 1 trade site) and run a search
Press Save, Watch or Send to Discord on any result
Click the toolbar button to open the sidebar and manage items, builds and watchers
Add a target price and an alert channel to get notified
Optional: paste a build in Import POB to bring in your gear

Unofficial, fan-made tool. Not affiliated with or endorsed by Grinding Gear Games.
```
## What it does

- **Save a listing in one click.** The item is stored with all its modifiers,
  tiers, price, seller, whisper text and stash position, not just a link.
- **Keep it organised.** Saved items live in collections you name, or stay in
  Unsorted until you assign them. Price history is kept per item (the last 50
  checks), so a chart shows whether the price is going up or down.
- **Import a build.** Paste a Path of Building code (PoE 1 or 2), a pobb.in
  link or a Mobalytics share code. The gear is decoded on your device and listed
  per slot; the code itself is never kept and never sent anywhere.
- **Watch a listing.** The extension re-checks a watched listing on your chosen
  interval and can alert you when it is sold, when the price changes, when it
  drops under a target price, or when a seller on your whitelist lists it.
- **Watch a search.** Re-run one of your own trade searches on a schedule and
  get told when a new listing appears, without keeping the tab open.
- **Alerts where you already are.** Desktop notification, Discord webhook or an
  ntfy topic. Discord and ntfy are optional and off until you configure them.
- **Open the item in Craft of Exile** with its modifiers already loaded, or copy
  its whisper to the clipboard.

## Both games, separately

Path of Exile 1 and Path of Exile 2 have their own saved items, builds,
watchers, leagues and prices. A switch at the top of the panel moves between
them; nothing from one game ever appears in the other.

## Chrome, Edge and Firefox

The same code runs everywhere. Chrome and Edge show the interface in the side
panel; Firefox uses the browser sidebar, and the toolbar button opens or closes
it. Every setting is stored in your browser profile.

## Privacy

No account, no analytics, no telemetry, no ads. Saved items and settings stay in
your browser. The extension reads only the public trade pages you open; it
contacts Discord or ntfy only if you configure them. The full policy is on this
page, under Privacy Policy.

## Notes

Unofficial fan-made extension. Not affiliated with, endorsed by, or sponsored by
Grinding Gear Games. Path of Exile is a trademark of Grinding Gear Games.
```

## Notes for Reviewers

AMO's field accepts 3,000 characters; this text is about 2,200, so it fits
without truncation.

```
No source package is needed: the full source is public at
https://github.com/iulicafarafrica/poetradewatcher12 and every file in the zip
is plain, readable JavaScript. Nothing is minified, bundled or templated.

One build step, for transparency: the Firefox package is the shared source with
lines marked "chrome-only" removed, so the package carries no Chrome-only API.
tools/build-firefox.js does that and fails the build if such a call survives.
No code is generated or rewritten; only whole lines are dropped. The Chrome and
Edge packages use the same files without that step.

Third-party library: pako 2.1.0 (MIT AND Zlib), unmodified, from the official
release.
  https://github.com/nodeca/pako/blob/2.1.0/dist/pako.min.js
  https://github.com/nodeca/pako/tree/2.1.0/lib
The shipped pako.min.js is byte-identical to that release file (46,859 bytes),
SHA-256 EDE2693A4A6A5126B9D35669062B358ECAB6AE7B9B86A1CF302FEB45A8514907.
It inflates Path of Building codes. No other third-party code is included.

Permissions: storage, unlimitedStorage (2,000 items, 200 builds, price history
and an icon cache exceed the default quota; nothing is uploaded), alarms and
notifications for the watcher, scripting only for "Read page", which reads a
Mobalytics build tab the user already has open. beta.craftofexile.com,
mobalytics.gg, discord.com, discordapp.com and ntfy.sh are optional
permissions requested at the moment of use, never at install. There is no
"tabs" permission.

The manifest declares data_collection_permissions.required = ["none"]. The
add-on has no server, no analytics and no telemetry; it reads the public trade
API on www.pathofexile.com and contacts Discord or ntfy only if the user
configures them. Full detail is in the privacy policy.

To test without a Path of Exile account: open
https://www.pathofexile.com/trade/search/Standard, run a search, and the
extension adds a toolbar plus Save / Watch buttons to each listing. The
toolbar button opens the sidebar. Build import, watchers and alert channels
need no account.

Issues: https://github.com/iulicafarafrica/poetradewatcher12/issues
```
