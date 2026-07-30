import typescriptEslint from "typescript-eslint";

const repositoryRoot = new URL("../../", import.meta.url).pathname;

export function createSyntheticCommunityReviewConfig(project) {
    return [
        {
            ignores: [
                "**/*.unit.spec.ts",
                "**/*.test.ts",
                "**/test/**",
                "src/apps/_test/**",
                "src/apps/cli/testdeno/**",
            ],
        },
        {
            files: ["src/**/*.ts"],
            languageOptions: {
                parser: typescriptEslint.parser,
                parserOptions: {
                    project,
                    tsconfigRootDir: repositoryRoot,
                },
            },
            plugins: {
                "@typescript-eslint": typescriptEslint.plugin,
            },
            rules: {
                "@typescript-eslint/no-redundant-type-constituents": "warn",
            },
        },
    ];
}
