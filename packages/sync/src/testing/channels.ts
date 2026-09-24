import type { ChannelFactory, ChannelLike } from '../idb/channel';

/**
 * In-memory `BroadcastChannel`s for tests: channels with the same name created from one hub
 * behave like tabs of one browser (asynchronous delivery, never to the sender, structured-cloned
 * messages).
 */
export function createChannelHub(): ChannelFactory & { pending(): Promise<void> } {
  const byName = new Map<string, Set<ChannelLike>>();
  let inFlight = 0;
  let idle: Array<() => void> = [];
  const settle = () => {
    if (inFlight === 0) {
      const waiting = idle;
      idle = [];
      for (const resolve of waiting) resolve();
    }
  };
  const factory = ((name: string) => {
    const channel: ChannelLike = {
      onmessage: null,
      postMessage(message: unknown) {
        const copy = structuredClone(message);
        for (const other of byName.get(name) ?? []) {
          if (other === channel) continue;
          inFlight += 1;
          setTimeout(() => {
            inFlight -= 1;
            other.onmessage?.({ data: copy });
            settle();
          }, 0);
        }
      },
      close() {
        byName.get(name)?.delete(channel);
      },
    };
    let set = byName.get(name);
    if (!set) {
      set = new Set();
      byName.set(name, set);
    }
    set.add(channel);
    return channel;
  }) as ChannelFactory & { pending(): Promise<void> };
  /** Resolves once every message posted so far has been delivered. */
  factory.pending = () =>
    new Promise<void>((resolve) => {
      if (inFlight === 0) resolve();
      else idle.push(resolve);
    });
  return factory;
}
