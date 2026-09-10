/* Whose viewing is this. Plex attributes everything to the account, not the
   person, but each history entry records which device played it — the only
   handle on "that was the other TV, not me". */
import { devices as serverDevices, history } from '../api/plex/library';
import { KEY, debug, isBack, show } from '../core/ui';
import * as merge from './merge';
import * as servers from './servers';

/* Fetched per server on the first paint's critical path, and Plex history
   entries are fat. */
const HISTORY = 100;

interface Claim {
  key: string;
  name: string;
  server: string;
  count: number;
  mine: boolean;
}

/** 'serverId:ratingKey' -> 'serverId:deviceID'. */
let played: Record<string, string> | null = null;

/** null means never configured, so nothing is filtered. */
let claimed: Record<string, boolean> | null = null;

let list: Claim[] = [];
let selected = 0;
let onClose: ((changed: boolean) => void) | null = null;

function must(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no #${id}`);
  return element;
}
const listElement = must('device-list');

function local(name: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(name);
    localStorage.setItem(name, value);
  } catch {
    /* private mode / quota */
  }
  return null;
}

export function init(): void {
  const raw = local('myDevices');
  if (!raw) return;
  try {
    claimed = JSON.parse(raw) as Record<string, boolean>;
  } catch {
    claimed = null;
  }
}

function itemKey(server: PlexServer, ratingKey: string): string {
  return `${server.id}:${ratingKey}`;
}

function countDevices(map: Record<string, string>): number {
  const seen: Record<string, true> = {};
  Object.keys(map).forEach((entry) => {
    const device = map[entry];
    if (device) seen[device] = true;
  });
  return Object.keys(seen).length;
}

/* One history fetch per server per session gives "which device last played
   this". onDeck carries no device information of its own. */
export function ensureHistory(): Promise<Record<string, string>> {
  if (played) return Promise.resolve(played);
  const reachable = servers.all();
  return Promise.all(
    reachable.map((server) => history(server, HISTORY).then((entries) => ({ server, entries }))),
  )
    .then((perServer) => {
      const map: Record<string, string> = {};
      let count = 0;
      perServer.forEach((result) => {
        /* Sorted newest first, so the first entry per item is the latest. */
        result.entries.forEach((entry) => {
          const deviceId = (entry as { deviceID?: number }).deviceID;
          if (!entry.ratingKey || deviceId === undefined) return;
          const seenAt = itemKey(result.server, entry.ratingKey);
          if (map[seenAt] === undefined) {
            map[seenAt] = `${result.server.id}:${deviceId}`;
            count++;
          }
        });
      });
      played = map;
      debug(
        `history: ${count} items across ${reachable.length} server` +
          (reachable.length === 1 ? '' : 's') +
          `, ${countDevices(map)} devices`,
      );
      return map;
    })
    .catch((error: Error) => {
      debug(`history unavailable: ${error.message}`);
      played = {}; // do not retry all session; filtering just stays off
      return played;
    });
}

/** A merged entry survives if any copy of it does. */
export function mine(items: PlexItem[]): PlexItem[] {
  const owned = claimed;
  const seen = played;
  if (!owned || !seen) return items;
  return items.filter((entry) =>
    merge.sources(entry).some((copy) => {
      const device = seen[`${copy._server ?? ''}:${copy.ratingKey}`];
      return !device || owned[device];
    }),
  );
}

function row(className: string, ...parts: (string | Node)[]): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  element.append(...parts);
  return element;
}

function badge(text: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = 'device-count';
  element.textContent = text;
  return element;
}

function render(): void {
  if (!list.length) {
    listElement.replaceChildren(row('device-row', 'No device history available on these servers.'));
    return;
  }
  listElement.replaceChildren(
    ...list.map((claim, at) => {
      const line = row('device-row' + (at === selected ? ' on' : ''), claim.mine ? '[x] ' : '[ ] ');
      line.append(claim.name);
      if (claim.server) line.append(' ', badge(`on ${claim.server}`));
      line.append(' ', badge(`${claim.count} items`));
      return line;
    }),
  );
}

export function open(onSaved: (changed: boolean) => void): void {
  onClose = onSaved;
  show('devices');
  selected = 0;
  listElement.replaceChildren(row('device-row', 'Reading history…'));

  const reachable = servers.all();
  void Promise.all([
    ensureHistory(),
    Promise.all(
      reachable.map((server) => serverDevices(server).then((found) => ({ server, found }))),
    ),
  ]).then(([map, named]) => {
    const names: Record<string, string> = {};
    named.forEach((entry) => {
      entry.found.forEach((device) => {
        names[`${entry.server.id}:${device.id}`] = device.name;
      });
    });

    const counts: Record<string, number> = {};
    Object.keys(map).forEach((entry) => {
      const device = map[entry];
      if (device) counts[device] = (counts[device] ?? 0) + 1;
    });

    list = Object.keys(counts)
      .map((deviceKey) => {
        const server = servers.get(deviceKey.split(':')[0]);
        return {
          key: deviceKey,
          name: names[deviceKey] ?? `device ${deviceKey.split(':')[1]}`,
          server: servers.label(server),
          count: counts[deviceKey] ?? 0,
          mine: claimed ? !!claimed[deviceKey] : true,
        };
      })
      .sort((one, two) => two.count - one.count);
    render();
  });
}

function save(): void {
  let changed = false;
  if (list.length) {
    const map: Record<string, boolean> = {};
    list.forEach((claim) => {
      if (claim.mine) map[claim.key] = true;
    });
    claimed = map;
    local('myDevices', JSON.stringify(map));
    debug(`devices: ${Object.keys(map).length} of ${list.length} claimed`);
    changed = true;
  }
  const done = onClose;
  onClose = null;
  done?.(changed);
}

/** True if it handled the key. This screen swallows everything. */
export function key(code: number): boolean {
  if (code === KEY.UP && selected > 0) {
    selected--;
    render();
    return true;
  }
  if (code === KEY.DOWN && selected < list.length - 1) {
    selected++;
    render();
    return true;
  }
  const current = list[selected];
  if (code === KEY.OK && current) {
    current.mine = !current.mine;
    render();
    return true;
  }
  if (isBack(code)) save();
  return true;
}
