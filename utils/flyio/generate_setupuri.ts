import { encrypt } from "npm:octagonal-wheels@0.1.11/encryption/encryption.js";

const noun = ["waterfall", "river", "breeze", "moon", "rain", "wind", "sea", "morning", "snow", "lake", "sunset", "pine", "shadow", "leaf", "dawn", "glitter", "forest", "hill", "cloud", "meadow", "sun", "glade", "bird", "brook", "butterfly", "bush", "dew", "dust", "field", "fire", "flower", "firefly", "feather", "grass", "haze", "mountain", "night", "pond", "darkness", "snowflake", "silence", "sound", "sky", "shape", "surf", "thunder", "violet", "water", "wildflower", "wave", "water", "resonance", "sun", "log", "dream", "cherry", "tree", "fog", "frost", "voice", "paper", "frog", "smoke", "star"];
const adjectives = ["autumn", "hidden", "bitter", "misty", "silent", "empty", "dry", "dark", "summer", "icy", "delicate", "quiet", "white", "cool", "spring", "winter", "patient", "twilight", "dawn", "crimson", "wispy", "weathered", "blue", "billowing", "broken", "cold", "damp", "falling", "frosty", "green", "long", "late", "lingering", "bold", "little", "morning", "muddy", "old", "red", "rough", "still", "small", "sparkling", "thrumming", "shy", "wandering", "withered", "wild", "black", "young", "holy", "solitary", "fragrant", "aged", "snowy", "proud", "floral", "restless", "divine", "polished", "ancient", "purple", "lively", "nameless"];
function friendlyString() {
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]}-${noun[Math.floor(Math.random() * noun.length)]}`;
}

const uri_passphrase = `${Deno.env.get("uri_passphrase") ?? friendlyString()}`;


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
    const encryptedConf = encodeURIComponent(await encrypt(JSON.stringify(conf), uri_passphrase, false));
    const theURI = `${URIBASE}${encryptedConf}`;
    console.log("\nYour passphrase of Setup-URI is: ", uri_passphrase);
    console.log("This passphrase is never shown again, so please note it in a safe place.")
    console.log(theURI);
}
await main();