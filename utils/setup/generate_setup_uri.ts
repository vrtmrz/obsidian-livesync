import {
  createNewVaultSettings,
  encodeTimeBoundSetupURI,
  generateP2PRoomId,
  isTimeBoundSetupURIUsableNow,
  type ObsidianLiveSyncSettings,
  P2P_DEFAULT_SETTINGS,
  PREFERRED_BASE,
  PREFERRED_JOURNAL_SYNC,
  PREFERRED_SETTING_SELF_HOSTED,
  type TimeBoundSetupURIMode,
  upsertRemoteConfigurationInPlace,
} from "./livesync-commonlib.ts";

export type SetupRemoteType = "couchdb" | "s3" | "p2p";
export type SetupGeneratorEnvironment = Readonly<
  Record<string, string | undefined>
>;

export interface GeneratedSetupURI {
  remoteType: SetupRemoteType;
  setupURI: string;
  setupPassphrase: string;
  mode: TimeBoundSetupURIMode;
  usableUntil: number | null;
  idRecoveryCode?: string;
}

const ID_RECOVERY_CODE_PREFIX = "sls-id-v1:";
const ID_RECOVERY_CODE_PATTERN = /^sls-id-v1:([0-9a-f]{64})$/u;

function generateRandomIdKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function configureIdDerivation(
  settings: ObsidianLiveSyncSettings,
  environment: SetupGeneratorEnvironment,
): string | undefined {
  const mode = environment.id_mode?.trim().toLowerCase() || "random";
  if (mode !== "random" && mode !== "legacy") {
    throw new Error("id_mode must be random or legacy");
  }
  const suppliedCode = environment.id_recovery_code?.trim();
  if (mode === "legacy") {
    if (suppliedCode) {
      throw new Error("id_recovery_code cannot be used with id_mode=legacy");
    }
    return undefined;
  }
  const key = suppliedCode
    ? ID_RECOVERY_CODE_PATTERN.exec(suppliedCode)?.[1]
    : generateRandomIdKey();
  if (!key) {
    throw new Error("id_recovery_code must be a valid sls-id-v1 recovery code");
  }
  Object.assign(settings, { idDerivationVersion: 1, idDerivationKey: key });
  return `${ID_RECOVERY_CODE_PREFIX}${key}`;
}

