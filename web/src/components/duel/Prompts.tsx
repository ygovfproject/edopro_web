"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import FieldDialog from "./FieldDialog";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import { CardImage, cardHeight } from "../CardImage";
import { useApp } from "../AppContext";
import type { DuelClient, Prompt } from "@/lib/game/client";
import { OcgMessageType, type ServerMessage } from "@/lib/protocol/gamemsg";
import { respond } from "@/lib/protocol/responses";
import { sumCheck } from "@/lib/game/actions";
import { cardMatchesOpcode, type OcgOpCode } from "@/lib/ocg/opcodes";
import { ATTRIBUTES, RACES } from "@/lib/data/strings";
import type { Resources } from "@/lib/data/resources";

type T = typeof OcgMessageType;
type Msg<K extends keyof T> = Extract<ServerMessage, { type: T[K] }>;

/** Prompts that are answered on the board rather than in a dialog. */
export function isBoardPrompt(p: Prompt | null) {
  if (!p) return false;
  const t = p.msg.type;
  return t === OcgMessageType.SELECT_IDLECMD || t === OcgMessageType.SELECT_BATTLECMD || t === OcgMessageType.SELECT_PLACE || t === OcgMessageType.SELECT_DISFIELD;
}

export function hintText(res: Resources, prompt: Prompt, fallbackSys: number) {
  return prompt.hint ? res.desc(prompt.hint) : res.sys(fallbackSys);
}

interface PromptProps {
  client: DuelClient;
  prompt: Prompt;
  onHover: (code: number) => void;
  /** Lets the player look at the board; the prompt comes back via the prompt bar. */
  onMinimize: () => void;
}

export default function PromptDialog(props: PromptProps) {
  const m = props.prompt.msg;
  const T = OcgMessageType;
  switch (m.type) {
    case T.SELECT_EFFECTYN:
    case T.SELECT_YESNO:
      return <YesNo {...props} />;
    case T.SELECT_OPTION:
      return <Options {...props} msg={m} />;
    case T.SELECT_CARD:
    case T.SELECT_TRIBUTE:
      return <SelectCards {...props} msg={m} />;
    case T.SELECT_UNSELECT_CARD:
      return <SelectUnselect {...props} msg={m} />;
    case T.SELECT_SUM:
      return <SelectSum {...props} msg={m} />;
    case T.SELECT_CHAIN:
      return <SelectChain {...props} msg={m} />;
    case T.SELECT_POSITION:
      return <SelectPosition {...props} msg={m} />;
    case T.SORT_CARD:
    case T.SORT_CHAIN:
      return <SortCards {...props} msg={m} />;
    case T.SELECT_COUNTER:
      return <SelectCounter {...props} msg={m} />;
    case T.ANNOUNCE_RACE:
      return <AnnounceRace {...props} msg={m} />;
    case T.ANNOUNCE_ATTRIB:
      return <AnnounceAttrib {...props} msg={m} />;
    case T.ANNOUNCE_CARD:
      return <AnnounceCard {...props} msg={m} />;
    case T.ANNOUNCE_NUMBER:
      return <AnnounceNumber {...props} msg={m} />;
    case T.ROCK_PAPER_SCISSORS:
      return <InDuelRps {...props} />;
    default:
      return null;
  }
}

function Shell({
  title,
  children,
  actions,
  onMinimize,
  maxWidth = "md",
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  onMinimize?: () => void;
  maxWidth?: "xs" | "sm" | "md" | "lg";
}) {
  return (
    <FieldDialog open fullWidth maxWidth={maxWidth} disableEscapeKeyDown>
      <DialogTitle sx={{ pb: 1 }}>{title}</DialogTitle>
      <DialogContent dividers>{children}</DialogContent>
      <DialogActions>
        {onMinimize && (
          <Button color="inherit" onClick={onMinimize} sx={{ mr: "auto" }}>
            View field
          </Button>
        )}
        {actions}
      </DialogActions>
    </FieldDialog>
  );
}

