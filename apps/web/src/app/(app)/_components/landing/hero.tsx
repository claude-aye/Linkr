import Link from 'next/link';

import { imageUrl, srcSet } from './picture';
import { buttonBase, focusRing, focusRingOnPhoto } from './styles';

/**
 * Full-screen hero: photo + bordeaux veil, the page's one `<h1>`, and the
 * page's ONE `backdrop-filter` layer — the panel holding the two buttons.
 *
 * Art direction: a 2:3 portrait crop on narrow / portrait screens, the 3:2
 * landscape frame from a square aspect ratio up. The hero is the LCP image:
 * eager, `fetchpriority="high"`, never lazy.
 *
 * The veil and the text use the FIXED brand colours (`bordeaux`, `beige`),
 * not the theme tokens: they sit on a photo, not on the page ground, and must
 * not flip with the theme. Contrast is measured on the worst pixel under the
 * text (PR R5b).
 *
 * The panel follows the R4 rule (CLAUDE.md §13.1 nº 24 (b)): OPAQUE by
 * default, translucent only under `@supports (backdrop-filter)`, written as
 * two positive `supports-[…]` variants. In both modes it holds only text that
 * is legible on its own: the primary button is solid, the secondary one is
 * filled with the ground colour, and the sign-in line uses `text-text`.
 */
export function Hero() {
  return (
    <section className="relative isolate flex min-h-svh flex-col justify-end overflow-hidden bg-bordeaux">
      <picture>
        <source
          media="(min-aspect-ratio: 1/1)"
          type="image/avif"
          srcSet={srcSet('hero-paysage', [1280, 1920], 'avif')}
          sizes="100vw"
        />
        <source
          media="(min-aspect-ratio: 1/1)"
          type="image/webp"
          srcSet={srcSet('hero-paysage', [1280, 1920], 'webp')}
          sizes="100vw"
        />
        <source
          type="image/avif"
          srcSet={srcSet('hero-portrait', [640, 828, 1536], 'avif')}
          sizes="100vw"
        />
        <source
          type="image/webp"
          srcSet={srcSet('hero-portrait', [640, 828, 1536], 'webp')}
          sizes="100vw"
        />
        <img
          src={imageUrl('hero-portrait', 828, 'webp')}
          alt=""
          width={828}
          height={1242}
          fetchPriority="high"
          decoding="async"
          style={{ backgroundColor: '#534b45' }}
          className="absolute inset-0 -z-20 h-full w-full object-cover object-[50%_35%]"
        />
      </picture>

      {/* Veil in three parts, dense only where text sits (contrast measured on
          the worst pixel at 320, 375, 414, 768, 1280 and 1440 px, PR R5b):
          - a LIGHT gradient over the whole photo, so it stays visible;
          - a 12rem band under the brand bar (« Se connecter » ≥ 4.5:1 even on
            the bright top of the photo at 768 px);
          - a denser screen that follows the text block (below), so it holds at
            every width wherever the block lands. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-t from-bordeaux/35 to-bordeaux/15"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-48 bg-linear-to-b from-bordeaux/80 to-transparent"
      />

      <div className="absolute inset-x-0 top-0 mx-auto flex w-full max-w-5xl items-center justify-between px-4 pt-4 sm:px-6 sm:pt-6">
        <p className="font-script text-[2.5rem] leading-none text-beige">Linkr</p>
        <Link
          href="/login"
          className={`inline-flex min-h-11 items-center rounded-2xl px-3 text-base font-medium text-beige underline-offset-4 hover:underline ${focusRingOnPhoto}`}
        >
          Se connecter
        </Link>
      </div>

      {/* `pt-32` keeps the text clear of the brand bar; the wrapper starts at
          the tagline, so the screen below starts 2rem above it at any width. */}
      <div className="relative w-full pt-32">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-24 bottom-0 -z-10 bg-linear-to-t from-bordeaux/80 to-bordeaux/60"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-24 bg-linear-to-t from-bordeaux/60 to-transparent"
        />
        <div className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6 sm:pb-16">
          <h1 className="max-w-3xl text-4xl leading-tight font-semibold tracking-tight text-balance text-beige sm:text-6xl">
            Vous avez un besoin&nbsp;? Ils ont du talent à revendre.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-pretty text-beige sm:text-xl">
            De la coiffure à domicile aux travaux spécialisés, trouvez le bon pro dans votre
            quartier.
          </p>

          <div
            className={
              'mt-8 w-full max-w-md rounded-2xl border border-edge bg-bg bg-linear-to-b from-surface to-surface p-4 shadow-xl shadow-bordeaux/30 backdrop-blur-xl sm:p-5 ' +
              'supports-[backdrop-filter:blur(1px)]:bg-none supports-[backdrop-filter:blur(1px)]:bg-surface ' +
              'supports-[-webkit-backdrop-filter:blur(1px)]:bg-none supports-[-webkit-backdrop-filter:blur(1px)]:bg-surface'
            }
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className={`${buttonBase} flex-1 bg-accent text-on-accent hover:bg-accent/90 ${focusRing}`}
              >
                Trouver un pro
              </Link>
              <Link
                href="/signup"
                className={`${buttonBase} flex-1 border border-accent bg-bg text-accent hover:bg-accent/10 ${focusRing}`}
              >
                Je suis un pro
              </Link>
            </div>
            <p className="mt-3 text-center text-sm text-text">
              Déjà un compte&nbsp;?{' '}
              <Link
                href="/login"
                className={`inline-flex min-h-11 items-center rounded-sm font-medium text-accent underline underline-offset-2 ${focusRing}`}
              >
                Se connecter
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
