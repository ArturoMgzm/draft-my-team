import { useEffect, useMemo, useState } from "react";
import { fetchPokemon, type PokemonData } from "@/lib/pokeapi";
import type { DraftEntry } from "@/lib/draft-engine";

export function HoverSprite({
  entry,
  className,
  activeIndex,
}: {
  entry: DraftEntry;
  className?: string;
  /** When provided, this index is shown and the internal hover-cycle is disabled. */
  activeIndex?: number;
}) {
  const slugs = useMemo(
    () => [entry.slug, ...(entry.altSlugs ?? [])],
    [entry.slug, entry.altSlugs],
  );
  const [datas, setDatas] = useState<(PokemonData | null)[]>(() => slugs.map(() => null));
  const [hoverIdx, setHoverIdx] = useState(0);
  const [hover, setHover] = useState(false);
  const controlled = activeIndex !== undefined;
  const idx = controlled ? Math.min(activeIndex!, slugs.length - 1) : hoverIdx;

  useEffect(() => {
    let active = true;
    setDatas(slugs.map(() => null));
    Promise.all(slugs.map((s) => fetchPokemon(s))).then((res) => {
      if (active) setDatas(res);
    });
    return () => {
      active = false;
    };
  }, [slugs]);

  useEffect(() => {
    if (controlled || !hover || slugs.length <= 1) return;
    const id = window.setInterval(() => {
      setHoverIdx((i) => (i + 1) % slugs.length);
    }, 1200);
    return () => window.clearInterval(id);
  }, [controlled, hover, slugs.length]);

  useEffect(() => {
    if (!controlled && !hover) setHoverIdx(0);
  }, [controlled, hover]);

  const pickSrc = (d: PokemonData | null) =>
    entry.shiny ? (d?.shinySprite ?? d?.sprite ?? null) : (d?.sprite ?? null);
  const label = idx === 0 ? entry.name : slugs[idx].replace(/-/g, " ");
  const anyLoaded = datas.some((d) => d);

  return (
    <div
      onMouseEnter={() => !controlled && setHover(true)}
      onMouseLeave={() => !controlled && setHover(false)}
      className="relative h-full w-full"
    >
      {!anyLoaded && <div className="h-full w-full animate-pulse rounded bg-muted" />}
      {datas.map((d, i) => {
        const src = pickSrc(d);
        if (!src) return null;
        const visible = i === idx;
        return (
          <img
            key={slugs[i]}
            src={src}
            alt={i === idx ? label : ""}
            loading="lazy"
            aria-hidden={!visible}
            className={`${className ?? ""} absolute inset-0 transition-opacity duration-500 ease-in-out ${
              visible ? "opacity-100" : "opacity-0"
            }`}
          />
        );
      })}
      {!controlled && hover && slugs.length > 1 && (
        <span className="pointer-events-none absolute bottom-0 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-background/80 px-1 text-[9px] font-semibold capitalize text-foreground">
          {label}
        </span>
      )}
    </div>
  );
}