/** One selectable card in a dialog grid. */
function Tile({
  code,
  label,
  selected,
  disabled,
  badge,
  onClick,
  onHover,
}: {
  code: number;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  badge?: React.ReactNode;
  onClick?: () => void;
  onHover: (code: number) => void;
}) {
  const { res } = useApp();
  return (
    <Stack spacing={0.5} sx={{ width: 84, alignItems: "center", opacity: disabled ? 0.45 : 1, position: "relative" }}>
      <CardImage code={code} width={76} faceDown={!code} selected={selected} onClick={disabled ? undefined : onClick} onHover={onHover} />
      {badge && <Box sx={{ position: "absolute", top: 2, right: 6 }}>{badge}</Box>}
      <Typography variant="caption" sx={{ textAlign: "center", lineHeight: 1.1, fontSize: 10.5 }}>
        {code ? res?.cards.name(code) : "Face-down card"}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, lineHeight: 1 }}>
        {label}
      </Typography>
    </Stack>
  );
}

function useLocLabel() {
  const { res } = useApp();
  return (client: DuelClient, c: { controller: number; location: number; sequence?: number }) => {
    const who = client.duel.isSpectator ? `P${c.controller + 1}` : c.controller === client.duel.me ? "Your" : "Opp.";
    return `${who} ${res?.locationName(c.location, c.sequence) ?? ""}`;
  };
}

/** Resolves the best known code for a selection entry (the message may hide it). */
function knownCode(client: DuelClient, c: { code: number; controller: number; location: number; sequence: number; overlay_sequence?: number }) {
  if (c.code) return c.code;
  return client.duel.getCard(c)?.code ?? 0;
}

const Grid = ({ children }: { children: React.ReactNode }) => (
  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, justifyContent: "center" }}>{children}</Box>
);

/* ---------------- yes / no ---------------- */

function YesNo({ client, prompt, onHover, onMinimize }: PromptProps) {
  const { res } = useApp();
  const m = prompt.msg as Msg<"SELECT_EFFECTYN"> | Msg<"SELECT_YESNO">;
  let text = "";
  let code = 0;
  if (m.type === OcgMessageType.SELECT_EFFECTYN) {
    code = m.code;
    const name = res!.cards.name(m.code);
    const where = res!.locationName(m.location, m.sequence);
    if (m.description === 0n) text = res!.sys(200).replace("%ls", name).replace("%ls", where);
    else if (m.description === 221n) text = res!.sys(221).replace("%ls", name).replace("%ls", where);
    else text = res!.desc(m.description, name);
  } else {
    text = res!.desc(m.description);
  }
  return (
    <Shell
      title="Confirm"
      maxWidth="xs"
      onMinimize={onMinimize}
      actions={
        <>
          <Button onClick={() => client.respond(respond.yesNo(false))}>No</Button>
          <Button variant="contained" onClick={() => client.respond(respond.yesNo(true))}>
            Yes
          </Button>
        </>
      }
    >
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        {code !== 0 && <CardImage code={code} width={70} onHover={onHover} />}
        <Typography>{text}</Typography>
      </Stack>
    </Shell>
  );
}

/* ---------------- options ---------------- */

function Options({ client, prompt, msg, onMinimize }: PromptProps & { msg: Msg<"SELECT_OPTION"> }) {
  const { res } = useApp();
  return (
    <Shell title={hintText(res!, prompt, 555)} maxWidth="sm" onMinimize={onMinimize}>
      <List>
        {msg.options.map((o, i) => (
          <ListItemButton key={i} onClick={() => client.respond(respond.option(i))}>
            <ListItemText primary={res!.desc(o)} />
          </ListItemButton>
        ))}
      </List>
    </Shell>
  );
}

/* ---------------- select cards / tribute ---------------- */

