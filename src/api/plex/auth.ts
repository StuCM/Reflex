/* The plex.tv/link PIN flow. */
import { local, plexTv, state } from './client';

interface Pin {
  id: number;
  code: string;
  authToken?: string;
}

/* No strong=true — that returns a long PIN for the auth-URL flow, and
   plex.tv/link only accepts the plain 4-character code. */
export function linkStart(): Promise<Pin> {
  return plexTv('POST', '/api/v2/pins', { token: false }) as Promise<Pin>;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/* Resolves with a token once the code is entered, or null if the pin expired.
   A failed poll is reported and retried rather than thrown: one network blip
   must not throw the user back to a fresh code. */
export function linkPoll(
  pinId: number,
  deadline: number,
  onStatus?: (message: string) => void,
): Promise<string | null> {
  let tries = 0;

  function attempt(): Promise<string | null> {
    tries++;
    return (plexTv('GET', `/api/v2/pins/${pinId}`, { token: false }) as Promise<Pin>).then(
      (pin) => {
        if (pin?.authToken) {
          state.token = pin.authToken;
          local('token', state.token);
          onStatus?.('linked, token stored');
          return state.token;
        }
        onStatus?.(`pin ${pinId} · poll ${tries} · not claimed yet`);
        if (Date.now() > deadline) return null;
        return wait(2000).then(attempt);
      },
      (error: Error) => {
        onStatus?.(`pin ${pinId} · poll ${tries} FAILED: ${error.message}`);
        if (Date.now() > deadline) return null;
        return wait(3000).then(attempt);
      },
    );
  }
  return attempt();
}

/* A 401 from a media server says nothing about the plex.tv login — drop the
   server list and rediscover rather than making the user link again. */
export function forgetServers(): void {
  Servers.forget();
}

export function signOut(): void {
  state.token = null;
  local('token', null);
  Servers.forget();
}
