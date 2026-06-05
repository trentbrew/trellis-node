/**
 * Trellis Reactive Primitives
 *
 * Framework-agnostic signals for building reactive UIs on top of
 * TrellisClient. Inspired by Svelte 5 runes and the react-runes
 * experiment, but stripped of any framework dependency.
 *
 * Use with React via the `react-runes` $ hook, or with Svelte 5
 * by wrapping signals in $state/$derived.
 */

/** Simple mutable reactive value. */
export class Signal<T> {
  private _value: T;
  private _subs = new Set<(v: T) => void>();

  constructor(initial: T) {
    this._value = initial;
  }

  get value(): T {
    return this._value;
  }

  set value(v: T) {
    if (Object.is(this._value, v)) return;
    this._value = v;
    for (const fn of this._subs) {
      try {
        fn(v);
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  /** Subscribe to changes. Immediately called with current value. */
  subscribe(fn: (v: T) => void): () => void {
    this._subs.add(fn);
    try {
      fn(this._value);
    } catch {
      /* ignore */
    }
    return () => {
      this._subs.delete(fn);
    };
  }

  /** Read without tracking. */
  peek(): T {
    return this._value;
  }

  /** Whether any subscriber is registered. */
  hasSubscribers(): boolean {
    return this._subs.size > 0;
  }
}

/** Throttled signal that batches rapid updates via requestAnimationFrame. */
export class BatchSignal<T> extends Signal<T> {
  private _raf: number | null = null;

  constructor(initial: T) {
    super(initial);
  }

  override set value(v: T) {
    if (Object.is(this.peek(), v)) return;
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      super.value = v;
    });
  }
}
