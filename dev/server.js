/* The laptop harness: serves the app and pretends to be Plex.
   Runs on Node only — the Chromium 53 constraint does not apply in dev/.

     node dev/server.js                    mock server, 2000 films
     node dev/server.js --films 30000      the real library's size, for feel
     node dev/server.js --latency 140      pretend the server is far away
     node dev/server.js --proxy            talk to the real plex.tv instead

   Then open http://localhost:8080, or whatever $PORT says — the harness that
   opens a preview pane assigns a free one rather than fighting whatever else
   is listening. Nothing in dev/ is loaded by the packaged app: index.html is
   rewritten in memory on the way out, never on disk. */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const mock = require('./mock-plex');
const mockTmdb = require('./mock-tmdb');
const mockYoutube = require('./mock-youtube');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

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
  /* `|| 8080` would swallow PORT=0, which legitimately means "any free port".
     Absent and empty are the only cases that take the default. */
  const envPort = process.env.PORT;
  const out = {
    port: envPort === undefined || envPort === '' ? 8080 : Number(envPort),
    films: 2000,
    latency: 0,
    pinPolls: 2,
    proxy: false,
    quiet: false,
    built: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--films') out.films = Number(argv[++i]);
    else if (a === '--latency') out.latency = Number(argv[++i]);
    else if (a === '--pin-polls') out.pinPolls = Number(argv[++i]);
    else if (a === '--proxy') out.proxy = true;
    else if (a === '--built') out.built = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else {
      console.error('unknown option ' + a);
      usage();
      process.exit(2);
    }
  }
  return out;
}

function usage() {
  console.log(
    fs
      .readFileSync(__filename, 'utf8')
      .split('*/')[0]
      .replace(/^\/\* ?/, ''),
  );
}

/* Vite serves the app's own modules and nothing else: the mock keeps every
   route it owns, and index.html stays with sendIndex below so the injected
   REFLEX_CONFIG survives. Created lazily so start() stays synchronous — the
   smoke suite's server lifecycle is not worth restructuring for this. */
let vitePromise = null;
function vite() {
  if (!vitePromise) {
    vitePromise = import('vite').then(function (mod) {
      return mod.createServer({
        root: ROOT,
        appType: 'custom',
        server: { middlewareMode: true },
        logLevel: 'warn',
      });
    });
  }
  return vitePromise;
}

/* js/ is in the module graph now — main.ts imports it — so Vite has to
   transform it, not the static branch below. Serving it raw is how
   import.meta.env in js/core/config.js came back undefined. */
