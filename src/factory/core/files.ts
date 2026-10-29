import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Tx } from "./db";
import type { Actor } from "./audit";
import { writeAudit } from "./audit";
import { invalid, notFound } from "./errors";

/** Where file content lives. Only metadata + SHA-256 go to the database. A MinIO/S3 driver can replace the local one. */
export interface FileStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

export class LocalFileStore implements FileStore {
  constructor(private readonly root: string) {}
  private resolve(key: string) {
    if (!/^[0-9a-f]{2}\/[0-9a-f]{64}$/.test(key)) throw new Error("storage key không hợp lệ");
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    const file = this.resolve(key);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, file); // atomic: a reader never sees half a file
  }
  async get(key: string) {
    return fs.promises.readFile(this.resolve(key));
  }
  async exists(key: string) {
    return fs.promises.access(this.resolve(key)).then(() => true, () => false);
  }
}

let store: FileStore | null = null;
export function getFileStore(): FileStore {
  if (!store) store = new LocalFileStore(process.env.FACTORY_FILE_DIR || path.join(process.cwd(), "uploads", "factory"));
  return store;
}
export function setFileStore(s: FileStore) {
  store = s;
}

export type FileCategory = "COA" | "SDS" | "IMAGE" | "RAW_DATA" | "DOCUMENT" | "DRAWING" | "SIGNED_RECORD";

const MB = 1024 * 1024;
const PDF = "application/pdf";
const IMAGES = ["image/png", "image/jpeg", "image/webp"];
const OFFICE = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const RULES: Record<FileCategory, { mimes: string[]; maxBytes: number }> = {
  COA: { mimes: [PDF, ...IMAGES], maxBytes: 20 * MB },
  SDS: { mimes: [PDF], maxBytes: 20 * MB },
  IMAGE: { mimes: IMAGES, maxBytes: 15 * MB },
  RAW_DATA: { mimes: [PDF, "text/csv", "text/plain", "application/zip", ...OFFICE, ...IMAGES], maxBytes: 200 * MB },
  DOCUMENT: { mimes: [PDF, ...OFFICE], maxBytes: 50 * MB },
  DRAWING: { mimes: [PDF, "application/zip", "image/png", "image/jpeg"], maxBytes: 100 * MB },
  SIGNED_RECORD: { mimes: [PDF, ...IMAGES], maxBytes: 20 * MB },
};

/** Content sniffing: the declared type must match the file's first bytes (a renamed .exe is refused). */
export function sniffMime(data: Buffer): string | null {
  const head = data.subarray(0, 12);
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return PDF;
  if (head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return "application/zip"; // also docx/xlsx
  if (!data.subarray(0, 4096).includes(0)) return "text/plain";
  return null;
}

function mimeMatches(declared: string, sniffed: string | null): boolean {
  if (!sniffed) return false;
  if (declared === sniffed) return true;
  if (sniffed === "application/zip") return declared === "application/zip" || OFFICE.includes(declared);
  if (sniffed === "text/plain") return declared === "text/csv" || declared === "text/plain";
  return false;
}

export async function saveAttachment(
  tx: Tx,
  actor: Actor,
  input: { entityType: string; entityId: string; category: FileCategory; fileName: string; mimeType: string; data: Buffer }
): Promise<{ id: string; sha256: string }> {
  const rule = RULES[input.category];
  if (!rule) throw invalid("Loại tài liệu không hợp lệ.");
  if (!input.data.length) throw invalid("File rỗng.");
  if (input.data.length > rule.maxBytes) throw invalid(`File vượt quá ${rule.maxBytes / MB} MB cho loại ${input.category}.`);
  if (!rule.mimes.includes(input.mimeType)) throw invalid(`Định dạng ${input.mimeType} không được chấp nhận cho loại ${input.category}.`);
  if (!mimeMatches(input.mimeType, sniffMime(input.data))) throw invalid("Nội dung file không khớp với định dạng khai báo.");
  const fileName = path.basename(input.fileName).replace(/[\u0000-\u001f]/g, "").slice(0, 255) || "file";
  const sha256 = crypto.createHash("sha256").update(input.data).digest("hex");
  const key = `${sha256.slice(0, 2)}/${sha256}`; // content-addressed: same file stored once
  const fileStore = getFileStore();
  if (!(await fileStore.exists(key))) await fileStore.put(key, input.data);
  const res = await tx.query(
    `INSERT INTO core.attachment (entity_type, entity_id, category, file_name, mime_type, size_bytes, sha256, storage_key, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [input.entityType, input.entityId, input.category, fileName, input.mimeType, input.data.length, sha256, key, actor.userId]
  );
  await writeAudit(tx, actor, {
    entityType: input.entityType,
    entityId: input.entityId,
    action: "attach",
    changes: { attachment: [null, `${fileName} (${sha256.slice(0, 12)}…)`] },
  });
  return { id: res.rows[0].id, sha256 };
}

/** Reads a file back and verifies its checksum, so silent corruption on disk is detected. */
export async function readAttachment(tx: Tx, id: string): Promise<{ fileName: string; mimeType: string; data: Buffer }> {
  const a = (await tx.query("SELECT * FROM core.attachment WHERE id = $1 AND voided_at IS NULL", [id])).rows[0];
  if (!a) throw notFound("file đính kèm");
  const data = await getFileStore().get(a.storage_key);
  if (crypto.createHash("sha256").update(data).digest("hex") !== a.sha256) {
    throw new Error(`File ${a.id} bị sai lệch checksum trên kho lưu trữ`);
  }
  return { fileName: a.file_name, mimeType: a.mime_type, data };
}
