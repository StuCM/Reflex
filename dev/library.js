/* Two synthetic Plex servers, generated deterministically.
   Runs on Node only — the Chromium 53 constraint does not apply in dev/.

   The point is not realistic titles, it is realistic *shapes*: enough items to
   make the windowed rail work for its living, a spread of media profiles that
   reaches every branch of the playback guard, and — since the real account has
   two servers sharing much of the same library — overlap.

   Films and shows exist in canonical lists. Each server holds a subset:

     - most are on Main
     - a third are on both, with DIFFERENT media on each (that is the whole
       point of choosing a source: one copy direct plays, the other doesn't)
     - some are only on Backup, so merging has to add as well as deduplicate

   Identity is the same on both servers — same plex:// guid, same title, same
   year — because that is what Plex itself syncs watch state against, and
   therefore what the app deduplicates on.

   Shows carry the same idea one level down: a show is on both servers, its
   episodes have the same season and episode numbers, and the media differs per
   server. An episode is the thing that plays, so it is the thing that gets a
   verdict. */
'use strict';

const ADJECTIVES = [
  'Absent', 'Amber', 'Ancient', 'Bitter', 'Blue', 'Broken', 'Careless',
  'Certain', 'Cold', 'Crimson', 'Distant', 'Eastern', 'Empty', 'Endless',
  'Faint', 'Final', 'Golden', 'Grey', 'Hidden', 'Hollow', 'Idle', 'Iron',
  'Kindly', 'Last', 'Level', 'Lonely', 'Long', 'Loud', 'Narrow', 'Northern',
  'Open', 'Patient', 'Quiet', 'Rapid', 'Roman', 'Salt', 'Second', 'Silent',
  'Slow', 'Small', 'Southern', 'Sudden', 'Tall', 'Third', 'Tidal', 'Uneasy',
  'Vacant', 'Warm', 'Western', 'Winter', 'Yellow'
];

const NOUNS = [
  'Anchor', 'Argument', 'Bridge', 'Cargo', 'Circuit', 'Coast', 'Compass',
  'Corridor', 'Crossing', 'Current', 'Dispatch', 'Engine', 'Estate', 'Ferry',
  'Garden', 'Harbour', 'Highway', 'Hotel', 'Inventory', 'Junction', 'Ladder',
  'Lantern', 'Letter', 'Machine', 'Meridian', 'Motel', 'Orchard', 'Passage',
  'Pattern', 'Pier', 'Quarry', 'Radio', 'Railway', 'Reservoir', 'Signal',
  'Station', 'Summer', 'Terminal', 'Tower', 'Traveller', 'Tunnel', 'Valley',
  'Verdict', 'Village', 'Voyage', 'Wharf', 'Window', 'Winter', 'Witness'
];

const FIRST_NAMES = [
  'Alma', 'Bernard', 'Cissy', 'Dara', 'Edwin', 'Fenella', 'Gordon', 'Hester',
  'Ivor', 'Juno', 'Keir', 'Lorna', 'Magnus', 'Nell', 'Orla', 'Peregrine',
  'Quentin', 'Rosalind', 'Silas', 'Tamsin', 'Ulric', 'Verity', 'Wilf', 'Yvonne'
];

const LAST_NAMES = [
  'Ackroyd', 'Baird', 'Cattermole', 'Dunphy', 'Eastwick', 'Fairbairn',
  'Gallacher', 'Hollingsworth', 'Inchbald', 'Jardine', 'Kettleborough',
  'Lachlan', 'Mainwaring', 'Nesbitt', 'Ollerenshaw', 'Pargeter', 'Quiller',
  'Rutherford', 'Standish', 'Thirlwell', 'Urquhart', 'Vane', 'Wollaston'
];

const GENRES = ['Drama', 'Thriller', 'Comedy', 'Science Fiction', 'Crime',
                'Documentary', 'Romance', 'Horror', 'Adventure', 'Mystery'];

const STUDIOS = ['Harbour Pictures', 'Northlight', 'Verdigris Films',
                 'Coldwater', 'Two Rivers', 'Ashgrove'];

/* Certificates the fake library uses, weighted so the kids filter has both
   plenty to show and plenty to exclude. `null` means unrated, which must stay
   out of the kids rows. */
