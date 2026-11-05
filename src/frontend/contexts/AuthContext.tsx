"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";

import { hasPermission } from "@/backend/services/permissions";
import { clearLocalDataCache } from "@/frontend/utils/storageSync";

export interface User {
    id: string;
    name: string;
    role: string;
    department?: string;
    email: string;
    status: string;
    password?: string;
    phone?: string;
    token?: string;
    username?: string;
    full_name?: string;
    permissions?: Record<string, boolean>;
    /** Logged in with a default / temporary password: must set a new one before using the portal */
    mustChangePassword?: boolean;
}

interface AuthContextType {
    user: User | null;
    login: (emailOrUser: string, pass: string) => Promise<{ success: boolean; error?: string; user?: User }>;
    logout: () => void;
    updateUser: (updatedFields: Partial<User>) => void;
    switchUser: (targetUser: User) => void;
    can: (permissionKey: string) => boolean;
    completePasswordChange: () => void;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const DEFAULT_MEMBERS: User[] = [];

function mapDbRole(dbRole: string): string {
    return dbRole === "admin" ? "Director"
        : dbRole === "sales_head" ? "Head of Sales"
        : dbRole === "sales_rep" ? "Sales Specialist"
        : dbRole === "sales_admin" ? "Sales Admin"
        : dbRole === "app_head" ? "Head of Application"
        : dbRole === "app_rep" ? "Application Specialist"
        : dbRole === "warehouse_lead" ? "Warehouse Manager"
        : dbRole === "warehouse" || dbRole === "warehouse_specialist" ? "Warehouse Specialist"
        : dbRole === "procurement_lead" ? "Procurement Lead"
        : dbRole === "procurement_specialist" || dbRole === "procurement" ? "Procurement Specialist"
        : dbRole === "accountant_head" ? "Chief Accountant"
        : dbRole === "accountant" ? "Receivable & Inventory Accountant"
        : dbRole === "qa_qc_lead" ? "QA/QC Manager"
        : dbRole === "qa_qc" ? "QA/QC Specialist"
        : dbRole === "legal_head" ? "Head of Legal"
        : dbRole === "legal" ? "Legal Specialist"
        : dbRole;
}

function mapServerUser(dbUser: any, previous?: Partial<User>): User {
    return {
        ...(previous || {}),
        id: "ABT-" + String(dbUser.id).padStart(2, "0"),
        name: dbUser.full_name,
        full_name: dbUser.full_name,
        role: mapDbRole(dbUser.role),
        department: dbUser.department,
        email: dbUser.email,
        status: dbUser.is_active !== false ? "Active" : "Inactive",
        username: dbUser.username,
        permissions: dbUser.permissions || {},
        mustChangePassword: Boolean(dbUser.must_change_password)
    } as User;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(() => {
        if (typeof window !== "undefined") {
            try {
                const stored = localStorage.getItem("tbr_current_user") || localStorage.getItem("current_user");
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed && (parsed.email || parsed.username || parsed.name)) return parsed;
                }
            } catch (e) {}
        }
        return null;
    });

    const [loading, setLoading] = useState<boolean>(() => {
        if (typeof window !== "undefined") {
            try {
                const stored = localStorage.getItem("tbr_current_user") || localStorage.getItem("current_user");
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed && (parsed.email || parsed.username || parsed.name)) return false;
                }
            } catch (e) {}
        }
        return true;
    });
    const router = useRouter();
    const pathname = usePathname();
    const sessionCheckedRef = useRef(false);

    const dropSession = () => {
        try {
            localStorage.removeItem("current_user");
            localStorage.removeItem("tbr_current_user");
        } catch (e) {}
        setUser(null);
    };

    useEffect(() => {
        // Sync default members list to localStorage if not exists or if outdated (< 25)
        const storedMembers = localStorage.getItem("lab_members");
        if (!storedMembers) {
            localStorage.setItem("lab_members", JSON.stringify(DEFAULT_MEMBERS));
        } else {
            try {
                const parsed = JSON.parse(storedMembers);
                if (!Array.isArray(parsed) || parsed.length < 25) {
                    localStorage.setItem("lab_members", JSON.stringify(DEFAULT_MEMBERS));
                }
            } catch (e) {
                localStorage.setItem("lab_members", JSON.stringify(DEFAULT_MEMBERS));
            }
        }

        if (sessionCheckedRef.current) return;
        sessionCheckedRef.current = true;

        const storedUser = localStorage.getItem("tbr_current_user") || localStorage.getItem("current_user");
        let parsedUser: User | null = null;
        if (storedUser) {
            try {
                const parsed = JSON.parse(storedUser);
                if (parsed && (parsed.email || parsed.username || parsed.name)) parsedUser = parsed;
            } catch (e) {}
        }
        if (!parsedUser) {
            setUser(null);
            setLoading(false);
            return;
        }

        // Phiên đăng nhập được xác thực bởi máy chủ (cookie httpOnly). Thông tin lưu ở trình duyệt chỉ để hiển thị.
        fetch("/api/auth?action=session")
            .then(async r => {
                if (r.status === 401 || r.status === 403) {
                    dropSession();
                    return;
                }
                const d = await r.json().catch(() => null);
                if (d?.user) {
                    const refreshed = mapServerUser(d.user, parsedUser!);
                    setUser(refreshed);
                    try {
                        localStorage.setItem("current_user", JSON.stringify(refreshed));
                        localStorage.setItem("tbr_current_user", JSON.stringify(refreshed));
                    } catch (err) {}
                } else {
                    setUser(parsedUser);
                }
            })
            // Mạng lỗi tạm thời: giữ phiên hiện tại, các API sẽ tự trả 401 nếu phiên không hợp lệ
            .catch(() => setUser(parsedUser))
            .finally(() => setLoading(false));
    }, [pathname]);

    // Máy chủ báo phiên hết hạn / không hợp lệ -> quay về màn hình đăng nhập (không xóa dữ liệu đệm chưa đồng bộ)
    useEffect(() => {
        const handleUnauthorized = () => dropSession();
        // Máy chủ yêu cầu đổi mật khẩu mặc định trước khi dùng tiếp
        const handleMustChange = () => setUser(prev => (prev ? { ...prev, mustChangePassword: true } : prev));
        window.addEventListener("tbr:unauthorized", handleUnauthorized);
        window.addEventListener("tbr:must-change-password", handleMustChange);
        return () => {
            window.removeEventListener("tbr:unauthorized", handleUnauthorized);
            window.removeEventListener("tbr:must-change-password", handleMustChange);
        };
    }, []);

    // Real-time permission change listener
    useEffect(() => {
        const handlePermissionsUpdated = (e: any) => {
            if (e.detail) {
                setUser(prev => {
                    if (!prev) return null;
                    const targetId = e.detail.userId;
                    const targetUsername = e.detail.username;
                    if (prev.id === targetId || prev.username === targetUsername) {
                        const updated = { ...prev, permissions: e.detail.permissions };
                        try {
                            localStorage.setItem("current_user", JSON.stringify(updated));
                            localStorage.setItem("tbr_current_user", JSON.stringify(updated));
                        } catch (err) {}
                        return updated;
                    }
                    return prev;
                });
            }
        };
        window.addEventListener("permissions-updated", handlePermissionsUpdated);
        return () => window.removeEventListener("permissions-updated", handlePermissionsUpdated);
    }, []);

    // Real-time Presence Heartbeat (Ping every 25s while active, mark offline on unload)
    useEffect(() => {
        if (!user) return;

        const sendHeartbeat = (status?: string) => {
            fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "heartbeat",
                    username: user.username || user.name || "",
                    fullName: user.full_name || user.name || "",
                    email: user.email || "",
                    userId: user.id && !isNaN(Number(String(user.id).replace(/\D/g, ""))) && Number(String(user.id).replace(/\D/g, "")) > 0
                        ? Number(String(user.id).replace(/\D/g, ""))
                        : null,
                    status: status || "online"
                })
            })
                .then(async (r) => {
                    if (!r.ok) return;
                    const d = await r.json().catch(() => null);
                    if (d && d.permissions && typeof d.permissions === "object") {
                        setUser((prev) => {
                            if (!prev) return prev;
                            const prevPermsJson = JSON.stringify(prev.permissions || {});
                            const nextPermsJson = JSON.stringify(d.permissions || {});
                            const mappedRole = d.role ? mapDbRole(d.role) : prev.role;
                            if (prevPermsJson === nextPermsJson && prev.role === mappedRole) return prev;
                            const updated = {
                                ...prev,
                                role: mappedRole,
                                department: d.department || prev.department,
                                permissions: d.permissions
                            };
                            try {
                                localStorage.setItem("current_user", JSON.stringify(updated));
                                localStorage.setItem("tbr_current_user", JSON.stringify(updated));
                                localStorage.setItem("via_current_user", JSON.stringify(updated));
                            } catch {}
                            return updated;
                        });
                    }
                })
                .catch(() => {});
        };

        sendHeartbeat("online");
        const intervalId = setInterval(() => sendHeartbeat("online"), 25000);

        const handleFocus = () => sendHeartbeat("online");
        window.addEventListener("focus", handleFocus);
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") sendHeartbeat("online");
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);

        const handleUnload = () => {
            if (navigator.sendBeacon) {
                const blob = new Blob([JSON.stringify({
                    action: "heartbeat",
                    username: user.username || user.name || "",
                    fullName: user.full_name || user.name || "",
                    email: user.email || "",
                    status: "offline"
                })], { type: "application/json" });
                navigator.sendBeacon("/api/auth", blob);
            }
        };
        window.addEventListener("beforeunload", handleUnload);

        return () => {
            clearInterval(intervalId);
            window.removeEventListener("focus", handleFocus);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("beforeunload", handleUnload);
        };
    }, [user?.username, user?.email, user?.full_name, user?.name]);

    const login = async (emailOrUsername: string, pass: string): Promise<{ success: boolean; error?: string; user?: User }> => {
        try {
            const res = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: emailOrUsername, password: pass })
            });
            const data = await res.json();
            if (res.ok && data.success && data.user) {
                const cleanUser = mapServerUser(data.user);
                localStorage.setItem("current_user", JSON.stringify(cleanUser));
                localStorage.setItem("tbr_current_user", JSON.stringify(cleanUser));
                setUser(cleanUser);
                return { success: true, user: cleanUser };
            }
            return { success: false, error: data.error || "Tài khoản hoặc mật khẩu không chính xác" };
        } catch (err: any) {
            console.error("Auth API error:", err);
            return { success: false, error: "Không kết nối được máy chủ. Vui lòng thử lại." };
        }
    };

    const logout = () => {
        const finish = () => {
            // Xóa dữ liệu đệm của phiên này để người đăng nhập sau không thấy / đẩy ngược dữ liệu cũ lên máy chủ
            clearLocalDataCache();
            setUser(null);
        };
        if (user) {
            fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "heartbeat", status: "offline" })
            })
                .catch(() => {})
                .finally(() => {
                    fetch("/api/auth", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "logout" })
                    }).catch(() => {});
                });
        }
        finish();
    };

    const switchUser = (targetUser: User) => {
        const fullUser = { ...targetUser, full_name: targetUser.name || targetUser.full_name };
        localStorage.setItem("current_user", JSON.stringify(fullUser));
        localStorage.setItem("tbr_current_user", JSON.stringify(fullUser));
        setUser(fullUser);
    };

    const updateUser = (updatedFields: Partial<User>) => {
        if (!user) return;
        const newUser = { ...user, ...updatedFields };
        setUser(newUser);
        localStorage.setItem("current_user", JSON.stringify(newUser));
        localStorage.setItem("tbr_current_user", JSON.stringify(newUser));
    };

    const completePasswordChange = () => {
        setUser(prev => {
            if (!prev) return prev;
            const updated = { ...prev, mustChangePassword: false };
            try {
                localStorage.setItem("current_user", JSON.stringify(updated));
                localStorage.setItem("tbr_current_user", JSON.stringify(updated));
            } catch (e) {}
            return updated;
        });
    };

    const can = (permissionKey: string): boolean => {
        return hasPermission(user, permissionKey);
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, updateUser, switchUser, can, loading, completePasswordChange }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
