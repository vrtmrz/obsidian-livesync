# 0.25

Since 19th July, 2025 (beta1 in 0.25.0-beta1, 13th July, 2025)

The head note of 0.25 is now in [updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md). Because 0.25 got a lot of updates, thankfully, compatibility is kept and we do not need breaking changes! In other words, when get enough stabled. The next version will be v1.0.0. Even though it my hope.

## ~~0.25.28~~ 0.25.29
(0.25.28 was skipped due to a packaging issue.)

17th November, 2025

### New feature
- We can now configure hidden file synchronisation to always overwrite with the latest version (#579).

### Fixed
- Timing dependency issues during initialisation have been mitigated (#714)

### Improved
- Error logs now contain stack-traces for better inspection.

## 0.25.27

12th November, 2025

### Improved

- Now we can switch the database adapter between IndexedDB and IDB without rebuilding (#747).
    - Just a local migration will be required, but faster than a full rebuild.
- No longer checking for the adapter by `Doctor`.

### Changes

- The default adapter is reverted to IDB to avoid memory leaks (#747).

### Fixed (?)

- Reverted QR code library to v1.4.4 (To make sure #752).


## 0.25.26

07th November, 2025

### Improved

- Some JWT notes have been added to the setting dialogue (#742).

### Fixed

- No longer wrong values encoded into the QR code.
- We can acknowledge why the QR codes have not been generated.
    - Probably too large a dataset to encode. When this happens, please consider using Setup-URI via text instead of QR code, or reduce the settings temporarily.

### Refactored

- Some dependencies have been updated.
- Internal functions have been modularised into `octagonal-wheels` packages and are well tested.
    - `dataobject/Computed` for caching computed values.
    - `encodeAnyArray/decodeAnyArray` for encoding and decoding any array-like data into compact strings (#729).
- Fixed importing from the parent project in library codes. (#729).

## 0.25.25

06th November, 2025

### Fixed

#### JWT Authentication

- Now we can use JWT Authentication ES512 correctly (#742).
- Several misdirections in the Setting dialogues have been fixed (i.e., seconds and minutes confusion...).
- The key area in the Setting dialogue has been enlarged and accepts newlines correctly.
- Caching of JWT tokens now works correctly
    - Tokens are now cached and reused until they expire.
    - They will be kept until 10% of the expiration duration is remaining or 10 seconds, whichever is longer (but at a maximum of 1 minute).
- JWT settings are now correctly displayed on the Setting dialogue.

And, tips about JWT Authentication on CouchDB have been added to the documentation (docs/tips/jwt-on-couchdb.md).

#### Other fixes

- Receiving non-latest revisions no longer causes unexpected overwrites.
    - On receiving revisions that made conflicting changes, we are still able to handle them.

### Improved

- No longer duplicated message notifications are shown when a connection to the remote server fails.
    - Instead, a single notification is shown, and it will be kept on the notification area inside the editor until the situation is resolved.
- The notification area is no longer imposing, distracting, and overwhelming.
    - With a pale background, but bordered and with icons.

Older notes are in
[updates_old.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/updates_old.md).
