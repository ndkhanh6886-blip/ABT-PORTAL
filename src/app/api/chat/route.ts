import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction, HttpError, httpErrorStatus } from "@/backend/db/db";
import { getAuthorizedUser, unauthorizedResponse, setAuditActor } from "@/backend/services/authz";

/**
 * Identity of the chat user comes from the server session. The browser used to send `user` /
 * `sender_name` itself, so anyone could post as somebody else or read other people's private chats.
 */
type ChatIdentity = { name: string; aliases: string[]; isAdmin: boolean; department: string };

async function getChatIdentity(req: NextRequest): Promise<ChatIdentity | null> {
  const me = await getAuthorizedUser(req);
  setAuditActor(me);
  if (!me) return null;
  const name = String(me.full_name || me.username).trim();
  const aliases = new Set<string>([name, me.username].map(s => String(s || "").trim().toLowerCase()).filter(Boolean));
  try {
    const p = await query(
      `SELECT employee_code FROM personnel
        WHERE employee_code = $1 OR REPLACE(REPLACE(employee_code, 'NV-TBR-', 'TBR'), 'NV-VIA-', 'VIA') = $1 LIMIT 1`,
      [me.username]
    );
    if (p.rows[0]?.employee_code) aliases.add(String(p.rows[0].employee_code).toLowerCase());
  } catch {}
  const isAdmin = me.username === "admin";
  if (isAdmin) {
    aliases.add("admin");
    aliases.add("quản trị viên hệ thống");
  }
  return { name, aliases: Array.from(aliases), isAdmin, department: me.department || "" };
}

