import { KEY } from '../core/ui';

/** How long OK is held before it counts as a hold, in milliseconds. */
const HOLD_MS = 500;

export interface Hold {
  down(): void;
  up(): void;
  /** True for the remote's repeated OK keydowns once the hold has fired. */
  swallow(code: number): boolean;
  cancel(): void;
}

/* OK acts on release, so a hold can open a menu instead of what a tap does.
   `held` stays set until the release: the remote keeps sending keydown, and
   once the menu is up those repeats would reach it as confirmations. */
export function createHold(onTap: () => void, onHold: () => void): Hold {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let held = false;

  function cancel(): void {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function fire(): void {
    cancel();
    held = true;
    onHold();
  }

  return {
    down() {
      // a second keydown while the timer runs is the remote repeating
      if (timer) fire();
      else timer = setTimeout(fire, HOLD_MS);
    },
    up() {
      held = false;
      if (!timer) return; // the menu opened, or this press began elsewhere
      cancel();
      onTap();
    },
    swallow: (code) => code === KEY.OK && held,
    cancel,
  };
}
