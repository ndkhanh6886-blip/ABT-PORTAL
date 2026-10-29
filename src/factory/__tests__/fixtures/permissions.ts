import { registerPermissions } from "../../core/authz";

// Permissions used only by the core tests' fixture state machine.
registerPermissions([
  { code: "test.doc.submit", description: "Gửi tài liệu thử" },
  { code: "test.doc.approve", description: "Duyệt tài liệu thử", gxpCritical: true },
  { code: "test.doc.cancel", description: "Hủy tài liệu thử" },
]);
