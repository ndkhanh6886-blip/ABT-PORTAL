import { registerPermissions } from "../core/authz";

registerPermissions([
  { code: "master.data.view", description: "Xem danh mục chủ (vật tư, đối tác, kho)" },
  { code: "master.item.manage", description: "Tạo, sửa danh mục vật tư và đơn vị tính" },
  { code: "master.partner.manage", description: "Tạo, sửa nhà cung cấp, khách hàng, đơn vị gia công" },
  { code: "master.warehouse.manage", description: "Tạo, sửa kho và vị trí lưu trữ", bootstrapAdmin: true },
]);
