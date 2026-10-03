# Mindset POS V11

V11 built from the original V10 project. Includes:
- Login flow preserved from V10
- 3-column product grid with additional rows and menu-only scrolling
- Fixed left sidebar and fixed right order/payment panel on desktop
- Bánh ngọt category and bakery products
- Centered custom confirmation modal for deleting products, toppings, categories, and locking users
- Original revenue/order/login logic preserved


## payOS tự động xác nhận chuyển khoản

Mindset sử dụng `@payos/node` để tạo payment link/QR theo từng hóa đơn và nhận webhook từ payOS. Sau khi ngân hàng xác nhận giao dịch, webhook cập nhật đơn `pending` thành `paid`; POS kiểm tra trạng thái khoảng 1,2 giây/lần và tự hiện “Thanh toán thành công”.

Environment variables:
- `PAYOS_CLIENT_ID`
- `PAYOS_API_KEY`
- `PAYOS_CHECKSUM_KEY`
- `PUBLIC_BASE_URL` (production: `https://mindset-pos.onrender.com`)

Webhook endpoint:
`https://mindset-pos.onrender.com/api/payos/webhook`

Sau khi deploy và đặt đủ 3 key, admin/manager có thể gọi endpoint xác nhận webhook hoặc payOS có thể được đăng ký webhook bằng API/SDK.
