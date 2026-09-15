import { CLOUDFLARE_ICE_SERVER_SOURCE_ID, validateCloudflareIceServerSourceConfiguration } from "./cloudflare/settings";

export const MANUAL_ICE_SERVER_SOURCE_ID = "manual" as const;

export type IceServerSourceSelectionId = typeof MANUAL_ICE_SERVER_SOURCE_ID | typeof CLOUDFLARE_ICE_SERVER_SOURCE_ID;

export interface IceServerSourceFieldDefinition {
    readonly key: string;
    readonly label: string;
    readonly secret: boolean;
}

export interface IceServerSourceDefinition {
    readonly id: string;
    readonly label: string;
    readonly fields: readonly IceServerSourceFieldDefinition[];
}

export interface IceServerSourceDescriptorLike {
    readonly version?: unknown;
    readonly id?: unknown;
    readonly configuration?: unknown;
}

/**
 * The service-owned field metadata used by the P2P settings dialogue. Manual
 * TURN values remain the existing settings fields and therefore do not occur
 * in this provider catalogue.
 */
export const iceServerSourceDefinitions = [
    {
        id: CLOUDFLARE_ICE_SERVER_SOURCE_ID,
        label: "Cloudflare",
        fields: [
            { key: "turnKeyId", label: "TURN Key ID", secret: false },
            { key: "apiToken", label: "TURN Key API Token", secret: true },
        ],
    },
] as const satisfies readonly IceServerSourceDefinition[];

/** The user-facing source choice, including the existing manual mode. */
export const turnConfigurationChoices = [
    { id: MANUAL_ICE_SERVER_SOURCE_ID, label: "Manual" },
    { id: CLOUDFLARE_ICE_SERVER_SOURCE_ID, label: "Cloudflare" },
] as const;

export const iceServerSourceChoices = turnConfigurationChoices;

function isRecord(value: unknown): value is IceServerSourceDescriptorLike {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a selected source descriptor without performing network access.
 * An absent descriptor represents the existing manual TURN configuration.
 */
export function validateIceServerSourceConfiguration(
    descriptor: IceServerSourceDescriptorLike | null | undefined
): string | undefined {
    if (descriptor === undefined || descriptor === null) return undefined;
    if (!isRecord(descriptor)) return "TURN configuration source is invalid.";
    if (descriptor.version !== 1) return "TURN configuration source version is not supported.";
    if (descriptor.id === MANUAL_ICE_SERVER_SOURCE_ID) {
        return undefined;
    }
    if (descriptor.id !== CLOUDFLARE_ICE_SERVER_SOURCE_ID) {
        return "The selected TURN configuration source is not supported.";
    }
    return validateCloudflareIceServerSourceConfiguration(descriptor.configuration);
}

export function getIceServerSourceDefinition(id: string): IceServerSourceDefinition | undefined {
    return iceServerSourceDefinitions.find((definition) => definition.id === id);
}

/** Validate the selected settings projection, including an unavailable encrypted source. */
export function validateTurnSettings(settings: {
    readonly P2P_iceServerSource?: IceServerSourceDescriptorLike | null;
    readonly encryptedP2PIceServerSource?: string;
}): string | undefined {
    if (!settings.P2P_iceServerSource && settings.encryptedP2PIceServerSource) {
        return "TURN configuration could not be decrypted.";
    }
    return validateIceServerSourceConfiguration(settings.P2P_iceServerSource);
}
