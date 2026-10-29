import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../../__tests__/helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../db";
import { LocalFileStore, readAttachment, saveAttachment, setFileStore, sniffMime } from "../files";
import { notifyUsers } from "../notifications";
import { enqueueEvent } from "../outbox";
import { onEvent, processOutbox } from "../worker";

const actor = { userId: 1, name: "Người tải" };
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-files-"));
  setFileStore(new LocalFileStore(dir));
});
afterAll(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await closeFactoryPool();
});

describe("attachments", () => {
  it("stores content by checksum and verifies it on read", async () => {
    const saved = await withTransaction((tx) =>
      saveAttachment(tx, actor, { entityType: "lot", entityId: "x", category: "COA", fileName: "../../coa.pdf", mimeType: "application/pdf", data: pdf })
    );
    const back = await withTransaction((tx) => readAttachment(tx, saved.id));
    expect(back.data.equals(pdf)).toBe(true);
    expect(back.fileName).toBe("coa.pdf"); // path stripped
    fs.writeFileSync(path.join(dir, saved.sha256.slice(0, 2), saved.sha256), "tampered");
    await expect(withTransaction((tx) => readAttachment(tx, saved.id))).rejects.toThrow(/checksum/);
  });

  it("refuses a file whose content does not match its declared type or category", async () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    expect(sniffMime(exe)).toBeNull();
    const base = { entityType: "lot", entityId: "x", fileName: "coa.pdf" };
    await expect(withTransaction((tx) => saveAttachment(tx, actor, { ...base, category: "COA", mimeType: "application/pdf", data: exe }))).rejects.toThrow(/không khớp/);
    await expect(withTransaction((tx) => saveAttachment(tx, actor, { ...base, category: "SDS", mimeType: "image/png", data: pdf }))).rejects.toThrow(/không được chấp nhận/);
  });
});

describe("outbox worker", () => {
  it("delivers events, retries a failing handler and isolates it from the others", async () => {
    // isolate from events left by other test files (some need gateways this file does not set up)
    await getFactoryPool().query("UPDATE core.outbox_event SET processed_at = now() WHERE processed_at IS NULL");
    let calls = 0;
    onEvent("test.flaky", async () => {
      calls++;
      if (calls === 1) throw new Error("tạm thời lỗi");
    });
    const delivered: string[] = [];
    onEvent("test.ok", async (_tx, ev) => {
      delivered.push(ev.payload.n);
    });
    const ids = await withTransaction(async (tx) => [await enqueueEvent(tx, "test.flaky", {}), await enqueueEvent(tx, "test.ok", { n: "a" })]);
    const first = await processOutbox();
    expect(first).toEqual({ processed: 1, failed: 1 });
    expect(delivered).toEqual(["a"]);
    const flaky = (await getFactoryPool().query("SELECT attempts, last_error, processed_at FROM core.outbox_event WHERE id = $1", [ids[0]])).rows[0];
    expect(flaky).toMatchObject({ attempts: 1, last_error: "tạm thời lỗi", processed_at: null });
    await getFactoryPool().query("UPDATE core.outbox_event SET available_at = now() WHERE id = $1", [ids[0]]);
    expect(await processOutbox()).toEqual({ processed: 1, failed: 0 });
  });

  it("never notifies a user twice for the same event", async () => {
    const key = `ev-${Date.now()}`;
    const n1 = await withTransaction((tx) => notifyUsers(tx, [5, 5, 6], { type: "T", title: "Lô chờ QC", sourceKey: key }));
    const n2 = await withTransaction((tx) => notifyUsers(tx, [5, 6], { type: "T", title: "Lô chờ QC", sourceKey: key }));
    expect([n1, n2]).toEqual([2, 0]);
  });
});
