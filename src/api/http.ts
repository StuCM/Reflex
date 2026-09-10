/* One XHR, for every client that talks to something.
 *
 * Plex, TMDB and YouTube each grew their own copy of the same forty lines —
 * open, timeout, status check, parse, three error paths — and the copies had
 * started to drift. They differ in three things only, and those are the
 * options: the headers to send, the name to put in an error, and whether a body
 * that is not JSON is an answer or a failure.
 *
 * No fetch(): Chromium 53 has it, but not with the timeout this needs, and a
 * request to a server on the other side of the country that never returns is
 * worse than one that fails.
 */

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  timeout?: number;
  body?: string | null;
  /** What an error calls this. Defaults to the url. */
  label?: string;
  /** Resolve a non-JSON body instead of rejecting. */
  text?: boolean;
  /** Add the server's own reason to a failure. */
  explain?: (xhr: XMLHttpRequest) => string;
}

/* Encode an object as a query string, dropping anything null or undefined —
   Plex reads an empty parameter as a value, not as an omission. */
export function queryString(
  parameters: Record<string, string | number | boolean | null | undefined>,
): string {
  return Object.keys(parameters)
    .filter((key) => parameters[key] !== null && parameters[key] !== undefined)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(parameters[key]))}`)
    .join('&');
}

const DEFAULT_TIMEOUT = 15000;

export function request(url: string, options: RequestOptions = {}): Promise<unknown> {
  const label = options.label ?? url;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method ?? 'GET', url, true);
    xhr.timeout = options.timeout ?? DEFAULT_TIMEOUT;

    const headers = options.headers ?? {};
    Object.keys(headers).forEach((name) => {
      xhr.setRequestHeader(name, headers[name] as string);
    });

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new Error(`${label} -> ${xhr.status}${options.explain ? options.explain(xhr) : ''}`),
        );
        return;
      }
      if (!xhr.responseText) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        if (options.text) resolve(xhr.responseText);
        else reject(new Error(`${label} bad json`));
      }
    };
    xhr.ontimeout = () => {
      reject(new Error(`${label} timeout`));
    };
    xhr.onerror = () => {
      reject(new Error(`${label} network`));
    };
    xhr.send(options.body ?? null);
  });
}
