"use client";

import { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import { useApp } from "../AppContext";
import { MASTER_RULES } from "@/lib/protocol/constants";
import { defaultHostInfo, type HostInfo } from "@/lib/protocol/packets";

const HOST_KEY = "edopro-web:hostOptions";

interface HostOptions {
  notes: string;
  password: string;
  banlistHash: number;
  rule: number;
  masterRule: string;
  bestOf: number;
  lp: number;
  startHand: number;
  drawCount: number;
  timeLimit: number;
  teamSize: number;
  noCheckDeck: boolean;
  noShuffleDeck: boolean;
}

const DEFAULTS: HostOptions = {
  notes: "",
  password: "",
  banlistHash: 0,
  rule: 2,
  masterRule: "mr5",
  bestOf: 1,
  lp: 8000,
  startHand: 5,
  drawCount: 1,
  timeLimit: 180,
  teamSize: 1,
  noCheckDeck: false,
  noShuffleDeck: false,
};

function readOptions(): HostOptions {
  try {
    const raw = localStorage.getItem(HOST_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), password: "" };
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

export default function HostDialog({
  open,
  onClose,
  onHost,
}: {
  open: boolean;
  onClose: () => void;
  onHost: (info: HostInfo, password: string, notes: string) => void;
}) {
  const { config, res } = useApp();
  const [o, setO] = useState<HostOptions>(() => (typeof window === "undefined" ? DEFAULTS : readOptions()));
  const set = <K extends keyof HostOptions>(k: K, v: HostOptions[K]) => setO((prev) => ({ ...prev, [k]: v }));
  const num = (k: keyof HostOptions) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  const submit = () => {
    try {
      localStorage.setItem(HOST_KEY, JSON.stringify({ ...o, password: "" }));
    } catch {
      /* ignore */
    }
    const preset = MASTER_RULES.find((r) => r.id === o.masterRule) ?? MASTER_RULES[0];
    const info = defaultHostInfo(config!.clientVersion);
    const speed = preset.id === "speed" || preset.id === "rush";
    Object.assign(info, {
      banlistHash: o.banlistHash,
      rule: o.rule,
      bestOf: o.bestOf,
      startLp: o.lp,
      startHand: o.startHand,
      drawCount: o.drawCount,
      timeLimit: o.timeLimit,
      team1: o.teamSize,
      team2: o.teamSize,
      noCheckDeck: o.noCheckDeck,
      noShuffleDeck: o.noShuffleDeck,
      duelFlags: preset.flags,
      forbiddenTypes: preset.forbiddenTypes,
    });
    if (speed) {
      info.limits = { main: { min: 20, max: 30 }, extra: { min: 0, max: 6 }, side: { min: 0, max: 6 } };
      if (o.startHand === 5 && preset.id === "speed") info.startHand = 4;
      if (o.lp === 8000 && preset.id === "speed") info.startLp = 4000;
    }
    onHost(info, o.password, o.notes);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Host a room</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Room notes" value={o.notes} onChange={(e) => set("notes", e.target.value.slice(0, 199))} placeholder="e.g. Casual, no hand traps" />
          <TextField label="Password (optional)" type="password" value={o.password} onChange={(e) => set("password", e.target.value.slice(0, 19))} />
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
            <TextField select label="Banlist" value={o.banlistHash} onChange={num("banlistHash")}>
              <MenuItem value={0}>No banlist</MenuItem>
              {res?.banlists.map((b) => (
                <MenuItem key={b.hash} value={b.hash}>
                  {b.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField select label="Allowed cards" value={o.rule} onChange={num("rule")}>
              <MenuItem value={0}>OCG</MenuItem>
              <MenuItem value={1}>TCG</MenuItem>
              <MenuItem value={2}>OCG/TCG</MenuItem>
              <MenuItem value={3}>OCG/TCG + Prerelease</MenuItem>
              <MenuItem value={4}>Any (incl. custom/anime)</MenuItem>
            </TextField>
            <TextField select label="Duel rule" value={o.masterRule} onChange={(e) => set("masterRule", e.target.value)}>
              {MASTER_RULES.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField select label="Match" value={o.bestOf} onChange={num("bestOf")}>
              <MenuItem value={1}>Single duel</MenuItem>
              <MenuItem value={3}>Best of 3</MenuItem>
              <MenuItem value={5}>Best of 5</MenuItem>
            </TextField>
            <TextField select label="Players" value={o.teamSize} onChange={num("teamSize")}>
              <MenuItem value={1}>1 vs 1</MenuItem>
              <MenuItem value={2}>2 vs 2 (Tag)</MenuItem>
              <MenuItem value={3}>3 vs 3</MenuItem>
            </TextField>
            <TextField select label="Time limit" value={o.timeLimit} onChange={num("timeLimit")}>
              <MenuItem value={0}>None</MenuItem>
              <MenuItem value={120}>2 minutes</MenuItem>
              <MenuItem value={180}>3 minutes</MenuItem>
              <MenuItem value={300}>5 minutes</MenuItem>
              <MenuItem value={600}>10 minutes</MenuItem>
            </TextField>
            <TextField label="Starting LP" type="number" value={o.lp} onChange={num("lp")} slotProps={{ htmlInput: { min: 1, max: 999999 } }} />
            <TextField label="Starting hand" type="number" value={o.startHand} onChange={num("startHand")} slotProps={{ htmlInput: { min: 0, max: 40 } }} />
            <TextField label="Cards drawn per turn" type="number" value={o.drawCount} onChange={num("drawCount")} slotProps={{ htmlInput: { min: 0, max: 35 } }} />
          </Box>
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
            <FormControlLabel control={<Switch checked={o.noCheckDeck} onChange={(e) => set("noCheckDeck", e.target.checked)} />} label="Don't check decks" />
            <FormControlLabel control={<Switch checked={o.noShuffleDeck} onChange={(e) => set("noShuffleDeck", e.target.checked)} />} label="Don't shuffle decks" />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!config}>
          Host
        </Button>
      </DialogActions>
    </Dialog>
  );
}
