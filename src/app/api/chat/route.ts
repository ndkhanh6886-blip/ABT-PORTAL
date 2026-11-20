import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/backend/services/apiErrors";
import { query, logAudit, withTransaction, HttpError, httpErrorStatus } from "@/backend/db/db";
import { getAuthorizedUser, unauthorizedResponse, setAuditActor } from "@/backend/services/authz";
import { normalizePersonText, personNameKey } from "@/backend/services/utils";
import { getFactoryPool } from "@/factory/core/db";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";

const MAX_CHAT_ATTACHMENTS_PER_MESSAGE = 5;
const CHAT_UPLOAD_DIR = path.join(process.cwd(), "uploads");

function getServerAttachmentContentKey(att: any): string {
  if (!att || typeof att !== "object") return "";
  if (att.sha256) return `sha256:${String(att.sha256).toLowerCase().slice(0, 32)}`;
  const urlStr = String(att.url || "");
  const m = urlStr.match(/sha256_([a-f0-9]{16,64})/i);
  if (m) return `sha256:${m[1].toLowerCase().slice(0, 32)}`;
  if (urlStr.startsWith("/api/upload")) {
    try {
      const u = new URL(urlStr, "http://localhost");
      const f = u.searchParams.get("file");
      if (f) return `file:${f.toLowerCase()}`;
    } catch {}
  }
  return urlStr ? `url:${urlStr}` : "";
}

async function normalizeAndDedupeChatAttachments(rawAttachments: any): Promise<{
  cleanedAttachments: any[];
  contentKeys: string[];
}> {
  if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) {
    return { cleanedAttachments: [], contentKeys: [] };
  }
  const seenKeys = new Set<string>();
  const cleanedAttachments: any[] = [];
  const contentKeys: string[] = [];

  for (const raw of rawAttachments) {
    if (!raw || typeof raw !== "object" || !raw.url) continue;
    const att = { ...raw };
    const urlStr = String(att.url || "");

    // Nếu trình duyệt gửi chuỗi Base64 (data:...;base64,...), tự động chuyển sang tệp vật lý đánh địa chỉ theo SHA-256 trên ổ đĩa để không làm phình bảng chat_messages
    if (urlStr.startsWith("data:")) {
      const dataMatch = urlStr.match(/^data:([^;]+);base64,(.+)$/);
      if (dataMatch) {
        try {
          const mime = dataMatch[1] || "application/octet-stream";
          const buf = Buffer.from(dataMatch[2], "base64");
          const sha256Hex = crypto.createHash("sha256").update(buf).digest("hex");
          const rawExt = path.extname(String(att.name || "")).toLowerCase();
          const fallbackExt = mime.startsWith("image/") ? `.${mime.split("/")[1].replace(/[^a-z0-9]/gi, "") || "png"}` : ".bin";
          const ext = rawExt || fallbackExt;
          const uniqueName = `sha256_${sha256Hex.slice(0, 32)}${ext}`;
          if (!fs.existsSync(CHAT_UPLOAD_DIR)) {
            fs.mkdirSync(CHAT_UPLOAD_DIR, { recursive: true });
          }
          const filePath = path.join(CHAT_UPLOAD_DIR, uniqueName);
          if (!fs.existsSync(filePath)) {
            await fsp.writeFile(filePath, buf);
          }
          const origName = String(att.name || uniqueName);
          att.url = `/api/upload?file=${encodeURIComponent(uniqueName)}&name=${encodeURIComponent(origName)}`;
          att.sha256 = sha256Hex;
          att.size = att.size || buf.length;
        } catch {}
      }
    }

    const key = getServerAttachmentContentKey(att);
    if (key && seenKeys.has(key)) {
      // Bỏ qua tệp/hình ảnh trùng lặp trong cùng 1 lần gửi
      continue;
    }
    if (key) {
      seenKeys.add(key);
      contentKeys.push(key);
    }
    cleanedAttachments.push(att);
  }

  return { cleanedAttachments, contentKeys };
}

/**
 * Identity of the chat user comes from the server session. The browser used to send `user` /
 * `sender_name` itself, so anyone could post as somebody else or read other people's private chats.
 */
type ChatIdentity = {
  name: string;
  username: string;
  role: string;
  position: string;
  aliases: string[];
  aliasKeys: string[];
  isAdmin: boolean;
  isDeptManager: boolean;
  department: string;
  departments: string[];
};