function SelectCards({ client, prompt, msg, onHover, onMinimize }: PromptProps & { msg: Msg<"SELECT_CARD"> | Msg<"SELECT_TRIBUTE"> }) {
  const { res } = useApp();
  const loc = useLocLabel();
  const [sel, setSel] = useState<number[]>([]);
  const isTribute = msg.type === OcgMessageType.SELECT_TRIBUTE;
  const weight = (i: number) => (isTribute ? Math.max(1, (msg as Msg<"SELECT_TRIBUTE">).selects[i].release_param || 1) : 1);
  const total = sel.reduce((a, i) => a + weight(i), 0);
  // The core checks tributes by summed tribute value (some monsters count as 2).
  const ok = isTribute ? total >= msg.min && sel.length <= msg.max : sel.length >= msg.min && sel.length <= msg.max;
  const toggle = (i: number) => {
    setSel((s) => {
      if (s.includes(i)) return s.filter((x) => x !== i);
      if (msg.max === 1) return [i];
      if (s.length >= msg.max) return s;
      return [...s, i];
    });
  };
  // Single selection answers immediately, like EDOPro; so does picking the last tribute needed.
  const click = (i: number) => {
    if (msg.min === 1 && msg.max === 1 && !isTribute) return client.respond(respond.cards([i]));
    if (isTribute && !sel.includes(i) && sel.length < msg.max) {
      const next = [...sel, i];
      const sum = next.reduce((a, j) => a + weight(j), 0);
      if (sum >= msg.min && (sum >= msg.max || next.length >= msg.max)) return client.respond(respond.cards(next));
    }
    toggle(i);
  };
  const title = hintText(res!, prompt, isTribute ? 531 : 560);
  return (
    <Shell
      title={`${title} (${msg.min === msg.max ? msg.min : `${msg.min}–${msg.max}`})`}
      onMinimize={onMinimize}
      actions={
        <>
          {msg.can_cancel && <Button onClick={() => client.respond(respond.cards(null))}>Cancel</Button>}
          {!(msg.min === 1 && msg.max === 1 && !isTribute) && (
            <Button variant="contained" disabled={!ok} onClick={() => client.respond(respond.cards(sel))}>
              Confirm ({sel.length})
            </Button>
          )}
        </>
      }
    >
      <Grid>
        {msg.selects.map((c, i) => (
          <Tile key={i} code={knownCode(client, c)} label={loc(client, c)} selected={sel.includes(i)} onClick={() => click(i)} onHover={onHover} />
        ))}
      </Grid>
    </Shell>
  );
}

/* ---------------- select / unselect (one card per answer) ---------------- */

function SelectUnselect({ client, prompt, msg, onHover, onMinimize }: PromptProps & { msg: Msg<"SELECT_UNSELECT_CARD"> }) {
  const { res } = useApp();
  const loc = useLocLabel();
  const n = msg.select_cards.length;
  return (
    <Shell
      title={`${hintText(res!, prompt, 560)} (${msg.min === msg.max ? msg.min : `${msg.min}–${msg.max}`})`}
      onMinimize={onMinimize}
      actions={
        <>
          {msg.can_cancel && !msg.can_finish && <Button onClick={() => client.respond(respond.unselect(null))}>Cancel</Button>}
          {msg.can_finish && (
            <Button variant="contained" onClick={() => client.respond(respond.unselect(null))}>
              Finish
            </Button>
          )}
        </>
      }
    >
      {msg.unselect_cards.length > 0 && (
        <>
          <Typography variant="overline">Selected (click to remove)</Typography>
          <Grid>
            {msg.unselect_cards.map((c, i) => (
              <Tile
                key={`u${i}`}
                code={knownCode(client, c)}
                label={loc(client, c)}
                selected
                onClick={() => {
                  client.pickMaterial(c, false);
                  client.respond(respond.unselect(n + i));
                }}
                onHover={onHover}
              />
            ))}
          </Grid>
        </>
      )}
      <Typography variant="overline">Choose</Typography>
      <Grid>
        {msg.select_cards.map((c, i) => (
          <Tile
            key={`s${i}`}
            code={knownCode(client, c)}
            label={loc(client, c)}
            onClick={() => {
              client.pickMaterial(c, true);
              client.respond(respond.unselect(i));
            }}
            onHover={onHover}
          />
        ))}
      </Grid>
    </Shell>
  );
}

