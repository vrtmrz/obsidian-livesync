// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: ef1bdf0
type HiddenFileSyncDirection = "pullForce" | "pushForce" | "safe";
type ConfigureHiddenFileSyncHandlers = {
    disable: () => Promise<void>;
    enable: () => Promise<void>;
    initialise: (direction: HiddenFileSyncDirection) => Promise<void>;
};
export type ConfigureHiddenFileSyncResult = "ignored" | "disabled" | "enabled";
export declare function configureHiddenFileSyncMode(mode: keyof OPTIONAL_SYNC_FEATURES, handlers: ConfigureHiddenFileSyncHandlers): Promise<ConfigureHiddenFileSyncResult>;
export {};
