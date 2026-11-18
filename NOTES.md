# Chrome Web Store notes (not shipped)

Working notes for the store dashboard. This file is not part of the packaged
extension.

## Permission justifications

- **`unlimitedStorage`** — the extension stores up to 2,000 saved items (each
  with its full modifier list, icon URL and price history), up to 200 builds with
  their imported gear, up to 300 watchers and a cache of item artwork. Chrome's
  default quota for `chrome.storage.local` (10 MB) is exhausted by a normal
  collection, and a full collection would silently stop saving.
- **`offscreen`** — plays a short two-tone alert when a watched listing's price
  changes. A service worker cannot use Web Audio, so an offscreen document with
  reason `AUDIO_PLAYBACK` is created on demand, plays two brief tones and closes
  itself. Nothing is rendered or read there, no data is stored, and it runs only
  while the user has the sound switch on (at most once every 5 seconds).
- **`notifications`** — desktop notification when a watched listing is sold,
  changes price, reaches the target price, or a whitelisted seller lists an item.
- **`alarms`** — re-checks the watched listings at the interval the user chooses
  (1–60 minutes).
- **`storage`** — keeps saved items, builds, watchers and settings locally.
- **`scripting`** — only for "Read page": reads the Mobalytics build tab the user
  has open and explicitly asks the extension to read. The optional host
  permission is requested at that click.
- **`sidePanel`** — the whole interface is a side panel.

## Open item

- `privacy.html` still carries the placeholder `privacy@example.com` until the
  real contact address is supplied.
