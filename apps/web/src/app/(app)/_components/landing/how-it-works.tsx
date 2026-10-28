import { h2Class, reveal, sectionClass } from './styles';

const STEPS = [
  {
    title: 'Cherchez près de chez vous',
    body: 'Indiquez votre adresse : Linkr vous montre les pros qui se déplacent jusqu’à vous.',
  },
  {
    title: 'Réservez ou comparez',
    body: 'Réservez un service à tarif fixe, ou publiez un appel d’offres pour comparer des devis.',
  },
  {
    title: 'Payez en deux temps',
    body: 'Un acompte de 20 %, puis le solde de 80 %.',
  },
] as const;

export function HowItWorks() {
  return (
    <section aria-labelledby="landing-how" className={sectionClass}>
      <h2 id="landing-how" className={`${h2Class} ${reveal}`}>
        Comment ça marche
      </h2>

      <ol className="mt-10 grid gap-6 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className={`rounded-2xl border border-edge bg-surface p-6 ${reveal}`}
          >
            <span
              aria-hidden
              className="flex size-10 items-center justify-center rounded-full bg-accent text-base font-semibold text-on-accent"
            >
              {index + 1}
            </span>
            <h3 className="mt-4 text-lg font-semibold text-text">{step.title}</h3>
            <p className="mt-2 text-base text-pretty text-text-muted">{step.body}</p>
          </li>
        ))}
      </ol>

      <p className={`mt-8 text-sm text-pretty text-text-muted ${reveal}`}>
        Pendant l’essai, les paiements sont en mode test&nbsp;: aucune somme réelle n’est prélevée.
      </p>
    </section>
  );
}
