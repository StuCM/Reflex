import { describe, expect, it } from 'vitest';
import { endsAt, hoursAndMinutes, timecode, wallClock } from '../src/rules/clock';

describe('timecode', () => {
  it('drops the hour under an hour and keeps two digits below it', () => {
    expect(timecode(0)).toBe('0:00');
    expect(timecode(9 * 60 + 12)).toBe('9:12');
    expect(timecode(3600 + 9 * 60 + 12)).toBe('1:09:12');
  });

  /* A live or badly-muxed stream reports Infinity or NaN, and the OSD paints
     it every frame — a throw here is a player that stops drawing. */
  it('survives what a broken stream reports', () => {
    expect(timecode(Number.NaN)).toBe('0:00');
    expect(timecode(-5)).toBe('0:00');
  });
});

describe('hoursAndMinutes', () => {
  it('is the resume caption, hours and minutes only', () => {
    expect(hoursAndMinutes(252)).toBe('0:04');
    expect(hoursAndMinutes(3600 + 26 * 60)).toBe('1:26');
  });
});

describe('endsAt', () => {
  it('adds what is left to the clock it is given', () => {
    const now = new Date(2026, 0, 1, 21, 48);
    expect(wallClock(now)).toBe('21:48');
    expect(endsAt(now, 2 * 3600 + 37 * 60)).toBe('00:25');
  });

  /* An unknown duration must not read as "ends now". */
  it('says nothing when nothing is left to say', () => {
    expect(endsAt(new Date(), 0)).toBe('');
  });
});
