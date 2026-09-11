import type { PokemonSpecies } from "@/lib/pokemon-pool";
import { getRegulation, DEFAULT_REGULATION_ID } from "@/lib/regulations/registry";

export type DraftEntry = {
  id: string;
  name: string;
  slug: string;
  speciesKey: string;
  isMega?: boolean;
  multiForm?: boolean;
  altSlugs?: string[];
  /** Display names parallel to altSlugs (same index maps to same slug). */
  altNames?: string[];
  shiny?: boolean;
};

export type FormOption = { slug: string; name: string };

export type PickOrder = "sequential" | "snake";
export type MegaMode = "exact" | "atleast";
export type DraftMode = "standard" | "auction";
export type RevealMode = "auction" | "roll";

export type Config = {
  players: number;
  extras: number;
  megas: number;
  megaMode: MegaMode;
  pickOrder: PickOrder;
  splitForms: boolean;
  /** Standard turn-based draft vs money-based auction (multiplayer only). */
  draftMode?: DraftMode;
  /** Auction mode: per-Pokémon auction clock, started by the first bid.
   * (Every mon also opens with a fixed 10s no-bid window first.) */
  auctionTimerSeconds?: number;
  /** Auction mode: "auction" reveals each mon as it comes up for bidding;
   * "roll" reveals the whole pool up front (still auctioned one at a time). */
  revealMode?: RevealMode;
  /** Auction mode: players with a full team may still bid; winning forces
   * a swap, with the released mon sent to the back of the queue. */
  allowOverdraft?: boolean;
  /** Auction mode: each player's starting money. */
  startingBudget?: number;
  /** Auction mode: money paid to each incomplete-team, non-winning player
   * after every mon resolves. 0 disables. Prevents perma-broke players and
   * stops overdrafters stalling the game forever. */
  auctionIncome?: number;
  /** Curated-pool mode: guaranteed picks and bans shape the roll instead of
   * it being purely random. Order is still shuffled at draft start. */
  useCustomPool?: boolean;
  /** Entry ids guaranteed to be in the pool (only meaningful when
   * useCustomPool). Anything short of the full pool size is filled in
   * randomly at draft start. */
  customPool?: string[];
  /** Entry ids that can never be rolled (only meaningful when
   * useCustomPool). Guarantees win if an id somehow lands in both. */
  bannedPool?: string[];
  /** Which regulation's pool + item list this draft uses. Defaults to the
   * current regulation when absent (older rooms/configs). */
  regulation?: string;
};

export const DEFAULT_CONFIG: Config = {
  players: 2,
  extras: 4,
  megas: 2,
  megaMode: "exact",
  pickOrder: "snake",
  splitForms: true,
  draftMode: "standard",
  auctionTimerSeconds: 30,
  revealMode: "auction",
  allowOverdraft: false,
  startingBudget: 100,
  auctionIncome: 0,
  regulation: DEFAULT_REGULATION_ID,
};

const MEGA_FORM_OVERRIDES: Record<string, string> = {
  floette: "floette-eternal",
  slowbro: "slowbro",
};

// The species pool + mega-capable set now depend on which regulation the
// config selects, so they're resolved per-call rather than baked into a
// module-level constant. poolFor is cheap (array lookup) and megaCapableFor
// is memoized per pool reference so repeated calls in a render don't rebuild
// the Set.
function poolFor(cfg: Config): PokemonSpecies[] {
  return getRegulation(cfg.regulation).pool;
}

