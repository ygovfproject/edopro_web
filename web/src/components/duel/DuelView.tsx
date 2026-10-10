"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
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
import Board, { HandRow } from "./Board";
import PromptDialog, { isBoardPrompt } from "./Prompts";
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
import { fieldLayout, linkedZones } from "@/lib/game/layout";

function useCardWidth(boardRows: number, handsOutside: boolean) {
  const [w, setW] = useState(56);
  useEffect(() => {
    const calc = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // 7 columns of cells (≈1.46 × width each) plus side panels on wide screens.
      const avail = vw >= 1200 ? vw - 600 : vw - 24;
      const byWidth = avail / (7 * 1.52);
      // Board rows plus both hands.
      const byHeight = (vh - 190) / ((boardRows + (handsOutside ? 2 : 0)) * 1.5);
      setW(Math.max(30, Math.min(70, Math.floor(Math.min(byWidth, byHeight)))));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [boardRows, handsOutside]);
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
  const W = useCardWidth(handsInBoard ? 7 : 5, !handsInBoard);
  const cellSize = cardHeight(W) + 6;
  const handWidth = 5 * cellSize + 4 * 4;
  const timeOf = useCountdown(client);
  const [hover, setHover] = useState<{ code: number; card: DuelCard | null }>({ code: 0, card: null });
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; actions: CardAction[]; title: string } | null>(null);
  const [pileView, setPileView] = useState<{ player: number; location: number } | null>(null);
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
        const pairs: [DuelCard, DuelCard, Link["kind"]][] = [];
        if (c.equipTarget) pairs.push([c, c.equipTarget, "equip"]);
        for (const t of c.targets) pairs.push([c, t, "target"]);
        for (const [a, b, kind] of pairs) {
          if (a !== hovered && b !== hovered) continue;
          linkedSet.add(a === hovered ? b.id : a.id);
          out.push({ from: sel(a), to: sel(b), kind });
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
    const t = setTimeout(() => client.dismissReveal(reveal.id), reveal.codes.length ? 1000 : 2000);
    return () => clearTimeout(t);
  }, [reveal?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pileCards = pileView ? (duel.pile(pileView.player, pileView.location) as DuelCard[]) : [];

  const oppHand = (width: number, maxWidth?: number) => (
    <HandRow
      cards={duel.players[opp].hand}
      width={width}
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
          mx: 0.5,
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

  return (
    <Box sx={{ height: "100vh", display: "flex", overflow: "hidden" }}>
      {/* Left: card details */}
      <Paper square elevation={0} sx={{ width: 280, borderRight: 1, borderColor: "divider", overflowY: "auto", display: { xs: "none", lg: "block" } }}>
        <CardDetail code={hover.code} live={hover.card} imageWidth={220} />
      </Paper>

      {/* Centre: field */}
      <Stack sx={{ flex: 1, minWidth: 0, py: 0.5 }} spacing={0.5}>
        {playerBar(opp)}
        {!handsInBoard && oppHand(Math.round(W * 0.7))}
        <Box sx={{ position: "relative", flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
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
            disabledZones={disabled}
            onCardClick={onCardClick}
            onZoneClick={onZoneClick}
            onPileClick={(player, location) => setPileView({ player, location })}
            onHover={onHover}
            oppHand={handsInBoard ? oppHand(Math.round(W * 0.85), handWidth) : undefined}
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
        {!handsInBoard && myHand()}
        {playerBar(me)}
        {/* Prompt / action bar */}
        <Paper square elevation={0} sx={{ borderTop: 1, borderColor: "divider", px: 1, height: 48, flex: "0 0 auto", display: "flex", alignItems: "center" }}>
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
      <Paper square elevation={0} sx={{ width: 300, borderLeft: 1, borderColor: "divider", display: { xs: "none", md: "flex" }, flexDirection: "column" }}>
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
                  sx={{ fontSize: 12.5, py: 0.25, borderBottom: "1px solid rgba(255,255,255,.04)", color: l.player === undefined ? "text.secondary" : l.player === me ? "#f5c518" : "#bdbdbd" }}
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
              client.respond(a.response);
            }}
          >
            <ListItemText primary={a.label} secondary={"code" in a ? res!.cards.name((a as { code: number }).code) : undefined} />
          </MenuItem>
        ))}
      </Menu>

      {/* Pile viewer */}
      <Dialog open={!!pileView} onClose={() => setPileView(null)} fullWidth maxWidth="md">
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
      </Dialog>

      <LinesOverlay links={links} version={client.rev} />
      <FxOverlay fx={duel.fx} me={me} onDone={(id) => client.dismissFx(id)} />

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

      {/* Revealed cards / messages: shown briefly, no click needed */}
      {reveal && (
        <Paper
          key={reveal.id}
          elevation={12}
          sx={{
            position: "fixed",
            left: "50%",
            top: "42%",
            transform: "translate(-50%, -50%)",
            zIndex: 1600,
            p: 1.5,
            pointerEvents: "none",
            maxWidth: "80vw",
            animation: "revealIn .18s ease-out",
            "@keyframes revealIn": { from: { opacity: 0, transform: "translate(-50%, -46%) scale(.96)" }, to: { opacity: 1, transform: "translate(-50%, -50%) scale(1)" } },
          }}
        >
          <Typography variant="subtitle2" sx={{ mb: reveal.codes.length ? 1 : 0, textAlign: "center" }}>
            {reveal.title}
          </Typography>
          {reveal.codes.length > 0 && (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, justifyContent: "center" }}>
              {reveal.codes.map((c, i) => (
                <CardImage key={i} code={c} width={reveal.kind === "negated" ? 110 : 84} negated={reveal.kind === "negated"} />
              ))}
            </Box>
          )}
        </Paper>
      )}

      {/* Pre-duel: rock paper scissors and turn order */}
      <Dialog open={client.status === "rps"} maxWidth="xs" fullWidth>
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
      </Dialog>
      <Dialog open={client.status === "choose-order"} maxWidth="xs" fullWidth>
        <DialogTitle>{client.rpsResult ? "You won rock-paper-scissors" : "Choose turn order"}</DialogTitle>
        <DialogActions sx={{ justifyContent: "center" }}>
          <Button variant="contained" onClick={() => client.chooseOrder(true)}>
            {res!.sys(100)}
          </Button>
          <Button variant="outlined" onClick={() => client.chooseOrder(false)}>
            {res!.sys(101)}
          </Button>
        </DialogActions>
      </Dialog>
      {(client.status === "rps-wait" || client.status === "order-wait" || client.status === "side-wait" || client.status === "rematch-wait") && !duel.winner && (
        <Box sx={{ position: "fixed", left: "50%", top: 16, transform: "translateX(-50%)", zIndex: 1500 }}>
          <Alert severity="info" variant="filled">
            {client.status === "rps-wait"
              ? "Waiting for the opponent's choice…"
              : client.status === "order-wait"
                ? "Waiting for the turn order…"
                : client.status === "side-wait"
                  ? "Waiting for the opponent to side deck…"
                  : "Waiting for the rematch answer…"}
          </Alert>
        </Box>
      )}

      {/* Side decking between games of a match */}
      {client.status === "siding" && client.deck && <SideDeckDialog deck={client.deck} onSubmit={(d) => client.submitSide(d)} />}

      {/* End of duel */}
      <Dialog open={!!winnerText && (client.status === "closed" || client.status === "rematch" || client.status === "rematch-wait" || client.status === "dueling")} maxWidth="xs" fullWidth>
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
      </Dialog>

      <Dialog open={confirmSurrender} onClose={() => setConfirmSurrender(false)}>
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
      </Dialog>
      {client.status === "closed" && !duel.winner && (
        <Dialog open maxWidth="xs" fullWidth>
          <DialogTitle>Disconnected</DialogTitle>
          <DialogContent>
            <Typography variant="body2">{client.error ?? "The connection to the server was closed."}</Typography>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={closeClient}>
              Back to lobby
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