const VITE_OWNS = /^\/(src\/|js\/|@vite|@id\/|@fs\/|node_modules\/)/;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function start(opts) {
  const log = opts.quiet
    ? function () {}
    : function (m) {
        console.log('  ' + m);
      };
  /* In proxy mode there is no fake library at all — see the /__plex handler. */
  const api = opts.proxy
    ? null
    : mock.create({ films: opts.films, pinPolls: opts.pinPolls, log: log });
  /* TMDB is mocked alongside Plex, and off the same generated library, so the
     artwork path runs without a request leaving the machine. In --proxy mode
     there is no library to derive it from and the real TMDB is used instead. */
  const tmdb = api ? mockTmdb.create({ films: api.library.films }) : null;

  const server = http.createServer(function (req, res) {
    const parsed = url.parse(req.url, true);
    const pathname = decodeURIComponent(parsed.pathname);
    const origin = 'http://' + (req.headers.host || 'localhost:' + opts.port);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      });
      res.end();
      return;
    }

    if (opts.proxy && pathname.indexOf('/__plextv') === 0) {
      proxyToPlexTv(req, res, parsed);
      return;
    }

    /* Proxy mode must not answer as a media server, even for a moment. The
       browser remembers the last servers it linked to, and if the mock kept
       answering on this origin the app would happily go on using the fake
       library it cached earlier — looking connected while showing nothing real.
       Refusing here makes the stale entry fail its ping, which is what makes
       the app rediscover. */
    if (opts.proxy && pathname.indexOf('/__plex') === 0) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('proxy mode: no mock server here');
      return;
    }

    if (tmdb && pathname.indexOf('/__tmdb') === 0) {
      if (!tmdb.handle(req, res, pathname, parsed.query)) {
        console.log(
          '  UNHANDLED ' +
            req.method +
            ' ' +
            pathname +
            '  <- the app is calling a TMDB path the mock does not know',
        );
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('mock: no route for ' + pathname);
      }
      return;
    }

    /* The recaps channel, stood in for the same way TMDB is. In --proxy mode
       the real YouTube is the only one there is, so nothing is answered here. */
    if (!opts.proxy && pathname.indexOf('/__yt') === 0) {
      if (!mockYoutube.handle(req, res, pathname, parsed.query)) {
        console.log(
          '  UNHANDLED ' +
            req.method +
            ' ' +
            pathname +
            '  <- the app is calling a YouTube path the mock does not know',
        );
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('mock: no route for ' + pathname);
      }
      return;
    }

    if (pathname.indexOf('/__plex') === 0) {
      const run = function () {
        if (!api.handle(req, res, pathname, parsed.query, origin)) {
          console.log(
            '  UNHANDLED ' +
              req.method +
              ' ' +
              pathname +
              '  <- the app is calling something the mock does not know',
          );
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('mock: no route for ' + pathname);
        }
      };
      if (opts.latency) setTimeout(run, opts.latency);
      else run();
      return;
    }

    if (pathname === '/__dev/shim.js') {
      sendFile(res, path.join(__dirname, 'shim.js'));
      return;
    }

    /* The TV never asks for this; the browser always does. */
    if (pathname === '/favicon.ico') {
      sendFile(res, path.join(ROOT, 'icon.png'));
      return;
    }

    /* --built serves what `vite build` produced instead of the source, so the
       suite can be run against the artifact that actually ships. Everything a
       server answers is unchanged; only the app's own files move. */
    if (opts.built) {
      const rel = pathname === '/' ? '/index.html' : pathname;
      const file = path.join(BUILD, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
      if (file.indexOf(BUILD) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found in build/ — run `npm run build` first');
        return;
      }
      if (rel === '/index.html') sendIndex(res, file, opts);
      else sendFile(res, file);
      return;
    }

    if (VITE_OWNS.test(pathname)) {
      vite().then(function (dev) {
        dev.middlewares(req, res, function () {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('vite: no route for ' + pathname);
        });
      });
      return;
    }

    /* The app itself, straight off disk. */
    let rel = pathname === '/' ? '/index.html' : pathname;
    const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    if (rel === '/index.html') {
      sendIndex(res, file, opts);
      return;
    }
    sendFile(res, file);
  });

  server.listen(opts.port, function () {
    /* The port asked for may be 0, which means "whatever is free" — so report
       the one actually bound, or the banner sends you to localhost:0. */
    var port = server.address().port;
    opts.port = port; // so the origin fallback above reports it too
    console.log('');
    console.log('  Mantis dev server   http://localhost:' + port);
    if (opts.proxy) {
      console.log('  plex.tv proxied for real — sign in with your own account.');
      console.log('  No mock library is served. Your real servers are reached directly,');
      console.log('  so posters and playback come straight from them.');
      console.log('');
      console.log('  Browsing and the playback guard are fair to test here.');
      console.log('  PLAYBACK IS NOT: a browser decodes far less than the panel does.');
      console.log('  Firefox has no AC3/E-AC3 and no HEVC, Chrome has no Matroska —');
      console.log('  silence or a decode error here says nothing about the B8.');
    } else {
      console.log('  mock Plex: two servers sharing ' + opts.films + ' films, pin claims itself.');
      console.log('  This is FAKE data — generated titles, generated posters.');
      console.log('  For your own library: npm run dev -- --proxy');
    }
    if (opts.latency) console.log('  ' + opts.latency + 'ms added to every server response');
    /* Only the mock needs a stand-in video; real servers have the real files. */
    if (!opts.proxy && !fixture()) {
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
    if (err) {
      res.writeHead(500);
      res.end(String(err));
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

/* index.html is rewritten on the way out: config before the app's own scripts,
   the key shim after them. The file on disk stays exactly what ships. */
function sendIndex(res, file, opts) {
  fs.readFile(file, 'utf8', function (err, html) {
    if (err) {
      res.writeHead(500);
      res.end(String(err));
      return;
    }
    const config = {
      plexTvBase: '/__plextv',
      dev: true,
      tmdbKey: process.env.TMDB_KEY || '',
      youtubeKey: process.env.YOUTUBE_KEY || '',
    };
    /* Against the mock, TMDB and YouTube are mocked too and the keys are only
       switches — the real ones are for --proxy, where the real services are the
       only ones there are. */
    if (!opts.proxy) {
      config.tmdbKey = 'mock-tmdb-key';
      config.tmdbBase = '/__tmdb';
      config.tmdbImageBase = '/__tmdbimg/';
      config.youtubeKey = 'mock-youtube-key';
      config.youtubeBase = '/__yt';
      config.youtubeEmbedBase = '/__ytembed/';
    }
    const out = html
      .replace(
        '</head>',
        '<script>window.REFLEX_CONFIG = ' + JSON.stringify(config) + ';</script>\n</head>',
      )
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
  req.on('data', function (c) {
    chunks.push(c);
  });
  req.on('end', function () {
    const headers = Object.assign({}, req.headers);
    delete headers.host;
    delete headers.origin;
    delete headers.referer;
    delete headers['accept-encoding'];
    const target = parsed.path.slice('/__plextv'.length) || '/';
    const out = https.request(
      {
        host: 'plex.tv',
        port: 443,
        method: req.method,
        path: target,
        headers: headers,
      },
      function (up) {
        const h = Object.assign({}, up.headers);
        h['access-control-allow-origin'] = '*';
        res.writeHead(up.statusCode, h);
        up.pipe(res);
      },
    );
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
