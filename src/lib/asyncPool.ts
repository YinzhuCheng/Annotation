export async function asyncPool<T, R>(items: T[], limit: number, iterator: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  const concurrency = Math.max(1, Math.floor(limit) || 1);
  const results: R[] = new Array(items.length);
  let index = 0;
  const executing = new Set<Promise<void>>();

  const enqueue = (): Promise<void> => {
    if (index >= items.length) {
      return Promise.resolve();
    }
    const currentIndex = index;
    index += 1;
    let promiseWrapper: Promise<void>;
    const promise = Promise.resolve(iterator(items[currentIndex], currentIndex))
      .then((value) => {
        results[currentIndex] = value;
      })
      .finally(() => {
        executing.delete(promiseWrapper);
      });
    promiseWrapper = promise.then(() => undefined);
    executing.add(promiseWrapper);

    let next: Promise<void> | undefined;
    if (executing.size >= concurrency) {
      next = Promise.race(executing);
    }
    return (next || Promise.resolve()).then(() => enqueue());
  };

  const starters = Array.from({ length: Math.min(concurrency, items.length) }, () => enqueue());
  await Promise.all(starters);
  return results;
}
