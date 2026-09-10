/* Will we play this copy, and at what cost to a server we do not own.
   Every quality below Original is a bitrate cap the server obeys by
   re-encoding, so the 4K rule applies to all of them. */

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

/* Caps above the file's own bitrate are not offered: more server work for a
   worse picture. */
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

/* We identify as Chrome, so a server may offer direct play of something
   Chrome decodes and this panel does not. Checked again here or that is a
   black screen. */
export function canDecode(media: PlexMedia | null | undefined): boolean {
  if (!media) return false;
  return Panel.supports('video', media.videoCodec) && Panel.supports('container', media.container);
}

export function isUHD(media: PlexMedia | null | undefined): boolean {
  return (media?.width ?? 0) >= 2500 || (media?.height ?? 0) >= 1400;
}

/* The kill-stream fires on 4K transcodes AFTER the session opens, so 4K that
   will not direct play is refused before anything starts. Below 4K a transcode
   is fine — insisting otherwise made every TrueHD remux unplayable. The decode
   check is direct-play only: a re-encode arrives as H.264. */
export function allows(media: PlexMedia | null | undefined, direct: boolean): boolean {
  return direct ? canDecode(media) : !isUHD(media);
}
