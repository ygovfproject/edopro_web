"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Tooltip } from "@mui/material";
import { CardImage, arrivalTime, cardHeight } from "../CardImage";
import { useApp } from "../AppContext";
import { LOC, POS, type DuelCard, type DuelState } from "@/lib/game/duel";
import { zoneKey, type Zone } from "@/lib/game/actions";
import { fieldLayout } from "@/lib/game/layout";
import { HAND_STEP, attributeColor, motion, type PickForm } from "@/lib/game/motion";
import { PickLayer } from "./fx/MaterialForm";

export interface ZoneGlow {
  id: number;
  color: string;
  delay: number;
  /** Also blink the card in the zone. */
  blink: boolean;
}

export interface BoardProps {
  duel: DuelState;
  cardWidth: number;
  /** Duel flags of the room: decide which zones exist (EMZ, pendulum zones, 3-column field). */
  duelFlags: bigint;
  /** Cards that have actions available (by DuelCard id). */
  actionable: Set<number>;
  /** Cards related to the hovered card (equips / targets). */
  linked: Set<number>;
  /** Chain link numbers by DuelCard id. */
  chainLinks: Map<number, number[]>;
  /** Zones that can be clicked (SELECT_PLACE). */
  selectableZones: Set<string>;
  selectedZones: Set<string>;
  /** Cards that can be chosen right on the board (a card prompt), and those picked so far. */
  selectCards?: Set<number>;
  pickedCards?: Set<number>;
  /** Zones the hovered Link Monster points to. */
  pointedZones?: Set<string>;
  disabledZones: Set<string>;
  onCardClick: (card: DuelCard, el: HTMLElement) => void;
  onZoneClick: (zone: Zone) => void;
  onPileClick: (player: number, location: number) => void;
  /** Whether a pile's list can be opened (no peeking into a Deck, or an Extra Deck that isn't ours). */
  canOpenPile: (player: number, location: number) => boolean;
  onHover: (card: DuelCard | null, code: number) => void;
  /** Click on an Xyz Monster's material count: show the materials. */
  onMaterialsClick?: (card: DuelCard) => void;
  /** Zones that glow briefly (activation, chain resolving, Special Summon): zone key -> glow. */
  glowZones?: Map<string, ZoneGlow>;
  /** Picked Synchro/Xyz/Link materials and how they look meanwhile (by DuelCard id). */
  picks?: Map<number, PickForm>;
  /** Shown in the middle of the field, between the two centre Monster Zones. */
  center?: React.ReactNode;
  /** MR3 only: hands drawn inside the board, between Extra Deck and Deck. */
  myHand?: React.ReactNode;
  oppHand?: React.ReactNode;
}

/** A picked Link material: the card turns white and shines in `color`. */
function glowPick(color: string) {
  return {
    filter: `grayscale(1) brightness(1.9) drop-shadow(0 0 2px #ffffff) drop-shadow(0 0 7px ${color}) drop-shadow(0 0 14px ${color})`,
    animation: "linkPickPulse 1100ms ease-in-out infinite alternate",
    "@keyframes linkPickPulse": {
      from: { filter: `grayscale(1) brightness(1.9) drop-shadow(0 0 2px #ffffff) drop-shadow(0 0 7px ${color}) drop-shadow(0 0 14px ${color})` },
      to: { filter: `grayscale(1) brightness(2.1) drop-shadow(0 0 3px #ffffff) drop-shadow(0 0 10px ${color}) drop-shadow(0 0 22px ${color})` },
    },
  };
}

/** White over the picked Link material's picture, so it reads as a white card. */
const glowPickVeil = {
  position: "absolute",
  inset: 0,
  borderRadius: "4px",
  bgcolor: "rgba(255,255,255,.72)",
  pointerEvents: "none",
} as const;

function isFaceDown(c: DuelCard) {
  return (c.position & POS.FACEDOWN) !== 0;
}

function isDefense(c: DuelCard) {
  return (c.position & POS.DEFENSE) !== 0;
}

