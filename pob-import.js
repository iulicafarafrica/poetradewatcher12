/*
 * pob-import.js — shared importer for Path of Building build codes.
 *
 * A "build code" (Mobalytics "Share your Build", Path of Building "Share",
 * pobb.in, etc.) is: base64url( zlib-deflate( XML ) ). Both games use the very
 * same container format and differ only in the root element and in a few
 * details of the item text:
 *
 *   PoE 2   <PathOfBuilding2>   sockets "S S S"      (S = rune socket)
 *   PoE 1   <PathOfBuilding>    sockets "R-R-R-B-B-R" (R/G/B/W/A colours)
 *
 * Gear lives in the <Items> section as <Item id="n"> blocks whose body is plain
 * item-text lines ("Rarity: RARE", name, base type, "Item Level: n", "Quality:
 * n", "Sockets: …", "Implicits: n", then the modifier lines — optionally
 * prefixed with {crafted}/{fractured}/{enchant}/{scourge}/{prefix}/{suffix}/
 * {tags:…}/{range:…}/{variant:…} tags). The equipped loadout is the ItemSet
 * referenced by <Items activeItemSet="n">: each <Slot itemId="n" name="…"/>
 * names an Item id and its slot (Weapon 1, Helmet, …, Flask 1, …).
 *
 * The order of the attributes inside <Item>, <Slot> and <ItemSet> is not the
 * same in the two games nor between Path of Building versions (PoE 2 sorts
 * them alphabetically, PoE 1 does not), so every attribute is looked up by
 * name instead of by position.
 *
 * Used by the side panel (POB Build tab): paste code -> preview -> import.
 * Exposes window.POB_IMPORT = { decodeCode, parseCode, parseBuildXml, detectGame }.
 * Requires window.pako (pako.min.js, v2 sync APIs).
 */
