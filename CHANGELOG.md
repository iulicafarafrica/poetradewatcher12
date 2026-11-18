# Poe Trade Watcher — Changelog

## 2.9.51

A pass over the review findings: alerts that respect their switch, watchers that take turns, state that survives a stopped worker, and untrusted input that stays bounded.

### Fixed
- **"Target price reached" now respects the notifications switch**, like the sold and price-change alerts. The sold alert also catches its own failure instead of leaving a rejected promise.
- **Watchers take turns.** The due list is sorted by `lastChecked` (oldest first) before the twenty-item cap. Before, with more than twenty watchers the same first twenty were due again every tick and the rest could wait forever.
- **The Watchers description says what really happens**: up to 20 listings per check, oldest first; watched searches left from older versions run at most every 15 minutes.
- **A stopped service worker no longer causes duplicate search alerts**: the state of a watched search is saved after each one, and the pass stops after four minutes with the rest still due for the next tick.
- **One-time flags reset.** A listing that comes back after "sold" can announce a sale again; a price that goes back above the target re-arms the target alert.
- **Rate limits are read from the headers too**: `X-Rate-Limit-Ip` / `-State`, `X-Rate-Limit-Account` / `-State` and `Retry-After` (measured on the live API: `8:10:60,15:60:120,60:300:1800,600:10800:3600`). The longest wait wins, the persisted block and clamps stay, "wait N seconds" from the body is still the fallback, and a window that is one request from full paces the next request instead of waiting for a 429.
- **Build codes are bounded**: at most 400,000 characters before decoding, and inflation runs in 64 KB chunks that abort the moment the output passes 32 MB, so a decompression bomb never gets fully allocated. zlib, raw and gzip are still tried in turn.
- **A restored build is sanitized like a record**: name, game, ascendancy, goals (50, named) and gear go through the same sanitizers, and the list is capped at 200. Ascendancy artwork is only accepted from `cdn.poe2db.tw` and `cdn.poedb.tw`, in the worker and at the `<img>` in the panel.
- **A disappeared listing no longer checks a build goal off.** "Sold or removed" never meant "you bought it": the alert stays, the automatic tick does not, and the hint in Notes & goals says so.
- **ntfy messages are honest about self-hosted servers**: any HTTPS ntfy URL is accepted (not only `ntfy.sh`), a self-hosted server needs CORS headers, and a failed test says so. `privacy.html` already described this correctly; only the panel contradicted it.
- **`NOTES.md`** (not shipped) holds the Chrome Web Store justifications, including `unlimitedStorage` (2,000 items, 200 builds, price history, icon cache).

### Still open
- `privacy.html` has the placeholder `privacy@example.com`; the real contact address is needed before publishing.

### Tests
- 202 (importer/schema/CoE/PoB limits), 70 (worker: flags, target reset, goal, ordering, incremental save, rate-limit headers, collection sanitizing), 27 (search rules).

## 2.9.50

The Watchers tab is laid out like a page instead of a pile: one toolbar, one section with its explanation, and the channels folded away until wanted.

### Changed
- **Toolbar**: "Check now" and "Check every [5 minutes]" instead of a bare "Auto" select.
- **The explanation moved under "Watched listings"**, where it belongs, and follows the chosen interval: "Checked every 5 minutes: the extension asks the trade site whether the price changed, the listing sold, or your target price was reached." No more paragraph floating above everything.
- **Watcher cards**: the status is a coloured pill (green available, blue price changed, warm target reached, red sold), the name wraps to two lines instead of disappearing behind the pill, and the meta line (checked / seller / stash) wraps in its own row.
- **Alert channels fold into a summary** that states what is configured ("Discord + ntfy", "Discord", "ntfy" or "Not set"). It opens by itself only while nothing is configured, remembers what you did with it, and puts the two fields side by side on a wide panel.
- The "same values live in Settings" line was dropped: it was noise on a form that already says what it does.

### Verified
- Panel harness with two watchers and both channels set: hint reads "Checked every 5 minutes...", summary "Discord + ntfy", the fold is closed, statuses render as "available" and "price-changed" pills; opening it shows both saved values.
- The name on a 400 px panel wraps onto two lines (39 px) without clipping.
- Tests: 199, 50, 27.

## 2.9.49

The Save button could stay on "Removing..." forever.

### Fixed
- **A stuck "Removing..." was possible.** The content script sent its message and waited without a deadline: if the worker was busy with a watcher check (its queue runs one task at a time) or was restarted mid-message, the callback never fired, so the label was never put back. Messages now give up after 20 seconds and resolve as "no answer".
- **The label is restored from the real state, always.** Both the unsave and the unwatch paths now refresh the button after the answer, whatever it was - a refused or timed-out delete used to leave "Removing..." on the row. The messages also say what is true: "Could not remove the item. The save is still there." / "Could not stop watching the item. The watcher is still there."
- The storage change that follows re-syncs the row anyway, so a delete that completes after the deadline corrects the label on its own.

### Verified
- Code reviewed; the worker routes (ptc:delete, ptc:watch:remove) are unchanged. There is no automated test for the content script - it needs the live trade page - so this fix is reasoned from the promise deadline and the two restored label updates; please confirm on the page.
- Tests: 199, 50, 27.

## 2.9.48

The Watchers tab now explains itself and carries the alert channels.

### Added
- **An explanation at the top of Watchers**: what a watcher is - the extension asks the trade site every few minutes whether the price changed, the listing sold, or the target was reached - and where the alerts go (desktop notification, Discord, ntfy).
- **The two channels and a test button in the Watchers tab**: Discord webhook, ntfy topic/URL, "Save" and "Test alerts". They write the same settings as the fields in Settings, and each side refills from the saved state when shown, so a value typed in one place appears in the other.
- **A phone tip for ntfy**: install the ntfy app (Android or iOS), subscribe to the same topic, and the alerts arrive as push notifications; the hint names the public-server form of a topic.

### Verified
- Panel harness: the fields open with the saved webhook and topic; Save reports "Alert channels saved."; Test reports "Test sent to Discord."; the Settings form then shows the same new values.
- Tests: 199, 50, 27.

## 2.9.47

A build can be deleted from its own card, and deleting it no longer orphans its imported gear.

### Added
- **A delete button next to each build name** in PoB Builds (small trash icon, red on hover). It asks first and says exactly what will happen, e.g. "1 imported item is deleted and 1 saved item stays in Saved items."

### Fixed
- **Deleting a build left its imported items orphaned.** They kept a `targetOf` pointing at a build that no longer existed, so PoB Builds no longer listed them and Saved items filters them out - they stayed in storage, invisible. The worker now removes them together with the build; saved listings that were assigned to it keep existing and become unsorted, as the confirmation says.

### Verified
- Panel harness: two builds, one with an imported item and an assigned saved item. Clicking the trash on the first one removes that build and its imported row, keeps the second build, and the saved item is still in Saved items afterwards. Toast: "Build deleted. Its imported items are gone."
- Worker harness: `handleCollectionDelete` reports 1 removed and 1 moved, leaves the unrelated items alone, no record keeps the deleted build, and the saved listing ends with an empty `collectionId` (5 new assertions).
- Tests: 199, 50, 27.

## 2.9.46

The default theme is Graphite.

### Changed
- New installs start on **Graphite** instead of Ember, in the panel and in the viewer, and the HTML ships with `data-theme="graphite"` so the first paint matches - no flash while the settings load.
- A stored choice still wins (an existing profile on Ember stays on Ember), and "Match system" still follows the operating system.

### Verified
- `PTC_SETTINGS.normalize({})` returns `graphite`; an explicit `ember` in the stored settings is kept.
- Tests: 199, 45, 27.

## 2.9.45

The Discord message left out that the item is corrupted.

