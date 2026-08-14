/* Subtitles are the one player feature that costs the server nothing — a text
   file, fetched once and drawn over the video, instead of the server burning
   words into a 4K picture and getting the session killed. That only holds if
   the parsing is right, so it gets a test.

   Run: node test/subs.test.js */
var assert = require('assert');
var loaded = require('./load.js')(['subs', 'panel', 'media']);
var Subs = loaded.Subs;
var Media = loaded.Media;

/* ---------- parsing ---------- */

var SRT = [
  '1',
  '00:00:01,000 --> 00:00:03,500',
  'The first line.',
  '',
  '2',
  '00:00:04,000 --> 00:00:06,000',
  '<i>Two lines,</i>',
  'the second one italic.',
  '',
  '3',
  '01:02:03,250 --> 01:02:05,000',
  '{\\an8}A sign, high on the screen.',
  ''
].join('\n');

var cues = Subs.parse(SRT);
assert.strictEqual(cues.length, 3);
assert.strictEqual(cues[0].start, 1);
assert.strictEqual(cues[0].end, 3.5);
assert.strictEqual(cues[0].text, 'The first line.');

// Markup a TV has no business rendering is stripped, the words are not.
assert.strictEqual(cues[1].text, 'Two lines,\nthe second one italic.');
assert.strictEqual(cues[2].text, 'A sign, high on the screen.');
assert.strictEqual(cues[2].start, 3723.25);

// WebVTT is the same file with dots and a header, and servers hand back either.
var VTT = 'WEBVTT\n\n00:00:02.000 --> 00:00:04.000 line:90%\nFrom a VTT.\n';
assert.strictEqual(Subs.parse(VTT).length, 1);
assert.strictEqual(Subs.parse(VTT)[0].text, 'From a VTT.');
assert.strictEqual(Subs.parse(VTT)[0].start, 2);

// Windows line endings, and a file with no trailing blank line.
assert.strictEqual(Subs.parse('1\r\n00:00:01,000 --> 00:00:02,000\r\nHello.\r\n').length, 1);

// Nothing at all is not an error — an empty track is a track with no words.
assert.strictEqual(Subs.parse('').length, 0);
assert.strictEqual(Subs.parse(null).length, 0);
assert.strictEqual(Subs.parse('not a subtitle file at all').length, 0);

// A cue whose number sits on the line before the next timestamp belongs to that
// next cue, not to the end of this one — otherwise every line ends in a digit.
var RUN_ON = '1\n00:00:01,000 --> 00:00:02,000\nFirst.\n2\n00:00:03,000 --> 00:00:04,000\nSecond.\n';
var runOn = Subs.parse(RUN_ON);
assert.strictEqual(runOn.length, 2);
assert.strictEqual(runOn[0].text, 'First.');
assert.strictEqual(runOn[1].text, 'Second.');

/* ---------- what is on screen ---------- */

assert.strictEqual(Subs.textAt(cues, 0), '');
assert.strictEqual(Subs.textAt(cues, 1), 'The first line.');
assert.strictEqual(Subs.textAt(cues, 2), 'The first line.');
assert.strictEqual(Subs.textAt(cues, 3.6), '', 'a cue is gone once it ends');
assert.strictEqual(Subs.textAt(cues, 5).indexOf('Two lines') === 0, true);
assert.strictEqual(Subs.textAt(cues, 3723.5), 'A sign, high on the screen.');
assert.strictEqual(Subs.textAt([], 10), '');

// Overlapping cues — two speakers, or a translated sign over dialogue — are
// both on screen, in time order.
var OVERLAP = Subs.parse([
  '1', '00:00:01,000 --> 00:00:09,000', 'A long one.', '',
  '2', '00:00:03,000 --> 00:00:04,000', 'A short one.', ''
].join('\n'));
assert.strictEqual(Subs.textAt(OVERLAP, 3.5), 'A long one.\nA short one.');
assert.strictEqual(Subs.textAt(OVERLAP, 8), 'A long one.');

// Straight after a seek to the far end of a two-hour film, the search still has
// to land on the right cue rather than walk there.
function hms(sec) {
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(Math.floor(sec / 3600)) + ':' + p(Math.floor(sec / 60) % 60) + ':' +
         p(sec % 60) + ',000';
}
var many = [];
for (var i = 0; i < 4000; i++) {
  many.push(String(i + 1), hms(i * 2) + ' --> ' + hms(i * 2 + 1), 'Cue ' + i, '');
}
var big = Subs.parse(many.join('\n'));
assert.strictEqual(big.length, 4000);
assert.strictEqual(Subs.textAt(big, 7000.5), 'Cue 3500');

/* ---------- which track ---------- */

function part(streams) {
  return { Stream: streams.map(function (s, n) {
    return Object.assign({ id: 500 + n, streamType: 3 }, s);
  }) };
}

