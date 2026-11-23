/* Inner tabs on a v2 page. Left/Right move between them; Down leaving is the
   page's call. */
import { clamp } from '../core/ui';
import { fill, span } from './dom';

export interface Tabs {
  /** Moves one tab left (-1) or right (1), stopping at the ends; returns the new index. */
  step(direction: -1 | 1): number;
  index(): number;
}

export function tabs(host: HTMLElement, labels: string[], active: number): Tabs {
  let at = active;
  const draw = () =>
    fill(host, ...labels.map((label, i) => span(`v2-tab${i === at ? ' on' : ''}`, label)));
  draw();
  return {
    step(direction) {
      at = clamp(at + direction, 0, labels.length - 1);
      draw();
      return at;
    },
    index: () => at,
  };
}
