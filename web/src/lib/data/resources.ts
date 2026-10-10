// Everything the client downloads from the asset backend at startup:
// card databases, strings and banlists. Also turns ids into display text.

import { parseBanlists, type Banlist } from "../protocol/banlist";
import type { Formatter } from "../game/duel";
import { PHASE } from "../game/duel";
import { CardDatabase, TYPE, type CardInfo } from "./cards";
import { expandSources, type AppConfig } from "./config";
import { ATTRIBUTES, RACES, Strings } from "./strings";

export class Resources {
  cards = new CardDatabase();
  strings = new Strings();
  banlists: Banlist[] = [];
  errors: string[] = [];

  constructor(public config: AppConfig) {}

  async load(onProgress?: (text: string) => void) {
    onProgress?.("Finding card databases…");
    const dbs = await expandSources(this.config.databases, ".cdb", ["cards.cdb"]);
    this.errors.push(...dbs.errors);
    onProgress?.("Loading card database…");
    this.errors.push(...(await this.cards.load(dbs.urls, (d, t) => onProgress?.(`Loading card database ${d}/${t}…`))));
    if (this.config.stringsUrl) {
      onProgress?.("Loading strings…");
      try {
        const res = await fetch(this.config.stringsUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.strings.parse(await res.text());
      } catch (e) {
        this.errors.push(`${this.config.stringsUrl}: ${(e as Error).message}`);
      }
    }
    onProgress?.("Loading banlists…");
    const lists = await expandSources(this.config.banlists ?? [], ".lflist.conf", ["OCG.lflist.conf", "0TCG.lflist.conf"]);
    this.errors.push(...lists.errors);
    await Promise.all(
      lists.urls.map(async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return parseBanlists(await res.text());
        } catch (e) {
          this.errors.push(`${url}: ${(e as Error).message}`);
          return [];
        }
      }),
    ).then((all) => this.banlists.push(...all.flat()));
  }

  banlistName(hash: number) {
    if (!hash) return "No banlist";
    return this.banlists.find((b) => b.hash === hash)?.name ?? `Unknown banlist (${hash.toString(16)})`;
  }

  /** EDOPro DataManager::GetDesc: 64-bit description = (card code << 20) | string index. */
  desc(desc: bigint, cardName?: string): string {
    const code = Number(desc >> 20n);
    const index = Number(desc & 0xfffffn);
    let text: string;
    if (code === 0) text = this.strings.sys(index);
    else text = this.cards.effectString(code, index) ?? `${this.cards.name(code)} effect ${index + 1}`;
    if (cardName !== undefined) text = text.replace("%ls", cardName);
    return text;
  }

  sys(id: number) {
    return this.strings.sys(id);
  }

  victory(reason: number) {
    return this.strings.victory.get(reason) ?? `Reason ${reason}`;
  }

  counterName(type: number) {
    return this.strings.counter.get(type) ?? `Counter ${type.toString(16)}`;
  }

  attributeNames(mask: number) {
    return ATTRIBUTES.filter(([b]) => mask & b).map(([, n]) => n);
  }

  raceNames(mask: bigint) {
    return RACES.filter(([b]) => mask & b).map(([, n]) => n);
  }

  /** "Dragon / Effect" style type line. */
  typeLine(c: Pick<CardInfo, "type" | "race">): string {
    const t = c.type;
    if (t & TYPE.SPELL || t & TYPE.TRAP) {
      const kind = t & TYPE.SPELL ? "Spell" : "Trap";
      const sub =
        t & TYPE.QUICKPLAY ? "Quick-Play" : t & TYPE.CONTINUOUS ? "Continuous" : t & TYPE.EQUIP ? "Equip" : t & TYPE.FIELD ? "Field" : t & TYPE.COUNTER ? "Counter" : t & TYPE.RITUAL ? "Ritual" : "Normal";
      return `${sub} ${kind}`;
    }
    const parts = [this.raceNames(c.race).join("/") || "Monster"];
    const flags: [number, string][] = [
      [TYPE.FUSION, "Fusion"],
      [TYPE.RITUAL, "Ritual"],
      [TYPE.SYNCHRO, "Synchro"],
      [TYPE.XYZ, "Xyz"],
      [TYPE.PENDULUM, "Pendulum"],
      [TYPE.LINK, "Link"],
      [TYPE.SPIRIT, "Spirit"],
      [TYPE.UNION, "Union"],
      [TYPE.GEMINI, "Gemini"],
      [TYPE.TOON, "Toon"],
      [TYPE.FLIP, "Flip"],
      [TYPE.TUNER, "Tuner"],
      [TYPE.TOKEN, "Token"],
    ];
    for (const [f, n] of flags) if (t & f) parts.push(n);
    parts.push(t & TYPE.EFFECT ? "Effect" : t & TYPE.NORMAL ? "Normal" : "");
    return parts.filter(Boolean).join(" / ");
  }

  locationName(location: number, sequence?: number): string {
    switch (location & 0x7f) {
      case 0x01:
        return "Deck";
      case 0x02:
        return "Hand";
      case 0x04:
        return sequence !== undefined && sequence >= 5 ? "Extra Monster Zone" : "Monster Zone";
      case 0x08:
        if (sequence === 5) return "Field Zone";
        if (sequence !== undefined && sequence >= 6) return "Pendulum Zone";
        return "Spell & Trap Zone";
      case 0x10:
        return "GY";
      case 0x20:
        return "Banished";
      case 0x40:
        return "Extra Deck";
      default:
        return location & 0x80 ? "Xyz Material" : "Unknown";
    }
  }

  phaseName(phase: number): string {
    switch (phase) {
      case PHASE.DRAW:
        return "Draw Phase";
      case PHASE.STANDBY:
        return "Standby Phase";
      case PHASE.MAIN1:
        return "Main Phase 1";
      case PHASE.BATTLE_START:
      case PHASE.BATTLE_STEP:
      case PHASE.DAMAGE:
      case PHASE.DAMAGE_CAL:
      case PHASE.BATTLE:
        return "Battle Phase";
      case PHASE.MAIN2:
        return "Main Phase 2";
      case PHASE.END:
        return "End Phase";
      default:
        return "";
    }
  }

  formatter(): Formatter {
    return {
      name: (code) => (code ? this.cards.name(code) : "a face-down card"),
      desc: (d) => this.desc(d),
      phase: (p) => this.phaseName(p),
      winReason: (r) => this.victory(r),
      info: (c) => this.cards.get(c),
    };
  }
}
