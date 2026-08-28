import type { RemoteDBSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";

type EndpointProjection = readonly [kind: "url" | "invalid-url", value: string];

function projectEndpoint(value: string): EndpointProjection {
    try {
        const endpoint = new URL(value);
        endpoint.hash = "";
        endpoint.searchParams.sort();
        while (endpoint.pathname.length > 1 && endpoint.pathname.endsWith("/")) {
            endpoint.pathname = endpoint.pathname.slice(0, -1);
        }
        return ["url", endpoint.toString()];
    } catch {
        return ["invalid-url", value];
    }
}

function projectHeaders(value: string): readonly (readonly [name: string, value: string])[] {
    const headers = new Map<string, string>();
    for (const line of value.split("\n")) {
        const [name, headerValue] = line.split(":", 2).map((part) => part.trim());
        if (name && headerValue) {
            headers.set(name, headerValue);
        }
    }
    return [...headers.entries()].sort(([leftName, leftValue], [rightName, rightValue]) => {
        const nameOrder = leftName.localeCompare(rightName);
        return nameOrder || leftValue.localeCompare(rightValue);
    });
}

function projectRemoteSecurity(settings: RemoteDBSettings) {
    return settings.encrypt
        ? ([
              "encrypted",
              settings.passphrase,
              settings.useDynamicIterationCount,
              settings.E2EEAlgorithm,
              settings.permitEmptyPassphrase,
          ] as const)
        : (["plain"] as const);
}

/**
 * Project the effective CouchDB connection settings to a private comparison identity.
 * The returned value can contain credentials and must not be logged, persisted, or displayed.
 */
export function getCouchDBReplicatorConfigurationIdentity(settings: RemoteDBSettings): string {
    const authentication = settings.useJWT
        ? ([
              "jwt",
              settings.jwtAlgorithm,
              settings.jwtKey,
              settings.jwtKid,
              settings.jwtSub,
              settings.jwtExpDuration,
          ] as const)
        : (["basic", settings.couchDB_USER, settings.couchDB_PASSWORD] as const);
    return JSON.stringify([
        "couchdb",
        projectEndpoint(settings.couchDB_URI),
        settings.couchDB_DBNAME,
        authentication,
        projectHeaders(settings.couchDB_CustomHeaders),
        settings.useRequestAPI,
        settings.disableRequestURI,
        projectRemoteSecurity(settings),
        settings.enableCompression,
    ]);
}

/**
 * Project the effective Object Storage connection settings to a private comparison identity.
 * The returned value can contain credentials and must not be logged, persisted, or displayed.
 */
export function getObjectStorageReplicatorConfigurationIdentity(settings: RemoteDBSettings): string {
    return JSON.stringify([
        "s3",
        projectEndpoint(settings.endpoint),
        settings.bucket,
        settings.bucketPrefix,
        settings.region,
        settings.accessKey,
        settings.secretKey,
        settings.forcePathStyle,
        settings.useCustomRequestHandler,
        projectHeaders(settings.bucketCustomHeaders),
        projectRemoteSecurity(settings),
    ]);
}
