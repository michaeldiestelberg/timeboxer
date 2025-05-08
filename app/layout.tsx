import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Timeboxer',
  description: 'Timeboxer helps you run timeboxed meetings, presentations, and group activities with ease.',
  generator: 'v0.dev (initial), improved with Windsurf (GPT-4.1 model)',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>

        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#ffffff" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="canonical" href="https://timeboxer.productized.tech/" />
        <meta property="og:title" content="Timeboxer" />
        <meta property="og:description" content="Timeboxer helps you run timeboxed meetings, presentations, and group activities with ease." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://timeboxer.productized.tech/" />
        <meta property="og:image" content="https://timeboxer.productized.tech/android-chrome-512x512.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Timeboxer" />
        <meta name="twitter:description" content="Timeboxer helps you run timeboxed meetings, presentations, and group activities with ease." />
        <meta name="twitter:image" content="https://timeboxer.productized.tech/android-chrome-512x512.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/android-chrome-512x512.png" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body>{children}</body>
    </html>
  )
}
