/* The time, top right, redrawn at each minute boundary rather than every second. */
import { wallClock } from '../rules/clock';
import { must } from './dom';

export function start(): void {
  const element = must('clock');
  const tick = (): void => {
    const now = new Date();
    element.textContent = wallClock(now);
    setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
  };
  tick();
}