const RATINGS = ['U', 'U', 'PG', 'PG', '12A', '12', '15', '15', '18', null];

const PROFILES = [
  { id: 'h264-eac3',  res: '1080', w: 1920, h: 1080, codec: 'h264', container: 'mkv',
    audio: [['eac3', 6, ''], ['ac3', 6, ''], ['aac', 2, '']] },
  { id: 'h264-aac',   res: '1080', w: 1920, h: 1080, codec: 'h264', container: 'mp4',
    audio: [['aac', 2, '']] },
  { id: 'hevc-eac3',  res: '4k',   w: 3840, h: 2160, codec: 'hevc', container: 'mkv',
    audio: [['eac3', 6, '']] },
  { id: 'hevc-mixed', res: '4k',   w: 3840, h: 2160, codec: 'hevc', container: 'mkv',
    audio: [['truehd', 8, ''], ['ac3', 6, '']] },
  { id: 'hevc-truehd', res: '4k',  w: 3840, h: 2160, codec: 'hevc', container: 'mkv',
    audio: [['truehd', 8, ''], ['dca', 8, 'ma']] },
  { id: 'vc1-avi',    res: '1080', w: 1920, h: 1080, codec: 'vc1', container: 'avi',
    audio: [['mp3', 2, '']] }
];

/* Weighted so the awkward cases are a minority but always present: roughly
   1 in 8 is TrueHD-only, 1 in 12 will not direct play at all. */
const PROFILE_PICK = [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 0];

/* Deterministic PRNG — the same library every run, so a screenshot or a bug
   report means the same thing tomorrow. */
function rand(seed) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) { return list[Math.floor(rng() * list.length)]; }

/* One version of one item: what the server says it holds, minus the streams,
   which only appear on the full metadata payload. */
function mediaFor(profile, ratingKey, duration) {
  return {
    id: Number(ratingKey),
    videoResolution: profile.res,
    videoCodec: profile.codec,
    audioCodec: profile.audio[0][0],
    container: profile.container,
    width: profile.w,
    height: profile.h,
    duration: duration,
    bitrate: profile.res === '4k' ? 48000 : 9000,
    Part: [{
      id: Number(ratingKey) + 500000,
      key: '/library/parts/' + (Number(ratingKey) + 500000) + '/' +
           ratingKey + '/file.' + profile.container,
      container: profile.container,
      duration: duration,
      size: profile.res === '4k' ? 62000000000 : 9000000000
    }]
  };
}

/* What a film IS, independent of which server is holding a copy of it. Both
   servers agree on all of this, which is what makes deduplication possible. */
function makeFilm(i) {
  const rng = rand(i * 2654435761);
  const title = pick(rng, ADJECTIVES) + ' ' + pick(rng, NOUNS) +
                (rng() < 0.12 ? ' ' + (2 + Math.floor(rng() * 3)) : '');
  const cast = [];
  const castCount = 4 + Math.floor(rng() * 6);
  for (let n = 0; n < castCount; n++) {
    cast.push({
      name: pick(rng, FIRST_NAMES) + ' ' + pick(rng, LAST_NAMES),
      role: pick(rng, FIRST_NAMES) + (rng() < 0.3 ? ' ' + pick(rng, LAST_NAMES) : '')
    });
  }
  const genres = [pick(rng, GENRES)];
  if (rng() < 0.6) genres.push(pick(rng, GENRES));
  const year = 1975 + Math.floor(rng() * 50);

  return {
    i: i,
    guid: 'plex://movie/' + (5000000 + i),
    tmdb: 1000 + i * 7,
    imdb: 'tt' + String(1000000 + i * 13),
    title: title,
    year: year,
    duration: (78 + Math.floor(rng() * 92)) * 60000,
    contentRating: pick(rng, RATINGS),
    tagline: 'A ' + pick(rng, ADJECTIVES).toLowerCase() + ' ' +
             pick(rng, NOUNS).toLowerCase() + ', and no way back.',
    studio: pick(rng, STUDIOS),
    rating: Math.round((45 + rng() * 55)) / 10,          // critic, out of 10
    audienceRating: Math.round((40 + rng() * 60)) / 10,
    genres: genres.filter(function (g, n, a) { return a.indexOf(g) === n; }),
    director: pick(rng, FIRST_NAMES) + ' ' + pick(rng, LAST_NAMES),
    writer: pick(rng, FIRST_NAMES) + ' ' + pick(rng, LAST_NAMES),
    cast: cast,
    summary: title + ' (' + year + '). ' +
             pick(rng, ADJECTIVES).toLowerCase() + ' ' + pick(rng, NOUNS).toLowerCase() +
             ', a ' + pick(rng, NOUNS).toLowerCase() + ', and one long night in the ' +
             pick(rng, NOUNS).toLowerCase() + '.'
  };
}

