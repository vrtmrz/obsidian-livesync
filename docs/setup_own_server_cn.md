# 在你自己的服务器上设置 CouchDB

## 目录
- [配置 CouchDB](#配置-CouchDB)
- [运行 CouchDB](#运行-CouchDB)
  - [Docker CLI](#docker-cli)
  - [Docker Compose](#docker-compose)
- [创建数据库](#创建数据库)
- [从移动设备访问](#从移动设备访问)
  - [移动设备测试](#移动设备测试)
  - [设置你的域名](#设置你的域名)
---

> 注：提供了 [docker-compose.yml 和 ini 文件](https://github.com/vrtmrz/self-hosted-livesync-server) 可以同时启动 Caddy 和 CouchDB。推荐直接使用该 docker-compose 配置进行搭建。（若使用，请查阅链接中的文档，而不是这个文档）

## 配置 CouchDB

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

## 运行 CouchDB

### Docker CLI

你可以通过指定 `local.ini` 配置运行 CouchDB:

```
$ docker run --rm -it -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password -v /path/to/local.ini:/opt/couchdb/etc/local.ini -p 5984:5984 couchdb
```
*记得将上述命令中的 local.ini 挂载路径替换成实际的存放路径*

后台运行:
```
$ docker run -d --restart always -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password -v /path/to/local.ini:/opt/couchdb/etc/local.ini -p 5984:5984 couchdb
```
*记得将上述命令中的 local.ini 挂载路径替换成实际的存放路径*

### Docker Compose
创建一个文件夹, 将你的 `local.ini` 放在文件夹内, 然后在文件夹内创建 `docker-compose.yml`. 请确保对 `local.ini` 有读写权限并且确保在容器运行后能创建 `data` 文件夹. 文件夹结构大概如下:
```
obsidian-livesync
├── docker-compose.yml
└── local.ini
```

可以参照以下内容编辑 `docker-compose.yml`:
```yaml
version: "2.1"
services:
  couchdb:
    image: couchdb
    container_name: obsidian-livesync
    user: 1000:1000
    environment:
      - COUCHDB_USER=admin
      - COUCHDB_PASSWORD=password
    volumes:
      - ./data:/opt/couchdb/data
      - ./local.ini:/opt/couchdb/etc/local.ini
    ports:
      - 5984:5984
    restart: unless-stopped
```

最后, 创建并启动容器:
```
# -d will launch detached so the container runs in background
docker-compose up -d
```

## 创建数据库

CouchDB 部署成功后, 需要手动创建一个数据库, 方便插件连接并同步.

1. 访问 `http://localhost:5984/_utils`, 输入帐号密码后进入管理页面
2. 点击 Create Database, 然后根据个人喜好创建数据库

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
