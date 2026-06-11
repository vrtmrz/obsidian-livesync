type InstanceHaveOnBindFunction = {
    onBindFunction: (core: any, services: any) => void;
} & Record<string, any>;
export declare function __$checkInstanceBinding<T extends InstanceHaveOnBindFunction>(instance: T): void;
export {};