### Fixed
- **CORRUPTED is now in the message, in red.** Discord has no coloured markdown, but it renders ANSI inside an ```ansi block, so the last line of a corrupted item is a red CORRUPTED. The embed bar is red as well instead of gold, which makes the item obvious before reading a word.
- The build export marks corrupted gear with "Corrupted" next to its rarity.

### Verified
- The message for the reported boots ends with:

  ```
  - +57 to maximum Energy Shield
  - 98% increased Energy Shield
  - 30% increased Movement Speed

  ```ansi
  (red) CORRUPTED
  ```
  ```

- A normal item gets no ANSI block; a corrupted one carries the code `0;31` and the block markers (three assertions in the suite).
- The worker harness sends a corrupted item through the real router and checks the embed colour `0xb0413a`.
- Tests: 199, 45, 27.

## 2.9.44

The Discord button sends again, and the themes come up off the floor.

### Fixed
- **"Send to Discord" actually sends.** In 2.9.37 the trade-page button became copy-only; it now posts the item to the configured webhook again, and copies the message with an explanation when no webhook is set or Discord refuses it. The worker route is back, and the harness tests it through the real message router with a fake webhook.
- The label is **Send to Discord** (not "Copy"), because that is what it does; the clipboard is the fallback, not the job.

### Changed - themes
- **The dark palettes leave near-black.** Midnight #080a0f -> #11141b, Graphite #0b0b0c -> #131315, Ember #0c0907 -> #16110d, Forest #060a08 -> #0f1512, with surfaces, raised layers and borders lifted by the same amount. The top bar and tab strip follow.
- **The light palettes get a floor.** Daylight page #eef1f6 -> #e4e9f1 with #fbfcfe cards and #ccd3df borders; Sand #f4efe6 -> #ebe3d5 with #fffdf8 cards and #d3c7ae borders. Cards now sit on the page instead of white on white.
- The theme picker previews use the new colours.

### Verified
- Contrast measured per theme from the tokens: text on the page 14.1-15.9:1, text on cards 14.6-18:1, secondary text 9.2-11.4:1, muted text 5.5-6.1:1. Every value stays well above 4.5:1.
- Rendered Ember and Daylight at 400 px: the dark theme reads as dark brown-grey rather than black, the light one shows a light-blue page, near-white cards and visible borders.
- Tests: 196, 44 (two new: the send route and its webhook call), 27.

## 2.9.43

The Craft of Exile action now says what it does, and a first-time user gets one screen that explains the site instead of a sandbox with a red cross.

### Changed
- **"Plan the craft" is "Open in Craft of Exile"**, in the panel, the viewer and the store text. The old name promised a plan the site does not produce; the new one says exactly what happens.
- **A one-time explainer on the first click.** Three lines and two buttons: what Craft of Exile is (a simulator that estimates cost and odds, it does not craft), what to do there (pick a currency, set the modifier you are aiming for, Simulate), and what is not imported (runes; the base defences are rolled by the site, so a number can differ). "Not now" closes it; the next click goes straight to the site.
- The explainer's button carries the click, so the discord.com-style permission prompt for craftofexile.com still appears with a valid user gesture. The "seen" flag is local (`ptcCoeHintSeen`), not synced.
- No currency picker was added: the currencies differ per game and per strategy, and the site already lists them all. The extension names the two steps instead of choosing for the player.

### Verified
- Panel harness: first click opens the explainer titled "Crafting in Craft of Exile" with the three steps; its button closes it, opens the Craft of Exile link and stores the flag; the second click opens the site directly.
- Tests: 196, 42, 27.

## 2.9.42

A two-number modifier was landing on a tier that held only the first number.

### Fixed
- **"Adds 32 to 68 Physical Damage" now picks the tier whose ranges hold both numbers.** The importer matched the first number only, so the staff landed on "Honed" T6 (ranges 13-17 / 28-32) while the item's rolls were 32 and 68. It now lands on "Tempered" T2 (30-40 / 63-73).
- The check uses the class forms (each modifier's stats in printed order with their own ranges), which the index now keeps next to the per-stat lists.

### Verified on the reported staff ("Loath Roar", Judgement Staff)
- Live Craft of Exile: base Judgement Staff (item 666), quality 27%, item level 75, two sockets, block implicit applied by the site, and the modifiers with the right values - the added physical damage now on the tier that contains 32/68.
- The link in the report was built by the previous matcher: it carried six modifiers and the wrong added-damage tier. The current link carries eight.

### Known limit: hybrid affixes
- The trade API prints a hybrid affix as one line per stat ("42% increased Physical Damage" and "+93 to Accuracy Rating"), while Craft of Exile models it as one modifier. The importer resolves lines one by one, so a hybrid can arrive as two modifiers; Craft of Exile then keeps only one per affix group. On this staff the 12% increased Global Accuracy Rating line does not survive next to the light-radius affix, and the crafted 125% shares a group with the 42%. The values that do arrive are correct; the affix pairing is the part that is not exact.
- A pairing pass was tried in this build and dropped again: it guessed wrong hybrids (physical + stun instead of physical + accuracy), which is worse than the current split.

### Tests
- 196, 42, 27 - two new assertions cover the two-number tier and the values it keeps.

## 2.9.41

A corrupted item imported into Craft of Exile looked uncorrupted: the payload never carried the flag.

### Fixed
- **Corrupted items import corrupted.** The details payload now sets `f: ["c"]` when the item is corrupted (and `m` / `p` for mirrored and split), which is the field the site reads for its CORRUPTED label. Verified on the reported boots: Craft of Exile now shows CORRUPTED under the modifiers.
- The socket count still travels (`ns`), so an item with runes keeps its empty socket after the import.

### Verified on the reported item ("Gloom March", Sekhema Sandals)
- Live Craft of Exile (PoE 2 0.5.5.5): base **Sekhema Sandals** (item 3008, not the Runeforged variant), quality 20%, item level 81, one socket, and all six modifiers with the right tier and value - Blazing T1 +57 ES, Unassailable T1 98% ES, Cheetah's T2 30% movement, of the Lightning T2 +40% lightning resistance, of Corundum Skin T3 +207 stun threshold, of the Impedance T3 49% reduced shock duration.
- The link that was pasted pointed at item 3490 (Runeforged Sekhema Sandals) with `method=4` and extra flags: that is the site's own state after the item was edited or saved, not the link the extension builds. The extension's link uses the plain base and keeps it on load.

### Known limits (unchanged, and visible on this item)
- **Socketed runes are not imported**: the 18% increased defences and the bonded +20 life / +20 mana do not apply, so the Energy Shield in Craft of Exile differs from the item.
- **The base defence roll is not imported**: the site rolls the base properties itself, so even without the rune the Energy Shield number is not the item's exact one.

### Tests
- 194, 42, 27 - two new assertions: a corrupted item sends `f: ["c"]` and keeps its socket count.

## 2.9.40

The default theme is Ember.

### Changed
- New installs start on **Ember** instead of Midnight, in the panel and in the item viewer. The stored choice always wins, and "Match system" still follows the operating system (daylight on a light system).
- The panel and the viewer ship with `data-theme="ember"` on the root element, so the first paint is Ember too: no flash of Midnight while the saved settings are read.

### Verified
- Panel harness with an empty profile: theme `ember`, background `rgb(12, 9, 7)`, the theme picker shows Ember pressed. With a stored `sand` profile the panel still opens on sand.
- Tests: 192, 42, 27.

## 2.9.39

"Open for details" moved to the top-right corner of the saved-item card.

### Changed
- The hint sits in the card's top-right corner, level with the item name, instead of on its own line at the bottom. The name reserves room for it, so a long name wraps before it instead of running underneath, and the card is one line shorter (92 px).

### Verified
- Rendered at 400 CSS px: the hint is 101 px wide at the top-right, the name stays clear of it, and both cards measure 92 px tall.
- Tests: 192, 42, 27.

## 2.9.38

The saved-item card shows when the seller listed the item, and it no longer prints the same price twice.

### Changed
- **The card date is the seller's listing time**, not the moment the item was saved. It comes from the listing itself (`indexed` from the trade API, or the page's printed date), so "2h ago" now says how old the offer is. The tooltip spells both out: "Listed by the seller 12 Nov 2026, 13:33 - you saved it 15 Nov 2026, 13:33". Records saved before the listing date was kept fall back to their saved date, and the tooltip says so.
- **No duplicate price.** The conversion tag is dropped when it repeats the asking price in the same unit and amount ("35 x Divine" + "~ 35 div", "3 x Exalted" + "~ 3 ex"). It stays whenever it adds something: "350 x Chaos" still shows "~ 35 div", and a conversion with a remainder ("35 div + 2 ex") is kept.
- The listing-date parser is shared (`parseListingDate` / `listedAt` in `item-utils.js`); the "new" badge on the trade page reads the same one, so both agree on what a date means.

### Verified
- Card harness: a listing indexed three days ago shows "3d ago" with the listing date in the tooltip; a listing indexed 25 minutes ago shows "25m ago"; an old record without a listing date keeps its saved date and says the listing date was not recorded.
- Price harness with divine/chaos/exalted rates: "35 x Divine" and "3 x Exalted" show one tag, "350 x Chaos" shows its "~ 35 div", "37 x Divine" shows one tag.
- Tests: 192, 42, 27.

## 2.9.37

The trade-page button copies a Discord message, and the item comparison is gone from the panel.

### Changed
- **"Copy" is now "Copy to Discord"**, and it copies: one click puts a formatted Discord message for the item on the clipboard. It no longer tries to post to a webhook - that was a send wearing a copy label, and it only worked for people who had a webhook configured. The narrow floating bar gives this button a row of its own so the three labels never squeeze.
- **Compare is gone** from the Saved items toolbar: the selection mode, the two-item modal, its styles and the Esc handling. The list keeps the rarity chips, the search and the trash button.

### Removed
- The `ptc:discord:send` worker route: nothing sends a single item from the page any more, and the build export uses its own message.

### Store text
- The Chrome Web Store description no longer advertises the badges, "Compare to build", the old Searches tab or "Copy for CoE". It now describes Saved items, Import POB, PoB Builds and "Plan the craft" as they are, and six colour schemes instead of seven.

### Verified
- Tests: 185, 42, 27.
- No comparison code is left in the panel: the remaining "compare" names are `compareRowWithApi` (checks the page against the trade API) and `parseCompareStats` (reads life, ES and resistances of an imported build item for its stored stats).

## 2.9.36

The upgrade/sidegrade/downgrade badges and "Compare to build" are gone, and three labels now say what they do.

### Removed
- **The Upgrade / Sidegrade / Downgrade badges** on trade results: the injected pill, the build-gear feed it compared against (`ptc:gear:reference`), its styles and the comparison behind it. A verdict on every row is noise, and the comparison depended on a build reference the page did not always have.
- **"Compare to build"** in the item panel, with its modal, its slot matching and the comparison helpers in `ptc-features.js`.

### Changed
- The PoB Builds button reads **"Send to Discord"** instead of "Discord". The build head keeps one line: the count is "1 item / N items", the name ellipsizes if it has to, and the ascendancy steps aside below 380 px.
- The first section is titled **"Saved items"** instead of "Items".
- **"Delete all saved items" is back where it is used**: a trash button in the Saved items toolbar, next to Compare. It had moved to Settings - Sync and data in 2.9.28, when the header needed the room for the wordmark; both entries now run the same confirmation and still keep the builds and their imported gear.

### Verified
- Panel harness at 400 px: the tabs "Saved items / Import POB / PoB Builds / Watchers / Tools" fit without scrolling, the trash and Compare buttons are in the toolbar, the item panel lists Price check, Plan the craft, Watch listing, Copy item, Seller profile and Delete (no Compare to build), and the build head is 41 px with the name on one line.
- Tests: 185 (three comparison tests went with the feature), 42, 27.

## 2.9.35

The trade status filter and the Craft of Exile import, measured on the live sites instead of assumed.

### Research
- **Trade status values.** One search was created per status value on the live trade site, in PoE 1 and PoE 2, and the label the site displayed was read back:

  | API value | label shown by the site |
  | --- | --- |
  | `available` | Instant Buyout and In Person |
  | `securable` | Instant Buyout |
  | `online` | In Person (Online) |
  | `onlineleague` | In Person (Online in League) |
  | `any` | Any |

  The names do not match the labels: `securable` is buyout only, and the old code used it - and `online` - believing it meant the combined option.
- **Craft of Exile.** The beta planner serves patch 3.30.0.1 for PoE 1 and 0.5.5.5 for PoE 2, reads `?eimport=` for pasted item text and keeps its own item state in a `details=` payload. Measured on the live site: the paste importer refuses uniques ("Unsupported rarity") and dropped every modifier of a PoE 2 rare ("issues encountered", 0 modifiers), while the details payload imported the base, the quality, the item level and every modifier with its tier.

### Changed
- Every search the extension creates now asks for `available`, the value the site labels "Instant Buyout and In Person", in both games: price checks, build imports, uniques, the search a page hint builds and the item-icon lookup. The single constant lives in `TRADE_STATUS` in `ptc-games.js`. The icon lookup keeps `any` when it has to look at offline listings - it is not a search the player sees.
- PoE 2 now uses the Craft of Exile details import as well (the profile flag), in the panel and in the viewer; the paste stays as the fallback when the payload cannot be built.
- Craft of Exile modifier resolution prefers the modifier whose number count matches the item line, so a hybrid that shares the first stat's wording no longer wins over the pure roll when both are in the class pool.

### Verified
- Live Craft of Exile, PoE 2: a Grand Regalia (quality 12%, item level 82, +90 life, +35% fire resistance) imported with every modifier and its tier - "Rotund" (T7) and "of the Volcano" (T3) - and the right base defenses.
- Live Craft of Exile, PoE 1: a Vaal Regalia (quality 16%, item level 86, +90 life, +35% fire resistance) imported with "Rotund" (T7) and "of the Furnace" (T4).
- Live trade site: the five labels above, read back in both games.
- Tests: 194 (profiles, importer, comparison, CoE payload), 42 (worker), 27 (search rules).

### Known limits
- The hybrid preference only helps when the class pool also has the pure modifier. On a STR/DEX/INT body armour the pool holds only hybrids for "increased Energy Shield", so a lone line of that wording imports as the hybrid - the site has no other modifier to offer for that base.
- Craft of Exile has no unique modifiers, so a unique still imports as its base with the item level and quality; its mods cannot be represented there.

## 2.9.34

The verdict badges were loud and the sidegrade verdict was too eager; a build also had no way out to Discord.

### Changed
- **Softer verdict badges, easier to read.** The solid yellow and red pills became tinted ones: a soft wash of the colour, a faint border of the same colour, and the label in a light tint at 11 px semibold instead of 10 px bold. Same three colours, a third of the shout.
- **"Sidegrade" no longer answers every mixed case.** Each stat is now weighed at the size it usually has on a rare item, so a big life roll and a big resistance roll count alike while a small energy shield roll stays small. Upgrade or downgrade is claimed only when that side is clearly ahead (a third more than the other side, and at least a fifth of an ordinary modifier); a close trade stays a sidegrade. A listing with +84 life and 5 points less fire resistance used to read "Sidegrade" and now reads "Upgrade".
- **PoB Builds: the build name is gold** (`--warm-text`) and the ascendancy under it is muted, so the name is what the eye lands on.
- **PoB Builds: a "Discord" button per build.** It posts the whole build to the webhook from Settings - Watchers: the build name as the title, the ascendancy as the author, one field per item with the base, rarity, item level, league and up to four rolls. A build that does not fit is split across several messages, inside Discord limits.
- The button says where to add a webhook when none is configured, asks for the discord.com permission if it is missing, and disables itself for a build with no items.

### Verified
- Tests: 188 (importer/schema/profile, including three new comparison cases), 42 (worker, including the build export), 26 (search rules).
- Badge colours measured on a dark row: sidegrade `rgb(221, 199, 151)` on a 12% tint, downgrade `rgb(233, 170, 163)` on a 12% tint, 11 px / 600 weight; the old solid versions are visibly louder beside them.
- Panel harness: the Discord button sends the build and reports "Build sent to Discord: 2 items in 1 message."; the message itself was checked in the worker harness (title, author, one field per item, missing webhook message), with a fake webhook - nothing was posted to a real Discord channel.

## 2.9.33

Gear imported from a build code had no place of its own: it sat in Items next to the listings saved from the trade site.

### Changed
- **A section for build imports.** "POB Build" is now "Import POB" and holds only the importer (paste a code, choose the build, import). Next to it, "PoB Builds" lists the builds and the gear imported into each one, with the slot count, the ascendancy and a row per item.
- **Items lists only what was saved from the trade site.** The build filter (All items / Unsorted / a build name) is gone from Items, together with the New and Manage buttons; both live in PoB Builds now. The rarity chips and Compare stay, with Compare moved onto the chip row.
- **An imported item opens the same detail panel as a saved one** - price check, crafting plan, compare, copy, viewer - and the button back there says "Back to builds" and returns to the build list.
- **The import switches to PoB Builds when it finishes**, instead of landing in Items, where those items are no longer listed.
- **"Delete all saved items" leaves imported gear alone**: it deletes the listings, keeps every build and its imported items, and the confirmation says so.
- Existing data needs no migration: imported records already carry `targetOf`, so they appear under their build as soon as the update is loaded.

### Verified
- Panel harness: with two saved items and one import, Items shows 2 cards and "2 items saved"; PoB Builds shows the build with "1 imported item"; opening it sets "Back to builds", returns to the builds list, and the empty state appears when no build exists.
- 400 and 360 CSS px: the five tabs (Items, Import POB, PoB Builds, Watchers, Tools) fit without scrolling, and Compare stays on the chip row.
- Worker harness (`tests/watcher-sim.js`, 33 assertions): clearing with the flag keeps the records that have `targetOf` and removes the rest; clearing without it still empties the game.
- Nothing was tested against the live trade site.

## 2.9.32

A PoE 1 build import opened its price check in Standard even with a league selected in the header.

### Fixed
- **The league picked in the header now reaches the search.** The header picker writes `leagueByGame` / `leagueModeByGame`, but the price check read only the "fallback league" field: it found nothing, the open trade tab did not match either, and the search was pinned to Standard. The panel now resolves the league in the same order the worker does: the league picked in the header, the league typed into the fallback field, then the league of the open trade tab.
- **The worker no longer pins Standard for a record without a league.** `handleTradeUrl` defaulted to Standard in both of its branches; it now asks `resolveLeague` first, which reads the settings and the live league list.
- Saved listings are unchanged and were not touched: a listing searches in the league it was saved from, in both games. Only imports, which have no league of their own, follow the current league.

### Verified
- Panel harness (real sidepanel, fake worker that records the record it receives): a PoE 1 import with "Covens" picked in the header sends Covens; a PoE 2 import with "Forbidden Rites" sends Forbidden Rites; a listing saved from Standard still sends Standard while the header says Forbidden Rites; a listing saved from Settlers sends Settlers.
- Worker harness (`tests/search-sim.js`, 26 assertions): an import without a league resolves to the configured league in both games, and a league written on the record still wins over the settings.
- Nothing was tested against the live trade site; the checks above run offline.

## 2.9.31

Two backgrounds removed: the one behind the name in the header, and the one behind the extension icon.

### Changed
- **The header wordmark has no plate any more.** Shield, "POE" and "TRADE WATCHER" sit directly on the topbar; there is no chip, no border, no shadow, and the lockup is 125x25 instead of 138x31.
- **The gold follows the theme.** Six new tokens (`--wm-top`, `--wm-mid`, `--wm-bot`, `--wm-sub`, `--wm-mark`) hold the wordmark colours. Dark palettes keep the bright gold; `daylight` and `sand` get a bronze, because gold on a pale topbar is not readable.
- **A new extension icon, on transparency.** The same gold shield with the orange gem as the header logo, drawn without the old black rounded square. It is the toolbar icon and the 128 px store icon, so a Chrome Web Store listing shows the same mark as the panel.
- The shield keeps a near-black interior on purpose: on a light toolbar the dark silhouette carries the shape, on a dark one the gold outline does, so one file works on both.
- Added `icons/icon32.png` (Chrome asks for 16/32/48/128) and `icons/icon.svg`, the vector source the PNGs are rasterised from. The 16 px variant scales the mark up 1.3x, otherwise the shield shrinks to a speck inside the frame.

### Verified
- Computed style of the lockup in all six themes: background `none`, padding `0`, box-shadow `none`.
- Contrast of the wordmark colours against the effective topbar colour: dark palettes 6.55:1 at the worst stop, `daylight` 5.29:1, `sand` 5.47:1 - all above the 4.5:1 AA threshold for text.
- Icons rendered at 16/32/48/128 over a light (#f1f3f4) and a dark (#292a2d) background; the PNGs are RGBA and the corners are transparent.
- Header at 360 CSS px: lockup 125x25, nothing clipped, no horizontal overflow.

## 2.9.30

The logo plate had a thin gold border around it, which read as a box drawn around the name rather than as a logo.

### Changed
- **No line around the logo**: the gold border and the inner highlight ring are gone. What is left is a soft dark chip (a faint top-to-bottom gradient, one small drop shadow) that holds the shield, "POE" and "TRADE WATCHER" together without outlining them.
- The chip is slightly tighter (138x31 px, was 144x34), so the header keeps its spacing at the narrowest width.
- The chip stays dark in every theme: it is part of the logo, not a surface, so the gold stays legible on the light themes too.

### Verified
- Rendered in the dark theme and in the light theme: no border (`0px none`), the gold text holds its contrast on both, no horizontal overflow.
- 400, 380 and 360 CSS px: plate complete, nothing clipped, "Buy me a coffee" keeps its label.

## 2.9.29

The first wordmark was one line of tracked caps at 11.5 px: hard to read and not a logo.

### Changed
- **A lockup instead of a line of text**: a gold shield with an orange gem, "POE" at 15 px in Cinzel with a gold gradient, and "TRADE WATCHER" as an 8.5 px tracked caption underneath - the standard shape of a logo, and readable at panel size.
- The plate is 144x34 px: narrower than the single-line version (164), so the wordmark, "Buy me a coffee" and the two icon buttons all fit down to 360 px without truncation.
- The heading still says "Poe Trade Watcher" for screen readers and for `document.title`.

### Verified
- Rendered at 400, 380 and 360 CSS px: plate complete at 144x34, nothing clipped, support button with its text, no horizontal overflow.

## 2.9.28

The name in the header is a wordmark now: black and gold, Trajan-style capitals, the look the trade site uses for its own logo.

### Changed
- **A logo instead of plain text**: "POE TRADE WATCHER" set in Cinzel (an open-licence Trajan-style serif, bundled with the extension - 15 KB, latin subset, OFL licence included in `fonts/`), gold gradient capitals on a black plate with a thin gold border and a faint orange inner rule. It stays black in every theme, because a logo is not a surface.
- **"Delete all saved items" moved from the header to Settings -> Sync and data**, with the same confirmation ("Delete all N saved items? Builds are kept."). A destructive action does not belong next to navigation, and the space lets the wordmark and the support button both fit.
- Without it, the header is the wordmark, the theme and settings buttons, and "Buy me a coffee".

### Verified
- Rendered at 400, 380 and 360 CSS px: wordmark complete (164 px plate), support text visible, no overflow; below 340 px the wordmark truncates and nothing else moves.
- The bundled font loads from the extension (`document.fonts.check` true), so no network request is involved.

## 2.9.27

The Ko-fi control was a cup with no words.

### Changed
- **"Buy me a coffee" is a labelled button** in the header: cup icon plus the words, in the warm (gold) style, stacked as a normal control instead of a bare icon. Its tooltip and screen-reader label say the same.
- The header was tightened (3 px between the icons, 8 px padding, a slightly smaller pill) so the full product name still fits next to it: measured at 400 and 380 CSS px, the title keeps all 108 px and nothing overflows. Below ~360 px the title is the part that gives way (it truncates with an ellipsis), never the button.

### Verified
- Rendered at 400 and 380 CSS px: title "Poe Trade Watcher" untruncated, button 104 px with its text visible, no horizontal overflow. At 344 px the title truncates to "Poe Trade …" and the button keeps its words.

## 2.9.26

One name in every file: Poe Trade Watcher.

### Changed
- **The panel header says "Poe Trade Watcher"** instead of just "Trade Watcher" (it still fits at 400 px: 108 px of text, no truncation).
- **Tab titles use the same name**: the panel is "Poe Trade Watcher" for both games (it used to switch between "Poe 1 Trade Watcher" and "Poe 2 Trade Watcher"), the item viewer is "<item> - Poe Trade Watcher", and the missing-item page is "Item not found - Poe Trade Watcher" (both said "Trade Collection").
- The theme file's header comment still called the extension "Poe2 Trade Watcher"; it follows the manifest now.

### Verified
- Rendered: header "Poe Trade Watcher", no overflow, `document.title` "Poe Trade Watcher", no page errors.

## 2.9.25

The Tools card for the companion app said PoE 2 only.

### Changed
- **"Poe2 Chat Alert" is now "Chat Alert — for Path of Exile 1 & 2"**, with a description that says both games: real-time chat alerts (leech words, trade items, price drops, Discord/ntfy) for Path of Exile 1 and Path of Exile 2, reading whichever game is running. The link still points at the same repository.

### Fixed
- **The tool cards can be reached with the keyboard.** They answer Enter and Space (the handler was there) but had no `role` and no `tabindex`, so focus never landed on them. Both cards are links now, with a label that says where they go.

### Verified
- Rendered: the new name and description, `role="link" tabindex="0"` with the label on both cards; pressing Enter with a card focused opens its GitHub page.

## 2.9.24

The two dropdowns in the header are gone, and Chrome Sync got a status line.

### Changed
- **A context bar under the header replaces the header selects.** The game is a two-way switch (PoE 2 / PoE 1, the current one pressed), the league is a pill that opens a list with the current one marked, and the saved-item count sits on its right. The title is no longer squeezed until it truncates, and the native selects (whose menu cannot be styled) are gone; the old rules for them are removed.

### Added
- **Sync says what it holds**: under the sync buttons, "Last pushed 7m ago · 3 chunks · 11 KB of 100 KB", read from the sync area itself; it also says "Chrome Sync is off." or "Nothing pushed yet.", and refreshes after push and pull.

### Verified — Chrome Sync
- Run against a fake `chrome.storage.sync` that enforces Chrome's real quotas (100 KB total, 8 KB per item, 512 items): 8 folders and 40 bookmarks push as 5 chunks (18.7 KB) with a correct meta; the pushed settings carry empty `discordWebhook` / `ntfyUrl`; a fresh device pulls back 8 folders and 40 bookmarks, takes the synced theme, and keeps its own webhook and ntfy topic.
- Pushing less data removes the chunks that are no longer used (5 chunks -> 1, only `ptcSyncChunk0` and the meta remain).
- An oversized push (400 bookmarks) fails with "Browser sync storage is full or unavailable." and leaves the previous sync data untouched.
- Saving any setting or a folder/bookmark queues a push 2 s later, only while the switch is on.

### Scope
- Chrome Sync carries folders, bookmarks and settings, not saved items, builds or watchers (a backup file covers those). The panel says so: "Backups contain items, builds, watchers, history and settings."

## 2.9.23

The themes were rebuilt from one palette system. Three things in the old ones were not taste, they were wrong.

### Fixed
- **Crafted and fractured modifiers were gold, the colour of rare items.** On the trade page that is actively misleading: a crafted line looked like a rare one. The rarity colours now follow the game: gold rare, orange unique, blue magic/explicit/rune, light blue crafted and fractured, magenta desecrated, violet enchant, steel implicit, red corrupted, teal gem, tan currency. The set is defined once and only its brightness changes between dark and light themes.
- **Graphite had a grey accent**, so buttons, links and selected tabs looked disabled. It keeps the neutral surfaces but the accent is a steel blue.
- **Forest used the same green for the accent and for "success"**, so "saved/ok" and "clickable" were the same colour. The accent is now lime and success emerald.

### Changed
- **New palettes for all six themes**, generated from one set of rules: a deeper base, four surface levels with visible separation, borders derived from the surface, and every text token checked against the surface it sits on. All six pass 4.5:1 (most reach 6-16:1).
- The picker previews were hardcoded to the old colours and are updated with the palettes.

### Verified
- The generator refuses to ship a theme whose text token is under 4.5:1; all six pass.
- Rendered each theme in the browser at 400x760 and looked at it: midnight, graphite, ember, forest, daylight, sand, all legible with distinct accents.

## 2.9.22

Audit of the settings: the form, the schema and what is actually read.

### Fixed
- **Two settings were dead.** `autoLeagueEnabled` was read by nobody (removed from the schema); `sellerAlertsEnabled` was read by nobody either, so whitelisted-seller alerts could not be turned off - it now gates them, with a switch: "Notify me about the sellers listed below".
- **A webhook or ntfy address that cannot work is reported when it is saved.** Before, an invalid Discord URL or a non-ntfy address was accepted with "Saved." and the alert then failed silently. The ntfy check mirrors the worker (a bare topic, or an https address whose last segment is a topic).
- **The theme hint claimed "Applies instantly"**; it applies on save, and now says so.

### Changed
- **The interval lists come from the schema.** The panel header and the settings form each had their own hardcoded list of 1/2/5/10/15/30/60; both are now built from `PTC_SETTINGS.WATCH_INTERVALS`, so a new value cannot drift.

### Checked and left alone
- Every form field maps to a setting and every setting the form edits is saved (25 fields, no duplicate names, no orphan field).
- `watcherInterval` is clamped in `normalize` (1-60) and saving re-creates the alarms through `ensureWatchAlarm`.
- `fuzzyResults` has no switch: it only affects the trade-page filter box, which is off by default and not part of this workflow.
- `defaultGame` is chosen in the panel header, and the legacy `league`/`hardcore`/`leagueMode` keys mirror the PoE 2 slot for older installs; neither needs a field.
- Secrets are stored locally, stripped from backups and from the sync payload (checked in `buildBackup`/`pushSync`).

### Verified
- Rendered: both interval selects list the same seven values from the schema; the seller switch exists and follows its setting.
- Saving `not-a-webhook` and `ftp://example.com/thing` gives "That is not a Discord webhook address. The ntfy address must be https://ntfy.sh/<topic> or a topic name."; a valid form still gives "Saved."

