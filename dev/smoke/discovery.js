'use strict';
/* a curated TMDB list as rows of what we hold */
module.exports = function (h) {
  const { shot, press, waitFor, step, sidebarPick, backToLibrary } = h;

  return h.ready()

    .then(function () {
      return step('discovery turns a curated list into rows of what we hold', function () {
        /* The mock answers TMDB's list endpoints with ids the fake servers
           really have, so this walks the whole path: a small external list, a
           guid lookup per title, and a row of the ones that came back. */
        return backToLibrary()
          .then(function () { return sidebarPick('Discovery'); })
          .then(function () {
            return waitFor('(function(){var r=document.querySelectorAll("#rows .row:not(.hidden)");' +
                           'for(var i=0;i<r.length;i++){' +
                           'if(/Trending this week/.test(r[i].textContent) &&' +
                           ' r[i].querySelectorAll(".tile:not(.hidden)").length) return true;}' +
                           'return false;})()', 'a trending row with something in it', 20000);
          })
          .then(function () { return shot('discovery'); })
          .then(function () { return press('Backspace'); });
      });
    });
};
