'use strict';
/* playback, the OSD, and what follows an episode */
module.exports = function (h) {
  const { hasFixture, trace, tracedThat, timelines, shot, press, waitFor, step,
    menuLabels, menuChoose, controlRow, openSidebar,
    sidebarRows, sidebarPick, backToLibrary, openTitle, openShowPage, playEpisode,
    playToEnd, upNext, waitForOffer, page, titles } = h;

  /* The control row is entered with ▼ and a panel opens on OK, so the row is
     walked here rather than through the shell's helpers, which press ▲ — ▲ is
     the trackbar now and opens nothing. */
  function focusControl(id) {
    return controlRow()
      /* A panel that is up owns the d-pad, so it has to go first. */
      .then(function (row) { return row.open ? press('Backspace').then(controlRow) : row; })
      .then(function (row) { return row.foc >= 0 ? row : press('ArrowDown').then(controlRow); })
      .then(function (row) {
        const want = row.ids.indexOf('osd-ctl-' + id);
        if (want < 0) throw new Error('no control called ' + id + ': ' + row.ids.join(', '));
        const by = want - row.foc;
        return press(by > 0 ? 'ArrowRight' : 'ArrowLeft', Math.abs(by));
      });
  }

  function openMenu(id) {
    return focusControl(id)
      .then(function () { return press('Enter'); })
      .then(function () {
        return waitFor('!document.getElementById("menu").classList.contains("hidden")',
                       'the ' + id + ' panel');
      });
  }

  function openChapters() {
    return focusControl('chapters')
      .then(function () { return press('Enter'); })
      .then(function () {
        return waitFor('!document.getElementById("osd-chapters").classList.contains("hidden")',
                       'the chapter rail');
      });
  }

  function barFocused() {
    return page.evaluate(function () {
      return document.getElementById('osd-bar').classList.contains('foc');
    });
  }

  /* The OSD clock reads where a seek is AIMED, so an assertion on it does not
     race the 400ms settle. The fixture is thirty seconds and the film is two
     hours, so every jump below clamps to what the harness can serve — what is
     checked is that the key still reaches the seek, which is exactly what a new
     focus mode breaks. */
  const CLOCK = '(function(){var p=document.getElementById("osd-time").textContent' +
                '.trim().split(/\\s+/)[0].split(":").map(Number);' +
                'return p.length===3?p[0]*3600+p[1]*60+p[2]:p[0]*60+p[1];})()';
  function clock(test, what) { return waitFor(CLOCK + test, what); }

  return h.ready()

    .then(function () {
      return step('plays a file that direct plays', function () {
        return openTitle(titles.directPlays.title)
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () { return page.waitForTimeout(600); })
          .then(function () {
            if (!tracedThat(/decision: directplay/)) {
              throw new Error('no directplay verdict in: ' + trace.slice(-3).join(' | '));
            }
          })
          .then(function () {
            /* With a fixture, the video element has to actually get going —
               "the guard let it through" is not the same as "it played". Without
               one, the error path is the correct outcome and all we can check is
               that the guard did not refuse it. */
            if (!hasFixture()) return page.waitForTimeout(400);
            return waitFor('(function(){var v=document.getElementById("video");' +
                           'return !v.classList.contains("hidden") && !v.paused &&' +
                           ' v.currentTime > 0.2 && !v.error;})()',
                           'the video to start advancing', 15000);
          })
          .then(function () { return shot('play'); });
      });
    })

    /* Everything the player can do while a film runs. All of it needs something
       actually playing, so it is skipped without a fixture — npm run fixture. */

    /* Three modes, and which one you are in has to be visible without looking
       anything up: ▲ is the trackbar, ▼ is the row, and a panel opens on OK on
       its own button and on nothing else. */

    .then(function () {
      if (!hasFixture()) return;
      return step('up takes the trackbar, down the row, and only OK opens a panel', function () {
        return press('ArrowUp')
          .then(barFocused)
          .then(function (on) { if (!on) throw new Error('up did not focus the trackbar'); })
          .then(controlRow)
          .then(function (row) {
            if (row.foc >= 0) throw new Error('up went to the control row, button ' + row.foc);
          })
          /* Left scrubs here rather than walking a button — the difference
             between the two modes, in one press. */
          .then(function () { return press('ArrowLeft'); })
          .then(function () {
            return waitFor('/SEEKING/.test(document.getElementById("osd-time").textContent)',
                           'the trackbar to scrub');
          })
          .then(function () { return press('ArrowDown'); })
          .then(controlRow)
          .then(function (row) {
            if (row.foc < 0) throw new Error('down did not reach the control row');
            if (row.open) throw new Error('a panel opened without OK: ' + row.open);
          })
          /* Back up to the bar, which is the user's actual complaint: up used to
             open whatever the row was sitting on. */
          .then(function () { return press('ArrowUp'); })
          .then(function () {
            return page.evaluate(function () {
              return document.getElementById('menu').classList.contains('hidden') &&
                     document.getElementById('osd-chapters').classList.contains('hidden');
            });
          })
          .then(function (shut) { if (!shut) throw new Error('up opened a panel'); })
          .then(barFocused)
          .then(function (on) {
            if (!on) throw new Error('up from the row did not return to the trackbar');
          })
          /* And OK on a button is what opens it. */
          .then(function () { return openMenu('subs'); })
          .then(controlRow)
          .then(function (row) {
            if (row.open !== 'osd-ctl-subs') throw new Error('OK opened: ' + row.open);
          })
          .then(function () { return press('Backspace'); })        // close the panel
          .then(function () { return press('ArrowDown'); })        // and leave the row
          .then(controlRow)
          .then(function (row) {
            if (row.foc >= 0) throw new Error('down did not leave the control row');
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('every documented key still means what it says unfocused', function () {
        /* Paused throughout: these jumps land near the end of a thirty-second
           fixture, and a film that ends here takes the rest of the suite with
           it. Pausing is itself one of the keys under test. */
        return press('Enter')
          .then(function () {
            return waitFor('/PAUSED/.test(document.getElementById("osd-time").textContent)',
                           'OK to pause');
          })
          .then(function () { return press('0'); })
          .then(function () { return clock(' === 0', 'the clock back at the start'); })
          .then(function () { return press('5'); })
          .then(function () { return clock(' > 10 && ' + CLOCK + ' < 20', 'a digit to jump'); })
          .then(function () { return press('ArrowLeft'); })
          .then(function () { return clock(' === 0', 'left to nudge back'); })
          .then(function () { return press('ArrowRight'); })
          .then(function () { return clock(' > 20', 'right to nudge on'); })
          .then(function () { return press('PageDown'); })
          .then(function () { return clock(' === 0', 'CH− to step back a chapter'); })
          .then(function () { return press('PageUp'); })
          .then(function () { return clock(' > 20', 'CH+ to step on a chapter'); })
          /* None of that may have moved the focus: the arrows only belong to the
             bar and the row once one of them has been asked for. */
          .then(barFocused)
          .then(function (on) { if (on) throw new Error('seeking focused the trackbar'); })
          .then(controlRow)
          .then(function (row) {
            if (row.foc >= 0) throw new Error('seeking focused the control row');
          })
          /* Back to the start, and playing again, so what follows has runway. */
          .then(function () { return press('0'); })
          .then(function () { return press('Enter'); })
          .then(function () {
            return waitFor('!document.getElementById("video").paused',
                           'OK to start it again');
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('the buttons are the design’s size and the panel is opaque', function () {
        return page.evaluate(function () {
          function widths(sel) {
            return Array.prototype.map.call(document.querySelectorAll(sel),
              function (b) { return b.offsetWidth; });
          }
          return { left: widths('#osd-left .osd-btn'), right: widths('#osd-right .osd-btn') };
        })
          .then(function (w) {
            /* 7a: one size for the transport, so Play and the two jumps read as
               one control, and a size down for the four choices. */
            if (w.left.join() !== '80,80,80') {
              throw new Error('the transport buttons are ' + w.left.join(', ') +
                              ', not three of 80');
            }
            if (w.right.join() !== '76,76,76,76') {
              throw new Error('the choice buttons are ' + w.right.join(', ') +
                              ', not four of 76');
            }
          })
          .then(function () { return openMenu('quality'); })
          .then(function () {
            return page.evaluate(function () {
              const s = getComputedStyle(document.getElementById('menu'));
              return [s.backgroundColor, s.borderTopLeftRadius];
            });
          })
          .then(function (style) {
            const parts = /rgba?\(([^)]+)\)/.exec(style[0])[1].split(',');
            const alpha = parts.length > 3 ? Number(parts[3]) : 1;
            if (alpha !== 1) throw new Error('the panel is translucent: ' + style[0]);
            if (style[1] !== '26px') throw new Error('the panel corner is ' + style[1]);
          })
          .then(function () { return press('Backspace'); })        // close the panel
          .then(function () { return press('ArrowDown'); });       // and leave the row
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('four captioned buttons, each opening its own panel', function () {
        return press('ArrowDown')                                  // into the row
          .then(controlRow)
          .then(function (row) {
            const named = row.ids.filter(Boolean).join(',');
            if (named !== 'osd-ctl-audio,osd-ctl-subs,osd-ctl-quality,osd-ctl-chapters') {
              throw new Error('the control row is: ' + row.ids.join(', '));
            }
            /* A caption names what is chosen now, so none of the four may be
               blank — that is the whole reason the tabs went. */
            const blank = row.caps.slice(row.caps.length - 4)
              .filter(function (c) { return c === ''; });
            if (blank.length) throw new Error('captions: ' + row.caps.join(' | '));
          })
          .then(function () { return openMenu('audio'); })
          .then(controlRow)
          .then(function (row) {
            /* The violet ring means "this is the panel that is open". */
            if (row.open !== 'osd-ctl-audio') {
              throw new Error('the open button is not ringed: ' + row.open);
            }
          })
          .then(menuLabels)
          .then(function (labels) {
            /* This film is the h264-eac3 profile: E-AC3 5.1, AC3 5.1 and a
               French AAC stereo. All three have to be offered, named by
               language rather than by stream id. */
            if (labels.length !== 3 || !/English/.test(labels[0]) ||
                !/French/.test(labels[2])) {
              throw new Error('audio rows: ' + labels.join(' | '));
            }
          })
          .then(function () { return openMenu('subs'); })
          .then(menuLabels)
          .then(function (labels) {
            if (!/Off/.test(labels[0])) throw new Error('subtitle rows: ' + labels.join(' | '));
            /* An image track is listed and refused by name — the only way to
               show it is to have the server burn it in, which is a transcode. */
            const image = labels.filter(function (l) { return /image/.test(l); });
            if (!image.length) throw new Error('the PGS track is not named as an image track');
          })
          .then(function () { return openMenu('quality'); })
          .then(menuLabels)
          .then(function (labels) {
            if (!/Original/.test(labels[0])) throw new Error('quality rows: ' + labels.join(' | '));
            if (labels.length < 2) throw new Error('no bitrate caps offered');
            /* There is no adaptive ladder behind any of these: Original is the
               file as it stands and a cap is a fixed ceiling. A row claiming to
               follow the connection would be a lie the user cannot check. */
            if (/auto|follows the connection/i.test(labels.join(' '))) {
              throw new Error('a quality row claims to follow the connection: ' +
                              labels.join(' | '));
            }
            /* And each one says what it costs before OK is pressed. */
            if (!/\[direct play\]/.test(labels[0]) ||
                !/\[transcode · /.test(labels[1])) {
              throw new Error('quality rows do not say what they cost: ' + labels.join(' | '));
            }
          })
          .then(function () { return shot('player-menu'); })
          .then(function () { return press('Backspace'); })           // close the panel
          .then(function () {
            return waitFor('document.getElementById("menu").classList.contains("hidden")',
                           'the panel to close');
          });
      });
    })

    /* Chapters is a rail of cards rather than a list: where a chapter has a
       still it is on the card, and where it has not the card is the same size
       with nothing broken in it. */

    .then(function () {
      if (!hasFixture()) return;
      return step('chapters open as a rail, and OK on a card seeks there', function () {
        var was;
        return openChapters()
          .then(function () {
            return page.evaluate(function () {
              return Array.prototype.map.call(
                document.querySelectorAll('#osd-chapters .osd-chap'),
                function (c) {
                  const still = c.querySelector('.osd-chap-shot');
                  return { h: still.offsetHeight, w: still.offsetWidth,
                           art: still.style.backgroundImage !== '',
                           imgs: c.querySelectorAll('img').length,
                           time: c.querySelector('.osd-chap-time').textContent.trim(),
                           title: c.querySelector('.osd-chap-title').textContent.trim(),
                           on: c.classList.contains('on') };
                });
            });
          })
          .then(function (cards) {
            if (cards.length < 8) throw new Error('only ' + cards.length + ' chapter cards');
            const sizes = cards.filter(function (c) { return c.h !== cards[0].h || c.w !== cards[0].w; });
            if (sizes.length) throw new Error('the cards are not all one size');
            /* No <img> anywhere: a card with no thumbnail must not leave a
               broken one behind, and a background is how that is guaranteed. */
            if (cards.filter(function (c) { return c.imgs; }).length) {
              throw new Error('a chapter card uses an img, which breaks without a thumb');
            }
            if (!cards.filter(function (c) { return c.art; }).length) {
              throw new Error('no chapter card drew the thumbnail the mock supplies');
            }
            if (!cards.filter(function (c) { return !c.art; }).length) {
              throw new Error('no chapter without a thumbnail to check');
            }
            if (!cards[0].time || !cards[0].title) throw new Error('a card is missing its text');
            if (cards.filter(function (c) { return c.on; }).length !== 1) {
              throw new Error('the chapter holding the playhead is not the ringed one');
            }
            return shot('player-chapters');
          })
          .then(function () {
            return page.evaluate(function () { return document.getElementById('video').currentTime; });
          })
          /* Two along, then OK: the seek is aimed at that chapter's start. */
          .then(function (t) { was = t; return press('ArrowRight', 2); })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('/SEEKING/.test(document.getElementById("osd-time").textContent)',
                           'the OSD to show the chapter jump aiming');
          })
          .then(function () {
            return waitFor('document.getElementById("osd-chapters").classList.contains("hidden")',
                           'the rail to close once a chapter is taken');
          })
          .then(function () {
            if (!(was >= 0)) throw new Error('playback had no position to seek from');
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('subtitles are fetched as text and drawn over the video', function () {
        return openMenu('subs')
          .then(function () { return menuChoose(/French/); })
          .then(function () {
            return waitFor('/français/.test(document.getElementById("subtitle").textContent)',
                           'the French subtitle track to be drawn over the video', 15000);
          })
          /* And clear of the controls: a line of dialogue behind a button is
             the one thing this screen must not do. */
          .then(function () {
            return page.evaluate(function () {
              const sub = document.getElementById('subtitle').getBoundingClientRect();
              const osd = document.getElementById('osd').getBoundingClientRect();
              return [sub.bottom, osd.top,
                      document.getElementById('subtitle').classList.contains('lifted')];
            });
          })
          .then(function (at) {
            if (!at[2]) throw new Error('the subtitle was not lifted while the OSD was up');
            if (at[0] > at[1]) {
              throw new Error('the subtitle runs into the controls: bottom ' + at[0] +
                              ' against an OSD starting at ' + at[1]);
            }
          })
          .then(function () { return shot('subtitles'); });
      });
    })

    /* Audio track selection, which is the one thing in the player that cannot
       be done by asking nicely.

       On a direct play the server hands over the original file with every
       track still in it, and the panel plays whichever it likes. Passing
       audioStreamID to the decision call changes nothing about those bytes, so
       a "switch" that stays a direct play is silent and total nonsense — the
       OSD renames the track and you go on hearing the first one.

       There are two ways out and the panel decides which. Both are tested. */

    .then(function () {
      if (!hasFixture()) return;
      return step('a track the panel owns is switched without asking the server', function () {
        /* Desktop Chrome exposes no audioTracks, so stand one in: this is the
           seam the TV may or may not have, and the logic behind it — mapping a
           Plex stream to a pipeline track and selecting it — has to be right
           either way. */
        return page.evaluate(function () {
          var v = document.getElementById('video');
          var list = [];
          /* Three, to match the three audio streams on this file, in order. */
          for (var i = 0; i < 3; i++) list.push({ id: 'p' + i, enabled: i === 0 });
          list.length = 3;
          Object.defineProperty(v, 'audioTracks', { configurable: true, value: list });
        })
          .then(function () {
            const before = trace.length;
            return openMenu('audio')
              .then(menuLabels)
              .then(function (labels) {
                /* No row may warn about a restart now — the panel owns them. */
                if (/restarts/.test(labels.join(' '))) {
                  throw new Error('offered a restart for a track the panel can select: ' +
                                  labels.join(' | '));
                }
              })
              .then(function () { return menuChoose(/French · AAC/); })
              .then(function () {
                return waitFor('/French/.test(document.querySelector(' +
                               '"#osd-ctl-audio .osd-cap").textContent)',
                               'the audio button to name the new track', 10000);
              })
              .then(function () {
                return page.evaluate(function () {
                  var l = document.getElementById('video').audioTracks;
                  return [l[0].enabled, l[1].enabled, l[2].enabled];
                });
              })
              .then(function (enabled) {
                if (!enabled[2] || enabled[0] || enabled[1]) {
                  throw new Error('the panel track was not selected: ' + JSON.stringify(enabled));
                }
                const after = trace.slice(before);
                if (after.filter(function (l) { return /decision:/.test(l); }).length) {
                  throw new Error('asked the server for a track the panel could select itself');
                }
                if (after.filter(function (l) { return /playing /.test(l); }).length) {
                  throw new Error('restarted playback for a switch that costs nothing');
                }
              })
              /* And playback never stopped, which is the whole point of it. */
              .then(function () {
                return waitFor('(function(){var v=document.getElementById("video");' +
                               'return !v.paused && !v.error;})()',
                               'playback to carry straight on');
              });
          })
          .then(function () {
            return page.evaluate(function () {
              delete document.getElementById('video').audioTracks;
            });
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('a track the panel cannot select stops asking for the file', function () {
        /* The fallback, and the actual bug: with no audioTracks to select from,
           a switch must stop being a direct play. Re-fetching the same file
           with a different audioStreamID changes nothing you can hear.

           This is deliberately the last thing that runs, because it ends
           playback in the harness and cannot not: the app correctly reaches for
           start.m3u8, and Chrome refuses every .m3u8 there has ever been. What
           is asserted is everything up to the bytes — the verdict changed, and
           the converted URL is what was played. */
        const before = trace.length;
        return openMenu('audio')
          .then(menuLabels)
          .then(function (labels) {
            /* With no panel list, the menu has to warn that this one restarts. */
            if (!/restarts/.test(labels.join(' '))) {
              throw new Error('no restart warning without a panel track list: ' +
                              labels.join(' | '));
            }
          })
          /* Not the AAC one — the step before this switched to it on the panel,
             and choosing what is already playing is correctly a no-op. */
          .then(function () { return menuChoose(/· AC3 5\.1/); })
          /* The decision, the restart and the media error all land inside a
             second; there is no end state to wait for, because the end state
             here is a failure the harness cannot avoid. */
          .then(function () { return page.waitForTimeout(1500); })
          .then(function () {
            const after = trace.slice(before);
            /* The switch's OWN verdict — the first one after the press. Later
               lines are the film page re-checking every copy once the harness
               fails to play the stream, and those are direct plays for
               unrelated parts. */
            const verdict = after.find(function (l) { return l.indexOf('decision:') >= 0; });
            if (!verdict) throw new Error('no second decision call for the new track');
            /* directplay here would mean the same file, every track still in
               it, and the panel going on choosing — which is exactly the bug,
               and this is what it looked like in the trace. */
            if (!/decision: directstream/.test(verdict)) {
              throw new Error('the chosen track did not stop the direct play: ' + verdict);
            }
            /* And what it played has to be the converted stream, not the file. */
            if (!after.filter(function (l) { return /server converting/.test(l); }).length) {
              throw new Error('played the original file again rather than the muxed stream: ' +
                              after.slice(-3).join(' | '));
            }
          })
          /* Put the film back on so the steps after this one have something to
             work with: out of the failure message, back to the page, play. */
          .then(function () { return press('Backspace'); })
          .then(function () {
            return waitFor('!document.getElementById("detail").classList.contains("hidden")',
                           'the film page after the harness could not play the stream');
          })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('(function(){var v=document.getElementById("video");' +
                           'return !v.classList.contains("hidden") && !v.paused &&' +
                           ' v.currentTime > 0 && !v.error;})()',
                           'playback to start again', 15000);
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('skip intro appears inside the marker and takes you past it', function () {
        /* Back to the start first — by now the film is well past the intro, and
           the offer is only made while you are inside one. */
        return press('ArrowLeft')
          .then(function () {
            return waitFor('!document.getElementById("osd-skip").classList.contains("hidden")',
                           'the skip-intro offer', 20000);
          })
          .then(function () { return page.textContent('#osd-skip'); })
          .then(function (text) {
            if (!/Skip intro/.test(text)) throw new Error('the offer says: ' + text);
          })
          .then(function () { return shot('skip-intro'); })
          /* OK means "take it" while the offer is up — the one moment that
             button is not pause, and the moment you are reaching for it. */
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('document.getElementById("video").currentTime >= 11.5',
                           'playback to land past the end of the intro', 10000);
          })
          .then(function () {
            return waitFor('document.getElementById("osd-skip").classList.contains("hidden")',
                           'the offer to go away once taken');
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('the trackbar shows chapters, and a digit jumps', function () {
        return page.evaluate(function () {
          return [document.querySelectorAll('#osd-ticks .osd-tick').length,
                  document.querySelectorAll('#osd-ticks .osd-band').length];
        }).then(function (n) {
          if (n[0] < 7) throw new Error('only ' + n[0] + ' chapter ticks on the bar');
          if (n[1] < 2) throw new Error('the intro and credits are not marked on the bar');
        })
        /* The elapsed and the total sit either side of the bar, not under it. */
        .then(function () {
          return page.evaluate(function () {
            function box(id) { return document.getElementById(id).getBoundingClientRect(); }
            return [box('osd-time').right, box('osd-bar').left, box('osd-bar').right,
                    box('osd-total').left,
                    document.getElementById('osd-total').textContent.trim()];
          });
        })
        .then(function (at) {
          if (!(at[0] <= at[1] && at[2] <= at[3])) {
            throw new Error('the times are not either side of the bar: ' + at.join(', '));
          }
          if (!/^\d+:\d\d/.test(at[4])) throw new Error('no total run time: ' + at[4]);
        })
        /* 0 is the safe digit to prove the jump with: the fixture is thirty
           seconds and the film says two hours, so anything else aims past the
           end of what the harness can serve. */
        .then(function () { return page.keyboard.press('0'); })
        .then(function () {
          return waitFor('/SEEKING/.test(document.getElementById("osd-time").textContent)',
                         'the OSD to show where the jump is aiming');
        })
        .then(function () { return shot('trackbar'); });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('the OSD follows playback, and Back stops it', function () {
        var at;
        return waitFor('document.getElementById("osd-time").textContent.trim().indexOf("0:00") !== 0',
                       'the OSD clock to move off zero', 15000)
          .then(function () { return page.evaluate(function () { return document.getElementById('video').currentTime; }); })
          .then(function (t) {
            at = t;
            return press('Backspace');            // stop
          })
          .then(function () {
            /* Back from playback returns to the page it was started from, so
               you can pick the other copy without searching again. */
            return waitFor('document.getElementById("video").classList.contains("hidden") &&' +
                           ' !document.getElementById("detail").classList.contains("hidden")',
                           'playback to stop and the detail page to come back');
          })
          .then(function () {
            if (!(at > 0)) throw new Error('playback never advanced');
          });
      });
    })

    /* ---- what comes next ----

       The whole point of the feature is that it does NOT roll on by itself
       unless it was asked to, so half of these steps are about nothing
       happening. */

    .then(function () {
      if (!hasFixture()) return;
      return step('an episode ending offers the next one, and waits', function () {
        return backToLibrary()
          .then(function () { return openShowPage(titles.run.title); })
          .then(function () { return playEpisode(1, 1); })
          .then(playToEnd)
          .then(waitForOffer)
          .then(function (st) {
            if (st.title.indexOf('S1 E2') !== 0) {
              throw new Error('the offer does not name S1 E2: ' + st.title);
            }
            if (st.show.indexOf(titles.run.title) < 0) {
              throw new Error('the offer does not name the series: ' + st.show);
            }
            if (/Playing in/.test(st.hint)) {
              throw new Error('a countdown ran with the setting off: ' + st.hint);
            }
          })
          .then(function () { return shot('up-next'); })
          /* And then nothing. The offer is still there and no episode has
             started itself, which is the default this feature ships with. */
          .then(function () { return page.waitForTimeout(3000); })
          .then(upNext)
          .then(function (st) {
            if (!st.showing) throw new Error('the offer went away on its own');
            if (!/S1 E2/.test(st.title)) throw new Error('the offer changed to ' + st.title);
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('OK on the offer plays the next one, the last one closed first', function () {
        const mark = timelines.length;
        return page.keyboard.press('Enter')
          .then(function () {
            return waitFor('(function(){var v=document.getElementById("video");' +
                           'return document.getElementById("upnext").classList.contains("hidden") &&' +
                           ' !v.classList.contains("hidden") && v.currentTime > 0.2 && !v.error;})()',
                           'the next episode to start', 25000);
          })
          .then(function () {
            /* A session left open on someone else's server is the rudest thing
               this app can do, so the finished episode is reported stopped
               before the next one asks for anything. */
            const after = timelines.slice(mark);
            const stopped = after.findIndex(function (u) { return /state=stopped/.test(u); });
            const playing = after.findIndex(function (u) { return /state=playing/.test(u); });
            if (stopped < 0) throw new Error('the finished episode was never reported stopped');
            if (playing >= 0 && playing < stopped) {
              throw new Error('the next episode started before the last one was closed');
            }
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('a next episode the guard refuses toasts instead of playing', function () {
        const mark = timelines.length;
        return playToEnd()
          .then(waitForOffer)
          .then(function (st) {
            if (st.title.indexOf('S1 E3') !== 0) {
              throw new Error('the offer does not name S1 E3: ' + st.title);
            }
          })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(function () {
            return waitFor('(function(){var t=document.getElementById("toast");' +
                           'return !t.classList.contains("hidden") && /Not playing/.test(t.textContent) &&' +
                           ' document.getElementById("video").classList.contains("hidden") &&' +
                           ' !document.getElementById("show").classList.contains("hidden");})()',
                           'the refusal, back on the series page', 25000);
          })
          .then(function () {
            /* Refused before anything opened: the decision call carries
               hasMDE=1 and nothing was ever reported playing. */
            const started = timelines.slice(mark).filter(function (u) {
              return /state=playing/.test(u);
            });
            if (started.length) throw new Error('a session was opened for a refused episode');
          });
      });
    })

    .then(function () {
      return step('the sidebar carries the autoplay setting and cycles it', function () {
        return backToLibrary()
          .then(openSidebar)
          .then(sidebarRows)
          .then(function (rows) {
            if (rows.indexOf('Autoplay next: off') < 0) {
              throw new Error('no autoplay setting in the sidebar: ' + rows.join(' | '));
            }
          })
          .then(function () { return sidebarPick('Autoplay next: off'); })
          .then(function () {
            return waitFor('/Autoplay next: 5s/.test(document.getElementById("toast").textContent)',
                           'the setting to say what it moved to');
          })
          .then(function () {
            /* Persisted, so it is still 5s after the app is next launched. */
            return page.evaluate(function () { return localStorage.getItem('reflex.autoplay'); });
          })
          .then(function (stored) {
            if (stored !== '5') throw new Error('the setting stored "' + stored + '"');
          })
          .then(openSidebar)
          .then(sidebarRows)
          .then(function (rows) {
            if (rows.indexOf('Autoplay next: 5s') < 0) {
              throw new Error('the sidebar still says: ' + rows.join(' | '));
            }
          })
          .then(function () { return press('ArrowLeft'); });        // close the sidebar
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('the countdown runs, and BACK before zero cancels it', function () {
        return backToLibrary()
          .then(function () { return openShowPage(titles.run.title); })
          .then(function () { return playEpisode(1, 1); })
          .then(playToEnd)
          .then(function () {
            return waitFor('/Playing in/.test(document.getElementById("un-hint").textContent)',
                           'the countdown', 25000);
          })
          .then(function () { return press('Backspace'); })
          .then(function () {
            return waitFor('document.getElementById("upnext").classList.contains("hidden") &&' +
                           ' document.getElementById("video").classList.contains("hidden")',
                           'the offer and playback to go away');
          })
          /* Longer than the countdown it was cancelling. Nothing may start
             behind a screen nobody is looking at any more. */
          .then(function () { return page.waitForTimeout(6000); })
          .then(function () {
            return page.evaluate(function () {
              return document.getElementById('video').classList.contains('hidden');
            });
          })
          .then(function (gone) {
            if (!gone) throw new Error('a cancelled countdown started an episode anyway');
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('the countdown reaching zero plays the next episode', function () {
        return backToLibrary()
          .then(function () { return openShowPage(titles.run.title); })
          .then(function () { return playEpisode(1, 1); })
          .then(playToEnd)
          .then(function () {
            return waitFor('/Playing in/.test(document.getElementById("un-hint").textContent)',
                           'the countdown', 25000);
          })
          .then(function () { return shot('up-next-countdown'); })
          /* Not a key from here on: the point is that it plays itself. */
          .then(function () {
            return waitFor('(function(){var v=document.getElementById("video");' +
                           'return document.getElementById("upnext").classList.contains("hidden") &&' +
                           ' !v.classList.contains("hidden") && v.currentTime > 0.2 && !v.error;})()',
                           'the next episode to start itself', 25000);
          })
          .then(function () { return press('Backspace'); });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('a new series is offered but never counted down', function () {
        return backToLibrary()
          .then(function () { return openShowPage(titles.run.title); })
          .then(function () { return playEpisode(1, titles.run.lastOfFirst); })
          .then(playToEnd)
          .then(waitForOffer)
          .then(function (st) {
            if (st.title.indexOf('S2 E1') !== 0) {
              throw new Error('the offer does not name S2 E1: ' + st.title);
            }
            if (/Playing in/.test(st.hint)) {
              throw new Error('a series boundary counted down: ' + st.hint);
            }
          })
          .then(function () { return page.waitForTimeout(6000); })
          .then(upNext)
          .then(function (st) {
            if (!st.showing) throw new Error('the offer fired at a series boundary');
          })
          .then(function () { return press('Backspace'); });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('the last episode of the last series offers nothing', function () {
        return backToLibrary()
          .then(function () { return openShowPage(titles.run.title); })
          .then(function () { return playEpisode(titles.run.seasons, titles.run.lastOfLast); })
          .then(playToEnd)
          .then(function () {
            return waitFor('document.getElementById("video").classList.contains("hidden") &&' +
                           ' document.getElementById("upnext").classList.contains("hidden") &&' +
                           ' !document.getElementById("show").classList.contains("hidden")',
                           'playback to end with nothing offered', 25000);
          });
      });
    })

    .then(function () {
      if (!hasFixture()) return;
      return step('a film that ends offers nothing', function () {
        return backToLibrary()
          .then(function () { return openTitle(titles.directPlays.title); })
          .then(function () { return page.keyboard.press('Enter'); })
          .then(playToEnd)
          .then(function () {
            return waitFor('document.getElementById("video").classList.contains("hidden") &&' +
                           ' document.getElementById("upnext").classList.contains("hidden") &&' +
                           ' !document.getElementById("detail").classList.contains("hidden")',
                           'the film to end and the page to come back', 25000);
          });
      });
    });
};
