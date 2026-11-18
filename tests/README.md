# Tests

Regression tests for the PoE 1 / PoE 2 split.

```
node tests/run-tests.js
```

Node 18 or newer, nothing else to install — the extension's own files are
loaded straight from the parent folder.

## What is covered

- **The per-game configuration** (`ptc-games.js`) — API roots, realms, league
  endpoints, economy endpoints, Craft of Exile game, trade URLs of both games,
  and the permanent leagues that must never be mistaken for a challenge league.
- **The settings schema** (`ptc-settings.js`) — the per-game league settings,
  and that an install which only knew PoE 2 keeps its league after the split.
- **The ascendancy classes** (`ascendancies.js`) — the seven Path of Exile 1
  classes with their ascendancies and the Bloodlines, next to the Path of
  Exile 2 classes.
- **The build importer** (`pob-import.js`) — the real Path of Building 2 build
  code in `poze promo/mobalyticscode.txt` has to produce exactly the same
  result as the 2.7.2 importer in `backup/`, and the two Path of Building 1
  builds in this folder have to be read correctly: base types, socket colours,
  implicit and explicit modifiers, crafted modifiers, corrupted items and the
  equipped loadout.

## The fixtures

- `mobalyticscode.txt` — a Path of Building 2 build, exported from Mobalytics
  ("Share your Build"). It lives in `poze promo/` because it was already part
  of the project.
- `OccVortex.xml` — a Path of Building 1 build from Path of Building's own
  test data (`spec/TestBuilds/3.13/OccVortex.xml`).
- `jugg_tectonic.xml` — a Path of Building 1 build from the poediscordbot
  project (`tests/in/jugg_tectonic.xml`).

The two XML files are read as they are and turned into a build code in memory
(zlib + base64url), so the tests exercise the real decoder.
