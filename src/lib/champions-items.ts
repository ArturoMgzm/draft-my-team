// Shared held-item type definition for regulation manifests.
//
// The actual legal item lists now live in the per-regulation JSON manifests
// under src/lib/regulations/ (reg-*.json), grouped for the item picker — see
// registry.ts. This module keeps only the shared shape those manifests are
// typed against.
//
// Mega Stones are handled implicitly by picking a Mega form in the Pokémon
// selector — the calc auto-applies the correct stone, so they aren't listed
// as held items.

export type ItemGroup = { label: string; items: string[] };
