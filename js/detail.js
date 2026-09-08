/* The page between the rail and playback.

   The rail shows one entry per film. This is where that entry opens out: the
   things you want before committing two hours — rating, cast, what it is about
   — and then a row of buttons that decide what pressing Play actually plays.

   Four of those are choices, and none of them is cosmetic. The copy is two
   dimensions, not one: the same film is often on both servers, and a single
   library item can itself hold several versions (a 4K remux and a 1080p encode
   are two entries in Media[]). The quality, the audio track and the subtitle
   language then sit on top of whichever copy is chosen. Every combination goes
   back through js/guard.js before it is accepted, so a choice that would push a
   4K transcode onto someone else's server is refused here rather than found out
   by starting one — and a refusal leaves the previous choice standing.

   The preferred server's copy is selected when the page opens — see
   Servers.preferred. */
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
  var elActions = document.getElementById('dt-actions');
  var elMenu = document.getElementById('dt-menu');
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

  function glyph(inner) {
    return '<svg width="46" height="46" viewBox="0 0 256 256" fill="none" ' +
           'stroke="currentColor" stroke-width="16" stroke-linecap="round" ' +
           'stroke-linejoin="round">' + inner + '</svg>';
  }
  var GLYPHS = {
    trailer: glyph('<circle cx="128" cy="128" r="100"/><polygon points="106,84 178,128 106,172"/>'),
    quality: glyph('<line x1="56" y1="196" x2="56" y2="140"/>' +
                   '<line x1="128" y1="196" x2="128" y2="96"/>' +
                   '<line x1="200" y1="196" x2="200" y2="52"/>'),
    source: glyph('<rect x="36" y="44" width="184" height="72" rx="14"/>' +
                  '<rect x="36" y="140" width="184" height="72" rx="14"/>'),
    audio: glyph('<polygon points="36,100 92,100 148,48 148,208 92,156 36,156"/>' +
                 '<path d="M188 92a52 52 0 0 1 0 72"/>'),
    subs: glyph('<rect x="28" y="52" width="200" height="152" rx="18"/>' +
                '<line x1="64" y1="124" x2="140" y2="124"/>' +
                '<line x1="64" y1="164" x2="192" y2="164"/>')
  };

  var item = null;                 // the merged entry
  var copies = [];                 // one per server that has it
  var sources = [];                // flattened: one per server × version
  var extras = [];                 // trailers and the rest, playable in their own right
  var sel = 0;                     // which source Play would use
  var strip = 0;                   // 0 = the action row, 1 = the extras
  var idx = 0;                     // within that row
  var headMd = null;               // the first copy's metadata: what the header says
  var opts = {};
  var generation = 0;

  /* The combination Play would start: the guard's verdict for it, and the three
     things the buttons can change about it. */
  var verdict = null, chosenAudio = null, chosenSub = null;
  var maxBitrate = null, forceStream = false;

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
    strip = 0;
    idx = 0;
    verdict = null; chosenAudio = null; chosenSub = null;
    maxBitrate = null; forceStream = false;
    rebuild();

    UI.show('detail');
    paintSkeleton();
    render();
    loadDetails();
  }

  function close() {
    /* Metadata and verdicts for the page we are leaving are still in flight;
       moving the generation on is what stops them drawing into an empty page. */
    generation++;
    Menu.close();
    item = null;
    copies = [];
    sources = [];
    extras = [];
    verdict = null;
    if (opts.onExit) opts.onExit();
  }

  /* ---------- the copies ---------- */

  /* Until a copy's metadata lands we know it has *a* version, from the list
     response, but not how many. So each copy contributes one provisional line
     that becomes one line per version once we know. */
  function rebuild() {
    var chosen = sources[sel] || null;
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
    sel = 0;
    if (chosen) {
      var i;
      for (i = 0; i < sources.length; i++) {
        if (sources[i].copy === chosen.copy && sources[i].mediaIndex === chosen.mediaIndex) {
          sel = i;
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
          render();
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
    render();
    extras.forEach(check);
  }

  function expand(copy, md) {
    var list = (md.Media && md.Media.length ? md.Media : [null]);
    copy.versions = list.map(function (media, n) {
      return { copy: copy, server: copy.server, mediaIndex: n, media: media || {},
               verdict: null, provisional: false };
    });
    rebuild();
    render();
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
      render();
    });
  }

  /* Nobody has chosen anything yet, so the selected copy's own verdict is what
     Play would use — including a refusal, which Play then explains in full. */
  function adoptDefault() {
    var src = sources[sel];
    if (verdict || !src || !src.verdict) return;
    verdict = src.verdict;
    chosenAudio = src.verdict.audio || null;
  }

  /* ---------- choosing ----------

     Every button on the row is the same move: ask the guard about the new
     combination, and keep it only if the answer is yes. Losing your place to
     deliver a message is a worse answer than not switching, so a refusal is a
     toast and the page does not move. */
  function choose(next) {
    var gen = generation;
    var src = sources[next.sel];
    if (!src) return;
    Guard.check(src.copy.item, src.mediaIndex, next.audio && next.audio.id,
                { maxBitrate: next.maxBitrate, forceStream: next.forceStream })
      .then(function (v) {
        if (gen !== generation) return;
        if (!v.ok) {
          UI.toast('Kept as it was — ' + Guard.label(v));
          UI.debug('choice refused: ' + Guard.refusal(item, v)[1]);
          return;
        }
        /* By stream id on the copy we came from, so a subtitle language chosen
           here survives a move to a different file with different ids. */
        chosenSub = chosenSub ? Media.pickSubtitle(v.part, chosenSub.languageCode) : null;
        sel = next.sel;
        chosenAudio = next.audio || v.audio;
        maxBitrate = next.maxBitrate || null;
        forceStream = !!next.forceStream;
        verdict = v;
        render();
      });
  }

  /* ---------- the action row ---------- */

  /* The track the guard picks for a copy on its own — anything else is the
     user's, and costs direct play unless the panel can select it. */
  function defaultAudio() {
    var base = sources[sel] && sources[sel].verdict;
    return (base && base.audio) || null;
  }

  /* Whether this pipeline exposes audioTracks, which is the whole difference
     between switching a track for nothing and asking the server to mux one. */
  function panelOwnsAudio() {
    return Panel.features().audioTracks !== 'no';
  }

  function part() { return verdict && verdict.part; }

  function sourceRows() {
    return sources.map(function (src, n) {
      var name = (src.server && src.server.name) || 'server';
      if (Servers.count() > 1 && Servers.isPreferred(src.server)) name += ' · preferred';
      return { label: Media.versionLabel(src.media) + ' · ' + name,
               note: Guard.label(src.verdict),
               on: n === sel, value: n };
    });
  }

  function qualityRows() {
    var media = sources[sel] && sources[sel].media;
    return Media.qualities(media).map(function (q) {
      return { label: q.label,
               note: q.bitrate && Media.isUHD(media)
                 ? 'a 4K transcode is what gets the stream killed — this will be refused' : '',
               on: (q.bitrate || null) === maxBitrate,
               value: q.bitrate || null };
    });
  }

  /* Would choosing this track mean giving up direct play? Only when the panel
     cannot select tracks out of the file itself and this is not the track the
     guard picks anyway — the note and the guard call are both this, so what the
     row says before OK is what OK does. */
  function needsMux(st) {
    if (panelOwnsAudio()) return false;
    var base = defaultAudio();
    return !(base && String(base.id) === String(st.id));
  }

  function audioRows() {
    return Media.audioTracks(part()).map(function (st) {
      var on = !!(chosenAudio && String(chosenAudio.id) === String(st.id));
      return { label: Media.audioMenuLabel(st),
               note: on ? '' : (needsMux(st) ? 'costs direct play — the server would mux it'
                                             : 'keeps direct play'),
               on: on, value: st };
    });
  }

  function subRows() {
    var out = [{ label: 'Off', on: !chosenSub, value: null }];
    Media.subtitleTracks(part()).forEach(function (st) {
      out.push({ label: Media.subLabel(st),
                 note: Media.isTextSub(st) ? '' : 'image track — it would have to be burnt in',
                 on: !!(chosenSub && String(chosenSub.id) === String(st.id)),
                 value: st });
    });
    return out;
  }

  /* "1:12" — where a part-watched film would pick up. */
  function atLabel(ms) {
    var mins = Math.floor(ms / 60000);
    return Math.floor(mins / 60) + ':' + (mins % 60 < 10 ? '0' : '') + (mins % 60);
  }

  /* Play says what it will do and what it will cost, because both are decided
     by the buttons beside it. */
  function playCaption() {
    var at = (item && item.viewOffset) || 0;
    return (at > 10000 ? 'resume at ' + atLabel(at) : 'from start') +
           '  ·  ' + (verdict ? Guard.label(verdict) : 'checking…');
  }

  function sourceCaption() {
    var src = sources[sel];
    return (src && src.server && src.server.name) || 'checking…';
  }

  function qualityCaption() {
    if (maxBitrate) return Media.bitrateLabel(maxBitrate) + ' converted';
    return Media.versionLabel(sources[sel] && sources[sel].media);
  }

  /* Six at most: Play, then the extras, then the three things about the copy
     that can be chosen. Trailer is only here when there is one. */
  function actions() {
    var out = [{ label: 'Play', primary: true, caption: playCaption(),
                 run: function () { start(verdict, false); } }];
    if (extras.length) {
      out.push({ glyph: GLYPHS.trailer, caption: extras[0].title,
                 run: function () { start(extras[0].verdict, true); } });
    }
    out.push({ glyph: GLYPHS.quality, caption: qualityCaption(), run: openQuality });
    out.push({ glyph: GLYPHS.source, caption: sourceCaption(), run: openSource });
    out.push({ glyph: GLYPHS.audio, run: openAudio,
               caption: chosenAudio ? Media.audioLabel(chosenAudio) : 'checking…' });
    out.push({ glyph: GLYPHS.subs, caption: Media.subLabel(chosenSub), run: openSubs });
    return out;
  }

  function renderActions() {
    var list = actions(), html = '', i, a;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      html += '<div class="dt-act' + (a.primary ? ' primary' : '') +
              (strip === 0 && i === idx ? ' on' : '') + '">' +
              '<div class="dt-act-btn">' + (a.glyph || UI.escapeHtml(a.label)) + '</div>' +
              '<div class="dt-act-cap">' + UI.escapeHtml(a.caption) + '</div>' +
              '</div>';
    }
    elActions.innerHTML = html;
  }

  /* The chooser sits under the button that opened it, clamped so a button near
     the end of the row does not push it off the screen. */
  function openChooser(tab, onChoose) {
    var btn = elActions.children[idx];
    elMenu.style.left = UI.clamp(64 + (btn ? btn.offsetLeft : 0), 64, 1000) + 'px';
    Menu.open({ host: elMenu, tabs: [tab], onChoose: onChoose, onClose: render });
  }

  function openSource() {
    openChooser({ label: 'Play from', rows: sourceRows,
                  note: 'Every copy on every server, each already checked.' },
      function (n) {
        if (n === sel) return;
        choose({ sel: n, audio: null, maxBitrate: null, forceStream: false });
      });
  }

  function openQuality() {
    openChooser({ label: 'Quality', rows: qualityRows,
                  note: 'Anything but Original asks the server to re-encode.' },
      function (kbps) {
        if ((kbps || null) === maxBitrate) return;
        choose({ sel: sel, audio: chosenAudio, maxBitrate: kbps, forceStream: forceStream });
      });
  }

  function openAudio() {
    openChooser({ label: 'Audio', rows: audioRows }, function (st) {
      if (chosenAudio && String(chosenAudio.id) === String(st.id)) return;
      /* A direct play hands the panel the whole file and the panel picks its own
         track, so a choice it cannot make itself means asking the server to mux
         — which on a 4K file the guard refuses, and rightly. */
      choose({ sel: sel, audio: st, maxBitrate: maxBitrate, forceStream: needsMux(st) });
    });
  }

  /* Subtitles never reach the guard: they are fetched as text and drawn over the
     video by js/subs.js, so they cost the server one GET and change nothing
     about the stream. An image track is the exception — the only way to show one
     is to have it burnt in, which is a transcode. */
  function openSubs() {
    openChooser({ label: 'Subtitles', rows: subRows,
                  note: 'Drawn over the video as text, so they cost the server nothing.' },
      function (st) {
        if (st && !Media.isTextSub(st)) {
          UI.toast('Kept as it was — an image track would have to be burnt in');
          return;
        }
        chosenSub = st;
        render();
      });
  }

  /* ---------- the extras strip ---------- */

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

  function render() {
    adoptDefault();
    renderActions();

    var html = '', i;
    for (i = 0; i < extras.length; i++) {
      html += extraCard(extras[i], strip === 1 && i === idx);
    }
    elExtras.innerHTML = html;
    elExtrasLabel.classList.toggle('hidden', extras.length === 0);
    /* The quality chip names the copy that would play, so it follows the
       Source button. */
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
    return names.join('  ·  ');
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

  /* The quality of the copy that would play if Play were pressed now. HDR only
     when the server says so — a claim we cannot check is worse than silence. */
  function qualityChip() {
    var src = sources[sel];
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

  /* Hand a verdict to the caller, or say why there is nothing to hand over. A
     refusal is the long form on the message screen: this is the one moment the
     user has asked for the whole story. */
  function start(v, isExtra) {
    if (!v) { UI.toast('Still checking that copy…'); return; }
    if (!v.ok) {
      var why = Guard.refusal(item, v);
      UI.message(why[0], why[1]);
      return;
    }
    if (opts.onPlay) {
      opts.onPlay(item, v, isExtra, isExtra ? null : (chosenSub && chosenSub.languageCode));
    }
  }

  function key(code) {
    var K = UI.KEY;
    if (Menu.isOpen()) return Menu.key(code);
    var last = (strip === 0 ? actions().length : extras.length) - 1;

    if (code === K.LEFT && idx > 0) { idx--; render(); return true; }
    if (code === K.RIGHT && idx < last) { idx++; render(); return true; }
    if (code === K.DOWN && strip === 0 && extras.length) {
      strip = 1; idx = 0; render(); return true;
    }
    if (code === K.UP && strip === 1) { strip = 0; idx = 0; render(); return true; }
    if (code === K.OK) {
      var a = strip === 0 ? actions()[idx] : null;
      if (a) a.run(); else start(extras[idx] && extras[idx].verdict, true);
      return true;
    }
    if (UI.isBack(code)) { close(); return true; }
    return true;                      // this page swallows everything else
  }

  /* The film currently open, so the message screen knows to come back here
     rather than dropping to the rail. */
  function current() { return item; }

  return { open: open, key: key, current: current };
})();
