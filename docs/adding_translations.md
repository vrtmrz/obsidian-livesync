# How to add translations

## Getting ready

1. Clone this repository recursively.
```sh
git clone --recursive https://github.com/vrtmrz/obsidian-livesync
```
2. Make `ls-debug` folder under your vault's `.obsidian` folder (as like `.../dev/.obsidian/ls-debug`).

## Add translations for already defined terms

1. Install dependencies, and build the plug-in as dev. build.
```sh
cd obsidian-livesync
npm i -D
npm run buildDev
```

2. Copy the `main.js` to `.obsidian/plugins/obsidian-livesync` folder of your vault, and run Obsidian-Self-hosted LiveSync.
3. You will get the `missing-translation-yyyy-mm-dd.jsonl`, please fill in new translations.
4. Build the plug-in again, and confirm that displayed things were expected.
5. Merge them into `rosetta.ts`, and make the PR to `https://github.com/vrtmrz/livesync-commonlib`.

## Make messages to be translated

1. Find the message that you want to be translated.
2. Change the literal to use `$tf`, like below.
```diff
- Logger("Could not determine passphrase to save data.json! You probably make the configuration sure again!", LOG_LEVEL_URGENT);
+ Logger($tf('someKeyForPassphraseError'), LOG_LEVEL_URGENT);
```
3. Make the PR to `https://github.com/vrtmrz/obsidian-livesync`.
4. Follow the steps of "Add translations for already defined terms" to add the translations.