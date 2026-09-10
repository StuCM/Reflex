/* Chromium 53 has neither `replaceChildren` (Chrome 86) nor `append`
   (Chrome 54). Everything that builds nodes goes through here so there is one
   place to be wrong about that, and `no-restricted-properties` keeps the two
   out of the rest of the tree. */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function div(className: string, text?: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function span(className: string, text?: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

type Child = Node | string | null | undefined;

/** Replaces everything in `host`. */
export function fill(host: Element, ...children: Child[]): void {
  while (host.firstChild) host.removeChild(host.firstChild);
  put(host, ...children);
}

/** Appends. A string becomes a text node; a null is skipped, so a caller can
    inline a condition. */
export function put(host: Element, ...children: Child[]): void {
  children.forEach((child) => {
    if (child === null || child === undefined) return;
    host.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
}

/** The element `index.html` promises, or a loud failure at boot. */
export function must(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no #${id}`);
  return element;
}

/** A static markup string as a node. Author-written SVG only — there is no
    escaping here, which is why nothing interpolates into it.

    The xmlns is added rather than required of the caller: parsed as XML
    without one, `<svg>` lands in no namespace, so it is not an SVGElement and
    paints nothing at all — while still reading correctly as text. */
export function svg(markup: string): Element {
  const namespaced = markup.replace('<svg', `<svg xmlns="${SVG_NS}"`);
  const parsed = new DOMParser().parseFromString(namespaced, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.namespaceURI !== SVG_NS) throw new Error(`not SVG: ${markup.slice(0, 40)}`);
  return document.importNode(root, true);
}
