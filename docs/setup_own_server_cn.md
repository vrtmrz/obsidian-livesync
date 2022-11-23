# 在你自己的服务器上设置 CouchDB

> 注：提供了 [docker-compose.yml 和 ini 文件](https://github.com/vrtmrz/self-hosted-livesync-server) 可以同时启动 Caddy 和 CouchDB。推荐直接使用该 docker-compose 配置进行搭建。（若使用，请查阅链接中的文档，而不是这个文档）

## 安装 CouchDB 并从 PC 或 Mac 上访问

设置 CouchDB 的最简单方法是使用 [CouchDB docker image]((https://hub.docker.com/_/couchdb)).

需要修改一些 `local.ini` 中的配置，以让它可以用于 Self-hosted LiveSync，如下：

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

创建 `local.ini` 并用如下指令启动 CouchDB：
```
$ docker run --rm -it -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password -v .local.ini:/opt/couchdb/etc/local.ini -p 5984:5984 couchdb
```
Note: 此时 local.ini 的文件所有者会变成 5984:5984。这是 docker 镜像的限制，请修改文件所有者后再编辑 local.ini。

在确定 Self-hosted LiveSync 可以和服务器同步后，可以后台启动 docker 镜像：

```
$ docker run -d --restart always -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password -v .local.ini:/opt/couchdb/etc/local.ini -p 5984:5984 couchdb
```

## 从移动设备访问
如果你想要从移动设备访问 Self-hosted LiveSync，你需要一个合法的 SSL 证书。

### 移动设备测试
测试时，[localhost.run](http://localhost.run/) 这一类的反向隧道服务很实用。（非必须，只是用于终端设备不方便 ssh 的时候的备选方案）

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

https://xxxxxxxx.localhost.run 即为临时服务器地址。

### 设置你的域名

设置一个指向你服务器的 A 记录，并根据需要设置反向代理。

Note: 不推荐将 CouchDB 挂载到根目录  
可以使用 Caddy 很方便的给服务器加上 SSL 功能

提供了 [docker-compose.yml 和 ini 文件](https://github.com/vrtmrz/self-hosted-livesync-server) 可以同时启动 Caddy 和 CouchDB。

注意检查服务器日志，当心恶意访问。
