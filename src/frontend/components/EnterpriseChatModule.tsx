"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  MessageSquare,
  Hash,
  Lock,
  Plus,
  Search,
  Send,
  Paperclip,
  Smile,
  Pin,
  Users,
  Download,
  Image as ImageIcon,
  FileText,
  Sparkles,
  X,
  ChevronDown,
  Briefcase,
  Package,
  FlaskConical,
  ShoppingCart,
  Building2,
  Eye,
  Trash2,
  Link2,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  ShieldCheck,
  UserCheck,
  Maximize2,
  Minimize2,
  UserPlus,
  Phone,
  Mail,
  User,
  Settings,
  Columns,
  ArrowLeftRight,
  LogOut,
  AlertTriangle,
  MoreVertical,
  Calendar,
  Reply
} from "lucide-react";
import { useAuth, DEFAULT_MEMBERS } from "@/frontend/contexts/AuthContext";
import { useNotification } from "@/frontend/contexts/NotificationContext";
import { Modal } from "@/frontend/components/Modal";
import {
  formatVietnamTime,
  formatVietnamDate,
  formatVietnamDateTime,
  getVietnamDateLabel
} from "@/backend/services/utils";
import { nowVNDateTime } from "@/backend/services/dates";

export const normalizeUserName = (name?: string): string => {
  if (!name) return "Nhân viên TBRs";
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower === "admin" || 
    lower === "quan tri vien" || 
    lower === "quản trị viên" || 
    lower === "quản trị viên hệ thống" || 
    lower === "quan tri vien he thong" ||
    lower === "tbr-admin" ||
    lower === "via-admin"
  ) {
    return "Quản Trị Viên Hệ Thống";
  }
  return trimmed;
};

interface ChatChannel {
  id: number;
  channel_code: string;
  name: string;
  channel_type: "CHANNEL" | "PROJECT" | "DIRECT" | "GROUP";
  department?: string;
  description?: string;
  is_private?: boolean;
  created_by?: string;
  members?: string[];
  pinned_messages?: any[];
  last_message_at?: string;
  last_message_time?: string;
  message_count?: number;
  unread_count?: number;
  last_message_content?: string;
  last_message_sender?: string;
}

interface ChatMessage {
  id: number;
  channel_id: number;
  channel_code: string;
  sender_id?: string;
  sender_name: string;
  sender_avatar?: string;
  sender_role?: string;
  sender_dept?: string;
  content: string;
  attachments?: Array<{ name: string; url: string; size?: number; type?: string; uploaded_at?: string }>;
  related_work?: { type: "TASK" | "WORKFLOW"; code: string; title: string };
  reactions?: Record<string, string[]>;
  is_pinned?: boolean;
  reply_to?: {
    id: number;
    sender_name: string;
    content: string;
    has_image?: boolean;
  } | null;
  created_at: string;
}

const COMMON_EMOJIS = ["👍", "❤️", "🚀", "👀", "✅", "🎉", "🔥", "💡"];

export const dedupePersonnel = (list: any[]): any[] => {
  if (!Array.isArray(list)) return [];
  const map = new Map<string, any>();
  for (const p of list) {
    const rawName = p.full_name || p.name || "";
    const norm = normalizeUserName(rawName);
    if (!norm) continue;
    if (!map.has(norm)) {
      map.set(norm, { ...p, full_name: rawName });
    } else {
      const existing = map.get(norm);
      if (p.presence_status === "online" && existing.presence_status !== "online") {
        map.set(norm, { ...existing, ...p, full_name: rawName });
      }
    }
  }
  return Array.from(map.values());
};

export const SENDER_PALETTES = [
  {
    key: "blue",
    text: "text-blue-600 dark:text-blue-400",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300 border border-blue-200 dark:border-blue-800",
    avatar: "bg-gradient-to-tr from-blue-600 to-indigo-600 text-white",
    bubbleBorder: "border-l-blue-500",
    sidebarCard: "bg-blue-50/90 hover:bg-blue-100 border border-blue-200/80 text-slate-800 dark:bg-blue-950/35 dark:hover:bg-blue-900/50 dark:border-blue-800/50 dark:text-slate-200",
  },
  {
    key: "emerald",
    text: "text-emerald-600 dark:text-emerald-400",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800",
    avatar: "bg-gradient-to-tr from-emerald-600 to-teal-600 text-white",
    bubbleBorder: "border-l-emerald-500",
    sidebarCard: "bg-emerald-50/90 hover:bg-emerald-100 border border-emerald-200/80 text-slate-800 dark:bg-emerald-950/35 dark:hover:bg-emerald-900/50 dark:border-emerald-800/50 dark:text-slate-200",
  },
  {
    key: "purple",
    text: "text-purple-600 dark:text-purple-400",
    badge: "bg-purple-50 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-200 dark:border-purple-800",
    avatar: "bg-gradient-to-tr from-purple-600 to-pink-600 text-white",
    bubbleBorder: "border-l-purple-500",
    sidebarCard: "bg-purple-50/90 hover:bg-purple-100 border border-purple-200/80 text-slate-800 dark:bg-purple-950/35 dark:hover:bg-purple-900/50 dark:border-purple-800/50 dark:text-slate-200",
  },
  {
    key: "amber",
    text: "text-amber-600 dark:text-amber-400",
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-200 dark:border-amber-800",
    avatar: "bg-gradient-to-tr from-amber-600 to-orange-600 text-white",
    bubbleBorder: "border-l-amber-500",
    sidebarCard: "bg-amber-50/90 hover:bg-amber-100 border border-amber-200/80 text-slate-800 dark:bg-amber-950/35 dark:hover:bg-amber-900/50 dark:border-amber-800/50 dark:text-slate-200",
  },
  {
    key: "rose",
    text: "text-rose-600 dark:text-rose-400",
    badge: "bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-200 dark:border-rose-800",
    avatar: "bg-gradient-to-tr from-rose-600 to-red-600 text-white",
    bubbleBorder: "border-l-rose-500",
    sidebarCard: "bg-rose-50/90 hover:bg-rose-100 border border-rose-200/80 text-slate-800 dark:bg-rose-950/35 dark:hover:bg-rose-900/50 dark:border-rose-800/50 dark:text-slate-200",
  },
  {
    key: "cyan",
    text: "text-cyan-600 dark:text-cyan-400",
    badge: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/70 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800",
    avatar: "bg-gradient-to-tr from-cyan-600 to-sky-600 text-white",
    bubbleBorder: "border-l-cyan-500",
    sidebarCard: "bg-cyan-50/90 hover:bg-cyan-100 border border-cyan-200/80 text-slate-800 dark:bg-cyan-950/35 dark:hover:bg-cyan-900/50 dark:border-cyan-800/50 dark:text-slate-200",
  },
  {
    key: "violet",
    text: "text-violet-600 dark:text-violet-400",
    badge: "bg-violet-50 text-violet-700 dark:bg-violet-950/70 dark:text-violet-300 border border-violet-200 dark:border-violet-800",
    avatar: "bg-gradient-to-tr from-violet-600 to-purple-700 text-white",
    bubbleBorder: "border-l-violet-500",
    sidebarCard: "bg-violet-50/90 hover:bg-violet-100 border border-violet-200/80 text-slate-800 dark:bg-violet-950/35 dark:hover:bg-violet-900/50 dark:border-violet-800/50 dark:text-slate-200",
  },
  {
    key: "teal",
    text: "text-teal-600 dark:text-teal-400",
    badge: "bg-teal-50 text-teal-700 dark:bg-teal-950/70 dark:text-teal-300 border border-teal-200 dark:border-teal-800",
    avatar: "bg-gradient-to-tr from-teal-600 to-emerald-600 text-white",
    bubbleBorder: "border-l-teal-500",
    sidebarCard: "bg-teal-50/90 hover:bg-teal-100 border border-teal-200/80 text-slate-800 dark:bg-teal-950/35 dark:hover:bg-teal-900/50 dark:border-teal-800/50 dark:text-slate-200",
  }
];

