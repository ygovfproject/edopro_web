"use client";

import { Badge, Box } from "@mui/material";
import { CardImage, cardHeight } from "../CardImage";
import { LOC, POS, type DuelCard, type DuelState } from "@/lib/game/duel";
import { zoneKey, type Zone } from "@/lib/game/actions";
import { fieldLayout } from "@/lib/game/layout";

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
  /** Zones the hovered Link Monster points to. */
  pointedZones?: Set<string>;
  disabledZones: Set<string>;
  onCardClick: (card: DuelCard, el: HTMLElement) => void;
  onZoneClick: (zone: Zone) => void;
  onPileClick: (player: number, location: number) => void;
  onHover: (card: DuelCard | null, code: number) => void;
  /** Shown in the middle of the field, between the two centre Monster Zones. */
  center?: React.ReactNode;
  /** MR3 only: hands drawn inside the board, between Extra Deck and Deck. */
  myHand?: React.ReactNode;
  oppHand?: React.ReactNode;
}

function isFaceDown(c: DuelCard) {
  return (c.position & POS.FACEDOWN) !== 0;
}

function isDefense(c: DuelCard) {
  return (c.position & POS.DEFENSE) !== 0;
}

export default function Board(p: BoardProps) {
  const { duel, cardWidth: W } = p;
  const H = cardHeight(W);
  const cell = H + 6;
  const me = duel.me;
  const opp = 1 - me;

  const layout = fieldLayout(p.duelFlags);
  const { emz, separatePz } = layout;
  const attackFrom = duel.attack?.attacker ?? null;
  const attackTo = duel.attack?.target ?? null;

  const highlightOf = (card: DuelCard) =>
    p.actionable.has(card.id) ? "action" : p.linked.has(card.id) ? "linked" : card === attackFrom || card === attackTo ? "target" : null;

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
    return (
      <Box
        key={key}
        onClick={selectable ? () => p.onZoneClick(z) : undefined}
        sx={{
          gridColumn,
          gridRow,
          width: cell,
          height: cell,
          border: "1px solid",
          borderColor: selected ? "primary.main" : selectable ? "#e6e6e6" : pointed ? "#f5c518" : "rgba(255,255,255,0.10)",
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
              ? "inset 0 0 16px rgba(245,197,24,.6), 0 0 8px rgba(245,197,24,.45)"
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
        {card && (
          <Badge
            badgeContent={card.overlays.length || 0}
            color="primary"
            invisible={!card.overlays.length}
            // Top-left: the bottom edge holds ATK/DEF, the top-right corner counters.
            anchorOrigin={{ vertical: "top", horizontal: "left" }}
          >
            <CardImage
              code={hiddenFromMe ? 0 : card.code}
              width={W}
              faceDown={isFaceDown(card)}
              sideways={isMonsterZone && isDefense(card)}
              flipped={player !== me}
              // STATUS_DISABLED or STATUS_FORBIDDEN, as EDOPro shows its "negated" icon.
              negated={!isFaceDown(card) && (card.status & (0x1 | 0x4000000)) !== 0}
              negatedBlink
              highlight={highlightOf(card)}
              trackId={card.id}
              chainLinks={p.chainLinks.get(card.id)}
              onClick={selectable ? undefined : (e) => p.onCardClick(card, e.currentTarget)}
              onHover={() => p.onHover(card, hiddenFromMe ? 0 : card.code)}
              onLeave={() => p.onHover(null, 0)}
            />
          </Badge>
        )}
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
        {card && Object.keys(card.counters).length > 0 && (
          <Box
            sx={{
              position: "absolute",
              top: 2,
              right: 2,
              bgcolor: "secondary.main",
              color: "#000",
              borderRadius: "10px",
              px: 0.6,
              fontSize: 10,
              fontWeight: 700,
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            {Object.values(card.counters).reduce((a, b) => a + b, 0)}
          </Box>
        )}
      </Box>
    );
  };

  const pile = (player: number, location: number, gridColumn: number, gridRow: number) => {
    const list = duel.pile(player, location) as DuelCard[];
    const top = list[list.length - 1];
    const faceUpTop = top && (location === LOC.GRAVE || (location === LOC.REMOVED && !isFaceDown(top)) || (location === LOC.EXTRA && !isFaceDown(top)));
    const hasAction = list.some((c) => p.actionable.has(c.id));
    const links = list.flatMap((c) => p.chainLinks.get(c.id) ?? []);
    return (
      <Box
        key={`pile-${player}-${location}`}
        onClick={() => p.onPileClick(player, location)}
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
          cursor: "pointer",
          bgcolor: "rgba(255,255,255,0.03)",
        }}
      >
        {top && (
          <CardImage
            code={faceUpTop ? top.code : 0}
            width={W}
            faceDown={!faceUpTop}
            sideways={location === LOC.REMOVED}
            flipped={player !== me}
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
      sx={{
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

/** A row of cards in hand, always the same height. */
export function HandRow({
  cards,
  width,
  hidden,
  flipped,
  actionable,
  linked,
  chainLinks,
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
  onCardClick?: (card: DuelCard, el: HTMLElement) => void;
  onHover: (card: DuelCard | null, code: number) => void;
}) {
  const H = cardHeight(width);
  // Overlap cards when the hand gets large (or doesn't fit the space it has).
  const n = cards.length;
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
      {cards.map((c, i) => {
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
              highlight={actionable.has(c.id) ? "action" : linked.has(c.id) ? "linked" : null}
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
