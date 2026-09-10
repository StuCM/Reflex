/* What is in the rails, and where the focus is: sections, rows, focus, mode.

   Nothing here holds a whole section. The All row is virtual over the servers'
   own totals and walks them in title order only as far as you scroll. */
import {
  contentRatings as plexContentRatings,
  hideFromDeck as plexHideFromDeck,
  hubs as plexHubs,
  items as plexItems,
  onDeck as plexOnDeck,
  scrobble as plexScrobble,
  search as plexSearch,
  tmdbId as plexTmdbId,
} from '../api/plex/library';
import { cycleTheme, themeLabel } from './showpage';
import { identity } from '../rules/identity';

interface DeckJob {
  entry: PlexItem;
  copies: PlexItem[];
}
import { KIDS_MAX_AGE, isKidsRating } from '../rules/ratings';
import * as cached from '../data/cached';
import * as devices from '../data/devices';
import { report as panelReport } from '../core/panel';
import * as discovery from '../data/discovery';
import * as masthead from '../view/masthead';
import * as menu from '../view/menu';
import * as merge from '../data/merge';
import * as rail from '../view/rail';
import * as rowModel from '../rules/rows';
import * as servers from '../data/servers';
import * as sidebar from '../view/sidebar';
import { KEY, clamp, debug, isBack, message, show as showView, toast } from '../core/ui';

function must(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no #${id}`);
  return element;
}

const browseView = must('browse');
const searchInput = must('search-input') as HTMLInputElement;
const hintLine = must('browse-hint');
const confirmHost = must('confirm');

interface BrowseSection {
  title: string;
  type: 'movie' | 'show';
  parts: MergePart[];
  current?: boolean;
}

interface BrowseOptions {
  onOpen?: (item: PlexItem) => void;
  onShow?: (item: PlexItem) => void;
  onExit?: () => void;
  [key: string]: unknown;
}

let sections: BrowseSection[] = [];
let sectionIndex = 0;
let rows: Row[] = [];
let rowIndex = 0;
/** section title -> its row titles, for the sidebar. */
const cats: Record<string, string[]> = {};
/** Continue watching, before any type filter. */
let deckItems: PlexItem[] = [];
/** The cut applied to it: null, movie or episode. */
let watchingType: string | null = null;
/** Row to land on once the next section is built. */
let wantRow = 0;
let mode: 'library' | 'kids' | 'discover' = 'library';
/** Rows parked while showing search results. */
let savedRows: Row[] | null = null;
/** Non-null while the results page is showing. */
let searchQuery: string | null = null;
/** Bumps on any row change, kills stale paints. */
let generation = 0;
let pageTimer: ReturnType<typeof setTimeout> | null = null;
/** A Discovery tile, once you stop on it. */
let resolveTimer: ReturnType<typeof setTimeout> | null = null;
const RESOLVE_HOLD = 420; // the stillness the backdrop also waits for
const MAX_SEEDS = 8; // titles the recommended row is built from
let options: BrowseOptions = {};

let picking = false; // green has the deck row in select mode
/** The entries picked, while it has. */
let picks: PlexItem[] = [];
let pickAt = -1; // the row that is happening on

const RESULTS_PER_ROW = 10;
const WATCHING = 'Continue watching';
/* KEY carries red, which search already uses; green is free on this
   screen and is the only other key the Magic Remote's siblings all have. */
const GREEN = 404;

/* One section per kind of thing this app can play, whatever the servers call
   their libraries. Music and photos are neither, so they are left out. */
const SECTION_TITLES: Record<'movie' | 'show', string> = { movie: 'Movies', show: 'TV Shows' };
const SECTION_ORDER: ('movie' | 'show')[] = ['movie', 'show'];

export function init(chosen: BrowseOptions) {
  options = chosen;
  /* Enter from the on-screen keyboard arrives on the input, not the document.
     It must not go on to reach the browse key handler: runSearch switches
     back to the browse view synchronously, so by the time the event bubbled
     up it would read as OK on whatever was focused before the search. */
  searchInput.addEventListener(
    'keydown',
    (event) => {
      if (event.keyCode !== KEY.OK) return;
      event.preventDefault();
      event.stopPropagation();
      runSearch();
    },
    false,
  );
}

/* ---------- state the rest of the app asks about ---------- */

