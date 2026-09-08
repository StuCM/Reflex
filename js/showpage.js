/* A show: its series across the top, its episodes down the side.

   The episode list is where playback actually starts, so each row carries the
   same verdict the detail page would give it — checked for the focused episode
   as you move, against the preferred server's copy. OK plays when that copy
   will direct play, and opens the copy chooser when it will not, which is the
   only time you need to care which server an episode came from. */
var ShowPage = (function () {
  'use strict';

  var elTitle = document.getElementById('sh-title');
  var elMeta = document.getElementById('sh-meta');
  var elSummary = document.getElementById('sh-summary');
  var elSeasons = document.getElementById('sh-seasons');
  var elEpisodes = document.getElementById('sh-episodes');
  var elArt = document.getElementById('sh-art');
  var elHint = document.getElementById('sh-hint');
  var elRecaps = document.getElementById('sh-recaps');
  var elHead = document.getElementById('sh-head');
  var elTheme = document.getElementById('theme');

  var EPISODE_POOL = 6;          // episode rows on screen at once, at 111px each
  var EPISODE_LEAD = 3;          // rows kept above the focused one
  var RECAP_POOL = 7;            // recap cards on screen at once, at 222px each
  var RECAP_LEAD = 2;

  var show = null;
  var seasons = [], seasonIdx = 0;
  var episodes = [], epIdx = 0;
  var zone = 'episodes';         // 'seasons' | 'episodes' | 'recaps'
  var recaps = null;             // null until searched, then the list, empty or not
  var recapIdx = 0;
  var searching = false;
  var wantEp = null;             // options.at.episode, honoured on the first load only
  var opts = {};
  var generation = 0;
  var verdicts = {};             // ratingKey -> verdict, for the rows
  var checkTimer = null;

  /* options.at = { season, episode } opens on a named episode — Plex's own
     index values, not array positions. Without it the page opens where it
     always did. */
  function open(entry, options) {
    if (!entry) return;
    show = entry;
    opts = options || {};
    wantEp = (opts.at && opts.at.episode !== undefined) ? opts.at.episode : null;
    generation++;
    seasons = []; episodes = []; seasonIdx = 0; epIdx = 0; zone = 'episodes';
    verdicts = {};
    recaps = null; recapIdx = 0; searching = false;

    UI.show('show');
    paintHeader();
    silence();                   // whatever the last series was, it is over
    playTheme();
    renderRecaps();
    elSeasons.innerHTML = '';
    elEpisodes.innerHTML = '<div class="sh-episode">Loading…</div>';

    var gen = generation;
    Shows.seasons(entry).then(function (list) {
      if (gen !== generation) return;
      seasons = list;
      seasonIdx = openSeason(list);
      renderSeasons();
      if (!list.length) {
        elEpisodes.innerHTML = '<div class="sh-episode">This server lists no series for ' +
                               'this show.</div>';
        return;
      }
      loadEpisodes();
    }).catch(function (e) {
      if (gen !== generation) return;
      UI.debug('seasons: ' + e.message);
      elEpisodes.innerHTML = '<div class="sh-episode">Could not read the series list.</div>';
    });
  }

  function openSeason(list) {
    var want = opts.at && opts.at.season, i;
    if (want !== undefined && want !== null) {
      for (i = 0; i < list.length; i++) if (list[i].index === want) return i;
    }
    return Shows.openAt(list);
  }

  function close() {
    clearTimeout(checkTimer);
    silence();
    show = null;
    if (opts.onExit) opts.onExit();
  }

  /* ---------- painting ---------- */

  function paintHeader() {
    elTitle.textContent = show.title || '';
    elSummary.textContent = show.summary || '';
    var bits = [];
    if (show.year) bits.push(show.year);
    var counts = Shows.summary(show);
    if (counts) bits.push(counts);
    if (show.contentRating) bits.push(show.contentRating);
    if (Merge.isShared(show)) bits.push('on ' + Merge.sources(show).length + ' servers');
    elMeta.textContent = bits.join('   ·   ');
    var art = Plex.artUrl(show, 960, 540);
    elArt.style.backgroundImage = art ? 'url("' + art + '")' : 'none';
  }

  function renderSeasons() {
    var html = '', i, cls;
    for (i = 0; i < seasons.length; i++) {
      cls = 'chip' + (i === seasonIdx ? ' cur' : '') +
            (zone === 'seasons' && i === seasonIdx ? ' on' : '');
      html += '<span class="' + cls + '">' + UI.escapeHtml(seasons[i].title || ('Series ' + (i + 1))) +
              '</span>';
    }
    elSeasons.innerHTML = html;
  }

  function verdictHtml(ep) {
    var v = verdicts[verdictKey(ep)];
    if (!v) return '';
    var state = v.ok ? 'good' : (v.state === 'noaudio' ? 'bad' : 'warn');
    return '<span class="badge ' + state + ' sh-verdict">' +
           UI.escapeHtml(Guard.label(v)) + '</span>';
  }

  function verdictKey(ep) { return ep._server + ':' + ep.ratingKey; }

  function renderEpisodes() {
    if (!episodes.length) {
      elEpisodes.innerHTML = '<div class="sh-episode">No episodes in this series.</div>';
      return;
    }
    /* A window, not the lot: a 24-episode series is common and drawing all of
       them costs more than it is worth. */
    var first = UI.clamp(epIdx - EPISODE_LEAD, 0, Math.max(0, episodes.length - EPISODE_POOL));
    var html = '', i, ep, on, watched, still;
    for (i = first; i < Math.min(first + EPISODE_POOL, episodes.length); i++) {
      ep = episodes[i];
      on = (i === epIdx && zone === 'episodes');
      watched = ep.viewOffset && ep.duration
        ? Math.round(100 * ep.viewOffset / ep.duration) + '%'
        : (ep.viewCount ? 'watched' : '');
      /* An episode's thumb *is* its still, so the picture is already paid for. */
      still = Plex.posterUrl(ep, 160, 90);
      html += '<div class="sh-episode' + (on ? ' on' : '') + '">' +
              '<span class="sh-ep-still"' +
              (still ? ' style="background-image:url(' + UI.escapeHtml(still) + ')"' : '') +
              '></span>' +
              '<span class="sh-ep-num">' + (ep.index === undefined ? '·' : ep.index) + '</span>' +
              '<span class="sh-ep-title">' + UI.escapeHtml(ep.title || '') + '</span>' +
              '<span class="sh-ep-mins">' +
              (ep.duration ? Math.round(ep.duration / 60000) + ' min' : '') + '</span>' +
              '<span class="sh-ep-seen">' + UI.escapeHtml(watched) + '</span>' +
              verdictHtml(ep) +
              '</div>';
    }
    elEpisodes.innerHTML = html;
    elHint.textContent = hint();
  }

  function hint() {
    if (zone === 'seasons') return '← → choose a series · ↓ to the episodes · BACK to the rail';
    if (zone === 'recaps') {
      return recaps && recaps.length
        ? '← → choose a recap · OK to play it · ↑ back to the episodes'
        : 'OK to look for season recaps · ↑ back to the episodes';
    }
    return '↑ ↓ choose an episode · OK to play · → other copies · BACK to the rail';
  }

  /* The recaps strip, which costs nothing to draw: one action until it is
     pressed, then the rail it turned into. Entering the zone lifts the episode
     list to make room — a transform, not a height. */
  function renderRecaps() {
    if (!Youtube.enabled()) { elRecaps.innerHTML = ''; return; }
    var on = zone === 'recaps';
    elHint.textContent = hint();
    elRecaps.classList.toggle('open', on);
    /* The whole column moves, or the episode rows would slide over the title. */
    elHead.classList.toggle('lifted', on);
    elSeasons.classList.toggle('lifted', on);
    elEpisodes.classList.toggle('lifted', on);
    if (!recaps || !recaps.length) {
      elRecaps.innerHTML = '<div class="sh-recap sh-recap-action' + (on ? ' on' : '') + '">' +
        (searching ? 'Searching…' : (recaps ? 'No recaps found' : 'Find recaps')) + '</div>';
      return;
    }
    var first = UI.clamp(recapIdx - RECAP_LEAD, 0, Math.max(0, recaps.length - RECAP_POOL));
    var html = '', i, r;
    for (i = first; i < Math.min(first + RECAP_POOL, recaps.length); i++) {
      r = recaps[i];
      html += '<div class="sh-recap' + (on && i === recapIdx ? ' on' : '') + '">' +
              '<span class="sh-recap-thumb"' +
              (r.thumb ? ' style="background-image:url(' + UI.escapeHtml(r.thumb) + ')"' : '') +
              '></span>' +
              '<span class="sh-recap-title">' + UI.escapeHtml(r.title) + '</span>' +
              '<span class="sh-recap-len">' + UI.escapeHtml(r.length) + '</span>' +
              '</div>';
    }
    elRecaps.innerHTML = html;
  }

  /* A search is 100 units of the day's 10,000, so it happens on a press and
     never on a page opening — and a show already searched is read back from the
     cache, empty answer included. */
  function findRecaps() {
    if (searching || recaps) return;
    searching = true;
    renderRecaps();
    var gen = generation, title = show.title || '';
    var key = 'recaps:' + Media.identity(show);
    Store.get(key).then(function (cached) {
      if (cached) return cached;
      return Youtube.recaps(title).then(function (items) {
        var list = Youtube.pickForShow(Youtube.parse(items), title);
        Store.put(key, list);
        return list;
      });
    }).then(function (list) {
      if (gen !== generation) return;
      searching = false;
      recaps = list;
      recapIdx = 0;
      renderRecaps();
    }, function (e) {
      if (gen !== generation) return;
      UI.debug('recaps: ' + e.message);
      /* Nothing was learnt, so the action goes back to being untried rather
         than claiming this show has no recaps. */
      searching = false;
      renderRecaps();
      UI.toast('Could not search for recaps');
    });
  }

  /* ---------- the theme tune ----------

     Shows have one, films do not. It is a static file on the server, so playing
     it costs a GET and nothing else: no decision, no session, nothing a
     kill-stream rule would ever see. */

  var THEME_VOL = 0.35;           // quiet: it announces the show, it is not the show
  var FADE_STEP = 40;             // ms between volume steps while fading in
  var fadeTimer = null;
  var themeOn = null;             // read from storage once, then cached

  /* Whether a series' theme plays when its page opens. Storage that refuses us
     reads as on, because on is what was asked for. */
  function themePlays() {
    if (themeOn !== null) return themeOn;
    var stored = null;
    try { stored = localStorage.getItem('reflex.theme'); } catch (e) { stored = null; }
    themeOn = stored !== 'off';
    return themeOn;
  }

  /* on → off → on, persisted; the sidebar cycles it the way it cycles autoplay. */
  function cycleTheme() {
    themeOn = !themePlays();
    try { localStorage.setItem('reflex.theme', themeOn ? 'on' : 'off'); } catch (e) { /* private mode */ }
    if (!themeOn) silence();
    return themeOn;
  }

  /* 'on' or 'off' — what the sidebar entry and its toast say. */
  function themeLabel() { return themePlays() ? 'on' : 'off'; }

  /* A show with no theme is the ordinary case, so this says nothing about it. */
  function playTheme() {
    var url = themePlays() ? Plex.themeUrl(Servers.of(show), show) : '';
    if (!url) return;
    elTheme.loop = true;
    elTheme.volume = 0;
    elTheme.src = url;
    var started = elTheme.play();
    /* The platform may refuse to start audio nobody asked for. That is an
       answer, not a fault: say so once and stay silent. */
    if (started && started.catch) {
      started.catch(function (e) { UI.debug('theme: ' + e.message); });
    }
    fadeIn();
  }

  function fadeIn() {
    var span = parseFloat(getComputedStyle(document.documentElement)
                            .getPropertyValue('--t-move')) || 340;
    var step = THEME_VOL / Math.max(1, Math.round(span / FADE_STEP));
    clearInterval(fadeTimer);
    fadeTimer = setInterval(function () {
      var v = elTheme.volume + step;
      if (v < THEME_VOL) { elTheme.volume = v; return; }
      elTheme.volume = THEME_VOL;
      clearInterval(fadeTimer);
      fadeTimer = null;
    }, FADE_STEP);
  }

  /* Stops the theme dead — paused, rewound, and the source dropped, because a
     paused element still holding a source is still holding the audio pipeline.
     Anything that wants the audio calls this first. */
  function silence() {
    clearInterval(fadeTimer);
    fadeTimer = null;
    if (!elTheme.getAttribute('src')) return;
    elTheme.pause();
    elTheme.currentTime = 0;
    elTheme.removeAttribute('src');
    elTheme.load();
  }

  /* ---------- loading ---------- */

  function loadEpisodes() {
    var gen = generation;
    var season = seasons[seasonIdx];
    /* The episode we were opened at is for this load only: switching series
       afterwards goes back to landing on the first unfinished one. */
    var want = wantEp;
    wantEp = null;
    episodes = [];
    epIdx = 0;
    elEpisodes.innerHTML = '<div class="sh-episode">Loading…</div>';
    Shows.episodes(season).then(function (list) {
      if (gen !== generation) return;
      episodes = list;
      /* Land on the episode we were opened at, or failing that the first
         unfinished one: what you want is almost always the next one. */
      var i, hit;
      for (i = 0; i < list.length; i++) {
        hit = want === null ? (list[i].viewOffset || !list[i].viewCount)
                            : list[i].index === want;
        if (hit) { epIdx = i; break; }
      }
      renderEpisodes();
      scheduleCheck();
    }).catch(function (e) {
      if (gen !== generation) return;
      UI.debug('episodes: ' + e.message);
      elEpisodes.innerHTML = '<div class="sh-episode">Could not read the episode list.</div>';
    });
  }

  /* The focused episode gets checked, once you have stopped moving. Everything
     the guard does is either cached or a hasMDE=1 query, so this costs the
     server a query per episode you rest on and opens no sessions. */
  function scheduleCheck() {
    clearTimeout(checkTimer);
    var ep = episodes[epIdx];
    if (!ep || verdicts[verdictKey(ep)]) return;
    var gen = generation;
    checkTimer = setTimeout(function () {
      Guard.check(ep, 0).then(function (v) {
        if (gen !== generation) return;
        verdicts[verdictKey(ep)] = v;
        renderEpisodes();
      });
    }, 300);
  }

  /* ---------- keys ---------- */

  function playFocused() {
    var ep = episodes[epIdx];
    if (!ep) return;
    var v = verdicts[verdictKey(ep)];
    /* Not checked yet, or the preferred copy will not play: the detail page is
       where every copy is listed, so send them there rather than guessing. */
    if (!v || !v.ok) { openCopies(); return; }
    if (opts.onPlay) opts.onPlay(ep, v);
  }

  function openCopies() {
    var ep = episodes[epIdx];
    if (ep && opts.onChoose) opts.onChoose(ep);
  }

  /* OK in the recaps zone is either the search or one of its results. */
  function chooseRecap() {
    if (!recaps) { findRecaps(); return; }
    var video = recaps[recapIdx];
    if (video && opts.onRecap) opts.onRecap(video);
  }

  function key(code) {
    var K = UI.KEY;

    if (zone === 'seasons') {
      if (code === K.LEFT && seasonIdx > 0) { seasonIdx--; renderSeasons(); loadEpisodes(); return true; }
      if (code === K.RIGHT && seasonIdx < seasons.length - 1) {
        seasonIdx++; renderSeasons(); loadEpisodes(); return true;
      }
      if (code === K.DOWN || code === K.OK) {
        zone = 'episodes'; renderSeasons(); renderEpisodes(); return true;
      }
      if (UI.isBack(code)) { close(); return true; }
      return true;
    }

    if (zone === 'recaps') {
      if (code === K.UP) { zone = 'episodes'; renderEpisodes(); renderRecaps(); return true; }
      if (code === K.LEFT && recapIdx > 0) { recapIdx--; renderRecaps(); return true; }
      if (code === K.RIGHT && recaps && recapIdx < recaps.length - 1) {
        recapIdx++; renderRecaps(); return true;
      }
      if (code === K.OK) { chooseRecap(); return true; }
      if (UI.isBack(code)) { close(); return true; }
      return true;
    }

    if (code === K.UP) {
      if (epIdx > 0) { epIdx--; renderEpisodes(); scheduleCheck(); }
      else { zone = 'seasons'; renderSeasons(); renderEpisodes(); }
      return true;
    }
    if (code === K.DOWN) {
      if (epIdx < episodes.length - 1) { epIdx++; renderEpisodes(); scheduleCheck(); return true; }
      /* Past the last episode is the recaps strip, when there is a key for it. */
      if (Youtube.enabled()) { zone = 'recaps'; renderEpisodes(); renderRecaps(); }
      return true;
    }
    if (code === K.RIGHT) { openCopies(); return true; }
    if (code === K.OK) { playFocused(); return true; }
    if (UI.isBack(code)) { close(); return true; }
    return true;                     // this page swallows everything else
  }

  function current() { return show; }

  return { open: open, key: key, current: current, silence: silence,
           cycleTheme: cycleTheme, themeLabel: themeLabel };
})();
