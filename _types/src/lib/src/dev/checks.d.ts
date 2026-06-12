type InstanceHaveOnBindFunction = {
    onBindFunction: (core: any, services: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
} & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export declare function __$checkInstanceBinding<T extends InstanceHaveOnBindFunction>(instance: T): void;
export {};
