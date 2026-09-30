/** The provider identifier persisted in a P2P profile for Cloudflare TURN. */
export const CLOUDFLARE_TURN_TYPE = "CF" as const;

/** The lifetime requested from Cloudflare for each issued credential set. */
export const CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS = 86_400 as const;

/** The Cloudflare TURN credential-generation endpoint. */
export const CLOUDFLARE_TURN_CREDENTIAL_ENDPOINT = "https://rtc.live.cloudflare.com/v1/turn/keys" as const;

/** A Cloudflare TURN configuration. */
export interface CloudflareTurnConfiguration {
    readonly turnKeyId: string;
    readonly apiToken: string;
}

// TURN Key IDs are inserted into one fixed URL path. Keep the accepted set
// deliberately narrower than URI escaping so a configuration cannot alter
// the request path or add a query string.
const TURN_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,255}$/;

// RFC 6750's b64token grammar, including optional trailing padding. This
// also excludes whitespace and control characters from the Authorization
// header without exposing the token in a validation message.
const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]+={0,2}$/;
const MAX_BEARER_TOKEN_LENGTH = 4_096;

/**
 * Returns a safe validation message for a Cloudflare TURN configuration.
 * The result never includes the supplied Key ID or API token.
 */
export function validateCloudflareTurnConfiguration(value: CloudflareTurnConfiguration): string | undefined {
    const turnKeyId = value.turnKeyId;
    if (typeof turnKeyId !== "string" || turnKeyId.length === 0) {
        return "Enter a TURN Key ID.";
    }
    if (!TURN_KEY_ID_PATTERN.test(turnKeyId)) {
        return "TURN Key ID contains unsupported characters.";
    }

    const apiToken = value.apiToken;
    if (typeof apiToken !== "string" || apiToken.length === 0) {
        return "Enter a TURN Key API Token.";
    }
    if (apiToken.length > MAX_BEARER_TOKEN_LENGTH || !BEARER_TOKEN_PATTERN.test(apiToken)) {
        return "TURN Key API Token must use Bearer token syntax.";
    }

    return undefined;
}
