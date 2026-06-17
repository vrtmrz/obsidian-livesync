const restrictedGlobalsOptions = [
    {
        name: "app",
        message: "Avoid using the global app object. Instead use the reference provided by your plugin instance.",
    },
    "warn",
    {
        name: "fetch",
        message: "Use the built-in `requestUrl` function instead of `fetch` for network requests in Obsidian.",
    },
    {
        name: "localStorage",
        message:
            "Prefer `App#saveLocalStorage` / `App#loadLocalStorage` functions to write / read localStorage data that's unique to a vault.",
    },
];
const restrictedImportsOptions = [
    {
        name: "axios",
        message: "Use the built-in `requestUrl` function instead of `axios`.",
    },
    {
        name: "superagent",
        message: "Use the built-in `requestUrl` function instead of `superagent`.",
    },
    {
        name: "got",
        message: "Use the built-in `requestUrl` function instead of `got`.",
    },
    {
        name: "ofetch",
        message: "Use the built-in `requestUrl` function instead of `ofetch`.",
    },
    {
        name: "ky",
        message: "Use the built-in `requestUrl` function instead of `ky`.",
    },
    {
        name: "node-fetch",
        message: "Use the built-in `requestUrl` function instead of `node-fetch`.",
    },
    {
        name: "moment",
        message: "The 'moment' package is bundled with Obsidian. Please import it from 'obsidian' instead.",
    },
];

const warnWhileDev = "off";

/**
 * @type {import("eslint").Linter.RulesRecord}
 */
export const baseRules = {
    // -- Base rules (turned off in favour of TS specific versions or explicitly disabled).
    "no-unused-vars": "off",
    "no-unused-labels": "off",
    "no-prototype-builtins": "off",
    "require-await": "off",
    // -- TypeScript specific rules (Gradual adoption of stricter rules, currently set to 'warn' for a while).
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-redundant-type-constituents": "warn",
    // -- TypeScript specific rules
    //  @typescript-eslint/no-unsafe-* rules and @typescript-eslint/no-explicit-any:
    //  This project contains a lot of library-sh code where the use of `any` is often necessary and justified.
    //  Rules is now set to 'off' for a while.
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    // -- Reasonable rules.
    "@typescript-eslint/no-deprecated": warnWhileDev,
    "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/no-empty-function": "off",
    "@typescript-eslint/require-await": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-unnecessary-type-assertion": "error",

    // -- General rules
    "no-async-promise-executor": warnWhileDev,
    "no-constant-condition": ["error", { checkLoops: false }],
    // -- Disabled rules
    // no-undef: This option breaks the global declarations for the library files and is not worth the effort to fix at this time.
    "no-undef": "off",
};

/**
 * @type {import("eslint").Linter.RulesRecord}
 */
export const obsidianRules = {
    // -- Obsidian rules
    // obsidianmd/no-unsupported-api: usually this project checks for API support at runtime, so this rule is not critical but can be helpful to catch potential issues.
    "obsidianmd/no-unsupported-api": warnWhileDev,

    // -- Plugin specific overrides
    "obsidianmd/rule-custom-message": "off",
    "obsidianmd/ui/sentence-case": "off",
    "obsidianmd/no-plugin-as-component": "off",

    // -- Temporary overrides for migration
    "obsidianmd/no-static-styles-assignment": "off",
};
/**
 * @type {(base:string) => import("eslint").Linter.RulesRecord}
 */
export const ImportAliasRules = (base) => ({
    "@dword-design/import-alias/prefer-alias": [
        "error",
        {
            aliasForSubpaths: true,
            alias: {
                "@": `${base}/src`,
                "@lib": `${base}/src/lib/src`,
            },
        },
    ],
});
/**
 * @type {import("eslint").Linter.RulesRecord}
 */
export const CommunityReviewRecommendedRules = {
    "no-unused-vars": "off",
    "no-prototype-bultins": "off",
    "no-self-compare": "warn",
    "no-eval": "error",
    "no-implied-eval": "error",
    "prefer-const": "off",
    "no-implicit-globals": "error",
    "no-console": "off", // overridden by obsidianmd/rule-custom-message
    "no-restricted-globals": ["error", ...restrictedGlobalsOptions],
    "no-restricted-imports": ["error", ...restrictedImportsOptions],
    "no-alert": "error",
    "no-undef": "error",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/no-deprecated": "error",
    "@typescript-eslint/no-unused-vars": ["warn", { args: "none" }],
    "@typescript-eslint/require-await": "off",
    "@typescript-eslint/no-explicit-any": ["error", { fixToUnknown: true }],
    // "import/no-nodejs-modules": "off",
    // "import/no-extraneous-dependencies": "error",
};
