'use strict';
/* eslint-disable no-await-in-loop -- key presses and polls are sequential by nature */
/* Movies and TV: the board's rows from TMDB, and no server hub */
module.exports = function (h) {
  const { page, press, step, trace, hubCalls, cachedRows } = h;

  const assertEqual = (got, want, what) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      throw new Error(what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
    }
  };

  /* The menu's way to a page: Up from the first row, along to the tile, and Down. */
  async function openTile(label) {
    await h.topRow();
    await press('ArrowUp');
    for (let i = 0; i < 12; i++) {
      const on = await page.evaluate('document.querySelector("#menubar .mb-tile.on").textContent');
      if (on === label) break;
      await press('ArrowRight');
    }
    await press('ArrowDown');
  }

  async function landed(last, from) {
    const done = new RegExp(last + ': \\d+ from TMDB');
    for (let i = 0; i < 200; i++) {
      if (trace.slice(from).some((line) => done.test(line))) return;
      await page.waitForTimeout(100);
    }
    throw new Error('the rows never reached ' + last);
  }

  /* Every row top to bottom: its label, its tile count, and its items' types. */
  async function walk() {
    await h.topRow();
    const seen = [];
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(150);
      const row = await page.evaluate(function () {
        const el = document.querySelector('#rows .row.on');
        return {
          label: el.querySelector('.row-label').textContent.trim(),
          tiles: el.querySelectorAll('.tile:not(.hidden)').length,
          types: el._rowRef.items.map(function (m) {
            return m.type;
          }),
        };
      });
      if (seen.length && seen[seen.length - 1].label === row.label) break;
      seen.push(row);
      await press('ArrowDown');
    }
    return seen;
  }

  const SERVICES = ['Netflix', 'Prime Video', 'Apple TV+', 'Disney+'].map(
    (name) => 'Popular on ' + name,
  );
  const top = (names) => names.map((name) => 'Top ' + name);

  let deck;
  let hubsAfterHome;

  return h
    .ready()

    .then(function () {
      return step('Home asks the servers for hubs, so the hub counter counts', async function () {
        const before = hubCalls.length;
        deck = await h.reloadDeck();
        hubsAfterHome = hubCalls.length;
        assertEqual(hubsAfterHome > before, true, 'hub requests made by Home');
        assertEqual(
          deck.entries.some((e) => e.type === 'movie') &&
            deck.entries.some((e) => e.type === 'episode'),
          true,
          'the deck holds a film and an episode',
        );
      });
    })

    .then(function () {
      return step(
        "Movies is the board's thirteen TMDB rows, a Top 10 of ten, and no hub",
        async function () {
          const rowsBefore = await cachedRows('Movies');
          assertEqual(rowsBefore === 'no database', false, 'the cache is readable');
          const from = trace.length;
          await openTile('Movies');
          await landed('Top documentaries', from);
          const seen = await walk();
          const seed = deck.entries.find((e) => e.type === 'movie').title;
          assertEqual(
            seen.map((r) => r.label),
            [
              'Trending this week',
              'Top 10 today',
              'Because you watched ' + seed,
              ...SERVICES,
              ...top(['thrillers', 'sci-fi', 'comedies', 'action', 'horror', 'documentaries']),
            ],
            'the Movies rows',
          );
          seen.forEach((row) => assertEqual(row.tiles > 0, true, row.label + ' has tiles'));
          assertEqual(seen[1].tiles, 10, 'the Top 10 tiles');
          assertEqual(hubCalls.slice(hubsAfterHome), [], 'hub requests made by Movies');
          assertEqual(await cachedRows('Movies'), rowsBefore, 'rows:Movies after the page');
        },
      );
    })

    .then(function () {
      return step(
        "TV is the board's fourteen rows with Your next episodes third, and no hub",
        async function () {
          const rowsBefore = await cachedRows('TV Shows');
          const from = trace.length;
          await openTile('TV');
          await landed('Top animation', from);
          const seen = await walk();
          const episodes = deck.entries.filter((e) => e.type === 'episode');
          assertEqual(episodes.length > 0, true, 'the deck holds episodes');
          assertEqual(
            seen.map((r) => r.label),
            [
              'Trending this week',
              'Top 10 today',
              'Your next episodes',
              'Because you watched ' + episodes[0].title,
              ...SERVICES,
              ...top([
                'crime',
                'sci-fi & fantasy',
                'comedies',
                'dramas',
                'documentaries',
                'animation',
              ]),
            ],
            'the TV rows',
          );
          assertEqual(seen[1].tiles, 10, 'the Top 10 tiles');
          assertEqual(
            seen[2].types,
            episodes.map(() => 'episode'),
            "Your next episodes are the deck's episodes",
          );
          assertEqual(hubCalls.slice(hubsAfterHome), [], 'hub requests made by TV');
          assertEqual(await cachedRows('TV Shows'), rowsBefore, 'rows:TV Shows after the page');
        },
      );
    })

    .then(function () {
      return step(
        'an empty deck leaves out Because you watched and Your next episodes',
        async function () {
          const noDeck = (route) =>
            route.fulfill({
              contentType: 'application/json',
              body: JSON.stringify({ MediaContainer: { size: 0, Metadata: [] } }),
            });
          await page.route(/\/library\/onDeck/, noDeck);
          await page.reload();
          await h.ready();
          let from = trace.length;
          await openTile('Movies');
          await landed('Top documentaries', from);
          const movies = (await walk()).map((r) => r.label);
          assertEqual(movies.length, 12, 'the Movies rows without a seed: ' + movies);
          assertEqual(
            movies.some((label) => label.startsWith('Because')),
            false,
            'no Because row',
          );
          from = trace.length;
          await openTile('TV');
          await landed('Top animation', from);
          const tv = (await walk()).map((r) => r.label);
          assertEqual(tv.length, 12, 'the TV rows without a deck: ' + tv);
          assertEqual(
            tv.slice(0, 3),
            ['Trending this week', 'Top 10 today', 'Popular on Netflix'],
            'TV starts',
          );
          await page.unroute(/\/library\/onDeck/, noDeck);
        },
      );
    });
};