## 2.9.21

"Open for details" moved to the right edge in the gold of the warm tags, and saving a webhook no longer claims success when the permission was refused.

### Changed
- **"Open for details ›" sits at the bottom-right of the card**, in `--warm-text` (gold) with the warmer tone on hover, instead of under the seller line in link blue.

### Fixed
- **A refused host permission is reported after the save.** Saving a Discord webhook or an ntfy topic set the warning, then wrote "Saved." over it; the ntfy permission result was ignored entirely. Both now appear in the settings status, because a missing permission is exactly why alerts would never arrive.

### Verified
- The two channels themselves: a test POST to the Discord webhook returned 204, and one to ntfy returned 200 with the topic name echoed back.
- The extension path in a sandbox with those settings: a watched price change sends exactly two requests (Discord embed "Watched item price changed · Skull Song: 45 x Divine -> 30 x Divine" and the ntfy JSON with topic/title/message); no price change sends none.
- Rendered at 380 px: the hint ends 13 px from the card edge (card padding), gold `rgb(224, 185, 120)`, no page errors.

## 2.9.20

"Open for details" looked like another grey label.

### Changed
- **It carries the accent colour** (the same blue as links and the primary button) and is semibold, so it reads as the way into the item instead of as metadata. On hover and keyboard focus it switches to the brighter accent and underlines.

