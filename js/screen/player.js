/* Playback, and everything you can do while it runs.

   What the panel is handed is decided before we get here — js/guard.js says
   whether a copy may play and at what cost, and nothing reaches this file
   without a verdict. What is left is the part the stock app does badly on this
   set: knowing where you are, getting somewhere else quickly, and changing the
   audio, the subtitles or the quality without going back to the film page.

   Three of those four are a restart. The panel picks its own audio track out of
   a direct-played file and cannot be told otherwise, so honouring a choice
   means asking the server for that track and starting again from where we
   were; the same is true of a quality cap or another version of the film. Each
   one goes back through the guard first, which is why a 4K file will refuse a
   quality cap — asking for a cap is asking for a transcode.

   Subtitles are the exception, and deliberately: they are fetched as text and
   drawn over the video by js/subs.js, so switching one costs a single GET and
   no restart. Burning them in would be a transcode. */
var Player = (function () {
  'use strict';

  const v = document.getElementById('video');
  const osd = document.getElementById('osd');
  const osdTitle = document.getElementById('osd-name');
  const osdTime = document.getElementById('osd-time');
  const osdTotal = document.getElementById('osd-total');
  const osdFill = document.getElementById('osd-fill');
  const osdBuffered = document.getElementById('osd-buffered');
  const osdTicks = document.getElementById('osd-ticks');
  const osdBar = document.getElementById('osd-bar');
  const osdKnob = document.getElementById('osd-knob');
  const osdLeft = document.getElementById('osd-left');
  const osdRight = document.getElementById('osd-right');
  const osdHint = document.getElementById('osd-hint');
  const chapEl = document.getElementById('osd-chapters');
  const chapInner = document.getElementById('osd-chapters-inner');
  const skipEl = document.getElementById('osd-skip');
  const nextEl = document.getElementById('upnext');
  const nextStillEl = document.getElementById('un-still');
  const nextShowEl = document.getElementById('un-show');
  const nextTitleEl = document.getElementById('un-title');
  const nextHintEl = document.getElementById('un-hint');
  const subEl = document.getElementById('subtitle');
  const menuEl = document.getElementById('menu');

  const BAR_W = 1300; // #osd-bar, in CSS pixels
  const CARD_W = 260; // .osd-chap plus its margin
  const CARDS_SHOWN = 6;
  const SEEK_SETTLE = 400; // ms of stillness before a seek is applied
  const NUDGE = 30; // left / right, seconds
  const JUMP = 300; // rewind / fast forward, seconds

  let item = null;
  let server = null;
  let onExit = null;
  let onError = null;
  let onSwitch = null;
  let onNext = null;
  let onPlayNext = null;
  let currentPart = null;
  let currentAudio = null;
  let currentMedia = null;
  let mediaIndex = 0;
  let maxBitrate = null;
  let transcoding = false;
  let forceStream = false;
  let ticker = null;
  let osdTimer = null;
  let resumeMs = 0;

  /* A stall is the thing you actually see as a blip, and it is over before the
     ten-second sample comes round. Count them instead. */
  let stalls = 0;
  let lowest = 999;
  let startedAt = 0;

  /* Where a run of seek presses is heading. Every currentTime assignment on a
     direct-played file is a real seek — a range request, a decoder flush — so
     holding the key would otherwise fire one per press and fight the network
     the whole way. Accumulate, show where you are going, apply once you stop. */
  let pending = null;
  let seekTimer = null;

  /* Subtitles: the parsed cues, which track they came from, and the language
     the user asked for. The language is what survives a restart — after a
     switch to another version the stream ids are different, but "French" still
     means the same thing. */
  let cues = [];
  let currentSub = null;
  let wantedLang = null;
  let subToken = 0;
  let subNote = '';

  /* The skip prompt. The menu is js/menu.js and keeps its own state. */
  let marker = null;

  /* Focus is a mode, and that is the only reason every key CLAUDE.md documents
     goes on meaning what it says: in 'none' the arrows seek, in 'bar' they
     scrub the trackbar, in 'row' they walk the buttons — and ctl says which
     button. Which panel is open under the row, and where the chapter rail is,
     are separate. */
  let focus = 'none';
  let ctl = -1;
  let openPanel = null;
  let chapSel = 0;

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor(sec / 60) % 60;
    const s = sec % 60;
    const mm = (m < 10 ? '0' : '') + m;
    const ss = (s < 10 ? '0' : '') + s;
    return h ? h + ':' + mm + ':' + ss : m + ':' + ss;
  }

  /* A live or badly-muxed stream reports Infinity, and every sum here divides
     by this — so fall back to what the server said the film runs to. */
  function duration() {
    const d = v.duration;
    if (d && isFinite(d)) return d;
    return ((item && item.duration) || 0) / 1000;
  }

  /* Where the picture will be once any pending seek lands — that is what the
     user is aiming at, so that is what the bar and the clock have to show. */
  function target() {
    return pending === null ? v.currentTime || 0 : pending;
  }

  /* ---------- the OSD ----------

     Two separate things: painting the time, and putting the OSD back on screen
     for another few seconds. Repainting must not reset the hide timer, or the
     OSD would never go away once playback started. */

  function paintOsd() {
    let at = target();
    const dur = duration();
    const left = dur ? Math.max(0, dur - at) : 0;

    osdTime.textContent = fmt(at) + (pending !== null ? '   SEEKING' : v.paused ? '   PAUSED' : '');
    osdTotal.textContent = fmt(dur) + (dur ? `   ·   ${fmt(left)} left` : '');

    const x = dur ? Math.round((BAR_W * Math.min(at, dur)) / dur) : 0;
    osdFill.style.width = x + 'px';
    /* transform, not left: the knob moves on every timeupdate and this is the
       one property the panel can move without a layout pass. */
    osdKnob.style.webkitTransform =
      osdKnob.style.transform = `translateX(${Math.min(x, BAR_W - 6)}px)`;

    let ahead = 0;
    try {
      if (v.buffered && v.buffered.length) ahead = v.buffered.end(v.buffered.length - 1);
    } catch (e) {
      ahead = 0;
    }
    osdBuffered.style.width = dur ? Math.round((BAR_W * Math.min(ahead, dur)) / dur) + 'px' : '0';
  }

  /* Chapters as ticks, markers as bands. Drawn once, when the duration is
     known — they do not move, and rebuilding them on every frame is exactly
     the kind of work this panel cannot afford. */
  function paintTicks() {
    const dur = duration();
    if (!dur) {
      osdTicks.innerHTML = '';
      return;
    }
    let html = '';
    const list = Media.chapters(item);
    let i;

    const markers = (item && item.Marker) || [];
    for (i = 0; i < markers.length; i++) {
      const at = Math.round((BAR_W * ((markers[i].startTimeOffset || 0) / 1000)) / dur);
      const wide = Math.max(
        2,
        Math.round(
          (BAR_W * (((markers[i].endTimeOffset || 0) - (markers[i].startTimeOffset || 0)) / 1000)) /
            dur,
        ),
      );
      html += `<i class="osd-band" style="left:${at}px;width:${wide}px"></i>`;
    }
    for (i = 0; i < list.length; i++) {
      if (list[i].start <= 0) continue;
      html +=
        '<i class="osd-tick" style="left:' + Math.round((BAR_W * list[i].start) / dur) + 'px"></i>';
    }
    osdTicks.innerHTML = html;
  }

  function showOsd() {
    paintOsd();
    osd.classList.remove('hidden');
    osd.style.opacity = '1';
    subEl.classList.add('lifted');
    clearTimeout(osdTimer);
    /* While a seek is still being aimed, the OSD is the only feedback there is,
       so it stays until the seek lands. The menu keeps it up too — it sits
       above the bar and reads as one panel. */
    osdTimer = setTimeout(() => {
      if (pending !== null || Menu.isOpen() || openPanel || focus !== 'none') {
        showOsd();
        return;
      }
      osd.style.opacity = '0';
      subEl.classList.remove('lifted');
    }, 4000);
  }

  function osdShowing() {
    return osd.style.opacity !== '0' && !osd.classList.contains('hidden');
  }

  function hint() {
    if (openPanel === 'chapters') {
      osdHint.textContent = '◀ ▶ chapter · OK jump there · BACK close';
    } else if (Menu.isOpen()) {
      osdHint.textContent = '▲ ▼ choose · OK select · BACK close';
    } else if (focus === 'row') {
      osdHint.textContent = '◀ ▶ control · OK open it · ▲ trackbar · ▼ back to playback';
    } else if (focus === 'bar') {
      osdHint.textContent = '◀ ▶ scrub · OK seek there · ▼ controls · BACK back to playback';
    } else {
      osdHint.textContent =
        `◀ ▶ ${NUDGE}s · ▲ trackbar · ▼ controls · 0–9 jump · ` + 'CH± chapter · OK pause';
    }
  }

  /* Move between the three modes. Leaving for playback forgets which button the
     row was on; the trackbar says so with the knob's ring. */
  function setFocus(to) {
    focus = to;
    if (to === 'none') ctl = -1;
    else if (to === 'row' && ctl < 0) ctl = indexOfCtl('audio');
    osdBar.classList.toggle('foc', to === 'bar');
  }

  /* ---------- choosing the audio track ----------

     The thing that is easy to get wrong, and was: on a DIRECT PLAY the server
     hands over the original file, whole, with every track still in it. The
     `audioStreamID` sent with the decision call is advice to the decision
     engine and changes not one byte of that file, so the panel goes on playing
     whichever track it prefers — the first one. Restarting playback with a
     different id therefore did nothing at all, while the OSD cheerfully named
     the track we had asked for.

     There are exactly two ways to actually be listening to a chosen track:

       1. The panel exposes audioTracks and lets us select one. Free, instant,
          no server involvement, no restart. This is the good case, and
          js/panel.js reports on the chip whether it is available.
       2. Failing that, the server has to mux the stream itself, which means
          giving up direct play — a real session on someone else's hardware,
          and on a 4K file a refusal. That is the honest price of choosing, and
          it is only paid when the panel will not choose for us. */

  /* The panel's own track list, or null when it does not have one. Only useful
     once metadata has loaded, so never cached. */
  function panelTracks() {
    const list = v.audioTracks;
    if (!list || typeof list.length !== 'number' || list.length < 2) return null;
    return list;
  }

  /* Which entry of the panel's list is this Plex stream? The file's audio
     streams and the pipeline's track list are the same tracks in the same
     order — but only if they are the same length. If they are not, we do not
     know what we are looking at, and guessing would select the wrong track
     silently, which is the bug this whole section exists to fix. */
  function panelIndexOf(st) {
    const tracks = Media.audioTracks(currentPart);
    const list = panelTracks();
    if (!list || list.length !== tracks.length) return -1;
    for (let i = 0; i < tracks.length; i++) {
      if (String(tracks[i].id) === String(st.id)) return i;
    }
    return -1;
  }

  function selectPanelTrack(n) {
    const list = panelTracks();
    if (!list || n < 0 || n >= list.length) return false;
    for (let i = 0; i < list.length; i++) {
      if (list[i]) list[i].enabled = i === n;
    }
    /* Trust nothing: read it back. A pipeline that exposes the list read-only
       would otherwise look like a successful switch and sound like the old
       track — the exact failure being fixed. */
    return !!(list[n] && list[n].enabled);
  }

  /* Is the track named on screen the track you are hearing? Only if we chose
     it: the server muxed the stream, or the panel let us select it. */
  function audioIsOurs() {
    return transcoding || Media.audioTracks(currentPart).length < 2 || !!panelTracks();
  }

  /* The track the guard picked is a promise the masthead already made before
     OK was pressed. If the panel lets us keep that promise, keep it at once
     rather than waiting to be asked — otherwise the first thing you hear is
     whatever the file happens to list first, which on a remux is routinely
     the one track that cannot cross ARC. */
  function applyChosenTrack() {
    if (!currentAudio || transcoding) return;
    const n = panelIndexOf(currentAudio);
    if (n < 0) {
      paintControls();
      return;
    }
    const list = panelTracks();
    if (list[n] && list[n].enabled) return; // already right, say nothing
    if (selectPanelTrack(n)) {
      UI.debug(`audio set on the panel (track ${n}): ${Media.audioLabel(currentAudio)}`);
    }
    paintControls();
  }

  function chooseAudio(st) {
    if (currentAudio && String(currentAudio.id) === String(st.id)) return;
    const n = panelIndexOf(st);
    if (n >= 0 && selectPanelTrack(n)) {
      /* The good case: the panel switched it, nothing restarted, the server
         was not asked for anything. */
      currentAudio = st;
      UI.debug(`audio switched on the panel (track ${n}): ${Media.audioLabel(st)}`);
      paintControls();
      showOsd();
      return;
    }
    switchTo({ audioId: st.id, forceStream: true }, Media.audioMenuLabel(st));
  }

  /* ---------- the control row ----------

     Transport on the left, the four things that can be changed on the right.
     Each right-hand button is captioned with what is chosen NOW rather than
     what is highlighted, because the caption is what you read before deciding
     to open anything; the violet ring says which panel is open. */

  /* Inlined, as everywhere else here: the app runs from file:// on the TV, so
     there is no icon font to fetch. */

  function audioCaption() {
    return Media.audioMenuLabel(currentAudio) + (audioIsOurs() ? '' : ' — panel’s choice');
  }

  function subCaption() {
    return (currentSub ? Media.subLabel(currentSub) : 'off') + (subNote ? ` — ${subNote}` : '');
  }

  function qualityCaption() {
    return maxBitrate
      ? Media.bitrateLabel(maxBitrate) + ' converted'
      : Media.versionLabel(currentMedia);
  }

  function chapterCaption() {
    const here = chapterAt(Media.chapters(item), target());
    return here ? here.title : 'none';
  }

  /* The three transport buttons, then the four choices. The order is the order
     on screen, and the index into it is what the arrows move. */
  function controls() {
    return [
      {
        glyph: Glyphs.rewind,
        run: () => {
          seekBy(-JUMP);
        },
      },
      { glyph: v.paused ? Glyphs.play : Glyphs.pause, run: togglePlay },
      {
        glyph: Glyphs.forward,
        run: () => {
          seekBy(JUMP);
        },
      },
      { id: 'audio', glyph: Glyphs.audio, caption: audioCaption() },
      { id: 'subs', glyph: Glyphs.subs, caption: subCaption() },
      { id: 'quality', glyph: Glyphs.quality, caption: qualityCaption() },
      { id: 'chapters', glyph: Glyphs.chapters, caption: chapterCaption() },
    ];
  }

  function paintControls() {
    const list = controls();
    let lh = '';
    let rh = '';
    let html;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      html =
        `<div class="osd-ctl${focus === 'row' && i === ctl ? ' foc' : ''}` +
        (c.id && c.id === openPanel ? ' on' : '') +
        '"' +
        (c.id ? ` id="osd-ctl-${c.id}"` : '') +
        '>' +
        '<div class="osd-btn">' +
        c.glyph +
        '</div>' +
        '<div class="osd-cap">' +
        UI.escapeHtml(c.caption || '') +
        '</div>' +
        '</div>';
      if (c.id) rh += html;
      else lh += html;
    }
    osdLeft.innerHTML = lh;
    osdRight.innerHTML = rh;
    hint();
  }

  function togglePlay() {
    if (v.paused) v.play();
    else v.pause();
    report(v.paused ? 'paused' : 'playing');
    paintControls();
    showOsd();
  }

  /* ---------- seeking ---------- */

  /* Nudge the target. Repeats accumulate rather than each one seeking. */
  function seekBy(seconds) {
    seekTo(target() + seconds);
  }

  function seekTo(seconds) {
    const dur = duration();
    pending = Math.max(0, dur ? Math.min(seconds, dur - 2) : seconds);
    dismissSkip();
    showOsd();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(applySeek, SEEK_SETTLE);
  }

  function applySeek() {
    if (pending === null) return;
    const to = pending;
    pending = null;
    try {
      v.currentTime = to;
    } catch (e) {
      /* not seekable yet */
    }
    report(v.paused ? 'paused' : 'playing');
    paintSub();
    showOsd();
  }

  /* A digit is the cheapest jump there is: 3 means three tenths in. The stock
     app has nothing like it and it is the fastest way past a first act. */
  function jumpToTenth(n) {
    const dur = duration();
    if (!dur) return;
    seekTo((dur * n) / 10);
  }

  /* Chapter skip, falling back to a fixed jump on a file with no chapters —
     the button should always do something. */
  function chapterStep(dir) {
    const list = Media.chapters(item);
    let at = target();
    let i;
    let to = null;
    if (!list.length) {
      seekBy(dir * JUMP);
      return;
    }
    if (dir > 0) {
      for (i = 0; i < list.length; i++) {
        if (list[i].start > at + 1) {
          to = list[i].start;
          break;
        }
      }
      if (to === null) to = Math.max(0, duration() - 5);
    } else {
      /* Back once goes to the start of this chapter, again to the one before —
         which is how every disc player has behaved for twenty years. */
      for (i = list.length - 1; i >= 0; i--) {
        if (list[i].start < at - 3) {
          to = list[i].start;
          break;
        }
      }
      if (to === null) to = 0;
    }
    seekTo(to);
  }

  /* ---------- skip intro ----------

     The server has already analysed the film and says where the intro and the
     credits are, so there is nothing to detect here — only something to offer
     while you are inside one. OK takes it; anything else carries on. */

  let skipDismissed = null;

  function checkMarker() {
    let found = Media.markerAt(item, v.currentTime || 0);
    /* A dismissal lasts as long as you are inside the thing you dismissed, and
       no longer. Rewinding back over an intro and being refused the offer —
       because you happened to seek while it was on screen an hour ago — is not
       a decision anyone made. */
    if (skipDismissed && found !== skipDismissed) skipDismissed = null;
    if (found && skipDismissed === found) found = null;
    if (found === marker) return;
    marker = found;
    if (!marker) {
      skipEl.classList.add('hidden');
      return;
    }
    skipEl.textContent = Media.markerLabel(marker) + '   ›   OK';
    skipEl.classList.remove('hidden');
  }

  function dismissSkip() {
    if (!marker) return;
    skipDismissed = marker;
    marker = null;
    skipEl.classList.add('hidden');
  }

  function takeSkip() {
    const to = (marker.endTimeOffset || 0) / 1000;
    skipDismissed = marker;
    marker = null;
    skipEl.classList.add('hidden');
    /* Applied at once rather than through the settle timer: the whole point is
       that one press gets you past it. */
    pending = null;
    clearTimeout(seekTimer);
    try {
      v.currentTime = to;
    } catch (e) {
      /* not seekable yet */
    }
    UI.debug(`skipped to ${fmt(to)}`);
    showOsd();
  }

  /* ---------- what comes next ----------

     An episode that ends offers the one after it, and by default waits there
     for a keypress. These are someone else's servers: a chain that rolls all
     night is load on hardware we do not own, put there by someone who fell
     asleep. A season boundary never counts down at all. */

  const AUTOPLAY = [0, 5, 10, 15, 30]; // seconds; 0 is "wait for OK"
  let autoplay = null; // read from storage once, then cached
  let next = null;
  let nextTimer = null;
  let nextLeft = 0;

  /* How long an ended episode waits before playing the next, in seconds, or 0
     for not at all. Storage that refuses us falls back to 0, the safe way. */
  function autoplaySeconds() {
    if (autoplay !== null) return autoplay;
    let stored = 0;
    try {
      stored = Number(localStorage.getItem('reflex.autoplay'));
    } catch (e) {
      stored = 0;
    }
    autoplay = AUTOPLAY.indexOf(stored) > 0 ? stored : 0;
    return autoplay;
  }

  /* off → 5 → 10 → 15 → 30 → off, persisted. Cycling is the cheapest control a
     d-pad has, which is why the preference is a sidebar entry and not a screen. */
  function cycleAutoplay() {
    autoplay = AUTOPLAY[(AUTOPLAY.indexOf(autoplaySeconds()) + 1) % AUTOPLAY.length];
    try {
      localStorage.setItem('reflex.autoplay', String(autoplay));
    } catch (e) {
      /* private mode */
    }
    return autoplay;
  }

  /* 'off' or '10s' — what the sidebar entry and its toast say. */
  function autoplayLabel() {
    const secs = autoplaySeconds();
    return secs ? secs + 's' : 'off';
  }

  /* Playback ended on its own. Ask what follows before tearing anything down,
     because with nothing to offer this is an ordinary stop. */
  function offerNext() {
    if (!onNext || !item) {
      stop('stopped');
      return;
    }
    const asked = item;
    onNext(item).then(
      (found) => {
        if (item !== asked) return; // stopped while we were asking
        if (!found || !found.episode) {
          stop('stopped');
          return;
        }
        showNext(found);
      },
      () => {
        stop('stopped');
      },
    );
  }

  /* "S1 E5 · Sundown" — where it sits in the series, then what it is called. */
  function nextLabel(ep) {
    return (
      `S${ep.parentIndex === undefined ? '?' : ep.parentIndex}` +
      ' E' +
      (ep.index === undefined ? '?' : ep.index) +
      '   ·   ' +
      (ep.title || '')
    );
  }

  function showNext(found) {
    next = found;
    dismissSkip();
    Menu.close();
    const ep = found.episode;
    const still = Plex.posterUrl(ep, 320, 180);
    nextStillEl.style.backgroundImage = still ? `url("${still}")` : 'none';
    nextShowEl.textContent = `Up next   ·   ${ep.grandparentTitle || ''}`;
    nextTitleEl.textContent = nextLabel(ep);
    /* Crossing into a new season always waits, whatever the setting says: it is
       exactly where an unattended chain should stop. */
    nextLeft = found.newSeason ? 0 : autoplaySeconds();
    paintNext();
    nextEl.classList.remove('hidden');
    if (nextLeft > 0) nextTimer = setInterval(tickNext, 1000);
    UI.debug(
      `up next: ${nextLabel(ep)}` + (nextLeft > 0 ? ` in ${nextLeft}s` : ' — waiting for OK'),
    );
  }

  function paintNext() {
    nextHintEl.textContent =
      nextLeft > 0
        ? `Playing in ${nextLeft}s   ·   OK now   ·   BACK to stop`
        : 'OK to play   ·   BACK to stop';
  }

  function tickNext() {
    nextLeft--;
    paintNext();
    if (nextLeft <= 0) takeNext();
  }

  /* Take the panel down and kill the countdown with it. A timer that plays an
     episode onto a screen nobody is looking at is worse than no feature, so
     every way out of playback comes through here. */
  function clearNext() {
    clearInterval(nextTimer);
    nextTimer = null;
    nextLeft = 0;
    next = null;
    nextEl.classList.add('hidden');
  }

  function takeNext() {
    const ep = next && next.episode;
    const go = onPlayNext;
    clearNext();
    if (!ep || !go) {
      stop('stopped');
      return;
    }
    /* The finished episode is reported stopped before the next one starts — a
       session left open on a server we do not own is the rudest thing this app
       can do. Quietly, or onExit would bounce us out mid-handover. */
    stop('stopped', true);
    go(ep);
  }

  function nextKey(code) {
    if (code === 13 || code === 415 || code === 19 || code === 179) {
      takeNext();
      return true;
    }
    if (UI.isBack(code) || code === 413) {
      clearNext();
      stop('stopped');
      return true;
    }
    return true; // the offer swallows everything else
  }

  /* ---------- subtitles ----------

     Fetched as text and drawn over the video. The server does one small GET
     and nothing else — no session, no re-encode, nothing on the dashboard of a
     server we do not own. */

  function setSub(stream) {
    const token = ++subToken;
    cues = [];
    subNote = '';
    subEl.textContent = '';
    /* Clear what is drawn AND the note of what was drawn: paintSub skips a cue
       identical to the last one, so leaving the note behind means turning a
       track off and back on inside one cue draws nothing. */
    subEl.setAttribute('data-cue', '');
    subEl.classList.add('hidden');
    currentSub = stream || null;
    wantedLang = stream ? String(stream.languageCode || '') : null;
    if (!stream) {
      paintControls();
      return;
    }

    if (!Media.isTextSub(stream)) {
      /* A picture of words can only reach the screen by being painted into the
         video, which is a transcode — and on a 4K file that is the one thing
         that gets the session killed. So it is refused, by name. */
      currentSub = null;
      subNote =
        String(stream.codec || '').toUpperCase() +
        ' is an image track — it would need the server to burn it in';
      paintControls();
      return;
    }

    subNote = 'loading…';
    paintControls();
    Plex.subtitles(server, stream).then(
      (text) => {
        if (token !== subToken) return;
        cues = Subs.parse(text);
        subNote = cues.length ? '' : 'the track came back empty';
        UI.debug(`subtitles: ${Media.subLabel(stream)} · ${cues.length} cues`);
        paintControls();
        paintSub();
      },
      (e) => {
        if (token !== subToken) return;
        currentSub = null;
        subNote = `could not be fetched (${e.message.split(' -> ').pop()})`;
        paintControls();
      },
    );
  }

  function paintSub() {
    if (!cues.length) return;
    const text = Subs.textAt(cues, (v.currentTime || 0) + 0.05);
    if (text === subEl.getAttribute('data-cue')) return;
    subEl.setAttribute('data-cue', text);
    subEl.textContent = text;
    subEl.classList.toggle('hidden', text === '');
  }

  /* ---------- the panels ----------

     Everything the stock app makes you leave playback for. One section per
     button rather than one block of tabs, so what is on screen is what the
     button you pressed is about. */

  function audioRows() {
    const tracks = Media.audioTracks(currentPart);
    const out = [];
    for (let i = 0; i < tracks.length; i++) out.push(audioRow(tracks[i]));
    return out;
  }

  function audioRow(st) {
    return {
      label: Media.audioMenuLabel(st),
      /* Say which switches are free. When the panel owns the track list this
         is instant; otherwise it restarts against a stream the server has to
         mux, and knowing that before you press OK is the difference between a
         choice and a surprise. */
      note:
        currentAudio && String(currentAudio.id) === String(st.id)
          ? ''
          : panelIndexOf(st) >= 0
            ? ''
            : 'restarts — the server has to mux this one',
      on: !!(currentAudio && String(currentAudio.id) === String(st.id)),
      value: () => {
        chooseAudio(st);
      },
    };
  }

  function subRows() {
    const list = Media.subtitleTracks(currentPart);
    const out = [
      {
        label: 'Off',
        on: !currentSub,
        value: () => {
          setSub(null);
        },
      },
    ];
    for (let i = 0; i < list.length; i++) out.push(subRow(list[i]));
    return out;
  }

  function subRow(st) {
    return {
      label: Media.subLabel(st),
      note: Media.isTextSub(st) ? '' : 'image track — cannot be shown without a transcode',
      on: !!(currentSub && String(currentSub.id) === String(st.id)),
      value: () => {
        setSub(st);
      },
    };
  }

  /* Quality is two different things wearing one name: another *version* of the
     film — a separate file, often the 1080p next to the 4K — and a bitrate cap,
     which is the server re-encoding this one. Both belong here because both are
     what the user means by "make this play properly", and both go through the
     guard, so the 4K rule refuses the cap and offers the other version. */
  function qualityRows() {
    const versions = (item && item.Media) || [];
    const out = [];
    let i;
    if (versions.length > 1) {
      for (i = 0; i < versions.length; i++) out.push(versionRow(versions[i], i));
    }
    const list = Media.qualities(currentMedia);
    for (i = 0; i < list.length; i++) out.push(qualityRow(list[i]));
    return out;
  }

  function versionRow(media, n) {
    return {
      label: `Version — ${Media.versionLabel(media)}`,
      on: n === mediaIndex && !maxBitrate,
      value: () => {
        if (n === mediaIndex && !maxBitrate) return;
        switchTo({ mediaIndex: n, maxBitrate: null }, Media.versionLabel(media));
      },
    };
  }

  /* What a row costs, said before OK rather than found out after it. There is
     no "Auto" here on purpose: nothing in this app follows the connection —
     Original is the file as it stands and every cap is a fixed ceiling the
     server re-encodes to. */
  function qualityNote(q) {
    if (!q.bitrate) return forceStream ? 'the server muxes this one' : 'direct play';
    if (Media.isUHD(currentMedia)) {
      return 'a 4K transcode is what gets the stream killed — this will be refused';
    }
    return `transcode · ${Media.bitrateLabel(q.bitrate)}`;
  }

  function qualityRow(q) {
    return {
      label: q.label,
      note: qualityNote(q),
      on: (q.bitrate || null) === maxBitrate,
      value: () => {
        if ((q.bitrate || null) === maxBitrate) return;
        switchTo({ maxBitrate: q.bitrate || null }, q.label);
      },
    };
  }

  /* The chapter the playhead is in, or null. The rail rings it and the caption
     names it, so both have to agree. */
  function chapterAt(list, at) {
    /* Backwards: a chapter Plex gave no end offset for would otherwise swallow
       the whole film from its start onwards. */
    for (let i = list.length - 1; i >= 0; i--) {
      if (at >= list[i].start && (!list[i].end || at < list[i].end)) return list[i];
    }
    return null;
  }

  /* Three of the four buttons open a list. A row's value is what choosing it
     does — js/menu.js draws and walks, and knows nothing about any of it. The
     builders are handed over rather than called, so the list is made when the
     panel opens and reflects where playback has got to. */
  const PANELS = {
    audio: { label: 'Audio', rows: audioRows },
    subs: {
      label: 'Subtitles',
      rows: subRows,
      note: 'Subtitles are fetched as text and drawn here, so they cost the server nothing.',
    },
    quality: {
      label: 'Quality',
      rows: qualityRows,
      note: 'Anything but Original asks the server to re-encode.',
    },
  };

  /* Open the panel belonging to one of the four right-hand buttons, anchored
     over it and clamped so the last button does not push it off the screen. */
  function openPanelFor(id) {
    if (id === 'chapters') {
      openChapters();
      return;
    }
    openPanel = id;
    paintControls();
    const btn = document.getElementById(`osd-ctl-${id}`);
    menuEl.style.left =
      UI.clamp(64 + osdRight.offsetLeft + (btn ? btn.offsetLeft : 0), 64, 960) + 'px';
    Menu.open({
      host: menuEl,
      tabs: [PANELS[id]],
      onChoose: (act) => {
        act();
      },
      onClose: () => {
        openPanel = null;
        paintControls();
        showOsd();
      },
    });
    showOsd();
  }

  /* ---------- the chapter rail ----------

     Cards rather than a list, because a still and a timecode say more about
     where you are going than "Chapter 7" does. Plex carries a thumbnail for
     some chapters and not others, so the picture is the only thing a card can
     lose — never its size. */

  function openChapters() {
    const list = Media.chapters(item);
    if (!list.length) {
      UI.toast('This file has no chapters');
      return;
    }
    openPanel = 'chapters';
    chapSel = Math.max(0, list.indexOf(chapterAt(list, target())));
    paintChapters();
    chapEl.classList.remove('hidden');
    paintControls();
    showOsd();
  }

  function closeChapters() {
    openPanel = null;
    chapEl.classList.add('hidden');
    paintControls();
    showOsd();
  }

  function paintChapters() {
    const list = Media.chapters(item);
    let html = '';
    let shot;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      shot = c.thumb ? Plex.photoUrl(server, c.thumb, 240, 135) : '';
      html +=
        `<div class="osd-chap${i === chapSel ? ' on' : ''}">` +
        '<div class="osd-chap-shot"' +
        (shot ? ` style="background-image: url('${shot}')"` : '') +
        '>' +
        '<div class="osd-chap-time">' +
        UI.escapeHtml(fmt(c.start)) +
        '</div>' +
        '</div>' +
        '<div class="osd-chap-title">' +
        UI.escapeHtml(c.title) +
        '</div>' +
        '</div>';
    }
    chapInner.innerHTML = html;
    const first = UI.clamp(chapSel - 2, 0, Math.max(0, list.length - CARDS_SHOWN));
    chapInner.style.webkitTransform =
      chapInner.style.transform = `translateX(${-first * CARD_W}px)`;
  }

  function chapterKey(code) {
    const list = Media.chapters(item);
    if (code === 37) {
      chapSel = (chapSel + list.length - 1) % list.length;
      paintChapters();
      return true;
    }
    if (code === 39) {
      chapSel = (chapSel + 1) % list.length;
      paintChapters();
      return true;
    }
    if (code === 13 || code === 415 || code === 19) {
      seekTo(list[chapSel].start);
      closeChapters();
      return true;
    }
    if (code === 40 || UI.isBack(code) || code === 413) {
      closeChapters();
      return true;
    }
    return true; // the rail swallows everything else
  }

  /* Another version, a quality cap, and an audio track the panel will not
     select for us all mean the same thing: ask the server for a different
     stream and start again from here. The guard decides whether that is
     allowed, which is what keeps a quality cap on a 4K file refused. */
  function switchTo(change, what) {
    if (!onSwitch) return;
    change.at = target();
    change.subLang = wantedLang;
    if (change.audioId === undefined) change.audioId = currentAudio && currentAudio.id;
    if (change.mediaIndex === undefined) change.mediaIndex = mediaIndex;
    if (change.maxBitrate === undefined) change.maxBitrate = maxBitrate;
    /* Carried so a later switch does not silently drop back to a direct play
       and lose the track the user chose. */
    if (change.forceStream === undefined) change.forceStream = forceStream;
    /* On the hint line rather than in a caption: a caption names what IS
       chosen, and this has not happened yet. play() writes the hint back. */
    osdHint.textContent = `Switching to ${what}…`;
    showOsd();
    onSwitch(change);
  }

  /* ---------- progress ---------- */

  function report(state) {
    if (!item || !server) return;
    Plex.timeline(server, item, state, (v.currentTime || 0) * 1000, (v.duration || 0) * 1000);
  }

  /* A black screen tells you nothing, and "the panel refused it" is only one of
     the reasons this fails. Say which. */
  function mediaErrorText(err) {
    const code = err ? err.code : 0;
    const detail = err && err.message ? `  ·  ${err.message}` : '';
    if (code === 1) return `The stream was aborted.${detail}`;
    if (code === 2)
      return (
        'The network dropped the stream — the server stopped ' +
        'answering part way through.' +
        detail
      );
    if (code === 3)
      return (
        'The panel could not decode this stream (media error 3). ' +
        'The server said it would direct play, so the declared ' +
        'profile in js/plex.js claims something this panel cannot ' +
        'actually decode.' +
        detail
      );
    if (code === 4)
      return (
        'The stream would not open (media error 4) — the server ' +
        'refused the request, or the container is one the panel ' +
        'will not accept at all.' +
        detail
      );
    return `The stream failed (media error ${code}).${detail}`;
  }

  /* A desktop browser is not this panel, and its codec support is much
     narrower — Firefox has no AC3/E-AC3 and no HEVC at all, Chrome has no
     Matroska. Silence or a decode error on the laptop usually says nothing
     about the TV, and mistaking one for the other costs an evening. */
  function laptopNote(media) {
    if (!Config.dev) return '';
    const codec = (media && media.videoCodec) || '?';
    const container = (media && media.container) || '?';
    return (
      '  ·  You are on the dev server, so this is a desktop browser, not ' +
      'the B8. It is playing ' +
      String(codec).toUpperCase() +
      ' in ' +
      String(container).toUpperCase() +
      ', and browsers do not decode AC3, ' +
      'E-AC3, HEVC or Matroska the way the panel does. Judge playback on ' +
      'the TV.'
    );
  }

  function fail(msg) {
    const report_ = onError;
    UI.debug(`playback failed: ${msg}`);
    stop('stopped');
    if (report_) report_(msg);
  }

  function play(opts) {
    item = opts.item;
    server = opts.server;
    onExit = opts.onExit;
    onError = opts.onError;
    onSwitch = opts.onSwitch || null;
    onNext = opts.onNext || null;
    onPlayNext = opts.onPlayNext || null;
    resumeMs = opts.item.viewOffset || 0;
    clearNext();

    stalls = 0;
    lowest = 999;
    startedAt = Date.now();
    const url = opts.url || Plex.streamUrl(server, opts.part);
    osdTitle.textContent = opts.item.title || '';
    pending = null;
    clearTimeout(seekTimer);
    currentPart = opts.part;
    currentAudio = opts.audio || null;
    mediaIndex = opts.mediaIndex || 0;
    maxBitrate = opts.maxBitrate || null;
    transcoding = !!opts.transcode;
    forceStream = !!opts.forceStream;
    currentMedia = (item.Media && item.Media[mediaIndex]) || null;
    marker = null;
    skipDismissed = null;
    skipEl.classList.add('hidden');
    Menu.close();
    setFocus('none');
    openPanel = null;
    chapEl.classList.add('hidden');
    cues = [];
    currentSub = null;
    subNote = '';
    subEl.classList.add('hidden');
    subEl.textContent = '';
    subEl.setAttribute('data-cue', '');
    wantedLang = opts.subLang === undefined ? null : opts.subLang;
    paintControls();
    hint();
    v.classList.remove('hidden');

    v.onloadedmetadata = () => {
      /* Only now does currentTime mean anything. Don't resume within half a
         minute of the end — that is a film you finished. */
      if (resumeMs > 10000 && v.duration && resumeMs < v.duration * 1000 - 30000) {
        v.currentTime = resumeMs / 1000;
      }
      paintTicks();
      applyChosenTrack();
      showOsd();
      report('playing');
      /* The subtitle track the user had before a restart, matched by language
         because a different version of the film has different stream ids. */
      if (wantedLang !== null) {
        const again = Media.pickSubtitle(currentPart, wantedLang);
        if (again) setSub(again);
      }
    };
    /* The track list is not always populated by loadedmetadata, so try again
       once the picture is actually running. */
    v.onplaying = () => {
      applyChosenTrack();
      showOsd();
    };
    /* 'waiting' is the panel telling us it has run dry. */
    v.onwaiting = () => {
      stalls++;
    };
    v.ontimeupdate = () => {
      if (osdShowing()) paintOsd();
      paintSub();
      checkMarker();
    };
    v.onended = () => {
      offerNext();
    };
    v.onerror = () => {
      fail(mediaErrorText(v.error) + laptopNote(currentMedia));
    };

    /* preload only matters between the element existing and a src being set,
       and the src is only ever set here, at the moment we play. Leaving it at
       "none" made the browser conservative about reading ahead for no benefit. */
    v.preload = 'auto';
    v.src = url;
    v.load();
    showOsd();
    UI.debug(
      (transcoding
        ? 'playing (server converting' +
          (maxBitrate ? ` at ${Media.bitrateLabel(maxBitrate)}` : '') +
          ') '
        : 'playing ') + String(url).split('?')[0],
    );

    /* Ask directly rather than waiting on loadedmetadata, which need not fire
       on its own, and report a rejected play() rather than sitting on a black
       screen — it is otherwise completely silent. */
    const started = v.play();
    if (started && started.then) {
      started.then(null, (e) => {
        fail(
          `The player refused to start: ${(e && e.name + ' ' + e.message) || 'unknown'}` +
            '. If this is the TV, it is usually the media pipeline rejecting the ' +
            'container rather than the codec.',
        );
      });
    }

    clearInterval(ticker);
    ticker = setInterval(() => {
      report(v.paused ? 'paused' : 'playing');
      UI.debug(health());
    }, 10000);
  }

  /* Stuttering is either the network not keeping up or the panel not decoding
     fast enough, and those want opposite fixes. The video element knows which:
     a buffer that keeps draining is bandwidth, dropped frames are decode.
     Reported every ten seconds alongside the timeline, so the debug line
     answers it without a profiler. */
  function health() {
    let ahead = 0;
    try {
      if (v.buffered && v.buffered.length) {
        ahead = Math.round(v.buffered.end(v.buffered.length - 1) - v.currentTime);
      }
    } catch (e) {
      ahead = -1;
    }

    let dropped = v.webkitDroppedFrameCount;
    let decoded = v.webkitDecodedFrameCount;
    if (dropped === undefined && v.getVideoPlaybackQuality) {
      const q = v.getVideoPlaybackQuality();
      dropped = q.droppedVideoFrames;
      decoded = q.totalVideoFrames;
    }
    const frames = decoded === undefined ? 'frames n/a' : `dropped ${dropped}/${decoded}`;

    if (ahead >= 0 && ahead < lowest) lowest = ahead;

    return (
      fmt(v.currentTime) +
      '  buffered +' +
      ahead +
      's (low ' +
      lowest +
      's)' +
      '  stalls ' +
      stalls +
      '  ' +
      frames +
      (v.paused ? '  PAUSED' : '')
    );
  }

  /* Said once when playback ends, because that is when the whole picture
     exists: enough stalls on a 4K remux means the link cannot carry it, and
     the answer is the 1080p copy on the film page rather than anything here. */
  function summary() {
    const mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    return (
      `played ${mins} min · ${stalls} stall${stalls === 1 ? '' : 's'}` +
      ' · buffer low ' +
      (lowest === 999 ? '?' : lowest + 's')
    );
  }

  /* quiet: tear down without telling the caller we are done — used when
     playback is about to be started again with a different track, where firing
     onExit would bounce back to the film page mid-restart. */
  function stop(state, quiet) {
    if (!item) return;
    Menu.close();
    setFocus('none');
    openPanel = null;
    chapEl.classList.add('hidden');
    UI.debug(summary());
    report(state || 'stopped');
    clearInterval(ticker);
    ticker = null;
    clearTimeout(osdTimer);
    clearTimeout(seekTimer);
    clearNext();
    pending = null;
    subToken++;
    v.pause();
    v.onloadedmetadata = v.onplaying = v.ontimeupdate = v.onended = v.onerror = null;
    v.onwaiting = null;
    v.removeAttribute('src');
    v.load();
    v.classList.add('hidden');
    osd.classList.add('hidden');
    skipEl.classList.add('hidden');
    subEl.classList.add('hidden');
    marker = null;
    cues = [];
    const done = quiet ? null : onExit;
    item = null;
    server = null;
    onExit = null;
    onError = null;
    onSwitch = null;
    onNext = null;
    onPlayNext = null;
    currentPart = null;
    currentAudio = null;
    currentMedia = null;
    currentSub = null;
    if (done) done();
  }

  function playing() {
    return !!item;
  }

  function indexOfCtl(id) {
    const list = controls();
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return 0;
  }

  /* Move the focus onto a button and open it — what a colour key does, so the
     shortcut and the row never disagree about what is on screen. */
  function focusPanel(id) {
    setFocus('row');
    ctl = indexOfCtl(id);
    openPanelFor(id);
  }

  /* The trackbar has the four arrows once it has the focus. Scrubbing is the
     same aim-then-seek as a nudge, so holding ◀ still costs one range request;
     OK is what says "stop aiming and go there". */
  function barKey(code) {
    if (code === 37) {
      seekBy(-NUDGE);
      return true;
    }
    if (code === 39) {
      seekBy(NUDGE);
      return true;
    }
    if (code === 13 || code === 415 || code === 19) {
      if (marker) {
        takeSkip();
        return true;
      }
      applySeek();
      return true;
    }
    if (code === 40) {
      setFocus('row');
      paintControls();
      showOsd();
      return true;
    }
    if (UI.isBack(code) || code === 413) {
      if (marker) {
        dismissSkip();
        return true;
      }
      setFocus('none');
      paintControls();
      showOsd();
      return true;
    }
    return false; // anything else is still playback's
  }

  /* The control row has the four arrows once it has the focus; everything else
     on the remote goes on meaning what it means during playback. OK belongs to
     the button here — the skip offer is taken with OK from playback, and BACK
     still dismisses it from the row. */
  function controlKey(code) {
    const n = controls().length;
    if (code === 37) {
      ctl = (ctl + n - 1) % n;
      paintControls();
      showOsd();
      return true;
    }
    if (code === 39) {
      ctl = (ctl + 1) % n;
      paintControls();
      showOsd();
      return true;
    }
    if (code === 13) {
      const c = controls()[ctl];
      if (c.id) openPanelFor(c.id);
      else c.run();
      return true;
    }
    if (code === 38) {
      setFocus('bar');
      paintControls();
      showOsd();
      return true;
    }
    if (code === 40) {
      setFocus('none');
      paintControls();
      showOsd();
      return true;
    }
    if (UI.isBack(code) || code === 413) {
      if (marker) {
        dismissSkip();
        return true;
      }
      setFocus('none');
      paintControls();
      showOsd();
      return true;
    }
    return false; // anything else is still playback's
  }

  function key(code) {
    /* The offer owns the remote while it is up: the film has ended, so seeking
       and pausing have nothing left to act on. */
    if (next) return nextKey(code);
    if (openPanel === 'chapters') return chapterKey(code);
    if (Menu.isOpen()) return Menu.key(code);

    /* Digits jump by tenths — the cheapest way past a first act there is. */
    if (code >= 48 && code <= 57) {
      jumpToTenth(code - 48);
      return true;
    }

    if (focus === 'bar' && barKey(code)) return true;
    if (focus === 'row' && controlKey(code)) return true;

    switch (code) {
      case 13:
      case 415:
      case 19:
      case 179: // OK / play / pause
        /* While the skip prompt is up, OK takes it. That is the one moment the
           button means something other than pause, and it is the moment you
           are reaching for it. */
        if (marker) {
          takeSkip();
          return true;
        }
        togglePlay();
        return true;
      case 37: // left
        seekBy(-NUDGE);
        return true;
      case 39: // right
        seekBy(NUDGE);
        return true;
      case 412: // rewind
        seekBy(-JUMP);
        return true;
      case 417: // fast forward
        seekBy(JUMP);
        return true;
      case 38: // up — the trackbar
        setFocus('bar');
        paintControls();
        showOsd();
        return true;
      case 40: // down — the control row
        setFocus('row');
        paintControls();
        showOsd();
        return true;
      case 33: // channel up — next chapter
        chapterStep(1);
        return true;
      case 34: // channel down — previous chapter
        chapterStep(-1);
        return true;
      case 403:
        focusPanel('audio');
        return true; // red
      case 404:
        focusPanel('subs');
        return true; // green
      case 405:
        focusPanel('quality');
        return true; // yellow
      case 406:
        focusPanel('chapters');
        return true; // blue
      case 461:
      case 27:
      case 8:
      case 413: // back / stop
        if (marker) {
          dismissSkip();
          return true;
        }
        stop('stopped');
        return true;
    }
    return false;
  }

  return {
    play: play,
    stop: stop,
    playing: playing,
    key: key,
    autoplaySeconds: autoplaySeconds,
    cycleAutoplay: cycleAutoplay,
    autoplayLabel: autoplayLabel,
  };
})();
