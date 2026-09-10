/* The one entry. index.html loads this and nothing else.
   The order below was index.html's script list and is still the dependency
   graph: each legacy module publishes itself on `window` on the way past. A
   file leaves this list when it moves to src/. */

import '../js/core/config.js';
import '../js/data/store.js';
import '../js/data/cached.js';
import '../js/core/panel.js';

/* rules/ has moved to src/. This publishes it under the name js/ still uses,
   and sits exactly where js/rules/media.js did in the order. */
import './legacy';

import '../js/data/servers.js';
import '../js/data/merge.js';
import '../js/data/art.js';
import '../js/core/ui.js';
import '../js/view/glyphs.js';
import '../js/view/menu.js';
import '../js/view/rail.js';
import '../js/data/meta.js';
import '../js/data/guard.js';
import '../js/data/shows.js';
import '../js/view/masthead.js';
import '../js/screen/detail.js';
import '../js/screen/showpage.js';
import '../js/data/devices.js';
import '../js/data/discovery.js';
import '../js/view/sidebar.js';
import '../js/screen/browse.js';
import '../js/screen/player.js';
import '../js/app.js';
