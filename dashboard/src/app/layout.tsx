import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sauti Desk",
  description: "Missed-call leads and receptionist settings for East African businesses",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
