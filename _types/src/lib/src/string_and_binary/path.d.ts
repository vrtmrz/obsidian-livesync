// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type AnyEntry, type DocumentID, type EntryHasPath, type FilePath, type FilePathWithPrefix } from "@lib/common/types.ts";
export declare function isValidFilenameInWidows(filename: string): boolean;
export declare function isValidFilenameInDarwin(filename: string): boolean;
export declare function isValidFilenameInLinux(filename: string): boolean;
export declare function isValidFilenameInAndroid(filename: string): boolean;
export declare function isFilePath(path: FilePath | FilePathWithPrefix): path is FilePath;
export declare function stripAllPrefixes(prefixedPath: FilePathWithPrefix): FilePath;
export declare function addPrefix(path: FilePath | FilePathWithPrefix, prefix: string): FilePathWithPrefix;
export declare function expandFilePathPrefix(path: FilePathWithPrefix | FilePath): [string, FilePathWithPrefix];
export declare function expandDocumentIDPrefix(id: DocumentID): [string, FilePathWithPrefix];
export declare function path2id_base(filenameSrc: FilePathWithPrefix | FilePath, obfuscatePassphrase: string | false, caseInsensitive: boolean): Promise<DocumentID>;
export declare function id2path_base(id: DocumentID, entry?: EntryHasPath): FilePathWithPrefix;
export declare function getPath(entry: AnyEntry): FilePathWithPrefix;
export declare function getPathWithoutPrefix(entry: AnyEntry): FilePath;
export declare function stripPrefix(prefixedPath: FilePathWithPrefix): FilePath;
export declare function shouldBeIgnored(filename: string): boolean;
export declare function isPlainText(filename: string): boolean;
export declare function shouldSplitAsPlainText(filename: string): boolean;
/**
 * returns whether the given path is accepted (not ignored) by the `.gitignore`.
 * @param path path of the file which is relative from `.gitignore` file
 * @param ignore lines of `.gitignore`
 * @returns true when accepted.
 * false when not accepted.
 * undefined when the path is not mentioned in the `.gitignore` file.
 */
export declare function isAccepted(path: string, ignore: string[]): boolean | undefined;
/**
 * Checks whether the path is accepted by all ignored files.
 * @param path path of target file
 * @param ignoreFiles list of ignore files. i.e. [".gitignore", ".dockerignore"]
 * @param getList function to retrieve the file.
 * @returns true when accepted. false when should be ignored.
 */
export declare function isAcceptedAll(path: string, ignoreFiles: string[], getList: (path: string) => Promise<string[] | false>): Promise<boolean>;
