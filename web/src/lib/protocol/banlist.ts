// Parsing of EDOPro .lflist.conf banlists, including the hash the server uses
// to identify a banlist (see edopro deck_manager.cpp LoadLFListSingle).

export interface Banlist {
  name: string;
  hash: number;
  whitelist: boolean;
  /** card code -> allowed copies (0 forbidden, 1 limited, 2 semi-limited, ...) */
  limits: Map<number, number>;
}

const HASH_MAGIC = 0x7dfcee6a;

function salt(hash: number, code: number, count: number) {
  // Mirrors the C++ uint32 arithmetic (shift counts are masked to 5 bits).
  const a = ((code << 18) | (code >>> 14)) >>> 0;
  const b = ((code << (27 + count)) | (code >>> (5 - count))) >>> 0;
  return (hash ^ a ^ b) >>> 0;
}

export function parseBanlists(text: string): Banlist[] {
  const out: Banlist[] = [];
  let current: Banlist | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!")) {
      if (current) out.push(current);
      current = { name: line.slice(1).trim(), hash: HASH_MAGIC, whitelist: false, limits: new Map() };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("$whitelist")) {
      current.whitelist = true;
      continue;
    }
    const space = line.indexOf(" ");
    if (space < 0) continue;
    const code = Number.parseInt(line.slice(0, space), 10);
    const countMatch = line.slice(space + 1).match(/^\s*(-?\d+)/);
    if (!Number.isFinite(code) || code <= 0 || !countMatch) continue;
    const count = Number.parseInt(countMatch[1], 10);
    current.limits.set(code >>> 0, count);
    current.hash = salt(current.hash, code >>> 0, count);
  }
  if (current) out.push(current);
  return out;
}

/** How many copies of `code` (or its alias) a banlist allows. */
export function allowedCopies(list: Banlist | null, code: number, alias = 0): number {
  if (!list) return 3;
  const key = alias && list.limits.has(alias) ? alias : code;
  const v = list.limits.get(key);
  if (v === undefined) return list.whitelist ? 0 : 3;
  return v;
}
