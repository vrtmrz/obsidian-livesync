# Contributing to Self-hosted LiveSync

Thank you for your interest in contributing to Self-hosted LiveSync! We welcome all contributions, including bug reports, feature requests, documentation improvements, translations, and pull requests.

## Getting Started

To set up the development environment, please follow these steps:

1. Clone the repository recursively to ensure all Git submodules are loaded:
   ```bash
   git clone --recursive https://github.com/vrtmrz/obsidian-livesync
   ```
   If you have already cloned the repository without submodules, run the following command:
   ```bash
   git submodule update --init --recursive
   ```

2. Install the package dependencies:
   ```bash
   npm ci
   ```

3. Build the plug-in:
   ```bash
   npm run build
   ```

For a more comprehensive guide on development workflows, testing configurations, and subrepos, please refer to [devs.md](devs.md).

## Guidelines for Contributions

### 1. Code Style and Verification

Before submitting a pull request, you must run verification scripts locally to ensure that there are no syntax, type, or linting errors:

- Run type checking and linting:
  ```bash
  npm run check
  ```
- Run unit tests:
  ```bash
  npm run test:unit
  ```

If you have the capability and a suitable environment (such as Linux and Docker), running the CLI End-to-End (E2E) tests is also highly appreciated. Instructions are detailed in [devs.md](devs.md). If you cannot run E2E tests locally, please explicitly ask to run the tests on the CI by stating 'Please run CI tests' in your pull request description.

### 2. Documentation and UI Text Style

To maintain consistency across the project, we ask that you follow the established writing style and conventions of the codebase when contributing documentation or user-facing messages:

- **Spelling**: Prioritise region-independent, neutral spelling if a suitable word exists. If there is no such word, please use British English spelling to align with the codebase's style (for example: preferring '-ise' and '-isation' suffixes over '-ize' and '-ization'). However, we do not treat alternative spellings as errors.
- **Oxford Comma**: Use the serial (Oxford) comma to separate items in lists of three or more (for example: 'settings, snippets, and themes').
- **Logical Punctuation**: Place punctuation marks outside quotation marks unless they are part of the quoted text itself (for example: write 'dialogue', not 'dialogue,').
- **No Contractions**: Avoid using contractions in general text or documentation (for example: write "do not" instead of "don't", and "cannot" instead of "can't").
- **Affirmative Phrasing**: Avoid asking questions using negative forms in user-facing dialogue. Use affirmative questions to prevent translation and interpretation discrepancies.
- **Specific Words**: Use 'dialogue' for documentation and user-facing messages (use 'dialog' only inside source code). Use the hyphenated form 'plug-in' in user-facing text (use 'plugin' only in configuration settings or technical contexts).

For a detailed list of vocabulary conventions and terms, please refer to [docs/terms.md](docs/terms.md).

### 3. Translations

To add or update translations, please refer to [docs/adding_translations.md](docs/adding_translations.md) for detailed instructions.

### 4. Git Submodules

The `src/lib` directory is a Git submodule pointing to the shared library `livesync-commonlib`. If you wish to propose changes to the shared library, do not modify `src/lib` directly. Instead, please submit a separate pull request to the [livesync-commonlib repository](https://github.com/vrtmrz/livesync-commonlib).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
