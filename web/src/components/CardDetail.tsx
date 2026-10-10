"use client";

import { Box, Chip, Stack, Typography } from "@mui/material";
import { useApp } from "./AppContext";
import { CardImage } from "./CardImage";
import { TYPE } from "@/lib/data/cards";
import type { DuelCard } from "@/lib/game/duel";

interface Props {
  code: number;
  /** Live card on the field, for current ATK/DEF and counters. */
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
  const counters = live ? Object.entries(live.counters) : [];
  return (
    <Stack spacing={1} sx={{ p: 1, minWidth: 0 }}>
      <Box sx={{ alignSelf: "center" }}>
        <CardImage code={code} width={imageWidth} />
      </Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
        {info.name}
      </Typography>
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
      {counters.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          {counters.map(([t, n]) => (
            <Chip key={t} size="small" color="primary" label={`${res!.counterName(Number(t))}: ${n}`} />
          ))}
        </Stack>
      )}
      {live && live.overlays.length > 0 && (
        <Typography variant="caption">Materials: {live.overlays.map((o) => (o.code ? res!.cards.name(o.code) : "?")).join(", ")}</Typography>
      )}
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.35 }}>
        {info.desc}
      </Typography>
      <Typography variant="caption" color="text.disabled">
        {info.code}
      </Typography>
    </Stack>
  );
}