function focusedRow() {
  return rows[rowIndex];
}
export function focusedItem(): PlexItem | null {
  const row = focusedRow();
  return row ? rowModel.itemAt(row, row.focus) : null;
}
export function hasRows() {
  return rows.length > 0;
}
export function currentSection() {
  return sections[sectionIndex] || null;
}

/* A guard any in-flight load can check before it paints. */
function generationGuard() {
  const mine = generation;
  return () => {
    return mine === generation;
  };
}

export function render() {
  browseView.classList.toggle('results', !!searchQuery);
  /* The hero is full height on the first row and a band everywhere else, so
     the rows have somewhere to go the moment you step into them. */
  browseView.classList.toggle('dense', rowIndex !== 0);
  rail.render(rows, rowIndex);
  masthead.render(focusedRow() ?? null, focusedItem(), rows.length > 0);
  /* The backdrop keeps its own debounce — Meta's skips a cached item and
     would leave the last film's art under the new one's title. */
  masthead.showArt(focusedItem());
  const focused = focusedItem();
  if (focused) scheduleResolve(focused);
  markPicks();
  scheduleWalk();
}

/* ---------- servers and sections ----------

   Every movie library on every server is one part of Movies, and every show
   library one part of TV shows. A server that splits its films across a 4K
   library and an LQ one contributes two parts; the merge folds them back to
   one entry per film, the way it already does across servers. */

export function setSections(perServer: { server: PlexServer; sections: PlexSection[] }[]): number {
  const byType: Partial<Record<'movie' | 'show', BrowseSection>> = {};

  perServer.forEach((entry) => {
    entry.sections.forEach((section) => {
      const type = section.type;
      const title = SECTION_TITLES[type];
      if (!title) return;
      byType[type] ??= { title, type, parts: [] };
      byType[type].parts.push({
        server: entry.server,
        key: section.key,
        updatedAt: section.updatedAt || 0,
      });
    });
  });

  const currentTitle = sections[sectionIndex]?.title;
  sections = SECTION_ORDER.map((type) => byType[type]).filter(
    (section): section is BrowseSection => !!section,
  );
  const at = sections.findIndex((section) => section.title === currentTitle);
  return at < 0 ? 0 : at;
}

function serversOf(section: BrowseSection): PlexServer[] {
  const out: PlexServer[] = [];
  const seen: Record<string, true> = {};
  section.parts.forEach((part) => {
    if (seen[part.server.id]) return;
    seen[part.server.id] = true;
    out.push(part.server);
  });
  return out;
}

/* ---------- the sidebar ----------

   The Magic Remote has no colour buttons, so every action has to be reachable
   with the d-pad. Left from the first tile of a row lands here. */

function openSidebar() {
  /* Continue watching is per account rather than per section, so it heads the
     list on its own rather than once under every section. */
  const at = watchingRowIndex();
  const watching = {
    current: mode === 'library' && rowIndex === at,
    type: watchingType,
    has: at >= 0 && (rows[at]?.total ?? 0) > 0,
  };
  sidebar.open(
    sections.map((section, i) => {
      /* Category titles are the row titles of a section we have already built,
       so this fetches nothing. A section never visited simply lists none. */
      return {
        title: section.title,
        categories: cats[section.title] ?? [],
        current: mode === 'library' && i === sectionIndex,
      };
    }),
    activate,
    mode,
    watching,
  );
}

/* Select mode renames the row, so while it is on the row is known by where it
   is rather than by what it says. */
function watchingRowIndex(): number {
  if (picking) return pickAt;
  return rows.findIndex((row) => row.title === WATCHING);
}

function deckCut() {
  if (!watchingType) return deckItems;
  return deckItems.filter((entry) => entry.type === watchingType);
}

/* Continue watching, cut to films or episodes. The unfiltered deck is kept so
   the cut can be lifted without asking the servers again, and an empty cut
   leaves the row where it is — a row vanishing on a keypress reads as a
   crash. */
function showWatching(type: string | null) {
  const at = watchingRowIndex();
  if (at < 0) {
    toast('Nothing part-watched there');
    return;
  }
  watchingType = type || null;
  const items = deckCut();
  rows[at] = rowModel.list(WATCHING, items);
  rowIndex = at;
  render();
  if (!items.length) toast('Nothing part-watched there');
}

