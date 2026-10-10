// Card database: downloads EDOPro .cdb files from the configured backend and
// reads them in the browser with sql.js (SQLite compiled to WebAssembly).

import type { OcgCardData } from "../ocg/types";

export interface CardInfo {
  code: number;
  alias: number;
  setcodes: number[];
  type: number;
  attack: number;
  defense: number;
  level: number;
  lscale: number;
  rscale: number;
  linkMarker: number;
  race: bigint;
  attribute: number;
  /** "ot" column: OCG/TCG/anime/... scope bits. */
  scope: number;
  name: string;
  desc: string;
  strings: string[];
}

export const TYPE = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  NORMAL: 0x10,
  EFFECT: 0x20,
  FUSION: 0x40,
  RITUAL: 0x80,
  SPIRIT: 0x200,
  UNION: 0x400,
  GEMINI: 0x800,
  TUNER: 0x1000,
  SYNCHRO: 0x2000,
  TOKEN: 0x4000,
  QUICKPLAY: 0x10000,
  CONTINUOUS: 0x20000,
  EQUIP: 0x40000,
  FIELD: 0x80000,
  COUNTER: 0x100000,
  FLIP: 0x200000,
  TOON: 0x400000,
  XYZ: 0x800000,
  PENDULUM: 0x1000000,
  LINK: 0x4000000,
  SKILL: 0x8000000,
} as const;

export const EXTRA_DECK_TYPES = TYPE.FUSION | TYPE.SYNCHRO | TYPE.XYZ | TYPE.LINK;

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => {
    exec(sql: string): { columns: string[]; values: unknown[][] }[];
    close(): void;
  };
}

declare global {
  interface Window {
    initSqlJs?: (cfg: { locateFile: (f: string) => string }) => Promise<SqlJsStatic>;
  }
}

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** Loads sql.js from /sqljs (copied there from node_modules by scripts/copy-sqljs.mjs). */
function loadSqlJs(): Promise<SqlJsStatic> {
  if (sqlPromise) return sqlPromise;
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "") + "/sqljs/";
  sqlPromise = new Promise<SqlJsStatic>((resolve, reject) => {
    const ready = () => {
      if (!window.initSqlJs) return reject(new Error("sql.js failed to load"));
      window.initSqlJs({ locateFile: (f) => base + f }).then(resolve, reject);
    };
    if (window.initSqlJs) return ready();
    const s = document.createElement("script");
    s.src = base + "sql-wasm.js";
    s.async = true;
    s.onload = ready;
    s.onerror = () => reject(new Error("Could not load /sqljs/sql-wasm.js. Did `npm install` run the postinstall step?"));
    document.head.appendChild(s);
  });
  sqlPromise.catch(() => (sqlPromise = null));
  return sqlPromise;
}

function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string" && v) return BigInt(v);
  return 0n;
}

export class CardDatabase {
  readonly cards = new Map<number, CardInfo>();
  /** Card names in lower case for searching, in insertion order. */
  private searchIndex: { code: number; name: string }[] = [];

  get size() {
    return this.cards.size;
  }

  get(code: number): CardInfo | undefined {
    return this.cards.get(code);
  }

  name(code: number): string {
    if (!code) return "Unknown card";
    return this.cards.get(code)?.name ?? `#${code}`;
  }

  /** Loads all databases in order. Returns per-URL errors (missing files are not fatal). */
  async load(urls: string[], onProgress?: (done: number, total: number) => void): Promise<string[]> {
    const SQL = await loadSqlJs();
    const errors: string[] = [];
    let done = 0;
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        const db = new SQL.Database(buf);
        try {
          this.ingest(db);
        } finally {
          db.close();
        }
      } catch (e) {
        errors.push(`${url}: ${(e as Error).message}`);
      }
      onProgress?.(++done, urls.length);
    }
    this.searchIndex = [...this.cards.values()].map((c) => ({ code: c.code, name: c.name.toLowerCase() }));
    return errors;
  }

  private ingest(db: InstanceType<SqlJsStatic["Database"]>) {
    const [datas] = db.exec(
      // 64-bit columns are read as text: sql.js would round them to doubles.
      "SELECT id, ot, alias, CAST(setcode AS TEXT), type, atk, def, level, CAST(race AS TEXT), attribute FROM datas",
    );
    const [texts] = db.exec("SELECT * FROM texts");
    const textMap = new Map<number, unknown[]>();
    const tcols = texts?.columns ?? [];
    const nameIdx = tcols.indexOf("name");
    const descIdx = tcols.indexOf("desc");
    const strIdx = Array.from({ length: 16 }, (_, i) => tcols.indexOf(`str${i + 1}`));
    for (const row of texts?.values ?? []) textMap.set(Number(row[0]), row);
    for (const row of datas?.values ?? []) {
      const [id, ot, alias, setcode, type, atk, def, level, race, attribute] = row;
      const code = Number(id);
      const t = Number(type);
      const lvl = Number(level);
      const sc = toBigInt(setcode);
      const setcodes: number[] = [];
      for (let i = 0n; i < 4n; i++) {
        const s = Number((sc >> (i * 16n)) & 0xffffn);
        if (s) setcodes.push(s);
      }
      const text = textMap.get(code);
      const isLink = (t & TYPE.LINK) !== 0;
      this.cards.set(code, {
        code,
        alias: Number(alias),
        setcodes,
        type: t,
        attack: Number(atk),
        defense: isLink ? 0 : Number(def),
        linkMarker: isLink ? Number(def) : 0,
        level: lvl & 0xff,
        lscale: (lvl >>> 24) & 0xff,
        rscale: (lvl >>> 16) & 0xff,
        race: toBigInt(race),
        attribute: Number(attribute),
        scope: Number(ot),
        name: text && nameIdx >= 0 ? String(text[nameIdx] ?? "") : `#${code}`,
        desc: text && descIdx >= 0 ? String(text[descIdx] ?? "") : "",
        strings: strIdx.map((i) => (text && i >= 0 ? String(text[i] ?? "") : "")),
      });
    }
  }

  /** Text search over names (and passcodes). */
  search(query: string, filter?: (c: CardInfo) => boolean, limit = 60): CardInfo[] {
    const q = query.trim().toLowerCase();
    const out: CardInfo[] = [];
    const asNum = /^\d+$/.test(q) ? Number(q) : null;
    if (asNum !== null) {
      const c = this.cards.get(asNum);
      if (c && (!filter || filter(c))) out.push(c);
    }
    if (!q) return out;
    for (const { code, name } of this.searchIndex) {
      if (out.length >= limit) break;
      if (!name.includes(q)) continue;
      const c = this.cards.get(code)!;
      if (filter && !filter(c)) continue;
      if (c.code !== asNum) out.push(c);
    }
    return out;
  }

  /** Card text for an effect description id (EDOPro's DataManager::GetDesc, non-compat). */
  effectString(code: number, index: number): string | null {
    const c = this.cards.get(code);
    const s = c?.strings[index];
    return s ? s : null;
  }

  /** Shape expected by the vendored opcode evaluator. */
  toOcgData(c: CardInfo): OcgCardData {
    return {
      code: c.code,
      alias: c.alias,
      setcodes: c.setcodes,
      type: c.type,
      level: c.level,
      attribute: c.attribute,
      race: c.race,
      attack: c.attack,
      defense: c.defense,
      lscale: c.lscale,
      rscale: c.rscale,
      link_marker: c.linkMarker,
    };
  }
}
