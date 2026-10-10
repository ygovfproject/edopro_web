// App configuration. URLs come from .env (NEXT_PUBLIC_* variables).

import type { ClientVersion } from "../protocol/packets";

export interface AppConfig {
  /** Base URL of the WebSocket/room-list proxy, e.g. "https://proxy.example.com". */
  proxyUrl: string;
  /** Card image URL template. "{code}" is replaced with the card passcode. */
  cardImageUrl: string;
  /** Optional card back image. When empty a drawn card back is used. */
  cardBackUrl?: string;
  /**
   * Card databases (.cdb). Later entries override earlier ones, like EDOPro expansions.
   * "github:owner/repo[/folder][@branch]" loads every .cdb in that folder.
   */
  databases: string[];
  /** EDOPro strings.conf (system strings, victory reasons, counters, archetypes). */
  stringsUrl?: string;
  /** Banlists (.lflist.conf); "github:owner/repo" entries load every .lflist.conf. */
  banlists?: string[];
  /** Version reported to the server. Updated automatically if the server reports another one. */
  clientVersion: ClientVersion;
}

/** Splits a comma-separated env value into a list. */
function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * All URLs come from .env (NEXT_PUBLIC_* values are inlined at build time, so
 * restart `npm run dev` or rebuild after changing them). Each variable must be
 * referenced literally here for Next.js to inline it.
 */
export const DEFAULT_CONFIG: AppConfig = {
  proxyUrl: process.env.NEXT_PUBLIC_PROXY_URL || "http://localhost:7000",
  cardImageUrl: process.env.NEXT_PUBLIC_CARD_IMAGE_URL || "https://images.ygoprodeck.com/images/cards/{code}.jpg",
  cardBackUrl: process.env.NEXT_PUBLIC_CARD_BACK_URL || "",
  databases: list(process.env.NEXT_PUBLIC_DATABASES || "github:ProjectIgnis/BabelCDB"),
  stringsUrl: process.env.NEXT_PUBLIC_STRINGS_URL || "https://raw.githubusercontent.com/ProjectIgnis/Distribution/master/config/strings.conf",
  banlists: list(process.env.NEXT_PUBLIC_BANLISTS || "github:ProjectIgnis/LFLists"),
  clientVersion: { client: [41, 0], core: [11, 0] },
};

const VERSION_KEY = "edopro-web:serverVersion";

export async function loadConfig(): Promise<AppConfig> {
  let cfg: AppConfig = DEFAULT_CONFIG;
  try {
    const learned = localStorage.getItem(VERSION_KEY);
    if (learned) cfg = { ...cfg, clientVersion: JSON.parse(learned) };
  } catch {
    /* storage unavailable */
  }
  return cfg;
}

export function rememberServerVersion(v: ClientVersion) {
  try {
    localStorage.setItem(VERSION_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function cardImage(cfg: AppConfig, code: number) {
  return cfg.cardImageUrl.replaceAll("{code}", String(code));
}

/**
 * Expands "github:owner/repo[/folder][@branch]" entries into the raw URLs of
 * every file in that folder with the given extension, using the GitHub API.
 * Plain URLs are returned unchanged. raw.githubusercontent.com sends CORS
 * headers, so the browser can download those files directly.
 */
export async function expandSources(entries: string[], ext: string, first: string[] = []): Promise<{ urls: string[]; errors: string[] }> {
  const urls: string[] = [];
  const errors: string[] = [];
  for (const entry of entries) {
    const m = entry.match(/^github:([^/@]+)\/([^/@]+)(?:\/([^@]*))?(?:@(.+))?$/);
    if (!m) {
      urls.push(entry);
      continue;
    }
    const [, owner, repo, folder = "", branch] = m;
    const api = `https://api.github.com/repos/${owner}/${repo}/contents${folder ? `/${folder}` : ""}${branch ? `?ref=${encodeURIComponent(branch)}` : ""}`;
    try {
      const res = await fetch(api, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = (await res.json()) as { name: string; type: string; download_url: string | null }[];
      const files = list
        .filter((f) => f.type === "file" && f.download_url && f.name.toLowerCase().endsWith(ext))
        .sort((a, b) => {
          // Base files (e.g. cards.cdb) load first so expansions can override them.
          const fa = first.indexOf(a.name);
          const fb = first.indexOf(b.name);
          if (fa !== fb) return (fa < 0 ? Infinity : fa) - (fb < 0 ? Infinity : fb);
          return a.name.localeCompare(b.name);
        });
      urls.push(...files.map((f) => f.download_url!));
    } catch (e) {
      // GitHub API limits anonymous calls to 60/hour per IP. Fall back to the base files.
      errors.push(`${entry}: could not list files (${(e as Error).message})`);
      const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch ?? "master"}/${folder ? `${folder}/` : ""}`;
      urls.push(...first.map((f) => raw + f));
    }
  }
  return { urls, errors };
}
