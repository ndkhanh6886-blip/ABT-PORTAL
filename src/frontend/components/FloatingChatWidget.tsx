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
  Plus
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
  const [filterType, setFilterType] = useState<"ALL" | "DIRECT" | "GROUP">("ALL");
  const [quickSearch, setQuickSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentUserName = user?.name || (user as any)?.full_name || "Nhân viên TBRs";
  const currentUserRole = user?.role || "Thành viên";
  const currentUserDept = (user as any)?.department || "Kinh Doanh";

  // Fetch Channels & Personnel on Open or when activeChannelId changes
  useEffect(() => {
    if (isOpen) {
      fetch(`/api/chat?action=channels&user=${encodeURIComponent(currentUserName)}`)
        .then(res => res.json())
        .then(data => {
          if (data.channels && data.channels.length > 0) {
            setChannels(data.channels);
            setPersonnel(data.personnel || []);
            if (!activeChannelId) {
              setActiveChannelId(data.channels[0].id);
            }
          }
        })
        .catch(err => console.error(err));
    }
  }, [isOpen, currentUserName]);

  // Fetch Messages for active channel
  useEffect(() => {
    if (isOpen && activeChannelId) {
      fetch(`/api/chat?action=messages&channel_id=${activeChannelId}`)
        .then(res => res.json())
        .then(data => {
          if (data.messages) {
            setMessages(data.messages);
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
          }
        })
        .catch(err => console.error(err));
    }
  }, [isOpen, activeChannelId]);

  // Periodic polling when chat widget is open
  useEffect(() => {
    if (!isOpen || !activeChannelId) return;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      fetch(`/api/chat?action=messages&channel_id=${activeChannelId}`)
        .then(res => res.json())
        .then(data => {
          if (data.messages) {
            setMessages(data.messages);
          }
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, [isOpen, activeChannelId]);

  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChannelId) return;

    const channel = channels.find(c => c.id === activeChannelId);
    const payload = {
      channel_id: activeChannelId,
      channel_code: channel?.channel_code || "",
      sender_name: currentUserName,
      sender_role: currentUserRole,
      sender_dept: currentUserDept,
      content: inputText.trim()
    };

    setInputText("");
    try {
      const res = await fetch("/api/chat?action=send_message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success && data.message) {
        setMessages(prev => [...prev, data.message]);
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
          title="Mở trò chuyện trao đổi công việc nhanh"
        >
          <MessageSquare className="w-5 h-5 lg:w-5.5 lg:h-5.5" />
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900 animate-pulse" />
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
                        {c.channel_type === "DIRECT" && <span className="text-[9px] opacity-75">1-1</span>}
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
                  {channels.slice(0, 6).map(c => (
                    <button
                      key={c.id}
                      onClick={() => setActiveChannelId(c.id)}
                      className={`px-2 py-0.5 rounded-lg font-semibold truncate max-w-[110px] cursor-pointer ${
                        activeChannelId === c.id
                          ? "bg-indigo-600 text-white"
                          : "text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
                      }`}
                    >
                      {getChannelDisplayName(c)}
                    </button>
                  ))}
                </div>
              )}

              {/* Messages Stream */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-xs">
                {messages.map((m, idx) => {
                  const isMe = m.sender_name === currentUserName;
                  const prevMsg = idx > 0 ? messages[idx - 1] : null;
                  const currentDateStr = formatVietnamDate(m.created_at);
                  const prevDateStr = prevMsg ? formatVietnamDate(prevMsg.created_at) : null;
                  const isNewDay = !prevDateStr || currentDateStr !== prevDateStr;
                  const dateLabel = isNewDay && m.created_at ? getVietnamDateLabel(m.created_at) : "";

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
                        className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
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
                        </div>
                        <div
                          className={`p-2.5 rounded-2xl max-w-[85%] text-xs leading-relaxed whitespace-pre-line shadow-2xs ${
                            isMe
                              ? "bg-indigo-600 text-white rounded-br-xs"
                              : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-xs border border-slate-200/80 dark:border-slate-700"
                          }`}
                        >
                          {m.content}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Mini Input Box */}
              <form onSubmit={handleSendMessage} className="p-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-1.5 shrink-0">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={`Nhắn tin tới ${activeChannel ? getChannelDisplayName(activeChannel) : ""}...`}
                  className="flex-1 px-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim()}
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
