/**
 * Replayable Quebec catalog seed — THIS FILE is the source of truth.
 *
 * Keys: categories -> `slug`; items -> `(service_category_id, slug)`;
 * requirements -> `(service_category_id, country_code, subdivision_code, authority_code)`.
 * Slugs are the stable natural keys — never rename them.
 *
 * Per run, for each entry of the file:
 *   +  absent from the database -> created
 *   ~  present, name/description/sort_order differ -> realigned on the file
 *   =  present and identical -> nothing written
 *   !  regulation_level or a requirement field differs -> NOT written, counted.
 *      These fields decide which checks providers must pass: changing them is a
 *      deliberate act (migration / one-off SQL), never a redeploy side effect.
 *   ?  in the database but not in the file -> reported only, never deleted.
 * `is_active` and `approval_status` of an existing row are never touched
 * (a category switched off by hand stays off).
 *
 * Dev:  npx ts-node -r tsconfig-paths/register src/database/seeders/quebec-catalog.seed.ts
 * Prod: docker compose --profile tools run --rm seed-catalog   (compiled, plain node)
 */

import 'dotenv/config';
import { isDeepStrictEqual } from 'node:util';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { ServiceCategory } from '../../modules/services-catalog/entities/service-category.entity';
import { ServiceItem } from '../../modules/services-catalog/entities/service-item.entity';
import { RegulatoryRequirement } from '../../modules/services-catalog/entities/regulatory-requirement.entity';
import { RegulationLevel } from '../../modules/services-catalog/enums/regulation-level.enum';
import { ApprovalStatus } from '../../modules/services-catalog/enums/approval-status.enum';
import { RequiredDocumentType } from '../../modules/services-catalog/enums/required-document-type.enum';
import { InputType } from '../../modules/services-catalog/enums/input-type.enum';

const ds = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [ServiceCategory, ServiceItem, RegulatoryRequirement],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  logging: ['error'],
});

// ── Category definitions ───────────────────────────────────────────────────

const CATEGORIES: Array<{
  slug: string;
  regulationLevel: RegulationLevel;
  nameTranslations: Record<string, string>;
  descriptionTranslations: Record<string, string>;
  sortOrder: number;
}> = [
  {
    slug: 'plomberie',
    regulationLevel: RegulationLevel.REGULATED,
    nameTranslations: { 'fr-CA': 'Plomberie', 'en-CA': 'Plumbing' },
    descriptionTranslations: {
      'fr-CA': 'Services de plomberie résidentielle et commerciale',
      'en-CA': 'Residential and commercial plumbing services',
    },
    sortOrder: 1,
  },
  {
    slug: 'electricite',
    regulationLevel: RegulationLevel.REGULATED,
    nameTranslations: { 'fr-CA': 'Électricité', 'en-CA': 'Electrical' },
    descriptionTranslations: {
      'fr-CA': 'Services électriques résidentiels et commerciaux',
      'en-CA': 'Residential and commercial electrical services',
    },
    sortOrder: 2,
  },
  {
    slug: 'menuiserie',
    regulationLevel: RegulationLevel.REGULATED,
    nameTranslations: { 'fr-CA': 'Menuiserie', 'en-CA': 'Carpentry' },
    descriptionTranslations: {
      'fr-CA': 'Travaux de menuiserie et charpenterie',
      'en-CA': 'Carpentry and woodworking services',
    },
    sortOrder: 3,
  },
  {
    slug: 'coiffure',
    regulationLevel: RegulationLevel.INFORMAL,
    nameTranslations: { 'fr-CA': 'Coiffure', 'en-CA': 'Hairdressing' },
    descriptionTranslations: {
      'fr-CA': 'Coupes, colorations et soins capillaires',
      'en-CA': 'Haircuts, colouring, and hair care',
    },
    sortOrder: 4,
  },
  {
    slug: 'esthetique',
    regulationLevel: RegulationLevel.INFORMAL,
    nameTranslations: { 'fr-CA': 'Esthétique', 'en-CA': 'Esthetics' },
    descriptionTranslations: {
      'fr-CA': 'Soins de beauté et esthétique',
      'en-CA': 'Beauty and esthetic treatments',
    },
    sortOrder: 5,
  },
  {
    slug: 'decoration',
    regulationLevel: RegulationLevel.INFORMAL,
    nameTranslations: { 'fr-CA': 'Décoration', 'en-CA': 'Decoration' },
    descriptionTranslations: {
      'fr-CA': 'Décoration intérieure et aménagement',
      'en-CA': 'Interior decorating and staging',
    },
    sortOrder: 6,
  },
  {
    slug: 'homme-a-tout-faire',
    regulationLevel: RegulationLevel.INFORMAL,
    nameTranslations: { 'fr-CA': 'Homme à tout faire', 'en-CA': 'Handyperson' },
    descriptionTranslations: {
      'fr-CA': 'Petits travaux de bricolage et réparations diverses',
      'en-CA': 'General repairs and odd jobs',
    },
    sortOrder: 7,
  },
];

