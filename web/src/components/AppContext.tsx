"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { loadConfig, rememberServerVersion, type AppConfig } from "@/lib/data/config";
import { Resources } from "@/lib/data/resources";
import { cloudDeckToStored, type StoredDeck } from "@/lib/data/decks";
import { CloudApi, CloudError, type CloudDeck, type CloudUser } from "@/lib/data/cloud";
import { DuelClient, webSocketTransport, type ChainMode } from "@/lib/game/client";

export interface Settings {
  chainMode: ChainMode;
  /** Pick the first free zone automatically when summoning/setting. */
  autoPlace: boolean;
  /** The deck last picked in a room (preselected next time). */
  defaultDeckId: string | null;
  /** Name used while not signed in (edopro_web_xxxxxx), kept so it stays the same. */
  guestName: string;
}

const SETTINGS_KEY = "edopro-web:settings";
const DEFAULT_SETTINGS: Settings = { chainMode: "auto", autoPlace: false, defaultDeckId: null, guestName: "" };

/** EDOPro names are at most 19 characters: "edopro_web_" + 6 = 17. */
function newGuestName() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return "edopro_web_" + Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

function readSettings(): Settings {
  let s = DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      // "name" was the old hand-typed duelist name; it isn't used any more.
      const { name: _oldName, ...saved } = JSON.parse(raw); // eslint-disable-line @typescript-eslint/no-unused-vars
      s = { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch {
    /* ignore */
  }
  if (!/^edopro_web_[a-z0-9]{6}$/.test(s.guestName)) {
    s = { ...s, guestName: newGuestName() };
    writeSettings(s);
  }
  return s;
}

function writeSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

interface AppState {
  config: AppConfig | null;
  res: Resources | null;
  loading: string | null;
  loadErrors: string[];
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;

  /** The accounts API on the proxy (null until the config is loaded). */
  cloud: CloudApi | null;
  /** The signed-in user, or null for a guest. */
  user: CloudUser | null;
  /** False until a saved session has been checked (avoids flashing "Sign in"). */
  authReady: boolean;
  /** The name shown to other players: the username, or the guest name. */
  playerName: string;
  signedIn(user: CloudUser): void;
  signOut(): Promise<void>;

  /** The signed-in user's decks (from the server; nothing is kept in this browser). */
  decks: StoredDeck[];
  deckLimit: number;
  decksLoading: boolean;
  refreshDecks(): Promise<void>;
  /** Uploads a deck; `ydk` is the original .ydk text. */
  uploadDeck(name: string, ydk: string): Promise<StoredDeck>;
  renameDeck(id: string, name: string): Promise<void>;
  deleteDeck(id: string): Promise<void>;

  client: DuelClient | null;
  /** Creates a fresh client bound to an EDOPro server (through the proxy). */
  openClient(serverId: string): DuelClient;
  closeClient(): void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [res, setRes] = useState<Resources | null>(null);
  const [loading, setLoading] = useState<string | null>("Loading configuration…");
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [user, setUser] = useState<CloudUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudDecks, setCloudDecks] = useState<CloudDeck[]>([]);
  const [deckLimit, setDeckLimit] = useState(10);
  const [decksLoading, setDecksLoading] = useState(false);
  const [client, setClient] = useState<DuelClient | null>(null);
  const clientRef = useRef<DuelClient | null>(null);

  useEffect(() => {
    setSettings(readSettings());
    let cancelled = false;
    (async () => {
      const cfg = await loadConfig();
      if (cancelled) return;
      setConfig(cfg);
      const r = new Resources(cfg);
      try {
        await r.load((t) => !cancelled && setLoading(t));
      } catch (e) {
        r.errors.push(String((e as Error)?.message ?? e));
      }
      if (cancelled) return;
      setRes(r);
      setLoadErrors(r.errors);
      setLoading(null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeSettings(next);
      clientRef.current?.setChainMode(next.chainMode);
      return next;
    });
  }, []);

  /* ---------- account ---------- */

  const cloud = useMemo(() => (config?.proxyUrl ? new CloudApi(config.proxyUrl) : null), [config?.proxyUrl]);

  const forgetUser = useCallback(() => {
    setUser(null);
    setCloudDecks([]);
  }, []);

  /** Runs a cloud call; a 401 means the session is gone, so the user is signed out. */
  const guard = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof CloudError && e.status === 401) forgetUser();
        throw e;
      }
    },
    [forgetUser],
  );

  const refreshDecks = useCallback(async () => {
    if (!cloud) return;
    setDecksLoading(true);
    try {
      const r = await guard(() => cloud.listDecks());
      setCloudDecks(r.decks);
      setDeckLimit(r.limit);
    } finally {
      setDecksLoading(false);
    }
  }, [cloud, guard]);

  // Resume a saved session.
  useEffect(() => {
    if (!cloud) return;
    if (!cloud.signedIn) {
      setAuthReady(true);
      return;
    }
    let gone = false;
    cloud
      .me()
      .then((u) => {
        if (gone) return;
        setUser(u);
        refreshDecks().catch(() => {});
      })
      .catch(() => {
        /* signed out, expired, or the server is unreachable: continue as a guest */
      })
      .finally(() => !gone && setAuthReady(true));
    return () => {
      gone = true;
    };
  }, [cloud, refreshDecks]);

  const signedIn = useCallback(
    (u: CloudUser) => {
      setUser(u);
      refreshDecks().catch(() => {});
    },
    [refreshDecks],
  );

  const signOut = useCallback(async () => {
    try {
      await cloud?.logout();
    } catch {
      /* the token is dropped either way */
    }
    forgetUser();
  }, [cloud, forgetUser]);

  /* ---------- decks (server only) ---------- */

  const decks = useMemo(() => cloudDecks.map((d) => cloudDeckToStored(d, res?.cards)), [cloudDecks, res]);

  const uploadDeck = useCallback(
    async (name: string, ydk: string) => {
      if (!cloud) throw new CloudError(0, "Not connected.");
      const d = await guard(() => cloud.createDeck(name, ydk));
      setCloudDecks((prev) => [...prev, d]);
      return cloudDeckToStored(d, res?.cards);
    },
    [cloud, guard, res],
  );

  const renameDeck = useCallback(
    async (id: string, name: string) => {
      if (!cloud) return;
      const old = cloudDecks.find((d) => d.id === id);
      if (!old) return;
      // The contents stay exactly as uploaded; only the name changes.
      const d = await guard(() => cloud.updateDeck(id, name, old.ydk));
      setCloudDecks((prev) => prev.map((x) => (x.id === id ? d : x)));
    },
    [cloud, cloudDecks, guard],
  );

  const deleteDeck = useCallback(
    async (id: string) => {
      if (!cloud) return;
      await guard(() => cloud.deleteDeck(id));
      setCloudDecks((prev) => prev.filter((x) => x.id !== id));
    },
    [cloud, guard],
  );

  /* ---------- duel client ---------- */

  const playerName = user?.username ?? settings.guestName;

  const openClient = useCallback(
    (serverId: string) => {
      if (!config) throw new Error("Configuration not loaded");
      clientRef.current?.leave();
      const c = new DuelClient({
        name: playerName || "Player",
        version: config.clientVersion,
        transport: webSocketTransport(config.proxyUrl, serverId),
        formatter: res?.formatter(),
        chainMode: settings.chainMode,
        onVersionLearned: (v) => {
          rememberServerVersion(v);
          setConfig((cfg) => (cfg ? { ...cfg, clientVersion: v } : cfg));
        },
      });
      c.serverId = serverId;
      clientRef.current = c;
      setClient(c);
      return c;
    },
    [config, res, playerName, settings.chainMode],
  );

  const closeClient = useCallback(() => {
    clientRef.current?.leave();
    clientRef.current = null;
    setClient(null);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      config,
      res,
      loading,
      loadErrors,
      settings,
      updateSettings,
      cloud,
      user,
      authReady,
      playerName,
      signedIn,
      signOut,
      decks,
      deckLimit,
      decksLoading,
      refreshDecks,
      uploadDeck,
      renameDeck,
      deleteDeck,
      client,
      openClient,
      closeClient,
    }),
    [
      config,
      res,
      loading,
      loadErrors,
      settings,
      updateSettings,
      cloud,
      user,
      authReady,
      playerName,
      signedIn,
      signOut,
      decks,
      deckLimit,
      decksLoading,
      refreshDecks,
      uploadDeck,
      renameDeck,
      deleteDeck,
      client,
      openClient,
      closeClient,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

/** Re-renders whenever the client state changes. */
export function useClientState(client: DuelClient | null): number {
  return useSyncExternalStore(
    client ? client.subscribe : noopSubscribe,
    client ? client.getRev : zero,
    zero,
  );
}

const noopSubscribe = () => () => {};
const zero = () => 0;
