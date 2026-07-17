# Refactoring and Code Quality Utilities

This directory contains Deno-based scripts that utilise `ts-morph` to perform codebase-wide refactoring, code quality clean-up, and static analysis.

These utilities are designed to help maintain code quality, resolve compiler warnings, and ensure popout window compatibility in the Obsidian plug-in environment.

---

## Prerequisites

To execute these scripts, you must have Deno installed on your system.

---

## General Usage

By default, all refactoring scripts run in **dry-run mode**. They will output the proposed changes to the console without modifying any files.

To apply the changes to the files, append the `'--run'` flag:

```bash
deno run --allow-read --allow-write --allow-env <script_name>.ts --run
```

---

## Utilities Reference

### 1. Global Wrapper Refactoring (`refactor-globals.ts`)
Converts standard global variable usages to compatibility wrappers to ensure safe operation when running in Obsidian popout windows (which run in separate window contexts).

*   **Targets**: `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `requestAnimationFrame`, `cancelAnimationFrame`, `localStorage`, `navigator`, `location`, `window`, `globalThis`, and `document`.
*   **Actions**:
    *   Replaces global namespace references (like `window` and `globalThis`) with `compatGlobal`.
*   Replaces `document` with `_activeDocument` from the Commonlib compatibility entry.
    *   Injects or updates the necessary imports in modified files.
*   **Command**:
    ```bash
    deno run --allow-read --allow-write --allow-env refactor-globals.ts
    ```

### 2. Element Style Normalisation (`refactor-styles.ts`)
Converts direct style assignments on HTML/SVG elements to use the plug-in's `setCssStyles` helper.

*   **Actions**:
    *   Replaces statements like `element.style.color = 'red';` with `element.setCssStyles({ color: 'red' });`.
    *   Groups multiple consecutive style assignments on the same element into a single call.
    *   Supports both static keys and computed bracket properties.
*   **Command**:
    ```bash
    deno run --allow-read --allow-write --allow-env refactor-styles.ts
    ```

### 3. Redundant Assertions Cleanup (`refactor-assertions.ts`)
Finds and removes type assertions that are redundant because the expression already evaluates to the asserted type.

*   **Actions**:
    *   Removes redundant `as Type` or `<Type>` assertions.
    *   Preserves critical literal assertions such as `as const` and `<const>`.
*   **Command**:
    ```bash
    deno run --allow-read --allow-write --allow-env refactor-assertions.ts
    ```

### 4. Unused Code Refactoring (`refactor-unused.ts`)
Cleans up unused imports and catch variables to reduce bundle size and warnings.

*   **Actions**:
    *   Converts unused catch variables to simple catch statements (e.g. `catch (error)` -> `catch`).
    *   Removes unused items in named imports, handling alias bindings (e.g. `import { A as B }`) correctly.
    *   Deletes empty import declarations resulting from the named import clean-up.
*   **Command**:
    ```bash
    deno run --allow-read --allow-write --allow-env refactor-unused.ts
    ```

### 5. Explicit Any Detection (`detect-any.ts`)
Scans the codebase and logs all occurrences of explicit `any` types.

*   **Actions**:
    *   Identifies uses of the `any` keyword in TypeScript and Svelte files.
    *   Logs the filename, line number, and matching code line for audit purposes.
*   **Command**:
    ```bash
    deno run --allow-read --allow-env detect-any.ts
    ```

### 6. Import Normalisation (`normalise-imports.ts`)
Ensures that internal plug-in import statements are standardised to the `@/` alias where applicable. Commonlib imports remain explicit package subpaths and are not rewritten.

*   **Command**:
    ```bash
    deno run --allow-read --allow-write --allow-env normalise-imports.ts
    ```

## Safety and Exclusions

*   **Tests Excluded**: All scripts automatically skip files located in `_test/` or `testdeno/` folders, as well as files ending with `.spec.ts` or `.test.ts`.
*   **Package Boundary**: These tools operate on this repository only. Changes to Commonlib belong in its own repository and must be validated with its package checks.
*   **Verification**: Always run `npm run check` and `npm run test:unit` after performing refactoring tasks to verify that type safety and tests remain intact.
