/* Will we play this copy, and at what cost to a server we do not own.
 *
 * Plex's quality menu is a cap on the video bitrate, which the server obeys by
 * re-encoding. So every entry below "Original" is a transcode by definition —
 * which means the 4K rule applies to all of them, and on a 4K file the guard
 * refuses every one. That is correct, and it is left to the guard rather than
 * hidden here, so the refusal explains itself.
 */

const BITRATES = [20000, 12000, 8000, 4000, 3000, 2000, 720];

export function bitrateLabel(kbps: number): string {
  return kbps >= 1000 ? `${kbps / 1000} Mbps` : `${kbps} Kbps`;
}

export function versionLabel(media: PlexMedia | null | undefined): string {
  if (!media) return 'this version';
  const resolution = String(media.videoResolution ?? '').toLowerCase();
  const name =
    resolution === '4k' ? '4K' : resolution ? `${resolution}p` : `${media.height ?? '?'}p`;
  const label = `${name} ${String(media.videoCodec ?? '?').toUpperCase()}`;
  return media.bitrate ? `${label} · ${bitrateLabel(media.bitrate)}` : label;
}

/* Only caps below what the file already is are offered; capping a 9 Mbps file
   at 20 would make the server work for a worse picture. */
export function qualities(media: PlexMedia | null | undefined): Quality[] {
  const source = media?.bitrate ?? 0;
  const out: Quality[] = [{ label: `Original (${versionLabel(media)})`, bitrate: null }];
  BITRATES.forEach((cap) => {
    if (!source || cap < source) {
      out.push({ label: `${bitrateLabel(cap)} — server converts`, bitrate: cap });
    }
  });
  return out;
}

/* The same list js/api/plex.js declares to the server, checked again on the way
   back — we identify as Chrome, so a server applying its Chrome profile may
   offer direct play of something Chrome decodes and this panel does not (VP9 or
   AV1 in a WebM, say). Claiming a codec the panel cannot decode is a black
   screen, so the two must agree. */
export function canDecode(media: PlexMedia | null | undefined): boolean {
  if (!media) return false;
  return Panel.supports('video', media.videoCodec) && Panel.supports('container', media.container);
}

export function isUHD(media: PlexMedia | null | undefined): boolean {
  return (media?.width ?? 0) >= 2500 || (media?.height ?? 0) >= 1400;
}

/* The one rule with teeth: the admin's kill-stream fires on 4K transcodes,
   after the session has started, so a 4K item that will not direct play is
   refused before anything opens. Below 4K a transcode is ordinary server work —
   preferring direct play is right, insisting on it is what made every TrueHD
   remux unplayable.

   Direct play is also the only path that hands the panel the original file, so
   that is where the decode check applies; a re-encode arrives as H.264. */
export function allows(media: PlexMedia | null | undefined, direct: boolean): boolean {
  return direct ? canDecode(media) : !isUHD(media);
}
