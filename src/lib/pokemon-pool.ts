// Shared Pokémon-species type definitions for regulation manifests.
//
// The actual legal pools now live in self-contained JSON manifests under
// src/lib/regulations/ (reg-*.json), one per regulation — see registry.ts.
// This module keeps only the shared shape those manifests (and the draft
// engine) are typed against, so there's a single source of truth for the
// data (the JSON) and a single source of truth for its type (here).
//
// `slug` is the PokéAPI identifier used to fetch sprites/types.
// `mega` (optional) marks the species as mega-capable and is the primary/
// default Mega variant. `altMegas` holds any additional Mega variants for
// species with more than one (e.g. Charizard X/Y, Raichu X/Y). Sprites still
// render from the base form per the "show base forms" UI rule.

export type FormVariant = { name: string; slug: string };
export type MegaInfo = { name: string; slug: string };

export type PokemonSpecies = {
  name: string;
  slug: string;
  forms?: FormVariant[];
  mega?: MegaInfo;
  altMegas?: MegaInfo[];
};
