import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchRoom,
  fetchRoomPlayers,
  type RoomPlayerRow,
  type RoomRow,
} from "@/lib/room-client";

export type RoomState = {
  room: RoomRow | null;
  players: RoomPlayerRow[];
  loading: boolean;
  error: string | null;
};

export function useRoom(code: string | null): RoomState & { refresh: () => void } {
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<RoomPlayerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tick = useRef(0);

  useEffect(() => {
    if (!code) {
      setRoom(null);
      setPlayers([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    const upper = code.toUpperCase();

    const load = async () => {
      try {
        const [r, p] = await Promise.all([fetchRoom(upper), fetchRoomPlayers(upper)]);
        if (!alive) return;
        setRoom(r);
        setPlayers(p);
      } catch (err) {
        if (alive) setError(String(err));
      } finally {
        if (alive) setLoading(false);
      }
    };

    void load();

    const channel = supabase
      .channel(`room-${upper}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `code=eq.${upper}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_players",
          filter: `room_code=eq.${upper}`,
        },
        () => void load(),
      )
      .subscribe();

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, tick.current]);

  return {
    room,
    players,
    loading,
    error,
    refresh: () => {
      tick.current += 1;
    },
  };
}