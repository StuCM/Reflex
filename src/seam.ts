/* The app modules the smoke suite reaches for, published under the names
   it uses. Not a migration bridge and not an app dependency: nothing in src/
   may import this, and the consumers are `page.evaluate` strings in dev/smoke/,
   where no import reaches and no type checker looks. Deleting a name here
   breaks a smoke step that nothing will warn you about. */
import settings from './core/config';
import * as art from './data/art';
import * as merge from './data/merge';
import * as showpage from './screen/showpage';
import * as grid from './view/grid';
import * as legend from './view/legend';
import * as menu from './view/menu';
import * as sidebar from './view/sidebar';
import * as tabs from './view/tabs';

window.Art = art;
window.Merge = merge;
window.ShowPage = showpage;
window.Sidebar = sidebar;
window.Grid = grid;
window.Legend = legend;
window.Menu = menu;
window.Tabs = tabs;
/* The settings object itself, not a copy: the recaps step clears `youtubeKey`
   and restores it, which is how it proves enabled() reads it at call time. */
window.Config = settings;
