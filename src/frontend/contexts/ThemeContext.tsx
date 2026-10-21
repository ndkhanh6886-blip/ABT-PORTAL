"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "@/frontend/contexts/AuthContext";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

/** Giao diện được nhớ theo từng tài khoản (mặc định: Sáng), không dùng chung cho mọi người trên cùng máy. */
const themeKey = (username?: string | null) => (username ? `tbr_theme:${username}` : "tbr_theme");

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>("light");
  const { user } = useAuth();
  const username = user?.username || null;

  useEffect(() => {
    let saved: Theme | null = null;
    try { saved = localStorage.getItem(themeKey(username)) as Theme | null; } catch {}
    const initial = (saved === "dark" || saved === "light") ? saved : "light";
    setThemeState(initial);
    if (initial === "dark") {
      document.documentElement.classList.add("dark");
      document.body?.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
      document.body?.classList.remove("dark");
    }
  }, [username]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    try { localStorage.setItem(themeKey(username), newTheme); } catch {}
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
      document.body?.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
      document.body?.classList.remove("dark");
    }
    window.dispatchEvent(new CustomEvent("theme_changed", { detail: newTheme }));
  };

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);