# Google Form Parser NextJS

Web NextJS dùng để nhập link Google Form và hiển thị:

- Section
- Câu hỏi
- Mã entry
- Loại câu hỏi
- Required / không required
- Danh sách options
- `pageHistory`
- Cấu hình tỉ lệ chọn options và gửi payload thử nghiệm
- Nhập nhiều câu trả lời cho Short Answer / Paragraph để random khi gửi
- Import dữ liệu CSV / XLSX và map cột vào entry để gửi theo từng dòng
- Chọn dòng file bắt đầu và xem tiến độ số form đã hoàn tất
- Tải kết quả dạng JSON

## Cách chạy

```bash
npm install
npm run dev
```

Mở trình duyệt:

```text
http://localhost:3000
```

## Lưu ý

- Form phải public hoặc có quyền truy cập không cần đăng nhập.
- Hỗ trợ link rút gọn `forms.gle`, link `viewform` và `formResponse`.
- Trình duyệt thường bị CORS khi fetch Google Forms trực tiếp, nên app dùng API route `/api/parse-form` để đọc form ở phía server.
- Chỉ dùng tính năng submit tự động với form bạn sở hữu hoặc có quyền kiểm thử.
- File CSV có thể dùng dấu phẩy, chấm phẩy hoặc tab. File Excel hỗ trợ `.xlsx`; nếu là `.xls`, hãy lưu lại thành `.xlsx` hoặc CSV.