function requireValue(
  environment: SetupGeneratorEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalBoolean(
  environment: SetupGeneratorEnvironment,
  name: string,
  fallback: boolean,
): boolean {
  const value = environment[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be true, false, 1, or 0`);
}

export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replace(/=+$/, "");
}

function applyEncryptedVaultSettings(
  settings: ObsidianLiveSyncSettings,
  environment: SetupGeneratorEnvironment,
): void {
  Object.assign(settings, {
    isConfigured: true,
    encrypt: true,
    passphrase: requireValue(environment, "passphrase"),
    usePathObfuscation: true,
  });
}

function createCouchDBSettings(
  environment: SetupGeneratorEnvironment,
): ObsidianLiveSyncSettings {
  const settings = createNewVaultSettings();
  Object.assign(settings, PREFERRED_SETTING_SELF_HOSTED, {
    couchDB_URI: requireValue(environment, "hostname"),
    couchDB_USER: requireValue(environment, "username"),
    couchDB_PASSWORD: requireValue(environment, "password"),
    couchDB_DBNAME: requireValue(environment, "database"),
    batchSave: true,
    periodicReplication: true,
    syncOnStart: true,
    syncOnFileOpen: true,
    syncAfterMerge: true,
  });
  applyEncryptedVaultSettings(settings, environment);
  upsertRemoteConfigurationInPlace(settings, "couchdb", { activate: true });
  return settings;
}

function createObjectStorageSettings(
  environment: SetupGeneratorEnvironment,
): ObsidianLiveSyncSettings {
  const settings = createNewVaultSettings();
  Object.assign(settings, PREFERRED_JOURNAL_SYNC, {
    endpoint: requireValue(environment, "endpoint"),
    accessKey: requireValue(environment, "access_key"),
    secretKey: requireValue(environment, "secret_key"),
    bucket: requireValue(environment, "bucket"),
    region: environment.region?.trim() || "auto",
    bucketPrefix: environment.bucket_prefix?.trim() || "",
    bucketCustomHeaders: environment.bucket_custom_headers?.trim() || "",
    useCustomRequestHandler: optionalBoolean(
      environment,
      "use_custom_request_handler",
      false,
    ),
    forcePathStyle: optionalBoolean(environment, "force_path_style", true),
    liveSync: true,
  });
  applyEncryptedVaultSettings(settings, environment);
  upsertRemoteConfigurationInPlace(settings, "s3", { activate: true });
  return settings;
}

function createP2PSettings(
  environment: SetupGeneratorEnvironment,
): ObsidianLiveSyncSettings {
  const settings = createNewVaultSettings();
  Object.assign(settings, PREFERRED_BASE, P2P_DEFAULT_SETTINGS, {
    P2P_Enabled: true,
    P2P_roomID: environment.p2p_room_id?.trim() || generateP2PRoomId(),
    P2P_passphrase: environment.p2p_passphrase?.trim() || generateSecret(),
    P2P_relays: environment.p2p_relays?.trim() ||
      P2P_DEFAULT_SETTINGS.P2P_relays,
    P2P_AppID: environment.p2p_app_id?.trim() || P2P_DEFAULT_SETTINGS.P2P_AppID,
    P2P_AutoStart: optionalBoolean(
      environment,
      "p2p_auto_start",
      P2P_DEFAULT_SETTINGS.P2P_AutoStart,
    ),
    P2P_AutoBroadcast: optionalBoolean(
      environment,
      "p2p_auto_broadcast",
      P2P_DEFAULT_SETTINGS.P2P_AutoBroadcast,
    ),
  });
  applyEncryptedVaultSettings(settings, environment);
  upsertRemoteConfigurationInPlace(settings, "p2p", {
    activate: true,
    activateForP2P: true,
  });
  return settings;
}

function parseRemoteType(
  environment: SetupGeneratorEnvironment,
): SetupRemoteType {
  const remoteType = environment.remote_type?.trim().toLowerCase() || "couchdb";
  if (remoteType === "couchdb" || remoteType === "s3" || remoteType === "p2p") {
    return remoteType;
  }
  throw new Error("remote_type must be couchdb, s3, or p2p");
}

function parseSetupURIMode(
  environment: SetupGeneratorEnvironment,
): TimeBoundSetupURIMode {
  const mode = environment.uri_mode?.trim().toLowerCase() || "ephemeral";
  if (mode === "ephemeral" || mode === "persistent") return mode;
  throw new Error("uri_mode must be ephemeral or persistent");
}

export function createSetupSettings(
  environment: SetupGeneratorEnvironment,
): { remoteType: SetupRemoteType; settings: ObsidianLiveSyncSettings } {
  const remoteType = parseRemoteType(environment);
  if (remoteType === "couchdb") {
    return { remoteType, settings: createCouchDBSettings(environment) };
  }
  if (remoteType === "s3") {
    return { remoteType, settings: createObjectStorageSettings(environment) };
  }
  return { remoteType, settings: createP2PSettings(environment) };
}

export async function generateSetupURI(
  environment: SetupGeneratorEnvironment,
): Promise<GeneratedSetupURI> {
  const setupPassphrase = environment.uri_passphrase?.trim() ||
    generateSecret();
  const mode = parseSetupURIMode(environment);
  const { remoteType, settings } = createSetupSettings(environment);
  const idRecoveryCode = configureIdDerivation(settings, environment);
  const { uri, usableUntil } = await encodeTimeBoundSetupURI(
    settings,
    setupPassphrase,
    {
      mode,
      removeProperties: [
        "pluginSyncExtendedSetting",
        "doNotUseFixedRevisionForChunks",
      ],
      skipDefaultValue: true,
    },
  );
  if (!isTimeBoundSetupURIUsableNow(usableUntil)) {
    throw new Error("Setup URI time window changed during generation");
  }
  return {
    remoteType,
    setupURI: uri.trim(),
    setupPassphrase,
    mode,
    usableUntil,
    idRecoveryCode,
  };
}

export async function runSetupURIGenerator(
  environment: SetupGeneratorEnvironment = Deno.env.toObject(),
): Promise<void> {
  let generated = await generateSetupURI(environment);
  if (!isTimeBoundSetupURIUsableNow(generated.usableUntil)) {
    generated = await generateSetupURI(environment);
  }
  if (!isTimeBoundSetupURIUsableNow(generated.usableUntil)) {
    throw new Error("Setup URI time window changed before it could be shown");
  }
  console.log(`\nGenerated ${generated.remoteType} Setup URI.`);
  if (generated.usableUntil === null) {
    console.log(
      "Persistent: no time condition. Older clients can open this format.",
    );
  } else {
    console.log(
      `Ephemeral: usable until ${
        new Date(generated.usableUntil).toISOString()
      } (UTC).`,
    );
  }
  console.log(
    "Your passphrase for the Setup URI is:",
    generated.setupPassphrase,
  );
  console.log("This passphrase is never shown again, so store it safely.");
  if (generated.idRecoveryCode) {
    console.log("ID recovery code:", generated.idRecoveryCode);
    console.log(
      "Use id_recovery_code with this value and reuse the same remote settings when generating another Setup URI for the same Vault.",
    );
  }
  console.log(generated.setupURI);
}

if (import.meta.main) await runSetupURIGenerator();
