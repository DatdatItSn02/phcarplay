# Đưa website lên máy chủ thật

Hướng dẫn cho hai trường hợp hay gặp: **hosting cPanel** (thuê theo tháng, có trình quản lý file và phpMyAdmin) và **VPS Ubuntu** (máy chủ riêng). Làm xong, chạy `php bin/doctor.php` để máy tự kiểm tra.

## 1. Cần chuẩn bị
- **Tên miền** (ví dụ `carplay.tenmien.vn`) và **HTTPS** (hosting/Let's Encrypt cấp miễn phí). Không có HTTPS thì mật khẩu đi trên mạng ở dạng đọc được.
- **PHP 7.4 trở lên** (nên dùng 8.2+), bật các extension: `pdo_mysql`, `mbstring`, `json`, `curl`, `openssl`.
- **MySQL 5.7+ hoặc MariaDB 10.3+**.
- **Tài khoản gửi thư SMTP** (Gmail/Zoho/của hosting) để gửi thư quên mật khẩu.
- Gói `carweb-ban-hoan-chinh.zip` (hoặc gói giai đoạn mới nhất).

> Quy tắc quan trọng nhất: **thư mục web (document root) phải trỏ vào thư mục `public/`**, không phải thư mục gốc dự án. Trong thư mục gốc có `.env` (mật khẩu database, SMTP), `storage/` (nhật ký, thư), mã nguồn. Bản đóng gói đã có `.htaccess` chặn những thứ này nếu lỡ trỏ sai, nhưng đó chỉ là lưới an toàn.

## 2. Cách A: hosting cPanel / DirectAdmin
1. **Tạo database**: cPanel → *MySQL Databases* → tạo database (ví dụ `user_carweb`), tạo user, gán user vào database với **All Privileges**. Ghi lại tên database, user, mật khẩu.
2. **Tải mã nguồn**: *File Manager* → tải zip lên thư mục nhà (ví dụ `/home/user/`), giải nén thành `/home/user/carweb/`. **Không** giải nén vào `public_html`.
3. **Trỏ tên miền vào `public/`**: *Domains* (hoặc *Subdomains*) → tạo/sửa tên miền, ô *Document Root* điền `carweb/public`.
   - Hosting không cho đổi document root của tên miền chính: dùng một tên miền phụ (subdomain) như `carplay.tenmien.vn`.
   - Bất đắc dĩ phải để cả dự án trong `public_html`: file `.htaccess` ở thư mục gốc sẽ chuyển mọi yêu cầu vào `public/`. Sau khi cài, chạy `php bin/doctor.php` để chắc chắn không đọc được `.env` qua web.
4. **Chọn PHP**: *Select PHP Version* (hoặc *MultiPHP Manager*) → chọn 8.2+ và bật các extension ở mục 1.
5. **Tạo `.env`**: trong *File Manager*, sao chép `.env.example` thành `.env`, sửa (xem mục 4 bên dưới).
6. **Tạo bảng và tài khoản master** — một trong hai cách:
   - Có *Terminal* (hoặc SSH): `cd ~/carweb` rồi `php bin/install.php` (tạo bảng, hỏi email và mật khẩu master từ 8 ký tự).
   - Không có dòng lệnh: phpMyAdmin → chọn database vừa tạo → tab *SQL* → dán nội dung `database/schema.sql` **sau khi xóa hai dòng đầu** `CREATE DATABASE ...` và `USE carweb;` (hosting không cho tạo database bằng lệnh). Rồi tạo master bằng câu lệnh ở cuối file đó (bỏ dấu `--`, đổi email, mật khẩu và salt 16 ký tự hex).
7. **HTTPS**: *SSL/TLS Status* → *Run AutoSSL* (hoặc *Let's Encrypt*). Rồi sửa `APP_URL=https://...` trong `.env`.
8. **Kiểm tra**: *Terminal* → `php bin/doctor.php`. Không có Terminal: mở `https://ten-mien/api/health` phải thấy `{"ok":true,...}`, mở `https://ten-mien/.env` phải báo **không tìm thấy**.

## 3. Cách B: VPS Ubuntu (Nginx + PHP-FPM + MariaDB)
```bash
sudo apt update
sudo apt install nginx mariadb-server php-fpm php-mysql php-mbstring php-curl php-xml unzip certbot python3-certbot-nginx
sudo mysql -e "CREATE DATABASE carweb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'carweb'@'localhost' IDENTIFIED BY 'MAT-KHAU-DAI-NGAU-NHIEN';
  GRANT ALL PRIVILEGES ON carweb.* TO 'carweb'@'localhost'; FLUSH PRIVILEGES;"
sudo mkdir -p /var/www && cd /var/www && sudo unzip ~/carweb-ban-hoan-chinh.zip -d carweb
cd /var/www/carweb && sudo cp .env.example .env && sudo nano .env      # sửa theo mục 4
sudo chown -R www-data:www-data storage .env && sudo chmod 640 .env
sudo chmod 700 storage/sessions
sudo -u www-data php bin/install.php                                  # tạo bảng và master
```
Cấu hình Nginx `/etc/nginx/sites-available/carweb` (thay tên miền và phiên bản PHP-FPM cho đúng máy):
```nginx
server {
    listen 80;
    server_name carplay.tenmien.vn;
    root /var/www/carweb/public;
    index index.php;
    client_max_body_size 8m;

    location ~ /\.(?!well-known) { deny all; }       # chặn .env, .git, .htaccess (chừa .well-known cho chứng chỉ HTTPS)
    location ~* \.(js|mjs|css)$ { add_header Cache-Control "no-cache"; try_files $uri =404; }   # luôn hỏi lại khi dùng file giao diện (xem mục 6)
    location / { try_files $uri /index.php?$query_string; }
    location ~ \.php$ {
        include fastcgi_params;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root/index.php;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/carweb /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d carplay.tenmien.vn          # HTTPS miễn phí, tự gia hạn
sudo -u www-data php bin/doctor.php
```
- Luôn chạy các lệnh `php bin/...` bằng **đúng tài khoản chạy website** (`sudo -u www-data ...`). Chạy bằng root có thể tạo file/thư mục mà website không ghi được.
- **Apache** thay cho Nginx: `DocumentRoot /var/www/carweb/public`, bật `a2enmod rewrite`, trong `<Directory /var/www/carweb/public>` đặt `AllowOverride All` (để dùng `public/.htaccess`).

## 4. Các giá trị trong `.env` khi chạy thật
| Biến | Đặt thế nào |
|---|---|
| `APP_URL` | Địa chỉ thật, có `https://`, không có `/` ở cuối. Dùng trong thư đặt lại mật khẩu |
| `APP_DEBUG` | **`false`**. `true` chỉ dùng trên máy mình khi phát triển (hiện chi tiết lỗi) |
| `APP_BASE_PATH` | Để trống, trừ khi website nằm trong thư mục con (`/carweb`) |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS` | Theo database đã tạo. Trên cPanel tên có tiền tố tài khoản, ví dụ `user_carweb` |
| `MAIL_DRIVER` | `smtp`, kèm `SMTP_HOST`, `SMTP_PORT` (587 với `SMTP_ENCRYPTION=tls`, hoặc 465 với `ssl`), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM_EMAIL`. Thử: `php bin/send-test-mail.php email@cua-ban.com`, hoặc (giai đoạn 16) đăng nhập trang quản trị bằng master > Tổng quan > thẻ **Gửi email** > **Gửi thư thử** (hiện lỗi cụ thể và cách sửa). Gmail: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_ENCRYPTION=tls`, `SMTP_PASS` là "Mật khẩu ứng dụng" 16 ký tự (bật Xác minh 2 bước trước), `MAIL_FROM_EMAIL` trùng `SMTP_USER`. Để `MAIL_DRIVER=log` thì thư chỉ ghi vào `storage/mail`, người dùng KHÔNG nhận được mã |
| `VIDEO_SOURCES` | `piped,invidious` (mặc định): thử Piped trước, Invidious dự phòng |
| `APP_KEY` | Mã bí mật để mã hóa khóa YouTube API của người dùng trong database. `php bin/doctor.php` gợi ý sẵn một mã ngẫu nhiên. Giữ bí mật, không đổi về sau (đổi thì người dùng phải nhập lại khóa) |
| `YOUTUBE_USER_KEYS` | `true` (mặc định): người dùng có tài khoản tự nhập khóa YouTube Data API riêng trong Cài đặt. Khóa chỉ dùng cho tìm kiếm của chính người đó, được thử với Google trước khi lưu, mã hóa bằng `APP_KEY`, không bao giờ hiện lại đầy đủ. Khóa hết lượt/sai thì tìm bằng cách khác kèm thông báo nhẹ. Lưu ý: điều khoản YouTube API yêu cầu mỗi ứng dụng một project và không cho chủ khóa đưa khóa cho bên thứ ba, nên dùng khóa của người dùng là có rủi ro bị Google khóa các khóa đó |
| `YOUTUBE_KEY_HINT` | `true` (mặc định): người chưa có khóa riêng, khi tìm kiếm phải dùng cách dự phòng hoặc lỗi, thấy một dòng nhắc nhẹ ở mục Tìm kiếm ("Tìm kiếm đang chậm? Thêm khóa YouTube miễn phí...") kèm nút mở thẳng mục khóa trong Cài đặt. Tối đa 1 lần/ngày, bấm "Để sau" thì 7 ngày không nhắc; không bao giờ hiện trên khung video. `false` = tắt |
| `YOUTUBE_API_KEY` | Không bắt buộc. Khóa YouTube Data API v3 (Google Cloud Console → APIs & Services → bật "YouTube Data API v3" → Credentials → API key; nên giới hạn khóa chỉ dùng cho API này). Có khóa thì tìm kiếm dự phòng dùng API chính thức (khoảng 99 lần tìm/ngày miễn phí) thay vì đọc trực tiếp YouTube |
| `YOUTUBE_DIRECT`, `YOUTUBE_DIRECT_PER_HOUR` | `true`, `300`: khi không có khóa, máy chủ được đọc trực tiếp kết quả tìm kiếm của YouTube tối đa 300 lần/giờ. Đọc trực tiếp **không đúng điều khoản YouTube** và có thể làm YouTube tạm chặn IP máy chủ (chỉ ảnh hưởng phần tìm kiếm dự phòng, không ảnh hưởng hosting) |
| `YOUTUBE_EMBED` | `true`: không lấy được luồng trực tiếp thì phát bằng trình phát YouTube (có quảng cáo, không có cửa sổ nổi) |
| `DEFAULT_VIDEO_URL` | Video phát khi mở website CHỈ khi người dùng chưa có bài hay nghe và chưa có bài trong playlist (giai đoạn 12): dán đường dẫn YouTube (`watch?v=`, `youtu.be/`, `/shorts/`) hoặc mã 11 ký tự. Để trống = phát danh sách nhạc như cũ. Sai dạng thì bỏ qua. Trình duyệt không cho tự phát có tiếng khi chưa chạm vào trang: video sẽ phát tắt tiếng kèm nút "Bật tiếng", chạm bất kỳ đâu là có tiếng |
| `PIPED_API_URLS`, `INVIDIOUS_API_URLS` | Danh sách máy chủ của từng nguồn. Chạy `php bin/video-scan.php` **trên máy chủ website** để tìm địa chỉ đang phát được, rồi dán dòng nó in ra vào `.env` |
| `SINGLE_DEVICE_LOGIN` | `true`: mỗi tài khoản một thiết bị |
| `ENFORCE_LICENSE` | Đang để `false` theo lựa chọn của bạn |
| `CLIENT_IP_HEADER` | Để trống. Chỉ đặt khi chạy sau Cloudflare (`CF-Connecting-IP`) hoặc proxy (`X-Real-IP`), xem mục 7 |
| `LOGIN_THROTTLE` | `false` (mặc định, theo quyết định dự án: không giới hạn số lần đăng nhập sai). `true` để tạm chặn 15 phút khi sai nhiều lần (xem mục 8) |
| `RATE_LIMIT`, `RATE_LIMIT_YOUTUBE`, `CSP_ENABLED`, `HSTS_MAX_AGE` | Giữ mặc định (xem mục 8) |

## 5. Sau khi cài: danh sách kiểm tra
- [ ] `php bin/doctor.php` không còn dòng `[LOI]`.
- [ ] `https://ten-mien/api/health` trả `{"ok":true,"data":{"status":"ok","database":true}}`.
- [ ] `https://ten-mien/.env` và `https://ten-mien/storage/logs/app.log` báo không tìm thấy.
- [ ] Đăng nhập `https://ten-mien/admin` bằng master, vào **Tài khoản của tôi** đổi sang mật khẩu dài (từ 12 ký tự, không dùng lại ở nơi khác).
- [ ] Thử **Quên mật khẩu** với một email thật: thư phải đến, liên kết phải mở đúng tên miền.
- [ ] Mở trang chính trên màn hình xe: tìm và phát được video, chuyển sáng/tối, nhập thử một key.

## 6. Sao lưu và cập nhật
**Sao lưu** (nên làm hằng ngày): database là quan trọng nhất (tài khoản, playlist, key, nhật ký), kèm file `.env`.
- cPanel: *Backup* → tải *MySQL Database* về; hoặc phpMyAdmin → *Export*.
- VPS: tạo thư mục `sudo mkdir -p /root/backup`, rồi thêm vào `sudo crontab -e` (3 giờ sáng mỗi ngày, giữ 14 bản gần nhất):
  `0 3 * * * mysqldump --single-transaction carweb | gzip > /root/backup/carweb-$(date +\%F).sql.gz && find /root/backup -name 'carweb-*' -mtime +14 -delete`
- Khôi phục: tạo database trống rồi `gunzip < file.sql.gz | mysql carweb` (hoặc phpMyAdmin → *Import*).
- `storage/` không cần sao lưu (bộ nhớ đệm, phiên, nhật ký kỹ thuật).

**Cập nhật lên bản mới:**
1. Sao lưu database và `.env`.
2. Giải nén bản mới đè lên thư mục cũ (giữ nguyên `.env` và `storage/`).
3. `php bin/migrate.php` (thêm bảng/cột mới nếu có), rồi `php bin/doctor.php`.
4. Trình duyệt và ứng dụng điện thoại tự dùng file giao diện mới, không cần xóa bộ nhớ đệm: trang chính không lưu đệm, `main.js` kèm thời điểm sửa, các file JS/CSS khác được gửi kèm `Cache-Control: no-cache` (Apache: `public/.htaccess`; Nginx: dòng `location ~* \.(js|mjs|css)$` ở mục 3) nên luôn hỏi lại máy chủ (không đổi thì máy chủ trả 304 rất nhẹ).

Riêng lần cập nhật lên bản giai đoạn 7: phiên đăng nhập chuyển vào `storage/sessions/`, nên mọi người (cả quản trị) phải đăng nhập lại một lần.

Riêng lần cập nhật lên bản giai đoạn 15 (đợt 2 - chiếu màn hình điện thoại lên màn hình xe): **phải chạy `php bin/migrate.php`** (migration `011_cast_sessions.sql` thêm 2 bảng `cast_sessions`, `cast_signals`; không đụng dữ liệu cũ). Không bắt buộc đổi `.env`; muốn chỉnh thì thêm `CAST_ENABLED=true`, `CAST_CODE_TTL_SECONDS=300`, `CAST_STUN_URLS=stun:stun.l.google.com:19302` (để trống `CAST_STUN_URLS` = chỉ nối khi hai máy cùng mạng). Website phải chạy bằng **https** (trình duyệt chỉ cho nối trực tiếp trên trang https). **Build lại ứng dụng Android** (bản 1.2.0, `versionCode` 3) thì điện thoại mới chiếu được; màn hình xe nhận hình bằng website nên không cần cài gì thêm. Ứng dụng iOS cũng lên 1.2.0 nhưng chưa chiếu được (chờ đợt 3).

Riêng lần cập nhật lên bản giai đoạn 15 (đợt 1 - nghe nhạc trong nền): không có migration mới, không đổi `.env`. Tải website lên như mọi khi, **và build lại cả hai ứng dụng** (bản 1.1.0, `versionCode` 2 - đã sửa sẵn trong `mobile/config/app.json`; nhớ giữ nguyên `webUrl` thật của bạn). Ứng dụng bản cũ 1.0.0 vẫn chạy với website mới (ra nền thì dừng như trước, Cài đặt nhắc cài bản mới).

Riêng lần cập nhật lên bản giai đoạn 14: **phải chạy `php bin/migrate.php`** (migration `010_user_phone_otp.sql` thêm cột `phone` vào `users` và bảng `otp_codes`; không đụng dữ liệu cũ). Có thể thêm `OTP_TTL_MINUTES=10` và `SMS_DRIVER=none` vào `.env` (không thêm cũng chạy với giá trị đó). Đăng ký mới bắt buộc số điện thoại; tài khoản cũ vẫn đăng nhập bằng email và tự thêm số trong Cài đặt > "Số điện thoại đăng nhập". Quên/đổi mật khẩu gửi mã 6 số qua email, nên website thật cần `MAIL_DRIVER=smtp` (hoặc `mail`). Không phải build lại ứng dụng Android/iOS.

Riêng lần cập nhật lên bản giai đoạn 17: website tự cập nhật từ GitHub (mục 6b); không phải chép file hay chạy SQL bằng tay nữa.

Riêng lần cập nhật lên bản giai đoạn 17 đợt 2 (ghép đôi một lần, nút "Chia sẻ"): có migration `012_cast_pairs.sql` (thêm bảng `cast_pairs` và cột `cast_sessions.pair_id`; không đụng dữ liệu cũ) - bản tự cập nhật sẽ sao lưu database rồi tự chạy. Không bắt buộc đổi `.env`; muốn chỉnh nhịp màn hình xe hỏi lời mời thì thêm `CAST_POLL_SECONDS=3` (2-60 giây; chỉ màn hình xe đã ghép đôi mới hỏi). Không cần build lại ứng dụng: ứng dụng Android 1.2.0 dùng được ngay.

Riêng lần cập nhật lên bản giai đoạn 16: không có migration. Chép đè các file; mục "Đổi mật khẩu" trong Cài đặt của người dùng được ẩn (đổi bằng "Quên mật khẩu?"). Kiểm tra gửi email ở trang quản trị > Tổng quan > **Gửi email**. Không phải build lại ứng dụng Android/iOS.

Riêng lần cập nhật lên bản giai đoạn 13: không có migration mới, không đổi `.env`. Website nhận ra khi được mở trong ứng dụng Android/iOS (thư mục `mobile/`, hướng dẫn build ở `mobile/README.md`). Nhớ tải lên cả `public/.htaccess` mới (thêm `Cache-Control: no-cache` cho JS/CSS). **Từ giai đoạn này:** thay đổi chỉ ở website thì ứng dụng nhận ngay khi mở lại, không phải build lại; thay đổi trong `mobile/` thì phải build lại ứng dụng (tăng `versionCode` trong `mobile/config/app.json`).

Riêng lần cập nhật lên bản giai đoạn 12: không có migration mới. Hàng đợi lúc mở web chỉ lấy bài hay nghe và playlist (video mặc định chỉ dùng khi hai phần đó trống); thêm nút chế độ phát (Lần lượt / Lặp tất cả / Lặp 1 bài / Trộn bài).

Riêng lần cập nhật lên bản giai đoạn 11: **phải chạy `php bin/migrate.php`** (migration `009_play_stats.sql` tạo bảng `user_play_stats` cho "bài bạn hay nghe"; không đụng dữ liệu cũ).

Riêng lần cập nhật lên bản giai đoạn 10: **phải chạy `php bin/migrate.php`** (migration `008_user_api_keys.sql` tạo bảng `user_api_keys`; không đụng dữ liệu cũ). Thêm `APP_KEY=...` vào `.env` (chạy `php bin/doctor.php` để được gợi ý mã) nếu muốn người dùng nhập khóa riêng.

Riêng lần cập nhật lên bản giai đoạn 9: không có migration mới; trong `.env` sửa `VIDEO_SOURCES=piped,invidious,youtube` và thêm các dòng `YOUTUBE_*` theo `.env.example` (không thêm cũng chạy với giá trị mặc định).

Riêng lần cập nhật lên bản giai đoạn 8: **phải chạy `php bin/migrate.php`** (migration `007_soft_delete.sql` thêm các cột đánh dấu xóa; không đụng dữ liệu cũ). Trong `.env` thêm/sửa `VIDEO_SOURCES`, `PIPED_API_URLS`, `INVIDIOUS_API_URLS` theo `.env.example`.

## 6b. Tự động cập nhật lên alwaysdata (giai đoạn 17)
Từ giai đoạn 17, mã trong nhánh `main` trên GitHub tự lên website, không phải chép file hay chạy SQL bằng tay.
Tệp liên quan: `.github/workflows/deploy-alwaysdata.yml` (GitHub), `deploy/ci-deploy.sh` (chạy trên máy của GitHub),
`deploy/server.sh` (chạy trên alwaysdata), `bin/backup-db.php` (sao lưu database), `bin/migrate.php` (cập nhật database).

**Mỗi lần mã mới vào `main` (chỉ khi có đổi trong app, bin, config, database, public, routes, storage, deploy):**
1. GitHub chạy kiểm thử PHP và JavaScript. Hỏng thì dừng, không đụng website.
2. Đăng nhập alwaysdata bằng khóa `ALWAYSDATA_SSH_KEY` (thử đúng **một** lần: alwaysdata chặn địa chỉ IP sau khoảng mười lần đăng nhập hỏng).
3. Chép gói mã (chỉ file có trong git: không bao giờ có `.env`) vào `~/phcarplay-deploy/releases/<bản>/` (giữ 3 bản gần nhất).
4. Tìm thư mục website: thư mục có `app/bootstrap.php`, `public/index.php`, `.env` và `APP_URL` trỏ đúng địa chỉ website (ghim bằng `deploy/site.conf` nếu có nhiều thư mục).
5. Sao lưu mã đang chạy vào `~/phcarplay-backups/code-<giờ>.tgz` (giữ 5 bản).
6. Nếu có migration mới: sao lưu database vào `~/phcarplay-backups/db-<giờ>.sql.gz` (giữ 10 bản), rồi chạy migration. Lỗi thì **dừng trước khi chép mã**: website vẫn chạy mã cũ.
7. Chép mã mới vào các thư mục `app bin config database public routes` và file `.htaccess`. Không xóa file nào; không đụng `.env`, `storage/`, `public/assets/vendor/`, các file khác ở thư mục gốc.
8. Kiểm tra `/api/health` (phải báo đúng bản mã mới ba lần liên tiếp), trang chủ và `/admin`. Website lỗi thì tự trả mã về bản sao lưu ở bước 5 (database giữ nguyên vì migration chỉ thêm bảng/cột).

**Cài đặt một lần** (cần mật khẩu nên chủ website tự làm):
1. alwaysdata: *Remote access > SSH* → sửa người dùng SSH → cho đăng nhập bằng mật khẩu.
2. Mở `https://ssh-<tài khoản>.alwaysdata.net`, đăng nhập, dán lệnh tạo khóa (in khóa riêng ra màn hình rồi xóa khỏi máy chủ, chỉ để lại khóa công khai trong `~/.ssh/authorized_keys` với ghi chú `phcarplay-github-deploy`; chạy lại thì khóa cũ hết tác dụng):
   `umask 077; mkdir -p ~/.ssh; chmod 700 ~/.ssh; d=$(mktemp -d); ssh-keygen -q -t ed25519 -N "" -C phcarplay-github-deploy -f "$d/k" && touch ~/.ssh/authorized_keys && { grep -v phcarplay-github-deploy ~/.ssh/authorized_keys; cat "$d/k.pub"; } > "$d/a" && cat "$d/a" > ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo "----- CHEP TU DONG BEGIN DEN DONG END -----" && cat "$d/k"; rm -rf "$d"`
3. GitHub: *Settings > Secrets and variables > Actions > New repository secret*, tên `ALWAYSDATA_SSH_KEY`, dán khóa (từ dòng `-----BEGIN OPENSSH PRIVATE KEY-----` đến hết dòng `-----END ...-----`).
4. (Nên làm) Tắt lại đăng nhập SSH bằng mật khẩu; khóa vẫn dùng được.
5. Lần chạy đầu chỉ kiểm tra và in khóa nhận dạng máy chủ: ghim vào `deploy/known_hosts` (để không bao giờ đăng nhập nhầm máy chủ giả mạo). Từ lần sau mới cập nhật thật.

Mặc định: máy chủ SSH `ssh-datdatcarplay.alwaysdata.net`, người dùng `datdatcarplay`, website `https://datdatcarplay.alwaysdata.net`. Khác thì đặt biến (không bí mật) trong *Settings > Secrets and variables > Actions > Variables*: `ALWAYSDATA_SSH_HOST`, `ALWAYSDATA_SSH_USER`, `SITE_URL`.

**Chạy tay:** tab *Actions* → "Cập nhật website lên alwaysdata" → *Run workflow* → `check` (chỉ xem sẽ đổi gì) hoặc `deploy`.

**Khôi phục bằng tay** (qua SSH):
- Mã: `tar xzf ~/phcarplay-backups/code-<giờ>.tgz -C <thư mục website>`.
- Database: file `db-*.sql.gz` chỉ có `CREATE TABLE` và `INSERT` (không xóa hay ghi đè gì), nên tạo một database **mới, trống** trên alwaysdata, nhập file vào (`zcat db-<giờ>.sql.gz | mysql -h mysql-<tài khoản>.alwaysdata.net -u <người dùng> -p <database mới>`), rồi sửa `DB_NAME` trong `.env` trỏ sang database đó.
- Gỡ quyền của GitHub: xóa dòng có `phcarplay-github-deploy` trong `~/.ssh/authorized_keys`.

`bin/migrate.php` từ giai đoạn 17 chạy lại được khi lần trước dừng giữa chừng hoặc database đã được sửa tay: câu lệnh báo "đã có rồi" (bảng/cột/chỉ mục đã tồn tại) được bỏ qua và in ra. `php bin/migrate.php --pending` liệt kê migration còn thiếu mà không đổi gì.

## 7. Chạy sau Cloudflare hoặc proxy
- Cloudflare: SSL/TLS chọn **Full (strict)**; trong `.env` đặt `CLIENT_IP_HEADER=CF-Connecting-IP` để nhật ký và bộ giới hạn tần suất thấy IP thật của người dùng (nếu không, mọi người đều mang IP của Cloudflare).
- Nginx/HAProxy đứng trước: proxy phải gửi `X-Forwarded-Proto: https` và `X-Real-IP`, rồi đặt `CLIENT_IP_HEADER=X-Real-IP`.
- Không có proxy thì **để trống** `CLIENT_IP_HEADER`, vì khi đó ai cũng tự gửi được header này để giả IP.

## 8. Bảo mật: những gì website đã làm và bạn cần biết
- **Giới hạn tần suất** (`RATE_LIMIT=true`, bật sẵn): quên mật khẩu tối đa 5 lần/giờ cho mỗi email (chống dùng website để gửi thư dồn dập); nhập sai key 10 lần/15 phút; đăng ký tối đa 20 tài khoản/giờ từ một mạng; API YouTube tối đa `RATE_LIMIT_YOUTUBE` lần/10 phút cho mỗi IP. Bị chặn thì người dùng thấy "Vui lòng thử lại sau N phút". Muốn mở chặn ngay: xóa các file trong `storage/cache/ratelimit/`.
- **Đăng nhập sai: KHÔNG giới hạn** (đúng quyết định của dự án). Có sẵn công tắc `LOGIN_THROTTLE=true`: khi bật, người dùng nhập sai 10 lần trên một máy (quản trị: 5 lần) thì máy đó bị tạm chặn **15 phút** với tài khoản đó; một tài khoản bị thử sai từ nhiều máy (30 lần, quản trị 20 lần) cũng bị tạm chặn. Vì mật khẩu băm kiểu md5 (rất nhanh), để tắt nghĩa là kẻ xấu được thử mật khẩu không giới hạn qua mạng — nên dùng mật khẩu quản trị dài và theo dõi Nhật ký.
- **Nhật ký**: lần đăng nhập quản trị sai được ghi vào mục **Nhật ký** (kèm email đã gõ và IP, không bao giờ ghi mật khẩu). Để bảng không phình to khi bị dò, mỗi máy chỉ ghi 5 lần sai đầu trong 15 phút rồi thêm một dòng "sai nhiều lần liên tiếp" (khi bật `LOGIN_THROTTLE` thì là dòng "tạm chặn"). Thấy nhiều dòng lạ: đổi mật khẩu quản trị, cân nhắc bật `LOGIN_THROTTLE` hoặc chặn IP đó ở tường lửa/Cloudflare.
- **Tiêu đề bảo mật**: Content-Security-Policy (trình duyệt chỉ chạy script của website), chống nhúng trang vào khung (trang quản trị không nhúng được ở đâu), HSTS khi chạy HTTPS, không lộ phiên bản PHP.
- **Phiên đăng nhập**: cookie HttpOnly + SameSite; file phiên nằm riêng trong `storage/sessions/` (website khác trên cùng hosting không đọc được, và không bị hệ thống tự xóa sau 24 phút như thư mục chung của Ubuntu).
- **Mật khẩu kiểu md5**: theo yêu cầu của dự án, mật khẩu băm bằng `md5(md5(mật khẩu) + salt)`. Kiểu này **rất nhanh**, nên nếu bảng `users`/`admins` bị lộ (lộ file sao lưu, lộ `.env` rồi bị đọc database...) thì mật khẩu yếu dễ bị dò ra. Vì vậy: giữ kín file sao lưu database, quản trị dùng mật khẩu dài và riêng. Khi không còn cần tương thích với hệ thống cũ, có thể chuyển sang `password_hash()` của PHP: chỉ sửa `app/Services/PasswordHasher.php`, mật khẩu cũ tự chuyển dần khi người dùng đăng nhập (cần một bước nhỏ ở lúc đăng nhập — có thể làm trong giai đoạn sau).
- **hls.js** (thư viện phát luồng HLS) mặc định tải từ CDN cdnjs. Muốn không phụ thuộc bên ngoài: tải file về `public/assets/vendor/hls.min.js` (xem `public/assets/vendor/README.txt`), website tự dùng file đó. Hoặc giữ CDN và đặt `HLS_JS_INTEGRITY` bằng mã SRI lấy ở trang cdnjs.com để trình duyệt từ chối file bị tráo.
- **Cập nhật PHP và hệ điều hành** định kỳ; PHP 7.4 đã ngừng nhận bản vá bảo mật.

## 9. Xử lý sự cố
| Hiện tượng | Cách xử lý |
|---|---|
| Trang trắng hoặc lỗi 500 | Xem `storage/logs/app.log` và log lỗi PHP của hosting. Chạy `php bin/doctor.php` |
| Trang chính mở được nhưng `/api/...` báo 404 | Máy chủ chưa chuyển mọi đường dẫn vào `public/index.php`: Apache cần `mod_rewrite` + `AllowOverride All`; Nginx cần dòng `try_files ... /index.php` |
| Không tìm/phát được video | `php bin/video-scan.php` để tìm địa chỉ Piped/Invidious đang phát được; dán kết quả vào `PIPED_API_URLS`/`INVIDIOUS_API_URLS` |
| Một tính năng không chạy, bảng điều khiển trình duyệt (F12) báo "Content Security Policy" | Đặt tạm `CSP_ENABLED=false` để xác nhận, rồi gửi nội dung lỗi để sửa; nhớ bật lại |
| Người dùng báo bị tạm chặn (đăng nhập khi đã bật `LOGIN_THROTTLE`, quên mật khẩu, nhập key) | Chờ hết thời gian báo trên màn hình, hoặc xóa file trong `storage/cache/ratelimit/` |
| Bị đăng xuất liên tục | Mỗi tài khoản chỉ một thiết bị (`SINGLE_DEVICE_LOGIN`); kiểm tra `storage/sessions` ghi được |
| Không nhận được thư | Trang quản trị > Tổng quan > **Gửi email** > Gửi thư thử (hoặc `php bin/send-test-mail.php email@cua-ban.com`), xem lỗi; kiểm tra `MAIL_DRIVER` không phải `log`; kiểm tra thư rác; dùng SMTP thay cho `mail` |
| Giờ trong nhật ký lệch | Kiểm tra `APP_TIMEZONE` (mặc định `Asia/Ho_Chi_Minh`) |
| Quên mật khẩu master và không nhận thư | Trên máy chủ: `php bin/reset-master.php --password=MatKhauMoi123` |
