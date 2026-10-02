# Mindset Cafe POS

POS web app cho quán cà phê Mindset, gồm **Admin** và **Nhân viên**.

## Tính năng
- Đăng nhập phân quyền admin/staff.
- Admin: quản lý tài khoản, cấp/hạ quyền admin, quản lý menu + upload ảnh, quản lý topping, upload QR chuyển khoản, xem doanh thu ngày/tháng và doanh thu theo nhân viên/ca.
- Nhân viên: menu, chọn món, topping, giỏ hàng, tiền mặt/chuyển khoản, QR chuyển khoản, tạo hóa đơn, in hóa đơn, clock-in/out.
- PostgreSQL lưu dữ liệu lâu dài, phù hợp Render.
- UI bám theo screenshot Mindset đã cung cấp.

## Chạy local
1. Cài Node.js 20+ và PostgreSQL.
2. Tạo database `mindset_pos`.
3. Copy `.env.example` thành `.env` và sửa `DATABASE_URL` + `JWT_SECRET`.
4. `npm install`
5. `npm start`
6. Mở `http://localhost:10000`

Nếu database đang trống, app tự tạo tài khoản demo:
- Admin: `admin` / `admin123`
- Nhân viên: `nhanvien` / `123456`

**Hãy đổi mật khẩu sau khi đăng nhập thật.**

## Deploy Render
1. Push toàn bộ thư mục này lên GitHub.
2. Tạo một PostgreSQL database trên Render.
3. Tạo Web Service từ repo GitHub.
4. Build command: `npm ci`
5. Start command: `npm start`
6. Environment variables:
   - `DATABASE_URL`: Internal Database URL của PostgreSQL Render
   - `JWT_SECRET`: chuỗi bí mật dài
   - `NODE_ENV=production`
7. Deploy.

`render.yaml` đã có sẵn cấu hình web service; nếu Render yêu cầu chọn plan khác, chọn plan phù hợp tài khoản của bạn.

### Lưu ý upload ảnh/QR
Ảnh được lưu trực tiếp trong PostgreSQL dưới dạng data URL nên không phụ thuộc filesystem của Render. Vì vậy restart/redeploy không làm mất ảnh. Với dữ liệu lớn, có thể chuyển sang Cloudinary/S3 sau này.
