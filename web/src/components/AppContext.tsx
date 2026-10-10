"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { loadConfig, rememberServerVersion, type AppConfig } from "@/lib/data/config";
import { Resources } from "@/lib/data/resources";
import { loadDecks, saveDecks, type StoredDeck } from "@/lib/data/decks";
import { DuelClient, webSocketTransport, type ChainMode } from "@/lib/game/client";

export interface Settings {
  name: string;
  chainMode: ChainMode;
  /** Pick the first free zone automatically when summoning/setting. */
  autoPlace: boolean;
  defaultDeckId: string | null;
}

const SETTINGS_KEY = "edopro-web:settings";
const DEFAULT_SETTINGS: Settings = { name: "", chainMode: "auto", autoPlace: false, defaultDeckId: null };

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

interface AppState {
  config: AppConfig | null;
  res: Resources | null;
  loading: string | null;
  loadErrors: string[];
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  decks: StoredDeck[];
  setDecks(next: StoredDeck[]): void;
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
  const [decks, setDecksState] = useState<StoredDeck[]>([]);
  const [client, setClient] = useState<DuelClient | null>(null);
  const clientRef = useRef<DuelClient | null>(null);

  useEffect(() => {
    setSettings(readSettings());
    setDecksState(loadDecks());
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
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      clientRef.current?.setChainMode(next.chainMode);
      return next;
    });
  }, []);

  const setDecks = useCallback((next: StoredDeck[]) => {
    setDecksState(next);
    saveDecks(next);
  }, []);

  const openClient = useCallback(
    (serverId: string) => {
      if (!config) throw new Error("Configuration not loaded");
      clientRef.current?.leave();
      const c = new DuelClient({
        name: settings.name || "Player",
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
    [config, res, settings.name, settings.chainMode],
  );

  const closeClient = useCallback(() => {
    clientRef.current?.leave();
    clientRef.current = null;
    setClient(null);
  }, []);

  const value = useMemo<AppState>(
    () => ({ config, res, loading, loadErrors, settings, updateSettings, decks, setDecks, client, openClient, closeClient }),
    [config, res, loading, loadErrors, settings, updateSettings, decks, setDecks, client, openClient, closeClient],
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
