import type { ForgetJoinedDeviceResult, JoinedDevice } from "@vrtmrz/livesync-commonlib/replication";

export interface JoinedDeviceRow extends JoinedDevice {
    readonly self: boolean;
    readonly lockedOut: boolean;
    readonly versionNoticesHidden: boolean;
}

export interface JoinedDevicesView {
    readonly milestonePresent: boolean;
    readonly locked: boolean;
    readonly cleaned: boolean;
    readonly devices: readonly JoinedDeviceRow[];
}

export interface JoinedDevicesDialogOptions {
    setVersionNoticesHidden(id: string, hidden: boolean): Promise<void>;
    refresh(): Promise<JoinedDevicesView>;
    forget(id: string): Promise<ForgetJoinedDeviceResult>;
    cancel(): void;
}
