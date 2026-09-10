/* Which view is showing, the toast, the debug line, and the keycodes. */
import { request } from '../api/http';
import settings from './config';

/* Every full-screen view in index.html. show() hides all of them and reveals
   one; show('player') reveals none, since the video sits above the lot. */
const VIEWS = ['browse', 'show', 'detail', 'link', 'message', 'search', 'devices'] as const;

/* The TV sends 461 for Back; a desktop browser sends 8 or 27, which is what
   lets the whole app be driven from a keyboard in dev. */
export const KEY = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  OK: 13,
  RED: 403,
  BACK: 461,
  ESC: 27,
  BACKSPACE: 8,
};

function must(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no #${id}`);
  return element;
}

const views: Record<string, HTMLElement> = {};
VIEWS.forEach((name) => {
  views[name] = must(name);
});

const toastElement = must('toast');
const debugElement = must('debug');

let current: string = 'browse';
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const bootedAt = Date.now();

export function isBack(code: number): boolean {
  return code === KEY.BACK || code === KEY.ESC || code === KEY.BACKSPACE;
}

export function show(name: string): void {
  current = name;
  VIEWS.forEach((each) => {
    views[each]?.classList.toggle('hidden', each !== name);
  });
}

export function view(): string {
  return current;
}

/* The bottom line of the screen. WAM does not forward console.log anywhere
   readable on this set, so the same text can be posted to a listener on the dev
   machine — see settings.beacon and dev/beacon.js. Stamped with the time since
   launch, which is the only way to tell a slow server from a slow panel without
   a profiler. */
export function debug(line: string): void {
  const stamped = `${Date.now() - bootedAt}ms  ${line}`;
  debugElement.textContent = stamped;
  console.log(`REFLEX ${stamped}`);
  if (!settings.beacon) return;
  /* Never let logging break the app: the answer is thrown away, and so is any
     failure to deliver it. */
  request(`${settings.beacon}?m=${encodeURIComponent(line)}`, { label: 'beacon' }).then(
    null,
    () => {},
  );
}

export function toast(text: string): void {
  toastElement.textContent = text;
  toastElement.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastElement.classList.add('hidden');
  }, 4000);
}

export function message(title: string, body: string): void {
  must('message-title').textContent = title;
  must('message-body').textContent = body;
  show('message');
}

export function escapeHtml(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
