# AI Coding Assistant Instructions (AGENTS.md)

When working on this repository (writing code, comments, documentation, or commits), you MUST follow these guidelines to maintain consistency.

## Required Reference Files

Before making changes to documentation, user-facing text, or settings:
1. Read [docs/terms.md](file:///Users/vorotamoroz/dev/js/obsidian-livesync/docs/terms.md) for terminology, vocabulary conventions, and technical definitions.
2. Read [docs/settings.md](file:///Users/vorotamoroz/dev/js/obsidian-livesync/docs/settings.md) (and [docs/settings_ja.md](file:///Users/vorotamoroz/dev/js/obsidian-livesync/docs/settings_ja.md)) for UI settings and setting key mappings.
3. Read [docs/troubleshooting.md](file:///Users/vorotamoroz/dev/js/obsidian-livesync/docs/troubleshooting.md) for troubleshooting guidelines and common recovery steps (such as flag files and SCRAM state).
4. Read [devs.md](file:///Users/vorotamoroz/dev/js/obsidian-livesync/devs.md) for development workflows, module architecture, and testing infrastructure.

---

## Documentation and User-Facing Text Rules

Always adhere to the following stylistic and spelling rules:

1. **British English Spelling**:
   - Write all documentation and user-facing messages in British English. If in doubt, the BBC News Styleguide may be useful as a reference.
   - **Traditional Spelling (Trad-spelling)**: Use `-ise` and `-isation` suffixes instead of `-ize` and `-ization` (for example: 'initialisation', 'synchronisation', and 'organisation').
   - **Oxford Comma**: Use the serial (Oxford) comma to separate items in lists of three or more (for example: 'settings, snippets, and themes' instead of 'settings, snippets and themes').
   - **Logical Punctuation**: Place punctuation marks (such as commas and full stops) outside quotation marks unless they are part of the quoted text itself (for example: write 'dialogue', not 'dialogue,').

2. **No Contractions**:
   - Do not use contractions in general text or documentation (for example: write "do not" instead of "don't", "cannot" instead of "can't", and "is not" instead of "isn't").

3. **Quotation Style**:
   - Prefer single quotation marks (`'`) over double quotation marks (`"`) in general documentation text, unless the context requires double quotes (for example, inside JSON code blocks).

4. **Specific Terminology and Spelling**:
   - Use **'dialogue'** in documentation, user-facing messages, and general text. Use **'dialog'** only inside source code (e.g. class names, methods).
   - Use the hyphenated form **'plug-in'** in user-facing text. Use **'plugin'** only in codebase files, configuration settings, or technical contexts.

5. **User Communication Language**:
   - Always reply to the user in the language in which they asked the question.

---

## Technical & Architecture Rules

1. **Database Structure**:
   - Remember that Self-hosted LiveSync splits files into **Metadata** (file properties, size, paths) and **Chunks** (actual content). Do not store raw content in the metadata document directly.
2. **Setup and Recovery**:
   - **Fast Setup (Simple Fetch)** is the preferred flow for initial replication on secondary devices. It utilises stream-based replication for high speed and delays local file reflection to suppress temporary synchronisation warnings.
   - **Flag files** (such as `redflag.md`, `redflag2.md`, and `redflag3.md`) at the root of the vault control the boot-up sequence and trigger automated fetch/rebuild tasks.
3. **Subrepositories**:
   - The directory [src/lib](file:///Users/vorotamoroz/dev/js/obsidian-livesync/src/lib) is a subrepository (Git submodule) pointing to the shared library `livesync-commonlib`. Do not make modifications inside this directory without careful consideration, as changes affect the shared library.
4. **Application Directories**:
   - The directory [src/apps](file:///Users/vorotamoroz/dev/js/obsidian-livesync/src/apps) contains independent application modules:
     - `cli`: A Command Line Interface application. Tests specifically for the CLI (both unit and End-to-End tests) are located and executed within [src/apps/cli](file:///Users/vorotamoroz/dev/js/obsidian-livesync/src/apps/cli) using its local `package.json` scripts.
     - `webapp`: A Web-based application.
     - `webpeer`: A Web-based peer utility.

---

## Development & Verification Commands

Before submitting code, you should run verification scripts locally to ensure correct syntax and function.

1. **Lint and Type Checking**:
   - Run `npm run check` to perform code verification. This runs type-checking (`tsc-check`), ESLint (`lint`), and Svelte checks (`svelte-check`).
2. **Unit Tests**:
   - Run `npm run test:unit` to execute fast local unit tests.
   - Run `npm run test` or `npm run test:full` for full testing suites (including dockerised services).
3. **Build**:
   - Run `npm run build` to compile the production bundle (`main.js`).
   - Run `npm run dev` for the development watch/build task.
