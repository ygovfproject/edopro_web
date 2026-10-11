// Online duel client: speaks the EDOPro protocol to a Multirole server through
// the WebSocket proxy, tracks the room and forwards game messages to the
// DuelState board model.

import { CHAT_TYPE, CTOS, OBSERVER_POS, PLAYERCHANGE, STOC } from "../protocol/constants";
import { ctos, decodeError, PacketSplitter, stoc, type ClientVersion, type HostInfo, type StocError } from "../protocol/packets";
import { isUnknown, OcgMessageType, parseGameMessage, type ServerMessage } from "../protocol/gamemsg";
import type { Deck } from "../protocol/ydk";
import { motion } from "./motion";
import { DuelState, type Formatter } from "./duel";

export type ClientStatus =
  | "idle"
  | "connecting"
  | "lobby" // waiting room
  | "rps" // asked to choose rock/paper/scissors
  | "rps-wait"
  | "choose-order" // asked to go first or second
  | "order-wait"
  | "dueling"
  | "siding" // asked to side deck (best of 3)
  | "side-wait"
  | "rematch" // asked whether to rematch
  | "rematch-wait"
  | "closed";

export interface Slot {
  name: string;
  ready: boolean;
}

export interface ChatLine {
  id: number;
  kind: "player" | "observer" | "system" | "error";
  name: string;
  text: string;
}

export type ChainMode = "auto" | "ask" | "never";

/** A pending decision for the player. */
export interface Prompt {
  id: number;
  msg: ServerMessage;
  hint: bigint;
}

export interface Transport {
  send(data: Uint8Array): void;
  close(): void;
}

export type TransportFactory = (handlers: {
  onOpen(): void;
  onData(data: Uint8Array): void;
  onClose(reason: string): void;
}) => Transport;

/** Opens a WebSocket to the proxy's bridge endpoint for `serverId`. */
export function webSocketTransport(proxyUrl: string, serverId: string): TransportFactory {
  return (h) => {
    const base = proxyUrl.replace(/^http/, "ws").replace(/\/+$/, "");
    const ws = new WebSocket(`${base}/api/servers/${encodeURIComponent(serverId)}/connect`);
    ws.binaryType = "arraybuffer";
    let closed = false;
    ws.onopen = () => h.onOpen();
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) h.onData(new Uint8Array(ev.data));
    };
    ws.onclose = (ev) => {
      if (closed) return;
      closed = true;
      h.onClose(ev.reason || (ev.code === 1006 ? "Connection lost" : "Disconnected"));
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    return {
      send: (d) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(d as Uint8Array<ArrayBuffer>);
      },
      close: () => {
        closed = true;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      },
    };
  };
}

const REQUIRES_ANSWER = new Set<number>([
  OcgMessageType.SELECT_BATTLECMD,
  OcgMessageType.SELECT_IDLECMD,
  OcgMessageType.SELECT_EFFECTYN,
  OcgMessageType.SELECT_YESNO,
  OcgMessageType.SELECT_OPTION,
  OcgMessageType.SELECT_CARD,
  OcgMessageType.SELECT_CHAIN,
  OcgMessageType.SELECT_PLACE,
  OcgMessageType.SELECT_POSITION,
  OcgMessageType.SELECT_TRIBUTE,
  OcgMessageType.SORT_CHAIN,
  OcgMessageType.SELECT_COUNTER,
  OcgMessageType.SELECT_SUM,
  OcgMessageType.SELECT_DISFIELD,
  OcgMessageType.SORT_CARD,
  OcgMessageType.SELECT_UNSELECT_CARD,
  OcgMessageType.ROCK_PAPER_SCISSORS,
  OcgMessageType.ANNOUNCE_RACE,
  OcgMessageType.ANNOUNCE_ATTRIB,
  OcgMessageType.ANNOUNCE_CARD,
  OcgMessageType.ANNOUNCE_NUMBER,
]);

