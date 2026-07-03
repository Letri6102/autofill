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
- Link dạng `viewform` hoặc `formResponse` đều dùng được.
- Không submit dữ liệu vào form, chỉ đọc cấu trúc HTML công khai của form.
- Trình duyệt thường bị CORS khi fetch Google Forms trực tiếp, nên app dùng API route `/api/parse-form` để đọc form ở phía server.
- Chỉ dùng tính năng submit tự động với form bạn sở hữu hoặc có quyền kiểm thử.
