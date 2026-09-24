/** The part of `BroadcastChannel` the stores use (tests inject in-memory channels). */
export interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** Creates a channel by name, or null when multi-tab messaging is unavailable or disabled. */
export type ChannelFactory = (name: string) => ChannelLike | null;

/** `BroadcastChannel` where the platform has one (every current browser, Node, workers). */
export const browserChannel: ChannelFactory = (name) => {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    const channel = new BroadcastChannel(name);
    return channel as unknown as ChannelLike;
  } catch {
    return null;
  }
};

/** A random ID for one store instance, so a tab can recognise its own messages. */
export function instanceId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(36).padStart(2, '0')).join('');
}
