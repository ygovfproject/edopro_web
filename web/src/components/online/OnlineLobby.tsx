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
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useRouter } from "next/navigation";
import RefreshIcon from "@mui/icons-material/Refresh";
import LockIcon from "@mui/icons-material/Lock";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import { useApp } from "../AppContext";
import HostDialog from "./HostDialog";
import { MASTER_RULES, masterRuleIdOf, masterRuleOf } from "@/lib/protocol/constants";

interface ServerEntry {
  id: string;
  name: string;
}

export interface RoomEntry {
  roomid: number;
  roomnotes: string;
  needpass: boolean;
  team1: number;
  team2: number;
  best_of: number;
  duel_flag: number;
  start_lp: number;
  time_limit: number;
  rule: number;
  banlist_hash: number;
  no_check: boolean;
  istart: string;
  users: { pos: number; name: string }[];
}

const SERVER_KEY = "edopro-web:server";
const COOKIE_STARTED = "edopro_hide_started";
const COOKIE_LOCKED = "edopro_hide_locked";
const COOKIE_RULE = "edopro_rule_filter";
const COOKIE_CARDS = "edopro_cards_filter";
const COOKIE_MATCH = "edopro_match_filter";

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}
const RULES = ["OCG", "TCG", "OCG/TCG", "Prerelease", "Any"];

