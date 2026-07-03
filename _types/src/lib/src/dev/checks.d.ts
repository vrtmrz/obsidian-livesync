// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
interface InstanceHaveOnBindFunction<T> {
    onBindFunction: (...params: T[]) => void;
}
export declare function __$checkInstanceBinding<T extends InstanceHaveOnBindFunction<any>>(instance: T): void; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
export {};
