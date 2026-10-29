# Kiến trúc nền tảng Nhà máy trong ABT Portal

> Đặc tả nghiệp vụ gốc: [01-mo-hinh-du-lieu.md](01-mo-hinh-du-lieu.md), [02-may-trang-thai.md](02-may-trang-thai.md).
> Tài liệu này ghi các **quyết định đã chốt** và mọi chỗ **khác** với đặc tả gốc, kèm lý do.
> Các mục D1–D13 và cơ chế giao thẳng trong bản đề xuất trước vẫn giữ nguyên (mục 6, 7 bên dưới).

## 1. Quyết định đã chốt (29/10/2026)

| # | Quyết định |
|---|---|
| Q1 | Bảng giá bán cho khách cuối do **Kinh doanh** quyết định, nằm trong ABT Portal. Nhà máy chỉ giữ giá chuyển giao |
| Q2 | Mã nguồn nằm **trong `abt-portal`**, không dùng lại mã của ABT-biolab |
| Q3 | Đăng nhập chung bằng tài khoản ABT Portal |
| Q4 | Một PostgreSQL, hai database: `abt_portal` (đang có) và `abt_factory` (mới) |
| Q5 | Ngưỡng tiền cần BGĐ duyệt PR và dung sai nhận hàng vượt PO là **tham số cấu hình** (`core.setting`) |
| Q6 | Mẫu mã số mới, cấp từ bộ đếm phía server, không trùng khi tạo đồng thời (mục 5) |
| Q7 | Chỉ tham khảo **công thức tính thông số Oligo** của OligoFlow cũ (MW, ε260, nmol/OD, µg/OD, Tm) để kết quả thống nhất |

## 2. Điều chỉnh công nghệ so với prompt gốc

Prompt gốc chọn Python/FastAPI + Vite. Vì mã nguồn phải nằm trong ABT Portal (Q2), nền tảng dùng
stack của ABT Portal nhưng giữ nguyên **mọi nguyên tắc** của prompt.

| Prompt gốc | Thay bằng | Giữ nguyên nguyên tắc |
|---|---|---|
| FastAPI + SQLAlchemy | Route handler Next.js mỏng + tầng service TypeScript thuần + `pg` | Logic nghiệp vụ chỉ ở service, có unit test; route chỉ xác thực, parse, gọi service |
| Pydantic | Zod (schema dùng chung server/client) | Kiểm tra mọi input ở server |
| Alembic | Thư mục `src/factory/db/migrations/*.sql` + trình chạy có khóa advisory và checksum | Mọi thay đổi schema qua migration; migration đã chạy không được sửa |
| Celery/RQ + Redis | Bảng `core.job` + tiến trình worker riêng (`FOR UPDATE SKIP LOCKED`) | Tác vụ nền tách khỏi request |
| MinIO | Giao diện `FileStore`, driver ổ đĩa cục bộ trước, driver S3/MinIO sau | CSDL chỉ lưu metadata + SHA-256 |
| OIDC/JWT riêng | Phiên đăng nhập ABT Portal (Q3); phân quyền nhà máy riêng trong `abt_factory.core` | RBAC = vai trò × hành động × phòng ban; kiểm tra ở mọi endpoint |
| testcontainers | Database `abt_factory_test` trên PostgreSQL cục bộ, migrate lại mỗi lần chạy | Integration test chạy trên PostgreSQL thật |
| argon2 | scrypt (cùng thư viện băm ABT Portal đang dùng) cho PIN chữ ký | Băm có salt, so sánh hằng thời gian |
| MUI/shadcn | Tailwind sẵn có + bộ component dùng chung của nhà máy; TanStack Query lấy dữ liệu | Giao diện thống nhất, dữ liệu luôn từ server |

## 3. Bố cục mã nguồn

```
src/factory/                     # Backend nhà máy — không import gì từ src/frontend
  core/                          # db, lỗi, máy trạng thái, mã số, audit, chữ ký, quyền, idempotency, outbox, file
  master/ inv/ purchase/ intake/ qms/ work/ asset/ rd/ mfg/ oligo/ device/
    <module>/schemas.ts          # Zod
    <module>/machines.ts         # Bảng chuyển trạng thái khai báo
    <module>/service.ts          # Nghiệp vụ (có thể tách nhiều file, mỗi file ≤ ~500 dòng)
    <module>/__tests__/
  db/migrations/NNNN_ten.sql
src/app/api/factory/<module>/…   # Route handler mỏng
src/frontend/factory/<feature>/  # Mỗi tab/màn hình một component
scripts/factory-migrate.ts       # Chạy migration
scripts/factory-worker.ts        # Worker tác vụ nền + outbox
scripts/factory-seed-dev.ts      # Dữ liệu mẫu, chỉ chạy tay ở dev
```

- Module chỉ truy cập schema của mình; gọi module khác qua hàm service được export.
- Khóa ngoại liên schema chỉ tới `core`, `master`, `inv` (như đặc tả 01).
- Thời gian: `timestamptz`, lưu UTC, hiển thị Asia/Ho_Chi_Minh. Số lượng `numeric(18,6)`, tiền `numeric(18,2)` + `currency`.
- Khóa chính `uuid` sinh bằng `uuidv7()` của PostgreSQL 18.

## 4. Tích hợp với phần Kinh doanh của ABT Portal

- Hai database nên không có transaction chung. Mỗi bên có bảng outbox; worker gửi sự kiện cho
  bên kia qua hàm service, bên nhận xử lý **idempotent** theo `event_id`. Gửi lại tới khi thành công.
- Sự kiện: `KdPoIssued`, `KdPoCancelled`, `FactoryOrderAccepted/Rejected/Progress`,
  `FactoryShipmentPosted`, `KdShipmentAcknowledged`.
