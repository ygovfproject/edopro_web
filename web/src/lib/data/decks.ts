// Decks. They live on the server (one account, up to 10 decks; see cloud.ts) and are
// kept exactly as uploaded; this browser only holds them in memory.

import { parseYdk, parseYdke, toYdk, type Deck } from "../protocol/ydk";
import { EXTRA_DECK_TYPES, type CardDatabase } from "./cards";
import type { CloudDeck } from "./cloud";

export interface StoredDeck {
  /** The server's deck id. */
  id: string;
  name: string;
  deck: Deck;
  /** The .ydk exactly as uploaded. */
  ydk: string;
  addedAt: number;
  updatedAt: number;
}

export function cloudDeckToStored(d: CloudDeck, db?: CardDatabase): StoredDeck {
  const deck = parseYdk(d.ydk);
  return {
    id: d.id,
    name: d.name,
    deck: db ? normaliseDeck(deck, db) : deck,
    ydk: d.ydk,
    addedAt: Date.parse(d.createdAt),
    updatedAt: Date.parse(d.updatedAt),
  };
}

/** A deck read from a file or pasted text, ready to upload. */
export interface DeckUpload {
  name: string;
  deck: Deck;
  /** What gets stored: the original .ydk text when possible. */
  ydk: string;
}

// What the server accepts as a .ydk line (proxy/src/accounts.mjs).
const YDK_LINE = /^(?:\s*|[#!].*|\d{1,10}\s*)$/;

/** Parses an uploaded file (.ydk) or pasted text (.ydk content or a ydke:// URL). */
export function deckFromText(name: string, text: string): DeckUpload | null {
  const clean = text.replace(/^﻿/, "");
  const trimmed = clean.trim();
  const isYdke = trimmed.startsWith("ydke://");
  const deck = isYdke ? parseYdke(trimmed) : parseYdk(clean);
  if (!deck || deck.main.length + deck.extra.length + deck.side.length === 0) return null;
  // Keep the file as it is unless it has lines the server wouldn't take (or is a
  // ydke:// link); then store the same cards as a plain .ydk.
  const original = !isYdke && clean.split(/\r?\n/).every((l) => YDK_LINE.test(l));
  return { name: deckName(name), deck, ydk: original ? clean : toYdk(deck) };
}

/** Deck names: no ".ydk", no control characters, at most 64 characters. */
export function deckName(name: string) {
  const n = name
    .replace(/\.ydk$/i, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 64)
    .trim();
  return n || "Deck";
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

/* ---------- decks saved in this browser by earlier versions ---------- */

const LEGACY_KEY = "edopro-web:decks";

/** Decks an earlier version kept in localStorage, so they can be uploaded once. */
export function legacyLocalDecks(): DeckUpload[] {
  try {
    const list = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]");
    if (!Array.isArray(list)) return [];
    return list
      .filter((d) => d && typeof d.name === "string" && d.deck && Array.isArray(d.deck.main))
      .map((d) => ({ name: deckName(d.name), deck: d.deck as Deck, ydk: toYdk(d.deck as Deck) }));
  } catch {
    return [];
  }
}

export function clearLegacyLocalDecks() {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}
