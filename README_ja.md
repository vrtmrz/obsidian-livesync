<!-- For translation: 20240227r0 -->
# Self-hosted LiveSync
[英語版ドキュメント](./README.md) - [中国語版ドキュメント](./README_cn.md).

Obsidianで利用可能なすべてのプラットフォームで使える、CouchDBをサーバに使用する、コミュニティ版の同期プラグイン

![obsidian_live_sync_demo](https://user-images.githubusercontent.com/45774780/137355323-f57a8b09-abf2-4501-836c-8cb7d2ff24a3.gif)

※公式のSyncと同期することはできません。


## 機能
- 高効率・低トラフィックでVault同士を同期
- 競合解決がいい感じ
  - 単純な競合なら自動マージします
- OSSソリューションを同期サーバに使用
  - 互換ソリューションも使用可能です
- End-to-End暗号化実装済み
- 設定・スニペット・テーマ、プラグインの同期が可能
-  [Webクリッパー](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf) もあります

NDAや類似の契約や義務、倫理を守る必要のある、研究者、設計者、開発者のような方に特にオススメです。


>[!IMPORTANT]
> - インストール・アップデート前には必ずVaultをバックアップしてください
> - 複数の同期ソリューションを同時に有効にしないでください（これはiCloudや公式のSyncも含みます）
> - このプラグインは同期プラグインです。バックアップとして使用しないでください


## このプラグインの使い方

### 3分セットアップ - CouchDB on fly.io

**はじめての方におすすめ**

[![LiveSync Setup onto Fly.io SpeedRun 2024 using Google Colab](https://img.youtube.com/vi/7sa_I1832Xc/0.jpg)](https://www.youtube.com/watch?v=7sa_I1832Xc)

1. [Fly.ioにCouchDBをセットアップする](docs/setup_flyio.md)
2. [Quick Setup](docs/quick_setup_ja.md)でプラグインを設定する


### Manually Setup

1. サーバのセットアップ
   1. [Fly.ioにCouchDBをセットアップする](docs/setup_flyio.md)
   2. [CouchDBをセットアップする](docs/setup_own_server_ja.md)
2. [Quick Setup](docs/quick_setup_ja.md)でプラグインを設定する

> [!TIP]
> IBM Cloudantもまだ使用できますが、いくつかの理由で現在はおすすめしていません。[IBM Cloudantのセットアップ](docs/setup_cloudant_ja.md)はまだあります。

## ステータスバーの説明

同期ステータスはステータスバーに、下記のアイコンとともに表示されます

-   アクティビティー
    -   📲 ネットワーク接続中
-   同期ステータス
    -   ⏹️ 停止中
    -   💤 変更待ち（LiveSync中）
    -   ⚡️ 同期の進行中
    -   ⚠ エラー
-   統計情報
     -   ↑ アップロードしたチャンクとメタデータ数
     -   ↓ ダウンロードしたチャンクとメタデータ数
-   進捗情報
     -   📥 転送後、未処理の項目数
     -   📄 稼働中データベース操作数
     -   💾 稼働中のストレージ書き込み数操作数
     -   ⏳ 稼働中のストレージ読み込み数操作数
     -   🛫 待機中のストレージ読み込み数操作数
     -   ⚙️ 隠しファイルの操作数（待機・稼働中合計）
     -   🧩 取得待ちを行っているチャンク数
     -   🔌 設定同期関連の操作数

データベースやファイルの破損を避けるため、Obsidianの終了は進捗情報が表示されなくなるまで待ってください（プラグインも復帰を試みますが）。特にファイルを削除やリネームした場合は気をつけてください。


## Tips and Troubleshooting
何かこまったら、[Tips and Troubleshooting](docs/troubleshooting.md)をご参照ください。

## License

Licensed under the MIT License.