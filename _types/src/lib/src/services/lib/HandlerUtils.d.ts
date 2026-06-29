// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
/**
 * A function type that can be used as a handler.
 */
type HandlerFunc<TArg extends unknown[], TResult> = (...args: TArg) => TResult | Promise<TResult>;
/**
 * A function type that returns a boolean or a Promise of boolean.
 */
type BooleanHandlerFunc<TArg extends unknown[], U = boolean> = (...args: TArg) => U | Promise<U>;
/**
 * An interface for invokable handlers that can add and remove handler functions.
 */
export interface InvokableHandler<T extends unknown[], U> {
    /**
     * Invokes the handler with the provided arguments.
     * @param args The arguments to pass to the handler.
     * @returns A Promise that resolves to the result of the handler.
     */
    invoke(...args: T): Promise<U>;
}
/**
 * An interface for invokable boolean handlers that can add and remove handler functions.
 */
type InvokableBooleanHandler<T extends unknown[]> = InvokableHandler<T, boolean>;
/**
 * A function type that can be used to unregister a handler.
 */
export type UnregisterFunction = () => void;
/**
 * An interface for binder handlers that can assign a single handler function.
 */
export interface BinderHandler<T extends unknown[], U> {
    assign(callback: HandlerFunc<T, U>, override?: boolean): UnregisterFunction;
}
/**
 * An interface for multi-binder handlers that can add and remove handler functions.
 */
export interface MultiRegisterHandler<T extends unknown[], U> {
    /**
     * Adds a handler function.
     * Note: The same function only added once.
     * If you want to prevent duplication, please remove the existing handler before adding it again.
     * @param callback The handler function to add.
     * @returns A function to remove the added handler.
     */
    addHandler(callback: BooleanHandlerFunc<T, U>): UnregisterFunction;
    /**
     * Removes a handler function.
     * @param callback The handler function to remove.
     */
    removeHandler(callback: BooleanHandlerFunc<T, U>): void;
    use(callback: BooleanHandlerFunc<T, U>): UnregisterFunction;
}
/**
 * An interface for dispatch handlers that can dispatch events to multiple handlers.
 */
export interface DispatcherHandler<T extends unknown[], U> {
    dispatch(...args: T): Promise<(Awaited<U> | Error)[]>;
}
/**
 * An interface for dispatch handlers that can add and remove handler functions.
 */
export interface DispatchHandler<T extends unknown[], U> extends DispatcherHandler<T, U>, MultiRegisterHandler<T, U> { // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface -- Empty interface
}
/**
 * A binder that allows assigning and invoking a single handler function.
 */
export declare class Binder<T extends (...args: any[]) => any> implements BinderHandler<Parameters<T>, ReturnType<T>>, InvokableHandler<Parameters<T>, ReturnType<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    private _name;
    /**
     * Creates a new Binder instance.
     * @param name  The name of the handler.
     * @param initialCallback An optional initial callback function to assign.
     */
    constructor(name: string, initialCallback?: T);
    private _callback;
    /**
     * Assigns a new handler function.
     * @param callback The new handler function to assign.
     */
    assign(callback: T, override?: boolean): () => void;
    /**
     * Invokes the assigned handler function with the provided arguments.
     * @param args  The arguments to pass to the handler function.
     * @returns The result of the handler function.
     */
    invoke(...args: Parameters<T>): ReturnType<T>;
}
/**
 * A binder that allows assigning and invoking a single handler function asynchronously.
 * The invocation will wait until a handler is assigned.
 */
export declare class LazyBinder<T extends (...args: any[]) => any> implements BinderHandler<Parameters<T>, ReturnType<T>>, InvokableHandler<Parameters<T>, Promise<Awaited<ReturnType<T>>>> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    private _name;
    private _callbackPromise;
    private _callback;
    /**
     * Creates a new LazyBinder instance.
     * @param name  The name of the handler.
     * @param initialCallback An optional initial callback function to assign.
     */
    constructor(name: string, initialCallback?: T);
    assign(callback: T, override?: boolean): () => void;
    /**
     * Invokes the assigned handler function with the provided arguments.
     * @param args The arguments to pass to the handler function.
     * @returns The result of the handler function.
     */
    invoke(...args: Parameters<T>): Promise<Awaited<ReturnType<T>>>;
}
/**
 * A multi-binder that allows adding and removing multiple handler functions.
 */
