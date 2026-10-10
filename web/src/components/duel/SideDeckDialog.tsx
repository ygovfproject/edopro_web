"use client";

import { useState } from "react";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import { CardImage } from "../CardImage";
import type { Deck } from "@/lib/protocol/ydk";

type Section = "main" | "extra" | "side";

/** Swap cards between Main/Extra and Side. Sizes stay the same, as the server requires. */
export default function SideDeckDialog({ deck, onSubmit }: { deck: Deck; onSubmit: (d: Deck) => void }) {
  const [d, setD] = useState<Deck>(() => ({ main: [...deck.main], extra: [...deck.extra], side: [...deck.side] }));
  const [picked, setPicked] = useState<{ section: Section; index: number } | null>(null);

  const click = (section: Section, index: number) => {
    if (!picked) return setPicked({ section, index });
    if (picked.section === section) return setPicked(picked.index === index ? null : { section, index });
    // Swap only between side and main/extra.
    if (picked.section !== "side" && section !== "side") return setPicked({ section, index });
    const next: Deck = { main: [...d.main], extra: [...d.extra], side: [...d.side] };
    const a = next[picked.section][picked.index];
    next[picked.section][picked.index] = next[section][index];
    next[section][index] = a;
    setD(next);
    setPicked(null);
  };

  const row = (title: string, section: Section) => (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="overline">
        {title} ({d[section].length})
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {d[section].map((c, i) => (
          <CardImage key={`${section}-${i}`} code={c} width={52} selected={picked?.section === section && picked.index === i} onClick={() => click(section, i)} />
        ))}
      </Box>
    </Box>
  );

  return (
    <Dialog open fullWidth maxWidth="lg">
      <DialogTitle>Side deck for the next duel</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Click a card in your Main or Extra Deck, then a card in your Side Deck, to swap them.
        </Typography>
        {row("Main Deck", "main")}
        {row("Extra Deck", "extra")}
        {row("Side Deck", "side")}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setD({ main: [...deck.main], extra: [...deck.extra], side: [...deck.side] })}>Reset</Button>
        <Button variant="contained" onClick={() => onSubmit(d)}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
