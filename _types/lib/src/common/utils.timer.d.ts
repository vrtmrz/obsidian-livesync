/**
 * Run task with keeping minimum interval
 * @param key waiting key
 * @param interval interval (ms)
 * @param task task to perform.
 * @returns result of task
 * @remarks This function is not designed to be concurrent.
 */
export declare function runWithInterval<T>(key: string, interval: number, task: () => Promise<T>): Promise<T>;
/**
 * Run task with keeping minimum interval on start
 * @param key waiting key
 * @param interval interval (ms)
 * @param task task to perform.
 * @returns result of task
 * @remarks This function is not designed to be concurrent.
 */
export declare function runWithStartInterval<T>(key: string, interval: number, task: () => Promise<T>): Promise<T>;
