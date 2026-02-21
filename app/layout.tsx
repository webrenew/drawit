import type React from "react"
import type { Metadata, Viewport } from "next"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { AuthProvider } from "@/components/auth-provider"

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://drawit.sh"

export const metadata: Metadata = {
  title: "Drawit - AI-Powered Whiteboard",
  description: "An AI powered tool to create diagrams, flowcharts and wireframes. Made in v0 by Webrenew.",
  generator: "v0.app",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "Drawit - AI-Powered Whiteboard",
    description: "An AI powered tool to create diagrams, flowcharts and wireframes. Made in v0 by Webrenew.",
    url: siteUrl,
    siteName: "Drawit",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Drawit - AI-powered diagrams, flowcharts & wireframes",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Drawit - AI-Powered Whiteboard",
    description: "An AI powered tool to create diagrams, flowcharts and wireframes. Made in v0 by Webrenew.",
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans antialiased`}>
        <ThemeProvider defaultTheme="system" storageKey="drawit-theme-v2">
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
