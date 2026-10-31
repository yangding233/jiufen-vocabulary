# 九分词汇 · 离线学习与 USB 同步

一个面向 Windows 和 iPhone 的离线背词项目。内置 1,493 条常规词汇，支持熟词搭桥、联想笔记、每日学习计划、间隔复习，并通过数据线合并两端学习进度。

**学习记录保存在本机 SQLite 数据库，日常学习和 USB 同步不需要云端账户。**iPhone 安装与续签时需要联网完成 Apple 签名。

[下载 v0.1.2 测试版](https://github.com/yangding233/jiufen-vocabulary/releases/tag/v0.1.2) · [安装、同步与续签](docs/安装与续签.md) · [验收记录](docs/验收清单.md) · [数据来源与许可](docs/数据来源与许可.md)

## 功能

- 常规词库 1,493 条，30 个 List，保留词形与中文释义，补齐音标。
- 熟词搭桥、拆分与场景联想；标记候选和待补内容，支持写自己的助记和笔记。
- 自定义每日新词数量，显示剩余词数、预计学习天数与完成日期。
- 认识、模糊、忘记、熟知标记，以及撤销和恢复复习。
- Windows 与 iPhone 离线保存；支持旧版完整 JSON 首次迁移、同步档案备份与恢复。
- USB 同步自动识别签名后的 App 标识，合并两端操作；保留文字冲突，等待手机保存回执后确认完成。

## 下载与使用

到 [Releases](https://github.com/yangding233/jiufen-vocabulary/releases) 下载 Windows ZIP 和未签名 iPhone IPA。源码也可通过 GitHub 的 Code → Download ZIP 或 Git 克隆取得。

**Windows：**解压后保留整个目录，双击 `九分词汇离线学习.exe`。便携版包含运行环境，不需要另装 Node 或 Python。真实 USB 连接需要可用的 Apple 设备连接组件，以及支持数据传输的数据线。

**iPhone：**将未签名 IPA 放入自己的签名工具，用自己的 Apple 账号签名安装。可使用 [Sideloadly](https://sideloadly.io/)；按手机提示完成开发者模式和开发者信任。密码、验证码及签名凭据始终由使用者在本机处理。

**首次同步：**先在电脑导入原有完整 JSON 并核对进度；手机保持空白。手机点“准备与电脑同步”，电脑勾选“首次配对”后点击“数据线同步”。手机保持前台、解锁，等电脑显示“双向同步完成”再退出同步准备。

完整步骤见 [安装与续签](docs/安装与续签.md)。两端都已有不同来源的独立记录时，程序会拒绝直接初始化，应先分别备份并核对档案。

## 当前版本与验证范围

Windows **0.1.2** 为开发测试版。iPhone 包已通过 GitHub macOS / Xcode 16.4 的 arm64 真机构建及签名安装；已实测 iPhone 17 的 USB 识别、App 文件共享读取和专用测试文件写入读回。核心合并、存储与 USB 自动化测试，以及 Windows 进程退出重开和页面持久化测试已通过。

Windows 0.1.2 修复了便携 USB 组件缺失的加密运行资源，加入冻结程序 SSL 自检、签名 App 自动识别和分阶段错误提示。手机端仍可使用首个已验证的 Build iOS #2。

双端完整学习档案合并、飞行模式冷启动、断线重试和覆盖续签等验收项目，以 [验收清单](docs/验收清单.md) 中记录的实际结果为准。

## 开发与测试

建议使用 Node 24、Python 3.12。Windows USB 连接需 Apple 设备服务；iOS 构建需要 macOS 和 Xcode，也可使用仓库内的 GitHub Actions。

```powershell
npm ci
npm --prefix apps/windows ci
python -m venv .venv-usb
.\.venv-usb\Scripts\python.exe -m pip install -r tools/usb-requirements-lock.txt
node --test tests/sync-core.test.cjs
npm --prefix apps/windows test
.\.venv-usb\Scripts\python.exe apps/windows/usb_transport.test.py
.\tools\build-usb.ps1
npm --prefix apps/windows start
```

可选界面测试使用 Playwright 和 Microsoft Edge，测试数据与日常学习档案分开：

```powershell
npm run test:ui
node tests/electron.test.cjs
```

Windows 打包：`npm --prefix apps/windows run package`。USB 组件使用目录方式分发，打包前会执行加密自检，并保留 Electron 的独立许可证文件。

## iPhone 远程构建

在自己的仓库中打开 **Actions → Build iOS → Run workflow**。任务会校验无个人进度的离线资源、运行同步核心测试，再生成未签名 arm64 IPA。成功后从 Artifacts 下载 `JiufenVocabulary-unsigned`；构建产物保留 3 天，正式发布包见 Releases。

不需要将 Apple 账号、证书、描述文件或学习档案放入 GitHub。构建使用 `CODE_SIGNING_ALLOWED=NO`。默认 App 标识是 `com.jiufen.vocabulary`，Windows 会识别实际签名后的标识。

项目已经包含可直接编译的 `web/`。`tools/prepare_web.py` 仅供维护者从旧网页重新生成资源，依赖未提交的 `tools/source.html`；普通源码构建不需要执行这个迁移步骤。

## 结构与同步方式

- `web/`：两端共用的离线学习页面。
- `shared/sync-core.js`：操作记录、去重合并、冲突与校验。
- `apps/windows/`：Electron、SQLite 与 USB 同步管理。
- `apps/ios/`：Swift / UIKit / WKWebView、SQLite 与文件共享。
- `tools/`：USB 传输、打包及 GitHub 构建辅助工具。
- `docs/`：安装、数据来源和验收说明；协议见 [CONTRACT.md](CONTRACT.md)。

每台设备保留稳定身份与操作序号。同步使用共同起点和操作记录，保留撤销、熟知状态以及并发笔记冲突；学习日按 Asia/Shanghai 计算。USB 仅交换 App 的 `Documents/Exchange` 固定文件，不覆盖运行中的数据库。电脑保存并写回后，必须收到手机对应批次的保存回执才显示完成。

## 许可与数据

自行编写的代码采用 [GPL-3.0](LICENSE)。第三方组件、音标数据及内置词表保留各自来源和权利，详见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) 与 [数据来源与许可](docs/数据来源与许可.md)。

仓库和发行包不包含个人学习记录、原始参考 PDF、签名资料或账号凭据。
