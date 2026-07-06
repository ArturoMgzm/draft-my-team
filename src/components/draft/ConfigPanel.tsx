import {
  type Config,
  type DraftMode,
  type MegaMode,
  type PickOrder,
  type RevealMode,
  DEFAULT_CONFIG,
  computeMegaMax,
  computeOverCapacity,
} from "@/lib/draft-engine";
import { useEffect } from "react";

export { DEFAULT_CONFIG };

export function ConfigPanel({
  cfg,
  setCfg,
  onStart,
  startLabel = "Roll Pool & Start Draft",
  readonly = false,
  hideStart = false,
  startDisabledReason,
  multiplayer = false,
}: {
  cfg: Config;
  setCfg: (updater: (c: Config) => Config) => void;
  onStart?: () => void;
  startLabel?: string;
  readonly?: boolean;
  hideStart?: boolean;
  startDisabledReason?: string | null;
  /** Auction mode is only meaningful with multiple live players, so its
   * settings only render in multiplayer lobbies. */
  multiplayer?: boolean;
}) {
  const totalNeeded = cfg.players * 6 + cfg.extras;
  const megaMax = computeMegaMax(cfg.splitForms, totalNeeded);
  const overCapacity = computeOverCapacity(cfg);
  const isAuction = multiplayer && (cfg.draftMode ?? "standard") === "auction";

  useEffect(() => {
    if (!readonly && cfg.megas > megaMax) setCfg((c) => ({ ...c, megas: megaMax }));
  }, [cfg.megas, megaMax, readonly, setCfg]);

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-lg">
      <div>
        <h2 className="text-lg font-bold">Draft Configuration</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Shared pool of {totalNeeded} Pokémon ({cfg.players * 6} slots + {cfg.extras} extras).
        </p>
      </div>

      <fieldset disabled={readonly} className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Players"
          value={cfg.players}
          min={1}
          max={8}
          onChange={(v) => setCfg((c) => ({ ...c, players: v }))}
          hint="6 Picks per player"
        />
        <NumberField
          label="Extra options"
          value={cfg.extras}
          min={0}
          max={50}
          onChange={(v) => setCfg((c) => ({ ...c, extras: v }))}
          hint="Bonus picks in shared pool"
        />
        <NumberField
          label="Megas in pool"
          value={cfg.megas}
          min={0}
          max={megaMax}
          onChange={(v) => setCfg((c) => ({ ...c, megas: v }))}
          hint={`Max ${megaMax}`}
        />
        <ToggleField
          label="Mega count"
          value={cfg.megaMode}
          options={[
            { value: "exact", label: "Exactly", hint: "Always X megas in pool" },
            { value: "atleast", label: "At least", hint: "X guaranteed, more may roll" },
          ]}
          onChange={(v) => setCfg((c) => ({ ...c, megaMode: v as MegaMode }))}
        />
        {multiplayer && (
          <div className="sm:col-span-2">
            <ToggleField
              label="Draft mode"
              value={cfg.draftMode ?? "standard"}
              options={[
                { value: "standard", label: "Standard", hint: "Take turns picking" },
                { value: "auction", label: "Auction 💰", hint: "Bid money on every mon" },
              ]}
              onChange={(v) => setCfg((c) => ({ ...c, draftMode: v as DraftMode }))}
            />
          </div>
        )}
        {!isAuction && (
          <div className="sm:col-span-2">
            <ToggleField
              label="Pick order"
              value={cfg.pickOrder}
              options={[
                { value: "sequential", label: "Sequential", hint: "1,2,3,1,2,3…" },
                { value: "snake", label: "Snake", hint: "1,2,3,3,2,1…" },
              ]}
              onChange={(v) => setCfg((c) => ({ ...c, pickOrder: v as PickOrder }))}
            />
          </div>
        )}
        {isAuction && (
          <>
            <NumberField
              label="Auction timer (s)"
              value={cfg.auctionTimerSeconds ?? 30}
              min={5}
              max={120}
              onChange={(v) => setCfg((c) => ({ ...c, auctionTimerSeconds: v }))}
              hint="Clock per mon, started by the first bid. Bids under 10s left reset it to 10s."
            />
            <NumberField
              label="Starting budget"
              value={cfg.startingBudget ?? 100}
              min={10}
              max={1000}
              onChange={(v) => setCfg((c) => ({ ...c, startingBudget: v }))}
              hint="Money per player. Bids start at $1."
            />
            <div className="sm:col-span-2">
              <ToggleField
                label="Reveal"
                value={cfg.revealMode ?? "auction"}
                options={[
                  {
                    value: "auction",
                    label: "On auction",
                    hint: "Each mon revealed as it hits the block",
                  },
                  {
                    value: "roll",
                    label: "On roll",
                    hint: "Whole pool visible up front, auctioned one at a time",
                  },
                ]}
                onChange={(v) => setCfg((c) => ({ ...c, revealMode: v as RevealMode }))}
              />
            </div>
            <div className="sm:col-span-2">
              <ToggleField
                label="Overdrafting"
                value={cfg.allowOverdraft ? "yes" : "no"}
                options={[
                  {
                    value: "no",
                    label: "Off",
                    hint: "Full teams can't bid",
                  },
                  {
                    value: "yes",
                    label: "On",
                    hint: "Full teams may bid; winning forces a swap, released mon requeued",
                  },
                ]}
                onChange={(v) => setCfg((c) => ({ ...c, allowOverdraft: v === "yes" }))}
              />
            </div>
          </>
        )}
        <div className="sm:col-span-2">
          <ToggleField
            label="Forms"
            value={cfg.splitForms ? "split" : "unified"}
            options={[
              {
                value: "split",
                label: "Split forms",
                hint: "Each variant is its own pick · one per species per player",
              },
              { value: "unified", label: "Unified", hint: "All variants under one entry" },
            ]}
            onChange={(v) => setCfg((c) => ({ ...c, splitForms: v === "split" }))}
          />
        </div>
      </fieldset>

      {overCapacity && (
        <div className="rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-sm text-primary">
          Pool too large — not enough eligible Pokémon for the selected split.
        </div>
      )}

      {!hideStart && onStart && (
        <button
          onClick={onStart}
          disabled={overCapacity || !!startDisabledReason}
          title={startDisabledReason ?? undefined}
          className="h-12 w-full rounded-xl bg-primary px-6 text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-md transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {startDisabledReason ?? startLabel}
        </button>
      )}
    </section>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex h-12 items-stretch overflow-hidden rounded-xl border border-border bg-input">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="px-4 text-lg font-bold text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isNaN(v)) return;
            onChange(Math.min(max, Math.max(min, v)));
          }}
          className="w-full bg-transparent text-center text-lg font-bold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="px-4 text-lg font-bold text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function ToggleField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                active
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border bg-input text-muted-foreground hover:border-accent/50"
              }`}
            >
              <div className="font-semibold">{opt.label}</div>
              {opt.hint && <div className="text-[11px] text-muted-foreground">{opt.hint}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
