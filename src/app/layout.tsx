import type { Metadata } from "next";
import { Tajawal } from "next/font/google";
import "./globals.css";

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "700", "800", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ArabiaDash | منصة تحليل الإعلانات الرقمية",
  description:
    "منصة عربية لإدارة وتحليل إعلاناتك من Meta و Google و TikTok وربطها بمتجرك على سلة وزد",
  keywords: [
    "إعلانات",
    "تسويق رقمي",
    "سلة",
    "زد",
    "تحليلات",
    "ميتا",
    "جوجل",
    "تيك توك",
    "ArabiaDash",
    "arabiadash",
  ],
  metadataBase: new URL("https://arabiadash.com"),
  openGraph: {
    title: "ArabiaDash | منصة تحليل الإعلانات الرقمية",
    description: "كل إعلاناتك ومبيعاتك في داشبورد واحد",
    url: "https://arabiadash.com",
    siteName: "ArabiaDash",
    locale: "ar_SA",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${tajawal.className} antialiased`}>{children}</body>
    </html>
  );
}
