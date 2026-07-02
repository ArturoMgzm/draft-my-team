// Held items actually available in Pokémon Champions (checked against the
// official Reg M-B item pool via Serebii's item listing, and every name
// verified against @smogon/calc's ITEMS index). Champions still doesn't
// have every item from the mainline games — notably missing: Choice
// Band/Specs, Assault Vest, Eviolite, Rocky Helmet, Weakness Policy,
// Covert Cloak, Clear Amulet, Safety Goggles, Booster Energy, Loaded Dice,
// Terrain Extender, Heavy-Duty Boots, Throat Spray, Mirror Herb.
// Names match Smogon @smogon/calc's ITEMS index (Showdown-style).
// Mega Stones are handled implicitly by picking a Mega form in the
// Pokémon selector — the calc auto-applies the correct stone.
// Extend this list as future regulations add items.

export type ItemGroup = { label: string; items: string[] };

export const CHAMPIONS_ITEMS: ItemGroup[] = [
  {
    label: "Damage boosters",
    items: [
      "Life Orb",
      "Choice Scarf",
      "Expert Belt",
      "Muscle Band",
      "Wise Glasses",
      "Metronome",
      "Light Ball",
    ],
  },
  {
    label: "Recovery / survival",
    items: [
      "Leftovers",
      "Focus Sash",
      "Focus Band",
      "Mental Herb",
      "White Herb",
      "Shell Bell",
      "Big Root",
    ],
  },
  {
    // The full official Champions berry pool (verified against Serebii's
    // item listing and @smogon/calc's ITEMS index). Status/PP-cure berries
    // first, then the 17 type-resist berries, alphabetically within each.
    label: "Berries",
    items: [
      "Lum Berry",
      "Sitrus Berry",
      "Oran Berry",
      "Leppa Berry",
      "Aspear Berry",
      "Cheri Berry",
      "Chesto Berry",
      "Pecha Berry",
      "Persim Berry",
      "Rawst Berry",
      "Babiri Berry",
      "Charti Berry",
      "Chilan Berry",
      "Chople Berry",
      "Coba Berry",
      "Colbur Berry",
      "Haban Berry",
      "Kasib Berry",
      "Kebia Berry",
      "Occa Berry",
      "Passho Berry",
      "Payapa Berry",
      "Rindo Berry",
      "Roseli Berry",
      "Shuca Berry",
      "Tanga Berry",
      "Wacan Berry",
      "Yache Berry",
    ],
  },
  {
    label: "Situational",
    items: [
      "Light Clay",
      "Wide Lens",
      "Zoom Lens",
      "Scope Lens",
      "King's Rock",
      "Bright Powder",
      "Quick Claw",
      "Iron Ball",
      "Shed Shell",
    ],
  },
  {
    label: "Weather / terrain extenders",
    items: ["Damp Rock", "Heat Rock", "Icy Rock", "Smooth Rock"],
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