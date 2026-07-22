export interface MapWithConcurrencyLimitResult<TResult> {
  results: TResult[];
  aborted: boolean;
}

export interface MapWithConcurrencyLimitOptions {
  concurrency?: number;
  signal?: AbortSignal;
}

/**
 * Keyed serial queue: tasks sharing a key run strictly one-after-another while
 * different keys stay fully parallel. Used to serialize agent runs per chat
 * scope — concurrent runs against the same project raced on the durable Pi
 * session file and on chat.json's read-modify-write (last writer wins).
 */
export function createKeyedSerialQueue(): <T>(key: string, run: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return function enqueue<T>(key: string, run: () => Promise<T>): Promise<T> {
    const tail = tails.get(key) ?? Promise.resolve();
    // A rejected predecessor must not poison the queue: run either way.
    const next = tail.then(run, run);
    tails.set(key, next);
    const cleanup = (): void => {
      if (tails.get(key) === next) tails.delete(key);
    };
    next.then(cleanup, cleanup);
    return next;
  };
}

export async function mapWithConcurrencyLimit<TItem, TResult>(
  items: readonly TItem[],
  mapper: (item: TItem, index: number, signal?: AbortSignal) => Promise<TResult>,
  options: MapWithConcurrencyLimitOptions = {},
): Promise<MapWithConcurrencyLimitResult<TResult>> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  let aborted = Boolean(options.signal?.aborted);

  async function worker(): Promise<void> {
    while (!aborted) {
      if (options.signal?.aborted) {
        aborted = true;
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index, options.signal);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return {
    results: results.filter((_, index) => Object.prototype.hasOwnProperty.call(results, index)),
    aborted,
  };
}
