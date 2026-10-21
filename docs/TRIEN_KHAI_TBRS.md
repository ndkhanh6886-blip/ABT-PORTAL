# Triển khai TBRs Portal (Công ty TNHH Khoa học TBR)

TBRs là bản sao phần mềm TBR Portal cho **Công ty TNHH Khoa học TBR** (MST 1102031182), chạy độc lập với TBR và VIA trên cùng máy chủ:

| | TBR | VIA | **TBRs** |
|---|---|---|---|
| Cổng | 3005 | 3006 | **3007** |
| Cơ sở dữ liệu | tbr_portal | via_portal | **tbrs_portal** |
| Thư mục máy chủ | /var/www/tbr-portal | /var/www/via-portal | **/var/www/tbrs-portal** |
| Tên tiến trình PM2 | tbr-portal | via-portal | **tbrs-portal** |
| Cookie đăng nhập | tbr_session | — | **tbrs_session** |

Dữ liệu ban đầu trống: chỉ có tài khoản `admin`, mật khẩu mặc định `123456`, bắt buộc đổi ở lần đăng nhập đầu.

## 1. Tạo repo GitHub (làm một lần)

1. Trên GitHub tạo repo **private, trống** (không README) tên `TBRs-Portal`.
2. Gửi link repo cho người phụ trách để đẩy mã nguồn lên.

## 2. Chuẩn bị máy chủ (làm một lần, chạy bằng tài khoản quản trị máy chủ)

```bash
# 2.1 Cơ sở dữ liệu: tạo DB trống với đầy đủ cấu trúc bảng (KHÔNG có dữ liệu)
sudo -u postgres createdb tbrs_portal
# Cách khuyên dùng: lấy cấu trúc mới nhất từ TBR đang chạy (chỉ cấu trúc, không chép dữ liệu)
sudo -u postgres pg_dump -s --no-owner --no-privileges tbr_portal | sudo -u postgres psql -q -d tbrs_portal
# (Nếu không có DB TBR trên máy này: dùng file đi kèm repo)
# sudo -u postgres psql -q -d tbrs_portal -f /var/www/tbrs-portal/scripts/tbrs_schema_init.sql

# 2.2 Mã nguồn
sudo git clone https://github.com/<tài-khoản>/TBRs-Portal.git /var/www/tbrs-portal
cd /var/www/tbrs-portal

# 2.3 Biến môi trường (KHÔNG chép SESSION_SECRET của TBR / VIA)
cat > .env.local <<EOF
PORT=3007
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=<mật khẩu postgres của máy chủ>
PGDATABASE=tbrs_portal
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
NEXT_PUBLIC_APP_URL=https://<tên miền của TBRs>
EOF

# 2.4 Build & chạy
npm ci
npm run build
pm2 start npm --name "tbrs-portal" -- start
pm2 save
curl -s http://127.0.0.1:3007/api/health   # phải thấy "service":"TBRs Portal" và database healthy
```

## 3. Tên miền (Cloudflare Tunnel)

Cloudflare Zero Trust → Networks → Tunnels → tunnel đang dùng → **Public Hostname → Add**:
tên miền con cho TBRs (ví dụ `tbrs.<tên miền>`) → Service `http://localhost:3007`.
Không cần khởi động lại cloudflared.

## 4. Tự động deploy khi push lên `main`

File `.github/workflows/deploy.yml` đã cấu hình sẵn cho TBRs (chỉ khởi động lại tiến trình `tbrs-portal`,
không đụng TBR / VIA, không khởi động lại Cloudflare Tunnel).
Cần đăng ký **self-hosted runner** cho repo `TBRs-Portal`:
GitHub → repo → Settings → Actions → Runners → **New self-hosted runner** → Linux → chạy các lệnh GitHub hiển thị
trên máy chủ (đặt runner thành service: `sudo ./svc.sh install && sudo ./svc.sh start`).

## 5. Sau khi chạy

1. Đăng nhập `admin` / `123456` → đổi mật khẩu ngay.
2. Cấu hình → thông tin công ty (đã điền sẵn tên, MST, địa chỉ, email, điện thoại của TBR Scientific — kiểm tra lại).
3. Cấu hình → Tài chính → phương thức thanh toán (ngân hàng của TBRs).
4. Nhập nhân sự / tài khoản, khách hàng, sản phẩm, nhà cung cấp.
