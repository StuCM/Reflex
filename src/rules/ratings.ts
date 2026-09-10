/* What a certificate means, and what counts as kids viewing. */

const RATING_AGE: Record<string, number> = {
  u: 0,
  g: 0,
  e: 0,
  ec: 0,
  'tv-y': 0,
  'tv-g': 0,
  uc: 0,
  'tv-y7': 7,
  pg: 8,
  'tv-pg': 8,
  'pg-13': 13,
  'tv-14': 14,
  r: 17,
  'tv-ma': 17,
  'nc-17': 18,
  x: 18,
};

/** Everything rated at or below this counts as kids viewing. */
export const KIDS_MAX_AGE = 12;

/* Unrated returns null rather than 0 — the absence of a rating is not evidence
   that something is suitable for children. */
export function ageLimit(rating: string | null | undefined): number | null {
  if (!rating) return null;
  let text = String(rating).toLowerCase().replace(/\s/g, '');
  const slash = text.lastIndexOf('/');
  if (slash >= 0) text = text.substring(slash + 1); // strip "gb/", "us/"
  const leadingNumber = /^(\d{1,2})/.exec(text); // 12, 12a, 15, 18, 6, 7
  if (leadingNumber?.[1]) return parseInt(leadingNumber[1], 10);
  return RATING_AGE[text] ?? null;
}

export function isKidsRating(rating: string | null | undefined): boolean {
  const age = ageLimit(rating);
  return age !== null && age <= KIDS_MAX_AGE;
}
