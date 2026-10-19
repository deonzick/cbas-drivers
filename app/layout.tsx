import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/components/Auth";
import "./globals.css";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "CBAS Drivers";
export const metadata: Metadata = {
  title: APP_NAME,
  description: "Assigned subdivisions, section check-offs and daily route planning for CBAS drivers.",
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  icons: { icon: [{ url: "/icons/favicon-48.png", sizes: "48x48" }, { url: "/icons/icon-192.png", sizes: "192x192" }], apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f9f9f9" }, { media: "(prefers-color-scheme: dark)", color: "#161618" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}` }} />
      </body>
    </html>
  );
}
