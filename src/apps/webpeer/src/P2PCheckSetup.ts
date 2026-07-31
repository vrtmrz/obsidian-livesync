import { encodeSettingsToSetupURI } from "@vrtmrz/livesync-commonlib/compat/API/processSetting";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import {
    P2P_DEFAULT_SETTINGS,
    PREFERRED_BASE,
    createNewVaultSettings,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { generateP2PRoomId } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { upsertRemoteConfigurationInPlace } from "@vrtmrz/livesync-commonlib/remote-configurations";

export const P2P_CHECK_APP_ID = "self-hosted-livesync-p2p-check-v1";
export const P2P_CHECK_REMOTE_NAME = "P2P connection check";

export type P2PCheckTarget = "desktop" | "mobile";

export interface GeneratedP2PCheckSetup {
    readonly target: P2PCheckTarget;
    readonly setupURI: string;
    readonly setupPassphrase: string;
    readonly groupId: string;
    readonly relay: string;
    readonly browserDeviceName: string;
    readonly browserSettings: ObsidianLiveSyncSettings;
}

export interface P2PCheckSetupOptions {
    readonly relay?: string;
}

export interface P2PCheckPageLocation {
    readonly hostname: string;
    readonly search: string;
}

interface SharedP2PCheckCredentials {
    readonly groupId: string;
    readonly p2pPassphrase: string;
    readonly vaultPassphrase: string;
}

const READABLE_SECRET_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const RANDOM_BYTE_ACCEPTANCE_LIMIT =
    Math.floor(256 / READABLE_SECRET_ALPHABET.length) * READABLE_SECRET_ALPHABET.length;

function generateReadableSecret(length: number): string {
    const crypto = compatGlobal.crypto;
    if (!crypto) {
        throw new Error("Web Crypto is required to prepare a P2P connection check");
    }

    let result = "";
    const bytes = new Uint8Array(Math.max(16, length));
    while (result.length < length) {
        crypto.getRandomValues(bytes);
        for (const byte of bytes) {
            if (byte >= RANDOM_BYTE_ACCEPTANCE_LIMIT) {
                continue;
            }
            result += READABLE_SECRET_ALPHABET[byte % READABLE_SECRET_ALPHABET.length];
            if (result.length === length) {
                break;
            }
        }
    }
    return result;
}

function generateSetupPassphrase(): string {
    return generateReadableSecret(16).match(/.{4}/g)!.join("-");
}

function createSettings(
    credentials: SharedP2PCheckCredentials,
    options: {
        readonly autoStart: boolean;
        readonly relay: string;
        readonly useDiagnostics: boolean;
    }
): ObsidianLiveSyncSettings {
    const settings = createNewVaultSettings();
    Object.assign(settings, PREFERRED_BASE, P2P_DEFAULT_SETTINGS, {
        isConfigured: true,
        encrypt: true,
        passphrase: credentials.vaultPassphrase,
        usePathObfuscation: true,
        P2P_Enabled: true,
        P2P_AppID: P2P_CHECK_APP_ID,
        P2P_roomID: credentials.groupId,
        P2P_passphrase: credentials.p2pPassphrase,
        P2P_relays: options.relay,
        P2P_AutoStart: options.autoStart,
        P2P_AutoBroadcast: false,
        P2P_DevicePeerName: "",
        P2P_useDiagRTC: options.useDiagnostics,
    });
    upsertRemoteConfigurationInPlace(settings, "p2p", {
        name: P2P_CHECK_REMOTE_NAME,
        activate: true,
        activateForP2P: true,
    });
    return settings;
}

export function resolveLocalP2PCheckRelayOverride(location: P2PCheckPageLocation): string | undefined {
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
    if (!loopbackHosts.has(location.hostname.toLowerCase())) {
        return undefined;
    }

    const requestedRelay = new URLSearchParams(location.search).get("relay")?.trim();
    if (!requestedRelay) {
        return undefined;
    }

    try {
        const relay = new URL(requestedRelay);
        if (relay.protocol !== "ws:" && relay.protocol !== "wss:") {
            return undefined;
        }
        return relay.href;
    } catch {
        return undefined;
    }
}

export async function generateP2PCheckSetup(
    target: P2PCheckTarget,
    options: P2PCheckSetupOptions = {}
): Promise<GeneratedP2PCheckSetup> {
    const relay = options.relay?.trim() || P2P_DEFAULT_SETTINGS.P2P_relays;
    const credentials: SharedP2PCheckCredentials = {
        groupId: generateP2PRoomId(),
        p2pPassphrase: generateReadableSecret(32),
        vaultPassphrase: generateReadableSecret(32),
    };
    const deviceSettings = createSettings(credentials, {
        autoStart: true,
        relay,
        useDiagnostics: false,
    });
    const browserSettings = createSettings(credentials, {
        autoStart: false,
        relay,
        useDiagnostics: true,
    });
    browserSettings.suspendParseReplicationResult = true;

    const setupPassphrase = generateSetupPassphrase();
    const setupURI = await encodeSettingsToSetupURI(
        deviceSettings,
        setupPassphrase,
        ["pluginSyncExtendedSetting", "doNotUseFixedRevisionForChunks", "P2P_DevicePeerName", "deviceAndVaultName"],
        true
    );

    return {
        target,
        setupURI: setupURI.trim(),
        setupPassphrase,
        groupId: credentials.groupId,
        relay: deviceSettings.P2P_relays,
        browserDeviceName: `p2p-check-browser-${target}-${credentials.groupId.slice(-3)}`,
        browserSettings,
    };
}
