/* Regenerates src/view/glyphs.ts from @phosphor-icons/core.

     node tools/icons.js

   The design names its icons (design/Mantis Screens.dc.html: ACTIONS and
   PLAYER_BTNS), so the mapping below is transcribed from it rather than
   chosen. Phosphor is a devDependency: the paths ship, the package does not. */
'use strict';

const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'node_modules', '@phosphor-icons', 'core', 'assets');
const OUT = path.join(__dirname, '..', 'src', 'view', 'glyphs.ts');

const MAP = [
  ['audio', 'regular/speaker-high'],
  ['subs', 'regular/subtitles'],
  ['quality', 'regular/monitor-play'],
  ['trailer', 'regular/film-reel'],
  ['source', 'regular/hard-drives'],
  ['remove', 'regular/minus-circle'],
  ['rewind', 'regular/rewind'],
  ['forward', 'regular/fast-forward'],
  ['play', 'fill/play-fill'],
  ['pause', 'fill/pause-fill'],
  ['chapters', 'regular/list-numbers'],
  ['back', 'regular/arrow-left'],
];

function inner(rel) {
  const file = path.join(ASSETS, rel + '.svg');
  if (!fs.existsSync(file)) throw new Error('no such icon: ' + rel);
  const text = fs.readFileSync(file, 'utf8');
  const body = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(text);
  if (!body) throw new Error('unreadable svg: ' + rel);
  return body[1].trim().replace(/\s+/g, ' ');
}

const head = fs.readFileSync(OUT, 'utf8').split('\n/** phosphor')[0];
const parts = MAP.map(function (pair) {
  return (
    '\n/** phosphor ' +
    pair[1].split('/')[1] +
    ' */\nexport const ' +
    pair[0] +
    " = glyph(\n  '" +
    inner(pair[1]) +
    "',\n);"
  );
});
fs.writeFileSync(OUT, head + parts.join('\n') + '\n');
console.log('  ' + MAP.length + ' icons -> src/view/glyphs.ts');