/* ---------------- select sum ---------------- */

function SelectSum({ client, prompt, msg, onHover, onMinimize }: PromptProps & { msg: Msg<"SELECT_SUM"> }) {
  const { res } = useApp();
  const loc = useLocLabel();
  const [sel, setSel] = useState<number[]>([]);
  const exact = msg.select_max === 0;
  const params = [...msg.selects_must.map((c) => c.amount), ...sel.map((i) => msg.selects[i].amount)];
  const countOk = !exact || (sel.length >= msg.min && sel.length <= msg.max);
  const ok = sel.length > 0 && countOk && sumCheck(params, msg.amount, exact);
  const level = (a: number) => (a >>> 16 ? `${a & 0xffff}/${a >>> 16}` : `${a & 0xffff}`);
  return (
    <Shell
      title={`${hintText(res!, prompt, 560)} — total ${exact ? "" : "at least "}${msg.amount}`}
      onMinimize={onMinimize}
      actions={
        <Button variant="contained" disabled={!ok} onClick={() => client.respond(respond.cards(sel))}>
          Confirm
        </Button>
      }
    >
      {msg.selects_must.length > 0 && (
        <>
          <Typography variant="overline">Always included</Typography>
          <Grid>
            {msg.selects_must.map((c, i) => (
              <Tile key={`m${i}`} code={knownCode(client, c)} label={`${loc(client, c)} · ${level(c.amount)}`} selected onHover={onHover} />
            ))}
          </Grid>
        </>
      )}
      <Grid>
        {msg.selects.map((c, i) => (
          <Tile
            key={i}
            code={knownCode(client, c)}
            label={`${loc(client, c)} · ${level(c.amount)}`}
            selected={sel.includes(i)}
            onClick={() => setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]))}
            onHover={onHover}
          />
        ))}
      </Grid>
    </Shell>
  );
}

/* ---------------- chain ---------------- */

function SelectChain({ client, prompt, msg, onHover, onMinimize }: PromptProps & { msg: Msg<"SELECT_CHAIN"> }) {
  const { res } = useApp();
  const loc = useLocLabel();
  const title = msg.forced ? "Select a card to activate" : msg.spe_count === 0x7f ? res!.sys(222) : res!.sys(203);
  return (
    <Shell
      title={title}
      maxWidth="sm"
      onMinimize={onMinimize}
      actions={
        !msg.forced && (
          <Button variant="contained" color="inherit" onClick={() => client.respond(respond.chain(null))}>
            Don&apos;t activate
          </Button>
        )
      }
    >
      {client.duel.chain.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Current chain: {client.duel.chain.map((l) => res!.cards.name(l.code)).join(" → ")}
        </Typography>
      )}
      <List dense>
        {msg.selects.map((c, i) => {
          const name = res!.cards.name(c.code);
          const label = c.client_mode === 1 ? "Resolve effect" : c.client_mode === 2 ? "Reset effect" : c.description ? res!.desc(c.description, name) : "Activate";
          return (
            <ListItemButton key={i} onClick={() => client.respond(respond.chain(i))} onMouseEnter={() => onHover(c.code)}>
              <Box sx={{ mr: 1.5 }}>
                <CardImage code={c.code} width={44} />
              </Box>
              <ListItemText primary={name} secondary={`${label} · ${loc(client, c)}`} />
            </ListItemButton>
          );
        })}
      </List>
    </Shell>
  );
}

/* ---------------- position ---------------- */