/* ---------- clearing Continue watching ----------

   The row grows and never shrinks, and Plex's own way out is marking things
   watched — which for a series two seasons in means losing the fact that you
   have seen two. So an item is hidden where the server can, and only where it
   cannot is the user asked to mark it watched instead. Nothing goes without a
   confirmation, and nothing leaves the row before the server has agreed. */

function pickIndex(item: PlexItem): number {
  const wanted = identity(item);
  for (let i = 0; i < picks.length; i++) if (identity(picks[i]) === wanted) return i;
  return -1;
}

/* Amber on tiles the rail has already drawn. The row model knows nothing
   about a mode that lasts seconds, and Rail owns no state to teach. */
function markPicks() {
  const tiles = document.querySelectorAll('#rows .tile');
  tiles.forEach((element) => {
    const tile = element as RailTileElement;
    tile.classList.toggle('picked', !!(picking && tile._item && pickIndex(tile._item) >= 0));
  });
}

function paintPicking() {
  const row = rows[pickAt];
  if (!row || row.kind !== 'list') return;
  /* A new row object rather than a renamed one: the rail repaints a label
     only when the row it is handed changes identity. */
  const renamed = rowModel.list(
    picking ? `Select to remove — ${picks.length} picked` : WATCHING,
    row.items,
  );
  renamed.focus = row.focus;
  rows[pickAt] = renamed;
  hintLine.textContent =
    '◀ ▶ move  ·  OK picks one  ·  green removes what is picked  ·  ' +
    'BACK leaves it all as it was';
  hintLine.classList.toggle('hidden', !picking);
  render();
}

function startPicking() {
  const at = watchingRowIndex();
  if (at < 0 || at !== rowIndex) {
    toast('Green clears things out of Continue watching');
    return;
  }
  if (!rows[at]?.total) {
    toast('Nothing part-watched to remove');
    return;
  }
  picking = true;
  pickAt = at;
  picks = [];
  paintPicking();
}

function stopPicking() {
  if (!picking) return;
  picking = false;
  picks = [];
  paintPicking();
}

function togglePick() {
  const item = focusedItem();
  let at;
  if (!item) return;
  at = pickIndex(item);
  if (at >= 0) picks.splice(at, 1);
  else picks.push(item);
  paintPicking();
}

/* The confirmation, in the shared menu shell — a title saying what will
   happen and to how many, the action, and Cancel. Cancel is what it lands on:
   the action is one key away and never the default. */
function askThen(count: number, action: string, run: () => void) {
  const hide = action === 'hide';
  menu.open({
    host: confirmHost,
    tabs: [
      {
        label: hide ? `Remove ${count} from Continue watching` : `Mark ${count} watched`,
        note: hide
          ? 'They stay part-watched.'
          : 'This server cannot hide them. Marking a show watched marks ' + 'every episode.',
        rows: () => {
          return [
            { label: hide ? 'Remove them' : 'Mark them watched', value: 'go' },
            { label: 'Cancel', on: true, value: null },
          ];
        },
      },
    ],
    onChoose: (value: unknown) => {
      if (value === 'go') run();
    },
    onClose: render,
  });
}

/* Marking an episode watched only advances the deck to the next episode, so
   the series stays in the row. Its show is what removes it — and marks every
   episode of it, which is why this path is confirmed in exactly those
   words. */
function watchedKey(copy: PlexItem): string {
  if (copy.type === 'episode' && copy.grandparentRatingKey) return copy.grandparentRatingKey;
  return copy.ratingKey;
}

/* Out of the row and out of the cache, so a reload does not bring it back.
   ponytail: the whole section's cached rows go rather than the one row —
   Continue watching is per account and so sits in every section's entry, and
   they are refetched on the next visit anyway. */
function dropFromDeck(entry: PlexItem) {
  const gone = identity(entry);
  deckItems = deckItems.filter((held) => identity(held) !== gone);
  sections.forEach((section) => void cached.rows.drop(section.title));
  const at = watchingRowIndex();
  const current = rows[at];
  if (at < 0 || !current) return;
  const row = rowModel.list(current.title, deckCut());
  row.focus = clamp(current.focus, 0, Math.max(0, row.total - 1));
  rows[at] = row;
}

