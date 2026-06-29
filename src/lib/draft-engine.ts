import { REG_MB_POOL } from "@/lib/pokemon-pool";

export type DraftEntry = {
  id: string;
  name: string;
  slug: string;
  speciesKey: string;
  isMega?: boolean;
  multiForm?: boolean;
  altSlugs?: string[];
  shiny?: boolean;
};

export type PickOrder = "sequential" | "snake";
export type MegaMode = "exact" | "atleast";

export type Config = {
  players: number;
  extras: number;
  megas: number;
  megaMode: MegaMode;
  pickOrder: PickOrder;
  splitForms: boolean;
};

export const DEFAULT_CONFIG: Config = {
  players: 2,
  extras: 4,
  megas: 2,
  megaMode: "exact",
  pickOrder: "snake",
  splitForms: true,
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
    entries.push({
      id: `m:${sp.slug}`,
      name: sp.name,
      slug: spriteSlug,
      speciesKey: sp.slug,
      isMega: true,
      altSlugs: [sp.mega.slug],
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