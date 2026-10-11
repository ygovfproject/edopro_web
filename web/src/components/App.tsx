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
import LoginIcon from "@mui/icons-material/Login";
import SettingsIcon from "@mui/icons-material/Settings";
import { AppProvider, useApp, useClientState } from "./AppContext";
import { AuthDialog, DeleteAccountDialog } from "./account/AccountDialogs";
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
  const { loading, loadErrors, client, closeClient, openClient, config, user, authReady, playerName } = useApp();
  useClientState(client);
  const [tab, setTab] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // The Decks tab is only there when signed in.
  useEffect(() => {
    if (authReady && !user) setTab(0);
  }, [authReady, user]);

  // Rejoin the room saved in the URL after a page reload (once the saved session is
  // checked, so the right name is used).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || loading || !config || !authReady) return;
    restored.current = true;
    const session = readSession();
    if (!session || client) return;
    openClient(session.server).join(session.room, session.password);
  }, [loading, config, authReady]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <Tabs value={user ? tab : 0} onChange={(_, v) => setTab(v)} sx={{ flex: 1 }}>
            <Tab label="Online" />
            {user && <Tab label="Decks" />}
          </Tabs>
          {authReady && !user && (
            <Button variant="contained" startIcon={<LoginIcon />} onClick={() => setAuthOpen(true)}>
              Sign in
            </Button>
          )}
          <Tooltip title={user ? "Signed in" : "Guest: sign in to duel"}>
            <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
              {playerName}
            </Typography>
          </Tooltip>
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
        {tab === 1 && user ? <DeckManager /> : <OnlineLobby onError={setToast} onSignIn={() => setAuthOpen(true)} />}
      </Container>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onSignIn={() => setAuthOpen(true)} />
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
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

function SettingsDialog({ open, onClose, onSignIn }: { open: boolean; onClose: () => void; onSignIn: () => void }) {
  const { settings, updateSettings, config, res, user, playerName, signOut } = useApp();
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Settings</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              {user ? "Account" : "Guest"}
            </Typography>
            <Typography>
              Duelist name: <b>{playerName}</b>
            </Typography>
            {user ? (
              <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: "center" }}>
                <Button size="small" variant="outlined" onClick={() => signOut()}>
                  Sign out
                </Button>
                <Button size="small" color="error" onClick={() => setDeleteOpen(true)}>
                  Delete account
                </Button>
              </Stack>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Guests can watch duels. Sign in to host or join duels and to keep decks.
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  sx={{ mt: 1 }}
                  onClick={() => {
                    onClose();
                    onSignIn();
                  }}
                >
                  Sign in
                </Button>
              </>
            )}
            {user && (
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                Accounts not used for 90 days are deleted together with their decks.
              </Typography>
            )}
          </Box>
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
        {SOURCE_URL && (
          <Button
            component="a"
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            color="inherit"
            startIcon={<CodeIcon />}
            sx={{ mr: "auto" }}
          >
            Source code (AGPL-3.0)
          </Button>
        )}
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
      <DeleteAccountDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} onDeleted={() => setDeleteOpen(false)} />
    </Dialog>
  );
}
