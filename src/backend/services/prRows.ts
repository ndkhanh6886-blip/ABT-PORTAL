/**
 * Đề xuất mua hàng (PR) được lưu trong bảng workflow_requests chung với "Quy trình phối hợp".
 * Một dòng là PR khi: mã PR…, loại PROCUREMENT / PURCHASE_REQUEST, hoặc phiếu phối hợp 1 bước gửi thẳng Cung Ứng
 * (quy trình nhiều bước khác — bảo trì, sửa chữa… — có 1 bước do Cung Ứng xử lý thì không phải PR).
 *
 * Cung ứng chỉ hiện các dòng này; Quy trình phối hợp KHÔNG hiện chúng (11/2026: mỗi ngày lên rất nhiều PR, để chung
 * với quy trình phối hợp làm rối — PR chỉ cần nằm ở Cung ứng cho người mua hàng xử lý).
 */
export const PR_ROW_SQL = `(
  workflow_code LIKE 'PR%' OR workflow_code ILIKE '%PR-%' OR workflow_type ILIKE '%PROCUREMENT%' OR workflow_type = 'PURCHASE_REQUEST'
  OR (target_dept ILIKE '%Cung%' AND jsonb_array_length(CASE WHEN jsonb_typeof(steps) = 'array' THEN steps ELSE '[]'::jsonb END) <= 1)
)`;

/** Điều kiện SQL: dòng KHÔNG phải PR (an toàn với giá trị NULL). */
export const NOT_PR_ROW_SQL = `NOT COALESCE(${PR_ROW_SQL}, false)`;
