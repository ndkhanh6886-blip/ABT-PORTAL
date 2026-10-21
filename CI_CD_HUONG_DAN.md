# HƯỚNG DẪN THIẾT LẬP CI/CD TỰ ĐỘNG TRIỂN KHAI (GITHUB ACTIONS)

Dự án đã được tích hợp sẵn quy trình CI/CD tự động trong file `.github/workflows/deploy.yml`.

---

## 1. Cơ chế hoạt động
- Mỗi khi có code mới được `git push` lên nhánh `main`:
  1. **Bước 1 (CI):** GitHub Actions tự động dựng môi trường Node.js 20, chạy `npm ci` và `npm run build` để kiểm tra toàn bộ mã nguồn. Nếu có lỗi biên dịch, hệ thống sẽ dừng lại và gửi thông báo đỏ.
  2. **Bước 2 (CD):** Nếu bước 1 thành công, GitHub Actions sẽ mở kết nối SSH an toàn vào máy chủ VPS của bạn, tự động thực hiện:
     - `git fetch origin main && git reset --hard origin/main` (kéo mã mới nhất)
     - `docker compose up -d --build` (tự động build container mới và reload dịch vụ mà không gián đoạn)

---

## 2. Các thông số cần cấu hình trên GitHub (Chỉ cần làm 1 lần)

Truy cập vào trang GitHub Repository của bạn:
👉 **Settings** -> **Secrets and variables** -> **Actions** -> Bấm nút **New repository secret** và thêm các biến sau:

| Tên Secret | Bắt buộc? | Mô tả / Giá trị mẫu |
| :--- | :---: | :--- |
| `SERVER_HOST` | **Có** | Địa chỉ IP máy chủ của bạn (Ví dụ: `103.20.100.50`) |
| `SERVER_USER` | **Có** | Tài khoản đăng nhập máy chủ (Ví dụ: `root` hoặc `ubuntu`) |
| `SERVER_SSH_KEY` | **Có** | Khóa SSH Private Key (`id_rsa` hoặc `id_ed25519`) của máy tính/server để truy cập không cần mật khẩu. |
| `SERVER_PORT` | Không | Cổng SSH (Mặc định là `22`) |
| `SERVER_PROJECT_PATH` | Không | Đường dẫn thư mục dự án trên máy chủ (Mặc định: `/var/www/tbr-portal` đối với TBR, hoặc `/var/www/via-portal` đối với VIA) |

---

## 3. Chuẩn bị lần đầu trên máy chủ (VPS)

Trước khi kích hoạt CI/CD lần đầu, trên máy chủ VPS anh chỉ cần chạy các lệnh sau một lần duy nhất:

```bash
# 1. Tạo thư mục chứa dự án
sudo mkdir -p /var/www/tbr-portal
sudo chown -R $USER:$USER /var/www/tbr-portal

# 2. Clone mã nguồn về lần đầu
git clone https://github.com/ndkhanh6886-blip/TBR-portal.git /var/www/tbr-portal
cd /var/www/tbr-portal

# 3. Tạo file cấu hình môi trường bảo mật trên server
cp .env.production.example .env.local
nano .env.local  # Điền mật khẩu database thực tế và JWT secret

# 4. Khởi chạy hệ thống lần đầu
docker compose up -d --build
```

Từ thời điểm này trở đi, bất kỳ khi nào bạn chạy `git push origin main` từ máy tính cục bộ, **GitHub Actions sẽ tự động làm toàn bộ phần còn lại!**
