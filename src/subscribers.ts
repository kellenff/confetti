import type {
  ConfigDiff,
  ErrorHandler,
  ReloadHandler,
  SourceName,
  Unwatch,
} from "./types.js";

/**
 * Holds onChange + onError handler arrays and dispatches in registration order.
 *
 * - `notifyChange` awaits each handler sequentially. Handler errors are
 *   routed to onError (with source='merged') and do NOT halt the loop.
 * - `notifyError` calls each handler synchronously. Handler errors are
 *   silently swallowed (last-resort: must never loop or escalate).
 */
export class Subscribers<T> {
  #change: Array<ReloadHandler> = [];
  #error: Array<ErrorHandler> = [];

  onChange(handler: ReloadHandler): Unwatch {
    this.#change.push(handler);
    return () => {
      const i = this.#change.indexOf(handler);
      if (i !== -1) this.#change.splice(i, 1);
    };
  }

  onError(handler: ErrorHandler): Unwatch {
    this.#error.push(handler);
    return () => {
      const i = this.#error.indexOf(handler);
      if (i !== -1) this.#error.splice(i, 1);
    };
  }

  /**
   * Dispatch a successful reload to every onChange handler in registration
   * order. Awaits each. Handler throws (sync or async) are routed to
   * `notifyError(err, 'merged')`; subsequent handlers still run.
   *
   * Snapshot the handler array so unsubscribe-during-dispatch and
   * register-during-dispatch don't disturb the in-flight loop.
   */
  async notifyChange(next: T, configDiff: ConfigDiff): Promise<void> {
    const handlers = [...this.#change];
    for (const h of handlers) {
      try {
        await h(next, configDiff);
      } catch (err) {
        this.notifyError(err, "merged");
      }
    }
  }

  /**
   * Dispatch an error to every onError handler in registration order.
   * Synchronous. Handler throws are silently swallowed.
   */
  notifyError(err: unknown, source: SourceName): void {
    const handlers = [...this.#error];
    for (const h of handlers) {
      try {
        h(err, source);
      } catch {
        // intentional: onError-throws must not loop or escalate.
      }
    }
  }

  /** Drop every change + error handler. Used by Config.close(). */
  clear(): void {
    this.#change = [];
    this.#error = [];
  }
}
