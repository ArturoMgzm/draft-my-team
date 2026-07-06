import { supabase } from "@/integrations/supabase/client";
import type { Config, DraftEntry } from "@/lib/draft-engine";

const DEVICE_KEY = "draft:deviceId";

export function getDeviceId(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function generateRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

export type AuctionState = {
  /** Entry ids still waiting to be auctioned, in order. */
  queue?: string[];
  /** Entry id currently on the block, or null between auctions. */
  current?: string | null;
  /** Highest bid so far; 0 = no bids yet. */
  bid?: number;
  /** Player holding the highest bid. */
  bidder?: string | null;
  /** Remaining budget per player id. */
  money?: Record<string, number>;
  /** Set when an overdraft win is waiting for the winner to release a mon. */
  pending_swap?: { player: string; won: string } | null;
  /** How the previous mon left the block — drives client animations. */
  last?: {
    entry: string;
    player: string | null;
    price: number;
    random: boolean;
    skipped: boolean;
  } | null;
  /** Bumps on every resolution so clients can detect state transitions. */
  seq?: number;
};

export type RoomRow = {
  code: string;
  host_id: string;
  config: Config;
  status: "lobby" | "drafting" | "finished";
  pool: DraftEntry[];
  picks: { entryId: string; playerId: string }[];
  player_order: string[];
  host_override: boolean;
  /** Absolute server-time deadline for the host's teambuilding timer, or
   * null if no timer is running. Every client derives its own countdown
   * from this shared anchor (see useRoom's realtime subscription), rather
   * than trusting each client's own clock for anything but rendering. */
  timer_ends_at: string | null;
  /** Original length of the current timer, for a progress bar. Null when
   * no timer is running. */
  timer_duration_seconds: number | null;
  /** Auction-mode state (empty object outside auction mode). */
  auction: AuctionState;
  /** Deadline of the auction currently on the block, or null. */
  auction_ends_at: string | null;
};

export type RoomPlayerRow = {
  room_code: string;
  player_id: string;
  username: string;
  joined_at: string;
};

export type RoomAction =
  | { type: "create"; config: Config; username: string }
  | { type: "join"; username: string }
  | { type: "leave" }
  | { type: "update_config"; config: Config }
  | { type: "set_order"; order: string[] }
  | { type: "kick"; player_id: string }
  | { type: "toggle_override"; value?: boolean }
  | { type: "begin"; pool: DraftEntry[] }
  | { type: "undo" }
  | { type: "redraft"; pool: DraftEntry[] }
  | { type: "cancel" }
  | { type: "set_timer"; seconds: number | null }
  | { type: "bid"; amount: number }
  | { type: "resolve_auction" }
  | { type: "swap_out"; entryId: string }
  | { type: "pick"; entryId: string; forPlayer?: string };

export async function applyRoomAction(code: string, playerId: string, action: RoomAction) {
  const { data, error } = await supabase.rpc("apply_room_action", {
    _code: code.toUpperCase(),
    _player_id: playerId,
    _action: action as never,
  });
  if (error) throw error;
  return data;
}

export async function fetchRoom(code: string): Promise<RoomRow | null> {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data ? (data as unknown as RoomRow) : null;
}

export async function fetchRoomPlayers(code: string): Promise<RoomPlayerRow[]> {
  const { data, error } = await supabase
    .from("room_players")
    .select("*")
    .eq("room_code", code.toUpperCase())
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RoomPlayerRow[];
}
