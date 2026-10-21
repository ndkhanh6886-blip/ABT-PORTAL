import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import { query, logAudit } from "@/backend/db/db";
import { todayVN } from "@/backend/services/dates";

export async function GET(req: NextRequest) {
  try {
    // Phiên phải còn hiệu lực (tài khoản chưa bị khóa, mật khẩu chưa đổi): proxy chỉ kiểm tra chữ ký cookie
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    setAuditActor(authUser);
    if (!isAdminUser(authUser) && !hasPermission(authUser, "application.view")) {
      return forbiddenResponse("Bạn không có quyền xem dữ liệu phân hệ Application.");
    }
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "overview";

    if (action === "overview") {
      const [tasks, plans, daily, resources, issues] = await Promise.all([
        query("SELECT * FROM application_tasks ORDER BY id DESC"),
        query("SELECT * FROM application_plans ORDER BY id DESC"),
        query("SELECT * FROM application_daily_logs ORDER BY log_date DESC LIMIT 50"),
        query("SELECT * FROM application_resources ORDER BY id ASC"),
        query("SELECT * FROM application_issues ORDER BY id DESC"),
      ]);

      return NextResponse.json({
        tasks: tasks.rows,
        plans: plans.rows,
        daily: daily.rows,
        resources: resources.rows,
        issues: issues.rows,
      });
    }

    if (action === "plans") {
      const res = await query("SELECT * FROM application_plans ORDER BY id DESC");
      return NextResponse.json({ plans: res.rows });
    }

    if (action === "tasks") {
      const res = await query("SELECT * FROM application_tasks ORDER BY id DESC");
      return NextResponse.json({ tasks: res.rows });
    }

    return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Phiên phải còn hiệu lực (tài khoản chưa bị khóa, mật khẩu chưa đổi): proxy chỉ kiểm tra chữ ký cookie
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    setAuditActor(authUser);
    if (!isAdminUser(authUser) && !hasPermission(authUser, "application.view")) {
      return forbiddenResponse("Bạn không có quyền thao tác dữ liệu phân hệ Application.");
    }
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const body = await req.json();

    if (action === "plan") {
      const { id, week_number, year, employee_name, plan_data, status } = body;
      if (id && !isNaN(Number(id))) {
        await query(
          `UPDATE application_plans SET week_number=$1, year=$2, employee_name=$3, plan_data=$4, status=$5 WHERE id=$6`,
          [week_number, year, employee_name, JSON.stringify(plan_data || {}), status || "DRAFT", Number(id)]
        );
      } else {
        await query(
          `INSERT INTO application_plans (week_number, year, employee_name, plan_data, status)
           VALUES ($1, $2, $3, $4, $5)`,
          [week_number, year, employee_name, JSON.stringify(plan_data || {}), status || "DRAFT"]
        );
      }
      await logAudit("SAVE", "APPLICATION_PLAN", `Lưu kế hoạch tuần ${week_number}/${year} của ${employee_name}`);
      return NextResponse.json({ success: true });
    }

    if (action === "delete_plan") {
      const { id } = body;
      await query("DELETE FROM application_plans WHERE id = $1", [id]);
      await logAudit("DELETE", "APPLICATION_PLAN", `Xóa kế hoạch tuần ID ${id}`);
      return NextResponse.json({ success: true });
    }

    if (action === "task") {
      const { id, task_code, title, assignee_name, customer_name, task_type, priority, status, deadline, description, logs } = body;
      if (id && !isNaN(Number(id))) {
        await query(
          `UPDATE application_tasks SET title=$1, assignee_name=$2, customer_name=$3, task_type=$4, priority=$5, status=$6, deadline=$7, description=$8, logs=$9 WHERE id=$10`,
          [title, assignee_name, customer_name, task_type, priority, status, deadline, description, JSON.stringify(logs || []), Number(id)]
        );
      } else {
        const code = task_code || `APP-${Date.now().toString().slice(-5)}`;
        await query(
          `INSERT INTO application_tasks (task_code, title, assignee_name, customer_name, task_type, priority, status, deadline, description, logs)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [code, title, assignee_name, customer_name, task_type || "Demo máy", priority || "MEDIUM", status || "TODO", deadline, description, JSON.stringify(logs || [])]
        );
      }
      await logAudit("SAVE", "APPLICATION_TASK", `Lưu công việc ${title} (${assignee_name})`);
      return NextResponse.json({ success: true });
    }

    if (action === "delete_task") {
      const { id } = body;
      await query("DELETE FROM application_tasks WHERE id = $1", [id]);
      return NextResponse.json({ success: true });
    }

    if (action === "resource") {
      const { id, resource_code, name, category, status, current_location, assigned_to, notes } = body;
      if (id && !isNaN(Number(id))) {
        await query(
          `UPDATE application_resources SET name=$1, category=$2, status=$3, current_location=$4, assigned_to=$5, notes=$6 WHERE id=$7`,
          [name, category, status, current_location, assigned_to, notes, Number(id)]
        );
      } else {
        await query(
          `INSERT INTO application_resources (resource_code, name, category, status, current_location, assigned_to, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [resource_code, name, category, status, current_location, assigned_to, notes]
        );
      }
      return NextResponse.json({ success: true });
    }

    if (action === "issue") {
      const { id, ticket_code, customer_name, device_name, issue_description, severity, status, assigned_technician, resolution_steps } = body;
      if (id && !isNaN(Number(id))) {
        await query(
          `UPDATE application_issues SET customer_name=$1, device_name=$2, issue_description=$3, severity=$4, status=$5, assigned_technician=$6, resolution_steps=$7 WHERE id=$8`,
          [customer_name, device_name, issue_description, severity, status, assigned_technician, resolution_steps, Number(id)]
        );
      } else {
        const code = ticket_code || `INC-${Date.now().toString().slice(-5)}`;
        await query(
          `INSERT INTO application_issues (ticket_code, customer_name, device_name, issue_description, severity, status, assigned_technician, resolution_steps)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [code, customer_name, device_name, issue_description, severity || "MEDIUM", status || "OPEN", assigned_technician, resolution_steps]
        );
      }
      await logAudit("SAVE", "APPLICATION_ISSUE", `Lưu sự cố KH: ${customer_name}`);
      return NextResponse.json({ success: true });
    }

    if (action === "delete_issue") {
      const { id } = body;
      await query("DELETE FROM application_issues WHERE id = $1", [id]);
      return NextResponse.json({ success: true });
    }

    if (action === "daily") {
      const { log_date, employee_name, content, result } = body;
      await query(
        `INSERT INTO application_daily_logs (log_date, employee_name, content, result)
         VALUES ($1, $2, $3, $4)`,
        [log_date || todayVN(), employee_name, content, result]
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Hành động POST không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // Phiên phải còn hiệu lực (tài khoản chưa bị khóa, mật khẩu chưa đổi): proxy chỉ kiểm tra chữ ký cookie
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    setAuditActor(authUser);
    if (!isAdminUser(authUser) && !hasPermission(authUser, "application.view")) {
      return forbiddenResponse("Bạn không có quyền thao tác dữ liệu phân hệ Application.");
    }
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Thiếu ID" }, { status: 400 });

    if (action === "task") {
      await query("DELETE FROM application_tasks WHERE id = $1", [id]);
      return NextResponse.json({ success: true });
    }
    if (action === "plan") {
      await query("DELETE FROM application_plans WHERE id = $1", [id]);
      return NextResponse.json({ success: true });
    }
    if (action === "issue") {
      await query("DELETE FROM application_issues WHERE id = $1", [id]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Hành động DELETE không hợp lệ" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