- Người dùng: `user_id` trong `abt_factory` là `users.id` của ABT Portal. Họ tên chụp lại (snapshot)
  vào audit và chữ ký tại thời điểm thực hiện.

## 5. Mã số

Bộ đếm `core.number_counter(sequence_key, period_key, last_value)`. Cấp số bằng một câu lệnh
`INSERT … ON CONFLICT (sequence_key, period_key) DO UPDATE SET last_value = last_value + 1 RETURNING`
trong cùng transaction với bản ghi được tạo:
- Hai người tạo cùng lúc → PostgreSQL khóa dòng bộ đếm, người sau nhận số kế tiếp, **không trùng**.
- Transaction lỗi → số chưa từng được dùng nên được cấp lại; số đã commit không bao giờ tái sử dụng.
- Cột `code` luôn có `UNIQUE` làm chốt chặn cuối.
- Kỳ reset (năm/tháng/ngày/không) suy ra từ mẫu, không cần job reset.

| Khóa | Mẫu mặc định | Ví dụ |
|---|---|---|
| Đơn nội bộ | `DN{YY}{MM}-{NNNN}` | DN2610-0001 |
| Đề nghị mua NVL | `PR{YY}{MM}-{NNNN}` | PR2610-0012 |
| Đơn mua NVL | `PM{YY}{MM}-{NNNN}` | PM2610-0005 |
| Phiếu nhận hàng | `GR{YY}{MM}-{NNNN}` | GR2610-0007 |
| Phiếu kho (nhập/xuất/chuyển/điều chỉnh) | `NK/XK/CK/DC{YY}{MM}-{NNNN}` | XK2610-0103 |
| Lô NVL nhận | `R{YY}{MM}{DD}{NN}` | R26102901 |
| Lô Kit thành phẩm | `K{YY}{MM}{NNN}` | K2610001 |
| Lô hóa chất pha | `P{YY}{MM}{NNN}` | P2610004 |
| Trình tự Oligo | `O{YY}{MM}{NNNNN}` | O261000123 |
| Mẻ tổng hợp | `SB{YY}{MM}{DD}-{NN}` | SB261029-02 |
| Serial thiết bị | `{MODEL}-{YY}{NNNN}` (đếm theo model) | QPCR48-260031 |
| Sai lệch / NCR / CAPA / CR | `DEV/NCR/CAPA/CR{YY}-{NNNN}` | NCR26-0042 |
| Phiếu giao | `GH{YY}{MM}-{NNNN}` | GH2610-0009 |

Tiền tố không trùng với mã chứng từ của phần Kinh doanh. Mẫu sửa được trong Cấu hình; mẫu mới chỉ áp dụng cho số cấp sau đó.

## 6. Những lỗi của ABT-biolab không được lặp lại

| Lỗi đã thấy ở hệ cũ | Cách nền tảng mới chặn |
|---|---|
| File nghiệp vụ ~15.000 dòng (`oligoflow_portal/app.py`) | Giới hạn ~500 dòng/file; module theo miền |
| Dữ liệu nằm trong file JSON / SQLite / Excel (R&D Hub, `oligoflow.db`, Price Catalog) | Mọi dữ liệu nghiệp vụ trong `abt_factory` |
| Hàng chục script `fix_*`, `cleanup_*`, `delete_*` sửa CSDL bằng tay | Chỉ migration + chứng từ đảo có lý do; không sửa dữ liệu ngoài service |
| Dữ liệu demo lẫn vào dữ liệu thật (`delete_mock_inventory`, `fix_demo_*`) | Dữ liệu mẫu chỉ trong `factory-seed-dev.ts`, từ chối chạy ở production |
| Mỗi phòng một hệ, một CSDL, một đăng nhập, phải đồng bộ chéo (`sync_factory_orders_to_so.py`) | Một database, một phiên đăng nhập, sự kiện outbox có xác nhận |
| Mật khẩu mặc định trong `docker-compose.yml` | Bí mật chỉ qua biến môi trường; thiếu thì không khởi động ở production |
| Tồn kho sửa trực tiếp, phải "backfill" giao dịch | Sổ cái chỉ ghi thêm; tồn = tổng sổ cái; job đêm đối chiếu |

## 7. Cơ chế giao thẳng và các điều chỉnh mô hình dữ liệu

Giữ nguyên như bản đề xuất bước 1: D1 (`intake.internal_order`), D2 (chỉ giá chuyển giao),
D3 (không hóa đơn nội bộ), D4–D5 (phiếu giao có `ship_mode`, biên bản), D6–D7 (R&D phần mềm; dự án
thiết bị thuộc KT-CN), D8 (phân bổ nhân sự), D9–D10 (quyền kho theo phòng, chuyển kho có duyệt),
D11 (PR theo phòng → hộp Cung ứng NVL), D12 (partner nội bộ "ABT – Khối Kinh doanh"),
D13 (`kd_item_code`), cùng máy trạng thái `internal_order`, `delivery_note` mới.

## 8. Lộ trình

| Giai đoạn | Nội dung |
|---|---|
| 2a | Hạ tầng: database, migration, test; lõi mã số, máy trạng thái, audit, chữ ký, quyền, idempotency, outbox |
| 2b | Master data, kho–lô–sổ cái, phân bổ FEFO/FIFO, file, thông báo, khung giao diện tab nhà máy |
| 3 | QMS, Cung ứng NVL, đơn nội bộ + tích hợp Kinh doanh (PO nội bộ, Kho KD vào tab KD, giao thẳng) |
| 4 | Oligo → SX Kit → KT-CN → R&D |
| 5 | Báo cáo, in nhãn/COA, Excel, migrate dữ liệu cũ |
