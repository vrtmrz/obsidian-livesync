// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { arrayBufferToBase64, base64ToArrayBuffer, base64ToArrayBufferInternalBrowser, readString, writeString, tryConvertBase64ToArrayBuffer } from "octagonal-wheels/binary";
export { arrayBufferToBase64, base64ToArrayBuffer, base64ToArrayBufferInternalBrowser, readString, writeString, tryConvertBase64ToArrayBuffer, };
export declare function arrayBufferToBase64Single(buffer: Uint8Array | ArrayBuffer): Promise<string>;
export { uint8ArrayToHexString, hexStringToUint8Array } from "octagonal-wheels/binary/hex";
export { encodeBinaryEach, decodeToArrayBuffer } from "octagonal-wheels/binary/encodedUTF16";
export { decodeBinary, encodeBinary } from "octagonal-wheels/binary";
export { escapeStringToHTML } from "octagonal-wheels/string";
export declare function versionNumberString2Number(version: string): number;
