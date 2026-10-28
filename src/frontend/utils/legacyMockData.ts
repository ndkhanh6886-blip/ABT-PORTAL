/** Mã phiếu Application / yêu cầu phối hợp mà các bản cũ tạo sẵn làm dữ liệu mẫu */
const LEGACY_DEMO_IDS = new Set([
  "APP-TSK-001", "APP-TSK-002", "APP-TSK-003", "APP-TSK-004",
  "REQ-APP-001", "REQ-APP-002", "REQ-APP-003", "REQ-APP-004",
]);

/** Số lô / số máy chỉ có trong dữ liệu mẫu cũ */
const LEGACY_DEMO_LOTS = ["lot-covid-fam-99", "sn-via-abi-003", "sn-tbr-abi-003", "service-setup", "sn-abi-7500-202601"];

/**
 * Dòng dữ liệu mẫu do bản cũ tạo sẵn (không phải dữ liệu thật).
 * Chỉ nhận diện theo mã mẫu / số lô mẫu: trước đây còn so theo tiêu đề ("abi 7500", "bảo trì định kỳ & hiệu chuẩn"...)
 * nên công việc THẬT có tiêu đề tương tự bị ẩn mất. Dùng chung cho Application và Kinh doanh.
 */
export const isLegacyMockAppTask = (item: any): boolean => {
  if (!item) return false;
  const id = String(item.id || "").toUpperCase();
  if (LEGACY_DEMO_IDS.has(id)) return true;
  const lot = String(item.productLot || "").toLowerCase();
  const desc = String(item.desc || item.description || "").toLowerCase();
  return LEGACY_DEMO_LOTS.some(code => lot.includes(code) || desc.includes(code));
};
