type CouchDBConfigurationSection = Record<string, string | undefined>;

export interface CouchDBConfiguration {
    admins: CouchDBConfigurationSection;
    chttpd: CouchDBConfigurationSection;
    chttpd_auth: CouchDBConfigurationSection;
    couchdb: CouchDBConfigurationSection;
    cors: CouchDBConfigurationSection;
    httpd: CouchDBConfigurationSection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function normaliseSection(value: unknown): CouchDBConfigurationSection {
    if (!isRecord(value)) {
        return {};
    }

    const entries: Array<[string, string]> = [];
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === "string") {
            entries.push([key, entry]);
        }
    }
    return Object.fromEntries(entries);
}

export function normaliseCouchDBConfiguration(value: unknown): CouchDBConfiguration {
    const source = isRecord(value) ? value : {};
    return {
        admins: normaliseSection(source.admins),
        chttpd: normaliseSection(source.chttpd),
        chttpd_auth: normaliseSection(source.chttpd_auth),
        couchdb: normaliseSection(source.couchdb),
        cors: normaliseSection(source.cors),
        httpd: normaliseSection(source.httpd),
    };
}
