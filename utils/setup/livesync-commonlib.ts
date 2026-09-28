// Keep Setup URI generation on its own static Commonlib module graph. This is
// intentionally separate from the CouchDB facade so that a raw-URL invocation
// does not load the PouchDB browser adapter.
export {
  decodeSettingsFromSetupURI,
  encodeTimeBoundSetupURI,
  isTimeBoundSetupURIUsableNow,
} from "npm:@vrtmrz/livesync-commonlib@0.1.32-next.0/setup-uri";
export type { TimeBoundSetupURIMode } from "npm:@vrtmrz/livesync-commonlib@0.1.32-next.0/setup-uri";
export { generateP2PRoomId } from "npm:@vrtmrz/livesync-commonlib@0.1.32-next.0/compat/common/utils";
export { upsertRemoteConfigurationInPlace } from "npm:@vrtmrz/livesync-commonlib@0.1.32-next.0/remote-configurations";
export {
  createNewVaultSettings,
  DEFAULT_SETTINGS,
  P2P_DEFAULT_SETTINGS,
  PREFERRED_BASE,
  PREFERRED_JOURNAL_SYNC,
  PREFERRED_SETTING_SELF_HOSTED,
} from "npm:@vrtmrz/livesync-commonlib@0.1.32-next.0/settings";
export type { ObsidianLiveSyncSettings } from "npm:@vrtmrz/livesync-commonlib@0.1.32-next.0/settings";
