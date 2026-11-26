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

  const near = (got, want, what) => {
    if (Math.abs(got - want) > 1) throw new Error(what + ': got ' + got + ', wanted ' + want);
  };
  const nearAll = (got, want, what) =>
    want.forEach((w, i) => near(got[i], w, what + ' [' + i + ']'));

  async function waitForRows(label) {
    for (let i = 0; i < 100; i++) {
      const has = await page.evaluate(
        'Array.prototype.some.call(document.querySelectorAll("#rows .row-label"), function (l) { return l.textContent === ' +
          JSON.stringify(label) +
          '; })',
      );
      if (has) return;
      await page.waitForTimeout(100);
    }
    throw new Error('no row ' + label);
  }

  /* The focused row and the one under it, once every transition has finished. */
  async function board() {
    await page.waitForTimeout(700);
    return page.evaluate(function () {
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 10) / 10);
      };
      const label = (row) => {
        const el = row._label;
        const s = getComputedStyle(el);
        const after = getComputedStyle(el, '::after');
        return {
          rect: rect(el),
          font: [
            s.fontSize,
            s.fontWeight,
            s.fontFamily.indexOf('Space Grotesk') !== -1,
            s.color,
            s.opacity,
          ],
          sub: [after.fontSize, after.color, after.content],
        };
      };
      const tiles = (row) =>
        row._tiles.filter((t) => !t.classList.contains('hidden')).sort((a, b) => a._idx - b._idx);
      const numeral = (t) => {
        const s = getComputedStyle(t._rank);
        return {
          rank: t._rank.textContent,
          numeral: rect(t._rank),
          poster: rect(t.querySelector('.tile-inner')),
          style: [
            s.fontSize,
            s.lineHeight,
            s.fontWeight,
            s.fontFamily.indexOf('Space Grotesk') !== -1,
            s.color,
            s.webkitTextStrokeWidth,
            s.webkitTextStrokeColor,
            s.textAlign,
          ],
          committed:
            96 +
            parseFloat(t.parentNode.style.getPropertyValue('--tx')) +
            parseFloat(t.style.getPropertyValue('--tx')),
        };
      };
      const on = document.querySelector('#rows .row.on');
      const peek = Array.prototype.filter.call(
        document.querySelectorAll('#rows .row'),
        (r) => r._row === on._row + 1,
      )[0];
      const mine = tiles(on);
      const focusedTile = on.querySelector('.tile.on');
      const rest = mine.filter((t) => t !== focusedTile && t._idx > focusedTile._idx);
      return {
        dense: document.getElementById('browse').classList.contains('dense'),
        label: label(on),
        peekLabel: peek ? label(peek) : null,
        focused: rect(focusedTile.querySelector('.tile-inner')),
        focusedRank: numeral(focusedTile),
        rest: rest.map((t) => rect(t.querySelector('.tile-inner'))),
        stride:
          parseFloat(mine[1].style.getPropertyValue('--tx')) -
          parseFloat(mine[0].style.getPropertyValue('--tx')),
        ranks: mine.map((t) => t._rank.textContent),
        titles: getComputedStyle(focusedTile.querySelector('.tile-title')).display,
        peek: peek ? tiles(peek).map(numeral) : [],
        pool: [
          document.querySelectorAll('#rows .row').length,
          document.querySelectorAll('#rows .tile').length,
        ],
      };
    });
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
        'Movies draws the board: Trending over a ranked peek, at its rects and styles',
        async function () {
          await openTile('Movies');
          await waitForRows('Top 10 today');
          await h.topRow();
          const at = await board();
          assertEqual(at.dense, false, '#browse.dense on Movies');
          near(at.label.rect[1], 520, 'the focused row label top');
          assertEqual(at.label.font, ['30px', '700', true, 'rgb(255, 255, 255)', '1'], 'the label');
          assertEqual(
            at.label.sub,
            ['24px', 'rgba(255, 255, 255, 0.55)', '"Updated daily"'],
            'its sub',
          );
          near(at.peekLabel.rect[1], 928, 'the peek label top');
          assertEqual(at.peekLabel.font[4], '0.6', 'the peek label opacity');
          assertEqual(at.peekLabel.sub[2], '"Most watched in your region"', 'the peek sub');
          const x = at.focusedRank.committed;
          nearAll(at.focused, [x, 570, 210, 315], 'the focused poster');
          nearAll(at.rest[0], [x + 216 + 34, 621, 176, 264], 'the poster after it');
          assertEqual(at.rest[1][0] - at.rest[0][0], 216, 'the plain stride');
          assertEqual(at.titles, 'none', 'the titles under the posters');
          at.peek.slice(0, 4).forEach((r, i) => {
            nearAll(r.poster, [246 + 366 * i, 972, 176, 264], 'ranked poster ' + (i + 1));
            assertEqual(r.rank, String(i + 1), 'ranked numeral ' + (i + 1));
            near(r.numeral[0], 96 + 366 * i, 'numeral ' + (i + 1) + ' left');
            near(r.numeral[2], 170, 'numeral width');
            near(r.numeral[1] + r.numeral[3], 972 + 264, 'numeral ' + (i + 1) + ' bottom');
          });
          assertEqual(
            at.peek[0].style,
            [
              '260px',
              '197.6px',
              '700',
              true,
              'rgba(255, 255, 255, 0.06)',
              '4px',
              'rgba(255, 255, 255, 0.7)',
              'right',
            ],
            'a resting numeral',
          );
        },
      );
    })

    .then(function () {
      return step(
        'the Top 10 draws 1 to 10 and walking right reaches 10 on screen',
        async function () {
          await press('ArrowDown');
          let at = await board();
          assertEqual(
            at.ranks,
            ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
            'the numerals',
          );
          near(at.label.rect[1], 520, 'the Top 10 label top');
          nearAll(at.focused, [246, 570, 210, 315], 'rank 1 focused');
          near(at.rest[0][0], 246 + 366 + 34, 'rank 2 poster left');
          assertEqual(
            at.focusedRank.style,
            [
              '260px',
              '197.6px',
              '700',
              true,
              'rgba(255, 255, 255, 0.14)',
              '4px',
              'rgba(255, 255, 255, 0.95)',
              'right',
            ],
            'the focused numeral',
          );
          near(at.focusedRank.numeral[3], 300 * 0.76, 'the focused numeral height');
          near(
            at.focusedRank.numeral[1] + at.focusedRank.numeral[3],
            885,
            'the focused numeral bottom',
          );
          near(at.peekLabel.rect[1], 928, 'the peek label under the Top 10');
          at.peek
            .slice(0, 4)
            .forEach((r, i) =>
              nearAll(r.poster, [96 + 216 * i, 972, 176, 264], 'peek poster ' + i),
            );
          await press('ArrowRight', 10);
          at = await board();
          assertEqual(at.focusedRank.rank, '10', 'the focused numeral after ten rights');
          const x = at.focusedRank.committed;
          assertEqual(x - 150 >= 0 && x + 176 <= 1920, true, 'rank 10 inside the viewport at ' + x);
          assertEqual(x, 246 + 4 * 366, 'rank 10 in the fifth place');
        },
      );
    })

    .then(function () {
      return step(
        'Movies and TV never go dense and step 216; Home does and steps 202',
        async function () {
          await press('ArrowDown', 2);
          let at = await board();
          assertEqual([at.dense, at.stride], [false, 216], 'Movies row 3: dense, stride');
          await openTile('TV');
          await waitForRows('Top 10 today');
          await h.topRow();
          await press('ArrowDown', 3);
          at = await board();
          assertEqual([at.dense, at.stride], [false, 216], 'TV row 4: dense, stride');
          await openTile('Home');
          await h.topRow();
          await press('ArrowDown', 3);
          at = await board();
          assertEqual([at.dense, at.stride], [true, 202], 'Home row 4: dense, stride');
          assertEqual(at.pool, [4, 48], 'the pool: rows, tiles');
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
              body: JSON.stringify({
                MediaContainer: { size: 0, Metadata: [] },
              }),
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
