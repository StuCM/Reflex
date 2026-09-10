/* The one entry. index.html loads this and nothing else.
 *
 * The order below is what index.html's script list used to be, and it is still
 * the dependency graph — a module here reaches its neighbours by bare name
 * through `window`, which each of them assigns on the way past. Every file that
 * moves to src/ leaves this list and joins the imports above it, and the
 * migration is over when nothing below is left.
 *
 * See docs/refactor-plan.md.
 */

import '../js/core/config.js';
import '../js/api/http.js';
import '../js/data/store.js';
import '../js/data/cache.js';
import '../js/core/panel.js';

/* rules/ has moved to src/. This publishes it under the name js/ still uses,
   and sits exactly where js/rules/media.js did in the order. */
import './legacy';

import '../js/data/servers.js';
import '../js/data/merge.js';
import '../js/api/plex.js';
import '../js/api/tmdb.js';
import '../js/api/youtube.js';
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
