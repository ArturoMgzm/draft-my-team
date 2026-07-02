// Curated list of held items available in Pokémon Champions.
// Names match Smogon @smogon/calc's ITEMS index (Showdown-style).
// This is intentionally a subset — extend as the Champions item pool is
// confirmed. Mega Stones are handled implicitly when the "Mega" toggle
// is on (the calc auto-applies the correct stone).

export type ItemGroup = { label: string; items: string[] };

export const CHAMPIONS_ITEMS: ItemGroup[] = [
  {
    label: "Damage boosters",
    items: [
      "Life Orb",
      "Choice Band",
      "Choice Specs",
      "Choice Scarf",
      "Expert Belt",
      "Muscle Band",
      "Wise Glasses",
      "Metronome",
    ],
  },
  {
    label: "Defensive",
    items: [
      "Assault Vest",
      "Rocky Helmet",
      "Eviolite",
      "Weakness Policy",
      "Covert Cloak",
      "Clear Amulet",
      "Safety Goggles",
    ],
  },
  {
    label: "Recovery / berries",
    items: [
      "Leftovers",
      "Sitrus Berry",
      "Focus Sash",
      "Mental Herb",
      "Mirror Herb",
      "White Herb",
    ],
  },
  {
    label: "Situational",
    items: [
      "Loaded Dice",
      "Booster Energy",
      "Terrain Extender",
      "Light Clay",
      "Heavy-Duty Boots",
      "Throat Spray",
      "Wide Lens",
      "Scope Lens",
      "King's Rock",
    ],
  },
  {
    label: "Type-boosting",
    items: [
      "Charcoal",
      "Mystic Water",
      "Miracle Seed",
      "Magnet",
      "NeverMeltIce",
      "Black Belt",
      "Poison Barb",
      "Soft Sand",
      "Sharp Beak",
      "Twisted Spoon",
      "Silver Powder",
      "Hard Stone",
      "Spell Tag",
      "Dragon Fang",
      "Black Glasses",
      "Metal Coat",
      "Silk Scarf",
      "Fairy Feather",
    ],
  },
];

export const ALL_ITEMS: string[] = CHAMPIONS_ITEMS.flatMap((g) => g.items);