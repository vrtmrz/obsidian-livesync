# Data Compression specification

## Status and decision for 1.0

Data Compression is a maintained, advanced opt-in feature for CouchDB-compatible remote databases. It remains disabled by default in the 1.0 line.

The feature provides a modest, measurable reduction in mixed-workload storage and transfer volume. Its value depends heavily on the chunk contents, while the current implementation adds substantial processing and worker-memory costs. Users with slow, metered, or storage-constrained connections may still find that trade-off worthwhile.

## Stored-data behaviour

The `enableCompression` setting affects chunk documents written through the CouchDB remote connection. It does not compress the local database, and it is separate from the journal format used by Object Storage synchronisation.

For each document containing string `data`, the writer:

1. detects canonical Base64 and decodes it to bytes, or encodes text as UTF-8;
2. applies raw DEFLATE through fflate at level 8;
3. encodes the result as Base64 and adds the LiveSync compressed-data marker; and
4. stores the compressed representation only when its string representation is shorter than the original.

Already compressed data and data which does not become smaller are therefore retained unchanged. Readers always recognise and expand the compressed-data marker, including when their own `enableCompression` setting is off. Compressed and uncompressed chunks can coexist in the same remote database.

When E2EE is enabled, compression is applied before E2EE V2 encryption. The encrypted remote representation does not expose the compression marker.

Changing the setting does not require a rebuild for compatibility: new writes adopt the selected policy, while existing chunks remain readable. All devices are still asked to agree on the remote tweak value so that future writes use one consistent policy. A deliberate remote rebuild can normalise existing storage, but it is optional rather than a prerequisite for synchronisation.

## Execution model

The compression and decompression algorithms are not executed synchronously on Obsidian's UI thread. Browser builds call fflate's asynchronous `deflate` and `inflate` APIs, which create a Web Worker for an operation and terminate it after the callback. The CLI uses the corresponding Node worker-thread path.

The PouchDB transform hook, Base64 detection and conversion, UTF-8 conversion, worker creation, result conversion, and document mutation still run in the calling JavaScript context. The current implementation also creates a separate fflate worker for each attempted chunk rather than reusing LiveSync's persistent splitting and encryption worker pool. `transform-pouch` applies the incoming transform to a bulk batch with `Promise.all`, so a batch can start many of these workers concurrently. It can therefore consume significant total CPU and memory, and worker churn may still affect responsiveness or mobile process limits even though the DEFLATE calculation itself is off the UI thread.

The current benchmark measures the Node CLI process. It does not establish Obsidian UI event-loop latency, Electron renderer responsiveness, mobile WebView memory behaviour, battery use, thermal throttling, or platform watchdog thresholds. Those remain real-runtime validation gaps.

## Reproducible benchmark

The benchmark is implemented under `src/apps/cli/testdeno` and packaged by `test/bench-network`. It uses the real CLI mirror and synchronisation path, Commonlib 0.1.0-rc.4, CouchDB 3.5.0, the V3 Rabin–Karp splitter, optional Data Compression, and E2EE V2. It runs each of these conditions three times in rotating order:

- E2EE off, compression off;
- E2EE off, compression on;
- E2EE on, compression off; and
- E2EE on, compression on.

The 623,553-byte deterministic fixture contains three Markdown files, two generated JPEG files, two repository PNG files, two JSON files, two TypeScript files, one gzip file, and one high-entropy binary file. Every run materialises and byte-compares all 13 files after synchronisation.

Run it from the repository root:

```bash
BENCH_COMMAND=compression \
BENCH_COMPRESSION_REPEAT_COUNT=3 \
BENCH_COUCHDB_RTT_MS=1 \
docker compose -f test/bench-network/compose.yml run --build --rm bench-runner
```

The latest local three-repeat result was generated on 21st July, 2026. The percentages below compare medians with compression off and on.

| Measurement                                      | E2EE off | E2EE on |
| ------------------------------------------------ | -------: | ------: |
| Stored chunk-data reduction                      |    9.12% |   9.01% |
| CouchDB external-size reduction                  |    9.03% |   8.92% |
| CouchDB file-size reduction                      |    2.57% |   7.62% |
| Upload request-body reduction                    |    8.58% |   8.61% |
| Complete materialisation response-body reduction |    6.56% |   4.84% |
| Upload wall-time increase                        |  197.10% | 199.29% |
| Upload CPU-time increase                         |  650.43% | 581.54% |
| Complete materialisation wall-time increase      |   19.58% |  19.75% |
| Complete materialisation CPU-time increase       |   45.11% |  43.98% |

With E2EE on, median upload wall time rose from 1.49 seconds to 4.45 seconds, CPU time rose from 1.30 seconds to 8.86 seconds, and upload maximum resident memory rose from about 160 MiB to 403 MiB. The full materialisation workflow starts a CLI process for each file and produced a much higher compressed-path peak of about 983 MiB; treat that figure as evidence about the current CLI workflow rather than a browser decompression lower bound.

