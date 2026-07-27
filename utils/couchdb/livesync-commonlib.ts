// Keep CouchDB database-version negotiation isolated from Setup URI generation.
// The exact release must match utils/livesync-commonlib-version.ts; the setup
// tool suite checks every static specifier before release.
export { checkRemoteVersion } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/compat/pouchdb/negotiation";
export { PouchDB } from "npm:@vrtmrz/livesync-commonlib@0.1.0-rc.4/compat/pouchdb/pouchdb-browser";
