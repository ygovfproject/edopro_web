"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import FlagIcon from "@mui/icons-material/Flag";
import { useApp, useClientState } from "../AppContext";
import Board, { HandRow, type ZoneGlow } from "./Board";
import PromptDialog, { isBoardPrompt } from "./Prompts";
import FieldDialog, { FieldWindow } from "./FieldDialog";
import CardDetail from "../CardDetail";
import ChatBox from "../ChatBox";
import { CardImage, cardHeight } from "../CardImage";
import SideDeckDialog from "./SideDeckDialog";
import LinesOverlay, { type Link } from "./LinesOverlay";
import FxOverlay from "./FxOverlay";
import type { DuelClient } from "@/lib/game/client";
import { LOC, type DuelCard } from "@/lib/game/duel";
import { actionsFor, disabledZoneKeys, selectableZones, zoneKey, type CardAction, type Zone } from "@/lib/game/actions";
import { OcgMessageType } from "@/lib/protocol/gamemsg";
import { respond } from "@/lib/protocol/responses";
import { MASTER_RULES } from "@/lib/protocol/constants";
import { attributeColor, summonTimeline } from "@/lib/game/motion";
import { fieldLayout, linkedZones } from "@/lib/game/layout";

/** Padding kept inside the field window at every window size (px). */
const FIELD_PAD = 10;
/** Largest card width on the field (px); below it the field grows to fill the field window. */
const MAX_CARD_W = 160;
/** Gap between an LP bar and its hand (px). */
const ROW_GAP = 4;
/** Space between each hand and the board (px). */
const HAND_GAP = 14;

/**
 * Card width that makes the block (LP bar, hand, field, hand, LP bar) as big as the field
 * window allows, padding included. After every render it measures the field window and
 * the block as they really are and grows or shrinks the cards to close the gap, so it
 * keeps fitting through resizes, full screen and zoom without relying on size estimates.
 */
function useCardWidth(field: HTMLElement | null, block: HTMLElement | null, boardRows: number, handsOutside: boolean) {
  const [w, setW] = useState(56);
  const [, remeasure] = useState(0);
  // Window or field window resized: render again so the fit below runs.
  useEffect(() => {
    if (!field) return;
    const again = () => remeasure((x) => x + 1);
    const ro = new ResizeObserver(again);
    ro.observe(field);
    window.addEventListener("resize", again);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", again);
    };
  }, [field]);
  useLayoutEffect(() => {
    if (!field || !block) return;
    const f = field.getBoundingClientRect();
    const b = block.getBoundingClientRect();
    const availW = f.width - FIELD_PAD * 2;
    const availH = f.height - FIELD_PAD * 2;
    if (availW <= 0 || availH <= 0) return;
    const k = 86 / 59; // card height / width (cardHeight)
    const rows = boardRows + (handsOutside ? 2 : 0);
    // How many px of card width the spare room is worth, across and down. The board is
    // 7 cells wide (cell = card height + 6, 4 px gaps).
    const boardW = 7 * (Math.round(w * k) + 6) + 6 * 4;
    // A row's card height is rounded, so keep `rows` px in hand before growing.
    const slackH = availH - b.height;
    const byH = slackH >= 0 ? (slackH - rows) / (rows * k) : slackH / (rows * k);
    const byW = (availW - boardW) / (7 * k);
    const d = Math.floor(Math.min(byH, byW));
    if (d === 0) return;
    const next = Math.max(24, Math.min(MAX_CARD_W, w + d));
    if (next !== w) setW(next);
  });
  return w;
}

