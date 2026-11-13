import UIKit
import WebKit

enum AppColors {
    static let background = UIColor(red: 15 / 255, green: 15 / 255, blue: 15 / 255, alpha: 1)
    static let brand = UIColor(red: 1, green: 0, blue: 51 / 255, alpha: 1)
}

/// Cấu hình đọc từ mobile/config/app.json (tệp được chép vào ứng dụng lúc build, xem project.yml).
/// Chỉ trang thuộc website mới được mở trong ứng dụng và nói chuyện với ứng dụng. "Thuộc website" = cùng giao thức +
/// tên miền + cổng với webUrl, chấp nhận thêm hai kiểu chuyển hướng hay gặp: http -> https và có/không có "www.".
struct AppConfig {
    let webURL: URL?
    let rawURL: String
    let version: String
    let origins: Set<String>

    static func load() -> AppConfig {
        var raw = ""
        if let url = Bundle.main.url(forResource: "app", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            raw = ((obj["webUrl"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "1.0.0"
        let url = validate(raw)
        return AppConfig(webURL: url, rawURL: raw, version: version, origins: url.map(makeOrigins) ?? [])
    }

    /// nil nếu không phải địa chỉ http/https hợp lệ hoặc vẫn là địa chỉ mẫu (*.example).
    static func validate(_ raw: String) -> URL? {
        guard let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = url.host?.lowercased(), !host.isEmpty, !host.hasSuffix(".example") else { return nil }
        return url
    }

    static func origin(scheme: String, host: String, port: Int?) -> String {
        let defaultPort = scheme == "http" ? 80 : 443
        if let port = port, port > 0, port != defaultPort {
            return "\(scheme)://\(host):\(port)"
        }
        return "\(scheme)://\(host)"
    }

    private static func makeOrigins(_ url: URL) -> Set<String> {
        let scheme = url.scheme?.lowercased() ?? "https"
        let host = url.host?.lowercased() ?? ""
        var hosts = [host]
        let isIP = host.allSatisfy { $0.isNumber || $0 == "." } || host.contains(":")
        if host.hasPrefix("www.") {
            hosts.append(String(host.dropFirst(4)))
        } else if !isIP && host.contains(".") {
            hosts.append("www." + host)
        }
        var result = Set<String>()
        for h in hosts {
            result.insert(origin(scheme: scheme, host: h, port: url.port))
            if scheme == "http" {
                result.insert(origin(scheme: "https", host: h, port: nil))
            }
        }
        return result
    }

    /// Địa chỉ này có thuộc website không?
    func isOwn(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host?.lowercased() else { return false }
        return origins.contains(AppConfig.origin(scheme: scheme, host: host, port: url.port))
    }

    /// Tin nhắn có đến từ website không (không phải từ khung của trang khác, ví dụ trình phát YouTube)?
    func isOwn(origin: WKSecurityOrigin) -> Bool {
        origins.contains(AppConfig.origin(scheme: origin.protocol.lowercased(), host: origin.host.lowercased(), port: origin.port))
    }
}
