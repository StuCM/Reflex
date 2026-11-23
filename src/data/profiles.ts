/* Who is watching: three fixed profiles, each with an accent, and the plays
   recorded under whichever is active. Plex cannot tell Stu from Naoise on one
   device, so the plays are kept here. */
import { KEY, debug, view } from '../core/ui';
import * as store from './store';

export interface Profile {
  id: string;
  name: string;
  accent: string;
}

const PROFILES: Profile[] = [
  { id: 'together', name: 'Together', accent: '#F4C8B6' },
  { id: 'stu', name: 'Stu', accent: '#AEBBF0' },
  { id: 'naoise', name: 'Naoise', accent: '#8FD9C4' },
];

const SAVED = 'profile';
const SAVED_VERSION = 1;
const IDLE_MS = 4 * 60 * 60 * 1000;
const RECORD_EVERY = 30 * 1000;

let active = PROFILES[0] as Profile;
let idle: ReturnType<typeof setTimeout> | null = null;
/** `profile|ratingKey|server` of every play, for the Continue watching filter. */
const played = new Set<string>();
const lastWrite = new Map<string, number>();

export function all(): Profile[] {
  return PROFILES.slice();
}

export function current(): Profile {
  return active;
}

function rgba(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function paint(): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const style = document.documentElement.style;
  style.setProperty('--ac', active.accent);
  style.setProperty('--ac-soft', rgba(active.accent, 0.2));
  style.setProperty('--ac-tint', rgba(active.accent, 0.14));
}

/** Switches profile, repaints the accent and remembers the choice. */
export function set(id: string): void {
  const next = PROFILES.find((profile) => profile.id === id);
  if (!next) return;
  if (next !== active) {
    active = next;
    paint();
    void store.put(SAVED, { v: SAVED_VERSION, id });
  }
  touch();
}

/** A keypress: the 4-hour countdown to Together starts over. */
export function touch(): void {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => {
    set('together');
  }, IDLE_MS);
}

function playId(profile: string, ratingKey: string, server: string): string {
  return [profile, ratingKey, server].join('|');
}

/** Notes a play under the active profile; at most one write per item per 30 s. */
export function recordPlay(item: PlexItem, offset: number, duration: number): void {
  const server = item._server ?? '';
  if (!item.ratingKey) return;
  const id = playId(active.id, item.ratingKey, server);
  const now = Date.now();
  const last = lastWrite.get(id);
  if (last !== undefined && now - last < RECORD_EVERY) return;
  lastWrite.set(id, now);
  played.add(id);
  void store.putIn('plays', [active.id, item.ratingKey, server], {
    at: now,
    offset,
    duration,
    type: item.type,
    show: item.grandparentRatingKey,
  });
}

/** Whether the active profile has played this copy; Together has played everything. */
export function hasPlayed(item: PlexItem): boolean {
  if (active.id === 'together') return true;
  return played.has(playId(active.id, item.ratingKey, item._server ?? ''));
}

async function load(): Promise<void> {
  const saved = await store.get<{ v: number; id: string }>(SAVED);
  if (saved && saved.v === SAVED_VERSION) {
    const found = PROFILES.find((profile) => profile.id === saved.id);
    if (found) active = found;
  }
  paint();
  const keys = await store.keysIn('plays');
  keys.forEach((key) => {
    played.add(key.join('|'));
  });
}

let loading: Promise<void> | null = null;

/** Resolves once the saved profile and its plays are in memory. */
export function ready(): Promise<void> {
  loading ??= load();
  return loading;
}

function onKey(event: KeyboardEvent): void {
  touch();
  if (event.keyCode !== KEY.CH_UP && event.keyCode !== KEY.CH_DOWN) return;
  debug(`channel key ${event.keyCode}`);
  if (view() !== 'browse') return;
  const step = event.keyCode === KEY.CH_UP ? 1 : PROFILES.length - 1;
  const at = PROFILES.indexOf(active);
  set((PROFILES[(at + step) % PROFILES.length] as Profile).id);
}

/* Nothing else in boot calls this, so the module starts itself; the guard is
   for the unit tests' document stub, which cannot listen. */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  void ready();
  touch();
  document.addEventListener('keydown', onKey, false);
}
