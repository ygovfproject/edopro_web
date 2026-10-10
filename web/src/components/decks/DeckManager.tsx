"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import { useApp } from "../AppContext";
import { CardImage } from "../CardImage";
import CardDetail from "../CardDetail";
import { deckFromText, normaliseDeck, unknownCards, type StoredDeck } from "@/lib/data/decks";
import { toYdk } from "@/lib/protocol/ydk";

export default function DeckManager() {
  const { decks, setDecks, res, settings, updateSettings } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(decks[0]?.id ?? null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = decks.find((d) => d.id === selectedId) ?? decks[0] ?? null;

  const addDecks = (added: StoredDeck[]) => {
    if (!added.length) return;
    const fixed = res ? added.map((d) => ({ ...d, deck: normaliseDeck(d.deck, res.cards) })) : added;
    setDecks([...decks, ...fixed]);
    setSelectedId(fixed[fixed.length - 1].id);
    if (!settings.defaultDeckId) updateSettings({ defaultDeckId: fixed[0].id });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: StoredDeck[] = [];
    const failed: string[] = [];
    for (const f of Array.from(files)) {
      const d = deckFromText(f.name, await f.text());
      if (d) added.push(d);
      else failed.push(f.name);
    }
    addDecks(added);
    setMessage(
      failed.length
        ? { kind: "error", text: `Could not read: ${failed.join(", ")}` }
        : { kind: "success", text: `Added ${added.length} deck${added.length === 1 ? "" : "s"}` },
    );
    if (fileRef.current) fileRef.current.value = "";
  };

  const remove = (id: string) => {
    const next = decks.filter((d) => d.id !== id);
    setDecks(next);
    if (settings.defaultDeckId === id) updateSettings({ defaultDeckId: next[0]?.id ?? null });
    setSelectedId(next[0]?.id ?? null);
  };

  const download = (d: StoredDeck) => {
    const blob = new Blob([toYdk(d.deck)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${d.name}.ydk`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
        <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => fileRef.current?.click()}>
          Upload .ydk files
        </Button>
        <Button variant="outlined" startIcon={<ContentPasteIcon />} onClick={() => setPasteOpen(true)}>
          Paste ydke:// or .ydk text
        </Button>
        <input ref={fileRef} type="file" accept=".ydk,text/plain" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      </Stack>
      {message && (
        <Alert severity={message.kind} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}
      {decks.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">
            No decks yet. Upload the .ydk files from your EDOPro <code>deck</code> folder.
          </Typography>
        </Paper>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "260px 1fr" }, gap: 2 }}>
          <Paper variant="outlined" sx={{ maxHeight: { md: "70vh" }, overflow: "auto" }}>
            <List dense>
              {decks.map((d) => (
                <ListItemButton key={d.id} selected={d.id === selected?.id} onClick={() => setSelectedId(d.id)}>
                  <ListItemText primary={d.name} secondary={`${d.deck.main.length} / ${d.deck.extra.length} / ${d.deck.side.length}`} />
                  {settings.defaultDeckId === d.id && <StarIcon fontSize="small" color="secondary" />}
                </ListItemButton>
              ))}
            </List>
          </Paper>
          {selected && (
            <DeckPreview
              deck={selected}
              isDefault={settings.defaultDeckId === selected.id}
              onDefault={() => updateSettings({ defaultDeckId: selected.id })}
              onRename={(name) => setDecks(decks.map((d) => (d.id === selected.id ? { ...d, name } : d)))}
              onDelete={() => remove(selected.id)}
              onDownload={() => download(selected)}
            />
          )}
        </Box>
      )}
      <PasteDialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onAdd={(d) => {
          addDecks([d]);
          setMessage({ kind: "success", text: `Added ${d.name}` });
        }}
      />
    </Stack>
  );
}

const PER_ROW = 10;
const GAP = 4;

function DeckPreview({
  deck,
  isDefault,
  onDefault,
  onRename,
  onDelete,
  onDownload,
}: {
  deck: StoredDeck;
  isDefault: boolean;
  onDefault: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const { res } = useApp();
  const [hover, setHover] = useState(0);
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
  const section = (title: string, codes: number[]) => (
    <Box>
      <Typography variant="overline" color="text.secondary">
        {title} ({codes.length})
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${PER_ROW}, ${cardW}px)`, gap: `${GAP}px` }}>
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
          value={deck.name}
          onChange={(e) => onRename(e.target.value)}
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { "aria-label": "Deck name" } }}
        />
        <Tooltip title={isDefault ? "Default deck" : "Use as default deck"}>
          <IconButton onClick={onDefault}>{isDefault ? <StarIcon color="secondary" /> : <StarBorderIcon />}</IconButton>
        </Tooltip>
        <Tooltip title="Download .ydk">
          <IconButton onClick={onDownload}>
            <DownloadIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete deck">
          <IconButton onClick={onDelete}>
            <DeleteIcon />
          </IconButton>
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
          {section("Main Deck", deck.deck.main)}
          {section("Extra Deck", deck.deck.extra)}
          {section("Side Deck", deck.deck.side)}
        </Stack>
        <Box sx={{ display: { xs: "none", lg: "block" } }}>
          <CardDetail code={hover} imageWidth={200} />
        </Box>
      </Box>
    </Paper>
  );
}

function PasteDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (d: StoredDeck) => void }) {
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
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Paste a deck</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="ydke:// link or .ydk contents" value={text} onChange={(e) => setText(e.target.value)} multiline minRows={6} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={add} variant="contained" disabled={!text.trim()}>
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}
