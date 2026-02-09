import { readFileSync } from "fs";
let localPrettierConfig = {};

try {
    const localConfig = readFileSync(".prettierrc.local", "utf-8");
    localPrettierConfig = JSON.parse(localConfig);
    console.log("Using local Prettier config from .prettierrc.local");
} catch (e) {
    // no local config
}
const prettierConfig = {
    trailingComma: "es5",
    tabWidth: 4,
    printWidth: 120,
    semi: true,
    endOfLine: "cr",
    ...localPrettierConfig,
};

export default prettierConfig;
