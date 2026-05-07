/**
 * Docker service management for tests.
 *
 * CouchDB start/stop/init is implemented directly using `docker` CLI commands
 * and the Fetch API, so it works on any platform where Docker (Desktop) is
 * available — including Windows — without needing bash.
 */

type DockerInvoker = {
    bin: string;
    prefix: string[];
    label: string;
};

let dockerInvokerPromise: Promise<DockerInvoker> | null = null;
const DOCKER_TEE = Deno.env.get("LIVESYNC_DOCKER_TEE") === "1" || Deno.env.get("LIVESYNC_TEST_TEE") === "1";

// ---------------------------------------------------------------------------
// Low-level docker wrapper
// ---------------------------------------------------------------------------

function parseCommand(command: string): { bin: string; prefix: string[] } {
    const parts = command.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
        throw new Error("LIVESYNC_DOCKER_COMMAND is empty");
    }
    return { bin: parts[0], prefix: parts.slice(1) };
}

async function runCommand(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const cmd = new Deno.Command(bin, {
        args,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
    });
    try {
        const { code, stdout, stderr } = await cmd.output();
        const dec = new TextDecoder();
        const result = {
            code,
            stdout: dec.decode(stdout),
            stderr: dec.decode(stderr),
        };
        if (DOCKER_TEE) {
            if (result.stdout.trim().length > 0) {
                console.log(`[docker:${bin}] ${result.stdout.trimEnd()}`);
            }
            if (result.stderr.trim().length > 0) {
                console.error(`[docker:${bin}] ${result.stderr.trimEnd()}`);
            }
        }
        return result;
    } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
            return {
                code: 127,
                stdout: "",
                stderr: `Command not found: ${bin}`,
            };
        }
        throw err;
    }
}

async function resolveDockerInvoker(): Promise<DockerInvoker> {
    const custom = Deno.env.get("LIVESYNC_DOCKER_COMMAND")?.trim();
    if (custom) {
        const parsed = parseCommand(custom);
        const runner: DockerInvoker = {
            ...parsed,
            label: `custom(${custom})`,
        };

        // Validate custom command eagerly so misconfiguration fails fast.
        const checkArgs = runner.prefix.length === 0 ? ["--version"] : [...runner.prefix, "docker", "--version"];
        const check = await runCommand(runner.bin, checkArgs);
        if (check.code !== 0) {
            throw new Error(`LIVESYNC_DOCKER_COMMAND is not usable: ${custom}\n${check.stderr || check.stdout}`);
        }
        return runner;
    }

    const mode = (Deno.env.get("LIVESYNC_DOCKER_MODE") ?? "auto").toLowerCase();
    const onWindows = Deno.build.os === "windows";

    const native: DockerInvoker = { bin: "docker", prefix: [], label: "docker" };
    const wsl: DockerInvoker = { bin: "wsl", prefix: [], label: "wsl docker" };

    if (mode === "native") {
        return native;
    }
    if (mode === "wsl") {
        return wsl;
    }
    if (mode !== "auto") {
        throw new Error(`Unsupported LIVESYNC_DOCKER_MODE='${mode}'. Use auto, native, or wsl.`);
    }

    // On Windows we prefer `wsl docker` first, then native docker.
    // This typically works better in setups where Docker is installed only in
    // WSL and not exposed as docker.exe on PATH.
    const candidates = onWindows ? [wsl, native] : [native, wsl];
    for (const c of candidates) {
        if (c.bin === "docker") {
            const r = await runCommand("docker", ["--version"]);
            if (r.code === 0) return c;
            continue;
        }
        const r = await runCommand("wsl", ["docker", "--version"]);
        if (r.code === 0) return c;
    }

    throw new Error(
        [
            "Docker command is not available.",
            "Set one of:",
            "- LIVESYNC_DOCKER_MODE=native",
            "- LIVESYNC_DOCKER_MODE=wsl",
            "- LIVESYNC_DOCKER_COMMAND='docker'",
            "- LIVESYNC_DOCKER_COMMAND='wsl docker'",
        ].join("\n")
    );
}

async function getDockerInvoker(): Promise<DockerInvoker> {
    if (!dockerInvokerPromise) {
        dockerInvokerPromise = resolveDockerInvoker().then((r) => {
            console.log(`[INFO] docker runner: ${r.label}`);
            return r;
        });
    }
    return await dockerInvokerPromise;
}