### Verified
- Computed in the browser on the midnight theme: `rgb(142, 166, 255)`, weight 600, against `rgb(232, 236, 244)` for the card text; no page errors.

## 2.9.19

A compact item card does not look like it holds the whole item. Now it says so.

### Added
- **"Open for details ›" at the bottom of every item card.** The card is a button that opens the full item (all modifiers with their tiers, price history, seller, the search link, Craft of Exile), so the card states it instead of leaving it to be discovered. It brightens on hover and on keyboard focus, and it is left out while picking two items to compare.

### Verified
- Rendered with two saved items: both cards show the line at the bottom, card height 132 px, no page errors.

## 2.9.18

The "Search" link in a watcher row sat lower than Target / Pause / Remove, and the target price needed proving.

### Fixed
- **"Search" is the same size as its neighbours.** It was an `.action` link (the large grid button used in the item panel) inside a row of small buttons, so it was taller and pushed down. It is a small button now; measured in the browser: all four actions at the same top (250 px) and the same height (23 px).

### Verified — target price
- Sandbox run of the worker with a price table, on a watcher at 45 divine: a listing at 30 with target 40 sets `targetReached`, switches the status to `target-reached` and announces "Target price reached". The same listing with target 20 does neither. 30 assertions in `tests/watcher-sim.js` (6 new).
- The target needs the currency table to compare prices (poe.ninja, cached 15 minutes): with no rates at all the comparison is skipped rather than guessed.
- Rendered row: tags "30 x Divine", "45 x Divine → 30 x Divine", "target 40 divine", status `target-reached`.

## 2.9.17

One kind of alert: a watched listing whose price moves, and now one you can hear.

### Changed
- **The tab is called "Watchers" again** and holds only watched listings: price, availability, target price. Watched searches and the search history are gone from the panel (their background code stays, nothing is deleted from storage).
- **A short two-tone alert plays when a watched price changes.** A service worker cannot play audio, so it goes through a small offscreen document created on demand (new `offscreen.html` / `offscreen.js`, `offscreen` permission). Limited to one tone every five seconds, and there is a switch: Settings → "Play a sound when a watched price changes".
- The badge on the tab counts enabled watched listings only.

### Removed
- The panel code behind watched searches, the search history, saved filters and multi-live searches (renderers, bindings and the handlers that only they used).

### Verified
- Sandbox run of the worker: a price change plays one sound and sends one notification; the same price plays nothing. 24 assertions in `tests/watcher-sim.js`.
- Rendered: tabs `Items / POB Build / Watchers 1 / Tools`, one card with the price history line ("50 x Divine → 45 x Divine"), the sound switch present and on, no page errors.

## 2.9.16

The Alerts tab was four controls in one line and three toolbars stacked in a 360px panel.

