# Ứng dụng điện thoại PH Car Play (Android & iOS)

Hai ứng dụng ở đây là **"vỏ"**: mỗi ứng dụng mở chính website PH Car Play của bạn (đã tải lên hosting) toàn màn hình.
Vì vậy mọi tính năng của website có ngay trong ứng dụng, và **sửa website thì ứng dụng có ngay, không phải cài lại**.

Ứng dụng làm thêm những việc trình duyệt không làm được:

| Tính năng | Android | iOS |
|---|---|---|
| Tự phát nhạc có tiếng khi mở, không cần chạm | Có | Có |
| Màn hình luôn sáng khi đang mở ứng dụng | Có | Có |
| Ẩn thanh trạng thái, toàn màn hình | Có | Có |
| Nút trên vô lăng / tai nghe Bluetooth (phát, dừng, bài sau, bài trước), cả khi đang phát ở nền | Có | Màn hình khóa / Trung tâm điều khiển của iOS |
| Tên bài hiện trên màn hình xe nối Bluetooth | Có (tùy xe) | Chưa |
| Tìm bằng giọng nói tiếng Việt của máy | Có (cần ứng dụng Google) | Có (của Apple) |
| Nút Quay lại: đóng hộp thoại → thoát "Chỉ video" → về Trang chủ → bấm 2 lần để thoát | Có | iPhone không có nút này |
| Liên kết sang trang khác mở bằng trình duyệt của máy | Có | Có |
| Mất mạng: màn hình "Thử lại", có mạng lại thì tự tải lại | Có | Có |
| **Chiếu màn hình điện thoại lên màn hình xe** (bản đồ một bên, nhạc một bên) - từ bản 1.2.0 | Có (chưa thử trên máy thật) | Chưa (cần phần mở rộng riêng + tài khoản Apple Developer) |
| **Nghe nhạc trong nền** (mở ứng dụng khác, tắt màn hình) - từ bản 1.1.0 | Có, kèm thông báo có nút lùi / phát-dừng / tới | Có, nhưng chưa thử trên máy thật (xem "Giới hạn đã biết") |
| Cửa sổ nổi | **Không** | **Không** |
| CarPlay / Android Auto | **Không** (hai hệ thống này không cho hiện video) | **Không** |

**Nghe nhạc trong nền (bản 1.1.0):** trong ứng dụng vào Cài đặt > "Phát trong nền" (mặc định Bật). Khi bật, mở ứng dụng khác
(bản đồ, Zalo...) hoặc tắt màn hình thì nhạc vẫn phát và tự sang bài kế. Lần đầu phát nhạc, Android 13 trở lên hỏi quyền
hiện thông báo: bấm **Cho phép** để có thông báo với 3 nút điều khiển. Tắt "Phát trong nền" thì như trước: rời ứng dụng là
dừng, mở lại thì phát tiếp. Bài phát bằng trình phát của YouTube (khi máy chủ video chính hỏng) luôn dừng khi rời ứng dụng
vì YouTube không cho phát ở nền. Đang dừng ở nền quá 30 phút thì ứng dụng cho trang nghỉ để đỡ tốn pin (mở lại là chạy tiếp).

Yêu cầu máy: Android 7.0 trở lên, iOS 15 trở lên.

```
mobile/
  config/app.json   cấu hình CHUNG cho cả hai (địa chỉ website, tên, mã ứng dụng, phiên bản)
  android/          dự án Android Studio (Java)
  ios/              dự án iOS (Swift, sinh dự án Xcode bằng XcodeGen)
.github/workflows/mobile-build.yml   build thử trên GitHub (không cần cài gì)
```

---

## Bước 1. Điền cấu hình: `mobile/config/app.json`

```json
{
  "webUrl": "https://ten-tai-khoan.alwaysdata.net",
  "appName": "PH Car Play",
  "appId": "com.phcarplay.app",
  "versionName": "1.0.0",
  "versionCode": 1
}
```

| Mục | Ý nghĩa | Quy tắc |
|---|---|---|
| `webUrl` | Địa chỉ website thật trên hosting (đúng như gõ trên trình duyệt) | Bắt đầu bằng `https://`. Còn để `...example` thì ứng dụng báo "Chưa cài địa chỉ website" |
| `appName` | Tên hiện dưới biểu tượng ứng dụng | 1-30 ký tự, được có dấu tiếng Việt, không dùng `$ & < > " ' \ /` |
| `appId` | Mã ứng dụng | Chữ thường không dấu, số, dấu chấm, ví dụ `vn.tencuaban.carplay`. **Chọn một lần rồi giữ nguyên**: đổi mã là thành ứng dụng khác (cài song song, mất dữ liệu đăng nhập) |
| `versionName` | Phiên bản hiện cho người dùng | Dạng `1.0.0` (tối đa 3 số) |
| `versionCode` | Số thứ tự bản build | Số nguyên, **tăng thêm 1 mỗi lần phát hành bản ứng dụng mới** (Android không cho cài bản có số nhỏ hơn đè lên) |