/* A job is an entry and the copies of it still to be dealt with — a film on
   both servers is still in the row if only one of them is told, and a copy
   that has already been hidden must not then be marked watched as well. */
function jobFor(entry: PlexItem): DeckJob {
  return { entry: entry, copies: merge.sources(entry) };
}

/* The entry leaves the row only once every copy of it has gone; whatever a
   server would not hide comes back as `copies` for the caller to ask about. */
interface ClearResult {
  ok?: boolean;
  needsWatched?: boolean;
  copies?: PlexItem[];
}

function clearFromDeck(job: DeckJob, action: string): Promise<ClearResult> {
  return Promise.all(
    job.copies.map((copy) => {
      const server = servers.of(copy);
      if (!server) return Promise.resolve(false);
      if (action !== 'watched') return plexHideFromDeck(server, copy.ratingKey);
      return plexScrobble(server, watchedKey(copy)).then(() => true);
    }),
  ).then(
    (done): ClearResult => {
      const refused = job.copies.filter((_copy, at) => !done[at]);
      if (refused.length) return { needsWatched: true, copies: refused };
      dropFromDeck(job.entry);
      return { ok: true };
    },
    (error: Error): ClearResult => {
      debug(`clear: ${error.message}`);
      return { ok: false };
    },
  );
}

/* Clear a list of jobs, asking again about only the copies the server would
   not hide. A server that refuses both leaves its item in the row and says
   so. */
function clearAll(jobs: DeckJob[], action: string, after?: () => void) {
  Promise.all(
    jobs.map((job) => {
      return clearFromDeck(job, action);
    }),
  ).then((results) => {
    const again: DeckJob[] = [];
    let failed = 0;
    results.forEach((result, at) => {
      const job = jobs[at];
      if (result.ok || !job) return;
      if (result.needsWatched) again.push({ entry: job.entry, copies: result.copies ?? [] });
      else failed++;
    });
    if (picking) {
      picks = again.map((job) => job.entry);
      paintPicking();
    } else render();
    if (failed) {
      toast(`${failed}${failed === 1 ? ' was' : ' were'} refused — still in the row`);
    }
    if (again.length) {
      askThen(again.length, 'watched', () => {
        clearAll(again, 'watched', after);
      });
      return;
    }
    stopPicking();
    if (after) after();
  });
}

/* Green a second time: confirm everything picked. */
function confirmPicks() {
  const chosen = picks.map(jobFor);
  if (!chosen.length) {
    toast('Nothing picked — OK picks the tile you are on');
    return;
  }
  askThen(chosen.length, 'hide', () => {
    clearAll(chosen, 'hide');
  });
}

/* The same action for one title, from its own page. */
export function clearOne(entry: PlexItem, after?: () => void) {
  askThen(1, 'hide', () => {
    clearAll([jobFor(entry)], 'hide', after);
  });
}

/* Is this on Continue watching? The detail page only offers to clear
   something the row actually holds. */
export function isOnDeck(item: PlexItem | null | undefined): boolean {
  const wanted = item && identity(item);
  if (!wanted) return false;
  for (let i = 0; i < deckItems.length; i++) {
    if (identity(deckItems[i]) === wanted) return true;
  }
  return false;
}

