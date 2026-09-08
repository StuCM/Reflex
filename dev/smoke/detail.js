'use strict';
/* the film page: what it says, and what Play would do */
module.exports = function (h) {
  const { hasFixture, trace, tracedThat, shot, press, waitFor, step, menuLabels,
    menuChoose, shown, backToLibrary, openTitle, actionRow, pressButton,
    openChooser, sourceRows, playable, page, titles } = h;

  return h.ready()

    .then(function () {
      /* A 4K remux whose only tracks are TrueHD and DTS-HD MA. Neither can cross
         plain ARC, so the film's own track is offered to the server for
         re-encoding — and re-encoding anything on a 4K file is the one thing
         the admin's kill-stream fires on, so it is refused. The decision call
         is how we learn that, and it opens no session (hasMDE=1), which is
         why asking is the design rather than a cost. */
      return step('refuses a 4K remux whose only audio would be re-encoded', function () {
        return openTitle(titles.truehdOnly.title)
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor(shown('4K transcode refused', titles.truehdOnly.title),
                           'the 4K refusal, naming ' + titles.truehdOnly.title);
          })
          .then(function () {
            if (!tracedThat(/decision: transcode/)) {
              throw new Error('the verdict was reached without asking the server');
            }
          })

          .then(function () { return shot('refuse-truehd'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('plays sub-4K content the server has to convert', function () {
        /* Below 4K a transcode is ordinary server work, and refusing it is what
           made every awkward file unplayable. */
        return openTitle(titles.transcodes.title)
          .then(function () {
            return waitFor('/transcode/.test(' +
                           'document.querySelector("#dt-actions .dt-act-cap").textContent)',
                           'a transcode verdict on Play\'s caption', 15000);
          })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            if (!tracedThat(/decision: transcode/)) {
              throw new Error('expected a transcode verdict in: ' + trace.slice(-3).join(' | '));
            }
          })
          .then(function () {
            if (!hasFixture()) return page.waitForTimeout(500);
            return waitFor('(function(){var v=document.getElementById("video");' +
                           'return !v.classList.contains("hidden") && !v.error;})()',
                           'the converted stream to start', 15000);
          })
          .then(function () {
            if (!tracedThat(/server converting/)) {
              throw new Error('played the original file rather than the converted stream');
            }
          })
          .then(function () { return shot('transcode-play'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('a film on both servers is one entry with two copies', function () {
        return openTitle(titles.shared.title)
          .then(function () {
            /* One search result, not two — that is the whole point. The count
               is in the results header the search left in the hero. */
            return page.evaluate(function () {
              const m = document.getElementById('mh-row').textContent.match(/(\d+) films?/);
              return m ? Number(m[1]) : -1;
            });
          })
          .then(function (n) {
            if (n !== 1) throw new Error('the same film appeared ' + n + ' times');
          })
          .then(function () { return openChooser('source'); })
          .then(function () {
            return waitFor('(function(){var r=document.querySelectorAll(' +
                           '"#dt-menu:not(.hidden) .menu-row");' +
                           'if (r.length !== 2) return false;' +
                           'return !/checking/.test(r[0].textContent) &&' +
                           ' !/checking/.test(r[1].textContent);})()',
                           'both copies checked', 15000);
          })
          .then(sourceRows)
          .then(function (src) {
            /* The two copies must not read the same, and exactly one of them
               must be playable — that is the case this whole feature exists
               for: a 4K TrueHD remux on one server, a passable copy on the
               other. */
            const plays = src.filter(function (s) { return /direct play/.test(s.verdict); });
            const refused = src.filter(function (s) { return /4K, would transcode/.test(s.verdict); });
            if (plays.length !== 1 || refused.length !== 1) {
              throw new Error('expected one playable and one refused copy, got:\n        ' +
                              src.map(function (s) { return s.server + ' ' + s.version + ' — ' +
                                                            s.verdict; }).join('\n        '));
            }
            if (!src[0].preferred) throw new Error('the preferred server should be listed first');
            if (!src[0].on) throw new Error('the preferred copy should be selected');
          })
          .then(function () { return shot('detail-shared'); });
      });
    })

    .then(function () {
      return step('a copy the guard refuses toasts and leaves the last one chosen', function () {
        /* The chooser is still up from the step before. Pick the copy that
           cannot play: the page must say why in a line and go on offering the
           one that can, rather than accepting a choice it will refuse at Play. */
        let was;
        return sourceRows()
          .then(function (src) {
            was = src.filter(function (s) { return s.on; })[0];
            const bad = src.filter(function (s) { return !playable(s.verdict); })[0];
            if (!bad) throw new Error('no refused copy to choose');
            /* By the whole label: two copies of the same film routinely differ
               only in bitrate, so half of one matches the other as well. */
            const label = bad.version + ' \u00b7 ' + bad.server;
            return menuChoose(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
          })
          .then(function () {
            return waitFor('(function(){var t=document.getElementById("toast");' +
                           'return !t.classList.contains("hidden") &&' +
                           ' /Kept as it was/.test(t.textContent);})()',
                           'the refusal toast', 15000);
          })
          .then(function () { return openChooser('source'); })
          .then(sourceRows)
          .then(function (src) {
            const on = src.filter(function (s) { return s.on; })[0];
            if (!on || on.version !== was.version || on.server !== was.server) {
              throw new Error('the refused copy was selected anyway: ' +
                              (on ? on.server + ' ' + on.version : 'nothing'));
            }
          })
          .then(function () { return press('Backspace'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('extras are cards with a length, and are guarded like anything else',
        function () {
        return openTitle(titles.directPlays.title)
          .then(function () {
            return waitFor('(function(){var e=document.querySelectorAll("#dt-extras .dt-extra");' +
                           'if (!e.length) return false;' +
                           'return !/checking/.test(e[0].textContent);})()',
                           'an extra with a verdict', 15000);
          })
          .then(function () {
            return page.evaluate(function () {
              return Array.prototype.map.call(
                document.querySelectorAll('#dt-extras .dt-extra'),
                function (e) {
                  const len = e.querySelector('.dt-extra-len');
                  return { text: e.textContent.replace(/\s+/g, ' '),
                           len: len ? len.textContent.trim() : '' };
                });
            });
          })
          .then(function (cards) {
            const all = cards.map(function (c) { return c.text; }).join(' | ');
            if (!/Trailer/i.test(all)) throw new Error('no trailer listed: ' + all);
            /* A clip is an ordinary part on the same server, so it goes through
               the same guard — it must carry a verdict, not be assumed safe. */
            if (!/direct play|transcode|no passable/.test(cards[0].text)) {
              throw new Error('extra has no verdict: ' + cards[0].text);
            }
            if (!/^\d+ min$/.test(cards[0].len)) {
              throw new Error('no length on the card: "' + cards[0].len + '"');
            }
          })
          /* Down off the action row is the extras strip. */
          .then(function () { return press('ArrowDown'); })
          .then(function () {
            return waitFor('!!document.querySelector("#dt-extras .dt-extra.on")',
                           'focus to reach the extras');
          })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            if (!hasFixture()) return page.waitForTimeout(500);
            return waitFor('(function(){var v=document.getElementById("video");' +
                           'return !v.classList.contains("hidden") && v.currentTime >= 0;})()',
                           'the extra to start', 15000);
          })
          .then(function () { return shot('extras'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      return step('the film page opens on Play, with a button per choice', function () {
        return openTitle(titles.directPlays.title)
          .then(actionRow)
          .then(function (row) {
            /* Play, Trailer, Quality, Source, Audio, Subtitles — and Play has
               the focus, so OK is still one press. */
            if (row.length !== 6) {
              throw new Error('the action row is: ' +
                              row.map(function (a) { return a.button || a.caption; }).join(' | '));
            }
            if (!row[0].primary || !row[0].on || row[0].button !== 'Play') {
              throw new Error('Play is not the focused primary: ' + JSON.stringify(row[0]));
            }
            /* Every caption names what is chosen now, and none of them is
               still saying "checking". */
            const blank = row.filter(function (a) {
              return !a.caption || /checking/.test(a.caption);
            });
            if (blank.length) {
              throw new Error('a button with nothing chosen: ' +
                              row.map(function (a) { return a.caption; }).join(' | '));
            }
            /* Play says what it will do and what the server will make of it. */
            if (!/from start|resume at/.test(row[0].caption) ||
                !/direct play/.test(row[0].caption)) {
              throw new Error('Play\'s caption is: ' + row[0].caption);
            }
          })
          .then(function () { return shot('detail-actions'); });
      });
    })

    .then(function () {
      return step('an audio track says what it costs, and the caption follows it', function () {
        return openChooser('audio')
          .then(menuLabels)
          .then(function (labels) {
            /* The h264-eac3 profile: E-AC3 5.1, AC3 5.1 and a French AAC
               stereo, all three named by language. */
            if (labels.length !== 3) throw new Error('audio rows: ' + labels.join(' | '));
            /* What a row says has to be what OK does. Desktop Chrome exposes no
               audioTracks, so every track but the one already chosen costs
               direct play — and the one already chosen must not be warned
               about, because choosing it costs nothing at all. */
            const on = labels.filter(function (l) { return /^\* /.test(l); });
            if (on.length !== 1) throw new Error('audio rows: ' + labels.join(' | '));
            if (/\[/.test(on[0])) {
              throw new Error('the track already chosen is warned about: ' + on[0]);
            }
            const others = labels.filter(function (l) { return !/^\* /.test(l); });
            const quiet = others.filter(function (l) { return !/costs direct play/.test(l); });
            if (quiet.length) {
              throw new Error('a row that does not say it costs direct play: ' +
                              labels.join(' | '));
            }
          })
          .then(function () { return menuChoose(/French/); })
          .then(function () {
            return waitFor('/AAC/.test(document.querySelectorAll(' +
                           '"#dt-actions .dt-act-cap")[4].textContent)',
                           'the audio button to name the chosen track', 15000);
          })
          .then(actionRow)
          .then(function (row) {
            /* Choosing a track the panel cannot select gives up direct play, so
               Play must now say so rather than still promising one. */
            if (/direct play/.test(row[0].caption)) {
              throw new Error('the audio choice cost nothing: ' + row[0].caption);
            }
          })
          .then(function () { return shot('detail-audio'); })
          .then(backToLibrary);
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('a subtitle language chosen on the film page is what plays', function () {
        return openTitle(titles.directPlays.title)
          .then(function () { return openChooser('subtitles'); })
          .then(menuLabels)
          .then(function (labels) {
            if (!/Off/.test(labels[0])) throw new Error('subtitle rows: ' + labels.join(' | '));
          })
          .then(function () { return menuChoose(/French/); })
          .then(function () {
            return waitFor('/French/.test(document.querySelectorAll(' +
                           '"#dt-actions .dt-act-cap")[5].textContent)',
                           'the subtitles button to name French', 15000);
          })
          /* And Play starts on it: the language crosses into the player, which
             fetches that track and draws it over the video. */
          .then(function () { return pressButton('play'); })
          .then(function () {
            return waitFor('/fran\u00e7ais/.test(document.getElementById("subtitle").textContent)',
                           'the chosen subtitle track drawn over the video', 15000);
          })
          .then(function () { return shot('detail-subtitles'); })
          .then(backToLibrary);
      });
    });
};
