# Dữ liệu ngày thi đấu

**Phiếu đăng ký** lấy từ ba chuyên mục WordPress của VPF. Chuyên mục luôn được kiểm tra, kể cả khi trận đã bắt đầu. Ảnh được ghép theo mùa, giải, vòng, hai đội và ngày giờ trên phiếu. OCR đối chiếu số áo và tên với danh sách đăng ký CLB. Mỗi đội phải có 11 cầu thủ xuất phát và số áo duy nhất. Phiếu OCR chưa đạt được đưa vào luồng đối chiếu, còn đội hình đã xác minh tiếp tục được phục vụ. Mỗi trận lưu tối đa tám phiên bản ảnh theo URL, mã băm và thời điểm thấy lần đầu.

**Trang trận VPF** cung cấp trạng thái, tỷ số, diễn biến và thay người. Đội hình trên trang trận chỉ được dùng khi thiếu phiếu đã xác minh của đội đó. Phiếu VPF hợp lệ thay thế dữ liệu dự phòng. Thời điểm vào và rời sân đến từ trang trận. Tỷ số đang đá hoặc nghỉ giữa hiệp không vào kết quả gần đây và không làm thay đổi bảng xếp hạng đã công bố. Tỷ số chung cuộc cần trạng thái kết thúc rõ ràng và lịch VPF khớp, hoặc bản dữ liệu chính thức đã xác minh. Nếu VPF không ghi rõ trạng thái, UI giữ kết quả đã kiểm chứng hoặc hiển thị trạng thái cập nhật gần nhất.

## Vận hành

- Hai workflow dùng chung khóa triển khai và cùng phục vụ dữ liệu ở `open-beta-data/data/live`. Lượt tin tức cũng mang theo phần ngày thi đấu để trang công khai không bị lùi phiên bản.
- Lịch GitHub Actions kiểm tra 5 phút một lượt, ưu tiên lệch đầu giờ. GitHub có thể xếp hàng hoặc trì hoãn lịch. Lượt theo lịch bỏ qua triển khai khi chỉ mục công khai đã trùng với bản xác minh. Khi không đọc được VPF, xem mã HTTP trong log. Lỗi nguồn giữ dữ liệu đã xác minh.
- Có thể chạy bộ thu từ máy Linux được phép đọc VPF. Chuẩn bị Python, lxml, Node, curl, Tesseract và dữ liệu `updates.json` hiện hành trong thư mục trạng thái.

```bash
python tools/prepare-app.py
PYTHONPATH=app/tools python -m live.collect --state /path/to/state
```

Dùng `--backfill` để rà lại cả mùa. Trước khi đưa một bản ra công khai, cần kiểm tra cập nhật phiếu VPF đến muộn, chuyển LIVE → nghỉ giữa hiệp → kết thúc theo nguồn và xác minh JSON cùng UI từ trình duyệt.

## Phục vụ đông người xem

Chỉ mục JSON nhỏ cập nhật theo lịch. Chi tiết tách theo trận và phiên bản. Trình duyệt chỉ tải chi tiết trận đang mở, giảm nhịp ở trang danh sách khi ngoài khung thi đấu và dừng đọc khi tab ẩn. Mỗi phút có một khóa CDN dùng chung cho chỉ mục. Các lượt xem không truy cập VPF. Bản web, lịch CLB và tin tức vẫn là tệp tĩnh. Với các đỉnh truy cập lớn, đặt bản phát hành tĩnh trên CDN có đủ hạn mức, duy trì một bộ thu dữ liệu dùng chung và diễn tập tải từ hạ tầng được phép trước khi cam kết công suất.
