#!/usr/bin/env node
import polyfill from "node-datachannel/polyfill";
import { main } from "./main";

for (const prop in polyfill) {
    // @ts-ignore Applying polyfill to globalThis
    globalThis[prop] = (polyfill as any)[prop];
}

main().catch((error) => {
    console.error(`[Fatal Error]`, error);
    process.exit(1);
});
