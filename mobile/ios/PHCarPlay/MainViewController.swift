import Network
import UIKit
import WebKit

/// Tên kênh tin nhắn website -> ứng dụng (phía website: public/assets/js/core/nativeApp.js).
let nativeChannelName = "PHCarPlayNative"

/// Màn hình duy nhất: website toàn màn hình.
/// - Tự phát có tiếng (không cần chạm), màn hình luôn sáng (SceneDelegate), ẩn thanh trạng thái.
/// - Tìm bằng giọng nói của iPhone (VoiceRecognizer) khi website gửi 'voice.start'.
/// - Liên kết ra ngoài website mở bằng Safari/ứng dụng tương ứng; mất mạng thì hiện màn hình "Thử lại".
/// - Ra nền (giai đoạn 15): người dùng bật "Phát trong nền" thì nhạc phát tiếp (Info.plist có UIBackgroundModes = audio).
///   iOS vẫn tự dừng video đúng lúc ra nền, nên ứng dụng nhắc website bấm phát lại vài lần ngay sau đó ('nudge').
///   Tắt "Phát trong nền": như trước - ra nền thì dừng, mở lại thì phát tiếp nếu trước đó đang phát.
final class MainViewController: UIViewController {
    private let config = AppConfig.load()
    private var webView: WKWebView?
    private let statusView = StatusView()
    private let voice = VoiceRecognizer()
    private let pathMonitor = NWPathMonitor()
    private var voiceId = 0
    private var failedURL: URL?
    private var lastStatePlaying = false
    private var resumeOnForeground = false
    private var backgroundEnabled = false          // website báo: người dùng đang bật "Phát trong nền"
    private var inBackground = false
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    /// Các lần nhắc website phát lại sau khi ra nền (giây). iOS dừng video ngay lúc ra nền, đôi khi trễ một chút.
    private static let nudgeDelays: [TimeInterval] = [0.3, 1.0, 2.5]

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = AppColors.background

        guard let url = config.webURL else {
            addStatusView()
            statusView.show(
                title: "Chưa cài địa chỉ website",
                message: "Mở tệp mobile/config/app.json, điền địa chỉ website thật vào mục webUrl, chạy lại ./generate.sh rồi build lại ứng dụng.\n\nĐang là: \(config.rawURL)",
                detail: nil, actionTitle: nil, action: nil)
            return
        }

