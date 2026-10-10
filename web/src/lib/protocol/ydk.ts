// Deck file formats: EDOPro/YGOPro .ydk text files and ydke:// URLs.

export interface Deck {
  main: number[];
  extra: number[];
  side: number[];
}

export function parseYdk(text: string): Deck {
  const deck: Deck = { main: [], extra: [], side: [] };
  let section: keyof Deck = "main";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (lower.startsWith("#main")) {
      section = "main";
      continue;
    }
    if (lower.startsWith("#extra")) {
      section = "extra";
      continue;
    }
    if (lower.startsWith("!side")) {
      section = "side";
      continue;
    }
    if (line.startsWith("#") || line.startsWith("!")) continue;
    const m = line.match(/^(\d+)/);
    if (!m) continue;
    const code = Number.parseInt(m[1], 10);
    if (code > 0 && code <= 0xffffffff) deck[section].push(code);
  }
  return deck;
}

export function toYdk(deck: Deck, comment = "created by EDOPro Web"): string {
  return [
    `#${comment}`,
    "#main",
    ...deck.main.map(String),
    "#extra",
    ...deck.extra.map(String),
    "!side",
    ...deck.side.map(String),
    "",
  ].join("\n");
}

function decodeBase64Codes(b64: string): number[] {
  if (!b64) return [];
  const bin = atob(b64);
  const out: number[] = [];
  for (let i = 0; i + 3 < bin.length; i += 4) {
    out.push(
      (bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0,
    );
  }
  return out;
}

/** Parses a ydke://main!extra!side! URL (base64 little-endian u32 arrays). */
export function parseYdke(url: string): Deck | null {
  const m = url.trim().match(/^ydke:\/\/([^!]*)!([^!]*)!([^!]*)!?$/);
  if (!m) return null;
  try {
    return { main: decodeBase64Codes(m[1]), extra: decodeBase64Codes(m[2]), side: decodeBase64Codes(m[3]) };
  } catch {
    return null;
  }
}

export function deckSize(d: Deck) {
  return d.main.length + d.extra.length + d.side.length;
}