### Changed
- **One bar at the top**: a single "Check now" (it checks listings and searches together) and the automatic interval. The "Check listings / Check searches" pair and the separate toolbars are gone.
- **One card per section**: "Watched listings" (with the count on its right), "Watched searches" (with "Watch open search" on its right), "Recent searches" (with "Clear"). Each card is bordered and separated; the explanatory hints only appear when the section is empty instead of sitting above every list.
- The ratio of controls to content is now 1 : 3 instead of 4 : 3.

### Removed
- The dead code behind saved filters and the multi-live list: their renderers and element references are gone, so nothing touches an element that no longer exists.

### Verified
- Rendered with one listing, one watched search and one history entry: one bar button, three cards with the right headers and actions, no stray hints, badge "2", no page errors.

## 2.9.15

Watchers and Searches were two tabs for the same question ("tell me when something happens"). They are one tab now.

### Changed
- **One "Alerts" tab** with three sections: **Watched listings** (one listing each: still there, price moved, target reached), **Watched searches** (a whole search, re-run on the trade site, new listings only) and **Search history**. The panel goes from five tabs to four.
- **One badge** for the tab: enabled watched listings plus enabled watched searches (2, not a history count).
- **Buttons say what they check**: "Check listings now" / "Check searches now", and "Watch the open search" sits with the watched searches it creates.
- **Saved filters and Live searches are gone from the panel.** They duplicated a browser bookmark and plain tabs; the stored data is untouched, only the UI is removed.

### Verified
- Rendered with one watcher, one watched search and one history entry: tabs `Items / POB Build / Alerts 2 / Tools`, the three section headers, both lists filled, and the four remaining buttons. No page errors.

## 2.9.14

Save on the trade page put the item into whichever build was selected in the panel, which is a filter, not a destination.

### Changed
- **Saving always goes to Unsorted.** The build selected in the panel says what you are looking at; it is no longer read as "put new saves here". The toast says so: "Item saved to Unsorted (N items). Assign it to a build from the panel."
- Moving an item into a build stays explicit: "Add to build" on the item, or "Add here" in the builds dialog.

### Removed
- The `ptcSelectedCollection` storage key and its writer: with the save button no longer reading it, it was dead state written on every filter change.

## 2.9.13

The "Manage builds" dialog was a form, a list and four equal buttons per build in one column. Reorganised.

### Changed
- **The list comes first.** Creating a build is a "+ New build" button that reveals the name field and the ascendancy picker; the form no longer pushes the list down every time the dialog opens (it is open by default only when there are no builds).
- **Builds are sorted by name**, not in storage order.
- **One line of numbers per build**: "12 items · 4 goals" instead of the item count alone.
- **"Open" is the primary action** (accent colour); "Notes & goals", "Rename" and "Delete" follow it. "Sheet" was renamed: it never said what it opened.
- **Deleting says what it moves**: "Delete build X? 3 items move to Unsorted."
- The header shows how many builds there are.

### Verified
- Rendered in a real browser with two builds: header "2 builds", form hidden, rows in name order, meta "2 items · 2 goals", actions Open / Notes & goals / Rename / Delete, no page errors.

## 2.9.12

This is the real cause of "the search does not have the item's filters": the panel sent only the explicit modifier lines.

### Fixed
- **The panel and the viewer send every modifier line, not only the explicit ones.** The search record was built with `explicitModLines(rec)`, so an imported item's crafted and desecrated modifiers never reached the worker: "Glyph Emblem" searched `+80 ES / 34% ES / mana / Int / lightning res` and dropped `77% increased Energy Shield` (crafted) and `+2 to Level of all Minion Skills` (desecrated). That is exactly the five-filter page in the screenshot, with the count set to 4.
- One helper, `PTC.searchModLines(item)`, now collects every modifier a search may use (explicit, crafted, fractured, desecrated, enchant, veiled, scourge, delve), deduplicated, with rune and "Bonded:"/"Rune:" lines left out.

### Unchanged
- The required group for build-defining stats and the "all but one" tolerance stay as they were in 2.9.11; they were not the problem here.

### Verified
- `tests/search-sim.js` now builds the record the way the panel does (one flat list from the helper): 20 assertions, including that the crafted and desecrated lines are in it, that the minion levels form the required group, and that the count group has the five remaining filters with no duplicate and no rune.
- Live check of the resulting query on the trade site earlier: 9 results with the required group against 1493 without it.

## 2.9.11

An imported item is searched by what it is built around, and the rest of its modifiers have to match all but one.

### Changed
- **The build-defining modifier is required again** ("+# to Level of all … Skills"): searching an item with "+2 to Level of all Minion Skills" only shows listings that have it. 2.9.10 made it optional, which brought back focuses without it.
- **The other modifiers must match all but one** (instead of half), with no roll minimum: "the same filters, plus or minus one". A stat that appears twice counts once, and runes are still never searched.

### Verified
- "Glyph Emblem" (Sacred Focus): `and[+2 to Level of all Minion Skills]` + `count(5 filters, min 4)`; duplicate energy shield merged, no rune filter. 17 assertions in `tests/search-sim.js`.
- If a result set turns out too small on a real league, the tolerance is one number (`rest.length - 1`); say the word and it becomes "all but two".

## 2.9.10

An import is a similarity search, not a shopping list: half of its modifiers, with the build-defining one counted like the others.

### Changed
- **The "+# to Level of all … Skills" stat is no longer required for an import.** Requiring it (2.9.8) made every result carry it, which is the opposite of "similar items": the market rarely repeats a whole build's stat combination, and the item the player is comparing against is itself a build, not a listing. All modifiers now form one `count` group and half of them must match.
- Kept from 2.9.8: a stat that appears twice (an explicit and a crafted "increased Energy Shield") is one filter, and runes are never searched.

### Verified
- The item from the report ("Glyph Emblem", Sacred Focus): one group, `count(6 filters, min 3)` — +2 to Level of all Minion Skills is one of the six — no duplicate Energy Shield, no rune filter. Before 2.9.8 it was `count(7, min 4)` with the duplicate.
- `tests/search-sim.js` (15 assertions) checks this, the rune rule, and the saved listing shape.

## 2.9.9

Runes are socketable, not part of what is being bought: a search must not exclude the items that happen to hold a different rune.

### Changed
- **Rune effects are never searched.** They were already left out (the rune modifier array is not read, and the rune stat domain is skipped), but by omission: a record that carried a rune line among its modifiers ("Bonded: +20 to maximum Life", "Rune: …") would have searched for it. The rule is explicit now, in one place, and a rune line in any modifier list is dropped.
- **The required/similarity split applies to imports only.** A saved listing that has no stat ids (an old record) still searches all of its printed modifiers, as before.

### Added
- **`tests/search-sim.js`**: runs the shipped worker in a sandbox with a fake stat table and no network, and checks the rules of a search — rune lines are not searched (also when they sit in the modifier text), an import requires its "+# to Level of all … Skills" stats and half-matches the rest, and a listing with stat ids searches those and never a rune id. 15 assertions.

### Verified
- The item from the report ("Glyph Emblem", Sacred Focus, three runes): seven searched lines, no rune among them; the query is `type "Sacred Focus"` + `and[minion levels]` + `count(5, min 3)`.

## 2.9.8

An imported item was searched with one loose group, so the modifier the item exists for was optional.

### Fixed
- **The build-defining modifier of an import is required.** A PoE 2 focus with "+2 to Level of all Minion Skills" (desecrated) went into a count group of seven filters with `min 4`: the minion levels were in the query, but four other modifiers were enough to match, so the results were focuses that shared the incidental stats and not the one the item was made for. The stat was found, it simply was not mandatory. Now the "+# to Level of all … Skills" stats form an `and` group (required) and the rest stay a similarity group (half of them, no roll minimum).
- **A stat listed twice counts once.** An item with both an explicit and a crafted "increased Energy Shield" produced two filters on the same stat id, which inflated the count and could be satisfied by a single roll.

### Verified offline with the item from the report
- "Glyph Emblem" (Sacred Focus, 5 explicit + 1 crafted + 1 desecrated, 3 runes): the query is `type "Sacred Focus"` + `and[+2 to Level of all Minion Skills]` + `count(5 filters, min 3)`; before it was `count(7 filters, min 4)` with the energy shield stat twice.
- A saved listing keeps its own shape: `count(n-1, 80% of its rolls)`.

## 2.9.7

Two corrections to the Searches tab, from looking at what it actually cost and what its badge said.

### Changed
- **The Searches badge counts the searches being watched now**, not the history entries and presets. It used to show a large number that never changed meaning (81 entries in one profile, with nothing being watched).
- **A watched search is checked at most every 15 minutes.** Each check is a real search plus a fetch of its newest listings, so it does not follow the item-watcher interval below 15 minutes; the settings field says so.

### Verified
- Sandbox run of the shipped worker (no network): a watched search last checked 10 minutes ago is skipped, one last checked 20 minutes ago is checked. 22 assertions in `tests/watcher-sim.js`.

## 2.9.6

An imported item searched like a saved listing, which it is not: it is not on the market, and its modifiers are a build's, not a listing's.

### Fixed
- **An import is searched with half of its modifiers and no roll minimum.** "All of them but one, at 80% of the roll" is right for a listing that is on the market: it finds the item next to its neighbours. For a build import it demanded seven of eight exact stats, returned nothing, and the old code then opened the page of the whole base — the "random items" that were really an empty result. An import now asks for at least half of its modifiers, with no value on them.
- **The import button is called "Price check"**, like the saved item one, and carries the same tooltip.
- **A failed build no longer opens a search without the modifiers.** It says what failed and stops; before, it fell back to the base page, which lists every item of that base.
- **The item viewer builds the same url as the panel.** It was still asking the worker to create a search over the api (the old ladder); a viewer item now goes through the same builder, with no trade request.

### Verified offline (no requests)
- The real imported belt (8 modifier lines): import -> `type "Utility Belt" + count(8, min 4)` with no roll values; the same record as a saved listing -> `count(8, min 7)` with its 80% values.

## 2.9.5

The watcher is now covered by a simulation, and the simulation found a bug on the first check of every watcher.

### Fixed
- **A new watcher no longer reports a price change on its first check.** The price was compared as display text: the trade row says "3 divine" and the answer from the api formats the same price as "3 x Divine". Every watcher therefore flipped to "price changed" (with the old price invented from the row text) and, with notifications on, sent an alert for a price that had not moved. Amount and currency are compared now; the text is only used when a side has no amount.

### Added
- **`tests/watcher-sim.js`** runs the shipped worker in a sandbox with a fake browser and a fake trade api, and walks the whole cycle without a network request: add, same price, price drop, listing gone, expired. 20 assertions, including that a sold alert is not repeated and that an expired watcher switches itself off.