const megaCapableCache = new WeakMap<PokemonSpecies[], Set<string>>();
function megaCapableFor(pool: PokemonSpecies[]): Set<string> {
  let set = megaCapableCache.get(pool);
  if (!set) {
    set = new Set(pool.filter((s) => s.mega).map((s) => s.slug));
    megaCapableCache.set(pool, set);
  }
  return set;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildBaseEntries(cfg: Config): DraftEntry[] {
  const entries: DraftEntry[] = [];
  for (const sp of poolFor(cfg)) {
    if (sp.forms && sp.forms.length > 0) {
      if (cfg.splitForms) {
        for (const f of sp.forms) {
          entries.push({
            id: `f:${sp.slug}:${f.slug}`,
            name: f.name,
            slug: f.slug,
            speciesKey: sp.slug,
          });
        }
      } else {
        entries.push({
          id: `b:${sp.slug}`,
          name: sp.name,
          slug: sp.slug,
          speciesKey: sp.slug,
          multiForm: true,
          // sp.forms always lists the base form first (slug === sp.slug) —
          // exclude it here since entry.slug already covers the base form.
          altSlugs: sp.forms.map((f) => f.slug).filter((slug) => slug !== sp.slug),
          altNames: sp.forms.filter((f) => f.slug !== sp.slug).map((f) => f.name),
        });
      }
    } else {
      entries.push({
        id: `b:${sp.slug}`,
        name: sp.name,
        slug: sp.slug,
        speciesKey: sp.slug,
      });
    }
  }
  return entries;
}

export function buildNonMegaEntries(cfg: Config): DraftEntry[] {
  const megaCapable = megaCapableFor(poolFor(cfg));
  return buildBaseEntries(cfg).filter((entry) => !megaCapable.has(entry.speciesKey));
}

// Every selectable entry for the custom-pool picker: all non-mega base
// entries plus every mega-capable entry, in a stable (unshuffled) order.
// Non-mega bases first, then megas — the same two groups rollPool draws
// from — so the picker grid reads consistently.
export function buildAllEntries(cfg: Config): DraftEntry[] {
  return [...buildNonMegaEntries(cfg), ...buildMegaCapableEntries(cfg)];
}

export function buildMegaCapableEntries(cfg: Config): DraftEntry[] {
  const entries: DraftEntry[] = [];
  for (const sp of poolFor(cfg)) {
    if (!sp.mega) continue;
    let spriteSlug = sp.slug;
    if (cfg.splitForms && sp.forms && sp.forms.length > 0) {
      const override = MEGA_FORM_OVERRIDES[sp.slug];
      if (override) spriteSlug = override;
    }
    const megaVariants = [sp.mega, ...(sp.altMegas ?? [])];
    entries.push({
      id: `m:${sp.slug}`,
      name: sp.name,
      slug: spriteSlug,
      speciesKey: sp.slug,
      isMega: true,
      altSlugs: megaVariants.map((m) => m.slug),
      altNames: megaVariants.map((m) => m.name),
    });
  }
  return entries;
}

// Draws `need` random entries, skipping anything in `exclude` and aiming for
// `megaTarget` megas among them. Shared by the pure-random roll and by the
// random fill that tops up a curated pool, so both obey the same mega rules.
function drawRandom(
  cfg: Config,
  need: number,
  exclude: Set<string>,
  megaTarget: number,
): DraftEntry[] {
  if (need <= 0) return [];
  const megaPool = shuffle(buildMegaCapableEntries(cfg).filter((e) => !exclude.has(e.id)));
  const nonMegaPool = shuffle(buildNonMegaEntries(cfg).filter((e) => !exclude.has(e.id)));
  const megas = Math.max(0, Math.min(megaTarget, need));
  let chosen: DraftEntry[];
  let leftovers: DraftEntry[];
  if (cfg.megaMode === "exact") {
    chosen = [...nonMegaPool.slice(0, need - megas), ...megaPool.slice(0, megas)];
    leftovers = [...nonMegaPool.slice(need - megas), ...megaPool.slice(megas)];
  } else {
    const lockedMegas = megaPool.slice(0, megas);
    const rest = shuffle([...megaPool.slice(megas), ...nonMegaPool]);
    chosen = [...lockedMegas, ...rest.slice(0, need - megas)];
    leftovers = rest.slice(need - megas);
  }
  // One group can run dry (a narrow regulation, or lots of bans) — top up
  // from whatever is left rather than handing back a short pool.
  if (chosen.length < need) chosen = [...chosen, ...leftovers.slice(0, need - chosen.length)];
  return chosen;
}

export function rollPool(cfg: Config): DraftEntry[] {
  const totalNeeded = cfg.players * 6 + cfg.extras;
  const chosen = drawRandom(cfg, totalNeeded, new Set(), Math.min(cfg.megas, totalNeeded));
  return shuffle(chosen.map((e) => ({ ...e, shiny: Math.random() < 1 / 4096 })));
}

// Ids the config bans. Bans only apply in curated-pool mode — a leftover
// ban list shouldn't quietly shrink a plain random roll.
export function bannedIds(cfg: Config): Set<string> {
  return new Set(cfg.useCustomPool ? (cfg.bannedPool ?? []) : []);
}

// The guaranteed entries a curated pool starts from: the hand-picked ids,
// resolved, de-duped, bans dropped, capped at the pool size.
export function guaranteedEntries(cfg: Config): DraftEntry[] {
  const all = new Map(buildAllEntries(cfg).map((e) => [e.id, e]));
  const banned = bannedIds(cfg);
  const seen = new Set<string>();
  const out: DraftEntry[] = [];
  for (const id of cfg.customPool ?? []) {
    if (seen.has(id) || banned.has(id)) continue;
    const e = all.get(id);
    if (!e) continue;
    seen.add(id);
    out.push(e);
  }
  return out.slice(0, cfg.players * 6 + cfg.extras);
}

// Builds the draft pool in curated mode: every guaranteed pick is in, every
// banned entry is out, and the slots left over are rolled randomly. Megas
// already guaranteed count against the mega quota, so guaranteeing two megas
// with `megas: 2` doesn't hand you four. Applies the same per-entry shiny
// roll rollPool uses and shuffles the order, so curating fixes *which* mons
// are in play but never the order they're drafted or auctioned in.
export function buildCustomPool(cfg: Config): DraftEntry[] {
  const totalNeeded = cfg.players * 6 + cfg.extras;
  const locked = guaranteedEntries(cfg);
  const exclude = new Set([...bannedIds(cfg), ...locked.map((e) => e.id)]);
  const lockedMegas = locked.filter((e) => e.isMega).length;
  const fill = drawRandom(
    cfg,
    totalNeeded - locked.length,
    exclude,
    Math.min(cfg.megas, totalNeeded) - lockedMegas,
  );
  const chosen = [...locked, ...fill];
  return shuffle(chosen.map((e) => ({ ...e, shiny: Math.random() < 1 / 4096 })));
}

// The single entry point every "start the draft" path uses to build a pool:
// the curated pool when curated mode is on, a plain random roll otherwise.
// Going through here is what keeps a host's guarantees and bans from being
// silently replaced by a random roll at start.
export function makePool(cfg: Config): DraftEntry[] {
  return cfg.useCustomPool ? buildCustomPool(cfg) : rollPool(cfg);
}

// Every viewable form for an entry, base form first. For non-mega/non-multi
// entries this is just the single base slug. Used to drive the click-to-flip
// form switcher on PoolCard; drafting always uses entry.id regardless of
// which form is currently being viewed.
export function getFormSlugs(entry: DraftEntry): string[] {
  if (entry.altSlugs && entry.altSlugs.length > 0) {
    return [entry.slug, ...entry.altSlugs];
  }
  return [entry.slug];
}

// Same as getFormSlugs but paired with a proper display name for each
// form (base species name, regional/alt form name, or "Mega X"/"Mega Y"
// style name), so UI toggles don't have to re-derive labels from slugs.
export function getFormOptions(entry: DraftEntry): FormOption[] {
  const slugs = getFormSlugs(entry);
  const names = [entry.name, ...(entry.altNames ?? [])];
  return slugs.map((slug, i) => ({ slug, name: names[i] ?? entry.name }));
}

export function nextPlayerIndex(pickIdx: number, playerCount: number, order: PickOrder): number {
  if (playerCount <= 0) return 0;
  if (order === "sequential") return pickIdx % playerCount;
  const round = Math.floor(pickIdx / playerCount);
  const pos = pickIdx % playerCount;
  return round % 2 === 0 ? pos : playerCount - 1 - pos;
}

export function computeMegaMax(cfg: Config, totalNeeded: number): number {
  return Math.min(buildMegaCapableEntries(cfg).length, totalNeeded);
}

export function computeOverCapacity(cfg: Config): boolean {
  const totalNeeded = cfg.players * 6 + cfg.extras;
  const megaNeeded = Math.min(cfg.megas, totalNeeded);
  // Bans shrink what's rollable, so they can push a config over capacity.
  const banned = bannedIds(cfg);
  const nonMegaAvailable = buildNonMegaEntries(cfg).filter((e) => !banned.has(e.id)).length;
  const megaAvailable = buildMegaCapableEntries(cfg).filter((e) => !banned.has(e.id)).length;
  if (megaNeeded > megaAvailable) return true;
  if (cfg.megaMode === "exact") {
    return totalNeeded - megaNeeded > nonMegaAvailable;
  }
  return totalNeeded > nonMegaAvailable + megaAvailable;
}
