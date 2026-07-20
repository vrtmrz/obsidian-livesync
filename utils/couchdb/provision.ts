import { PouchDB } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/compat/pouchdb/pouchdb-browser";
import { checkRemoteVersion } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/compat/pouchdb/negotiation";

export interface CouchDBProvisioningOptions {
  hostname: string;
  username: string;
  password: string;
  node?: string;
  database?: string;
  origins?: string;
  retryCount?: number;
  retryDelayMs?: number;
}

interface ProvisioningDependencies {
  fetch: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  initialiseDatabaseVersion: (
    databaseURL: string,
    username: string,
    password: string,
  ) => Promise<void>;
}

const DEFAULT_ORIGINS =
  "app://obsidian.md,capacitor://localhost,http://localhost";

function requireValue(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function normaliseHostname(hostname: string): string {
  const parsed = new URL(requireValue(hostname, "hostname"));
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.href.replace(/\/$/, "");
}

function validateDatabaseName(database: string): string {
  const trimmed = database.trim();
  if (!/^[a-z][a-z0-9_$()+-]*$/.test(trimmed)) {
    throw new Error(
      "database must begin with a lower-case letter and contain only lower-case letters, digits, _, $, (, ), +, or -",
    );
  }
  return trimmed;
}

function basicAuthorisation(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

async function requestWithRetry(
  dependencies: ProvisioningDependencies,
  label: string,
  url: string,
  init: RequestInit,
  accept: (response: Response, body: string) => boolean,
  retryCount: number,
  retryDelayMs: number,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const response = await dependencies.fetch(url, init);
      const body = await response.text();
      if (accept(response, body)) return;
      const error = new Error(
        `${label} failed with HTTP ${response.status}: ${body}`,
      );
      if (response.status < 500) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (
        error instanceof Error &&
        error.message.startsWith(`${label} failed with HTTP 4`)
      ) {
        throw error;
      }
    }
    if (attempt < retryCount) await dependencies.sleep(retryDelayMs);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} failed after ${retryCount} attempts`);
}

export async function initialiseLiveSyncDatabaseVersion(
  databaseURL: string,
  username: string,
  password: string,
): Promise<void> {
  const database = new PouchDB(databaseURL, {
    adapter: "http",
    auth: { username, password },
    skip_setup: true,
  });
  try {
    const compatible = await checkRemoteVersion(
      database,
      async () => false,
    );
    if (!compatible) {
      throw new Error(
        "the remote database uses an incompatible LiveSync database version",
      );
    }
  } finally {
    await database.close();
  }
}

export async function provisionCouchDB(
  options: CouchDBProvisioningOptions,
  overrides: Partial<ProvisioningDependencies> = {},
): Promise<void> {
  const hostname = normaliseHostname(options.hostname);
  const username = requireValue(options.username, "username");
  const password = requireValue(options.password, "password");
  const node = encodeURIComponent(options.node?.trim() || "_local");
  const origins = options.origins?.trim() || DEFAULT_ORIGINS;
  const retryCount = options.retryCount ?? 12;
  const retryDelayMs = options.retryDelayMs ?? 5_000;
  if (!Number.isInteger(retryCount) || retryCount < 1) {
    throw new Error("retryCount must be a positive integer");
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new Error("retryDelayMs must be zero or greater");
  }

  const dependencies: ProvisioningDependencies = {
    fetch,
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    initialiseDatabaseVersion: initialiseLiveSyncDatabaseVersion,
    ...overrides,
  };
  const headers = {
    "Content-Type": "application/json",
    Authorization: basicAuthorisation(username, password),
  };
  const configure = async (
    label: string,
    path: string,
    body: string,
    method = "PUT",
    accept: (response: Response, body: string) => boolean = (response) =>
      response.ok,
  ) =>
    await requestWithRetry(
      dependencies,
      label,
      `${hostname}${path}`,
      { method, headers, body },
      accept,
      retryCount,
      retryDelayMs,
    );

  await configure(
    "single-node cluster setup",
    "/_cluster_setup",
    JSON.stringify({
      action: "enable_single_node",
      username,
      password,
      bind_address: "0.0.0.0",
      port: 5984,
      singlenode: true,
    }),
    "POST",
    (response, body) =>
      response.ok ||
      ((response.status === 400 || response.status === 409) &&
        /already|finished/i.test(body)),
  );

  const settings: Array<[string, string, string]> = [
    ["require authenticated HTTP users", "chttpd/require_valid_user", '"true"'],
    [
      "require authenticated HTTP users for authentication",
      "chttpd_auth/require_valid_user",
      '"true"',
    ],
    [
      "set the HTTP authentication challenge",
      "httpd/WWW-Authenticate",
      '"Basic realm=\\"couchdb\\""',
    ],
    ["enable HTTP CORS", "httpd/enable_cors", '"true"'],
    ["enable clustered HTTP CORS", "chttpd/enable_cors", '"true"'],
    [
      "set the maximum HTTP request size",
      "chttpd/max_http_request_size",
      '"4294967296"',
    ],
    [
      "set the maximum document size",
      "couchdb/max_document_size",
      '"50000000"',
    ],
    ["enable CORS credentials", "cors/credentials", '"true"'],
    ["set allowed CORS origins", "cors/origins", JSON.stringify(origins)],
  ];
  for (const [label, key, body] of settings) {
    await configure(label, `/_node/${node}/_config/${key}`, body);
  }

  if (options.database?.trim()) {
    const database = validateDatabaseName(options.database);
    const databaseURL = `${hostname}/${encodeURIComponent(database)}`;
    await requestWithRetry(
      dependencies,
      "create database",
      databaseURL,
      { method: "PUT", headers },
      (response) => response.ok || response.status === 412,
      retryCount,
      retryDelayMs,
    );
    await dependencies.initialiseDatabaseVersion(
      databaseURL,
      username,
      password,
    );
  }
}

function optionalNumber(name: string): number | undefined {
  const value = Deno.env.get(name)?.trim();
  return value ? Number(value) : undefined;
}

if (import.meta.main) {
  await provisionCouchDB({
    hostname: Deno.env.get("hostname") ?? "",
    username: Deno.env.get("username") ?? "",
    password: Deno.env.get("password") ?? "",
    node: Deno.env.get("node"),
    database: Deno.env.get("database"),
    origins: Deno.env.get("origins"),
    retryCount: optionalNumber("retry_count"),
    retryDelayMs: optionalNumber("retry_delay_ms"),
  });
  console.log("CouchDB provisioning completed.");
}
