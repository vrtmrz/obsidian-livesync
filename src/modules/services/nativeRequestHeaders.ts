const cacheReuseDirectives = new Set(["max-age", "max-stale", "min-fresh", "only-if-cached"]);

function splitHeaderDirectives(value: string): string[] {
    const directives: string[] = [];
    let start = 0;
    let inQuotes = false;
    let escaped = false;

    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (inQuotes && escaped) {
            escaped = false;
            continue;
        }
        if (inQuotes && character === "\\") {
            escaped = true;
            continue;
        }
        if (character === '"') {
            inQuotes = !inQuotes;
        } else if (character === "," && !inQuotes) {
            const directive = value.slice(start, index).trim();
            if (directive) directives.push(directive);
            start = index + 1;
        }
    }

    const lastDirective = value.slice(start).trim();
    if (lastDirective) directives.push(lastDirective);
    return directives;
}

function getDirectiveName(directive: string): string {
    const equalsIndex = directive.indexOf("=");
    return (equalsIndex === -1 ? directive : directive.slice(0, equalsIndex)).trim().toLowerCase();
}

/**
 * Whether native GET or HEAD requests must revalidate an explicitly bypassed cache.
 *
 * @param method - HTTP method, compared without regard to letter case.
 * @param cacheMode - Effective Request or options cache mode.
 * @returns True only for GET/HEAD with `no-cache` or `no-store`.
 */
export function shouldRevalidateNativeRequest(method: string, cacheMode: RequestCache | undefined): boolean {
    return (cacheMode === "no-cache" || cacheMode === "no-store") && ["GET", "HEAD"].includes(method.toUpperCase());
}

function shouldRetainCacheControlDirective(directive: string, enforceNoStore: boolean): boolean {
    const name = getDirectiveName(directive);
    return !cacheReuseDirectives.has(name) && name !== "no-cache" && (!enforceNoStore || name !== "no-store");
}

/**
 * Copy request headers and apply the native fetch adapter's header/cache policy.
 *
 * @param headers - Merged input headers; this function does not mutate them.
 * @param method - HTTP method used to decide whether cache revalidation applies.
 * @param cacheMode - Effective Request or options cache mode.
 * @returns Fresh headers with the adapter's native-controlled headers removed.
 * Revalidated GET/HEAD requests retain non-conflicting directives and receive
 * `no-cache`; `no-store` also adds that directive. Existing header spelling is retained.
 */
export function createNativeRequestHeaders(
    headers: Readonly<Record<string, string>>,
    method: string,
    cacheMode: RequestCache | undefined
): Record<string, string> {
    const transformedHeaders = { ...headers };
    // Delete headers that should not be sent by native fetch,
    // they are controlled by the browser and may cause CORS preflight failure if sent manually.
    delete transformedHeaders["host"];
    delete transformedHeaders["Host"];
    delete transformedHeaders["content-length"];
    delete transformedHeaders["Content-Length"];
    if (shouldRevalidateNativeRequest(method, cacheMode)) {
        // requestUrl has no cache option; no-store alone can reuse an existing cached response.
        const enforceNoStore = cacheMode === "no-store";
        const cacheControlKeys = Object.keys(transformedHeaders).filter((key) => key.toLowerCase() === "cache-control");
        const cacheControlDirectives = cacheControlKeys
            .flatMap((key) => splitHeaderDirectives(transformedHeaders[key]))
            .filter((directive) => shouldRetainCacheControlDirective(directive, enforceNoStore));
        const cacheControlKey = cacheControlKeys[0] ?? "cache-control";
        for (const key of cacheControlKeys) delete transformedHeaders[key];
        transformedHeaders[cacheControlKey] = [
            ...cacheControlDirectives,
            "no-cache",
            ...(enforceNoStore ? ["no-store"] : []),
        ].join(", ");

        const pragmaKeys = Object.keys(transformedHeaders).filter((key) => key.toLowerCase() === "pragma");
        const pragmaDirectives = pragmaKeys
            .flatMap((key) => splitHeaderDirectives(transformedHeaders[key]))
            .filter((directive) => getDirectiveName(directive) !== "no-cache");
        const pragmaKey = pragmaKeys[0] ?? "pragma";
        for (const key of pragmaKeys) delete transformedHeaders[key];
        transformedHeaders[pragmaKey] = [...pragmaDirectives, "no-cache"].join(", ");
    }
    return transformedHeaders;
}
