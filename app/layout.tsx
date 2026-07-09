import type { Metadata } from "next"
import { ThemeInit } from "@/components/theme-init"
import "./globals.css"

export const metadata: Metadata = {
  title: "WebKit WebGPU Frame Nightmare",
  description:
    "Pixel-provable repro of iOS Safari presenting WebGPU canvas frames out of order under rAF catch-up bursts. Frame numbers are painted into the canvas — record, frame-step, watch time go backward.",
  // Favicon: app/icon.png (Next file convention — the JOYCO brand icon).
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=new URLSearchParams(window.location.search).get('theme')||'dark';document.documentElement.dataset.theme=t})()`,
          }}
        />
      </head>
      <body>
        <ThemeInit />
        {children}
      </body>
    </html>
  )
}