/** Local countdown for the active player's time limit. */
function useCountdown(client: DuelClient) {
  const [, tick] = useState(0);
  const [stamp, setStamp] = useState({ at: Date.now(), left: [0, 0] as number[], player: -1 });
  const { timeLeft, timePlayer } = client.duel;
  useEffect(() => {
    setStamp({ at: Date.now(), left: [...timeLeft], player: timePlayer });
  }, [timeLeft[0], timeLeft[1], timePlayer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (player: number) => {
    const base = stamp.left[player] ?? 0;
    if (player !== stamp.player) return base;
    return Math.max(0, base - Math.floor((Date.now() - stamp.at) / 1000));
  };
}

export default function DuelView({ client }: { client: DuelClient }) {
  useClientState(client);
  const { res, settings, updateSettings, closeClient } = useApp();
  const duel = client.duel;
  // Rooms always send their flags; MR5 is only a fallback before the room info arrives.
  const duelFlags = client.hostInfo?.duelFlags ?? MASTER_RULES[0].flags;
  // MR3 draws both hands inside the board (same row as Deck and Extra Deck).
  const handsInBoard = fieldLayout(duelFlags).separatePz;
  const [field, setField] = useState<HTMLElement | null>(null);
  const [block, setBlock] = useState<HTMLElement | null>(null);
  const W = useCardWidth(field, block, handsInBoard ? 7 : 5, !handsInBoard);
  const cellSize = cardHeight(W) + 6;
  const handWidth = 5 * cellSize + 4 * 4;
  /** The field's width: 7 cells with 4 px gaps (see Board). The LP bars match it. */
  const boardWidth = 7 * cellSize + 6 * 4;
  const timeOf = useCountdown(client);
  const [hover, setHover] = useState<{ code: number; card: DuelCard | null }>({ code: 0, card: null });
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; actions: CardAction[]; title: string } | null>(null);
  const [pileView, setPileView] = useState<{ player: number; location: number } | null>(null);
  /** The Xyz Monster whose materials are listed (DuelCard id). */
  const [materialsOf, setMaterialsOf] = useState<number | null>(null);
  const [minimized, setMinimized] = useState<number | null>(null);
  const [sideTab, setSideTab] = useState(0);
  const [placeSel, setPlaceSel] = useState<Zone[]>([]);
  const [confirmSurrender, setConfirmSurrender] = useState(false);

  const prompt = client.prompt;
  const msg = prompt?.msg;
  const describer = useMemo(
    () => ({ desc: (d: bigint, n?: string) => res!.desc(d, n), name: (c: number) => res!.cards.name(c) }),
    [res],
  );
  const actions = useMemo(() => actionsFor(msg, duel, describer), [msg, duel, describer, client.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const actionable = useMemo(() => new Set(actions.byCard.keys()), [actions]);

  // Zone selection prompts.
  const placeZones = useMemo(() => {
    if (!msg || (msg.type !== OcgMessageType.SELECT_PLACE && msg.type !== OcgMessageType.SELECT_DISFIELD)) return [];
    return selectableZones(msg.player, msg.field_mask);
  }, [msg]);
  const placeKeys = useMemo(() => new Set(placeZones.map(zoneKey)), [placeZones]);
  const placeNeeded = msg && (msg.type === OcgMessageType.SELECT_PLACE || msg.type === OcgMessageType.SELECT_DISFIELD) ? Math.max(1, msg.count) : 0;
  useEffect(() => setPlaceSel([]), [prompt?.id]);
  useEffect(() => {
    // Auto placement: first free zone of the selecting player (centre first).
    if (!settings.autoPlace || !msg || msg.type !== OcgMessageType.SELECT_PLACE || placeNeeded !== 1) return;
    const own = placeZones.filter((z) => z.player === msg.player);
    const order = [2, 1, 3, 0, 4, 5, 6, 7];
    const best = own.sort((a, b) => order.indexOf(a.sequence) - order.indexOf(b.sequence))[0];
    if (best) client.respond(respond.places([best]));
  }, [prompt?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onZoneClick = (z: Zone) => {
    const next = [...placeSel.filter((p) => zoneKey(p) !== zoneKey(z)), z];
    if (next.length >= placeNeeded) client.respond(respond.places(next.slice(0, placeNeeded)));
    else setPlaceSel(next);
  };

  const onHover = useCallback((card: DuelCard | null, code: number) => {
    setHoverId(card ? card.id : null);
    if (code) setHover({ code, card });
  }, []);

  const onCardClick = (card: DuelCard, el: HTMLElement) => {
    if (card.code) setHover({ code: card.code, card });
    const a = actions.byCard.get(card.id);
    if (a?.length) setMenu({ el, actions: a, title: card.code ? res!.cards.name(card.code) : "Card" });
  };

  const disabled = useMemo(() => disabledZoneKeys(duel), [duel, duel.disabledZones]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = duel.me;
  const opp = 1 - me;
  const [t1] = client.teamSizes;
  const myTeam = client.isObserver ? 0 : client.selfPos < t1 ? 0 : 1;
  const teamNames = (team: number) =>
    client.slots
      .slice(team === 0 ? 0 : t1, team === 0 ? t1 : undefined)
      .filter(Boolean)
      .map((s) => s!.name)
      .join(" & ");
  const names = { [me]: teamNames(myTeam) || "You", [opp]: teamNames(1 - myTeam) || "Opponent" } as Record<number, string>;

  const showPrompt = prompt && !isBoardPrompt(prompt) && minimized !== prompt.id;
  const hint = (() => {
    if (!msg) return duel.waiting ? "Waiting for opponent…" : "";
    if (msg.type === OcgMessageType.SELECT_IDLECMD) return "Your move: click a highlighted card, or choose a phase.";
    if (msg.type === OcgMessageType.SELECT_BATTLECMD) return "Battle: click a highlighted monster to attack, or move on.";
    if (msg.type === OcgMessageType.SELECT_PLACE) {
      // For zone selection the hint carries the card being placed.
      return prompt?.hint ? res!.sys(569).replace("%ls", res!.cards.name(Number(prompt.hint))) : res!.sys(560);
    }
    if (msg.type === OcgMessageType.SELECT_DISFIELD) return `${res!.sys(570)} (${placeSel.length}/${placeNeeded})`;
    return prompt?.hint ? res!.desc(prompt.hint) : "Make a choice";
  })();

  const winnerText = duel.winner
    ? duel.winner.player > 1
      ? "Draw"
      : client.isObserver
        ? `${names[duel.winner.player]} won`
        : duel.winner.player === me
          ? "You won!"
          : "You lost"
    : null;

  // Equip / target relations of the hovered card, in both directions.
  const { linked, links } = (() => {
    const linkedSet = new Set<number>();
    const out: Link[] = [];
    const sel = (c: DuelCard) => `[data-card-id="${c.id}"]`;
    const hovered = hoverId !== null ? duel.allCards().find((c) => c.id === hoverId) : undefined;
    if (hovered) {
      for (const c of duel.allCards()) {
        const pairs: [DuelCard, DuelCard][] = [];
        if (c.equipTarget) pairs.push([c, c.equipTarget]);
        for (const t of c.targets) pairs.push([c, t]);
        for (const [a, b] of pairs) {
          if (a !== hovered && b !== hovered) continue;
          // Related cards just get the white highlight; no arrows.
          linkedSet.add(a === hovered ? b.id : a.id);
        }
      }
      // An effect on the chain and the cards it targets, while both are on the field:
      // bound like an equip until the link resolves.
      const onField = (c: DuelCard) => (c.location & LOC.ONFIELD) !== 0;
      for (const link of duel.chain) {
        const src = link.card;
        if (!src || !onField(src)) continue;
        for (const t of link.targets) {
          if (t === src || !onField(t)) continue;
          if (src === hovered) linkedSet.add(t.id);
          else if (t === hovered) linkedSet.add(src.id);
        }
      }
    }
    if (duel.attack) {
      const { attacker, target } = duel.attack;
      // Only a real direct attack points at the player; a vanished target means no arrow.
      if (attacker && (target || !duel.attack.to)) {
        out.push({
          from: sel(attacker),
          to: target ? sel(target) : `[data-lp="${1 - duel.attack.from.controller}"]`,
          kind: "attack",
        });
      }
    }
    return { linked: linkedSet, links: out };
  })();

  // Xyz Summon in progress: the void behind every cell, until the card lands.
  const xyzFx = duel.fx.find((f) => f.kind === "xyz");
  const xyzTl = xyzFx ? summonTimeline("xyz", Math.max(1, xyzFx.materials?.length ?? 0)) : null;
  const boardVoid =
    xyzFx && xyzTl
      ? {
          id: xyzFx.id,
          cardId: xyzFx.cardId,
          color: attributeColor(res?.cards.get(xyzFx.code)?.attribute ?? 0),
          end: xyzTl.impact,
          // The cell turns yellow when the last sphere hits.
          yellowAt: xyzTl.hits[xyzTl.hits.length - 1],
        }
      : null;

  // Zones that glow for a moment (activation, chain resolving, Special Summon).
  const glowZones = new Map<string, ZoneGlow>();
  for (const f of duel.fx) {
    if (f.kind === "glow" && f.zone) glowZones.set(zoneKey(f.zone), { id: f.id, color: f.color ?? "#ffffff", delay: f.delay ?? 0, blink: !!f.blink });
  }

  // Zones the hovered face-up Link Monster points to.
  const pointedZones = (() => {
    const out = new Set<string>();
    if (hoverId === null) return out;
    const card = duel.allCards().find((c) => c.id === hoverId);
    if (!card || card.location !== LOC.MZONE || card.position & 0xa) return out;
    const info = card.code ? res!.cards.get(card.code) : undefined;
    const isLink = (card.type || info?.type || 0) & 0x4000000;
    const marker = card.linkMarker || info?.linkMarker || 0;
    if (!isLink || !marker) return out;
    for (const z of linkedZones(card.controller, card.sequence, marker, fieldLayout(duelFlags).emz)) out.add(zoneKey(z));
    return out;
  })();

  const chainLinks = new Map<number, number[]>();
  duel.chain.forEach((l, i) => {
    if (!l.card) return;
    chainLinks.set(l.card.id, [...(chainLinks.get(l.card.id) ?? []), i + 1]);
  });

  const reveal = duel.reveals[0];
  // Revealed cards are shown briefly, then disappear on their own.
  useEffect(() => {
    if (!reveal) return;
    // Negations stay a little longer: the pop-up shows the card turning negated.
    const t = setTimeout(() => client.dismissReveal(reveal.id), reveal.kind === "negated" ? 1500 : reveal.codes.length ? 1000 : 2000);
    return () => clearTimeout(t);
  }, [reveal?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pileCards = pileView ? (duel.pile(pileView.player, pileView.location) as DuelCard[]) : [];
  // Follows the monster while the dialog is open; closes once it has no materials left.
  const materialsHolder = materialsOf !== null ? duel.allCards().find((c) => c.id === materialsOf && c.overlays.length > 0) : undefined;

  // Both hands use the same card size.
  const oppHand = (maxWidth?: number) => (
    <HandRow
      cards={duel.players[opp].hand}
      width={W}
      maxWidth={maxWidth}
      hidden
      flipped
      actionable={actionable}
      linked={linked}
      chainLinks={chainLinks}
      onHover={onHover}
    />
  );
  const myHand = (maxWidth?: number) => (
    <HandRow
      cards={duel.players[me].hand}
      width={W}
      maxWidth={maxWidth}
      hidden={false}
      actionable={actionable}
      linked={linked}
      chainLinks={chainLinks}
      onCardClick={onCardClick}
      onHover={onHover}
    />
  );

  const playerBar = (player: number) => {
    const lp = duel.players[player].lp;
    const start = client.hostInfo?.startLp || 8000;
    const t = timeOf(player);
    const active = duel.turnPlayer === player && duel.turn > 0;
    const mine = player === me && !client.isObserver;
    return (
      <Stack
        data-lp={player}
        direction="row"
        spacing={1.5}
        sx={{
          alignItems: "center",
          px: 1.5,
          height: 40,
          flex: "0 0 auto",
          borderRadius: 1,
          transition: "background .3s ease, box-shadow .3s ease",
          background: active ? (player === me ? "linear-gradient(90deg, rgba(245,197,24,.38), rgba(245,197,24,.12))" : "linear-gradient(90deg, rgba(190,190,190,.38), rgba(190,190,190,.12))") : "rgba(255,255,255,.03)",
          boxShadow: active ? `inset 0 0 0 1px ${player === me ? "rgba(245,197,24,.6)" : "rgba(190,190,190,.6)"}` : "none",
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {names[player]}
        </Typography>
        <Box sx={{ flex: 1, maxWidth: 200, minWidth: 60 }}>
          <LinearProgress
            variant="determinate"
            value={Math.max(0, Math.min(100, (lp / start) * 100))}
            color={lp <= start / 4 ? "error" : "primary"}
            sx={{ height: 8, borderRadius: 4 }}
          />
        </Box>
        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, minWidth: 64 }}>
          {lp} LP
        </Typography>
        {client.hostInfo?.timeLimit ? (
          <Chip size="small" color={duel.timePlayer === player ? "warning" : "default"} label={`${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`} />
        ) : null}
        <Box sx={{ flex: 1 }} />
        {mine &&
          actions.phase.map((p) => (
            <Button key={p.label} size="small" variant="contained" color="secondary" onClick={() => client.respond(p.response)} sx={{ py: 0.25 }}>
              {p.label}
            </Button>
          ))}
      </Stack>
    );
  };

  /** Drawn inside the field window: arrows, effects, revealed cards and waiting notes. */
  const fieldOverlays = (
    <>
      <LinesOverlay links={links} version={client.rev} />
      <FxOverlay fx={duel.fx} me={me} onDone={(id) => client.dismissFx(id)} />

      {/* Revealed cards / messages: shown briefly, no click needed */}
      {reveal && (
        <Paper
          key={reveal.id}
          elevation={12}
          sx={{
            // Centred in the field window.
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 1600,
            p: 1.5,
            pointerEvents: "none",
            maxWidth: "90%",
            animation: "revealIn .18s ease-out",
            "@keyframes revealIn": { from: { opacity: 0, transform: "translate(-50%, -46%) scale(.96)" }, to: { opacity: 1, transform: "translate(-50%, -50%) scale(1)" } },
          }}
        >
          {/* Cards speak for themselves: text only when nothing is shown (coin toss, messages). */}
          {reveal.codes.length === 0 && (
            <Typography variant="subtitle2" sx={{ textAlign: "center" }}>
              {reveal.title}
            </Typography>
          )}
          {reveal.codes.length > 0 && (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, justifyContent: "center" }}>
              {reveal.codes.map((c, i) => (
                <CardImage key={i} code={c} width={reveal.kind === "negated" ? 110 : 84} negated={reveal.kind === "negated"} negateIntro />
              ))}
            </Box>
          )}
        </Paper>
      )}

      {(client.status === "rps-wait" || client.status === "order-wait" || client.status === "side-wait" || client.status === "rematch-wait") &&
        !(duel.winner && client.status === "rematch-wait") && (
        <Box sx={{ position: "absolute", left: "50%", top: 12, transform: "translateX(-50%)", zIndex: 1500, maxWidth: "90%" }}>
          <Alert severity="info" variant="filled">
            {/* Between games of a match, the last game's result stays on screen. */}
            {duel.winner && winnerText ? `${winnerText}. ` : ""}
            {client.status === "rps-wait"
              ? "Waiting for the opponent's choice…"
              : client.status === "order-wait"
                ? "Waiting for the next duel to start…"
                : client.status === "side-wait"
                  ? client.isObserver
                    ? "The duelists are side decking…"
                    : "Waiting for your opponent…"
                  : "Waiting for the rematch answer…"}
          </Alert>
        </Box>
      )}

    </>
  );

  return (
    <FieldWindow.Provider value={field}>
    <Box sx={{ height: "100vh", display: "flex", overflow: "hidden" }}>
      {/* Left: card details. Everything around the field window is layered above it, so
          pop-ups and effects from the field never cover it. */}
      <Paper
        square
        elevation={0}
        sx={{
          width: 280,
          flex: "0 0 280px",
          borderRight: 1,
          borderColor: "divider",
          overflow: "hidden",
          display: { xs: "none", lg: "block" },
          position: "relative",
          zIndex: 2,
        }}
      >
        <CardDetail code={hover.code} live={hover.card} imageWidth={220} />
      </Paper>

      {/* Centre: the field window (LP bar to LP bar), then the action bar */}
      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <Box
          ref={setField}
          data-field-window
          sx={{
            // Its own layer under the panels: pop-ups (FieldDialog) and effects stay inside it.
            position: "relative",
            zIndex: 0,
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            p: `${FIELD_PAD}px`,
            overflow: "hidden",
          }}
        >
        {/* LP bar, hand, field, hand, LP bar as one block, centred in the field window. The LP
            bars are as wide as the field; the hands sit against the field's edges. */}
        <Box ref={setBlock} sx={{ width: boardWidth, maxWidth: "100%", flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "stretch" }}>
        <Box sx={{ mb: `${ROW_GAP}px` }}>{playerBar(opp)}</Box>
        {!handsInBoard && <Box sx={{ mb: `${HAND_GAP}px` }}>{oppHand()}</Box>}
        <Box sx={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Board
            duel={duel}
            cardWidth={W}
            duelFlags={duelFlags}
            actionable={actionable}
            linked={linked}
            chainLinks={chainLinks}
            selectableZones={placeKeys}
            selectedZones={new Set(placeSel.map(zoneKey))}
            pointedZones={pointedZones}
            glowZones={glowZones}
            picks={duel.materialPicks}
            boardVoid={boardVoid}
            disabledZones={disabled}
            onCardClick={onCardClick}
            onZoneClick={onZoneClick}
            onPileClick={(player, location) => setPileView({ player, location })}
            onMaterialsClick={(card) => setMaterialsOf(card.id)}
            onHover={onHover}
            oppHand={handsInBoard ? oppHand(handWidth) : undefined}
            myHand={handsInBoard ? myHand(handWidth) : undefined}
            center={
              duel.turn > 0 ? (
                <Box
                  sx={{
                    // Fixed width so the box doesn't change size with the turn number or phase name.
                    width: 92,
                    maxWidth: "100%",
                    boxSizing: "border-box",
                    textAlign: "center",
                    px: 0.5,
                    py: 0.5,
                    borderRadius: 1,
                    lineHeight: 1.2,
                    bgcolor: duel.turnPlayer === me ? "rgba(245,197,24,.22)" : "rgba(190,190,190,.22)",
                    border: "1px solid",
                    borderColor: duel.turnPlayer === me ? "rgba(245,197,24,.6)" : "rgba(190,190,190,.6)",
                  }}
                >
                  <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>TURN {duel.turn}</Typography>
                  <Typography noWrap sx={{ fontSize: 10.5, color: "text.secondary" }}>{res!.phaseName(duel.phase)}</Typography>
                </Box>
              ) : undefined
            }
          />
        </Box>
        {!handsInBoard && <Box sx={{ mt: `${HAND_GAP}px` }}>{myHand()}</Box>}
        <Box sx={{ mt: `${ROW_GAP}px` }}>{playerBar(me)}</Box>
        </Box>
        {fieldOverlays}
        </Box>
        {/* Prompt / action bar */}
        <Paper square elevation={0} sx={{ position: "relative", zIndex: 2, borderTop: 1, borderColor: "divider", px: 1, height: 48, flex: "0 0 auto", display: "flex", alignItems: "center" }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", width: "100%", minWidth: 0 }}>
            <Typography
              variant="body2"
              noWrap
              title={hint}
              sx={{ flex: 1, minWidth: 0 }}
              color={prompt ? "text.primary" : "text.secondary"}
            >
              {hint}
            </Typography>
            {client.retryWarning && <Chip size="small" color="error" label="Invalid choice, try again" />}
            {prompt && minimized === prompt.id && (
              <Button size="small" variant="contained" onClick={() => setMinimized(null)}>
                Back to choice
              </Button>
            )}
            {actions.loose.length > 0 && (
              <Button
                size="small"
                variant="outlined"
                onClick={(e) => setMenu({ el: e.currentTarget, actions: actions.loose, title: "Other actions" })}
              >
                Other actions ({actions.loose.length})
              </Button>
            )}
            {!client.isObserver && (
              <TextField
                select
                size="small"
                value={settings.chainMode}
                onChange={(e) => updateSettings({ chainMode: e.target.value as typeof settings.chainMode })}
                sx={{ minWidth: 150, "& .MuiInputBase-input": { py: 0.5, fontSize: 13 } }}
                slotProps={{ htmlInput: { "aria-label": "Chain prompts" } }}
              >
                <MenuItem value="auto">Chains: auto</MenuItem>
                <MenuItem value="ask">Chains: always ask</MenuItem>
                <MenuItem value="never">Chains: never ask</MenuItem>
              </TextField>
            )}
            {!client.isObserver && client.status === "dueling" && (
              <Button size="small" color="error" startIcon={<FlagIcon />} onClick={() => setConfirmSurrender(true)}>
                Surrender
              </Button>
            )}
            {client.isObserver && (
              <Button size="small" onClick={closeClient}>
                Leave
              </Button>
            )}
          </Stack>
        </Paper>
      </Stack>

      {/* Right: log and chat */}
      <Paper square elevation={0} sx={{ position: "relative", zIndex: 2, width: 300, borderLeft: 1, borderColor: "divider", display: { xs: "none", md: "flex" }, flexDirection: "column" }}>
        <Tabs value={sideTab} onChange={(_, v) => setSideTab(v)} variant="fullWidth">
          <Tab label="Log" />
          <Tab label="Chat" />
        </Tabs>
        {sideTab === 0 ? (
          <Box sx={{ flex: 1, overflowY: "auto", px: 1, py: 0.5, display: "flex", flexDirection: "column-reverse" }}>
            <Box>
              {duel.log.map((l) => (
                <Typography
                  key={l.id}
                  variant="body2"
                  onMouseEnter={() => l.codes[0] && setHover({ code: l.codes[0], card: null })}
                  sx={{ fontSize: 12.5, py: 0.25, borderBottom: "1px solid rgba(255,255,255,.04)", color: l.kind === "turn" ? "#ff5252" : l.player === undefined ? "text.secondary" : l.player === me ? "#f5c518" : "#bdbdbd" }}
                >
                  {l.text}
                </Typography>
              ))}
            </Box>
          </Box>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <ChatBox client={client} height="100%" />
          </Box>
        )}
      </Paper>

      {/* Card action menu */}
      <Menu open={!!menu} anchorEl={menu?.el} onClose={() => setMenu(null)}>
        {menu && (
          <MenuItem disabled dense>
            <Typography variant="caption">{menu.title}</Typography>
          </MenuItem>
        )}
        {menu?.actions.map((a, i) => (
          <MenuItem
            key={i}
            onClick={() => {
              setMenu(null);
              // Chosen from a card in the pile viewer: close it too.
              setPileView(null);
              client.respond(a.response);
            }}
          >
            <ListItemText primary={a.label} secondary={"code" in a ? res!.cards.name((a as { code: number }).code) : undefined} />
          </MenuItem>
        ))}
      </Menu>

      {/* Pile viewer */}
      <FieldDialog open={!!pileView} onClose={() => setPileView(null)} fullWidth maxWidth="md">
        <DialogTitle>
          {pileView && `${pileView.player === me ? "Your" : `${names[pileView.player]}'s`} ${res!.locationName(pileView.location)} (${pileCards.length})`}
        </DialogTitle>
        <DialogContent dividers>
          {pileView && pileView.location === LOC.DECK && pileCards.every((c) => !c.code) ? (
            <Typography color="text.secondary">The Deck is face-down.</Typography>
          ) : (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {[...pileCards].reverse().map((c) => {
                const visible = c.code && (pileView!.player === me || pileView!.location === LOC.GRAVE || (c.position & 0x5) !== 0);
                const acts = actions.byCard.get(c.id) ?? [];
                return (
                  <Stack key={c.id} spacing={0.5} sx={{ alignItems: "center", width: 84 }}>
                    <CardImage
                      code={visible ? c.code : 0}
                      faceDown={!visible}
                      width={76}
                      highlight={acts.length ? "action" : null}
                      onHover={() => visible && setHover({ code: c.code, card: c })}
                      // The card works like its button(s): one action runs at once, several open a menu.
                      onClick={
                        acts.length
                          ? (e) => {
                              if (acts.length === 1) {
                                setPileView(null);
                                client.respond(acts[0].response);
                              } else {
                                setMenu({ el: e.currentTarget, actions: acts, title: c.code ? res!.cards.name(c.code) : "Card" });
                              }
                            }
                          : undefined
                      }
                    />
                    {acts.map((a, i) => (
                      <Button
                        key={i}
                        size="small"
                        variant="contained"
                        color="secondary"
                        sx={{ fontSize: 10, py: 0, px: 0.5, minWidth: 0 }}
                        onClick={() => {
                          setPileView(null);
                          client.respond(a.response);
                        }}
                      >
                        {a.label}
                      </Button>
                    ))}
                  </Stack>
                );
              })}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPileView(null)}>Close</Button>
        </DialogActions>
      </FieldDialog>

      {/* Xyz materials */}
      <FieldDialog open={!!materialsHolder} onClose={() => setMaterialsOf(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          {materialsHolder &&
            `${materialsHolder.code ? res!.cards.name(materialsHolder.code) : "Xyz Monster"}: ${materialsHolder.overlays.length} material${materialsHolder.overlays.length === 1 ? "" : "s"}`}
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {materialsHolder?.overlays.map((o) => (
              <Stack key={o.id} spacing={0.5} sx={{ alignItems: "center", width: 84 }}>
                <CardImage code={o.code} faceDown={!o.code} width={76} onHover={() => o.code && setHover({ code: o.code, card: o })} />
                <Typography variant="caption" sx={{ textAlign: "center", lineHeight: 1.2, wordBreak: "break-word" }}>
                  {o.code ? res!.cards.name(o.code) : "Unknown"}
                </Typography>
              </Stack>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMaterialsOf(null)}>Close</Button>
        </DialogActions>
      </FieldDialog>

      {/* Selection prompts */}
      {showPrompt && prompt && (
        <PromptDialog
          key={prompt.id}
          client={client}
          prompt={prompt}
          onHover={(code) => code && setHover({ code, card: null })}
          onMinimize={() => setMinimized(prompt.id)}
        />
      )}

      {/* Pre-duel: rock paper scissors and turn order */}
      <FieldDialog open={client.status === "rps"} maxWidth="xs" fullWidth>
        <DialogTitle>Rock, paper, scissors</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            The winner decides who goes first.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "center" }}>
          <Button variant="outlined" onClick={() => client.chooseRps(2)}>
            ✊ Rock
          </Button>
          <Button variant="outlined" onClick={() => client.chooseRps(3)}>
            ✋ Paper
          </Button>
          <Button variant="outlined" onClick={() => client.chooseRps(1)}>
            ✌️ Scissors
          </Button>
        </DialogActions>
      </FieldDialog>
      <FieldDialog open={client.status === "choose-order"} maxWidth="xs" fullWidth>
        <DialogTitle>{client.rpsResult ? "You won rock-paper-scissors" : "Choose turn order"}</DialogTitle>
        <DialogActions sx={{ justifyContent: "center" }}>
          <Button variant="contained" onClick={() => client.chooseOrder(true)}>
            {res!.sys(100)}
          </Button>
          <Button variant="outlined" onClick={() => client.chooseOrder(false)}>
            {res!.sys(101)}
          </Button>
        </DialogActions>
      </FieldDialog>
      {/* Side decking between games of a match */}
      {client.status === "siding" && client.deck && (
        <SideDeckDialog deck={client.deck} result={winnerText ?? undefined} onSubmit={(d) => client.submitSide(d)} />
      )}

      {/* End of duel */}
      {/* In a match, a game's end leads to side decking; only the last game (DUEL_END -> closed) shows this. */}
      <FieldDialog
        open={
          !!winnerText &&
          (client.status === "closed" ||
            client.status === "rematch" ||
            client.status === "rematch-wait" ||
            (client.status === "dueling" && (client.hostInfo?.bestOf ?? 1) <= 1))
        }
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{winnerText}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {duel.winner && res!.victory(duel.winner.reason)}
          </Typography>
        </DialogContent>
        <DialogActions>
          {client.status === "rematch" && (
            <>
              <Button onClick={() => client.answerRematch(false)}>No rematch</Button>
              <Button variant="contained" onClick={() => client.answerRematch(true)}>
                Rematch
              </Button>
            </>
          )}
          {client.status !== "rematch" && (
            <Button variant="contained" onClick={closeClient}>
              Back to lobby
            </Button>
          )}
        </DialogActions>
      </FieldDialog>

      <FieldDialog open={confirmSurrender} onClose={() => setConfirmSurrender(false)}>
        <DialogTitle>Surrender this duel?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setConfirmSurrender(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              setConfirmSurrender(false);
              client.surrender();
            }}
          >
            Surrender
          </Button>
        </DialogActions>
      </FieldDialog>
      {client.status === "closed" && !duel.winner && (
        <FieldDialog open maxWidth="xs" fullWidth>
          <DialogTitle>Disconnected</DialogTitle>
          <DialogContent>
            <Typography variant="body2">{client.error ?? "The connection to the server was closed."}</Typography>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={closeClient}>
              Back to lobby
            </Button>
          </DialogActions>
        </FieldDialog>
      )}
    </Box>
    </FieldWindow.Provider>
  );
}