Sửa sai quy tắc thì lúc build sẽ báo lỗi bằng tiếng Việt chỉ rõ mục nào sai.

---

## Bước 2. Android

### Cách A: Android Studio trên máy tính (Windows)

1. Tải và cài Android Studio: https://developer.android.com/studio (cài mặc định).
2. Mở Android Studio → **Open** → chọn đúng thư mục `mobile\android` (không chọn cả thư mục dự án).
3. Chờ dòng trạng thái dưới cùng chạy xong "Gradle sync" (lần đầu tải khoảng 1-2 GB, có thể mất 10-20 phút).
4. Menu **Build → Build App Bundle(s) / APK(s) → Build APK(s)**. Xong bấm **locate** ở thông báo góc phải,
   tệp nằm ở `mobile\android\app\build\outputs\apk\debug\app-debug.apk`.
5. Cài lên điện thoại / màn hình xe Android: chép tệp APK sang máy (cáp USB, Zalo, Google Drive...), mở tệp,
   cho phép "Cài ứng dụng không rõ nguồn gốc" khi máy hỏi.

Gặp lỗi khi sync/build:
- "Incompatible Gradle JVM" / "Unsupported Java": **File → Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK**, chọn bản 17 hoặc 21, rồi bấm biểu tượng con voi (Sync).
- Android Studio gợi ý nâng cấp "Android Gradle Plugin": có thể bỏ qua.
- Lỗi khác: chép nguyên văn dòng lỗi màu đỏ gửi cho tôi.

Bản APK "debug" ký bằng khóa thử đi kèm dự án (`app/debug.keystore`, mật khẩu công khai `android`), nên APK build ở máy nào
cũng cài đè lên nhau được. **Phát hành rộng / đưa lên Google Play** thì ký bằng khóa riêng:
**Build → Generate Signed App Bundle or APK → APK → Create new...** Giữ thật kỹ tệp khóa (.jks) và mật khẩu: mất là
không cập nhật được ứng dụng đã cài cho khách. Không gửi tệp khóa cho ai, không đưa lên mạng.
Google Play cần tài khoản nhà phát triển (25 USD một lần) và có thể từ chối ứng dụng chỉ bọc website hoặc có nội dung YouTube.

### Cách B: để GitHub build giúp (không cần cài Android Studio)

1. Đưa mã nguồn lên một kho GitHub **riêng tư** (Private). Không đưa tệp `.env` (đã có trong `.gitignore`).
2. Vào tab **Actions** → **Build ứng dụng điện thoại** → **Run workflow**.
3. Chờ xong (khoảng 5-10 phút) → bấm vào lần chạy → mục **Artifacts** → tải `android-apk-debug` (tệp zip, giải nén ra APK).

Cùng lần chạy đó GitHub cũng biên dịch thử bản iOS (máy Mac của GitHub) để biết mã iOS không lỗi.

---

## Bước 3. iOS (cần máy Mac)

Cần: máy Mac có **Xcode** (tải miễn phí ở App Store) và một Apple ID.
- Apple ID miễn phí: cài được lên iPhone của chính bạn, nhưng **sau 7 ngày ứng dụng hết hạn**, phải cài lại.
- Tài khoản Apple Developer (99 USD/năm): cài lâu dài, gửi cho người khác qua TestFlight, đưa lên App Store
  (Apple có thể từ chối ứng dụng chỉ bọc website).

