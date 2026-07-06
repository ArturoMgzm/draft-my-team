import { REG_MB_POOL } from "@/lib/pokemon-pool";

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
};

const MEGA_FORM_OVERRIDES: Record<string, string> = {
  floette: "floette-eternal",
  slowbro: "slowbro",
};

const MEGA_CAPABLE_SPECIES = new Set(REG_MB_POOL.filter((s) => s.mega).map((s) => s.slug));

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildBaseEntries(splitForms: boolean): DraftEntry[] {
  const entries: DraftEntry[] = [];
  for (const sp of REG_MB_POOL) {
    if (sp.forms && sp.forms.length > 0) {
      if (splitForms) {
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

export function buildNonMegaEntries(splitForms: boolean): DraftEntry[] {
  return buildBaseEntries(splitForms).filter(
    (entry) => !MEGA_CAPABLE_SPECIES.has(entry.speciesKey),
  );
}

export function buildMegaCapableEntries(splitForms: boolean): DraftEntry[] {
  const entries: DraftEntry[] = [];
  for (const sp of REG_MB_POOL) {
    if (!sp.mega) continue;
    let spriteSlug = sp.slug;
    if (splitForms && sp.forms && sp.forms.length > 0) {
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

export function rollPool(cfg: Config): DraftEntry[] {
  const totalNeeded = cfg.players * 6 + cfg.extras;
  const guaranteedMegas = Math.min(cfg.megas, totalNeeded);
  const megaPool = shuffle(buildMegaCapableEntries(cfg.splitForms));
  const nonMegaPool = shuffle(buildNonMegaEntries(cfg.splitForms));
  let chosen: DraftEntry[];
  if (cfg.megaMode === "exact") {
    const nonMegas = nonMegaPool.slice(0, totalNeeded - guaranteedMegas);
    const megas = megaPool.slice(0, guaranteedMegas);
    chosen = [...nonMegas, ...megas];
  } else {
    const lockedMegas = megaPool.slice(0, guaranteedMegas);
    const rest = shuffle([...megaPool.slice(guaranteedMegas), ...nonMegaPool]).slice(
      0,
      totalNeeded - guaranteedMegas,
    );
    chosen = [...lockedMegas, ...rest];
  }
  chosen = chosen.map((e) => ({ ...e, shiny: Math.random() < 1 / 4096 }));
  return shuffle(chosen);
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

export function computeMegaMax(splitForms: boolean, totalNeeded: number): number {
  return Math.min(buildMegaCapableEntries(splitForms).length, totalNeeded);
}

export function computeOverCapacity(cfg: Config): boolean {
  const totalNeeded = cfg.players * 6 + cfg.extras;
  const megaNeeded = Math.min(cfg.megas, totalNeeded);
  const nonMegaAvailable = buildNonMegaEntries(cfg.splitForms).length;
  const megaAvailable = buildMegaCapableEntries(cfg.splitForms).length;
  if (megaNeeded > megaAvailable) return true;
  if (cfg.megaMode === "exact") {
    return totalNeeded - megaNeeded > nonMegaAvailable;
  }
  return totalNeeded > nonMegaAvailable + megaAvailable;
}