/* One server's copy of a film. Same identity, its own rating key and its own
   media — deliberately different between servers, so that choosing a source
   is choosing whether the thing direct plays. */
function makeCopy(film, serverIndex) {
  const rng = rand(film.i * 7919 + serverIndex * 104729);
  const profile = PROFILES[PROFILE_PICK[Math.floor(rng() * PROFILE_PICK.length)]];
  const ratingKey = String(serverIndex * 1000000 + 1000 + film.i);

  const item = {
    ratingKey: ratingKey,
    key: '/library/metadata/' + ratingKey,
    guid: film.guid,
    Guid: [{ id: 'tmdb://' + film.tmdb }, { id: 'imdb://' + film.imdb }],
    type: 'movie',
    title: film.title,
    titleSort: film.title,
    year: film.year,
    duration: film.duration,
    addedAt: 1600000000 + film.i * 3600 + serverIndex * 900,
    updatedAt: 1600000000 + film.i * 3600,
    thumb: '/library/metadata/' + ratingKey + '/thumb/' + (1600000000 + film.i),
    art: '/library/metadata/' + ratingKey + '/art/' + (1600000000 + film.i),
    summary: film.summary,
    tagline: film.tagline,
    studio: film.studio,
    rating: film.rating,
    audienceRating: film.audienceRating,
    Media: [mediaFor(profile, ratingKey, film.duration)]
  };
  if (film.contentRating) item.contentRating = film.contentRating;
  item._profile = profile.id;
  item._film = film.i;
  return item;
}

/* Extras hang off a film's metadata carrying their own media but, like a real
   server, no streams — those come from fetching the extra's own metadata.
   Rating key is the film's with '00' and the index appended, so the mock can
   resolve one without keeping an index. */
const EXTRA_KINDS = [
  { subtype: 'trailer', title: 'Official Trailer', minutes: 2 },
  { subtype: 'behindTheScenes', title: 'Behind the Scenes', minutes: 7 }
];

function extraKey(parentKey, n) { return String(parentKey) + '00' + n; }

function makeExtra(parent, n, withStreams) {
  const kind = EXTRA_KINDS[n];
  const key = extraKey(parent.ratingKey, n);
  const out = {
    ratingKey: key,
    key: '/library/metadata/' + key,
    type: 'clip',
    subtype: kind.subtype,
    extraType: n + 1,
    title: kind.title,
    duration: kind.minutes * 60000,
    thumb: parent.thumb,
    Media: [{
      id: Number(key),
      videoResolution: '1080', videoCodec: 'h264', audioCodec: 'aac',
      container: 'mp4', width: 1920, height: 1080, duration: kind.minutes * 60000,
      Part: [{
        id: Number(key) + 1,
        key: '/library/parts/' + key + '/1600000000/extra.mp4',
        container: 'mp4', duration: kind.minutes * 60000, size: 40000000
      }]
    }]
  };
  /* Extras direct play: h264 + AAC stereo is inside the declared profile. */
  if (withStreams) {
    out.Media[0].Part[0].Stream = [
      { id: Number(key) * 10, streamType: 1, codec: 'h264', width: 1920, height: 1080 },
      { id: Number(key) * 10 + 1, streamType: 2, codec: 'aac', channels: 2,
        languageCode: 'eng', selected: true }
    ];
  }
  return out;
}

/* Streams, cast and crew only appear on the full metadata payload, exactly as
   they do on a real server — which is why the masthead shows "AUDIO …" until it
   lands, and why the detail page has to fetch. */
