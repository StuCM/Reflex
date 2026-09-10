'use strict';
/* the plex.tv link screen, and the rail it becomes */
module.exports = function (h) {
  const { shot, press, waitFor, step, openSidebar, sidebarRows, page } = h;

  return Promise.resolve()

    .then(function () {
      return step('shows the plex.tv link code', function () {
        return page
          .waitForSelector('#link:not(.hidden)', { timeout: 8000 })
          .then(function () {
            return page.textContent('#link-code');
          })
          .then(function (code) {
            if (code.trim() !== 'MOCK') throw new Error('link code was "' + code + '"');
          })
          .then(function () {
            return shot('link');
          });
      });
    })

    .then(function () {
      return step('links, discovers a server and paints a rail', function () {
        /* Tiles exist from boot — the pool is built empty — so wait for one
           that has actually been filled with something. */
        return waitFor(
          '(function(){var t=document.querySelectorAll("#rows .tile:not(.hidden)");' +
            'var n=0,i;for(i=0;i<t.length;i++) if(t[i].textContent.trim()) n++;' +
            'return n > 5;})()',
          'filled tiles',
          20000,
        )
          .then(openSidebar)
          .then(sidebarRows)
          .then(function (rows) {
            const text = rows.join(' | ');
            if (text.indexOf('Movies') < 0) throw new Error('no Movies section: ' + text);
            if (text.indexOf('TV Shows') < 0) throw new Error('no TV Shows section: ' + text);
          })
          .then(function () {
            return press('ArrowLeft');
          }); // close it again
      });
    });
};
