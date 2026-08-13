/* Audio track selection is the rule that keeps us off the server admin's
   transcode dashboard, so it gets the one test. Run: node test/audio.test.js */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'media.js'), 'utf8');
var Media = new Function(src + '; return Media;')();

function part(streams) {
  return { Stream: streams.map(function (s, i) {
    return Object.assign({ id: 100 + i, streamType: 2 }, s);
  }) };
}

var pick = Media.pickAudio;

// TrueHD can never pass over plain ARC. Nothing else on offer -> refuse.
assert.strictEqual(pick(part([{ codec: 'truehd', channels: 8 }])), null);

// DTS-HD MA likewise.
assert.strictEqual(pick(part([{ codec: 'dca', profile: 'ma', channels: 8 }])), null);

// TrueHD present but an AC3 track exists -> take the AC3.
assert.strictEqual(
  pick(part([{ codec: 'truehd', channels: 8 }, { codec: 'ac3', channels: 6 }])).codec, 'ac3');

// E-AC3 beats AC3.
assert.strictEqual(
  pick(part([{ codec: 'ac3', channels: 6 }, { codec: 'eac3', channels: 6 }])).codec, 'eac3');

// Among AC3 tracks, prefer 5.1 over stereo.
assert.strictEqual(
  pick(part([{ codec: 'ac3', channels: 2 }, { codec: 'ac3', channels: 6 }])).channels, 6);

// Among AAC tracks, prefer stereo — a 5.1 AAC gets downmixed anyway.
assert.strictEqual(
  pick(part([{ codec: 'aac', channels: 6 }, { codec: 'aac', channels: 2 }])).channels, 2);

// Plain DTS is a coin flip on this generation of panel, so AAC wins.
assert.strictEqual(
  pick(part([{ codec: 'dca', channels: 6 }, { codec: 'aac', channels: 2 }])).codec, 'aac');

// Subtitle and video streams are not audio candidates.
assert.strictEqual(pick({ Stream: [{ streamType: 1, codec: 'hevc' },
                                   { streamType: 3, codec: 'srt' }] }), null);
assert.strictEqual(pick(null), null);

// What the panel decodes. We identify as Chrome to get a decision at all, so a
// server may offer direct play of something Chrome handles and this panel does
// not — that has to be refused here rather than shown as a black screen.
assert.strictEqual(Media.canDecode({ videoCodec: 'h264', container: 'mkv' }), true);
assert.strictEqual(Media.canDecode({ videoCodec: 'hevc', container: 'mp4' }), true);
assert.strictEqual(Media.canDecode({ videoCodec: 'h264', container: 'mpegts' }), true);
assert.strictEqual(Media.canDecode({ videoCodec: 'HEVC', container: 'MKV' }), true);
assert.strictEqual(Media.canDecode({ videoCodec: 'vp9', container: 'webm' }), false);
assert.strictEqual(Media.canDecode({ videoCodec: 'av1', container: 'mkv' }), false);
assert.strictEqual(Media.canDecode({ videoCodec: 'vc1', container: 'mkv' }), false);
assert.strictEqual(Media.canDecode({ videoCodec: 'h264', container: 'avi' }), false);
assert.strictEqual(Media.canDecode({}), false);
assert.strictEqual(Media.canDecode(null), false);

// The 4K guard fires on UHD dimensions, not on 1080p.
assert.strictEqual(Media.isUHD({ width: 3840, height: 2160 }), true);
assert.strictEqual(Media.isUHD({ width: 1920, height: 1080 }), false);

assert.strictEqual(Media.audioLabel({ codec: 'eac3', channels: 6, languageCode: 'eng' }),
                   'EAC3 5.1 ENG');

console.log('audio selection: all assertions passed');
