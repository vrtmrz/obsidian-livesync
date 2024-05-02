import { PersistentMap } from "../lib/src/dataobject/PersistentMap.ts";

export let sameChangePairs: PersistentMap<number[]>;

export function initializeStores(vaultName: string) {
    sameChangePairs = new PersistentMap<number[]>(`ls-persist-same-changes-${vaultName}`);
}
