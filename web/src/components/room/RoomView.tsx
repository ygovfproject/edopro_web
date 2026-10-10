"use client";

import { useEffect, useMemo } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import { useApp, useClientState } from "../AppContext";
import ChatBox from "../ChatBox";
import type { DuelClient } from "@/lib/game/client";
import { normaliseDeck } from "@/lib/data/decks";
import { DECK_ERROR, masterRuleOf } from "@/lib/protocol/constants";

const RULES = ["OCG", "TCG", "OCG/TCG", "OCG/TCG + Prerelease", "Any"];

export default function RoomView({ client }: { client: DuelClient }) {
  useClientState(client);
  const { decks, res, settings, updateSettings, closeClient } = useApp();
  const info = client.hostInfo!;
  const [t1, t2] = client.teamSizes;
  const isDuelist = !client.isObserver;
  const me = client.slots[client.selfPos];
  const selectedDeckId = decks.some((d) => d.id === settings.defaultDeckId) ? settings.defaultDeckId! : decks[0]?.id ?? "";

  // Keep the client's deck in sync with the chosen deck.
  const chosen = decks.find((d) => d.id === selectedDeckId);
  useEffect(() => {
    if (chosen && res) client.setDeck(normaliseDeck(chosen.deck, res.cards));
  }, [chosen, res, client]);

  const allReady = client.slots.length === t1 + t2 && client.slots.every((s) => s?.ready);
  const deckError = useMemo(() => {
    const e = client.deckError;
    if (!e || e.kind !== "deck") return null;
    const card = e.card ? `${res?.cards.name(e.card) ?? e.card}` : "";
    switch (e.code) {
      case DECK_ERROR.LFLIST:
        return `${card} is not allowed by the banlist (or too many copies).`;
      case DECK_ERROR.OCGONLY:
        return `${card} is OCG-only.`;
      case DECK_ERROR.TCGONLY:
        return `${card} is TCG-only.`;
      case DECK_ERROR.UNKNOWNCARD:
        return `${card || "A card"} is not known to the server.`;
      case DECK_ERROR.CARDCOUNT:
        return `Too many copies of ${card}.`;
      case DECK_ERROR.MAINCOUNT:
        return `Main Deck has ${e.got} cards (allowed ${e.min}–${e.max}).`;
      case DECK_ERROR.EXTRACOUNT:
        return `Extra Deck has ${e.got} cards (allowed ${e.min}–${e.max}).`;
      case DECK_ERROR.SIDECOUNT:
        return `Side Deck has ${e.got} cards (allowed ${e.min}–${e.max}).`;
      case DECK_ERROR.FORBTYPE:
        return `${card} has a card type forbidden by this duel rule.`;
      case DECK_ERROR.UNOFFICIALCARD:
        return `${card} is not an official card.`;
      default:
        return "The server rejected your deck.";
    }
  }, [client.deckError, res]);

  const slot = (pos: number) => {
    const s = client.slots[pos];
    const mine = pos === client.selfPos;
    return (
      <Paper key={pos} variant="outlined" sx={{ p: 1.25, display: "flex", alignItems: "center", gap: 1, borderColor: mine ? "primary.main" : undefined }}>
        {s?.ready ? <CheckCircleIcon color="success" /> : <RadioButtonUncheckedIcon color="disabled" />}
        <Typography sx={{ flex: 1, fontWeight: mine ? 700 : 400 }} color={s ? "text.primary" : "text.disabled"}>
          {s ? s.name : "Empty"}
          {mine && " (you)"}
        </Typography>
        {client.isHost && s && !mine && (
          <Tooltip title="Kick">
            <IconButton size="small" onClick={() => client.kick(pos)}>
              <PersonRemoveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Paper>
    );
  };

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack spacing={2}>
        <Stack direction="row" sx={{ alignItems: "center" }} spacing={2}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              Room {client.roomId || ""}
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5, mt: 0.5 }}>
              <Chip size="small" label={res?.banlistName(info.banlistHash) ?? "Banlist"} />
              <Chip size="small" label={RULES[info.rule] ?? "?"} />
              <Chip size="small" label={masterRuleOf(info.duelFlags) ?? "Custom rules"} />
              <Chip size="small" label={info.bestOf > 1 ? `Best of ${info.bestOf}` : "Single"} />
              <Chip size="small" label={`${info.startLp} LP`} />
              <Chip size="small" label={info.timeLimit ? `${Math.round(info.timeLimit / 60)} min` : "No time limit"} />
              {info.noCheckDeck && <Chip size="small" color="warning" label="Decks not checked" />}
            </Stack>
          </Box>
          <Button color="inherit" variant="outlined" onClick={closeClient}>
            Leave
          </Button>
        </Stack>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
          <Stack spacing={1}>
            <Typography variant="overline">Team 1</Typography>
            {Array.from({ length: t1 }, (_, i) => slot(i))}
          </Stack>
          <Stack spacing={1}>
            <Typography variant="overline">Team 2</Typography>
            {Array.from({ length: t2 }, (_, i) => slot(t1 + i))}
          </Stack>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Spectators: {client.spectators}
        </Typography>

        {deckError && <Alert severity="error">{deckError}</Alert>}
        {decks.length === 0 && (
          <Alert severity="info">You have no decks yet, so you can only spectate. Upload a .ydk in the Decks tab to duel.</Alert>
        )}

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
            <TextField
              select
              size="small"
              label="Deck"
              value={selectedDeckId}
              onChange={(e) => updateSettings({ defaultDeckId: e.target.value })}
              sx={{ minWidth: 220, flex: 1 }}
              disabled={!!me?.ready}
            >
              {decks.map((d) => (
                <MenuItem key={d.id} value={d.id}>
                  {d.name} ({d.deck.main.length}/{d.deck.extra.length}/{d.deck.side.length})
                </MenuItem>
              ))}
            </TextField>
            {isDuelist &&
              (me?.ready ? (
                <Button variant="outlined" onClick={() => client.notReady()}>
                  Not ready
                </Button>
              ) : (
                <Button variant="contained" color="success" onClick={() => client.ready()} disabled={!chosen}>
                  Ready
                </Button>
              ))}
            {isDuelist ? (
              <Button variant="outlined" onClick={() => client.toObserver()} disabled={!!me?.ready}>
                Spectate
              </Button>
            ) : (
              <Button variant="outlined" onClick={() => client.toDuelist()}>
                Join as duelist
              </Button>
            )}
            {t1 + t2 > 2 && isDuelist && (
              <Button variant="outlined" onClick={() => client.toDuelist()} disabled={!!me?.ready}>
                Switch slot
              </Button>
            )}
            {client.isHost && (
              <Button variant="contained" onClick={() => client.startDuel()} disabled={!allReady}>
                Start duel
              </Button>
            )}
          </Stack>
        </Paper>

        <Paper variant="outlined">
          <ChatBox client={client} height={240} />
        </Paper>
      </Stack>
    </Container>
  );
}
