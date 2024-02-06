import { webcrypto } from "node:crypto";

const KEY_RECYCLE_COUNT = 100;
type KeyBuffer = {
    key: CryptoKey;
    salt: Uint8Array;
    count: number;
};

let semiStaticFieldBuffer: Uint8Array;
const nonceBuffer: Uint32Array = new Uint32Array(1);
const writeString = (string: string) => {
    // Prepare enough buffer.
    const buffer = new Uint8Array(string.length * 4);
    const length = string.length;
    let index = 0;
    let chr = 0;
    let idx = 0;
    while (idx < length) {
        chr = string.charCodeAt(idx++);
        if (chr < 128) {
            buffer[index++] = chr;
        } else if (chr < 0x800) {
            // 2 bytes
            buffer[index++] = 0xC0 | (chr >>> 6);
            buffer[index++] = 0x80 | (chr & 0x3F);
        } else if (chr < 0xD800 || chr > 0xDFFF) {
            // 3 bytes
            buffer[index++] = 0xE0 | (chr >>> 12);
            buffer[index++] = 0x80 | ((chr >>> 6) & 0x3F);
            buffer[index++] = 0x80 | (chr & 0x3F);
        } else {
            // 4 bytes - surrogate pair
            chr = (((chr - 0xD800) << 10) | (string.charCodeAt(idx++) - 0xDC00)) + 0x10000;
            buffer[index++] = 0xF0 | (chr >>> 18);
            buffer[index++] = 0x80 | ((chr >>> 12) & 0x3F);
            buffer[index++] = 0x80 | ((chr >>> 6) & 0x3F);
            buffer[index++] = 0x80 | (chr & 0x3F);
        }
    }
    return buffer.slice(0, index);
};
const KeyBuffs = new Map<string, KeyBuffer>();
async function getKeyForEncrypt(passphrase: string, autoCalculateIterations: boolean): Promise<[CryptoKey, Uint8Array]> {
    // For performance, the plugin reuses the key KEY_RECYCLE_COUNT times.
    const buffKey = `${passphrase}-${autoCalculateIterations}`;
    const f = KeyBuffs.get(buffKey);
    if (f) {
        f.count--;
        if (f.count > 0) {
            return [f.key, f.salt];
        }
        f.count--;
    }
    const passphraseLen = 15 - passphrase.length;
    const iteration = autoCalculateIterations ? ((passphraseLen > 0 ? passphraseLen : 0) * 1000) + 121 - passphraseLen : 100000;
    const passphraseBin = new TextEncoder().encode(passphrase);
    const digest = await webcrypto.subtle.digest({ name: "SHA-256" }, passphraseBin);
    const keyMaterial = await webcrypto.subtle.importKey("raw", digest, { name: "PBKDF2" }, false, ["deriveKey"]);
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    const key = await webcrypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: iteration,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"]
    );
    KeyBuffs.set(buffKey, {
        key,
        salt,
        count: KEY_RECYCLE_COUNT,
    });
    return [key, salt];
}

function getSemiStaticField(reset?: boolean) {
    // return fixed field of iv.
    if (semiStaticFieldBuffer != null && !reset) {
        return semiStaticFieldBuffer;
    }
    semiStaticFieldBuffer = webcrypto.getRandomValues(new Uint8Array(12));
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
function arrayBufferToBase64internalBrowser(buffer: DataView | Uint8Array): Promise<string> {
    return new Promise((res, rej) => {
        const blob = new Blob([buffer], { type: "application/octet-binary" });
        const reader = new FileReader();
        reader.onload = function (evt) {
            const dataURI = evt.target?.result?.toString() || "";
            if (buffer.byteLength != 0 && (dataURI == "" || dataURI == "data:")) return rej(new TypeError("Could not parse the encoded string"));
            const result = dataURI.substring(dataURI.indexOf(",") + 1);
            res(result);
        };
        reader.readAsDataURL(blob);
    });
}

// Map for converting hexString
const revMap: { [key: string]: number } = {};
const numMap: { [key: number]: string } = {};
for (let i = 0; i < 256; i++) {
    revMap[(`00${i.toString(16)}`.slice(-2))] = i;
    numMap[i] = (`00${i.toString(16)}`.slice(-2));
}


function uint8ArrayToHexString(src: Uint8Array): string {
    return [...src].map(e => numMap[e]).join("");
}

const QUANTUM = 32768;
async function arrayBufferToBase64Single(buffer: ArrayBuffer): Promise<string> {
    const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (buf.byteLength < QUANTUM) return btoa(String.fromCharCode.apply(null, [...buf]));
    return await arrayBufferToBase64internalBrowser(buf);
}


export async function encrypt(input: string, passphrase: string, autoCalculateIterations: boolean) {
    const [key, salt] = await getKeyForEncrypt(passphrase, autoCalculateIterations);
    // Create initial vector with semi-fixed part and incremental part
    // I think it's not good against related-key attacks.
    const fixedPart = getSemiStaticField();
    const invocationPart = getNonce();
    const iv = new Uint8Array([...fixedPart, ...new Uint8Array(invocationPart.buffer)]);
    const plainStringified = JSON.stringify(input);

    // const plainStringBuffer: Uint8Array = tex.encode(plainStringified)
    const plainStringBuffer: Uint8Array = writeString(plainStringified);
    const encryptedDataArrayBuffer = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainStringBuffer);
    const encryptedData2 = (await arrayBufferToBase64Single(encryptedDataArrayBuffer));
    //return data with iv and salt.
    const ret = `["${encryptedData2}","${uint8ArrayToHexString(iv)}","${uint8ArrayToHexString(salt)}"]`;
    return ret;
}

const URIBASE = "obsidian://setuplivesync?settings=";
async function main() {
    const conf = {
        "couchDB_URI": `${Deno.env.get("hostname")}`,
        "couchDB_USER": `${Deno.env.get("username")}`,
        "couchDB_PASSWORD": `${Deno.env.get("password")}`,
        "couchDB_DBNAME": `${Deno.env.get("database")}`,
        "syncOnStart": true,
        "gcDelay": 0,
        "periodicReplication": true,
        "syncOnFileOpen": true,
        "encrypt": true,
        "passphrase": `${Deno.env.get("passphrase")}`,
        "usePathObfuscation": true,
        "batchSave": true,
        "batch_size": 50,
        "batches_limit": 50,
        "useHistory": true,
        "disableRequestURI": true,
        "customChunkSize": 50,
        "syncAfterMerge": false,
        "concurrencyOfReadChunksOnline": 100,
        "minimumIntervalOfReadChunksOnline": 100,
    }
    const encryptedConf = encodeURIComponent(await encrypt(JSON.stringify(conf), "welcome", false));
    const theURI = `${URIBASE}${encryptedConf}`;
    console.log(theURI);
}
await main();