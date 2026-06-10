import "./globals.css";

export const metadata = {
  title: "VTEX Live Order Tracker",
  description: "Monitor VTEX order state changes in real time with instant browser notifications and audio cues.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
