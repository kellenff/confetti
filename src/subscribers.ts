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
 * - Errors that arrive before any onError handler is registered are
 *   buffered and replayed when the first handler attaches. This protects
 *   against the timing race where source.watch fails asynchronously
 *   during defineConfig before the caller can register onError. After
 *   the first handler attaches the buffer is drained and disabled.
 */
export class Subscribers {
  #change: Array<ReloadHandler> = [];
  #error: Array<ErrorHandler> = [];
  #pendingErrors: Array<{ err: unknown; source: SourceName }> = [];
  #drained = false;

  onChange(handler: ReloadHandler): Unwatch {
    this.#change.push(handler);
    return () => {
      const i = this.#change.indexOf(handler);
      if (i !== -1) this.#change.splice(i, 1);
    };
  }

  onError(handler: ErrorHandler): Unwatch {
    this.#error.push(handler);
    if (!this.#drained && this.#pendingErrors.length > 0) {
      this.#drained = true;
      const buffered = this.#pendingErrors;
      this.#pendingErrors = [];
      for (const { err, source } of buffered) {
        try {
          handler(err, source);
        } catch {
          // intentional: onError-throws must not loop or escalate.
        }
      }
    } else {
      this.#drained = true;
    }
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
  async notifyChange(next: unknown, configDiff: ConfigDiff): Promise<void> {
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
    if (!this.#drained) {
      this.#pendingErrors.push({ err, source });
      return;
    }
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
    this.#pendingErrors = [];
    // Stay 'drained' after close — post-close errors should be dropped,
    // not buffered for a hypothetical future onError that won't come.
    this.#drained = true;
  }
}
