/* eslint-disable obsidianmd/no-nodejs-builtins */
import * as nodeFs from "node:fs";
import * as nodeFsPromises from "node:fs/promises";
import * as nodePath from "node:path";
import * as nodeReadlinePromises from "node:readline/promises";

export {
    nodeFs as fs,
    nodeFsPromises as fsPromises,
    nodePath as path,
    nodeReadlinePromises as readline,
};