function activate(choice: { kind: string; index?: number; row?: number; type?: string | null }) {
  if (choice.kind === 'search') {
    openSearch();
    return;
  }
  if (choice.kind === 'watching') {
    /* Kids and discovery have no Continue watching row, so the library comes
       back first — it lands on row 0, which is it. */
    if (mode !== 'library') loadSection(sectionIndex, true);
    else showWatching(choice.type ?? null);
    return;
  }
  if (choice.kind === 'clear') {
    /* The focus can be anywhere when this is chosen, so land on the row
       first: a mode you then have to go and find is not reachable, which is
       the whole reason this entry exists beside the green key. */
    const deckAt = watchingRowIndex();
    if (deckAt < 0) {
      toast('Nothing part-watched to remove');
      return;
    }
    rowIndex = deckAt;
    startPicking();
    return;
  }
  if (choice.kind === 'kids') {
    loadKids();
    return;
  }
  if (choice.kind === 'discover') {
    loadDiscover();
    return;
  }
  if (choice.kind === 'prefer') {
    const now = servers.get(servers.cyclePreferred() ?? undefined);
    debug(`preferring ${now ? now.name : '?'} where both servers have a film`);
    /* Rebuild the rows: which copy of a shared film is shown changes with
       the preference. */
    loadSection(sectionIndex, true);
    return;
  }
  if (choice.kind === 'autoplay') {
    Player.cycleAutoplay();
    toast(`Autoplay next: ${Player.autoplayLabel()}`);
    render();
    return;
  }
  if (choice.kind === 'theme') {
    cycleTheme();
    toast(`Theme music: ${themeLabel()}`);
    render();
    return;
  }
  if (choice.kind === 'panel') {
    message('What this panel claims it can play', panelReport());
    return;
  }
  if (choice.kind === 'devices') {
    devices.open((changed) => {
      showView('browse');
      if (changed) loadSection(sectionIndex, true);
      else render();
    });
    return;
  }
  if (choice.kind === 'row') {
    if (mode === 'library' && choice.index === sectionIndex) {
      rowIndex = clamp(choice.row ?? 0, 0, rows.length - 1);
      render();
    } else {
      loadSection(choice.index ?? 0, true, choice.row);
    }
    return;
  }
  mode = 'library';
  if (choice.index !== sectionIndex) loadSection(choice.index ?? 0, true);
  else render();
}

/* Row titles are what the sidebar lists under a section, and their positions
   are what picking one jumps to, so the two must be the same list. */
function noteCategories(section: BrowseSection) {
  cats[section.title] = rows.map((row) => row.title);
}

/* ---------- building rows ---------- */

function reset(newMode: 'library' | 'kids' | 'discover') {
  generation++;
  mode = newMode;
  rows = [];
  rowIndex = 0;
  watchingType = null;
  /* The rows the mode was over are gone, so it goes with them rather than
     counting picks nobody can see. */
  picking = false;
  picks = [];
  hintLine.classList.add('hidden');
  render();
}

/* Rows from titled item lists, remembering the part-watched ones so the
   Continue watching cut has something to filter. */
function listRows(built: { title: string; items: PlexItem[] }[]): Row[] {
  deckItems = built.find((row) => row.title === WATCHING)?.items ?? [];
  return built.map((row) => rowModel.list(row.title, row.items));
}

/* One page of one server's section, for the merge walk. */
function pageFetcher(): MergeFetch {
  return (part, offset) =>
    plexItems(part.server, part.key, offset, rowModel.PAGE, part.filter).then((page) => ({
      items: page.items,
      total: page.total,
    }));
}

function allRow(
  section: BrowseSection,
  title?: string,
  filter?: Record<string, string | number>,
  tag?: string,
): Row {
  /* type 2 asks a show section for shows rather than every episode in it. */
  const base: Record<string, string | number> = {
    type: section.type === 'show' ? 2 : 1,
    ...filter,
  };
  const parts: MergePart[] = section.parts.map((part) => ({
    server: part.server,
    key: part.key,
    updatedAt: part.updatedAt ?? 0,
    filter: base,
    tag: tag ?? '',
  }));
  return rowModel.merged(
    title || (section.type === 'show' ? 'All shows' : 'All films'),
    parts,
    pageFetcher(),
  );
}

/* A section's length, cheaply: size=0 returns totalSize and no items, once
   per server. The merged length is the sum less whatever duplicates the walk
   has found so far, so it only gets more accurate. */
function primeTotals(row: Row | undefined, isCurrent: () => boolean) {
  if (!row || row.kind !== 'merge') return;
  const jobs = row.state.streams.map((one) => {
    if (one.total) return Promise.resolve();
    const cacheKey = `${one.part.server.id}:${one.part.key}:${one.part.tag ?? ''}`;
    return cached.total
      .get(cacheKey)
      .then((hit) => {
        if (hit?.total && hit.updatedAt === one.part.updatedAt) {
          one.total = hit.total;
          return;
        }
        return plexItems(one.part.server, one.part.key, 0, 0, one.part.filter).then((page) => {
          one.total = page.total;
          void cached.total.put(cacheKey, { updatedAt: one.part.updatedAt, total: page.total });
        });
      })
      .catch((error: Error) => {
        debug(`count: ${error.message}`);
      });
  });
  Promise.all(jobs).then(() => {
    if (!isCurrent()) return;
    row.total = merge.estimate(row.state);
    render();
    debug(
      row.title +
        ': about ' +
        row.total +
        ' across ' +
        row.state.streams.length +
        ' server' +
        (row.state.streams.length === 1 ? '' : 's'),
    );
  });
}

