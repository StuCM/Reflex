/* The row of remote colour keys on a v2 page: a dot and what the key does.
   Drawing only — the page wires the keys. */
import { div, fill, span } from './dom';

export interface LegendEntry {
  key: 'ok' | 'red' | 'yellow' | 'blue';
  label: string;
}

export function legend(host: HTMLElement, entries: LegendEntry[]): void {
  fill(
    host,
    ...entries.map((entry) => {
      const item = div('lg-item');
      item.appendChild(span(`lg-dot lg-${entry.key}`));
      item.appendChild(span('lg-label', entry.label));
      return item;
    }),
  );
}
