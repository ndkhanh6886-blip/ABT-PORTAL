#!/usr/bin/env bash
# Kiểm tra máy chủ TRƯỚC khi cài / cập nhật ABT Portal — CHỈ ĐỌC, không sửa gì, không in mật khẩu.
# Chạy trên máy chủ:  bash server-preflight.sh   (nên chạy bằng user quản trị có sudo để đọc được PostgreSQL / PM2)
# Kết quả: [OK] / [CẢNH BÁO] / [XUNG ĐỘT] cho từng điểm có thể đụng với phần mềm đang chạy.

APP_PORT=3008
APP_DIR_CI="/var/www/ABT-portal"        # thư mục mà .github/workflows/deploy.yml dùng
PM2_NAME="abt-portal"
DB_PORTAL="abt_portal"
DB_FACTORY="abt_factory"

ok()   { echo "  [OK]        $*"; }
warn() { echo "  [CẢNH BÁO]  $*"; }
bad()  { echo "  [XUNG ĐỘT]  $*"; }
h()    { echo; echo "== $* =="; }

h "1. Hệ điều hành, tài nguyên"
uname -a
free -h 2>/dev/null | sed 's/^/  /'
df -h / /var/www 2>/dev/null | sed 's/^/  /'
nproc 2>/dev/null | sed 's/^/  CPU: /'

h "2. Node.js (Next.js 16 cần Node >= 20.9)"
if command -v node >/dev/null; then
  v=$(node -v); echo "  node $v"
  major=${v#v}; major=${major%%.*}
  [ "$major" -ge 20 ] && ok "Node đủ phiên bản" || bad "Node quá cũ cho Next.js 16"
else bad "Chưa cài Node.js"; fi

h "3. Cổng $APP_PORT và các cổng web đang dùng"
listeners=$(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null)
echo "$listeners" | awk 'NR==1 || /LISTEN/' | sed 's/^/  /' | head -40
if echo "$listeners" | grep -qE "[:.]$APP_PORT\b"; then
  warn "Cổng $APP_PORT đang có tiến trình nghe — xem ở trên: nếu KHÔNG phải ABT Portal ($PM2_NAME) thì là XUNG ĐỘT, phải đổi cổng"
else ok "Cổng $APP_PORT còn trống"; fi

h "4. PM2 (tiến trình đang chạy)"
if command -v pm2 >/dev/null; then
  pm2 jlist 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const p of JSON.parse(s)){
      const e=p.pm2_env||{};console.log("  "+[p.name,e.status,"cwd="+(e.pm_cwd||""),"PORT="+((e.env||{}).PORT||"")].join("  |  "))}}catch{console.log("  (không đọc được pm2 jlist)")}})'
  pm2 jlist 2>/dev/null | grep -q "\"name\":\"$PM2_NAME\"" && warn "Đã có tiến trình PM2 tên $PM2_NAME — deploy sẽ khởi động lại đúng tiến trình này; kiểm tra cwd đúng $APP_DIR_CI" || ok "Chưa có tiến trình PM2 $PM2_NAME (cài mới)"
else warn "Không có pm2 (hoặc chạy bằng user khác) — deploy.yml cần pm2"; fi

h "5. Docker (nếu có, xem container có chiếm cổng / PostgreSQL)"
command -v docker >/dev/null && docker ps --format '  {{.Names}}  |  {{.Image}}  |  {{.Ports}}' 2>/dev/null || echo "  (không có docker hoặc không có quyền)"

h "6. Thư mục mã nguồn"
for d in /var/www/*; do [ -d "$d" ] && echo "  $d  $( [ -d "$d/.git" ] && git -C "$d" remote get-url origin 2>/dev/null | sed -E 's#https://[^@]*@#https://#')"; done
[ -d "$APP_DIR_CI" ] && warn "$APP_DIR_CI đã tồn tại (git reset --hard của CI sẽ ghi đè thay đổi chưa commit trong đó)" || ok "$APP_DIR_CI chưa có (cài mới)"
[ -d /var/www/abt-portal ] && [ "/var/www/abt-portal" != "$APP_DIR_CI" ] && bad "Có /var/www/abt-portal (chữ thường) khác $APP_DIR_CI — tài liệu và CI đang lệch tên thư mục"

h "7. PostgreSQL (uuidv7() của nhà máy cần PostgreSQL >= 18)"
if command -v psql >/dev/null; then
  ver=$(sudo -n -u postgres psql -Atqc "SHOW server_version_num" 2>/dev/null)
  if [ -n "$ver" ]; then
    echo "  server_version_num=$ver"
    [ "$ver" -ge 180000 ] && ok "PostgreSQL 18+ (có uuidv7)" || bad "PostgreSQL < 18: migration nhà máy (uuidv7) sẽ lỗi — cần nâng cấp hoặc cụm PG18 riêng"
    echo "  Các CSDL hiện có:"
    sudo -n -u postgres psql -Atqc "SELECT datname || '  (' || pg_size_pretty(pg_database_size(datname)) || ')' FROM pg_database WHERE NOT datistemplate ORDER BY 1" 2>/dev/null | sed 's/^/    /'
    for db in "$DB_PORTAL" "$DB_FACTORY"; do
      sudo -n -u postgres psql -Atqc "SELECT 1 FROM pg_database WHERE datname='$db'" 2>/dev/null | grep -q 1 \
        && warn "CSDL $db đã tồn tại — kiểm tra nó thuộc ABT Portal, KHÔNG phải phần mềm khác (OligoFlow…)" \
        || ok "CSDL $db chưa có (sẽ tạo mới)"
    done
    sudo -n -u postgres psql -Atqc "SELECT count(*) FROM pg_stat_activity" 2>/dev/null | sed 's/^/  Kết nối đang mở: /'
    sudo -n -u postgres psql -Atqc "SHOW max_connections" 2>/dev/null | sed 's/^/  max_connections: /'
  else warn "Không đọc được PostgreSQL bằng sudo -u postgres (chạy lại với sudo)"; fi
else warn "Không có psql trên máy (PostgreSQL ở Docker / máy khác?)"; fi

h "8. Web server / tên miền"
command -v nginx >/dev/null && { echo "  nginx: $(nginx -v 2>&1)"; grep -rhoE "server_name[^;]+" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | sort -u | sed 's/^/    /'; grep -rlE "proxy_pass\s+http://(127\.0\.0\.1|localhost):$APP_PORT" /etc/nginx 2>/dev/null | sed "s/^/    proxy tới $APP_PORT: /"; } || echo "  (không có nginx trên host)"
command -v cloudflared >/dev/null && { echo "  cloudflared: $(cloudflared --version 2>&1 | head -1)"; ls /etc/cloudflared 2>/dev/null | sed 's/^/    /'; grep -rhE "hostname|service" /etc/cloudflared/*.yml ~/.cloudflared/*.yml 2>/dev/null | sed 's/^/    /'; } || echo "  (không có cloudflared)"

h "9. GitHub Actions self-hosted runner"
ls -d /home/*/actions-runner* /opt/actions-runner* 2>/dev/null | sed 's/^/  /' || true
systemctl list-units --type=service 2>/dev/null | grep -i "actions.runner" | sed 's/^/  /' || true

echo
echo "Xong. Gửi lại toàn bộ kết quả này (không chứa mật khẩu) để đối chiếu trước khi deploy."
