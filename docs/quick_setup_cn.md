# 快速配置 (Quick setup)

该插件有较多配置项, 可以应对不同的情况. 不过, 实际使用的设置并不多. 因此, 我们采用了 "设置向导 (The Setup wizard)" 来简化初始设置.

Note: 建议使用 `Copy setup URI` and `Open setup URI` 来设置后续设备.

## 设置向导 (The Setup wizard)

在设置对话框中打开 `🧙‍♂️ Setup wizard`. 如果之前未配置插件, 则会自动打开该页面.

![quick_setup_1](../images/quick_setup_1.png)

- 放弃现有配置并进行设置  
如果您先前有过任何设置, 此按钮允许您在设置前放弃所有更改.

- 保留现有配置和设置  
快速重新配置. 请注意, 在向导模式下, 您无法看到所有已经配置过的配置项.

在上述选项中按下 `Next`, 配置对话框将进入向导模式 (wizard mode).

### 向导模式 (Wizard mode)

![quick_setup_2](../images/quick_setup_2.png)

接下来将介绍如何逐步使用向导模式.

## 配置远程数据库

### 开始配置远程数据库

输入已部署好的数据库的信息.  

![quick_setup_3](../images/quick_setup_3.png)

#### 测试数据库连接并检查数据库配置

我们可以检查数据库的连接性和数据库设置.

![quick_setup_5](../images/quick_setup_5.png)

#### 测试数据库连接

检查是否能成功连接数据库. 如果连接失败, 可能是多种原因导致的, 但请先点击 `Check database configuration` 来检查数据库配置是否有问题.

#### 检查数据库配置

检查数据库设置并修复问题.

![quick_setup_6](../images/quick_setup_6.png)

Config check 的显示内容可能因不同连接而异. 在上图情况下, 按下所有三个修复按钮.
如果修复按钮消失, 全部变为复选标记, 则表示修复完成.

### 加密配置

![quick_setup_4](../images/quick_setup_4.png)

为您的数据库加密, 以防数据库意外曝光; 启用端到端加密后, 笔记内容在离开设备时就会被加密. 我们强烈建议启用该功能. `路径混淆 (Path Obfuscation)` 还能混淆文件名. 现已稳定并推荐使用.
加密基于 256 位 AES-GCM.
如果你在一个封闭的网络中, 而且很明显第三方不会访问你的文件, 则可以禁用这些设置.

![quick_setup_7](../images/quick_setup_7.png)

#### Next

转到同步设置.

#### 放弃现有数据库并继续

清除远程数据库的内容, 然后转到同步设置.

### 同步设置

最后, 选择一个同步预设完成向导.

![quick_setup_9_1](../images/quick_setup_9_1.png)

选择我们要使用的任何同步方法, 然后 `Apply` 初始化并按要求建立本地和远程数据库. 如果显示 `All done!`, 我们就完成了. `Copy setup URI` 将自动打开，并要求我们输入密码以加密 `Setup URI`.

![quick_setup_10](../images/quick_setup_10.png)

根据需要设置密码。.
设置 URI (Setup URI) 将被复制到剪贴板, 然后您可以通过某种方式将其传输到第二个及后续设备.

## 如何设置第二单元和后续单元 (the second and subsequent units)

在第一台设备上安装 Self-hosted LiveSync 后, 从命令面板上选择 `Open setup URI`, 然后输入您传输的设置 URI (Setup URI). 然后输入密码，安装向导就会打开.
在弹窗中选择以下内容.

- `Importing LiveSync's conf, OK?` 选择 `Yes`
- `How would you like to set it up?`. 选择 `Set it up as secondary or subsequent device`

然后, 配置将生效并开始复制. 您的文件很快就会同步! 您可能需要关闭设置对话框并重新打开, 才能看到设置字段正确填充, 但它们都将设置好.
