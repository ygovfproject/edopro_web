import type { Metadata, Viewport } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import ThemeRegistry from "@/components/ThemeRegistry";

export const metadata: Metadata = {
  title: "EDOPro Web",
  description: "Play EDOPro online duels in the browser",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#161616",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider>
          <ThemeRegistry>{children}</ThemeRegistry>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