function stripVn(input?: string | null): string {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9&/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDeptBuckets(rawText?: string | null): Set<string> {
  const s = stripVn(rawText);
  const buckets = new Set<string>();
  if (!s) return buckets;
  const words = s.split(/[\s/&]+/).filter(Boolean);

  if (
    s.includes("kinh doanh") ||
    s.includes("sales") ||
    s.includes("marketing") ||
    s.includes("truyen thong") ||
    s.includes("quan ly san pham") ||
    s.includes("cham soc khach hang") ||
    words.includes("pm") ||
    words.includes("cskh")
  ) {
    buckets.add("SALES");
  }

  if (s.includes("r&d") || s.includes("nghien cuu") || words.includes("rd")) {
    buckets.add("RD");
  }

  if (s.includes("oligo")) {
    buckets.add("OLIGO");
  }

  if (
    (s.includes("san xuat") || s.includes("sx kit") || words.includes("kit")) &&
    !s.includes("oligo")
  ) {
    buckets.add("KIT_PROD");
  }

  if (
    s.includes("ktcn") ||
    s.includes("ky thuat cong nghe") ||
    s.includes("ky thuat thiet bi") ||
    s.includes("thiet bi")
  ) {
    buckets.add("DEVICE_TECH");
  }

  if (
    words.includes("qa") ||
    words.includes("qc") ||
    s.includes("qa/qc") ||
    s.includes("qc/qa") ||
    s.includes("chat luong") ||
    s.includes("iso13485") ||
    s.includes("iso 13485")
  ) {
    buckets.add("QA_QC");
  }

  if (
    s.includes("application") ||
    s.includes("ung dung") ||
    words.includes("app") ||
    words.includes("lab")
  ) {
    buckets.add("APPLICATION");
  }

  if (
    s.includes("cung ung") ||
    s.includes("mua hang") ||
    s.includes("procurement") ||
    s.includes("purchasing") ||
    s.includes("thu mua") ||
    words.includes("xnk")
  ) {
    buckets.add("PROCUREMENT");
  }

  if (
    words.includes("kho") ||
    s.includes("kho van") ||
    s.includes("van hanh") ||
    s.includes("dieu van") ||
    s.includes("giao nhan") ||
    words.includes("warehouse")
  ) {
    buckets.add("WAREHOUSE");
  }

  if (
    s.includes("phong it") ||
    s.includes("cong nghe thong tin") ||
    words.includes("it") ||
    words.includes("cntt")
  ) {
    buckets.add("IT");
  }

  if (
    s.includes("hanh chinh") ||
    s.includes("hanh chanh") ||
    s.includes("nhan su") ||
    words.includes("hcns") ||
    words.includes("hr")
  ) {
    buckets.add("HR_ADMIN");
  }

  if (
    s.includes("ke toan") ||
    s.includes("tai chinh") ||
    s.includes("cong no") ||
    s.includes("thu quy")
  ) {
    buckets.add("ACCOUNTING");
  }

  if (
    s.includes("phap che") ||
    s.includes("ho so thau") ||
    words.includes("thau") ||
    words.includes("legal")
  ) {
    buckets.add("LEGAL");
  }

  if (buckets.size === 0 && s.includes("ky thuat")) {
    buckets.add("DEVICE_TECH");
  }

  return buckets;
}

function isCompanyWideChannel(c: any): boolean {
  if (!c || String(c.channel_type || "CHANNEL").toUpperCase() !== "CHANNEL") return false;
  const code = stripVn(c.channel_code);
  const name = stripVn(c.name);
  const dept = stripVn(c.department);
  if (code === "general") return true;
  if (["toan cong ty", "cong ty", "general", "thong bao chung", "toan the cong ty"].includes(name)) {
    return true;
  }
  const nameBuckets = extractDeptBuckets(c.name);
  if (nameBuckets.size === 0 && (dept === "toan cong ty" || dept === "cong ty")) {
    return true;
  }
  return false;
}

function getChannelDeptBuckets(c: any): Set<string> {
  if (!c) return new Set();
  const fromName = extractDeptBuckets(c.name);
  if (fromName.size > 0) return fromName;
  const combined = new Set<string>();
  for (const b of extractDeptBuckets(c.department)) combined.add(b);
  if (combined.size > 0) return combined;
  for (const b of extractDeptBuckets(c.channel_code)) combined.add(b);
  return combined;
}

function deptMatchesChannel(deptText: string, c: any): boolean {
  if (!deptText || !c) return false;
  const chBuckets = getChannelDeptBuckets(c);
  const userBuckets = extractDeptBuckets(deptText);
  if (chBuckets.size > 0 && userBuckets.size > 0) {
    for (const b of userBuckets) {
      if (chBuckets.has(b)) return true;
    }
    return false;
  }
  const dNorm = stripVn(deptText);
  const cDeptNorm = stripVn(c.department);
  const cNameNorm = stripVn(c.name);
  if (!dNorm) return false;
  return (Boolean(cDeptNorm) && dNorm === cDeptNorm) || (Boolean(cNameNorm) && dNorm === cNameNorm);
}

function userMatchesChannelDepartment(ident: ChatIdentity, c: any): boolean {
  if (!ident || !c) return false;
  for (const d of ident.departments) {
    if (deptMatchesChannel(d, c)) return true;
  }
  return false;
}

function parseChannelMembers(rawMembers: any): string[] {
  let arr: any[] = [];
  if (Array.isArray(rawMembers)) {
    arr = rawMembers;
  } else if (typeof rawMembers === "string" && rawMembers.trim()) {
    try {
      const parsed = JSON.parse(rawMembers);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = rawMembers
        .replace(/[{}]/g, "")
        .split(",")
        .map((s: string) => s.trim().replace(/^"|"$/g, ""));
    }
  }
  return arr.map((m) => String(m || "").trim()).filter(Boolean);
}

function userMatchesMemberList(ident: ChatIdentity, members: string[]): boolean {
  if (!members || members.length === 0) return false;
  for (const m of members) {
    const lower = m.toLowerCase();
    const key = stripVn(m);
    if (ident.aliases.includes(lower) || (key && ident.aliasKeys.includes(key))) {
      return true;
    }
  }
  return false;
}

function userIsChannelCreator(ident: ChatIdentity, c: any): boolean {
  const creator = String(c?.created_by || "").trim();
  if (!creator || stripVn(creator) === "he thong") return false;
  const lower = creator.toLowerCase();
  const key = stripVn(creator);
  return ident.aliases.includes(lower) || (Boolean(key) && ident.aliasKeys.includes(key));
}

function isChannelAdmin(ident: ChatIdentity, c: any): boolean {
  if (!ident || !c) return false;
  if (ident.isAdmin) return true;
  if (userIsChannelCreator(ident, c)) return true;
  if (String(c.channel_type || "CHANNEL").toUpperCase() === "CHANNEL") {
    if (ident.isDeptManager && userMatchesChannelDepartment(ident, c)) {
      return true;
    }
  }
  return false;
}

function canUserAccessChannelRow(ident: ChatIdentity, c: any): boolean {
  if (!ident || !c) return false;
  const members = parseChannelMembers(c.members);
  const type = String(c.channel_type || "CHANNEL").toUpperCase();
  const code = String(c.channel_code || "").toLowerCase();

  // 1. Direct Messages (1-1): strictly limited to the two participants
  if (type === "DIRECT" || code.startsWith("dm-")) {
    if (userMatchesMemberList(ident, members)) return true;
    if (userIsChannelCreator(ident, c)) return true;
    if (members.length === 0) {
      const nameLower = String(c.name || "").trim().toLowerCase();
      const nameKey = stripVn(c.name);
      if (ident.aliases.includes(nameLower) || (nameKey && ident.aliasKeys.includes(nameKey))) {
        return true;
      }
    }
    return false;
  }

  // 2. Department Channels (CHANNEL)
  if (type === "CHANNEL") {
    if (isCompanyWideChannel(c)) return true;
    if (userIsChannelCreator(ident, c)) return true;
    if (userMatchesMemberList(ident, members)) return true;
    if (c.is_private) return false;
    if (ident.isAdmin) return true;
    return userMatchesChannelDepartment(ident, c);
  }

  // 3. Group & Project Channels (GROUP / PROJECT)
  if (userIsChannelCreator(ident, c)) return true;
  if (userMatchesMemberList(ident, members)) return true;
  if (!c.is_private && ident.isAdmin) return true;
  return false;
}

async function getChatIdentity(req: NextRequest): Promise<ChatIdentity | null> {
  const me = await getAuthorizedUser(req);
  setAuditActor(me);
  if (!me) return null;
  const name = String(me.full_name || me.username).trim();
  const aliases = new Set<string>([name, me.username].map(s => String(s || "").trim().toLowerCase()).filter(Boolean));
  const depts = new Set<string>();
  if (me.department) depts.add(String(me.department).trim());
  let position = "";

  try {
    const p = await query(
      `SELECT employee_code, full_name, department, position FROM personnel
        WHERE LOWER(employee_code) = LOWER($1)
           OR LOWER(REGEXP_REPLACE(employee_code, '^NV-(ABT|TBRS|TBR|VIA)-?', '\\1', 'i')) = LOWER($1)
           OR LOWER(TRIM(full_name)) = LOWER(TRIM($2))
        LIMIT 1`,
      [me.username, name]
    );
    if (p.rows[0]) {
      if (p.rows[0].employee_code) aliases.add(String(p.rows[0].employee_code).trim().toLowerCase());
      if (p.rows[0].full_name) aliases.add(String(p.rows[0].full_name).trim().toLowerCase());
      if (p.rows[0].department) depts.add(String(p.rows[0].department).trim());
      if (p.rows[0].position) position = String(p.rows[0].position).trim();
    }
  } catch {}

  const roleLower = String(me.role || "").trim().toLowerCase();
  const posNorm = stripVn(position);
  const deptsArr = Array.from(depts).filter(Boolean);
  const isBod = deptsArr.some(d => {
    const dn = stripVn(d);
    return dn.includes("ban giam doc") || dn === "giam doc" || dn === "bod";
  });

  const isAdmin =
    me.username === "admin" ||
    roleLower === "admin" ||
    roleLower === "director" ||
    isBod ||
    posNorm.includes("giam doc") ||
    posNorm.includes("quan tri vien he thong");

  if (isAdmin) {
    aliases.add("admin");
    aliases.add("quản trị viên hệ thống");
  }

  const isDeptManager =
    isAdmin ||
    roleLower === "manager" ||
    roleLower === "leader" ||
    roleLower === "head" ||
    posNorm.includes("truong phong") ||
    posNorm.includes("pho phong") ||
    posNorm.includes("truong bo phan") ||
    posNorm.includes("quan ly");

  const aliasArr = Array.from(aliases);
  const aliasKeys = Array.from(new Set(aliasArr.map(a => stripVn(a)).filter(Boolean)));

  return {
    name,
    username: String(me.username || ""),
    role: String(me.role || ""),
    position,
    aliases: aliasArr,
    aliasKeys,
    isAdmin,
    isDeptManager,
    department: deptsArr[0] || me.department || "",
    departments: deptsArr
  };
}

/** Broad SQL pre-filter (final strict department & member filtering is enforced by canUserAccessChannelRow) */
function channelAccessSql(aliasParam: string) {
  return `(
    c.channel_type = 'CHANNEL'
    OR LOWER(TRIM(COALESCE(c.created_by, ''))) = ANY(${aliasParam})
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.members) = 'array' THEN c.members ELSE '[]'::jsonb END) mm
      WHERE LOWER(TRIM(mm)) = ANY(${aliasParam})
    )
    OR (c.channel_type = 'DIRECT'
        AND jsonb_array_length(CASE WHEN jsonb_typeof(c.members) = 'array' THEN c.members ELSE '[]'::jsonb END) = 0
        AND LOWER(TRIM(c.name)) = ANY(${aliasParam}))
  )`;
}

async function canAccessChannel(ident: ChatIdentity, channelId: any, channelCode?: any): Promise<number | null> {
  const numId = channelId && !isNaN(Number(channelId)) ? Number(channelId) : null;
  const cleanCode = channelCode ? String(channelCode).trim() : null;

  if (cleanCode) {
    const codeRes = await query(
      `SELECT c.* FROM chat_channels c
        WHERE c.channel_code = $1
        LIMIT 1`,
      [cleanCode]
    );
    if (codeRes.rows[0] && canUserAccessChannelRow(ident, codeRes.rows[0])) {
      return Number(codeRes.rows[0].id);
    }
  }

  if (numId !== null) {
    const idRes = await query(
      `SELECT c.* FROM chat_channels c
        WHERE c.id = $1::int
        LIMIT 1`,
      [numId]
    );
    if (idRes.rows[0]) {
      if (cleanCode && idRes.rows[0].channel_code && idRes.rows[0].channel_code !== cleanCode) {
        return null;
      }
      if (canUserAccessChannelRow(ident, idRes.rows[0])) {
        return Number(idRes.rows[0].id);
      }
    }
  }

  return null;
}

function chatForbidden() {
  return NextResponse.json({ error: "Bạn không phải thành viên của cuộc trò chuyện này." }, { status: 403 });
}

const DEFAULT_DEPARTMENT_CHANNELS = [
  {
    channel_code: "general",
    name: "toan-cong-ty",
    department: "Toàn công ty",
    description: "Kênh thảo luận, thông báo chung cho toàn thể cán bộ nhân viên"
  },
  {
    channel_code: "sales",
    name: "kinh-doanh",
    department: "Kinh Doanh",
    description: "Trao đổi chiến lược bán hàng, chăm sóc khách hàng, chào giá và cập nhật tiến độ deal"
  },
  {
    channel_code: "application",
    name: "application-lab",
    department: "Application",
    description: "Kênh phòng Kỹ thuật & Ứng dụng Lab"
  },
  {
    channel_code: "warehouse",
    name: "kho-van-hanh",
    department: "Kho & Vận Hành",
    description: "Kênh phòng Kho vận & Điều vận"
  },
  {
    channel_code: "procurement",
    name: "cung-ung-procurement",
    department: "Cung Ứng",
    description: "Kênh phòng Mua hàng & Cung ứng"
  },
  {
    channel_code: "rd",
    name: "nghien-cuu-rd",
    department: "Nghiên Cứu R&D",
    description: "Kênh chuyên môn Phòng Nghiên cứu & Phát triển (Đề tài R&D, DHF, thiết kế mồi/probe & thẩm định)"
  },
  {
    channel_code: "kit",
    name: "san-xuat-kit",
    department: "Sản Xuất Kit",
    description: "Kênh điều độ Phòng Sản xuất Kit Chẩn đoán (Lệnh sản xuất eBR, pha chế MasterMix, chia chuẩn .D.IC)"
  },
  {
    channel_code: "oligo",
    name: "tong-hop-oligo",
    department: "Tổng Hợp Oligo",
    description: "Kênh điều độ Phòng Tổng hợp Oligo (Mẻ tổng hợp cột CPG, tinh sạch HPLC/PAGE & đo QC OD)"
  },
  {
    channel_code: "device",
    name: "ky-thuat-thiet-bi",
    department: "Kỹ Thuật – Thiết Bị",
    description: "Kênh Phòng Kỹ thuật – Thiết bị (Hồ sơ DMR, lắp ráp DHR máy EZ32, chạy Burn-in & bảo hành RMA)"
  },
  {
    channel_code: "qa",
    name: "qa-qc-iso13485",
    department: "QA/QC",
    description: "Kênh Phòng Đảm bảo & Kiểm soát Chất lượng ISO 13485 (Giải phóng lô, cấp COA, kiểm soát NCR/CAPA)"
  },
  {
    channel_code: "legal",
    name: "phap-che-thau",
    department: "Pháp Chế",
    description: "Kênh Phòng Pháp chế & Hồ sơ Thầu Y tế (Số lưu hành IVD Bộ Y Tế, thẩm định hợp đồng & hồ sơ thầu)"
  }
];

let chatTablesEnsured = false;
// Cấu trúc bảng chat (bảng đọc tin, cột ghim, chỉ mục) do migration trong db.ts tạo; ở đây chỉ chuẩn hóa dữ liệu kênh.
// Lỗi được ghi log và lần gọi sau thử lại (trước đây lỗi bị nuốt và không bao giờ chạy lại).
async function ensureChatTables() {
  if (chatTablesEnsured) return;
  let failed = false;
  const logFail = (step: string) => (err: any) => {
    failed = true;
    console.error(`[chat] Chuẩn hóa dữ liệu kênh thất bại (${step}):`, err?.message || err);
  };
  try {

    // Always ensure the company-wide general channel exists; only seed the other default department channels on initial setup
    const countRes = await query(`SELECT COUNT(*)::int AS cnt FROM chat_channels`).catch(() => ({ rows: [{ cnt: 1 }] }));
    const hasExistingChannels = Number(countRes.rows?.[0]?.cnt || 0) > 0;
    for (const ch of DEFAULT_DEPARTMENT_CHANNELS) {
      if (ch.channel_code !== "general" && hasExistingChannels) continue;
      await query(
        `INSERT INTO chat_channels (channel_code, name, channel_type, department, description, is_private, created_by, members)
         SELECT $1::varchar, $2::varchar, 'CHANNEL', $3::varchar, $4::text, FALSE, 'Hệ Thống', '[]'::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM chat_channels WHERE channel_code = $1::varchar)`,
        [ch.channel_code, ch.name, ch.department, ch.description]
      ).catch(logFail(`kênh ${ch.channel_code}`));
    }

    // Ensure standard department channels always have channel_type = 'CHANNEL' (do NOT overwrite custom is_private on specific dept channels)
    await query(`
      UPDATE chat_channels
      SET channel_type = 'CHANNEL'
      WHERE channel_code IN ('general', 'sales', 'application', 'warehouse', 'procurement', 'rd', 'kit', 'oligo', 'device', 'qa', 'legal')
        AND channel_type IS DISTINCT FROM 'CHANNEL'
    `).catch(logFail("kênh phòng ban"));

    await query(`
      UPDATE chat_channels
      SET is_private = FALSE, department = 'Toàn công ty'
      WHERE channel_code = 'general'
        AND (is_private IS DISTINCT FROM FALSE OR department IS DISTINCT FROM 'Toàn công ty')
    `).catch(logFail("kênh toàn công ty"));

    // Auto-align department label if a standard channel was renamed to a specific department (e.g. "Phòng IT")
    await query(`
      UPDATE chat_channels
      SET department = 'Phòng IT'
      WHERE channel_type = 'CHANNEL'
        AND LOWER(TRIM(name)) IN ('phòng it', 'phong it', 'kênh phòng it', 'it')
        AND department IS DISTINCT FROM 'Phòng IT'
    `).catch(() => {});

    // Ensure DM channels always have channel_type = 'DIRECT', is_private = TRUE, and department = 'Tin nhắn riêng'
    await query(`
      UPDATE chat_channels
      SET channel_type = 'DIRECT', is_private = TRUE, department = 'Tin nhắn riêng'
      WHERE channel_code LIKE 'dm-%'
        AND (channel_type IS DISTINCT FROM 'DIRECT' OR is_private IS DISTINCT FROM TRUE OR department IS DISTINCT FROM 'Tin nhắn riêng')
    `).catch(logFail("tin nhắn riêng"));

    // Re-align any messages whose channel_code explicitly matches a channel in chat_channels but whose channel_id drifted
    await query(`
      UPDATE chat_messages m
      SET channel_id = c.id
      FROM chat_channels c
      WHERE m.channel_code IS NOT NULL
        AND m.channel_code <> ''
        AND m.channel_code = c.channel_code
        AND m.channel_id IS DISTINCT FROM c.id
    `).catch(logFail("gắn lại tin nhắn"));

    chatTablesEnsured = !failed;
  } catch (err) {
    console.error("[chat] Không chuẩn hóa được dữ liệu kênh:", err);
  }
}

export async function GET(req: NextRequest) {
  try {
    await ensureChatTables();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "channels";
    const ident = await getChatIdentity(req);
    if (!ident) return unauthorizedResponse();

    // 1. Get channels list & personnel for mention / DM
    if (action === "channels") {
      const cleanUser = ident.name;
      const isAdminUser = false; // quản trị viên cũng chỉ thấy các cuộc trò chuyện mình tham gia

      // Auto-touch last_seen_at for the active user visiting chat (throttled to 30s to prevent hot-path contention)
      if (cleanUser) {
        await query(`
          UPDATE users 
          SET last_seen_at = NOW() 
          WHERE (
            TRIM(LOWER(full_name)) = TRIM(LOWER($1))
            OR TRIM(LOWER(username)) = TRIM(LOWER($1))
            OR TRIM(LOWER(username)) = TRIM(LOWER(REPLACE(REPLACE($1, 'NV-ABT-', 'ABT'), 'NV-VIA-', 'VIA')))
            OR TRIM(LOWER(username)) = TRIM(LOWER(REPLACE(REPLACE($1, 'NV-ABT', 'ABT'), 'NV-VIA', 'VIA')))
            OR TRIM(LOWER(email)) = TRIM(LOWER($1))
            OR ($1 ILIKE '%admin%' AND username = 'admin')
            OR ($1 ILIKE '%quản trị%' AND username = 'admin')
          )
          AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '30 seconds')
        `, [cleanUser]).catch((e) => console.error("[CHAT_TOUCH_USER_ERR]:", e?.message || e));
      }

      // Resolve user aliases (full_name, username, employee_code, email)
      const userAliases: string[] = cleanUser ? [cleanUser] : [];
      if (cleanUser && !isAdminUser) {
        try {
          const aliasRes = await query(
            `SELECT u.username, u.full_name, u.email, p.employee_code 
             FROM users u 
             LEFT JOIN personnel p ON (u.username = REPLACE(REPLACE(p.employee_code, 'NV-ABT-', 'ABT'), 'NV-VIA-', 'VIA') OR TRIM(LOWER(u.full_name)) = TRIM(LOWER(p.full_name)))
             WHERE TRIM(LOWER(u.full_name)) = TRIM(LOWER($1)) 
                OR TRIM(LOWER(u.username)) = TRIM(LOWER($1)) 
                OR TRIM(LOWER(u.email)) = TRIM(LOWER($1))
                OR TRIM(LOWER(p.employee_code)) = TRIM(LOWER($1))
             LIMIT 1`,
            [cleanUser]
          );
          if (aliasRes.rows.length > 0) {
            const row = aliasRes.rows[0];
            if (row.full_name && !userAliases.includes(row.full_name)) userAliases.push(row.full_name);
            if (row.username && !userAliases.includes(row.username)) userAliases.push(row.username);
            if (row.employee_code && !userAliases.includes(row.employee_code)) userAliases.push(row.employee_code);
          }
        } catch (e) {}
      }

      const includeMeta = searchParams.get("include_meta") !== "0";

      let unreadSubquery = "0::int as unread_count";
      if (cleanUser) {
        unreadSubquery = `
          COALESCE((
            SELECT COUNT(*)::int 
            FROM chat_messages m
            WHERE m.channel_id = c.id
              AND NOT (LOWER(TRIM(COALESCE(m.sender_name, ''))) = ANY($1::text[]))
              AND m.sender_name != 'Hệ Thống'
              AND m.content NOT ILIKE 'Bắt đầu cuộc trò chuyện%'
              AND m.content NOT ILIKE 'Đã tạo nhóm%'
              AND m.content NOT ILIKE 'Chào mừng đến với%'
              AND (
                m.id > COALESCE(ur.last_read_id, 0)
              )
              AND (
                ur.last_read_id IS NOT NULL
                OR m.created_at >= NOW() - INTERVAL '14 days'
              )
          ), 0)::int as unread_count
        `;
      }

      let channelsQuery = `
        SELECT c.*, 
          COALESCE(ms.message_count, 0)::int as message_count,
          ${unreadSubquery},
          lm.last_message_id,
          lm.last_message_content,
          lm.last_message_sender,
          lm.last_message_time
        FROM chat_channels c
        LEFT JOIN (
          SELECT channel_id, COUNT(*)::int AS message_count
          FROM chat_messages
          GROUP BY channel_id
        ) ms ON ms.channel_id = c.id
        LEFT JOIN (
          SELECT channel_id, MAX(last_read_message_id)::int AS last_read_id
          FROM chat_channel_reads
          WHERE LOWER(TRIM(user_name)) = ANY($1::text[])
          GROUP BY channel_id
        ) ur ON ur.channel_id = c.id
        LEFT JOIN LATERAL (
          SELECT id AS last_message_id,
                 content AS last_message_content,
                 sender_name AS last_message_sender,
                 created_at AS last_message_time
          FROM chat_messages m
          WHERE m.channel_id = c.id
          ORDER BY m.id DESC
          LIMIT 1
        ) lm ON true
      `;
      const params: any[] = [ident.aliases];
      channelsQuery += ` WHERE ${channelAccessSql("$1::text[]")}`;
      channelsQuery += ` ORDER BY c.last_message_at DESC NULLS LAST, c.id ASC`;

      const [channelsRes, personnelRes, tasksRes, workflowsRes] = await Promise.all([
        query(channelsQuery, params),
        query(`
          SELECT 
            COALESCE(u.id, p.id) as id,
            COALESCE(u.id, p.id) as user_id,
            p.employee_code as username,
            p.full_name as full_name,
            COALESCE(p.department, 'Khác') as department,
            COALESCE(p.position, 'Thành viên') as position,
            COALESCE(p.email, '') as email,
            COALESCE(p.phone, '') as phone,
            p.employee_code as employee_code,
            u.last_seen_at,
            CASE 
              WHEN u.last_seen_at IS NOT NULL AND u.last_seen_at >= NOW() - INTERVAL '3 minutes' THEN 'online'
              WHEN u.last_seen_at IS NOT NULL AND u.last_seen_at >= NOW() - INTERVAL '15 minutes' THEN 'away'
              ELSE 'offline'
            END as presence_status
          FROM personnel p
          LEFT JOIN LATERAL (
            SELECT u2.id, u2.last_seen_at
              FROM users u2
             WHERE u2.is_active IS NOT FALSE
               AND (
                 LOWER(u2.username) = LOWER(p.employee_code)
                 OR LOWER(u2.username) = LOWER(REGEXP_REPLACE(p.employee_code, '^NV-(ABT|TBRS|TBR|VIA)-?', '\\1', 'i'))
                 OR LOWER(REGEXP_REPLACE(TRIM(u2.full_name), '\\s+', ' ', 'g')) = LOWER(REGEXP_REPLACE(TRIM(p.full_name), '\\s+', ' ', 'g'))
               )
             ORDER BY u2.last_seen_at DESC NULLS LAST, u2.id ASC
             LIMIT 1
          ) u ON true
          WHERE p.employee_code IS NOT NULL AND p.employee_code != '' AND (p.status IS NULL OR p.status != 'INACTIVE')

          UNION ALL

          SELECT 
            u.id as id,
            u.id as user_id,
            u.username as username,
            u.full_name as full_name,
            COALESCE(u.department, 'Ban Giám Đốc') as department,
            'Quản trị viên hệ thống' as position,
            COALESCE(u.email, 'admin@abtvn.com') as email,
            '' as phone,
            'admin' as employee_code,
            u.last_seen_at,
            CASE 
              WHEN u.last_seen_at IS NOT NULL AND u.last_seen_at >= NOW() - INTERVAL '3 minutes' THEN 'online'
              WHEN u.last_seen_at IS NOT NULL AND u.last_seen_at >= NOW() - INTERVAL '15 minutes' THEN 'away'
              ELSE 'offline'
            END as presence_status
          FROM users u
          WHERE u.username = 'admin' 
            AND NOT EXISTS (SELECT 1 FROM personnel WHERE employee_code = 'admin')

          ORDER BY full_name ASC
        `),
        includeMeta
          ? query("SELECT id, task_code, title, department, assignee_name, status FROM company_tasks ORDER BY id DESC LIMIT 50")
          : Promise.resolve({ rows: [] }),
        includeMeta
          ? query("SELECT id, workflow_code, title, requester_dept, target_dept, status FROM workflow_requests ORDER BY id DESC LIMIT 50")
          : Promise.resolve({ rows: [] })
      ]);

      const presenceRank = (s?: string) => (s === "online" ? 2 : s === "away" ? 1 : 0);
      const dedupedPersonnelMap = new Map<string, any>();
      for (const row of personnelRes.rows || []) {
        const cleanName = normalizePersonText(row.full_name);
        const key = personNameKey(cleanName) || String(row.username || row.id || "").toLowerCase();
        if (!key) continue;
        const normalizedRow = { ...row, full_name: cleanName || row.username };
        const existing = dedupedPersonnelMap.get(key);
        if (!existing || presenceRank(normalizedRow.presence_status) > presenceRank(existing.presence_status)) {
          dedupedPersonnelMap.set(key, normalizedRow);
        }
      }
      const dedupedPersonnelList = Array.from(dedupedPersonnelMap.values());

      const accessibleRows = (channelsRes.rows || []).filter((c: any) => canUserAccessChannelRow(ident, c));

      const formattedChannels = accessibleRows.map((c: any) => {
        const explicitMembers = parseChannelMembers(c.members);
        let effectiveMembers = explicitMembers;
        const chType = String(c.channel_type || "CHANNEL").toUpperCase();

        if (chType === "CHANNEL") {
          if (isCompanyWideChannel(c)) {
            const allNames = dedupedPersonnelList.map((p: any) => String(p.full_name || "").trim()).filter(Boolean);
            effectiveMembers = Array.from(new Set([...explicitMembers, ...allNames]));
          } else if (!c.is_private) {
            const deptNames = dedupedPersonnelList
              .filter((p: any) => p.department && deptMatchesChannel(p.department, c))
              .map((p: any) => String(p.full_name || "").trim())
              .filter(Boolean);
            effectiveMembers = Array.from(new Set([...explicitMembers, ...deptNames]));
          }
        }

        // Display accurate department badge when channel was renamed (e.g. "Phòng IT")
        let displayDept = c.department;
        if (chType === "CHANNEL" && extractDeptBuckets(c.name).has("IT") && stripVn(displayDept) === "cung ung") {
          displayDept = "Phòng IT";
        }

        return {
          ...c,
          department: displayDept,
          unread_count: Number(c.unread_count) || 0,
          message_count: Number(c.message_count) || 0,
          name: c.name || "Kênh chat",
          can_manage: isChannelAdmin(ident, c),
          members: effectiveMembers
        };
      });

      let factoryWorkItems: any[] = [];
      if (includeMeta) {
        try {
          const fPool = getFactoryPool();
          const fwRes = await fPool.query(`
            SELECT 'KIT_ORDER' AS type, k.code, ('Lệnh SX Kit: ' || COALESCE(i.name, k.code) || ' (' || k.status || ')') AS title, 'Sản Xuất Kit' AS department, 'factory-kit' AS target_tab
              FROM kit.production_order k LEFT JOIN master.item i ON i.id = k.product_item_id ORDER BY k.created_at DESC LIMIT 15
            UNION ALL
            SELECT 'OLIGO_BATCH' AS type, b.code, ('Mẻ tổng hợp Oligo: ' || b.code || ' (' || b.status || ')') AS title, 'Tổng Hợp Oligo' AS department, 'factory-oligo' AS target_tab
              FROM oligo.synth_batch b ORDER BY b.created_at DESC LIMIT 15
            UNION ALL
            SELECT 'DEVICE_ORDER' AS type, d.code, ('Lệnh lắp ráp Thiết bị: ' || COALESCE(m.name, d.code) || ' (' || d.status || ')') AS title, 'Kỹ Thuật – Thiết Bị' AS department, 'factory-device' AS target_tab
              FROM device.device_order d LEFT JOIN device.device_model m ON m.id = d.model_id ORDER BY d.created_at DESC LIMIT 15
            UNION ALL
            SELECT 'RD_PROJECT' AS type, r.code, ('Đề tài R&D: ' || r.name || ' (' || r.status || ')') AS title, 'Nghiên Cứu R&D' AS department, 'factory-rd' AS target_tab
              FROM rd.project r ORDER BY r.created_at DESC LIMIT 15
            UNION ALL
            SELECT 'QA_NCR' AS type, n.code, ('Báo cáo sự cố NCR: ' || n.title || ' (' || n.status || ')') AS title, 'QA/QC' AS department, 'factory-qa' AS target_tab
              FROM qms.ncr n ORDER BY n.created_at DESC LIMIT 15
            UNION ALL
            SELECT 'INTAKE_ORDER' AS type, o.code, ('Đơn đặt hàng nội bộ: ' || o.code || ' (' || o.status || ')') AS title, 'Đơn Nội Bộ' AS department, 'factory-orders' AS target_tab
              FROM intake.order_request o ORDER BY o.created_at DESC LIMIT 15
          `);
          factoryWorkItems = fwRes.rows || [];
        } catch (e) {
          // Bỏ qua nếu bảng nhà máy chưa sẵn sàng
        }
      }

      return NextResponse.json({
        channels: formattedChannels,
        personnel: dedupedPersonnelList,
        is_admin: ident.isAdmin,
        tasks: tasksRes.rows || [],
        workflows: workflowsRes.rows || [],
        factoryWorkItems,
      });
    }

    // 1.5 Real-time presence polling
    if (action === "presence") {
      const presenceRes = await query(`
        SELECT DISTINCT ON (
          COALESCE(
            NULLIF(TRIM(LOWER(u.full_name)), ''), 
            CASE WHEN u.username = 'admin' THEN 'quan tri vien he thong' ELSE LOWER(u.username) END
          )
        )
          u.id, 
          u.username, 
          COALESCE(NULLIF(TRIM(u.full_name), ''), CASE WHEN u.username = 'admin' THEN 'Quản Trị Viên Hệ Thống' ELSE u.username END) as full_name, 
          u.role, 
          u.department, 
          u.last_seen_at,
          CASE 
            WHEN u.last_seen_at IS NOT NULL AND u.last_seen_at >= NOW() - INTERVAL '3 minutes' THEN 'online'
            WHEN u.last_seen_at IS NOT NULL AND u.last_seen_at >= NOW() - INTERVAL '15 minutes' THEN 'away'
            ELSE 'offline'
          END as presence_status
        FROM users u
        ORDER BY 
          COALESCE(
            NULLIF(TRIM(LOWER(u.full_name)), ''), 
            CASE WHEN u.username = 'admin' THEN 'quan tri vien he thong' ELSE LOWER(u.username) END
          ) ASC,
          u.last_seen_at DESC NULLS LAST,
          u.id ASC
      `);
      return NextResponse.json({ presence: presenceRes.rows });
    }

    // 2. Get messages for a channel
    if (action === "messages") {
      const channelId = searchParams.get("channel_id");
      const channelCode = searchParams.get("channel_code");
      const user = ident.name;
      if (!channelId && !channelCode) {
        return NextResponse.json({ error: "Thiếu channel_id hoặc channel_code" }, { status: 400 });
      }

      const resolvedChannelId = await canAccessChannel(ident, channelId, channelCode);
      if (!resolvedChannelId) return chatForbidden();

      const chMetaRes = await query(
        "SELECT id, channel_code, channel_type FROM chat_channels WHERE id = $1 LIMIT 1",
        [resolvedChannelId]
      );
      const chMeta = chMetaRes.rows[0];
      const resolvedCode = chMeta?.channel_code || channelCode || "";
      const resolvedType = chMeta?.channel_type || "CHANNEL";

      // Strict channel isolation: never mix DM messages into CHANNEL or CHANNEL messages into DIRECT
      // Newest 200 messages, returned oldest-first (it used to return the OLDEST 200, so a channel with more
      // messages never showed new ones and the read marker stopped at message #200)
      const res = await query(
        `SELECT * FROM (
         SELECT * FROM chat_messages m
         WHERE m.channel_id = $1
           AND (
             $2::text = ''
             OR m.channel_code IS NULL
             OR m.channel_code = ''
             OR m.channel_code = $2::text
           )
           AND (
             ($3::text = 'CHANNEL' AND COALESCE(m.channel_code, '') NOT LIKE 'dm-%')
             OR ($3::text = 'DIRECT' AND COALESCE(m.channel_code, '') NOT IN ('general', 'sales', 'application', 'warehouse', 'procurement'))
             OR ($3::text NOT IN ('CHANNEL', 'DIRECT'))
           )
         ORDER BY m.id DESC
         LIMIT 200
         ) newest
         ORDER BY newest.id ASC`,
        [resolvedChannelId, resolvedCode, resolvedType]
      );

      if (user && res.rows.length > 0) {
        const lastMsgId = res.rows[res.rows.length - 1].id;
        await query(
          `INSERT INTO chat_channel_reads (channel_id, user_name, last_read_message_id, last_read_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (channel_id, user_name)
           DO UPDATE SET last_read_message_id = GREATEST(chat_channel_reads.last_read_message_id, EXCLUDED.last_read_message_id),
                         last_read_at = NOW()`,
          [resolvedChannelId, user, lastMsgId]
        ).catch(() => {});
      }

      const readsRes = await query(
        `SELECT user_name, last_read_message_id::int AS last_read_message_id, last_read_at
           FROM chat_channel_reads
          WHERE channel_id = $1
            AND last_read_message_id > 0
          ORDER BY last_read_at DESC NULLS LAST`,
        [resolvedChannelId]
      ).catch(() => ({ rows: [] as any[] }));

      return NextResponse.json({
        channel_id: resolvedChannelId,
        channel_code: resolvedCode,
        channel_type: resolvedType,
        messages: res.rows,
        reads: readsRes.rows
      });
    }

    // 2.5 Mark channel messages as read explicitly
    if (action === "mark_read") {
      const channelId = searchParams.get("channel_id");
      const user = ident.name;
      if (channelId && !(await canAccessChannel(ident, channelId))) return chatForbidden();
      const lastId = searchParams.get("last_message_id");

      if (channelId && user) {
        const maxRes = await query("SELECT COALESCE(MAX(id), 0)::int as max_id FROM chat_messages WHERE channel_id = $1", [channelId]);
        const maxId = Number(maxRes.rows[0]?.max_id) || 0;
        const parsedLast = Number(lastId) || 0;
        const msgId = parsedLast > 0 && parsedLast <= 2147483647 ? Math.max(maxId, parsedLast) : maxId;
        await query(
          `INSERT INTO chat_channel_reads (channel_id, user_name, last_read_message_id, last_read_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (channel_id, user_name)
           DO UPDATE SET last_read_message_id = GREATEST(chat_channel_reads.last_read_message_id, EXCLUDED.last_read_message_id),
                         last_read_at = NOW()`,
          [channelId, user, msgId]
        ).catch(() => {});
      }

      return NextResponse.json({ success: true });
    }

    // 3. Search messages across channels
    if (action === "search") {
      const q = searchParams.get("q") || "";
      if (!q.trim()) return NextResponse.json({ messages: [] });

      const chRes = await query("SELECT * FROM chat_channels");
      const allowedIds = (chRes.rows || [])
        .filter((c: any) => canUserAccessChannelRow(ident, c))
        .map((c: any) => Number(c.id))
        .filter(Boolean);

      if (allowedIds.length === 0) return NextResponse.json({ messages: [] });

      const res = await query(
        `SELECT m.*, c.name as channel_name 
         FROM chat_messages m
         JOIN chat_channels c ON m.channel_id = c.id
         WHERE m.content ILIKE $1 AND m.channel_id = ANY($2::int[])
         ORDER BY m.id DESC LIMIT 50`,
        [`%${q}%`, allowedIds]
      );

      return NextResponse.json({ messages: res.rows });
    }

    return NextResponse.json({ error: "Hành động GET không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Chat API GET Error:", error);
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureChatTables();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const ident = await getChatIdentity(req);
    if (!ident) return unauthorizedResponse();
    if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
    // Người thực hiện luôn là người đang đăng nhập
    body.sender_name = ident.name;
    body.sender_dept = ident.department || body.sender_dept;
    body.created_by = ident.name;
    body.added_by = ident.name;
    body.removed_by = ident.name;
    body.user_name = ident.name;
    body.user = ident.name;
    if (action === "leave_channel") body.member_name = ident.name;

    const CHANNEL_SCOPED = ["send_message", "add_members", "update_channel", "remove_member", "leave_channel", "delete_channel", "toggle_pin", "pin_message", "mark_read"];
    if (CHANNEL_SCOPED.includes(action || "")) {
      const chId = body.channel_id || searchParams.get("channel_id");
      if ((chId || body.channel_code) && !(await canAccessChannel(ident, chId, body.channel_code))) return chatForbidden();
    }
    if (action === "toggle_reaction" && body.message_id) {
      const m = await query("SELECT channel_id FROM chat_messages WHERE id = $1", [body.message_id]);
      if (m.rows[0] && !(await canAccessChannel(ident, m.rows[0].channel_id))) return chatForbidden();
    }
    if (action === "delete_channel" && body.channel_id) {
      const ch = await query("SELECT * FROM chat_channels WHERE id = $1", [body.channel_id]);
      if (ch.rows[0]) {
        if (String(ch.rows[0].channel_code || "").toLowerCase() === "general") {
          return NextResponse.json({ error: "Không thể xóa kênh thông báo chung của toàn công ty." }, { status: 400 });
        }
        if (!isChannelAdmin(ident, ch.rows[0])) {
          return NextResponse.json({ error: "Chỉ Trưởng nhóm hoặc Quản trị viên mới được xóa nhóm." }, { status: 403 });
        }
      }
    }

    // 1. Send Message
    if (action === "send_message") {
      const {
        channel_id,
        channel_code,
        sender_id,
        sender_name,
        sender_avatar,
        sender_role,
        sender_dept,
        content,
        attachments,
        related_work,
        reply_to
      } = body;

      if (!content && (!attachments || attachments.length === 0)) {
        return NextResponse.json({ error: "Nội dung tin nhắn hoặc tệp đính kèm không được rỗng" }, { status: 400 });
      }

      if (Array.isArray(attachments) && attachments.length > MAX_CHAT_ATTACHMENTS_PER_MESSAGE) {
        return NextResponse.json(
          { error: `Mỗi lần gửi trong chat nội bộ chỉ được đính kèm tối đa ${MAX_CHAT_ATTACHMENTS_PER_MESSAGE} hình ảnh / tệp tin.` },
          { status: 400 }
        );
      }

      // Check or resolve channel strictly (preferring channel_code consistency if both are provided)
      const resolvedChannelId = await canAccessChannel(ident, channel_id, channel_code);
      if (!resolvedChannelId) {
        return NextResponse.json({ error: "Không tìm thấy kênh chat hoặc bạn không có quyền truy cập" }, { status: 404 });
      }

      const { cleanedAttachments, contentKeys } = await normalizeAndDedupeChatAttachments(attachments);

      // Chặn gửi lặp lại cùng một hình ảnh / tệp tin nhiều lần liên tiếp trong cùng kênh chat (trong vòng 10 phút gần nhất)
      if (contentKeys.length > 0) {
        const recentRes = await query(
          `SELECT content, attachments
             FROM chat_messages
            WHERE channel_id = $1
              AND LOWER(TRIM(sender_name)) = LOWER(TRIM($2))
              AND created_at >= NOW() - INTERVAL '10 minutes'
            ORDER BY id DESC
            LIMIT 8`,
          [resolvedChannelId, sender_name || ident.name]
        ).catch(() => ({ rows: [] as any[] }));

        const recentSentKeys = new Set<string>();
        for (const r of recentRes.rows) {
          const rAtts = Array.isArray(r.attachments)
            ? r.attachments
            : typeof r.attachments === "string"
            ? (() => { try { return JSON.parse(r.attachments); } catch { return []; } })()
            : [];
          if (Array.isArray(rAtts)) {
            for (const ra of rAtts) {
              const k = getServerAttachmentContentKey(ra);
              if (k) recentSentKeys.add(k);
            }
          }
        }

        const freshAttachments = cleanedAttachments.filter((att) => {
          const k = getServerAttachmentContentKey(att);
          return !k || !recentSentKeys.has(k);
        });

        if (freshAttachments.length === 0 && !String(content || "").trim()) {
          return NextResponse.json(
            { error: "Hình ảnh / tệp này bạn vừa mới gửi trong cuộc trò chuyện. Hệ thống đã chặn gửi lặp lại cùng một hình ảnh để tránh gây nặng hệ thống." },
            { status: 409 }
          );
        }

        // Nếu tin nhắn có kèm chữ hoặc có tệp mới xen lẫn tệp trùng vừa gửi, chỉ giữ lại tệp mới chưa gửi trùng
        cleanedAttachments.splice(0, cleanedAttachments.length, ...freshAttachments);
      }

      const chInfoRes = await query("SELECT id, channel_code FROM chat_channels WHERE id = $1 LIMIT 1", [resolvedChannelId]);
      const canonicalChannelCode = chInfoRes.rows[0]?.channel_code || channel_code || "";

      const res = await query(
        `INSERT INTO chat_messages (
           channel_id, channel_code, sender_id, sender_name, sender_avatar,
           sender_role, sender_dept, content, attachments, related_work, reply_to
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          resolvedChannelId,
          canonicalChannelCode,
          sender_id || "",
          sender_name || "Nhân viên",
          sender_avatar || "",
          sender_role || "Thành viên",
          sender_dept || "Kinh Doanh",
          content || "",
          JSON.stringify(cleanedAttachments),
          related_work ? JSON.stringify(related_work) : null,
          reply_to ? JSON.stringify(reply_to) : null
        ]
      );

      // Update channel last message timestamp
      await query("UPDATE chat_channels SET last_message_at = CURRENT_TIMESTAMP WHERE id = $1", [resolvedChannelId]);

      // Automatically touch last_seen_at for sender
      if (sender_name) {
        await query(`
          UPDATE users 
          SET last_seen_at = NOW() 
          WHERE TRIM(LOWER(full_name)) = TRIM(LOWER($1))
             OR TRIM(LOWER(username)) = TRIM(LOWER($1))
             OR TRIM(LOWER(username)) = TRIM(LOWER(REPLACE(REPLACE($1, 'NV-ABT-', 'ABT'), 'NV-VIA-', 'VIA')))
             OR ($1 ILIKE '%admin%' AND username = 'admin')
             OR ($1 ILIKE '%quản trị%' AND username = 'admin')
        `, [sender_name]).catch(() => {});
      }

      const createdMessage = res.rows[0];

      // Auto update read receipt for the sender so their own message is marked as read by them
      if (createdMessage?.id && resolvedChannelId && sender_name) {
        await query(
          `INSERT INTO chat_channel_reads (channel_id, user_name, last_read_message_id, last_read_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (channel_id, user_name)
           DO UPDATE SET last_read_message_id = GREATEST(chat_channel_reads.last_read_message_id, EXCLUDED.last_read_message_id),
                         last_read_at = NOW()`,
          [resolvedChannelId, sender_name, createdMessage.id]
        ).catch(() => {});
      }

      return NextResponse.json({ success: true, message: createdMessage });
    }

    // 2. Create Channel / Group Chat / Direct Message
    if (action === "create_channel") {
      const {
        name,
        channel_type,
        department,
        description,
        is_private,
        created_by,
        members
      } = body;

      if (!name || !name.trim()) {
        return NextResponse.json({ error: "Vui lòng nhập tên nhóm / kênh chat" }, { status: 400 });
      }

      const cleanType = channel_type || "GROUP";
      const memberList: string[] = Array.isArray(members) ? members : [];

      // Tin nhắn riêng: tìm đúng kênh giữa NGƯỜI ĐANG ĐĂNG NHẬP và NGƯỜI ĐƯỢC CHỌN (so khớp chính xác tên thành viên).
      // Trước đây so "tên kênh có chứa tên mình" nên mở chat với ai cũng rơi vào kênh người khác đã nhắn cho mình.
      if (cleanType === "DIRECT") {
        const ADMIN_ALIASES = ["admin", "quản trị viên hệ thống", "quản trị viên", "quan tri vien he thong", "quan tri vien"];
        const meAliases = ident.aliases;
        const target = String(
          memberList.map(m => String(m || "").trim()).find(m => m && !meAliases.includes(m.toLowerCase())) || name
        ).trim();
        if (!target || meAliases.includes(target.toLowerCase())) {
          return NextResponse.json({ error: "Không thể tự nhắn tin cho chính mình" }, { status: 400 });
        }
        const targetAliases = ADMIN_ALIASES.includes(target.toLowerCase()) ? ADMIN_ALIASES : [target.toLowerCase()];
        const existRes = await query(
          `SELECT * FROM chat_channels c
            WHERE c.channel_type = 'DIRECT'
              AND (
                (
                  EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.members) = 'array' THEN c.members ELSE '[]'::jsonb END) m WHERE LOWER(TRIM(m)) = ANY($1::text[]))
                  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.members) = 'array' THEN c.members ELSE '[]'::jsonb END) m WHERE LOWER(TRIM(m)) = ANY($2::text[]))
                )
                OR (
                  jsonb_array_length(CASE WHEN jsonb_typeof(c.members) = 'array' THEN c.members ELSE '[]'::jsonb END) = 0
                  AND (
                    (LOWER(TRIM(c.name)) = ANY($2::text[]) AND LOWER(TRIM(COALESCE(c.created_by, ''))) = ANY($1::text[]))
                    OR (LOWER(TRIM(c.name)) = ANY($1::text[]) AND LOWER(TRIM(COALESCE(c.created_by, ''))) = ANY($2::text[]))
                  )
                )
              )
            ORDER BY (SELECT COUNT(*) FROM chat_messages m WHERE m.channel_id = c.id) DESC, c.last_message_at DESC NULLS LAST, c.id ASC
            LIMIT 1`,
          [meAliases, targetAliases]
        );
        if (existRes.rows.length > 0) {
          return NextResponse.json({ success: true, channel: existRes.rows[0], isExisting: true });
        }
        memberList.splice(0, memberList.length, ident.name, target);
      }

      // Generate clean channel_code
      const slug = name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      
      const prefix = cleanType === "DIRECT" ? "dm" : cleanType === "GROUP" ? "grp" : cleanType === "PROJECT" ? "prj" : "ch";
      const channel_code = `${prefix}-${slug || "nhom"}-${Date.now().toString().slice(-4)}`;

      const res = await query(
        `INSERT INTO chat_channels (
           channel_code, name, channel_type, department, description, is_private, created_by, members
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          channel_code,
          name.trim(),
          cleanType,
          cleanType === "DIRECT" ? "Tin nhắn riêng" : (department || (cleanType === "GROUP" ? "Liên phòng ban" : "Toàn công ty")),
          description || "",
          cleanType === "DIRECT" || cleanType === "GROUP" ? true : !!is_private,
          created_by || "Nhân viên",
          JSON.stringify(memberList)
        ]
      );

      const created = res.rows[0];

      // Auto add welcome message
      const welcomeText = cleanType === "DIRECT"
        ? `Bắt đầu cuộc trò chuyện trực tiếp giữa ${memberList.join(" và ")}.`
        : cleanType === "GROUP"
        ? `Đã tạo nhóm chat liên phòng ban với ${memberList.length} thành viên: ${memberList.join(", ")}.`
        : cleanType === "PROJECT"
        ? `Chào mừng đến với nhóm dự án #${created.name}! ${description ? `Mục đích: ${description}` : ""}`
        : `Chào mừng đến với kênh #${created.name}! ${description ? `Mục đích: ${description}` : ""}`;

      const welcomeRes = await query(
        `INSERT INTO chat_messages (channel_id, channel_code, sender_name, sender_role, sender_dept, content)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          created.id,
          created.channel_code,
          created_by || "Hệ Thống",
          "Điều phối",
          department || "ABT",
          welcomeText
        ]
      );
      const welcomeMsg = welcomeRes.rows[0];
      if (welcomeMsg?.id) {
        const initialReaders = Array.from(new Set([created_by, ...(memberList || [])].filter(Boolean)));
        for (const m of initialReaders) {
          await query(
            `INSERT INTO chat_channel_reads (channel_id, user_name, last_read_message_id, last_read_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (channel_id, user_name)
             DO UPDATE SET last_read_message_id = GREATEST(chat_channel_reads.last_read_message_id, EXCLUDED.last_read_message_id),
                           last_read_at = NOW()`,
            [created.id, m, welcomeMsg.id]
          ).catch(() => {});
        }
      }

      await logAudit("CREATE", "CHAT_CHANNEL", `Tạo mới nhóm chat: ${name} (${cleanType})`);
      return NextResponse.json({ success: true, channel: created });
    }

    // 2.2 Broadcast Meeting Invitation / Reminder via Chat (Group + Direct Messages to Attendees)
    if (action === "broadcast_meeting") {
      const {
        title,
        content,
        attendees,
        department,
        send_direct = true,
        create_group = false,
        existing_channel_id
      } = body;

      if (!content || !String(content).trim()) {
        return NextResponse.json({ error: "Nội dung thông báo lịch họp không được để trống" }, { status: 400 });
      }

      const senderName = ident.name || "Điều phối";
      const senderDept = ident.department || department || "Ban Giám Đốc";
      const rawAttendees: string[] = Array.isArray(attendees) ? attendees : [];
      const cleanAttendees = Array.from(
        new Set(rawAttendees.map((a) => String(a || "").trim()).filter(Boolean))
      );
      const allMembers = Array.from(new Set([senderName, ...cleanAttendees]));

      let groupChannel: any = null;
      let directSentCount = 0;

      // A) If create_group or existing_channel_id is requested, create/reuse the meeting group channel and post the message
      if (create_group || existing_channel_id) {
        if (existing_channel_id) {
          const exRes = await query("SELECT * FROM chat_channels WHERE id = $1", [Number(existing_channel_id)]);
          if (exRes.rows.length > 0) {
            groupChannel = exRes.rows[0];
            // Ensure all attendees are in members
            const curMems: string[] = Array.isArray(groupChannel.members) ? groupChannel.members : [];
            const mergedMems = Array.from(new Set([...curMems, ...allMembers]));
            await query("UPDATE chat_channels SET members = $1, last_message_at = CURRENT_TIMESTAMP WHERE id = $2", [
              JSON.stringify(mergedMems),
              groupChannel.id
            ]);
          }
        }

        if (!groupChannel) {
          const groupName = `📅 Họp: ${String(title || "Cuộc họp nội bộ").trim().slice(0, 60)}`;
          // Check if a group channel with the same name already exists
          const existGrp = await query(
            "SELECT * FROM chat_channels WHERE channel_type = 'GROUP' AND LOWER(TRIM(name)) = LOWER(TRIM($1)) ORDER BY id DESC LIMIT 1",
            [groupName]
          );
          if (existGrp.rows.length > 0) {
            groupChannel = existGrp.rows[0];
            const curMems: string[] = Array.isArray(groupChannel.members) ? groupChannel.members : [];
            const mergedMems = Array.from(new Set([...curMems, ...allMembers]));
            await query("UPDATE chat_channels SET members = $1, last_message_at = CURRENT_TIMESTAMP WHERE id = $2", [
              JSON.stringify(mergedMems),
              groupChannel.id
            ]);
          } else {
            const slug = groupName
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/đ/g, "d")
              .replace(/[^a-z0-9]/g, "-")
              .replace(/-+/g, "-")
              .replace(/^-|-$/g, "");
            const channel_code = `mtg-${slug.slice(0, 24) || "hop"}-${Date.now().toString().slice(-4)}`;
            const createRes = await query(
              `INSERT INTO chat_channels (
                 channel_code, name, channel_type, department, description, is_private, created_by, members, last_message_at
               ) VALUES ($1, $2, 'GROUP', $3, $4, TRUE, $5, $6, CURRENT_TIMESTAMP) RETURNING *`,
              [
                channel_code,
                groupName,
                department || "Liên phòng ban",
                `Nhóm trao đổi & thông báo lịch họp: ${title || ""}`,
                senderName,
                JSON.stringify(allMembers)
              ]
            );
            groupChannel = createRes.rows[0];
          }
        }

        if (groupChannel?.id) {
          const msgRes = await query(
            `INSERT INTO chat_messages (
               channel_id, channel_code, sender_name, sender_role, sender_dept, content, is_pinned
             ) VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING *`,
            [
              groupChannel.id,
              groupChannel.channel_code || "",
              senderName,
              "Chủ trì cuộc họp",
              senderDept,
              String(content).trim()
            ]
          );
          const createdMsg = msgRes.rows[0];
          if (createdMsg?.id) {
            await query(
              `INSERT INTO chat_channel_reads (channel_id, user_name, last_read_message_id, last_read_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (channel_id, user_name)
               DO UPDATE SET last_read_message_id = GREATEST(chat_channel_reads.last_read_message_id, EXCLUDED.last_read_message_id),
                             last_read_at = NOW()`,
              [groupChannel.id, senderName, createdMsg.id]
            ).catch(() => {});
          }
        }
      }

      // B) Send Direct Message to each attendee so they get a personal notification in 1-on-1 chat
      if (send_direct && cleanAttendees.length > 0) {
        const meAliases = ident.aliases;
        for (const target of cleanAttendees) {
          if (!target || meAliases.includes(target.toLowerCase())) continue;
          const targetAliases = [target.toLowerCase()];
          try {
            let dmChannel: any = null;
            const existDm = await query(
              `SELECT * FROM chat_channels c
                WHERE c.channel_type = 'DIRECT'
                  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.members) = 'array' THEN c.members ELSE '[]'::jsonb END) m WHERE LOWER(TRIM(m)) = ANY($1::text[]))
                  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.members) = 'array' THEN c.members ELSE '[]'::jsonb END) m WHERE LOWER(TRIM(m)) = ANY($2::text[]))
                ORDER BY c.id ASC LIMIT 1`,
              [meAliases, targetAliases]
            );
            if (existDm.rows.length > 0) {
              dmChannel = existDm.rows[0];
            } else {
              const slug = target
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/đ/g, "d")
                .replace(/[^a-z0-9]/g, "-")
                .replace(/-+/g, "-")
                .replace(/^-|-$/g, "");
              const dmCode = `dm-${slug.slice(0, 20) || "nv"}-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 90 + 10)}`;
              const createDm = await query(
                `INSERT INTO chat_channels (
                   channel_code, name, channel_type, department, description, is_private, created_by, members, last_message_at
                 ) VALUES ($1, $2, 'DIRECT', $3, 'Trao đổi trực tiếp & Thông báo lịch họp', TRUE, $4, $5, CURRENT_TIMESTAMP) RETURNING *`,
                [dmCode, target, "Tin nhắn riêng", senderName, JSON.stringify([senderName, target])]
              );
              dmChannel = createDm.rows[0];
            }

            if (dmChannel?.id) {
              const dmMsgRes = await query(
                `INSERT INTO chat_messages (
                   channel_id, channel_code, sender_name, sender_role, sender_dept, content
                 ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [
                  dmChannel.id,
                  dmChannel.channel_code || "",
                  senderName,
                  "Thông báo lịch họp",
                  senderDept,
                  String(content).trim()
                ]
              );
              await query("UPDATE chat_channels SET last_message_at = CURRENT_TIMESTAMP WHERE id = $1", [dmChannel.id]);
              const dmMsg = dmMsgRes.rows[0];
              if (dmMsg?.id) {
                await query(
                  `INSERT INTO chat_channel_reads (channel_id, user_name, last_read_message_id, last_read_at)
                   VALUES ($1, $2, $3, NOW())
                   ON CONFLICT (channel_id, user_name)
                   DO UPDATE SET last_read_message_id = GREATEST(chat_channel_reads.last_read_message_id, EXCLUDED.last_read_message_id),
                                 last_read_at = NOW()`,
                  [dmChannel.id, senderName, dmMsg.id]
                ).catch(() => {});
              }
              directSentCount++;
            }
          } catch (dmErr) {
            console.warn("[BROADCAST_MEETING_DM_ERR]:", dmErr);
          }
        }
      }

      return NextResponse.json({
        success: true,
        groupChannel,
        directSentCount,
        totalAttendees: cleanAttendees.length
      });
    }

    // 2.5 Add Members to Channel/Group
    if (action === "add_members") {
      const { channel_id, new_members, added_by } = body;
      if (!channel_id || !Array.isArray(new_members) || new_members.length === 0) {
        return NextResponse.json({ error: "Thiếu thông tin thành viên cần thêm" }, { status: 400 });
      }

      const cRes = await query("SELECT * FROM chat_channels WHERE id = $1", [channel_id]);
      if (cRes.rows.length === 0) {
        return NextResponse.json({ error: "Không tìm thấy nhóm chat" }, { status: 404 });
      }

      const channel = cRes.rows[0];
      const currentMembers: string[] = Array.isArray(channel.members) ? channel.members : [];
      const updatedMembers = Array.from(new Set([...currentMembers, ...new_members]));

      await query("UPDATE chat_channels SET members = $1 WHERE id = $2", [JSON.stringify(updatedMembers), channel_id]);

      // System notification message
      await query(
        `INSERT INTO chat_messages (channel_id, channel_code, sender_name, sender_role, sender_dept, content)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          channel_id,
          channel.channel_code,
          "Hệ Thống",
          "Thông báo",
          "ABT",
          `${added_by || "Thành viên"} đã thêm ${new_members.join(", ")} vào nhóm trao đổi.`
        ]
      );

      return NextResponse.json({ success: true, members: updatedMembers });
    }

    // 2.6 Update Channel Settings
    if (action === "update_channel") {
      const { channel_id, name, department, description, is_private, user_name } = body;
      if (!channel_id || !name || !name.trim()) {
        return NextResponse.json({ error: "Thiếu thông tin cập nhật nhóm chat" }, { status: 400 });
      }

      const existRes = await query("SELECT * FROM chat_channels WHERE id = $1", [channel_id]);
      if (existRes.rows.length === 0) {
        return NextResponse.json({ error: "Không tìm thấy nhóm chat" }, { status: 404 });
      }
      const existingChannel = existRes.rows[0];
      if (!isChannelAdmin(ident, existingChannel)) {
        return NextResponse.json(
          { error: "Chỉ Trưởng nhóm hoặc Quản trị viên mới có quyền chỉnh sửa cài đặt nhóm." },
          { status: 403 }
        );
      }

      let nextDepartment = department || existingChannel.department || "Liên phòng ban";
      if (extractDeptBuckets(name).has("IT") && stripVn(nextDepartment) === "cung ung") {
        nextDepartment = "Phòng IT";
      }

      let nextMembers = parseChannelMembers(existingChannel.members);
      const nextPrivate = isCompanyWideChannel(existingChannel) ? false : !!is_private;
      if (
        nextPrivate &&
        !existingChannel.is_private &&
        String(existingChannel.channel_type || "").toUpperCase() === "CHANNEL" &&
        !isCompanyWideChannel(existingChannel)
      ) {
        const pRes = await query(
          "SELECT full_name, department FROM personnel WHERE employee_code IS NOT NULL AND employee_code != '' AND (status IS NULL OR status != 'INACTIVE')"
        );
        const deptMatchingNames: string[] = [];
        const tempChannel = { ...existingChannel, name: name.trim(), department: nextDepartment };
        for (const p of pRes.rows || []) {
          const fn = normalizePersonText(p.full_name);
          if (!fn) continue;
          if (p.department && deptMatchesChannel(p.department, tempChannel)) {
            deptMatchingNames.push(fn);
          }
        }
        nextMembers = Array.from(new Set([...nextMembers, ...deptMatchingNames, ident.name].filter(Boolean)));
      }

      const res = await query(
        `UPDATE chat_channels 
         SET name = $1, department = $2, description = $3, is_private = $4, members = $5 
         WHERE id = $6 RETURNING *`,
        [name.trim(), nextDepartment, description || "", nextPrivate, JSON.stringify(nextMembers), channel_id]
      );

      if (res.rows.length === 0) {
        return NextResponse.json({ error: "Không tìm thấy nhóm chat" }, { status: 404 });
      }

      const updated = { ...res.rows[0], can_manage: true };
      await query(
        `INSERT INTO chat_messages (channel_id, channel_code, sender_name, sender_role, sender_dept, content)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          channel_id,
          updated.channel_code,
          "Hệ Thống",
          "Cài đặt",
          "ABT",
          `${user_name || "Quản trị viên"} đã cập nhật thông tin nhóm: "${name}".`
        ]
      );

      await logAudit("UPDATE", "CHAT_CHANNEL", `Cập nhật nhóm chat: ${name} (ID: ${channel_id})`);
      return NextResponse.json({ success: true, channel: updated });
    }

    // 2.7 Remove Member from Group
    if (action === "remove_member") {
      const { channel_id, member_name, removed_by } = body;
      if (!channel_id || !member_name) {
        return NextResponse.json({ error: "Thiếu thông tin thành viên cần xóa" }, { status: 400 });
      }

      const cRes = await query("SELECT * FROM chat_channels WHERE id = $1", [channel_id]);
      if (cRes.rows.length === 0) return NextResponse.json({ error: "Không tìm thấy nhóm chat" }, { status: 404 });

      const channel = cRes.rows[0];
      if (!isChannelAdmin(ident, channel)) {
        return NextResponse.json(
          { error: "Chỉ Trưởng nhóm hoặc Quản trị viên mới có quyền xóa thành viên khỏi nhóm." },
          { status: 403 }
        );
      }

      const targetKey = stripVn(member_name);
      const creatorKey = stripVn(channel.created_by);
      if (creatorKey && creatorKey !== "he thong" && targetKey === creatorKey && !ident.isAdmin) {
        return NextResponse.json(
          { error: "Không thể xóa Trưởng nhóm (người tạo nhóm) khỏi nhóm chat." },
          { status: 400 }
        );
      }

      let baseMembers = parseChannelMembers(channel.members);
      let nextIsPrivate = Boolean(channel.is_private);

      // If removing a member from a department channel that wasn't locked to explicit members yet,
      // materialize the department's members into c.members (minus the removed person) so they are genuinely excluded.
      if (String(channel.channel_type || "").toUpperCase() === "CHANNEL" && !isCompanyWideChannel(channel) && !channel.is_private) {
        const pRes = await query(
          "SELECT full_name, department FROM personnel WHERE employee_code IS NOT NULL AND employee_code != '' AND (status IS NULL OR status != 'INACTIVE')"
        );
        const deptMatchingNames: string[] = [];
        for (const p of pRes.rows || []) {
          const fn = normalizePersonText(p.full_name);
          if (!fn) continue;
          if (p.department && deptMatchesChannel(p.department, channel)) {
            deptMatchingNames.push(fn);
          }
        }
        baseMembers = Array.from(new Set([...baseMembers, ...deptMatchingNames]));
        nextIsPrivate = true;
      }

      const updatedMembers = baseMembers.filter(m => stripVn(m) !== targetKey && m !== member_name);
      let nextCreatedBy = channel.created_by || "Hệ Thống";
      if (creatorKey && creatorKey === targetKey) {
        nextCreatedBy = updatedMembers[0] || "Hệ Thống";
      }

      await query("UPDATE chat_channels SET members = $1, is_private = $2, created_by = $3 WHERE id = $4", [
        JSON.stringify(updatedMembers),
        nextIsPrivate,
        nextCreatedBy,
        channel_id
      ]);

      await query(
        `INSERT INTO chat_messages (channel_id, channel_code, sender_name, sender_role, sender_dept, content)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          channel_id,
          channel.channel_code,
          "Hệ Thống",
          "Thông báo",
          "ABT",
          `${removed_by || "Quản trị"} đã xóa ${member_name} khỏi nhóm trao đổi.`
        ]
      );

      return NextResponse.json({
        success: true,
        members: updatedMembers,
        is_private: nextIsPrivate,
        created_by: nextCreatedBy
      });
    }

    // 2.8 Leave Channel / Group
    if (action === "leave_channel") {
      const { channel_id, member_name } = body;
      if (!channel_id || !member_name) {
        return NextResponse.json({ error: "Thiếu thông tin rời nhóm" }, { status: 400 });
      }

      const cRes = await query("SELECT * FROM chat_channels WHERE id = $1", [channel_id]);
      if (cRes.rows.length === 0) return NextResponse.json({ error: "Không tìm thấy nhóm chat" }, { status: 404 });

      const channel = cRes.rows[0];
      if (isCompanyWideChannel(channel)) {
        return NextResponse.json(
          { error: "Không thể rời khỏi kênh thông báo chung của toàn công ty." },
          { status: 400 }
        );
      }

      let baseMembers = parseChannelMembers(channel.members);
      let nextIsPrivate = true;

      // If leaving a department channel that wasn't locked to explicit members yet,
      // materialize the department's members into c.members first so remaining department members stay in the channel
      // while the leaving member is genuinely excluded.
      if (String(channel.channel_type || "").toUpperCase() === "CHANNEL" && !channel.is_private) {
        const pRes = await query(
          "SELECT full_name, department FROM personnel WHERE employee_code IS NOT NULL AND employee_code != '' AND (status IS NULL OR status != 'INACTIVE')"
        );
        const deptMatchingNames: string[] = [];
        for (const p of pRes.rows || []) {
          const fn = normalizePersonText(p.full_name);
          if (!fn) continue;
          if (p.department && deptMatchesChannel(p.department, channel)) {
            deptMatchingNames.push(fn);
          }
        }
        baseMembers = Array.from(new Set([...baseMembers, ...deptMatchingNames]));
      }

      const leavingKey = stripVn(member_name);
      const updatedMembers = baseMembers.filter((m) => {
        const mLower = String(m || "").trim().toLowerCase();
        const mKey = stripVn(m);
        if (m === member_name || (leavingKey && mKey === leavingKey)) return false;
        if (ident.aliases.includes(mLower) || (mKey && ident.aliasKeys.includes(mKey))) return false;
        return true;
      });

      let nextCreatedBy = channel.created_by || "Hệ Thống";
      let transferredTo = "";
      if (userIsChannelCreator(ident, channel) || (leavingKey && stripVn(channel.created_by) === leavingKey)) {
        nextCreatedBy = updatedMembers[0] || "Hệ Thống";
        if (nextCreatedBy && nextCreatedBy !== "Hệ Thống") {
          transferredTo = nextCreatedBy;
        }
      }

      await query(
        "UPDATE chat_channels SET members = $1, is_private = $2, created_by = $3 WHERE id = $4",
        [JSON.stringify(updatedMembers), nextIsPrivate, nextCreatedBy, channel_id]
      );

      await query(
        `INSERT INTO chat_messages (channel_id, channel_code, sender_name, sender_role, sender_dept, content)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          channel_id,
          channel.channel_code,
          "Hệ Thống",
          "Thông báo",
          "ABT",
          transferredTo
            ? `${member_name} đã rời khỏi nhóm trao đổi (Quyền Trưởng nhóm được chuyển cho ${transferredTo}).`
            : `${member_name} đã rời khỏi nhóm trao đổi.`
        ]
      );

      return NextResponse.json({
        success: true,
        members: updatedMembers,
        is_private: nextIsPrivate,
        created_by: nextCreatedBy
      });
    }

    // 2.9 Delete Channel / Group
    if (action === "delete_channel") {
      const { channel_id, user_name } = body;
      if (!channel_id) {
        return NextResponse.json({ error: "Thiếu channel_id cần xóa" }, { status: 400 });
      }

      const cRes = await query("SELECT * FROM chat_channels WHERE id = $1", [channel_id]);
      if (cRes.rows.length === 0) return NextResponse.json({ error: "Không tìm thấy nhóm chat" }, { status: 404 });

      const channelName = cRes.rows[0].name;

      // Delete reads & messages first, then channel
      await query("DELETE FROM chat_channel_reads WHERE channel_id = $1", [channel_id]).catch(() => {});
      await query("DELETE FROM chat_messages WHERE channel_id = $1", [channel_id]);
      await query("DELETE FROM chat_channels WHERE id = $1", [channel_id]);

      await logAudit("DELETE", "CHAT_CHANNEL", `Đã xóa vĩnh viễn nhóm chat: ${channelName} (ID: ${channel_id}) bởi ${user_name || "Người dùng"}`);
      return NextResponse.json({ success: true, deleted_id: channel_id });
    }

    // 3. Toggle Emoji Reaction (M5: with row-lock)
    if (action === "toggle_reaction") {
      const { message_id, emoji, user_name } = body;
      const updatedReactions = await withTransaction(async (c) => {
        const res = await c.query("SELECT reactions FROM chat_messages WHERE id = $1 FOR UPDATE", [message_id]);
        if (res.rows.length === 0) throw new HttpError(404, "Không tìm thấy tin nhắn");

        const reactions = res.rows[0].reactions || {};
        const currentUsers: string[] = reactions[emoji] || [];

        if (currentUsers.includes(user_name)) {
          reactions[emoji] = currentUsers.filter((u: string) => u !== user_name);
          if (reactions[emoji].length === 0) delete reactions[emoji];
        } else {
          reactions[emoji] = [...currentUsers, user_name];
        }

        await c.query("UPDATE chat_messages SET reactions = $1 WHERE id = $2", [JSON.stringify(reactions), message_id]);
        return reactions;
      });
      return NextResponse.json({ success: true, reactions: updatedReactions });
    }

    // 4. Toggle Pin Message (M5: with row-lock)
    if (action === "toggle_pin" || action === "pin_message") {
      const { message_id, channel_id, is_pinned } = body;
      const result = await withTransaction(async (c) => {
        const res = await c.query("SELECT is_pinned, content, sender_name, channel_id, created_at FROM chat_messages WHERE id = $1 FOR UPDATE", [message_id]);
        if (res.rows.length === 0) throw new HttpError(404, "Không tìm thấy tin nhắn");

        const targetChannelId = channel_id || res.rows[0].channel_id;
        const newPinned = typeof is_pinned === "boolean" ? is_pinned : !res.rows[0].is_pinned;
        await c.query("UPDATE chat_messages SET is_pinned = $1 WHERE id = $2", [newPinned, message_id]);

        // Update pinned_messages array in channel with row lock
        let pins: any[] = [];
        if (targetChannelId) {
          const chRes = await c.query("SELECT pinned_messages FROM chat_channels WHERE id = $1 FOR UPDATE", [targetChannelId]);
          pins = Array.isArray(chRes.rows[0]?.pinned_messages) ? [...chRes.rows[0].pinned_messages] : [];
          pins = pins.filter((p: any) => Number(p.id) !== Number(message_id));
          if (newPinned) {
            pins.push({
              id: message_id,
              content: res.rows[0].content,
              sender_name: res.rows[0].sender_name,
              created_at: res.rows[0].created_at,
              pinned_by: ident.name,
              pinned_at: new Date().toISOString()
            });
          }
          await c.query("UPDATE chat_channels SET pinned_messages = $1 WHERE id = $2", [JSON.stringify(pins), targetChannelId]);
        }
        return { is_pinned: newPinned, pinned_messages: pins };
      });
      return NextResponse.json({ success: true, is_pinned: result.is_pinned, pinned_messages: result.pinned_messages });
    }

    // 6. Mark Read Action
    if (action === "mark_read") {
      const channel_id = body?.channel_id || searchParams.get("channel_id");
      const user = body?.user || searchParams.get("user") || "";
      const last_id = body?.last_message_id || searchParams.get("last_message_id");

      if (channel_id && user) {
        const maxRes = await query("SELECT COALESCE(MAX(id), 0)::int as max_id FROM chat_messages WHERE channel_id = $1", [channel_id]);
        const maxId = Number(maxRes.rows[0]?.max_id) || 0;
        const parsedLast = Number(last_id) || 0;
        const msgId = parsedLast > 0 && parsedLast <= 2147483647 ? Math.max(maxId, parsedLast) : maxId;
        await query(
          `INSERT INTO chat_channel_reads (channel_id, user_name, last_read_message_id, last_read_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (channel_id, user_name)
           DO UPDATE SET last_read_message_id = GREATEST(chat_channel_reads.last_read_message_id, EXCLUDED.last_read_message_id),
                         last_read_at = NOW()`,
          [channel_id, user, msgId]
        ).catch((e) => console.error("[MARK_READ_ERR]:", e?.message || e));
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Hành động POST không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Chat API POST Error:", error);
    return apiErrorResponse(error);
  }
}
