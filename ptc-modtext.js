/* ==========================================================================
   Poe Trade Watcher — canonical modifier text
   --------------------------------------------------------------------------
   Path of Building writes modifier lines in its own wording ("+15% to
   Increased Physical Damage"), while the trade site and Craft of Exile use
   the game's wording ("#% increased physical damage"). Both are the same
   modifier, so both sides are reduced to one canonical form before they are
   compared. Without this, a build import finds none of its modifiers and
   neither the trade search nor the Craft of Exile paste can use them.

   The wording is not consistent between stats: a physical damage modifier is
   "increased" in the game, while a resistance modifier is "to". A line that
   says "to increased" can therefore mean either, so every lookup tries the
   plausible spellings.

   Exposes `globalThis.PTC_MODTEXT`:
     .canonical(text)  – one compact lookup key
     .candidates(text) – every key worth trying for that line
     .normalize(text)  – the same text in the game's wording
   ========================================================================== */

(function (root) {
  'use strict';

  /* "[min|max]" style ranges and the "|explicit" marker are noise for a lookup. */
  function stripTags(value) {
    return String(value == null ? '' : value)
      .replace(/\[[^\]]*\|([^\]]*)\]/g, '$1')
      .replace(/\[[^\]]*\]/g, (match) => match.slice(1, -1));
  }

  function canonical(value) {
    return stripTags(value)
      .toLowerCase()
      /* A range ("+(21-25)", "25-25%") is one number for a lookup: Path of
         Building writes the tier's range when it does not know the roll, and the
         site writes the stat with a single "#". Without this the line never
         matched and the imported item searched with fewer filters. */
      .replace(/[0-9]+(?:\.[0-9]+)?\s*[-\u2013]\s*[0-9]+(?:\.[0-9]+)?/g, '#')
      .replace(/[0-9]+(?:\.[0-9]+)?/g, '#')
      /* The leading "+" is only a sign, the value carries the meaning. */
      .replace(/[^a-z0-9#%\s]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  /*
   * "to increased" is ambiguous: the game writes the physical damage
   * modifier as "increased" and the resistance modifier as "to", so both
   * readings are worth a try.
   */
  function candidates(value) {
    const compact = canonical(value);
    const out = [compact];
    if (compact.indexOf('toincreased') !== -1) {
      out.push(compact.replace(/toincreased/g, 'increased'));
      out.push(compact.replace(/toincreased/g, 'to'));
    }
    return out;
  }

  /* The same text with the wording the game uses, so it can be shown. */
  function normalize(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
  }

  const api = { canonical: canonical, candidates: candidates, normalize: normalize };
  root.PTC_MODTEXT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
