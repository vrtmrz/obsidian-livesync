# CouchDB サーバーのセットアップ

## 目次

- [1. CouchDB を準備する](#1-prepare-couchdb)
  - [A. Docker を使用する](#a-using-docker)
  - [B. Docker Compose を使用する](#b-using-docker-compose)
  - [C. CouchDB を直接インストールする](#c-install-couchdb-directly)
- [2. couchdb-init.sh を実行して初期化する](#2-run-couchdb-initsh-for-initialise)
- [3. デバイスから CouchDB に接続できるようにする](#3-expose-couchdb-to-the-internet)
- [4. クライアントのセットアップ](#4-client-setup)
- [手動セットアップ情報](#manual-setup-information)
- [リバースプロキシ](#reverse-proxies)

---

<a id="1-prepare-couchdb"></a>

## 1. CouchDB を準備する

<a id="a-using-docker"></a>

### A. Docker を使用する

<a id="1-prepare"></a>

#### 1. 準備
```bash

# 環境変数を設定する。
export hostname=http://localhost:5984
export username=goojdasjdas     # 好きな値に変更してください。
export password=kpkdasdosakpdsa # 好きな値に変更してください。

# 保存データと設定用のディレクトリを作成する。
mkdir couchdb-data
mkdir couchdb-etc
```

<a id="2-run-docker-container"></a>

#### 2. Docker コンテナを実行する
1. 起動確認。
```
$ docker run --name couchdb-for-ols --rm -it -e COUCHDB_USER=${username} -e COUCHDB_PASSWORD=${password} -v ${PWD}/couchdb-data:/opt/couchdb/data -v ${PWD}/couchdb-etc:/opt/couchdb/etc/local.d -p 5984:5984 couchdb
```
> [!WARNING]
> コンテナがエラーで終了した場合は、couchdb-data と couchdb-etc のアクセス権を確認してください。  
> CouchDB の起動後、これらのディレクトリの所有者は uid:`5984` になります。その uid に所有者を変更し直してください。

2. バックグラウンドで有効化する
```
$ docker run --name couchdb-for-ols -d --restart always -e COUCHDB_USER=${username} -e COUCHDB_PASSWORD=${password} -v ${PWD}/couchdb-data:/opt/couchdb/data -v ${PWD}/couchdb-etc:/opt/couchdb/etc/local.d -p 5984:5984 couchdb
```

完了したら、[手順 2](#2-run-couchdb-initsh-for-initialise)に進んでください。

<a id="b-using-docker-compose"></a>

### B. Docker Compose を使用する

<a id="1-prepare-1"></a>

#### 1. 準備

```
# 保存データと設定用のディレクトリを作成する。
mkdir couchdb-data
mkdir couchdb-etc

# 所有者をユーザー 5984 に変更する。
chown -R 5984:5984 ./couchdb-data
chown -R 5984:5984 ./couchdb-etc
```

<a id="2-create-a-docker-composeyml-file-with-the-following-added-to-it"></a>

#### 2. 次の内容を追加した `docker-compose.yml` ファイルを作成する
```
services:
  couchdb:
    image: couchdb:latest
    container_name: couchdb-for-ols
    user: 5984:5984
    environment:
      - COUCHDB_USER=<INSERT USERNAME HERE>  # 好きな値に変更してください。
      - COUCHDB_PASSWORD=<INSERT PASSWORD HERE> # 好きな値に変更してください。
    volumes:
      - ./couchdb-data:/opt/couchdb/data
      - ./couchdb-etc:/opt/couchdb/etc/local.d
    ports:
      - 5984:5984
    restart: unless-stopped
```

<a id="3-run-the-docker-compose-file-to-boot-check"></a>

#### 3. Docker Compose ファイルを実行して起動確認する

```
docker compose up
# 古いバージョンを使用している場合
docker-compose up
```
> [!WARNING]
> コンテナがエラーで終了した場合は、couchdb-data と couchdb-etc のアクセス権を確認してください。  
> CouchDB の起動後、これらのディレクトリの所有者は uid:`5984` になります。その uid に所有者を変更し直してください。

<a id="4-run-the-docker-compose-file-in-the-background"></a>

#### 4. Docker Compose ファイルをバックグラウンドで実行する
すべて正常に完了し、エラーが発生しなかった場合は、`CTRL+C` で終了してから次のコマンドを実行します。
```
docker compose up -d
# 古いバージョンを使用している場合
docker-compose up -d
```

完了したら、[手順 2](#2-run-couchdb-initsh-for-initialise)に進んでください。

<a id="c-install-couchdb-directly"></a>

### C. CouchDB を直接インストールする
[公式ドキュメント](https://docs.couchdb.org/en/stable/install/index.html)を参照してください。ただし、完全に設定する必要はありません。管理者を設定するだけで十分です。

<a id="2-run-couchdb-initsh-for-initialise"></a>

## 2. couchdb-init.sh を実行して初期化する

Deno 2 が必要です。CouchDB の接続情報とデータベースの詳細をエクスポートし、プロビジョニング用のラッパーを実行します。

この手順の `username` と `password` は CouchDB の管理者認証情報です。Docker または Docker Compose の場合は、`COUCHDB_USER` と `COUCHDB_PASSWORD` に指定した同じ値を使用します。直接インストールした場合は、CouchDB のセットアップ時に設定した管理者を使用します。ラッパーは、管理者以外の同期用アカウントを別途作成しません。

```
export hostname=http://localhost:5984
export username='<INSERT COUCHDB ADMINISTRATOR USERNAME HERE>'
export password='<INSERT COUCHDB ADMINISTRATOR PASSWORD HERE>'
export database=obsidiannotes
curl -s https://raw.githubusercontent.com/vrtmrz/obsidian-livesync/main/utils/couchdb/couchdb-init.sh | bash
```

> [!TIP]
> fish では `hostname` が読み取り専用で、エクスポートできません。代わりに `env` 経由で値を渡してください: `curl -s https://raw.githubusercontent.com/vrtmrz/obsidian-livesync/main/utils/couchdb/couchdb-init.sh | env hostname='http://localhost:5984' username='<INSERT COUCHDB ADMINISTRATOR USERNAME HERE>' password='<INSERT COUCHDB ADMINISTRATOR PASSWORD HERE>' database=obsidiannotes bash`

次のように表示された場合:
```
CouchDB provisioning completed.
```

ラッパーは、レジストリでバージョンを固定した Commonlib を使用するコードをそのまま実行します。`database` を指定すると、データベースを作成し、Commonlib を通じて LiveSync のデータベースバージョンドキュメントを初期化します。`database` を指定しない場合は、CouchDB サーバーの設定のみを行います。

Docker Compose を使用していて上記のコマンドが動作しない場合、または `ERROR: Hostname missing` と表示される場合は、プレースホルダーを自分の値に置き換えて次のコマンドを実行してください:
```
curl -s https://raw.githubusercontent.com/vrtmrz/obsidian-livesync/main/utils/couchdb/couchdb-init.sh | hostname='http://<YOUR SERVER IP>:5984' username='<INSERT COUCHDB ADMINISTRATOR USERNAME HERE>' password='<INSERT COUCHDB ADMINISTRATOR PASSWORD HERE>' database=obsidiannotes bash
```

<a id="3-expose-couchdb-to-the-internet"></a>

## 3. デバイスから CouchDB に接続できるようにする

- CouchDB を信頼できるローカルネットワーク上のデスクトップデバイスでのみ使用する場合は、この手順を省略できます。
  - モバイルデバイスでは、Obsidian は有効な証明書付きの HTTPS を必要とします。HTTPS を使用するために CouchDB を公開する必要はありません。

デバイスから CouchDB サーバーへの接続方法を選択します。自分で運用する[リバースプロキシ](#reverse-proxies)、プライベートネットワーク経由のアクセス、または任意のトンネルサービスを使用できます。[Docker プロファイル](../docker/README.md#profile-details)には例があります。

Cloudflare は任意の選択肢の1つです。次の例では、一時的なテスト用に [Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) を使用します。ランダムなホスト名が表示され、トンネルを作成するたびに変わります。また、`cloudflared` プロセスを停止すると URL は動作しなくなります。Quick Tunnel はテストと開発用であり、本番用ではありません。継続して使用する場合は、選択した接続方法を設定してください。Cloudflare を選ぶ場合は、[Cloudflare Tunnel ガイド](https://developers.cloudflare.com/tunnel/get-started/)が参考になります。

```
cloudflared tunnel --url http://localhost:5984
```

次の 2024 年の出力は形式の例です。ホスト名は例示のみを目的としています。実際には、自分のトンネルが出力した URL を使用してください。

```
2024-02-14T10:35:25Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out. However, be aware that these account-less Tunnels have no uptime guarantee. If you intend to use Tunnels in production you should use a pre-created named tunnel by following: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps
2024-02-14T10:35:25Z INF Requesting new quick Tunnel on trycloudflare.com...
2024-02-14T10:35:26Z INF +--------------------------------------------------------------------------------------------+
2024-02-14T10:35:26Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2024-02-14T10:35:26Z INF |  https://tiles-photograph-routine-groundwater.trycloudflare.com                            |
2024-02-14T10:35:26Z INF +--------------------------------------------------------------------------------------------+
  :
  :
  :
```
トンネルが出力した URL をサーバーアドレスとして使用します。クライアントの設定とテストが完了するまで、トンネルプロセスを実行したままにしてください。

<a id="4-client-setup"></a>

## 4. クライアントのセットアップ
> [!TIP]
> 生成されたセットアップ URI は、新しい Vault の現在のデフォルトと、選択したリモートプロファイルを引き継ぐため、推奨される方法です。セットアップ URI を生成できない場合は、[1台目で CouchDB を手動設定する](./quick_setup_ja.md#1台目で-couchdb-を手動設定する)に従い、その後、動作中のデバイスから新しいセットアップ URI を生成して、追加のデバイスごとに使用してください。

<a id="1-generate-the-setup-uri-on-a-desktop-device-or-server"></a>

### 1. デスクトップデバイスまたはサーバーでセットアップ URI を生成する

ここでの `LIVESYNC_USER` と `LIVESYNC_PASS` は、Self-hosted LiveSync がこのデータベースへの通常のアクセス用に保存する認証情報です。手順 2 の管理者認証情報でもかまいません。このデータベースへの必要なアクセス権を持つ CouchDB アカウントを別途設定している場合は、そのアカウントを使用してください。プロビジョニングラッパーもセットアップ URI ジェネレーターも、その別のアカウントを作成しません。

デバイスから CouchDB に接続するときに使用するサーバー URL を使用します。上記の一時的な Quick Tunnel の例では、実行中の自分のトンネルが出力した URL を使用してください。

```bash
export LIVESYNC_HOST='<YOUR COUCHDB SERVER URL>'
export LIVESYNC_DB=obsidiannotes
export LIVESYNC_USER='<INSERT COUCHDB USERNAME FOR LIVESYNC>'
export LIVESYNC_PASS='<INSERT THE COUCHDB PASSWORD>'
export LIVESYNC_PASSPHRASE='<INSERT A STRONG VAULT ENCRYPTION PASSPHRASE>'
export uri_passphrase='<INSERT A SEPARATE SETUP URI PASSPHRASE>' # 任意
deno run --minimum-dependency-age=0 --allow-env https://raw.githubusercontent.com/vrtmrz/obsidian-livesync/main/utils/setup/generate_setup_uri.ts
```

> [!TIP]
> `LIVESYNC_PASSPHRASE` は、エンドツーエンド暗号化で同期 Vault のデータを保護します。`uri_passphrase` はセットアップ URI のみを保護します。異なる値を使用し、両方を安全に保管し、セットアップ URI とそのパスフレーズを同じ経路で送らないでください。
>
> `uri_passphrase` を省略した場合、ジェネレーターは暗号学的にランダムな値を作成し、一度だけ表示します。

ジェネレーターは、ランダムな ID キーの復旧コードも表示します。同じ Vault のセットアップ URI を再生成する可能性がある場合は、そのコードを保存してください。`id_recovery_code` として渡し直さないと、後で実行したときに異なるキーが作成されます。`id_mode=legacy` は、以前の ID 動作を使用する Vault に接続する場合にのみ設定してください。詳しくは[セットアップユーティリティのリファレンス](../utils/readme.md#setup-uri-generation)を参照してください。

ジェネレーターは、プロビジョニングユーティリティが使用するのと同じ、レジストリでバージョンを固定した Commonlib リリースを使用します。設定済みの CouchDB リモートプロファイルを作成し、新しい Vault の現在のデフォルトを適用して、Commonlib のセットアップ URI 契約でエンコードします。

デフォルトでは、URI は Ephemeral（一時的）であり、ジェネレーターが表示した正確な UTC 時刻までのみ開けます。これは作成から7日後ではなく、固定された7日間の UTC ウィンドウの終了時点です。URI に時間条件が必要ない場合、または既存の暗号化形式をサポートする古いクライアントで読み取る必要がある場合は、コマンドを実行する前に `uri_mode=persistent` を設定してください。

出力は次の形式になります。以下のタイムスタンプと値は例です。

```text
Generated couchdb Setup URI.
Ephemeral: usable until 2026-10-01T00:00:00.000Z (UTC).
Your passphrase for the Setup URI is: H7vX...a-random-32-character-value
This passphrase is never shown again, so store it safely.
ID recovery code: sls-id-v1:<64 lowercase hexadecimal characters>
Use id_recovery_code with this value and reuse the same remote settings when generating another Setup URI for the same Vault.
obsidian://setuplivesync?settings=%5B%22tm2DpsOE74nJAryprZO2M93wF%2Fvg.......4b26ed33230729%22%5D
```

セットアップ URI とそのパスフレーズは別々に保管してください。

<a id="2-setup-self-hosted-livesync-to-obsidian"></a>

### 2. Self-hosted LiveSync を Obsidian にセットアップする

1台目については、[クイックセットアップ](./quick_setup_ja.md#1台目のデバイスをセットアップする)に従ってください。現在のオンボーディング通知、セットアップ URI のインポート、サーバーの初期化、および新しくプロビジョニングされたデータベースで表示される安全確認について説明しています。

通常のノート同期が動作した後、その1台目で[新しいセットアップ URI を生成](./quick_setup_ja.md#別のデバイス用のセットアップ-uri-を作成する)し、[別のデバイスを追加する](./quick_setup_ja.md#別のデバイスを追加する)に従ってください。2台目を、プロビジョニング時に作成した初期セットアップ URI の保持に依存させないでください。オプション機能は、通常の経路が確認された後にのみ設定してください。[非表示ファイル同期には専用のガイド](./tips/hidden-file-sync.md)があります。

---

<a id="manual-setup-information"></a>

## 手動セットアップ情報

<a id="setting-up-your-domain"></a>

### ドメインの設定

ドメインの A レコードをサーバーに向けて設定し、任意の方法でリバースプロキシをホストします。  
注: CouchDB をトップディレクトリにマウントすることは推奨しません。  
Caddy を使用すると、SSL 付きでサーバーを自動的に提供でき便利です。

Caddy と CouchDB を同時に起動する [docker-compose.yml と ini ファイル](https://github.com/vrtmrz/self-hosted-livesync-server)を公開しています。Traefik を使用している場合は、下の[リバースプロキシ](#reverse-proxies)のセクションを確認してください。

また、サーバーログを必ず確認し、不正なアクセスに注意してください。

<a id="reverse-proxies"></a>

## リバースプロキシ

<a id="traefik"></a>

### Traefik

Traefik を使用している場合、この [docker-compose.yml](https://github.com/vrtmrz/obsidian-livesync/blob/main/docker-compose.traefik.yml) ファイル（下にも掲載）には、適切な CORS パラメーターがすべて設定されています。外部ネットワーク `proxy` が存在することを前提としています。

```yaml
services:
  couchdb:
    image: couchdb:latest
    container_name: obsidian-livesync
    user: 1000:1000
    environment:
      - COUCHDB_USER=username
      - COUCHDB_PASSWORD=password
    volumes:
      - ./data:/opt/couchdb/data
      - ./local.ini:/opt/couchdb/etc/local.ini
    # Traefik に渡している場合はポートは不要
    #ports:
    #  - 5984:5984
    restart: unless-stopped
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      # Traefik ネットワーク
      - "traefik.docker.network=proxy"
      # 'obsidian-livesync.example.org' を自分のドメインに置き換えるのを忘れないでください
      - "traefik.http.routers.obsidian-livesync.rule=Host(`obsidian-livesync.example.org`)"
      # 'websecure' エントリーポイントは基本的に HTTPS のエントリーポイントです。問題が発生した場合にのみ次のコードスニペットを確認してください。これがリバースプロキシする最初のコンテナでなければ、おそらく Traefik は正しく設定されています。
      - "traefik.http.routers.obsidian-livesync.entrypoints=websecure"
      - "traefik.http.routers.obsidian-livesync.service=obsidian-livesync"
      - "traefik.http.services.obsidian-livesync.loadbalancer.server.port=5984"
      - "traefik.http.routers.obsidian-livesync.tls=true"
      # 'letsencrypt' を自分の証明書リゾルバーに置き換えてください
      - "traefik.http.routers.obsidian-livesync.tls.certresolver=letsencrypt"
      - "traefik.http.routers.obsidian-livesync.middlewares=obsidiancors"
      # Traefik 2.x で CORS を動作させるために必要な部分はここから
      - "traefik.http.middlewares.obsidiancors.headers.accesscontrolallowmethods=GET,PUT,POST,HEAD,DELETE"
      - "traefik.http.middlewares.obsidiancors.headers.accesscontrolallowheaders=accept,authorization,content-type,origin,referer"
      - "traefik.http.middlewares.obsidiancors.headers.accesscontrolalloworiginlist=app://obsidian.md,capacitor://localhost,http://localhost"
      - "traefik.http.middlewares.obsidiancors.headers.accesscontrolmaxage=3600"
      - "traefik.http.middlewares.obsidiancors.headers.addvaryheader=true"
      - "traefik.http.middlewares.obsidiancors.headers.accessControlAllowCredentials=true"

networks:
  proxy:
    external: true
```

上記で言及した `traefik.yml` 設定ファイルの抜粋:
```yml
...

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: "websecure"
          scheme: "https"
  websecure:
    address: ":443"

...
```

<a id="nginx"></a>

### Nginx

Nginx を CouchDB のリバースプロキシとして設定する際は、よくある間違いに注意してください。

1. Fast Fetch の進捗が止まり、無期限にフリーズしたように見える場合は、`proxy_buffering` が無効になっていることを確認してください:

```nginx
location / {
    proxy_pass http://127.0.0.1:5984;
    proxy_buffering off;
    ...
}
```

2. "413 Entity too large" エラーが発生する場合は、`client_max_body_size` を増やしてください:

```nginx
location / {
    proxy_pass http://127.0.0.1:5984;
    client_max_body_size 50M; # 必要に応じて値を調整してください
    ...
}
```

3. "404 Database not found" エラーが発生する場合は、CouchDB をルートロケーションに配置していることを確認してください（推奨）:

```nginx
server {
    server_name couchdb.domain.com

    location / {
        proxy_pass http://127.0.0.1:5984;
        ...
    }
}
```

CouchDB をサブディレクトリに配置することも可能ですが、設定をそれに合わせて変更する必要があります:

```nginx

server {
    server_name domain.com

    location /couchdb {
        rewrite ^ $request_uri;
        rewrite ^/couchdb/(.*) /$1 break;
        
        proxy_pass http://127.0.0.1:5984$uri;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        ... 
    }
    location /_session {
        proxy_pass http://127.0.0.1:5984/_session;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        ...
    }
}
```

4. データベース接続の詳細設定でカスタム HTTP ヘッダーを追加した場合は、Nginx と CouchDB の両方の設定を更新してください:

Nginx:
```nginx
location / {
    set $pass 1; 
    
    # カスタム HTTP ヘッダーを処理する例
    if ($http_x_custom_header != 'foo'){ 
        set $pass 0; 
    } 

    # 重要: OPTIONS リクエストにはヘッダーが含まれないため、常に CouchDB にプロキシする必要があります
    if ($request_method = 'OPTIONS') { 
        set $pass 1; 
    } 

    if ($pass = 0) { 
        return 403; 
    } 

    proxy_pass http://127.0.0.1:5984;
    ...
}
```

couchdb-etc/docker.ini:
```ini
...
[cors]
credentials = true
origins = app://obsidian.md,capacitor://localhost,http://localhost

;カスタムヘッダーをリストに追加して、CORS が壊れないようにしてください
headers = accept, authorization, content-type, origin, referer, x-custom-header
```
