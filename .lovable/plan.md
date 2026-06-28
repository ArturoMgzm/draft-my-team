## 1. Shiny polish (sprite border + sound)

**Visual**
- Add a `shiny` variant to `PoolCard` and `TeamSlot` in `src/routes/index.tsx`: an animated gradient ring (gold → cyan → magenta) plus a soft outer glow. The existing ✨ badge stays.
- Add `@keyframes shiny-shimmer` and a `.shiny-frame` utility in `src/styles.css` (rotating conic-gradient border, ~3s loop, `prefers-reduced-motion` falls back to a static gold ring).
- Wrap the sprite in a dedicated frame div so the shimmer doesn't fight the type-color background already on the card.

**Sound**
- Add a short royalty-free sparkle SFX uploaded via `lovable-assets` → `src/assets/shiny.mp3.asset.json` (CC0 chime, ~1s; bundling the actual game jingle would conflict with the fan-project disclaimer in section 2).
- New `src/lib/shiny-sound.ts`: lazy `HTMLAudioElement` singleton, exports `playShinyChime()`. Respects a `shinyMuted` flag in `localStorage` and ignores repeat calls within 1.5s so a roll containing multiple shinies chimes exactly once.
- Call `playShinyChime()` from `rollPool`'s caller (`startDraft`) after state commits, only when at least one entry has `shiny: true`.
- Header in `src/routes/index.tsx` gets a small 🔊 / 🔇 toggle button persisted to `localStorage`.

## 2. Legal disclaimers + publish metadata

**Footer + dedicated legal page**
- Update the footer in `src/routes/index.tsx` to: "Pokémon and Pokémon character names are trademarks of Nintendo, Game Freak, and The Pokémon Company. This is an unofficial fan project, not affiliated with or endorsed by them. Pokémon data and sprites via PokéAPI." with a link to `/legal`.
- New route `src/routes/legal.tsx` covering: fan-project status, non-commercial intent, trademark acknowledgements (Nintendo / Game Freak / TPC / Creatures Inc.), PokéAPI attribution + local-cache fair-use compliance, no warranty, takedown contact line (placeholder the user can fill in).

**Site metadata (so the share card and tab title aren't "Lovable App")**
- `src/routes/__root.tsx`: replace the template `title` / `description` / `og:*` defaults with real values; add `og:site_name` "Pokémon Champions Draft", `og:type: website`, `twitter:card: summary`.
- `src/routes/index.tsx` `head()`: fill in matching `twitter:title`, `twitter:description`, `og:url`, and a `<link rel="canonical">` pointing at `https://poke-champions-draft.lovable.app/`.
- `src/routes/legal.tsx` `head()`: own title/description/og/canonical per the head-meta rules (canonical on leaf only).
- Favicon: generate a small Poké Ball SVG to `public/favicon.svg` and link it from `__root.tsx`.

**Publish step**
- After the above lands, publish with `website_info_status: added_or_updated` and a summary naming title, description, OG, Twitter, favicon, and the new legal route.

## Files touched

- `src/styles.css` — shiny shimmer keyframes + `.shiny-frame` utility
- `src/lib/shiny-sound.ts` (new)
- `src/assets/shiny.mp3.asset.json` (new, via `lovable-assets`)
- `src/routes/index.tsx` — shiny border, chime trigger, mute toggle, footer disclaimer, metadata fill-in
- `src/routes/legal.tsx` (new)
- `src/routes/__root.tsx` — real site-wide metadata + favicon link
- `public/favicon.svg` (new)

## Out of scope (deferred)

- Multiplayer rooms (planned separately on the next turn).

## Open question

OK to use a generic CC0 sparkle SFX rather than the actual Pokémon shiny jingle? Bundling the game audio would itself be the kind of IP issue section 2 is meant to avoid.
