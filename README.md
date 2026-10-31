# 九分词汇离线版 / USB 同步

状态：Windows 0.1.1 开发测试版。Windows 原生保存及自动化同步测试已通过；iOS 已在 GitHub macOS 上编译成功并生成未签名 arm64 IPA，**尚待本机签名安装和 iPhone 实机同步验收**。不能将模拟目录或浏览器桥测试视为真机 USB 已通过。

首个成功构建：[Build iOS #2](https://github.com/yangding233/jiufen-vocabulary/actions/runs/41191710069)，源码提交 `4786c9f`。下载后的 IPA 已核对 SHA256、arm64 真机格式、最低 iOS 15.4、文件共享配置及六项离线资源。后续签名与验收见 [安装与续签](docs/安装与续签.md)。

## 直接使用 Windows 测试包

发布目录中双击 `九分词汇离线学习.exe`，不需要另外安装 Node 或 Python。
完整发布目录必须一起保留。学习数据保存在独立用户数据库，不写回旧 HTML。

1. 在原来的网页“备份与设置”导出完整 JSON。
2. 在新程序尚未开始学习时，导入此 JSON，核对已学、熟知、笔记、计划和断点。
3. 此后日常导出顶部“完整同步档案”。它保留配对身份和操作记录，可以灾难恢复或合并回同一档案。
4. 安装 iPhone App 后，在手机点“准备与电脑同步”，电脑首次勾选“首次配对”后同步。
5. 手机保持前台、解锁。电脑显示“双向同步完成”后，手机退出同步准备，才能拔线继续学习。

如果两端已有不同来源的独立进度，程序会拒绝直接首次配对。先留存两端备份，明确合并后初始化另一端，避免覆写。

## iPhone 安装包构建

把本目录中的源码上传到自己的 **Private** GitHub 仓库。上传的是代码与内置资源，不包含学习备份、数据库、签名资料、测试输出、Python环境或 node_modules。

仓库 → Actions → Build iOS → Run workflow → main。
成功后从 Artifacts 下载 `JiufenVocabulary-unsigned`，解压得到 IPA 和 SHA256。用 Windows 签名工具签名安装；固定 bundle ID、账号，覆盖更新前备份数据。

默认 bundle ID：`com.jiufen.vocabulary`。如果签名工具改了标识，电脑同步面板须填写实际安装的标识。

本轮不上传 Apple 账号、证书。构建只需 macOS 标准 runner，`CODE_SIGNING_ALLOWED=NO`，生成 arm64 真机包。构建产物保留 3 天。私有仓库的 Actions 用量与存储费用以账号额度和预算设置为准。

## 项目结构

- `web/`：当前可运行、无远程依赖的完整学习页面。
- `shared/sync-core.js`：两端共用的操作记录、确定性合并、冲突与校验。
- `apps/ios/`：Swift/UIKit/WKWebView + SQLite + 文件共享。
- `apps/windows/`：Electron + Node SQLite + USB 同步管理。
- `tools/usb_transport.py`：限定 App 的 Exchange 文件传输，使用 pymobiledevice3 7.8.3。
- `.github/workflows/build-ios.yml`：手动启动的无签名真机构建。
- `docs/`：协议、迁移和测试说明。

## 本地开发

Node 24，Python 3.12，Windows Apple 设备连接组件。

```powershell
npm --prefix apps/windows ci
python -m venv .venv-usb
.\.venv-usb\Scripts\python.exe -m pip install -r tools/usb-requirements-lock.txt
node --test tests/sync-core.test.cjs
npm --prefix apps/windows test
.\.venv-usb\Scripts\python.exe apps/windows/usb_transport.test.py
.\tools\build-usb.ps1
npm --prefix apps/windows start
```

`tools/prepare_web.py` 是旧网页迁移生成器，仅维护者在本机提供 `tools/source.html` 时使用。已生成的 `web/` 可直接编译，不需要在 GitHub 上读取旧网页。

## 同步与保存

SQLite 一次事务保存“共同起点 + 全部操作 + 本机界面断点”。反馈只有保存成功后才切换；浏览器 localStorage 仅作可丢弃缓存。
每台设备拥有稳定 ID，操作有递增序号、Lamport 顺序和因果版本；合并去重、保留撤销墓碑，熟知与恢复独立，文字并发冲突可人工合并。学习日按 Asia/Shanghai。

USB 只读写 `Documents/Exchange` 里的固定文件；真正数据库在私有目录。电脑读 outgoing → 双端备份 → 提交合并 → 写 incoming → 手机校验并保存 → ack。没有匹配批次回执，电脑不会显示全部完成。
同步时两端冻结学习面板；中途拔线保留操作和待确认信息，下次用新批次重试，按操作 ID 去重。取消也等待当前传输到安全点。

## 已知验收边界

Windows 真正的 SQLite、进程退出重开、文件共享组件加载和设备枚举已验证。
模拟同步测试验证了重试、损坏包、双端离线操作、冲突、撤销、熟知、过时回执与取消。
iOS 已通过 Xcode 16.4 无签名 arm64 编译及 IPA 内容检查；真机桥、文件共享双向读写、签名覆盖保数据、飞行模式冷启动仍须安装首个 IPA 后验收。
整个 Windows 学习界面阻断外网请求，不使用云端学习数据服务。
