/* The laptop harness: serves the app and pretends to be Plex.
   Runs on Node only — the Chromium 53 constraint does not apply in dev/.

     node dev/server.js                    mock server, 2000 films
     node dev/server.js --films 30000      the real library's size, for feel
     node dev/server.js --latency 140      pretend the server is far away
     node dev/server.js --proxy            talk to the real plex.tv instead

   Then open http://localhost:8080. Nothing in dev/ is loaded by the packaged
   app: index.html is rewritten in memory on the way out, never on disk. */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const mock = require('./mock-plex');

const ROOT = path.join(__dirname, '..');

/* The video the mock serves for every item, if you have given it one. */
function fixture() {
  const names = ['sample.mp4', 'sample.webm', 'sample.mkv'];
  for (const name of names) {
    const p = path.join(__dirname, 'fixtures', name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function parseArgs(argv) {
  const out = { port: 8080, films: 2000, uhd: 300, latency: 0, pinPolls: 2,
                proxy: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--films') out.films = Number(argv[++i]);
    else if (a === '--uhd') out.uhd = Number(argv[++i]);
    else if (a === '--latency') out.latency = Number(argv[++i]);
    else if (a === '--pin-polls') out.pinPolls = Number(argv[++i]);
    else if (a === '--proxy') out.proxy = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { console.error('unknown option ' + a); usage(); process.exit(2); }
  }
  return out;
}

function usage() {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\* ?/, ''));
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

function start(opts) {
  const log = opts.quiet ? function () {} : function (m) { console.log('  ' + m); };
  const api = mock.create({ films: opts.films, uhd: opts.uhd, pinPolls: opts.pinPolls, log: log });

  const server = http.createServer(function (req, res) {
    const parsed = url.parse(req.url, true);
    const pathname = decodeURIComponent(parsed.pathname);
    const origin = 'http://' + (req.headers.host || ('localhost:' + opts.port));

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'
      });
      res.end();
      return;
    }

    if (opts.proxy && pathname.indexOf('/__plextv') === 0) {
      proxyToPlexTv(req, res, parsed);
      return;
    }

    if (pathname.indexOf('/__plex') === 0) {
      const run = function () {
        if (!api.handle(req, res, pathname, parsed.query, origin)) {
          console.log('  UNHANDLED ' + req.method + ' ' + pathname +
                      '  <- the app is calling something the mock does not know');
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('mock: no route for ' + pathname);
        }
      };
      if (opts.latency) setTimeout(run, opts.latency); else run();
      return;
    }

    if (pathname === '/__dev/shim.js') {
      sendFile(res, path.join(__dirname, 'shim.js'));
      return;
    }

    /* The TV never asks for this; the browser always does. */
    if (pathname === '/favicon.ico') { sendFile(res, path.join(ROOT, 'icon.png')); return; }

    /* The app itself, straight off disk. */
    let rel = pathname === '/' ? '/index.html' : pathname;
    const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    if (rel === '/index.html') { sendIndex(res, file, opts); return; }
    sendFile(res, file);
  });

  server.listen(opts.port, function () {
    console.log('');
    console.log('  Reflex dev server   http://localhost:' + opts.port);
    console.log('  ' + (opts.proxy ? 'plex.tv proxied for real; sign in with your own account'
                                   : 'mock Plex: ' + opts.films + ' films, ' + opts.uhd +
                                     ' 4K films, pin claims itself'));
    if (opts.latency) console.log('  ' + opts.latency + 'ms added to every server response');
    if (!fixture()) {
      console.log('  no video to play: OK on a film will reach its error path.');
      console.log('  npm run fixture   (or drop one at dev/fixtures/sample.mp4)');
    }
    console.log('  keys: arrows, Enter, Backspace = Back, F1 = red/search, ? = help');
    console.log('');
  });
  return server;
}

function sendFile(res, file) {
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(500); res.end(String(err)); return; }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

/* index.html is rewritten on the way out: config before the app's own scripts,
   the key shim after them. The file on disk stays exactly what ships. */
function sendIndex(res, file, opts) {
  fs.readFile(file, 'utf8', function (err, html) {
    if (err) { res.writeHead(500); res.end(String(err)); return; }
    const config = {
      plexTvBase: '/__plextv',
      dev: true,
      tmdbKey: process.env.TMDB_KEY || ''
    };
    const out = html
      .replace('</head>',
        '<script>window.REFLEX_CONFIG = ' + JSON.stringify(config) + ';</script>\n</head>')
      .replace('</body>', '<script src="/__dev/shim.js"></script>\n</body>');
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    res.end(out);
  });
}

/* --proxy: forward /__plextv/* to the real plex.tv so you can sign in with a
   real account and browse the real library from the laptop. Discovery then
   hands the browser the server's own https address and the app talks to it
   directly, same as on the TV. Your token passes through this process. */
function proxyToPlexTv(req, res, parsed) {
  const chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    const headers = Object.assign({}, req.headers);
    delete headers.host;
    delete headers.origin;
    delete headers.referer;
    delete headers['accept-encoding'];
    const target = parsed.path.slice('/__plextv'.length) || '/';
    const out = https.request({
      host: 'plex.tv', port: 443, method: req.method, path: target, headers: headers
    }, function (up) {
      const h = Object.assign({}, up.headers);
      h['access-control-allow-origin'] = '*';
      res.writeHead(up.statusCode, h);
      up.pipe(res);
    });
    out.on('error', function (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('plex.tv proxy failed: ' + e.message);
    });
    if (chunks.length) out.write(Buffer.concat(chunks));
    out.end();
  });
}

if (require.main === module) start(parseArgs(process.argv.slice(2)));

module.exports = { start: start, parseArgs: parseArgs };