### Verified
- The cycle end to end in the sandbox: `available` (no alert) -> `price-changed` (one alert, old price kept) -> `sold` (one alert, not repeated) -> `expired` (switched off).
- Alarm: `ptc-watch-check` is created with the configured interval (5 minutes), and one check spends exactly one request per watcher.

## 2.9.4

Two gaps left by 2.9.2 / 2.9.3, found while checking the badge on a PoE 1 page.

### Fixed
- **The build gear is repaired too.** The 2.9.2 repair fixed the saved items but not the copy each build keeps for the trade-page comparison, so a belt saved as "Elder Item" still never matched a listing. The migration (V2) now fixes both, and runs once more.
- **Nothing to compare against is no badge.** A build item with no comparable stat (a ring whose only modifier is "+#% to all Elemental Resistances") made every listing an "Upgrade": each stat of the listing counted as a gain against an empty reference. With no reference values the verdict is "unknown" and no badge is drawn.

### Verified live
- PoE 1 page (Divine Crown, Covens): badges appear, the reference is the PoE 1 build ("vs Divine Crown (Helmet)"), and the tooltip lists the listing against the build item (-102 Life, loses 44 Cold Res, loses 44 Lightning Res).

## 2.9.3

The upgrade badge could tell you an item was an upgrade when it was not. A badge that is wrong is worse than no badge, so the comparison is now conservative.

### Fixed — upgrade / downgrade badge
- **A listing whose modifiers were not read gets no badge at all.** Before, an unrendered row counted every stat of the build item as "lost" and every such listing showed "Downgrade". The comparison now reports "unknown" and the badge is removed.
- **"Upgrade" / "Downgrade" is only claimed when no compared stat moved the other way.** The old verdict was a vote count, so "+1 life, +1 energy shield, +1 mana" beat "loses 36 fire and 34 lightning resistance" and the item was labelled an upgrade. Anything mixed is a "Sidegrade" now, and the tooltip lists every difference with its numbers.
- **A point or two is noise.** Differences within two points, or within 5% of the build item's own value, are ignored instead of deciding a verdict.

### Not covered (by design)
- The badge compares flat Life / Energy Shield / Mana / resistances from modifiers. The base armour and energy shield of the item, and "% increased" modifier lines, are not part of it — the item's own base can be better or worse than the numbers suggest.
- The badge reads the listing from the trade page's DOM. If the site changes its markup the badge simply does not appear (never a guessed verdict).
- The "Compare to build" sheet in the side panel is unchanged: it shows the numbers and totals next to each other, with a note that it is an indication, and never a label.

## 2.9.2

Build imports were searching with the old code, and the PoE 1 ones were searching for a base that does not exist.

### Fixed — build imports
- **An influence line is no longer read as the base type.** Path of Building writes "Cord Belt" / "Elder Item" on two lines; the importer took the second as the base, so the trade search asked for a base called "Elder Item" and the Craft of Exile link could not find one either. The influence tag is skipped and the item keeps its real base.
- **Modifier ranges are one number for the lookup.** Lines like "+(21-25) to Strength and Dexterity" (a tier range, which PoB writes when it does not know the roll) canonicalised to "##", never matched the site's stat and were dropped from the search. They now match like "+(21)".
- **An import builds its search the way a saved item does.** Instead of creating a search through the api and walking a ladder of up to six requests, the query is written into the url and the site runs it: instant, no trade request spent, and the same code path as Price check.
- **Imports already saved are repaired once.** A one-time migration restores the base of the records that were stored with "Elder Item" / "Warlord Item" (and similar) as their base, and trims the record name that had it glued on.
- **PoE 1 exports carry no item level**, so none is invented: the search simply does not filter on it.

### Fixed — upgrade / downgrade badge
- **The reference build is now the build of the page's own game.** The badge used the most recently updated build of either game, so a PoE 1 page could compare a listing against the PoE 2 build — and bases that exist in both ("Prismatic Ring") made that a wrong comparison instead of no comparison.

### Verified offline (no trade requests)
- The influenced rare now imports as `base "Cord Belt"`, the unique as `name "The Taming" / base "Prismatic Ring"`.
- Ranges: four real lines canonicalise exactly like their single-number form.
- A PoE 2 import ("Utility Belt", 5 modifiers) builds `type + count(5, min 4)`; a PoE 1 import builds `type + and(3)`; a unique builds `term`.
- The repair migration fixed the 2 affected records in the profile and left uniques untouched.
- The gear reference returns the Templar build for `poe1` and the Sorceress build for `poe2`.

## 2.9.1

Second half of the split: the per-game data that was still sitting in shared files moved into the two profiles.

### Architecture
- **Currency fallback weights** (`item-utils.js`) live in each profile now. The old fallback line also let a PoE 1 price borrow the PoE 2 weight table for a currency its own table did not know; the game's own table is the only one consulted.
- **The mod-colour legend** (`content.js`) comes from the profile of the page's game.
- **The tier → currency ladder** moved out of `background.js` and out of `ptc-features.js` (it existed twice) into the profiles; the craft estimate takes the game and reads its own ladder.
- **The Craft of Exile import path** is a profile field (`coeDetailsImport`): PoE 1 opens the item by its own base id, PoE 2 goes through the paste importer. The panel and the viewer no longer test the game name for it.
- **The pages load the profiles**: the content script list in the manifest, `sidepanel.html` and `viewer.html` all load `ptc-poe1.js` / `ptc-poe2.js` right after `ptc-games.js`.

### Verified
- Same numbers as before the move: 2 divine is `400` in PoE 1 terms and `2` in PoE 2 terms; 3 chaos is `3` / `1.8072`; tier 3 and 6 pick `alt`/`exalted` for PoE 1 and `alch`/`vaal` for PoE 2.
- With the PoE 1 profile deleted, PoE 1 degrades (weights gone, ladder falls back to chaos) and PoE 2 returns identical numbers.
- Panel and viewer loaded in a real browser: both profiles present, six legend entries, 41 buttons, no page errors.
- 15 new assertions (171 in total) cover the new fields, the data that must differ, and the empty-profile fallback.

## 2.9.0

The two games now have their own code, instead of sharing one file full of "if PoE 1 … else PoE 2".

### Architecture
- **New `ptc-poe1.js` and `ptc-poe2.js`** — one profile per game, with exactly the same fields: which modifier arrays become trade filters, whether desecrated modifiers are filed as explicit stats, which stat domains are skipped, which modifier arrays the Craft of Exile import reads, the item-class → trade-category map, and the currency prices are shown in. The item-class category map moved out of `background.js` into the PoE 2 profile; the search filters and the Craft of Exile import now read the profile instead of testing the game name.
- **`PTC_GAMES.profile(game)` is the only place that picks a game's profile**, and it never throws: if one profile is missing or broken, that game degrades to an empty profile (no filters, no category, no currency) while the other game keeps working unchanged.
- **One branch removed on the trade page:** the `trade` / `trade2` path segment now comes from the game configuration instead of a test in `content.js`.
- **21 new regression tests** check that both profiles carry the same fields, that the values that must differ do differ, and that deleting the PoE 1 profile leaves PoE 2 untouched.

### Verified
Built the same search for both games before and after the move: PoE 1 gets `explicit` + `crafted` + `fractured` with implicit and desecrated ignored; PoE 2 gets `explicit` + `crafted` + desecrated-as-`explicit` with runes ignored; categories resolve for PoE 2 only. With the PoE 1 profile removed, PoE 1 returns no filters and PoE 2 is byte-identical.

## 2.8.17

### Changed
- **The saved item actions are in the order they are used:** Price check, Plan the craft, Watch listing, Seller profile, Delete. Copy item and Compare to build sit between Watch listing and Seller profile, and Delete stays last.

## 2.8.16

### Changed
- **"Craft this item" is now "Plan the craft"** — the action opens the item in Craft of Exile with its base, quality, item level and modifiers, which is a crafting plan rather than a craft. Renamed in the saved item panel, in the item viewer, in the permission warning, and in the privacy page.

## 2.8.15

### Changed
- **"How to craft this?" is now "Craft this item".** Same action, named like the buttons around it ("Price check", "Copy item"): it opens the item in Craft of Exile with its base, quality, item level and modifiers. Renamed in the saved item panel, in the item viewer, in the permission warning, and in the privacy page.

### Fixed
- **The privacy page described the Craft of Exile access as granted at install.** Since 2.8.13 the host permission is optional and requested on the first use, and the page now says so.

## 2.8.14

### Changed
- **"Find similar" is now "Price check".** That is what the action is for: it opens the trade search for the saved item — the item itself plus the listings that share its prefixes and suffixes — in the league it was listed in. Renamed in the saved item panel and in the item viewer.
- **The fuzzy filter box on the trade page is off by default.** It still exists for the times a local filter is handy (Settings → "Show a filter box on the trade page"), but a fresh profile no longer gets a floating box over the site. Profiles that only ever had the old default get it switched off once; turning it back on stays on.

## 2.8.13

An audit pass over the whole extension: static analysis, every file read end to end, the panel checked with axe, and a 12 second runtime profile of a live trade page (no long tasks, 23 DOM mutations, stable node count, no heap growth).

### Fixed — saved items and searches
- **Craft of Exile on a PoE 1 item always fell back to the paste importer.** The worker asked for a helper that only exists in the page scripts, so the call threw and the "details" import — the path that pins the base by its own id — never ran.
- **"Find similar" no longer opens the saved search after a failed build.** It says what failed; before, it quietly opened the price-only search that shows the whole market.
- **A failed "Search item" in the viewer now says so** instead of doing nothing.
- **Target price and expiry now save.** The three controls had no `name`, so the form handler read `undefined` and threw.
- **Price samples are read from the price line only.** The buttons the extension adds to that line ended up in the parsed text, so the market index silently skipped exactly the rows it decorates.
- **Value badges no longer follow the previous listing** when the site reuses a result row, and the filter highlights are rebuilt when the query changes.
- **Search ids are UTF-8**, so a query with an accented name stays readable by the site.
- **Wiki links for uniques open the unique**, not its base item.

### Fixed — watchers and alerts
- **A watcher edited or deleted while a check was running is no longer reverted.** The check writes only the fields it owns onto a fresh list, instead of writing back the snapshot it read minutes earlier. Same for search watches.
- **Search watches follow the watcher interval again.** A minutes/hours mix-up gated them at one hour while the alarm fired every five minutes.
- **Target prices use the rates of the watcher's own league**, not whichever league was cached first (which could be the other game).
- **Live tabs open in the watcher's league**, not the league of the last trade tab.
- **Desktop alerts respect the "watcher notifications" setting** for search watches too.
- **Saving a preset keeps the newest one** (it evicted it and kept the oldest).

