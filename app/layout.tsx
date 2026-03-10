import type { Metadata } from "next"

import "./globals.css"

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export const metadata: Metadata = {
  title: "Timeboxer",
  description: "Timeboxer helps you run shared, timeboxed meetings and group activities with ease.",
  applicationName: "Timeboxer",
  generator: "Codex",
  metadataBase: new URL(appUrl),
  openGraph: {
    title: "Timeboxer",
    description: "Create shared meeting timers that everyone in the room can open and follow live.",
    type: "website",
    images: ["/android-chrome-512x512.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Timeboxer",
    description: "Create shared meeting timers that everyone in the room can open and follow live.",
    images: ["/android-chrome-512x512.png"],
  },
  icons: {
    apple: "/apple-touch-icon.png",
    icon: [
      { rel: "icon", type: "image/png", sizes: "16x16", url: "/favicon-16x16.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", url: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", url: "/android-chrome-192x192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", url: "/android-chrome-512x512.png" },
    ],
    shortcut: "/favicon.ico",
  },
  manifest: "/manifest.webmanifest",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head />
      <body>{children}</body>
    </html>
  )
}