export declare class MultiBinder<T extends (...args: any[]) => any> implements MultiRegisterHandler<Parameters<T>, ReturnType<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    protected _name: string;
    /**
     * Creates a new MultiBinder instance.
     * @param name  The name of the handler.
     */
    constructor(name: string);
    protected _callbackMap: Map<T, [number, number]>;
    protected _isCallbackDirty: boolean;
    protected _maxUsedPriority: number;
    /**
     * Adds a handler function.
     * Note: The same function is only added once.
     * @param callback The handler function to add.
     * @param priority The priority of the handler, Do not use floating numbers to prevent confusion.
     * @returns A function to unregister the added handler.
     *
     */
    addHandler(callback: T, priority?: number, allowSwap?: boolean): UnregisterFunction;
    /**
     * Removes a handler function.
     * @param callback The handler function to remove.
     */
    removeHandler(callback: T): void;
    /**
     * Adds a handler function (alias of addHandler, but more semantic).
     * @param callback
     * @returns
     */
    use(callback: T, priority?: number): UnregisterFunction;
    _sortedCallbacks: T[];
    protected get _callbacks(): T[];
}
/**
 * A dispatcher that invokes all added handler functions sequentially and collects their results.
 * */
export declare class Dispatch<T extends unknown[], U> extends MultiBinder<HandlerFunc<T, U>> implements DispatcherHandler<T, U> {
    /**
     * Dispatches the event to all registered handlers sequentially.
     * @param args The arguments to pass to the handlers.
     * @returns An array of results or errors from each handler.
     */
    dispatch(...args: T): Promise<(Awaited<U> | Error)[]>;
}
/**
 * A dispatcher that invokes all added handler functions in parallel and collects their results.
 */
export declare class DispatchParallel<T extends unknown[], U> extends MultiBinder<HandlerFunc<T, U>> implements DispatcherHandler<T, U> {
    /**
     * Dispatches the event to all registered handlers in parallel.
     * @param args The arguments to pass to the handlers.
     * @returns An array of results or errors from each handler.
     */
    dispatch(...args: T): Promise<(Awaited<U> | Error)[]>;
}
/**
 * A base class for boolean handlers that can add and remove handler functions.
 */
export declare abstract class BooleanHandlerBase<T extends unknown[], U = boolean> extends MultiBinder<BooleanHandlerFunc<T, U>> implements InvokableBooleanHandler<T> {
    abstract invoke(...args: T): Promise<boolean>;
}
/**
 * A handler that invokes all added handler functions sequentially until one returns false.
 */
export declare class AllHandler<T extends unknown[]> extends BooleanHandlerBase<T> {
    /**
     * Invoke all handlers sequentially until one returns false.
     * @param args The arguments to pass to the handlers.
     * @returns A Promise that resolves to true if all handlers return true, otherwise false.
     */
    invoke(...args: T): Promise<boolean>;
}
/**
 * A handler that invokes all added handler functions in parallel and returns true only if all return true.
 */
export declare class ParallelAllHandler<T extends unknown[]> extends BooleanHandlerBase<T> {
    /**
     * Invoke all handlers in parallel
     * @param args The arguments to pass to the handlers.
     * @returns True if all handlers return true, otherwise false.
     */
    invoke(...args: T): Promise<boolean>;
}
/**
 * A handler that invokes all added handler functions sequentially until one returns true.
 */