function fullMetadata(item, film) {
  const copy = JSON.parse(JSON.stringify(item));

  /* A show has no media of its own — only its episodes do. */
  if (!copy.Media || !copy.Media.length) {
    copy.Genre = (film.genres || []).map(function (g) { return { tag: g }; });
    copy.Role = (film.cast || []).map(function (c, n) {
      return { tag: c.name, role: c.role,
               thumb: '/people/' + n + '/' + encodeURIComponent(c.name) };
    });
    return copy;
  }

  const profile = PROFILES.filter(function (p) { return p.id === item._profile; })[0];
  const media = copy.Media[0];

  const streams = [{
    id: Number(item.ratingKey) * 10,
    streamType: 1,
    codec: media.videoCodec,
    width: media.width,
    height: media.height,
    bitDepth: media.videoCodec === 'hevc' ? 10 : 8,
    default: true
  }];
  profile.audio.forEach(function (a, n) {
    const st = {
      id: Number(item.ratingKey) * 10 + 1 + n,
      streamType: 2,
      codec: a[0],
      channels: a[1],
      languageCode: n === 2 ? 'fra' : 'eng',
      selected: n === 0
    };
    if (a[2]) st.profile = a[2];
    streams.push(st);
  });
  streams.push({
    id: Number(item.ratingKey) * 10 + 9,
    streamType: 3, codec: 'subrip', languageCode: 'eng'
  });
  copy.Media[0].Part[0].Stream = streams;

  copy.Genre = (film.genres || []).map(function (g) { return { tag: g }; });
  if (film.director) copy.Director = [{ tag: film.director }];
  if (film.writer) copy.Writer = [{ tag: film.writer }];
  copy.Role = (film.cast || []).map(function (c, n) {
    return { tag: c.name, role: c.role,
             thumb: '/people/' + n + '/' + encodeURIComponent(c.name) };
  });
  copy.Extras = {
    size: EXTRA_KINDS.length,
    Metadata: EXTRA_KINDS.map(function (k, n) { return makeExtra(item, n, false); })
  };
  return copy;
}

/* ---------- shows ----------

   A show is not playable; an episode is. Everything the guard cares about
   therefore lives on the episode, and the show and season exist to be browsed
   through. */

const SHOW_SUFFIX = ['', '', '', ': The Return', ': Origins', ' (UK)'];

function makeShow(i) {
  const rng = rand(i * 40503 + 7);
  const title = pick(rng, ADJECTIVES) + ' ' + pick(rng, NOUNS) + pick(rng, SHOW_SUFFIX);
  const year = 1990 + Math.floor(rng() * 34);
  const seasonCount = 1 + Math.floor(rng() * 5);
  const cast = [];
  for (let n = 0; n < 4 + Math.floor(rng() * 5); n++) {
    cast.push({
      name: pick(rng, FIRST_NAMES) + ' ' + pick(rng, LAST_NAMES),
      role: pick(rng, FIRST_NAMES)
    });
  }

  const seasons = [];
  for (let sn = 1; sn <= seasonCount; sn++) {
    const episodes = [];
    const count = 6 + Math.floor(rng() * 8);
    for (let en = 1; en <= count; en++) {
      episodes.push({
        season: sn,
        number: en,
        title: pick(rng, ADJECTIVES) + ' ' + pick(rng, NOUNS),
        duration: (22 + Math.floor(rng() * 40)) * 60000,
        summary: 'Series ' + sn + ', episode ' + en + '. ' +
                 pick(rng, NOUNS).toLowerCase() + ', and a ' +
                 pick(rng, NOUNS).toLowerCase() + '.',
        airedAt: (2000 + sn) + '-0' + (1 + (en % 9)) + '-1' + (en % 10)
      });
    }
    seasons.push({ number: sn, episodes: episodes });
  }

  return {
    i: i,
    guid: 'plex://show/' + (7000000 + i),
    tvdb: 80000 + i * 3,
    tmdb: 60000 + i * 5,
    title: title,
    year: year,
    contentRating: pick(rng, RATINGS),
    studio: pick(rng, STUDIOS),
    rating: Math.round((45 + rng() * 55)) / 10,
    audienceRating: Math.round((40 + rng() * 60)) / 10,
    genres: [pick(rng, GENRES)],
    cast: cast,
    seasons: seasons,
    summary: title + '. ' + pick(rng, ADJECTIVES).toLowerCase() + ' ' +
             pick(rng, NOUNS).toLowerCase() + ', across ' + seasonCount +
             ' series.'
  };
}

