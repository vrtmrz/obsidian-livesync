export declare function resolveWithIgnoreKnownError<T>(p: Promise<T>, def: T): Promise<T>;
export declare const Parallels: (ps?: Set<Promise<unknown>>) => {
    add: (p: Promise<unknown>) => Set<Promise<unknown>>;
    wait: (limit: number) => false | Promise<unknown>;
    all: () => Promise<unknown[]>;
};
export declare function allSettledWithConcurrencyLimit<T>(processes: Promise<T>[], limit: number): Promise<void>;
export declare const globalConcurrencyController: import("octagonal-wheels/concurrency/semaphore_v2").SemaphoreObject;
export declare function wrapException<T>(func: () => Promise<Awaited<T>>): Promise<Awaited<T> | Error>;
export declare function wrapByDefault<T, U>(func: () => T, onError: (err: Error) => U): T | U;
