/* Poster and backdrop URLs. Items are stamped with the server they came from,
   so callers do not carry it around just to draw a picture. */
import { queryString } from './client';
import * as servers from '../../data/servers';

export function photoUrl(
  server: PlexServer | null | undefined,
  imagePath: string | undefined,
  width: number,
  height: number,
): string {
  if (!server || !imagePath) return '';
  return `${server.base}/photo/:/transcode?${queryString({
    width,
    height,
    minSize: 1,
    upscale: 1,
    url: `${imagePath}?X-Plex-Token=${server.token}`,
    'X-Plex-Token': server.token,
  })}`;
}

export function posterUrl(
  item: PlexItem | null | undefined,
  width: number,
  height: number,
): string {
  if (!item?.thumb) return '';
  return photoUrl(servers.of(item), item.thumb, width, height);
}

export function artUrl(item: PlexItem | null | undefined, width: number, height: number): string {
  if (!item?.art) return '';
  return photoUrl(servers.of(item), item.art, width, height);
}

/* A show's theme tune, or '' when it has none — most do not, and that is
   normal. A plain file GET like a poster: no decision, no session. */
export function themeUrl(
  server: PlexServer | null | undefined,
  item: (PlexItem & { theme?: string }) | null | undefined,
): string {
  if (!server || !item?.theme) return '';
  return `${server.base}${item.theme}?X-Plex-Token=${server.token}`;
}
