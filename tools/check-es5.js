/* Does the shipped app still run on Chromium 53?

     npm run check

   webOS 4.0 is stuck on Chromium 53 forever, and the laptop you develop on is
   not. Everything in js/ and css/ works in desktop Chrome long before it works
   on the TV, so the mistake this catches is the one you cannot see: code that
   is fine in the browser you tested in and a blank screen on the panel.

   This is a text scan, not a parser. It knows the constructs that have actually
   come up, and it will not catch everything — treat a clean run as "nothing
   obviously wrong", not as proof. dev/, test/ and tools/ are not scanned; they
   never reach the TV. */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* Chrome version each thing landed in, so the message can say why. */
const JS_RULES = [
  [/\basync\s+(function|\()/, 'async functions', 'Chrome 55'],
  [/\bawait\s+[\w({[]/, 'await', 'Chrome 55'],
  [/\{\s*\.\.\./, 'object spread', 'Chrome 60'],
  [/,\s*\.\.\.\w+\s*\}/, 'object rest', 'Chrome 60'],
  [
    /\bObject\.(entries|values|fromEntries|getOwnPropertyDescriptors)\s*\(/,
    'Object.entries/values',
    'Chrome 54',
  ],
  [/\bPromise\.(any|allSettled)\s*\(/, 'Promise.any / allSettled', 'Chrome 76+'],
  [/\.finally\s*\(/, 'Promise.prototype.finally', 'Chrome 63'],
  [/\.(padStart|padEnd)\s*\(/, 'String.padStart/padEnd', 'Chrome 57'],
  [/\.(trimStart|trimEnd)\s*\(/, 'String.trimStart/trimEnd', 'Chrome 66'],
  [/\.(flat|flatMap)\s*\(/, 'Array.flat/flatMap', 'Chrome 69'],
  [/\.(matchAll|replaceAll)\s*\(/, 'String.matchAll/replaceAll', 'Chrome 73+'],
  [/\.at\s*\(/, 'Array.at', 'Chrome 92'],
  [/\?\./, 'optional chaining', 'Chrome 80'],
  [/\?\?/, 'nullish coalescing', 'Chrome 80'],
  [/\bglobalThis\b/, 'globalThis', 'Chrome 71'],
  [/\bstructuredClone\s*\(/, 'structuredClone', 'Chrome 98'],
  [/\bqueueMicrotask\s*\(/, 'queueMicrotask', 'Chrome 71'],
  [/\bResizeObserver\b/, 'ResizeObserver', 'Chrome 64'],
  [/\bBigInt\b/, 'BigInt', 'Chrome 67'],
  [/\bObject\.hasOwn\s*\(/, 'Object.hasOwn', 'Chrome 93'],
  /* Not a compatibility rule but a readability one, and the only place it can
     be enforced. Chromium 53 has block scoping (Chrome 49), so inside a module
     there is no reason to reach for var. The one var per file that is allowed
     sits at column 0: that is the module's own binding, and only var puts a
     property on the global object for index.html's next script tag and for
     test/load.js. */
  [/^\s+var\s/, 'var inside a module', 'house rule: const/let, Chrome 49'],
];

const CSS_RULES = [
  [/display\s*:\s*(inline-)?grid/, 'CSS Grid', 'Chrome 57'],
  [/\bgrid-(template|area|column|row|gap)/, 'CSS Grid', 'Chrome 57'],
  [/position\s*:\s*sticky/, 'position: sticky', 'Chrome 56'],
  [/(^|[;{\s])gap\s*:/, 'flexbox gap', 'Chrome 84'],
  [/\baspect-ratio\s*:/, 'aspect-ratio', 'Chrome 88'],
  [/backdrop-filter\s*:/, 'backdrop-filter', 'Chrome 76'],
  [/:\s*(clamp|min|max)\(/, 'CSS clamp()/min()/max()', 'Chrome 79'],
  [/:(is|where)\s*\(/, ':is() / :where()', 'Chrome 88'],
  /* CLAUDE.md: animate transform and opacity only — everything else forces
     layout or paint on a 2018 SoC. */
  [
    /transition[^;]*:[^;]*\b(filter|box-shadow|blur|all)\b/,
    'transition on filter/shadow/all',
    'house rule: transform and opacity only',
  ],
  [
    /animation[^;]*:[^;]*\b(filter|box-shadow|blur)\b/,
    'animation on filter/shadow',
    'house rule: transform and opacity only',
  ],
];

/* Comment and string noise this scan should not trip over: a rule name quoted
   inside a comment is not a use of it. Crude, but it keeps the output honest. */
function stripNoise(line) {
  return line
    .replace(/\/\*.*?\*\//g, '')
    .replace(/^\s*\*.*$/, '')
    .replace(/\/\/.*$/, '');
}

const problems = [];

function scan(file, rules) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let inBlockComment = false;
  lines.forEach(function (raw, i) {
    let line = raw;
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const open = line.lastIndexOf('/*');
    if (open >= 0 && line.indexOf('*/', open) < 0) {
      inBlockComment = true;
      line = line.slice(0, open);
    }
    line = stripNoise(line);
    rules.forEach(function (rule) {
      if (rule[0].test(line)) {
        problems.push(
          rel +
            ':' +
            (i + 1) +
            '  ' +
            rule[1] +
            '  (' +
            rule[2] +
            ')\n      ' +
            raw.trim().slice(0, 100),
        );
      }
    });
  });
}

function listFiles(dir, ext) {
  const out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push.apply(out, listFiles(full, ext));
    else if (path.extname(e.name) === ext) out.push(full);
  });
  return out.sort();
}

/* What each layer is allowed to touch. Without this the directories are a
   suggestion, and a suggestion is what a screen file reaches past at 1am when
   it wants one more field off the server.

   The rule is per layer, and it is about what a file may *reach for*, not what
   it may know: api/ is the only place an XHR is opened, data/ the only place
   the key/value store is addressed, and rules/ is the pure half — no DOM, no
   request, no cache — which is what makes it the half worth unit testing. */
const LAYER_RULES = {
  'js/rules': [
    [/\bdocument\./, 'the DOM in rules/', 'rules/ is pure: no DOM, no request, no cache'],
    [/\bXMLHttpRequest\b/, 'a request in rules/', 'rules/ is pure: call it from data/'],
    [/\b(Store|Cache)\./, 'the cache in rules/', 'rules/ is pure: read it in data/'],
  ],
  'js/api': [[/\bdocument\./, 'the DOM in api/', 'api/ speaks to servers, not to the screen']],
  'js/view': [
    [/\bXMLHttpRequest\b/, 'a raw request in view/', 'go through api/'],
    [/\bStore\./, 'the store in view/', 'go through Cache, in data/'],
  ],
  'js/screen': [
    [/\bXMLHttpRequest\b/, 'a raw request in screen/', 'go through api/'],
    [/\bStore\./, 'the store in screen/', 'go through Cache, in data/'],
  ],
  'js/core': [[/\bXMLHttpRequest\b/, 'a raw request in core/', 'go through api/']],
};

/* http.js is the one file whose whole job is the thing api/ owns. */
const LAYER_EXEMPT = { 'js/api/http.js': 1, 'js/data/store.js': 1 };

function layerOf(rel) {
  const parts = rel.split('/');
  return parts.length > 2 ? parts[0] + '/' + parts[1] : null;
}

const jsFiles = listFiles(path.join(ROOT, 'js'), '.js');
jsFiles.forEach(function (f) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  scan(f, JS_RULES);
  if (LAYER_EXEMPT[rel]) return;
  const extra = LAYER_RULES[layerOf(rel)];
  if (extra) scan(f, extra);
});
const cssFiles = listFiles(path.join(ROOT, 'css'), '.css');
cssFiles.forEach(function (f) {
  scan(f, CSS_RULES);
});

/* Every module in js/ has to be in index.html, in one of the script tags, and
   every stylesheet in one of the link tags, or it simply is not in the app —
   there is no bundler to notice. The stylesheets are one file per screen, so
   this is now the way a whole screen loses its styling in silence. */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* Compared by path, not by basename: js/ is layered now, and a script tag
   naming the right file in the wrong layer is exactly the mistake a move
   like that makes. */
function loaded(dir, files, tags) {
  const referenced = (html.match(tags) || []).map(function (s) {
    return s.replace(/"$/, '').replace(/^.*"/, '');
  });
  const present = files.map(function (f) {
    return path.relative(ROOT, f).split(path.sep).join('/');
  });
  present.forEach(function (f) {
    if (referenced.indexOf(f) < 0)
      problems.push('index.html  ' + f + ' exists but is never loaded');
  });
  referenced.forEach(function (f) {
    if (present.indexOf(f) < 0) problems.push('index.html  loads ' + f + ', which does not exist');
  });
  return present;
}

const scripts = loaded('js/', jsFiles, /<script src="js\/[^"]+"/g);
const sheets = loaded('css/', cssFiles, /<link rel="stylesheet" href="css\/[^"]+"/g);

if (problems.length) {
  console.log(
    '\n  ' +
      problems.length +
      ' problem' +
      (problems.length === 1 ? '' : 's') +
      ' for Chromium 53:\n',
  );
  problems.forEach(function (p) {
    console.log('  ' + p);
  });
  console.log('');
  process.exit(1);
}

console.log(
  '  chromium 53: ' +
    scripts.length +
    ' scripts, ' +
    sheets.length +
    ' stylesheets, nothing unsupported',
);
