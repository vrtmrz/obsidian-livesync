# AI Coding Assistant Instructions (AGENTS.md)

When working on this repository (writing code, comments, documentation, or commits), you MUST follow these guidelines to maintain consistency.

## Documentation Navigation and Maintenance

- Use the [documentation index](docs/README.md) to select the relevant implementation reference, ADR, proposal, or historical record. The required references below still apply.
- When implementation or publication changes a recorded status, update its publication note and supporting references in the same change. Preserve the original decision date, reviewed-version baseline, and remaining follow-ups.
- Mark superseded or frozen documents at their entry point and link to the maintained reference. Keep historical evidence distinguishable from current operating instructions, and preserve existing links when reorganising documentation.

## Required Reference Files

Before making changes to documentation, user-facing text, or settings:
1. Read [docs/terms.md](docs/terms.md) for documentation style and vocabulary conventions.
2. Read [docs/glossary.md](docs/glossary.md) for user-facing, operational, developer, and design terminology.
3. Read [docs/settings.md](docs/settings.md) (and [docs/settings_ja.md](docs/settings_ja.md)) for UI settings and setting key mappings.
4. Read [docs/troubleshooting.md](docs/troubleshooting.md) for troubleshooting guidelines and common recovery steps (such as flag files and SCRAM state).
5. Read [devs.md](devs.md) for development workflows, module architecture, and testing infrastructure.

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
   - Use **'Self-hosted LiveSync'** or, where the context is clear, **'this plug-in'** when referring to this product. Preserve exact interface labels, code identifiers, commands, package names, and quotations. In explanatory prose, write **'LiveSync mode'** for the Sync Mode.

5. **User Communication Language**:
   - Always reply to the user in the language in which they asked the question.

---

## Release Notes

- Follow the release-note scope and history rules in [devs.md](devs.md#release-notes). Structure substantive entries as the user-visible outcome, the method that produces it, and supporting conditions, defaults, limitations, or required actions. Put the outcome first and use subordinate items when the explanation needs them.
- When a pull request explains only its implementation, consult the relevant issue or design decision to establish the problem it resolves. Verify the claimed outcome against the change and its evidence. Distinguish removing a cause from reducing occurrence, detecting a problem, or improving recovery.

---

## Technical & Architecture Rules

1. **Database Structure**:
   - Remember that Self-hosted LiveSync splits files into **Metadata** (file properties, size, paths) and **Chunks** (actual content). Do not store raw content in the metadata document directly.
2. **Setup and Recovery**:
   - **Fast Setup (Simple Fetch)** is the preferred flow for initial replication on secondary devices. It utilises stream-based replication for high speed and delays local file reflection to suppress temporary synchronisation warnings.
   - **Flag files** (such as `redflag.md`, `redflag2.md`, and `redflag3.md`) at the root of the vault control the boot-up sequence and trigger automated fetch/rebuild tasks.
3. **Subrepositories**:
   - Treat `@vrtmrz/livesync-commonlib` as an external, authoritative package. Make Commonlib changes in its repository, validate the packed artefact and downstream LiveSync consumer, and update the exact dependency here. Do not recreate a `src/lib` source mirror or generated `_types` fallback.
4. **Application Directories**:
   - The directory [src/apps](src/apps) contains independent application modules:
     - `cli`: A Command Line Interface application. Tests specifically for the CLI (both unit and End-to-End tests) are located and executed within [src/apps/cli](src/apps/cli) using its local `package.json` scripts.
     - `webapp`: A Web-based application.
     - `webpeer`: A Web-based peer utility.

---

## Failure Assessment and Recovery

- Establish the intended behaviour from [the conflict policy](devs.md#conflict-merge-policy) and [the revision-provenance contract](docs/specs_conflict_resolution.md) before classifying a failure. A visible conflict which preserves both versions can be the correct outcome; manual selection alone does not establish a serious defect.
- Assess preservation of user edits and required revision ancestry separately from extra work, temporary synchronisation delays, or duplicate internal records. A successful automatic merge or an empty queue is not proof of correct recovery. Check the resulting contents and history, safe convergence, and behaviour after restart where applicable.
- Distinguish data still present on a device or in readable history from irretrievable loss. Verify that a recovery source contains the affected edits before treating the failure as fully recoverable. Follow [the recovery guidance](docs/recovery.md) before recommending a rebuild or reset which could discard unique work.
- Give demonstrated irreversible information loss particular weight. Describe the actual burden of safe manual conflict resolution without treating automation as a correctness requirement. If preservation, recovery, impact, or the appropriate response remains unclear, review the evidence and alternatives with the collaborating user before changing the design or accepting the risk; continue independent investigation.

---

## Development & Verification Commands

Before submitting code, you should run verification scripts locally to ensure correct syntax and function.

1. **Lint and Type Checking**:
   - Run `npm run check` to perform code verification. This runs type-checking (`tsc-check`), ESLint (`lint`), and Svelte checks (`svelte-check`).
2. **Unit Tests**:
   - Run `npm run test:unit` to execute fast local unit tests.
   - Run `npm run test:unit:coverage` when unit-test coverage is required.
   - Run focused integration, CLI E2E, or real Obsidian E2E commands for the boundary being changed. Start only the Docker services required by that command.
3. **Build**:
   - Run `npm run build` to compile the production bundle (`main.js`).
   - Run `npm run dev` for the development watch/build task.
