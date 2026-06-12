export interface MiddlewareContext<TResult> {
    next: () => Promise<TResult>;
    state: Record<string, unknown>;
}
type TargetFunc<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>;
type MiddlewareFunc<TArgs extends unknown[], TResult> = (ctx: MiddlewareContext<TResult>, ...args: TArgs) => Promise<TResult>;
export declare class MiddlewareManager<TArgs extends unknown[], TResult> {
    private middlewares;
    private _indexCounter;
    private _isMiddlewareDirty;
    use(priority: number, func: MiddlewareFunc<TArgs, TResult>): () => void;
    setFinal(func: TargetFunc<TArgs, TResult>): void;
    private sortMiddlewares;
    protected onStepRunOut: (...args: TArgs) => Promise<TResult>;
    private composed;
    private compose;
    invoke(...args: TArgs): Promise<TResult>;
}
type FunctionKeys<T> = {
    [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never; // eslint-disable-line @typescript-eslint/no-explicit-any
}[keyof T];
export declare function middlewares<T extends Record<keyof T, (...args: any[]) => any>>(): { // eslint-disable-line @typescript-eslint/no-explicit-any
    useMiddleware<K extends FunctionKeys<T>>(key: K): {
        use: (priority: number, func: MiddlewareFunc<Parameters<T[K]>, Awaited<ReturnType<T[K]>>>) => () => void;
        invoke: (...args: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>>;
        setFinal: (func: TargetFunc<Parameters<T[K]>, Awaited<ReturnType<T[K]>>>) => void;
    };
};
export {};
