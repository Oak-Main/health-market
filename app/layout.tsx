import type { Metadata, Viewport } from "next"
import { Inter_Tight, Instrument_Serif, Geist_Mono } from "next/font/google"
import "./globals.css"

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  display: "swap",
})

const instrumentSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
})

export const metadata: Metadata = {
  metadataBase: new URL("https://subsidydropoff.com"),
  title: {
    default: "Subsidy Dropoff — Find the dollar that ends your ACA subsidy",
    template: "%s — Subsidy Dropoff",
  },
  description:
    "A precision tool that finds the exact income at which your ACA premium tax credit disappears at 400% of the federal poverty line — and what crossing that line costs you. Estimates only. Not affiliated with the U.S. government.",
  keywords: [
    "ACA subsidy cliff",
    "400% federal poverty line",
    "premium tax credit",
    "self-employed health insurance",
    "early retirement health insurance",
  ],
  openGraph: {
    title: "Subsidy Dropoff — Find the dollar that ends your ACA subsidy",
    description:
      "Since the enhanced premium tax credits lapsed on December 31, 2025, one dollar over 400% of the federal poverty line can cost a household its entire subsidy. Subsidy Dropoff finds that exact dollar.",
    type: "website",
    url: "https://subsidydropoff.com",
    siteName: "Subsidy Dropoff",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Subsidy Dropoff — find the dollar that ends your ACA subsidy" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Subsidy Dropoff — Find the dollar that ends your ACA subsidy",
    description:
      "A precise estimate of the income at which your ACA premium tax credit disappears at 400% of the federal poverty line.",
    images: ["/og.png"],
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 } },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d0f" },
  ],
  colorScheme: "light dark",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${instrumentSerif.variable} ${geistMono.variable} bg-background`}
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
