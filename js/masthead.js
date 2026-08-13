/* The panel above the rail: what is focused, and whether it will play.

   The badges are the point. Resolution, codec and container come free with the
   list response; the audio badge is the one that matters, because it says which
   track we would ask for and therefore whether pressing OK is going to be
   refused. Green means a 5.1 track that passes over ARC, amber means stereo or
   a downmix, red means nothing on this file can pass at all. */
var Masthead = (function () {
  'use strict';

  var elTitle = document.getElementById('mh-title');
  var elMeta = document.getElementById('mh-meta');
  var elBadges = document.getElementById('mh-badges');
  var elSummary = document.getElementById('mh-summary');

  function badge(text, cls) {
    return '<span class="badge' + (cls ? ' ' + cls : '') + '">' +
           UI.escapeHtml(text) + '</span>';
  }

  function audioBadge(item) {
    var md = Meta.get(item.ratingKey);
    if (!md) return badge('AUDIO …');
    var part = md.Media && md.Media[0] && md.Media[0].Part && md.Media[0].Part[0];
    var audio = Media.pickAudio(part);
    if (!audio) return badge('NO PASSABLE AUDIO', 'bad');
    return badge('AUDIO ' + Media.audioLabel(audio), audio.channels > 2 ? 'good' : 'warn');
  }

  function render(row, item, hasRows) {
    var position = row && row.total ? ((row.focus + 1) + ' of ' + row.total) : '';

    if (!item) {
      elTitle.textContent = hasRows ? '…' : 'Loading…';
      elMeta.textContent = position;
      elBadges.innerHTML = '';
      elSummary.textContent = '';
      return;
    }

    elTitle.textContent = item.title || '';
    elSummary.textContent = item.summary || '';

    var meta = [];
    if (item.year) meta.push(item.year);
    if (item.duration) meta.push(Math.round(item.duration / 60000) + ' min');
    if (item.contentRating) meta.push(item.contentRating);
    if (item.viewOffset && item.duration) {
      meta.push(Math.round(100 * item.viewOffset / item.duration) + '% watched');
    }
    meta.push(position);
    elMeta.textContent = meta.join('   ·   ');

    var media = (item.Media && item.Media[0]) || {};
    var b = '';
    if (media.videoResolution) {
      b += badge(String(media.videoResolution).toUpperCase(), Media.isUHD(media) ? 'warn' : '');
    }
    if (media.videoCodec) b += badge(String(media.videoCodec).toUpperCase());
    if (media.container) b += badge(String(media.container).toUpperCase());
    b += audioBadge(item);
    elBadges.innerHTML = b;
  }

  return { render: render };
})();
