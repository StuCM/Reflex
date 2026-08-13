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
  [/\bObject\.(entries|values|fromEntries|getOwnPropertyDescriptors)\s*\(/, 'Object.entries/values', 'Chrome 54'],
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
  [/\bObject\.hasOwn\s*\(/, 'Object.hasOwn', 'Chrome 93']
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
  [/transition[^;]*:[^;]*\b(filter|box-shadow|blur|all)\b/, 'transition on filter/shadow/all',
   'house rule: transform and opacity only'],
  [/animation[^;]*:[^;]*\b(filter|box-shadow|blur)\b/, 'animation on filter/shadow',
   'house rule: transform and opacity only']
];

/* Comment and string noise this scan should not trip over: a rule name quoted
   inside a comment is not a use of it. Crude, but it keeps the output honest. */
function stripNoise(line) {
  return line.replace(/\/\*.*?\*\//g, '').replace(/^\s*\*.*$/, '').replace(/\/\/.*$/, '');
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
        problems.push(rel + ':' + (i + 1) + '  ' + rule[1] + '  (' + rule[2] + ')\n      ' +
                      raw.trim().slice(0, 100));
      }
    });
  });
}

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return path.extname(f) === ext; })
    .map(function (f) { return path.join(dir, f); });
}

const jsFiles = listFiles(path.join(ROOT, 'js'), '.js');
jsFiles.forEach(function (f) { scan(f, JS_RULES); });
listFiles(path.join(ROOT, 'css'), '.css').forEach(function (f) { scan(f, CSS_RULES); });

/* Every module in js/ has to be in index.html, in one of the script tags, or it
   simply is not in the app — there is no bundler to notice. */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const referenced = (html.match(/<script src="js\/[^"]+"/g) || [])
  .map(function (s) { return s.replace(/.*js\//, '').replace(/"$/, ''); });
const present = jsFiles.map(function (f) { return path.basename(f); });

present.forEach(function (f) {
  if (referenced.indexOf(f) < 0) problems.push('index.html  js/' + f + ' exists but is never loaded');
});
referenced.forEach(function (f) {
  if (present.indexOf(f) < 0) problems.push('index.html  loads js/' + f + ', which does not exist');
});

if (problems.length) {
  console.log('\n  ' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') +
              ' for Chromium 53:\n');
  problems.forEach(function (p) { console.log('  ' + p); });
  console.log('');
  process.exit(1);
}

console.log('  chromium 53: ' + present.length + ' scripts, ' +
            listFiles(path.join(ROOT, 'css'), '.css').length + ' stylesheets, nothing unsupported');
