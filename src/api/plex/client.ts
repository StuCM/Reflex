/* The Plex request plumbing, and the account token.
   Every call that touches a media server takes that server as its first
   argument. There is deliberately no "current server": the account has more
   than one, the same film is on both, and each must be askable separately. */
import { queryString, request as httpRequest } from '../http';

const PLEX_TV = Config.plexTvBase;
const PRODUCT = 'Reflex';
const VERSION = '0.0.1';

/* The panel is webOS, but do NOT say so. Measured against both of this
   account's servers on 2026-08-13: the decision engine answers 400 — an HTML
   error page, not a Plex one — for a platform of webOS, WebOS, LG, Linux or
   absent, and returns a decision for Chrome, Safari, Android, Roku, tvOS. No
   query parameter changes it; all of them were bisected first.
   Chrome is the honest choice of the ones that work — this IS Chromium 53
   under WAM — while product, device and model still say what it really is. */
const PLATFORM = 'Chrome';
const PLATFORM_VERSION = '53.0';
const DEVICE = 'LG OLED B8';

/* Two kinds of token, not interchangeable. The account token is for plex.tv;
   each server hands out its own via /api/v2/resources. A server you do not own
   rejects the account token with 401, which is the case here. */
export const state: { clientId: string | null; token: string | null } = {
  clientId: null,
  token: null,
};

export function local(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
  return null;
}

export function uuid(): string {
  let out = '';
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) out += '-';
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

function headers(): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Plex-Product': PRODUCT,
    'X-Plex-Version': VERSION,
    'X-Plex-Client-Identifier': state.clientId ?? '',
    'X-Plex-Platform': PLATFORM,
    'X-Plex-Platform-Version': PLATFORM_VERSION,
    'X-Plex-Device': DEVICE,
    'X-Plex-Device-Name': 'Reflex (B8)',
    'X-Plex-Model': 'OLED55B8',
    'X-Plex-Device-Screen-Resolution': '1920x1080,3840x2160',
  };
}

/* The declared profile is 500 characters of constant noise. Anything reaching
   a screen or a log is more use without it. */
function tidy(url: string): string {
  return String(url).replace(/X-Plex-Client-Profile-Extra=[^&]*/, 'X-Plex-Client-Profile-Extra=…');
}

/* Plex says why it refused, in the body. Reporting a bare status is how a 400
   becomes unexplainable. */
function why(xhr: XMLHttpRequest): string {
  let body = '';
  try {
    body = xhr.responseText || '';
  } catch {
    return '';
  }
  if (!body) return '';
  const found =
    /status="([^"]+)"/.exec(body) ?? // <Response status="..."/>
    /"status"\s*:\s*"([^"]+)"/.exec(body);
  if (found?.[1]) return `  ·  ${found[1]}`;
  return `  ·  ${body.replace(/\s+/g, ' ').substring(0, 220)}`;
}

export interface AskOptions {
  timeout?: number;
  body?: string | null;
  /** The token to send, or false for none. */
  token?: string | false;
}

/* A body that is not JSON is an answer here, not a failure: several endpoints
   reply in plain text. */
export function request(method: string, url: string, options: AskOptions = {}): Promise<unknown> {
  const sending = headers();
  if (options.token) sending['X-Plex-Token'] = options.token;
  return httpRequest(url, {
    method,
    headers: sending,
    timeout: options.timeout,
    body: options.body,
    text: true,
    label: `${method} ${tidy(url)}`,
    explain: why,
  });
}

/** plex.tv, which uses the account token. */
export function plexTv(method: string, path: string, options: AskOptions = {}): Promise<unknown> {
  const token = options.token === undefined ? (state.token ?? false) : options.token;
  return request(method, PLEX_TV + path, { ...options, token });
}

/** A media server, which uses its own token. */
export function ask(server: PlexServer, path: string, options: AskOptions = {}): Promise<unknown> {
  return request('GET', server.base + path, { ...options, token: server.token });
}

export { queryString };

export function init(): void {
  state.clientId = local('clientId');
  if (!state.clientId) {
    state.clientId = uuid();
    local('clientId', state.clientId);
  }
  state.token = local('token');
  Servers.load();
}

export function hasToken(): boolean {
  return !!state.token;
}