/* focusRow lands on a named category once its section is built, which is what
   picking one out of the sidebar has to do when it belongs to another
   section. */
export function loadSection(i: number, allowFetch: boolean, focusRow?: number) {
  sectionIndex = i;
  wantRow = focusRow || 0;
  reset('library');
  const isCurrent = generationGuard();
  const section = sections[i];
  if (!section) return;
  void cached.rows
    .get(section.title)
    .then((hit) => {
      if (!isCurrent()) return;
      if (hit?.rows?.length) {
        rows = listRows(hit.rows as { title: string; items: PlexItem[] }[]);
        rows.push(allRow(section));
        noteCategories(section);
        rowIndex = clamp(wantRow, 0, rows.length - 1);
        primeTotals(rows[rows.length - 1], isCurrent);
        render();
        debug(section.title + ': rows from cache');
      }
      if (!allowFetch) return;

      /* Continue watching is per server; the category rows are per section. Two
       requests per server for the whole browse screen, however big the
       library is. */
      const reachable = serversOf(section);
      return Promise.all([
        Promise.all(reachable.map((server) => plexOnDeck(server))),
        Promise.all(section.parts.map((part) => plexHubs(part.server, part.key))),
        devices.ensureHistory(),
      ]).then((results) => {
        if (!isCurrent()) return;
        const built: { title: string; items: PlexItem[] }[] = [];

        /* onDeck is per server, not per section, and hands back films and
         episodes together — which is what you want to carry on with, so it is
         kept whole rather than cut to the section's own type. Most recently
         watched first. */
        const deck = devices.mine(merge.lists(results[0]));
        deck.sort((one, two) => (two.lastViewedAt ?? 0) - (one.lastViewedAt ?? 0));
        if (deck.length) built.push({ title: WATCHING, items: deck });

        mergeHubs(results[1]).forEach((hub) => {
          built.push(hub);
        });

        void cached.rows.put(section.title, { rows: built });
        rows = listRows(built);
        rows.push(allRow(section));
        noteCategories(section);
        rowIndex = clamp(rowIndex || wantRow, 0, rows.length - 1);
        primeTotals(rows[rows.length - 1], isCurrent);
        render();
        debug(
          `${section.title}: ${rows.length} rows from ${reachable.length} server` +
            (reachable.length === 1 ? '' : 's'),
        );
      });
    })
    .catch((error: Error) => {
      if (!isCurrent()) return;
      debug(`rows: ${error.message}`);
      if (!rows.length) toast('Could not reach the servers');
    });
}

/* Both servers offer a "Recently Added"; they are one row, deduplicated.
   Order within it is first-seen, which keeps each server's own ordering
   intact rather than inventing a ranking across them. */
function mergeHubs(perPart: PlexHub[][]): { title: string; items: PlexItem[] }[] {
  const byTitle: Record<string, PlexItem[][]> = {};
  const order: string[] = [];
  perPart.forEach((hubs) => {
    hubs.forEach((hub) => {
      if (!byTitle[hub.title]) {
        byTitle[hub.title] = [];
        order.push(hub.title);
      }
      byTitle[hub.title]?.push(hub.items);
    });
  });
  return order
    .map((title) => ({ title, items: merge.lists(byTitle[title] ?? []) }))
    .filter((hub) => hub.items.length > 0);
}

/* ---------- walking the merge ---------- */

/* Debounced: scrolling through twenty screens must not fire twenty walks,
   only one for wherever you come to rest. */
function scheduleWalk() {
  if (pageTimer) clearTimeout(pageTimer);
  pageTimer = setTimeout(() => {
    const row = focusedRow();
    if (!row || row.kind !== 'merge') return;
    if (rowModel.haveUpTo(row) > rowModel.needsUpTo(row)) return;
    const isCurrent = generationGuard();
    const had = rowModel.haveUpTo(row);
    const was = row.total;
    merge
      .advance(row.state, rowModel.needsUpTo(row))
      .then(() => {
        if (!isCurrent()) return;
        row.total = merge.estimate(row.state);
        /* Only repaint if the walk actually produced something, or this would
         schedule itself for ever once the servers are exhausted. */
        if (rowModel.haveUpTo(row) === had && row.total === was) return;
        rail.invalidateEmpty();
        render();
      })
      .catch((error: Error) => {
        if (!isCurrent()) return;
        debug(`walk: ${error.message}`);
      });
  }, 150);
}