### Fixed — data handling
- **Restoring a backup keeps your Discord webhook and ntfy topic** instead of blanking the secrets a backup never contains.
- **Importing a JSON backup no longer hangs** (it waited for a queue turn it already held).
- **The trade-site block survives the worker being stopped**, so a reload does not walk straight back into the same penalty.
- **Messages are size-checked** before any handler writes them to storage.
- **Icons are only accepted from poecdn.com** (`evilpoecdn.com` used to pass).
- **A `small` or `medium` text size survives updates** — the one-time migration ran on every update.
- **Rarity comes from the listing's frame type**, so the fair-price and scam checks stop comparing rares against uniques.
- **Craft of Exile keeps modifiers without a number** ("Cannot be Frozen") and keeps crafted / fractured / enchant flags on build imports.
- **Path of Building imports no longer append the variant marker to a unique's name** ("Abyssus (Current)" matched nothing), and a decompression bomb is refused above 32 MB.

### Fixed — panel and accessibility
- **The item viewer's search button is visible again.** It was created hidden and never shown, so that action did not exist.
- **The "Highlight matched stats" checkbox works.** Two controls shared its `name`, which turned the field into a radio list that ignored `.checked`; the stale duplicate row is gone.
- **Tabs are announced as the current section** (`aria-current` instead of `aria-selected` on a plain button), and the arrow keys move between them.
- **Sort and build filters have labels**, the filter row sits in a landmark, the item list is no longer a nested `main`, and the tool cards answer Enter and Space.
- **Two themes reach AA contrast:** `daylight` muted and danger text, `sand` accent.

## 2.8.12

The built search asked for rolls closer to the saved item than the market can offer.

### Changed
- **"Find similar" accepts rolls from 80% of the saved item's own roll, not 90%.** Measured on a five affix helmet in Covens: 90% found three listings (the item and two others), 80% found nine, while asking for one modifier fewer jumped to 119 unrelated helmets. The number of modifiers matched stays "all of them but one" — that is the strict part of the search; the threshold was only making the sample too small to read a price from.

## 2.8.11

A saved listing whose search only held a price showed the whole market instead of the item.

### Fixed
- **"Find similar" no longer opens an endless list of unrelated items.** The search a listing is saved with can be one the player ran with only a price filter set — it says nothing about the item, so opening it listed every item above that price (PoE 1: items from 3 div up, in any base). A saved search that does not constrain the item (no base, no name, no modifiers, no category) is now rebuilt from the item itself: its base type plus its own modifiers, in the league it was listed in.
- **Price-only filters no longer count as "the search finds something"** — only the market filters (price, sale type, indexed date) are ignored when checking a saved search; every filter that describes the item still keeps the saved search intact.

### Changed
- **"Search page" is now "Find similar"** in the saved item panel and in the item viewer ("Open search" when an item has no search of its own).

## 2.8.10

The saved item panel is tidier.

### Changed
- **Removed from the saved item:** "Open full view", "Craft cost", "Copy for CoE" and "Export JSON".
- **"How to craft this?" now sits with the actions, right before "Seller profile"** (it used to be in the Wiki row below them).

## 2.8.9

2.8.8 rebuilt the search of every saved listing, and the rebuilt search came back empty in both games.

### Fixed
- **"Search page" opens the saved search again.** The search a listing was saved from already is the search that found it — the item and the items that share its modifiers — so it is opened exactly as saved, instantly (2.8.8 replaced it with a rebuilt query and the page showed nothing).
- **A search is only rebuilt when the saved one is the site's default search** (status and no filters at all), which would otherwise list every item in the league. That built search now uses the item's own stat ids — the site ships them with every listing (`hash`) — so no modifier has to be guessed from its printed line.
- **The base type of a search is written into `type`, a unique into `term`** — measured from the urls the trade site writes itself, in both games. 2.8.8 wrote a PoE 2 base into `term`, which the site reads as an item name and answers with "No results found".
- The stats of a rebuilt search ask for all of an item's affixes but one, so the page shows the saved item next to the items that share its prefixes and suffixes (measured live: a PoE 1 ring → 5 rings, a PoE 2 boot → 30 boots).
- A unique item is searched by its name only, which is what the site itself writes for one.

## 2.8.8

The PoE 1 search showed every item of the base instead of the item's own modifiers.

### Fixed
- **PoE 1 "Search page" listed the whole base.** The stat filters of a saved search carry the ids of the patch the search was made in, and the trade site names every stat with an id that changes with every patch — after a league restart it does not know those ids any more, ignores the filters and lists every item of the base. The filters of the search are now rebuilt with the ids of the current patch, from the item's own modifiers, while the rest of the search (base, rarity, level, ...) is kept as the player left it. Measured on the live site: a Coral Ring with life, strength and accuracy opens on 145 rings that carry those modifiers.
- The table of stat ids is kept for two hours instead of a day, so a patch restart cannot leave the extension with ids the site no longer knows.

## 2.8.7

"Search page" opens the saved search again — the one the item was found in, with the item and the other items that carry the same modifiers.

### Fixed
- **"Search page" showed the wrong items.** The saved search was narrowed with the item's base, and the trade site reads that field as the *name* of a unique in PoE 1 — so the page came back empty or with something else entirely (measured on the live site). The saved search is now opened exactly as it was, instantly: the item and the other items with the same prefixes and suffixes, exactly as the search you used.
- **A listing saved from the site's default search** (the one with no filters at all, which lists every item of the league) now gets its own search instead: the base, the rarity and the item's own modifiers, written into the url. The site runs that query itself, so it opens at once — no "creating the search…" and no waiting for the api.

## 2.8.6

The "Search page" button goes back to opening the saved search instantly, and the PoE 1 Craft of Exile import brings every modifier along.

### Fixed
- **"Search page" built a new search instead of opening the saved one** — the button became a slow, network-bound "creating the search…" that showed other items. A saved item opens the search it was saved from again, instantly, with the item in its results (both games). The saved search keeps its own filters; when it does not name the item, the item is added to it — the query id of a search is a compressed copy of the query, so this happens locally, with no request, and the site does the searching itself. The trade site keeps that in "term" (the base type, or the name of a unique), which is the field its own links use. The un-narrowed search stays available as the "Original search" row.
- **Craft of Exile dropped PoE 1 modifiers whose wording the site writes with alternatives** ("[Resistances|Cold Resistance]" on the site, "Cold Resistance" on the item), so those items imported without their affixes. Both wordings are matched now, and the modifiers are taken from the pool of the item's own class — a weapon's "increased Spell Damage" no longer lands on a ring.

## 2.8.5

The league list stayed stale across a PoE 1 restart, so the new league (Covens) did not appear in the picker.

### Fixed
- **A new league did not show up in the league list after the PoE 1 restart.** During the restart the trade site's PC league list is empty, the refresh failed, and the last successfully fetched list (without the new league) stayed cached for up to 6 hours. The cache now expires after 30 minutes instead of 6, and it is refreshed immediately when the player is trading in a league the cached list does not know. The "Refresh league list" button in Settings still forces an update on demand. Once the list refreshes, automatic league detection picks Covens as the PoE 1 league on its own (permanent modes are never mistaken for a new league).

## 2.8.4

Fixes the PoE 1 Craft of Exile import, which failed with an error per affix.

### Fixed
- **PoE 1 items imported into Craft of Exile onto the wrong base item** (for example a Coral Ring imported as a Cerulean Ring), with the site then rejecting every affix of the wrong item one by one. The paste importer the extension used resolves the base by name on the Craft of Exile site, and for PoE 1 it can pick a different item of the same class. Saved PoE 1 items now open the Craft of Exile "details" URL instead: the base is pinned by its internal id and the affixes are attached through the site's own modifier keys, so the item lands exactly on its own base. Verified on the live site: base and every affix import without errors.
- **Craft of Exile "details" payloads lost the PoE 1 modifiers** — the API stores the modifier wording in a different field than PoE 2, and the payload read only the PoE 2 one. Both fields are read now, and the socket count is kept from the "R-G-B" string of saved listings.
- PoE 2 is unchanged: it keeps the paste import that already worked.

## 2.8.3

Follow-up to the 2.8.2 saved-search fix: the check for "is the saved search worth opening as-is" was still too loose.

### Fixed
- **Saved items whose saved search was not pinned to the item's base** (a stats-only search, a category search, or any search without a base type) opened a page listing every base in the league, which looked like random items. A saved search is now only opened directly when it is actually pinned to the item itself — its base type, or its name for uniques. In every other case the button builds the search for the item (base, rarity, level and its own modifiers, in the item's league) — exactly the behavior PoE 2 already had. The original search page is still visible as a secondary "Original search" link when it is not the primary button.

## 2.8.2

A correction release after live feedback: the 2.8.1 search button was too eager and one of its helpers was not requested.

### Fixed
- **"Open trade search" rebuilt the search for every item** — a slow, network-bound operation that listed similar items instead of the one on screen. Saved items go back to the original behavior: the button is the search the item was saved from, opened **instantly**, with the item in its results. A new search is built only when there is nothing better to open: build imports (no saved search of their own) and listings saved from the site's default filterless search — the exact case that produced the "random items" reports.
- **Craft of Exile paste lost the affixes of some PoE 1 items.** The paste relied on the mod capture made on the trade page; when that capture was empty the item imported with no affixes. The paste now falls back to the trade API's own modifier data (same wording, tier and roll range). The page capture still wins whenever it has anything, so PoE 2 pastes are byte-identical to before.

### Reverted
- The 2.8.1 "longest match" base-name fallback is gone. When two real bases could fit one item name ("…Quicksilver Flask…" contains both "Quicksilver Flask" and "Silver Flask"), the resolver refuses to guess, as it did before — a search for the wrong base is worse than no search.

### Notes
- When **Covens of Umbra** appears in the trade site's league list after the restart, automatic league detection picks it as the PoE 1 league on its own — the permanent modes (Standard, Hardcore, Ruthless, Hardcore Ruthless) are never mistaken for a new league. To force it while the list is still rebuilding, type "Covens of Umbra" in the fallback league field in Settings, or choose it in the header picker as soon as it shows up.

## 2.8.1

A follow-up to the dual-game release, from the first live PoE 1 testing round.