// ── Item definitions ───────────────────────────────────────────────────────

const ITEMS: Array<{
  categorySlug: string;
  slug: string;
  nameTranslations: Record<string, string>;
}> = [
  // plomberie
  { categorySlug: 'plomberie', slug: 'deboucher-evier', nameTranslations: { 'fr-CA': 'Déboucher un évier', 'en-CA': 'Unclog a sink' } },
  { categorySlug: 'plomberie', slug: 'remplacer-robinet', nameTranslations: { 'fr-CA': 'Remplacer un robinet', 'en-CA': 'Replace a faucet' } },
  { categorySlug: 'plomberie', slug: 'reparer-chasse-eau', nameTranslations: { 'fr-CA': 'Réparer une chasse d\'eau', 'en-CA': 'Repair a toilet flush' } },
  // electricite
  { categorySlug: 'electricite', slug: 'installer-prise', nameTranslations: { 'fr-CA': 'Installer une prise', 'en-CA': 'Install an outlet' } },
  { categorySlug: 'electricite', slug: 'remplacer-panneau', nameTranslations: { 'fr-CA': 'Remplacer un panneau électrique', 'en-CA': 'Replace electrical panel' } },
  { categorySlug: 'electricite', slug: 'installer-luminaire', nameTranslations: { 'fr-CA': 'Installer un luminaire', 'en-CA': 'Install a light fixture' } },
  // menuiserie
  { categorySlug: 'menuiserie', slug: 'installer-plancher', nameTranslations: { 'fr-CA': 'Installer un plancher', 'en-CA': 'Install flooring' } },
  { categorySlug: 'menuiserie', slug: 'poser-portes-fenetres', nameTranslations: { 'fr-CA': 'Poser portes et fenêtres', 'en-CA': 'Install doors and windows' } },
  { categorySlug: 'menuiserie', slug: 'construire-terrasse', nameTranslations: { 'fr-CA': 'Construire une terrasse', 'en-CA': 'Build a deck' } },
  // coiffure
  { categorySlug: 'coiffure', slug: 'coupe-homme', nameTranslations: { 'fr-CA': 'Coupe homme', 'en-CA': 'Men\'s haircut' } },
  { categorySlug: 'coiffure', slug: 'coupe-femme', nameTranslations: { 'fr-CA': 'Coupe femme', 'en-CA': 'Women\'s haircut' } },
  { categorySlug: 'coiffure', slug: 'coloration', nameTranslations: { 'fr-CA': 'Coloration', 'en-CA': 'Hair colouring' } },
  // esthetique
  { categorySlug: 'esthetique', slug: 'manucure', nameTranslations: { 'fr-CA': 'Manucure', 'en-CA': 'Manicure' } },
  { categorySlug: 'esthetique', slug: 'pose-ongles', nameTranslations: { 'fr-CA': 'Pose d\'ongles', 'en-CA': 'Nail extensions' } },
  { categorySlug: 'esthetique', slug: 'epilation-cire', nameTranslations: { 'fr-CA': 'Épilation à la cire', 'en-CA': 'Wax hair removal' } },
  // decoration
  { categorySlug: 'decoration', slug: 'consultation-deco', nameTranslations: { 'fr-CA': 'Consultation déco', 'en-CA': 'Décor consultation' } },
  { categorySlug: 'decoration', slug: 'peinture-interieure', nameTranslations: { 'fr-CA': 'Peinture intérieure', 'en-CA': 'Interior painting' } },
  // homme-a-tout-faire
  { categorySlug: 'homme-a-tout-faire', slug: 'montage-meuble', nameTranslations: { 'fr-CA': 'Montage de meuble', 'en-CA': 'Furniture assembly' } },
  { categorySlug: 'homme-a-tout-faire', slug: 'petites-reparations', nameTranslations: { 'fr-CA': 'Petites réparations', 'en-CA': 'Minor repairs' } },
];

// ── Regulatory requirement definitions (Quebec) ────────────────────────────