// A picture of words can only reach the screen by the server painting it into
// the video, which is a transcode — so it is never a candidate.
assert.strictEqual(Media.isTextSub({ codec: 'subrip' }), true);
assert.strictEqual(Media.isTextSub({ codec: 'ass' }), true);
assert.strictEqual(Media.isTextSub({ codec: 'pgs' }), false);
assert.strictEqual(Media.isTextSub({ codec: 'vobsub' }), false);
assert.strictEqual(Media.isTextSub(null), false);

var tracks = part([{ codec: 'pgs', languageCode: 'eng' },
                   { codec: 'subrip', languageCode: 'fre' },
                   { codec: 'subrip', languageCode: 'eng', selected: true }]);
assert.strictEqual(Media.subtitleTracks(tracks).length, 3, 'all of them are listed…');
assert.strictEqual(Media.pickSubtitle(tracks).languageCode, 'eng', '…but only text is picked');
assert.strictEqual(Media.pickSubtitle(tracks, 'fre').languageCode, 'fre',
                   'a language the user asked for wins over the selected flag');
assert.strictEqual(Media.pickSubtitle(tracks, 'deu').languageCode, 'eng',
                   'a language the file does not have falls back rather than failing');
assert.strictEqual(Media.pickSubtitle(part([{ codec: 'pgs' }])), null,
                   'image tracks only means no subtitles');
assert.strictEqual(Media.pickSubtitle(part([])), null);

// A forced track is the foreign-dialogue captions on an English film, which is
// the right default when nothing is marked selected.
assert.strictEqual(
  Media.pickSubtitle(part([{ codec: 'subrip', languageCode: 'eng' },
                           { codec: 'subrip', languageCode: 'eng', forced: true }])).forced, true);

// Commentary subtitles exist too, and are no more the film than the audio kind.
assert.strictEqual(
  Media.pickSubtitle(part([{ codec: 'subrip', languageCode: 'eng', title: 'Director commentary' },
                           { codec: 'subrip', languageCode: 'eng', title: 'Full' }])).title, 'Full');

// Named for a menu, not for a badge.
assert.ok(/French/.test(Media.subLabel({ codec: 'subrip', languageCode: 'fre' })));
assert.ok(/image/.test(Media.subLabel({ codec: 'pgs', languageCode: 'eng' })));
assert.strictEqual(Media.subLabel(null), 'Off');
assert.strictEqual(Media.langName({ languageCode: 'jpn' }), 'Japanese');
assert.strictEqual(Media.langName({ language: 'Cornish' }), 'Cornish');
assert.strictEqual(Media.langName({ languageCode: 'xyz' }), 'XYZ');

/* ---------- markers and chapters ---------- */

var film = {
  duration: 7200000,
  Marker: [{ type: 'intro', startTimeOffset: 30000, endTimeOffset: 90000 },
           { type: 'credits', startTimeOffset: 7000000, endTimeOffset: 7200000 }],
  Chapter: [{ index: 2, tag: 'Two', startTimeOffset: 600000, endTimeOffset: 1200000 },
            { index: 1, tag: 'One', startTimeOffset: 0, endTimeOffset: 600000 }]
};

assert.strictEqual(Media.markerAt(film, 10), null);
assert.strictEqual(Media.markerAt(film, 45).type, 'intro');
assert.strictEqual(Media.markerAt(film, 90), null, 'the offer ends when the intro does');
assert.strictEqual(Media.markerLabel(Media.markerAt(film, 7001)), 'Skip credits');
assert.strictEqual(Media.markerAt({}, 45), null);

var chapters = Media.chapters(film);
assert.strictEqual(chapters.length, 2);
assert.strictEqual(chapters[0].title, 'One', 'in time order, whatever order they arrived in');
assert.strictEqual(chapters[0].start, 0);
assert.strictEqual(chapters[1].start, 600);
assert.strictEqual(Media.chapters(null).length, 0);

/* ---------- quality ----------

   Every entry below Original is the server re-encoding, so on a 4K file the
   guard refuses all of them. That is the rule working, not a gap. */

var hd = { videoResolution: '1080', videoCodec: 'h264', bitrate: 9000, width: 1920, height: 1080 };
var qualities = Media.qualities(hd);
assert.strictEqual(qualities[0].bitrate, null, 'Original is always first');
assert.ok(/1080p H264/.test(qualities[0].label));
assert.ok(qualities.length > 1);
qualities.slice(1).forEach(function (q) {
  assert.ok(q.bitrate < hd.bitrate, 'never offer a cap above what the file already is');
});
assert.strictEqual(Media.qualities({ bitrate: 500 }).length, 1,
                   'a file already below every cap has nothing to choose');
assert.strictEqual(Media.versionLabel({ videoResolution: '4k', videoCodec: 'hevc', bitrate: 48000 }),
                   '4K HEVC · 48 Mbps');
assert.strictEqual(Media.bitrateLabel(720), '720 Kbps');

console.log('subtitles, markers and quality: all assertions passed');
