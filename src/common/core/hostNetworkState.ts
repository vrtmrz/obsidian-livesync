/** Host network availability, with the time of the latest network notification when available. */
export interface HostNetworkState {
    readonly online: boolean;
    readonly notifiedAt?: number;
}