const REQUIREMENTS: Array<{
  categorySlug: string;
  countryCode: string;
  subdivisionCode: string;
  authorityCode: string;
  authorityFullNameTranslations: Record<string, string>;
  requiredDocumentType: RequiredDocumentType;
  inputType: InputType;
  isRequired: boolean;
}> = [
  // plomberie — RBQ + CMMTQ
  {
    categorySlug: 'plomberie',
    countryCode: 'CA',
    subdivisionCode: 'CA-QC',
    authorityCode: 'RBQ',
    authorityFullNameTranslations: { 'fr-CA': 'Régie du bâtiment du Québec', 'en-CA': 'Quebec Building Authority' },
    requiredDocumentType: RequiredDocumentType.LICENSE_NUMBER,
    inputType: InputType.TEXT_INPUT,
    isRequired: true,
  },
  {
    categorySlug: 'plomberie',
    countryCode: 'CA',
    subdivisionCode: 'CA-QC',
    authorityCode: 'CMMTQ',
    authorityFullNameTranslations: { 'fr-CA': 'Corporation des maîtres mécaniciens en tuyauterie du Québec', 'en-CA': 'Corporation of Master Pipe-Mechanics of Quebec' },
    requiredDocumentType: RequiredDocumentType.LICENSE_NUMBER,
    inputType: InputType.TEXT_INPUT,
    isRequired: true,
  },
  // electricite — RBQ + CMEQ
  {
    categorySlug: 'electricite',
    countryCode: 'CA',
    subdivisionCode: 'CA-QC',
    authorityCode: 'RBQ',
    authorityFullNameTranslations: { 'fr-CA': 'Régie du bâtiment du Québec', 'en-CA': 'Quebec Building Authority' },
    requiredDocumentType: RequiredDocumentType.LICENSE_NUMBER,
    inputType: InputType.TEXT_INPUT,
    isRequired: true,
  },
  {
    categorySlug: 'electricite',
    countryCode: 'CA',
    subdivisionCode: 'CA-QC',
    authorityCode: 'CMEQ',
    authorityFullNameTranslations: { 'fr-CA': 'Corporation des maîtres électriciens du Québec', 'en-CA': 'Corporation of Master Electricians of Quebec' },
    requiredDocumentType: RequiredDocumentType.LICENSE_NUMBER,
    inputType: InputType.TEXT_INPUT,
    isRequired: true,
  },
  // menuiserie — RBQ + CCQ + ASP_CONSTRUCTION
  {
    categorySlug: 'menuiserie',
    countryCode: 'CA',
    subdivisionCode: 'CA-QC',
    authorityCode: 'RBQ',
    authorityFullNameTranslations: { 'fr-CA': 'Régie du bâtiment du Québec', 'en-CA': 'Quebec Building Authority' },
    requiredDocumentType: RequiredDocumentType.LICENSE_NUMBER,
    inputType: InputType.TEXT_INPUT,
    isRequired: true,
  },
  {
    categorySlug: 'menuiserie',
    countryCode: 'CA',
    subdivisionCode: 'CA-QC',
    authorityCode: 'CCQ',
    authorityFullNameTranslations: { 'fr-CA': 'Commission de la construction du Québec', 'en-CA': 'Commission de la construction du Québec' },
    requiredDocumentType: RequiredDocumentType.COMPETENCY_CARD,
    inputType: InputType.FILE_UPLOAD,
    isRequired: true,
  },
  {
    categorySlug: 'menuiserie',
    countryCode: 'CA',
    subdivisionCode: 'CA-QC',
    authorityCode: 'ASP_CONSTRUCTION',
    authorityFullNameTranslations: { 'fr-CA': 'Association paritaire pour la santé et la sécurité du travail — secteur construction', 'en-CA': 'Joint Association for Occupational Health and Safety — Construction Sector' },
    requiredDocumentType: RequiredDocumentType.CERTIFICATION,
    inputType: InputType.FILE_UPLOAD,
    isRequired: false,
  },
];

// ── Seeder runner ──────────────────────────────────────────────────────────

type Counts = { created: number; updated: number; unchanged: number; diverged: number; orphans: number };
const counts: Counts = { created: 0, updated: 0, unchanged: 0, diverged: 0, orphans: 0 };

/** Keys of `fields` whose database value differs from the file value (key order ignored for JSONB). */
function differing<T extends object>(row: T, fields: Partial<T>): Array<keyof T> {
  return (Object.keys(fields) as Array<keyof T>).filter((k) => !isDeepStrictEqual(row[k], fields[k]));
}

