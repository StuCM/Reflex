/* A virtualised poster grid: a fixed pool of rows, one more than fit on
   screen, recycled as focus moves down. Never an element per item. */
import { clamp } from '../core/ui';
import { div, fill, span } from './dom';

export interface GridItem {
  title: string;
  poster?: string;
  /** Not on any server: dimmed and tagged. */
  absent?: boolean;
}

export interface GridOptions {
  columns: number;
  tileW: number;
  tileH: number;
  gap: number;
  /** Rows that fit on screen. */
  rows: number;
}

interface Tile {
  element: HTMLElement;
  image: HTMLImageElement;
  title: HTMLElement;
}

export function grid(
  host: HTMLElement,
  options: GridOptions,
): { render(items: GridItem[], focus: number): void } {
  const { columns, rows } = options;
  const pitch = options.tileH + options.gap;
  const poolRows = rows + 1;
  const pan = div('gd-pan');
  const pool: { element: HTMLElement; tiles: Tile[] }[] = [];
  let first = 0;

  host.classList.add('gd');
  host.style.setProperty('--gd-w', `${options.tileW}px`);
  host.style.setProperty('--gd-h', `${options.tileH}px`);
  host.style.setProperty('--gd-gap', `${options.gap}px`);
  host.style.setProperty('--gd-height', `${rows * pitch - options.gap}px`);

  for (let rowAt = 0; rowAt < poolRows; rowAt++) {
    const tiles: Tile[] = [];
    const rowElement = div('gd-row');
    for (let col = 0; col < columns; col++) {
      const image = document.createElement('img');
      image.className = 'gd-img hidden';
      const title = div('gd-title');
      const element = div('gd-tile');
      element.appendChild(image);
      element.appendChild(title);
      element.appendChild(span('gd-tag', 'Not on server'));
      rowElement.appendChild(element);
      tiles.push({ element, image, title });
    }
    pan.appendChild(rowElement);
    pool.push({ element: rowElement, tiles });
  }
  fill(host, pan);

  function render(items: GridItem[], focus: number): void {
    const focusRow = Math.floor(focus / columns);
    first = clamp(first, focusRow - rows + 1, focusRow);
    pan.style.setProperty('--grid-y', `${-first * pitch}px`);

    for (let rowAt = first; rowAt <= first + rows; rowAt++) {
      const slot = pool[rowAt % poolRows];
      if (!slot) return;
      slot.element.style.setProperty('--ry', `${rowAt * pitch}px`);
      slot.tiles.forEach((tile, col) => {
        const at = rowAt * columns + col;
        const item = items[at];
        tile.element.className =
          'gd-tile' +
          (item ? '' : ' hidden') +
          (at === focus ? ' on' : '') +
          (item && item.absent ? ' absent' : '');
        if (!item) return;
        tile.title.textContent = item.title;
        const poster = item.poster;
        if (!poster) tile.image.removeAttribute('src');
        else if (tile.image.getAttribute('src') !== poster) tile.image.setAttribute('src', poster);
        tile.image.className = poster ? 'gd-img' : 'gd-img hidden';
      });
    }
  }

  return { render };
}
