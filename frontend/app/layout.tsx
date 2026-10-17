import type { Metadata } from "next";
import { Archivo_Black, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const archivoBlack = Archivo_Black({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: "400", // Archivo Black only ships 400 (it's already "black")
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Euthyna",
  description: "An AI treasurer on probation, audited continuously by its own contract.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivoBlack.variable} ${jetbrainsMono.variable} h-full`}>
      <body className="min-h-full bg-bg text-ink font-data antialiased">{children}</body>
    </html>
  );
}
