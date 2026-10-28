import { h2Class, reveal, sectionClass } from './styles';

/**
 * « La confiance, ça se construit ». Every line is true of the code today:
 * reviews need `completedAtUtc` (§13.1 nº 11), the portfolio exists, discover
 * serves cell centres only (§13.1 nº 22), and cards are entered in Stripe's
 * own iframe (`PaymentElement`) — Linkr stores brand, last four and expiry.
 * Never « vérifié », « gratuit » or « sécurisé » here.
 */
const ITEMS = [
  {
    title: 'Des avis qui comptent',
    body: 'Seuls les clients dont la prestation est terminée peuvent laisser un avis.',
  },
  {
    title: 'Le travail en images',
    body: 'Chaque pro peut présenter ses réalisations dans un portfolio.',
  },
  {
    title: 'Une position approximative',
    body: 'La position des pros n’est jamais affichée exactement : seulement une zone approximative.',
  },
  {
    title: 'Des paiements par Stripe',
    body: 'Les paiements passent par Stripe : Linkr ne voit jamais le numéro de votre carte.',
  },
] as const;

export function Trust() {
  return (
    <section aria-labelledby="landing-trust" className={sectionClass}>
      <h2 id="landing-trust" className={`${h2Class} ${reveal}`}>
        La confiance, ça se construit
      </h2>

      <ul className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item.title} className={`border-l-2 border-accent pl-5 ${reveal}`}>
            <h3 className="text-lg font-semibold text-text">{item.title}</h3>
            <p className="mt-2 text-base text-pretty text-text-muted">{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
