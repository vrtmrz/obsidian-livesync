# Self-hosted LiveSync
[英語版ドキュメント](./README.md) - [中国語版ドキュメント](./README_cn.md).

Self-hosted LiveSync は、Obsidian 対応のすべてのプラットフォームで利用できる、コミュニティ開発の同期プラグインです。CouchDB や MinIO、S3、R2 などのオブジェクトストレージを利用し、信頼性の高いデータ同期を実現します。

WebRTC によるピアツーピア（P2P）同期にも対応しており、中央のデータ保存サーバーを介さずにデバイス間でノートを交換できます。ピアの検出にはシグナリングリレーが必要です。詳しくは[ピアツーピア同期の仕組み](./docs/p2p.md)をご覧ください。

セットアップガイド、トラブルシューティング、技術資料、設計判断、過去の資料は[ドキュメント一覧](docs/README.md)から確認できます。

![obsidian_live_sync_demo](https://user-images.githubusercontent.com/45774780/137355323-f57a8b09-abf2-4501-836c-8cb7d2ff24a3.gif)

>[!IMPORTANT]
> このプラグインは公式の「Obsidian Sync」と互換性がなく、同サービスとは同期できません。

## 機能
- Vault を効率的に、通信量を抑えて同期します。
- 競合する変更を適切に処理します。
  - 単純な競合は自動的にマージします。
- サーバーにはオープンソースのソリューションを使用します。
  - 互換性のあるソリューションにも対応します。
- エンドツーエンド暗号化に対応します。
- [カスタマイズ同期（高度な設定）](docs/settings_ja.md#6-customisation-sync-advanced)または[非表示ファイル同期](docs/tips/hidden-file-sync.md)で、設定、スニペット、テーマ、プラグインを同期します。
- WebRTC によるピアツーピア同期を行います。

このプラグインは、セキュリティ上の理由からノートを完全に自己管理する必要がある研究者、エンジニア、開発者に特に適しています。ノートが完全にプライベートなままであることに安心感を求める方にも適しています。

>[!IMPORTANT]
> - このプラグインをインストールまたはアップグレードする前に、Vault をバックアップしてください。
> - iCloud や Obsidian Sync など、同じ Vault に書き込む他の同期ソリューションと同時に有効にしないでください。
> - バックアップには、[Differential ZIP Backup](https://github.com/vrtmrz/diffzip) も利用できます。

## このプラグインの使い方

セルフホストでは、信頼できるサーバーを選び、自分で管理できます。サーバーをセットアップして保守し、安全な状態を保ってください。

<a id="setup-workflows"></a>

### 必要なもの

| 方法 | 必要なもの | あると便利なもの |
| --- | --- | --- |
| CouchDB | CouchDB 互換サーバー | — |
| オブジェクトストレージ | S3 互換サービスまたはサーバー | — |
| ピアツーピア | 不要 | 独自のシグナリングサーバー |

CouchDB 互換サーバーを使う場合は、環境に合ったセットアップガイドを選んでください。

- [自分のサーバー](docs/setup_own_server_ja.md): Raspberry Pi など、自分で管理するサーバーで CouchDB を実行します。
- [Docker](docker/README.md): 付属の Docker スタックで CouchDB をデプロイします。
- [Fly.io](docs/setup_flyio.md): ホスト型インフラ上で自分の CouchDB インスタンスを管理します。
- [IBM Cloudant（マネージド）](docs/setup_cloudant_ja.md): IBM が管理するデータベースサービスを利用します。

各ガイドでセットアップ方法とプロバイダー固有の費用を確認してください。

<a id="3-minute-setup---couchdb-on-flyio"></a>

Fly.io の動画による手順は、[自動セットアップ](docs/setup_flyio.md#a-very-automated-setup)を参照してください。

P2P では中央のデータ保存サーバーは不要ですが、ピアの検出にはシグナリングリレーが必要です。プロジェクトの公開シグナリングリレーを利用できるため、サーバーを用意する必要はありません。別のデバイスが同期している間は、必要なデータを持つデバイスを少なくとも1台オンラインにしてください。[P2P の通信モデル](./docs/p2p.md)を確認してから、[ピアツーピアのセットアップ](./docs/setup_p2p.md)に進んでください。

デバイス上で P2P のセットアップと接続がどのように動作するかを確認したい場合は、実験的な [WebPeer ブラウザーユーティリティ](https://vrtmrz.github.io/obsidian-livesync/webpeer/)のガイド付き接続チェックを試してください。空の Vault を使用し、ノートの同期はテストしません。範囲と制限は [WebPeer のドキュメント](src/apps/webpeer/README.md)を参照してください。

### 同期を開始する

1. 最初のデバイスで、CouchDB の[クイックセットアップ](docs/quick_setup_ja.md)、[オブジェクトストレージのセットアップ](docs/setup_object_storage.md)、または[ピアツーピアのセットアップ](docs/setup_p2p.md)を使用して Self-hosted LiveSync をインストールおよび設定します。
2. 動作中のデバイスからセットアップ URI を生成し、同じガイドに従って他のデバイスを追加します。
3. テスト用ノートを作成し、双方向に同期されることを確認します。

<a id="third-party-managed-couchdb-hosting"></a>

### コミュニティが紹介するホスティングサービス

> [!NOTE]
> 以下のサービスは第三者によって運営されています。Self-hosted LiveSync の公式サービスではなく、本プロジェクトが推奨または保証するものでもありません。表内の掲載は各プロバイダーから提案されたものです。

自分でサーバーをセットアップして保守したくない場合は、以下のプロバイダーが、このプラグインから接続できるマネージド CouchDB サーバーを提供しています。

| プロバイダー | 提供内容 |
| --- | --- |
| [Zenith Hosting](https://zenith.hosting/host/obsidian-livesync) | マネージド CouchDB ホスティング。 |

同期データはプロバイダーが運営するサーバーに保存されます。Vault にとって許容できるか検討し、利用前にプロバイダーの最新の利用規約、料金、データ取扱方針を確認してください。

## ステータスバーの説明

同期ステータスは、デフォルトでステータスバーとエディタ内に表示されます。主な表示は以下のとおりです。

| 表示 | 意味 |
| --- | --- |
| ⏹️ | 停止中。 |
| 🌀 | 同期を開始しています。 |
| 💤 | LiveSync モードが変更を待っています。 |
| ⚡️ | 同期中です。 |
| ⏩ | CouchDB の変更履歴を比較しています（ローカルに保持済みの項目も含みます）。 |
| ⚠ | エラーが発生しました。 |
| ↑ / ↓ | アップロード／ダウンロードしたチャンクとメタデータ。 |
| 📲 / 🌐N | 個別のリモート操作を実行中／概算のリモートリクエスト数。 |

<a id="customising-status-items-with-css-snippets"></a>

詳細な進捗カウンターと [CSS のカスタマイズ](docs/tips/status-display.md#customising-status-items-with-css-snippets)については、[ステータス表示ガイド](docs/tips/status-display.md)を参照してください。

Obsidian を閉じる前に、保留中のファイル操作が完了するまで待ってください。特にファイルの削除や名前変更の後は注意してください。

## ヒントとトラブルシューティング
- 後続のデバイスをセットアップする際に、より高速で簡単な初期複製を行う場合は、[Fast Setup ガイド](docs/tips/fast-setup_ja.md)を参照してください。
- 通常のノート同期が動作することを確認してから、[非表示ファイル同期](docs/tips/hidden-file-sync.md)を設定してください。
- Obsidian または LiveSync が正常に起動できない場合は、リモートデータベースを変更またはリセットする前に、[復旧とフラグファイル](docs/recovery.md)を確認してください。
- Self-hosted LiveSync 1.0 には Obsidian 1.7.2 以降が必要です。旧バージョンの Obsidian で 1.0 を使用する必要がある場合は、バージョン、プラットフォーム、およびそのバージョンにとどまる理由を添えて [Issue を作成](https://github.com/vrtmrz/obsidian-livesync/issues/new?template=issue-report.md)してください。サポートの拡張が可能かどうかを検討します。標準のコミュニティプラグインインストーラーでは、互換性のある古いプラグインリリースが選択されます。
- プラグインが動作しない場合は、[トラブルシューティング](docs/troubleshooting.md)を参照してください。

## 謝辞
本プロジェクトの継続的な発展は、以下の方々の支援によって支えられています。
- 多くの [コントリビューター](https://github.com/vrtmrz/obsidian-livesync/graphs/contributors)の皆様。
- 多くの [GitHub スポンサー](https://github.com/sponsors/vrtmrz#sponsors)の皆様。
- JetBrains コミュニティプログラム / オープンソースプロジェクト支援 <img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jetbrains.png" alt="JetBrains logo" height="24">

貢献してくださった方々のご厚意とご支援に、深く感謝します。

## 開発ガイド
開発環境のセットアップ、テスト基盤、コード規約などについては、[開発ガイド](devs.md)を参照してください。

## ライセンス

MIT License の下で公開されています。