export const getSenderPalette = (name: string) => {
  if (!name) return SENDER_PALETTES[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % SENDER_PALETTES.length;
  return SENDER_PALETTES[idx];
};

const DEFAULT_FALLBACK_CHANNELS: ChatChannel[] = [
  { id: 1, channel_code: "general", name: "toan-cong-ty", channel_type: "CHANNEL", department: "Toàn công ty", description: "Kênh thảo luận chung toàn thể cán bộ nhân viên TBRs", is_private: false, created_by: "Hệ thống", members: [] },
  { id: 2, channel_code: "sales", name: "kinh-doanh", channel_type: "CHANNEL", department: "Kinh Doanh", description: "Kênh trao đổi nội bộ phòng Kinh Doanh", is_private: false, created_by: "Hệ thống", members: [] },
  { id: 3, channel_code: "application", name: "application-lab", channel_type: "CHANNEL", department: "Application", description: "Kênh phòng Kỹ thuật & Ứng dụng Lab", is_private: false, created_by: "Hệ thống", members: [] },
  { id: 4, channel_code: "warehouse", name: "kho-van-hanh", channel_type: "CHANNEL", department: "Kho & Vận Hành", description: "Kênh phòng Kho vận & Điều vận", is_private: false, created_by: "Hệ thống", members: [] },
  { id: 5, channel_code: "procurement", name: "cung-ung-procurement", channel_type: "CHANNEL", department: "Cung Ứng", description: "Kênh phòng Mua hàng & Cung ứng", is_private: false, created_by: "Hệ thống", members: [] }
];

export const EnterpriseChatModule: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useNotification();

  const currentUserName = normalizeUserName(user?.full_name || user?.name);
  const currentUserRole = user?.role || "Thành viên";
  const currentUserDept = (user as any)?.department || "Kinh Doanh";

  // Channels & Active Channel (Primary pane)
  const [channels, setChannels] = useState<ChatChannel[]>(DEFAULT_FALLBACK_CHANNELS);
  const [activeChannel, setActiveChannel] = useState<ChatChannel | null>(DEFAULT_FALLBACK_CHANNELS[0]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [personnelList, setPersonnelList] = useState<any[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("lab_members");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return dedupePersonnel(parsed.map((m: any) => ({
              id: m.id,
              user_id: m.id,
              employee_code: m.username || m.id,
              username: m.username || "",
              full_name: m.full_name || m.name,
              department: m.department || "Khác",
              position: m.role || "Thành viên",
              email: m.email || "",
              phone: m.phone || "",
              presence_status: "offline"
            })));
          }
        }
      } catch (e) {}
    }
    return dedupePersonnel(DEFAULT_MEMBERS.map(m => ({
      id: m.id,
      user_id: m.id,
      employee_code: m.username || m.id,
      username: m.username || "",
      full_name: m.full_name || m.name,
      department: m.department || "Khác",
      position: m.role || "Thành viên",
      email: m.email || "",
      phone: m.phone || "",
      presence_status: "offline"
    })));
  });
  const [tasksList, setTasksList] = useState<any[]>([]);
  const [workflowsList, setWorkflowsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);

  // Split View Pane (Song song)
  const [splitChannel, setSplitChannel] = useState<ChatChannel | null>(null);
  const [splitMessages, setSplitMessages] = useState<ChatMessage[]>([]);
  const [splitMessagesLoading, setSplitMessagesLoading] = useState(false);
  const [splitInputText, setSplitInputText] = useState("");
  const [splitInputAttachments, setSplitInputAttachments] = useState<any[]>([]);
  const [openInSplitViewOnCreate, setOpenInSplitViewOnCreate] = useState(true);

  // Search & Filter
  const [searchChannelQuery, setSearchChannelQuery] = useState("");
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [isSearchingInChat, setIsSearchingInChat] = useState(false);

  // Message Input (Primary)
  const [inputText, setInputText] = useState("");
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [inputAttachments, setInputAttachments] = useState<any[]>([]);
  const [selectedRelatedWork, setSelectedRelatedWork] = useState<any | null>(null);
  const [isWorkLinkDropdownOpen, setIsWorkLinkDropdownOpen] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // UI Drawers & Modals
  const [isRightDrawerOpen, setIsRightDrawerOpen] = useState(false);
  const [isCreateChannelModalOpen, setIsCreateChannelModalOpen] = useState(false);
  const [isStartDMModalOpen, setIsStartDMModalOpen] = useState(false);
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Channel Settings & Deletion Modal
  const [isChannelSettingsModalOpen, setIsChannelSettingsModalOpen] = useState(false);
  const [editChannelForm, setEditChannelForm] = useState({
    id: 0,
    name: "",
    department: "",
    description: "",
    is_private: false,
    created_by: "",
    members: [] as string[]
  });
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  // Direct Message Picker State
  const [dmSearchQuery, setDmSearchQuery] = useState("");
  const [dmDeptFilter, setDmDeptFilter] = useState("Tất cả");

  // Create Channel / Group Form State
  const [newChannelForm, setNewChannelForm] = useState({
    name: "",
    channel_type: "GROUP" as "CHANNEL" | "PROJECT" | "DIRECT" | "GROUP",
    department: "Liên phòng ban",
    description: "",
    is_private: true,
    selectedMembers: [] as string[]
  });
  const [memberPickerSearch, setMemberPickerSearch] = useState("");
  const [memberPickerDept, setMemberPickerDept] = useState("Tất cả");

  // Add Member State
  const [addMembersSelected, setAddMembersSelected] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const splitMessagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reply to message state
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [splitReplyingTo, setSplitReplyingTo] = useState<ChatMessage | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);

  // Scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  const scrollSplitToBottom = () => {
    splitMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Helper for DM display name
  const getChannelDisplayName = (c: ChatChannel) => {
    if (!c) return "Kênh chat";
    if (c.channel_type === "DIRECT") {
      let memberList: string[] = [];
      if (Array.isArray(c.members)) {
        memberList = c.members.map(m => String(m || "").trim()).filter(Boolean);
      } else if (typeof c.members === "string") {
        try {
          const parsed = JSON.parse(c.members);
          if (Array.isArray(parsed)) memberList = parsed.map((m: any) => String(m || "").trim()).filter(Boolean);
        } catch (e) {
          memberList = (c.members as string).replace(/[{}]/g, "").split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
        }
      }

      if (memberList.length > 0) {
        const other = memberList.find(m => m && normalizeUserName(m) !== currentUserName);
        if (other) return String(other).trim();
      }
      if (c.created_by && normalizeUserName(c.created_by) !== currentUserName) {
        return String(c.created_by).trim();
      }
      const rawName = String(c.name || "");
      const cleaned = rawName
        .replace(currentUserName, "")
        .replace("Quản Trị Viên (Admin)", "")
        .replace("Quản Trị Viên Hệ Thống", "")
        .replace("&", "")
        .trim();
      return cleaned || rawName || "Đồng nghiệp";
    }
    return String(c.name || "Kênh chat");
  };

  // Helper for recipient full profile
  const getRecipientProfile = (c: ChatChannel) => {
    const otherName = getChannelDisplayName(c);
    const p = personnelList.find(item => 
      normalizeUserName(item.full_name) === normalizeUserName(otherName) ||
      item.full_name?.trim() === otherName.trim() ||
      item.username?.toLowerCase() === otherName.toLowerCase()
    );
    return {
      name: otherName,
      department: p?.department || c.department || "Nhân viên TBRs",
      position: p?.position || "Đồng nghiệp",
      phone: p?.phone || "",
      email: p?.email || ""
    };
  };

  // Unread messages tracking
  const readCountsRef = useRef<Record<number, number>>({});
  const lastKnownTimestampsRef = useRef<Record<number, string>>({});

  // Mark channel read helper
  const markChannelAsRead = useCallback(async (channelId: number, messageCount?: number) => {
    if (!channelId) return;
    const count = typeof messageCount === "number" ? messageCount : Number.MAX_SAFE_INTEGER;
    readCountsRef.current[channelId] = count;
    setChannels(prev => prev.map(c => c.id === channelId ? { ...c, unread_count: 0 } : c));
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(`tbr_chat_read_${currentUserName}_${channelId}`, String(Date.now()));
        localStorage.setItem(`chat_last_read_${channelId}_${currentUserName}`, new Date().toISOString());
      }
      await fetch(`/api/chat?action=mark_read&channel_id=${channelId}&user=${encodeURIComponent(currentUserName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId, user: currentUserName, last_message_id: count })
      });
    } catch {}
  }, [currentUserName]);

  // Dynamic unread count resolver
  const getChannelUnreadCount = useCallback((c?: ChatChannel | null): number => {
    if (!c) return 0;
    if (activeChannel?.id === c.id || splitChannel?.id === c.id) return 0;
    if (typeof c.unread_count === "number") {
      return Math.max(0, c.unread_count);
    }
    const total = Number(c.message_count) || 0;
    const read = readCountsRef.current[c.id];
    if (read !== undefined) {
      return Math.max(0, total - read);
    }
    return 0;
  }, [activeChannel?.id, splitChannel?.id]);

  // Zero-dependency pleasant chime sound synthesizer (Web Audio API)
  const playNotificationChime = () => {
    try {
      if (typeof window === "undefined") return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(784, now); // G5
      osc.frequency.setValueAtTime(1046.5, now + 0.08); // C6
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
    } catch (e) {
      // User hasn't interacted with page yet or audio context blocked
    }
  };

  // Real-time User Presence Engine (Online/Away/Offline based on last_seen_at)
  const getUserPresence = (name: string): { 
    status: "online" | "away" | "offline"; 
    label: string; 
    dotClass: string;
    badgeClass: string;
    textClass: string;
  } => {
    if (!name) return { 
      status: "offline", 
      label: "Ngoại tuyến", 
      dotClass: "bg-slate-300 dark:bg-slate-600",
      badgeClass: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700",
      textClass: "text-slate-400"
    };
    const norm = normalizeUserName(name);
    if (norm === currentUserName) {
      return { 
        status: "online", 
        label: "Đang trực tuyến", 
        dotClass: "bg-emerald-500 ring-2 ring-emerald-500/20",
        badgeClass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800",
        textClass: "text-emerald-600 dark:text-emerald-400 font-bold"
      };
    }
    const person = personnelList.find(p => {
      const pNorm = normalizeUserName(p.full_name);
      return (
        pNorm === norm ||
        p.full_name?.trim() === name.trim() ||
        p.username?.toLowerCase() === name.toLowerCase() ||
        p.employee_code?.toLowerCase() === name.toLowerCase() ||
        p.email?.toLowerCase() === name.toLowerCase()
      );
    });
    const status = person?.presence_status || "offline";
    if (status === "online") {
      return { 
        status: "online", 
        label: "Đang trực tuyến", 
        dotClass: "bg-emerald-500 ring-2 ring-emerald-500/20",
        badgeClass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800",
        textClass: "text-emerald-600 dark:text-emerald-400 font-bold"
      };
    }
    if (status === "away") {
      return { 
        status: "away", 
        label: "Hoạt động gần đây", 
        dotClass: "bg-amber-400 ring-2 ring-amber-400/20",
        badgeClass: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800",
        textClass: "text-amber-600 dark:text-amber-400 font-medium"
      };
    }
    return { 
      status: "offline", 
      label: "Ngoại tuyến", 
      dotClass: "bg-slate-300 dark:bg-slate-600",
      badgeClass: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700",
      textClass: "text-slate-400"
    };
  };

  // 1. Fetch Channels & System metadata (Initial or explicit select)
  const fetchChannels = async (selectChannelCode?: string) => {
    try {
      const res = await fetch(`/api/chat?action=channels&user=${encodeURIComponent(currentUserName)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.channels && Array.isArray(data.channels) && data.channels.length > 0) {
        setChannels(data.channels);
        if (data.personnel && Array.isArray(data.personnel) && data.personnel.length > 0) {
          const deduped = dedupePersonnel(data.personnel);
          setPersonnelList(deduped);
          if (typeof window !== "undefined") {
            try {
              localStorage.setItem("lab_members", JSON.stringify(deduped));
            } catch (e) {}
          }
        }
        setTasksList(data.tasks || []);
        setWorkflowsList(data.workflows || []);

        // Record initial last message times
        data.channels.forEach((c: ChatChannel) => {
          const t = c.last_message_time || c.last_message_at;
          if (t) {
            lastKnownTimestampsRef.current[c.id] = String(t);
          }
        });

        if (selectChannelCode) {
          const found = data.channels.find((c: ChatChannel) => c.channel_code === selectChannelCode);
          if (found) {
            setActiveChannel(found);
            markChannelAsRead(found.id, Number(found.message_count) || 0);
          }
        } else {
          setActiveChannel(current => {
            if (!current) {
              const savedCode = typeof window !== "undefined" ? localStorage.getItem("tbr_active_chat_channel") : null;
              if (savedCode) {
                const foundSaved = data.channels.find((c: ChatChannel) => c.channel_code === savedCode);
                if (foundSaved) {
                  localStorage.removeItem("tbr_active_chat_channel");
                  markChannelAsRead(foundSaved.id, Number(foundSaved.message_count) || 0);
                  return foundSaved;
                }
              }
              const defaultCh = data.channels[0];
              if (defaultCh) {
                markChannelAsRead(defaultCh.id, Number(defaultCh.message_count) || 0);
              }
              return defaultCh;
            }
            const still = data.channels.find((c: ChatChannel) => c.id === current.id || c.channel_code === current.channel_code);
            return still || current;
          });
        }
      }
    } catch (err) {
      console.error("Failed to load chat channels:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchChannels();
  }, [currentUserName]);

  // 2. Fetch Messages for Active Channel (Primary)
  const fetchMessages = async (channelId: number) => {
    try {
      setMessagesLoading(true);
      const res = await fetch(`/api/chat?action=messages&channel_id=${channelId}&user=${encodeURIComponent(currentUserName)}`);
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages);
        markChannelAsRead(channelId, data.messages.length);
        setTimeout(scrollToBottom, 80);
      }
    } catch (err) {
      console.error("Failed to load messages:", err);
    } finally {
      setMessagesLoading(false);
    }
  };

  useEffect(() => {
    if (activeChannel) {
      fetchMessages(activeChannel.id);
    }
  }, [activeChannel?.id]);

  // 2b. Fetch Messages for Split Channel (Song song)
  const fetchSplitMessages = async (channelId: number) => {
    try {
      setSplitMessagesLoading(true);
      const res = await fetch(`/api/chat?action=messages&channel_id=${channelId}&user=${encodeURIComponent(currentUserName)}`);
      const data = await res.json();
      if (data.messages) {
        setSplitMessages(data.messages);
        markChannelAsRead(channelId, data.messages.length);
        setTimeout(scrollSplitToBottom, 80);
      }
    } catch (err) {
      console.error("Failed to load split messages:", err);
    } finally {
      setSplitMessagesLoading(false);
    }
  };

  useEffect(() => {
    if (splitChannel) {
      fetchSplitMessages(splitChannel.id);
    }
  }, [splitChannel?.id]);

  // Real-time synchronization loop: Channels + Messages + Presence every 3.5s
  useEffect(() => {
    const syncInterval = setInterval(async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        // A. Background silent channel sync
        const chRes = await fetch(`/api/chat?action=channels&user=${encodeURIComponent(currentUserName)}`);
        if (chRes.ok) {
          const chData = await chRes.json();
          if (chData.channels && Array.isArray(chData.channels)) {
            // Check for newly arrived messages across any channel
            chData.channels.forEach((c: ChatChannel) => {
              const prevTime = lastKnownTimestampsRef.current[c.id];
              const rawTime = c.last_message_time || c.last_message_at;
              const currTime = rawTime ? String(rawTime) : "";
              if (
                currTime &&
                prevTime &&
                currTime !== prevTime &&
                c.last_message_sender &&
                normalizeUserName(c.last_message_sender) !== currentUserName
              ) {
                // New message from someone else!
                playNotificationChime();
                if (activeChannel?.id !== c.id && splitChannel?.id !== c.id) {
                  showToast(`💬 ${c.last_message_sender}: ${c.last_message_content || "Tin nhắn mới"}`, "info");
                }
              }
              if (currTime) {
                lastKnownTimestampsRef.current[c.id] = currTime;
              }
            });

            setChannels(chData.channels);
            if (chData.personnel && Array.isArray(chData.personnel)) {
              setPersonnelList(dedupePersonnel(chData.personnel));
            }
          }
        }

        // B. Active Channel messages polling
        if (activeChannel) {
          const mRes = await fetch(`/api/chat?action=messages&channel_id=${activeChannel.id}&user=${encodeURIComponent(currentUserName)}`);
          if (mRes.ok) {
            const mData = await mRes.json();
            if (mData.messages && Array.isArray(mData.messages)) {
              setMessages(prev => {
                if (mData.messages.length !== prev.length) {
                  const latestMsg = mData.messages[mData.messages.length - 1];
                  if (latestMsg && normalizeUserName(latestMsg.sender_name) !== currentUserName) {
                    playNotificationChime();
                  }
                  markChannelAsRead(activeChannel.id, mData.messages.length);
                  setTimeout(scrollToBottom, 80);
                  return mData.messages;
                }
                return prev;
              });
            }
          }
        }

        // C. Split Channel messages polling
        if (splitChannel) {
          const smRes = await fetch(`/api/chat?action=messages&channel_id=${splitChannel.id}&user=${encodeURIComponent(currentUserName)}`);
          if (smRes.ok) {
            const smData = await smRes.json();
            if (smData.messages && Array.isArray(smData.messages)) {
              setSplitMessages(prev => {
                if (smData.messages.length !== prev.length) {
                  markChannelAsRead(splitChannel.id, smData.messages.length);
                  setTimeout(scrollSplitToBottom, 80);
                  return smData.messages;
                }
                return prev;
              });
            }
          }
        }
      } catch (err) {
        // Silent sync error
      }
    }, 3500);

    return () => clearInterval(syncInterval);
  }, [currentUserName, activeChannel?.id, splitChannel?.id]);

  // 3. Send Message (Primary)
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeChannel) return;
    const cleanedText = inputText.replace(/Đang tải hình ảnh \/ tệp lên\.\.\. Vui lòng đợi/gi, "").trim();
    if (!cleanedText && inputAttachments.length === 0) return;

    const payload = {
      channel_id: activeChannel.id,
      channel_code: activeChannel.channel_code,
      sender_name: currentUserName,
      sender_role: currentUserRole,
      sender_dept: currentUserDept,
      content: cleanedText,
      attachments: inputAttachments,
      related_work: selectedRelatedWork,
      reply_to: replyingTo ? {
        id: replyingTo.id,
        sender_name: replyingTo.sender_name,
        content: replyingTo.content ? (replyingTo.content.length > 140 ? replyingTo.content.slice(0, 140) + "..." : replyingTo.content) : "",
        has_image: replyingTo.attachments?.some(a => a.type?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(a.name))
      } : null
    };

    setInputText("");
    setInputAttachments([]);
    setReplyingTo(null);
    setSelectedRelatedWork(null);
    setIsWorkLinkDropdownOpen(false);

    try {
      const res = await fetch("/api/chat?action=send_message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success && data.message) {
        setMessages(prev => [...prev, data.message]);
        setTimeout(scrollToBottom, 50);
        fetchChannels(activeChannel.channel_code);
      } else {
        showToast(data.error || "Lỗi khi gửi tin nhắn", "error");
      }
    } catch (err: any) {
      showToast("Lỗi gửi tin: " + err.message, "error");
    }
  };

  // 3b. Send Message (Split Pane)
  const handleSendSplitMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!splitChannel) return;
    if (!splitInputText.trim() && splitInputAttachments.length === 0) return;

    const payload = {
      channel_id: splitChannel.id,
      channel_code: splitChannel.channel_code,
      sender_name: currentUserName,
      sender_role: currentUserRole,
      sender_dept: currentUserDept,
      content: splitInputText.trim(),
      attachments: splitInputAttachments,
      reply_to: splitReplyingTo ? {
        id: splitReplyingTo.id,
        sender_name: splitReplyingTo.sender_name,
        content: splitReplyingTo.content ? (splitReplyingTo.content.length > 140 ? splitReplyingTo.content.slice(0, 140) + "..." : splitReplyingTo.content) : "",
        has_image: splitReplyingTo.attachments?.some(a => a.type?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(a.name))
      } : null
    };

    setSplitInputText("");
    setSplitInputAttachments([]);
    setSplitReplyingTo(null);

    try {
      const res = await fetch("/api/chat?action=send_message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success && data.message) {
        setSplitMessages(prev => [...prev, data.message]);
        setTimeout(scrollSplitToBottom, 50);
        fetchChannels();
      }
    } catch (err: any) {
      showToast("Lỗi gửi tin: " + err.message, "error");
    }
  };

  // 4. File & Image Upload Handler (Supports FileList and File[] with Base64 Fallback so it never hangs)
  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Không thể đọc tệp"));
      reader.readAsDataURL(file);
    });

  const handleUploadFiles = async (files: FileList | File[] | null, isSplit = false) => {
    if (!files) return;
    const fileList = Array.isArray(files) ? files : Array.from(files);
    if (fileList.length === 0) return;

    setIsUploading(true);
    const safetyReset = setTimeout(() => setIsUploading(false), 15000);
    try {
      const uploaded: any[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        let fileUrl = "";
        let fileName = file.name;
        let fileSize = file.size;
        let fileType = file.type || "image/png";

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000);
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
              fileType = data.type || file.type || "image/png";
            }
          }
        } catch {
          // Automatic fallback to inline base64 Data URL below
        }

        if (!fileUrl) {
          fileUrl = await readFileAsDataUrl(file);
        }

        if (fileUrl) {
          uploaded.push({
            name: fileName,
            url: fileUrl,
            size: fileSize,
            type: fileType,
            uploaded_at: nowVNDateTime()
          });
        }
      }
      if (uploaded.length > 0) {
        if (isSplit) {
          setSplitInputAttachments(prev => [...prev, ...uploaded]);
        } else {
          setInputAttachments(prev => [...prev, ...uploaded]);
        }
        showToast(`Đã đính kèm ${uploaded.length} tệp/hình ảnh`, "success");
      }
    } catch (err: any) {
      showToast("Lỗi tải tệp: " + (err?.message || "Không xác định"), "error");
    } finally {
      clearTimeout(safetyReset);
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  // 4b. Paste Image from Clipboard (Ctrl + V)
  const handlePaste = async (e: React.ClipboardEvent, isSplit = false) => {
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
          const renamedFile = new File([file], `screenshot_${timestamp}_${i + 1}.${ext}`, { type: file.type });
          imageFiles.push(renamedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      await handleUploadFiles(imageFiles, isSplit);
    }
  };

  // 4c. Remove Selected Attachment Before Sending
  const handleRemoveAttachment = (idxToRemove: number, isSplit = false) => {
    if (isSplit) {
      setSplitInputAttachments(prev => prev.filter((_, idx) => idx !== idxToRemove));
    } else {
      setInputAttachments(prev => prev.filter((_, idx) => idx !== idxToRemove));
    }
  };

  // 4d. Reply to Message Actions
  const handleStartReply = (msg: ChatMessage, isSplit = false) => {
    if (isSplit) {
      setSplitReplyingTo(msg);
    } else {
      setReplyingTo(msg);
      textareaRef.current?.focus();
    }
  };

  const handleCancelReply = (isSplit = false) => {
    if (isSplit) {
      setSplitReplyingTo(null);
    } else {
      setReplyingTo(null);
    }
  };

  // 4e. Smooth Scroll to Quoted Message & Flash Highlight
  const scrollToMessage = (msgId: number) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMessageId(msgId);
      setTimeout(() => setHighlightedMessageId(null), 2500);
    } else {
      showToast("Tin nhắn gốc đã cũ hơn hoặc ở xa danh sách", "info");
    }
  };

  // 5. Toggle Emoji Reaction
  const handleToggleReaction = async (messageId: number, emoji: string) => {
    try {
      const res = await fetch("/api/chat?action=toggle_reaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, emoji, user_name: currentUserName })
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: data.reactions } : m));
        setSplitMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: data.reactions } : m));
      }
    } catch (e) {
      console.error("Reaction error:", e);
    }
  };

  // 6. Toggle Pin Message
  const handleTogglePin = async (messageId: number) => {
    if (!activeChannel) return;
    try {
      const res = await fetch("/api/chat?action=toggle_pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, channel_id: activeChannel.id })
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, is_pinned: data.is_pinned } : m));
        setActiveChannel(prev => prev ? { ...prev, pinned_messages: data.pinned_messages } : null);
        setChannels(prev => prev.map(c => c.id === activeChannel.id ? { ...c, pinned_messages: data.pinned_messages } : c));
        showToast(data.is_pinned ? "📌 Đã ghim tin nhắn lên đầu kênh!" : "Đã bỏ ghim tin nhắn!", "info");
      }
    } catch (e) {
      showToast("Lỗi khi ghim tin nhắn", "error");
    }
  };

  // 7. Create New Channel / Group Chat with Parallel Open Option
  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelForm.name.trim()) {
      showToast("Vui lòng nhập tên nhóm chat", "warning");
      return;
    }

    try {
      const res = await fetch("/api/chat?action=create_channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newChannelForm,
          created_by: currentUserName,
          members: Array.from(new Set([currentUserName, ...newChannelForm.selectedMembers]))
        })
      });
      const data = await res.json();
      if (data.success && data.channel) {
        showToast(`Đã tạo nhóm: #${data.channel.name}`, "success");
        setIsCreateChannelModalOpen(false);

        // Check if user wanted to open parallel side-by-side
        if (openInSplitViewOnCreate && activeChannel) {
          setSplitChannel(data.channel);
          showToast(`Đã mở nhóm #${data.channel.name} song song bên cạnh`, "info");
        } else {
          setActiveChannel(data.channel);
        }

        setNewChannelForm({
          name: "",
          channel_type: "GROUP",
          department: "Liên phòng ban",
          description: "",
          is_private: true,
          selectedMembers: []
        });
        await fetchChannels();
      } else {
        showToast(data.error || "Lỗi tạo nhóm", "error");
      }
    } catch (err: any) {
      showToast("Lỗi kết nối: " + err.message, "error");
    }
  };

  // 8. Open Direct Message with a colleague
  const handleOpenDirectMessage = async (personName: string) => {
    const targetNorm = normalizeUserName(personName);
    if (targetNorm === currentUserName) return;

    const existing = channels.find(c => {
      if (c.channel_type !== "DIRECT") return false;
      if (Array.isArray(c.members) && c.members.length > 0) {
        const normMembers = c.members.map(m => normalizeUserName(m));
        return normMembers.includes(targetNorm) && normMembers.includes(currentUserName);
      }
      // Kênh cũ không có danh sách thành viên: chỉ nhận khi đúng cặp người tạo / người nhận
      const nameNorm = normalizeUserName(c.name);
      const creatorNorm = normalizeUserName(c.created_by);
      return (nameNorm === targetNorm && creatorNorm === currentUserName) || (nameNorm === currentUserName && creatorNorm === targetNorm);
    });

    if (existing) {
      setActiveChannel(existing);
      setIsStartDMModalOpen(false);
      fetchMessages(existing.id);
    } else {
      try {
        const res = await fetch("/api/chat?action=create_channel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `${personName}`,
            channel_type: "DIRECT",
            department: "Tin nhắn riêng",
            description: `Cuộc trò chuyện trực tiếp giữa ${currentUserName} và ${personName}`,
            is_private: true,
            created_by: currentUserName,
            members: [currentUserName, personName]
          })
        });
        const data = await res.json();
        if (data.success && data.channel) {
          setIsStartDMModalOpen(false);
          setActiveChannel(data.channel);
          setChannels(prev => {
            const idx = prev.findIndex(c => c.id === data.channel.id || c.channel_code === data.channel.channel_code);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = data.channel;
              return updated;
            }
            return [data.channel, ...prev];
          });
          fetchMessages(data.channel.id);
          await fetchChannels(data.channel.channel_code);
        } else {
          showToast(data.error || "Không thể kết nối cuộc trò chuyện", "error");
        }
      } catch (err: any) {
        showToast("Không thể mở cuộc trò chuyện trực tiếp", "error");
      }
    }
  };

  // 9. Open Channel in Split View (Song song)
  const handleOpenInSplitView = (channelToSplit: ChatChannel) => {
    if (activeChannel?.id === channelToSplit.id) {
      showToast("Kênh này đã đang mở ở khung chính", "info");
      return;
    }
    setSplitChannel(channelToSplit);
    showToast(`Đã mở #${channelToSplit.name} ở khung song song`, "info");
  };

  // Swap Left and Right panes
  const handleSwapPanes = () => {
    if (!activeChannel || !splitChannel) return;
    const temp = activeChannel;
    setActiveChannel(splitChannel);
    setSplitChannel(temp);
  };

  // 10. Open Channel Settings Modal
  const handleOpenChannelSettings = (channel?: ChatChannel) => {
    const target = channel || activeChannel;
    if (!target) return;
    setEditChannelForm({
      id: target.id,
      name: target.name,
      department: target.department || "Liên phòng ban",
      description: target.description || "",
      is_private: !!target.is_private,
      created_by: target.created_by || "",
      members: Array.isArray(target.members) ? target.members : []
    });
    setIsChannelSettingsModalOpen(true);
  };

  // Save Channel Settings (Update)
  const handleSaveChannelSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editChannelForm.name.trim()) {
      showToast("Tên nhóm không được để trống", "warning");
      return;
    }
    try {
      const res = await fetch("/api/chat?action=update_channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: editChannelForm.id,
          name: editChannelForm.name,
          department: editChannelForm.department,
          description: editChannelForm.description,
          is_private: editChannelForm.is_private,
          user_name: currentUserName
        })
      });
      const data = await res.json();
      if (data.success && data.channel) {
        showToast("Cập nhật cài đặt nhóm thành công!", "success");
        setIsChannelSettingsModalOpen(false);
        await fetchChannels(data.channel.channel_code);
        if (activeChannel?.id === data.channel.id) {
          setActiveChannel(data.channel);
        }
        if (splitChannel?.id === data.channel.id) {
          setSplitChannel(data.channel);
        }
      } else {
        showToast(data.error || "Lỗi cập nhật cài đặt", "error");
      }
    } catch (err: any) {
      showToast("Lỗi: " + err.message, "error");
    }
  };

  // Delete Channel (Xóa nhóm chat vĩnh viễn)
  const handleDeleteChannel = async () => {
    if (!editChannelForm.id) return;
    try {
      const res = await fetch("/api/chat?action=delete_channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: editChannelForm.id,
          user_name: currentUserName
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("Đã xóa vĩnh viễn nhóm chat!", "info");
        setIsDeleteConfirmOpen(false);
        setIsChannelSettingsModalOpen(false);
        if (activeChannel?.id === editChannelForm.id) {
          setActiveChannel(null);
        }
        if (splitChannel?.id === editChannelForm.id) {
          setSplitChannel(null);
        }
        await fetchChannels();
      } else {
        showToast(data.error || "Lỗi khi xóa nhóm chat", "error");
      }
    } catch (e: any) {
      showToast("Lỗi kết nối: " + e.message, "error");
    }
  };

  // Remove Member from Group
  const handleRemoveMember = async (memberName: string) => {
    if (!editChannelForm.id) return;
    try {
      const res = await fetch("/api/chat?action=remove_member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: editChannelForm.id,
          member_name: memberName,
          removed_by: currentUserName
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Đã xóa ${memberName} khỏi nhóm`, "success");
        setEditChannelForm(prev => ({ ...prev, members: data.members }));
        if (activeChannel?.id === editChannelForm.id) {
          setActiveChannel(prev => prev ? { ...prev, members: data.members } : null);
        }
        fetchChannels();
      }
    } catch (e: any) {
      showToast("Lỗi: " + e.message, "error");
    }
  };

  // Leave Channel
  const handleLeaveChannel = async () => {
    if (!editChannelForm.id) return;
    try {
      const res = await fetch("/api/chat?action=leave_channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: editChannelForm.id,
          member_name: currentUserName
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("Bạn đã rời khỏi nhóm chat", "info");
        setIsChannelSettingsModalOpen(false);
        if (activeChannel?.id === editChannelForm.id) {
          setActiveChannel(null);
        }
        if (splitChannel?.id === editChannelForm.id) {
          setSplitChannel(null);
        }
        await fetchChannels();
      }
    } catch (e: any) {
      showToast("Lỗi: " + e.message, "error");
    }
  };

  // Add Member to Active Channel / Group
  const handleAddMembersToActiveChannel = async () => {
    if (!activeChannel || addMembersSelected.length === 0) return;
    try {
      const res = await fetch("/api/chat?action=add_members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: activeChannel.id,
          new_members: addMembersSelected,
          added_by: currentUserName
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Đã thêm ${addMembersSelected.length} thành viên vào nhóm`, "success");
        setIsAddMemberModalOpen(false);
        setAddMembersSelected([]);
        setActiveChannel(prev => prev ? { ...prev, members: data.members } : null);
        fetchMessages(activeChannel.id);
      } else {
        showToast(data.error || "Lỗi thêm thành viên", "error");
      }
    } catch (e: any) {
      showToast("Lỗi: " + e.message, "error");
    }
  };

  // Auto-generate group name suggestion based on selected members
  const handleAutoSuggestGroupName = () => {
    if (!newChannelForm.selectedMembers || newChannelForm.selectedMembers.length === 0) return;
    const names = newChannelForm.selectedMembers.map(m => String(m || "").split(" ").slice(-1)[0]).filter(Boolean);
    const myLastName = String(currentUserName || "Admin").split(" ").slice(-1)[0] || "Admin";
    const suggested = `Nhóm ${myLastName}, ${names.slice(0, 3).join(", ")}${names.length > 3 ? "..." : ""}`;
    setNewChannelForm(prev => ({ ...prev, name: suggested }));
  };

  // Filtered Channels for sidebar
  const departmentChannels = useMemo(() => {
    return channels.filter(c => c.channel_type === "CHANNEL" && c.name.toLowerCase().includes(searchChannelQuery.toLowerCase()));
  }, [channels, searchChannelQuery]);

  const projectAndGroupChannels = useMemo(() => {
    return channels.filter(c => (c.channel_type === "PROJECT" || c.channel_type === "GROUP") && c.name.toLowerCase().includes(searchChannelQuery.toLowerCase()));
  }, [channels, searchChannelQuery]);

  const directChannels = useMemo(() => {
    return channels.filter(c => {
      if (c.channel_type !== "DIRECT") return false;
      const other = getChannelDisplayName(c);
      return other.toLowerCase().includes(searchChannelQuery.toLowerCase());
    });
  }, [channels, searchChannelQuery, currentUserName]);

  // Deduplicated personnel list ensuring each employee appears exactly once
  const uniquePersonnel = useMemo(() => {
    return dedupePersonnel(personnelList);
  }, [personnelList]);

  // Unified list of colleagues for direct 1-1 chat in the sidebar (no modal needed!)
  const sidebarColleagues = useMemo(() => {
    const query = searchChannelQuery.toLowerCase().trim();
    
    // All unique colleagues excluding current user
    const colleagues = uniquePersonnel.filter(p => {
      if (normalizeUserName(p.full_name) === currentUserName) return false;
      if (!query) return true;
      return (
        p.full_name?.toLowerCase().includes(query) ||
        p.username?.toLowerCase().includes(query) ||
        p.employee_code?.toLowerCase().includes(query) ||
        p.department?.toLowerCase().includes(query)
      );
    });

    // Map each colleague with existing direct channel (if any) and presence
    const mapped = colleagues.map(p => {
      const targetNorm = normalizeUserName(p.full_name);
      const matchingChannel = channels.find(c => {
        if (c.channel_type !== "DIRECT") return false;
        const otherName = getChannelDisplayName(c);
        return normalizeUserName(otherName) === targetNorm;
      });
      const presence = getUserPresence(p.full_name);
      const unreadCount = getChannelUnreadCount(matchingChannel);

      return {
        colleague: p,
        channel: matchingChannel,
        presence,
        unreadCount
      };
    });

    // Helper to extract message timestamp in ms
    const getMsgTime = (item: (typeof mapped)[0]): number => {
      if (!item.channel) return 0;
      const raw = item.channel.last_message_time || item.channel.last_message_at;
      if (!raw) return (Number(item.channel.message_count) || 0) > 0 ? 1 : 0;
      const t = new Date(raw).getTime();
      return isNaN(t) ? ((Number(item.channel.message_count) || 0) > 0 ? 1 : 0) : t;
    };

    // Helper for presence rank: online (2) > away (1) > offline (0)
    const getPresenceRank = (status?: string): number => {
      if (status === "online") return 2;
      if (status === "away") return 1;
      return 0;
    };

    // Sort priority:
    // 1. Unread messages first (newest unread on top)
    // 2. Both have conversation history: newest message timestamp, with online boost
    // 3. Colleagues with history rank above colleagues without history
    // 4. Colleagues without history: Online -> Away -> Offline
    // 5. Alphabetical fallback
    return mapped.sort((a, b) => {
      if (a.unreadCount > 0 || b.unreadCount > 0) {
        if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
        if (b.unreadCount > 0 && a.unreadCount === 0) return 1;
        const tDiff = getMsgTime(b) - getMsgTime(a);
        if (tDiff !== 0) return tDiff;
      }

      const tA = getMsgTime(a);
      const tB = getMsgTime(b);
      const rankA = getPresenceRank(a.presence.status);
      const rankB = getPresenceRank(b.presence.status);

      // Both have conversation history
      if (tA > 0 && tB > 0) {
        const timeDiff = tB - tA;
        // Prioritize online colleague if timestamps are close (within 30 mins)
        if (rankA !== rankB && Math.abs(timeDiff) < 30 * 60 * 1000) {
          return rankB - rankA;
        }
        if (timeDiff !== 0) return timeDiff;
        if (rankA !== rankB) return rankB - rankA;
      }

      // One has history, one does not
      if ((tA > 0) !== (tB > 0)) {
        return tA > 0 ? -1 : 1;
      }

      // Neither has history: Online (2) > Away (1) > Offline (0)
      if (rankA !== rankB) {
        return rankB - rankA;
      }

      return (a.colleague.full_name || "").localeCompare(b.colleague.full_name || "");
    });
  }, [uniquePersonnel, channels, activeChannel, searchChannelQuery, currentUserName, getChannelUnreadCount]);

  // Total unread DMs count across all colleagues
  const totalUnreadDMs = useMemo(() => {
    return sidebarColleagues.reduce((sum, item) => sum + (item.unreadCount || 0), 0);
  }, [sidebarColleagues]);

  // Filtered Personnel for DM modal
  const matchDept = (d1?: string, d2?: string): boolean => {
    if (!d1 || !d2) return false;
    if (d1 === "Tất cả" || d2 === "Tất cả") return true;
    const s1 = d1.toLowerCase().trim();
    const s2 = d2.toLowerCase().trim();
    if (s1 === s2) return true;
    const isProc = (s: string) => s.includes("mua hàng") || s.includes("cung ứng") || s.includes("procurement") || s.includes("purchasing");
    if (isProc(s1) && isProc(s2)) return true;
    const isApp = (s: string) => s.includes("ứng dụng") || s.includes("kỹ thuật") || s.includes("application") || s === "app";
    if (isApp(s1) && isApp(s2)) return true;
    const isWh = (s: string) => s.includes("kho");
    if (isWh(s1) && isWh(s2)) return true;
    const isAcc = (s: string) => s.includes("kế toán") || s.includes("tài chính");
    if (isAcc(s1) && isAcc(s2)) return true;
    const isSales = (s: string) => s.includes("kinh doanh") || s.includes("sales") || s.includes("marketing");
    if (isSales(s1) && isSales(s2)) return true;
    const isBod = (s: string) => s.includes("giám đốc") || s.includes("bod") || s.includes("quản trị");
    if (isBod(s1) && isBod(s2)) return true;
    const isLegal = (s: string) => s.includes("pháp chế") || s.includes("legal");
    if (isLegal(s1) && isLegal(s2)) return true;
    return s1.includes(s2) || s2.includes(s1);
  };

  const filteredPersonnelForDM = useMemo(() => {
    return uniquePersonnel.filter(p => {
      if (normalizeUserName(p.full_name) === currentUserName) return false;
      if (dmDeptFilter !== "Tất cả" && !matchDept(p.department, dmDeptFilter)) return false;
      if (!dmSearchQuery.trim()) return true;
      const q = dmSearchQuery.toLowerCase().trim();
      return (
        p.full_name?.toLowerCase().includes(q) ||
        p.username?.toLowerCase().includes(q) ||
        p.employee_code?.toLowerCase().includes(q) ||
        (p.department && p.department.toLowerCase().includes(q)) ||
        (p.position && p.position.toLowerCase().includes(q)) ||
        (p.email && p.email.toLowerCase().includes(q))
      );
    });
  }, [uniquePersonnel, currentUserName, dmDeptFilter, dmSearchQuery]);

  // Filtered Personnel for Create Group Modal
  const filteredPersonnelForGroup = useMemo(() => {
    return uniquePersonnel.filter(p => {
      if (normalizeUserName(p.full_name) === currentUserName) return false;
      if (memberPickerDept !== "Tất cả" && !matchDept(p.department, memberPickerDept)) return false;
      if (!memberPickerSearch.trim()) return true;
      const q = memberPickerSearch.toLowerCase().trim();
      return (
        p.full_name?.toLowerCase().includes(q) ||
        p.username?.toLowerCase().includes(q) ||
        p.employee_code?.toLowerCase().includes(q) ||
        (p.department && p.department.toLowerCase().includes(q)) ||
        (p.position && p.position.toLowerCase().includes(q))
      );
    });
  }, [uniquePersonnel, currentUserName, memberPickerDept, memberPickerSearch]);

  // Top colleagues sorted by active status for quick sidebar access
  const topColleagues = useMemo(() => {
    return [...uniquePersonnel]
      .filter(p => normalizeUserName(p.full_name) !== currentUserName)
      .sort((a, b) => {
        const rank = (status?: string) => (status === "online" ? 0 : status === "away" ? 1 : 2);
        return rank(a.presence_status) - rank(b.presence_status);
      })
      .slice(0, 12);
  }, [uniquePersonnel, currentUserName]);

  // Filter messages by search
  const displayedMessages = useMemo(() => {
    if (!messageSearchQuery.trim()) return messages;
    return messages.filter(m => m.content.toLowerCase().includes(messageSearchQuery.toLowerCase()));
  }, [messages, messageSearchQuery]);

  const recipientProfile = activeChannel?.channel_type === "DIRECT" ? getRecipientProfile(activeChannel) : null;
  const splitRecipientProfile = splitChannel?.channel_type === "DIRECT" ? getRecipientProfile(splitChannel) : null;

  return (
    <div className="flex h-[calc(100vh-5.5rem)] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-md">
      {/* ==================== 1. LEFT SIDEBAR: CHANNELS, GROUPS & DMS ==================== */}
      <div className="w-64 sm:w-72 md:w-80 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 shrink-0">
        {/* Workspace Brand Header */}
        <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center font-black shadow-sm">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-extrabold text-xs text-slate-900 dark:text-white leading-tight">
                TBRs Communication
              </h2>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 truncate max-w-[170px]" title={`Tài khoản hiện tại của bạn: ${currentUserName}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span className="truncate">{currentUserName}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setNewChannelForm({
                  name: "",
                  channel_type: "GROUP",
                  department: "Liên phòng ban",
                  description: "",
                  is_private: true,
                  selectedMembers: []
                });
                setIsCreateChannelModalOpen(true);
              }}
              className="p-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 transition-colors cursor-pointer"
              title="Tạo nhóm chat / Kênh mới"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Search Channels */}
        <div className="p-2 border-b border-slate-200/60 dark:border-slate-800/60">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchChannelQuery}
              onChange={(e) => setSearchChannelQuery(e.target.value)}
              placeholder="Tìm kênh, nhóm, đồng nghiệp..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Channels & DMs Scrollable List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-4 text-xs">
          {/* SECTION A: NHÓM PHỐI HỢP & DỰ ÁN */}
          <div>
            <div className="px-2 py-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <span>Nhóm Phối Hợp &amp; Dự Án ({projectAndGroupChannels.length})</span>
              <button
                type="button"
                onClick={() => {
                  setNewChannelForm(prev => ({ ...prev, channel_type: "GROUP", department: "Liên phòng ban" }));
                  setIsCreateChannelModalOpen(true);
                }}
                className="hover:text-indigo-600 p-0.5 rounded cursor-pointer"
                title="Tạo nhóm chat mới"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1 mt-1">
              {projectAndGroupChannels.map((c) => {
                const isActive = activeChannel?.id === c.id;
                const isSplitActive = splitChannel?.id === c.id;
                const isGroup = c.channel_type === "GROUP";
                return (
                  <div key={c.id} className="group/item flex items-center gap-1">
                    <button
                      onClick={() => setActiveChannel(c)}
                      className={`flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left font-semibold transition-all cursor-pointer ${
                        isActive
                          ? "bg-indigo-600 text-white shadow-xs"
                          : isSplitActive
                          ? "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700"
                          : "bg-slate-100/90 hover:bg-slate-200/80 border border-slate-200/80 text-slate-800 dark:bg-slate-900/40 dark:hover:bg-slate-800/60 dark:border-slate-800 dark:text-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-xs">{isGroup ? "👥" : "🎯"}</span>
                        <span className="truncate">{c.name}</span>
                      </div>
                      {isSplitActive ? (
                        <span className="text-[9px] px-1.5 py-0.2 rounded-full font-bold bg-purple-600 text-white">
                          Song song
                        </span>
                      ) : !isActive && getChannelUnreadCount(c) > 0 ? (
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-rose-500 text-white shadow-xs">
                          {getChannelUnreadCount(c)}
                        </span>
                      ) : null}
                    </button>

                    {/* Quick action: Open in Split View */}
                    <button
                      type="button"
                      onClick={() => handleOpenInSplitView(c)}
                      className="opacity-0 group-hover/item:opacity-100 p-1 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-200 dark:hover:bg-slate-800 transition-opacity cursor-pointer shrink-0"
                      title="Mở trong khung chat song song"
                    >
                      <Columns className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
              {projectAndGroupChannels.length === 0 && (
                <div className="text-[11px] text-slate-400 px-2 py-1 italic">
                  Chưa có nhóm phối hợp nào. Nhấp dấu + để tạo nhóm.
                </div>
              )}
            </div>
          </div>

          {/* SECTION B: TIN NHẮN TRỰC TIẾP (DIRECT MESSAGES 1-1) - CLICK ĐỂ CHAT NGAY */}
          <div>
            <div className="px-2 py-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
                <span>Tin Nhắn Riêng (1-1)</span>
              </div>
              {totalUnreadDMs > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-rose-500 text-white shadow-xs" title={`${totalUnreadDMs} tin nhắn mới chưa đọc`}>
                  {totalUnreadDMs}
                </span>
              )}
            </div>

            <div className="space-y-1 mt-1 max-h-[360px] overflow-y-auto pr-0.5 custom-scrollbar">
              {sidebarColleagues.map((item) => {
                const colleagueName = item.colleague.full_name;
                const colleaguePalette = getSenderPalette(colleagueName);
                const isActive = activeChannel?.channel_type === "DIRECT" && (
                  (item.channel && activeChannel?.id === item.channel.id) ||
                  getChannelDisplayName(activeChannel) === colleagueName
                );
                const isSplitActive = splitChannel?.channel_type === "DIRECT" && (
                  (item.channel && splitChannel?.id === item.channel.id) ||
                  getChannelDisplayName(splitChannel) === colleagueName
                );
                const presence = item.presence;
                const unreadCount = item.unreadCount;

                return (
                  <div key={item.colleague.id || item.colleague.employee_code || colleagueName} className="group/dm flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (item.channel) {
                          setActiveChannel(item.channel);
                          markChannelAsRead(item.channel.id, Number(item.channel.message_count) || 0);
                          fetchMessages(item.channel.id);
                        } else {
                          handleOpenDirectMessage(colleagueName);
                        }
                      }}
                      className={`flex-1 flex items-center justify-between px-2.5 py-2 rounded-xl text-left font-semibold transition-all cursor-pointer ${
                        isActive
                          ? "bg-indigo-600 text-white shadow-xs"
                          : isSplitActive
                          ? "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700"
                          : colleaguePalette.sidebarCard
                      }`}
                      title={`Nhấp để chat riêng với ${colleagueName}`}
                    >
                      <div className="flex items-center gap-2.5 truncate min-w-0">
                        <div className="relative shrink-0">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] ${
                            isActive 
                              ? "bg-white/20 text-white" 
                              : `${colleaguePalette.avatar} shadow-2xs`
                          }`}>
                            {(String(colleagueName || "U")).slice(0, 1).toUpperCase()}
                          </div>
                          <span 
                            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ${
                              isActive ? "ring-indigo-600" : "ring-white dark:ring-slate-900"
                            } ${presence.dotClass} ${presence.status === "online" ? "animate-pulse" : ""}`}
                            title={`${colleagueName}: ${presence.label}`}
                          />
                        </div>
                        <div className="truncate min-w-0">
                          <div className="truncate font-semibold text-xs leading-tight">{colleagueName}</div>
                          <div className="flex items-center gap-1 text-[10px] mt-0.5 leading-none">
                            {presence.status === "online" ? (
                              <span className={`font-bold flex items-center gap-1 ${isActive ? "text-emerald-200" : "text-emerald-600 dark:text-emerald-400"}`}>
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                                Online
                              </span>
                            ) : presence.status === "away" ? (
                              <span className={isActive ? "text-amber-200" : "text-amber-600 dark:text-amber-400 font-medium"}>
                                Vắng mặt
                              </span>
                            ) : (
                              <span className={`truncate ${isActive ? "text-indigo-200" : "text-slate-600 dark:text-slate-400 font-medium"}`}>
                                {item.colleague.department || "Ngoại tuyến"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {unreadCount > 0 ? (
                          <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-rose-500 text-white shadow-xs">
                            {unreadCount}
                          </span>
                        ) : null}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (item.channel) {
                          handleOpenInSplitView(item.channel);
                        } else {
                          handleOpenDirectMessage(colleagueName);
                        }
                      }}
                      className="opacity-0 group-hover/dm:opacity-100 p-1 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-200 dark:hover:bg-slate-800 transition-opacity cursor-pointer shrink-0"
                      title="Mở trong khung chat song song"
                    >
                      <Columns className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}

              {sidebarColleagues.length === 0 && (
                <div className="text-[11px] text-slate-400 px-2 py-2 italic text-center">
                  Không tìm thấy đồng nghiệp phù hợp
                </div>
              )}
            </div>
          </div>

          {/* SECTION C: KÊNH PHÒNG BAN & TOÀN CÔNG TY */}
          <div>
            <div className="px-2 py-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <span>Kênh Phòng Ban ({departmentChannels.length})</span>
            </div>
            <div className="space-y-1 mt-1">
              {departmentChannels.map((c) => {
                const isActive = activeChannel?.id === c.id;
                return (
                  <div key={c.id} className="group/ch flex items-center gap-1">
                    <button
                      onClick={() => {
                        setActiveChannel(c);
                        markChannelAsRead(c.id, Number(c.message_count) || 0);
                      }}
                      className={`flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left font-semibold transition-all cursor-pointer ${
                        isActive
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "bg-slate-100/90 hover:bg-slate-200/80 border border-slate-200/80 text-slate-800 dark:bg-slate-900/40 dark:hover:bg-slate-800/60 dark:border-slate-800 dark:text-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Hash className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-white" : "text-slate-400"}`} />
                        <span className="truncate">{c.name}</span>
                      </div>
                      {!isActive && getChannelUnreadCount(c) > 0 ? (
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-rose-500 text-white shadow-xs">
                          {getChannelUnreadCount(c)}
                        </span>
                      ) : null}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenInSplitView(c)}
                      className="opacity-0 group-hover/ch:opacity-100 p-1 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-200 dark:hover:bg-slate-800 transition-opacity cursor-pointer shrink-0"
                      title="Mở song song"
                    >
                      <Columns className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ==================== 2. CENTER: MAIN CHAT PANE (PANE 1) ==================== */}
      <div className="flex-1 flex overflow-hidden">
        {activeChannel ? (
          <div className={`flex flex-col h-full overflow-hidden bg-white dark:bg-slate-900 ${splitChannel ? "w-1/2 border-r border-slate-200 dark:border-slate-800" : "flex-1"}`}>
            {/* Chat Top Header */}
            <div className="h-14 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                    {activeChannel.channel_type === "DIRECT" ? (
                      (String(recipientProfile?.name || "U")).slice(0, 1).toUpperCase()
                    ) : activeChannel.channel_type === "GROUP" ? (
                      "👥"
                    ) : activeChannel.channel_type === "PROJECT" ? (
                      "🎯"
                    ) : (
                      <Hash className="w-4 h-4" />
                    )}
                  </div>
                  {activeChannel.channel_type === "DIRECT" && recipientProfile?.name && (
                    <span 
                      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                        getUserPresence(recipientProfile.name).dotClass
                      } ${getUserPresence(recipientProfile.name).status === "online" ? "animate-pulse" : ""}`}
                      title={getUserPresence(recipientProfile.name).label}
                    />
                  )}
                </div>
                <div className="overflow-hidden">
                  <div className="flex items-center gap-2 flex-wrap">
                    {activeChannel.channel_type === "DIRECT" ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-400">Trò chuyện với:</span>
                        <h3 className="font-extrabold text-sm text-slate-900 dark:text-white truncate">
                          {recipientProfile?.name}
                        </h3>
                      </div>
                    ) : (
                      <h3 className="font-extrabold text-sm text-slate-900 dark:text-white truncate">
                        {activeChannel.channel_type === "CHANNEL"
                          ? `#${activeChannel.name}`
                          : activeChannel.name}
                      </h3>
                    )}
                    {splitChannel && (
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                        Khung 1
                      </span>
                    )}

                    {/* Status Pill Indicator */}
                    {activeChannel.channel_type === "DIRECT" && recipientProfile?.name ? (
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        getUserPresence(recipientProfile.name).badgeClass
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${getUserPresence(recipientProfile.name).dotClass}`} />
                        {getUserPresence(recipientProfile.name).label}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        <span>👥 {Array.isArray(activeChannel.members) ? activeChannel.members.length : 0} thành viên</span>
                        {(() => {
                          const onlineCount = (Array.isArray(activeChannel.members) ? activeChannel.members : []).filter(m => getUserPresence(m).status === "online").length;
                          return onlineCount > 0 ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold ml-1">
                              • 🟢 {onlineCount} online
                            </span>
                          ) : null;
                        })()}
                      </span>
                    )}

                    <span className="hidden sm:inline-block text-[10px] font-semibold px-2 py-0.2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                      {activeChannel.channel_type === "DIRECT"
                        ? `${recipientProfile?.position || "Đồng nghiệp"}`
                        : activeChannel.department || "Liên phòng ban"}
                    </span>
                  </div>
                  {activeChannel.channel_type === "DIRECT" ? (
                    <p className="text-[11px] text-slate-400 truncate max-w-sm mt-0.5">
                      {recipientProfile?.position ? `${recipientProfile.position} • ` : ""}{recipientProfile?.department || "Tin nhắn riêng 1-1"}
                    </p>
                  ) : activeChannel.description ? (
                    <p className="text-[11px] text-slate-400 truncate max-w-xs mt-0.5">
                      {activeChannel.description}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Action Tools Header */}
              <div className="flex items-center gap-1">
                {/* Search In Chat */}
                <div className="relative">
                  {isSearchingInChat ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        autoFocus
                        value={messageSearchQuery}
                        onChange={(e) => setMessageSearchQuery(e.target.value)}
                        placeholder="Tìm tin nhắn..."
                        className="px-2 py-1 rounded-lg text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 w-36"
                      />
                      <button
                        onClick={() => { setMessageSearchQuery(""); setIsSearchingInChat(false); }}
                        className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsSearchingInChat(true)}
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      title="Tìm tin nhắn"
                    >
                      <Search className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Channel Settings Button (Cài đặt nhóm chat) */}
                <button
                  type="button"
                  onClick={() => handleOpenChannelSettings(activeChannel)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  title="Cài đặt & Quản lý nhóm chat"
                >
                  <Settings className="w-4 h-4" />
                </button>

                {/* Toggle Right Drawer */}
                {!splitChannel && (
                  <button
                    onClick={() => setIsRightDrawerOpen(!isRightDrawerOpen)}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                      isRightDrawerOpen
                        ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                        : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                    title="Thông tin nhóm & thành viên"
                  >
                    <Users className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Pinned Banner */}
            {((activeChannel.pinned_messages && activeChannel.pinned_messages.length > 0) || messages.some(m => m.is_pinned)) && (() => {
              const pinnedList = (activeChannel.pinned_messages && activeChannel.pinned_messages.length > 0)
                ? activeChannel.pinned_messages
                : messages.filter(m => m.is_pinned).map(m => ({ id: m.id, content: m.content, sender_name: m.sender_name }));
              const latestPin = pinnedList[pinnedList.length - 1];
              if (!latestPin) return null;
              return (
                <div className="bg-amber-50 dark:bg-amber-950/40 px-3.5 py-1.5 border-b border-amber-200 dark:border-amber-900/50 flex items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
                  <div
                    onClick={() => latestPin.id && scrollToMessage(Number(latestPin.id))}
                    className="flex items-center gap-1.5 truncate cursor-pointer hover:underline"
                    title="Bấm để cuộn tới tin nhắn đã ghim"
                  >
                    <Pin className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="font-extrabold shrink-0">📌 Tin đã ghim ({pinnedList.length}):</span>
                    {latestPin.sender_name && (
                      <span className="font-semibold text-amber-700 dark:text-amber-300 shrink-0">
                        {latestPin.sender_name}:
                      </span>
                    )}
                    <span className="truncate max-w-md">{latestPin.content || "[Tệp đính kèm / Hình ảnh]"}</span>
                  </div>
                  {latestPin.id && (
                    <button
                      type="button"
                      onClick={() => handleTogglePin(Number(latestPin.id))}
                      className="text-[10px] font-bold text-amber-700 hover:text-rose-600 dark:text-amber-300 px-2 py-0.5 rounded bg-amber-100/80 dark:bg-amber-900/50 hover:bg-rose-50 cursor-pointer shrink-0 transition-colors"
                      title="Bỏ ghim tin nhắn này"
                    >
                      Bỏ ghim ×
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
              {messagesLoading && (
                <div className="text-center py-6 text-xs text-slate-400">
                  Đang tải nội dung cuộc trò chuyện...
                </div>
              )}

              {!messagesLoading && displayedMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full min-h-[260px] text-center py-12 text-slate-400 dark:text-slate-500 space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-500 flex items-center justify-center">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <div className="font-bold text-xs text-slate-700 dark:text-slate-300">
                    Chưa có tin nhắn nào trong #{activeChannel.name}
                  </div>
                  <div className="text-[11px] max-w-xs text-slate-500">
                    Hãy bắt đầu cuộc trò chuyện hoặc trao đổi công việc với các thành viên tại đây!
                  </div>
                </div>
              )}

              {displayedMessages.map((msg, index) => {
                const isMe = normalizeUserName(msg.sender_name) === currentUserName;
                const isDirectChat = activeChannel.channel_type === "DIRECT";
                const hasAttachments = msg.attachments && msg.attachments.length > 0;
                const reactions = msg.reactions || {};
                const senderPalette = getSenderPalette(msg.sender_name);
                const presence = getUserPresence(msg.sender_name);

                // Date separator calculation (Vietnam timezone)
                const prevMsg = index > 0 ? displayedMessages[index - 1] : null;
                const currentDateStr = formatVietnamDate(msg.created_at);
                const prevDateStr = prevMsg ? formatVietnamDate(prevMsg.created_at) : null;
                const isNewDay = !prevDateStr || currentDateStr !== prevDateStr;
                const dateLabel = isNewDay && msg.created_at ? getVietnamDateLabel(msg.created_at) : "";

                const dateDivider = isNewDay && dateLabel ? (
                  <div className="flex items-center justify-center my-3 select-none">
                    <div className="flex items-center gap-2 max-w-full">
                      <div className="h-px bg-slate-200 dark:bg-slate-700/60 w-8 sm:w-16" />
                      <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300/40 dark:border-slate-700/60 shadow-2xs">
                        <Calendar className="w-3 h-3 text-indigo-500" />
                        {dateLabel}
                      </span>
                      <div className="h-px bg-slate-200 dark:bg-slate-700/60 w-8 sm:w-16" />
                    </div>
                  </div>
                ) : null;

                // --- SENDER IS ME (Right-aligned Indigo Bubble) ---
                if (isMe) {
                  return (
                    <React.Fragment key={msg.id || index}>
                      {dateDivider}
                      <div
                        id={`msg-${msg.id}`}
                        className={`flex justify-end group px-1 py-1 transition-all duration-200 ${
                          highlightedMessageId === msg.id
                            ? "ring-2 ring-indigo-500 rounded-2xl bg-indigo-50/30 dark:bg-indigo-950/40 p-1.5 shadow-md"
                            : ""
                        }`}
                      >
                        <div className="flex items-end gap-1.5 max-w-[82%] sm:max-w-[75%]">
                          {/* Hover action toolbar (left of my bubble) */}
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 pb-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleStartReply(msg)}
                              className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                              title="Trả lời tin nhắn này"
                            >
                              <Reply className="w-3 h-3" />
                            </button>
                            {COMMON_EMOJIS.slice(0, 2).map(em => (
                              <button
                                key={em}
                                type="button"
                                onClick={() => handleToggleReaction(msg.id, em)}
                                className="hover:scale-125 px-0.5 text-xs cursor-pointer"
                                title={`Thả cảm xúc ${em}`}
                              >
                                {em}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => handleTogglePin(msg.id)}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-0.5 cursor-pointer transition-colors ${
                                msg.is_pinned
                                  ? "text-amber-600 bg-amber-100 dark:bg-amber-950/60"
                                  : "text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                              }`}
                              title={msg.is_pinned ? "Bỏ ghim tin nhắn" : "Ghim tin nhắn lên đầu kênh"}
                            >
                              <Pin className="w-3 h-3" />
                              <span>{msg.is_pinned ? "Bỏ ghim" : "Ghim"}</span>
                            </button>
                          </div>

                          {/* Bubble Container */}
                          <div className="flex flex-col items-end min-w-0">
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-1 px-1">
                              <span className="font-bold text-indigo-600 dark:text-indigo-400">Bạn ({currentUserName})</span>
                              <span>•</span>
                              <span 
                                className="hover:text-slate-200 cursor-help transition-colors font-medium"
                                title={`Thời gian gửi (Giờ Việt Nam): ${formatVietnamDateTime(msg?.created_at)}`}
                              >
                                {formatVietnamTime(msg?.created_at)}
                              </span>
                              {msg.is_pinned && (
                                <span className="flex items-center gap-0.5 text-[8px] font-bold text-amber-600 bg-amber-100 dark:bg-amber-950 px-1 rounded">
                                  <Pin className="w-2 h-2" /> Ghim
                                </span>
                              )}
                            </div>

                          {/* Quoted Message Preview if this message is a reply */}
                          {msg.reply_to && (
                            <div
                              onClick={() => scrollToMessage(msg.reply_to!.id)}
                              className="mb-1.5 px-3 py-1.5 rounded-xl bg-indigo-800/60 text-indigo-100 border-l-3 border-indigo-300 text-[11px] cursor-pointer hover:bg-indigo-800/80 transition-colors text-left max-w-full shadow-2xs"
                              title="Bấm để cuộn đến tin nhắn gốc"
                            >
                              <div className="flex items-center gap-1 font-bold text-[10px] text-indigo-200">
                                <Reply className="w-2.5 h-2.5" />
                                <span>Trả lời {msg.reply_to.sender_name}</span>
                              </div>
                              <div className="truncate italic opacity-90 text-[10.5px]">
                                {msg.reply_to.content || (msg.reply_to.has_image ? "📷 [Hình ảnh]" : "Tin nhắn")}
                              </div>
                            </div>
                          )}

                          {/* Primary Bubble */}
                          <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-2xl rounded-tr-xs px-4 py-2.5 shadow-xs text-xs leading-relaxed whitespace-pre-line break-words max-w-full">
                            {String(msg.content || "").replace(/Đang tải hình ảnh \/ tệp lên\.\.\. Vui lòng đợi/gi, "").trim()}
                          </div>

                          {/* Related Work Badge */}
                          {msg.related_work && (
                            <div className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                              <Briefcase className="w-3 h-3" />
                              <span>{msg.related_work.type === "TASK" ? "Công việc" : "Quy trình"}: {msg.related_work.code} - {msg.related_work.title}</span>
                            </div>
                          )}

                          {/* Attachments */}
                          {hasAttachments && (
                            <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                              {msg.attachments?.map((att, aIdx) => {
                                const isImg = att.type?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(att.name);
                                return isImg ? (
                                  <div
                                    key={aIdx}
                                    onClick={() => setPreviewImage(att.url)}
                                    className="w-28 h-20 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 relative group cursor-pointer shadow-2xs"
                                  >
                                    <img src={att.url} alt={att.name} className="w-full h-full object-cover hover:scale-105 transition-transform" />
                                  </div>
                                ) : (
                                  <a
                                    key={aIdx}
                                    href={att.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    download
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-xs font-semibold text-indigo-700 dark:text-indigo-300"
                                  >
                                    <FileText className="w-3.5 h-3.5 text-indigo-600" />
                                    <span className="truncate max-w-[140px]">{att.name}</span>
                                  </a>
                                );
                              })}
                            </div>
                          )}

                          {/* Emoji Reactions */}
                          {Object.keys(reactions).length > 0 && (
                            <div className="mt-1 flex flex-wrap justify-end gap-1">
                              {Object.entries(reactions).map(([emoji, usersList]) => (
                                <button
                                  key={emoji}
                                  onClick={() => handleToggleReaction(msg.id, emoji)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xs hover:bg-slate-50 cursor-pointer"
                                >
                                  <span>{emoji}</span>
                                  <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{usersList.length}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {/* End of Bubble Container */}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                  );
                }

                // --- SENDER IS OTHER PARTICIPANT (Left-aligned) ---
                return (
                  <React.Fragment key={msg.id || index}>
                    {dateDivider}
                    <div
                      id={`msg-${msg.id}`}
                      className={`flex items-start gap-2.5 group px-1 py-1 transition-all duration-200 ${
                        msg.is_pinned ? "bg-amber-50/40 dark:bg-amber-950/20 rounded-xl p-2 border-l-2 border-amber-400" : ""
                      } ${
                        highlightedMessageId === msg.id
                          ? "ring-2 ring-indigo-500 rounded-2xl bg-indigo-50/30 dark:bg-indigo-950/40 p-1.5 shadow-md"
                          : ""
                      }`}
                    >
                      {/* Participant Avatar */}
                      <div className="relative shrink-0 mt-0.5">
                        <div className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center shadow-2xs ${
                          isDirectChat
                            ? "bg-gradient-to-tr from-indigo-500 to-purple-600 text-white"
                            : senderPalette.avatar
                        }`}>
                          {(String(msg?.sender_name || "N")).slice(0, 1).toUpperCase()}
                        </div>
                        <span 
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${presence.dotClass}`}
                          title={`${msg.sender_name}: ${presence.label}`}
                        />
                      </div>

                      {/* Content Container */}
                      <div className="flex-1 max-w-[82%] sm:max-w-[75%] min-w-0">
                        {/* Sender Meta Header */}
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className={`font-bold text-xs ${
                            isDirectChat 
                              ? "text-slate-900 dark:text-white" 
                              : senderPalette.text
                          }`}>
                            {msg?.sender_name || "Đồng nghiệp"}
                          </span>

                          {/* Distinct Department / Role Badge for Group Chats */}
                          {!isDirectChat && (msg?.sender_dept || msg?.sender_role) && (
                            <span className={`text-[9px] px-1.5 py-0.2 rounded-md font-semibold ${senderPalette.badge}`}>
                              {msg.sender_dept || msg.sender_role}
                            </span>
                          )}

                          {/* Quick 1-1 Chat shortcut in group chats */}
                          {!isDirectChat && msg?.sender_name && (
                            <button
                              type="button"
                              onClick={() => handleOpenDirectMessage(msg.sender_name)}
                              className="text-[9px] text-indigo-500 hover:text-indigo-700 hover:underline flex items-center gap-0.5 cursor-pointer font-medium"
                              title={`Nhắn tin riêng 1-1 với ${msg.sender_name}`}
                            >
                              💬 Chat 1-1
                            </button>
                          )}

                          <span 
                            className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-help transition-colors font-medium"
                            title={`Thời gian gửi (Giờ Việt Nam): ${formatVietnamDateTime(msg?.created_at)}`}
                          >
                            {formatVietnamTime(msg?.created_at)}
                          </span>

                          {msg.is_pinned && (
                            <span className="flex items-center gap-0.5 text-[8px] font-bold text-amber-600 bg-amber-100 dark:bg-amber-950 px-1 rounded">
                              <Pin className="w-2 h-2" /> Ghim
                            </span>
                          )}
                        </div>

                      {/* Quoted Message Preview if this message is a reply */}
                      {msg.reply_to && (
                        <div
                          onClick={() => scrollToMessage(msg.reply_to!.id)}
                          className="mb-1.5 px-3 py-1.5 rounded-xl bg-slate-200/80 dark:bg-slate-700/80 text-slate-700 dark:text-slate-200 border-l-3 border-indigo-500 text-[11px] cursor-pointer hover:bg-slate-300/80 dark:hover:bg-slate-600 transition-colors text-left max-w-full shadow-2xs"
                          title="Bấm để cuộn đến tin nhắn gốc"
                        >
                          <div className="flex items-center gap-1 font-bold text-[10px] text-indigo-600 dark:text-indigo-400">
                            <Reply className="w-2.5 h-2.5" />
                            <span>Trả lời {msg.reply_to.sender_name}</span>
                          </div>
                          <div className="truncate italic opacity-90 text-[10.5px]">
                            {msg.reply_to.content || (msg.reply_to.has_image ? "📷 [Hình ảnh]" : "Tin nhắn")}
                          </div>
                        </div>
                      )}

                      {/* Message Bubble */}
                      <div className={`rounded-2xl rounded-tl-xs px-4 py-2.5 text-xs leading-relaxed whitespace-pre-line break-words shadow-2xs ${
                        isDirectChat
                          ? "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/70 dark:border-slate-700/60"
                          : `bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/70 dark:border-slate-700/60 border-l-4 ${senderPalette.bubbleBorder}`
                      }`}>
                        {String(msg.content || "").replace(/Đang tải hình ảnh \/ tệp lên\.\.\. Vui lòng đợi/gi, "").trim()}
                      </div>

                      {/* Related Work Badge */}
                      {msg.related_work && (
                        <div className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                          <Briefcase className="w-3 h-3" />
                          <span>{msg.related_work.type === "TASK" ? "Công việc" : "Quy trình"}: {msg.related_work.code} - {msg.related_work.title}</span>
                        </div>
                      )}

                      {/* Attachments */}
                      {hasAttachments && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {msg.attachments?.map((att, aIdx) => {
                            const isImg = att.type?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(att.name);
                            return isImg ? (
                              <div
                                key={aIdx}
                                onClick={() => setPreviewImage(att.url)}
                                className="w-28 h-20 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 relative group cursor-pointer shadow-2xs"
                              >
                                <img src={att.url} alt={att.name} className="w-full h-full object-cover hover:scale-105 transition-transform" />
                              </div>
                            ) : (
                              <a
                                key={aIdx}
                                href={att.url}
                                target="_blank"
                                rel="noreferrer"
                                download
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 text-xs font-semibold"
                              >
                                <FileText className="w-3.5 h-3.5 text-indigo-600" />
                                <span className="truncate max-w-[140px]">{att.name}</span>
                              </a>
                            );
                          })}
                        </div>
                      )}

                      {/* Reactions */}
                      {Object.keys(reactions).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(reactions).map(([emoji, usersList]) => (
                            <button
                              key={emoji}
                              onClick={() => handleToggleReaction(msg.id, emoji)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xs hover:bg-slate-50 cursor-pointer"
                            >
                              <span>{emoji}</span>
                              <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{usersList.length}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Hover action toolbar (right of colleague's bubble) */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 pt-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartReply(msg)}
                        className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                        title="Trả lời tin nhắn này"
                      >
                        <Reply className="w-3 h-3" />
                      </button>
                      {COMMON_EMOJIS.slice(0, 2).map(em => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => handleToggleReaction(msg.id, em)}
                          className="hover:scale-125 px-0.5 text-xs cursor-pointer"
                          title={`Thả cảm xúc ${em}`}
                        >
                          {em}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => handleTogglePin(msg.id)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-0.5 cursor-pointer transition-colors ${
                          msg.is_pinned
                            ? "text-amber-600 bg-amber-100 dark:bg-amber-950/60"
                            : "text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                        }`}
                        title={msg.is_pinned ? "Bỏ ghim tin nhắn" : "Ghim tin nhắn lên đầu kênh"}
                      >
                        <Pin className="w-3 h-3" />
                        <span>{msg.is_pinned ? "Bỏ ghim" : "Ghim"}</span>
                      </button>
                    </div>
                  </div>
                </React.Fragment>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Box */}
            <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <form onSubmit={handleSendMessage} className="space-y-1.5">
                {/* Replying Banner */}
                {replyingTo && (
                  <div className="flex items-center justify-between px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/50 border-l-4 border-indigo-500 rounded-lg text-xs animate-in fade-in duration-150 shadow-2xs">
                    <div className="flex items-center gap-2 overflow-hidden mr-2">
                      <Reply className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      <div className="truncate">
                        <span className="font-bold text-indigo-700 dark:text-indigo-300">
                          Đang trả lời {replyingTo.sender_name}:
                        </span>{" "}
                        <span className="text-slate-600 dark:text-slate-300 italic">
                          {replyingTo.content || (replyingTo.attachments?.length ? "📷 [Hình ảnh/Tệp đính kèm]" : "Tin nhắn")}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCancelReply(false)}
                      className="p-1 text-slate-400 hover:text-rose-500 rounded-full cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
                      title="Hủy trả lời"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Previews of attachments / pasted images */}
                {inputAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-2 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 max-h-36 overflow-y-auto">
                    {inputAttachments.map((att, idx) => {
                      const isImg = att.type?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(att.name);
                      return (
                        <div
                          key={idx}
                          className="relative group flex items-center gap-1.5 p-1 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xs"
                        >
                          {isImg ? (
                            <img
                              src={att.url}
                              alt={att.name}
                              className="w-12 h-12 object-cover rounded-md cursor-pointer hover:opacity-90"
                              onClick={() => setPreviewImage(att.url)}
                              title="Bấm để xem ảnh phóng to"
                            />
                          ) : (
                            <div className="w-12 h-12 flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-800 rounded-md">
                              <FileText className="w-5 h-5 text-indigo-600" />
                            </div>
                          )}
                          <div className="max-w-[120px] pr-5">
                            <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate" title={att.name}>
                              {att.name}
                            </div>
                            {att.size && (
                              <div className="text-[9px] text-slate-400">
                                {Math.round(att.size / 1024)} KB
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveAttachment(idx, false)}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow-xs cursor-pointer"
                            title="Xóa tệp này"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Uploading progress indicator */}
                {isUploading && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 text-xs rounded-lg border border-orange-200 dark:border-orange-900/50">
                    <Clock className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang tải hình ảnh / tệp lên... Vui lòng đợi</span>
                  </div>
                )}

                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    rows={isInputExpanded ? 5 : 2}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onPaste={(e) => handlePaste(e, false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder={
                      replyingTo
                        ? `Nhập câu trả lời cho ${replyingTo.sender_name}... (Ctrl+V để dán ảnh, Enter để gửi)`
                        : activeChannel.channel_type === "DIRECT"
                        ? `Nhập tin nhắn gửi tới ${recipientProfile?.name || "đồng nghiệp"}... (Ctrl+V để dán ảnh, Enter để gửi)`
                        : `Nhập tin nhắn tới #${activeChannel.name}... (Ctrl+V để dán ảnh, Enter để gửi)`
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 resize-none font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setIsInputExpanded(!isInputExpanded)}
                    className="absolute top-1.5 right-1.5 p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                    title="Mở rộng / thu gọn khung nhập"
                  >
                    {isInputExpanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    {/* General File Upload */}
                    <input
                      type="file"
                      multiple
                      ref={fileInputRef}
                      onChange={(e) => handleUploadFiles(e.target.files, false)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      title="Đính kèm tệp tài liệu"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                    </button>

                    {/* Dedicated Image Upload Button */}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      ref={imageInputRef}
                      onChange={(e) => handleUploadFiles(e.target.files, false)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      title="Chọn và gửi hình ảnh (hoặc Ctrl+V để dán trực tiếp)"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                    </button>

                    {/* Emoji Quick */}
                    <div className="flex items-center gap-0.5">
                      {COMMON_EMOJIS.slice(0, 4).map(em => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => setInputText(prev => prev + em)}
                          className="hover:scale-125 p-0.5 text-xs cursor-pointer"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!inputText.trim() && inputAttachments.length === 0}
                    className="flex items-center gap-1 px-3.5 py-1 rounded-xl font-bold text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white shadow-xs cursor-pointer transition-all"
                  >
                    <span>Gửi</span>
                    <Send className="w-3 h-3" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <MessageSquare className="w-12 h-12 text-slate-300 dark:text-slate-700 mb-3" />
            <h3 className="font-bold text-slate-700 dark:text-slate-300 text-sm">Chưa chọn kênh trao đổi</h3>
          </div>
        )}

        {/* ==================== 2b. SPLIT VIEW PANE (KHUNG CHAT SONG SONG) ==================== */}
        {splitChannel && (
          <div className="w-1/2 flex flex-col h-full overflow-hidden bg-slate-50/40 dark:bg-slate-950/40 border-l border-slate-200 dark:border-slate-800">
            {/* Split Top Header */}
            <div className="h-14 px-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-purple-50/80 dark:bg-purple-950/30 backdrop-blur">
              <div className="flex items-center gap-2 overflow-hidden">
                <div className="relative shrink-0">
                  <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                    {splitChannel.channel_type === "DIRECT" ? (
                      (String(splitRecipientProfile?.name || "U")).slice(0, 1).toUpperCase()
                    ) : splitChannel.channel_type === "GROUP" ? "👥" : <Hash className="w-3.5 h-3.5" />}
                  </div>
                  {splitChannel.channel_type === "DIRECT" && splitRecipientProfile?.name && (
                    <span 
                      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                        getUserPresence(splitRecipientProfile.name).dotClass
                      } ${getUserPresence(splitRecipientProfile.name).status === "online" ? "animate-pulse" : ""}`}
                    />
                  )}
                </div>
                <div className="overflow-hidden">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4 className="font-extrabold text-xs text-slate-900 dark:text-white truncate">
                      {splitChannel.channel_type === "DIRECT" ? splitRecipientProfile?.name : `#${splitChannel.name}`}
                    </h4>
                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-purple-600 text-white">
                      Song song
                    </span>
                    {splitChannel.channel_type === "DIRECT" && splitRecipientProfile?.name ? (
                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-full ${
                        getUserPresence(splitRecipientProfile.name).badgeClass
                      }`}>
                        {getUserPresence(splitRecipientProfile.name).label}
                      </span>
                    ) : (
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        👥 {Array.isArray(splitChannel.members) ? splitChannel.members.length : 0} thành viên
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 block truncate">
                    {splitChannel.department || "Liên phòng ban"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {/* Swap Panes */}
                <button
                  type="button"
                  onClick={handleSwapPanes}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-purple-600 hover:bg-purple-100 dark:hover:bg-purple-950/50 cursor-pointer"
                  title="Hoán đổi 2 khung chat"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </button>

                {/* Settings for split channel */}
                <button
                  type="button"
                  onClick={() => handleOpenChannelSettings(splitChannel)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-purple-600 hover:bg-purple-100 dark:hover:bg-purple-950/50 cursor-pointer"
                  title="Cài đặt nhóm này"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>

                {/* Close Split View */}
                <button
                  type="button"
                  onClick={() => setSplitChannel(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                  title="Đóng khung chat song song"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Split Messages Stream */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs">
              {splitMessagesLoading && (
                <div className="text-center py-6 text-xs text-slate-400">
                  Đang tải tin nhắn song song...
                </div>
              )}

              {splitMessages.map((msg, index) => {
                const isMe = normalizeUserName(msg.sender_name) === currentUserName;
                const isDirect = splitChannel.channel_type === "DIRECT";
                const palette = getSenderPalette(msg.sender_name);

                // Date separator calculation (Vietnam timezone)
                const prevMsg = index > 0 ? splitMessages[index - 1] : null;
                const currentDateStr = formatVietnamDate(msg.created_at);
                const prevDateStr = prevMsg ? formatVietnamDate(prevMsg.created_at) : null;
                const isNewDay = !prevDateStr || currentDateStr !== prevDateStr;
                const dateLabel = isNewDay && msg.created_at ? getVietnamDateLabel(msg.created_at) : "";

                return (
                  <React.Fragment key={msg.id || index}>
                    {isNewDay && dateLabel && (
                      <div className="flex items-center justify-center my-2 select-none">
                        <span className="px-2.5 py-0.5 rounded-full text-[9px] font-semibold bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300/40 dark:border-slate-700/60 shadow-2xs">
                          📅 {dateLabel}
                        </span>
                      </div>
                    )}
                    <div
                      id={`msg-${msg.id}`}
                      className={`flex flex-col group transition-all duration-200 ${isMe ? "items-end" : "items-start"} ${
                        highlightedMessageId === msg.id ? "ring-2 ring-purple-500 rounded-2xl bg-purple-50/20 p-1.5" : ""
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-[9px] text-slate-400 mb-0.5 px-1">
                        <span className={`font-bold ${isMe ? "text-purple-600 dark:text-purple-400" : isDirect ? "text-slate-700 dark:text-slate-200" : palette.text}`}>
                          {isMe ? `Bạn (${currentUserName})` : msg.sender_name}
                        </span>
                        {!isMe && !isDirect && (msg.sender_dept || msg.sender_role) && (
                          <span className={`text-[8px] px-1 py-0.1 rounded font-semibold ${palette.badge}`}>
                            {msg.sender_dept || msg.sender_role}
                          </span>
                        )}
                        <span>•</span>
                        <span 
                          className="cursor-help font-medium"
                          title={`Thời gian gửi (Giờ Việt Nam): ${formatVietnamDateTime(msg?.created_at)}`}
                        >
                          {formatVietnamTime(msg?.created_at)}
                        </span>
                        {/* Quick reply button in split view */}
                        <button
                          type="button"
                          onClick={() => handleStartReply(msg, true)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-purple-600 transition-opacity cursor-pointer ml-1"
                          title="Trả lời tin nhắn này"
                        >
                          <Reply className="w-2.5 h-2.5" />
                        </button>
                      </div>

                      {/* Quoted message in split view */}
                      {msg.reply_to && (
                        <div
                          onClick={() => scrollToMessage(msg.reply_to!.id)}
                          className="mb-1 px-2.5 py-1 rounded-lg bg-slate-200/80 dark:bg-slate-700/80 text-slate-700 dark:text-slate-200 border-l-2 border-purple-500 text-[10px] cursor-pointer hover:opacity-80 transition-opacity text-left max-w-[85%]"
                          title="Bấm để xem tin nhắn gốc"
                        >
                          <span className="font-bold text-purple-600 dark:text-purple-400 mr-1">
                            ↪ {msg.reply_to.sender_name}:
                          </span>
                          <span className="italic truncate">
                            {msg.reply_to.content || (msg.reply_to.has_image ? "[Hình ảnh]" : "")}
                          </span>
                        </div>
                      )}

                      <div
                        className={`p-2.5 rounded-2xl max-w-[85%] text-xs leading-relaxed whitespace-pre-line shadow-2xs ${
                          isMe
                            ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-tr-xs"
                            : isDirect
                            ? "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-xs border border-slate-200 dark:border-slate-700"
                            : `bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-xs border border-slate-200 dark:border-slate-700 border-l-3 ${palette.bubbleBorder}`
                        }`}
                      >
                        {msg.content}
                      </div>

                      {/* Split view attachments */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {msg.attachments.map((att, aIdx) => {
                            const isImg = att.type?.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(att.name);
                            return isImg ? (
                              <img
                                key={aIdx}
                                src={att.url}
                                alt={att.name}
                                onClick={() => setPreviewImage(att.url)}
                                className="w-16 h-14 object-cover rounded-lg cursor-pointer hover:opacity-80 border border-slate-200 dark:border-slate-700"
                              />
                            ) : (
                              <a
                                key={aIdx}
                                href={att.url}
                                target="_blank"
                                rel="noreferrer"
                                download
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                              >
                                <FileText className="w-3 h-3 text-purple-600" />
                                <span className="truncate max-w-[100px]">{att.name}</span>
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
              <div ref={splitMessagesEndRef} />
            </div>

            {/* Split Input Box */}
            <div className="p-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1">
              {/* Replying banner in split view */}
              {splitReplyingTo && (
                <div className="flex items-center justify-between px-2.5 py-1 bg-purple-50 dark:bg-purple-950/50 border-l-2 border-purple-500 rounded-md text-[11px]">
                  <div className="truncate flex items-center gap-1 text-slate-700 dark:text-slate-200">
                    <Reply className="w-3 h-3 text-purple-600 shrink-0" />
                    <span className="font-bold text-purple-700 dark:text-purple-300">
                      Trả lời {splitReplyingTo.sender_name}:
                    </span>
                    <span className="italic truncate">{splitReplyingTo.content || "[Hình ảnh/Tệp]"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCancelReply(true)}
                    className="p-0.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Attachments preview in split view */}
              {splitInputAttachments.length > 0 && (
                <div className="flex flex-wrap gap-1 p-1 bg-slate-50 dark:bg-slate-950/60 rounded-lg">
                  {splitInputAttachments.map((att, idx) => (
                    <div key={idx} className="relative p-1 bg-white dark:bg-slate-800 rounded border border-slate-200 text-[10px] flex items-center gap-1">
                      <span className="truncate max-w-[80px]">{att.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(idx, true)}
                        className="text-rose-500 cursor-pointer"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleSendSplitMessage} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={splitInputText}
                  onChange={(e) => setSplitInputText(e.target.value)}
                  onPaste={(e) => handlePaste(e, true)}
                  placeholder={
                    splitReplyingTo
                      ? `Trả lời ${splitReplyingTo.sender_name}... (Ctrl+V để dán ảnh)`
                      : splitChannel.channel_type === "DIRECT"
                      ? `Nhắn gửi tới ${splitRecipientProfile?.name || "đồng nghiệp"}... (Ctrl+V để dán ảnh)`
                      : `Nhắn tới #${splitChannel.name}... (Ctrl+V để dán ảnh)`
                  }
                  className="flex-1 px-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden"
                />
                <button
                  type="submit"
                  disabled={!splitInputText.trim() && splitInputAttachments.length === 0}
                  className="p-2 rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 cursor-pointer shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* ==================== 3. RIGHT DRAWER: CHANNEL DETAILS & MEMBERS ==================== */}
      {isRightDrawerOpen && activeChannel && !splitChannel && (
        <div className="w-72 border-l border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-3.5 flex flex-col shrink-0 overflow-y-auto space-y-4 text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
            <h4 className="font-bold text-slate-900 dark:text-white">Chi Tiết Nhóm</h4>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleOpenChannelSettings(activeChannel)}
                className="p-1 rounded text-slate-400 hover:text-indigo-600 cursor-pointer"
                title="Cài đặt nhóm"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setIsRightDrawerOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div>
            <span className="font-bold text-slate-500 text-[10px] uppercase">Tên Kênh / Nhóm</span>
            <p className="font-extrabold text-sm text-slate-900 dark:text-white mt-0.5">
              {activeChannel.channel_type === "DIRECT" ? recipientProfile?.name : `#${activeChannel.name}`}
            </p>
            <p className="text-slate-500 text-xs mt-1 leading-relaxed">{activeChannel.description || "Nhóm trao đổi phối hợp công việc TBRs"}</p>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <span className="font-bold text-slate-500 text-[10px] uppercase">Phạm Vi Phụ Trách</span>
            <p className="font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">
              {activeChannel.department || "Liên phòng ban"}
            </p>
          </div>

          {/* Members List */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-500 text-[10px] uppercase">
                Thành Viên ({Array.isArray(activeChannel.members) ? activeChannel.members.length : 0})
              </span>
              {activeChannel.channel_type !== "DIRECT" && (
                <button
                  type="button"
                  onClick={() => setIsAddMemberModalOpen(true)}
                  className="text-indigo-600 dark:text-indigo-400 font-bold text-[10px] hover:underline flex items-center gap-0.5 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Thêm
                </button>
              )}
            </div>

            <div className="space-y-1 max-h-48 overflow-y-auto">
              {Array.isArray(activeChannel.members) && activeChannel.members.map((memName, idx) => {
                const isMe = memName === currentUserName;
                const p = personnelList.find(item => item.full_name === memName);
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <div className="relative shrink-0">
                        <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold text-[10px]">
                          {(String(memName || "N")).slice(0, 1).toUpperCase()}
                        </div>
                        <span 
                          className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-1 ring-white dark:ring-slate-900 ${
                            getUserPresence(memName).dotClass
                          } ${getUserPresence(memName).status === "online" ? "animate-pulse" : ""}`}
                        />
                      </div>
                      <div className="overflow-hidden">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold block leading-tight">
                            {isMe ? `${memName} (Bạn)` : memName}
                          </span>
                          <span className={`text-[9px] font-bold px-1.5 rounded-full ${getUserPresence(memName).badgeClass}`}>
                            {getUserPresence(memName).status === "online" ? "Online" : getUserPresence(memName).label}
                          </span>
                        </div>
                        <span className="text-[9px] text-slate-400 block truncate">
                          {p?.department || "TBR"}
                        </span>
                      </div>
                    </div>

                    {!isMe && (
                      <button
                        type="button"
                        onClick={() => handleOpenDirectMessage(memName)}
                        className="p-1 rounded text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 cursor-pointer shrink-0"
                        title={`Nhắn tin riêng với ${memName}`}
                      >
                        💬
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Actions: Settings & Split View */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
            <button
              type="button"
              onClick={() => handleOpenChannelSettings(activeChannel)}
              className="w-full flex items-center justify-center gap-1.5 p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs cursor-pointer text-slate-700 dark:text-slate-300"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Cài Đặt &amp; Quản Lý Nhóm</span>
            </button>
          </div>
        </div>
      )}

      {/* ==================== MODAL 1: BẮT ĐẦU CHAT RIÊNG (1-1) ==================== */}
      <Modal
        isOpen={isStartDMModalOpen}
        onClose={() => setIsStartDMModalOpen(false)}
        title="BẮT ĐẦU TRÒ CHUYỆN RIÊNG (1-1)"
        size="md"
      >
        <div className="space-y-3 p-1 text-xs">
          <p className="text-slate-500 text-[11px]">
            Chọn bất kỳ đồng nghiệp nào trong công ty để bắt đầu cuộc trò chuyện riêng tư trực tiếp.
          </p>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={dmSearchQuery}
              onChange={(e) => setDmSearchQuery(e.target.value)}
              placeholder="Tìm theo tên nhân viên, phòng ban, chức vụ, email..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-medium"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
            {["Tất cả", "Kinh Doanh", "Application", "Kho & Vận Hành", "Mua Hàng & Cung Ứng", "Ban Giám Đốc", "Kế Toán"].map(dept => (
              <button
                key={dept}
                type="button"
                onClick={() => setDmDeptFilter(dept)}
                className={`px-2.5 py-1 rounded-lg font-bold shrink-0 cursor-pointer ${
                  dmDeptFilter === dept
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                }`}
              >
                {dept}
              </button>
            ))}
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
            {filteredPersonnelForDM.map((p) => {
              const pPalette = getSenderPalette(p.full_name);
              return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleOpenDirectMessage(p.full_name)}
                className={`w-full flex items-center justify-between p-2 rounded-xl transition-all text-left group cursor-pointer ${pPalette.sidebarCard}`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-full ${pPalette.avatar} flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs`}>
                    {(String(p?.full_name || p?.name || "N")).slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200 text-xs">
                      <span>{p.full_name}</span>
                      <span 
                        className={`w-2 h-2 rounded-full shrink-0 ${getUserPresence(p.full_name).dotClass}`} 
                        title={`${p.full_name}: ${getUserPresence(p.full_name).label}`}
                      />
                    </div>
                    <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                      <span className={`font-semibold ${pPalette.text}`}>{p.department}</span>
                      <span>•</span>
                      <span>{p.position || "Thành viên"}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 opacity-80 group-hover:opacity-100">
                  <span>Chat ngay</span>
                  <span>→</span>
                </div>
              </button>
              );
            })}

            {filteredPersonnelForDM.length === 0 && (
              <div className="py-8 text-center text-slate-400">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-xs font-semibold">Không tìm thấy tài khoản đồng nghiệp phù hợp</p>
                {(dmSearchQuery || dmDeptFilter !== "Tất cả") && (
                  <button
                    type="button"
                    onClick={() => { setDmSearchQuery(""); setDmDeptFilter("Tất cả"); }}
                    className="mt-2 text-indigo-500 hover:underline text-xs font-bold cursor-pointer"
                  >
                    Xóa bộ lọc tìm kiếm
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* ==================== MODAL 2: TẠO NHÓM CHAT / KÊNH (VỚI TÙY CHỌN MỞ SONG SONG) ==================== */}
      <Modal
        isOpen={isCreateChannelModalOpen}
        onClose={() => setIsCreateChannelModalOpen(false)}
        title="TẠO NHÓM CHAT &amp; KÊNH PHỐI HỢP CÔNG VIỆC"
        size="lg"
      >
        <form onSubmit={handleCreateChannel} className="space-y-3.5 p-1 text-xs">
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              Loại hình nhóm trao đổi *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setNewChannelForm({ ...newChannelForm, channel_type: "GROUP", department: "Liên phòng ban" })}
                className={`p-2.5 rounded-xl border text-left font-semibold transition-all cursor-pointer ${
                  newChannelForm.channel_type === "GROUP"
                    ? "bg-indigo-50 border-indigo-500 text-indigo-700 dark:bg-indigo-950 dark:border-indigo-600 dark:text-indigo-300 ring-2 ring-indigo-500/20"
                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold mb-0.5 text-xs">
                  <span>👥</span>
                  <span>Nhóm Chat Tự Do</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal leading-tight">
                  Nhóm riêng giữa một vài người (tự do chọn thành viên bất kỳ phòng ban)
                </p>
              </button>

              <button
                type="button"
                onClick={() => setNewChannelForm({ ...newChannelForm, channel_type: "PROJECT", department: "Dự án liên phòng ban" })}
                className={`p-2.5 rounded-xl border text-left font-semibold transition-all cursor-pointer ${
                  newChannelForm.channel_type === "PROJECT"
                    ? "bg-indigo-50 border-indigo-500 text-indigo-700 dark:bg-indigo-950 dark:border-indigo-600 dark:text-indigo-300 ring-2 ring-indigo-500/20"
                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold mb-0.5 text-xs">
                  <span>🎯</span>
                  <span>Nhóm Dự Án / Deal</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal leading-tight">
                  Dành cho các hợp đồng, viện lớn hoặc gói thầu phối hợp
                </p>
              </button>

              <button
                type="button"
                onClick={() => setNewChannelForm({ ...newChannelForm, channel_type: "CHANNEL", department: "Toàn công ty" })}
                className={`p-2.5 rounded-xl border text-left font-semibold transition-all cursor-pointer ${
                  newChannelForm.channel_type === "CHANNEL"
                    ? "bg-indigo-50 border-indigo-500 text-indigo-700 dark:bg-indigo-950 dark:border-indigo-600 dark:text-indigo-300 ring-2 ring-indigo-500/20"
                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold mb-0.5 text-xs">
                  <Hash className="w-3.5 h-3.5" />
                  <span>Kênh Phòng Ban</span>
                </div>
                <p className="text-[10px] text-slate-500 font-normal leading-tight">
                  Kênh thảo luận công khai nội bộ phòng ban hoặc chuyên môn
                </p>
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold text-slate-700 dark:text-slate-300">
                Tên nhóm chat *
              </label>
              {newChannelForm.selectedMembers.length > 0 && (
                <button
                  type="button"
                  onClick={handleAutoSuggestGroupName}
                  className="text-[11px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer"
                >
                  ⚡ Đặt tên theo thành viên đã chọn
                </button>
              )}
            </div>
            <input
              type="text"
              required
              value={newChannelForm.name}
              onChange={(e) => setNewChannelForm({ ...newChannelForm, name: e.target.value })}
              placeholder={newChannelForm.channel_type === "GROUP" ? "VD: Nhóm kỹ thuật demo Chợ Rẫy" : "VD: du-an-bv-bach-mai"}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold text-xs"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Phạm vi phòng ban
              </label>
              <select
                value={newChannelForm.department}
                onChange={(e) => setNewChannelForm({ ...newChannelForm, department: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-semibold text-xs"
              >
                <option value="Liên phòng ban">Liên phòng ban (Tự do)</option>
                <option value="Toàn công ty">Toàn công ty</option>
                <option value="Kinh Doanh">Kinh Doanh</option>
                <option value="Application">Application</option>
                <option value="Kho & Vận Hành">Kho &amp; Vận Hành</option>
                <option value="Mua Hàng & Cung Ứng">Mua Hàng &amp; Cung Ứng (Procurement)</option>
                <option value="Ban Giám Đốc">Ban Giám Đốc</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Tùy chọn hiển thị
              </label>
              {/* Split View Checkbox */}
              <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-purple-800 dark:text-purple-300">
                  <input
                    type="checkbox"
                    checked={openInSplitViewOnCreate}
                    onChange={(e) => setOpenInSplitViewOnCreate(e.target.checked)}
                    className="rounded text-purple-600"
                  />
                  <span>◫ Mở khung chat song song (Split View)</span>
                </label>
                <p className="text-[10px] text-purple-600/80 dark:text-purple-400 mt-0.5 font-normal">
                  Giữ cuộc trò chuyện hiện tại và mở nhóm mới song song bên cạnh để tiện đối chiếu.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              Mục đích trao đổi
            </label>
            <input
              type="text"
              value={newChannelForm.description}
              onChange={(e) => setNewChannelForm({ ...newChannelForm, description: e.target.value })}
              placeholder="VD: Phối hợp demo máy và bàn giao chứng chỉ CO/CQ..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs"
            />
          </div>

          {/* Members Multi-select */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-bold text-slate-700 dark:text-slate-300">
                Thành viên tham gia ({newChannelForm.selectedMembers.length} người đã chọn)
              </label>
              {newChannelForm.selectedMembers.length > 0 && (
                <button
                  type="button"
                  onClick={() => setNewChannelForm(prev => ({ ...prev, selectedMembers: [] }))}
                  className="text-[11px] text-rose-500 hover:underline cursor-pointer"
                >
                  Xóa tất cả
                </button>
              )}
            </div>

            {newChannelForm.selectedMembers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2 p-2 bg-indigo-50/60 dark:bg-indigo-950/40 rounded-xl border border-indigo-200 dark:border-indigo-800">
                {newChannelForm.selectedMembers.map((memName) => {
                  const p = personnelList.find(item => item.full_name === memName);
                  return (
                    <span
                      key={memName}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-600 text-white font-bold text-[11px]"
                    >
                      <span>{memName}</span>
                      <span className="text-indigo-200 text-[10px]">({p?.department || "TBR"})</span>
                      <button
                        type="button"
                        onClick={() => setNewChannelForm(prev => ({
                          ...prev,
                          selectedMembers: prev.selectedMembers.filter(m => m !== memName)
                        }))}
                        className="hover:text-rose-200 p-0.5 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={memberPickerSearch}
                  onChange={(e) => setMemberPickerSearch(e.target.value)}
                  placeholder="Lọc tên nhân viên..."
                  className="w-full pl-8 pr-2 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                />
              </div>

              <select
                value={memberPickerDept}
                onChange={(e) => setMemberPickerDept(e.target.value)}
                className="px-2 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 font-medium"
              >
                <option value="Tất cả">Tất cả phòng ban</option>
                <option value="Kinh Doanh">Kinh Doanh</option>
                <option value="Application">Application</option>
                <option value="Kho & Vận Hành">Kho &amp; Vận Hành</option>
                <option value="Mua Hàng & Cung Ứng">Mua Hàng &amp; Cung Ứng</option>
                <option value="Ban Giám Đốc">Ban Giám Đốc</option>
              </select>
            </div>

            <div className="max-h-36 overflow-y-auto p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-1">
              {filteredPersonnelForGroup.map((p) => {
                const isSelected = newChannelForm.selectedMembers.includes(p.full_name);
                const pPalette = getSenderPalette(p.full_name);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setNewChannelForm(prev => ({
                          ...prev,
                          selectedMembers: prev.selectedMembers.filter(m => m !== p.full_name)
                        }));
                      } else {
                        setNewChannelForm(prev => ({
                          ...prev,
                          selectedMembers: [...prev.selectedMembers, p.full_name]
                        }));
                      }
                    }}
                    className={`w-full flex items-center justify-between p-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200 font-bold border border-indigo-300 dark:border-indigo-700"
                        : pPalette.sidebarCard
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span 
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${getUserPresence(p.full_name).dotClass}`} 
                        title={`${p.full_name}: ${getUserPresence(p.full_name).label}`}
                      />
                      <span>{p.full_name}</span>
                      <span className="text-[10px] text-slate-500 font-normal">({p.department} - {p.position})</span>
                    </div>
                    {isSelected ? <Check className="w-4 h-4 text-indigo-600" /> : <Plus className="w-3.5 h-3.5 text-slate-400" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsCreateChannelModalOpen(false)}
              className="px-4 py-2 rounded-xl font-bold border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/30 cursor-pointer"
            >
              Tạo Nhóm {openInSplitViewOnCreate ? "& Mở Song Song" : ""}
            </button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL 4: CÀI ĐẶT & QUẢN LÝ NHÓM CHAT (SETTINGS & DELETE) ==================== */}
      <Modal
        isOpen={isChannelSettingsModalOpen}
        onClose={() => setIsChannelSettingsModalOpen(false)}
        title={`CÀI ĐẶT NHÓM: #${editChannelForm.name}`}
        size="lg"
      >
        <div className="space-y-4 p-1 text-xs">
          {/* Form edit channel */}
          <form onSubmit={handleSaveChannelSettings} className="space-y-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Tên nhóm chat *
              </label>
              <input
                type="text"
                required
                value={editChannelForm.name}
                onChange={(e) => setEditChannelForm({ ...editChannelForm, name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Phạm vi phụ trách
                </label>
                <select
                  value={editChannelForm.department}
                  onChange={(e) => setEditChannelForm({ ...editChannelForm, department: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-semibold"
                >
                  <option value="Liên phòng ban">Liên phòng ban</option>
                  <option value="Toàn công ty">Toàn công ty</option>
                  <option value="Kinh Doanh">Kinh Doanh</option>
                  <option value="Application">Application</option>
                  <option value="Kho & Vận Hành">Kho &amp; Vận Hành</option>
                  <option value="Mua Hàng & Cung Ứng">Mua Hàng &amp; Cung Ứng (Procurement)</option>
                  <option value="Ban Giám Đốc">Ban Giám Đốc</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Quyền riêng tư
                </label>
                <label className="flex items-center gap-2 pt-2 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={editChannelForm.is_private}
                    onChange={(e) => setEditChannelForm({ ...editChannelForm, is_private: e.target.checked })}
                    className="rounded text-indigo-600"
                  />
                  <span>Chỉ thành viên được mời mới thấy</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Mục đích nhóm
              </label>
              <textarea
                rows={2}
                value={editChannelForm.description}
                onChange={(e) => setEditChannelForm({ ...editChannelForm, description: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-xs cursor-pointer"
              >
                Lưu Thay Đổi
              </button>
            </div>
          </form>

          {/* Members Management in Settings */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <label className="font-bold text-slate-700 dark:text-slate-300 uppercase text-[11px]">
                Quản lý thành viên ({editChannelForm.members.length} người)
              </label>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-1.5 border border-slate-200 dark:border-slate-800 rounded-xl p-2 bg-slate-50 dark:bg-slate-950">
              {editChannelForm.members.map((memName, idx) => {
                const isMe = memName === currentUserName;
                const isCreator = memName === editChannelForm.created_by;
                const p = personnelList.find(item => item.full_name === memName);
                const mPalette = getSenderPalette(memName);
                return (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-1.5 rounded-lg ${mPalette.sidebarCard}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full ${mPalette.avatar} flex items-center justify-center font-bold text-[10px]`}>
                        {(String(memName || "N")).slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-bold">{memName} {isMe && "(Bạn)"}</span>
                        {isCreator && (
                          <span className="ml-1.5 text-[9px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-700 font-bold">
                            Trưởng nhóm
                          </span>
                        )}
                        <span className="text-[10px] text-slate-500 block">{p?.department} - {p?.position}</span>
                      </div>
                    </div>

                    {!isMe && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(memName)}
                        className="px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-[10px] font-bold cursor-pointer"
                        title="Xóa thành viên khỏi nhóm"
                      >
                        Xóa
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Danger Zone: Leave Group or Delete Group */}
          <div className="pt-3 border-t border-rose-200 dark:border-rose-900/40 space-y-2">
            <span className="font-bold text-rose-600 dark:text-rose-400 uppercase text-[10px]">
              Khu vực nguy hiểm
            </span>

            <div className="flex items-center justify-between p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60">
              <div>
                <h5 className="font-bold text-rose-900 dark:text-rose-200 text-xs">Rời khỏi nhóm chat</h5>
                <p className="text-[10px] text-rose-700/80 dark:text-rose-400">
                  Bạn sẽ không còn thấy tin nhắn hoặc tham gia thảo luận trong nhóm này.
                </p>
              </div>
              <button
                type="button"
                onClick={handleLeaveChannel}
                className="px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-100 font-bold cursor-pointer shrink-0"
              >
                Rời Nhóm
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-rose-500/10 border border-rose-300 dark:border-rose-800">
              <div>
                <h5 className="font-bold text-rose-800 dark:text-rose-300 text-xs">Xóa vĩnh viễn nhóm chat</h5>
                <p className="text-[10px] text-rose-600 dark:text-rose-400">
                  Xóa nhóm chat cùng toàn bộ lịch sử tin nhắn, tệp đính kèm. Không thể hoàn tác.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDeleteConfirmOpen(true)}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer shrink-0"
              >
                Xóa Nhóm
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ==================== MODAL 5: XÁC NHẬN XÓA NHÓM CHAT ==================== */}
      <Modal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        title="XÁC NHẬN XÓA VĨNH VIỄN NHÓM CHAT"
        size="md"
      >
        <div className="space-y-3 p-1 text-xs">
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Hành động này không thể hoàn tác!</p>
              <p className="text-[11px] mt-0.5 leading-relaxed text-rose-700 dark:text-rose-300">
                Nhóm chat <strong>#{editChannelForm.name}</strong> cùng toàn bộ lịch sử tin nhắn, hình ảnh và tài liệu chia sẻ sẽ bị xóa vĩnh viễn khỏi hệ thống.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-bold cursor-pointer"
            >
              Hủy Bỏ
            </button>
            <button
              type="button"
              onClick={handleDeleteChannel}
              className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer"
            >
              Xác Nhận Xóa Vĩnh Viễn
            </button>
          </div>
        </div>
      </Modal>

      {/* ==================== MODAL 6: THÊM THÀNH VIÊN VÀO NHÓM ĐANG XEM ==================== */}
      <Modal
        isOpen={isAddMemberModalOpen}
        onClose={() => setIsAddMemberModalOpen(false)}
        title={`THÊM THÀNH VIÊN VÀO #${activeChannel?.name}`}
        size="md"
      >
        <div className="space-y-3 p-1 text-xs">
          <p className="text-slate-500 text-[11px]">
            Chọn các nhân sự bổ sung từ bất kỳ phòng ban nào để mời vào nhóm trao đổi này.
          </p>

          <div className="max-h-56 overflow-y-auto space-y-1 border border-slate-200 dark:border-slate-800 rounded-xl p-2 bg-slate-50 dark:bg-slate-950">
            {uniquePersonnel.map(p => {
              const isAlreadyMember = Array.isArray(activeChannel?.members) && activeChannel?.members.includes(p.full_name);
              const isSelected = addMembersSelected.includes(p.full_name);
              if (isAlreadyMember) return null;
              const pPalette = getSenderPalette(p.full_name);

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      setAddMembersSelected(prev => prev.filter(m => m !== p.full_name));
                    } else {
                      setAddMembersSelected(prev => [...prev, p.full_name]);
                    }
                  }}
                  className={`w-full flex items-center justify-between p-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                    isSelected ? "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold border border-indigo-300 dark:border-indigo-700" : pPalette.sidebarCard
                  }`}
                >
                  <div>
                    <span className="font-semibold">{p.full_name}</span>
                    <span className="text-[10px] text-slate-500 ml-1.5 font-normal">({p.department} - {p.position})</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsAddMemberModalOpen(false)}
              className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 font-bold"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={addMembersSelected.length === 0}
              onClick={handleAddMembersToActiveChannel}
              className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold disabled:opacity-50"
            >
              Thêm {addMembersSelected.length} thành viên
            </button>
          </div>
        </div>
      </Modal>

      {/* ==================== IMAGE PREVIEW MODAL ==================== */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img src={previewImage} alt="Xem ảnh" className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl" />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black/90 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
