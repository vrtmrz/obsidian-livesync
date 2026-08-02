import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type WebDAVConfig = {
    endpoint: string;
    username: string;
    password: string;
};

function parseEnvFile(content: string): Record<string, string> {
    const entries = content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
            const equalsAt = line.indexOf("=");
            if (equalsAt < 0) return undefined;
            const key = line.slice(0, equalsAt).trim();
            const rawValue = line.slice(equalsAt + 1).trim();
            return [key, rawValue.replace(/^['"]|['"]$/gu, "")] as const;
        })
        .filter((entry): entry is readonly [string, string] => entry !== undefined);
    return Object.fromEntries(entries);
}

function firstValue(values: Record<string, string | undefined>, keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const value = values[key]?.trim();
        if (value) return value;
    }
    return undefined;
}

export async function loadWebDAVConfig(envFile = ".test.env"): Promise<WebDAVConfig> {
    let fileValues: Record<string, string> = {};
    try {
        fileValues = parseEnvFile(await readFile(resolve(envFile), "utf8"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const values = { ...fileValues, ...process.env };
    return {
        endpoint: (firstValue(values, ["WEBDAV_ENDPOINT", "webdavEndpoint"]) ?? "http://127.0.0.1:8088/dav").replace(
            /\/+$/u,
            ""
        ),
        username: firstValue(values, ["WEBDAV_USERNAME", "webdavUsername"]) ?? "",
        password: firstValue(values, ["WEBDAV_PASSWORD", "webdavPassword"]) ?? "",
    };
}

function normalisePrefix(prefix: string): string[] {
    const parts = prefix
        .trim()
        .split("/")
        .filter((part) => part.length > 0);
    if (parts.some((part) => part === "." || part === "..")) {
        throw new TypeError("WebDAV E2E prefix must not contain dot path segments.");
    }
    return parts;
}

export function webDAVCollectionUrl(config: Pick<WebDAVConfig, "endpoint">, prefix: string): URL {
    const url = new URL(`${config.endpoint.replace(/\/+$/u, "")}/`);
    if (url.search || url.hash) throw new TypeError("WebDAV E2E endpoint must not contain a query or fragment.");
    const baseParts = url.pathname.split("/").filter((part) => part.length > 0);
    const prefixParts = normalisePrefix(prefix);
    url.pathname = `/${[...baseParts, ...prefixParts].map((part) => encodeURIComponent(decodeURIComponent(part))).join("/")}/`;
    return url;
}

function requestHeaders(config: WebDAVConfig, additional: HeadersInit = {}): Headers {
    const headers = new Headers(additional);
    if (config.username || config.password) {
        headers.set(
            "Authorization",
            `Basic ${Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")}`
        );
    }
    return headers;
}

export async function assertWebDAVReachable(config: WebDAVConfig): Promise<void> {
    const response = await fetch(`${config.endpoint}/`, {
        method: "PROPFIND",
        headers: requestHeaders(config, { Depth: "0" }),
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status !== 207) {
        throw new Error(`WebDAV fixture is not reachable: HTTP ${response.status}.`);
    }
}

function decodeXmlText(value: string): string {
    return value
        .replace(/&amp;/giu, "&")
        .replace(/&lt;/giu, "<")
        .replace(/&gt;/giu, ">")
        .replace(/&quot;/giu, '"')
        .replace(/&apos;/giu, "'");
}

export function parseWebDAVObjectKeys(xml: string, collectionUrl: URL): string[] {
    const hrefs = [
        ...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?href\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?href>/giu),
    ].map((match) => decodeXmlText(match[1].trim()));
    const basePath = decodeURIComponent(collectionUrl.pathname);
    const keys = new Set<string>();
    for (const href of hrefs) {
        const path = decodeURIComponent(new URL(href, collectionUrl).pathname);
        if (!path.startsWith(basePath)) continue;
        const key = path.slice(basePath.length).replace(/\/$/u, "");
        if (key && !key.includes("/")) keys.add(key);
    }
    return [...keys].sort();
}

export async function listWebDAVObjectKeys(config: WebDAVConfig, prefix: string): Promise<string[]> {
    const collectionUrl = webDAVCollectionUrl(config, prefix);
    const response = await fetch(collectionUrl, {
        method: "PROPFIND",
        headers: requestHeaders(config, { Depth: "1" }),
    });
    if (response.status !== 207) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Could not list WebDAV E2E objects: HTTP ${response.status}.`);
    }
    return parseWebDAVObjectKeys(await response.text(), collectionUrl);
}

export async function readWebDAVObjectText(config: WebDAVConfig, prefix: string, key: string): Promise<string> {
    if (key.includes("/") || key === "." || key === "..") {
        throw new TypeError("WebDAV E2E object keys must be flat names.");
    }
    const response = await fetch(new URL(encodeURIComponent(key), webDAVCollectionUrl(config, prefix)), {
        headers: requestHeaders(config),
    });
    if (!response.ok) throw new Error(`Could not read WebDAV E2E object ${key}: HTTP ${response.status}.`);
    return await response.text();
}

export async function deleteWebDAVPrefix(config: WebDAVConfig, prefix: string): Promise<void> {
    const response = await fetch(webDAVCollectionUrl(config, prefix), {
        method: "DELETE",
        headers: requestHeaders(config),
    });
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok && response.status !== 404 && response.status !== 410) {
        throw new Error(`Could not remove WebDAV E2E prefix: HTTP ${response.status}.`);
    }
}

export function makeUniqueWebDAVPrefix(label: string): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `${label}-${Date.now()}-${random}/`;
}