function SelectPosition({ client, msg, onHover }: PromptProps & { msg: Msg<"SELECT_POSITION"> }) {
  const opts: [number, string, boolean, boolean][] = [
    [0x1, "Face-up Attack", false, false],
    [0x2, "Face-down Attack", true, false],
    [0x4, "Face-up Defense", false, true],
    [0x8, "Face-down Defense", true, true],
  ];
  return (
    <Shell title="Select the battle position" maxWidth="sm">
      <Stack direction="row" spacing={2} sx={{ justifyContent: "center", flexWrap: "wrap" }}>
        {opts
          .filter(([p]) => msg.positions & p)
          .map(([p, label, down, def]) => (
            <Stack key={p} spacing={1} sx={{ alignItems: "center" }}>
              {/* Same height for every option, so Defense cards sit in the middle. */}
              <Box sx={{ height: cardHeight(80), display: "flex", alignItems: "center" }}>
                <CardImage code={msg.code} width={80} faceDown={down} sideways={def} onClick={() => client.respond(respond.position(p))} onHover={onHover} />
              </Box>
              <Button size="small" onClick={() => client.respond(respond.position(p))}>
                {label}
              </Button>
            </Stack>
          ))}
      </Stack>
    </Shell>
  );
}

/* ---------------- sort ---------------- */

function SortCards({ client, msg, onHover }: PromptProps & { msg: Msg<"SORT_CARD"> | Msg<"SORT_CHAIN"> }) {
  const { res } = useApp();
  const [order, setOrder] = useState<number[]>([]); // card indices in chosen order
  const n = msg.cards.length;
  const click = (i: number) => setOrder((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i]));
  const confirm = () => {
    // Response: for each card (as received), its position in the new order.
    const slots = msg.cards.map((_, i) => order.indexOf(i));
    client.respond(respond.sort(slots));
  };
  const title = msg.type === OcgMessageType.SORT_CHAIN ? res!.sys(206) : res!.sys(205);
  return (
    <Shell
      title={title}
      actions={
        <>
          <Button onClick={() => client.respond(respond.sort(null))}>Keep current order</Button>
          <Button onClick={() => setOrder([])}>Reset</Button>
          <Button variant="contained" disabled={order.length !== n} onClick={confirm}>
            Confirm
          </Button>
        </>
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Click the cards in order (first click = first/top).
      </Typography>
      <Grid>
        {msg.cards.map((c, i) => (
          <Tile
            key={i}
            code={c.code}
            label={order.includes(i) ? `#${order.indexOf(i) + 1}` : ""}
            selected={order.includes(i)}
            onClick={() => click(i)}
            onHover={onHover}
          />
        ))}
      </Grid>
    </Shell>
  );
}

/* ---------------- counters ---------------- */

function SelectCounter({ client, msg, onHover }: PromptProps & { msg: Msg<"SELECT_COUNTER"> }) {
  const { res } = useApp();
  const [counts, setCounts] = useState<number[]>(() => msg.cards.map(() => 0));
  const total = counts.reduce((a, b) => a + b, 0);
  const set = (i: number, d: number) =>
    setCounts((cs) => cs.map((v, j) => (j === i ? Math.max(0, Math.min(msg.cards[i].count, v + d)) : v)));
  return (
    <Shell
      title={`Remove ${msg.count} ${res!.counterName(msg.counter_type)}(s) — ${total}/${msg.count}`}
      actions={
        <Button variant="contained" disabled={total !== msg.count} onClick={() => client.respond(respond.counters(counts))}>
          Confirm
        </Button>
      }
    >
      <Grid>
        {msg.cards.map((c, i) => (
          <Stack key={i} sx={{ alignItems: "center" }}>
            <Tile code={c.code} label={`has ${c.count}`} onHover={onHover} />
            <Stack direction="row" sx={{ alignItems: "center" }}>
              <IconButton size="small" onClick={() => set(i, -1)}>
                <RemoveIcon fontSize="small" />
              </IconButton>
              <Typography>{counts[i]}</Typography>
              <IconButton size="small" onClick={() => set(i, 1)}>
                <AddIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>
        ))}
      </Grid>
    </Shell>
  );
}

/* ---------------- announce ---------------- */

