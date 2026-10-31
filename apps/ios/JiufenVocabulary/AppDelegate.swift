import UIKit
import WebKit
import SQLite3
import CryptoKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let root = VocabularyViewController()
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = root
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

enum NativeError: LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case .invalid(let text) = self { return text }; return nil }
}

// A synchronous SQLite transaction is deliberately used for the prompt bridge:
// JavaScript advances the card only after COMMIT has completed.
final class DocumentStore {
    private var db: OpaquePointer?
    private let maximumBytes = 50 * 1024 * 1024
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    let directory: URL

    init() throws {
        let fm = FileManager.default
        directory = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("Jiufen", isDirectory: true)
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("learning.sqlite3")
        guard sqlite3_open_v2(file.path, &db, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            throw NativeError.invalid("无法打开本机学习数据库。请保留 App 并先导出诊断信息。")
        }
        do {
            try execute("PRAGMA journal_mode=DELETE")
            try execute("PRAGMA synchronous=FULL")
            try execute("PRAGMA busy_timeout=3000")
            try execute("CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value BLOB NOT NULL)")
        } catch { sqlite3_close(db); db = nil; throw error }
        try fm.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: file.path)
    }
    deinit { sqlite3_close(db) }

    private func execute(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw databaseError() }
    }
    private func databaseError() -> NativeError {
        let text = db.map { String(cString: sqlite3_errmsg($0)) } ?? "数据库未打开"
        return .invalid("本机保存失败：\(text)。当前操作尚未确认保存，请勿删除 App。")
    }
    func read(_ key: String = "document") throws -> Data? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT value FROM state WHERE key=?", -1, &statement, nil) == SQLITE_OK else { throw databaseError() }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_bind_text(statement, 1, key, -1, transient) == SQLITE_OK else { throw databaseError() }
        let status = sqlite3_step(statement)
        if status == SQLITE_DONE { return nil }
        guard status == SQLITE_ROW else { throw databaseError() }
        let count = Int(sqlite3_column_bytes(statement, 0))
        guard count <= maximumBytes, let bytes = sqlite3_column_blob(statement, 0) else { throw NativeError.invalid("数据库内容长度异常，未覆盖原记录。") }
        return Data(bytes: bytes, count: count)
    }
    func load() throws -> Any? {
        guard let data = try read() else { return nil }
        let value = try JSONSerialization.jsonObject(with: data)
        try Self.validateDocument(value)
        return value
    }
    static func validateDocument(_ value: Any) throws {
        guard let doc = value as? [String: Any], doc["format"] as? String == "jiufen-usb", doc["schema"] as? Int == 1,
              let profile = doc["profileId"] as? String, !profile.isEmpty, profile.count < 200,
              let device = doc["deviceId"] as? String, !device.isEmpty, device.count < 200,
              doc["baseline"] is [String: Any], doc["operations"] is [Any] else { throw NativeError.invalid("同步记录格式不正确，原记录未覆盖。") }
    }
    func save(_ document: Any) throws {
        try Self.validateDocument(document)
        let data = try JSONSerialization.data(withJSONObject: document, options: [.sortedKeys])
        guard data.count <= maximumBytes else { throw NativeError.invalid("学习记录超过 50 MB，请先导出备份。") }
        try execute("BEGIN IMMEDIATE")
        do {
            try execute("INSERT OR REPLACE INTO state(key,value) SELECT 'previous',value FROM state WHERE key='document'")
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO state(key,value) VALUES ('document',?)", -1, &statement, nil) == SQLITE_OK else { throw databaseError() }
            defer { sqlite3_finalize(statement) }
            let result = data.withUnsafeBytes { bytes in sqlite3_bind_blob(statement, 1, bytes.baseAddress, Int32(data.count), transient) }
            guard result == SQLITE_OK, sqlite3_step(statement) == SQLITE_DONE else { throw databaseError() }
            try execute("COMMIT")
        } catch { try? execute("ROLLBACK"); throw error }
    }
    func backupForSync() throws {
        guard let data = try read() else { return }
        let fm = FileManager.default, backups = directory.appendingPathComponent("Backups", isDirectory: true)
        try fm.createDirectory(at: backups, withIntermediateDirectories: true)
        let name = "before-sync-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(6)).json"
        try data.write(to: backups.appendingPathComponent(name), options: [.atomic])
        let files = try fm.contentsOfDirectory(at: backups, includingPropertiesForKeys: nil).filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent > $1.lastPathComponent }
        for old in files.dropFirst(20) { try fm.removeItem(at: old) }
    }
}

