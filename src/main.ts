/* The one entry. index.html loads this and nothing else.

   js/ is gone, so this is no longer a dependency order — the import graph is.
   legacy.ts stays only while anything still reaches for a global. */
import './legacy';

/* Last: the boot runs once everything it wires is defined. */
import './app';
