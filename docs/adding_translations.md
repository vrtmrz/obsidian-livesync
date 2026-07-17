# How to add translations

## Getting ready

1. Clone the Commonlib repository, which owns the translation catalogue.
```sh
git clone https://github.com/vrtmrz/livesync-commonlib
```
2. Make `ls-debug` folder under your vault's `.obsidian` folder (as like `.../dev/.obsidian/ls-debug`).

## Add translations for already defined terms

1. Install dependencies, and build the plug-in as dev. build.
```sh
cd livesync-commonlib
npm ci
npm run i18n:bake
```

2. Install the resulting packed Commonlib artefact in a Self-hosted LiveSync development checkout, build the plug-in, copy `main.js` to `.obsidian/plugins/obsidian-livesync` in your test Vault, and run Self-hosted LiveSync.
3. You will get the `missing-translation-yyyy-mm-dd.jsonl`, please fill in new translations.
4. Build the plug-in again, and confirm that displayed things were expected.
5. Add the translations to the Commonlib catalogue, run `npm run i18n:bake`, and make the pull request to `https://github.com/vrtmrz/livesync-commonlib`.

## Make messages to be translated

1. Find the message that you want to be translated.
2. Change the literal to use `$tf`, like below.
```diff
- Logger("Could not determine passphrase to save data.json! You probably make the configuration sure again!", LOG_LEVEL_URGENT);
+ Logger($tf('someKeyForPassphraseError'), LOG_LEVEL_URGENT);
```
3. Make the PR to `https://github.com/vrtmrz/obsidian-livesync`.
4. Follow the steps of "Add translations for already defined terms" to add the translations.
