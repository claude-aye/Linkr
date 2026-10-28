import type { Metadata } from "next";
import { Geist, Geist_Mono, Parisienne } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  // Inutile sur les pages publiques : chargée seulement quand un texte la lit.
  preload: false,
});

/*
 * Parisienne — logo et grands titres SEULEMENT (CLAUDE.md §13.1 « Socle visuel »).
 * Exposée à Tailwind sous `font-script` (`globals.css`). La variable s'appelle
 * `--font-parisienne`, pas `--font-script` : le token Tailwind `--font-script`
 * pointe dessus, et un même nom des deux côtés se définirait par lui-même.
 * `latin-ext` couvre les diacritiques au-delà du latin de base.
 */
const parisienne = Parisienne({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-parisienne",
});

export const metadata: Metadata = {
  title: { default: "Linkr", template: "%s · Linkr" },
  description:
    "De la coiffure à domicile aux travaux spécialisés, trouvez le bon pro dans votre quartier.",
  // Version d'essai : aucune indexation (voir aussi robots.ts et next.config.ts).
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // ⚠️ `data-theme="light"` EST L'INTERRUPTEUR DU MODE SOMBRE. Il force le
    // thème clair, quel que soit le réglage de l'OS, et éteint toutes les
    // classes `dark:`. NE PAS le retirer avant la fin de la migration des
    // couleurs codées en dur vers les tokens (CLAUDE.md §6).
    <html
      lang="fr-CA"
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${parisienne.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Hauteur = --trial-banner-h (globals.css) : une seule ligne, à toutes les largeurs. */}
        <p className="flex h-[var(--trial-banner-h)] shrink-0 items-center justify-center overflow-hidden whitespace-nowrap bg-accent px-4 text-xs text-on-accent">
          <span className="sm:hidden">
            Version d&apos;essai · Paiements en mode test
          </span>
          <span className="hidden sm:inline">
            Version d&apos;essai · Les paiements sont en mode test : aucune somme
            réelle n&apos;est prélevée.
          </span>
        </p>
        {children}
      </body>
    </html>
  );
}
