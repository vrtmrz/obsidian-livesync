// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: bbf2539
type HiddenFileSyncDirection = "pullForce" | "pushForce" | "safe";
type ConfigureHiddenFileSyncHandlers = {
    disable: () => Promise<void>;
    enable: () => Promise<void>;
    initialise: (direction: HiddenFileSyncDirection) => Promise<void>;
};
export type ConfigureHiddenFileSyncResult = "ignored" | "disabled" | "enabled";
export declare function configureHiddenFileSyncMode(mode: keyof OPTIONAL_SYNC_FEATURES, handlers: ConfigureHiddenFileSyncHandlers): Promise<ConfigureHiddenFileSyncResult>;
export {};