export interface ClientOptions {
  name: string;
  version: ClientVersion;
  transport: TransportFactory;
  formatter?: Formatter;
  /** Called when the server reports a different version, so it can be remembered. */
  onVersionLearned?: (v: ClientVersion) => void;
  chainMode?: ChainMode;
}

type Intent =
  | { kind: "host"; info: HostInfo; password: string; notes: string }
  | { kind: "join"; roomId: number; password: string };

export class DuelClient {
  status: ClientStatus = "idle";
  error: string | null = null;
  deckError: StocError | null = null;
  hostInfo: HostInfo | null = null;
  roomId = 0;
  isHost = false;
  /** Own slot index, or OBSERVER_POS (7) when spectating. */
  selfPos = OBSERVER_POS;
  slots: (Slot | null)[] = [];
  spectators = 0;
  chat: ChatLine[] = [];
  rpsResult: { me: number; opponent: number } | null = null;
  duel: DuelState;
  prompt: Prompt | null = null;
  catchingUp = false;
  retryWarning = false;
  deck: Deck | null = null;
  chainMode: ChainMode;
  /** Proxy server id this client is connected through. */
  serverId = "";
  rev = 0;

  private transport: Transport | null = null;
  private splitter = new PacketSplitter();
  /** Packets waiting while a summon animation plays (see pump). */
  private pending: { type: number; body: Uint8Array }[] = [];
  private holdUntil = 0;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private intent: Intent | null = null;
  private versionRetried = false;
  private chatId = 0;
  private promptId = 0;
  private version: ClientVersion;

  constructor(private opts: ClientOptions) {
    this.duel = new DuelState(opts.formatter);
    this.version = opts.version;
    this.chainMode = opts.chainMode ?? "auto";
  }

  /* ---------------- store plumbing (useSyncExternalStore) ---------------- */

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getRev = () => this.rev;
  private emit() {
    this.rev++;
    for (const l of this.listeners) l();
  }

  get teamSizes(): [number, number] {
    return [this.hostInfo?.team1 ?? 1, this.hostInfo?.team2 ?? 1];
  }
  get isObserver() {
    return this.selfPos >= this.teamSizes[0] + this.teamSizes[1];
  }

  /* ---------------- connection ---------------- */

  host(info: HostInfo, password = "", notes = "") {
    this.start({ kind: "host", info: { ...info, version: this.version }, password, notes });
  }

  join(roomId: number, password = "") {
    this.start({ kind: "join", roomId, password });
    this.roomId = roomId;
  }

  /** Password used to enter the current room (kept so a reload can rejoin). */
  get password() {
    return this.intent?.password ?? "";
  }

  private start(intent: Intent) {
    this.intent = intent;
    this.resetRoom();
    this.status = "connecting";
    this.error = null;
    this.emit();
    this.transport?.close();
    this.clearQueue();
    this.splitter = new PacketSplitter();
    this.transport = this.opts.transport({
      onOpen: () => {
        this.send(ctos.playerInfo(this.opts.name || "Player"));
        if (intent.kind === "host") {
          this.send(ctos.createGame({ ...intent.info, version: this.version }, "", intent.password, intent.notes));
        } else {
          this.send(ctos.joinGame(intent.roomId, intent.password, this.version));
        }
      },
      onData: (d) => this.onData(d),
      onClose: (reason) => {
        if (this.status === "closed") return;
        this.status = "closed";
        if (!this.error) this.error = reason;
        this.prompt = null;
        this.emit();
      },
    });
  }

  leave() {
    this.clearQueue();
    if (this.transport) {
      this.send(ctos.simple(CTOS.LEAVE_GAME));
      this.transport.close();
      this.transport = null;
    }
    this.status = "closed";
    this.prompt = null;
    this.emit();
  }

  private resetRoom() {
    this.hostInfo = null;
    this.roomId = 0;
    this.isHost = false;
    this.selfPos = OBSERVER_POS;
    this.slots = [];
    this.spectators = 0;
    this.prompt = null;
    this.rpsResult = null;
    this.deckError = null;
    this.duel = new DuelState(this.opts.formatter);
  }

