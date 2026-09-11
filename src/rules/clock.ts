/* Times as they are written on the player and the film page. Pure: no DOM, no
   Date.now() — the caller passes the clock in, which is what makes "ends at"
   testable. */

function pad(value: number): string {
  return (value < 10 ? '0' : '') + value;
}

/** "1:09:12", or "9:12" under an hour. */
export function timecode(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(whole % 60)}` : `${minutes}:${pad(whole % 60)}`;
}

/** "1:26" — hours and minutes only, for a resume position. */
export function hoursAndMinutes(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

/** The wall clock, 24-hour and zero-padded — 7a writes midnight as 00:25. */
export function wallClock(now: Date): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** When something with `secondsLeft` to run will finish, or '' if unknown. */
export function endsAt(now: Date, secondsLeft: number): string {
  if (!secondsLeft) return '';
  return wallClock(new Date(now.getTime() + secondsLeft * 1000));
}
