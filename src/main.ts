/* The one entry. index.html loads this and nothing else.
   The order below was index.html's script list and is still the dependency
   graph: each legacy module publishes itself on `window` on the way past. A
   file leaves this list when it moves to src/. */

/* rules/ has moved to src/. This publishes it under the name js/ still uses,
   and sits exactly where js/rules/media.js did in the order. */
import './legacy';

import '../js/screen/player.js';
import '../js/app.js';