export declare class AnySuccessHandler<T extends unknown[]> extends BooleanHandlerBase<T> {
    /**
     * Invokes handlers sequentially until one returns true.
     * @param args The arguments to pass to the handlers.
     * @returns True if any handler returns true, otherwise false.
     */
    invoke(...args: T): Promise<boolean>;
}
/**
 * A handler that invokes all added handler functions sequentially until one returns a non-falsy value.
 */
export declare class FirstResultHandler<T extends unknown[], U> extends MultiBinder<BooleanHandlerFunc<T, U>> {
    /**
     * Invokes handlers sequentially until one returns a non-falsy value.
     * @param args The arguments to pass to the handlers.
     * @returns The first non-falsy result from the handlers, or false if none found.
     */
    invoke(...args: T): Promise<U | false>;
}
/**
 * A function type that can be used as a handler with assignable functionality.
 */
export interface HandlerFunction<TFunc extends (...args: any[]) => U | Promise<U>, U = unknown> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /**
     * Invokes the handler function with the provided arguments.
     */
    (...args: Parameters<TFunc>): ReturnType<TFunc>;
    /**
     * Assigns a new handler function.
     * @param callback The new handler function to assign.
     * @param override Whether to override the existing handler if one is already assigned.
     * @returns A function to unregister the assigned handler.
     */
    setHandler: (callback: TFunc, override?: boolean) => void;
}
/**
 * A function type that can be used as a handler with assignable functionality.
 */
export interface LazyHandlerFunction<TFunc extends (...args: any[]) => U | Promise<U>, U = unknown> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /**
     * Invokes the handler function with the provided arguments.
     */
    (...args: Parameters<TFunc>): Promise<Awaited<ReturnType<TFunc>>>;
    /**
     * Assigns a new handler function.
     * @param callback The new handler function to assign.
     * @param override Whether to override the existing handler if one is already assigned.
     * @returns A function to unregister the assigned handler.
     */
    setHandler: (callback: TFunc, override?: boolean) => void;
}
/**
 * A function type that can be used as a multiple handler with add/remove functionality.
 */
export interface MultipleHandlerFunction<TFunc extends (...args: any[]) => U | Promise<U>, U = unknown> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /**
     * Invokes the handler function with the provided arguments.
     */
    (...args: Parameters<TFunc>): ReturnType<TFunc>;
    /**
     * Adds a handler function.
     * @param callback The handler function to add.
     * @returns A function to remove the added handler.
     */
    addHandler: (callback: TFunc) => () => void;
    /**
     * Removes a handler function.
     * @param callback The handler function to remove.
     * @returns
     */
    removeHandler: (callback: TFunc) => void;
}
/**
 * A function type that can be used as a value-collecting handler with add/remove functionality.
 */
export type CollectorFunction<TFunc extends (...args: any[]) => U | Promise<U>, U = unknown> = (...args: Parameters<TFunc>) => Promise<Awaited<U>>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
/**
 * A Handler function type that can have multiple handlers added or removed, and collects their results into an array.
 */
