/* A fake YouTube, so the recaps rail can be exercised without a request ever
   leaving the machine. Runs on Node only.

     /__yt/...        stands in for https://www.googleapis.com/youtube/v3
     /__ytembed/<id>  stands in for https://www.youtube.com/embed/

   The search answers off the query itself, so whatever show is asked about gets
   recaps named after it — plus the two things the app has to cope with: a video
   belonging to a different show, and one with no season in its title. */
'use strict';

const CHANNEL = 'UC-mock-man-of-recaps';
const HANDLE = '@ManOfRecaps';

/* Not every show has recaps. Three in four do, by the length of the title —
   arbitrary, but deterministic, and the smoke test picks its shows by it. */
function hasRecaps(title) { return title.length % 4 !== 0; }

/* An embed that never answers, so the app's 8-second fallback has something to
   fall back from. */
function stalls(id) { return /-stall$/.test(id); }

function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function item(id, title) {
  return {
    id: { kind: 'youtube#video', videoId: id },
    snippet: {
      title: title,
      channelId: CHANNEL,
      thumbnails: { medium: { url: '/__yt/thumb/' + id + '.svg', width: 320, height: 180 } }
    }
  };
}

/* Deliberately out of season order, and deliberately impure: the app has to
   sort them, drop the one that is not this show, and put the unnumbered one
   last. "Zzyzx Postbox" is two words the generated library cannot produce, so
   it can never accidentally be the show being asked about. */
function search(q) {
  const title = String(q || '').replace(/\s+recap\s*$/i, '').trim();
  if (!title || !hasRecaps(title)) return [];
  const s = slug(title);
  return [
    item(s + '-s2', title + ' Season 2 Recap'),
    item(s + '-s1', title + ' Season 1 Recap'),
    item(s + '-s3-stall', title + ' S3 Recap'),
    item('zzyzx-postbox-s1', 'Zzyzx Postbox Season 1 Recap'),
    item(s + '-all', 'Everything that happened in ' + title)
  ];
}

/* search carries no duration; videos.list does. */
function durations(ids) {
  return ids.filter(function (id) { return !!id; }).map(function (id, n) {
    return { id: id, contentDetails: { duration: 'PT' + (8 + n) + 'M' + (10 + n) + 'S' } };
  });
}

function json(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

/* A caption on a flat ground, so a recap thumbnail is obvious in a screenshot
   and says which video it belongs to. */
function thumb(res, id) {
  const hue = (id.length * 37) % 360;
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=60' });
  res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">' +
    '<rect width="320" height="180" fill="hsl(' + hue + ',40%,22%)"/>' +
    '<text x="16" y="100" font-family="Helvetica,Arial" font-size="20" ' +
    'fill="rgba(255,255,255,0.8)">YT ' + id + '</text></svg>');
}

function embed(res, id) {
  if (stalls(id)) return;            // answers nothing, ever, on purpose
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!DOCTYPE html><title>recap</title>' +
          '<body style="margin:0;background:#000;color:#eee;font:24px sans-serif">' +
          '<p style="padding:40px">mock recap player: ' + id + '</p>');
}

/* Returns true if it answered. /__ytembed first: it also starts with /__yt. */
function handle(req, res, pathname, query) {
  if (pathname.indexOf('/__ytembed/') === 0) {
    embed(res, pathname.slice('/__ytembed/'.length));
    return true;
  }
  if (pathname.indexOf('/__yt/thumb/') === 0) {
    thumb(res, pathname.slice('/__yt/thumb/'.length).replace(/\.svg$/, ''));
    return true;
  }
  query = query || {};
  if (pathname === '/__yt/channels') {
    json(res, { items: query.forHandle === HANDLE ? [{ id: CHANNEL }] : [] });
    return true;
  }
  if (pathname === '/__yt/search') {
    json(res, { items: search(query.q) });
    return true;
  }
  if (pathname === '/__yt/videos') {
    json(res, { items: durations(String(query.id || '').split(',')) });
    return true;
  }
  return false;
}

module.exports = { handle: handle, hasRecaps: hasRecaps, CHANNEL: CHANNEL };
