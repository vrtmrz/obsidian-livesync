# How to add translations

Self-hosted LiveSync owns its multilingual catalogue. Commonlib supplies only the typed English messages which its services request; the plug-in combines those keys with its application messages and injects the selected translator at each service composition root.

## Getting ready

1. Clone this repository.

    ```sh
    git clone https://github.com/vrtmrz/obsidian-livesync
    cd obsidian-livesync
    npm ci
    ```

2. Create an `ls-debug` directory below the test Vault's `.obsidian` directory, for example `.obsidian/ls-debug`.

## Add translations for existing messages

1. Edit the human-readable YAML files under `src/common/messagesYAML/`.
2. Regenerate the JSON and TypeScript resources.

    ```sh
    npm run i18n:bake
    ```

3. Build the plug-in in development mode, install it in the test Vault, and run Self-hosted LiveSync.
4. Review any `missing-translation-yyyy-mm-dd.jsonl` file written below `.obsidian/ls-debug`, and add the required translations to the YAML catalogue.
5. Bake and build again, then confirm the displayed text and placeholder substitution in the relevant workflow.

Commit the edited YAML and all regenerated JSON and TypeScript resources together.

## Make a message translatable

LiveSync-owned messages may first be added to
`src/common/messages/LiveSyncProvisionalMessages.ts` while their wording is being
exercised. This keeps an application-only message out of Commonlib and provides a
typed English fallback without requiring contributors to update every language.

When the wording is ready for translation:

1. Move its canonical English entry from
   `src/common/messages/LiveSyncProvisionalMessages.ts` to
   `src/common/messagesYAML/en.yaml`. Remove the provisional entry in the same
   change. Translations in the other LiveSync YAML files may follow as contributor
   updates.
2. Replace the source literal with `$msg()` or another existing translation helper, using the English catalogue key as the typed contract.
3. Run `npm run i18n:bake`, build the plug-in, and verify the affected workflow.

When a new message belongs to Commonlib rather than the application, add its canonical English definition and key type in Commonlib first. Add any available translations to LiveSync when consuming that package; untranslated languages use Commonlib's canonical English fallback.
