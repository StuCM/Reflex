/* The sections, moved off the top of the screen.

   An overlay inside the browse view rather than a view of its own, so nothing
   in js/app.js or js/ui.js has to know it exists: Browse hands it the key while
   it is open and takes it back when it closes.

   Everything the old chip row reached is here, because the Magic Remote has no
   colour buttons and this is now the only way to any of it. A section's own
   category rows hang under it — the hub titles Browse already holds, so opening
   this fetches nothing. */
var Sidebar = (function () {
  'use strict';

  var el = document.getElementById('sidebar-list');

  var VIEW_H = 968;     // the panel less its top padding and a little breathing room
  var offset = 0;       // how far the list is wound up, in px

  var secs = [];        // { title, categories: [string], current }
  var watching = null;  // { current, type } — the Continue watching entry's state
  var rows = [];        // the flattened list the d-pad walks
  var idx = 0;
  var showing = false;
  var NONE = -2;        // nothing expanded; sections are 0-up and watching is -1
  var expanded = NONE;  // which entry's children are listed, if any
  var onPick = null;
  var atMode = '';      // the mode showing, so it can be marked as the sections are

  /* Kids, discovery and search are modes rather than sections; the last three
     are the settings the chip row used to carry. */
  function modes() {
    var out = [{ label: 'Discovery', kind: 'discover', current: atMode === 'discover' },
               { label: 'Kids', kind: 'kids', current: atMode === 'kids' },
               { label: 'Search', kind: 'search' }];
    if (Servers.count() > 1) {
      var pref = Servers.get(Servers.preferred());
      out.push({ label: 'Prefer ' + (pref ? pref.name : '?'), kind: 'prefer' });
    }
    out.push({ label: 'Devices', kind: 'devices' });
    out.push({ label: 'Panel', kind: 'panel' });
    return out;
  }

  /* Continue watching answers "what was I in the middle of" across films and
     shows at once, so it heads the list rather than hanging under a section,
     with the two cuts of it as its children. */
  function watchingRows() {
    if (!watching) return [];
    var type = watching.type || null;
    var out = [{ label: 'Continue watching', kind: 'watching', index: -1, type: null,
                 opens: true, current: !!watching.current && type === null }];
    if (expanded !== -1) return out;
    out.push({ label: 'Movies', kind: 'watching', index: -1, type: 'movie', sub: true,
               current: !!watching.current && type === 'movie' });
    out.push({ label: 'TV Shows', kind: 'watching', index: -1, type: 'episode', sub: true,
               current: !!watching.current && type === 'episode' });
    return out;
  }

  function build() {
    var out = watchingRows(), i, j, cats;
    for (i = 0; i < secs.length; i++) {
      cats = secs[i].categories || [];
      out.push({ label: secs[i].title, kind: 'section', index: i,
                 opens: cats.length > 0, current: !!secs[i].current });
      if (i !== expanded) continue;
      for (j = 0; j < cats.length; j++) {
        /* Continue watching has its own entry above, and every section builds
           one — listing them all is the duplication this is rid of. */
        if (cats[j] === 'Continue watching') continue;
        out.push({ label: cats[j], kind: 'row', index: i, row: j, sub: true });
      }
    }
    return out.concat(modes());
  }

  function render() {
    var html = '', i, r;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      html += '<div class="sb-row' + (r.sub ? ' sub' : '') +
              (r.current ? ' cur' : '') + (i === idx ? ' on' : '') + '">' +
              UI.escapeHtml(r.label) + '</div>';
    }
    el.innerHTML = html;
    reveal();
  }

  /* Keep the focused row in view by winding the list, the way js/rail.js moves
     a strip: there is no pointer on this set, so overflow:auto would put the
     entries past the fold behind a scrollbar nothing can reach. Rows are two
     different heights, so the offsets are read off the DOM rather than
     arithmetic that would have to know about both. */
  function reveal() {
    var row = el.children[idx];
    if (!row) return;
    var top = row.offsetTop, bottom = top + row.offsetHeight;
    if (bottom > offset + VIEW_H) offset = bottom - VIEW_H;
    if (top < offset) offset = top;
    if (offset < 0) offset = 0;
    var t = 'translateY(' + (-offset) + 'px)';
    el.style.transform = t;
    el.style.webkitTransform = t;
  }

  function at(kind, index) {
    var i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].kind === kind && rows[i].index === index) return i;
    }
    return 0;
  }

  /* sections: what Browse holds — title, the section's row titles, and whether
     it is the one showing. The current section opens expanded, so the thing
     most likely to be wanted is already on screen. mode marks kids or discovery
     the same way, since neither is a section and both can be what you are in.
     watching is { current, type }: whether the Continue watching row has the
     focus, and which cut of it. */
  function open(sections, pick, mode, watchingState) {
    secs = sections || [];
    watching = watchingState || null;
    onPick = pick;
    atMode = mode || '';
    expanded = NONE;
    var i;
    for (i = 0; i < secs.length; i++) if (secs[i].current) expanded = i;
    /* The section is current too whenever Continue watching is, so this comes
       second: the list opens on where the focus actually is, not a level up. */
    if (watching && watching.current) expanded = -1;
    rows = build();
    idx = at(expanded === -1 ? 'watching' : 'section', expanded);
    offset = 0;
    showing = true;
    el.parentNode.classList.add('open');
    render();
  }

  function close() {
    showing = false;
    el.parentNode.classList.remove('open');
  }

  function isOpen() { return showing; }

  /* True for every key: an overlay that lets some keys through to the rail
     behind it would move a selection you cannot see. */
  function key(code) {
    var K = UI.KEY, r = rows[idx];

    if (UI.isBack(code) || code === K.LEFT) { close(); return true; }
    if (code === K.UP) { idx = UI.clamp(idx - 1, 0, rows.length - 1); render(); return true; }
    if (code === K.DOWN) { idx = UI.clamp(idx + 1, 0, rows.length - 1); render(); return true; }
    if (code !== K.RIGHT && code !== K.OK) return true;
    if (!r) return true;

    /* An entry with children opens them in place; pressing again on the open
       one — or on a section never visited, whose categories nobody has yet —
       picks it. */
    if (r.opens && r.index !== expanded) {
      expanded = r.index;
      rows = build();
      idx = at(r.kind, r.index);
      render();
      return true;
    }

    close();
    if (onPick) onPick(r);
    return true;
  }

  return { open: open, close: close, isOpen: isOpen, key: key };
})();