/* ---------- kids ---------- */

function loadKids() {
  const section = sections[sectionIndex];
  if (!section) return;
  reset('kids');
  const isCurrent = generationGuard();

  /* Ask each library which certificates it uses, keep the ones at or below
     the cutoff, and let the servers do the filtering. */
  Promise.all(
    section.parts.map((part) => {
      return plexContentRatings(part.server, part.key);
    }),
  )
    .then((perPart) => {
      if (!isCurrent()) return;
      const kid: string[] = [];
      const seen: Record<string, true> = {};
      perPart.forEach((list) => {
        list
          .filter((rating) => isKidsRating(rating))
          .forEach((rating) => {
            if (seen[rating]) return;
            seen[rating] = true;
            kid.push(rating);
          });
      });
      debug(`kids certificates: ${kid.join(', ') || 'none'}`);

      const reachable = serversOf(section);
      return Promise.all([
        Promise.all(reachable.map((server) => plexOnDeck(server))),
        devices.ensureHistory(),
      ]).then((results) => {
        if (!isCurrent()) return;
        const kidsWant = section.type === 'show' ? 'episode' : 'movie';
        const watching = devices.mine(merge.lists(results[0])).filter((entry) => {
          return entry.type === kidsWant && isKidsRating(entry.contentRating);
        });
        rows = [];
        if (watching.length) rows.push(rowModel.list('Kids · carry on watching', watching));

        if (kid.length) {
          const row = allRow(
            section,
            'Kids · all films',
            { contentRating: kid.join(',') },
            `kids${KIDS_MAX_AGE}`,
          );
          rows.push(row);
          render();
          primeTotals(row, isCurrent);
          return;
        }
        render();
        if (!watching.length) {
          message(
            'No age ratings',
            section.title +
              ' has no certificate data, so ' +
              'there is nothing to filter on. BACK to return.',
          );
        }
      });
    })
    .catch((error: Error) => {
      if (!isCurrent()) return;
      debug(`kids: ${error.message}`);
      toast('Could not load the kids list');
    });
}

/* ---------- discovery ---------- */

/* A Discovery tile is looked up on the servers only once you have stopped on
   it, on the same stillness the backdrop waits for — so sweeping a row costs
   nothing and painting the page costs nothing at all. */
function scheduleResolve(item: PlexItem) {
  if (resolveTimer) clearTimeout(resolveTimer);
  const entry = item as DiscoveryEntry;
  if (!discovery.isEntry(item) || entry._resolved !== undefined) return;
  const mine = generation;
  resolveTimer = setTimeout(() => {
    void discovery.resolve(entry).then(() => {
      if (mine === generation && focusedItem() === item) render();
    });
  }, RESOLVE_HOLD);
}

/* Seeds for the recommended row, out of the Continue watching row already in
   memory. Asking a server for them would cost the page its whole point. */
function deckSeeds() {
  const out = [];
  for (let i = 0; i < deckItems.length && out.length < MAX_SEEDS; i++) {
    const id = plexTmdbId(deckItems[i]);
    if (id && out.indexOf(id) < 0) out.push(id);
  }
  return out;
}

function loadDiscover() {
  reset('discover');
  const isCurrent = generationGuard();

  if (!discovery.enabled()) {
    mode = 'library';
    message(
      'Discovery needs a TMDB key',
      'Curated rows come from TMDB. Put a free v3 API key in tmdbKey in ' +
        'js/config.js. Everything else works without it.',
    );
    return;
  }

  discovery
    .load({
      isCurrent: isCurrent,
      seeds: deckSeeds(),
      /* Rows appear as they arrive rather than all at the end — the first one
       lands while the rest are still being fetched. */
      add: (title, items) => {
        rows.push(rowModel.list(title, items));
        render();
      },
    })
    .then(() => {
      if (!isCurrent() || rows.length) return;
      message(
        'Nothing to show',
        'TMDB returned no titles for any of the categories in js/config.js. ' +
          'Check the debug line for which came back empty.',
      );
    });
}

