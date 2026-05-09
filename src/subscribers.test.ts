import { describe, expect, it, vi } from "vitest";
import { Subscribers } from "./subscribers.js";

describe("Subscribers.onChange", () => {
  it("invokes handlers in registration order", async () => {
    const subs = new Subscribers<{ v: number }>();
    const order: string[] = [];
    subs.onChange(() => {
      order.push("a");
    });
    subs.onChange(() => {
      order.push("b");
    });
    subs.onChange(() => {
      order.push("c");
    });
    await subs.notifyChange({ v: 1 }, []);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("awaits async handlers sequentially", async () => {
    const subs = new Subscribers<number>();
    const events: string[] = [];
    subs.onChange(async () => {
      events.push("a-start");
      await Promise.resolve();
      events.push("a-end");
    });
    subs.onChange(() => {
      events.push("b");
    });
    await subs.notifyChange(1, []);
    expect(events).toEqual(["a-start", "a-end", "b"]);
  });

  it("routes a handler throw to onError(err, 'merged') and continues with subsequent handlers", async () => {
    const subs = new Subscribers<number>();
    const seen: unknown[] = [];
    const errs: Array<{ err: unknown; source: string }> = [];
    subs.onError((err, source) => {
      errs.push({ err, source });
    });
    subs.onChange(() => {
      throw new Error("boom-sync");
    });
    subs.onChange(() => {
      seen.push("ran");
    });
    await subs.notifyChange(1, []);
    expect(seen).toEqual(["ran"]);
    expect(errs.length).toBe(1);
    const first = errs[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.source).toBe("merged");
    expect((first.err as Error).message).toBe("boom-sync");
  });

  it("routes an async handler rejection to onError and continues", async () => {
    const subs = new Subscribers<number>();
    const seen: string[] = [];
    const errs: unknown[] = [];
    subs.onError((err) => {
      errs.push(err);
    });
    subs.onChange(async () => {
      throw new Error("boom-async");
    });
    subs.onChange(() => {
      seen.push("after");
    });
    await subs.notifyChange(1, []);
    expect(seen).toEqual(["after"]);
    expect((errs[0] as Error).message).toBe("boom-async");
  });

  it("unsubscribe removes the handler", async () => {
    const subs = new Subscribers<number>();
    const a = vi.fn();
    const b = vi.fn();
    const unA = subs.onChange(a);
    subs.onChange(b);
    unA();
    await subs.notifyChange(1, []);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("snapshots the handler list so unsubscribe-during-dispatch is safe", async () => {
    const subs = new Subscribers<number>();
    const calls: string[] = [];
    let unB: () => void = () => {};
    subs.onChange(() => {
      calls.push("a");
      unB();
    });
    unB = subs.onChange(() => {
      calls.push("b");
    });
    subs.onChange(() => {
      calls.push("c");
    });
    await subs.notifyChange(1, []);
    // 'b' still runs in this dispatch (snapshot taken at start), but is
    // gone for subsequent dispatches.
    expect(calls).toEqual(["a", "b", "c"]);
    calls.length = 0;
    await subs.notifyChange(1, []);
    expect(calls).toEqual(["a", "c"]);
  });
});

describe("Subscribers.onError", () => {
  it("invokes handlers in registration order", () => {
    const subs = new Subscribers<number>();
    const order: string[] = [];
    subs.onError(() => {
      order.push("a");
    });
    subs.onError(() => {
      order.push("b");
    });
    subs.notifyError(new Error("x"), "merged");
    expect(order).toEqual(["a", "b"]);
  });

  it("silently swallows onError handler throws (does not loop or escalate)", () => {
    const subs = new Subscribers<number>();
    const seen: string[] = [];
    subs.onError(() => {
      throw new Error("inner-onError-throw");
    });
    subs.onError(() => {
      seen.push("after");
    });
    expect(() => subs.notifyError(new Error("orig"), "merged")).not.toThrow();
    expect(seen).toEqual(["after"]);
  });

  it("unsubscribe removes the error handler", () => {
    const subs = new Subscribers<number>();
    const a = vi.fn();
    const b = vi.fn();
    const unA = subs.onError(a);
    subs.onError(b);
    unA();
    subs.notifyError(new Error("x"), "merged");
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("Subscribers.clear", () => {
  it("drops all change + error handlers", async () => {
    const subs = new Subscribers<number>();
    const change = vi.fn();
    const err = vi.fn();
    subs.onChange(change);
    subs.onError(err);
    subs.clear();
    await subs.notifyChange(1, []);
    subs.notifyError(new Error("x"), "merged");
    expect(change).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
});
