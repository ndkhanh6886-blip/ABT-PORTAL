import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/backend/services/apiErrors";
import { getAuthorizedUser, unauthorizedResponse, setAuditActor } from "@/backend/services/authz";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { Readable } from "stream";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Giới hạn dung lượng tối đa cho file thầu (.rar, .zip, .pdf), video kỹ thuật FSE, tài liệu hợp đồng: 250MB
const MAX_FILE_SIZE = 250 * 1024 * 1024; // 250 MB

// Danh sách các phần mở rộng thực thi nguy hiểm bị chặn tuyệt đối để bảo vệ an ninh hệ thống
const DANGEROUS_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".sh", ".vbs", ".js", ".mjs", ".cjs", ".php",
  ".py", ".com", ".scr", ".msi", ".dll", ".jar", ".ps1", ".hta", ".cpl",
  ".pif", ".vbe", ".jse", ".wsf", ".wsh"
]);

// Danh sách định dạng được phép (Hỗ trợ đầy đủ tài liệu kinh doanh, thầu y tế, kỹ thuật, kế toán)
const ALLOWED_EXTENSIONS = new Set([
  // Văn phòng & Hồ sơ mời/dự thầu
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".xlsm", ".xlsb", ".ppt", ".pptx", ".csv", ".txt", ".rtf", ".odt", ".ods", ".odp",
  // Hồ sơ nén thầu & dữ liệu đóng gói
  ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz",
  // Hình ảnh chứng từ, CO/CQ, tem nhãn, chụp hiện trường
  ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".svg", ".heic", ".heif",
  // Hóa đơn điện tử, dữ liệu máy xét nghiệm y tế, bản vẽ kỹ thuật
  ".xml", ".json", ".pcrd", ".eds", ".tsv", ".dat", ".dwg", ".dxf", ".msg", ".eml", ".log",
  // Video & âm thanh ghi nhận hiện trường sự cố máy móc FSE
  ".mp4", ".mov", ".avi", ".webm", ".mkv", ".mp3", ".wav", ".m4a"
]);

function validateFileExtensionAndSize(originalName: string, totalSize: number): string | null {
  if (totalSize > MAX_FILE_SIZE) {
    const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
    return `Dung lượng tệp (${sizeMB} MB) vượt quá giới hạn tối đa cho phép là 250 MB. Vui lòng nén bớt hoặc chia nhỏ tệp.`;
  }

  const ext = path.extname(originalName || "").toLowerCase();
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return `Định dạng tệp ${ext} bị chặn vì lý do an toàn bảo mật hệ thống!`;
  }

  if (!ext) {
    return "Tệp không có phần mở rộng (.pdf, .xlsx, .jpg...) nên không thể xác định định dạng an toàn. Vui lòng đổi tên tệp rồi tải lại.";
  }

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `Định dạng tệp ${ext} không được hỗ trợ. Vui lòng tải các định dạng văn phòng, thầu, ảnh, video hoặc file nén (.zip, .rar, .7z).`;
  }

  return null;
}

function buildContentAddressedFileName(originalName: string, sha256Hex: string): string {
  const ext = path.extname(originalName || "").toLowerCase();
  const cleanHash = String(sha256Hex || "").toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 32);
  if (cleanHash.length >= 16) {
    // Lưu trữ theo mã băm nội dung (Content-Addressable Storage): cùng 1 hình ảnh/tệp dù gửi hay dán (Ctrl+V) bao nhiêu lần cũng chỉ lưu 1 bản duy nhất trên ổ cứng
    return `sha256_${cleanHash}${ext}`;
  }
  const baseRaw = path.basename(originalName || "file", ext);
  const normalizedBase = baseRaw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
  return `${Date.now()}_${crypto.randomBytes(6).toString("hex")}_${normalizedBase || "file"}${ext}`;
}

