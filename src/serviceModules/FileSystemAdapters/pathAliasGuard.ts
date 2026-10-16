/**
 * Keeps storage from being changed through a name which the file system resolves but no directory lists.
 *
 * A file system may reach one entry under several names: a short name beside the long one, a name with trailing
 * dots or spaces, a name with code points it ignores. Every rule which decides by the spelling of a path, such as
 * the one which keeps synchronised documents out of hidden folders, would then be passed by another spelling. So
 * no segment of a path which exists on disk may be addressed by a name which its parent directory does not list.
 * Names are compared without regard to case and Unicode normalisation, which are the differences the supported
 * file systems fold by design. A symbolic link or junction is listed under its own name and is not an alias.
 */
export interface PathAliasGuardHost {
    /** Whether the vault index holds an entry under exactly this path. Such an entry was listed under that name. */
    isIndexed(path: string): boolean;
    /** Whether the file system resolves this path to an entry, under whatever name. */
    exists(path: string): Promise<boolean>;
    /** The names, or paths, of the entries which a directory lists. The vault root is the empty path. */
    list(directory: string): Promise<string[]>;
}

/** How long the names which a directory listed are taken as still listed. A name which is missed is listed afresh. */
const LISTING_LIFETIME_MS = 1_000;

const foldName = (name: string) => name.normalize("NFC").toLowerCase();

const nameOf = (entry: string) => {
    const segments = entry.split("/").filter((segment) => segment !== "");
    return segments[segments.length - 1] ?? "";
};

export class PathAliasGuard {
    private readonly listings = new Map<string, { names: Set<string>; listedAt: number }>();

    constructor(
        private readonly host: PathAliasGuardHost,
        private readonly now: () => number = Date.now
    ) {}

    private recentListing(directory: string): Set<string> | undefined {
        const listing = this.listings.get(directory);
        if (!listing) return undefined;
        if (this.now() - listing.listedAt <= LISTING_LIFETIME_MS) return listing.names;
        this.listings.delete(directory);
        return undefined;
    }

    private async listAfresh(directory: string): Promise<Set<string>> {
        const names = new Set((await this.host.list(directory)).map((entry) => foldName(nameOf(entry))));
        this.listings.set(directory, { names, listedAt: this.now() });
        return names;
    }

    /**
     * Refuse `path` when one of its segments exists on disk under a name which its parent directory does not list.
     *
     * Nothing is listed for a segment which the vault index holds, and nothing below the first segment which does
     * not exist yet: an entry which is about to be created has no other name. Only a segment which exists outside
     * the index, such as a hidden folder or one created a moment ago, has its parent listed.
     */
    async assertNoAlias(path: string): Promise<void> {
        const segments = path.split("/").filter((segment) => segment !== "");
        let listed = 0;
        for (let length = segments.length; length > 0; length--) {
            if (this.host.isIndexed(segments.slice(0, length).join("/"))) {
                listed = length;
                break;
            }
        }
        for (let index = listed; index < segments.length; index++) {
            const parent = segments.slice(0, index).join("/");
            const name = foldName(segments[index]);
            if (this.recentListing(parent)?.has(name)) continue;
            if (!(await this.host.exists(segments.slice(0, index + 1).join("/")))) return;
            if (!(await this.listAfresh(parent)).has(name)) {
                throw new Error("Refusing a path which reaches an existing entry by a name its folder does not list.");
            }
        }
    }
}

/** The part of the Obsidian app which the guard consults. */
export interface PathAliasGuardApp {
    vault: {
        getAbstractFileByPath(path: string): unknown;
        adapter: {
            exists(path: string): Promise<boolean>;
            list(path: string): Promise<{ files: string[]; folders: string[] }>;
        };
    };
}

export function createPathAliasGuard(app: PathAliasGuardApp): PathAliasGuard {
    return new PathAliasGuard({
        isIndexed: (path) => app.vault.getAbstractFileByPath(path) != null,
        exists: (path) => app.vault.adapter.exists(path),
        list: async (directory) => {
            const listing = await app.vault.adapter.list(directory === "" ? "/" : directory);
            return [...listing.files, ...listing.folders];
        },
    });
}
