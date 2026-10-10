// EDOPro network protocol constants (see edopro/gframe/network.h and
// Multirole/src/Multirole/YGOPro/{CTOSMsg,STOCMsg}.hpp).

export const CTOS = {
  RESPONSE: 0x01,
  UPDATE_DECK: 0x02,
  HAND_RESULT: 0x03, // rock-paper-scissors choice
  TP_RESULT: 0x04, // go first / go second
  PLAYER_INFO: 0x10,
  CREATE_GAME: 0x11,
  JOIN_GAME: 0x12,
  LEAVE_GAME: 0x13,
  SURRENDER: 0x14,
  TIME_CONFIRM: 0x15,
  CHAT: 0x16,
  HS_TODUELIST: 0x20,
  HS_TOOBSERVER: 0x21,
  HS_READY: 0x22,
  HS_NOTREADY: 0x23,
  HS_KICK: 0x24,
  HS_START: 0x25,
  REMATCH_RESPONSE: 0xf0,
} as const;

export const STOC = {
  GAME_MSG: 0x01,
  ERROR_MSG: 0x02,
  SELECT_HAND: 0x03,
  SELECT_TP: 0x04,
  HAND_RESULT: 0x05,
  TP_RESULT: 0x06,
  CHANGE_SIDE: 0x07,
  WAITING_SIDE: 0x08,
  CREATE_GAME: 0x11,
  JOIN_GAME: 0x12,
  TYPE_CHANGE: 0x13,
  LEAVE_GAME: 0x14,
  DUEL_START: 0x15,
  DUEL_END: 0x16,
  REPLAY: 0x17,
  TIME_LIMIT: 0x18,
  CHAT: 0x19,
  HS_PLAYER_ENTER: 0x20,
  HS_PLAYER_CHANGE: 0x21,
  HS_WATCH_CHANGE: 0x22,
  NEW_REPLAY: 0x30,
  CATCHUP: 0xf0,
  REMATCH: 0xf1,
  WAITING_REMATCH: 0xf2,
  CHAT_2: 0xf3,
} as const;

export const ERRMSG = {
  JOINERROR: 0x1,
  DECKERROR: 0x2,
  SIDEERROR: 0x3,
  VERERROR: 0x4,
  VERERROR2: 0x5,
} as const;

export const JOIN_ERROR = {
  UNABLE: 0,
  PASSWORD: 1,
  REFUSED: 2,
} as const;

export const DECK_ERROR = {
  NONE: 0,
  LFLIST: 1,
  OCGONLY: 2,
  TCGONLY: 3,
  UNKNOWNCARD: 4,
  CARDCOUNT: 5,
  MAINCOUNT: 6,
  EXTRACOUNT: 7,
  SIDECOUNT: 8,
  FORBTYPE: 9,
  UNOFFICIALCARD: 10,
  INVALIDSIZE: 11,
  TOOMANYLEGENDS: 12,
  TOOMANYSKILLS: 13,
} as const;

export const PLAYERCHANGE = {
  OBSERVE: 0x8,
  READY: 0x9,
  NOTREADY: 0xa,
  LEAVE: 0xb,
} as const;

export const CHAT_TYPE = {
  DUELIST: 0,
  OBSERVER: 1,
  SYSTEM: 2,
  SYSTEM_ERROR: 3,
  SYSTEM_SHOUT: 4,
} as const;

export const SERVER_HANDSHAKE = 4043399681;

/** Position value used by the server for spectators in TYPE_CHANGE. */
export const OBSERVER_POS = 7;

/** "allowed cards" values in HostInfo.rule */
export const ALLOWED_CARDS = {
  OCG_ONLY: 0,
  TCG_ONLY: 1,
  OCG_TCG: 2,
  WITH_PRERELEASE: 3,
  ANY: 4,
} as const;

/** Duel flags (64-bit, split into high/low in HostInfo). */
export const DUEL_FLAGS = {
  TEST_MODE: 0x01n,
  ATTACK_FIRST_TURN: 0x02n,
  USE_TRAPS_IN_NEW_CHAIN: 0x04n,
  SIX_STEP_BATLLE_STEP: 0x08n,
  PSEUDO_SHUFFLE: 0x10n,
  TRIGGER_WHEN_PRIVATE_KNOWLEDGE: 0x20n,
  SIMPLE_AI: 0x40n,
  RELAY: 0x80n,
  OBSOLETE_IGNITION: 0x100n,
  FIRST_TURN_DRAW: 0x200n,
  ONE_FACEUP_FIELD: 0x400n,
  PZONE: 0x800n,
  SEPARATE_PZONE: 0x1000n,
  EMZONE: 0x2000n,
  FSX_MMZONE: 0x4000n,
  TRAP_MONSTERS_NOT_USE_ZONE: 0x8000n,
  RETURN_TO_DECK_TRIGGERS: 0x10000n,
  TRIGGER_ONLY_IN_LOCATION: 0x20000n,
  SPSUMMON_ONCE_OLD_NEGATE: 0x40000n,
  CANNOT_SUMMON_OATH_OLD: 0x80000n,
  NO_STANDBY_PHASE: 0x100000n,
  NO_MAIN_PHASE_2: 0x200000n,
  THREE_COLUMNS_FIELD: 0x400000n,
  DRAW_UNTIL_5: 0x800000n,
  NO_HAND_LIMIT: 0x1000000n,
  UNLIMITED_SUMMONS: 0x2000000n,
  INVERTED_QUICK_PRIORITY: 0x4000000n,
  EQUIP_NOT_SENT_IF_MISSING_TARGET: 0x8000000n,
  ZERO_ATK_DESTROYED: 0x10000000n,
  STORE_ATTACK_REPLAYS: 0x20000000n,
  SINGLE_CHAIN_IN_DAMAGE_SUBSTEP: 0x40000000n,
  CAN_REPOS_IF_NON_SUMPLAYER: 0x80000000n,
  TCG_SEGOC_NONPUBLIC: 0x100000000n,
  TCG_SEGOC_FIRSTTRIGGER: 0x200000000n,
  TCG_FAST_EFFECT_IGNITION: 0x400000000n,
  EXTRA_DECK_RITUAL: 0x800000000n,
  NORMAL_SUMMON_FACEUP_DEF: 0x1000000000n,
} as const;

