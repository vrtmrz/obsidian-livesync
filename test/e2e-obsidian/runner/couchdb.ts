import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type CouchDbConfig = {
    uri: string;
    username: string;
    password: string;
    dbPrefix: string;
};

export type CouchDbDocument = {
    _id: string;
    _rev?: string;
    type?: string;
    path?: string;
    children?: string[];
    [key: string]: unknown;
};

export type CouchDbAllDocsResponse = {
    rows: Array<{
        id: string;
        key: string;
        value: { rev: string; deleted?: boolean };
        doc?: CouchDbDocument;
    }>;
};

function parseEnvFile(content: string): Record<string, string> {
    const entries = content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
            const equalsAt = line.indexOf("=");
            if (equalsAt < 0) {
                return undefined;
            }
            const key = line.slice(0, equalsAt).trim();
            const rawValue = line.slice(equalsAt + 1).trim();
            const value = rawValue.replace(/^['"]|['"]$/gu, "");
            return [key, value] as const;
        })
        .filter((entry): entry is readonly [string, string] => entry !== undefined);
    return Object.fromEntries(entries);
}

function getEnvValue(values: Record<string, string | undefined>, ...keys: string[]): string {
    for (const key of keys) {
        const value = values[key]?.trim();
        if (value) {
            return value;
        }
    }
    throw new Error(`Required CouchDB environment value is missing: ${keys.join(" or ")}`);
}

function authHeader(config: Pick<CouchDbConfig, "username" | "password">): string {
    return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
}

function databaseUrl(config: Pick<CouchDbConfig, "uri">, dbName: string, suffix = ""): string {
    return `${config.uri.replace(/\/+$/u, "")}/${encodeURIComponent(dbName)}${suffix}`;
}

async function couchDbRequest(
    config: Pick<CouchDbConfig, "uri" | "username" | "password">,
    path: string,
    init: RequestInit = {}
): Promise<Response> {
    const response = await fetch(`${config.uri.replace(/\/+$/u, "")}${path}`, {
        ...init,
        headers: {
            authorization: authHeader(config),
            ...init.headers,
        },
    });
    return response;
}

export async function loadCouchDbConfig(envFile = ".test.env"): Promise<CouchDbConfig> {
    let fileValues: Record<string, string> = {};
    try {
        fileValues = parseEnvFile(await readFile(resolve(envFile), "utf-8"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
        }
    }

    const values = { ...fileValues, ...process.env };
    return {
        uri: getEnvValue(values, "COUCHDB_URI", "hostname").replace(/\/+$/u, ""),
        username: getEnvValue(values, "COUCHDB_USER", "username"),
        password: getEnvValue(values, "COUCHDB_PASSWORD", "password"),
        dbPrefix: getEnvValue(values, "COUCHDB_DBNAME", "dbname"),
    };
}

export function makeUniqueDatabaseName(prefix: string, label: string): string {
    const safePrefix = prefix
        .toLowerCase()
        .replace(/[^a-z0-9_$()+/-]+/gu, "-")
        .replace(/^-+/u, "")
        .slice(0, 80);
    const random = Math.random().toString(36).slice(2, 8);
    return `${safePrefix || "livesync-e2e"}-${label}-${Date.now()}-${random}`;
}

export async function assertCouchDbReachable(config: CouchDbConfig): Promise<void> {
    const response = await couchDbRequest(config, "/_up");
    if (!response.ok) {
        throw new Error(`CouchDB is not reachable at ${config.uri}. HTTP ${response.status}: ${await response.text()}`);
    }
}

export async function createCouchDbDatabase(config: CouchDbConfig, dbName: string): Promise<void> {
    const response = await fetch(databaseUrl(config, dbName), {
        method: "PUT",
        headers: { authorization: authHeader(config) },
    });
    if (!response.ok && response.status !== 412) {
        throw new Error(
            `Failed to create CouchDB database ${dbName}. HTTP ${response.status}: ${await response.text()}`
        );
    }
}

export async function deleteCouchDbDatabase(config: CouchDbConfig, dbName: string): Promise<void> {
    const response = await fetch(databaseUrl(config, dbName), {
        method: "DELETE",
        headers: { authorization: authHeader(config) },
    });
    if (!response.ok && response.status !== 404) {
        throw new Error(
            `Failed to delete CouchDB database ${dbName}. HTTP ${response.status}: ${await response.text()}`
        );
    }
}

export async function fetchAllCouchDbDocs(config: CouchDbConfig, dbName: string): Promise<CouchDbAllDocsResponse> {
    const response = await fetch(databaseUrl(config, dbName, "/_all_docs?include_docs=true"), {
        headers: { authorization: authHeader(config) },
    });
    if (!response.ok) {
        throw new Error(
            `Failed to read CouchDB documents from ${dbName}. HTTP ${response.status}: ${await response.text()}`
        );
    }
    return (await response.json()) as CouchDbAllDocsResponse;
}

export async function waitForCouchDbDocs(
    config: CouchDbConfig,
    dbName: string,
    predicate: (docs: CouchDbDocument[]) => boolean,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS ?? 15000)
): Promise<CouchDbDocument[]> {
    const deadline = Date.now() + timeoutMs;
    let lastDocs: CouchDbDocument[] = [];
    while (Date.now() < deadline) {
        const response = await fetchAllCouchDbDocs(config, dbName);
        lastDocs = response.rows.flatMap((row) => (row.doc ? [row.doc] : []));
        if (predicate(lastDocs)) {
            return lastDocs;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
        `Timed out waiting for CouchDB documents in ${dbName}. Last document IDs: ${lastDocs
            .map((doc) => doc._id)
            .join(", ")}`
    );
}
