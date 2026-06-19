// eslint-disable-next-line obsidianmd/no-nodejs-builtins -- This file is used to provide Node.js built-in modules in the CLI environment, which is not running in a browser context.
import * as nodeFs from "node:fs";
// eslint-disable-next-line obsidianmd/no-nodejs-builtins -- This file is used to provide Node.js built-in modules in the CLI environment, which is not running in a browser context.
import * as nodeFsPromises from "node:fs/promises";
// eslint-disable-next-line obsidianmd/no-nodejs-builtins -- This file is used to provide Node.js built-in modules in the CLI environment, which is not running in a browser context.
import * as nodePath from "node:path";
// eslint-disable-next-line obsidianmd/no-nodejs-builtins -- This file is used to provide Node.js built-in modules in the CLI environment, which is not running in a browser context.
import * as nodeReadlinePromises from "node:readline/promises";
// eslint-disable-next-line obsidianmd/no-nodejs-builtins -- This file is used to provide Node.js built-in modules in the CLI environment, which is not running in a browser context.
import type { Stats } from "node:fs";
export { nodeFs as fs, nodeFsPromises as fsPromises, nodePath as path, nodeReadlinePromises as readline, type Stats };