Các bước:
1. Mở **Terminal** trên Mac, cài Homebrew (xem https://brew.sh) rồi cài XcodeGen: `brew install xcodegen`
2. Đi vào thư mục và sinh dự án Xcode:
   ```
   cd đường/dẫn/tới/mobile/ios
   ./generate.sh
   open PHCarPlay.xcodeproj
   ```
3. Trong Xcode: bấm **PHCarPlay** (cột trái) → tab **Signing & Capabilities** → **Team**: chọn Apple ID của bạn
   (chưa có thì **Xcode → Settings → Accounts → +** để thêm).
4. Cắm iPhone vào Mac, chọn iPhone ở thanh trên cùng, bấm nút ▶.
   - Lần đầu trên iPhone: **Cài đặt → Cài đặt chung → Quản lý VPN & Thiết bị** → tin cậy tên nhà phát triển.
   - iOS 16 trở lên: bật **Cài đặt → Quyền riêng tư & Bảo mật → Chế độ nhà phát triển**.
5. Lần đầu bấm micro trong ứng dụng, iPhone hỏi quyền **Micro** và **Nhận dạng giọng nói**: chọn Cho phép.

Sửa `app.json` (địa chỉ, tên, phiên bản) thì chạy lại `./generate.sh` trước khi build. Không sửa tay `PHCarPlay.xcodeproj`
(mỗi lần chạy generate.sh nó được sinh lại).

---

## Đồng bộ Android & iOS khi cập nhật (quy tắc của dự án)

| Thay đổi | Việc cần làm |
|---|---|
| Chỉ website (`public/`, `app/`, `config/`, database...) | Tải lên hosting như mọi khi. Cả hai ứng dụng nhận ngay lần mở sau, **không build lại** |
| Trong `mobile/android` | Build lại APK Android, tăng `versionCode` (+1) và `versionName` trong `app.json`, cài lại |
| Trong `mobile/ios` | Chạy lại `./generate.sh`, build lại iOS, tăng `versionCode` và `versionName` |
| `mobile/config/app.json` (địa chỉ, tên, mã) | Build lại cả hai (iOS chạy lại `./generate.sh` trước) |

Mỗi kế hoạch cập nhật tôi gửi sẽ có mục **"Đồng bộ Android & iOS"** ghi rõ thay đổi nằm ở đâu và ứng dụng nào cần build lại.

---

## Xem lỗi khi cần

- Android (bản debug): cắm máy vào máy tính, mở Chrome trên máy tính, vào `chrome://inspect` → mục WebView của ứng dụng → inspect.
- iOS (bản Debug): trên Mac mở Safari → **Develop (Phát triển)** → tên iPhone → trang của ứng dụng.

## Giới hạn đã biết

- Nhận giọng nói Android dùng màn hình nghe của Google: máy (thường là màn hình xe Trung Quốc) không có ứng dụng Google thì báo
  "Máy này chưa có dịch vụ nhận giọng nói", vẫn gõ tìm được.
- Màn hình xe Android quá cũ, WebView không cập nhật được: ứng dụng tự dùng cách nối dự phòng; nếu WebView cũ hơn Chrome 61
  thì chính website không chạy được (giống trình duyệt cũ).
- Chiếu màn hình (bản 1.2.0, Android): cách dùng - trên màn hình xe bấm **Chiếu ĐT** để lấy mã 6 số; trên điện thoại mở ứng dụng >
  Cài đặt > **Chiếu lên màn hình xe**, nhập mã, bấm **Bắt đầu** ở hộp hỏi của Android, rồi mở bản đồ.
  Hai máy phải **chung mạng**: (1) cắm dây điện thoại vào màn hình xe và bật Cài đặt > Điểm phát sóng và chia sẻ kết nối >
  **Chia sẻ kết nối qua USB** (tùy màn hình xe có nhận kiểu mạng này không), hoặc (2) cho màn hình xe dùng Wi-Fi phát từ điện thoại.
  Khác mạng thì thường không nối được (không có máy chủ trung chuyển). Màn hình xe chia hẳn làm 2 bên: bản đồ một nửa, ứng dụng nghe nhạc
  một nửa. Điện thoại dọc cao hơn nửa màn hình xe nên hình được phóng kín và cắt bớt trên/dưới: kéo hình trên màn hình xe để chọn
  phần muốn xem, hoặc bấm "Vừa khung" để thấy trọn màn hình điện thoại (cột hẹp hơn). Chỉ xem được, không chạm lên màn hình xe để điều khiển
  điện thoại. Điện thoại phải sáng màn hình; tin nhắn/thông báo hiện trên điện thoại cũng hiện trên xe. Android hỏi quyền mỗi lần chiếu.
  Website phải là https. Phần chụp màn hình (`CastService.java`) CHƯA được thử trên máy thật.
- Nghe nhạc trong nền trên Android: một số hãng (Xiaomi, Oppo, Vivo, Realme, nhiều màn hình xe Trung Quốc) tự tắt ứng dụng
  chạy nền để tiết kiệm pin. Nếu nhạc tự tắt sau vài phút: vào Cài đặt của máy > Ứng dụng > PH Car Play > Pin >
  chọn **Không hạn chế** (hoặc "Cho phép chạy nền" / "Tự khởi chạy").
- Nghe nhạc trong nền vẫn tải cả hình của video (website phát bằng thẻ video), nên tốn dữ liệu như lúc đang xem.
- Nghe nhạc trong nền trên iPhone/iPad: iOS tự dừng video đúng lúc ứng dụng ra nền; ứng dụng nhắc website phát lại ngay sau đó.
  Phần này và việc tự sang bài kế khi đang ở nền CHƯA được thử trên máy thật - nếu không chạy, hãy báo lại kèm phiên bản iOS.
- Gửi ứng dụng lên Google Play / App Store: hai chợ thường từ chối ứng dụng phát nội dung YouTube ở nền. Cài bằng file APK
  hoặc cài trực tiếp từ Xcode thì không bị ảnh hưởng.
