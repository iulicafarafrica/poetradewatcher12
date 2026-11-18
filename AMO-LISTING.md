# AMO submission — Poe Trade Watcher 2.9.52

Everything needed for https://addons.mozilla.org/developers/ → **Submit a New Add-on**
→ **On this site**.

Fill the fields below in order. Items marked **TODO** need a value only the
owner has.

---

## Upload

- **File:** `poe_trade_watcher-2.9.52.zip` (from `PoeTradeFirefox/dist/`)
- **Platforms:** Desktop only. The interface is built for a side panel or a
  sidebar; Firefox for Android has neither.
- **Source code:** not needed. Every shipped file is plain, unminified
  JavaScript written for this add-on, except the vendored `pako.min.js`
  (see Notes for Reviewers).

## Listing fields

- **Name:** Poe Trade Watcher
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
each item. Nothing leaves your device unless you export a backup or, in Chrome,
turn on sync for your settings. Removing the extension deletes all of it.

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

## Description

```markdown
Poe Trade Watcher keeps the trade listings you care about, with every modifier
intact, and tells you when their price moves.

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
No source package is needed: no first-party file is generated, minified,
bundled or templated. Every .js, .css and .html file in the zip is the
hand-written file that ships, so there is no build step to reproduce.

Third-party library: pako 2.1.0 (MIT AND Zlib), unmodified, from the official
release.
  https://github.com/nodeca/pako/blob/2.1.0/dist/pako.min.js
  https://github.com/nodeca/pako/tree/2.1.0/lib
The shipped pako.min.js is byte-identical to that release file (46,859 bytes),
SHA-256 EDE2693A4A6A5126B9D35669062B358ECAB6AE7B9B86A1CF302FEB45A8514907.
It inflates Path of Building codes. No other third-party code is included.

The four validator warnings are Chrome-only branches, guarded at runtime:
- sidePanel.setPanelBehavior (background.js:57, 59) is inside
  if (HAS_SIDE_PANEL), false when chrome.sidePanel is undefined.
- offscreen.createDocument (background.js:3313, 3318) is inside
  if (chrome.offscreen && chrome.offscreen.createDocument).
In Firefox neither runs: the interface is the sidebar (sidebar_action) and the
alert tone is played by the sidebar or an open trade tab.

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
