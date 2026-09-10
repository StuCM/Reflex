/* What the build and the dev harness put around the app. */

interface ImportMetaEnv {
  readonly VITE_TMDB_KEY?: string;
  readonly VITE_YOUTUBE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /* The dev server injects this before the app runs — see dev/server.js. It is
     the only seam the app needs to talk to a fake server instead of a real one. */
  REFLEX_CONFIG?: Record<string, unknown>;
  /* webOS is injected by the TV's WAM runtime and absent on the laptop, which
     is why every use of it is guarded. */
  webOS?: { platform?: { tv?: boolean } };
}