function leaveMode() {
  if (mode === 'library') return false;
  loadSection(sectionIndex, true);
  return true;
}

/* ---------- search ---------- */

function openSearch() {
  showView('search');
  searchInput.value = '';
  /* webOS raises its own on-screen keyboard when an input takes focus —
     no need to build a letter grid. */
  setTimeout(() => {
    searchInput.focus();
  }, 50);
}

function closeSearch() {
  searchInput.blur();
  showView('browse');
  render();
}

/* Results land on their own page, not back on the library rows — laid out as
   a grid of RESULTS_PER_ROW using the same row machinery. Both servers are
   asked, and a film on both appears once. */
function runSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    closeSearch();
    return;
  }
  searchInput.blur();
  showView('browse');
  toast('Searching…');
  const isCurrent = generationGuard();
  Promise.all(
    servers.all().map((server) => {
      return plexSearch(server, query);
    }),
  )
    .then((perServer) => {
      if (!isCurrent()) return;
      const found = merge.lists(perServer);
      if (!savedRows) savedRows = rows;
      searchQuery = query;
      const noun = countNoun(found);
      /* The results page has no chips to head it any more, so the first row's
       own title carries what was asked, what came back, and the way out. */
      const header = query + '  ·  ' + found.length + ' ' + noun + '  ·  BACK to library';
      rows = [];
      for (let i = 0; i < found.length; i += RESULTS_PER_ROW) {
        rows.push(rowModel.list(i === 0 ? header : '', found.slice(i, i + RESULTS_PER_ROW)));
      }
      if (!rows.length) rows = [rowModel.list(header, [])];
      rowIndex = 0;
      render();
      debug(`search "${query}": ${found.length} ${noun}`);
    })
    .catch((error: Error) => {
      message('Search failed', error.message);
    });
}

/* "3 films", "1 show", or "7 results" when it is both. Saying "films" over a
   list that is half shows is the kind of small lie that makes a screen feel
   untrustworthy. */
function countNoun(found: PlexItem[]): string {
  const shows = found.filter((item) => item.type === 'show').length;
  const films = found.length - shows;
  if (shows && films) return 'results';
  if (shows) return `show${shows === 1 ? '' : 's'}`;
  return `film${films === 1 ? '' : 's'}`;
}

/* Back out of a results list to the rows we parked. */
function clearResults() {
  if (!savedRows) return false;
  rows = savedRows;
  savedRows = null;
  searchQuery = null;
  rowIndex = 0;
  render();
  return true;
}

/* ---------- keys ---------- */

/* The search view: the system keyboard owns every key, OK included — pressing
   OK picks a letter. Only Back is ours; Enter is handled on the input. */
export function searchKey(code: number): boolean {
  if (isBack(code)) {
    closeSearch();
    return true;
  }
  return false;
}

export function key(code: number): boolean {
  if (menu.isOpen()) return menu.key(code);
  if (sidebar.isOpen()) return sidebar.key(code);

  let row = focusedRow();
  const K = KEY;

  switch (code) {
    case K.LEFT:
      /* Left off the front of a row is the way to the sections — there is
         nowhere else for it to go, and the rail has no header any more.
         Not while picking: the way out of the mode is BACK, not wandering. */
      if (row && row.focus > 0) {
        row.focus--;
        render();
      } else if (!picking) openSidebar();
      break;
    case K.RIGHT:
      if (row && row.focus < row.total - 1) {
        row.focus++;
        render();
      }
      break;
    case K.UP:
      if (!picking && rowIndex > 0) {
        rowIndex--;
        render();
      }
      break;
    case K.DOWN:
      if (!picking && rowIndex < rows.length - 1) {
        rowIndex++;
        render();
      }
      break;
    case K.OK:
      if (picking) {
        togglePick();
        break;
      }
      {
        const chosen = focusedItem();
        if (chosen && options.onOpen) options.onOpen(chosen);
      }
      break;
    case K.RED: // red, on remotes that have it
      openSearch();
      break;
    case GREEN: // enter the mode, then confirm it
      if (picking) confirmPicks();
      else startPicking();
      break;
    default:
      if (!isBack(code)) return false;
      if (picking) {
        stopPicking();
        break;
      }
      if (!clearResults() && !leaveMode()) options.onExit?.();
      break;
  }
  return true;
}