async function computeFileSha256OnDisk(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    setAuditActor(authUser);

    const formData = await req.formData();

    // Hỗ trợ tải lên theo từng phần (Chunked Upload) cho các tệp lớn (.rar, .zip, .pdf, video > 2MB)
    // giúp vượt qua mọi giới hạn body size (10MB) của Next.js Proxy, Nginx hoặc Cloudflare
    const chunkBlob = formData.get("chunk") as File | null;
    const uploadIdRaw = formData.get("uploadId");

    if (chunkBlob && uploadIdRaw) {
      const uploadId = String(uploadIdRaw).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
      const chunkIndex = Number(formData.get("chunkIndex") ?? 0);
      const totalChunks = Number(formData.get("totalChunks") ?? 1);
      const originalFileName = String(formData.get("fileName") || chunkBlob.name || "file.bin");
      const totalFileSize = Number(formData.get("fileSize") ?? chunkBlob.size);
      const fileType = String(formData.get("fileType") || chunkBlob.type || "application/octet-stream");

      if (!uploadId || isNaN(chunkIndex) || isNaN(totalChunks) || totalChunks < 1 || chunkIndex < 0 || chunkIndex >= totalChunks) {
        return NextResponse.json({ error: "Thông tin phân mảnh tệp (chunk) không hợp lệ" }, { status: 400 });
      }

      const validationError = validateFileExtensionAndSize(originalFileName, totalFileSize);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }

      // File tạm gắn với tài khoản: người khác không thể ghi chèn vào phần tải lên của mình
      const partPath = path.join(UPLOAD_DIR, `.part_${Number(authUser.id) || 0}_${uploadId}`);

      // Nếu là chunk đầu tiên (0), xóa file tạm cũ nếu có
      if (chunkIndex === 0) {
        await fsp.unlink(partPath).catch(() => {}); // chưa có file tạm: không có gì để xóa
      }

      const chunkBytes = await chunkBlob.arrayBuffer();
      await fsp.appendFile(partPath, Buffer.from(chunkBytes));

      // Kiểm tra dung lượng tích lũy thực tế trên đĩa không vượt quá MAX_FILE_SIZE
      const stat = await fsp.stat(partPath);
      if (stat.size > MAX_FILE_SIZE) {
        await fsp.unlink(partPath).catch(err => console.error("[upload] Không xóa được tệp tạm quá cỡ:", err));
        return NextResponse.json(
          { error: "Tổng dung lượng tệp tải lên vượt quá giới hạn tối đa 250 MB." },
          { status: 413 }
        );
      }

      // Chưa phải chunk cuối -> trả về trạng thái đã nhận chunk
      if (chunkIndex < totalChunks - 1) {
        return NextResponse.json({
          success: true,
          partial: true,
          chunkIndex,
          totalChunks,
          receivedBytes: stat.size
        });
      }

      // Đã nhận đủ chunk cuối -> tính mã băm SHA-256 để chống trùng lặp tệp trên ổ đĩa
      const sha256Hex = await computeFileSha256OnDisk(partPath);
      const uniqueName = buildContentAddressedFileName(originalFileName, sha256Hex);
      const finalPath = path.join(UPLOAD_DIR, uniqueName);
      const alreadyExists = fs.existsSync(finalPath);
      if (alreadyExists) {
        await fsp.unlink(partPath).catch(() => {});
      } else {
        await fsp.rename(partPath, finalPath);
      }

      const fileUrl = `/api/upload?file=${encodeURIComponent(uniqueName)}&name=${encodeURIComponent(originalFileName)}`;

      return NextResponse.json({
        success: true,
        partial: false,
        name: originalFileName,
        fileName: uniqueName,
        url: fileUrl,
        size: stat.size || totalFileSize,
        type: fileType,
        sha256: sha256Hex,
        deduplicated: alreadyExists,
      });
    }

    // Luồng tải lên 1 lần (Single-shot Upload) cho các tệp nhỏ
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Không tìm thấy file tải lên" }, { status: 400 });
    }

    const validationError = validateFileExtensionAndSize(file.name, file.size);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: file.size > MAX_FILE_SIZE ? 413 : 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const sha256Hex = crypto.createHash("sha256").update(buf).digest("hex");
    const uniqueName = buildContentAddressedFileName(file.name, sha256Hex);
    const filePath = path.join(UPLOAD_DIR, uniqueName);
    const alreadyExists = fs.existsSync(filePath);

    if (!alreadyExists) {
      await fsp.writeFile(filePath, buf);
    }

    const fileUrl = `/api/upload?file=${encodeURIComponent(uniqueName)}&name=${encodeURIComponent(file.name)}`;

    return NextResponse.json({
      success: true,
      name: file.name,
      fileName: uniqueName,
      url: fileUrl,
      size: file.size,
      type: file.type || "application/octet-stream",
      sha256: sha256Hex,
      deduplicated: alreadyExists,
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    return apiErrorResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthorizedUser(req);
    if (!authUser) return unauthorizedResponse();
    setAuditActor(authUser);
    const { searchParams } = new URL(req.url);
    const fileName = searchParams.get("file");
    const displayFileName = searchParams.get("name");

    if (!fileName) {
      return NextResponse.json({ error: "Thiếu tên tệp" }, { status: 400 });
    }

    const safeName = path.basename(fileName);
    const filePath = path.join(UPLOAD_DIR, safeName);

    const fileStat = await fsp.stat(filePath).catch(() => null);
    if (!fileStat || !fileStat.isFile()) {
      return NextResponse.json({ error: "Tệp tin không tồn tại hoặc đã bị xóa" }, { status: 404 });
    }

    const ext = path.extname(safeName).toLowerCase();

    let contentType = "application/octet-stream";
    let isDownload = false;

    switch (ext) {
      case ".pdf": contentType = "application/pdf"; break;
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
        isDownload = true;
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
      case ".rar": contentType = "application/vnd.rar"; isDownload = true; break;
      case ".7z": contentType = "application/x-7z-compressed"; isDownload = true; break;
      default:
        contentType = "application/octet-stream";
        isDownload = true;
    }

    const downloadTitle = displayFileName ? path.basename(displayFileName) : safeName;
    const encodedUtf8Name = encodeURIComponent(downloadTitle);
    const disposition = isDownload
      ? `attachment; filename="${safeName}"; filename*=UTF-8''${encodedUtf8Name}`
      : `inline; filename="${safeName}"; filename*=UTF-8''${encodedUtf8Name}`;

    const baseHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400, immutable",
      "Accept-Ranges": "bytes",
    };

    // Gửi tệp dạng luồng (stream) thay vì đọc cả tệp vào RAM; hỗ trợ Range để tua video
    const size = fileStat.size;
    const range = req.headers.get("range");
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as unknown as ReadableStream;
      return new NextResponse(stream, {
        status: 206,
        headers: { ...baseHeaders, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
      });
    }

    const stream = Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream;
    return new NextResponse(stream, { headers: { ...baseHeaders, "Content-Length": String(size) } });
  } catch (error: any) {
    console.error("[upload] Lỗi đọc tệp:", error);
    return apiErrorResponse(error);
  }
}