// Master Rule presets, as defined by EDOPro (common.h DUEL_MODE_*).
const F = DUEL_FLAGS;
const MR1 = F.OBSOLETE_IGNITION | F.FIRST_TURN_DRAW | F.ONE_FACEUP_FIELD | F.SPSUMMON_ONCE_OLD_NEGATE |
  F.RETURN_TO_DECK_TRIGGERS | F.CANNOT_SUMMON_OATH_OLD;
const MR2 = F.FIRST_TURN_DRAW | F.ONE_FACEUP_FIELD | F.SPSUMMON_ONCE_OLD_NEGATE | F.RETURN_TO_DECK_TRIGGERS |
  F.CANNOT_SUMMON_OATH_OLD;
const MR3 = F.PZONE | F.SEPARATE_PZONE | F.SPSUMMON_ONCE_OLD_NEGATE | F.RETURN_TO_DECK_TRIGGERS | F.CANNOT_SUMMON_OATH_OLD;
const MR4 = F.PZONE | F.EMZONE | F.SPSUMMON_ONCE_OLD_NEGATE | F.RETURN_TO_DECK_TRIGGERS | F.CANNOT_SUMMON_OATH_OLD;
const MR5 = F.PZONE | F.EMZONE | F.FSX_MMZONE | F.TRAP_MONSTERS_NOT_USE_ZONE | F.TRIGGER_ONLY_IN_LOCATION;
const GOAT = MR1 | F.TCG_FAST_EFFECT_IGNITION | F.USE_TRAPS_IN_NEW_CHAIN | F.SIX_STEP_BATLLE_STEP |
  F.TRIGGER_WHEN_PRIVATE_KNOWLEDGE | F.EQUIP_NOT_SENT_IF_MISSING_TARGET | F.ZERO_ATK_DESTROYED |
  F.STORE_ATTACK_REPLAYS | F.SINGLE_CHAIN_IN_DAMAGE_SUBSTEP | F.CAN_REPOS_IF_NON_SUMPLAYER |
  F.TCG_SEGOC_NONPUBLIC | F.TCG_SEGOC_FIRSTTRIGGER;
const SPEED = F.THREE_COLUMNS_FIELD | F.NO_MAIN_PHASE_2 | F.TRAP_MONSTERS_NOT_USE_ZONE | F.TRIGGER_ONLY_IN_LOCATION;
const RUSH = F.THREE_COLUMNS_FIELD | F.NO_MAIN_PHASE_2 | F.NO_STANDBY_PHASE | F.FIRST_TURN_DRAW |
  F.INVERTED_QUICK_PRIORITY | F.DRAW_UNTIL_5 | F.NO_HAND_LIMIT | F.UNLIMITED_SUMMONS |
  F.TRAP_MONSTERS_NOT_USE_ZONE | F.TRIGGER_ONLY_IN_LOCATION | F.EXTRA_DECK_RITUAL;

const TYPE_XYZ = 0x800000;
const TYPE_PENDULUM = 0x1000000;
const TYPE_LINK = 0x4000000;

/** Duel rule presets as offered by EDOPro's host window, with the card types each one forbids. */
export const MASTER_RULES: { id: string; label: string; flags: bigint; forbiddenTypes: number }[] = [
  { id: "mr5", label: "Master Rule 2020 (MR5)", flags: MR5, forbiddenTypes: 0 },
  { id: "mr4", label: "New Master Rule (MR4)", flags: MR4, forbiddenTypes: 0 },
  { id: "mr3", label: "Master Rule 3", flags: MR3, forbiddenTypes: TYPE_LINK },
  { id: "mr2", label: "Master Rule 2", flags: MR2, forbiddenTypes: TYPE_PENDULUM | TYPE_LINK },
  { id: "mr1", label: "Master Rule 1", flags: MR1, forbiddenTypes: TYPE_XYZ | TYPE_PENDULUM | TYPE_LINK },
  { id: "goat", label: "GOAT", flags: GOAT, forbiddenTypes: TYPE_XYZ | TYPE_PENDULUM | TYPE_LINK },
  { id: "speed", label: "Speed Duel", flags: SPEED, forbiddenTypes: 0 },
  { id: "rush", label: "Rush Duel", flags: RUSH, forbiddenTypes: 0 },
];

/** Id of the preset ("mr5", "speed"...) a room's flags match, or null for custom rules. */
export function masterRuleIdOf(flags: bigint): string | null {
  const relevant = flags & ~F.PSEUDO_SHUFFLE;
  return MASTER_RULES.find((r) => r.flags === relevant)?.id ?? null;
}

export function masterRuleOf(flags: bigint): string | null {
  // The server adds PSEUDO_SHUFFLE on its own when "don't shuffle deck" is set.
  const relevant = flags & ~F.PSEUDO_SHUFFLE;
  const hit = MASTER_RULES.find((r) => r.flags === relevant);
  return hit ? hit.label : null;
}
