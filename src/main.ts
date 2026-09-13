/* The one entry. index.html loads this and nothing else; the import graph
   below it is the dependency order. */
import './app';
/* Nothing in the app reads the seam — it is here because the smoke suite does,
   and a module nothing imports is not in the bundle. */
import './seam';
