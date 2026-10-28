import Link from 'next/link';

import { LandingPicture } from './picture';
import { buttonBase, focusRing, h2Class, leadClass, reveal, sectionClass } from './styles';

export function ProSection() {
  return (
    <section aria-labelledby="landing-pro" className={sectionClass}>
      <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
        <div className={`overflow-hidden rounded-2xl ${reveal}`}>
          <LandingPicture
            name="pro"
            widths={[480, 640, 960]}
            width={960}
            height={640}
            sizes="(min-width: 1024px) 480px, (min-width: 768px) 45vw, 92vw"
            color="#463920"
            className="aspect-3/2 h-auto w-full object-cover"
          />
        </div>
        <div className={reveal}>
          <h2 id="landing-pro" className={h2Class}>
            Vous avez un talent à revendre&nbsp;? Rejoignez Linkr.
          </h2>
          <p className={leadClass}>
            Créez votre profil, présentez vos réalisations et recevez des demandes de clients près
            de chez vous.
          </p>
          <Link
            href="/signup"
            className={`${buttonBase} mt-8 w-full bg-accent text-on-accent hover:bg-accent/90 sm:w-auto ${focusRing}`}
          >
            Créer mon profil pro
          </Link>
        </div>
      </div>
    </section>
  );
}
