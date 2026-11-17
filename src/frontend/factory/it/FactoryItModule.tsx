"use client";

import React from "react";
import { useFactoryMe } from "../api";
import { Empty } from "../ui";
import { ProjectsView } from "../rd/ProjectsView";
import { TransferView } from "../rd/TransferView";
import { SoftwareLifecycleView } from "../device/SoftwareLifecycleView";

/**
 * Phòng IT (Khối Kinh Doanh): IT chung và nghiên cứu – phát triển phần mềm.
 * Vòng đời phần mềm (IEC 62304), dự án phần mềm (Stage-Gate) và bản phát hành phần mềm.
 * Dữ liệu và quyền dùng chung hạ tầng phần mềm của phân hệ Kỹ thuật – Thiết bị (ownerModule = DEVICE).
 */
export function FactoryItModule() {
  const me = useFactoryMe();
  const perms = new Set(me.data?.permissions ?? []);

  if (me.isLoading) return <div className="text-sm text-slate-400 p-6">Đang tải…</div>;
  if (!perms.has("it.view")) {
    return <Empty>Bạn chưa có quyền trong Phòng IT (Phát triển phần mềm). Liên hệ quản trị viên để được cấp quyền.</Empty>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-cyan-200 dark:border-cyan-900 bg-cyan-50/60 dark:bg-cyan-950/30 px-4 py-2.5 text-xs font-bold text-cyan-900 dark:text-cyan-200">
        💻 Phòng IT — Khối Kinh Doanh · Nghiên cứu &amp; Phát triển phần mềm (IEC 62304)
      </div>
      <SoftwareLifecycleView />
      <ProjectsView
        domainLock="SOFTWARE"
        ownerModule="IT"
        canManage={perms.has("rd.project.manage")}
        canReviewGate={perms.has("rd.gate.review")}
        canEdit={Boolean(me.data?.is_root || perms.has("rd.project.edit"))}
        canDelete={Boolean(me.data?.is_root || perms.has("rd.project.delete"))}
      />
      <TransferView section="software" canManage={perms.has("rd.transfer.manage")} canAccept={false} />
    </div>
  );
}

export default FactoryItModule;
