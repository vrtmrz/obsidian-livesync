// Keep Setup URI generation on its own static Commonlib module graph. This is
// intentionally separate from the CouchDB facade so that a raw-URL invocation
// does not load the PouchDB browser adapter.
export {
  decodeSettingsFromSetupURI,
  encodeSettingsToSetupURI,
} from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/compat/API/processSetting";
export { generateP2PRoomId } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/compat/common/utils";
export { upsertRemoteConfigurationInPlace } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/remote-configurations";
export {
  createNewVaultSettings,
  DEFAULT_SETTINGS,
  P2P_DEFAULT_SETTINGS,
  PREFERRED_BASE,
  PREFERRED_JOURNAL_SYNC,
  PREFERRED_SETTING_SELF_HOSTED,
} from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/settings";
export type { ObsidianLiveSyncSettings } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/settings";
