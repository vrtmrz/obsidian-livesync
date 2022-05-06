import { PouchDB as PouchDB_ } from "../pouchdb-browser-webpack/dist/pouchdb-browser.js";

const Pouch: PouchDB.Static = PouchDB_;
export { Pouch as PouchDB };
