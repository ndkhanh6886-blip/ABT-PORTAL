"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  MessageSquare,
  X,
  Maximize2,
  Minimize2,
  Send,
  Hash,
  Paperclip,
  Check,
  ChevronDown,
  ExternalLink,
  Users,
  Search,
  Plus,
  Pin,
  FileText,
  Image as ImageIcon
} from "lucide-react";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { MainTab } from "@/frontend/components/Navbar";
import {
  formatVietnamTime,
  formatVietnamDate,
  formatVietnamDateTime,
  getVietnamDateLabel
} from "@/backend/services/utils";

interface FloatingChatWidgetProps {
  activeTab: MainTab;
  setActiveTab: (tab: MainTab) => void;
}

export const FloatingChatWidget: React.FC<FloatingChatWidgetProps> = ({ activeTab, setActiveTab }) => {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false); // Expanded in-place window
  const [channels, setChannels] = useState<any[]>([]);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [inputAttachments, setInputAttachments] = useState<Array<{ name: string; url: string; size?: number; type?: string }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [filterType, setFilterType] = useState<"ALL" | "DIRECT" | "GROUP">("ALL");
  const [quickSearch, setQuickSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeChannelIdRef = useRef<number | null>(null);

  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  const currentUserName = user?.name || (user as any)?.full_name || "Nhân viên TBRs";
  const currentUserKey = String((user as any)?.username || currentUserName).trim().toLowerCase();
  const currentUserRole = user?.role || "Thành viên";
  const currentUserDept = (user as any)?.department || "Kinh Doanh";

  const markChannelAsReadLocal = (channelId: number, lastMsgId?: number) => {
    if (!channelId || typeof window === "undefined") return;
    try {
      localStorage.setItem(`chat_last_read_${channelId}_${currentUserKey}`, new Date().toISOString());
      if (lastMsgId && Number(lastMsgId) > 0) {
        localStorage.setItem(`chat_last_read_id_${channelId}_${currentUserKey}`, String(lastMsgId));
      }
    } catch {}
    setChannels(prev => prev.map(c => c.id === channelId ? { ...c, unread_count: 0 } : c));
    fetch("/api/chat?action=mark_read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: channelId, user: currentUserName, last_message_id: lastMsgId })
    }).catch(() => {});
  };

  const getChannelUnreadCount = (c: any): number => {
    if (!c) return 0;
    if (isOpen && activeChannelId === c.id) return 0;
    const apiUnread = Math.max(0, Number(c.unread_count) || 0);
    const lastMsgId = Number(c.last_message_id) || 0;
    if (typeof window !== "undefined" && lastMsgId > 0) {
      try {
        const localReadId = Number(localStorage.getItem(`chat_last_read_id_${c.id}_${currentUserKey}`)) || 0;
        if (localReadId >= lastMsgId) {
          return 0;
        }
      } catch {}
    }
    return apiUnread;
  };

  const totalUnreadCount = channels.reduce((sum, c) => sum + getChannelUnreadCount(c), 0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.dispatchEvent(new CustomEvent("tbr-chat-unread-updated", { detail: { count: totalUnreadCount, userKey: currentUserKey } }));
    } catch {}
  }, [totalUnreadCount, currentUserKey]);

  // Fetch Channels & Personnel on mount and poll every 6s even when closed so unread badge stays live
  useEffect(() => {
    const loadChannels = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      fetch(`/api/chat?action=channels&user=${encodeURIComponent(currentUserName)}`)
        .then(res => res.json())
        .then(data => {
          if (data.channels && data.channels.length > 0) {
            setChannels(data.channels);
            setPersonnel(data.personnel || []);
            setActiveChannelId(prev => {
              if (prev) return prev;
              const defaultCh =
                data.channels.find((c: any) => c.channel_code === "general" && c.channel_type === "CHANNEL") ||
                data.channels.find((c: any) => c.channel_type === "CHANNEL") ||
                data.channels[0];
              return defaultCh ? defaultCh.id : null;
            });
          }
        })
        .catch(() => {});
    };
    loadChannels();
    const interval = setInterval(loadChannels, 6000);
    return () => clearInterval(interval);
  }, [currentUserName]);

  // Fetch Messages for active channel
  useEffect(() => {
    if (isOpen && activeChannelId) {
      const requestedId = activeChannelId;
      activeChannelIdRef.current = requestedId;
      const ch = channels.find(c => c.id === requestedId);
      const chCode = ch?.channel_code || "";
      setMessages([]);
      markChannelAsReadLocal(requestedId);
      fetch(
        `/api/chat?action=messages&channel_id=${requestedId}&channel_code=${encodeURIComponent(chCode)}&user=${encodeURIComponent(currentUserName)}`
      )
        .then(res => res.json())
        .then(data => {
          if (activeChannelIdRef.current !== requestedId) return;
          if (data.messages && Array.isArray(data.messages)) {
            setMessages(data.messages);
            const lastMsg = data.messages[data.messages.length - 1];
            if (lastMsg?.id) markChannelAsReadLocal(requestedId, lastMsg.id);
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
          } else {
            setMessages([]);
          }
        })
        .catch(err => console.error(err));
    }
  }, [isOpen, activeChannelId, currentUserName]);

  // Periodic polling when chat widget is open
  useEffect(() => {
    if (!isOpen || !activeChannelId) return;
    const polledId = activeChannelId;
    const ch = channels.find(c => c.id === polledId);
    const chCode = ch?.channel_code || "";
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      fetch(
        `/api/chat?action=messages&channel_id=${polledId}&channel_code=${encodeURIComponent(chCode)}&user=${encodeURIComponent(currentUserName)}`
      )
        .then(res => res.json())
        .then(data => {
          if (activeChannelIdRef.current !== polledId) return;
          if (data.messages && Array.isArray(data.messages)) {
            setMessages(data.messages);
            const lastMsg = data.messages[data.messages.length - 1];
            if (lastMsg?.id) markChannelAsReadLocal(polledId, lastMsg.id);
          }
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, [isOpen, activeChannelId, currentUserName, channels]);

  // Upload files / images with Base64 Data URL fallback so it never gets stuck
  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Không thể đọc tệp"));
      reader.readAsDataURL(file);
    });

  const handleUploadFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const fileList = Array.isArray(files) ? files : Array.from(files);
    if (fileList.length === 0) return;

    setIsUploading(true);
    try {
      const uploaded: Array<{ name: string; url: string; size?: number; type?: string }> = [];
      for (const file of fileList) {
        let fileUrl = "";
        let fileName = file.name;
        let fileSize = file.size;
        let fileType = file.type || "application/octet-stream";

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/api/upload", {
            method: "POST",
            body: formData,
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const data = await res.json();
            if (data && (data.url || data.fileUrl)) {
              fileUrl = data.url || data.fileUrl;
              fileName = data.name || file.name;
              fileSize = data.size || file.size;
              fileType = data.type || file.type || fileType;
            }
          }
        } catch {
          // Fallback to base64 Data URL below
        }

        if (!fileUrl) {
          fileUrl = await readFileAsDataUrl(file);
        }

        if (fileUrl) {
          uploaded.push({
            name: fileName,
            url: fileUrl,
            size: fileSize,
            type: fileType
          });
        }
      }
      if (uploaded.length > 0) {
        setInputAttachments(prev => [...prev, ...uploaded]);
      }
    } catch (err) {
      console.error("Floating chat file upload error:", err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          const ext = file.type.split("/")[1] || "png";
          const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
          imageFiles.push(new File([file], `screenshot_${timestamp}_${i + 1}.${ext}`, { type: file.type }));
        }
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      await handleUploadFiles(imageFiles);
    }
  };

  const handleTogglePin = async (messageId: number) => {
    if (!activeChannelId) return;
    try {
      const res = await fetch("/api/chat?action=toggle_pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, channel_id: activeChannelId })
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, is_pinned: data.is_pinned } : m));
        setChannels(prev => prev.map(c => c.id === activeChannelId ? { ...c, pinned_messages: data.pinned_messages } : c));
      }
    } catch (e) {
      console.error("Toggle pin error:", e);
    }
  };

  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && inputAttachments.length === 0) || !activeChannelId) return;

    const channel = channels.find(c => c.id === activeChannelId);
    const cleanedText = inputText.replace(/Đang tải hình ảnh \/ tệp lên\.\.\. Vui lòng đợi/gi, "").trim();
    const payload = {
      channel_id: activeChannelId,
      channel_code: channel?.channel_code || "",
      sender_name: currentUserName,
      sender_role: currentUserRole,
      sender_dept: currentUserDept,
      content: cleanedText,
      attachments: inputAttachments
    };

    setInputText("");
    setInputAttachments([]);
    try {
      const res = await fetch("/api/chat?action=send_message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success && data.message) {
        setMessages(prev => [...prev, data.message]);
        markChannelAsReadLocal(activeChannelId, data.message.id);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Open Direct Message 1-1
  const handleStartDM = async (otherName: string) => {
    if (otherName === currentUserName) return;
    try {
      const res = await fetch("/api/chat?action=create_channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: otherName,
          channel_type: "DIRECT",
          department: "Tin nhắn riêng",
          description: `Cuộc trò chuyện giữa ${currentUserName} và ${otherName}`,
          is_private: true,
          created_by: currentUserName,
          members: [currentUserName, otherName]
        })
      });
      const data = await res.json();
      if (data.success && data.channel) {
        // Refresh channels
        const cRes = await fetch(`/api/chat?action=channels&user=${encodeURIComponent(currentUserName)}`);
        const cData = await cRes.json();
        if (cData.channels) {
          setChannels(cData.channels);
          setActiveChannelId(data.channel.id);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Maximize to full-page chat tab
  const handleMaximizeToFullTab = () => {
    const channel = channels.find(c => c.id === activeChannelId);
    if (channel) {
      if (typeof window !== "undefined") {
        localStorage.setItem("tbr_active_chat_channel", channel.channel_code);
      }
    }
    setIsOpen(false);
    setActiveTab("chat" as any);
  };

  // Safe early exit AFTER all hooks have executed
  if (activeTab === ("chat" as any)) {
    return null;
  }

  const activeChannel = channels.find(c => c.id === activeChannelId);

  // Helper for DM display name
  const getChannelDisplayName = (c: any) => {
    if (c.channel_type === "DIRECT") {
      if (Array.isArray(c.members)) {
        const other = c.members.find((m: string) => m !== currentUserName);
        if (other) return other;
      }
      return c.name.replace(currentUserName, "").replace("&", "").trim() || c.name;
    }
    return `#${c.name}`;
  };

  const filteredChannels = channels.filter(c => {
    if (filterType === "DIRECT" && c.channel_type !== "DIRECT") return false;
    if (filterType === "GROUP" && (c.channel_type === "DIRECT" || c.channel_type === "CHANNEL")) return false;
    if (quickSearch.trim()) {
      const name = getChannelDisplayName(c).toLowerCase();
      return name.includes(quickSearch.toLowerCase());
    }
    return true;
  });

  return (
    <div className="fixed bottom-20 right-3.5 lg:bottom-5 lg:right-5 z-40">
      {/* Floating launcher trigger button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="w-11 h-11 lg:w-12 lg:h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-700 to-purple-600 text-white flex items-center justify-center shadow-xl shadow-indigo-600/30 hover:scale-105 active:scale-95 transition-all cursor-pointer group relative"
          title={
            totalUnreadCount > 0
              ? `Bạn có ${totalUnreadCount} tin nhắn mới chưa đọc — Bấm để mở chat`
              : "Mở trò chuyện trao đổi công việc nhanh"
          }
        >
          <MessageSquare className="w-5 h-5 lg:w-5.5 lg:h-5.5" />
          {totalUnreadCount > 0 ? (
            <>
              <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-rose-600 text-white text-[10px] font-extrabold flex items-center justify-center border-2 border-white dark:border-slate-900 shadow-md z-10 animate-bounce">
                {totalUnreadCount > 99 ? "99+" : totalUnreadCount}
              </span>
              <span className="absolute inset-0 rounded-2xl bg-rose-500/30 animate-ping pointer-events-none" />
            </>
          ) : (
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900 animate-pulse" />
          )}
        </button>
      )}

      {/* Floating Chat Window (Compact or Expanded) */}
      {isOpen && (
        <div
          className={`bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden transition-all duration-200 ${
            isExpanded
              ? "w-[720px] max-w-[94vw] h-[580px] max-h-[75vh] lg:max-h-[85vh]"
              : "w-[calc(100vw-1.75rem)] sm:w-96 h-[440px] max-h-[72vh] lg:h-[490px]"
          }`}
        >
          {/* Header */}
          <div className="p-3 bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-600 text-white flex items-center justify-between shrink-0 shadow-xs">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center font-bold text-xs">
                {activeChannel?.channel_type === "DIRECT" ? "💬" : activeChannel?.channel_type === "PROJECT" ? "🎯" : <Hash className="w-3.5 h-3.5" />}
              </div>
              <div className="overflow-hidden">
                <div className="flex items-center gap-1 font-bold text-xs truncate">
                  <span>{activeChannel ? getChannelDisplayName(activeChannel) : "Chat TBRs"}</span>
                </div>
                <span className="text-[10px] text-white/80 block truncate">
                  {activeChannel?.department || "Trò chuyện nhanh nội bộ"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Toggle in-place expand size */}
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1.5 rounded-lg hover:bg-white/20 text-white transition-colors cursor-pointer"
                title={isExpanded ? "Thu gọn kích thước" : "Mở rộng khung chat tại chỗ"}
              >
                {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>

              {/* Full Screen Tab */}
              <button
                type="button"
                onClick={handleMaximizeToFullTab}
                className="p-1.5 rounded-lg hover:bg-white/20 text-white transition-colors cursor-pointer"
                title="Mở toàn màn hình Workspace Chat"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>

              {/* Close */}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/20 text-white transition-colors cursor-pointer"
                title="Đóng chat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Main Body (Single or Dual column if expanded) */}
          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar if expanded */}
            {isExpanded && (
              <div className="w-60 border-r border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 flex flex-col shrink-0 text-xs">
                <div className="p-2 border-b border-slate-200/80 dark:border-slate-800/80">
                  <div className="relative">
                    <Search className="w-3 h-3 absolute left-2 top-2 text-slate-400" />
                    <input
                      type="text"
                      value={quickSearch}
                      onChange={(e) => setQuickSearch(e.target.value)}
                      placeholder="Tìm kênh, đồng nghiệp..."
                      className="w-full pl-6 pr-2 py-1 rounded-lg text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                  <div className="text-[10px] font-bold text-slate-400 px-1 uppercase">Kênh & Nhóm:</div>
                  {filteredChannels.map(c => {
                    const isActive = activeChannelId === c.id;
                    const chUnread = getChannelUnreadCount(c);
                    return (
                      <button
                        key={c.id}
                        onClick={() => setActiveChannelId(c.id)}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg font-semibold text-left transition-colors cursor-pointer ${
                          isActive
                            ? "bg-indigo-600 text-white"
                            : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60"
                        }`}
                      >
                        <span className="truncate">{getChannelDisplayName(c)}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {chUnread > 0 && !isActive && (
                            <span className="min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-extrabold flex items-center justify-center">
                              {chUnread > 99 ? "99+" : chUnread}
                            </span>
                          )}
                          {c.channel_type === "DIRECT" && <span className="text-[9px] opacity-75">1-1</span>}
                        </div>
                      </button>
                    );
                  })}

                  <div className="pt-2 text-[10px] font-bold text-slate-400 px-1 uppercase">Chat riêng đồng nghiệp:</div>
                  {personnel.slice(0, 6).map((p, idx) => {
                    if (p.full_name === currentUserName) return null;
                    const cardColors = [
                      "bg-blue-50/90 hover:bg-blue-100 border border-blue-200/80 text-slate-800 dark:bg-blue-950/35 dark:hover:bg-blue-900/50 dark:border-blue-800/50 dark:text-slate-200",
                      "bg-emerald-50/90 hover:bg-emerald-100 border border-emerald-200/80 text-slate-800 dark:bg-emerald-950/35 dark:hover:bg-emerald-900/50 dark:border-emerald-800/50 dark:text-slate-200",
                      "bg-purple-50/90 hover:bg-purple-100 border border-purple-200/80 text-slate-800 dark:bg-purple-950/35 dark:hover:bg-purple-900/50 dark:border-purple-800/50 dark:text-slate-200",
                      "bg-amber-50/90 hover:bg-amber-100 border border-amber-200/80 text-slate-800 dark:bg-amber-950/35 dark:hover:bg-amber-900/50 dark:border-amber-800/50 dark:text-slate-200",
                      "bg-rose-50/90 hover:bg-rose-100 border border-rose-200/80 text-slate-800 dark:bg-rose-950/35 dark:hover:bg-rose-900/50 dark:border-rose-800/50 dark:text-slate-200",
                      "bg-cyan-50/90 hover:bg-cyan-100 border border-cyan-200/80 text-slate-800 dark:bg-cyan-950/35 dark:hover:bg-cyan-900/50 dark:border-cyan-800/50 dark:text-slate-200",
                    ];
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleStartDM(p.full_name)}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left text-[11px] font-medium cursor-pointer transition-colors ${cardColors[idx % cardColors.length]}`}
                      >
                        <span className="truncate">{p.full_name}</span>
                        <span className="text-[9px] text-slate-500">{p.department}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Chat Content Column */}
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/30 dark:bg-slate-950/20">
              {/* Channel Switcher Tabs in Compact mode */}
              {!isExpanded && (
                <div className="px-2 py-1.5 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 flex gap-1 overflow-x-auto text-[11px] shrink-0">
                  {channels.slice(0, 6).map(c => {
                    const chUnread = getChannelUnreadCount(c);
                    return (
                      <button
                        key={c.id}
                        onClick={() => setActiveChannelId(c.id)}
                        className={`relative px-2 py-0.5 rounded-lg font-semibold truncate max-w-[120px] cursor-pointer flex items-center gap-1 ${
                          activeChannelId === c.id
                            ? "bg-indigo-600 text-white"
                            : "text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
                        }`}
                      >
                        <span className="truncate">{getChannelDisplayName(c)}</span>
                        {chUnread > 0 && activeChannelId !== c.id && (
                          <span className="min-w-[15px] h-3.5 px-1 rounded-full bg-rose-600 text-white text-[9px] font-extrabold flex items-center justify-center shrink-0">
                            {chUnread}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Pinned Messages Banner */}
              {activeChannel?.pinned_messages && activeChannel.pinned_messages.length > 0 && (
                <div className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/50 flex items-center justify-between gap-2 text-[11px] text-amber-900 dark:text-amber-200 shrink-0">
                  <div
                    onClick={() => {
                      const lastPin = activeChannel.pinned_messages[activeChannel.pinned_messages.length - 1];
                      if (lastPin?.id) {
                        document.getElementById(`floating-msg-${lastPin.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }
                    }}
                    className="flex items-center gap-1.5 truncate cursor-pointer hover:underline"
                    title="Bấm để cuộn tới tin nhắn đã ghim"
                  >
                    <Pin className="w-3 h-3 text-amber-600 shrink-0" />
                    <span className="font-bold shrink-0">📌 Ghim ({activeChannel.pinned_messages.length}):</span>
                    <span className="truncate">
                      {activeChannel.pinned_messages[activeChannel.pinned_messages.length - 1]?.sender_name
                        ? `${activeChannel.pinned_messages[activeChannel.pinned_messages.length - 1].sender_name}: `
                        : ""}
                      {activeChannel.pinned_messages[activeChannel.pinned_messages.length - 1]?.content || "[Tệp đính kèm]"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const lastPin = activeChannel.pinned_messages[activeChannel.pinned_messages.length - 1];
                      if (lastPin?.id) handleTogglePin(lastPin.id);
                    }}
                    className="text-amber-600 hover:text-rose-600 font-bold px-1 cursor-pointer shrink-0"
                    title="Bỏ ghim tin nhắn này"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Messages Stream */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-xs">
                {messages
                  .filter(m => !activeChannelId || Number(m.channel_id) === Number(activeChannelId))
                  .map((m, idx, arr) => {
                  const isMe = m.sender_name === currentUserName;
                  const prevMsg = idx > 0 ? arr[idx - 1] : null;
                  const currentDateStr = formatVietnamDate(m.created_at);
                  const prevDateStr = prevMsg ? formatVietnamDate(prevMsg.created_at) : null;
                  const isNewDay = !prevDateStr || currentDateStr !== prevDateStr;
                  const dateLabel = isNewDay && m.created_at ? getVietnamDateLabel(m.created_at) : "";
                  const cleanedContent = String(m.content || "").replace(/Đang tải hình ảnh \/ tệp lên\.\.\. Vui lòng đợi/gi, "").trim();

                  return (
                    <React.Fragment key={m.id || idx}>
                      {isNewDay && dateLabel && (
                        <div className="flex items-center justify-center my-2 select-none">
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300/40 dark:border-slate-700/60 shadow-2xs">
                            📅 {dateLabel}
                          </span>
                        </div>
                      )}
                      <div
                        id={`floating-msg-${m.id}`}
                        className={`flex flex-col group ${isMe ? "items-end" : "items-start"}`}
                      >
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5 px-1">
                          <span className="font-bold">{isMe ? "Bạn" : m.sender_name}</span>
                          <span>•</span>
                          <span 
                            className="cursor-help font-medium"
                            title={`Thời gian gửi (Giờ Việt Nam): ${formatVietnamDateTime(m.created_at)}`}
                          >
                            {formatVietnamTime(m.created_at)}
                          </span>
                          {m.is_pinned && (
                            <span className="text-[9px] font-bold text-amber-600 bg-amber-100 dark:bg-amber-950/60 px-1 rounded">
                              📌 Đã ghim
                            </span>
                          )}
                          {m.id && (
                            <button
                              type="button"
                              onClick={() => handleTogglePin(m.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-semibold text-slate-400 hover:text-amber-600 px-1 cursor-pointer"
                              title={m.is_pinned ? "Bỏ ghim tin nhắn" : "Ghim tin nhắn"}
                            >
                              📌 {m.is_pinned ? "Bỏ ghim" : "Ghim"}
                            </button>
                          )}
                        </div>
                        {cleanedContent && (
                          <div
                            className={`p-2.5 rounded-2xl max-w-[85%] text-xs leading-relaxed whitespace-pre-line shadow-2xs ${
                              isMe
                                ? "bg-indigo-600 text-white rounded-br-xs"
                                : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-xs border border-slate-200/80 dark:border-slate-700"
                            }`}
                          >
                            {cleanedContent}
                          </div>
                        )}
                        {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1.5 max-w-[85%]">
                            {m.attachments.map((att: any, aIdx: number) => {
                              const isImg = att.type?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(att.name || "");
                              return isImg ? (
                                <a key={aIdx} href={att.url} target="_blank" rel="noreferrer" className="block">
                                  <img
                                    src={att.url}
                                    alt={att.name || "image"}
                                    className="w-24 h-20 object-cover rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs hover:opacity-90"
                                  />
                                </a>
                              ) : (
                                <a
                                  key={aIdx}
                                  href={att.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  download={att.name}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400"
                                >
                                  <FileText className="w-3 h-3 shrink-0" />
                                  <span className="truncate max-w-[120px]">{att.name || "Tệp đính kèm"}</span>
                                </a>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Attachment Preview & Upload Indicator */}
              {inputAttachments.length > 0 && (
                <div className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto shrink-0">
                  {inputAttachments.map((att, idx) => (
                    <div key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px]">
                      <span className="truncate max-w-[110px] font-semibold text-slate-700 dark:text-slate-200">{att.name}</span>
                      <button
                        type="button"
                        onClick={() => setInputAttachments(prev => prev.filter((_, i) => i !== idx))}
                        className="text-rose-500 hover:text-rose-700 font-bold cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {isUploading && (
                <div className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold border-t border-indigo-200 dark:border-indigo-900/50 shrink-0">
                  ⏳ Đang đính kèm tệp/hình ảnh...
                </div>
              )}

              {/* Mini Input Box */}
              <form onSubmit={handleSendMessage} className="p-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-1.5 shrink-0">
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={(e) => handleUploadFiles(e.target.files)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                  title="Đính kèm hình ảnh hoặc tệp tài liệu"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                </button>
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onPaste={handlePaste}
                  placeholder={`Nhắn tin tới ${activeChannel ? getChannelDisplayName(activeChannel) : ""}... (Ctrl+V dán ảnh)`}
                  className="flex-1 px-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() && inputAttachments.length === 0}
                  className="p-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
