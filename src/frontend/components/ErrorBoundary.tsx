"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in component:", error, errorInfo);
    const msg = `${error?.name || ""} ${error?.message || ""}`;
    if (/ChunkLoadError|Failed to load chunk|Loading chunk [\w-]+ failed|Importing a module script failed/i.test(msg)) {
      try {
        const lastReload = Number(sessionStorage.getItem("agy_chunk_reload_ts") || "0");
        if (Date.now() - lastReload > 15000) {
          sessionStorage.setItem("agy_chunk_reload_ts", String(Date.now()));
          window.location.reload();
          return;
        }
      } catch {
        window.location.reload();
        return;
      }
    }
    this.setState({ error, errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[70vh] flex flex-col items-center justify-center p-8 text-slate-200 bg-slate-950/90 rounded-2xl border border-red-500/30 m-4">
          <AlertTriangle className="w-14 h-14 text-red-500 mb-4 animate-pulse" />
          <h2 className="text-xl font-bold text-white mb-2 font-mono">
            {this.props.fallbackTitle || "Đã xảy ra lỗi khi tải giao diện"}
          </h2>
          <p className="text-sm text-slate-400 max-w-xl text-center mb-4">
            {this.state.error?.message || "Không thể khởi tạo giao diện thành phần này."}
          </p>
          {this.state.error?.stack && (
            <pre className="text-[11px] font-mono bg-black/60 p-4 rounded-xl max-w-3xl max-h-60 overflow-auto text-red-400 border border-red-950/60 mb-4 whitespace-pre-wrap">
              {this.state.error.stack}
            </pre>
          )}
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Tải lại trang (Reload)
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