async function seed(): Promise<void> {
  await ds.initialize();

  const catRepo = ds.getRepository(ServiceCategory);
  const itemRepo = ds.getRepository(ServiceItem);
  const reqRepo = ds.getRepository(RegulatoryRequirement);

  console.log('Seeding Quebec catalog…');

  // 1. Categories
  const categoryMap = new Map<string, string>();
  for (const def of CATEGORIES) {
    const cat = await catRepo.findOne({ where: { slug: def.slug } });
    if (!cat) {
      const created = await catRepo.save(
        catRepo.create({
          slug: def.slug,
          regulationLevel: def.regulationLevel,
          nameTranslations: def.nameTranslations,
          descriptionTranslations: def.descriptionTranslations,
          sortOrder: def.sortOrder,
          isActive: true,
        }),
      );
      categoryMap.set(def.slug, created.id);
      counts.created++;
      console.log(`  + category: ${def.slug}`);
      continue;
    }
    categoryMap.set(def.slug, cat.id);
    if (cat.regulationLevel !== def.regulationLevel) {
      counts.diverged++;
      console.log(`  ! category ${def.slug}: regulation_level db=${cat.regulationLevel} file=${def.regulationLevel} (NOT applied)`);
    }
    const want = {
      nameTranslations: def.nameTranslations,
      descriptionTranslations: def.descriptionTranslations,
      sortOrder: def.sortOrder,
    };
    const diff = differing(cat, want);
    if (diff.length) {
      await catRepo.update(cat.id, want);
      counts.updated++;
      console.log(`  ~ category: ${def.slug} (${diff.join(', ')})`);
    } else {
      counts.unchanged++;
      console.log(`  = category: ${def.slug}`);
    }
  }
  for (const cat of await catRepo.find()) {
    if (!categoryMap.has(cat.slug)) {
      counts.orphans++;
      console.log(`  ? category in database, not in file: ${cat.slug}`);
    }
  }

  // 2. Items
  for (const def of ITEMS) {
    const categoryId = categoryMap.get(def.categorySlug);
    if (!categoryId) throw new Error(`Unknown category slug: ${def.categorySlug}`);

    const item = await itemRepo.findOne({ where: { serviceCategoryId: categoryId, slug: def.slug } });
    if (!item) {
      await itemRepo.save(
        itemRepo.create({
          serviceCategoryId: categoryId,
          slug: def.slug,
          nameTranslations: def.nameTranslations,
          descriptionTranslations: {},
          approvalStatus: ApprovalStatus.APPROVED,
          isActive: true,
        }),
      );
      counts.created++;
      console.log(`  + item: ${def.categorySlug}/${def.slug}`);
      continue;
    }
    // The file carries no item descriptions: only the name is realigned.
    const want = { nameTranslations: def.nameTranslations };
    if (differing(item, want).length) {
      await itemRepo.update(item.id, want);
      counts.updated++;
      console.log(`  ~ item: ${def.categorySlug}/${def.slug} (nameTranslations)`);
    } else {
      counts.unchanged++;
      console.log(`  = item: ${def.categorySlug}/${def.slug}`);
    }
  }
  for (const item of await itemRepo.find()) {
    if (!ITEMS.some((d) => d.slug === item.slug && categoryMap.get(d.categorySlug) === item.serviceCategoryId)) {
      counts.orphans++;
      console.log(`  ? item in database, not in file: ${item.slug}`);
    }
  }

  // 3. Requirements (created if absent; existing ones are only compared)
  for (const def of REQUIREMENTS) {
    const categoryId = categoryMap.get(def.categorySlug);
    if (!categoryId) throw new Error(`Unknown category slug: ${def.categorySlug}`);

    const key = {
      serviceCategoryId: categoryId,
      countryCode: def.countryCode,
      subdivisionCode: def.subdivisionCode,
      authorityCode: def.authorityCode,
    };
    const req = await reqRepo.findOne({ where: key });
    const label = `${def.categorySlug}/${def.authorityCode}`;
    if (!req) {
      await reqRepo.save(
        reqRepo.create({
          ...key,
          authorityFullNameTranslations: def.authorityFullNameTranslations,
          requiredDocumentType: def.requiredDocumentType,
          inputType: def.inputType,
          isRequired: def.isRequired,
        }),
      );
      counts.created++;
      console.log(`  + requirement: ${label}`);
      continue;
    }
    const diff = differing(req, {
      authorityFullNameTranslations: def.authorityFullNameTranslations,
      requiredDocumentType: def.requiredDocumentType,
      inputType: def.inputType,
      isRequired: def.isRequired,
    });
    if (diff.length) {
      counts.diverged++;
      console.log(`  ! requirement ${label}: ${diff.join(', ')} differ from file (NOT applied)`);
    } else {
      counts.unchanged++;
      console.log(`  = requirement: ${label}`);
    }
  }
  const knownReqs = new Set(
    REQUIREMENTS.map((d) => `${categoryMap.get(d.categorySlug)}|${d.countryCode}|${d.subdivisionCode}|${d.authorityCode}`),
  );
  for (const req of await reqRepo.find()) {
    if (!knownReqs.has(`${req.serviceCategoryId}|${req.countryCode}|${req.subdivisionCode}|${req.authorityCode}`)) {
      counts.orphans++;
      console.log(`  ? requirement in database, not in file: ${req.authorityCode} (${req.serviceCategoryId})`);
    }
  }

  await ds.destroy();
  console.log(
    `Done. created=${counts.created} updated=${counts.updated} unchanged=${counts.unchanged} diverged=${counts.diverged} not-in-file=${counts.orphans}`,
  );
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
