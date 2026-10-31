# iPhone 离线 App 构建与 USB 验证

这是原生 UIKit / WKWebView 容器，复用项目 `web/` 下的学习页面。
最低部署版本 iOS 15.4，不依赖第三方 iOS SDK。

## 构建

仓库根目录是 `usb-vocab/`。源码中已经包含可直接编译的 `web/`，不需要运行依赖旧网页的迁移生成器。开始前运行 `python3 apps/ios/verify-resources.py`，确保：

- `web/index.html` 为无个人进度的发行页面；`portable-state` 必须是 `null`。
- `web/native-adapter.js` 和 `shared/sync-core.js` 已就绪。

GitHub Actions 页面选择 **Build iOS → Run workflow**。
构建使用 macOS runner、iPhone 真机 SDK、arm64，关闭代码签名。
成功后下载 **JiufenVocabulary-unsigned**，解压取得 `.ipa`。
在 Windows 上签名后安装。GitHub 不需要 Apple 账号、签名密钥或个人学习备份。

本机构建命令（有 macOS / Xcode 时）：

```sh
python3 apps/ios/verify-resources.py
xcodebuild -project apps/ios/JiufenVocabulary.xcodeproj -scheme JiufenVocabulary \
  -configuration Release -destination 'generic/platform=iOS' -sdk iphoneos \
  -derivedDataPath build/ios CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO build
```

## 保存与文件共享

- 学习数据库：`Library/Application Support/Jiufen/learning.sqlite3`。
- 每次保存是 SQLite 事务，保存 `document` 及上一份 `previous`。
- 同步前自动备份：私有目录 `Backups/`，最多保留 20 份。
- USB 共享目录：`Documents/Exchange/`，包含 `device-info.json`、`outgoing.json`、`incoming.json`、`ack.json`。
- App 身份默认 `com.jiufen.vocabulary`；签名工具若改了 bundle ID，电脑同步工具应填写实际 ID。
- SQLite 数据库不放在共享目录，不通过 USB 覆盖运行中的数据库。

网页通过受限的 WKUIDelegate prompt 通道调用本机保存接口。
只接受 App 自己的 `Web/` 文件及主框架；远程导航和新窗口被拦截。

## 一次真实 USB 验证

1. 首次安装、启动，确认存在 `Exchange/device-info.json`。
2. 手机解锁并信任电脑，保持 App 前台。
3. 在 App 中准备同步。App 原子写出 `outgoing.json`。
4. Windows 读回文件、校验，合并并写 `incoming.json`。
5. 网页读取并校验返回包，保存成功后请求 `ackIncoming`。
6. 原生层核对批次、文件摘要和本次读取后已有成功保存，再写 `ack.json`。
7. 电脑收到同批次回执后才可以显示双向同步完成。

## 验证边界

Windows 环境不能运行 Xcode。静态检查不等于 Swift 编译通过。
第一次 GitHub Actions 真机编译、Windows 签名安装、iPhone 离线运行和 USB 回执测试均须完成后，才能把本工程标为已通过真机验收。
续签与更新沿用原 Apple 账号及 bundle ID，采用覆盖安装；实际保留数据须真机确认。