final class VocabularyViewController: UIViewController, WKUIDelegate, WKNavigationDelegate {
    private var webView: WKWebView!
    private var store: DocumentStore?
    private var startupError: String?
    private var webRoot: URL!
    private var exchange: URL!
    private var syncPrepared = false
    private var incomingDigest: String?
    private var incomingBatch: String?
    private var saveGeneration: UInt64 = 0
    private var incomingReadGeneration: UInt64 = 0
    private var lastAcknowledged: String?
    private let maximumBytes = 50 * 1024 * 1024
    private var deviceID: String {
        let key = "jiufen.device-id"
        if let value = UserDefaults.standard.string(forKey: key) { return value }
        let value = "ios-" + UUID().uuidString.lowercased()
        UserDefaults.standard.set(value, forKey: key)
        return value
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        do {
            store = try DocumentStore()
            let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            exchange = documents.appendingPathComponent("Exchange", isDirectory: true)
            try FileManager.default.createDirectory(at: exchange, withIntermediateDirectories: true)
            try writeJSON(["format": "jiufen-device-info", "schema": 1, "deviceId": deviceID,
                           "bundleId": Bundle.main.bundleIdentifier ?? "com.jiufen.vocabulary", "platform": "ios",
                           "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"], to: "device-info.json")
        } catch { startupError = error.localizedDescription }
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            showFatal("安装包缺少离线网页资源，学习数据没有删除。请重新构建安装包。")
            return
        }
        webRoot = root.standardizedFileURL
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.addUserScript(WKUserScript(source: "window.__JIUFEN_IOS__ = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        view.addSubview(webView)
        NSLayoutConstraint.activate([webView.leadingAnchor.constraint(equalTo: view.leadingAnchor), webView.trailingAnchor.constraint(equalTo: view.trailingAnchor), webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
        webView.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
    }
    private func showFatal(_ message: String) {
        let label = UILabel(); label.text = message; label.numberOfLines = 0; label.textAlignment = .center; label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24), label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24), label.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
    }
    private func trusted(_ url: URL?) -> Bool {
        guard let url = url, url.isFileURL, let root = webRoot else { return false }
        return url.standardizedFileURL.path.hasPrefix(root.path + "/")
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(trusted(navigationAction.request.url) ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { return nil }
    private func jsonResponse(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8) else { return "{\"ok\":false,\"error\":\"原生返回格式错误\"}" }
        return text
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let prefix = "__JIUFEN_NATIVE__"
        guard prompt.hasPrefix(prefix) else {
            guard frame.isMainFrame, trusted(frame.request.url) else { completionHandler(nil); return }
            let dialog = UIAlertController(title: "输入", message: prompt, preferredStyle: .alert)
            dialog.addTextField { $0.text = defaultText }
            dialog.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
            dialog.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(dialog.textFields?.first?.text) })
            present(dialog, animated: true); return
        }
        guard frame.isMainFrame, trusted(frame.request.url), prompt.utf8.count <= maximumBytes else { completionHandler(jsonResponse(["ok": false, "error": "拒绝非本机页面的原生请求"])); return }
        do {
            guard let data = String(prompt.dropFirst(prefix.count)).data(using: .utf8), let request = try JSONSerialization.jsonObject(with: data) as? [String: Any], let method = request["method"] as? String else { throw NativeError.invalid("原生请求格式错误") }
            let result = try handle(method, payload: request["payload"] ?? NSNull())
            completionHandler(jsonResponse(["ok": true, "value": result]))
        } catch { completionHandler(jsonResponse(["ok": false, "error": error.localizedDescription])) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard frame.isMainFrame, trusted(frame.request.url) else { completionHandler(); return }
        let dialog = UIAlertController(title: "提示", message: message, preferredStyle: .alert)
        dialog.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler() }); present(dialog, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard frame.isMainFrame, trusted(frame.request.url) else { completionHandler(false); return }
        let dialog = UIAlertController(title: "请确认", message: message, preferredStyle: .alert)
        dialog.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        dialog.addAction(UIAlertAction(title: "继续", style: .default) { _ in completionHandler(true) }); present(dialog, animated: true)
    }
    private func writeJSON(_ object: Any, to name: String) throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        try data.write(to: exchange.appendingPathComponent(name), options: [.atomic])
    }
    private func readBounded(_ url: URL) throws -> Data {
        let resource = try url.resourceValues(forKeys: [.fileSizeKey, .isSymbolicLinkKey])
        guard resource.isSymbolicLink != true, let size = resource.fileSize, size <= maximumBytes else { throw NativeError.invalid("同步文件过大或路径异常") }
        let data = try Data(contentsOf: url)
        guard data.count <= maximumBytes else { throw NativeError.invalid("同步文件过大") }
        return data
    }
    private func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private func packetContents(_ data: Data) throws -> (document: [String: Any], batchId: String) {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["format"] as? String == "jiufen-usb-packet", object["schema"] as? Int == 1,
              object["algorithm"] as? String == "sha256", let payload = object["payload"] as? String,
              let payloadData = payload.data(using: .utf8), payloadData.count <= maximumBytes,
              let checksum = object["checksum"] as? String, checksum == digest(payloadData),
              let content = try JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
              let batch = content["batchId"] as? String, !batch.isEmpty, batch.count < 200,
              let document = content["document"] as? [String: Any] else { throw NativeError.invalid("同步包格式、校验和或批次编号不正确") }
        try DocumentStore.validateDocument(document)
        return (document, batch)
    }
    private func handle(_ method: String, payload: Any) throws -> Any {
        if let error = startupError { throw NativeError.invalid(error) }
        guard let store = store else { throw NativeError.invalid("本机数据库不可用") }
        switch method {
        case "load": return try store.load() ?? NSNull()
        case "save": try store.save(payload); saveGeneration += 1; return true
        case "syncStatus":
            return ["platform": "ios", "deviceId": deviceID, "prepared": syncPrepared, "bundleId": Bundle.main.bundleIdentifier ?? "com.jiufen.vocabulary", "message": syncPrepared ? "等待电脑通过 USB 同步，请保持 App 在前台" : "离线学习可用；同步时连接电脑并准备同步"] as [String: Any]
        case "prepareSync":
            guard let object = payload as? [String: Any], let document = object["document"], let text = object["packet"] as? String, let bytes = text.data(using: .utf8), bytes.count <= maximumBytes else { throw NativeError.invalid("准备同步需要 document 和完整 packet") }
            let contents = try packetContents(bytes)
            try DocumentStore.validateDocument(document)
            guard let expectedDocument = document as? [String: Any], NSDictionary(dictionary: expectedDocument).isEqual(to: contents.document) else { throw NativeError.invalid("准备同步的记录与同步包不一致") }
            try store.backupForSync()
            try store.save(document)
            saveGeneration += 1
            try bytes.write(to: exchange.appendingPathComponent("outgoing.json"), options: [.atomic])
            syncPrepared = true; incomingDigest = nil; incomingBatch = nil
            return true
        case "readIncoming":
            guard syncPrepared else { return NSNull() }
            let file = exchange.appendingPathComponent("incoming.json")
            guard FileManager.default.fileExists(atPath: file.path) else { return NSNull() }
            let data = try readBounded(file), batch = try packetContents(data).batchId
            if batch == lastAcknowledged { return NSNull() }
            guard let text = String(data: data, encoding: .utf8) else { throw NativeError.invalid("同步包不是 UTF-8") }
            incomingDigest = digest(data); incomingBatch = batch; incomingReadGeneration = saveGeneration
            return text
        case "ackIncoming":
            guard syncPrepared, let body = payload as? [String: Any], let batch = body["batchId"] as? String,
                  batch == incomingBatch, let expected = incomingDigest, saveGeneration > incomingReadGeneration else { throw NativeError.invalid("本批次尚未确认保存，不能发送同步完成回执") }
            let current = try readBounded(exchange.appendingPathComponent("incoming.json"))
            guard digest(current) == expected, try packetContents(current).batchId == batch else { throw NativeError.invalid("同步包已改变，请重新读取后再确认") }
            try writeJSON(["format": "jiufen-sync-ack", "schema": 1, "batchId": batch, "deviceId": deviceID, "at": ISO8601DateFormatter().string(from: Date())], to: "ack.json")
            lastAcknowledged = batch; return true
        case "finishSync": syncPrepared = false; incomingBatch = nil; incomingDigest = nil; return true
        case "export":
            guard let body = payload as? [String: Any], let name = body["name"] as? String, let content = body["content"] as? String, content.utf8.count <= maximumBytes,
                  !name.isEmpty, name.count <= 200, URL(fileURLWithPath: name).lastPathComponent == name, !name.contains("\\"), !name.contains("/") else { throw NativeError.invalid("导出文件名或内容不正确") }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Exports", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent(name)
            try content.write(to: file, atomically: true, encoding: .utf8)
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                if let popover = sheet.popoverPresentationController { popover.sourceView = self.view; popover.sourceRect = CGRect(x: self.view.bounds.midX, y: self.view.bounds.midY, width: 1, height: 1) }
                self.present(sheet, animated: true)
            }
            return true
        default: throw NativeError.invalid("不支持的原生方法：\(method)")
        }
    }
}
