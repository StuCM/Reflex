/* The rail draws from a fixed pool — ROW_POOL rows of TILE_POOL tiles — and
   hangs its bookkeeping on the elements themselves rather than in a parallel
   array. These are those properties. Underscored so nothing mistakes them for
   something the DOM provides. */

/** One tile in the pool. Recycled: _item says which film is in it now. */
interface RailTileElement extends HTMLDivElement {
  _img: HTMLImageElement;
  _name: HTMLDivElement;
  _sub: HTMLDivElement;
  _prog: HTMLDivElement;
  /** Index within the row, or -1 while unused. */
  _idx: number;
  _filled: boolean;
  _item: PlexItem | null;
  /** Art has been asked for and has not landed yet. */
  _wait: boolean;
}

/** One row in the pool. */
interface RailRowElement extends HTMLDivElement {
  _label: HTMLDivElement;
  _strip: HTMLDivElement;
  /** Index into the row model, or -1 while unused. */
  _row: number;
  _rowRef: object | null;
  _tiles: RailTileElement[];
  _onScreen: boolean;
}
