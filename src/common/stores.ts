import { PersistentMap } from "octagonal-wheels/dataobject/PersistentMap";

export let sameChangePairs: PersistentMap<number[]>;

export function initializeStores(vaultName: string) {
    sameChangePairs = new PersistentMap<number[]>(`ls-persist-same-changes-${vaultName}`);
}
