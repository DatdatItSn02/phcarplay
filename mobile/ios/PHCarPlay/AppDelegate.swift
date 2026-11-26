import UIKit

/// Vỏ ứng dụng iOS của PH Car Play: mở website (mobile/config/app.json) toàn màn hình trong WKWebView.
/// Màn hình chính: MainViewController. Phần website tương ứng: public/assets/js/core/nativeApp.js.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Phát tiếng cả khi gạt nút im lặng của iPhone (như ứng dụng nghe nhạc); cũng là điều kiện để phát ở nền.
        AppAudio.usePlayback()
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }
}