export default function OnlineLobby({ onError }: { onError: (msg: string) => void }) {
  const { config, res, openClient, settings, decks } = useApp();
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [serverId, setServerId] = useState<string>("");
  const [rooms, setRooms] = useState<RoomEntry[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [hideStarted, setHideStartedState] = useState(true);
  const [hideLocked, setHideLockedState] = useState(true);
  // Rule filters: "" = any. Rule is a preset id or "custom"; cards is the allowed-cards value; match is best-of.
  const [ruleFilter, setRuleFilterState] = useState("");
  const [cardsFilter, setCardsFilterState] = useState("");
  const [matchFilter, setMatchFilterState] = useState("");
  useEffect(() => {
    setRuleFilterState(readCookie(COOKIE_RULE) ?? "");
    setCardsFilterState(readCookie(COOKIE_CARDS) ?? "");
    setMatchFilterState(readCookie(COOKIE_MATCH) ?? "");
  }, []);
  const setRuleFilter = (v: string) => {
    setRuleFilterState(v);
    writeCookie(COOKIE_RULE, v);
  };
  const setCardsFilter = (v: string) => {
    setCardsFilterState(v);
    writeCookie(COOKIE_CARDS, v);
  };
  const setMatchFilter = (v: string) => {
    setMatchFilterState(v);
    writeCookie(COOKIE_MATCH, v);
  };

  // Filters are remembered in cookies; both default to on.
  useEffect(() => {
    setHideStartedState(readCookie(COOKIE_STARTED) !== "0");
    setHideLockedState(readCookie(COOKIE_LOCKED) !== "0");
  }, []);
  const setHideStarted = (v: boolean) => {
    setHideStartedState(v);
    writeCookie(COOKIE_STARTED, v ? "1" : "0");
  };
  const setHideLocked = (v: boolean) => {
    setHideLockedState(v);
    writeCookie(COOKIE_LOCKED, v ? "1" : "0");
  };
  const [hostOpen, setHostOpen] = useState(false);
  const [joinTarget, setJoinTarget] = useState<RoomEntry | null>(null);
  const [byIdOpen, setByIdOpen] = useState(false);

  const router = useRouter();
  const proxy = config?.proxyUrl.replace(/\/+$/, "") ?? "";

  useEffect(() => {
    if (!proxy) return;
    fetch(`${proxy}/api/servers`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: { servers: ServerEntry[] }) => {
        setServers(j.servers);
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(SERVER_KEY);
        } catch {
          /* ignore */
        }
        setServerId(j.servers.find((s) => s.id === saved)?.id ?? j.servers[0]?.id ?? "");
      })
      .catch(() => router.replace("/server-error"));
  }, [proxy, router]);

  const refresh = useCallback(async () => {
    if (!serverId) return;
    setLoadingRooms(true);
    try {
      let r: Response;
      try {
        r = await fetch(`${proxy}/api/servers/${encodeURIComponent(serverId)}/rooms`);
      } catch {
        // The proxy itself is unreachable.
        router.replace("/server-error");
        return;
      }
      // 502 = that EDOPro server's room list is down; other servers may still work.
      if (r.status >= 500 && r.status !== 502) {
        router.replace("/server-error");
        return;
      }
      const j = await r.json();
      setRooms(Array.isArray(j.rooms) ? j.rooms : []);
      setRoomError(j.error ?? null);
    } catch {
      setRoomError("Could not load the room list.");
    } finally {
      setLoadingRooms(false);
    }
  }, [proxy, serverId, router]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const chooseServer = (id: string) => {
    setServerId(id);
    try {
      localStorage.setItem(SERVER_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rooms.filter((r) => {
      if (hideStarted && r.istart !== "waiting") return false;
      if (hideLocked && r.needpass) return false;
      if (ruleFilter) {
        const id = masterRuleIdOf(BigInt(Math.trunc(r.duel_flag))) ?? "custom";
        if (id !== ruleFilter) return false;
      }
      if (cardsFilter !== "" && r.rule !== Number(cardsFilter)) return false;
      if (matchFilter === "single" && r.best_of > 1) return false;
      if (matchFilter === "match" && r.best_of <= 1) return false;
      if (!q) return true;
      return r.roomnotes.toLowerCase().includes(q) || r.users.some((u) => u.name.toLowerCase().includes(q));
    });
  }, [rooms, filter, hideStarted, hideLocked, ruleFilter, cardsFilter, matchFilter]);

  const needSetup = !settings.name ? "Set your duelist name in Settings first." : decks.length === 0 ? "Upload a deck in the Decks tab first." : null;

  // Watching a duel in progress needs no deck; taking a seat in a waiting room does.
  const join = (room: RoomEntry, password = "") => {
    const watching = room.istart !== "waiting";
    if (!watching && needSetup) return onError(needSetup);
    const c = openClient(serverId);
    c.join(room.roomid, password);
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
        <TextField select size="small" label="Server" value={serverId} onChange={(e) => chooseServer(e.target.value)} sx={{ minWidth: 240 }}>
          {servers.map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          placeholder="Filter by notes or player"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          sx={{ flex: 1 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={refresh} disabled={!serverId}>
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Button variant="outlined" onClick={() => setByIdOpen(true)} disabled={!serverId}>
          Join by ID
        </Button>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          disabled={!serverId}
          onClick={() => (needSetup ? onError(needSetup) : setHostOpen(true))}
        >
          Host
        </Button>
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        <TextField select size="small" label="Rule" value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value)} sx={{ minWidth: 190 }}>
          <MenuItem value="">Any rule</MenuItem>
          {MASTER_RULES.map((r) => (
            <MenuItem key={r.id} value={r.id}>
              {r.label}
            </MenuItem>
          ))}
          <MenuItem value="custom">Custom rules</MenuItem>
        </TextField>
        <TextField select size="small" label="Cards" value={cardsFilter} onChange={(e) => setCardsFilter(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">Any</MenuItem>
          {RULES.map((label, i) => (
            <MenuItem key={i} value={String(i)}>
              {label}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Match" value={matchFilter} onChange={(e) => setMatchFilter(e.target.value)} sx={{ minWidth: 130 }}>
          <MenuItem value="">Any</MenuItem>
          <MenuItem value="single">Single duel</MenuItem>
          <MenuItem value="match">Match (Bo3+)</MenuItem>
        </TextField>
        <FormControlLabel control={<Switch size="small" checked={hideStarted} onChange={(e) => setHideStarted(e.target.checked)} />} label="Hide started" />
        <FormControlLabel control={<Switch size="small" checked={hideLocked} onChange={(e) => setHideLocked(e.target.checked)} />} label="Hide locked" />
      </Stack>
      {roomError && <Alert severity="warning">{roomError}</Alert>}
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        {loadingRooms && <LinearProgress sx={{ height: 2 }} />}
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Room</TableCell>
                <TableCell>Players</TableCell>
                <TableCell>Rules</TableCell>
                <TableCell>Banlist</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                      {rooms.length ? "No rooms match the filters." : "No open rooms. Host one!"}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {shown.map((r) => {
                const rule = masterRuleOf(BigInt(Math.trunc(r.duel_flag)));
                return (
                  <TableRow key={r.roomid} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        {r.needpass && <LockIcon fontSize="small" color="disabled" />}
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {r.roomnotes || `Room ${r.roomid}`}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            #{r.roomid} · {r.istart === "waiting" ? "Waiting" : "Dueling"}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{r.users.map((u) => u.name).join(", ") || "—"}</Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
                        <Chip size="small" label={`${r.team1}v${r.team2}`} />
                        <Chip size="small" label={`Bo${r.best_of}`} />
                        <Chip size="small" label={RULES[r.rule] ?? "?"} />
                        {rule && <Chip size="small" label={rule.replace(/ \(.*\)/, "")} />}
                        {r.start_lp !== 8000 && <Chip size="small" label={`${r.start_lp} LP`} />}
                        {r.no_check && <Chip size="small" color="warning" label="No deck check" />}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{res?.banlistName(r.banlist_hash) ?? r.banlist_hash}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" variant="outlined" onClick={() => (r.needpass ? setJoinTarget(r) : join(r))}>
                        {r.istart === "waiting" ? "Join" : "Watch"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      </Paper>
      <HostDialog
        open={hostOpen}
        onClose={() => setHostOpen(false)}
        onHost={(info, password, notes) => {
          setHostOpen(false);
          const c = openClient(serverId);
          c.host(info, password, notes);
        }}
      />
      <PasswordDialog
        room={joinTarget}
        onClose={() => setJoinTarget(null)}
        onJoin={(pw) => {
          const r = joinTarget!;
          setJoinTarget(null);
          join(r, pw);
        }}
      />
      <JoinByIdDialog
        open={byIdOpen}
        onClose={() => setByIdOpen(false)}
        onJoin={(id, pw) => {
          setByIdOpen(false);
          // The room may be waiting or already dueling; without a deck you can still watch or spectate.
          openClient(serverId).join(id, pw);
        }}
      />
    </Stack>
  );
}

function PasswordDialog({ room, onClose, onJoin }: { room: RoomEntry | null; onClose: () => void; onJoin: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  return (
    <Dialog open={!!room} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Room password</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          type="password"
          label="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onJoin(pw)}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onJoin(pw)}>
          Join
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function JoinByIdDialog({ open, onClose, onJoin }: { open: boolean; onClose: () => void; onJoin: (id: number, pw: string) => void }) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const valid = /^\d+$/.test(id.trim());
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Join by room ID</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField autoFocus label="Room ID" value={id} onChange={(e) => setId(e.target.value)} />
          <TextField type="password" label="Password (if any)" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid} onClick={() => onJoin(Number(id.trim()), pw)}>
          Join
        </Button>
      </DialogActions>
    </Dialog>
  );
}
