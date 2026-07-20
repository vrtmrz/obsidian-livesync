import { encodeSettingsToSetupURI } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/compat/API/processSetting";
import { upsertRemoteConfigurationInPlace } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/remote-configurations";
import {
  createNewVaultSettings,
  PREFERRED_SETTING_SELF_HOSTED,
} from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/settings";

function requireEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function generateSetupPassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replace(/=+$/, "");
}

async function main() {
  const setupPassphrase = Deno.env.get("uri_passphrase")?.trim() ||
    generateSetupPassphrase();
  const settings = createNewVaultSettings();
  Object.assign(settings, PREFERRED_SETTING_SELF_HOSTED, {
    couchDB_URI: requireEnvironment("hostname"),
    couchDB_USER: requireEnvironment("username"),
    couchDB_PASSWORD: requireEnvironment("password"),
    couchDB_DBNAME: requireEnvironment("database"),
    batchSave: true,
    periodicReplication: true,
    syncOnStart: true,
    syncOnFileOpen: true,
    syncAfterMerge: true,
    encrypt: true,
    passphrase: requireEnvironment("passphrase"),
    usePathObfuscation: true,
  });
  upsertRemoteConfigurationInPlace(settings, "couchdb", { activate: true });

  const setupURI = await encodeSettingsToSetupURI(settings, setupPassphrase, [
    "pluginSyncExtendedSetting",
    "doNotUseFixedRevisionForChunks",
  ], true);

  console.log("\nYour passphrase for the Setup URI is:", setupPassphrase);
  console.log("This passphrase is never shown again, so store it safely.");
  console.log(setupURI.trim());
}

await main();
