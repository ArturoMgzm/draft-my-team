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

export type RoomRow = {
  code: string;
  host_id: string;
  config: Config;
  status: "lobby" | "drafting" | "finished";
  pool: DraftEntry[];
  picks: { entryId: string; playerId: string }[];
  player_order: string[];
  host_override: boolean;
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
  | { type: "pick"; entryId: string; forPlayer?: string };

export async function applyRoomAction(
  code: string,
  playerId: string,
  action: RoomAction,
) {
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