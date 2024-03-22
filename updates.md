### 0.22.0
A few years passed since Self-hosted LiveSync was born, and our codebase had been very complicated. This could be patient now, but it should be a tremendous hurt.
Therefore at v0.22.0, for future maintainability, I refined task scheduling logic totally.

Of course, I think this would be our suffering in some cases. However, I would love to ask you for your cooperation and contribution.

Sorry for being absent so much long. And thank you for your patience!

Note: we got a very performance improvement.
Note at 0.22.2: **Now, to rescue mobile devices, Maximum file size is set to 50 by default**. Please configure the limit as you need. If you do not want to limit the sizes, set zero manually, please.

#### Version history
- 0.22.15:
  - Improved:
    - Faster start-up by removing too many logs which indicates normality
    - By streamlined scanning of customised synchronisation extra phases have been deleted.
- 0.22.14:
  - New feature:
    - We can disable the status bar in the setting dialogue.
  - Improved:
    - Now some files are handled as correct data type.
    - Customisation sync now uses the digest of each file for better performance.
    - The status in the Editor now works performant.
  - Refactored:
    - Common functions have been ready and the codebase has been organised.
    - Stricter type checking following TypeScript updates.
    - Remove old iOS workaround for simplicity and performance.
- 0.22.13:
  - Improved:
    - Now using HTTP for the remote database URI warns of an error (on mobile) or notice (on desktop).
  - Refactored:
    - Dependencies have been polished.
- 0.22.12:
  - Changed:
    - The default settings has been changed.
  - Improved:
    - Default and preferred settings are applied on completion of the wizard.
  - Fixed:
    - Now Initialisation `Fetch` will be performed smoothly and there will be fewer conflicts.
    - No longer stuck while Handling transferred or initialised documents.
... To continue on to `updates_old.md`.