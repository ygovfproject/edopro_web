"use client";

import { Box, Chip, Stack, Typography } from "@mui/material";
import { useApp } from "./AppContext";
import { CardImage } from "./CardImage";
import { TYPE } from "@/lib/data/cards";
import type { DuelCard } from "@/lib/game/duel";

interface Props {
  code: number;
  /** Live card on the field: current ATK/DEF, changed name, negated, materials, counters. */
  live?: DuelCard | null;
  imageWidth?: number;
}

function stat(v: number) {
  return v < 0 ? "?" : String(v);
}

export default function CardDetail({ code, live, imageWidth = 180 }: Props) {
  const { res } = useApp();
  const info = code ? res?.cards.get(code) : undefined;
  if (!code) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
        Hover a card to see its details.
      </Typography>
    );
  }
  if (!info) {
    return (
      <Stack spacing={1} sx={{ p: 1 }}>
        <CardImage code={code} width={imageWidth} />
        <Typography variant="body2">Unknown card #{code}</Typography>
      </Stack>
    );
  }
  const isMonster = (info.type & TYPE.MONSTER) !== 0;
  const isLink = (info.type & TYPE.LINK) !== 0;
  const isXyz = (info.type & TYPE.XYZ) !== 0;
  const atk = live?.hasStats ? live.attack : info.attack;
  const def = live?.hasStats ? live.defense : info.defense;
  const level = live?.hasStats ? (isXyz ? live.rank : isLink ? live.link : live.level) : info.level;
  const attr = res!.attributeNames(live?.hasStats ? live.attribute : info.attribute).join("/");
  const counters = live ? Object.entries(live.counters).filter(([, n]) => n > 0) : [];
  // Its name while on the field, if an effect changes it (e.g. "Eldlich the Mad Golden Lord"
  // is treated as "Eldlich the Golden Lord"). The database alias only marks alternate artworks.
  const renamed = live && live.alias && live.alias !== code && live.alias !== info.alias ? live.alias : 0;
  // STATUS_DISABLED or STATUS_FORBIDDEN (same as the board's negated look).
  const negated = !!live && !(live.position & 0xa) && (live.status & (0x1 | 0x4000000)) !== 0;
  const materials = live?.overlays.length ?? 0;
  return (
    // Fills its panel; only the card text scrolls.
    <Stack spacing={1} sx={{ p: 1, minWidth: 0, height: "100%", minHeight: 0, boxSizing: "border-box" }}>
      <Box sx={{ alignSelf: "center", flex: "0 0 auto" }}>
        <CardImage code={code} width={imageWidth} />
      </Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
        {info.name}
      </Typography>
      {(renamed !== 0 || negated || materials > 0 || counters.length > 0) && (
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
          {renamed !== 0 && <Chip size="small" color="info" label={`Name: ${res!.cards.name(renamed)}`} sx={{ maxWidth: "100%" }} />}
          {negated && <Chip size="small" color="error" label="Negated" />}
          {materials > 0 && <Chip size="small" label={`Materials: ${materials}`} />}
          {counters.map(([t, n]) => (
            <Chip key={t} size="small" color="primary" label={`${res!.counterName(Number(t))}: ${n}`} />
          ))}
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary">
        {res!.typeLine(info)}
        {isMonster && attr ? ` · ${attr}` : ""}
      </Typography>
      {isMonster && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
          <Chip size="small" label={`${isLink ? "Link" : isXyz ? "Rank" : "Level"} ${level}`} />
          <Chip size="small" label={`ATK ${stat(atk)}`} color={live?.hasStats && atk !== info.attack ? "secondary" : "default"} />
          {!isLink && <Chip size="small" label={`DEF ${stat(def)}`} color={live?.hasStats && def !== info.defense ? "secondary" : "default"} />}
          {(info.type & TYPE.PENDULUM) !== 0 && <Chip size="small" label={`Scale ${info.lscale}/${info.rscale}`} />}
        </Stack>
      )}
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.35, flex: "1 1 auto", minHeight: 40, overflowY: "auto", pr: 0.5 }}>
        {info.desc}
      </Typography>
      <Typography variant="caption" color="text.disabled">
        {info.code}
      </Typography>
    </Stack>
  );
}
