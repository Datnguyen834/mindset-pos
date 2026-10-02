# Mindset Cafe POS

POS cho quán cà phê Mindset, thiết kế theo giao diện tham chiếu.

## Đã cập nhật
- Giao diện POS full-screen, responsive theo màn hình desktop/laptop.
- Ảnh sản phẩm mẫu nằm riêng tại `public/assets/menu/`.
- Nhân viên không còn nút Bắt đầu ca / Kết ca.
- Chọn **Tiền mặt / Chuyển khoản** ngay trên khu vực đơn hàng, phía trên nút Thanh toán.
- Bấm vào sản phẩm để chọn **topping + % đường + % đá** trước khi thêm vào đơn.
- Có thể bấm **Tùy chỉnh** trên món trong giỏ để sửa lại topping, đường, đá.
- Hóa đơn lưu % đường và % đá.
- Admin xem doanh thu theo khoảng ngày và theo nhân viên.
- QR chuyển khoản do Admin upload và hiện cho nhân viên khi thanh toán chuyển khoản.

## Tài khoản demo
- Admin: `admin / admin123`
- Nhân viên: `nhanvien / 123456`

## Chạy local
```bash
npm install
npm start
```

Cần PostgreSQL và biến môi trường `DATABASE_URL`.

## GitHub
```bash
git add .
git commit -m "Update Mindset POS UI and product customization"
git push
```

## Render
- Web Service: `npm install` / `npm start`
- PostgreSQL: tạo database Render và đặt `DATABASE_URL` vào Environment Variables.
- Đặt `JWT_SECRET` riêng trên Render.
