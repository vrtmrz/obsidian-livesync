import { join } from "@std/path";
import { CLI_DIR, runCliOrFail } from "./cli.ts";

// ---------------------------------------------------------------------------
// Settings file initialisation
// ---------------------------------------------------------------------------

/** Generate a default settings file using the CLI's init-settings command. */
export async function initSettingsFile(settingsFile: string): Promise<void> {
    await runCliOrFail("init-settings", "--force", settingsFile);
}

/**
 * Generate a full setup URI from a settings file via src/lib API.
 * Mirrors the bash flow in test-setup-put-cat-linux.sh.
 */
export async function generateSetupUriFromSettings(settingsFile: string, setupPassphrase: string): Promise<string> {
    const repoRoot = join(CLI_DIR, "..", "..", "..");
    const script = [
        "import fs from 'node:fs';",
        "import { pathToFileURL } from 'node:url';",
        "(async () => {",
        "  const modulePath = process.env.REPO_ROOT + '/src/lib/src/API/processSetting.ts';",
        "  const moduleUrl = pathToFileURL(modulePath).href;",
        "  const { encodeSettingsToSetupURI } = await import(moduleUrl);",
        "  const settingsPath = process.env.SETTINGS_FILE;",
        "  const passphrase = process.env.SETUP_PASSPHRASE;",
        "  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));",
        "  settings.couchDB_DBNAME = 'setup-put-cat-db';",
        "  settings.couchDB_URI = 'http://127.0.0.1:5999';",
        "  settings.couchDB_USER = 'dummy';",
        "  settings.couchDB_PASSWORD = 'dummy';",
        "  settings.liveSync = false;",
        "  settings.syncOnStart = false;",
        "  settings.syncOnSave = false;",
        "  const uri = await encodeSettingsToSetupURI(settings, passphrase);",
        "  process.stdout.write(uri.trim());",
        "})();",
    ].join("\n");

    const scriptPath = await Deno.makeTempFile({
        prefix: "livesync-setup-uri-",
        suffix: ".mts",
    });
    await Deno.writeTextFile(scriptPath, script);

    try {
        const cmd = new Deno.Command("npx", {
            args: ["tsx", scriptPath],
            cwd: CLI_DIR,
            env: {
                REPO_ROOT: repoRoot,
                SETTINGS_FILE: settingsFile,
                SETUP_PASSPHRASE: setupPassphrase,
            },
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
        });

        const { code, stdout, stderr } = await cmd.output();
        const dec = new TextDecoder();
        if (code !== 0) {
            throw new Error(
                `Failed to generate setup URI (code ${code})\nstdout: ${dec.decode(stdout)}\nstderr: ${dec.decode(stderr)}`
            );
        }

        const uri = dec.decode(stdout).trim();
        if (!uri) {
            throw new Error("Failed to generate setup URI: output is empty");
        }
        return uri;
    } finally {
        await Deno.remove(scriptPath).catch(() => {});
    }
}

/** Set isConfigured=true in a settings file (required for mirror / scan). */
export async function markSettingsConfigured(settingsFile: string): Promise<void> {
    const data = JSON.parse(await Deno.readTextFile(settingsFile));
    data.isConfigured = true;
    await Deno.writeTextFile(settingsFile, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// CouchDB remote settings
// ---------------------------------------------------------------------------

/**
 * Apply CouchDB connection details to a settings file.
 * Mirrors cli_test_apply_couchdb_settings() from test-helpers.sh.
 */
export async function applyCouchdbSettings(
    settingsFile: string,
    couchdbUri: string,
    couchdbUser: string,
    couchdbPassword: string,
    couchdbDbname: string,
    liveSync = false
): Promise<void> {
    const data = JSON.parse(await Deno.readTextFile(settingsFile));
    data.couchDB_URI = couchdbUri;
    data.couchDB_USER = couchdbUser;
    data.couchDB_PASSWORD = couchdbPassword;
    data.couchDB_DBNAME = couchdbDbname;
    if (liveSync) {
        data.liveSync = true;
        data.syncOnStart = false;
        data.syncOnSave = false;
        data.usePluginSync = false;
    }
    data.isConfigured = true;
    await Deno.writeTextFile(settingsFile, JSON.stringify(data, null, 2));
}

export async function applyRemoteSyncSettings(
    settingsFile: string,
    options: {
        remoteType: "COUCHDB" | "MINIO";
        couchdbUri?: string;
        couchdbUser?: string;
        couchdbPassword?: string;
        couchdbDbname?: string;
        minioBucket?: string;
        minioEndpoint?: string;
        minioAccessKey?: string;
        minioSecretKey?: string;
        encrypt?: boolean;
        passphrase?: string;
    }
): Promise<void> {
    const data = JSON.parse(await Deno.readTextFile(settingsFile));

    if (options.remoteType === "COUCHDB") {
        data.remoteType = "";
        data.couchDB_URI = options.couchdbUri;
        data.couchDB_USER = options.couchdbUser;
        data.couchDB_PASSWORD = options.couchdbPassword;
        data.couchDB_DBNAME = options.couchdbDbname;
    } else {
        data.remoteType = "MINIO";
        data.bucket = options.minioBucket;
        data.endpoint = options.minioEndpoint;
        data.accessKey = options.minioAccessKey;
        data.secretKey = options.minioSecretKey;
        data.region = "auto";
        data.forcePathStyle = true;
    }

    data.liveSync = true;
    data.syncOnStart = false;
    data.syncOnSave = false;
    data.usePluginSync = false;
    data.encrypt = options.encrypt === true;
    data.passphrase = options.encrypt ? (options.passphrase ?? "") : "";
    data.isConfigured = true;
    await Deno.writeTextFile(settingsFile, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// P2P settings
// ---------------------------------------------------------------------------

/**
 * Apply P2P connection details to a settings file.
 * Mirrors cli_test_apply_p2p_settings() from test-helpers.sh.
 */
export async function applyP2pSettings(
    settingsFile: string,
    roomId: string,
    passphrase: string,
    appId = "self-hosted-livesync-cli-tests",
    relays = "ws://localhost:4000/",
    autoAccept = "~.*"
): Promise<void> {
    const data = JSON.parse(await Deno.readTextFile(settingsFile));
    data.P2P_Enabled = true;
    data.P2P_AutoStart = false;
    data.P2P_AutoBroadcast = false;
    data.P2P_AppID = appId;
    data.P2P_roomID = roomId;
    data.P2P_passphrase = passphrase;
    data.P2P_relays = relays;
    data.P2P_AutoAcceptingPeers = autoAccept;
    data.P2P_AutoDenyingPeers = "";
    data.P2P_IsHeadless = true;
    data.isConfigured = true;
    await Deno.writeTextFile(settingsFile, JSON.stringify(data, null, 2));
}

export async function applyP2pTestTweaks(settingsFile: string, deviceName: string, passphrase: string): Promise<void> {
    const data = JSON.parse(await Deno.readTextFile(settingsFile));
    data.remoteType = "ONLY_P2P";
    data.encrypt = true;
    data.passphrase = passphrase;
    data.usePathObfuscation = true;
    data.handleFilenameCaseSensitive = false;
    data.customChunkSize = 50;
    data.usePluginSyncV2 = true;
    data.doNotUseFixedRevisionForChunks = false;
    data.P2P_DevicePeerName = deviceName;
    data.isConfigured = true;
    await Deno.writeTextFile(settingsFile, JSON.stringify(data, null, 2));
}
