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

  var elArt = document.getElementById('dt-art');
  var elKicker = document.getElementById('dt-kicker');
  var elTitle = document.getElementById('dt-title');
  var elChips = document.getElementById('dt-chips');
  var elRatings = document.getElementById('dt-ratings');
  var elTagline = document.getElementById('dt-tagline');
  var elSummary = document.getElementById('dt-summary');
  var elNames = document.getElementById('dt-names');
  var elCrew = document.getElementById('dt-crew');
  var elSources = document.getElementById('dt-sources');
  var elExtras = document.getElementById('dt-extras');
  var elExtrasLabel = document.getElementById('dt-extras-label');
  var elCast = document.getElementById('dt-cast');

  /* Inlined, like the search icon in index.html: the app runs from file:// on
     the TV, so there is no icon font to fetch. */
  var STAR_GLYPH =
    '<svg class="dt-glyph" width="22" height="22" viewBox="0 0 256 256" fill="none" ' +
    'stroke="currentColor" stroke-width="18" stroke-linejoin="round">' +
    '<polygon points="128,24 158,94 234,101 177,152 194,228 128,188 62,228 79,152 22,101 98,94"/>' +
    '</svg>';
  var PLAY_GLYPH =
    '<svg class="dt-extra-play" width="52" height="52" viewBox="0 0 256 256" fill="none" ' +
    'stroke="currentColor" stroke-width="16" stroke-linejoin="round">' +
    '<circle cx="128" cy="128" r="100"/><polygon points="106,84 178,128 106,172"/></svg>';

  var item = null;                 // the merged entry
  var copies = [];                 // one per server that has it
  var sources = [];                // flattened: one per server × version
  var extras = [];                 // trailers and the rest, playable in their own right
  var idx = 0;                     // indexes sources.concat(extras)
  var headMd = null;               // the first copy's metadata: what the header says
  var opts = {};
  var generation = 0;

  function open(entry, options) {
    if (!entry) return;
    item = entry;
    opts = options || {};
    generation++;

    /* Merge already put the preferred server's copy first, so source 0 is the
       one the preference asks for. */
    copies = Merge.sources(entry).map(function (copy) {
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
    /* Metadata and verdicts for the page we are leaving are still in flight;
       moving the generation on is what stops them drawing into an empty page. */
    generation++;
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
    var chosen = lines()[idx] || null;
    sources = [];
    copies.forEach(function (copy) {
      if (copy.versions) {
        copy.versions.forEach(function (v) { sources.push(v); });
        return;
      }
      sources.push({ copy: copy, server: copy.server, mediaIndex: 0,
                     media: (copy.item.Media && copy.item.Media[0]) || {},
                     verdict: null, provisional: true });
    });
    /* Keep the user's choice pinned across a rebuild. */
    idx = 0;
    if (chosen) {
      var all = lines(), i;
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
    var gen = generation;
    var known = {};
    copies.forEach(function (c) { known[c.item._server + ':' + c.item.ratingKey] = true; });

    Servers.all().forEach(function (sv) {
      Plex.allVersions(sv, md).then(function (found) {
        if (gen !== generation || !found.length) return;
        var added = 0;
        found.forEach(function (other) {
          var key = other._server + ':' + other.ratingKey;
          if (known[key]) return;
          known[key] = true;
          added++;
          copies.push({ item: other, server: Servers.of(other), versions: null });
          Meta.load(other).then(function (omd) {
            if (gen !== generation || !omd) return;
            expand(copies.find(function (c) { return c.item === other; }), omd);
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
    extras = md.Extras.Metadata.slice(0, 6).map(function (x) {
      return { copy: { item: x }, server: Servers.of(x), mediaIndex: 0,
               media: (x.Media && x.Media[0]) || {},
               title: x.title || 'Extra', kind: x.subtype || x.extraType || '',
               verdict: null, isExtra: true };
    });
    renderSources();
    extras.forEach(check);
  }

  function expand(copy, md) {
    var list = (md.Media && md.Media.length ? md.Media : [null]);
    copy.versions = list.map(function (media, n) {
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
    var gen = generation;
    Guard.check(src.copy.item, src.mediaIndex).then(function (v) {
      if (gen !== generation) return;
      src.verdict = v;
      renderSources();
    });
  }

  function versionLabel(src) {
    var media = src.media || {};
    var bits = [];
    if (media.videoResolution) bits.push(String(media.videoResolution).toUpperCase());
    if (media.videoCodec) bits.push(String(media.videoCodec).toUpperCase());
    if (media.container) bits.push(String(media.container).toUpperCase());
    if (src.verdict && src.verdict.audio) bits.push(Media.audioLabel(src.verdict.audio));
    else if (media.audioCodec) bits.push(String(media.audioCodec).toUpperCase());
    return bits.join(' · ');
  }

  function sourceLine(src, on) {
    var v = src.verdict;
    var state = v ? (v.ok ? 'good' : (v.state === 'noaudio' ? 'bad' : 'warn')) : '';
    var name = (src.server && src.server.name) || 'server';
    if (Servers.count() > 1 && Servers.isPreferred(src.server)) name += ' · preferred';

    return '<div class="dt-source' + (on ? ' on' : '') + '">' +
           '<div class="dt-source-name">' + UI.escapeHtml(name) + '</div>' +
           '<div class="dt-source-media">' + UI.escapeHtml(versionLabel(src)) + '</div>' +
           '<div class="dt-source-verdict badge ' + state + '">' +
           UI.escapeHtml(Guard.label(v)) + '</div>' +
           '</div>';
  }

  /* A trailer is a card, not a line: a still with a play glyph and its length,
     the verdict under it because a clip is guarded like anything else. */
  function extraCard(src, on) {
    var v = src.verdict;
    var state = v ? (v.ok ? 'good' : (v.state === 'noaudio' ? 'bad' : 'warn')) : '';
    var clip = src.copy.item;
    var mins = clip.duration
      ? Math.max(1, Math.round(clip.duration / 60000)) + ' min' : '';
    var shot = Plex.photoUrl(src.server, clip.thumb, 320, 180);
    return '<div class="dt-extra' + (on ? ' on' : '') + '">' +
           '<div class="dt-extra-shot"' +
           (shot ? ' style="background-image: url(\'' + shot + '\')"' : '') + '>' +
           PLAY_GLYPH +
           (mins ? '<div class="dt-extra-len">' + UI.escapeHtml(mins) + '</div>' : '') +
           '</div>' +
           '<div class="dt-extra-title">' + UI.escapeHtml(src.title) + '</div>' +
           '<div class="dt-extra-verdict badge ' + state + '">' +
           UI.escapeHtml(Guard.label(v)) + '</div>' +
           '</div>';
  }

  function renderSources() {
    var html = '', i;
    for (i = 0; i < sources.length; i++) html += sourceLine(sources[i], i === idx);
    elSources.innerHTML = html;

    html = '';
    for (i = 0; i < extras.length; i++) {
      html += extraCard(extras[i], sources.length + i === idx);
    }
    elExtras.innerHTML = html;
    elExtrasLabel.classList.toggle('hidden', extras.length === 0);
    /* The quality chip names the copy that would play, so it follows the
       selection down the list. */
    elChips.innerHTML = chipsHtml();
  }

  /* ---------- the rest of the page ---------- */

  /* Everything the rail already knows, so the page is never blank while the
     metadata requests are in flight. */
  function paintSkeleton() {
    headMd = null;
    elTitle.textContent = item.title || '';
    elTagline.textContent = '';
    elSummary.textContent = description(null);
    elNames.textContent = namesLine(null);
    elCrew.innerHTML = '';
    elCast.innerHTML = '';
    renderHead();

    var art = Plex.artUrl(item, 960, 540);
    elArt.style.backgroundImage = art ? 'url("' + art + '")' : 'none';
  }

  /* The kicker, the chips and the ratings, from whatever we have so far. Called
     again as metadata lands and as the selection moves. */
  function renderHead() {
    elKicker.textContent = kickerLine();
    elChips.innerHTML = chipsHtml();
    elRatings.innerHTML = ratingsHtml();
  }

  /* The header says what the rail's header said, which means TMDB's overview
     when the rail already fetched one and Plex's summary otherwise — the two
     screens must not describe the same film differently. */
  function description(md) {
    var got = Art.factsFor(item);
    if (got && got.overview) return got.overview;
    return (md && md.summary) || item.summary || '';
  }

  /* Key actors, names only. Same source as the header above, so the strip of
     photographs further down never contradicts it. */
  function namesLine(md) {
    var got = Art.factsFor(item);
    var names = (got && got.cast.length) ? got.cast
      : (md && md.Role ? md.Role.slice(0, 4).map(function (r) { return r.tag; }) : []);
    return names.join('  \u00b7  ');
  }

  /* "MOVIE · SCIENCE FICTION · DENIS VILLENEUVE" — what it is, in amber caps.
     An episode is named by its show; anything we do not have drops out with its
     separator rather than leaving a gap. */
  function kickerLine() {
    var bits = [item.type === 'episode' ? item.grandparentTitle : item.type];
    if (headMd && headMd.Genre && headMd.Genre.length) bits.push(headMd.Genre[0].tag);
    if (headMd && headMd.Director && headMd.Director.length) bits.push(headMd.Director[0].tag);
    return bits.filter(Boolean).join(' · ');
  }

  /* Media.episodeLabel leads with the show, which the kicker already says. */
  function episodeChip() {
    var label = Media.episodeLabel(item);
    var at = label.lastIndexOf('·');
    return at < 0 ? '' : label.slice(at + 1).trim();
  }

  /* TMDB's run time when we have it — it is the film's, where the item's
     duration is this copy's file. */
  function runtimeChip() {
    var got = Art.factsFor(item);
    var mins = (got && got.runtime) ||
               (item.duration ? Math.round(item.duration / 60000) : 0);
    if (!mins) return '';
    if (mins < 60) return mins + 'm';
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  }

  /* The quality of the copy that would play if OK were pressed now. HDR only
     when the server says so — a claim we cannot check is worse than silence. */
  function qualityChip() {
    var src = sources[Math.min(idx, sources.length - 1)];
    var media = (src && src.media) || null;
    var res = String((media && media.videoResolution) || '').toLowerCase();
    if (!res) return '';
    var name = res === '4k' ? '4K' : (/^\d+$/.test(res) ? res + 'p' : res.toUpperCase());
    return /hdr|dovi|dolby/i.test(media.videoDynamicRange || '') ? name + ' HDR' : name;
  }

  /* Certificate, where it sits in a show, year, run time and quality. A chip we
     have nothing for is absent, never an empty outline. */
  function chipsHtml() {
    var out = [];
    function add(text, outlined) {
      if (!text) return;
      out.push('<span class="dt-chip' + (outlined ? ' out' : '') + '">' +
               UI.escapeHtml(String(text)) + '</span>');
    }
    add(item.contentRating, true);
    add(episodeChip(), true);
    add(item.year, false);
    add(runtimeChip(), false);
    add(qualityChip(), true);
    return out.join('');
  }

  /* Up to three scores, each labelled with the source it actually came from.
     There is no IMDb here: Plex gives critics and audience, TMDB gives its
     own, and a number under the wrong badge is a lie the user cannot check. */
  function ratingsHtml() {
    var got = Art.factsFor(item);
    var out = [];
    function add(text) {
      out.push('<span class="dt-rating">' + STAR_GLYPH +
               '<span class="dt-rating-text">' + UI.escapeHtml(text) + '</span></span>');
    }
    if (headMd && headMd.rating) add(Math.round(headMd.rating * 10) + '% Critics');
    if (headMd && headMd.audienceRating) {
      add(Math.round(headMd.audienceRating * 10) + '% Audience');
    }
    if (got && got.rating) add(got.rating + ' TMDB');
    return out.join('');
  }

  /* Metadata for every copy: each one tells us its versions, and the first to
     arrive also fills in the cast and crew, which are the same whichever server
     you end up playing from. */
  function loadDetails() {
    var gen = generation;
    var filled = false;
    copies.forEach(function (copy) {
      Meta.load(copy.item).then(function (md) {
        if (gen !== generation || !md) return;
        copy.md = md;
        expand(copy, md);
        if (filled) return;
        filled = true;
        headMd = md;
        renderHead();
        elTagline.textContent = md.tagline || '';
        elSummary.textContent = description(md);
        elNames.textContent = namesLine(md);
        elCrew.innerHTML = crewHtml(md);
        elCast.innerHTML = castHtml(md);
        addExtras(md);
        addOtherVersions(md);
      });
    });
  }

  function crewHtml(md) {
    var bits = [];
    function names(list) {
      return (list || []).map(function (x) { return UI.escapeHtml(x.tag); }).join(', ');
    }
    if (md.Director && md.Director.length) bits.push('<b>Director</b> ' + names(md.Director));
    if (md.Writer && md.Writer.length) bits.push('<b>Writer</b> ' + names(md.Writer));
    if (md.studio) bits.push('<b>Studio</b> ' + UI.escapeHtml(md.studio));
    return bits.join('<span class="dt-gap"></span>');
  }

  /* The first letters of the first two words: "Ada Lovelace" is AL. */
  function initials(name) {
    var words = String(name || '').trim().split(/\s+/), out = '', i;
    for (i = 0; i < words.length && out.length < 2; i++) {
      if (words[i]) out += words[i].charAt(0).toUpperCase();
    }
    return out;
  }

  function castHtml(md) {
    var roles = (md.Role || []).slice(0, 8), html = '', i, r, url;
    if (!roles.length) return '';
    for (i = 0; i < roles.length; i++) {
      r = roles[i];
      url = Plex.photoUrl(Servers.of(md), r.thumb, 120, 120);
      html += '<div class="dt-actor">' +
              (url ? '<img src="' + url + '" alt="">'
                   : '<div class="dt-actor-blank">' + UI.escapeHtml(initials(r.tag)) + '</div>') +
              '<div class="dt-actor-name">' + UI.escapeHtml(r.tag) + '</div>' +
              '<div class="dt-actor-role">' + UI.escapeHtml(r.role || '') + '</div>' +
              '</div>';
    }
    return html;
  }

  /* ---------- keys ---------- */

  function play() {
    var src = lines()[idx];
    if (!src) return;
    if (!src.verdict) { UI.toast('Still checking that copy…'); return; }
    if (!src.verdict.ok) {
      var why = Guard.refusal(item, src.verdict);
      UI.message(why[0], why[1]);
      return;
    }
    if (opts.onPlay) opts.onPlay(item, src.verdict, !!src.isExtra);
  }

  function key(code) {
    var K = UI.KEY;
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
