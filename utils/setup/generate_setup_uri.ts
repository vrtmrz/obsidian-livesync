import { encodeSettingsToSetupURI } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/compat/API/processSetting";
import { generateP2PRoomId } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/compat/common/utils";
import { upsertRemoteConfigurationInPlace } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/remote-configurations";
import {
  createNewVaultSettings,
  type ObsidianLiveSyncSettings,
  P2P_DEFAULT_SETTINGS,
  PREFERRED_BASE,
  PREFERRED_JOURNAL_SYNC,
  PREFERRED_SETTING_SELF_HOSTED,
} from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/settings";

export type SetupRemoteType = "couchdb" | "s3" | "p2p";
export type SetupGeneratorEnvironment = Readonly<
  Record<string, string | undefined>
>;

export interface GeneratedSetupURI {
  remoteType: SetupRemoteType;
  setupURI: string;
  setupPassphrase: string;
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
  const { remoteType, settings } = createSetupSettings(environment);
  const setupURI = await encodeSettingsToSetupURI(settings, setupPassphrase, [
    "pluginSyncExtendedSetting",
    "doNotUseFixedRevisionForChunks",
  ], true);
  return { remoteType, setupURI: setupURI.trim(), setupPassphrase };
}

export async function runSetupURIGenerator(
  environment: SetupGeneratorEnvironment = Deno.env.toObject(),
): Promise<void> {
  const generated = await generateSetupURI(environment);
  console.log(`\nGenerated ${generated.remoteType} Setup URI.`);
  console.log(
    "Your passphrase for the Setup URI is:",
    generated.setupPassphrase,
  );
  console.log("This passphrase is never shown again, so store it safely.");
  console.log(generated.setupURI);
}

if (import.meta.main) await runSetupURIGenerator();