/* One server's copy of a show, with its seasons and episodes. The media profile
   is chosen per show per server — a whole run is usually one encode — so a show
   that direct plays on one server may not on the other. */
function makeShowCopy(show, serverIndex) {
  const rng = rand(show.i * 15485863 + serverIndex * 32452843);
  const profile = PROFILES[PROFILE_PICK[Math.floor(rng() * PROFILE_PICK.length)]];
  const base = serverIndex * 1000000;
  const showKey = String(base + 500000 + show.i);

  const item = {
    ratingKey: showKey,
    key: '/library/metadata/' + showKey + '/children',
    guid: show.guid,
    Guid: [{ id: 'tvdb://' + show.tvdb }, { id: 'tmdb://' + show.tmdb }],
    type: 'show',
    title: show.title,
    titleSort: show.title,
    year: show.year,
    summary: show.summary,
    studio: show.studio,
    rating: show.rating,
    audienceRating: show.audienceRating,
    addedAt: 1600000000 + show.i * 7200 + serverIndex * 900,
    updatedAt: 1600000000 + show.i * 7200,
    thumb: '/library/metadata/' + showKey + '/thumb/' + (1600000000 + show.i),
    art: '/library/metadata/' + showKey + '/art/' + (1600000000 + show.i),
    childCount: show.seasons.length,
    leafCount: show.seasons.reduce(function (n, s) { return n + s.episodes.length; }, 0),
    viewedLeafCount: 0,
    _show: show.i,
    _profile: profile.id
  };
  if (show.contentRating) item.contentRating = show.contentRating;

  const seasons = show.seasons.map(function (season) {
    const seasonKey = String(base + 600000 + show.i * 10 + season.number);
    return {
      ratingKey: seasonKey,
      key: '/library/metadata/' + seasonKey + '/children',
      type: 'season',
      title: 'Season ' + season.number,
      index: season.number,
      parentRatingKey: showKey,
      parentTitle: show.title,
      parentGuid: show.guid,
      thumb: '/library/metadata/' + seasonKey + '/thumb/' + (1600000000 + show.i),
      leafCount: season.episodes.length,
      viewedLeafCount: 0,
      addedAt: item.addedAt,
      _show: show.i,
      _season: season.number
    };
  });

  const episodes = [];
  show.seasons.forEach(function (season) {
    season.episodes.forEach(function (ep) {
      const epKey = String(base + 700000 + show.i * 1000 + season.number * 100 + ep.number);
      /* One episode per show is deliberately a different encode, so a show that
         otherwise direct plays still has an awkward one in it. */
      const epProfile = (ep.number === 3)
        ? PROFILES[PROFILE_PICK[(show.i + serverIndex + 4) % PROFILE_PICK.length]]
        : profile;
      episodes.push({
        ratingKey: epKey,
        key: '/library/metadata/' + epKey,
        guid: 'plex://episode/' + (8000000 + show.i * 1000 + season.number * 100 + ep.number),
        type: 'episode',
        title: ep.title,
        titleSort: ep.title,
        index: ep.number,
        parentIndex: season.number,
        parentTitle: 'Season ' + season.number,
        parentRatingKey: String(base + 600000 + show.i * 10 + season.number),
        grandparentTitle: show.title,
        grandparentRatingKey: showKey,
        grandparentGuid: show.guid,
        grandparentThumb: item.thumb,
        duration: ep.duration,
        summary: ep.summary,
        originallyAvailableAt: ep.airedAt,
        contentRating: show.contentRating,
        addedAt: item.addedAt + ep.number * 60,
        updatedAt: item.addedAt,
        thumb: '/library/metadata/' + epKey + '/thumb/' + (1600000000 + show.i),
        art: item.art,
        Media: [mediaFor(epProfile, epKey, ep.duration)],
        _show: show.i,
        _profile: epProfile.id
      });
    });
  });

  return { show: item, seasons: seasons, episodes: episodes };
}

/* ---------- servers ---------- */

/* Which films each server holds. Main has most of them; Backup has a third of
   Main's plus a slice of its own, so merging has to both deduplicate and add. */
function holdings(count) {
  const main = [], backup = [];
  for (let i = 0; i < count; i++) {
    if (i % 4 !== 3) main.push(i);
    if (i % 3 === 0 || i % 4 === 3) backup.push(i);
  }
  return [main, backup];
}

