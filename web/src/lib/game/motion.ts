/**
 * Hints from the board model to the card renderer about how a card should move
 * on its next render. Set while game messages are applied, read once by the
 * card's move animation.
 */

/** How a hidden card shows up once its hold time is over. */
export type AppearStyle = "fade" | "pop" | "twist";

export const motion = {
  /** Cards that leave without flying to their new pile (destroyed, used as material). */
  vanish: new Set<number>(),
  /** Cards that stay invisible for `hold` ms where they land, then appear in place. */
  appear: new Map<number, { hold: number; style: AppearStyle }>(),
  clear() {
    this.vanish.clear();
    this.appear.clear();
  },
};
