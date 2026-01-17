# Self-hosted LiveSync

Self-hosted LiveSync (自搭建在线同步) 是一个社区实现的在线同步插件。  
它利用诸如CouchDB或对象存储系统（例如MinIO、S3、R2等）等强大的服务器解决方案，以确保数据同步的可靠性。。兼容所有支持 Obsidian 的平台。

此外，它现在支持使用WebRTC进行点对点同步（实验性功能），使您无需依赖服务器即可直接在设备之间同步笔记。

>[!IMPORTANT]
>本插件与官方的 "Obsidian Sync" 服务不兼容。

![obsidian_live_sync_demo](https://user-images.githubusercontent.com/45774780/137355323-f57a8b09-abf2-4501-836c-8cb7d2ff24a3.gif)

安装或升级 LiveSync 之前，请备份你的 vault。

## 功能

-   以最少流量高效同步vault
-   有效处理冲突的修改。
  - 自动合并简单冲突。
- 服务端使用开源的解决方案
  - 支持兼容的解决方案。
- 支持端到端加密。
- 同步设置、代码片段、主题和插件，通过 [Customisation Sync (Beta)](docs/settings.md#6-customization-sync-advanced) 或者 [Hidden File Sync](docs/settings.md#7-hidden-files-advanced).
- 启用 WebRTC 点对点同步，无需指定 `host`（实验性）。
  - 此功能仍处于试验阶段。请在使用时务必谨慎。
  - WebRTC 是一种点对点同步方法，因此**至少有一台设备必须在线才能进行同步**。
  - 与其让您的设备作为稳定的对等节点保持在线，您可以使用两个 pseudo-peers:
    - [livesync-serverpeer](https://github.com/vrtmrz/livesync-serverpeer): 在服务器上运行的 pseudo-client 用于在设备之间接收和发送数据。
    - [webpeer](https://github.com/vrtmrz/livesync-commonlib/tree/main/apps/webpeer): 用于在设备之间接收和发送数据的pseudo-client。
    - 一个预构建的实例现已上线，地址为 [fancy-syncing.vrtmrz.net/webpeer](https://fancy-syncing.vrtmrz.net/webpeer/) (托管于vrtmrz博客网站). 这也是一个点对点的实例。可自由使用。
  - 欲了解更多信息，请参阅[英文说明文章](https://fancy-syncing.vrtmrz.net/blog/0034-p2p-sync-en.html)或[日文说明文章](https://fancy-syncing.vrtmrz.net/blog/0034-p2p-sync)。

此插件适用于出于安全原因需要将笔记完全自托管的研究人员、工程师或开发人员，以及任何喜欢笔记完全私密所带来的安全感的人。

>[!IMPORTANT]
> - 在安装或升级此插件之前，请务必备份您的保险库。
> - 请勿同时启用此插件与其它同步方案（包括iCloud和Obsidian Sync）。
> - 对于备份，我们还提供了一款名为[Differential ZIP Backup](https://github.com/vrtmrz/diffzip)的插件。

## 如何使用

### 3分钟搞定——在fly.io上部署CouchDB

**推荐初学者第一次使用此方法**
[![LiveSync Setup onto Fly.io SpeedRun 2024 using Google Colab](https://img.youtube.com/vi/7sa_I1832Xc/0.jpg)](https://www.youtube.com/watch?v=7sa_I1832Xc)

1. [Setup CouchDB on fly.io](docs/setup_flyio.md)
2. 在 [Quick Setup](docs/quick_setup.md) 中配置插件。

### 手动设置

1. 配置服务器
   1. [在fly.io上快速搭建CouchDB](docs/setup_flyio.md)
   2. [自行搭建CouchDB](docs/setup_own_server.md)
2. 在[快速设置](docs/quick_setup.md)中配置插件
   
> [!提示]
> Fly.io现已不再免费。不过，尽管存在一些问题，我们仍可使用IBM Cloudant。请参考[搭建IBM Cloudant](docs/setup_cloudant.md)。
> 此外，我们还可以采用点对点同步方式，无需搭建服务器；或者选用价格极低的对象存储——Cloudflare R2可免费使用。
> 但最重要的是，我们可以选择自己信任的服务器。因此，建议您搭建自有服务器
> CouchDB可在树莓派上运行。（但请务必注意服务器的安全性）。



## 状态栏中的信息

同步状态显示在状态栏中，采用以下图标。

-   活动指示器
    -   📲 网络请求
-   状态
    -   ⏹️ 已停止
    -   💤 LiveSync已启用，正在等待更改
    -   ⚡️ 同步中
    -   ⚠ 发生了错误
-   统计指标
     -   ↑ 上传的分块与元数据
     -   ↓ 下载的分块与元数据
-   进度指示器
     -   📥 未处理的传输项
     -   📄 正在进行的数据库操作
     -   💾 正在进行的写入存储进程
     -   ⏳ 正在进行的读取存储进程
     -   🛫 待处理的读取存储进程
     -   📬 批量处理的读取存储进程
     -   ⚙️ 正在进行或待处理的隐藏文件存储进程
     -   🧩 等待中的分块
     -   🔌 正在进行的自定义项（配置、代码片段和插件）

为避免文件和数据库损坏，请等待所有进度指示器尽可能消失后再关闭 Obsidian（插件也会尝试恢复同步进度）。特别是在您已删除或重命名文件的情况下，请务必遵守此操作。


## 使用技巧与故障排除
如果您在配置插件时遇到问题，请参阅：[Tips and Troubleshooting](docs/troubleshooting.md). 


## 致谢
本项目得以持续顺利推进，离不开以下各方的贡献：  
- 众多[贡献者](https://github.com/vrtmrz/obsidian-livesync/graphs/contributors)。  
- 许多[GitHub 赞助人](https://github.com/sponsors/vrtmrz#sponsors)。  
- JetBrains 社区计划／对开源项目的支持。<img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jetbrains.png" alt="JetBrains logo" height="24">  

愿所有作出贡献的人士因其善良与慷慨而受到尊敬与铭记。

## 许可协议

本项目采用 MIT 许可协议授权。
