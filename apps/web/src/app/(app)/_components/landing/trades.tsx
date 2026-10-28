import { LandingPicture } from './picture';
import { h2Class, leadClass, reveal, sectionClass } from './styles';

/**
 * « Des talents pour chaque besoin » — six trade cards.
 *
 * ⚠️ NOT LINKS, AND MUST NOT LOOK LIKE LINKS: no hover, no pointer, no arrow.
 * Search is private (`/recherche` needs a session), and the regulated trades
 * are not offered (`lib/catalog/launch-scope.ts`). The two regulated cards
 * carry « Bientôt »; the note under the grid says why, in the future tense.
 */
const TRADES = [
  { name: 'coiffure', label: 'Coiffure', color: '#9f8771', soon: false },
  { name: 'esthetique', label: 'Esthétique', color: '#b6a390', soon: false },
  { name: 'decoration', label: 'Décoration', color: '#c3b8a7', soon: false },
  { name: 'petits-travaux', label: 'Petits travaux', color: '#998d78', soon: false },
  { name: 'construction', label: 'Construction', color: '#503b27', soon: true },
  { name: 'electricite', label: 'Électricité', color: '#928c87', soon: true },
] as const;

export function Trades() {
  return (
    <section aria-labelledby="landing-trades" className={sectionClass}>
      <h2 id="landing-trades" className={`${h2Class} ${reveal}`}>
        Des talents pour chaque besoin
      </h2>
      <p className={`${leadClass} ${reveal}`}>
        Coiffure, esthétique, décoration, petits travaux&nbsp;: ces services sont ouverts dès
        maintenant.
      </p>

      <ul className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6">
        {TRADES.map((trade) => (
          <li key={trade.name} className={reveal}>
            <div className="relative overflow-hidden rounded-2xl">
              <LandingPicture
                name={trade.name}
                widths={[320, 480, 640]}
                width={640}
                height={800}
                sizes="(min-width: 1024px) 320px, (min-width: 640px) 30vw, 45vw"
                color={trade.color}
                className="aspect-4/5 h-auto w-full object-cover"
              />
              {trade.soon && (
                <span className="absolute top-3 left-3 rounded-2xl bg-bg px-3 py-1 text-sm font-medium text-text">
                  Bientôt
                </span>
              )}
            </div>
            <p className="mt-3 text-base font-medium text-text">{trade.label}</p>
          </li>
        ))}
      </ul>

      <p className={`mt-8 text-sm text-pretty text-text-muted ${reveal}`}>
        Les métiers réglementés ouvriront une fois la vérification des licences en place.
      </p>
    </section>
  );
}
