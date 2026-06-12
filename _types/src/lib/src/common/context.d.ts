declare class Context<T extends Record<string | number | symbol, any> = object> { // eslint-disable-line @typescript-eslint/no-explicit-any
    _data: Partial<T>;
    children: WeakRef<Context<T>>[];
    parent?: Context<T>;
    constructor(base?: Context<T>, data?: Partial<T>);
    set<V extends keyof T>(key: V, value: T[V]): void;
    get<V extends keyof T>(key: V): T[V] | undefined;
    setInGlobalContext<V extends keyof T>(key: V, value: T[V]): void;
    setInNearestContext<V extends keyof T>(key: V, value: T[V]): void;
    spawnContext<V extends Record<string, any>>(data?: V): Context<V & T>; // eslint-disable-line @typescript-eslint/no-explicit-any
    _disposeChild(child: Context<any>): void; // eslint-disable-line @typescript-eslint/no-explicit-any
    dispose(): void;
}
export declare function getContext<T extends U, U extends Record<string, any> = object>(data?: T): Context<T & object>; // eslint-disable-line @typescript-eslint/no-explicit-any
export declare function getIndependentContext<T extends U, U extends Record<string, any> = object>(data?: T): Context<T>; // eslint-disable-line @typescript-eslint/no-explicit-any
export {};
