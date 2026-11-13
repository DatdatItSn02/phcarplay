# API (giai đoạn 0-5.4)

Tiền tố `/api`. Dữ liệu JSON UTF-8. Cookie phiên `carweb_sid` (HttpOnly). Mọi yêu cầu POST/PUT/PATCH/DELETE phải có header `X-CSRF-Token` lấy từ `GET /api/auth/me`.

Thành công: `{"ok":true,"data":...}`. Lỗi: `{"ok":false,"error":{"code","message","details?"}}`.

| Phương thức, đường dẫn | Body | Kết quả / lỗi |
|---|---|---|
| `GET /health` | - | `{status, database}` (không trả phiên bản PHP) |
| `GET /auth/me` | - | `{user\|null, guest, csrf, plan, features[], expires_at}`. Thêm `replaced: true` nếu tài khoản vừa đăng nhập ở thiết bị khác (thiết bị này bị đăng xuất) |
| `POST /auth/register` | `{email, phone, name?, password}` | 201 như `/auth/me` và tự đăng nhập. `phone` bắt buộc (giai đoạn 14): số di động VN 10 số bắt đầu bằng 0 (nhận cả `+84`/`84`, dấu cách, dấu chấm, gạch nối; lưu dạng `0xxxxxxxxx`). 422 `VALIDATION_FAILED`, 409 `EMAIL_TAKEN`, 409 `PHONE_TAKEN` |
| `POST /auth/login` | `{login, password}` | `login` là email **hoặc** số điện thoại (vẫn nhận `{email, password}` cũ). Như `/auth/me`. 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_BLOCKED` |
| `POST /auth/logout` | - | `{csrf}` (token mới) |
| `POST /auth/forgot` | `{login}` (hoặc `{email}`) | Giai đoạn 14: gửi **mã 6 số** (hết hạn sau `OTP_TTL_MINUTES`, mặc định 10 phút) tới email của tài khoản; SMS khi đã bật `SMS_DRIVER`. Luôn trả `{message, resend_after, expires_in}` giống nhau dù tài khoản có hay không. Mỗi tài khoản tối đa 1 mã/60 giây |
| `POST /auth/reset` | `{login, code, password}` | Đặt mật khẩu mới bằng mã. `{message}`; mọi thiết bị bị đăng xuất. 400 `OTP_INVALID` (sai tài khoản, hết hạn, đã dùng), 400 `OTP_WRONG` (`details.code`: còn N lần), 400 `OTP_LOCKED` (sai 5 lần, mã bị hủy), 422. Tối đa 60 lần/giờ mỗi IP. Vẫn nhận `{token, password}` của liên kết cũ (400 `TOKEN_INVALID`) |
| `PUT /user/phone` | `{phone}` | Cần đăng nhập. Thêm/đổi số điện thoại đăng nhập. Trả như `/auth/me`. 422, 409 `PHONE_TAKEN` |
| `POST /user/password/code` | - | Cần đăng nhập. Gửi mã đổi mật khẩu tới email (và SMS khi đã bật). `{message, resend_after, expires_in}`. 429 `OTP_TOO_SOON` (`details.retry_after` giây) |
| `POST /user/password` | `{code, password}` | Cần đăng nhập. Đổi mật khẩu bằng mã: thiết bị này vẫn đăng nhập (phiên mới), các thiết bị khác bị đăng xuất. Trả `{message}` + như `/auth/me`. Lỗi mã như `/auth/reset` |
| `GET /user/preferences` | - | Cần đăng nhập. `{layout: {h, v} \| null}` (null nếu chưa từng lưu) |
| `GET /user/youtube-key` | - | Cần đăng nhập (giai đoạn 10). `{enabled, reason, has_key, last4, updated_at, state}`. `state`: `ok`, `quota` (hết lượt hôm nay), `invalid`, `unreadable` (APP_KEY đã đổi) hoặc null. Không bao giờ trả khóa đầy đủ |
| `PUT /user/youtube-key` | `{key}` | Cần đăng nhập. Thử khóa với Google (lệnh `videos.list`, 1 đơn vị hạn mức) rồi mã hóa và lưu. Trả như GET kèm `checked`: `ok`, `quota` hoặc `error` (chưa thử được). 422 nếu khóa sai dạng hoặc Google báo sai; 409 `FEATURE_DISABLED` nếu tính năng tắt/thiếu APP_KEY; tối đa 10 lần/giờ |
| `DELETE /user/youtube-key` | - | Cần đăng nhập. Bỏ khóa (để trống cột, không xóa dòng). Trả như GET |
| `POST /user/plays` | `{id, title, uploader, duration}` | Cần đăng nhập (giai đoạn 11). Cộng 1 lượt nghe (giao diện gửi khi bài đã phát từ 30 giây; bài dưới 1 phút: quá nửa bài). Ảnh bìa không nhận từ trình duyệt. 422 nếu mã video sai; tối đa 300 lần/giờ |
| `GET /user/plays/top` | - | Cần đăng nhập. `{items: [video + plays]}`: bài nghe từ 2 lượt, nghe lần cuối trong 60 ngày, nhiều lượt trước, tối đa 20. Giao diện ghép vào đầu tab "Tất cả" rồi thêm bài gợi ý cho đủ 20 |
| `POST /user/plays/{id}/hide` | - | Cần đăng nhập. Ẩn một bài khỏi danh sách hay nghe (đưa lượt về 0, ghi `hidden_at`; nghe lại 2 lượt thì hiện lại) |
| `POST /user/plays/clear` | - | Cần đăng nhập. Xóa danh sách hay nghe (mọi bài về 0 lượt, không xóa dòng) |
| `PUT /user/preferences` (giai đoạn 12) | `{playback: {repeat, autoMix}}` | Cũng nhận chế độ phát: `repeat` là `off` (lần lượt), `all` (lặp tất cả), `one` (lặp 1 bài) hoặc `shuffle` (trộn bài); `autoMix` là true/false. GET trả thêm `playback` (null nếu chưa lưu) |
| `PUT /user/preferences` | `{layout: {h?, v?}}` | Cần đăng nhập. Mỗi giá trị 0.1 đến 0.9, gộp vào cài đặt đã lưu. Trả cài đặt sau khi lưu. 422 nếu không có giá trị hợp lệ |
| `POST /user/license/redeem` | `{code}` | Cần đăng nhập. Nhập key kích hoạt (gõ chữ thường, bỏ gạch nối hay thừa dấu cách đều được). Cộng số ngày của key vào hạn dùng: còn hạn thì cộng nối tiếp, hết hạn hoặc chưa có thì tính từ bây giờ. Trả `{days_added, previous_expires_at, user, plan, features[], expires_at}`. 422 (sai định dạng, lỗi ở `details.code`), 404 `KEY_NOT_FOUND`, 409 `KEY_USED`, 409 `KEY_REVOKED` |

### Chiếu màn hình điện thoại lên màn hình xe (giai đoạn 15)

Máy chủ chỉ **ghép nối** hai máy; hình ảnh đi thẳng giữa hai máy (WebRTC), không qua máy chủ. Không cần đăng nhập. Mỗi máy
chứng minh mình bằng khóa nhận lúc tạo/nhập mã, gửi trong header `X-Cast-Token`. POST vẫn cần `X-CSRF-Token` như mọi API.

| Đường dẫn | Gửi | Trả về |
|---|---|---|
| `POST /cast/sessions` | - | 201 `{id, code, token, role:'receiver', expires_in, ice_servers}`. Màn hình xe lấy mã 6 số (hiệu lực `CAST_CODE_TTL_SECONDS`, mặc định 300 giây). Tối đa 40 lần/giờ mỗi IP. 503 `CAST_DISABLED` |
| `POST /cast/join` | `{code, device_name?}` | `{id, token, role:'sender', ice_servers}`. Điện thoại nhập mã; mã chỉ dùng một lần. 404 `CAST_CODE_INVALID`. Tối đa 12 lần/10 phút mỗi IP (chống dò mã) |
| `GET /cast/sessions/{id}/signals?after=N` | header `X-Cast-Token` | `{status:'waiting'/'paired', role, device_name, signals:[{id, kind, payload}], code_expires_in?}` - tin của máy BÊN KIA sau tin số N. 404 `CAST_NOT_FOUND` (sai khóa), 410 `CAST_ENDED` (`details.ended_by`: `receiver`/`sender`/`expired`) |
| `POST /cast/sessions/{id}/signals` | `{kind, payload}` + header | 201 `{id}`. `kind`: `offer`/`answer`/`ice`/`bye`; `payload` là object, tối đa 16.000 byte. 409 `CAST_NOT_PAIRED`, 422, 429 `CAST_TOO_MANY` (quá 3.000 tin/phiên) |
| `POST /cast/sessions/{id}/end` | header | `{ended:true}`. Kết thúc phiên: không xóa dòng, ghi `ended_at`/`ended_by` và xóa trắng nội dung các tin |


## YouTube (qua Piped, dự phòng Invidious rồi YouTube; khách cũng gọi được)
| Phương thức, đường dẫn | Kết quả |
|---|---|
| `GET /youtube/search?q=...&page=...` | `{items: [video], next: string\|null}`. `page` là giá trị `next` của lần trước để tải thêm: `p:...` (trang kế của Piped), `i:2`, `i:3`... (Invidious), `y:...` (YouTube đọc trực tiếp) `a:...` (YouTube Data API bằng khóa của website) hoặc `u:...` (bằng khóa riêng của người dùng); mã cũ không có tiền tố được hiểu là của Piped. Người đã đăng nhập có khóa riêng: tìm bằng khóa đó trước. Có thể kèm `notice` (chuỗi) khi khóa riêng hết lượt/không dùng được (vẫn trả kết quả từ nguồn khác), và `key_hint: true` (cũng có trong `error.details` khi lỗi) khi người dùng chưa có khóa riêng mà phải tìm bằng cách dự phòng (`YOUTUBE_KEY_HINT`). 422 nếu thiếu `q` |
| `GET /youtube/suggest?q=...` | `{suggestions: [string]}` (tối đa 8) |
| `GET /youtube/trending` | `{items: [video]}` nhạc thịnh hành theo từ khóa `MUSIC_QUERY` |
| `GET /youtube/stream/{id}` | Thông tin phát: `{id, title, uploader, duration, thumbnail, live, hls, sources[], audio[], related[video]}`. `hls` là địa chỉ HLS hoặc null; `sources` là các luồng mp4 có cả hình và tiếng (nét nhất trước); `related` dùng cho chế độ Mix; `source` là `piped`, `invidious` hoặc `youtube`. **`embed: true`** (khi Piped/Invidious không cho luồng, `YOUTUBE_EMBED=true`): `sources`, `audio` rỗng, giao diện phát bằng trình phát nhúng của YouTube; `related` lấy từ YouTube nếu được |

Một `video` là `{id, title, uploader, duration (giây), thumbnail, views, uploaded_at (mili giây, 0 nếu không rõ)}`.
Máy chủ thử lần lượt các nguồn theo `VIDEO_SOURCES` (mặc định Piped trước, Invidious sau); trong mỗi nguồn thử mọi địa chỉ, địa chỉ hỏng (không kết nối được, trả trang web thay vì dữ liệu, lỗi 5xx/403/429) bị tạm bỏ qua 10 phút. Luồng phát của Invidious được xin kèm `local=true` để đi qua chính máy chủ Invidious.
Nguồn thứ ba **YouTube** (giai đoạn 9) luôn được thử sau cùng: có `YOUTUBE_API_KEY` thì dùng YouTube Data API, không có thì máy chủ đọc trực tiếp kết quả tìm kiếm của YouTube, với 5 biện pháp chống bị chặn: chỉ dùng khi Piped/Invidious hỏng; lưu đệm kết quả (`YOUTUBE_SEARCH_TTL`); tối đa `YOUTUBE_DIRECT_PER_HOUR` lần/giờ cho cả website; YouTube báo chặn thì nghỉ `YOUTUBE_BLOCK_COOLDOWN` giây; có khóa thì không đọc trực tiếp.
Lỗi riêng: 502 `UPSTREAM_FAILED` (mọi nguồn, mọi địa chỉ đều lỗi), 404 `STREAM_UNAVAILABLE` (nguồn đã trả lời nhưng video không phát được), 503 `PIPED_NOT_CONFIGURED`/`INVIDIOUS_NOT_CONFIGURED` (không cấu hình nguồn nào).

## Playlist (cần đăng nhập)
| Phương thức, đường dẫn | Body | Kết quả |
|---|---|---|
| `GET /playlists` | - | `{playlists: [{id, name, count, updated_at}]}` mới sửa gần nhất đứng đầu |
| `POST /playlists` | `{name}` | 201, `{id, name, count, updated_at}`. 422 `PLAYLIST_LIMIT` khi đạt số playlist tối đa |
| `GET /playlists/{id}` | - | `{id, name, items: [{id, title, uploader, duration, thumbnail}]}`. 404 nếu không phải của bạn |
| `PATCH /playlists/{id}` | `{name}` | Playlist sau khi đổi tên |
| `DELETE /playlists/{id}` | - | `{deleted: true}` (xóa luôn các bài) |
| `POST /playlists/{id}/items` | `{items: [{id, title, uploader?, duration?, thumbnail?}]}` (tối đa 50) | 201, `{added, count}`; bài đã có thì bỏ qua. 422 `PLAYLIST_FULL` |
| `DELETE /playlists/{id}/items/{video_id}` | - | `{deleted: true}` |
| `PUT /playlists/{id}/order` | `{video_ids: [...]}` đúng bằng tập bài hiện có | Playlist với thứ tự mới |
| `POST /playlists/import` | `{playlists: [{name, items: [...]}]}` | `{created}`. Dùng để chuyển playlist của khách lên tài khoản |

Mã lỗi chung: 403 `CSRF_INVALID`, 401 `UNAUTHORIZED`, 401 `SESSION_REPLACED` (route cần đăng nhập, khi tài khoản đã đăng nhập ở thiết bị khác), 404 `NOT_FOUND`, 405 `METHOD_NOT_ALLOWED`, 429 `TOO_MANY_ATTEMPTS`, 500 `SERVER_ERROR`.

**Giới hạn tần suất (429 `TOO_MANY_ATTEMPTS`)**: kèm `details.retry_after` (giây) và header `Retry-After`; lời nhắn có sẵn "Vui lòng thử lại sau N phút". Áp dụng cho: quên mật khẩu (5 lần/giờ mỗi email, 20 lần/giờ mỗi IP), đăng ký (20 lần/giờ mỗi IP), nhập sai key (10 lần/15 phút mỗi người dùng), API `/youtube/*` (`RATE_LIMIT_YOUTUBE` lần/10 phút mỗi IP, mặc định 1200); tắt bằng `RATE_LIMIT=false`. **Đăng nhập sai mặc định không giới hạn** (quyết định dự án); chỉ khi đặt `LOGIN_THROTTLE=true` mới tạm chặn: 10 lần/15 phút cho một email trên một IP, 30 lần cho một email, 60 lần cho một IP (quản trị 5/20/30), và đổi mật khẩu quản trị nhập sai mật khẩu hiện tại 5 lần/15 phút.

`plan` là `guest` (chưa đăng nhập), `member` hoặc `trial` (chỉ khi `ENFORCE_LICENSE=true` và tài khoản hết hạn). `features` là danh sách tính năng được dùng.

## Đăng nhập trên một thiết bị
Bật bằng `SINGLE_DEVICE_LOGIN=true` (mặc định). Mỗi lần đăng nhập hoặc đăng ký tạo một dấu phiên ngẫu nhiên: bản băm lưu ở `users.session_token` (kèm `session_device`, `session_ip`, `session_at`), bản gốc nằm trong cookie phiên của thiết bị. Đăng nhập ở thiết bị mới ghi đè dấu cũ nên thiết bị cũ bị đăng xuất ở yêu cầu kế tiếp. Giao diện hỏi `GET /auth/me` mỗi 60 giây và khi quay lại thiết bị để thiết bị cũ biết mình đã bị đăng xuất. Đặt lại mật khẩu cũng đăng xuất mọi thiết bị. Cùng một trình duyệt mở nhiều tab vẫn là một thiết bị; hai trình duyệt khác nhau trên cùng máy là hai thiết bị.


---

# API quản trị (giai đoạn 5.1-5.4)

Tiền tố **`/admin/api`**, phiên riêng (cookie `carweb_admin`, HttpOnly, sống 8 giờ) tách hẳn khỏi người dùng: đăng nhập trang người dùng không cho quyền admin và ngược lại. Định dạng phản hồi và quy tắc CSRF giống API người dùng (header `X-CSRF-Token` lấy từ `GET /admin/api/auth/me`). Mật khẩu admin tối thiểu **8** ký tự.

Ba lớp kiểm tra quyền, chạy theo thứ tự: `RequireAdmin` (đã đăng nhập, chưa bị khóa, mật khẩu chưa đổi kể từ lúc đăng nhập) → `RequirePasswordChanged` (không còn là mật khẩu tạm) → `RequireMaster` (chỉ vai trò master).

| Phương thức, đường dẫn | Quyền | Body | Kết quả / lỗi |
|---|---|---|---|
| `GET /auth/me` | công khai | - | `{admin\|null, csrf}`. `admin` = `{id, email, name, role, status, must_change_password, last_login_at, created_at}` (không bao giờ có hash/salt) |
| `POST /auth/login` | công khai | `{email, password}` | như `/auth/me`. 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_BLOCKED`. Đổi ID phiên sau khi đăng nhập; ghi nhật ký `admin.login` |
| `POST /auth/logout` | công khai | - | `{csrf}` (token mới), hủy phiên |
| `POST /auth/forgot` | công khai | `{email}` | Luôn `{message}` nếu email đúng định dạng. Chỉ gửi thư khi là admin đang hoạt động; tối đa 1 thư/60 giây. Liên kết: `APP_URL/admin/reset-password?token=...` |
| `POST /auth/reset` | công khai | `{token, password}` | `{message}`. 400 `TOKEN_INVALID` (sai, hết hạn, đã dùng, hoặc là token của người dùng), 422 |
| `POST /account/password` | đã đăng nhập (kể cả đang bị buộc đổi) | `{current_password, new_password}` | như `/auth/me` với phiên đã làm mới. 422 nếu sai mật khẩu hiện tại hoặc mật khẩu mới trùng cũ. Gỡ cờ `must_change_password`; các phiên khác của tài khoản bị đăng xuất |
| `GET /admins` | master | - | `{items: [admin]}` master đứng đầu |
| `POST /admins` | master | `{email, name, password}` | 201 `admin`. Luôn tạo vai trò `admin`, `must_change_password = true`. 422, 409 `EMAIL_TAKEN` |
| `GET /admins/{id}` | master | - | `admin`. 404 |
| `PATCH /admins/{id}` | master | một hoặc nhiều của `{name, email, status}` (`status`: `active`/`blocked`) | `admin` sau khi sửa. 422, 409 `EMAIL_TAKEN`, 403 `MASTER_PROTECTED` |
| `POST /admins/{id}/password` | master | `{password}` | `{message}`. Đặt mật khẩu tạm: buộc đổi ở lần đăng nhập tới, đăng xuất mọi phiên, vô hiệu token quên mật khẩu cũ. 403 `MASTER_PROTECTED` nếu là master |
| `DELETE /admins/{id}` | master | - | `{deleted: true}`. Xóa cả token đặt lại mật khẩu của người đó. 403 `MASTER_PROTECTED` |

### Tổng quan, người dùng, key, playlist, nhật ký (giai đoạn 5.2-5.4)
Quyền: **mọi admin** đã đổi mật khẩu tạm dùng được `/stats`, `/users`, `/keys`, `/playlists`; **chỉ master** xem được `/audit`. Mọi danh sách phân trang bằng `?page=1&per_page=20` (tối đa 100) và trả `{items, total, page, per_page}`. Ô tìm kiếm `q` coi `%` và `_` là ký tự thường (không phải ký tự đại diện).

**Xóa = đánh dấu (giai đoạn 8).** Website không bao giờ chạy lệnh `DELETE` trên database. Mọi API "xóa" chỉ ghi `deleted_at` (thời điểm) và người xóa (`deleted_by_type` = `admin`/`user`/`system`, `deleted_by_id`, `deleted_by_email`); dòng đó bị ẩn khỏi mọi danh sách, đăng nhập, tìm kiếm. Các danh sách `/users`, `/keys`, `/playlists`, `/admins` nhận thêm `deleted=1` để chỉ xem mục đã xóa; mỗi mục có `deleted: {at, by_type, by_id, by_email}` (hoặc `null` nếu chưa xóa).

| Phương thức, đường dẫn | Body / tham số | Kết quả / lỗi |
|---|---|---|
| `GET /stats` | - | `{users: {total, active, blocked, new_7d, license_valid, license_expired, license_none}, keys: {unused, used, revoked}, playlists: {playlists, items}, admins: {total}, recent}`. `recent` là 8 thao tác gần nhất, **chỉ master** có (admin thường: `null`) |
| `GET /users` | `q` (email hoặc tên), `status` (`active`/`blocked`), `license` (`valid`/`expired`/`none`) | `{items: [user], total, page, per_page}`. `user` = `{id, email, name, status, expires_at, license, last_login_at, created_at, device\|null, playlist_count}`, không bao giờ có hash, salt hay dấu phiên. 422 nếu `status`/`license` lạ |
| `GET /users/{id}` | - | `user` kèm `device: {label, ip, since}\|null`, `playlists: [{id, name, count, updated_at}]`, `keys: [key]` (các key người này đã nhập, dạng như ở `/keys`). 404 |
| `PATCH /users/{id}` | một hoặc nhiều của `{name, email, phone, status, expires_at}` (`phone`: `''`/`null` để bỏ số) (`status`: `active`/`blocked`; `expires_at`: `YYYY-MM-DD` hoặc `null` để xóa hạn) | `user` sau khi sửa. Ngày cụ thể được hiểu là hết **cuối ngày đó** (23:59:59). Khóa tài khoản xóa luôn dấu phiên nên người dùng bị đăng xuất ngay. 422, 409 `EMAIL_TAKEN`, 409 `PHONE_TAKEN`, 404 |
| `POST /users/{id}/extend` | `{days}` (1 đến 3650) | `user`. Cộng ngày như khi nhập key (nối tiếp hạn còn lại, hoặc từ bây giờ). 422 |
| `POST /users/{id}/password` | `{password}` (6 đến 100 ký tự) | `{message}`. Đặt mật khẩu mới (vĩnh viễn, không phải mật khẩu tạm), đăng xuất mọi thiết bị, vô hiệu token quên mật khẩu cũ. Người dùng muốn tự đổi thì dùng "Quên mật khẩu" |
| `POST /users/{id}/send-reset` | - | `{message}`. Gửi **mã 6 số** đặt lại mật khẩu tới email người dùng (giai đoạn 14; tối đa 1 mã/60 giây). Người dùng nhập mã ở "Quên mật khẩu" > "Đã có mã trong email? Nhập mã". 409 `USER_BLOCKED` nếu đang bị khóa |
| `POST /users/{id}/logout-device` | - | `{message}`. Đăng xuất thiết bị đang đăng nhập; người dùng vẫn đăng nhập lại được |
| `DELETE /users/{id}` | - | `{deleted: true}`. Đánh dấu xóa người dùng cùng playlist và bài của họ, đăng xuất thiết bị, vô hiệu token đặt lại mật khẩu. Email này đăng ký lại được (tài khoản mới). **Key họ đã nhập được giữ lại làm lịch sử**. Mọi admin đều xóa được |
| `GET /keys` | `q` (mã, ghi chú hoặc email người dùng), `status` (`unused`/`used`/`revoked`) | `{items: [key], total, page, per_page, counts: {unused, used, revoked}}`. `key` = `{id, code, days, note, status, created_by_email, created_at, used_by, used_by_email, used_at, revoked_at}` |
| `POST /keys` | `{count, days, note?}` (`count` 1 đến 100, `days` 1 đến 3650, ghi chú tối đa 190 ký tự) | 201 `{items: [key]}`. Mã dạng `XXXX-XXXX-XXXX-XXXX` (31 ký tự, bỏ 0/O/1/I/L cho dễ đọc), sinh bằng `random_bytes`, không trùng. 422 kèm lỗi từng ô |
| `POST /keys/{id}/revoke` | - | `key` đã thu hồi. Chỉ key chưa dùng. 409 `KEY_USED`, 404 |
| `DELETE /keys/{id}` | - | `{deleted: true}`. Đánh dấu xóa; key đã xóa không nhập được nữa. Không xóa được key đã dùng (giữ làm lịch sử): 409 `KEY_USED`. 404 |
| `POST /keys/bulk` | `{action: 'revoke'\|'delete', ids: [số]}` (1 đến 100 id) | `{done: [id], skipped: [{id, reason}]}`. Thu hồi / xóa nhiều key một lần; key không làm được (đã dùng, đã thu hồi, không còn) được bỏ qua kèm lý do. Ghi **một** dòng nhật ký `key.bulk_revoke`/`key.bulk_delete` cho cả lô. 422 |
| `GET /playlists` | `q` (tên playlist hoặc email chủ) | `{items: [{id, name, count, updated_at, user_id, user_email, user_name}], total, page, per_page}` |
| `GET /playlists/{id}` | - | `{id, name, updated_at, user_email, items: [{id, title, uploader, duration, thumbnail}]}`. 404 |
| `DELETE /playlists/{id}` | - | `{deleted: true}`. Đánh dấu xóa playlist và các bài trong đó. 404 |
| `GET /audit` (**master**) | `q` (email người làm hoặc chi tiết), `action`, `from`, `to` (`YYYY-MM-DD`) | `{items: [{id, admin_id, admin_email, action, target_type, target_id, detail, ip, created_at}], total, page, per_page, actions: [mã hành động đã có]}`. Mới nhất trước. 422 nếu ngày sai định dạng. 403 `FORBIDDEN` với admin thường |

Không có API sửa hay xóa nhật ký. Key được lưu dạng chữ rõ (không băm) để admin xem lại và gửi cho khách; hãy coi danh sách key là dữ liệu nhạy cảm và chỉ giao cho người tin cậy.

Mã lỗi riêng: 401 `UNAUTHORIZED` (chưa đăng nhập, hết phiên, bị khóa, hoặc mật khẩu đã đổi ở nơi khác), 403 `PASSWORD_CHANGE_REQUIRED` (đang dùng mật khẩu tạm), 403 `FORBIDDEN` (không phải master), 403 `MASTER_PROTECTED`, 409 `EMAIL_TAKEN`, 409 `KEY_USED`, 409 `USER_BLOCKED`.

**Quy tắc bảo vệ master** (kiểm tra ở `AdminAccountService`, không chỉ ở giao diện): không tạo thêm master; không khóa, xóa, đặt mật khẩu tạm cho master; chỉ chính master mới sửa được tên và email của mình. Quên mật khẩu master: tự quên mật khẩu qua email, hoặc `php bin/reset-master.php --password=...`.

**Phiên và đổi mật khẩu:** lúc đăng nhập, phiên lưu một "dấu vân tay" `sha256(password_hash . salt)`. Mật khẩu đổi (tự đổi, master đặt lại, quên mật khẩu) thì dấu cũ không còn khớp và mọi phiên cũ của tài khoản đó bị đăng xuất ở yêu cầu kế tiếp; khóa hoặc xóa tài khoản cũng vậy. Giao diện hỏi `/auth/me` mỗi 60 giây để biết sớm.

**Nhật ký (`audit_log`):** ghi `admin.login`, `admin.create`, `admin.update` (chỉ khi có thay đổi thật, kèm giá trị cũ → mới), `admin.password_set`, `admin.password_change`, `admin.password_forgot`, `admin.password_reset`, `admin.delete`; về người dùng `user.update`, `user.extend`, `user.password_set`, `user.reset_sent`, `user.logout_device`, `user.delete`; về key `key.create`, `key.revoke`, `key.delete`, `key.bulk_revoke`, `key.bulk_delete`; về playlist `playlist.delete`; cùng IP. Không bao giờ ghi mật khẩu hay token (kể cả mật khẩu admin vừa đặt cho người dùng). Đăng nhập sai không ghi nhật ký (không giới hạn số lần theo yêu cầu dự án). Nếu ghi nhật ký lỗi thì chỉ ghi vào `storage/logs/app.log` và không làm hỏng thao tác chính. Xem bằng mục "Nhật ký" của trang quản trị (chỉ master).

## Trang quản trị
`/admin` (và `/admin/dashboard`, `/admin/users`, `/admin/keys`, `/admin/playlists`, `/admin/audit`, `/admin/admins`, `/admin/account`, `/admin/reset-password?token=...`) do `public/index.php` phục vụ cùng một trang HTML (có `noindex`, `Cache-Control: no-store`); phần giao diện nằm ở `public/assets/js/admin/`. Mục đang mở lấy từ địa chỉ trang nên tải lại hoặc nút Back vẫn đúng chỗ; mục không có quyền (admin thường gõ `/admin/audit`) tự chuyển về Tổng quan.
