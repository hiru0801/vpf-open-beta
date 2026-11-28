# Open Beta 2026/27

## Danh mục nguồn và phạm vi

| Dữ liệu hoặc tài sản | Nguồn cần xác minh | Hình thức công khai hiện tại | Việc cần xác nhận |
| --- | --- | --- | --- |
| Lịch, tỷ số, diễn biến, bảng xếp hạng | VPF và nguồn đối chiếu theo trận | Trường dữ liệu và liên kết | Điều kiện đọc tự động và công bố theo nhóm dữ liệu |
| Phiếu đăng ký | Chuyên mục và trang trận VPF | Đội hình đã đối chiếu, liên kết gốc | Quyền xử lý phiếu, phạm vi trường công bố và quy trình yêu cầu dữ liệu cá nhân |
| Tên, logo giải và CLB | Đơn vị tổ chức, CLB hoặc chủ thể quyền | Nhận diện đội và giải trong giao diện tra cứu | Phạm vi tái sử dụng và yêu cầu nhận diện |
| Bài báo, logo tòa soạn | VFF, Bóng Đá Plus, Thanh Niên, Znews, VTC News, VnExpress | Tiêu đề, giờ đăng, tên và biểu trưng nguồn, liên kết bài gốc hoặc chuyên mục | Phân loại pháp lý và quyền dẫn lại hoặc dùng logo |
| Video và phát sóng | VPF, đài hoặc kênh phát ghi theo trận | Liên kết ra nguồn | Điều kiện của kênh trước khi nhúng hoặc phát lại |
| Nhận diện app | Đồ họa sân bóng do dự án tạo | Biểu tượng tab và PWA | Đối chiếu trước khi đổi tên hoặc biểu tượng |

Ghi ngày, đầu mối xác nhận, phạm vi, thời hạn và căn cứ bằng văn bản khi có. Lưu thư từ và hồ sơ riêng tư ở nơi hạn chế truy cập.

## Đính chính và gỡ

1. Đối chiếu URL, mã trận hoặc tài sản bị báo và lưu quyết định xử lý ở phạm vi phù hợp.
2. Chặn tại đầu vào nếu nguồn có thể đưa trở lại. Kiểm tra bản phát hành và bộ nhớ đệm khi triển khai. Tạm ngừng xuất bản phần liên quan nếu cần.
3. Xác minh URL hiện tại và đường dẫn phát hành cũ từ mạng công khai. Rà soát lịch sử Git, kho lưu và bản sao bên ngoài nếu có liên quan.
4. Ghi mốc phát hiện, sửa, xuất bản và xác minh. GitHub Issues là kênh công khai. Dùng kênh riêng cho tài liệu có dữ liệu cá nhân.

## Web và mobile

- Dùng chung danh mục nguồn và nội dung pháp lý, sau đó đối chiếu dữ liệu, quyền của hệ điều hành và nhà cung cấp trên từng nền tảng.
- Phục vụ tệp tĩnh bằng CDN và tải chi tiết theo nhu cầu. Tách phần thu thập khỏi yêu cầu của người dùng. Tin tức dùng một tệp JSON cho các bộ lọc, tải khi mở mục Tin tức. Tác vụ thu thập chạy riêng và người đọc mở bài gốc tại nguồn.
- Chỉ thử tải trên hạ tầng được phép. Đo tỉ lệ cache hit, tỉ lệ lỗi, p95, băng thông, độ trễ xuất bản và số yêu cầu tới origin. Kiểm tra giới hạn GitHub Pages trước khi tăng quy mô. Kiểm thử mobile trên mạng yếu, khi chạy nền và khi mất mạng.
