"use client";

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AppBar,
  Backdrop,
  Box,
  Button,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import CodeIcon from "@mui/icons-material/Code";
import SettingsIcon from "@mui/icons-material/Settings";
import { AppProvider, useApp, useClientState } from "./AppContext";
import DeckManager from "./decks/DeckManager";
import OnlineLobby from "./online/OnlineLobby";
import RoomView from "./room/RoomView";
import DuelView from "./duel/DuelView";

/** Link to this site's source code, as the AGPL asks for network services. */
const SOURCE_URL = process.env.NEXT_PUBLIC_SOURCE_URL || "";

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

/* ---------- room session in the URL (?server=…&room=…) ---------- */

const PW_KEY = "edopro-web:roomPassword";

function readSession(): { server: string; room: number; password: string } | null {
  const q = new URLSearchParams(window.location.search);
  const server = q.get("server");
  const room = Number(q.get("room"));
  if (!server || !Number.isInteger(room) || room <= 0) return null;
  let password = "";
  try {
    password = sessionStorage.getItem(`${PW_KEY}:${server}:${room}`) ?? "";
  } catch {
    /* ignore */
  }
  return { server, room, password };
}

function writeSession(server: string, room: number, password: string) {
  const q = new URLSearchParams(window.location.search);
  if (q.get("server") === server && q.get("room") === String(room)) return;
  q.set("server", server);
  q.set("room", String(room));
  window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
  try {
    // The password stays out of the URL; it only lives in this tab.
    if (password) sessionStorage.setItem(`${PW_KEY}:${server}:${room}`, password);
  } catch {
    /* ignore */
  }
}

function clearSession() {
  const q = new URLSearchParams(window.location.search);
  if (!q.has("server") && !q.has("room")) return;
  q.delete("server");
  q.delete("room");
  const rest = q.toString();
  window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
}

const DUEL_STATUSES = new Set(["rps", "rps-wait", "choose-order", "order-wait", "dueling", "siding", "side-wait", "rematch", "rematch-wait"]);

function Shell() {
  const { loading, loadErrors, client, closeClient, openClient, settings, config } = useApp();
  useClientState(client);
  const [tab, setTab] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Ask for a name the first time.
  useEffect(() => {
    if (!loading && !settings.name) setSettingsOpen(true);
  }, [loading, settings.name]);

  // Rejoin the room saved in the URL after a page reload.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || loading || !config || !settings.name) return;
    restored.current = true;
    const session = readSession();
    if (!session || client) return;
    openClient(session.server).join(session.room, session.password);
  }, [loading, config, settings.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the URL pointing at the current room, so a reload can rejoin it.
  useEffect(() => {
    if (!restored.current) return;
    if (client && client.roomId > 0 && client.status !== "closed") writeSession(client.serverId, client.roomId, client.password);
    else if (!client) clearSession();
  }, [client, client?.roomId, client?.status]);

  // Leaving the page mid-duel loses it: the server counts a disconnect as a loss.
  useEffect(() => {
    const inDuel = client && !client.isObserver && DUEL_STATUSES.has(client.status);
    if (!inDuel) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [client, client?.status]);

  // A connection that ended before a duel started goes back to the lobby with its error.
  useEffect(() => {
    if (client && client.status === "closed" && !client.duel.started) {
      setToast(client.error ?? "Disconnected");
      closeClient();
    }
  }, [client, client?.status, closeClient]);

  if (loading) {
    return (
      <Stack sx={{ height: "100vh", alignItems: "center", justifyContent: "center" }} spacing={2}>
        <CircularProgress />
        <Typography color="text.secondary">{loading}</Typography>
      </Stack>
    );
  }

  if (client && client.status === "lobby") return <RoomView client={client} />;
  if (client && (DUEL_STATUSES.has(client.status) || (client.status === "closed" && client.duel.started))) {
    return <DuelView client={client} />;
  }

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <AppBar position="sticky" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: 0.3 }}>
            EDOPro Web
          </Typography>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ flex: 1 }}>
            <Tab label="Online" />
            <Tab label="Decks" />
          </Tabs>
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
            {settings.name || "No name set"}
          </Typography>
          {SOURCE_URL && (
            <Tooltip title="Source code (AGPL-3.0)">
              <IconButton component="a" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
                <CodeIcon />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Settings">
            <IconButton onClick={() => setSettingsOpen(true)}>
              <SettingsIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        {loadErrors.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Some resources could not be loaded. Check the URLs in <code>web/.env</code>.
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {loadErrors.slice(0, 6).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </Box>
          </Alert>
        )}
        {tab === 0 ? <OnlineLobby onError={setToast} /> : <DeckManager />}
      </Container>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Backdrop open={client?.status === "connecting"} sx={{ zIndex: 2000 }}>
        <Stack alignItems="center" spacing={2}>
          <CircularProgress />
          <Typography>Connecting…</Typography>
          <Button variant="outlined" onClick={closeClient}>
            Cancel
          </Button>
        </Stack>
      </Backdrop>
      <Snackbar open={!!toast} autoHideDuration={6000} onClose={() => setToast(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity="error" onClose={() => setToast(null)} variant="filled">
          {toast}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, updateSettings, config, res } = useApp();
  const [name, setName] = useState(settings.name);
  useEffect(() => setName(settings.name), [settings.name, open]);
  const save = () => {
    updateSettings({ name: name.trim().slice(0, 19) });
    onClose();
  };
  return (
    <Dialog open={open} onClose={() => settings.name && onClose()} fullWidth maxWidth="xs">
      <DialogTitle>Settings</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Duelist name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 19 } }}
            helperText="Shown to other players (max 19 characters)"
            onKeyDown={(e) => e.key === "Enter" && name.trim() && save()}
          />
          <TextField
            select
            label="Chain prompts"
            value={settings.chainMode}
            onChange={(e) => updateSettings({ chainMode: e.target.value as typeof settings.chainMode })}
            helperText="When to ask before passing priority"
          >
            <MenuItem value="auto">Like EDOPro: only when it matters</MenuItem>
            <MenuItem value="ask">Always ask when something can be chained</MenuItem>
            <MenuItem value="never">Never ask (except forced triggers)</MenuItem>
          </TextField>
          <FormControlLabel
            control={<Switch checked={settings.autoPlace} onChange={(e) => updateSettings({ autoPlace: e.target.checked })} />}
            label="Place cards in the first free zone automatically"
          />
          <Typography variant="caption" color="text.secondary">
            Cards loaded: {res?.cards.size ?? 0}. Client version {config?.clientVersion.client.join(".")} (core {config?.clientVersion.core.join(".")}).
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={save} disabled={!name.trim()} variant="contained">
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
