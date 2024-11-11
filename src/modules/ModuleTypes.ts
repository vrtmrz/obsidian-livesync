import type { Prettify } from "../lib/src/common/types";
import type { LiveSyncCore } from "../main";

export type OverridableFunctionsKeys<T> = {
    [K in keyof T as K extends `$${string}` ? K : never]: T[K];
};

export type ChainableExecuteFunction<T> = {
    [K in keyof T as K extends `$${string}`
        ? T[K] extends (...args: any) => ChainableFunctionResult
            ? K
            : never
        : never]: T[K];
};

export type ICoreModuleBase = OverridableFunctionsKeys<LiveSyncCore>;
export type ICoreModule = Prettify<Partial<ICoreModuleBase>>;
export type CoreModuleKeys = keyof ICoreModule;

export type ChainableFunctionResult =
    | Promise<boolean | undefined | string>
    | Promise<boolean | undefined>
    | Promise<boolean>
    | Promise<void>;
export type ChainableFunctionResultOrAll = Promise<boolean | undefined | string | void>;

type AllExecuteFunction<T> = {
    [K in keyof T as K extends `$all${string}`
        ? T[K] extends (...args: any[]) => ChainableFunctionResultOrAll
            ? K
            : never
        : never]: T[K];
};
type EveryExecuteFunction<T> = {
    [K in keyof T as K extends `$every${string}`
        ? T[K] extends (...args: any[]) => ChainableFunctionResult
            ? K
            : never
        : never]: T[K];
};
type AnyExecuteFunction<T> = {
    [K in keyof T as K extends `$any${string}`
        ? T[K] extends (...args: any[]) => ChainableFunctionResult
            ? K
            : never
        : never]: T[K];
};
type InjectableFunction<T> = {
    [K in keyof T as K extends `$$${string}` ? (T[K] extends (...args: any[]) => any ? K : never) : never]: T[K];
};
export type AllExecuteProps = AllExecuteFunction<LiveSyncCore>;
export type EveryExecuteProps = EveryExecuteFunction<LiveSyncCore>;
export type AnyExecuteProps = AnyExecuteFunction<LiveSyncCore>;

export type AllInjectableProps = InjectableFunction<LiveSyncCore>;
