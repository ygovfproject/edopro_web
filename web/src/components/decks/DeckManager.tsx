"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import { useApp } from "../AppContext";
import { CardImage, cardHeight } from "../CardImage";
import CardDetail from "../CardDetail";
import {
  clearLegacyLocalDecks,
  deckFromText,
  deckName,
  legacyLocalDecks,
  unknownCards,
  type DeckUpload,
  type StoredDeck,
} from "@/lib/data/decks";
import { CloudError } from "@/lib/data/cloud";

type Message = { kind: "success" | "error" | "info"; text: string };

/** The signed-in player's decks. They are stored on the server only. */
export default function DeckManager() {
  const { decks, deckLimit, decksLoading, uploadDeck, deleteDeck, user } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  /** The deck waiting for "Delete" to be confirmed. */
  const [confirmDelete, setConfirmDelete] = useState<StoredDeck | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = decks.find((d) => d.id === selectedId) ?? decks[0] ?? null;
  const full = decks.length >= deckLimit;

  // Decks an earlier version of the site kept in this browser: offer to upload them once.
  const [legacy, setLegacy] = useState<DeckUpload[]>([]);
  useEffect(() => setLegacy(legacyLocalDecks()), []);

  /** Uploads one by one (the server allows 10 writes a minute and 10 decks). */
  const upload = async (items: DeckUpload[], failed: string[] = []): Promise<DeckUpload[]> => {
    const done: DeckUpload[] = [];
    if (!items.length && !failed.length) return done;
    setBusy(true);
    setMessage(null);
    let added = 0;
    let lastId: string | null = null;
    const errors = [...failed.map((f) => `${f}: not a .ydk deck`)];
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          lastId = (await uploadDeck(item.name, item.ydk)).id;
          added++;
          done.push(item);
        } catch (e) {
          errors.push(`${item.name}: ${e instanceof CloudError ? e.message : "upload failed"}`);
          // At the deck limit, rate limited or signed out: the rest would fail the same way.
          if (e instanceof CloudError && (e.status === 409 || e.status === 429 || e.status === 401)) {
            const rest = items.length - i - 1;
            if (rest > 0) errors.push(`${rest} more not uploaded.`);
            break;
          }
        }
      }
    } finally {
      setBusy(false);
    }
    if (lastId) setSelectedId(lastId);
    const ok = added ? `Uploaded ${added} deck${added === 1 ? "" : "s"}.` : "";
    setMessage(errors.length ? { kind: "error", text: [ok, ...errors].filter(Boolean).join(" ") } : { kind: "success", text: ok });
    return done;
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const items: DeckUpload[] = [];
    const failed: string[] = [];
    for (const f of Array.from(files)) {
      const d = deckFromText(f.name, await f.text());
      if (d) items.push(d);
      else failed.push(f.name);
    }
    if (fileRef.current) fileRef.current.value = "";
    await upload(items, failed);
  };

  const remove = async (d: StoredDeck) => {
    setBusy(true);
    setMessage(null);
    try {
      await deleteDeck(d.id);
      setSelectedId(null);
      setMessage({ kind: "info", text: `Deleted "${d.name}".` });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof CloudError ? e.message : "Couldn't delete the deck." });
    } finally {
      setBusy(false);
    }
  };

  const download = (d: StoredDeck) => {
    // The .ydk exactly as it was uploaded.
    const blob = new Blob([d.ydk], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${d.name}.ydk`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!user) return null;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1, alignItems: "center" }}>
        <Button variant="contained" startIcon={<UploadFileIcon />} disabled={busy || full} onClick={() => fileRef.current?.click()}>
          Upload .ydk files
        </Button>
        <Button variant="outlined" startIcon={<ContentPasteIcon />} disabled={busy || full} onClick={() => setPasteOpen(true)}>
          Paste ydke:// or .ydk text
        </Button>
        <input ref={fileRef} type="file" accept=".ydk,text/plain" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        {busy && <CircularProgress size={20} />}
        <Typography variant="body2" color="text.secondary" sx={{ ml: "auto" }}>
          {decks.length} / {deckLimit} decks
        </Typography>
      </Stack>
      {/* Results (saved, deleted, uploaded, errors) pop up for a moment. Errors stay a little
          longer, since they can list several files. */}
      <Snackbar
        key={message?.text}
        open={!!message}
        autoHideDuration={message?.kind === "error" ? 4000 : 2000}
        onClose={(_, reason) => reason !== "clickaway" && setMessage(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={message?.kind ?? "info"} variant="filled" onClose={() => setMessage(null)} sx={{ maxWidth: 560 }}>
          {message?.text}
        </Alert>
      </Snackbar>
      {full && <Alert severity="info">You have {deckLimit} decks, the most an account can keep. Delete one to upload another.</Alert>}
      {legacy.length > 0 && (
        <Alert
          severity="info"
          action={
            <Stack direction="row" spacing={1}>
              <Button
                color="inherit"
                size="small"
                disabled={busy || full}
                onClick={async () => {
                  const done = await upload(legacy.slice(0, Math.max(0, deckLimit - decks.length)));
                  const left = legacy.filter((d) => !done.includes(d));
                  if (!left.length) clearLegacyLocalDecks();
                  setLegacy(left);
                }}
              >
                Upload
              </Button>
              <Button
                color="inherit"
                size="small"
                disabled={busy}
                onClick={() => {
                  clearLegacyLocalDecks();
                  setLegacy([]);
                }}
              >
                Discard
              </Button>
            </Stack>
          }
        >
          This browser still has {legacy.length} deck{legacy.length === 1 ? "" : "s"} from before accounts. Upload them to your account?
        </Alert>
      )}
      {decks.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          {decksLoading ? (
            <CircularProgress size={24} />
          ) : (
            <Typography color="text.secondary">
              No decks yet. Upload the .ydk files from your EDOPro <code>deck</code> folder.
            </Typography>
          )}
        </Paper>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "260px 1fr" }, gap: 2 }}>
          <Paper variant="outlined" sx={{ maxHeight: { md: "70vh" }, overflow: "auto" }}>
            <List dense>
              {decks.map((d) => (
                <ListItemButton key={d.id} selected={d.id === selected?.id} onClick={() => setSelectedId(d.id)}>
                  <ListItemText primary={d.name} secondary={`${d.deck.main.length} / ${d.deck.extra.length} / ${d.deck.side.length}`} />
                </ListItemButton>
              ))}
            </List>
          </Paper>
          {selected && (
            <DeckPreview
              key={selected.id}
              deck={selected}
              busy={busy}
              onMessage={setMessage}
              onDelete={() => setConfirmDelete(selected)}
              onDownload={() => download(selected)}
            />
          )}
        </Box>
      )}
      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this deck?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            &quot;{confirmDelete?.name}&quot; will be deleted from your account. This can&apos;t be undone; download the .ydk first if you
            want to keep a copy.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              const d = confirmDelete;
              setConfirmDelete(null);
              if (d) remove(d);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
      <PasteDialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onAdd={(d) => {
          setPasteOpen(false);
          upload([d]);
        }}
      />
    </Stack>
  );
}

const PER_ROW = 10;
const GAP = 4;

function DeckPreview({
  deck,
  busy,
  onMessage,
  onDelete,
  onDownload,
}: {
  deck: StoredDeck;
  busy: boolean;
  onMessage: (m: Message) => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const { res, renameDeck } = useApp();
  const [hover, setHover] = useState(0);
  const [name, setName] = useState(deck.name);
  const [saving, setSaving] = useState(false);
  useEffect(() => setName(deck.name), [deck.name]);
  const cleanName = name.trim();
  const changed = cleanName !== deck.name;
  const canSave = changed && !!cleanName && !saving && !busy;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await renameDeck(deck.id, deckName(cleanName));
      onMessage({ kind: "success", text: `Renamed to "${deckName(cleanName)}".` });
    } catch (e) {
      onMessage({ kind: "error", text: e instanceof CloudError ? e.message : "Couldn't rename the deck." });
    } finally {
      setSaving(false);
    }
  };

  const unknown = useMemo(() => (res ? unknownCards(deck.deck, res.cards) : []), [deck, res]);
  // 10 cards per row: measure the column and size cards to fill it.
  const gridRef = useRef<HTMLDivElement>(null);
  const [cardW, setCardW] = useState(58);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setCardW(Math.max(24, Math.floor((el.clientWidth - GAP * (PER_ROW - 1)) / PER_ROW)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Height of n rows of cards.
  const rowsH = (n: number) => (n > 0 ? n * cardHeight(cardW) + (n - 1) * GAP : 0);
  // Each section is as tall as its cards, between room for minRows and maxRows rows
  // (Main 40-60 cards, Extra/Side 1-2 rows, i.e. up to 15); a bigger section scrolls.
  const section = (title: string, codes: number[], minRows: number, maxRows: number) => (
    <Box>
      <Typography variant="overline" color="text.secondary">
        {title} ({codes.length})
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${PER_ROW}, ${cardW}px)`,
          gap: `${GAP}px`,
          alignContent: "start",
          minHeight: rowsH(minRows),
          maxHeight: rowsH(maxRows),
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {codes.map((c, i) => (
          <CardImage key={`${c}-${i}`} code={c} width={cardW} onHover={setHover} />
        ))}
      </Box>
    </Box>
  );
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <TextField
          size="small"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setName(deck.name);
          }}
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { "aria-label": "Deck name", maxLength: 64 } }}
        />
        <Button variant="contained" onClick={save} disabled={!canSave}>
          Save
        </Button>
        <Tooltip title="Download .ydk">
          <IconButton onClick={onDownload}>
            <DownloadIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete deck">
          <span>
            <IconButton onClick={onDelete} disabled={busy}>
              <DeleteIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {unknown.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {unknown.length} card{unknown.length === 1 ? " is" : "s are"} not in the loaded database:{" "}
          {unknown.slice(0, 8).map((c) => (
            <Chip key={c} size="small" label={c} sx={{ mr: 0.5 }} />
          ))}
        </Alert>
      )}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 260px" }, gap: 2 }}>
        <Stack spacing={1.5} ref={gridRef} sx={{ minWidth: 0 }}>
          {section("Main Deck", deck.deck.main, 4, 6)}
          {section("Extra Deck", deck.deck.extra, 1, 2)}
          {section("Side Deck", deck.deck.side, 1, 2)}
        </Stack>
        {/* As tall as the deck (it doesn't make the view taller); scrolls if it needs more. */}
        <Box sx={{ display: { xs: "none", lg: "block" }, position: "relative", minHeight: 0 }}>
          <Box sx={{ position: "absolute", inset: 0, overflowY: "auto" }}>
            <CardDetail code={hover} imageWidth={200} />
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}

function PasteDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (d: DeckUpload) => void }) {
  const [name, setName] = useState("Pasted deck");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const d = deckFromText(name, text);
    if (!d) {
      setError("That doesn't look like a .ydk file or a ydke:// link.");
      return;
    }
    onAdd(d);
    setText("");
    setError(null);
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Paste a deck</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 64 } }} />
          <TextField label="ydke:// link or .ydk contents" value={text} onChange={(e) => setText(e.target.value)} multiline minRows={6} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={add} variant="contained" disabled={!text.trim()}>
          Upload
        </Button>
      </DialogActions>
    </Dialog>
  );
}
