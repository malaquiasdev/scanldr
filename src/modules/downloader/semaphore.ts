export interface Semaphore {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
}

export function createSemaphore(limit: number): Semaphore {
  const queue: Array<() => void> = [];
  let running = 0;

  function acquire(): Promise<void> {
    if (running < limit) {
      running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => queue.push(resolve));
  }

  function release(): void {
    running--;
    const next = queue.shift();
    if (next) {
      running++;
      next();
    }
  }

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return { run };
}
