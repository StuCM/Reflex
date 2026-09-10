/* Two servers, one library, and the question "is that the same film?".

   Getting this wrong shows the same film twice, or — worse — collapses two
   different films into one entry and plays the wrong thing. Run:
     node test/merge.test.js */
import assert from 'node:assert';
import { test } from 'vitest';
import { Media, Merge, Servers } from './modules';

test('merge across servers', () => {
  var MAIN = { id: 'srv-main', name: 'Main', base: 'http://main', token: 'a' };
  var BACKUP = { id: 'srv-backup', name: 'Backup', base: 'http://backup', token: 'b' };
  Servers.set([MAIN, BACKUP]);

  function film(server, opts) {
    var m = {
      ratingKey: opts.key,
      _server: server.id,
      title: opts.title,
      titleSort: opts.title,
      year: opts.year,
    };
    if (opts.imdb) m.Guid = [{ id: 'imdb://' + opts.imdb }];
    if (opts.tmdb) m.Guid = (m.Guid || []).concat([{ id: 'tmdb://' + opts.tmdb }]);
    if (opts.plex) m.guid = 'plex://movie/' + opts.plex;
    if (opts.legacy) m.guid = 'com.plexapp.agents.imdb://' + opts.legacy + '?lang=en';
    if (opts.viewOffset) m.viewOffset = opts.viewOffset;
    return m;
  }

  /* ---- identity ---- */

  // The same film on two servers, matched on the id Plex itself syncs against.
  var a = film(MAIN, { key: '1', title: 'Amber Anchor', year: 1999, imdb: 'tt001' });
  var b = film(BACKUP, { key: '900', title: 'Amber Anchor', year: 1999, imdb: 'tt001' });
  assert.strictEqual(Media.identity(a), Media.identity(b));

  // One server on the modern agent, the other still on the legacy one.
  var legacy = film(BACKUP, { key: '901', title: 'Amber Anchor', year: 1999, legacy: 'tt001' });
  assert.ok(
    Media.identities(legacy).indexOf('imdb://tt001') >= 0,
    'the legacy agent form must yield the same imdb key',
  );

  // No external ids at all: title and year, normalised.
  var bare1 = film(MAIN, { key: '2', title: 'The Cold Ferry', year: 1988 });
  var bare2 = film(BACKUP, { key: '902', title: 'Cold Ferry', year: 1988 });
  assert.strictEqual(
    Media.identity(bare1),
    Media.identity(bare2),
    'a leading "The" must not make it a different film',
  );

  // Different films must not collide.
  var other = film(MAIN, { key: '3', title: 'Amber Anchor', year: 2014, imdb: 'tt999' });
  assert.notStrictEqual(Media.identity(a), Media.identity(other));

  // Unrated, untitled nonsense still produces a key rather than throwing.
  assert.ok(Media.identity({}));

  /* ---- merging lists ---- */

  Servers.setPreferred(MAIN.id);

  var merged = Merge.lists([
    [
      film(MAIN, { key: '1', title: 'Amber Anchor', year: 1999, imdb: 'tt001' }),
      film(MAIN, { key: '2', title: 'Blue Bridge', year: 2001, imdb: 'tt002' }),
    ],
    [
      film(BACKUP, { key: '900', title: 'Amber Anchor', year: 1999, imdb: 'tt001' }),
      film(BACKUP, { key: '903', title: 'Cold Ferry', year: 1988, imdb: 'tt003' }),
    ],
  ]);

  assert.strictEqual(merged.length, 3, 'the shared film appears once');
  assert.strictEqual(Merge.sources(merged[0]).length, 2, 'and carries both copies');
  assert.strictEqual(Merge.isShared(merged[0]), true);
  assert.strictEqual(Merge.isShared(merged[1]), false, 'a film only one server has is not shared');
  assert.strictEqual(merged[2].title, 'Cold Ferry', 'a film only the second server has is added');

  // The entry is SHOWN as the preferred server's copy.
  assert.strictEqual(merged[0]._server, MAIN.id);

  /* ---- the preference decides which copy is on show ---- */

  Servers.setPreferred(BACKUP.id);
  var flipped = Merge.lists([
    [film(MAIN, { key: '1', title: 'Amber Anchor', year: 1999, imdb: 'tt001' })],
    [film(BACKUP, { key: '900', title: 'Amber Anchor', year: 1999, imdb: 'tt001' })],
  ]);
  assert.strictEqual(flipped.length, 1);
  assert.strictEqual(flipped[0]._server, BACKUP.id, "the preferred server's copy is the one shown");
  assert.strictEqual(flipped[0].ratingKey, '900');
  // The other copy is still reachable — that is what the detail page offers.
  assert.strictEqual(Merge.sources(flipped[0])[1]._server, MAIN.id);

  // A cycle would be written to IndexedDB and is not allowed.
  assert.ok(
    Merge.sources(flipped[0])[1]._sources === undefined ||
      Merge.sources(flipped[0])[1]._sources === null,
    'the demoted copy must not carry its own sources list',
  );

  /* ---- resume position ---- */

  Servers.setPreferred(MAIN.id);
  var resumed = Merge.lists([
    [film(MAIN, { key: '1', title: 'Amber Anchor', year: 1999, imdb: 'tt001' })],
    [
      film(BACKUP, {
        key: '900',
        title: 'Amber Anchor',
        year: 1999,
        imdb: 'tt001',
        viewOffset: 900000,
      }),
    ],
  ]);
  assert.strictEqual(
    resumed[0].viewOffset,
    900000,
    'the furthest-watched position wins, whichever server holds it',
  );

  /* ---- a copy is a library, not a server ---- */

  /* One Movies section spans every movie library on every server, so the same
     film in a 4K library and an LQ one on ONE server is two copies that play
     differently — and the detail page has to be able to offer both. */
  function inPart(server, part, opts) {
    var m = film(server, opts);
    m._part = part;
    return m;
  }

  var twoLibraries = Merge.lists([
    [
      inPart(MAIN, '1', { key: '10', title: 'Amber Anchor', year: 1999, imdb: 'tt001' }),
      inPart(MAIN, '2', { key: '11', title: 'Amber Anchor', year: 1999, imdb: 'tt001' }),
    ],
  ]);
  assert.strictEqual(twoLibraries.length, 1, 'one film, however many libraries hold it');
  assert.strictEqual(
    Merge.sources(twoLibraries[0]).length,
    2,
    "both of one server's copies are kept",
  );
  assert.strictEqual(Merge.sources(twoLibraries[0])[1].ratingKey, '11');

  // The same library twice is the same copy, not a second one.
  var sameLibrary = Merge.lists([
    [
      inPart(MAIN, '1', { key: '10', title: 'Amber Anchor', year: 1999, imdb: 'tt001' }),
      inPart(MAIN, '1', { key: '12', title: 'Amber Anchor', year: 1999, imdb: 'tt001' }),
    ],
  ]);
  assert.strictEqual(
    Merge.sources(sameLibrary[0]).length,
    1,
    'two editions in one library are not two copies',
  );

  // One library, one copy: no phantom duplicate.
  var oneLibrary = Merge.lists([
    [inPart(MAIN, '1', { key: '10', title: 'Amber Anchor', year: 1999, imdb: 'tt001' })],
  ]);
  assert.strictEqual(Merge.sources(oneLibrary[0]).length, 1);

  /* onDeck and the hubs have no libraries to name, so their items carry no part
     and must go on folding per server exactly as they did. */
  var noParts = Merge.lists([
    [
      film(MAIN, { key: '10', title: 'Amber Anchor', year: 1999, imdb: 'tt001' }),
      film(MAIN, { key: '11', title: 'Amber Anchor', year: 1999, imdb: 'tt001' }),
    ],
    [film(BACKUP, { key: '900', title: 'Amber Anchor', year: 1999, imdb: 'tt001' })],
  ]);
  assert.strictEqual(noParts.length, 1);
  assert.strictEqual(
    Merge.sources(noParts[0]).length,
    2,
    'partless items still fold to one copy per server',
  );

  /* ---- the streaming merge ---- */

  /* Two servers, each with its own sorted slice of the same library, handed out
     a page at a time — the shape the All films row actually sees. */
  function pageServer(server, titles) {
    var items = titles.map(function (t, i) {
      return film(server, {
        key: server.id + '-' + i,
        title: t,
        year: 2000,
        imdb: 'tt-' + t.toLowerCase().replace(/\W/g, ''),
      });
    });
    return function (offset, size) {
      return { items: items.slice(offset, offset + size), total: items.length };
    };
  }

  var mainPages = pageServer(MAIN, ['Anchor', 'Bridge', 'Ferry', 'Garden', 'Harbour']);
  /* Main's second movie library, holding 4K remuxes of two films it also has at
     1080 — the same server twice, which the walk has to keep apart. */
  var mainUhdPages = pageServer(MAIN, ['Bridge', 'Garden']);
  var backupPages = pageServer(BACKUP, ['Bridge', 'Ferry', 'Ladder', 'Motel']);
  var requests = 0;

  var state = Merge.stream(
    [
      { server: MAIN, key: '1' },
      { server: MAIN, key: '2' },
      { server: BACKUP, key: '1' },
    ],
    function (part, offset) {
      requests++;
      var pages =
        part.server === BACKUP ? backupPages : part.key === '2' ? mainUhdPages : mainPages;
      return Promise.resolve(pages(offset, 2)); // deliberately small pages
    },
  );

  Merge.advance(state, 0)
    .then(function () {
      var out = Merge.items(state);
      assert.strictEqual(out[0].title, 'Anchor', 'the merge is in title order across servers');
      return Merge.advance(state, 100); // past the end: walks everything
    })
    .then(function () {
      var out = Merge.items(state);
      /* Joined, not deepStrictEqual: these arrays are built inside the sandbox and
       so have a different Array.prototype, which strict deep equality rejects. */
      var titles = out
        .map(function (m) {
          return m.title;
        })
        .join(',');
      assert.strictEqual(
        titles,
        'Anchor,Bridge,Ferry,Garden,Harbour,Ladder,Motel',
        'every film once, in order, from both servers',
      );

      // Every library holding a film is a copy of it, the same server's included.
      function copiesOf(entry) {
        return Merge.sources(entry)
          .map(function (c) {
            return c._server + '/' + c._part;
          })
          .sort()
          .join(' ');
      }
      assert.strictEqual(
        copiesOf(out[1]),
        'srv-backup/1 srv-main/1 srv-main/2',
        "Bridge is in both of Main's libraries and on Backup",
      );
      assert.strictEqual(
        copiesOf(out[3]),
        'srv-main/1 srv-main/2',
        "Garden is in both of Main's libraries and nowhere else",
      );
      assert.strictEqual(Merge.sources(out[2]).length, 2, 'Ferry is on both servers');
      assert.strictEqual(copiesOf(out[0]), 'srv-main/1', 'Anchor is in one library only');

      // 11 copies, 7 films: the estimate has corrected itself as duplicates appeared.
      assert.strictEqual(Merge.estimate(state), 7);

      // Nothing was crawled: pages of 2 over 11 items, and not one request more.
      assert.ok(requests <= 10, 'walked in pages, not in one crawl (' + requests + ' requests)');

      /* Slimmed entries keep what the rail and masthead draw, and drop the rest —
       a 30k walk holds 30k of these. Guid is the one costly field that stays:
       without it a film walked into this row has no TMDB id, so it gets neither
       a backdrop of its own nor a place in the merge by identity. */
      assert.ok(out[0].title && out[0].ratingKey && out[0]._server);
      assert.strictEqual(out[0]._part, '1', 'the library a copy came from survives slim()');
      assert.strictEqual(out[0].Guid[0].id, 'imdb://tt-anchor', 'the Guid array is kept');
      assert.strictEqual(out[0].Media, undefined, 'a film with no Media gains none');

      console.log('merge across servers: all assertions passed');
    })
    .catch(function (e) {
      console.error((e && e.stack) || e);
      process.exit(1);
    });
});