  private send(data: Uint8Array) {
    this.transport?.send(data);
  }

  /* ---------------- room actions ---------------- */

  setDeck(deck: Deck) {
    this.deck = deck;
    this.emit();
  }

  /** Sends the deck and marks ready. */
  ready() {
    if (!this.deck) return;
    this.deckError = null;
    this.send(ctos.updateDeck([...this.deck.main, ...this.deck.extra], this.deck.side));
    this.send(ctos.simple(CTOS.HS_READY));
    this.emit();
  }
  notReady() {
    this.send(ctos.simple(CTOS.HS_NOTREADY));
  }
  toDuelist() {
    this.send(ctos.simple(CTOS.HS_TODUELIST));
  }
  toObserver() {
    this.send(ctos.simple(CTOS.HS_TOOBSERVER));
  }
  kick(pos: number) {
    this.send(ctos.kick(pos));
  }
  startDuel() {
    this.send(ctos.simple(CTOS.HS_START));
  }
  sendChat(text: string) {
    const t = text.trim();
    if (t) this.send(ctos.chat(t));
  }
  chooseRps(choice: 1 | 2 | 3) {
    this.send(ctos.handResult(choice));
    this.status = "rps-wait";
    this.emit();
  }
  chooseOrder(goFirst: boolean) {
    this.send(ctos.tpResult(goFirst));
    this.status = "order-wait";
    this.emit();
  }
  /** Side decking: sends the (possibly changed) deck for the next game. */
  submitSide(deck: Deck) {
    this.deck = deck;
    this.send(ctos.updateDeck([...deck.main, ...deck.extra], deck.side));
    this.status = "side-wait";
    this.emit();
  }
  /** Material prompt click: shows the card as picked/unpicked before the server answers. */
  pickMaterial(ref: { controller: number; location: number; sequence: number }, picked: boolean) {
    this.duel.pickMaterial(ref, picked);
    this.emit();
  }
  answerRematch(yes: boolean) {
    this.send(ctos.rematch(yes));
    this.status = yes ? "rematch-wait" : "closed";
    if (!yes) this.transport?.close();
    this.emit();
  }
  surrender() {
    this.send(ctos.simple(CTOS.SURRENDER));
  }

  /** Answers the current prompt. */
  respond(data: Uint8Array) {
    if (!this.prompt) return;
    this.prompt = null;
    this.retryWarning = false;
    this.duel.selectHint = 0n;
    this.send(ctos.response(data));
    this.emit();
  }

  dismissFx(id: number) {
    this.duel.dismissFx(id);
    this.emit();
  }

  dismissReveal(id: number) {
    this.duel.dismissReveal(id);
    this.emit();
  }

  setChainMode(mode: ChainMode) {
    this.chainMode = mode;
    this.emit();
  }

  /* ---------------- incoming ---------------- */

  private onData(data: Uint8Array) {
    for (const p of this.splitter.push(data)) this.pending.push(p);
    this.pump();
  }

  /**
   * Handles queued packets in order. After a summon, the board model asks to hold
   * everything that follows (triggered effects, chains, prompts...) until the summon
   * animation has finished, so those start after it instead of on top of it.
   */
  private pump() {
    if (this.holdTimer) return;
    let changed = false;
    while (this.pending.length) {
      const wait = this.holdUntil - Date.now();
      if (wait > 0 && !this.catchingUp) {
        this.holdTimer = setTimeout(() => {
          this.holdTimer = null;
          this.pump();
        }, wait);
        break;
      }
      const p = this.pending.shift()!;
      try {
        this.handlePacket(p.type, p.body);
      } catch (e) {
        console.error("Failed to handle packet", p.type, e);
      }
      changed = true;
      const hold = this.duel.takeHold();
      // While catching up on a duel in progress nothing animates, so nothing waits.
      if (hold > 0 && !this.catchingUp) this.holdUntil = Date.now() + hold;
    }
    // While catching up on a duel in progress, replay silently and render only the final state.
    if (changed && !this.catchingUp) this.emit();
  }

