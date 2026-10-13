"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, CircularProgress, Stack, Typography } from "@mui/material";
import { AppProvider, useApp, useClientState } from "../AppContext";
import type { RoomEntry } from "../online/OnlineLobby";
import DuelView from "../duel/DuelView";

/** After a match ends (or the connection drops), the next duel is joined this long after. */
const NEXT_AFTER_MS = 5000;
/** With nothing to watch, look again this often. */
const RETRY_MS = 5000;
/** Joining a room that never shows a duel (gone, full of spectators...): give up after this. */
const JOIN_TIMEOUT_MS = 15000;

const DUEL_STATUSES = new Set(["rps", "rps-wait", "choose-order", "order-wait", "dueling", "siding", "side-wait", "rematch", "rematch-wait"]);

/**
 * Random duel watching (its own page, not in the navbar): joins a random duel in progress
 * on any server as a spectator (rooms with a password are skipped), and when it ends, the
 * next one. "Next room" skips to another duel right away.
 */
export default function RandomWatch() {
  return (
    <AppProvider>
      <Watcher />
    </AppProvider>
  );
}

function Watcher() {
  const { loading, config, client, openClient, closeClient } = useApp();
  useClientState(client);
  const proxy = config?.proxyUrl.replace(/\/+$/, "") ?? "";
  const [message, setMessage] = useState("Looking for a duel…");
  /** Rooms already watched (server:room), so "next" goes somewhere new until all were seen. */
  const seen = useRef(new Set<string>());
  const current = useRef<string | null>(null);
  const searching = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  const next = useCallback(async () => {
    if (!proxy || searching.current) return;
    searching.current = true;
    if (retry.current) clearTimeout(retry.current);
    retry.current = null;
    closeClient();
    setMessage("Looking for a duel…");
    try {
      // Every server's open duels (started, no password); servers that fail are skipped.
      let servers: { id: string }[] = [];
      try {
        const r = await fetch(`${proxy}/api/servers`);
        if (r.ok) servers = ((await r.json()) as { servers: { id: string }[] }).servers ?? [];
      } catch {
        /* the proxy is unreachable: retried below */
      }
      const lists = await Promise.all(
        servers.map(async (s) => {
          try {
            const r = await fetch(`${proxy}/api/servers/${encodeURIComponent(s.id)}/rooms`);
            const j = (await r.json()) as { rooms?: RoomEntry[] };
            return (Array.isArray(j.rooms) ? j.rooms : []).filter((room) => room.istart !== "waiting" && !room.needpass).map((room) => ({ server: s.id, room: room.roomid }));
          } catch {
            return [];
          }
        }),
      );
      const all = lists.flat().filter((x) => `${x.server}:${x.room}` !== current.current);
      let fresh = all.filter((x) => !seen.current.has(`${x.server}:${x.room}`));
      if (!fresh.length && all.length) {
        // Watched them all: start over.
        seen.current.clear();
        fresh = all;
      }
      if (!fresh.length) {
        current.current = null;
        setMessage(servers.length ? "No duels to watch right now. Checking again…" : "Can't reach the servers. Trying again…");
        retry.current = setTimeout(() => next(), RETRY_MS);
        return;
      }
      const pick = fresh[Math.floor(Math.random() * fresh.length)];
      const key = `${pick.server}:${pick.room}`;
      seen.current.add(key);
      current.current = key;
      setMessage("Joining…");
      openClient(pick.server).join(pick.room, "");
    } finally {
      searching.current = false;
    }
  }, [proxy, openClient, closeClient]);

  // Start once everything is loaded.
  useEffect(() => {
    if (!loading && config) next();
    return () => {
      if (retry.current) clearTimeout(retry.current);
    };
  }, [loading, config]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = client?.status;
  const ended = !!client && status === "closed";
  const watching = !!client && (DUEL_STATUSES.has(status ?? "") || (status === "closed" && client.duel.started));

  // The match ended or the connection dropped: on to the next duel after a moment (right
  // away if no duel was ever shown).
  useEffect(() => {
    if (!ended) return;
    const t = setTimeout(next, client!.duel.started ? NEXT_AFTER_MS : 0);
    return () => clearTimeout(t);
  }, [ended, client, next]);

  // A room that never shows a duel (it went back to the lobby, or the join hangs): skip it.
  useEffect(() => {
    if (!client || watching) return;
    const t = setTimeout(next, JOIN_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [client, watching, next]);

  if (client && watching) {
    return <DuelView key={current.current ?? ""} client={client} onNext={next} nextAfter={ended ? NEXT_AFTER_MS : undefined} />;
  }
  return (
    <Stack sx={{ height: "100vh", alignItems: "center", justifyContent: "center" }} spacing={2}>
      <CircularProgress />
      <Typography color="text.secondary">{loading || message}</Typography>
      {!loading && client && (
        <Button variant="outlined" onClick={next}>
          Next room
        </Button>
      )}
    </Stack>
  );
}
