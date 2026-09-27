import type { Metadata, Viewport } from 'next';
import { Inter, Sora, JetBrains_Mono } from 'next/font/google';

// Token layer (generated) must load first so component styles can override it.
import './tokens.css';
import './globals.css';
import '../components/portal.css';
import '../components/login.css';
import '../components/launch.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'LGU Portal — Single Sign-On',
    template: '%s · LGU Portal',
  },
  description:
    'Single sign-on gateway for connected LGU systems. One credential, every system.',
  applicationName: 'LGU Portal',
  robots: {
    // An authenticated portal has nothing useful to index.
    index: false,
    follow: false,
    nocache: true,
  },
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export const viewport: Viewport = {
  // The viewport theme colour must be a literal — it is read by the UA before
  // any stylesheet applies, so it cannot be a token reference.
  themeColor: '#070A14', // tokens-allow-raw
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable} ${jetbrains.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
