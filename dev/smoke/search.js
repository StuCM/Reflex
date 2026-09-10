'use strict';
/* search */
module.exports = function (h) {
  const { shot, press, waitFor, step, backToLibrary, page, titles } = h;

  return h
    .ready()

    .then(function () {
      return step('search finds a title and shows a result count', function () {
        return backToLibrary()
          .then(function () {
            return press('F1');
          })
          .then(function () {
            return page.waitForSelector('#search-input', { state: 'visible' });
          })
          .then(function () {
            return page.fill('#search-input', titles.directPlays.title);
          })
          .then(function () {
            return page.keyboard.press('Enter');
          })
          .then(function () {
            /* The results page has no chip row any more: the first row's own
               title is the header, and it still has to say what was asked, how
               many came back, and the way out. */
            return waitFor(
              'document.getElementById("browse").classList.contains("results")',
              'the results page',
            );
          })
          .then(function () {
            return page.textContent('#mh-row');
          })
          .then(function (header) {
            const safe = titles.directPlays.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const want = new RegExp('^' + safe + '\\s+·\\s+1 film\\s+·\\s+BACK to library$');
            if (!want.test(header.trim())) throw new Error('the header reads "' + header + '"');
          })
          .then(function () {
            return shot('search');
          })
          .then(function () {
            return press('Backspace');
          });
      });
    });
};