### Fixed
- **"Search page" opened the wrong search on saved items.** The button re-opened the search that happened to be on screen when the item was saved. The trade site opens on a default search that lists *every* securable item in the league, so from that page the button showed random items instead of the saved one. The button is now **"Open trade search"**: it builds a search for the item itself — base type, rarity, level and its own modifiers, in the league the item was listed in — and opens that. The search it lands on is the item, or the closest similar listing, never an unrelated pile. The original search page is kept as a secondary **"Original search"** link in the item details. The item viewer got the same treatment ("Search item" button, "Original search" link).
- **Variant-prefixed base types no longer fail to resolve.** A name like "Perpetual Quicksilver Flask of Staunching" contains *two* real bases ("Quicksilver Flask" and "Silver Flask"), so the old resolver refused to guess. It now takes the longest unique match, which is the actual base; a tie between two equally long names is still refused.

### New
- **League picker in the header.** The league is now one click away, next to the PoE 1 / PoE 2 switcher, instead of hidden in Settings. It edits the same per-game league setting as the Settings field (the two always stay in sync), shows every league of the active game with the hardcore ones marked, and keeps a choice that is no longer in the fetched list visible as "(not in list)". "Auto league" restores the automatic detection.

### Notes
- During league launch (server restarts) the trade API can answer 502/503 briefly. Searches created in that window fall back to the plain league page with the base type pre-filled, so a click never dead-ends. When the new league appears in the trade site's league list, automatic detection picks it up on its own — the permanent modes (Standard, Hardcore, Ruthless, Hardcore Ruthless) are never mistaken for it.

## 2.8.0

**Path of Exile 1 is here.** The extension now speaks both games, and a switcher in the side panel header decides which one you are looking at. Everything you save, watch, build or search stays in its own game — the two collections never mix. PoE 2 keeps working exactly as before.

### New: a game switcher
- **PoE 1 / PoE 2** in the side panel header. Switching changes the whole context: the items, builds, watchers, searches and history you see, the league list, and the trade searches that are opened.
- PoE 2 stays the default, so nothing changes for anyone who only plays PoE 2.

### New: a league selector for each game
- The league list comes from the trade site's own API, per game: `/api/trade/data/leagues` for PoE 1, `/api/trade2/data/leagues` for PoE 2.
- **Smart auto-detect** — the current challenge league is picked automatically. The permanent modes are never mistaken for it: Standard and Hardcore for PoE 2, and Standard, Hardcore, Ruthless and Hardcore Ruthless for PoE 1. While no challenge league is live the extension falls back to Standard instead of Ruthless.
- **Manual override** — every league of the list can be chosen by hand, with a Hardcore toggle. The list is refreshed on demand, so a league that appears on launch day shows up without waiting.
- The league of the trade tab that is open right now always wins over the remembered one, so a search never lands in the wrong league.

### New: Path of Exile 1 support
- **The trade page widget works on pathofexile.com/trade** — the same action bar (Save, Watch, Copy for Discord), the same value badge, the same meta row, the same fuzzy filter and the same mod colour legend. PoE 1 and PoE 2 use the very same markup, so both games behave identically.
- **Prices in the currency of the game** — poe.ninja is read per game: divine orbs for PoE 2, chaos orbs for PoE 1. Conversions, the value score and the crafting-cost estimate follow.
- **Craft of Exile for PoE 1** — the Craft of Exile beta site serves both games; the extension now asks for the PoE 1 data files and resolves affix names, prefix/suffix type and tier from them.
- **PoE 1 mods** — implicit, crafted, fractured, enchanted, veiled, scourge and delve modifiers are all read, coloured and labelled.
- **Wiki links** now point at the right wiki: poewiki.net and poedb.tw for PoE 1, poe2wiki.net and poe2db.tw for PoE 2.

### New: Path of Building 1 builds
- The **POB Build** tab now reads a **Path of Building 1** build code as well as a Path of Building 2 one — the importer recognises the format on its own, so there is nothing to choose.
- The gear is imported exactly the way PoE 2 gear is: the same item view, the same trade search with the item's modifiers as filters, the same Craft of Exile paste, and the same upgrade badge against the build.
- PoE 1 rarities keep their name and their base type apart, sockets keep their colours, crafted and fractured modifiers are recognised, and variants (talismans) are resolved.
- The **ascendancy picker** now knows the seven Path of Exile 1 classes with their ascendancies, plus the Bloodlines that any class can take instead.

### Changed
- **The extension is called “Poe Trade Watcher”** now — it is no longer only about Path of Exile 2.
- The Settings button in the header now **toggles**: press it once to open the settings, press it again to go back to where you were.
- The **search filter highlights the modifiers** of the matching rows, and searches the item name as well as the price.
- The mod colour legend follows the game you are on: PoE 1 has veiled and enchant instead of desecrated and rune.

### Removed
- **“Pin” is gone.** The widget and the side panel both had a pin list next to Save and Watch, which was one list too many. Saved items and watched items already cover it, so the whole feature — the button, the list, the storage and the backup format — was taken out.

### Fixes
- The build importer read the “Crafted: true” line of an item with a pattern that could never match, so a crafted item was not recognised as crafted.
- The upgrade / sidegrade / downgrade badge could not find the item's base type, because it looked for a class the trade site does not use any more.

## 2.7.2

A big update. The headline is a brand-new **Build import**: paste a build from Path of Building 2, pobb.in or Mobalytics and every piece of your equipped gear becomes a first-class item — searchable on the trade site and craftable in Craft of Exile, exactly like something you saved by hand. The whole UI was redesigned at the same time.

### New: Build import (Path of Building 2)
Paste a build code in the **POB Build** tab and import your gear as a build.
- **Import from anywhere** — Path of Building 2, pobb.in, or Mobalytics ("Share your Build"). Only equipped gear is imported; flasks and gems are skipped.
- **Preview before you commit** — see every item (slot, name, base, ilvl, rarity) and pick which ones to bring in, into a new build or an existing one. A **Clear list** button empties the panel for the next build.
- **Imported gear behaves exactly like saved gear:**
  - Full item view and the same action bar as anything you saved.
  - **Open trade search** — a live search built from the item's own modifiers (prefix/suffix stats), opened in *your current league*.
  - **How to craft** — a Craft of Exile import with the correct affix names, prefix/suffix type and tier, resolved from the site's own data.
  - **Upgrade / Sidegrade / Downgrade badge** on the trade page and **Compare to build** in the side panel, both measured against the matching slot in your imported build (life, energy shield, resistances).

### New: redesigned interface & themes
- A full visual redesign across the side panel, the trade page widget, the item viewer and the privacy page.
- **Seven colour themes** plus *match system*: Auto, Midnight, Graphite, Ember, Forest, Daylight, Sand.
- Adjustable **text size**.
- The original golden bookmark icons are back.
- A **Ko-fi** support link for the author.

### New: on the trade page
- **Copy for Discord now sends straight to your channel.** If you have a Discord webhook in Settings, the item is posted directly as a message with its icon — no pasting. With no webhook set it tells you to add one and still copies the message to the clipboard; if Discord refuses, it falls back to the clipboard so nothing is lost.
- Per-row action bar: **Save, Watch, Pin, Discord, CoE**.
- **Estimated value badge** (price per quality, in chaos orbs — lower is better) and an optional re-order of the whole page by value score, using live poe.ninja rates.
- **"new" badge** for items listed in the last 5 minutes.
- **Item meta row**: ilvl, quality, verified seller, online status, stash tab/position and fee without opening the popup.
- **Filter box** with fuzzy search that **highlights the matching stats** inside the rows.
- **Mod colour legend** for explicit / crafted / fractured / desecrated / rune / implicit mods.
- **API/DOM mismatch warning** when the page shows stale data that disagrees with the trade API.
- **Seller blacklist** (hide rows) and optional **seller alerts** when a followed IGN lists something.
- **Expired search banner** with one-click "open a fresh search".
- The in-page price conversion was removed — the official trade page already shows the price.

### New: side panel
- **Items** — everything saved, with price, seller, league and a **price history chart** (trend, per-point values, mixed-currency aware), listing link, wiki links and a saved-item viewer.
- **Fair price & bait warnings** — a local price index from the listings you have seen flags prices far below (often price-mining bait) or far above the market.
- **Crafting cost** — an estimate of what it would cost to craft the item yourself (Craft of Exile affix tiers + live currency), so you can see whether buying is cheaper than crafting.
- **Watchers** — re-check the trade API on your interval and alert on price change, sold, or target reached.
- **Pinned** — quick access to the items you are deciding on.
- **Searches** — history, saved filters, live searches and **watched searches**: watch a whole search and get a message when a new listing appears, optionally only below a budget in divine orbs. A watched search is re-run by the extension on its own, so the trade tab does not have to stay open.
- **Settings** — theme, text size, league (auto-detected or manual, with a Hardcore toggle), price display, display toggles, blacklist & seller alerts, watcher interval and notification channels.

### New: watched searches without an open tab
Watched searches now keep working while the trade tab is closed — the extension re-runs them on its own schedule.

### Notifications
- Chrome **desktop notifications** for sales, price changes, target prices and new listings in watched searches.
- **Discord webhook** and **ntfy** for the same alerts.
- **Seller alerts** (local toast + notification) when a followed seller lists an item.

### Craft of Exile
- **Copy for CoE** — one click turns any item into a Craft of Exile paste string (explicit, crafted and fractured mods, optionally desecrated).
- **How to craft / COE import link** — jump to a pre-filled import.
- The Craft of Exile data is now fetched reliably (no more CORS errors), and imported items get their affix names, prefix/suffix and tier resolved from the site's own data.

### Trade search — faster and in the right league
- Searches now open in **your league**, never silently in Standard.
- A smarter search ladder starts at the step that has a real chance of matching, so results come back faster.
- Fixed "the search is no longer valid" (the query id was being truncated) and "Could not find a valid affix" in Craft of Exile.
- A **global rate-limit guard**: if the trade site asks you to wait, every trade request pauses and the UI tells you how long, instead of hammering the API.
- A "Creating the trade search…" progress indicator while a search is being built.

### Price tracking
- Per-item **price history** with a built-in SVG chart.
- Live **Divine/Exalted ratios** from poe.ninja for conversions and value scoring.

### Privacy & your data
- Everything is stored **locally** in your browser profile. No servers, no accounts, no telemetry, no trackers.
- **Backup & restore** — export your items, watchers, builds, search history and settings to a JSON file and import them on any machine.
- **Optional Chrome Sync** for settings only. Saved items, builds and watchers are never synced.
- Your Discord webhook and ntfy topic are never sent anywhere except to the services themselves.

### Fixes
- Copy for Discord failed with "displayName is not defined" — fixed.
- Craft of Exile data failed to load (CORS) — fixed.
- Watched-search max-price filter did not work — fixed.
