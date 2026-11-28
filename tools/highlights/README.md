# Video tổng hợp 2026/27
Nguồn chính là ba mục trên trang Highlight VPF, kho phân trang của từng giải và WordPress. Nguồn dự phòng gồm RSS của ba kênh giải và ba playlist mùa 2026/27 của FPT Bóng Đá Việt. Mỗi nguồn lỗi được ghi riêng. Liên kết hiện có được giữ khi nguồn gặp lỗi.

Bộ ghép dùng cặp đội theo thứ tự sân nhà và sân khách, giải, mùa, thời điểm đăng nếu có và trạng thái trận. Nếu một mục playlist không có giờ đăng thì cặp đấu phải duy nhất trong giải. Với mục FPT có dấu hiệu xếp nhầm playlist, đợt rà kho xác nhận lại kênh phát và ngày đăng trên trang video trước khi ghép với cặp đấu duy nhất trong ngày. Chỉ dùng video của từng trận đã kết thúc và có tỷ số. Khi VPF bổ sung bài đúng trận, bài VPF có thể thay liên kết YouTube.

Workflow Open Beta quét nguồn mới mỗi 15 phút theo lịch GitHub Actions và rà lại kho mỗi ngày. Nó dùng chung checkpoint và khóa triển khai với luồng dữ liệu trận và Tin tức. Báo cáo độ phủ theo giải nằm trong log. Mỗi lần chạy chỉ tạo bản phát hành khi có liên kết thay đổi. Thiết bị của người xem mở video tại trang nguồn qua nút Xem video tổng hợp.
