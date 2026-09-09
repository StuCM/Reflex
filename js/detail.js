/* The page between the rail and playback.

   The rail shows one entry per film. This is where that entry opens out: the
   things you want before committing two hours — rating, cast, what it is about
   — and which copy to play.

   "Which copy" is two dimensions, not one. The same film is often on both
   servers, and a single library item can itself hold several versions (a 4K
   remux and a 1080p encode are two entries in Media[]). Every combination is
   listed, and every one is checked through js/guard.js as the page opens, so
   each line already says whether it direct plays or would push a transcode
   onto someone else's hardware before you choose.

   The preferred server's copy is selected when the page opens — see
   Servers.preferred. Switching is one press away, and is the point of the
   page. */
var Detail = (function () {
  'use strict';

  const elArt = document.getElementById('dt-art');
  const elTitle = document.getElementById('dt-title');
  const elMeta = document.getElementById('dt-meta');
  const elTagline = document.getElementById('dt-tagline');
  const elSummary = document.getElementById('dt-summary');
  const elCrew = document.getElementById('dt-crew');
  const elSources = document.getElementById('dt-sources');
  const elExtras = document.getElementById('dt-extras');
  const elExtrasLabel = document.getElementById('dt-extras-label');
  const elCast = document.getElementById('dt-cast');

  let item = null;                 // the merged entry
  let copies = [];                 // one per server that has it
  let sources = [];                // flattened: one per server × version
  let extras = [];                 // trailers and the rest, playable in their own right
  let idx = 0;                     // indexes sources.concat(extras)
  let opts = {};
  let generation = 0;

  function open(entry, options) {
    if (!entry) return;
    item = entry;
    opts = options || {};
    generation++;

    /* Merge already put the preferred server's copy first, so source 0 is the
       one the preference asks for. */
    copies = Merge.sources(entry).map(copy => {
      return { item: copy, server: Servers.of(copy), versions: null };
    });
    extras = [];
    idx = 0;
    rebuild();

    UI.show('detail');
    paintSkeleton();
    renderSources();
    loadDetails();
  }

  function close() {
    item = null;
    copies = [];
    sources = [];
    extras = [];
    if (opts.onExit) opts.onExit();
  }

  /* Everything focusable on the page, in the order it is drawn. */
  function lines() { return sources.concat(extras); }

  /* ---------- the source list ---------- */

  /* Until a copy's metadata lands we know it has *a* version, from the list
     response, but not how many. So each copy contributes one provisional line
     that becomes one line per version once we know. */
  function rebuild() {
    const chosen = lines()[idx] || null;
    sources = [];
    copies.forEach(copy => {
      if (copy.versions) {
        copy.versions.forEach(v => { sources.push(v); });
        return;
      }
      sources.push({ copy: copy, server: copy.server, mediaIndex: 0,
                     media: (copy.item.Media && copy.item.Media[0]) || {},
                     verdict: null, provisional: true });
    });
    /* Keep the user's choice pinned across a rebuild. */
    idx = 0;
    if (chosen) {
      let all = lines(), i;
      for (i = 0; i < all.length; i++) {
        if (all[i].copy === chosen.copy && all[i].mediaIndex === chosen.mediaIndex) {
          idx = i;
          break;
        }
      }
    }
  }

  /* The copies we started with came from the row, which only ever knew about
     one section. These libraries keep the 4K version of a film in a section of
     its own, so the other versions are separate library items and only a guid
     lookup across the whole server finds them. */
  function addOtherVersions(md) {
    const gen = generation;
    const known = {};
    copies.forEach(c => { known[c.item._server + ':' + c.item.ratingKey] = true; });

    Servers.all().forEach(sv => {
      Plex.allVersions(sv, md).then(found => {
        if (gen !== generation || !found.length) return;
        let added = 0;
        found.forEach(other => {
          const key = other._server + ':' + other.ratingKey;
          if (known[key]) return;
          known[key] = true;
          added++;
          copies.push({ item: other, server: Servers.of(other), versions: null });
          Meta.load(other).then(omd => {
            if (gen !== generation || !omd) return;
            expand(copies.filter(c => c.item === other)[0], omd);
          });
        });
        if (added) {
          UI.debug('found ' + added + ' more version' + (added === 1 ? '' : 's') +
                   ' of ' + md.title + ' on ' + sv.name);
          rebuild();
          renderSources();
        }
      });
    });
  }

  /* Trailers and behind-the-scenes clips come nested in the film's metadata,
     carrying their own media. They are ordinary parts on the same server, so
     they go through the same guard as the film — a clip that would transcode
     is still a transcode on someone else's hardware. */
  function addExtras(md) {
    if (extras.length || !md.Extras || !md.Extras.Metadata) return;
    extras = md.Extras.Metadata.slice(0, 6).map(x => {
      return { copy: { item: x }, server: Servers.of(x), mediaIndex: 0,
               media: (x.Media && x.Media[0]) || {},
               title: x.title || 'Extra', kind: x.subtype || x.extraType || '',
               verdict: null, isExtra: true };
    });
    renderSources();
    extras.forEach(check);
  }

  function expand(copy, md) {
    const list = (md.Media && md.Media.length ? md.Media : [null]);
    copy.versions = list.map((media, n) => {
      return { copy: copy, server: copy.server, mediaIndex: n, media: media || {},
               verdict: null, provisional: false };
    });
    rebuild();
    renderSources();
    copy.versions.forEach(check);
  }

  /* Every version of every copy is checked as the page opens. hasMDE=1 opens no
     session, so asking about one you end up not playing costs a query and
     nothing else. */
  function check(src) {
    const gen = generation;
    Guard.check(src.copy.item, src.mediaIndex).then(v => {
      if (gen !== generation) return;
      src.verdict = v;
      renderSources();
    });
  }

  function versionLabel(src) {
    const media = src.media || {};
    const bits = [];
    if (media.videoResolution) bits.push(String(media.videoResolution).toUpperCase());
    if (media.videoCodec) bits.push(String(media.videoCodec).toUpperCase());
    if (media.container) bits.push(String(media.container).toUpperCase());
    if (src.verdict && src.verdict.audio) bits.push(Media.audioLabel(src.verdict.audio));
    else if (media.audioCodec) bits.push(String(media.audioCodec).toUpperCase());
    return bits.join(' · ');
  }

  function sourceLine(src, on) {
    const v = src.verdict;
    const state = v ? (v.ok ? 'good' : (v.state === 'noaudio' ? 'bad' : 'warn')) : '';
    let name = (src.server && src.server.name) || 'server';
    if (Servers.count() > 1 && Servers.isPreferred(src.server)) name += ' · preferred';

    return '<div class="dt-source' + (on ? ' on' : '') + '">' +
           '<div class="dt-source-name">' + UI.escapeHtml(name) + '</div>' +
           '<div class="dt-source-media">' + UI.escapeHtml(versionLabel(src)) + '</div>' +
           '<div class="dt-source-verdict badge ' + state + '">' +
           UI.escapeHtml(Guard.label(v)) + '</div>' +
           '</div>';
  }

  function extraLine(src, on) {
    const v = src.verdict;
    const state = v ? (v.ok ? 'good' : (v.state === 'noaudio' ? 'bad' : 'warn')) : '';
    const mins = src.copy.item.duration
      ? Math.max(1, Math.round(src.copy.item.duration / 60000)) + ' min' : '';
    return '<div class="dt-source' + (on ? ' on' : '') + '">' +
           '<div class="dt-source-name">' + UI.escapeHtml(src.title) + '</div>' +
           '<div class="dt-source-media">' +
           UI.escapeHtml([src.kind, mins, versionLabel(src)].filter(Boolean).join(' · ')) +
           '</div>' +
           '<div class="dt-source-verdict badge ' + state + '">' +
           UI.escapeHtml(Guard.label(v)) + '</div>' +
           '</div>';
  }

  function renderSources() {
    let html = '', i;
    for (i = 0; i < sources.length; i++) html += sourceLine(sources[i], i === idx);
    elSources.innerHTML = html;

    html = '';
    for (i = 0; i < extras.length; i++) {
      html += extraLine(extras[i], sources.length + i === idx);
    }
    elExtras.innerHTML = html;
    elExtrasLabel.classList.toggle('hidden', extras.length === 0);
  }

  /* ---------- the rest of the page ---------- */

  /* Everything the rail already knows, so the page is never blank while the
     metadata requests are in flight. */
  function paintSkeleton() {
    elTitle.textContent = item.title || '';
    elTagline.textContent = '';
    elSummary.textContent = item.summary || '';
    elCrew.innerHTML = '';
    elCast.innerHTML = '';
    elMeta.textContent = metaLine(item, null);

    const art = Plex.artUrl(item, 960, 540);
    elArt.style.backgroundImage = art ? 'url("' + art + '")' : 'none';
  }

  function metaLine(entry, md) {
    const bits = [];
    if (entry.type === 'episode') bits.push(Media.episodeLabel(entry));
    if (entry.year) bits.push(entry.year);
    if (entry.duration) bits.push(Math.round(entry.duration / 60000) + ' min');
    if (entry.contentRating) bits.push(entry.contentRating);
    if (md && md.rating) bits.push('critics ' + Number(md.rating).toFixed(1));
    if (md && md.audienceRating) bits.push('audience ' + Number(md.audienceRating).toFixed(1));
    if (md && md.Genre && md.Genre.length) {
      bits.push(md.Genre.slice(0, 3).map(g => g.tag).join(', '));
    }
    if (entry.originallyAvailableAt) bits.push('aired ' + entry.originallyAvailableAt);
    if (entry.viewOffset && entry.duration) {
      bits.push(Math.round(100 * entry.viewOffset / entry.duration) + '% watched');
    }
    return bits.join('   ·   ');
  }

  /* Metadata for every copy: each one tells us its versions, and the first to
     arrive also fills in the cast and crew, which are the same whichever server
     you end up playing from. */
  function loadDetails() {
    const gen = generation;
    let filled = false;
    copies.forEach(copy => {
      Meta.load(copy.item).then(md => {
        if (gen !== generation || !md) return;
        copy.md = md;
        expand(copy, md);
        if (filled) return;
        filled = true;
        elMeta.textContent = metaLine(item, md);
        elTagline.textContent = md.tagline || '';
        if (md.summary) elSummary.textContent = md.summary;
        elCrew.innerHTML = crewHtml(md);
        elCast.innerHTML = castHtml(md);
        addExtras(md);
        addOtherVersions(md);
      });
    });
  }

  function crewHtml(md) {
    const bits = [];
    function names(list) {
      return (list || []).map(x => UI.escapeHtml(x.tag)).join(', ');
    }
    if (md.Director && md.Director.length) bits.push('<b>Director</b> ' + names(md.Director));
    if (md.Writer && md.Writer.length) bits.push('<b>Writer</b> ' + names(md.Writer));
    if (md.studio) bits.push('<b>Studio</b> ' + UI.escapeHtml(md.studio));
    return bits.join('<span class="dt-gap"></span>');
  }

  function castHtml(md) {
    let roles = (md.Role || []).slice(0, 8), html = '', i, r, url;
    if (!roles.length) return '';
    for (i = 0; i < roles.length; i++) {
      r = roles[i];
      url = Plex.photoUrl(Servers.of(md), r.thumb, 120, 120);
      html += '<div class="dt-actor">' +
              (url ? '<img src="' + url + '" alt="">' : '<div class="dt-actor-blank"></div>') +
              '<div class="dt-actor-name">' + UI.escapeHtml(r.tag) + '</div>' +
              '<div class="dt-actor-role">' + UI.escapeHtml(r.role || '') + '</div>' +
              '</div>';
    }
    return html;
  }

  /* ---------- keys ---------- */

  function play() {
    const src = lines()[idx];
    if (!src) return;
    if (!src.verdict) { UI.toast('Still checking that copy…'); return; }
    if (!src.verdict.ok) {
      const why = Guard.refusal(item, src.verdict);
      UI.message(why[0], why[1]);
      return;
    }
    if (opts.onPlay) opts.onPlay(item, src.verdict, !!src.isExtra);
  }

  function key(code) {
    const K = UI.KEY;
    if ((code === K.UP || code === K.LEFT) && idx > 0) { idx--; renderSources(); return true; }
    if ((code === K.DOWN || code === K.RIGHT) && idx < lines().length - 1) {
      idx++; renderSources(); return true;
    }
    if (code === K.OK) { play(); return true; }
    if (UI.isBack(code)) { close(); return true; }
    return true;                      // this page swallows everything else
  }

  /* The film currently open, so the message screen knows to come back here
     rather than dropping to the rail. */
  function current() { return item; }

  return { open: open, key: key, current: current };
})();
