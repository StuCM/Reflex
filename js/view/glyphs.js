/* The action icons, drawn as inline SVG.

   The film page and the player each drew their own copy of the same builder
   and three of the same icons, which is how two buttons meaning the same thing
   drift apart. Inline rather than a font: nothing is fetched, and stroke
   follows the text colour, so a focused button needs no second asset. */
var Glyphs = (function () {
  'use strict';

  /* One 46px icon from its inner shapes. */
  function glyph(inner) {
    return (
      '<svg width="46" height="46" viewBox="0 0 256 256" fill="none" ' +
      'stroke="currentColor" stroke-width="16" stroke-linecap="round" ' +
      'stroke-linejoin="round">' +
      inner +
      '</svg>'
    );
  }

  return {
    glyph: glyph,

    /* Shared by the film page and the player. */
    audio: glyph(
      '<polygon points="36,100 92,100 148,48 148,208 92,156 36,156"/>' +
        '<path d="M188 92a52 52 0 0 1 0 72"/>',
    ),
    subs: glyph(
      '<rect x="28" y="52" width="200" height="152" rx="18"/>' +
        '<line x1="64" y1="124" x2="140" y2="124"/>' +
        '<line x1="64" y1="164" x2="192" y2="164"/>',
    ),
    quality: glyph(
      '<line x1="56" y1="196" x2="56" y2="140"/>' +
        '<line x1="128" y1="196" x2="128" y2="96"/>' +
        '<line x1="200" y1="196" x2="200" y2="52"/>',
    ),

    /* The film page's own. */
    trailer: glyph('<circle cx="128" cy="128" r="100"/><polygon points="106,84 178,128 106,172"/>'),
    source: glyph(
      '<rect x="36" y="44" width="184" height="72" rx="14"/>' +
        '<rect x="36" y="140" width="184" height="72" rx="14"/>',
    ),
    remove: glyph(
      '<circle cx="128" cy="128" r="100"/>' + '<line x1="84" y1="128" x2="172" y2="128"/>',
    ),

    /* The player's own. */
    rewind: glyph(
      '<polygon points="124,64 124,192 40,128"/>' + '<polygon points="216,64 216,192 132,128"/>',
    ),
    forward: glyph(
      '<polygon points="132,64 132,192 216,128"/>' + '<polygon points="40,64 40,192 124,128"/>',
    ),
    /* Filling their box the way the two jumps either side of them do: the
       buttons were always one size, and a triangle inset in its own box is
       what read as a smaller play than forward. */
    play: glyph('<polygon points="72,48 72,208 208,128"/>'),
    pause: glyph(
      '<line x1="88" y1="52" x2="88" y2="204"/>' + '<line x1="168" y1="52" x2="168" y2="204"/>',
    ),
    chapters: glyph(
      '<rect x="28" y="60" width="200" height="136" rx="18"/>' +
        '<line x1="96" y1="60" x2="96" y2="196"/>' +
        '<line x1="160" y1="60" x2="160" y2="196"/>',
    ),
  };
})();
