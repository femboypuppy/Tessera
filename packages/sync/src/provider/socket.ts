import { HocuspocusProviderWebsocket } from '@hocuspocus/provider';

/**
 * Hocuspocus's shared WebSocket, without its zombie reconnects.
 *
 * When a connection drops, Hocuspocus schedules `setTimeout(() => this.connect())`, and
 * `connect()` sets `shouldConnect` back to true. A socket that is destroyed (the workspace was
 * closed, or the person signed out) or disconnected on purpose (the browser went offline) before
 * that timer fires would reconnect anyway and then retry forever. This socket connects only while
 * it is wanted: after `disconnect()` or `destroy()`, only `resume()` connects it again.
 */
export class SyncSocket extends HocuspocusProviderWebsocket {
  // Read before these fields are initialized (the base constructor may connect): undefined means
  // neither paused nor destroyed.
  private paused?: boolean;
  private destroyed?: boolean;

  override connect(): Promise<unknown> {
    if (this.paused || this.destroyed) return Promise.resolve();
    return super.connect();
  }

  /** Connects again after `disconnect()`. */
  resume(): Promise<unknown> {
    if (this.destroyed) return Promise.resolve();
    this.paused = false;
    // After a quick offline/online flip the old socket may not have reported its close yet:
    // `connect()` then sees it as connected and does nothing, so the close handler reconnects.
    this.shouldConnect = true;
    return super.connect();
  }

  override disconnect(): void {
    this.paused = true;
    super.disconnect();
  }

  override destroy(): void {
    this.destroyed = true;
    super.destroy();
  }
}
