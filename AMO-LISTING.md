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

```
What this add-on is
-------------------
A helper for the official Path of Exile trade site (www.pathofexile.com/trade
and /trade2). It adds a small toolbar to trade search pages, a Save and a Watch
button to each listing, and a side panel / sidebar that stores them.

Permissions
-----------
- storage: saved items, builds, watchers and settings, all local.
- unlimitedStorage: 2,000 saved items, 200 builds, price history and a small
  icon cache go past the default quota. Nothing is uploaded to make room.
- alarms: the watcher tick and timed search watches must run with the panel
  closed.
- notifications: the desktop alert when a watched price changes.
- scripting: only for "Read page", which reads a Mobalytics build tab the user
  already has open, and only after the optional host permission is granted at
  that click.
- Optional host permissions (requested at the moment of use, never at install):
  beta.craftofexile.com, mobalytics.gg, discord.com, discordapp.com, ntfy.sh.
  A self-hosted ntfy server is contacted at the address the user types; there is
  no broad host permission for it.
There is no "tabs" permission. The extension can see a tab's address only on
hosts it already has permission for.

Network
-------
Only public endpoints: www.pathofexile.com (trade API), web.poecdn.com (item
icons loaded by the browser), cdn.poe2db.tw and cdn.poedb.tw (ascendancy icons),
poe.ninja (currency rates), plus the optional endpoints above. Nothing is sent
to a server of ours; there is no server of ours.

No remote code
--------------
Every script is shipped in the package and readable. The only minified file is
pako.min.js, the unmodified pako 2.1.0 release (MIT AND Zlib) from
https://github.com/nodeca/pako, used to inflate Path of Building codes. It
carries its version and licence in the first line of the file.

Data collection
---------------
The manifest declares data_collection_permissions.required = ["none"]. The
add-on has no analytics or telemetry; it only sends the alerts the user
explicitly configures to the endpoint the user provides.

The four validator warnings
---------------------------
sidePanel.setPanelBehavior (background.js:57, 59) and
offscreen.createDocument (background.js:3313, 3318) are Chrome-only branches.
Both are guarded at runtime:
  const HAS_SIDE_PANEL = !!(chrome.sidePanel && chrome.sidePanel.setPanelBehavior);
  if (chrome.offscreen && chrome.offscreen.createDocument) { ... }
In Firefox those objects are undefined, so neither line runs: the panel is the
sidebar (sidebar_action in the manifest) and the alert tone is played by the
sidebar or an open trade tab. The warnings are static portability notices, not
dead calls.

How to test without a Path of Exile account
-------------------------------------------
1. Install, then open https://www.pathofexile.com/trade/search/Standard
   (or /trade2/search/poe2/Standard for the second game).
2. Run any search. The extension adds a "Mod colors" toolbar above the results
   and a Save / Watch button to each row.
3. Click Save. The item appears under Saved items in the panel; the toolbar
   button opens the panel (sidebar in Firefox).
4. Everything else (build import, watchers, Discord/ntfy) is reachable from the
   panel tabs and does not need an account. Discord and ntfy are optional and
   off by default; their permissions are requested only when used.

Contact
-------
Issues: https://github.com/iulicafarafrica/poetradewatcher12/issues
```
