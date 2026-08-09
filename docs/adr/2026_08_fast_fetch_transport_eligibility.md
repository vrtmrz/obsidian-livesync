# Architectural Decision Record: Fast Fetch Transport Eligibility

## Status

Accepted

## Context

Fast Fetch accelerates Fast Setup (Simple Fetch) by reading bounded pages from
CouchDB's continuous changes feed. It consumes each response incrementally,
persists documents while the page is still arriving, and cancels the underlying
request when the page completes or fails.

The CouchDB setting `useRequestAPI`, labelled 'Use Internal API', routes ordinary
replication through Obsidian's `requestUrl` API to avoid browser CORS
restrictions. This API exposes a completed response as text, JSON, or an
`ArrayBuffer`; it does not expose the network response progressively or accept
the Fetch API's `AbortSignal`. Wrapping its result in a `Response` does not
restore those transport properties.

Custom headers can cause a browser preflight, and an authenticating proxy may
reject that preflight before the requested header values are sent. Custom
headers do not, however, make Fast Fetch intrinsically incompatible. A server
with correctly configured CORS can accept the same headers through the ordinary
Fetch API and retain streaming behaviour.

Ordinary PouchDB replication has a different response contract. Standard Fetch
uses finite batches, while LiveSync uses long-poll responses whose change
payload is bounded by the replication batch size. Both can process each response
after it has completed and do not depend on progressively reading a
document-bearing continuous feed.

## Decision

Fast Fetch requires a Fetch-compatible transport which exposes the response
body progressively and honours request cancellation.

When `useRequestAPI` is enabled for a CouchDB remote, Fast Fetch falls back to
Standard Fetch before entering the Fast Fetch activity or resetting the local
database through the Fast Fetch path. The presence of custom headers alone does
not disable Fast Fetch. Once Standard Fetch resets the local database, it
invalidates any retained Fast Fetch checkpoint for that database.

Commonlib's Rebuilder owns this eligibility decision because it owns both Fast
Fetch and the existing Standard Fetch fallback. The streaming implementation
does not receive Obsidian's buffered request adapter, and LiveSync does not add
proxy-specific or Cloudflare-specific policy.

## Consequences

- Initial retrieval through Standard Fetch may be slower and issue more HTTP
  requests because PouchDB uses the configured batch size, document retrieval,
  and checkpoint operations. The decision does not assume that `requestUrl` is
  faster; its benefit here is compatibility with connections which browser CORS
  would otherwise reject.
- LiveSync remains supported with `useRequestAPI`. Its HTTP adapter uses
  long-poll responses whose change payload is bounded by the replication batch
  size, rather than the document-bearing stream required by Fast Fetch.
- A user whose server accepts the configured custom headers through correct
  CORS handling can leave `useRequestAPI` disabled and continue to use Fast
  Fetch.
- The decision can be revisited if Obsidian provides a progressively readable,
  cancellable internal request API, or if a separately designed buffered
  transport establishes explicit payload bounds and equivalent cancellation
  semantics.

## Verification

Commonlib unit tests verify that `useRequestAPI` selects only the existing
Standard Fetch activity, does not invoke Streaming Fetch, and invalidates any
retained Fast Fetch checkpoint after the local database is reset. Existing
tests continue to verify that custom headers are passed to Fast Fetch when
`useRequestAPI` is disabled.

## References

- [Fast Fetch Persistence and Completion Semantics](2026_08_fast_fetch_persistence_and_completion.md)
- [Apache CouchDB changes-feed API](https://docs.couchdb.org/en/stable/api/database/changes.html)
