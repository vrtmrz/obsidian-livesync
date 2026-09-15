import { CLOUDFLARE_ICE_SERVER_SOURCE_ID } from "@/integrations/cloudflare/settings";
import type { IceServerSourceFactoryCatalogue } from "@vrtmrz/livesync-commonlib/p2p";
import {
    createCloudflareIceServerSource,
    type CloudflareIceServerSourceFetch,
} from "@/integrations/cloudflare/iceServerSource";

/**
 * Compose the closed LiveSync-owned ICE source catalogue from a host HTTP
 * adapter. The adapter is intentionally narrow so this feature does not take
 * a dependency on LiveSync core or on native request APIs.
 */
export function useIceServerSources(fetch: CloudflareIceServerSourceFetch): IceServerSourceFactoryCatalogue {
    return {
        [CLOUDFLARE_ICE_SERVER_SOURCE_ID]: (configuration) => createCloudflareIceServerSource(configuration, { fetch }),
    };
}
