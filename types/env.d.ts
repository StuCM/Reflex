/* What the app runs inside, beyond what lib.dom already describes.

   webOS is injected by the TV's WAM runtime and is simply absent on the
   laptop, which is why every use of it in js/ is guarded. REFLEX_CONFIG is the
   seam the dev harness injects settings through — see js/core/config.js. */
interface Window {
  webOS?: {
    platform?: { tv?: boolean };
    deviceInfo?: (cb: (info: Record<string, unknown>) => void) => void;
    service?: { request: (uri: string, opts: Record<string, unknown>) => void };
  };
  REFLEX_CONFIG?: Record<string, unknown>;
}