The E2EE upload saved 99,034 decoded HTTP body bytes while adding about 2.96 seconds of local processing wall time. A simple serial-transfer estimate puts the wall-time break-even near 0.27 Mbit/s. This estimate excludes headers, contention, request overlap, radio energy, data charges, and server behaviour. The benchmark does not emulate a bandwidth-limited mobile link, so transfer-volume reduction may still be valuable where elapsed time is not the only cost.

## Results by file kind

The E2EE stored chunk-data reductions were:

| Fixture kind        | Reduction |
| ------------------- | --------: |
| Markdown            |    16.30% |
| JPEG                |     4.72% |
| PNG                 |     6.16% |
| JSON                |    72.80% |
| TypeScript          |    74.11% |
| gzip                |        0% |
| high-entropy binary |        0% |

These results describe payload and chunk characteristics, not a reliable file-extension policy. The JSON and TypeScript fixtures were repetitive and mapped to relatively large chunks. The Markdown files were split into 151 referenced chunks, so small-chunk overhead and limited repetition windows reduced their benefit. JPEG, PNG, and gzip inputs had already undergone format-level compression, while the deterministic binary input was intentionally difficult to compress.

The remote transform sees a content-addressed chunk, not a trustworthy original file type. A chunk can also be deduplicated across files with different extensions. Enabling compression only for selected extensions would therefore either require carrying new provenance into the chunk format or make the representation depend on whichever file first produced a shared chunk. Neither is suitable for the 1.0 format.

## Follow-up optimisation candidates

The first optimisation should remove unbounded per-chunk worker creation:

1. add compression and decompression tasks to a reusable worker pool;
2. run synchronous fflate inside those workers so that it does not create a nested worker for each task;
3. put a bounded scheduler or semaphore before dispatch, rather than submitting the complete `Promise.all` batch at once;
4. transfer derived input and output `ArrayBuffer` objects explicitly in each `postMessage` transfer list; and
5. decide that a result is not smaller inside the worker, so an unhelpful compressed buffer does not need to be returned.

LiveSync's current `bgWorker` is a useful starting point because it creates a fixed pool of approximately half the reported hardware concurrency and selects workers in round-robin order. It is not sufficient unchanged: its `processing` count does not control selection, and it does not limit the number of tasks posted to each worker. Its foreground modules also form a circular dependency: `bgWorker.ts` imports the splitting and encryption adapters, while those adapters import task dispatch and removal from `bgWorker.ts`. Compression must not add another branch to that cycle.

Before adding compression, the Worker code should be separated into a dependency-bottom pool, task registry, scheduler, and transfer transport, with splitting, encryption, and compression implemented as task adapters above it. The shared scheduler should own concurrency limits, cancellation, crash propagation, fairness, and task clean-up. Compression then needs either a separate bounded lane or scheduling which prevents a long level-8 task from starving splitting and encryption work.

The `TransformStream` currently used by `bgWorker.splitting` is local to the calling context; it is not transferred to the Worker. Moving a stream endpoint across contexts could provide real end-to-end back-pressure, but it is not the first memory optimisation for Data Compression. The [Streams Standard transfer algorithm](https://streams.spec.whatwg.org/#transferable-streams) transfers the stream endpoint and posts each chunk through an internal `MessagePort` with an empty transfer list. Binary chunks can therefore still be cloned. Explicitly transferring each `ArrayBuffer` is the clearer zero-copy boundary for independent chunk tasks.

Cross-context transferable streams also cannot yet be required by the supported mobile baseline. WebKit lists `ReadableStream`, `WritableStream`, and `TransformStream` transfer via `postMessage()` as a [Safari 27 beta addition](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/#readablestream-improvements). A future general `bgWorker` redesign may use transferable streams behind capability detection, particularly where back-pressure matters more than copying, but it needs a message-based fallback.

After bounding worker use, adaptive per-chunk compression can reduce unnecessary work without depending on the source filename:

1. skip very small chunks where the marker and worker start-up dominate;
2. sample decoded bytes and estimate entropy or repetition before starting level-8 DEFLATE;
3. require both a minimum byte saving and a minimum percentage saving;
4. compare lower DEFLATE levels against level 8; and
5. replace one-worker-per-chunk operation with a bounded, persistent compression worker pool and back-pressure.

Any optimisation must preserve the current wire contract: content may remain uncompressed, the compressed marker must stay readable, compression must precede E2EE, and mixed representations must interoperate. It should be evaluated with the same four-condition benchmark, a bandwidth-shaped case, UI event-loop latency, and at least one real mobile Obsidian run before reconsidering the default.