async function docker(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const invoker = await getDockerInvoker();

    // Either:
    //   docker <args>
    // Or:
    //   wsl docker <args>
    const finalArgs =
        invoker.prefix.length === 0
            ? invoker.bin === "wsl"
                ? ["docker", ...args]
                : args
            : [...invoker.prefix, ...args];

    const r = await runCommand(invoker.bin, finalArgs);
    return { code: r.code, stdout: r.stdout, stderr: r.stderr };
}

async function dockerOrFail(...args: string[]): Promise<string> {
    const r = await docker(...args);
    if (r.code !== 0) {
        throw new Error(`docker ${args[0]} failed (code ${r.code}): ${r.stderr.trim()}`);
    }
    return r.stdout;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCouchdbStable(hostname: string, user: string, password: string): Promise<void> {
    const h = hostname.replace(/\/$/, "").replace("localhost", "127.0.0.1");
    const auth = btoa(`${user}:${password}`);
    const headers = { Authorization: `Basic ${auth}` };
    let consecutive = 0;
    for (let i = 0; i < 30; i++) {
        try {
            const r = await fetch(`${h}/_up`, {
                headers,
                signal: AbortSignal.timeout(3000),
            });
            if (r.ok) {
                consecutive++;
                if (consecutive >= 3) return;
            } else {
                consecutive = 0;
            }
        } catch {
            consecutive = 0;
        }
        await sleep(500);
    }
    throw new Error("CouchDB did not become stable in time");
}

// ---------------------------------------------------------------------------
// Fetch with retry (mirrors cli_test_curl_json() retry loop)
// ---------------------------------------------------------------------------

async function fetchRetry(
    url: string,
    init: RequestInit,
    retries = 30,
    delayMs = 2000,
    allowStatus: number[] = []
): Promise<void> {
    let lastError: unknown;
    let lastStatus: number | undefined;
    for (let i = 0; i < retries; i++) {
        try {
            const r = await fetch(url, {
                signal: AbortSignal.timeout(5000),
                ...init,
            });
            lastStatus = r.status;
            await r.body?.cancel().catch(() => {});
            if (r.ok || allowStatus.includes(r.status)) return;
            lastError = `HTTP ${r.status}`;
        } catch (e) {
            lastError = e;
        }
        await sleep(delayMs);
    }
    throw new Error(
        `Could not reach ${url} after ${retries} retries: ${lastError} (last status: ${lastStatus ?? "N/A"})`
    );
}

// ---------------------------------------------------------------------------
// CouchDB
// ---------------------------------------------------------------------------
//
// TODO: these values could be configurable via environment variables.
//
const COUCHDB_CONTAINER = "couchdb-test";
const COUCHDB_IMAGE = "couchdb:3.5.0";

const MINIO_CONTAINER = "minio-test";
const MINIO_IMAGE = "minio/minio";
const MINIO_MC_IMAGE = "minio/mc";

export async function stopCouchdb(): Promise<void> {
    await docker("stop", COUCHDB_CONTAINER);
    await docker("rm", COUCHDB_CONTAINER);
}

/**
 * Start a CouchDB test container, initialise it, and create the test DB.
 * Mirrors cli_test_start_couchdb() from test-helpers.sh, using direct
 * docker / fetch calls instead of the bash util scripts.
 */
export async function startCouchdb(couchdbUri: string, user: string, password: string, dbname: string): Promise<void> {
    console.log("[INFO] stopping leftover CouchDB container if present");
    await stopCouchdb().catch(() => {});

    console.log("[INFO] starting CouchDB test container");
    await dockerOrFail(
        "run",
        "-d",
        "--name",
        COUCHDB_CONTAINER,
        "-p",
        // TODO: port mapping should be configurable.
        "5989:5984",
        "-e",
        `COUCHDB_USER=${user}`,
        "-e",
        `COUCHDB_PASSWORD=${password}`,
        "-e",
        "COUCHDB_SINGLE_NODE=y",
        COUCHDB_IMAGE
    );

    console.log("[INFO] initialising CouchDB");
    await initCouchdb(couchdbUri, user, password);

    console.log("[INFO] waiting for CouchDB to become stable");
    await waitForCouchdbStable(couchdbUri, user, password);

    console.log(`[INFO] creating test database: ${dbname}`);
    await createCouchdbDatabase(couchdbUri, user, password, dbname);
}

/**
 * Mirror couchdb-init.sh: configure single-node CouchDB via its REST API.
 */
async function initCouchdb(hostname: string, user: string, password: string, node = "_local"): Promise<void> {
    // Podman environments often resolve localhost to ::1; use 127.0.0.1 like
    // the bash script does.
    const h = hostname.replace(/\/$/, "").replace("localhost", "127.0.0.1");
    const auth = btoa(`${user}:${password}`);
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
    };

    const calls: Array<[string, string, string]> = [
        [
            "POST",
            `${h}/_cluster_setup`,
            JSON.stringify({
                action: "enable_single_node",
                username: user,
                password,
                bind_address: "0.0.0.0",
                port: 5984,
                singlenode: true,
            }),
        ],
        ["PUT", `${h}/_node/${node}/_config/chttpd/require_valid_user`, '"true"'],
        ["PUT", `${h}/_node/${node}/_config/chttpd_auth/require_valid_user`, '"true"'],
        ["PUT", `${h}/_node/${node}/_config/httpd/WWW-Authenticate`, '"Basic realm=\\"couchdb\\""'],
        ["PUT", `${h}/_node/${node}/_config/httpd/enable_cors`, '"true"'],
        ["PUT", `${h}/_node/${node}/_config/chttpd/enable_cors`, '"true"'],
        ["PUT", `${h}/_node/${node}/_config/chttpd/max_http_request_size`, '"4294967296"'],
        ["PUT", `${h}/_node/${node}/_config/couchdb/max_document_size`, '"50000000"'],
        ["PUT", `${h}/_node/${node}/_config/cors/credentials`, '"true"'],
        ["PUT", `${h}/_node/${node}/_config/cors/origins`, '"*"'],
    ];

    for (const [method, url, body] of calls) {
        await fetchRetry(url, { method, headers, body });
    }
}

