# [WIP] The design intent explanation for using metadata and chunks

## Abstract

## Goal

- To explain the following:
  - What metadata and chunks are
  - The design intent of using metadata and chunks

## Background and Motivation

We are using PouchDB and CouchDB for storing files and synchronising them. PouchDB is a JavaScript database that stores data on the device (browser, and of course, Obsidian), while CouchDB is a NoSQL database that stores data on the server. The two databases can be synchronised to keep data consistent across devices via the CouchDB replication protocol. This is a powerful and flexible way to store and synchronise data, including conflict management, but it is not well suited for files. Therefore, we needed to manage how to store files and synchronise them.

## Terminology

- Password:
  - A string used to authenticate the user.

- Passphrase:
  - A string used to encrypt and decrypt data.
  - This is not a password.

- Encrypt:
  - To convert data into a format that is unreadable to anyone.
  - Can be decrypted by the user who has the passphrase.
  - Should be 1:n, containing random data to ensure that even the same data, when encrypted, results in different outputs.

- Obfuscate:
  - To convert data into a format that is not easily readable.
  - Can be decrypted by the user who has the passphrase.
  - Should be 1:1, containing no random data, and the same data is always obfuscated to the same result. It is necessarily unreadable.

- Hash:
  - To convert data into a fixed-length string that is not easily readable.
  - Cannot be decrypted.
  - Should be 1:1, containing no random data, and the same data is always hashed to the same result.

## Designs

### Principles

- To synchronise and handle conflicts, we should keep the history of modifications.
- No data should be lost. Even though some extra data may be stored, it should be removed later, safely.
- Each stored data item should be as small as possible to transfer efficiently, but not so small as to be inefficient.
- Any type of file should be supported, including binary files.
- Encryption should be supported efficiently.
- This method should not depart too far from the PouchDB/CouchDB philosophy. It needs to leave room for other `remote`s, to benefit from custom replicators.

As a result, we have adopted the following design.

- Files are stored as one metadata entry and multiple chunks.
- Chunks are content-addressable, and the metadata contains the ids of the chunks.
- Chunks may be referenced from multiple metadata entries. They should be efficiently managed to avoid redundancy.

### Metadata Design

The metadata contains the following information:

| Field    | Type                 | Description                  | Note                                                                                                  |
| -------- | -------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| _id      | string               | The id of the metadata       | It is created from the file path                                                                      |
| _rev     | string               | The revision of the metadata | It is created by PouchDB                                                                              |
| children | [string]             | The ids of the chunks        |                                                                                                       |
| path     | string               | The path of the file         | If Obfuscate path has been enabled, it has been encrypted                                             |
| size     | number               | The size of the metadata     | Not respected; for troubleshooting                                                                    |
| ctime    | string               | The creation timestamp       | This is not used to compare files, but when writing to storage, it will be used                       |
| mtime    | string               | The modification timestamp   | This will be used to compare files, and will be written to storage                                    |
| type     | `plain` \| `newnote` | The type of the file         | Children of type `plain` will not be base64 encoded, while `newnote` will be                          |
| e_       | boolean              | The file is encrypted        | Encryption is processed during transfer to the remote. In local storage, this property does not exist |

#### Decision Rule for `_id` of Metadata

```ts
// Note: This is pseudo code.
let _id = PATH;
if (!HANDLE_FILES_AS_CASE_SENSITIVE) {
  _id = _id.toLowerCase();
}
if (_id.startsWith("_")) {
  _id = "/" + _id;
}
if (OBFUSCATE_PATH) {
  _id = `f:${OBFUSCATE_PATH(_id, E2EE_PASSPHRASE)}`;
}
return _id;
```

#### Expected Questions

- Why do we need to handle files as case-sensitive?
  - Some filesystems are case-sensitive, while others are not. For example, Windows is not case-sensitive, while Linux is. Therefore, we need to handle files as case-sensitive to manage conflicts.
  - The trade-off is that you will not be able to manage files with different cases, so this can be disabled if you only have case-sensitive terminals.
- Why obfuscate the path?
  - E2EE only encrypts the content of the file, not metadata. Hence, E2EE alone is not enough to protect the vault completely. The path is also part of the metadata, so it should be obfuscated. This is a trade-off between security and performance. However, if you title a note with sensitive information, you should obfuscate the path.
- What is `f:`?
  - It is a prefix to indicate that the path is obfuscated. It is used to distinguish between normal paths and obfuscated paths. Due to file enumeration, Self-hosted LiveSync should scan the files to find the metadata, excluding chunks and other information.
  - Why does an unobfuscated path not start with `f:`?
  - For compatibility. Self-hosted LiveSync, by its nature, must also be able to handle files created with newer versions as far as possible.

### Chunk Design

#### Chunk Structure

The chunk contains the following information:

| Field | Type         | Description               | Note                                                                                                  |
| ----- | ------------ | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| _id   | `h:{string}` | The id of the chunk       | It is created from the hash of the chunk content                                                      |
| _rev  | string       | The revision of the chunk | It is created by PouchDB                                                                              |
| data  | string       | The content of the chunk  |                                                                                                       |
| type  | `leaf`       | Fixed                     |                                                                                                       |
| e_    | boolean      | The chunk is encrypted    | Encryption is processed during transfer to the remote. In local storage, this property does not exist |

**SORRY, TO BE WRITTEN, BUT WE HAVE IMPLEMENTED `v2`, WHICH REQUIRES MORE INFORMATION.**

### How they are unified

## Deduplication and Optimisation

## Synchronisation Strategy

## Performance Considerations

## Security and Privacy

## Edge Cases
