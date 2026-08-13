/* Prints the TV's debug line on the laptop.
   Runs on Node only — modern syntax is fine here.

     node dev/beacon.js                 listens on 0.0.0.0:8099

   WAM does not forward console.log anywhere readable on a B8, and
   ares-inspect needs a browser old enough to attach. When neither is working,
   set beacon in js/config.js to http://<your laptop>:8099/ and every line the
   app writes to its debug readout turns up here as well.

   Only useful on the TV: under the dev server the browser console has it all
   already. Empty the setting again before packaging anything you care about —
   it costs a request per debug line. */
'use strict';

const http = require('http');
const url = require('url');

const port = Number(process.argv[2] || 8099);

function stamp() {
  const d = new Date();
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

http.createServer(function (req, res) {
  const q = url.parse(req.url, true).query;
  if (q.m !== undefined) console.log(stamp() + '  ' + q.m);
  res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
  res.end();
}).listen(port, '0.0.0.0', function () {
  console.log('\n  beacon listening on port ' + port);
  console.log('  set beacon in js/config.js to http://<this machine>:' + port + '/\n');
});