export async function createCouchdbDatabase(
    hostname: string,
    user: string,
    password: string,
    dbname: string
): Promise<void> {
    const h = hostname.replace(/\/$/, "").replace("localhost", "127.0.0.1");
    const auth = btoa(`${user}:${password}`);
    await fetchRetry(`${h}/${dbname}`, {
        method: "PUT",
        headers: { Authorization: `Basic ${auth}` },
    });
}

/** Update a CouchDB document via PUT. Returns the updated document. */
export async function updateCouchdbDoc(
    hostname: string,
    user: string,
    password: string,
    docUrl: string,
    updater: (doc: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
    const h = hostname.replace(/\/$/, "").replace("localhost", "127.0.0.1");
    const auth = btoa(`${user}:${password}`);
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
    };
    const getRes = await fetch(`${h}/${docUrl}`, { headers });
    const current = (await getRes.json()) as Record<string, unknown>;
    const updated = updater(current);
    await fetchRetry(`${h}/${docUrl}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(updated),
    });
}

// ---------------------------------------------------------------------------
// MinIO
// ---------------------------------------------------------------------------

function shQuote(value: string): string {
    return `'${value.split("'").join(`'"'"'`)}'`;
}

export async function stopMinio(): Promise<void> {
    await docker("stop", MINIO_CONTAINER);
    await docker("rm", MINIO_CONTAINER);
}

async function initMinioBucket(
    minioEndpoint: string,
    accessKey: string,
    secretKey: string,
    bucket: string
): Promise<boolean> {
    const cmd =
        `mc alias set myminio ${shQuote(minioEndpoint)} ${shQuote(accessKey)} ${shQuote(secretKey)} >/dev/null 2>&1 && ` +
        `mc mb --ignore-existing myminio/${shQuote(bucket)} >/dev/null 2>&1`;
    const r = await docker("run", "--rm", "--network", "host", "--entrypoint", "/bin/sh", MINIO_MC_IMAGE, "-c", cmd);
    return r.code === 0;
}

async function waitForMinioBucket(
    minioEndpoint: string,
    accessKey: string,
    secretKey: string,
    bucket: string
): Promise<void> {
    for (let i = 0; i < 30; i++) {
        const checkCmd =
            `mc alias set myminio ${shQuote(minioEndpoint)} ${shQuote(accessKey)} ${shQuote(secretKey)} >/dev/null 2>&1 && ` +
            `mc ls myminio/${shQuote(bucket)} >/dev/null 2>&1`;
        const check = await docker(
            "run",
            "--rm",
            "--network",
            // Now I used host networking to access the container via localhost for some environments (Docker Desktop on Windows).
            // We need something good idea to work across all environments.
            "host",
            "--entrypoint",
            "/bin/sh",
            MINIO_MC_IMAGE,
            "-c",
            checkCmd
        );
        if (check.code === 0) {
            return;
        }
        await initMinioBucket(minioEndpoint, accessKey, secretKey, bucket);
        await sleep(2000);
    }
    throw new Error(`MinIO bucket not ready: ${bucket}`);
}

export async function startMinio(
    minioEndpoint: string,
    accessKey: string,
    secretKey: string,
    bucket: string
): Promise<void> {
    console.log("[INFO] stopping leftover MinIO container if present");
    await stopMinio().catch(() => {});

    console.log("[INFO] starting MinIO test container");
    await dockerOrFail(
        "run",
        "-d",
        "--name",
        MINIO_CONTAINER,
        // TODO: Ports should be configurable.
        "-p",
        "9000:9000",
        "-p",
        "9001:9001",
        "-e",
        `MINIO_ROOT_USER=${accessKey}`,
        "-e",
        `MINIO_ROOT_PASSWORD=${secretKey}`,
        "-e",
        `MINIO_SERVER_URL=${minioEndpoint}`,
        MINIO_IMAGE,
        "server",
        "/data",
        "--console-address",
        ":9001"
    );

    console.log(`[INFO] initialising MinIO test bucket: ${bucket}`);
    let initialised = false;
    for (let i = 0; i < 5; i++) {
        if (await initMinioBucket(minioEndpoint, accessKey, secretKey, bucket)) {
            initialised = true;
            break;
        }
        await sleep(2000);
    }
    if (!initialised) {
        throw new Error(`Could not initialise MinIO bucket after retries: ${bucket}`);
    }

    await waitForMinioBucket(minioEndpoint, accessKey, secretKey, bucket);
}

// ---------------------------------------------------------------------------
// P2P relay (strfry)
// ---------------------------------------------------------------------------
// TODO: these values could be configurable via environment variables.
const P2P_RELAY_CONTAINER = "relay-test";
const P2P_RELAY_IMAGE = "ghcr.io/hoytech/strfry:latest";
const STRFRY_BOOTSTRAP_SH = String.raw`cat > /tmp/strfry.conf <<"EOF"
db = "./strfry-db/"

relay {
  bind = "0.0.0.0"
  port = 7777
  nofiles = 100000

  info {
    name = "livesync test relay"
    description = "local relay for livesync p2p tests"
  }

  maxWebsocketPayloadSize = 131072
  autoPingSeconds = 55

  writePolicy {
    plugin = ""
  }
}
EOF
exec /app/strfry --config /tmp/strfry.conf relay`;

export async function stopP2pRelay(): Promise<void> {
    await docker("stop", P2P_RELAY_CONTAINER);
    await docker("rm", P2P_RELAY_CONTAINER);
}

/**
 * Start the local P2P relay container through the same docker runner used
 * by CouchDB helpers. This keeps process ownership consistent across
 * start/stop on Windows, WSL, and native Linux/macOS.
 */
export async function startP2pRelay(): Promise<void> {
    console.log("[INFO] stopping leftover P2P relay container if present");
    await stopP2pRelay().catch(() => {});

    console.log("[INFO] starting local P2P relay container");
    await dockerOrFail(
        "run",
        "-d",
        "--name",
        P2P_RELAY_CONTAINER,
        "-p",
        //TODO: port mapping should be configurable.
        "4000:7777",
        "--tmpfs",
        "/app/strfry-db:rw,size=256m",
        "--entrypoint",
        "sh",
        P2P_RELAY_IMAGE,
        "-lc",
        STRFRY_BOOTSTRAP_SH
    );
}

export function isLocalP2pRelay(relayUrl: string): boolean {
    return relayUrl === "ws://localhost:4000" || relayUrl === "ws://localhost:4000/";
}