(function (global) {
  'use strict';

  const B64_MAP = (() => {
    const map = {};
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach((ch, index) => {
      map[ch] = index;
    });
    map['-'] = 62; // base64url
    map['_'] = 63; // base64url
    return map;
  })();

  function base64UrlToBytes(value) {
    const chars = String(value).replace(/\s+/g, '');
    if (!chars) return null;
    const out = [];
    let bits = 0;
    let bitCount = 0;
    for (let i = 0; i < chars.length; i += 1) {
      if (chars[i] === '=') continue;
      const symbol = B64_MAP[chars[i]];
      if (symbol == null) throw new Error('Invalid build code character: ' + chars[i]);
      bits = (bits << 6) | symbol;
      bitCount += 6;
      if (bitCount >= 8) {
        bitCount -= 8;
        out.push((bits >> bitCount) & 255);
      }
    }
    return out.length ? out : null;
  }

  const MAX_CODE_CHARS = 400000;
  const MAX_INFLATED_BYTES = 32 * 1024 * 1024;

  /*
   * One wrapper of the stream, inflated in chunks. A build code from the
   * internet can be a decompression bomb: the output is counted as it arrives
   * and the moment it passes the ceiling the stream is aborted, so the 32 MB
   * limit is a ceiling on memory, not a check after the fact.
   */
  function inflateWithWindow(bytes, windowBits) {
    const pako = global.pako;
    if (!pako || typeof pako.Inflate !== 'function') {
      throw new Error('Decompression is unavailable.');
    }
    const inflator = new pako.Inflate({ windowBits: windowBits, chunkSize: 64 * 1024 });
    const chunks = [];
    let total = 0;
    inflator.onData = (chunk) => {
      total += chunk.length;
      if (total > MAX_INFLATED_BYTES) {
        const tooLarge = new Error('Build code is too large.');
        tooLarge.tooLarge = true;
        throw tooLarge;
      }
      chunks.push(chunk);
    };
    inflator.push(bytes, true);
    if (inflator.err) {
      const failed = new Error('Could not decompress the build code.');
      failed.wrapper = true;
      throw failed;
    }
    if (!chunks.length) return null;
    const out = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
      out.set(chunk, offset);
      offset += chunk.length;
    });
    return out;
  }

  function inflateBytes(bytes) {
    /* zlib, raw deflate, gzip - the three wrappers a build code may use. */
    const attempts = [15, -15, 31];
    for (let i = 0; i < attempts.length; i += 1) {
      try {
        const result = inflateWithWindow(bytes, attempts[i]);
        if (result && result.length) return result;
      } catch (error) {
        /* A size problem is not a wrapper problem: do not try another one. */
        if (error && error.tooLarge) throw error;
      }
    }
    throw new Error('Could not decompress the build code.');
  }

  function decodeXmlEntities(text) {
    return String(text)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (match, num) => {
        try { return String.fromCodePoint(Number(num)); } catch (error) { return ''; }
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (match, num) => {
        try { return String.fromCodePoint(parseInt(num, 16)); } catch (error) { return ''; }
      });
  }

  /* Reads every attribute of one tag into an object. The order in which the
     attributes appear is irrelevant, which is what makes the same parser work
     for Path of Building 1 and Path of Building 2. */
  function readAttributes(body) {
    const out = {};
    const re = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
    let match = null;
    while ((match = re.exec(String(body || ''))) !== null) {
      out[match[1]] = decodeXmlEntities(match[2]);
    }
    return out;
  }

  function readAttr(body, name) {
    const attrs = readAttributes(body);
    return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : '';
  }

  function cleanLine(line) {
    return decodeXmlEntities(line).replace(/\s+/g, ' ').trim();
  }

  /* ------------------------------------------------------------------ */
  /* Game profiles                                                       */
  /* ------------------------------------------------------------------ */

  /*
   * Every line of an item text that is NOT the item's name or base type.
   * The list is the union of both games' lines: a line that only one game
   * writes simply never shows up in the other one, so the shared parser
   * stays identical for both.
   */
  const METADATA_LINE = /^(?:Rarity:|New Item$|Item Class:|Unique ID:|Item Level:|Quality:|Sockets:|Rune:|LevelReq:|League:|Radius:|Limited to:|Crafted:|Implicits:|Variant:|Selected Variant:|Selected Variant Group:|Selected Version:|Version:|Has Alt Variant:|Selected Alt Variant|Allow Duplicate Variants:|Corrupted$|Sanctified$|Prefix:|Suffix:|Catalyst:|CatalystQuality:|Talisman Tier:|Memory Strands:|Cluster Jewel Skill:|Cluster Jewel Node Count:|Unreleased:|Requires Class|Armour:|Evasion:|Energy Shield:|Runic Ward:|Ward:|Intangibility:|Charm Slots:|Spirit:|Split$|Mirrored$|Fractured Item$|Unidentified$|Foil Unique|<ModRange|-{4,}$)/i;

  const PROPERTY_LINE = /^[A-Za-z][A-Za-z ]*:\s*[0-9]/;

  /*
   * Path of Building puts the item's influence on a line of its own, between the
   * name and the metadata ("Cord Belt" / "Elder Item"). It is not a base type:
   * reading it as one sent "Elder Item" to the trade search and to Craft of
   * Exile, neither of which knows such a base.
   */
  const INFLUENCE_LINE = /^(?:Elder|Shaper|Warlord|Crusader|Hunter|Redeemer|Synthesised|Searing Exarch|Eater of Worlds) Item$/i;

  /*
   * The tag in front of a modifier line says which domain it belongs to.
   * PoE 2 knows desecrated and rune mods, PoE 1 knows scourge, crucible and
   * the eater / exarch / synthesis mods - a build only ever uses the ones of
   * its own game, so one table serves both.
   */
  const MOD_TAGS = {
    desecrated: 'desecrated',
    fractured: 'fractured',
    crafted: 'crafted',
    enchant: 'enchant',
    rune: 'rune',
    scourge: 'scourge',
    crucible: 'crucible',
    mutated: 'mutated',
  };

  function detectGame(xmlText) {
    const head = String(xmlText || '').slice(0, 200);
    if (head.indexOf('<PathOfBuilding2') !== -1 || head.indexOf('<pathofbuilding2') !== -1) return 'poe2';
    if (head.indexOf('<PathOfBuilding') !== -1 || head.indexOf('<pathofbuilding') !== -1) return 'poe1';
    return '';
  }

  /* ------------------------------------------------------------------ */
  /* Item text                                                           */
  /* ------------------------------------------------------------------ */

  // Splits a leading "{tag}{tag}…" run off a mod line. Tag values of interest:
  // crafted, desecrated, fractured, enchant, rune, scourge, crucible, prefix,
  // suffix, tags:…, range:…, variant:…
  function parseTagTokens(line) {
    const tokens = { variant: null };
    let rest = line;
    for (;;) {
      const match = /^({([^}]*?)})(.*)$/s.exec(rest);
      if (!match) break;
      const tag = match[2];
      const low = tag.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(MOD_TAGS, low)) {
        tokens[MOD_TAGS[low]] = true;
      } else if (low === 'prefix') {
        tokens.prefix = true;
      } else if (low === 'suffix') {
        tokens.suffix = true;
      } else if (low.indexOf('variant:') === 0) {
        const nums = tag.slice(8).split(',').map((part) => Number(part.trim()));
        tokens.variant = nums.filter((num) => Number.isFinite(num));
      }
      // tags:… and range:… carry no domain information; skip them.
      rest = match[3];
    }
    return { tokens, rest: rest.trim() };
  }

  function modKind(tokens) {
    if (tokens.desecrated) return 'desecrated';
    if (tokens.fractured) return 'fractured';
    if (tokens.crafted) return 'crafted';
    if (tokens.enchant) return tokens.rune ? 'rune' : 'enchant';
    if (tokens.rune) return 'rune';
    if (tokens.scourge) return 'scourge';
    if (tokens.crucible) return 'crucible';
    if (tokens.mutated) return 'mutated';
    return 'explicit';
  }

  /*
   * PoE 2 writes "Sockets: S S S" (S = rune socket, the letters stand for the
   * colours). PoE 1 writes "Sockets: R-R-R-B-B-R", where a dash links two
   * sockets of the same group and a space starts a new group.
   */
  function parseSockets(raw, game) {
    const out = [];
    if (!raw) return out;
    if (game === 'poe1') {
      String(raw).split(/\s+/).forEach((group) => {
        group.split('-').forEach((letter) => {
          if (!letter) return;
          const up = letter.toUpperCase();
          if (!/[RGBWA]/.test(up)) return;
          out.push({ sColour: up });
        });
      });
      return out;
    }
    String(raw).split(/\s+/).forEach((letter) => {
      if (!letter) return;
      const up = letter.toUpperCase();
      out.push(up === 'S' ? { type: 'rune' } : { sColour: up });
    });
    return out;
  }

  function parseItemBlock(block, game) {
    const inner = block.replace(/^<Item[^>]*>/, '').replace(/<\/Item>$/, '');
    const lines = inner
      .split(/\r?\n/)
      .map((line) => line.replace(/\s*<ModRange[^>]*\/>\s*$/, '').trim())
      .filter((line) => line && !/^<ModRange/.test(line));

    const rarityIndex = lines.findIndex((line) => /^Rarity:/i.test(line));
    if (rarityIndex < 0) return null;
    let rarity = lines[rarityIndex].replace(/^Rarity:\s*/i, '').trim();
    rarity = rarity.charAt(0).toUpperCase() + rarity.slice(1).toLowerCase();
    if (!['Normal', 'Magic', 'Rare', 'Unique'].includes(rarity)) rarity = 'Rare';

    // Name + base type: the plain lines right after "Rarity:" ("New Item" is
    // skipped, influence tags are not a base). Some items (charms, flasks) have
    // no base-type line at all, and an influenced rare has only its name.
    const header = [];
    for (let i = rarityIndex + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === 'New Item' || INFLUENCE_LINE.test(line)) continue;
      if (METADATA_LINE.test(line) || PROPERTY_LINE.test(line)) break;
      header.push(line);
      if (header.length >= 2) break;
    }
    const name = header[0] || '';
    const baseType = header[1] || header[0] || '';
    if (!name) return null;

    const field = (pattern) => {
      const line = lines.find((entry) => pattern.test(entry));
      if (!line) return null;
      return line.replace(pattern, '').trim();
    };
    const ilvlRaw = field(/^Item Level:/i);
    const qualityRaw = field(/^Quality:/i);
    const levelReqRaw = field(/^LevelReq:/i);
    const socketsRaw = field(/^Sockets:/i);
    const league = cleanLine(field(/^League:/i) || '');
    const uniqueId = cleanLine(field(/^Unique ID:/i) || '');
    const radius = cleanLine(field(/^Radius:/i) || '');
    /* "Crafted: true" is a line of its own, so it has to be looked for line by
       line - a ^…$ test against the whole item text would never match. */
    const craftedFlag = lines.some((line) => /^Crafted:\s*true$/i.test(line));
    const corrupted = lines.some((line) => /^Corrupted$/i.test(line));
    const sanctified = lines.some((line) => /^Sanctified$/i.test(line));

    // Talisman variants: "Variant: X" lines + "Selected Variant: n".
    const variants = [];
    let selectedVariant = null;
    lines.forEach((line) => {
      if (/^Variant:/i.test(line)) variants.push(cleanLine(line.replace(/^Variant:\s*/i, '')));
      const selected = /^Selected Variant:\s*(\d+)/i.exec(line);
      if (selected) selectedVariant = Number(selected[1]);
    });
    /* PoB lists legacy versions of the same unique and the selected one is
       usually "Current"; appending it produced names the trade site does not
       know ("Abyssus (Current)") and the search matched nothing. */
    if (selectedVariant != null && selectedVariant >= 1 && selectedVariant <= variants.length) {
      const variant = variants[selectedVariant - 1];
      if (variant && !/^current$/i.test(variant)) name = name + ' (' + variant + ')';
    }

    const properties = [];
    const requirements = [];
    const sockets = parseSockets(socketsRaw, game);
    const runes = [];

    const quality = qualityRaw != null && Number.isFinite(Number(qualityRaw)) ? Number(qualityRaw) : null;
    const ilvl = ilvlRaw != null && Number.isFinite(Number(ilvlRaw)) ? Number(ilvlRaw) : null;
    const levelReq = levelReqRaw != null && Number.isFinite(Number(levelReqRaw)) ? Number(levelReqRaw) : null;
    if (levelReq != null) requirements.push({ name: 'Level', values: [[String(levelReq), 0]] });
    if (quality != null && quality > 0) properties.push({ name: 'Quality', values: [[quality + '% increased', 0]] });

    // Rune sockets: "Rune: Name" lines ("Rune: None" = empty).
    lines.forEach((line) => {
      if (!/^Rune:/i.test(line)) return;
      const value = cleanLine(line.replace(/^Rune:\s*/i, ''));
      if (value && !/^None$/i.test(value)) runes.push(value);
    });

    // Everything after "Implicits: N" is a modifier line; the first N are implicit.
    const implicitsIndex = lines.findIndex((line) => /^Implicits:\s*\d+/i.test(line));
    const implicitCount = implicitsIndex >= 0 ? Number(lines[implicitsIndex].replace(/^Implicits:\s*/i, '')) : 0;
    const mods = [];
    for (let i = implicitsIndex + 1; i < lines.length; i += 1) {
      const raw = lines[i];
      if (/^Corrupted$/i.test(raw) || /^Sanctified$/i.test(raw)) continue;
      const { tokens, rest } = parseTagTokens(raw);
      if (!rest) continue;
      // Variant-filtered mods (talisman): keep only the selected variant's line.
      if (selectedVariant != null && tokens.variant && tokens.variant.length) {
        if (tokens.variant.indexOf(selectedVariant) === -1) continue;
      }
      mods.push({ kind: modKind(tokens), text: cleanLine(rest), type: tokens.prefix ? 'prefix' : (tokens.suffix ? 'suffix' : '') });
    }
    // The exporter declares how many implicit mods there are (Implicits: N) and
    // lists them first. A tagged line (rune/enchant) can sit in those first slots
    // too — a rune effect is not an implicit — so only UNTAGGED lines in the first
    // N positions become implicit; a tagged one keeps its real group. Exact text
    // duplicates (some exporters repeat a line) are shown only once.
    const implicitMods = [];
    const otherMods = [];
    const seenTexts = new Set();
    mods.forEach((mod, index) => {
      const textKey = mod.text.toLowerCase();
      if (seenTexts.has(textKey)) return;
      seenTexts.add(textKey);
      const tagged = mod.kind !== 'explicit';
      if (index < implicitCount && !tagged) {
        implicitMods.push(mod.text);
      } else {
        otherMods.push(mod);
      }
    });

    return {
      name: cleanLine(name),
      baseType: cleanLine(baseType),
      rarity,
      uniqueId,
      ilvl,
      levelReq,
      quality,
      league,
      radius,
      sockets,
      runes,
      properties,
      requirements,
      mods: otherMods,
      implicitMods,
      corrupted,
      sanctified,
      crafted: craftedFlag || mods.some((mod) => mod.kind === 'crafted'),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Build XML                                                           */
  /* ------------------------------------------------------------------ */

  function extractItemBlocks(xml) {
    const blocks = new Map();
    const itemRe = /<Item\s+([^>]*?)>([\s\S]*?)<\/Item>/g;
    let match = null;
    while ((match = itemRe.exec(xml)) !== null) {
      const attrs = readAttributes(match[1]);
      const id = attrs.id;
      if (!id || blocks.has(id)) continue;
      blocks.set(id, { attrs, body: match[2] });
    }
    return blocks;
  }

  /*
   * The equipped loadout: <Items activeItemSet="n"> points at the ItemSet that is
   * actually equipped; its <Slot itemId="n" name="…"/> entries reference the Item
   * ids. Path of Building 1 also wrote the slots directly under <Items> in older
   * versions, so both places are read. Flask slots are not gear, so they are
   * skipped.
   */
  function extractActiveSlots(xml) {
    const itemsTag = /<Items\b[^>]*>/.exec(xml);
    if (!itemsTag) return [];
    const activeId = readAttr(itemsTag[0], 'activeItemSet') || '';

    const collect = (body) => {
      const slots = [];
      const slotRe = /<Slot\s+([^>]*?)\/?>/g;
      let slot = null;
      while ((slot = slotRe.exec(body)) !== null) {
        const attrs = readAttributes(slot[1]);
        const name = cleanLine(attrs.name || '');
        const itemId = Number(attrs.itemId);
        if (!name || /^Flask/i.test(name)) continue; // flasks are not gear
        if (!Number.isFinite(itemId) || !itemId) continue;
        slots.push({ itemId, slot: name });
      }
      return slots;
    };

    const sets = [];
    const setRe = /<ItemSet\s+([^>]*?)>([\s\S]*?)<\/ItemSet>/g;
    let match = null;
    while ((match = setRe.exec(xml)) !== null) {
      sets.push({ attrs: readAttributes(match[1]), body: match[2] });
    }

    let chosen = null;
    sets.forEach((entry) => {
      if (chosen || !activeId) return;
      if (entry.attrs.id === activeId) chosen = entry.body;
    });
    if (!chosen) {
      // Fallback: the first set that actually has gear in it.
      for (let i = 0; i < sets.length; i += 1) {
        const slots = collect(sets[i].body);
        if (slots.length) { chosen = sets[i].body; break; }
      }
    }
    if (chosen) {
      const slots = collect(chosen);
      if (slots.length) return slots;
    }
    // Last resort: the slots that sit directly under <Items> (legacy format).
    const itemsBlock = /<Items\b[^>]*>([\s\S]*?)<\/Items>/.exec(xml);
    if (itemsBlock) {
      const slots = collect(itemsBlock[1]);
      if (slots.length) return slots;
    }
    return [];
  }

  function parseBuildXml(xml) {
    const text = String(xml || '');
    const game = detectGame(text);
    if (!game) throw new Error('Decoded data is not a Path of Building build.');
    const buildMatch = /<Build\b[^>]*>/.exec(text);
    if (!buildMatch) throw new Error('No build found in the code.');
    const buildTag = buildMatch[0];
    const build = {
      className: readAttr(buildTag, 'className'),
      ascendancy: readAttr(buildTag, 'ascendClassName'),
      level: readAttr(buildTag, 'level'),
      targetVersion: readAttr(buildTag, 'targetVersion'),
    };
    const blocks = extractItemBlocks(text);
    const slots = extractActiveSlots(text);
    const items = [];
    const seen = new Set();
    slots.forEach((slot) => {
      const entry = blocks.get(String(slot.itemId));
      if (!entry || seen.has(slot.itemId)) return;
      seen.add(slot.itemId);
      const parsed = parseItemBlock(entry.body, game);
      if (!parsed) return;
      parsed.game = game;
      items.push(Object.assign(parsed, { slot: slot.slot }));
    });
    if (!items.length) throw new Error('The build code contains no equipped gear.');
    return { game, build, items };
  }

  async function decodeCode(code) {
    const value = String(code || '').trim();
    if (value.length < 64) throw new Error('This does not look like a build code.');
    if (value.length > MAX_CODE_CHARS) throw new Error('Build code is too long.');
    const bytes = base64UrlToBytes(value);
    if (!bytes) throw new Error('Invalid build code (bad encoding).');
    const result = inflateBytes(new Uint8Array(bytes));
    const text = new TextDecoder('utf-8', { fatal: false }).decode(result);
    if (!text || text.length < 40) {
      throw new Error('Could not decompress the build code.');
    }
    // An XML declaration may precede the root element.
    if (!detectGame(text)) {
      throw new Error('Decoded data is not a Path of Building build.');
    }
    return text;
  }

  async function parseCode(code) {
    return parseBuildXml(await decodeCode(code));
  }

  global.POB_IMPORT = {
    decodeCode,
    parseCode,
    parseBuildXml,
    detectGame,
  };
  // The old name is kept so that anything still reaching for it keeps working.
  global.POB2_IMPORT = global.POB_IMPORT;
})(typeof window !== 'undefined' ? window : globalThis);
