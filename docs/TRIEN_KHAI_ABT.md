# Triển khai ABT Portal (Công ty TNHH Giải pháp Y sinh ABT)

ABT Portal là bản sao phần mềm TBRs Portal dành cho **Công ty TNHH Giải pháp Y sinh ABT** (MST 0315562387),
chạy độc lập với các bản TBR / VIA / TBRs trên cùng máy chủ:

| | TBR | VIA | TBRs | **ABT** |
|---|---|---|---|---|
| Cổng | 3005 | 3006 | 3007 | **3008** |
| Cơ sở dữ liệu | tbr_portal | via_portal | tbrs_portal | **abt_portal** |
| Thư mục máy chủ | /var/www/TBR-portal | /var/www/via-portal | /var/www/TBRs-portal | **/var/www/ABT-portal** |
| Tên tiến trình PM2 | tbr-portal | via-portal | tbrs-portal | **abt-portal** |
| Cookie đăng nhập | tbr_session | — | tbrs_session | **abt_session** |

Dữ liệu ban đầu trống. Lần chạy đầu tạo tài khoản `admin` với mật khẩu lấy từ biến `INITIAL_ADMIN_PASSWORD`
(nếu không đặt, mật khẩu tạm ngẫu nhiên được in ra log khởi động); bắt buộc đổi ở lần đăng nhập đầu.

## 1. Tạo repo GitHub (làm một lần)

1. Trên GitHub tạo repo **private, trống** (không README) tên `ABT-portal`.
2. Gửi link repo cho người phụ trách để đẩy mã nguồn lên.

## 2. Chuẩn bị máy chủ (làm một lần, chạy bằng tài khoản quản trị máy chủ)

```bash
# 2.1 Cơ sở dữ liệu: tạo DB trống với đầy đủ cấu trúc bảng (KHÔNG có dữ liệu)
sudo -u postgres createdb abt_portal
# Cách khuyên dùng: lấy cấu trúc mới nhất từ TBRs đang chạy (chỉ cấu trúc, không chép dữ liệu)
sudo -u postgres pg_dump -s --no-owner --no-privileges tbrs_portal | sudo -u postgres psql -q -d abt_portal
# (Nếu không có DB TBRs trên máy này: dùng file đi kèm repo)
# sudo -u postgres psql -q -d abt_portal -f /var/www/ABT-portal/scripts/abt_schema_init.sql

# 2.2 Mã nguồn
sudo git clone https://github.com/ndkhanh6886-blip/ABT-portal.git /var/www/abt-portal
cd /var/www/abt-portal

# 2.3 Biến môi trường (KHÔNG chép SESSION_SECRET của TBR / VIA / TBRs)
cat > .env.local <<EOF
PORT=3008
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=<mật khẩu postgres của máy chủ>
PGDATABASE=abt_portal
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
NEXT_PUBLIC_APP_URL=https://<tên miền của ABT>
EOF

# 2.4 Build & chạy
npm ci
npm run build
pm2 start npm --name "abt-portal" -- start
pm2 save
curl -s http://127.0.0.1:3008/api/health   # phải thấy "service":"ABT Portal" và database healthy
```

## 3. Tên miền (Cloudflare Tunnel)

Cloudflare Zero Trust → Networks → Tunnels → tunnel đang dùng → **Public Hostname → Add**:
tên miền con cho ABT (ví dụ `abt.<tên miền>`) → Service `http://localhost:3008`.
Không cần khởi động lại cloudflared.

## 4. Tự động deploy khi push lên `main`

File `.github/workflows/deploy.yml` đã cấu hình sẵn cho ABT (chỉ khởi động lại tiến trình `abt-portal`,
không đụng TBR / VIA / TBRs, không khởi động lại Cloudflare Tunnel).
Cần đăng ký **self-hosted runner** cho repo `ABT-portal`:
GitHub → repo → Settings → Actions → Runners → **New self-hosted runner** → Linux → chạy các lệnh GitHub hiển thị
trên máy chủ (đặt runner thành service: `sudo ./svc.sh install && sudo ./svc.sh start`).

## 5. Sau khi chạy

1. Đăng nhập `admin` bằng mật khẩu tạm (`INITIAL_ADMIN_PASSWORD` hoặc mật khẩu in trong log) → đổi mật khẩu ngay.
2. Cấu hình → thông tin công ty (đã điền sẵn tên, MST, địa chỉ, email, điện thoại của ABT — kiểm tra lại).
3. Cấu hình → Tài chính → phương thức thanh toán (ngân hàng của ABT).
4. Nhập nhân sự / tài khoản, khách hàng, sản phẩm, nhà cung cấp.
