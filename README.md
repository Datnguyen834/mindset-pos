# Mindset POS + payOS

Bản này tích hợp payOS theo luồng QR thanh toán tự động:

1. POS tạo đơn chuyển khoản ở trạng thái `pending`.
2. Backend gọi `payOS.paymentRequests.create()` để tạo QR/link theo đúng mã đơn và số tiền.
3. Khách quét QR và chuyển khoản.
4. payOS gửi webhook về `/api/payos/webhook`.
5. Backend xác minh webhook bằng `payOS.webhooks.verify()` và kiểm tra mã đơn + số tiền.
6. Đơn chuyển sang `paid`.
7. POS polling trạng thái khoảng 1,2 giây/lần và tự hiện thành công.

## Render Environment Variables

```text
NODE_ENV=production
DATABASE_URL=...
JWT_SECRET=...
PAYOS_CLIENT_ID=...
PAYOS_API_KEY=...
PAYOS_CHECKSUM_KEY=...
PUBLIC_BASE_URL=https://mindset-pos.onrender.com
```

Không commit các secret lên GitHub.

## Webhook

```text
https://mindset-pos.onrender.com/api/payos/webhook
```

Server tự gọi `payOS.webhooks.confirm()` khi khởi động nếu đủ 3 biến `PAYOS_*`. Nếu cần có thể gọi POST `/api/payos/confirm-webhook` bằng tài khoản admin/manager.

## Quan trọng

Nếu bộ key payOS đã từng được gửi trong chat, hãy đổi/rotate key trước khi dùng production.

## Lưu ảnh sản phẩm

Ảnh sản phẩm không còn được commit lên GitHub. Backend Render nhận file upload và lưu trực tiếp vào Neon PostgreSQL (`menu_items.image_blob` + `image_mime`). Frontend chỉ nhận URL `/api/menu/:id/image` có version theo `updated_at`, nên trình duyệt có thể cache ảnh và tự lấy ảnh mới khi Admin thay ảnh.

Khi nâng cấp từ bản cũ, server sẽ tự động migrate các ảnh cũ đang có trong `public/assets/menu` vào Neon một lần. Sau khi deployment đầu tiên chạy thành công và ảnh đã được migrate, có thể xóa thư mục ảnh cũ khỏi Git repository.

Không cần cấu hình `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` hoặc `GITHUB_BRANCH`.
