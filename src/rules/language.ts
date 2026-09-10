/* Plex reports a stream's language as an ISO 639-2 code and, usually, a
   `language` field with the name already in it. Usually is not always, and
   "FRA" on a menu row is a worse answer than "French", so there is a table for
   the ones a shared library actually turns up. Anything unlisted falls back to
   the code, which is still better than nothing. */

const LANGUAGES: Record<string, string> = {
  eng: 'English',
  fre: 'French',
  fra: 'French',
  ger: 'German',
  deu: 'German',
  spa: 'Spanish',
  ita: 'Italian',
  por: 'Portuguese',
  dut: 'Dutch',
  nld: 'Dutch',
  rus: 'Russian',
  pol: 'Polish',
  swe: 'Swedish',
  nor: 'Norwegian',
  dan: 'Danish',
  fin: 'Finnish',
  ice: 'Icelandic',
  isl: 'Icelandic',
  gle: 'Irish',
  gla: 'Gaelic',
  cym: 'Welsh',
  wel: 'Welsh',
  cze: 'Czech',
  ces: 'Czech',
  hun: 'Hungarian',
  gre: 'Greek',
  ell: 'Greek',
  tur: 'Turkish',
  ara: 'Arabic',
  heb: 'Hebrew',
  hin: 'Hindi',
  ben: 'Bengali',
  tam: 'Tamil',
  tel: 'Telugu',
  urd: 'Urdu',
  jpn: 'Japanese',
  kor: 'Korean',
  chi: 'Chinese',
  zho: 'Chinese',
  tha: 'Thai',
  vie: 'Vietnamese',
  ind: 'Indonesian',
  may: 'Malay',
  ukr: 'Ukrainian',
  ron: 'Romanian',
  rum: 'Romanian',
  bul: 'Bulgarian',
  hrv: 'Croatian',
  srp: 'Serbian',
  slo: 'Slovak',
  slk: 'Slovak',
  slv: 'Slovenian',
  cat: 'Catalan',
  baq: 'Basque',
  eus: 'Basque',
  glg: 'Galician',
  per: 'Persian',
  fas: 'Persian',
  fil: 'Filipino',
  tgl: 'Tagalog',
  und: 'Unknown',
  mul: 'Multiple',
  zxx: 'None',
};

/** The language of a stream as a reader would say it, or '' if unknown. */
export function langName(stream: PlexStream | null | undefined): string {
  if (!stream) return '';
  if (stream.language) return stream.language;
  const code = String(stream.languageCode ?? '').toLowerCase();
  if (!code) return '';
  return LANGUAGES[code] ?? code.toUpperCase();
}
