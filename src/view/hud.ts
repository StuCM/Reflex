/* The tuning panel: motion toggles and live frame numbers, hidden until Blue. */
import { setPosterSize } from '../data/art';

const OPTIONS = {
  hero: ['off', 0, 150, 280, 420],
  wc: ['off', 'containers'],
  glow: ['static', 'page', 'drift'],
  shadows: ['on', 'off'],
  timing: ['fast', 'default', 'slow'],
  skip: ['on', 'off'],
  noise: [0, 0.03, 0.05, 0.08],
  focus: ['scale', 'ring', 'both'],
  poster: ['w342', 'w185'],
};
type Name = keyof typeof OPTIONS;

/* Quick, move and menu, in ms. */
const TIMINGS = [
  [100, 200, 240],
  [130, 260, 300],
  [180, 360, 420],
];

/* Number key to setting: 1 to 8, in the order the panel lists them; 9 is poster. */
const ORDER: Name[] = ['hero', 'wc', 'glow', 'shadows', 'timing', 'skip', 'noise', 'focus'];
const DEFAULTS: Record<Name, number> = {
  hero: 2,
  wc: 1,
  glow: 1,
  shadows: 0,
  timing: 2,
  skip: 0,
  noise: 1,
  focus: 0,
  poster: 1,
};
const STORE_KEY = 'reflex.tuning';

const state: Record<Name, number> = { ...DEFAULTS };
const panel = document.getElementById('hud');
const browse = document.getElementById('browse');
const rows = document.getElementById('rows');
const root = document.documentElement;

let running = false;
let frames: number[] = [];
let worst = 0;
let jank = 0;
let lastFrame = 0;
let keyAt = 0;
let keySum = 0;
let keyCount = 0;

function load(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    [...ORDER, 'poster' as Name].forEach((name) => {
      const index = saved[name];
      if (index >= 0 && index < OPTIONS[name].length) state[name] = index;
    });
  } catch {
    /* no storage, or nothing worth reading: the defaults stand */
  }
}

function save(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* a private window: the setting lasts until the next launch */
  }
}

function value(name: Name): number | string {
  return OPTIONS[name][state[name]]!;
}

function apply(): void {
  document.body.classList.toggle('nowc', value('wc') === 'off');
  document.body.classList.toggle('noshift', value('glow') === 'static');
  document.body.classList.toggle('drift', value('glow') === 'drift');
  browse?.classList.toggle('shadows', value('shadows') === 'on');
  rows?.classList.toggle('f-ring', value('focus') === 'ring');
  rows?.classList.toggle('f-both', value('focus') === 'both');
  const [quick, move, menu] = TIMINGS[state.timing]!;
  root.style.setProperty('--t-quick', `${quick}ms`);
  root.style.setProperty('--t-move', `${move}ms`);
  root.style.setProperty('--t-menu', `${menu}ms`);
  root.style.setProperty('--noise', String(value('noise')));
  setPosterSize(value('poster') as string);
}

export function heroHold(): number {
  const hold = value('hero');
  return hold === 'off' ? 0 : (hold as number);
}

export function heroOn(): boolean {
  return value('hero') !== 'off';
}

export function skipOnRepeat(): boolean {
  return value('skip') === 'on';
}

function resetStats(): void {
  frames = [];
  worst = 0;
  jank = 0;
  keySum = 0;
  keyCount = 0;
}

function paint(): void {
  if (!panel) return;
  const cutoff = lastFrame - 1000;
  const fps = frames.filter((at) => at > cutoff).length;
  const keyMs = keyCount ? (keySum / keyCount).toFixed(1) : '-';
  const lines = [
    `fps ${fps}   worst ${worst.toFixed(1)} ms   jank ${jank}   key>frame ${keyMs} ms`,
    ...ORDER.map((name, i) => `${i + 1} ${name} ${value(name)}`),
    `9 poster ${value('poster')}   0 reset stats`,
  ];
  panel.textContent = lines.join('\n');
}

let lastPaint = 0;

function tick(now: number): void {
  if (!running) return;
  if (lastFrame) {
    const gap = now - lastFrame;
    if (gap > worst) worst = gap;
    if (gap > 25) jank++;
  }
  lastFrame = now;
  frames.push(now);
  while (frames.length && now - frames[0]! > 2000) frames.shift();
  if (keyAt) {
    keySum += performance.now() - keyAt;
    keyCount++;
    keyAt = 0;
  }
  if (now - lastPaint > 500) {
    lastPaint = now;
    paint();
  }
  requestAnimationFrame(tick);
}

export function visible(): boolean {
  return running;
}

export function toggle(): void {
  if (!panel) return;
  running = !running;
  panel.classList.toggle('hidden', !running);
  if (!running) return;
  resetStats();
  lastFrame = 0;
  paint();
  requestAnimationFrame(tick);
}

/* Notes when a key went down, for the key>frame number. */
export function noteKey(): void {
  if (running) keyAt = performance.now();
}

/* Number keys while the panel shows; true when the key was one of its own. */
export function key(code: number): boolean {
  const digit = code - 48;
  if (digit < 0 || digit > 9) return false;
  if (digit === 0) resetStats();
  else if (digit >= 1) {
    const name = digit === 9 ? 'poster' : ORDER[digit - 1]!;
    state[name] = (state[name] + 1) % OPTIONS[name].length;
    save();
    apply();
  }
  paint();
  return true;
}

load();
apply();
