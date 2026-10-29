import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/frontend/contexts/ThemeContext";
import { AuthProvider } from "@/frontend/contexts/AuthContext";
import { NotificationProvider } from "@/frontend/contexts/NotificationContext";
import ErrorBoundary from "@/frontend/components/ErrorBoundary";

export const metadata: Metadata = {
  title: "ABT Portal - Công ty TNHH Giải pháp Y sinh ABT",
  description: "Hệ thống quản trị kinh doanh thuần túy, kho hàng, application, cung ứng và cấu hình nhật ký cho Công ty TNHH Giải pháp Y sinh ABT trên cơ sở dữ liệu PostgreSQL",
  icons: {
    icon: "/favicon.ico",
  },
  other: {
    "zalo-platform-site-verification": "CeEVCBcy4IbQivP-c8GOV7kJjtMNvMmfCpOt"
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <meta property="zalo-platform-site-verification" content="CeEVCBcy4IbQivP-c8GOV7kJjtMNvMmfCpOt" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">
        <ErrorBoundary>
          <AuthProvider>
            <NotificationProvider>
              <ThemeProvider>{children}</ThemeProvider>
            </NotificationProvider>
          </AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}