/** SQL condition (on alias `c`) for channels the user may see; the parameter must be a lowercase text[] of aliases. */
function channelAccessSql(aliasParam: string) {
  return `(
    (c.is_private = FALSE AND c.channel_type = 'CHANNEL')
    OR (c.channel_type = 'CHANNEL' AND c.department = 'Toàn công ty')
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

  // If both channelId and channelCode are provided, prefer exact match on channelCode if channelId points to a different channel_code
  if (cleanCode) {
    const codeRes = await query(
      `SELECT c.id FROM chat_channels c
        WHERE c.channel_code = $1
          AND ${channelAccessSql("$2::text[]")}
        LIMIT 1`,
      [cleanCode, ident.aliases]
    );
    if (codeRes.rows[0]?.id) {
      return Number(codeRes.rows[0].id);
    }
  }

  if (numId !== null) {
    const idRes = await query(
      `SELECT c.id, c.channel_code FROM chat_channels c
        WHERE c.id = $1::int
          AND ${channelAccessSql("$2::text[]")}
        LIMIT 1`,
      [numId, ident.aliases]
    );
    if (idRes.rows[0]?.id) {
      // Guard against stale fallback IDs: if caller explicitly asked for a standard department channel_code
      // but this ID in DB is a DIRECT/different channel, do NOT return the wrong channel!
      if (cleanCode && idRes.rows[0].channel_code && idRes.rows[0].channel_code !== cleanCode) {
        return null;
      }
      return Number(idRes.rows[0].id);
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

    // Ensure all 5 standard department channels exist in chat_channels and have correct type/privacy
    for (const ch of DEFAULT_DEPARTMENT_CHANNELS) {
      await query(
        `INSERT INTO chat_channels (channel_code, name, channel_type, department, description, is_private, created_by, members)
         SELECT $1::varchar, $2::varchar, 'CHANNEL', $3::varchar, $4::text, FALSE, 'Hệ Thống', '[]'::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM chat_channels WHERE channel_code = $1::varchar)`,
        [ch.channel_code, ch.name, ch.department, ch.description]
      ).catch(logFail(`kênh ${ch.channel_code}`));
    }

    // Ensure standard department channels always have channel_type = 'CHANNEL' and is_private = FALSE
    await query(`
      UPDATE chat_channels
      SET channel_type = 'CHANNEL', is_private = FALSE
      WHERE channel_code IN ('general', 'sales', 'application', 'warehouse', 'procurement')
        AND (channel_type IS DISTINCT FROM 'CHANNEL' OR is_private IS DISTINCT FROM FALSE)
    `).catch(logFail("kênh phòng ban"));

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
            OR TRIM(LOWER(username)) = TRIM(LOWER(REPLACE(REPLACE($1, 'NV-TBR-', 'TBR'), 'NV-VIA-', 'VIA')))
            OR TRIM(LOWER(username)) = TRIM(LOWER(REPLACE(REPLACE($1, 'NV-TBR', 'TBR'), 'NV-VIA', 'VIA')))
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
             LEFT JOIN personnel p ON (u.username = REPLACE(REPLACE(p.employee_code, 'NV-TBR-', 'TBR'), 'NV-VIA-', 'VIA') OR TRIM(LOWER(u.full_name)) = TRIM(LOWER(p.full_name)))
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

      let unreadSubquery = "0 as unread_count";
      if (cleanUser) {
        unreadSubquery = `
          COALESCE((
            SELECT COUNT(*) 
            FROM chat_messages m
            WHERE m.channel_id = c.id
              AND NOT (LOWER(TRIM(COALESCE(m.sender_name, ''))) = ANY($1::text[]))
              AND m.sender_name != 'Hệ Thống'
              AND m.content NOT ILIKE 'Bắt đầu cuộc trò chuyện%'
              AND m.content NOT ILIKE 'Đã tạo nhóm%'
              AND m.content NOT ILIKE 'Chào mừng đến với%'
              AND (
                m.id > COALESCE((
                  SELECT MAX(r.last_read_message_id)
                  FROM chat_channel_reads r
                  WHERE r.channel_id = c.id
                    AND LOWER(TRIM(r.user_name)) = ANY($1::text[])
                ), 0)
              )
              AND (
                EXISTS (
                  SELECT 1 FROM chat_channel_reads r2
                  WHERE r2.channel_id = c.id
                    AND LOWER(TRIM(r2.user_name)) = ANY($1::text[])
                )
                OR m.created_at >= NOW() - INTERVAL '14 days'
              )
          ), 0) as unread_count
        `;
      }

      let channelsQuery = `
        SELECT c.*, 
          (SELECT COUNT(*) FROM chat_messages m WHERE m.channel_id = c.id) as message_count,
          ${unreadSubquery},
          lm.last_message_id,
          lm.last_message_content,
          lm.last_message_sender,
          lm.last_message_time
        FROM chat_channels c
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
          LEFT JOIN users u ON (u.username = p.employee_code OR TRIM(LOWER(u.full_name)) = TRIM(LOWER(p.full_name)))
          WHERE p.employee_code IS NOT NULL AND p.employee_code != '' AND (p.status IS NULL OR p.status != 'INACTIVE')

          UNION ALL

          SELECT 
            u.id as id,
            u.id as user_id,
            u.username as username,
            u.full_name as full_name,
            COALESCE(u.department, 'Ban Giám Đốc') as department,
            'Quản trị viên hệ thống' as position,
            COALESCE(u.email, 'admin@tbr.vn') as email,
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
        query("SELECT id, task_code, title, department, assignee_name, status FROM company_tasks ORDER BY id DESC LIMIT 50"),
        query("SELECT id, workflow_code, title, requester_dept, target_dept, status FROM workflow_requests ORDER BY id DESC LIMIT 50")
      ]);

      const formattedChannels = (channelsRes.rows || []).map((c: any) => {
        let members = c.members;
        if (typeof members === "string") {
          try {
            members = JSON.parse(members);
          } catch (e) {
            members = members.replace(/[{}]/g, "").split(",").map((s: string) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
          }
        }
        if (!Array.isArray(members)) members = [];
        return {
          ...c,
          name: c.name || "Kênh chat",
          members: members.map((m: any) => String(m || "").trim()).filter(Boolean)
        };
      });

      return NextResponse.json({
        channels: formattedChannels,
        personnel: personnelRes.rows || [],
        tasks: tasksRes.rows || [],
        workflows: workflowsRes.rows || []
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
      const res = await query(
        `SELECT * FROM chat_messages m
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
         ORDER BY m.id ASC
         LIMIT 200`,
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

      return NextResponse.json({
        channel_id: resolvedChannelId,
        channel_code: resolvedCode,
        channel_type: resolvedType,
        messages: res.rows
      });
    }

    // 2.5 Mark channel messages as read explicitly
    if (action === "mark_read") {
      const channelId = searchParams.get("channel_id");
      const user = ident.name;
      if (channelId && !(await canAccessChannel(ident, channelId))) return chatForbidden();
      const lastId = searchParams.get("last_message_id");

      if (channelId && user) {
        let msgId = Number(lastId) || 0;
        if (!msgId) {
          const maxRes = await query("SELECT COALESCE(MAX(id), 0) as max_id FROM chat_messages WHERE channel_id = $1", [channelId]);
          msgId = Number(maxRes.rows[0]?.max_id) || 0;
        }
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

      const res = await query(
        `SELECT m.*, c.name as channel_name 
         FROM chat_messages m
         JOIN chat_channels c ON m.channel_id = c.id
         WHERE m.content ILIKE $1 AND ${channelAccessSql("$2::text[]")}
         ORDER BY m.id DESC LIMIT 50`,
        [`%${q}%`, ident.aliases]
      );

      return NextResponse.json({ messages: res.rows });
    }

    return NextResponse.json({ error: "Hành động GET không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    console.error("Chat API GET Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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
      const ch = await query("SELECT created_by FROM chat_channels WHERE id = $1", [body.channel_id]);
      const owner = String(ch.rows[0]?.created_by || "").trim().toLowerCase();
      if (ch.rows[0] && !ident.aliases.includes(owner) && !ident.isAdmin) {
        return NextResponse.json({ error: "Chỉ người tạo nhóm hoặc Quản trị viên mới được xóa nhóm." }, { status: 403 });
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

      // Check or resolve channel strictly (preferring channel_code consistency if both are provided)
      const resolvedChannelId = await canAccessChannel(ident, channel_id, channel_code);
      if (!resolvedChannelId) {
        return NextResponse.json({ error: "Không tìm thấy kênh chat hoặc bạn không có quyền truy cập" }, { status: 404 });
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
          JSON.stringify(attachments || []),
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
             OR TRIM(LOWER(username)) = TRIM(LOWER(REPLACE(REPLACE($1, 'NV-TBR-', 'TBR'), 'NV-VIA-', 'VIA')))
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
          department || "TBR",
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
          "TBR",
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

      const res = await query(
        `UPDATE chat_channels 
         SET name = $1, department = $2, description = $3, is_private = $4 
         WHERE id = $5 RETURNING *`,
        [name.trim(), department || "Liên phòng ban", description || "", !!is_private, channel_id]
      );

      if (res.rows.length === 0) {
        return NextResponse.json({ error: "Không tìm thấy nhóm chat" }, { status: 404 });
      }

      const updated = res.rows[0];
      await query(
        `INSERT INTO chat_messages (channel_id, channel_code, sender_name, sender_role, sender_dept, content)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          channel_id,
          updated.channel_code,
          "Hệ Thống",
          "Cài đặt",
          "TBR",
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
      const currentMembers: string[] = Array.isArray(channel.members) ? channel.members : [];
      const updatedMembers = currentMembers.filter(m => m !== member_name);

      await query("UPDATE chat_channels SET members = $1 WHERE id = $2", [JSON.stringify(updatedMembers), channel_id]);

      await query(
        `INSERT INTO chat_messages (channel_id, channel_code, sender_name, sender_role, sender_dept, content)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          channel_id,
          channel.channel_code,
          "Hệ Thống",
          "Thông báo",
          "TBR",
          `${removed_by || "Quản trị"} đã xóa ${member_name} khỏi nhóm trao đổi.`
        ]
      );

      return NextResponse.json({ success: true, members: updatedMembers });
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
      const currentMembers: string[] = Array.isArray(channel.members) ? channel.members : [];
      const updatedMembers = currentMembers.filter(m => m !== member_name);

      await query("UPDATE chat_channels SET members = $1 WHERE id = $2", [JSON.stringify(updatedMembers), channel_id]);

      await query(
        `INSERT INTO chat_messages (channel_id, channel_code, sender_name, sender_role, sender_dept, content)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          channel_id,
          channel.channel_code,
          "Hệ Thống",
          "Thông báo",
          "TBR",
          `${member_name} đã rời khỏi nhóm trao đổi.`
        ]
      );

      return NextResponse.json({ success: true, members: updatedMembers });
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

      // Delete messages first, then channel
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
        let msgId = Number(last_id) || 0;
        if (!msgId) {
          const maxRes = await query("SELECT COALESCE(MAX(id), 0) as max_id FROM chat_messages WHERE channel_id = $1", [channel_id]);
          msgId = Number(maxRes.rows[0]?.max_id) || 0;
        }
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
    return NextResponse.json({ error: error.message || String(error) }, { status: httpErrorStatus(error) });
  }
}