export interface CollectiveHandlerFunction<TFunc extends (...args: any[]) => U[] | Promise<U[]>, U = unknown> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /**
     * Invokes the handler function with the provided arguments.
     */
    (...args: Parameters<TFunc>): ReturnType<TFunc>;
    /**
     * Adds a handler function.
     * @param callback The handler function to add.
     * @returns A function to remove the added handler.
     */
    addHandler: (callback: CollectorFunction<TFunc>) => () => void;
    /**
     * Removes a handler function.
     * @param callback The handler function to remove.
     * @returns
     */
    removeHandler: (callback: CollectorFunction<TFunc>) => void;
}
export interface BooleanMultipleHandlerFunction<TFunc extends (...args: any[]) => boolean | Promise<boolean>> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /**
     * Invokes the handler function with the provided arguments.
     */
    (...args: Parameters<TFunc>): ReturnType<TFunc>;
    /**
     * Adds a handler function.
     * @param callback The handler function to add.
     * @returns A function to remove the added handler.
     */
    addHandler: (callback: TFunc, priority?: number) => () => void;
    /**
     * Removes a handler function.
     * @param callback The handler function to remove.
     * @returns
     */
    removeHandler: (callback: TFunc) => void;
}
export interface MultiBinderInstance<T extends unknown[], U> extends InvokableHandler<T, U>, MultiRegisterHandler<T, U> { // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface -- Empty interface
}
export interface BooleanMultiBinderInstance<T extends unknown[]> extends InvokableBooleanHandler<T>, MultiRegisterHandler<T, boolean> { // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface -- Empty interface
}
export declare function allFunction<TFunc extends (...args: any[]) => Promise<boolean>>(name?: string): BooleanMultipleHandlerFunction<TFunc>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
export declare function bailFirstFailureFunction<TFunc extends (...args: any[]) => Promise<boolean>>(name?: string): BooleanMultipleHandlerFunction<TFunc>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
export declare function allParallelFunction<TFunc extends (...args: any[]) => Promise<boolean>>(name?: string): BooleanMultipleHandlerFunction<TFunc>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
export declare function anySuccessFunction<TFunc extends (...args: any[]) => Promise<boolean>>(name?: string): BooleanMultipleHandlerFunction<TFunc>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
export declare function firstResultFunction<TFunc extends (...args: any[]) => Promise<unknown>>(name?: string): MultipleHandlerFunction<TFunc>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
export declare function dispatchParallelFunction<TFunc extends (...args: any[]) => Promise<unknown[]>>(name?: string): CollectiveHandlerFunction<TFunc>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
export declare function bindableFunction<TFunc extends (...args: any[]) => any>(name?: string): HandlerFunction<TFunc>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
export declare function lazyBindableFunction<TFunc extends (...args: any[]) => any>(name?: string): LazyHandlerFunction<TFunc>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
type FunctionKeys<T> = Extract<{
    [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
}[keyof T], string>;
export declare function handlers<T extends object>(): {
    /**
     * Create a handler that invokes all added handler functions sequentially until one returns false.
     * @param name
     * @returns
     */
    all<K extends FunctionKeys<T>>(name: K): BooleanMultipleHandlerFunction<Extract<T[K], (...args: any[]) => Promise<boolean>>>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /**
     * Create a handler that invokes all added handler functions in parallel and returns true only if all return true.
     * @param name
     * @returns
     */
    allParallel<K extends FunctionKeys<T>>(name: K): BooleanMultipleHandlerFunction<Extract<T[K], (...args: any[]) => Promise<boolean>>>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /**
     * Create a handler that invokes all added handler functions sequentially until one returns false.
     * @param name
     * @returns
     */
    bailFirstFailure<K extends FunctionKeys<T>>(name: K): BooleanMultipleHandlerFunction<Extract<T[K], (...args: any[]) => Promise<boolean>>>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /**
     * Create a handler that invokes all added handler functions sequentially until one returns true.
     * @param name
     * @returns
     */
    anySuccess<K extends FunctionKeys<T>>(name: K): BooleanMultipleHandlerFunction<Extract<T[K], (...args: any[]) => Promise<boolean>>>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /**
     * Create a handler that invokes all added handler functions sequentially until one returns a non-falsy value.
     * @param name
     * @returns
     */
    firstResult<K extends FunctionKeys<T>>(name: K): MultipleHandlerFunction<Extract<T[K], (...args: any[]) => Promise<unknown>>>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /**
     * Create a handler that invokes all added handler functions in parallel.
     * @param name
     * @returns
     */
    dispatchParallel<K extends FunctionKeys<T>>(name: K): CollectiveHandlerFunction<Extract<T[K], (...args: any[]) => Promise<unknown[]>>>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /**
     * Create a binder handler that can assign a single handler function.
     * @param name
     * @returns
     */
    binder<K extends FunctionKeys<T>>(name: K): HandlerFunction<Extract<T[K], (...args: any[]) => any>>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    lazyBinder<K extends FunctionKeys<T>>(name: K): LazyHandlerFunction<Extract<T[K], (...args: any[]) => any>>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
};
export {};
