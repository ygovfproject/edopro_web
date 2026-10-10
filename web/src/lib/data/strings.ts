// EDOPro strings.conf parser plus English fallbacks for the strings the
// client needs even when no strings.conf is configured.

export class Strings {
  system = new Map<number, string>();
  victory = new Map<number, string>();
  counter = new Map<number, string>();
  setname = new Map<number, string>();

  constructor() {
    for (const [k, v] of Object.entries(FALLBACK_SYSTEM)) this.system.set(Number(k), v);
    for (const [k, v] of Object.entries(FALLBACK_VICTORY)) this.victory.set(Number(k), v);
  }

  parse(text: string) {
    for (const raw of text.split(/\r?\n/)) {
      const m = raw.match(/^!(system|victory|counter|setname)\s+(\S+)\s+(.*)$/);
      if (!m) continue;
      const key = m[2].startsWith("0x") ? Number.parseInt(m[2], 16) : Number.parseInt(m[2], 10);
      if (!Number.isFinite(key)) continue;
      const value = m[3].trim();
      const target = m[1] === "system" ? this.system : m[1] === "victory" ? this.victory : m[1] === "counter" ? this.counter : this.setname;
      // setname lines look like "0x1 Ally of Justice\tアリー"; keep the first column.
      target.set(key, m[1] === "setname" ? value.split("\t")[0] : value);
    }
  }

  sys(id: number, fallback = ""): string {
    return this.system.get(id) ?? (fallback || `#${id}`);
  }
}

export const ATTRIBUTES: [number, string][] = [
  [0x01, "EARTH"],
  [0x02, "WATER"],
  [0x04, "FIRE"],
  [0x08, "WIND"],
  [0x10, "LIGHT"],
  [0x20, "DARK"],
  [0x40, "DIVINE"],
];

export const RACES: [bigint, string][] = [
  "Warrior", "Spellcaster", "Fairy", "Fiend", "Zombie", "Machine", "Aqua", "Pyro", "Rock", "Winged Beast",
  "Plant", "Insect", "Thunder", "Dragon", "Beast", "Beast-Warrior", "Dinosaur", "Fish", "Sea Serpent",
  "Reptile", "Psychic", "Divine-Beast", "Creator God", "Wyrm", "Cyberse", "Illusion", "Cyborg",
  "Magical Knight", "High Dragon", "Omega Psychic",
].map((name, i) => [1n << BigInt(i), name]);

const FALLBACK_SYSTEM: Record<number, string> = {
  20: "Draw Phase",
  21: "Standby Phase",
  22: "Main Phase",
  24: "Battle Phase",
  26: "End Phase",
  30: "A replay occurred, continue the attack?",
  31: "Attack directly?",
  60: "Heads",
  61: "Tails",
  90: "Normal Summon without Tribute(s)?",
  91: "Use your additional Normal Summon?",
  93: "Continue choosing materials?",
  94: "Activate this card's effect now?",
  95: 'Use the effect of "%ls"?',
  96: 'Use the effect of "%ls" to avoid destruction?',
  97: 'Place "%ls" in the Spell & Trap Zone?',
  100: "Go first",
  101: "Go second",
  200: 'Use the effect of "%ls" from [%ls]?',
  203: "Activate a card or effect?",
  205: "Select the sort order [from top to bottom]",
  206: "Select the Chain Link sequence",
  221: 'Activate the Trigger Effect of "%ls" from [%ls]?',
  222: "Activate a Trigger Effect?",
  500: "Select the card(s) to Tribute",
  501: "Select the card(s) to discard",
  502: "Select the card(s) to destroy",
  503: "Select the card(s) to banish",
  504: "Select the card(s) to send to the GY",
  505: "Select the card(s) to return to the hand",
  506: "Select the card(s) to add to your hand",
  507: "Select the card(s) to return to the Deck",
  508: "Select the card(s) to Normal Summon",
  509: "Select the card(s) to Special Summon",
  510: "Select the card(s) to Set to the field",
  511: "Select the card(s) to use as Fusion Material",
  512: "Select the card(s) to use as Synchro Material",
  513: "Select the card(s) to use as Xyz Material",
  519: "Select the Xyz Material(s) to detach",
  531: "Select monsters for Tribute Summon",
  533: "Select the card(s) to use as Link Material",
  549: "Select an attack target",
  550: "Select the effect you want to activate",
  551: "Select the target(s) of the effect",
  555: "Select an option",
  556: "Select the effect to apply/resolve",
  560: "Select",
  561: "Select the battle position",
  562: "Declare an Attribute",
  563: "Declare a Type",
  564: "Declare a card name",
  565: "Declare a number",
  566: "Select the effect to activate",
  569: 'Select the zone to place "%ls"',
  570: "Select the zone(s) to become unusable",
  572: "Select the card(s) to place a counter on",
  1150: "Activate",
  1151: "Normal Summon",
  1152: "Special Summon",
  1153: "Set",
  1154: "Flip Summon",
  1155: "To Defense",
  1156: "To Attack",
  1157: "Attack",
  1159: "S/T Set",
  1160: "Activate it as a Pendulum Spell",
  1161: "Resolve effect",
  1162: "Reset effect",
};

const FALLBACK_VICTORY: Record<number, string> = {
  0x0: "Surrendered",
  0x1: "LP reached 0",
  0x2: "Cards can't be drawn",
  0x3: "Time limit up",
  0x4: "Lost connection",
};
