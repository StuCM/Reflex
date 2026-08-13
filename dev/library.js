/* A synthetic Plex library, generated deterministically.
   Runs on Node only — the Chromium 53 constraint does not apply in dev/.

   The point is not realistic titles, it is realistic *shapes*: enough items to
   make the windowed rail work for its living, and a spread of media profiles
   that reaches every branch of the playback guard —

     - 1080p h264 + E-AC3 5.1        direct plays, good audio badge
     - 1080p h264 + AAC stereo       direct plays, warn badge
     - 4K hevc + E-AC3 5.1           direct plays, UHD badge
     - 4K hevc + TrueHD and AC3      we pick the AC3 and it plays
     - 4K hevc + TrueHD only         refused before any request is made
     - 1080p vc1 in avi              the server returns transcode, we refuse
*/
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

function makeItem(sectionKey, i) {
  const rng = rand(i * 2654435761 + sectionKey * 97);
  const profile = PROFILES[PROFILE_PICK[Math.floor(rng() * PROFILE_PICK.length)]];
  const ratingKey = String(sectionKey * 100000 + 1000 + i);
  const title = pick(rng, ADJECTIVES) + ' ' + pick(rng, NOUNS) +
                (rng() < 0.12 ? ' ' + (2 + Math.floor(rng() * 3)) : '');
  const year = 1975 + Math.floor(rng() * 50);
  const duration = (78 + Math.floor(rng() * 92)) * 60000;
  const contentRating = pick(rng, RATINGS);
  const tmdb = 1000 + i * 7 + sectionKey;

  const item = {
    ratingKey: ratingKey,
    key: '/library/metadata/' + ratingKey,
    guid: 'plex://movie/' + ratingKey,
    Guid: [{ id: 'tmdb://' + tmdb }],
    type: 'movie',
    title: title,
    titleSort: title,
    year: year,
    duration: duration,
    addedAt: 1600000000 + i * 3600,
    updatedAt: 1600000000 + i * 3600,
    thumb: '/library/metadata/' + ratingKey + '/thumb/' + (1600000000 + i),
    art: '/library/metadata/' + ratingKey + '/art/' + (1600000000 + i),
    summary: title + ' (' + year + '). ' + pick(rng, ADJECTIVES).toLowerCase() +
             ' ' + pick(rng, NOUNS).toLowerCase() + ', a ' +
             pick(rng, NOUNS).toLowerCase() + ', and one long night in the ' +
             pick(rng, NOUNS).toLowerCase() + '.',
    Media: [{
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
             (1600000000 + i) + '/file.' + profile.container,
        container: profile.container,
        duration: duration,
        size: profile.res === '4k' ? 62000000000 : 9000000000
      }]
    }]
  };
  if (contentRating) item.contentRating = contentRating;
  item._profile = profile.id;
  return item;
}

/* Streams only appear on the full metadata payload, exactly as they do on a
   real server — which is why the masthead shows "AUDIO …" until it lands. */
function streamsFor(item) {
  const profile = PROFILES.filter(function (p) { return p.id === item._profile; })[0];
  const media = item.Media[0];
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
      languageCode: n === 0 ? 'eng' : (n === 1 ? 'eng' : 'fra'),
      selected: n === 0
    };
    if (a[2]) st.profile = a[2];
    streams.push(st);
  });
  streams.push({
    id: Number(item.ratingKey) * 10 + 9,
    streamType: 3, codec: 'subrip', languageCode: 'eng'
  });
  return streams;
}

function fullMetadata(item) {
  const copy = JSON.parse(JSON.stringify(item));
  copy.Media[0].Part[0].Stream = streamsFor(item);
  return copy;
}

/* Sections. The show section exists so we can see it being filtered out —
   drill-down is task 3, and until then it must not appear as a chip. */
function build(counts) {
  const sections = [
    { key: '1', title: 'Films', type: 'movie', updatedAt: 1700000000, count: counts.films },
    { key: '2', title: '4K Films', type: 'movie', updatedAt: 1700000100, count: counts.uhd },
    { key: '3', title: 'TV Shows', type: 'show', updatedAt: 1700000200, count: 0 }
  ];

  const items = {};
  sections.forEach(function (sec) {
    const list = [];
    for (let i = 0; i < sec.count; i++) list.push(makeItem(Number(sec.key), i));
    /* The app asks for sort=titleSort:asc and nothing else, so sort once here
       rather than pretending to honour arbitrary sorts. */
    list.sort(function (a, b) { return a.titleSort < b.titleSort ? -1 : (a.titleSort > b.titleSort ? 1 : 0); });
    items[sec.key] = list;
  });

  const byKey = {};
  const byTmdb = {};
  Object.keys(items).forEach(function (k) {
    items[k].forEach(function (m) {
      byKey[m.ratingKey] = m;
      byTmdb[m.Guid[0].id] = m;
    });
  });

  return {
    sections: sections,
    items: items,
    byKey: byKey,
    byTmdb: byTmdb,
    fullMetadata: fullMetadata,
    /* Distinct certificates in a section, which is what the kids filter asks
       for before it filters on anything. */
    contentRatings: function (key) {
      const seen = {};
      (items[key] || []).forEach(function (m) { if (m.contentRating) seen[m.contentRating] = true; });
      return Object.keys(seen).sort();
    }
  };
}

module.exports = { build: build, PROFILES: PROFILES };
