# Cửa sổ nổi (PiP), toàn màn hình và Media Session

Giai đoạn 4. Chỉ có phía trình duyệt: không có API, database hay biến `.env` mới. Mã nằm ở `public/assets/js/modules/pip/`, nối vào `modules/youtube/media.js` (tạo) và `modules/player/playerPanel.js` (nút bấm). Xem thêm `docs/ARCHITECTURE.md`.

## Người dùng thấy gì
- Hai nút tròn nhỏ ở góc trên bên phải khung video: **Cửa sổ nổi** và **Toàn màn hình**.
- Bấm **Cửa sổ nổi**: video nổi lên trên các app khác. Khung video trong app hiện "Đang phát ở cửa sổ nổi." kèm nút **Đưa về đây**. Đổi bài hoặc Mix không làm đóng cửa sổ nổi.
- Nút Cửa sổ nổi mờ đi khi chưa nổi được (chưa có video, hoặc bài chỉ có âm thanh). Bấm vào nút mờ sẽ hiện lý do.
- Nút bị **ẩn hẳn** khi trình duyệt không hỗ trợ hoặc tài khoản không có quyền `pip`; có một dòng gợi ý nhỏ dưới các nút.
- **Toàn màn hình**: phóng to chính thẻ video và tạm bật thanh điều khiển có sẵn của trình duyệt (thẻ video của app không có thanh điều khiển). Trên Android Chrome, đang toàn màn hình mà bấm Home thì trình duyệt thường tự chuyển sang cửa sổ nổi.
- **Media Session**: tên bài, kênh, ảnh bìa và các nút phát/dừng/bài trước/bài sau/tua hiện trên cửa sổ nổi, thanh thông báo, màn hình khóa, nút tai nghe.

## Giới hạn
- Phụ thuộc trình duyệt: Chrome, Edge, Safari có; Firefox không có API cho trang web; trình duyệt trên đầu xe có thể không hỗ trợ (khi đó nút tự ẩn, Media Session vẫn chạy nếu trình duyệt có).
- Bài chỉ có âm thanh (không có hình) không nổi được; vẫn điều khiển được qua Media Session.
- Document PiP (cửa sổ có giao diện riêng) chỉ có trên máy tính nên không dùng.
- Safari/iPhone dùng API riêng (`webkitSetPresentationMode`); đã có nhánh xử lý nhưng chưa thử trên thiết bị thật.
- Chưa kiểm chứng: Chrome có giữ cửa sổ nổi khi thẻ video đổi nguồn phát hay không (mã không bao giờ chủ động thoát PiP khi đổi bài). Phải thử trên thiết bị.

## Danh sách thử trên thiết bị thật
1. Mở web, đợi video phát. Bấm **Cửa sổ nổi**: video có nổi ra không? Khung trong app có hiện "Đang phát ở cửa sổ nổi."?
2. Khi đang nổi, bấm **Bài kế tiếp** (hoặc đợi hết bài): **cửa sổ nổi có còn mở và chuyển sang bài mới không?** Đây là mục quan trọng nhất.
3. Mở app khác (Home, rồi mở app bản đồ): cửa sổ nổi có ở lại trên cùng?
4. Nút phát/dừng, bài trước/sau, tua trên cửa sổ nổi và trên thanh thông báo (kéo màn hình thông báo xuống): có chạy không? Tên bài và ảnh bìa có đúng?
5. Bấm **Đưa về đây** và nút X của cửa sổ nổi: giao diện có trở lại bình thường?
6. **Toàn màn hình**: có thanh điều khiển của trình duyệt không? Thoát bằng nút Back được không? Đang toàn màn hình bấm Home có tự vào cửa sổ nổi không (Android Chrome)?
7. Đăng xuất khi đang nổi: cửa sổ nổi có đóng và nhạc có dừng?
8. Trên trình duyệt đầu xe: nút Cửa sổ nổi ẩn hay hiện? Nếu ẩn, dòng gợi ý có hiện đúng?

Gặp lỗi, chụp màn hình hoặc ghi lại: thiết bị, trình duyệt và phiên bản, bước đã làm, điều thấy được.

- Trong ứng dụng Android/iOS (giai đoạn 13, `mobile/`): cửa sổ nổi tắt hẳn (không nút, không dòng gợi ý): Android WebView không hỗ trợ cửa sổ nổi của web. Từ giai đoạn 15 ứng dụng nghe được nhạc trong nền (Cài đặt > "Phát trong nền") nên không cần cửa sổ nổi để nghe tiếp.
