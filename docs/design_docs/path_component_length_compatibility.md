---
date: 2026-09-04
commonlib-version: "0.1.21"
self-hosted-livesync-version: "1.0.24"
status: unreleased
---

# Path component length compatibility

## Purpose

File systems place limits on each file or folder name, rather than applying one
common limit to an entire Vault-relative path. Those limits are also expressed
in different units. Self-hosted LiveSync therefore treats 255 UTF-8 bytes as a
focused Android and Linux compatibility warning, not as a universal definition
of a valid path.

## Basis for the 255-byte warning

- The Linux kernel documentation gives ext4 a maximum file-name length of
  [255 bytes](https://www.kernel.org/doc/html/latest/filesystems/ext4/directory.html).
- The F2FS on-disk header defines
  [`F2FS_NAME_LEN` as 255](https://android.googlesource.com/kernel/common/+/88d92fb1c034922572bab93482ac9cc61d4ba43c/include/linux/f2fs_fs.h)
  and stores names in byte arrays.
- Android's MediaProvider uses a
  [`MAX_FILENAME_BYTES` value of 255](https://android.googlesource.com/platform/packages/providers/MediaProvider/+/bae279463/src/com/android/providers/media/util/FileUtils.java)
  when building file names. Its source notes that emulated storage can write to
  ext4 through FUSE, where names are encoded as UTF-8.
- Android 11 and later use
  [FUSE for emulated storage](https://source.android.com/docs/core/storage/fuse-passthrough),
  with requests passing through to the underlying file system.

Together, these provide a conservative compatibility boundary for file names
which may reach Android or Linux storage. They do not show that every Android
device, storage provider, or Linux file system has the same limit.

## Why the rule is not universal

Other platforms describe component limits differently. Microsoft's file-system
comparison documents limits in
[Unicode characters](https://learn.microsoft.com/en-us/windows/win32/fileio/filesystem-functionality-comparison),
not UTF-8 bytes. Apple's HFS Plus format stores a name as up to
[255 16-bit `UniChar` values](https://developer.apple.com/library/archive/technotes/tn/tn1150.html).
Apple's APFS guidance discusses valid UTF-8 names, normalisation, and case
sensitivity, but does not establish a universal
[255-byte component rule](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html).

A name can consequently exceed 255 UTF-8 bytes and still work on one platform,
or fail for another platform-specific reason while remaining below this
boundary.

## Product policy

Self-hosted LiveSync applies the warning as follows:

1. split the Vault-relative path on `/` and inspect each non-empty component;
2. measure each component after UTF-8 encoding;
3. accept 255 bytes without this warning and warn at 256 bytes or more;
4. identify every over-limit file or folder name in the active-file status;
5. do not reject, truncate, or rename the path; and
6. treat the result of the real storage operation as authoritative.

If a scan cannot process an individual file, its path is recorded in the
verbose log and remains eligible for a later retry. Ordinary start-up may still
become ready so that unaffected files can synchronise. Explicit Fetch and
Rebuild operations retain strict scan completion because they establish an
authoritative local or remote state.

This policy does not replace the existing checks for reserved characters,
case collisions, ignore rules, or configured file-size limits.
