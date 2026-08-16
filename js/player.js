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

  var v = document.getElementById('video');
  var osd = document.getElementById('osd');
  var osdTitle = document.getElementById('osd-title');
  var osdTime = document.getElementById('osd-time');
  var osdFill = document.getElementById('osd-fill');
  var osdBuffered = document.getElementById('osd-buffered');
  var osdTicks = document.getElementById('osd-ticks');
  var osdKnob = document.getElementById('osd-knob');
  var osdTracks = document.getElementById('osd-tracks');
  var osdHint = document.getElementById('osd-hint');
  var skipEl = document.getElementById('osd-skip');
  var subEl = document.getElementById('subtitle');
  var menuEl = document.getElementById('menu');
  var menuTabsEl = document.getElementById('menu-tabs');
  var menuListEl = document.getElementById('menu-list');
  var menuInnerEl = document.getElementById('menu-inner');
  var menuNoteEl = document.getElementById('menu-note');

  var BAR_W = 1792;                // #osd-bar, in CSS pixels
  var SEEK_SETTLE = 400;           // ms of stillness before a seek is applied
  var NUDGE = 30;                  // left / right, seconds
  var JUMP = 300;                  // rewind / fast forward, seconds
  var ROW_H = 56;                  // a menu row, in CSS pixels
  var ROWS_SHOWN = 7;

  var item = null, server = null, onExit = null, onError = null, onSwitch = null;
  var currentPart = null, currentAudio = null, currentMedia = null;
  var mediaIndex = 0, maxBitrate = null, transcoding = false, forceStream = false;
  var ticker = null, osdTimer = null, resumeMs = 0;

  /* A stall is the thing you actually see as a blip, and it is over before the
     ten-second sample comes round. Count them instead. */
  var stalls = 0, lowest = 999, startedAt = 0;

  /* Where a run of seek presses is heading. Every currentTime assignment on a
     direct-played file is a real seek — a range request, a decoder flush — so
     holding the key would otherwise fire one per press and fight the network
     the whole way. Accumulate, show where you are going, apply once you stop. */
  var pending = null, seekTimer = null;

  /* Subtitles: the parsed cues, which track they came from, and the language
     the user asked for. The language is what survives a restart — after a
     switch to another version the stream ids are different, but "French" still
     means the same thing. */
  var cues = [], currentSub = null, wantedLang = null, subToken = 0, subNote = '';

  /* The skip prompt, and the menu. */
  var marker = null;
  var menuOn = false, tab = 0, sel = 0, rows = [];

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    var mm = (m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return h ? (h + ':' + mm + ':' + ss) : (m + ':' + ss);
  }

  /* A live or badly-muxed stream reports Infinity, and every sum here divides
     by this — so fall back to what the server said the film runs to. */
  function duration() {
    var d = v.duration;
    if (d && isFinite(d)) return d;
    return ((item && item.duration) || 0) / 1000;
  }

  /* Where the picture will be once any pending seek lands — that is what the
     user is aiming at, so that is what the bar and the clock have to show. */
  function target() {
    return pending === null ? (v.currentTime || 0) : pending;
  }

  /* ---------- the OSD ----------

     Two separate things: painting the time, and putting the OSD back on screen
     for another few seconds. Repainting must not reset the hide timer, or the
     OSD would never go away once playback started. */

  function paintOsd() {
    var at = target(), dur = duration();
    var left = dur ? Math.max(0, dur - at) : 0;

    osdTime.textContent = fmt(at) + ' / ' + fmt(dur) +
      (dur ? '   ·   ' + fmt(left) + ' left' : '') +
      (pending !== null ? '   SEEKING' : (v.paused ? '   PAUSED' : ''));

    var x = dur ? Math.round(BAR_W * Math.min(at, dur) / dur) : 0;
    osdFill.style.width = x + 'px';
    /* transform, not left: the knob moves on every timeupdate and this is the
       one property the panel can move without a layout pass. */
    osdKnob.style.webkitTransform = osdKnob.style.transform =
      'translateX(' + Math.min(x, BAR_W - 6) + 'px)';

    var ahead = 0;
    try {
      if (v.buffered && v.buffered.length) ahead = v.buffered.end(v.buffered.length - 1);
    } catch (e) { ahead = 0; }
    osdBuffered.style.width = dur ? Math.round(BAR_W * Math.min(ahead, dur) / dur) + 'px' : '0';
  }

  /* Chapters as ticks, markers as bands. Drawn once, when the duration is
     known — they do not move, and rebuilding them on every frame is exactly
     the kind of work this panel cannot afford. */
  function paintTicks() {
    var dur = duration();
    if (!dur) { osdTicks.innerHTML = ''; return; }
    var html = '', list = Media.chapters(item), i, at;

    var markers = (item && item.Marker) || [];
    for (i = 0; i < markers.length; i++) {
      at = Math.round(BAR_W * ((markers[i].startTimeOffset || 0) / 1000) / dur);
      var wide = Math.max(2, Math.round(BAR_W *
        (((markers[i].endTimeOffset || 0) - (markers[i].startTimeOffset || 0)) / 1000) / dur));
      html += '<i class="osd-band" style="left:' + at + 'px;width:' + wide + 'px"></i>';
    }
    for (i = 0; i < list.length; i++) {
      if (list[i].start <= 0) continue;
      html += '<i class="osd-tick" style="left:' +
              Math.round(BAR_W * list[i].start / dur) + 'px"></i>';
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
    osdTimer = setTimeout(function () {
      if (pending !== null || menuOn) { showOsd(); return; }
      osd.style.opacity = '0';
      subEl.classList.remove('lifted');
    }, 4000);
  }

  function osdShowing() { return osd.style.opacity !== '0' && !osd.classList.contains('hidden'); }

  function hint() {
    osdHint.textContent = menuOn
      ? '◀ ▶ section · ▲ ▼ choose · OK select · BACK close'
      : '◀ ▶ ' + NUDGE + 's · ▲ ▼ menu · 0–9 jump · CH± chapter · OK pause';
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
    var list = v.audioTracks;
    if (!list || typeof list.length !== 'number' || list.length < 2) return null;
    return list;
  }

  /* Which entry of the panel's list is this Plex stream? The file's audio
     streams and the pipeline's track list are the same tracks in the same
     order — but only if they are the same length. If they are not, we do not
     know what we are looking at, and guessing would select the wrong track
     silently, which is the bug this whole section exists to fix. */
  function panelIndexOf(st) {
    var tracks = Media.audioTracks(currentPart), list = panelTracks(), i;
    if (!list || list.length !== tracks.length) return -1;
    for (i = 0; i < tracks.length; i++) {
      if (String(tracks[i].id) === String(st.id)) return i;
    }
    return -1;
  }

  function selectPanelTrack(n) {
    var list = panelTracks(), i;
    if (!list || n < 0 || n >= list.length) return false;
    for (i = 0; i < list.length; i++) {
      if (list[i]) list[i].enabled = (i === n);
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
    var n = panelIndexOf(currentAudio);
    if (n < 0) { paintTracks(); return; }
    var list = panelTracks();
    if (list[n] && list[n].enabled) return;          // already right, say nothing
    if (selectPanelTrack(n)) {
      UI.debug('audio set on the panel (track ' + n + '): ' + Media.audioLabel(currentAudio));
    }
    paintTracks();
  }

  function chooseAudio(st) {
    if (currentAudio && String(currentAudio.id) === String(st.id)) { closeMenu(); return; }
    var n = panelIndexOf(st);
    if (n >= 0 && selectPanelTrack(n)) {
      /* The good case: the panel switched it, nothing restarted, the server
         was not asked for anything. */
      currentAudio = st;
      UI.debug('audio switched on the panel (track ' + n + '): ' + Media.audioLabel(st));
      paintTracks();
      closeMenu();
      showOsd();
      return;
    }
    switchTo({ audioId: st.id, forceStream: true }, Media.audioMenuLabel(st));
  }

  /* Which audio the panel is actually carrying, and what else is on, named on
     screen — the file usually has several tracks and until now nothing said
     which one you had. */
  function paintTracks() {
    var bits = [];
    var tracks = Media.audioTracks(currentPart);
    bits.push('Audio: ' + Media.audioMenuLabel(currentAudio) +
              (tracks.length > 1 ? ' (' + tracks.length + ')' : '') +
              (audioIsOurs() ? '' : ' — panel’s choice'));
    bits.push('Subtitles: ' + (currentSub ? Media.subLabel(currentSub) : 'off') +
              (subNote ? ' — ' + subNote : ''));
    bits.push('Quality: ' + (maxBitrate ? Media.bitrateLabel(maxBitrate) + ' converted'
                                        : Media.versionLabel(currentMedia)));
    osdTracks.textContent = bits.join('   ·   ');
  }

  /* ---------- seeking ---------- */

  /* Nudge the target. Repeats accumulate rather than each one seeking. */
  function seekBy(seconds) {
    seekTo(target() + seconds);
  }

  function seekTo(seconds) {
    var dur = duration();
    pending = Math.max(0, dur ? Math.min(seconds, dur - 2) : seconds);
    dismissSkip();
    showOsd();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(applySeek, SEEK_SETTLE);
  }

  function applySeek() {
    if (pending === null) return;
    var to = pending;
    pending = null;
    try { v.currentTime = to; } catch (e) { /* not seekable yet */ }
    report(v.paused ? 'paused' : 'playing');
    paintSub();
    showOsd();
  }

  /* A digit is the cheapest jump there is: 3 means three tenths in. The stock
     app has nothing like it and it is the fastest way past a first act. */
  function jumpToTenth(n) {
    var dur = duration();
    if (!dur) return;
    seekTo(dur * n / 10);
  }

  /* Chapter skip, falling back to a fixed jump on a file with no chapters —
     the button should always do something. */
  function chapterStep(dir) {
    var list = Media.chapters(item), at = target(), i, to = null;
    if (!list.length) { seekBy(dir * JUMP); return; }
    if (dir > 0) {
      for (i = 0; i < list.length; i++) {
        if (list[i].start > at + 1) { to = list[i].start; break; }
      }
      if (to === null) to = Math.max(0, duration() - 5);
    } else {
      /* Back once goes to the start of this chapter, again to the one before —
         which is how every disc player has behaved for twenty years. */
      for (i = list.length - 1; i >= 0; i--) {
        if (list[i].start < at - 3) { to = list[i].start; break; }
      }
      if (to === null) to = 0;
    }
    seekTo(to);
  }

  /* ---------- skip intro ----------

     The server has already analysed the film and says where the intro and the
     credits are, so there is nothing to detect here — only something to offer
     while you are inside one. OK takes it; anything else carries on. */

  var skipDismissed = null;

  function checkMarker() {
    var found = Media.markerAt(item, v.currentTime || 0);
    /* A dismissal lasts as long as you are inside the thing you dismissed, and
       no longer. Rewinding back over an intro and being refused the offer —
       because you happened to seek while it was on screen an hour ago — is not
       a decision anyone made. */
    if (skipDismissed && found !== skipDismissed) skipDismissed = null;
    if (found && skipDismissed === found) found = null;
    if (found === marker) return;
    marker = found;
    if (!marker) { skipEl.classList.add('hidden'); return; }
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
    var to = (marker.endTimeOffset || 0) / 1000;
    skipDismissed = marker;
    marker = null;
    skipEl.classList.add('hidden');
    /* Applied at once rather than through the settle timer: the whole point is
       that one press gets you past it. */
    pending = null;
    clearTimeout(seekTimer);
    try { v.currentTime = to; } catch (e) { /* not seekable yet */ }
    UI.debug('skipped to ' + fmt(to));
    showOsd();
  }

  /* ---------- subtitles ----------

     Fetched as text and drawn over the video. The server does one small GET
     and nothing else — no session, no re-encode, nothing on the dashboard of a
     server we do not own. */

  function setSub(stream) {
    var token = ++subToken;
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
    if (!stream) { paintTracks(); return; }

    if (!Media.isTextSub(stream)) {
      /* A picture of words can only reach the screen by being painted into the
         video, which is a transcode — and on a 4K file that is the one thing
         that gets the session killed. So it is refused, by name. */
      currentSub = null;
      subNote = String(stream.codec || '').toUpperCase() +
                ' is an image track — it would need the server to burn it in';
      paintTracks();
      return;
    }

    subNote = 'loading…';
    paintTracks();
    Plex.subtitles(server, stream).then(function (text) {
      if (token !== subToken) return;
      cues = Subs.parse(text);
      subNote = cues.length ? '' : 'the track came back empty';
      UI.debug('subtitles: ' + Media.subLabel(stream) + ' · ' + cues.length + ' cues');
      paintTracks();
      paintSub();
    }, function (e) {
      if (token !== subToken) return;
      currentSub = null;
      subNote = 'could not be fetched (' + e.message.split(' -> ').pop() + ')';
      paintTracks();
    });
  }

  function paintSub() {
    if (!cues.length) return;
    var text = Subs.textAt(cues, (v.currentTime || 0) + 0.05);
    if (text === subEl.getAttribute('data-cue')) return;
    subEl.setAttribute('data-cue', text);
    subEl.textContent = text;
    subEl.classList.toggle('hidden', text === '');
  }

  /* ---------- the menu ----------

     Everything the stock app makes you leave playback for. Four sections, one
     list, driven with four arrows and OK — which is all the remote reliably
     has. */

  var TABS = ['Audio', 'Subtitles', 'Quality', 'Chapters'];

  function buildRows() {
    rows = [];
    if (tab === 0) buildAudioRows();
    else if (tab === 1) buildSubRows();
    else if (tab === 2) buildQualityRows();
    else buildChapterRows();
    if (!rows.length) rows.push({ label: 'Nothing to choose here', off: true });
  }

  function buildAudioRows() {
    var tracks = Media.audioTracks(currentPart), i;
    for (i = 0; i < tracks.length; i++) {
      rows.push(audioRow(tracks[i]));
    }
  }

  function audioRow(st) {
    return {
      label: Media.audioMenuLabel(st),
      /* Say which switches are free. When the panel owns the track list this
         is instant; otherwise it restarts against a stream the server has to
         mux, and knowing that before you press OK is the difference between a
         choice and a surprise. */
      note: (currentAudio && String(currentAudio.id) === String(st.id)) ? ''
        : (panelIndexOf(st) >= 0 ? '' : 'restarts — the server has to mux this one'),
      on: !!(currentAudio && String(currentAudio.id) === String(st.id)),
      act: function () { chooseAudio(st); }
    };
  }

  function buildSubRows() {
    var list = Media.subtitleTracks(currentPart), i;
    rows.push({
      label: 'Off', on: !currentSub,
      act: function () { setSub(null); closeMenu(); }
    });
    for (i = 0; i < list.length; i++) rows.push(subRow(list[i]));
  }

  function subRow(st) {
    return {
      label: Media.subLabel(st),
      note: Media.isTextSub(st) ? '' : 'image track — cannot be shown without a transcode',
      on: !!(currentSub && String(currentSub.id) === String(st.id)),
      act: function () { setSub(st); closeMenu(); }
    };
  }

  /* Quality is two different things wearing one name: another *version* of the
     film — a separate file, often the 1080p next to the 4K — and a bitrate cap,
     which is the server re-encoding this one. Both belong here because both are
     what the user means by "make this play properly", and both go through the
     guard, so the 4K rule refuses the cap and offers the other version. */
  function buildQualityRows() {
    var versions = (item && item.Media) || [], i;
    if (versions.length > 1) {
      for (i = 0; i < versions.length; i++) rows.push(versionRow(versions[i], i));
    }
    var list = Media.qualities(currentMedia);
    for (i = 0; i < list.length; i++) rows.push(qualityRow(list[i]));
  }

  function versionRow(media, n) {
    return {
      label: 'Version — ' + Media.versionLabel(media),
      on: n === mediaIndex && !maxBitrate,
      act: function () {
        if (n === mediaIndex && !maxBitrate) { closeMenu(); return; }
        switchTo({ mediaIndex: n, maxBitrate: null }, Media.versionLabel(media));
      }
    };
  }

  function qualityRow(q) {
    return {
      label: q.label,
      note: q.bitrate && Media.isUHD(currentMedia)
        ? 'a 4K transcode is what gets the stream killed — this will be refused' : '',
      on: (q.bitrate || null) === maxBitrate,
      act: function () {
        if ((q.bitrate || null) === maxBitrate) { closeMenu(); return; }
        switchTo({ maxBitrate: q.bitrate || null }, q.label);
      }
    };
  }

  function buildChapterRows() {
    var list = Media.chapters(item), i;
    rows.push({
      label: 'Play from the beginning',
      act: function () { seekTo(0); closeMenu(); }
    });
    for (i = 0; i < list.length; i++) rows.push(chapterRow(list[i]));
  }

  function chapterRow(c) {
    return {
      label: c.title, note: fmt(c.start),
      on: target() >= c.start && (!c.end || target() < c.end),
      act: function () { seekTo(c.start); closeMenu(); }
    };
  }

  function paintMenu() {
    var html = '', i, r;
    for (i = 0; i < TABS.length; i++) {
      html += '<span class="menu-tab' + (i === tab ? ' on' : '') + '">' +
              UI.escapeHtml(TABS[i]) + '</span>';
    }
    menuTabsEl.innerHTML = html;

    html = '';
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      html += '<div class="menu-row' + (i === sel ? ' sel' : '') +
              (r.on ? ' on' : '') + (r.off ? ' off' : '') + '">' +
              '<span class="menu-mark">' + (r.on ? '●' : '') + '</span>' +
              '<span class="menu-label">' + UI.escapeHtml(r.label) + '</span>' +
              (r.note ? '<span class="menu-note-inline">' + UI.escapeHtml(r.note) + '</span>' : '') +
              '</div>';
    }
    menuListEl.innerHTML = html;

    /* Keep the selection in view without a scrollbar the remote cannot use. */
    var top = UI.clamp(sel - 3, 0, Math.max(0, rows.length - ROWS_SHOWN));
    menuInnerEl.style.webkitTransform = menuInnerEl.style.transform =
      'translateY(' + (-top * ROW_H) + 'px)';
    menuNoteEl.textContent = tab === 1
      ? 'Subtitles are fetched as text and drawn here, so they cost the server nothing.'
      : (tab === 2 ? 'Anything but Original asks the server to re-encode.' : '');
  }

  function openMenu(which) {
    menuOn = true;
    if (which !== undefined) tab = which;
    sel = 0;
    buildRows();
    /* Land on what is currently in use, so OK on the first press is a no-op
       rather than a surprise. */
    var i;
    for (i = 0; i < rows.length; i++) if (rows[i].on) { sel = i; break; }
    menuEl.classList.remove('hidden');
    paintMenu();
    hint();
    showOsd();
  }

  function closeMenu() {
    menuOn = false;
    menuEl.classList.add('hidden');
    hint();
    showOsd();
  }

  function menuKey(code) {
    if (code === 38) { sel = (sel + rows.length - 1) % rows.length; paintMenu(); return true; }
    if (code === 40) { sel = (sel + 1) % rows.length; paintMenu(); return true; }
    if (code === 37 || code === 39) {
      tab = (tab + (code === 39 ? 1 : TABS.length - 1)) % TABS.length;
      openMenu(tab);
      return true;
    }
    if (code === 13 || code === 415 || code === 19) {
      var r = rows[sel];
      if (r && r.act) r.act(); else closeMenu();
      return true;
    }
    if (UI.isBack(code) || code === 413) { closeMenu(); return true; }
    return true;                       // the menu swallows everything else
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
    closeMenu();
    osdTracks.textContent = 'Switching to ' + what + '…';
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
    var code = err ? err.code : 0;
    var detail = err && err.message ? '  ·  ' + err.message : '';
    if (code === 1) return 'The stream was aborted.' + detail;
    if (code === 2) return 'The network dropped the stream — the server stopped ' +
                           'answering part way through.' + detail;
    if (code === 3) return 'The panel could not decode this stream (media error 3). ' +
                           'The server said it would direct play, so the declared ' +
                           'profile in js/plex.js claims something this panel cannot ' +
                           'actually decode.' + detail;
    if (code === 4) return 'The stream would not open (media error 4) — the server ' +
                           'refused the request, or the container is one the panel ' +
                           'will not accept at all.' + detail;
    return 'The stream failed (media error ' + code + ').' + detail;
  }

  /* A desktop browser is not this panel, and its codec support is much
     narrower — Firefox has no AC3/E-AC3 and no HEVC at all, Chrome has no
     Matroska. Silence or a decode error on the laptop usually says nothing
     about the TV, and mistaking one for the other costs an evening. */
  function laptopNote(media) {
    if (!Config.dev) return '';
    var codec = (media && media.videoCodec) || '?';
    var container = (media && media.container) || '?';
    return '  ·  You are on the dev server, so this is a desktop browser, not ' +
           'the B8. It is playing ' + String(codec).toUpperCase() + ' in ' +
           String(container).toUpperCase() + ', and browsers do not decode AC3, ' +
           'E-AC3, HEVC or Matroska the way the panel does. Judge playback on ' +
           'the TV.';
  }

  function fail(msg) {
    var report_ = onError;
    UI.debug('playback failed: ' + msg);
    stop('stopped');
    if (report_) report_(msg);
  }

  function play(opts) {
    item = opts.item;
    server = opts.server;
    onExit = opts.onExit;
    onError = opts.onError;
    onSwitch = opts.onSwitch || null;
    resumeMs = opts.item.viewOffset || 0;

    stalls = 0; lowest = 999; startedAt = Date.now();
    var url = opts.url || Plex.streamUrl(server, opts.part);
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
    marker = null; skipDismissed = null;
    skipEl.classList.add('hidden');
    menuOn = false; menuEl.classList.add('hidden');
    cues = []; currentSub = null; subNote = '';
    subEl.classList.add('hidden'); subEl.textContent = '';
    subEl.setAttribute('data-cue', '');
    wantedLang = opts.subLang === undefined ? null : opts.subLang;
    paintTracks();
    hint();
    v.classList.remove('hidden');

    v.onloadedmetadata = function () {
      /* Only now does currentTime mean anything. Don't resume within half a
         minute of the end — that is a film you finished. */
      if (resumeMs > 10000 && v.duration && resumeMs < (v.duration * 1000) - 30000) {
        v.currentTime = resumeMs / 1000;
      }
      paintTicks();
      applyChosenTrack();
      showOsd();
      report('playing');
      /* The subtitle track the user had before a restart, matched by language
         because a different version of the film has different stream ids. */
      if (wantedLang !== null) {
        var again = Media.pickSubtitle(currentPart, wantedLang);
        if (again) setSub(again);
      }
    };
    /* The track list is not always populated by loadedmetadata, so try again
       once the picture is actually running. */
    v.onplaying = function () { applyChosenTrack(); showOsd(); };
    /* 'waiting' is the panel telling us it has run dry. */
    v.onwaiting = function () { stalls++; };
    v.ontimeupdate = function () {
      if (osdShowing()) paintOsd();
      paintSub();
      checkMarker();
    };
    v.onended = function () { stop('stopped'); };
    v.onerror = function () {
      fail(mediaErrorText(v.error) + laptopNote(currentMedia));
    };

    /* preload only matters between the element existing and a src being set,
       and the src is only ever set here, at the moment we play. Leaving it at
       "none" made the browser conservative about reading ahead for no benefit. */
    v.preload = 'auto';
    v.src = url;
    v.load();
    showOsd();
    UI.debug((transcoding ? 'playing (server converting' +
              (maxBitrate ? ' at ' + Media.bitrateLabel(maxBitrate) : '') + ') ' : 'playing ') +
             String(url).split('?')[0]);

    /* Ask directly rather than waiting on loadedmetadata, which need not fire
       on its own, and report a rejected play() rather than sitting on a black
       screen — it is otherwise completely silent. */
    var started = v.play();
    if (started && started.then) {
      started.then(null, function (e) {
        fail('The player refused to start: ' + ((e && (e.name + ' ' + e.message)) || 'unknown') +
             '. If this is the TV, it is usually the media pipeline rejecting the ' +
             'container rather than the codec.');
      });
    }

    clearInterval(ticker);
    ticker = setInterval(function () {
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
    var ahead = 0;
    try {
      if (v.buffered && v.buffered.length) {
        ahead = Math.round(v.buffered.end(v.buffered.length - 1) - v.currentTime);
      }
    } catch (e) { ahead = -1; }

    var dropped = v.webkitDroppedFrameCount, decoded = v.webkitDecodedFrameCount;
    if (dropped === undefined && v.getVideoPlaybackQuality) {
      var q = v.getVideoPlaybackQuality();
      dropped = q.droppedVideoFrames;
      decoded = q.totalVideoFrames;
    }
    var frames = (decoded === undefined) ? 'frames n/a'
      : ('dropped ' + dropped + '/' + decoded);

    if (ahead >= 0 && ahead < lowest) lowest = ahead;

    return fmt(v.currentTime) + '  buffered +' + ahead + 's (low ' + lowest + 's)' +
           '  stalls ' + stalls + '  ' + frames + (v.paused ? '  PAUSED' : '');
  }

  /* Said once when playback ends, because that is when the whole picture
     exists: enough stalls on a 4K remux means the link cannot carry it, and
     the answer is the 1080p copy on the film page rather than anything here. */
  function summary() {
    var mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    return 'played ' + mins + ' min · ' + stalls + ' stall' + (stalls === 1 ? '' : 's') +
           ' · buffer low ' + (lowest === 999 ? '?' : lowest + 's');
  }

  /* quiet: tear down without telling the caller we are done — used when
     playback is about to be started again with a different track, where firing
     onExit would bounce back to the film page mid-restart. */
  function stop(state, quiet) {
    if (!item) return;
    UI.debug(summary());
    report(state || 'stopped');
    clearInterval(ticker); ticker = null;
    clearTimeout(osdTimer);
    clearTimeout(seekTimer);
    pending = null;
    subToken++;
    v.pause();
    v.onloadedmetadata = v.onplaying = v.ontimeupdate = v.onended = v.onerror = null;
    v.onwaiting = null;
    v.removeAttribute('src');
    v.load();
    v.classList.add('hidden');
    osd.classList.add('hidden');
    menuEl.classList.add('hidden');
    skipEl.classList.add('hidden');
    subEl.classList.add('hidden');
    menuOn = false; marker = null; cues = [];
    var done = quiet ? null : onExit;
    item = null; server = null; onExit = null; onError = null; onSwitch = null;
    currentPart = null; currentAudio = null; currentMedia = null; currentSub = null;
    if (done) done();
  }

  function playing() { return !!item; }

  function key(code) {
    if (menuOn) return menuKey(code);

    /* Digits jump by tenths — the cheapest way past a first act there is. */
    if (code >= 48 && code <= 57) { jumpToTenth(code - 48); return true; }

    switch (code) {
      case 13: case 415: case 19: case 179:      // OK / play / pause
        /* While the skip prompt is up, OK takes it. That is the one moment the
           button means something other than pause, and it is the moment you
           are reaching for it. */
        if (marker) { takeSkip(); return true; }
        if (v.paused) v.play(); else v.pause();
        report(v.paused ? 'paused' : 'playing');
        showOsd();
        return true;
      case 37:                                    // left
        seekBy(-NUDGE);
        return true;
      case 39:                                    // right
        seekBy(NUDGE);
        return true;
      case 412:                                   // rewind
        seekBy(-JUMP);
        return true;
      case 417:                                   // fast forward
        seekBy(JUMP);
        return true;
      case 38:                                    // up — the menu
        openMenu(0);
        return true;
      case 40:                                    // down — the menu
        openMenu(0);
        return true;
      case 33:                                    // channel up — next chapter
        chapterStep(1);
        return true;
      case 34:                                    // channel down — previous chapter
        chapterStep(-1);
        return true;
      case 403: openMenu(0); return true;         // red — audio
      case 404: openMenu(1); return true;         // green — subtitles
      case 405: openMenu(2); return true;         // yellow — quality
      case 406: openMenu(3); return true;         // blue — chapters
      case 461: case 27: case 8: case 413:        // back / stop
        if (marker) { dismissSkip(); return true; }
        stop('stopped');
        return true;
    }
    return false;
  }

  return { play: play, stop: stop, playing: playing, key: key };
})();
