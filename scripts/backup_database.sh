#!/bin/bash
# ==============================================================================
# Script tự động sao lưu Cơ sở dữ liệu PostgreSQL cho TBR Portal Enterprise
# Thiết lập chạy tự động hàng ngày qua Linux Crontab: 0 2 * * * /app/scripts/backup_database.sh
# ==============================================================================
set -euo pipefail

BACKUP_DIR="/var/backups/tbrs_portal"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/tbrs_portal_backup_${DATE}.sql.gz"
CONTAINER_NAME="tbrs_postgres_db"
DB_USER="postgres"
DB_NAME="tbrs_portal"
RETENTION_DAYS=30

mkdir -p ${BACKUP_DIR}

echo "[$(date)] Bắt đầu sao lưu cơ sở dữ liệu TBR Portal..."

# Dump database từ Docker container và nén gzip
docker exec ${CONTAINER_NAME} pg_dump -U ${DB_USER} -d ${DB_NAME} | gzip > ${BACKUP_FILE}

if [ $? -eq 0 ]; then
  echo "[$(date)] Sao lưu thành công: ${BACKUP_FILE} (Dung lượng: $(du -h ${BACKUP_FILE} | cut -f1))"
else
  echo "[$(date)] LỖI: Sao lưu thất bại!" >&2
  exit 1
fi

# Xóa các bản sao lưu cũ hơn 30 ngày để tiết kiệm dung lượng đĩa
echo "[$(date)] Đang dọn dẹp các bản sao lưu cũ hơn ${RETENTION_DAYS} ngày..."
find ${BACKUP_DIR} -name "tbrs_portal_backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

echo "[$(date)] Hoàn tất chu trình sao lưu tự động!"
