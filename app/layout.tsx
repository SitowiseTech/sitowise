import type {Metadata, Viewport} from "next";
import {IBM_Plex_Mono, Manrope} from "next/font/google";
import "./globals.css";
import {RevealRoot} from "@/components/Reveal";
import {Footer} from "@/components/site/Footer";
import {Header} from "@/components/site/Header";
import {ToastProvider} from "@/components/ui/Toast";
import {SITE, siteUrl} from "@/lib/site";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE.name}: deploy a node on Robinhood Chain`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  // The social card comes from app/opengraph-image.tsx, so no images here.
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: "en_US",
    url: "/",
    title: `${SITE.name}: deploy a node on Robinhood Chain`,
    description: SITE.description,
  },
  twitter: {
    card: "summary_large_image",
    site: SITE.xHandle,
    creator: SITE.xHandle,
    title: `${SITE.name}: deploy a node on Robinhood Chain`,
    description: SITE.description,
  },
  icons: {
    // The mark is a raster tile with its own gradient, so there is no SVG
    // variant to offer here. Sizes are listed smallest first so a browser
    // picking the first entry still gets a sane favicon.
    icon: [
      {url: "/icon-16.png", type: "image/png", sizes: "16x16"},
      {url: "/icon-32.png", type: "image/png", sizes: "32x32"},
      {url: "/icon-192.png", type: "image/png", sizes: "192x192"},
      {url: "/icon-512.png", type: "image/png", sizes: "512x512"},
    ],
    apple: [{url: "/apple-touch-icon.png", sizes: "180x180"}],
  },
  robots: {index: true, follow: true},
};

export const viewport: Viewport = {
  themeColor: "#fcfaf7",
  colorScheme: "light",
};

export default function RootLayout({children}: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} ${plexMono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        {/* One observer for every [data-reveal] on the site, mounted once. */}
        <RevealRoot />
        <ToastProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </ToastProvider>
      </body>
    </html>
  );
}