  private clearQueue() {
    this.pending = [];
    this.holdUntil = 0;
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private addChat(kind: ChatLine["kind"], name: string, text: string) {
    this.chat.push({ id: ++this.chatId, kind, name, text });
    if (this.chat.length > 200) this.chat.splice(0, this.chat.length - 200);
  }

  private handlePacket(type: number, body: Uint8Array) {
    switch (type) {
      case STOC.GAME_MSG:
        this.handleGameMessage(body);
        break;
      case STOC.ERROR_MSG: {
        const err = decodeError(body);
        this.handleError(err);
        break;
      }
      case STOC.CREATE_GAME:
        this.roomId = stoc.createGame(body);
        break;
      case STOC.JOIN_GAME: {
        this.hostInfo = stoc.joinGame(body);
        this.slots = Array(this.hostInfo.team1 + this.hostInfo.team2).fill(null);
        this.status = "lobby";
        this.versionRetried = false;
        break;
      }
      case STOC.TYPE_CHANGE: {
        const t = stoc.typeChange(body);
        this.selfPos = t.pos;
        this.isHost = t.isHost;
        break;
      }
      case STOC.HS_PLAYER_ENTER: {
        const p = stoc.playerEnter(body);
        if (p.pos < this.slots.length) this.slots[p.pos] = { name: p.name, ready: false };
        break;
      }
      case STOC.HS_PLAYER_CHANGE: {
        const { pos, state } = stoc.playerChange(body);
        if (pos >= this.slots.length) break;
        if (state < 8) {
          // Moved from `pos` to slot `state`.
          const prev = this.slots[pos];
          this.slots[pos] = null;
          if (state < this.slots.length) this.slots[state] = prev ? { ...prev, ready: false } : null;
        } else if (state === PLAYERCHANGE.READY || state === PLAYERCHANGE.NOTREADY) {
          const s = this.slots[pos];
          if (s) s.ready = state === PLAYERCHANGE.READY;
        } else if (state === PLAYERCHANGE.LEAVE || state === PLAYERCHANGE.OBSERVE) {
          this.slots[pos] = null;
        }
        this.slots = [...this.slots];
        break;
      }
      case STOC.HS_WATCH_CHANGE:
        this.spectators = stoc.watchChange(body);
        break;
      case STOC.CHAT_2: {
        const c = stoc.chat2(body);
        const kind =
          c.type === CHAT_TYPE.DUELIST ? "player" : c.type === CHAT_TYPE.OBSERVER ? "observer" : c.type === CHAT_TYPE.SYSTEM_ERROR ? "error" : "system";
        this.addChat(kind, c.name, c.message);
        break;
      }
      case STOC.CHAT: {
        const c = stoc.chat(body);
        this.addChat("player", this.slots[c.player]?.name ?? "", c.message);
        break;
      }
      case STOC.DUEL_START:
        // Sent at the start of each game of a match (and to late spectators).
        // Between games of a match the server sends this to each duelist as soon as *their* side
        // deck is accepted, and to spectators once everyone is done. A duelist keeps waiting
        // (for the opponent's side deck, then the turn order) until the next game starts.
        if (this.status === "lobby" || this.status === "rematch-wait") this.status = "order-wait";
        else if (this.status === "side-wait" && this.isObserver) this.status = "order-wait";
        this.prompt = null;
        break;
      case STOC.SELECT_HAND:
        this.status = "rps";
        break;
      case STOC.HAND_RESULT:
        this.rpsResult = stoc.handResult(body);
        break;
      case STOC.SELECT_TP:
        this.status = "choose-order";
        break;
      case STOC.TP_RESULT:
        break;
      case STOC.TIME_LIMIT: {
        const t = stoc.timeLimit(body);
        this.duel.timeLeft[t.player & 1] = t.left;
        this.duel.timePlayer = t.player;
        if (t.player === this.duel.me && !this.duel.isSpectator) this.send(ctos.simple(CTOS.TIME_CONFIRM));
        break;
      }
      case STOC.CHANGE_SIDE:
        this.status = "siding";
        this.prompt = null;
        break;
      case STOC.WAITING_SIDE:
        this.status = "side-wait";
        break;
      case STOC.REMATCH:
        this.status = "rematch";
        this.prompt = null;
        break;
      case STOC.WAITING_REMATCH:
        if (this.status !== "rematch") this.status = "rematch-wait";
        break;
      case STOC.DUEL_END:
        this.status = "closed";
        this.prompt = null;
        this.error = null;
        this.transport?.close();
        break;
      case STOC.CATCHUP:
        this.catchingUp = stoc.catchUp(body);
        if (!this.catchingUp) {
          // Nothing from the replayed history should pop up or animate.
          this.duel.reveals = [];
          this.duel.fx = [];
          motion.clear();
          this.duel.waiting = false;
        }
        break;
      case STOC.LEAVE_GAME:
      case STOC.REPLAY:
      case STOC.NEW_REPLAY:
      default:
        break;
    }
  }

  private handleError(err: StocError) {
    switch (err.kind) {
      case "version": {
        if (err.version && !this.versionRetried && this.intent) {
          // The server told us its version: adopt it and reconnect once.
          this.versionRetried = true;
          this.version = err.version;
          this.opts.onVersionLearned?.(err.version);
          const intent = this.intent;
          setTimeout(() => this.start(intent.kind === "host" ? { ...intent, info: { ...intent.info, version: this.version } } : intent), 0);
          return;
        }
        const v = err.version;
        this.error = v
          ? `Version mismatch: the server runs ${v.client[0]}.${v.client[1]} (core ${v.core[0]}.${v.core[1]}).`
          : "Version mismatch with the server.";
        break;
      }
      case "join":
        this.error = err.code === 1 ? "Wrong password." : err.code === 2 ? "The host refused the connection." : "Could not join the room.";
        break;
      case "deck":
        this.deckError = err;
        this.addChat("error", "", "Your deck was rejected by the server.");
        return;
      case "side":
        this.addChat("error", "", "Side deck changes were rejected. Main, Extra and Side sizes must stay the same.");
        this.status = "siding";
        return;
    }
  }

  private handleGameMessage(body: Uint8Array) {
    const msg = parseGameMessage(body);
    if (isUnknown(msg)) return;
    if (this.status !== "dueling" && msg.type !== OcgMessageType.WIN) this.status = "dueling";
    if (msg.type === OcgMessageType.RETRY) {
      this.retryWarning = true;
      this.addChat("error", "", "The server rejected that choice. Please choose again (another invalid answer loses the duel).");
      return;
    }
    if (REQUIRES_ANSWER.has(msg.type)) {
      this.duel.waiting = false;
      if (this.catchingUp || this.duel.isSpectator) return;
      if (this.autoRespond(msg)) return;
      this.duel.syncMaterialPicks(msg);
      this.prompt = { id: ++this.promptId, msg, hint: this.duel.selectHint };
      return;
    }
    if (msg.type !== OcgMessageType.WAITING) this.duel.waiting = false;
    this.duel.apply(msg);
  }

  /** Mirrors EDOPro's automatic answers. Returns true if it answered. */
  private autoRespond(msg: ServerMessage): boolean {
    if (msg.type === OcgMessageType.SELECT_CHAIN) {
      const selectTrigger = msg.spe_count === 0x7f;
      const count = msg.selects.length;
      if (msg.forced || selectTrigger) return false;
      const pass =
        this.chainMode === "never" ||
        count === 0 ||
        (this.chainMode === "auto" && msg.spe_count === 0);
      if (pass) {
        this.send(ctos.response(new Uint8Array([0xff, 0xff, 0xff, 0xff])));
        return true;
      }
    }
    return false;
  }
}
