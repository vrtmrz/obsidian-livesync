import { Logger } from "./logger";
import { LOG_LEVEL } from "./types";

export type encodedData = [encryptedData: string, iv: string, salt: string];
export type KeyBuffer = {
    index: string;
    key: CryptoKey;
    salt: Uint8Array;
};

const KeyBuffs: KeyBuffer[] = [];
const decKeyBuffs: KeyBuffer[] = [];

const KEY_RECYCLE_COUNT = 100;
let recycleCount = KEY_RECYCLE_COUNT;

let semiStaticFieldBuffer: Uint8Array = null;
const nonceBuffer: Uint32Array = new Uint32Array(1);

export async function getKeyForEncrypt(passphrase: string): Promise<[CryptoKey, Uint8Array]> {
    // For performance, the plugin reuses the key KEY_RECYCLE_COUNT times.
    const f = KeyBuffs.find((e) => e.index == passphrase);
    if (f) {
        recycleCount--;
        if (recycleCount > 0) {
            return [f.key, f.salt];
        }
        KeyBuffs.remove(f);
        recycleCount = KEY_RECYCLE_COUNT;
    }
    const xpassphrase = new TextEncoder().encode(passphrase);
    const digest = await crypto.subtle.digest({ name: "SHA-256" }, xpassphrase);
    const keyMaterial = await crypto.subtle.importKey("raw", digest, { name: "PBKDF2" }, false, ["deriveKey"]);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"]
    );
    KeyBuffs.push({
        index: passphrase,
        key,
        salt,
    });
    while (KeyBuffs.length > 50) {
        KeyBuffs.shift();
    }
    return [key, salt];
}

export async function getKeyForDecryption(passphrase: string, salt: Uint8Array): Promise<[CryptoKey, Uint8Array]> {
    const bufKey = passphrase + uint8ArrayToHexString(salt);
    const f = decKeyBuffs.find((e) => e.index == bufKey);
    if (f) {
        return [f.key, f.salt];
    }
    const xpassphrase = new TextEncoder().encode(passphrase);
    const digest = await crypto.subtle.digest({ name: "SHA-256" }, xpassphrase);
    const keyMaterial = await crypto.subtle.importKey("raw", digest, { name: "PBKDF2" }, false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"]
    );
    decKeyBuffs.push({
        index: bufKey,
        key,
        salt,
    });
    while (decKeyBuffs.length > 50) {
        decKeyBuffs.shift();
    }
    return [key, salt];
}

function getSemiStaticField(reset?: boolean) {
    // return fixed field of iv.
    if (semiStaticFieldBuffer != null && !reset) {
        return semiStaticFieldBuffer;
    }
    semiStaticFieldBuffer = crypto.getRandomValues(new Uint8Array(12));
    return semiStaticFieldBuffer;
}

function getNonce() {
    // This is nonce, so do not send same thing.
    nonceBuffer[0]++;
    if (nonceBuffer[0] > 10000) {
        // reset semi-static field.
        getSemiStaticField(true);
    }
    return nonceBuffer;
}

function uint8ArrayToHexString(src: Uint8Array): string {
    return Array.from(src)
        .map((e: number): string => `00${e.toString(16)}`.slice(-2))
        .join("");
}
function hexStringToUint8Array(src: string): Uint8Array {
    const srcArr = [...src];
    const arr = srcArr.reduce((acc, _, i) => (i % 2 ? acc : [...acc, srcArr.slice(i, i + 2).join("")]), []).map((e) => parseInt(e, 16));
    return Uint8Array.from(arr);
}
export async function encrypt(input: string, passphrase: string) {
    const [key, salt] = await getKeyForEncrypt(passphrase);
    // Create initial vector with semifixed part and incremental part
    // I think it's not good against related-key attacks.
    const fixedPart = getSemiStaticField();
    const invocationPart = getNonce();
    const iv = Uint8Array.from([...fixedPart, ...new Uint8Array(invocationPart.buffer)]);
    const plainStringified: string = JSON.stringify(input);
    const plainStringBuffer: Uint8Array = new TextEncoder().encode(plainStringified);
    const encryptedDataArrayBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainStringBuffer);

    const encryptedData = window.btoa(Array.from(new Uint8Array(encryptedDataArrayBuffer), (char) => String.fromCharCode(char)).join(""));

    //return data with iv and salt.
    const response: encodedData = [encryptedData, uint8ArrayToHexString(iv), uint8ArrayToHexString(salt)];
    const ret = JSON.stringify(response);
    return ret;
}

export async function decrypt(encryptedResult: string, passphrase: string): Promise<string> {
    try {
        const [encryptedData, ivString, salt]: encodedData = JSON.parse(encryptedResult);
        const [key] = await getKeyForDecryption(passphrase, hexStringToUint8Array(salt));
        const iv = hexStringToUint8Array(ivString);
        // decode base 64, it should increase speed and i should with in MAX_DOC_SIZE_BIN, so it won't OOM.
        const encryptedDataBin = window.atob(encryptedData);
        const encryptedDataArrayBuffer = Uint8Array.from(encryptedDataBin.split(""), (char) => char.charCodeAt(0));
        const plainStringBuffer: ArrayBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encryptedDataArrayBuffer);
        const plainStringified = new TextDecoder().decode(plainStringBuffer);
        const plain = JSON.parse(plainStringified);
        return plain;
    } catch (ex) {
        Logger("Couldn't decode! You should wrong the passphrases", LOG_LEVEL.VERBOSE);
        Logger(ex, LOG_LEVEL.VERBOSE);
        throw ex;
    }
}

export async function testCrypt() {
    const src = "supercalifragilisticexpialidocious";
    const encoded = await encrypt(src, "passwordTest");
    const decrypted = await decrypt(encoded, "passwordTest");
    if (src != decrypted) {
        Logger("WARNING! Your device would not support encryption.", LOG_LEVEL.VERBOSE);
        return false;
    } else {
        Logger("CRYPT LOGIC OK", LOG_LEVEL.VERBOSE);
        return true;
    }
}
