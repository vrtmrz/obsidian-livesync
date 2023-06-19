# CouchDBのセットアップ方法

## CouchDBのインストールとPCやMacでの使用
CouchDBを構築するには、[Dockerのイメージ](https://hub.docker.com/_/couchdb)を使用するのが一番簡単です。  
ただし、インストールしたCouchDBをSelf-hosted LiveSyncから使用するためには、少々設定が必要となります。  
具体的には、下記の設定が`local.ini`として必要になります。

```
[couchdb]
single_node=true
max_document_size = 50000000

[chttpd]
require_valid_user = true
max_http_request_size = 4294967296

[chttpd_auth]
require_valid_user = true
authentication_redirect = /_utils/session.html

[httpd]
WWW-Authenticate = Basic realm="couchdb"
enable_cors = true

[cors]
origins = app://obsidian.md,capacitor://localhost,http://localhost
credentials = true
headers = accept, authorization, content-type, origin, referer
methods = GET, PUT, POST, HEAD, DELETE
max_age = 3600
```

このファイルを作成し、
```
$ docker run --rm -it -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password -v .local.ini:/opt/couchdb/etc/local.ini -p 5984:5984 couchdb
```
とすると簡単にCouchDBを起動することができます。  
備考：このとき、local.iniのオーナーが5984:5984になります。これは、Dockerイメージの制限事項です。編集する場合はいったんオーナーを変更してください。  
正常にSelf-hosted LiveSyncからアクセスすることができたら、お好みでバックグラウンドで起動するように編集して起動してください。  
例）  
```
$ docker run -d --restart always -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password -v .local.ini:/opt/couchdb/etc/local.ini -p 5984:5984 couchdb
```


## モバイルからのアクセス
MacやPCからアクセスする場合は上記の方法で作ったサーバーで問題ありませんが、モバイル端末からアクセスする場合は有効なSSLの証明書が必要となります。

### モバイルからのアクセスのテスト
テストを行う場合は、[localhost.run](http://localhost.run/)などのサービスが便利です。
```
$ ssh -R 80:localhost:5984 nokey@localhost.run
Warning: Permanently added the RSA host key for IP address '35.171.254.69' to the list of known hosts.

===============================================================================
Welcome to localhost.run!

Follow your favourite reverse tunnel at [https://twitter.com/localhost_run].

**You need a SSH key to access this service.**
If you get a permission denied follow Gitlab's most excellent howto:
https://docs.gitlab.com/ee/ssh/
*Only rsa and ed25519 keys are supported*

To set up and manage custom domains go to https://admin.localhost.run/

More details on custom domains (and how to enable subdomains of your custom
domain) at https://localhost.run/docs/custom-domains

To explore using localhost.run visit the documentation site:
https://localhost.run/docs/

===============================================================================


** your connection id is xxxxxxxxxxxxxxxxxxxxxxxxxxxx, please mention it if you send me a message about an issue. **

xxxxxxxx.localhost.run tunneled with tls termination, https://xxxxxxxx.localhost.run
Connection to localhost.run closed by remote host.
Connection to localhost.run closed.
```
このように表示された場合、`https://xxxxxxxx.localhost.run`が一時的なサーバアドレスとして使用できます。

### ドメインを設定してアクセスする。

DNSのAレコードを設定し、お好みの方法でリバースプロキシをホスティングしてください。  
備考:トップディレクトリにCouchDBを露出させるのはおすすめしません。  
Caddy等でLet's Encryptの証明書を自動取得すると運用が楽になります。

CaddyとCouchDBを同時に立てられる[docker-composeの設定とiniファイル](https://github.com/vrtmrz/self-hosted-livesync-server)を公開しています。
ぜひご利用下さい。

なお、サーバのログは必ず確認し、不正なアクセスに注意してください。