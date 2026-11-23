import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { TelemetryProvider } from "@/lib/telemetry-provider";
import { ToastProvider } from "@/lib/ui";

export const metadata: Metadata = {
  title: "Legal Search — поиск судебной практики",
  description: "Legal Search — поиск и анализ судебной практики.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru">
      <body>
        <ToastProvider>
          <AuthProvider>
            <TelemetryProvider>{children}</TelemetryProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
