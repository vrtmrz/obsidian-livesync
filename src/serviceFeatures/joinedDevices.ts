import type { JoinedDevice, JoinedDevicesSnapshot } from "@vrtmrz/livesync-commonlib/replication";
import type { JoinedDevicesView } from "./joinedDevicesDialogTypes";

/** Compare recognised SemVer values; unknown development labels have no ordering. */
export function comparePluginVersions(left: string, right: string): number | undefined {
    const parse = (value: string) => {
        const match =
            /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
                value
            );
        if (!match) return undefined;
        const prerelease = match[4]?.split(".");
        if (prerelease?.some((part) => /^0\d+$/.test(part))) return undefined;
        return { core: match.slice(1, 4).map(BigInt), prerelease };
    };
    const a = parse(left);
    const b = parse(right);
    if (!a || !b) return undefined;
    for (let i = 0; i < 3; i++) {
        if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
    }
    if (!a.prerelease || !b.prerelease) return a.prerelease ? -1 : b.prerelease ? 1 : 0;
    for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
        const x = a.prerelease[i];
        const y = b.prerelease[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        if (x === y) continue;
        const xn = /^\d+$/.test(x);
        const yn = /^\d+$/.test(y);
        if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
        if (xn !== yn) return xn ? -1 : 1;
        return x > y ? 1 : -1;
    }
    return 0;
}

export function joinedDevicesView(
    snapshot: JoinedDevicesSnapshot,
    self: Omit<JoinedDevice, "accepted">
): JoinedDevicesView {
    const ownRecord = snapshot.devices.find((device) => device.id === self.id);
    const ownDevice: JoinedDevice = { ...ownRecord, ...self, accepted: ownRecord?.accepted ?? false };
    return {
        ...snapshot,
        devices: [ownDevice, ...snapshot.devices.filter((device) => device.id !== self.id)].map((device) => ({
            ...device,
            self: device.id === self.id,
            lockedOut: snapshot.locked && !device.accepted,
        })),
    };
}

export function differentDeviceVersions(snapshot: JoinedDevicesSnapshot, ownId: string, ownVersion: string) {
    const newer = new Set<string>();
    const older = new Set<string>();
    for (const device of snapshot.devices) {
        if (device.id === ownId || !device.pluginVersion) continue;
        const comparison = comparePluginVersions(device.pluginVersion, ownVersion);
        if (comparison !== undefined && comparison > 0) newer.add(device.pluginVersion);
        if (comparison !== undefined && comparison < 0) older.add(device.pluginVersion);
    }
    return { newer: [...newer].sort(), older: [...older].sort() };
}
