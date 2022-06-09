/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
// This module just webpacks pouchdb-browser
// import * as PouchDB_src from "pouchdb-browser";
const pouch = require("pouchdb-browser").default;
const find = require("pouchdb-find").default;
const transform = require("transform-pouch");
const PouchDB = pouch.plugin(find).plugin(transform);

export { PouchDB };
