### 0.21.0
The E2EE encryption V2 format has been reverted. That was probably the cause of the glitch.
Instead, to maintain efficiency, files are treated with Blob until just before saving. Along with this, the old-fashioned encryption format has also been discontinued.
There are both forward and backwards compatibilities, with recent versions. However, unfortunately, we lost compatibility with filesystem-livesync or some.
It will be addressed soon. Please be patient if you are using filesystem-livesync with E2EE.


#### Version history
- 0.21.4
  - Improved:
    - Now all revisions will be shown only its first a few letters.
    - Now ID of the documents is shown in the log with the first 8 letters.
  - Fixed:
    - Check before modifying files has been implemented.
    - Content change detection has been improved.
- 0.21.3
  - Implemented:
    - Now we can use SHA1 for hash function as fallback.
- 0.21.2
  - IMPORTANT NOTICE: **0.21.1 CONTAINS A BUG WHILE REBUILDING THE DATABASE. IF YOU HAVE BEEN REBUILT, PLEASE MAKE SURE THAT ALL FILES ARE SANE.**
    - This has been fixed in this version.
  - Fixed:
    - No longer files are broken while rebuilding.
    - Now, Large binary files can be written correctly on a mobile platform.
    - Any decoding errors now make zero-byte files.
  - Modified:
    - All files are processed sequentially for each.
- 0.21.1
  - Fixed:
    - No more infinity loops on larger files.
    - Show message on decode error.
  - Refactored:
    - Fixed to avoid obsolete global variables.
- 0.21.0
  - Changes and performance improvements:
    - Now the saving files are processed by Blob.
    - The V2-Format has been reverted.
    - New encoding format has been enabled in default.
    - WARNING: Since this version, the compatibilities with older Filesystem LiveSync have been lost.

... To continue on to `updates_old.md`.