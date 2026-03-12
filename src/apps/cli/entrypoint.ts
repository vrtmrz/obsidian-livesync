#!/usr/bin/env node
import { main } from "./main";

main().catch((error) => {
    console.error(`[Fatal Error]`, error);
    process.exit(1);
});