        let web = makeWebView()
        webView = web
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        let guide = view.safeAreaLayoutGuide   // không đè lên tai thỏ / thanh vuốt
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            web.topAnchor.constraint(equalTo: guide.topAnchor),
            web.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
        ])
        addStatusView()
        watchNetwork()
        web.load(URLRequest(url: url))
    }

    deinit {
        pathMonitor.cancel()
    }

    private func addStatusView() {
        statusView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(statusView)
        NSLayoutConstraint.activate([
            statusView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            statusView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            statusView.topAnchor.constraint(equalTo: view.topAnchor),
            statusView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []   // tự phát có tiếng, không cần chạm
        configuration.allowsPictureInPictureMediaPlayback = false     // không dùng cửa sổ nổi trong ứng dụng
        configuration.applicationNameForUserAgent = "Mobile/15E148 PHCarPlayApp/\(config.version) (iOS)"
        configuration.websiteDataStore = .default()                     // giữ đăng nhập (cookie 30 ngày của website)
        if #available(iOS 15.4, *) {
            configuration.preferences.isElementFullscreenEnabled = true // nút toàn màn hình của website
        }
        let content = WKUserContentController()
        content.add(WeakScriptHandler(self), name: nativeChannelName)
        configuration.userContentController = content

        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = AppColors.background
        web.scrollView.backgroundColor = AppColors.background
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.allowsBackForwardNavigationGestures = false
        web.allowsLinkPreview = false
        #if DEBUG
        if #available(iOS 16.4, *) {
            web.isInspectable = true   // bản Debug: xem lỗi bằng Safari trên máy Mac (Develop > tên iPhone)
        }
        #endif
        return web
    }

    // MARK: - Gọi vào website

    /// Gọi window.__phApp.fn(arg) ở khung chính; argJSON là một giá trị JSON.
    private func callWeb(_ fn: String, _ argJSON: String) {
        let js = "(function(){try{var a=window.__phApp;if(a&&typeof a.\(fn)==='function')a.\(fn)(\(argJSON));}catch(e){}})()"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    private func json(_ object: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    // MARK: - Ra nền / mở lại (SceneDelegate gọi)

    func appVisibilityChanged(visible: Bool) {
        inBackground = !visible
        if visible {
            endBackgroundTask()
            callWeb("lifecycle", "\"visible\"")
            if resumeOnForeground {
                callWeb("mediaKey", "\"play\"")   // iOS đã tự dừng video khi ra nền; trước đó đang phát thì phát tiếp
            }
            resumeOnForeground = false
        } else {
            // Phát trong nền: website tự lo việc phát tiếp (kể cả khi hiện lại); không bật thì ứng dụng nhớ để phát tiếp lúc mở lại.
            resumeOnForeground = backgroundEnabled ? false : lastStatePlaying
            callWeb("lifecycle", "\"hidden\"")
            if backgroundEnabled { nudgePlaybackInBackground() }
            if voiceId != 0 {
                voice.cancel()
                sendVoice(id: voiceId, kind: "error", text: "", code: "aborted")
                voiceId = 0
            }
        }
    }

    /// Giữ ứng dụng thức thêm vài giây sau khi ra nền và nhắc website phát lại. Khi tiếng đã phát thì iOS tự giữ ứng dụng chạy.
    private func nudgePlaybackInBackground() {
        endBackgroundTask()
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "phcarplay.resume") { [weak self] in
            self?.endBackgroundTask()
        }
        for delay in MainViewController.nudgeDelays {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self = self, self.inBackground, self.backgroundEnabled else { return }
                self.callWeb("lifecycle", "\"nudge\"")
            }
        }
        let last = (MainViewController.nudgeDelays.last ?? 0) + 2.0
        DispatchQueue.main.asyncAfter(deadline: .now() + last) { [weak self] in
            self?.endBackgroundTask()
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    // MARK: - Tìm bằng giọng nói

    private func startVoice(id: Int, lang: String) {
        if voiceId != 0 {
            sendVoice(id: voiceId, kind: "error", text: "", code: "aborted")
        }
        voiceId = id
        voice.start(locale: lang) { [weak self] event in
            guard let self = self, self.voiceId == id else { return }
            switch event {
            case .partial(let text):
                self.sendVoice(id: id, kind: "partial", text: text, code: "")
            case .result(let text):
                self.voiceId = 0
                self.sendVoice(id: id, kind: "result", text: text, code: "")
            case .error(let code):
                self.voiceId = 0
                self.sendVoice(id: id, kind: "error", text: "", code: code)
            }
        }
    }

    private func sendVoice(id: Int, kind: String, text: String, code: String) {
        callWeb("voice", json(["id": id, "kind": kind, "text": text, "code": code]))
    }

    // MARK: - Mất mạng

    private func showOffline(detail: String) {
        statusView.show(
            title: "Không kết nối được",
            message: "Hãy kiểm tra Wi-Fi hoặc 4G rồi bấm Thử lại. Có mạng trở lại thì ứng dụng tự tải lại.",
            detail: detail, actionTitle: "Thử lại",
            action: { [weak self] in self?.retry() })
    }

    private func retry() {
        guard let web = webView, let url = failedURL ?? config.webURL else { return }
        web.load(URLRequest(url: url))
    }

    private func watchNetwork() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            DispatchQueue.main.async {
                guard let self = self, self.statusView.isShowing, self.failedURL != nil else { return }
                self.retry()
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "phcarplay.network"))
    }

    private func handleLoadError(_ error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }   // bị hủy vì bấm sang trang khác
        if e.domain == "WebKitErrorDomain" && (e.code == 102 || e.code == 204) { return }   // đã mở ngoài ứng dụng / tệp phát trực tiếp
        if let url = e.userInfo[NSURLErrorFailingURLErrorKey] as? URL {
            failedURL = url
        } else if failedURL == nil {
            failedURL = config.webURL
        }
        showOffline(detail: "\(e.localizedDescription) (\(e.code))")
    }

    private func openExternally(_ url: URL) {
        let scheme = (url.scheme ?? "").lowercased()
        guard ["http", "https", "mailto", "tel", "sms", "maps", "itms-apps"].contains(scheme) else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }
}

// MARK: - Tin nhắn từ website

extension MainViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // Chỉ nhận từ khung chính của đúng website (khung trình phát YouTube cũng thấy kênh này trên iOS).
        guard message.frameInfo.isMainFrame, config.isOwn(origin: message.frameInfo.securityOrigin) else { return }
        guard let text = message.body as? String, text.count <= 8192,
              let data = text.data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let type = object["type"] as? String else { return }
        switch type {
        case "voice.start":
            let id = (object["id"] as? NSNumber)?.intValue ?? 0
            startVoice(id: id, lang: (object["lang"] as? String) ?? "vi-VN")
        case "voice.stop":
            let id = (object["id"] as? NSNumber)?.intValue ?? 0
            if id != 0 && id == voiceId {
                voiceId = 0
                voice.cancel()
            }
        case "state":
            lastStatePlaying = (object["playing"] as? Bool) ?? false
        case "background":
            backgroundEnabled = (object["enabled"] as? Bool) ?? false
        default:
            break
        }
    }
}

/// WKUserContentController giữ chặt đối tượng nhận tin; lớp trung gian này giữ lỏng để màn hình được giải phóng bình thường.
final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

// MARK: - Điều hướng

extension MainViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let scheme = (url.scheme ?? "").lowercased()
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true   // nil = mở cửa sổ mới
        if !isMainFrame || scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow)   // khung con (trình phát YouTube), trang trống
            return
        }
        if (scheme == "http" || scheme == "https") && config.isOwn(url) {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        openExternally(url)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        failedURL = nil
        statusView.hide()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleLoadError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadError(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()   // bộ hiển thị web bị tắt (thiếu bộ nhớ): tải lại
    }
}

extension MainViewController: WKUIDelegate {
    /// Liên kết mở cửa sổ mới (target=_blank, window.open): trang của website thì mở ngay tại đây, trang khác mở bằng Safari.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if config.isOwn(url) {
                webView.load(navigationAction.request)
            } else {
                openExternally(url)
            }
        }
        return nil
    }

    /// Website dùng nhận giọng nói của ứng dụng, không cần micro/camera trong trang.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }
}
