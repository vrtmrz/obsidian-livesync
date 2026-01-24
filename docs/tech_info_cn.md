# 架构设计

## 这个插件是怎么实现同步的.

![Synchronization](../images/1.png)

1. 当笔记创建或修改时，Obsidian会触发事件。Self-hosted LiveSync捕获这些事件，并将变更同步至本地PouchDB
2. PouchDB通过自动或手动方式将变更同步至远程CouchDB
3. 其他设备监听远程CouchDB的变更，从而获取最新更新
4. Self-hosted LiveSync 将同步的变更集反映到Obsidian存储库中。

注：图示为简化演示，仅展示两个设备间的单向同步。实际为多设备间同时进行的双向同步。

## 降低带宽消耗的技术方案。

![dedupe](../images/2.png)
