import type { MetadataRoute } from "next";

// The home-screen app's name and colours. Change NEXT_PUBLIC_APP_NAME in Vercel to rename it.
export default function manifest(): MetadataRoute.Manifest {
  const name = process.env.NEXT_PUBLIC_APP_NAME || "CBAS Drivers";
  return {
    id: "/",
    name,
    short_name: name.length > 12 ? name.replace(/^CBAS\s*/i, "CBAS ").slice(0, 12).trim() : name,
    description: "Assigned subdivisions, section check-offs and daily route planning for CBAS drivers.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["business", "navigation", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