export default function Board(p: BoardProps) {
  const { duel, cardWidth: W } = p;
  const { res } = useApp();
  const H = cardHeight(W);
  const cell = H + 6;
  const me = duel.me;
  const opp = 1 - me;

  const layout = fieldLayout(p.duelFlags);
  const { emz, separatePz } = layout;
  const attackFrom = duel.attack?.attacker ?? null;
  const attackTo = duel.attack?.target ?? null;

  const highlightOf = (card: DuelCard) =>
    // Cards bound to the hovered one (equips, targets) glow white, over any other highlight.
    p.linked.has(card.id)
      ? "linked"
      : p.selectCards?.has(card.id)
        ? "select"
        : p.actionable.has(card.id)
          ? "action"
          : card === attackFrom || card === attackTo
            ? "target"
            : null;

  const zone = (player: number, location: number, sequence: number, key: string, gridColumn: number, gridRow: number) => {
    const z: Zone = { player, location, sequence };
    const k = zoneKey(z);
    const pile = duel.pile(player, location) as (DuelCard | null)[];
    const card = pile?.[sequence] ?? null;
    const selectable = p.selectableZones.has(k);
    const selected = p.selectedZones.has(k);
    const pointed = !!p.pointedZones?.has(k);
    const disabled = p.disabledZones.has(k);
    const isMonsterZone = location === LOC.MZONE;
    // MR3's dedicated Pendulum Zones (S/T 6 and 7).
    const pz = location === LOC.SZONE ? layout.pendulumZones : null;
    const isPendulumZone = !!pz && pz.includes(sequence);
    const isLeftPz = !!pz && sequence === pz[0];
    const hiddenFromMe = card && isFaceDown(card) && player !== me;
    const glow = p.glowZones?.get(k);
    const pick = card ? p.picks?.get(card.id) : undefined;
    const negated = !!card && !isFaceDown(card) && (card.status & (0x1 | 0x4000000)) !== 0;
    return (
      <Box
        key={key}
        // Field cells ripple when a summoned card lands (FxOverlay).
        data-cell
        onClick={selectable ? () => p.onZoneClick(z) : undefined}
        sx={{
          gridColumn,
          gridRow,
          width: cell,
          height: cell,
          border: "1px solid",
          borderColor: selected ? "primary.main" : selectable ? "#e6e6e6" : pointed ? "#1ec8ff" : "rgba(255,255,255,0.10)",
          bgcolor: selected ? "rgba(245,197,24,.25)" : selectable ? "rgba(230,230,230,.14)" : disabled ? "rgba(255,80,80,.14)" : "rgba(255,255,255,0.03)",
          backgroundImage:
            isPendulumZone && !selected && !selectable
              ? isLeftPz
                ? "radial-gradient(circle, rgba(66,133,244,.14), transparent 70%)"
                : "radial-gradient(circle, rgba(229,57,53,.14), transparent 70%)"
              : undefined,
          borderStyle: isPendulumZone && separatePz ? "dashed" : "solid",
          borderRadius: 1,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: selectable ? "pointer" : "default",
          boxShadow: selectable
            ? "inset 0 0 12px rgba(230,230,230,.35)"
            : pointed
              ? // Zones the hovered Link Monster points to shine blue.
                "inset 0 0 16px rgba(30,200,255,.6), 0 0 8px rgba(30,200,255,.45)"
              : "none",
          transition: "box-shadow .15s ease, border-color .15s ease",
        }}
      >
        {isPendulumZone && !card && (
          // Pendulum Scale marker: blue diamond for the left zone (S/T 6), red for the right (S/T 7).
          <Box
            title={isLeftPz ? "Left Pendulum Zone" : "Right Pendulum Zone"}
            sx={{
              width: Math.round(cell * 0.28),
              height: Math.round(cell * 0.28),
              transform: "rotate(45deg)",
              borderRadius: "3px",
              bgcolor: isLeftPz ? "rgba(66,133,244,.55)" : "rgba(229,57,53,.55)",
              boxShadow: isLeftPz ? "0 0 10px rgba(66,133,244,.6)" : "0 0 10px rgba(229,57,53,.6)",
              pointerEvents: "none",
            }}
          />
        )}
        {card && isMonsterZone && card.overlays.length > 0 && (
          <XyzMaterials
            key={card.id}
            card={card}
            width={W}
            height={H}
            flipped={player !== me}
            color={attributeColor((card.hasStats ? card.attribute : 0) || (res?.cards.get(card.code)?.attribute ?? 0))}
            onClick={p.onMaterialsClick ? () => p.onMaterialsClick!(card) : undefined}
          />
        )}
        {/* While picked as a material the card turns into its shapes (PickLayer), or, for
            Link materials, stays and turns white with a glow (glowPick). */}
        {card && (
          <Tooltip title={negated ? "Effects negated" : ""} placement="top" disableInteractive>
            <Box
              sx={{
                position: "relative",
                opacity: pick && pick.shape !== "glow" ? 0 : 1,
                transform: pick && pick.shape !== "glow" ? "scale(.75)" : "none",
                transition: "opacity .25s ease, transform .25s ease, filter .25s ease",
                ...(pick?.shape === "glow" ? glowPick(pick.color) : {}),
              }}
            >
              <CardImage
                // One element per card: a new card in this zone must not inherit the last one's animation.
                key={card.id}
                code={hiddenFromMe ? 0 : card.code}
                width={W}
                faceDown={isFaceDown(card)}
                sideways={isMonsterZone && isDefense(card)}
                flipped={player !== me}
                // STATUS_DISABLED or STATUS_FORBIDDEN, as EDOPro shows its "negated" icon.
                negated={negated}
                highlight={highlightOf(card)}
                selected={p.pickedCards?.has(card.id)}
                trackId={card.id}
                chainLinks={p.chainLinks.get(card.id)}
                onClick={selectable ? undefined : (e) => p.onCardClick(card, e.currentTarget)}
                // A set card of the opponent's that was revealed to us (its code is known) shows in
                // the card details too, even though it stays face-down on the field.
                onHover={() => p.onHover(card, card.code)}
                onLeave={() => p.onHover(null, 0)}
              />
              {pick?.shape === "glow" && <Box sx={glowPickVeil} />}
            </Box>
          </Tooltip>
        )}
        {card && isMonsterZone && <PickLayer form={pick} width={W} height={H} />}
        {card && isMonsterZone && !isFaceDown(card) && card.hasStats && (
          <Box
            sx={{
              position: "absolute",
              bottom: -2,
              left: "50%",
              transform: "translateX(-50%)",
              bgcolor: "rgba(0,0,0,.78)",
              px: 0.5,
              borderRadius: 0.5,
              fontSize: 10,
              lineHeight: 1.4,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            {card.attack < 0 ? "?" : card.attack}
            {card.link ? ` / L${card.link}` : ` / ${card.defense < 0 ? "?" : card.defense}`}
          </Box>
        )}
        {/* Counters, a changed name, negation and materials are listed in the card details on hover. */}
        {card && isPendulumZone && !isFaceDown(card) && (() => {
          // Pendulum Scale: a diamond in the middle of the zone, blue on the left, red on the right.
          const info = card.code ? res?.cards.get(card.code) : undefined;
          if (!((card.type || info?.type || 0) & 0x1000000)) return null;
          const scale = isLeftPz ? card.lscale || info?.lscale : card.rscale || info?.rscale;
          const size = Math.max(18, Math.round(W * 0.34));
          return (
            <Box
              title={isLeftPz ? "Left Pendulum Scale" : "Right Pendulum Scale"}
              sx={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: size,
                height: size,
                transform: "translate(-50%, -50%) rotate(45deg)",
                borderRadius: "4px",
                bgcolor: isLeftPz ? "#1e63d6" : "#c62828",
                border: "2px solid rgba(255,255,255,.9)",
                boxShadow: isLeftPz ? "0 0 10px rgba(66,133,244,.8)" : "0 0 10px rgba(229,57,53,.8)",
                display: "grid",
                placeItems: "center",
                pointerEvents: "none",
                zIndex: 3,
              }}
            >
              <Box component="span" sx={{ transform: "rotate(-45deg)", color: "#fff", fontWeight: 800, fontSize: Math.round(size * 0.5), lineHeight: 1 }}>
                {scale ?? "?"}
              </Box>
            </Box>
          );
        })()}
        {glow && (
          <>
            {/* The zone glows for a moment (activation / resolving / Special Summon). */}
            <Box
              key={`g${glow.id}`}
              sx={{
                position: "absolute",
                inset: -1,
                borderRadius: "3px",
                pointerEvents: "none",
                zIndex: 4,
                opacity: 0,
                animation: `zoneGlow 900ms ease-out ${glow.delay}ms forwards`,
                "@keyframes zoneGlow": {
                  "0%": { opacity: 0 },
                  "25%": { opacity: 1 },
                  "100%": { opacity: 0 },
                },
                boxShadow: `inset 0 0 18px 4px ${glow.color}d9, 0 0 16px 4px ${glow.color}b3`,
                bgcolor: `${glow.color}38`,
              }}
            />
            {glow.blink && card && (
              // ...and the card in it blinks twice.
              <Box
                key={`b${glow.id}`}
                sx={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: isMonsterZone && isDefense(card) ? H : W,
                  height: isMonsterZone && isDefense(card) ? W : H,
                  transform: "translate(-50%, -50%)",
                  borderRadius: "4px",
                  bgcolor: glow.color,
                  mixBlendMode: "overlay",
                  pointerEvents: "none",
                  zIndex: 3,
                  opacity: 0,
                  animation: `cardBlink 700ms ease-in-out ${glow.delay}ms`,
                  "@keyframes cardBlink": { "0%, 50%, 100%": { opacity: 0 }, "25%, 75%": { opacity: 0.85 } },
                }}
              />
            )}
          </>
        )}
      </Box>
    );
  };

  const pile = (player: number, location: number, gridColumn: number, gridRow: number) => {
    const list = duel.pile(player, location) as DuelCard[];
    const top = list[list.length - 1];
    const faceUpTop = top && (location === LOC.GRAVE || (location === LOC.REMOVED && !isFaceDown(top)) || (location === LOC.EXTRA && !isFaceDown(top)));
    const hasAction = list.some((c) => p.actionable.has(c.id));
    // A card in it we can use (rare for a Deck) always opens it.
    const openable = hasAction || p.canOpenPile(player, location);
    const links = list.flatMap((c) => p.chainLinks.get(c.id) ?? []);
    return (
      <Box
        data-cell
        // Cards coming into a hand from here start from this pile (see useMoveAnimation).
        data-pile={`${player}-${location}`}
        key={`pile-${player}-${location}`}
        onClick={openable ? () => p.onPileClick(player, location) : undefined}
        sx={{
          gridColumn,
          gridRow,
          width: cell,
          height: cell,
          border: "1px solid",
          borderColor: hasAction ? "secondary.main" : "rgba(255,255,255,0.10)",
          boxShadow: hasAction ? "0 0 10px rgba(255,213,79,.55)" : "none",
          borderRadius: 1,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: openable ? "pointer" : "default",
          bgcolor: "rgba(255,255,255,0.03)",
        }}
      >
        {top && (
          <CardImage
            // One element per top card (see the zone above).
            key={top.id}
            code={faceUpTop ? top.code : 0}
            width={W}
            faceDown={!faceUpTop}
            sideways={location === LOC.REMOVED}
            // Banished cards are turned a further 180° on top of lying sideways.
            flipped={location === LOC.REMOVED ? player === me : player !== me}
            trackId={top.id}
            chainLinks={links.length ? links : undefined}
            highlight={p.linked.has(top.id) ? "linked" : null}
            onHover={() => faceUpTop && p.onHover(top, top.code)}
          />
        )}
        {list.length > 0 && (
          <Box
            sx={{
              position: "absolute",
              bottom: 2,
              right: 2,
              bgcolor: "rgba(0,0,0,.8)",
              borderRadius: 0.5,
              px: 0.5,
              fontSize: 11,
              fontWeight: 700,
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            {list.length}
          </Box>
        )}
      </Box>
    );
  };

  // Field shape by duel rule:
  //  - MR4/MR5: Extra Monster Zones; Pendulum Zones are S/T zones 0 and 4.
  //  - MR3: no EMZ; separate Pendulum Zones (S/T 6 and 7) beside the Monster Zones.
  //  - MR1/MR2/GOAT: no EMZ, no Pendulum Zones.
  //  - Speed/Rush: 3-column field, only zones 1-3 exist; no EMZ.
  const zoneExists = (seq: number) => layout.has(LOC.MZONE, seq);

  // Rows: MR3 adds a row on each side so the Pendulum Zones sit between
  // Field/GY and Extra Deck/Deck. Columns are always 7.
  const cols = 7;
  const myCol = (seq: number) => 2 + seq;
  const oppCol = (seq: number) => cols + 1 - myCol(seq); // rotated 180°
  const R = separatePz
    ? { oppPiles: 1, oppS: 2, oppM: 3, mid: 4, myM: 5, myS: 6, myPiles: 7, rows: 7 }
    : { oppPiles: 1, oppS: 1, oppM: 2, mid: 3, myM: 4, myS: 5, myPiles: 5, rows: 5 };

  const cells: React.ReactNode[] = [];
  // Opponent (rotated 180°): Deck/GY on their right = my left.
  cells.push(pile(opp, LOC.DECK, 1, R.oppPiles));
  cells.push(pile(opp, LOC.EXTRA, cols, R.oppPiles));
  for (let s = 0; s < 5; s++) if (zoneExists(s)) cells.push(zone(opp, LOC.SZONE, s, `o-s${s}`, oppCol(s), R.oppS));
  if (separatePz) {
    cells.push(zone(opp, LOC.SZONE, 7, "o-p7", 1, R.oppS));
    cells.push(zone(opp, LOC.SZONE, 6, "o-p6", cols, R.oppS));
  }
  cells.push(pile(opp, LOC.GRAVE, 1, R.oppM));
  for (let s = 0; s < 5; s++) if (zoneExists(s)) cells.push(zone(opp, LOC.MZONE, s, `o-m${s}`, oppCol(s), R.oppM));
  cells.push(zone(opp, LOC.SZONE, 5, "o-field", cols, R.oppM));
  // Shared middle row: banished piles, Extra Monster Zones, turn info.
  cells.push(pile(opp, LOC.REMOVED, 1, R.mid));
  if (emz) {
    // Left EMZ (above my zone 1) is my seq 5 / opponent's seq 6; right EMZ is my seq 6 / opponent's seq 5.
    const left = duel.players[opp].mzone[6] ? zone(opp, LOC.MZONE, 6, "emz-l", myCol(1), R.mid) : zone(me, LOC.MZONE, 5, "emz-l", myCol(1), R.mid);
    const right = duel.players[opp].mzone[5] ? zone(opp, LOC.MZONE, 5, "emz-r", myCol(3), R.mid) : zone(me, LOC.MZONE, 6, "emz-r", myCol(3), R.mid);
    cells.push(left, right);
  }
  cells.push(pile(me, LOC.REMOVED, cols, R.mid));
  if (p.center) {
    cells.push(
      <Box key="center" sx={{ gridColumn: myCol(2), gridRow: R.mid, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        {p.center}
      </Box>,
    );
  }
  // Me.
  cells.push(zone(me, LOC.SZONE, 5, "me-field", 1, R.myM));
  for (let s = 0; s < 5; s++) if (zoneExists(s)) cells.push(zone(me, LOC.MZONE, s, `me-m${s}`, myCol(s), R.myM));
  cells.push(pile(me, LOC.GRAVE, cols, R.myM));
  if (separatePz) {
    cells.push(zone(me, LOC.SZONE, 6, "me-p6", 1, R.myS));
    cells.push(zone(me, LOC.SZONE, 7, "me-p7", cols, R.myS));
  }
  for (let s = 0; s < 5; s++) if (zoneExists(s)) cells.push(zone(me, LOC.SZONE, s, `me-s${s}`, myCol(s), R.myS));
  cells.push(pile(me, LOC.EXTRA, 1, R.myPiles));
  cells.push(pile(me, LOC.DECK, cols, R.myPiles));
  if (separatePz) {
    // MR3: hands share the row with Deck and Extra Deck.
    cells.push(
      <Box key="opp-hand" sx={{ gridColumn: `2 / ${cols}`, gridRow: R.oppPiles, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {p.oppHand}
      </Box>,
      <Box key="my-hand" sx={{ gridColumn: `2 / ${cols}`, gridRow: R.myPiles, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {p.myHand}
      </Box>,
    );
  }

  return (
    <Box
      // Big impacts shake the whole field (FxOverlay).
      data-board
      sx={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
        gridTemplateRows: `repeat(${R.rows}, ${cell}px)`,
        gap: "4px",
        justifyContent: "center",
      }}
    >
            {cells}
    </Box>
  );
}

/** An empty hand waits this long for all the cards coming in before laying out their places (ms). */
const HAND_COLLECT_MS = 150;

/** A card that left the hand keeps its place empty this long at least (ms), e.g. when it goes somewhere not drawn. */
const HAND_GAP_MIN = 420;

/**
 * Keeps the hand's layout while cards leave it: a card that left keeps an empty slot of its
 * size where it was until it has arrived where it went (see arrivalTime), then the hand
 * closes up.
 */
function useHandGaps(cards: DuelCard[]) {
  const [, force] = useState(0);
  /** Departed card id -> its index in the row and until when its slot stays. */
  const gaps = useRef(new Map<number, { index: number; until: number; min: number }>());
  // A copy: the duel state changes the hand's list in place.
  const prev = useRef<DuelCard[]>([...cards]);
  const ids = new Set(cards.map((c) => c.id));
  // Found while rendering, so the very first frame without the card already has the slot.
  prev.current.forEach((c, i) => {
    if (!ids.has(c.id) && !gaps.current.has(c.id)) {
      // A card leaving with an effect where it stood (e.g. a Fusion material swirling away)
      // stays hidden at its destination for that long: keep its place at least until then.
      const hold = motion.appear.get(c.id)?.hold ?? 0;
      gaps.current.set(c.id, { index: i, until: 0, min: performance.now() + hold });
    }
  });
  for (const id of [...gaps.current.keys()]) if (ids.has(id)) gaps.current.delete(id);
  prev.current = [...cards];
  useEffect(() => {
    // After the cards' own layout effects: their flights have started, so their arrival is known.
    const now = performance.now();
    let next = Infinity;
    for (const [id, g] of gaps.current) {
      if (g.until === 0) g.until = Math.max(now + HAND_GAP_MIN, g.min, arrivalTime(id) ?? 0);
      next = Math.min(next, g.until);
    }
    if (next === Infinity) return;
    // When the next card has arrived: drop its slot and close up.
    const t = setTimeout(() => {
      const at = performance.now();
      for (const [id, g] of gaps.current) if (g.until <= at) gaps.current.delete(id);
      force((n) => n + 1);
    }, Math.max(0, next - now) + 5);
    return () => clearTimeout(t);
  });
  // The row: the cards, with empty slots where cards left.
  const row: (DuelCard | { gap: number })[] = [...cards];
  [...gaps.current.entries()].sort((x, y) => x[1].index - y[1].index).forEach(([id, g]) => row.splice(Math.min(g.index, row.length), 0, { gap: id }));
  return row;
}

/**
 * Cards coming into the hand join it one after another.
 *  - Into an empty hand: the row is laid out for all of them at once (centred), with an empty
 *    place for each; each card then flies into its own place when its time comes
 *    (motion.handAt), so nothing moves but the cards flying in.
 *  - Into a hand that has cards: each takes its place only once the one before it has landed
 *    (and not before its own time), so it flies to a place that stays put, and the row
 *    re-centres in one slide per card.
 * Returns the cards in the row right now and the places kept for cards still to come.
 */
function useHandSchedule(cards: DuelCard[]) {
  const [, force] = useState(0);
  /** Cards still to join, in the order they came. */
  const queue = useRef<number[]>([]);
  /** Cards whose place is already kept in the row (they came into an empty hand). */
  const reserved = useRef(new Set<number>());
  /** The last card that joined (its landing lets the next one in). */
  const lastJoined = useRef<number | null>(null);
  /** When each queued card may join, counted from when this row first saw it (not from when
   * the game handled the draw: a burst of messages can be handled long before it is shown). */
  const joinAt = useRef(new Map<number, number>());
  const ids = new Set(cards.map((c) => c.id));
  /** An empty hand gathers the cards coming in until then before laying out their places. */
  const collectUntil = useRef(0);
  /** Cards already let in (their own flight is under way or done). */
  const joined = useRef(new Set<number>());
  // Only cards coming from a pile (Deck, GY, banished, Extra Deck) wait for their turn hidden:
  // the pile is still there to see. A card coming from the field takes its place at once and
  // stays visible where it was until it flies (see useMoveAnimation), so it never vanishes.
  const fresh = cards.filter(
    (c) => motion.handAt.has(c.id) && motion.handFrom.has(c.id) && !queue.current.includes(c.id) && !joined.current.has(c.id),
  );
  for (const id of [...joined.current]) if (!ids.has(id)) joined.current.delete(id);
  if (fresh.length) {
    const seen = performance.now();
    // Into an empty hand: nothing in it but these and others of the same batch not yet dealt.
    const empty = cards.every((c) => fresh.includes(c) || reserved.current.has(c.id));
    if (empty) {
      // Gather the whole batch first (the game may send the cards a few messages apart), then
      // lay out all their places at once, centred, and deal them one after another.
      if (collectUntil.current <= seen) collectUntil.current = seen + HAND_COLLECT_MS;
      for (const c of fresh) {
        queue.current.push(c.id);
        reserved.current.add(c.id);
      }
      let at = collectUntil.current;
      for (const id of queue.current) {
        if (!reserved.current.has(id)) continue;
        joinAt.current.set(id, at);
        at += HAND_STEP;
      }
    } else {
      // One after another, after the ones already waiting.
      let at = Math.max(seen, ...queue.current.map((id) => (joinAt.current.get(id) ?? 0) + HAND_STEP));
      for (const c of fresh) {
        queue.current.push(c.id);
        joinAt.current.set(c.id, at);
        at += HAND_STEP;
      }
    }
  }
  queue.current = queue.current.filter((id) => ids.has(id));
  for (const id of [...joinAt.current.keys()]) if (!queue.current.includes(id)) joinAt.current.delete(id);
  for (const id of [...reserved.current]) if (!queue.current.includes(id)) reserved.current.delete(id);
  const now = performance.now();
  let wake = 0;
  // Let in as many as are due.
  while (queue.current.length) {
    const id = queue.current[0];
    const due = joinAt.current.get(id) ?? 0;
    // A kept place doesn't move: no need to wait for the one before to land.
    const landed =
      !reserved.current.has(id) && lastJoined.current !== null && ids.has(lastJoined.current) ? (arrivalTime(lastJoined.current) ?? 0) : 0;
    const at = Math.max(due, landed);
    if (at > now + 15) {
      wake = at;
      break;
    }
    queue.current.shift();
    reserved.current.delete(id);
    joinAt.current.delete(id);
    joined.current.add(id);
    // It flies as soon as it is in the row.
    motion.handAt.set(id, now);
    lastJoined.current = id;
    // The one just let in hasn't started flying yet: if the next waits for its landing, that
    // time is known once it is drawn (checked again after this render).
    if (queue.current.length && !reserved.current.has(queue.current[0])) {
      wake = now + 30;
      break;
    }
  }
  useEffect(() => {
    if (!wake) return;
    const t = setTimeout(() => force((n) => n + 1), Math.max(0, wake - performance.now()));
    return () => clearTimeout(t);
  });
  if (collectUntil.current > now && (!wake || collectUntil.current < wake)) wake = collectUntil.current;
  const waiting = new Set(queue.current);
  // While still gathering, no places yet (they would shift as more cards come).
  const kept = collectUntil.current > now ? new Set<number>() : new Set(reserved.current);
  return { shown: waiting.size ? cards.filter((c) => !waiting.has(c.id)) : cards, kept };
}

/**
 * The order cards are shown in a hand: the cards already shown keep their places, whatever
 * the game does with the hand's order; new cards are added on the right. (The game's own
 * order still decides what is sent back; this is only how the row looks.)
 */
function useStableOrder(cards: DuelCard[]) {
  const order = useRef<number[]>(cards.map((c) => c.id));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const kept = order.current.filter((id) => byId.has(id));
  const added = cards.filter((c) => !kept.includes(c.id)).map((c) => c.id);
  order.current = [...kept, ...added];
  return order.current.map((id) => byId.get(id)!);
}

/** A row of cards in hand, always the same height. */
export function HandRow({
  cards,
  width,
  hidden,
  flipped,
  actionable,
  linked,
  chainLinks,
  selectCards,
  pickedCards,
  onCardClick,
  onHover,
  maxWidth,
}: {
  maxWidth?: number;
  cards: DuelCard[];
  width: number;
  hidden: boolean;
  flipped?: boolean;
  actionable: Set<number>;
  linked: Set<number>;
  chainLinks: Map<number, number[]>;
  /** Cards that can be chosen right here (a card prompt), and those picked so far. */
  selectCards?: Set<number>;
  pickedCards?: Set<number>;
  onCardClick?: (card: DuelCard, el: HTMLElement) => void;
  onHover: (card: DuelCard | null, code: number) => void;
}) {
  const H = cardHeight(width);
  const ordered = useStableOrder(cards);
  const schedule = useHandSchedule(ordered);
  const slots = useHandGaps(schedule.shown);
  // Empty places kept for cards still flying into an empty hand, where they will be.
  // (They came in order into an empty hand, so they follow the ones already in it.)
  for (const c of ordered) if (schedule.kept.has(c.id)) slots.push({ gap: c.id });
  // New cards go on each player's own right: the opponent faces you, so theirs is on your left.
  if (flipped) slots.reverse();
  // Overlap cards when the hand gets large (or doesn't fit the space it has).
  const n = slots.length;
  const overlap =
    maxWidth !== undefined
      ? n > 1
        ? Math.max(0, Math.min(width * 0.75, (n * (width + 4) - 4 - maxWidth) / (n - 1)))
        : 0
      : n > 8
        ? Math.min(width * 0.55, ((n - 8) * width) / n)
        : 0;
  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: maxWidth !== undefined ? "100%" : H + 14, flex: "0 0 auto" }}>
      {slots.map((c, i) => {
        if ("gap" in c) return <Box key={`gap${c.gap}`} sx={{ ml: i === 0 ? 0 : `${4 - overlap}px`, width, height: H, flex: "0 0 auto" }} />;
        const known = !hidden || (c.code !== 0 && c.isPublic);
        return (
          <Box key={c.id} sx={{ ml: i === 0 ? 0 : `${4 - overlap}px`, zIndex: i }}>
            <CardImage
              code={known ? c.code : 0}
              width={width}
              faceDown={!known}
              flipped={flipped}
              trackId={c.id}
              chainLinks={chainLinks.get(c.id)}
              highlight={linked.has(c.id) ? "linked" : selectCards?.has(c.id) ? "select" : actionable.has(c.id) ? "action" : null}
              selected={pickedCards?.has(c.id)}
              onClick={onCardClick ? (e) => onCardClick(c, e.currentTarget) : undefined}
              onHover={() => known && onHover(c, c.code)}
              onLeave={() => onHover(null, 0)}
            />
          </Box>
        );
      })}
    </Box>
  );
}

/** How long the materials of a just-summoned Xyz Monster take to appear (glow, then cards). */
const MATERIALS_SPAWN_MS = 650;

/**
 * An Xyz Monster's materials, under it and turned across it (together they form a "+"), up to
 * three stacked. They sit 90° behind the monster's own angle and turn with it when it changes
 * position: on your side they face left in attack position and up in defense position, on
 * the opponent's right and down. Clicking them lists the materials.
 *
 * After an Xyz Summon they only appear once the monster has landed (motion.materialsAt):
 * first as a glow in the monster's Attribute colour in the shape of a card, which then
 * turns into the cards.
 */
function XyzMaterials({
  card,
  width,
  height,
  flipped,
  color,
  onClick,
}: {
  card: DuelCard;
  width: number;
  height: number;
  flipped: boolean;
  color: string;
  onClick?: () => void;
}) {
  const [phase, setPhase] = useState<"wait" | "spawn" | "shown">(() => (motion.materialsAt.has(card.id) ? "wait" : "shown"));
  useEffect(() => {
    if (phase !== "wait") return;
    const at = motion.materialsAt.get(card.id) ?? 0;
    const t = setTimeout(() => {
      motion.materialsAt.delete(card.id);
      setPhase("spawn");
    }, Math.max(0, at - performance.now()));
    return () => clearTimeout(t);
  }, [phase, card.id]);
  useEffect(() => {
    if (phase !== "spawn") return;
    const t = setTimeout(() => setPhase("shown"), MATERIALS_SPAWN_MS);
    return () => clearTimeout(t);
  }, [phase]);
  if (phase === "wait") return null;
  const spawning = phase === "spawn";
  const angle = (isDefense(card) ? 90 : 0) - 90;
  const shown = card.overlays.slice(0, 3);
  return (
    <>
      {shown.map((m, i) => {
        const o = (shown.length - 1 - i) * 2;
        return (
          <Box
            key={m.id}
            title="Show materials"
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
            sx={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width,
              height,
              transform: `translate(calc(-50% + ${o}px), calc(-50% + ${o}px)) rotate(${angle}deg)`,
              transition: "transform .25s ease",
              cursor: onClick ? "pointer" : "default",
            }}
          >
            <Box sx={spawning ? { opacity: 0, animation: `xyzMatCard 300ms ease-out 260ms forwards` } : undefined}>
              <CardImage code={m.code} width={width} flipped={flipped} />
            </Box>
            {spawning && (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "4px",
                  background: `radial-gradient(ellipse at center, #ffffff 0%, ${color} 55%, ${color}cc 100%)`,
                  boxShadow: `0 0 10px 3px ${color}, 0 0 22px 6px ${color}88`,
                  pointerEvents: "none",
                  opacity: 0,
                  animation: `xyzMatGlow ${MATERIALS_SPAWN_MS}ms ease-out forwards`,
                  "@keyframes xyzMatGlow": {
                    "0%": { opacity: 0, transform: "scale(.6)" },
                    "40%": { opacity: 1, transform: "scale(1.04)" },
                    "100%": { opacity: 0, transform: "scale(1)" },
                  },
                  "@keyframes xyzMatCard": { from: { opacity: 0 }, to: { opacity: 1 } },
                }}
              />
            )}
          </Box>
        );
      })}
    </>
  );
}