function AnnounceRace({ client, msg }: PromptProps & { msg: Msg<"ANNOUNCE_RACE"> }) {
  const [sel, setSel] = useState<bigint>(0n);
  const count = (v: bigint) => v.toString(2).split("").filter((b) => b === "1").length;
  return (
    <Shell
      title={`Declare ${msg.count} Type${msg.count > 1 ? "s" : ""}`}
      maxWidth="sm"
      actions={
        <Button variant="contained" disabled={count(sel) !== msg.count} onClick={() => client.respond(respond.race(sel))}>
          Confirm
        </Button>
      }
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        {RACES.filter(([b]) => (msg.available as bigint) & b).map(([b, name]) => (
          <FormControlLabel
            key={name}
            control={<Checkbox size="small" checked={(sel & b) !== 0n} onChange={() => setSel((s) => s ^ b)} />}
            label={name}
          />
        ))}
      </Box>
    </Shell>
  );
}

function AnnounceAttrib({ client, msg }: PromptProps & { msg: Msg<"ANNOUNCE_ATTRIB"> }) {
  const [sel, setSel] = useState(0);
  const count = (v: number) => v.toString(2).split("").filter((b) => b === "1").length;
  return (
    <Shell
      title={`Declare ${msg.count} Attribute${msg.count > 1 ? "s" : ""}`}
      maxWidth="xs"
      actions={
        <Button variant="contained" disabled={count(sel) !== msg.count} onClick={() => client.respond(respond.attribute(sel))}>
          Confirm
        </Button>
      }
    >
      <Stack>
        {ATTRIBUTES.filter(([b]) => msg.available & b).map(([b, name]) => (
          <FormControlLabel key={name} control={<Checkbox size="small" checked={(sel & b) !== 0} onChange={() => setSel((s) => s ^ b)} />} label={name} />
        ))}
      </Stack>
    </Shell>
  );
}

function AnnounceCard({ client, msg, onHover }: PromptProps & { msg: Msg<"ANNOUNCE_CARD"> }) {
  const { res } = useApp();
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    const ops = msg.opcodes as OcgOpCode[];
    return res!.cards.search(q, (c) => (ops.length ? cardMatchesOpcode(res!.cards.toOcgData(c), ops) : !c.alias), 40);
  }, [q, msg.opcodes, res]);
  return (
    <Shell title={res!.sys(564)} maxWidth="sm">
      <TextField autoFocus fullWidth size="small" placeholder="Type a card name…" value={q} onChange={(e) => setQ(e.target.value)} sx={{ mb: 1 }} />
      {q.trim().length >= 2 && results.length === 0 && <Alert severity="info">No matching card can be declared.</Alert>}
      <List dense sx={{ maxHeight: 360, overflow: "auto" }}>
        {results.map((c) => (
          <ListItemButton key={c.code} onClick={() => client.respond(respond.card(c.code))} onMouseEnter={() => onHover(c.code)}>
            <ListItemText primary={c.name} secondary={res!.typeLine(c)} />
          </ListItemButton>
        ))}
      </List>
    </Shell>
  );
}

function AnnounceNumber({ client, msg }: PromptProps & { msg: Msg<"ANNOUNCE_NUMBER"> }) {
  const { res } = useApp();
  return (
    <Shell title={res!.sys(565)} maxWidth="xs">
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        {msg.options.map((o, i) => (
          <Button key={i} variant="outlined" onClick={() => client.respond(respond.number(i))}>
            {String(o)}
          </Button>
        ))}
      </Box>
    </Shell>
  );
}

function InDuelRps({ client }: PromptProps) {
  return (
    <Shell title="Rock, paper, scissors" maxWidth="xs">
      <Stack direction="row" spacing={1} sx={{ justifyContent: "center" }}>
        <Button variant="outlined" onClick={() => client.respond(respond.rps(2))}>
          ✊ Rock
        </Button>
        <Button variant="outlined" onClick={() => client.respond(respond.rps(3))}>
          ✋ Paper
        </Button>
        <Button variant="outlined" onClick={() => client.respond(respond.rps(1))}>
          ✌️ Scissors
        </Button>
      </Stack>
    </Shell>
  );
}