const SERVERS = [
  { index: 1, id: 'mockmachine00000000000000000000000000main', name: 'Main', prefix: '/__plex' },
  { index: 2, id: 'mockmachine0000000000000000000000000backup', name: 'Backup', prefix: '/__plex2' }
];

function build(counts) {
  const filmCount = counts.films;
  /* One show per ten films, near enough to the real ratio and enough to make
     the show rail work. */
  const showCount = Math.max(6, Math.round(filmCount / 10));

  const films = [];
  for (let i = 0; i < filmCount; i++) films.push(makeFilm(i));
  const shows = [];
  for (let i = 0; i < showCount; i++) shows.push(makeShow(i));

  const filmsHeld = holdings(filmCount);
  const showsHeld = holdings(showCount);

  function byTitle(a, b) {
    return a.titleSort < b.titleSort ? -1 : (a.titleSort > b.titleSort ? 1 : 0);
  }

  const servers = SERVERS.map(function (spec, n) {
    const allFilms = filmsHeld[n].map(function (i) { return makeCopy(films[i], spec.index); });
    allFilms.sort(byTitle);
    const uhd = allFilms.filter(function (m) { return m.Media[0].videoResolution === '4k'; });

    /* Shows, and everything hanging off them. `children` is what
       /library/metadata/<key>/children answers with. */
    const children = {};
    const allShows = [];
    const episodesByShow = {};
    showsHeld[n].forEach(function (i) {
      const built = makeShowCopy(shows[i], spec.index);
      allShows.push(built.show);
      children[built.show.ratingKey] = built.seasons;
      built.seasons.forEach(function (season) {
        children[season.ratingKey] = built.episodes.filter(function (ep) {
          return ep.parentIndex === season.index;
        });
      });
      episodesByShow[built.show.ratingKey] = built.episodes;
    });
    allShows.sort(byTitle);

    const sections = [
      { key: '1', title: 'Films', type: 'movie', updatedAt: 1700000000 + n },
      { key: '3', title: 'TV Shows', type: 'show', updatedAt: 1700000200 + n }
    ];
    const items = { '1': allFilms, '3': allShows };
    /* Only Main separates its 4K films into their own section. */
    if (n === 0) {
      sections.splice(1, 0, { key: '2', title: '4K Films', type: 'movie', updatedAt: 1700000100 });
      items['2'] = uhd;
    }

    const byKey = {};
    allFilms.forEach(function (m) { byKey[m.ratingKey] = m; });
    allShows.forEach(function (m) { byKey[m.ratingKey] = m; });
    Object.keys(children).forEach(function (k) {
      children[k].forEach(function (child) { byKey[child.ratingKey] = child; });
    });

    const byGuid = {};
    allFilms.forEach(function (m) { byGuid['tmdb://' + films[m._film].tmdb] = m; });
    allShows.forEach(function (m) { byGuid['tmdb://' + shows[m._show].tmdb] = m; });

    return {
      spec: spec,
      name: spec.name,
      machineId: spec.id,
      prefix: spec.prefix,
      sections: sections,
      items: items,
      children: children,
      episodesByShow: episodesByShow,
      byKey: byKey,
      byGuid: byGuid,
      contentRatings: function (key) {
        const seen = {};
        (items[key] || []).forEach(function (m) {
          if (m.contentRating) seen[m.contentRating] = true;
        });
        return Object.keys(seen).sort();
      }
    };
  });

  /* The canonical record behind whichever copy is being asked about. */
  function subject(item) {
    if (item.type === 'movie') return films[item._film];
    return shows[item._show];
  }

  return {
    films: films,
    shows: shows,
    servers: servers,
    subject: subject,
    fullMetadata: function (item) { return fullMetadata(item, subject(item)); }
  };
}

/* '<parentKey>00<n>' -> the extra, with streams, or null. */
function resolveExtra(byKey, key) {
  const m = String(key).match(/^(\d+)00(\d)$/);
  if (!m) return null;
  const parent = byKey[m[1]];
  const n = Number(m[2]);
  if (!parent || n >= EXTRA_KINDS.length) return null;
  return makeExtra(parent, n, true);
}

module.exports = { build: build, PROFILES: PROFILES, SERVERS: SERVERS,
                   resolveExtra: resolveExtra };
