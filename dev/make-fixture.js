/* Makes a video for the harness to play.
   Runs on Node only — modern syntax is fine here.

     npm run fixture              30 seconds at dev/fixtures/sample.webm
     npm run fixture -- 90        longer, if you want to test seeking properly

   The mock server serves this file for every item, so pressing OK on anything
   plays it. Recording is real-time, so 30 seconds takes 30 seconds.

   It is a VP8 webm, which is a laptop format — the TV never sees it. If you
   would rather use a real file, drop any browser-playable video at
   dev/fixtures/sample.mp4 instead and this script is unnecessary.

   Needs Playwright, same as npm run smoke. The frame counter is burnt into the
   picture so you can see at a glance whether playback is actually advancing or
   just sitting on a first frame. */
'use strict';

const fs = require('fs');
const path = require('path');

const SECONDS = Number(process.argv[2] || 30);
const OUT = path.join(__dirname, 'fixtures', 'sample.webm');

/* npm run verify calls this every time, so an existing fixture is left alone —
   the smoke test only needs something playable, not a fresh recording. */
const existing = ['sample.mp4', 'sample.webm', 'sample.mkv']
  .map(function (n) { return path.join(__dirname, 'fixtures', n); })
  .filter(fs.existsSync)[0];
if (existing) {
  console.log('  fixture already present: ' + path.relative(process.cwd(), existing) +
              '  (delete it to re-record)');
  process.exit(0);
}

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  try {
    chromium = require(path.join(
      require('child_process').execSync('npm root -g').toString().trim(),
      'playwright')).chromium;
  } catch (e2) {
    /* Exit 0, as dev/smoke.js does for the same reason: without Playwright the
       smoke test skips rather than fails, and npm run verify must not go red
       over a tool that is only needed to test playback. */
    console.log('\n  SKIPPED: Playwright is needed to generate a fixture:');
    console.log('  npm i -g playwright && npx playwright install chromium');
    console.log('\n  Or drop any playable video at dev/fixtures/sample.mp4 instead.\n');
    process.exit(0);
  }
}

(function () {
  console.log('  recording ' + SECONDS + 's…');
  let browser;
  chromium.launch().then(function (b) {
    browser = b;
    return b.newPage();
  }).then(function (page) {
    return page.evaluate(function (seconds) {
      return new Promise(function (resolve, reject) {
        var c = document.createElement('canvas');
        c.width = 960; c.height = 540;
        var g = c.getContext('2d');
        var frame = 0;

        function draw() {
          var t = frame / 25;
          g.fillStyle = '#101018';
          g.fillRect(0, 0, 960, 540);
          /* Something moving, so a stuck frame is obvious. */
          g.fillStyle = 'hsl(' + ((frame * 2) % 360) + ',60%,45%)';
          g.fillRect((frame * 6) % 960, 200, 160, 140);
          g.fillStyle = '#f0f0f4';
          g.font = '64px Helvetica, Arial';
          g.fillText('Reflex test pattern', 40, 90);
          g.font = '120px Helvetica, Arial';
          g.fillText(t.toFixed(1) + 's', 40, 470);
          frame++;
        }

        draw();
        var stream = c.captureStream(25);
        var chunks = [];
        var rec;
        try {
          rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        } catch (e) { reject(new Error('MediaRecorder unavailable: ' + e.message)); return; }

        rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          var blob = new Blob(chunks, { type: 'video/webm' });
          var fr = new FileReader();
          fr.onload = function () { resolve(fr.result); };
          fr.onerror = function () { reject(new Error('could not read the recording')); };
          fr.readAsDataURL(blob);
        };
        rec.start();
        var timer = setInterval(draw, 40);
        setTimeout(function () { clearInterval(timer); rec.stop(); }, seconds * 1000);
      });
    }, SECONDS);
  }).then(function (dataUrl) {
    const base64 = String(dataUrl).split(',')[1];
    const dir = path.dirname(OUT);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OUT, Buffer.from(base64, 'base64'));
    console.log('  wrote ' + path.relative(process.cwd(), OUT) + '  ' +
                Math.round(fs.statSync(OUT).size / 1024) + 'KB');
    return browser.close();
  }).catch(function (e) {
    console.error('  failed: ' + e.message);
    if (browser) browser.close();
    process.exit(1);
  });
})();
