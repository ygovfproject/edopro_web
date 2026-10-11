"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import { useApp } from "../AppContext";
import { CloudError } from "@/lib/data/cloud";

/** Sign in, or create an account. */
export function AuthDialog({ open, onClose, onSignedIn }: { open: boolean; onClose: () => void; onSignedIn?: () => void }) {
  const { cloud, signedIn } = useApp();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setPassword2("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!cloud || busy || !username.trim() || !password) return;
    setError(null);
    if (mode === "register" && password !== password2) return setError("The passwords don't match.");
    setBusy(true);
    try {
      const u = mode === "login" ? await cloud.login(username.trim(), password) : await cloud.register(username.trim(), password);
      signedIn(u);
      onClose();
      onSignedIn?.();
    } catch (e) {
      setError(e instanceof CloudError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>{mode === "login" ? "Sign in" : "Create an account"}</DialogTitle>
      <Tabs
        value={mode}
        onChange={(_, v) => {
          setMode(v);
          setError(null);
        }}
        sx={{ px: 2 }}
      >
        <Tab value="login" label="Sign in" />
        <Tab value="register" label="Create account" />
      </Tabs>
      <DialogContent>
        <Stack
          spacing={2}
          sx={{ pt: 1 }}
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Typography variant="body2" color="text.secondary">
            With an account you can host and join duels, and keep up to 10 decks on the server. Your username is your duelist name.
          </Typography>
          {mode === "register" && (
            <Alert severity="warning">
              There is no password recovery. If you forget your password, the account and its decks can&apos;t be recovered.
              Accounts not used for 90 days are deleted.
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            helperText={mode === "register" ? "3-19 characters: letters, digits, _ . -" : undefined}
            slotProps={{ htmlInput: { maxLength: 19 } }}
            autoFocus
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            helperText={mode === "register" ? "At least 8 characters" : undefined}
            slotProps={{ htmlInput: { maxLength: 128 } }}
          />
          {mode === "register" && (
            <TextField
              label="Repeat password"
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              autoComplete="new-password"
              slotProps={{ htmlInput: { maxLength: 128 } }}
            />
          )}
          <button type="submit" hidden />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !cloud || !username.trim() || !password} onClick={submit}>
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Deletes the account and its decks (asks for the password). */
export function DeleteAccountDialog({ open, onClose, onDeleted }: { open: boolean; onClose: () => void; onDeleted: () => void }) {
  const { cloud, signOut } = useApp();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) {
      setPassword("");
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete your account?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2">This deletes the account and all its decks. It can&apos;t be undone.</Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          disabled={busy || !password || !cloud}
          onClick={async () => {
            if (!cloud) return;
            setBusy(true);
            setError(null);
            try {
              await cloud.deleteAccount(password);
              await signOut();
              onDeleted();
            } catch (e) {
              setError(e instanceof CloudError ? e.message : "Something went wrong.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete account
        </Button>
      </DialogActions>
    </Dialog>
  );
}
