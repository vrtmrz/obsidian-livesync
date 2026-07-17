import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
    globalIgnores([
        "node_modules",
        "**/dist",
        "build",
        "coverage",
        "main.js",
        "main_org.js",
        "pouchdb-browser.js",
        "package.json",
        "package-lock.json",
        "versions.json",
        // Svelte is covered by the project lint and svelte-check; the directory report currently analyses TypeScript.
        "**/*.svelte",
        "**/svelte.config.js",
        "**/*.unit.spec.ts",
        "**/test/**",
        "src/apps/_test/**",
        "src/apps/cli/testdeno/**",
    ]),
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
                MANIFEST_VERSION: "readonly",
                PACKAGE_VERSION: "readonly",
                UPDATE_INFO: "readonly",
                hostPlatform: "readonly",
            },
            parserOptions: {
                project: [
                    "./tsconfig.json",
                    "./src/apps/browser/tsconfig.json",
                    "./src/apps/cli/tsconfig.json",
                    "./src/apps/webapp/tsconfig.json",
                    "./src/apps/webpeer/tsconfig.app.json",
                    "./src/apps/webpeer/tsconfig.node.json",
                ],
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    ...obsidianmd.configs.recommended,
    {
        rules: {
            // The directory review reports console usage as guidance rather than a release blocker.
            "obsidianmd/rule-custom-message": "off",
            "no-console": "warn",
            "obsidianmd/no-unsupported-api": "error",
            // Keep legacy type-safety debt visible while reserving errors for directory-review blockers.
            "@typescript-eslint/no-unsafe-argument": "warn",
            "@typescript-eslint/no-unsafe-assignment": "warn",
            "@typescript-eslint/no-unsafe-call": "warn",
            "@typescript-eslint/no-unsafe-member-access": "warn",
            "@typescript-eslint/no-unsafe-return": "warn",
            "@typescript-eslint/no-base-to-string": "warn",
            "@typescript-eslint/no-redundant-type-constituents": "warn",
            "@typescript-eslint/no-unnecessary-type-assertion": "warn",
        },
    },
    {
        files: ["src/apps/**/*.{ts,js,mjs}"],
        rules: {
            // These applications are inspected by the directory review but accept external command and file data.
            "@typescript-eslint/restrict-template-expressions": "warn",
        },
    },
    {
        files: ["src/apps/browser/**/*.ts", "src/apps/webapp/**/*.ts"],
        rules: {
            "obsidianmd/no-static-styles-assignment": "off",
            "obsidianmd/prefer-create-el": "off",
            "obsidianmd/prefer-active-doc": "off",
        },
    }
);
