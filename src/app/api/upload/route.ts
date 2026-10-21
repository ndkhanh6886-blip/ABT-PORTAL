import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import fs from "fs";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Giới hạn dung lượng tối đa cho file thầu, video kỹ thuật FSE, tài liệu hợp đồng: 200MB
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 MB

// Danh sách các phần mở rộng nguy hiểm bị chặn tuyệt đối để bảo vệ an ninh hệ thống
const DANGEROUS_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".sh", ".vbs", ".js", ".mjs", ".cjs", ".php", 
  ".py", ".com", ".scr", ".msi", ".dll", ".jar", ".ps1", ".hta", ".cpl", 
  ".pif", ".vbe", ".jse", ".wsf", ".wsh"
]);

// Danh sách định dạng được phép (Hỗ trợ 100% tài liệu kinh doanh, thầu y tế, kỹ thuật, kế toán)
const ALLOWED_EXTENSIONS = new Set([
  // Văn phòng & Hồ sơ mời/dự thầu
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".txt", ".rtf",
  // Hồ sơ nén thầu & dữ liệu đóng gói
  ".zip", ".rar", ".7z", ".tar", ".gz",
  // Hình ảnh chứng từ, CO/CQ, tem nhãn, chụp hiện trường
  ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".svg",
  // Hóa đơn điện tử, dữ liệu máy xét nghiệm y tế
  ".xml", ".json", ".pcrd", ".eds", ".tsv", ".dat",
  // Video ghi nhận hiện trường sự cố máy móc FSE
  ".mp4", ".mov", ".avi", ".webm", ".mkv"
]);

export async function POST(req: NextRequest) {
  try {
    // Phiên phải còn hiệu lực (tài khoản chưa bị khóa, mật khẩu chưa đổi): proxy chỉ kiểm tra chữ ký cookie
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    setAuditActor(authUser);
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Không tìm thấy file tải lên" }, { status: 400 });
    }

    // 1. Kiểm tra dung lượng tệp trước khi đọc dữ liệu vào bộ nhớ RAM
    if (file.size > MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      return NextResponse.json(
        { 
          error: `Dung lượng tệp (${sizeMB} MB) vượt quá giới hạn tối đa cho phép là 200 MB. Vui lòng nén bớt hoặc chia nhỏ tệp.` 
        }, 
        { status: 413 }
      );
    }

    // 2. Kiểm tra phần mở rộng tệp
    const ext = path.extname(file.name).toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `Định dạng tệp ${ext} bị chặn vì lý do an toàn bảo mật hệ thống!` }, 
        { status: 400 }
      );
    }

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { 
          error: `Định dạng tệp ${ext} không được hỗ trợ. Vui lòng tải các định dạng văn phòng, thầu, ảnh, video hoặc file nén (.zip, .rar, .7z).` 
        }, 
        { status: 400 }
      );
    }

    // 3. Đọc dữ liệu và ghi an toàn ra đĩa lưu trữ
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Chuẩn hóa tên file: loại bỏ ký tự lạ, giữ lại tiếng Việt không dấu hoặc ký tự hợp lệ
    const rawBase = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    const uniqueName = `${Date.now()}_${rawBase || "file"}${ext}`;
    const filePath = path.join(UPLOAD_DIR, uniqueName);

    fs.writeFileSync(filePath, buffer);

    const fileUrl = `/api/upload?file=${encodeURIComponent(uniqueName)}`;

    return NextResponse.json({
      success: true,
      name: file.name,
      fileName: uniqueName,
      url: fileUrl,
      size: file.size,
      type: file.type || "application/octet-stream",
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: error.message || "Lỗi trong quá trình lưu trữ tệp" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    // Phiên phải còn hiệu lực (tài khoản chưa bị khóa, mật khẩu chưa đổi): proxy chỉ kiểm tra chữ ký cookie
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    setAuditActor(authUser);
    const { searchParams } = new URL(req.url);
    const fileName = searchParams.get("file");

    if (!fileName) {
      return NextResponse.json({ error: "Thiếu tên tệp" }, { status: 400 });
    }

    const safeName = path.basename(fileName);
    const filePath = path.join(UPLOAD_DIR, safeName);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Tệp tin không tồn tại hoặc đã bị xóa" }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(safeName).toLowerCase();

    let contentType = "application/octet-stream";
    let isDownload = false;

    // MIME Types chuẩn
    switch (ext) {
      case ".pdf": contentType = "application/pdf"; break;
      // XML / JSON có thể chứa script chạy được trên trình duyệt (XHTML) -> luôn tải xuống, không mở trực tiếp
      case ".xml": contentType = "application/xml"; isDownload = true; break;
      case ".json": contentType = "application/json"; isDownload = true; break;
      case ".png": contentType = "image/png"; break;
      case ".jpg":
      case ".jpeg": contentType = "image/jpeg"; break;
      case ".webp": contentType = "image/webp"; break;
      case ".gif": contentType = "image/gif"; break;
      case ".bmp": contentType = "image/bmp"; break;
      case ".tif":
      case ".tiff": contentType = "image/tiff"; break;
      case ".svg": 
        contentType = "image/svg+xml"; 
        isDownload = true; // Chống SVG XSS
        break;
      case ".mp4": contentType = "video/mp4"; break;
      case ".webm": contentType = "video/webm"; break;
      case ".mov": contentType = "video/quicktime"; break;
      case ".avi": contentType = "video/x-msvideo"; break;
      case ".mkv": contentType = "video/x-matroska"; break;
      case ".xlsx": contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; break;
      case ".xls": contentType = "application/vnd.ms-excel"; break;
      case ".docx": contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; break;
      case ".doc": contentType = "application/msword"; break;
      case ".pptx": contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"; break;
      case ".ppt": contentType = "application/vnd.ms-powerpoint"; break;
      case ".csv": contentType = "text/csv; charset=utf-8"; break;
      case ".txt": contentType = "text/plain; charset=utf-8"; break;
      case ".zip": contentType = "application/zip"; isDownload = true; break;
      case ".rar": contentType = "application/x-rar-compressed"; isDownload = true; break;
      case ".7z": contentType = "application/x-7z-compressed"; isDownload = true; break;
      default:
        contentType = "application/octet-stream";
        isDownload = true;
    }

    const disposition = isDownload ? `attachment; filename="${safeName}"` : `inline; filename="${safeName}"`;

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
        "X-Content-Type-Options": "nosniff",
        // Tài liệu nội bộ: chỉ trình duyệt của người dùng được lưu đệm, không cho proxy / CDN lưu
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
