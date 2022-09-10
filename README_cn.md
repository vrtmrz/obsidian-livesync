# Self-hosted LiveSync

Self-hosted LiveSync (自搭建在线同步) 是一个社区实现的在线同步插件。  
使用一个自搭建的或者购买的 CouchDB 作为中转服务器。兼容所有支持 Obsidian 的平台。

注意: 本插件与官方的 "Obsidian Sync" 服务不兼容。

![obsidian_live_sync_demo](https://user-images.githubusercontent.com/45774780/137355323-f57a8b09-abf2-4501-836c-8cb7d2ff24a3.gif)

安装或升级 LiveSync 之前，请备份你的 vault。

## 功能

-   可视化的冲突解决器
-   接近实时的多设备双向同步
-   可使用 CouchDB 以及兼容的服务，如 IBM Cloudant
-   支持端到端加密
-   插件同步 (Beta)
-   从 [obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf) 接收 WebClip (本功能不适用端到端加密)

适用于出于安全原因需要将笔记完全自托管的研究人员、工程师或开发人员，以及任何喜欢笔记完全私密所带来的安全感的人。

## 重要提醒

-   请勿与其他同步解决方案（包括 iCloud、Obsidian Sync）一起使用。在启用此插件之前，请确保禁用所有其他同步方法以避免内容损坏或重复。如果要同步到多个服务，请一一进行，切勿同时启用两种同步方法。
    这包括不能将您的保管库放在云同步文件夹中（例如 iCloud 文件夹或 Dropbox 文件夹）
-   这是一个同步插件，不是备份解决方案。不要依赖它进行备份。
-   如果设备的存储空间耗尽，可能会发生数据库损坏。
-   隐藏文件或任何其他不可见文件不会保存在数据库中，因此不会被同步。（**并且可能会被删除**）

## 如何使用

### 准备好你的数据库

首先，准备好你的数据库。IBM Cloudant 是用于测试的首选。或者，您也可以在自己的服务器上安装 CouchDB。有关更多信息，请参阅以下内容：
1. [Setup IBM Cloudant](docs/setup_cloudant.md)
2. [Setup your CouchDB](docs/setup_own_server_cn.md)

Note: 正在征集更多搭建方法！目前在讨论的有 [使用 fly.io](https://github.com/vrtmrz/obsidian-livesync/discussions/85)。

### 第一个设备

1. 在您的设备上安装插件。
2. 配置远程数据库信息。
	1. 将您的服务器信息填写到 `Remote Database configuration`（远程数据库配置）设置页中。
	2. 建议启用 `End to End Encryption`（端到端加密）。输入密码后，单击“应用”。
	3. 点击 `Test Database Connection` 并确保插件显示 `Connected to (你的数据库名称)`。
	4. 单击 `Check database configuration`（检查数据库配置）并确保所有测试均已通过。
3. 在 `Sync Settings`（同步设置）选项卡中配置何时进行同步。（您也可以稍后再设置）
	1. 如果要实时同步，请启用 `LiveSync`。
	2. 或者，根据您的需要设置同步方式。默认情况下，不会启用任何自动同步，这意味着您需要手动触发同步过程。
	3. 其他配置也在这里。建议启用 `Use Trash for deleted files`（删除文件到回收站），但您也可以保持所有配置不变。
4. 配置杂项功能。
	1. 启用 `Show staus inside editor` 会在编辑器右上角显示状态。（推荐开启）
5. 回到编辑器。等待初始扫描完成。
6. 当状态不再变化并显示 ⏹️ 图标表示 COMPLETED（没有 ⏳ 和 🧩 图标）时，您就可以与服务器同步了。
7. 按功能区上的复制图标或从命令面板运行 `Replicate now`（立刻复制）。这会将您的所有数据发送到服务器。
8. 打开命令面板，运行 `Copy setup URI`（复制设置链接），并设置密码。这会将您的配置导出到剪贴板，作为您导入其他设备的链接。

**重要: 不要公开本链接，这个链接包含了你的所有认证信息！** (即使没有密码别人读不了)

### 后续设备

注意：如果要与非空的 vault 进行同步，文件的修改日期和时间必须互相匹配。否则，可能会发生额外的传输或文件可能会损坏。
为简单起见，我们强烈建议同步到一个全空的 vault。

1. 安装插件。
2. 打开您从第一台设备导出的链接。
3. 插件会询问您是否确定应用配置。 回答 `Yes`，然后按照以下说明进行操作：
	1. 对 `Keep local DB?` 回答 `Yes`。
	*注意：如果您希望保留本地现有 vault，则必须对此问题回答 `No`，并对 `Rebuild the database?` 回答 `No`。*
	2. 对 `Keep remote DB?` 回答 `Yes`。
	3. 对 `Replicate once?` 回答 `Yes`。
	完成后，您的所有设置将会从第一台设备成功导入。
4. 你的笔记应该很快就会同步。

## 文件看起来有损坏...

请再次打开配置链接并回答如下：
- 如果您的本地数据库看起来已损坏（当你的本地 Obsidian 文件看起来很奇怪）
- 对 `Keep local DB?` 回答 `No`
- 如果您的远程数据库看起来已损坏（当复制时发生中断）
- 对  `Keep remote DB?` 回答 `No`

如果您对两者都回答“否”，您的数据库将根据您设备上的内容重建。并且远程数据库将锁定其他设备，您必须再次同步所有设备。（此时，几乎所有文件都会与时间戳同步。因此您可以安全地使用现有的 vault）。

## 测试服务器

设置 Cloudant 或本地 CouchDB 实例有点复杂，所以我搭建了一个 [self-hosted-livesync 尝鲜服务器](https://olstaste.vrtmrz.net/)。欢迎免费尝试！  
注意：请仔细阅读“限制”条目。不要发送您的私人 vault。

## 状态栏信息

同步状态将显示在状态栏。

-   状态
    -   ⏹️ 就绪
    -   💤 LiveSync 已启用，正在等待更改。
    -   ⚡️ 同步中。
    -   ⚠ 一个错误出现了。
-   ↑ 上传的 chunk 和元数据数量
-   ↓ 下载的 chunk 和元数据数量
-   ⏳ 等待的过程的数量
-   🧩 正在等待 chunk 的文件数量
如果你删除或更名了文件，请等待 ⏳ 图标消失。


## 提示

- 如果文件夹在复制后变为空，则默认情况下该文件夹会被删除。您可以关闭此行为。检查 [设置](docs/settings.md)。
- LiveSync 模式在移动设备上可能导致耗电量增加。建议使用定期同步 + 条件自动同步。
- 移动平台上的 Obsidian 无法连接到非安全 (HTTP) 或本地签名的服务器，即使设备上安装了根证书。
- 没有类似“exclude_folders”的配置。
- 同步时，文件按修改时间进行比较，较旧的将被较新的文件覆盖。然后插件检查冲突，如果需要合并，将打开一个对话框。
- 数据库中的文件在罕见情况下可能会损坏。当接收到的文件看起来已损坏时，插件不会将其写入本地存储。如果您的设备上有文件的本地版本，则可以通过编辑本地文件并进行同步来覆盖损坏的版本。但是，如果您的任何设备上都不存在该文件，则无法挽救该文件。在这种情况下，您可以从设置对话框中删除这些损坏的文件。
- 要阻止插件的启动流程（例如，为了修复数据库问题），您可以在 vault 的根目录创建一个 "redflag.md" 文件。
- 问：数据库在增长，我该如何缩小它？
    答：每个文档都保存了过去 100 次修订，用于检测和解决冲突。想象一台设备已经离线一段时间，然后再次上线。设备必须将其笔记与远程保存的笔记进行比较。如果存在曾经相同的历史修订，则可以安全地直接更新这个文件（和 git 的快进原理一样）。即使文件不在修订历史中，我们也只需检查两个设备上该文件的公有修订版本之后的差异。这就像 git 的冲突解决方法。所以，如果想从根本上解决数据库太大的问题，我们像构建一个扩大版的 git repo 一样去重新设计数据库。
- 更多技术信息在 [技术信息](docs/tech_info.md)
- 如果你想在没有黑曜石的情况下同步文件，你可以使用[filesystem-livesync](https://github.com/vrtmrz/filesystem-livesync)。
- WebClipper 也可在 Chrome Web Store 上使用：[obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf)


仓库地址：[obsidian-livesync-webclip](https://github.com/vrtmrz/obsidian-livesync-webclip) （文档施工中）

## License

The source code is licensed under the MIT License.
本源代码使用 MIT 协议授权。
