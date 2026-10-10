// Decks uploaded from the player's computer. They are kept in this browser's
// localStorage so they survive a reload; the .ydk files stay the source of truth.

import { parseYdk, parseYdke, type Deck } from "../protocol/ydk";
import { EXTRA_DECK_TYPES, type CardDatabase } from "./cards";

export interface StoredDeck {
  id: string;
  name: string;
  deck: Deck;
  addedAt: number;
}

const KEY = "edopro-web:decks";

export function loadDecks(): StoredDeck[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveDecks(decks: StoredDeck[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks));
    return true;
  } catch {
    return false;
  }
}

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Parses an uploaded file (.ydk) or pasted text (ydk content or a ydke:// URL). */
export function deckFromText(name: string, text: string): StoredDeck | null {
  const trimmed = text.trim();
  const deck = trimmed.startsWith("ydke://") ? parseYdke(trimmed) : parseYdk(text);
  if (!deck || deck.main.length + deck.extra.length + deck.side.length === 0) return null;
  return { id: newId(), name: name.replace(/\.ydk$/i, "") || "Deck", deck, addedAt: Date.now() };
}

/**
 * Re-sorts Main/Extra using the card database: some .ydk exporters put
 * Extra Deck monsters in #main. The server splits them by type anyway.
 */
export function normaliseDeck(deck: Deck, db: CardDatabase): Deck {
  const main: number[] = [];
  const extra: number[] = [];
  for (const code of [...deck.main, ...deck.extra]) {
    const c = db.get(code);
    if (c && c.type & EXTRA_DECK_TYPES && !(c.type & 0x4000)) extra.push(code);
    else main.push(code);
  }
  return { main, extra, side: [...deck.side] };
}

export function unknownCards(deck: Deck, db: CardDatabase): number[] {
  const all = new Set([...deck.main, ...deck.extra, ...deck.side]);
  return [...all].filter((c) => !db.get(c));
}
