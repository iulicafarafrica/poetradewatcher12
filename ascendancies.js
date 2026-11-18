/*
 * Ascendancy classes per game, with their class icons.
 *
 * PoE 2: the poe2db passive skill tree data (patch 4.5), which lists every
 * class tree with the ascendancy trees that branch from it. The third
 * ascendancy of a class is stored as its own tree root (Huntress, Warrior,
 * Mercenary, Shadow, Templar), so it is added to the class it belongs to.
 *
 * PoE 1: the passive skill tree data Path of Building ships for patch 3.29,
 * which lists the seven base classes (Scion included) with their three
 * ascendancies each. On top of that the game offers the Bloodlines, an
 * alternative to the ascendancy that any class can pick instead, so they are
 * listed as their own group.
 *
 * The icons are the class pictures from poedb / poe2db.
 */
const POE2_ASCENDANCIES = [
  {
    class: 'Ranger',
    icon: 'https://cdn.poe2db.tw/image/Art/2DArt/UIImages/Common/IconDexFour.webp',
    ascendancies: ['Deadeye', 'Pathfinder', 'Huntress'],
  },
  {
    class: 'Amazon',
    icon: 'https://cdn.poe2db.tw/image/Art/2DArt/UIImages/Common/IconDexFourb.webp',
    ascendancies: ['Spirit Walker', 'Ritualist', 'Shadow'],
  },
  {
    class: 'Monk',
    icon: 'https://cdn.poe2db.tw/image/Art/2DArt/UIImages/Common/IconDexIntFourb.webp',
    ascendancies: ['Martial Artist', 'Invoker', 'Acolyte of Chayula'],
  },
  {
    class: 'Witch',
    icon: 'https://cdn.poe2db.tw/image/Art/2DArt/UIImages/Common/IconIntFour.webp',
    ascendancies: ['Infernalist', 'Blood Mage', 'Lich', 'Abyssal Lich'],
  },
  {
    class: 'Sorceress',
    icon: 'https://cdn.poe2db.tw/image/Art/2DArt/UIImages/Common/IconIntFourb.webp',
    ascendancies: ['Stormweaver', 'Chronomancer', 'Disciple of Varashta'],
  },
  {
    class: 'Marauder',
    icon: 'https://cdn.poe2db.tw/image/Art/2DArt/UIImages/Common/IconStrFour.webp',
    ascendancies: ['Warrior', 'Titan', 'Warbringer', 'Smith of Kitava'],
  },
  {
    class: 'Duelist',
    icon: 'https://cdn.poe2db.tw/image/Art/2DArt/UIImages/Common/IconStrDexFour.webp',
    ascendancies: ['Mercenary', 'Tactician', 'Witchhunter', 'Gemling Legionnaire'],
  },
  {
    class: 'Druid',
    icon: 'https://cdn.poe2db.tw/image/Art/2DArt/UIImages/Common/IconStrIntFour.webp',
    ascendancies: ['Oracle', 'Shaman', 'Templar'],
  },
];

const POE1_ASCENDANCIES = [
  {
    class: 'Scion',
    icon: 'https://cdn.poedb.tw/image/Art/2DArt/UIImages/Common/IconStrDexInt.webp',
    ascendancies: ['Ascendant', 'Reliquarian', 'Luminary'],
  },
  {
    class: 'Marauder',
    icon: 'https://cdn.poedb.tw/image/Art/2DArt/UIImages/Common/IconStr.webp',
    ascendancies: ['Juggernaut', 'Berserker', 'Chieftain'],
  },
  {
    class: 'Ranger',
    icon: 'https://cdn.poedb.tw/image/Art/2DArt/UIImages/Common/IconDex.webp',
    ascendancies: ['Warden', 'Deadeye', 'Pathfinder'],
  },
  {
    class: 'Witch',
    icon: 'https://cdn.poedb.tw/image/Art/2DArt/UIImages/Common/IconInt.webp',
    ascendancies: ['Occultist', 'Elementalist', 'Necromancer'],
  },
  {
    class: 'Duelist',
    icon: 'https://cdn.poedb.tw/image/Art/2DArt/UIImages/Common/IconStrDex.webp',
    ascendancies: ['Slayer', 'Gladiator', 'Champion'],
  },
  {
    class: 'Templar',
    icon: 'https://cdn.poedb.tw/image/Art/2DArt/UIImages/Common/IconStrInt.webp',
    ascendancies: ['Inquisitor', 'Hierophant', 'Guardian'],
  },
  {
    class: 'Shadow',
    icon: 'https://cdn.poedb.tw/image/Art/2DArt/UIImages/Common/IconDexInt.webp',
    ascendancies: ['Assassin', 'Trickster', 'Saboteur'],
  },
];

/*
 * The Bloodlines (patch 3.25 and later) are an alternative to the ascendancy:
 * any class can take one of them instead. They belong to no class, so they
 * are listed as a group of their own.
 */
const POE1_BLOODLINES = {
  class: 'Bloodline',
  icon: '',
  ascendancies: [
    'Chaos Bloodline',
    'Nameless Bloodline',
    'Oshabi Bloodline',
    'Catarina Bloodline',
    'Aul Bloodline',
    'Lycia Bloodline',
    'Olroth Bloodline',
    'Farrul Bloodline',
    'Delirious Bloodline',
    'Breachlord Bloodline',
    'Saresh Bloodline',
    'Velka Bloodline',
    'Abyssal Bloodline',
    'Warden of the Maji',
    'Warlock of the Mists',
    'Wildwood Primalist',
  ],
};

const PTC_ASCENDANCIES = {
  poe2: POE2_ASCENDANCIES,
  poe1: POE1_ASCENDANCIES.concat([POE1_BLOODLINES]),
};

/* The ascendancy classes of one game. PoE 2 is the default so that anything
   that does not name a game keeps the behaviour it had before. */
function ascendanciesFor(game) {
  const id = String(game == null ? '' : game).toLowerCase() === 'poe1' ? 'poe1' : 'poe2';
  return PTC_ASCENDANCIES[id] || POE2_ASCENDANCIES;
}

if (typeof globalThis !== 'undefined') {
  globalThis.POE2_ASCENDANCIES = POE2_ASCENDANCIES;
  globalThis.POE1_ASCENDANCIES = POE1_ASCENDANCIES;
  globalThis.POE1_BLOODLINES = POE1_BLOODLINES;
  globalThis.PTC_ASCENDANCIES = { ascendanciesFor, list: PTC_ASCENDANCIES };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    POE2_ASCENDANCIES,
    POE1_ASCENDANCIES,
    POE1_BLOODLINES,
    PTC_ASCENDANCIES,
    ascendanciesFor,
  };
}
