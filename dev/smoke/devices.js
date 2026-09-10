'use strict';
/* the device screen */
module.exports = function (h) {
  const { shot, press, waitFor, step, sidebarPick, backToLibrary } = h;

  return h
    .ready()

    .then(function () {
      return step('the device screen lists who has been watching', function () {
        return backToLibrary()
          .then(function () {
            return sidebarPick('Devices');
          })
          .then(function () {
            return waitFor(
              '/Living room/.test(document.querySelector("#device-list").textContent)',
              'the device list',
              15000,
            );
          })
          .then(function () {
            return shot('devices');
          })
          .then(function () {
            return press('Backspace');
          }) // saves and returns
          .then(function () {
            return waitFor(
              'document.getElementById("devices").classList.contains("hidden")',
              'the device screen to close',
            );
          });
      });
    });
};
