import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2] || '.bench/rabin-window-fixed');
const baselineDirectory = resolve(process.argv[3] || '.bench/chunk-size');
const load = async (file, base = directory) => JSON.parse(await fs.readFile(join(base, file), 'utf8'));
const summary = await load('summary.json');
const baseline = await load('summary.json', baselineDirectory);
const comparison = await load('comparison.json');
const validation = await load('validation.json');
const boundary = await load('cloudant-json-boundary/results.json');
const consumer = await load('context/validated-consumer.json');
const recovery = await load('context/cli-bundle-recovery.json');
assert.equal(validation.completedRemoteCases, 30);
assert.equal(validation.completedP2PCases, 12);
assert.equal(summary.corpus.manifestSha256, baseline.corpus.manifestSha256);
const mib = bytes => (bytes / 1048576).toFixed(3);
const second = milliseconds => (milliseconds / 1000).toFixed(2);
const getRemote = (data, provider, size, stage) => data.remote.find(row => row.provider === provider && row.customChunkSize === size && row.stage === stage);
const getP2P = (data, size, stage) => data.p2p.find(row => row.customChunkSize === size && row.stage === stage);
const getLocal = (data, size, stage) => data.local.find(row => row.customChunkSize === size && row.stage === stage);
const decrease = (before, after) => ((1 - after / before) * 100).toFixed(1);
const lines = [];
const paragraph = text => lines.push(text, '');
paragraph('Rabin–Karp窓処理修正後の実測（Self-hosted LiveSync 1.0.39 / Commonlib 0.1.44の未公開修正パッケージ）');
paragraph('窓処理は、今回の挿入後のチャンク再利用を妨げていた原因の一つだった。最小限の修正をCommonlibへ加え、前回と完全に同じ入力・設定・候補を再測定した。今回の混在コーパスでは、通常の新規推奨値を4（上限500 KiB）へ揃える案が有力になった。Cloudant対応は接続先ごとの推奨値ではなく、将来の同期先も含むvault共通のデータ制約として扱う必要がある。ただし数値4だけで全設定のCloudant互換性を保証する結論ではない。初期値、推奨値、UI、および移行処理はまだ変更していない。');
paragraph(`LiveSyncの基点は ${consumer.liveSyncBaseRevision}、Commonlibの基点は ${consumer.commonlibBaseRevision}。Commonlib所有リポジトリーの作業ツリーで修正し、単体・境界・リリースツール・パッケージ検証を通したtarballをLiveSyncへfile依存として入れた。公開版0.1.44を置換して公開したものではない。候補の実体は ${consumer.packageIntegrity}、インストール済みchunks.jsのSHA-256は ${consumer.installedChunksSha256}。`);
paragraph('修正はsrc/string_and_binary/chunks.tsの窓更新条件を pos >= start + windowSize から pos >= windowSize へ変える1行と、その目的を示すコメントである。境界でstartが進んでも、hashの48バイト窓を連続して更新する。形式、ID導出方法、設定キー、最小・平均・最大チャンク目標は変更していない。');
paragraph('先に3件の振る舞いの回帰テストを追加し、未修正の公開0.1.44相当ソースで3件とも期待した境界assertionが失敗することを確認した。バイナリ300/300/300 KiBの目印列は従来300/256/256/88 KiBとなり、挿入後の同一末尾チャンクを再利用できなかった。テキストの目印列でも過去のチャンクの影響が残った。修正後は3件とも成功し、再構成した全バイトも一致した。Commonlib全123ファイル・2,416テスト、型、boundary、release tools、packed consumerが成功した。LiveSyncはnpm 10クリーンインストール、通常npm ci、check、単体1,297成功・1 skipped、およびObsidian bundle/CLI/WebApp/WebPeerビルドが成功した。Community lintの既存51 warningsは残っている。');
paragraph(`入力は前回と同じ15ファイル、初期合計 ${mib(summary.corpus.stages[0].sourceBytes)} MiB。通常のプロジェクトMarkdown10本、約512 KiBと約5 MiBの生成Markdown、PNG2枚、および固定seedの8 MiB高エントロピーバイナリである。manifest SHA-256は ${summary.corpus.manifestSha256}。段階は初回、4 KiBのバイナリ上書き等、続いてバイナリ途中4 KiB挿入と生成Markdownへの段落挿入。設定はRabin–Karp、minimumChunkSize=20、E2EE V2、独立ID鍵version 1、パス・内部Metadata暗号化、チャンク圧縮なし、Edenなし、全chunk取得で固定した。`);
paragraph('ローカル分割は0,1,4,10,20,40,60を各3回。HTTPはCouchDB 3.5.0とRustFSを0,4,10,20,40各3回、P2Pは0,4,10,40各3回。同じホスト上の生成テストvaultとタスク専用コンテナを使用し、WAN遅延やパケットロスは加えていない。CPU負荷をかける検証・測定は同時に実行していない。Node v24.18.0 / Linux arm64 / Neoverse-N1 / 論理CPU3である。');
paragraph('以下はHTTPの実送信本文の3回中央値。ヘッダー・TLSは含めない。同期秒数はCLI起動を含み、事前のmirrorと転送後のファイル復元・SHA照合を含まない。OSキャッシュやサービスは各回に再起動していない。S3のJournalパック圧縮はenableCompressionによるチャンク圧縮とは別である。');
lines.push('remote | value | 初期送信MiB | 上書き送信MiB | 挿入送信MiB | 初期送信秒 | 初期受信秒 | 初期HTTP要求数');
for (const provider of ['couchdb', 's3']) for (const size of [0, 4, 10, 20, 40]) {
    const initial = getRemote(summary, provider, size, 'initial');
    const overwrite = getRemote(summary, provider, size, 'overwrite');
    const insert = getRemote(summary, provider, size, 'insert');
    lines.push([provider, size, mib(initial.upload_requestBodyBytes.median), mib(overwrite.upload_requestBodyBytes.median), mib(insert.upload_requestBodyBytes.median), second(initial.upload_elapsedMs.median), second(initial.download_elapsedMs.median), initial.upload_requests.median].join(' | '));
}
lines.push('');
paragraph('P2Pは全回host<->host経路。werift 0.24.4のcandidate-pair bytesカウンターは0のため採用せず、RTCDataChannelの実送信payloadを両端で観測した。下表は送信元host側で、RPC制御とアプリ層再送を含み、SCTP/DTLS/UDP/IPのヘッダー、下位層再送、Nostr signallingは含まない。HTTP本文量と完全に同じ層ではない。同期時間は探索・接続・双方向同期を含む。');
lines.push('value | 初期送信MiB | 上書き送信MiB | 挿入送信MiB 中央値 [min..max] | 初期同期秒 | 上書き同期秒 | 挿入同期秒');
for (const size of [0, 4, 10, 40]) {
    const initial = getP2P(summary, size, 'initial'); const overwrite = getP2P(summary, size, 'overwrite'); const insert = getP2P(summary, size, 'insert');
    lines.push([size, mib(initial.host_payloadBytesSent.median), mib(overwrite.host_payloadBytesSent.median), `${mib(insert.host_payloadBytesSent.median)} [${mib(insert.host_payloadBytesSent.min)}..${mib(insert.host_payloadBytesSent.max)}]`, second(initial.elapsedMs.median), second(overwrite.elapsedMs.median), second(insert.elapsedMs.median)].join(' | '));
}
lines.push('');
paragraph('値4の途中挿入における修正前→修正後の比較は次のとおり。');
lines.push('対象 | 修正前MiB | 修正後MiB | 減少率');
const oldRaw = getLocal(baseline, 4, 'insert').binaryNewRawBytes; const newRaw = getLocal(summary, 4, 'insert').binaryNewRawBytes;
lines.push(`新しく必要なバイナリの生データ | ${mib(oldRaw)} | ${mib(newRaw)} | ${decrease(oldRaw, newRaw)}%`);
for (const provider of ['couchdb', 's3']) {
    const oldValue = getRemote(baseline, provider, 4, 'insert').upload_requestBodyBytes.median; const newValue = getRemote(summary, provider, 4, 'insert').upload_requestBodyBytes.median;
    lines.push(`${provider}送信本文 | ${mib(oldValue)} | ${mib(newValue)} | ${decrease(oldValue, newValue)}%`);
}
const oldPeer = getP2P(baseline, 4, 'insert').host_payloadBytesSent.median; const newPeer = getP2P(summary, 4, 'insert').host_payloadBytesSent.median;
lines.push(`P2P host payload | ${mib(oldPeer)} | ${mib(newPeer)} | ${decrease(oldPeer, newPeer)}%`, '');
paragraph('通常の4 MiB未満のMarkdown11本×3段階は、修正後も7候補の全てで分割境界とIDが一致した。customChunkSizeを上げてもこの領域のID数は減らない。新しい独立ID鍵方式のIDは67文字で、旧暗号化xxhash64比較は14〜16文字、中央値16文字だった。ID命名の変更がIDを短くしたという前提は置けない。');
paragraph('0/1ではバイナリ・大きいテキストの最小値が最大値へクランプされ、100/200 KiBの固定分割になるため、窓修正後も挿入時の再同期の利点は出ない。小さい局所上書きだけなら0が有利だが、今回の挿入を含む編集では4の方が大幅に少なく済む。40と60は実装上の4 MiB上限に達し、全15ファイル×3段階で分割境界とIDが完全一致した。60の重複するネットワーク測定は省いた。');
for (const provider of ['couchdb', 's3']) {
    const four = getRemote(summary, provider, 4, 'initial').upload_requestBodyBytes.median;
    const forty = getRemote(summary, provider, 40, 'initial').upload_requestBodyBytes.median;
    paragraph(`${provider}で4から40へ増やした初回送信量の削減は ${((1 - forty / four) * 100).toFixed(3)}%程度だった。上書き・挿入では40の送信量が大きく、今回の条件から大きいチャンクを維持する性能上の根拠は得られなかった。`);
}
paragraph('S3ではどの候補も初回7オブジェクト・14 HTTP要求だった。4と40は編集時もそれぞれ1オブジェクト追加・6 HTTP要求で、chunk数の削減がそのままPUT削減になる構成ではない。AWS等の実サービスの課金やWAN性能を測った値ではない。P2Pでは回ごとの再送等の変動があるため、中央値だけでなくsummary.jsonのmin/maxも参照する。150msの断片再要求との因果は計測しておらず、この処理は変更していない。');
paragraph('Cloudantの現行IBM公式limits（2026-10-23確認）は、単一JSON文書1 MB、リクエスト全体64MB、添付10 MB。https://cloud.ibm.com/docs/Cloudant?topic=Cloudant-limits 。chunksは添付ではなくJSON文書として送る。モデルには保守的に1,000,000 / 64,000,000 bytesを使った。通常の暗号化条件ではCouchDBに文書上限だけをかけ、4は15ファイルの復元まで成功、10は413となった。4の最大保存文書は910,461 bytes、通常HTTP測定の最大リクエストは約10.27 MBで、両方の上限内だった。');
paragraph('別の境界probeでは、実際の分割器・圧縮・暗号化関数を用い、レプリケーションのrevisionフィールドを含む合成leafを送信した。結果は次のとおり。');
lines.push('入力 | value | 暗号化 | 圧縮 | JSON文書bytes | CouchDB HTTP status');
for (const row of boundary.cases) lines.push([row.kind, row.customChunkSize, row.encryption, row.compression, row.jsonBytes, row.status].join(' | '));
lines.push('');
paragraph('値4のバイナリはraw 512,000 bytes → base64 682,668 bytes → E2EE V1/V2で約910.5 KBとなった。値5のE2EE V2は1,092,573 bytesとなり、文書上限で413が返った。したがって暗号化バイナリに対して4は整数の候補として上限に近く、余裕を残す候補である。');
paragraph('ただし、CouchDB 3.5.0のmax_document_sizeはparsed document bodyをcouch_ejson_size:encoded_sizeで概算し、文字列はUTF-8長に2を足すだけでJSON escapeを数えない。このためNULの未暗号化テキストはwire上3,072,213 bytesでも、モデルの1 MB文書制限では受理された。Cloudant内部の算定が完全に同一であるとは確認していない。単純にwire JSONが1 MB超なら必ずCloudantの文書制限で失敗する、とこの結果から断定してはいけない。公式CouchDBソースはcontext/couch_doc-3.5.0.erlとcontext/couch_ejson_size-3.5.0.erlに保存した。');
paragraph('一括リクエストは別の制限である。分割器が作った500 KiBの異なる制御文字テキスト25個をまとめると76,805,358 bytesとなり、64,000,000-byte request制限で413になった。20個なら61,444,288 bytesで受理された。これは合成bulk requestの境界probeであり、アプリケーションの通常同期全体で同じbulkが組まれると実証したテストではない。現在の通常Couch同期のbatch_size=25では、暗号化文書が1 MB以内なら25 MB程度だが、暗号化しないテキストのescape膨張には件数制限だけでは十分でない。optional bulk chunk sendには独自のbyte制限もあるので、その経路と通常Pouch replicationの経路を区別する必要がある。');
paragraph('CloudantモデルはローカルCouchDBで制限を模したものであり、IBM Cloudantサービス自体の同期・性能は測定していない。全probe後に両制限設定を復元し、合成文書のDBも削除した。Cloudantの互換性を約束するなら、leafだけでなくMetadataを含む最終文書とバッチの実サイズも方針の対象にするのが妥当である。');
paragraph(`旧版と修正版の混在は、同じ旧依存リンクからビルドを復元し、旧entryが前回の保存物と完全一致することを確認して実測した（${recovery.originalEntryBitIdenticalToBaselineArchive}）。旧→新、新→旧の各3段階×15ファイル、計${validation.mixedVersionVerifiedFileStages}件でSHA-256が一致した。チャンクの保存形式とID方式は引き続き読める。再利用効率を揃えるには書込み端末の分割実装も揃える方がよい。最初の互換性試行は旧bundleの付随CJS不足で実行前に失敗し、そのログと復元記録を保存した。復元後の全試行は成功した。`);
const cutover = comparison.cutover.find(row => row.customChunkSize === 40);
paragraph(`窓の修正で分割境界が変わるため、既存ファイルを再保存する初回には追加チャンクが多く必要になり得る。ローカルの同じ初期データを値40で比較すると、新方式のunique raw ${mib(cutover.totalNewAlgorithmUniqueRawBytes)} MiB中、旧初期chunkに存在しない部分は ${mib(cutover.bytesNotPresentInOldAlgorithmInitialChunks)} MiBだった。これは内容/ID照合による算定で、実際のアップグレード時の転送量を測定した値ではない。以後の同じ方式での編集に対する改善とは分けて扱う。`);
paragraph('設定整理への提案は、通常の新規作成・推奨値をremote種別によらず4へ揃える方向で進め、旧設定の省略値や既存remoteで合意済みのtweakを一律に書き換えないことである。60と10を標準候補として分ける根拠は今回弱い。一方、Cloudantへ将来同期する意図を問うなら、現在の接続先ではなくvault全体の互換方針として扱い、全書込み端末で守る必要がある。暗号化・JSON化・バッチ化後の上限を内部で導出し、ユーザーへ組合せの数字を選ばせることは避けたい。');
paragraph('現在のremote profile URIは接続欄だけを含み、customChunkSizeは共通設定である。通常のprofile切替でその値を変えないが、起動時のCloudant接続先補正やpreferred tweak採用では変わる経路がある。保存済みleafは転送時に再分割されない。Cloudant対応を後から有効化して値だけ下げても、既存の大きいleafがそのまま残るため、互換方針を変える移行では既存DBの検査・再構成も別途設計する必要がある。これは今回未実装の設計案である。');
paragraph(`検証結果は、主測定42ケース・126段階×15ファイル=${validation.verifiedFileStages}件のSHA-256一致、保存後設定${validation.checkedPersistedConfigurations}件の条件一致、混在版${validation.mixedVersionVerifiedFileStages}件のSHA-256一致。通常Markdown、40/60同一、全分割の再構成、反復でのID・境界再現性、および同じIDの内容一致も成功した。`);
paragraph('保存物は生JSON、summary/CSV、comparison.json、validation.json、全入力corpus、各caseのログ・設定・P2Pカウンター、scripts、contextの完全な旧/新CLI bundleとlockfile、commonlibの修正差分・回帰テスト・検証ログ・tarball、およびartifacts.sha256である。巨大な作業用DB複製は含めず、再生成できる入力と証拠を保存する。旧baselineは親ディレクトリーにそのまま残している。');
paragraph('再現時はLiveSync固定コミットとCommonlib固定コミットの作業ツリーを用意し、Commonlibのproduction.patchとsource内の回帰テストを反映する。Commonlibの元リポジトリーで検証し、保存済みtarballと同じ実体をLiveSyncにfile依存として入れる。scriptsをLiveSyncのutils/chunk-size-benchmarkへ置き、npm 10 ci、通常npm ci、check、unit、全app buildの順に実行する。旧版の再構築には公開0.1.44パッケージを使い、実行本体だけでなくdist全体を別ディレクトリーへ残す。新しい出力先とLIVESYNC_BENCH_VARIANT=rolling-window-fixedを使ってlocal/remote/cloudant probes/compatibility/p2pを逐次実行し、summarise、compare、verify-results、reportの順に集計する。ローカル専用fixtureの起動・停止にもcomposeのproject名を指定する。');
await fs.writeFile(join(directory, 'report.txt'), lines.join('\n'));
console.log(JSON.stringify({ report: join(directory, 'report.txt'), bytes: Buffer.byteLength(lines.join('\n')) }));
