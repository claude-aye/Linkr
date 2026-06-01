/**
 * Idempotent Quebec catalog seed.
 *
 * Upsert strategy:
 *   - categories  → by `slug`
 *   - items        → by `(service_category_id, slug)`
 *   - requirements → by `(service_category_id, country_code, subdivision_code, authority_code)`
 *
 * Slugs are the stable natural keys — never rename them.
 * Run with: npx ts-node -r tsconfig-paths/register src/database/seeders/quebec-catalog.seed.ts
 */

import 'dotenv/config';
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

async function seed(): Promise<void> {
  await ds.initialize();

  const catRepo = ds.getRepository(ServiceCategory);
  const itemRepo = ds.getRepository(ServiceItem);
  const reqRepo = ds.getRepository(RegulatoryRequirement);

  console.log('Seeding Quebec catalog…');

  // 1. Upsert categories
  const categoryMap = new Map<string, string>();
  for (const def of CATEGORIES) {
    let cat = await catRepo.findOne({ where: { slug: def.slug } });
    if (!cat) {
      cat = catRepo.create({
        slug: def.slug,
        regulationLevel: def.regulationLevel,
        nameTranslations: def.nameTranslations,
        descriptionTranslations: def.descriptionTranslations,
        sortOrder: def.sortOrder,
        isActive: true,
      });
      await catRepo.save(cat);
      console.log(`  + category: ${def.slug}`);
    } else {
      console.log(`  = category (exists): ${def.slug}`);
    }
    categoryMap.set(def.slug, cat.id);
  }

  // 2. Upsert items
  for (const def of ITEMS) {
    const categoryId = categoryMap.get(def.categorySlug);
    if (!categoryId) throw new Error(`Unknown category slug: ${def.categorySlug}`);

    const exists = await itemRepo.findOne({
      where: { serviceCategoryId: categoryId, slug: def.slug },
    });
    if (!exists) {
      const item = itemRepo.create({
        serviceCategoryId: categoryId,
        slug: def.slug,
        nameTranslations: def.nameTranslations,
        descriptionTranslations: {},
        approvalStatus: ApprovalStatus.APPROVED,
        isActive: true,
      });
      await itemRepo.save(item);
      console.log(`  + item: ${def.categorySlug}/${def.slug}`);
    } else {
      console.log(`  = item (exists): ${def.categorySlug}/${def.slug}`);
    }
  }

  // 3. Upsert requirements
  for (const def of REQUIREMENTS) {
    const categoryId = categoryMap.get(def.categorySlug);
    if (!categoryId) throw new Error(`Unknown category slug: ${def.categorySlug}`);

    const exists = await reqRepo.findOne({
      where: {
        serviceCategoryId: categoryId,
        countryCode: def.countryCode,
        subdivisionCode: def.subdivisionCode,
        authorityCode: def.authorityCode,
      },
    });
    if (!exists) {
      const req = reqRepo.create({
        serviceCategoryId: categoryId,
        countryCode: def.countryCode,
        subdivisionCode: def.subdivisionCode,
        authorityCode: def.authorityCode,
        authorityFullNameTranslations: def.authorityFullNameTranslations,
        requiredDocumentType: def.requiredDocumentType,
        inputType: def.inputType,
        isRequired: def.isRequired,
      });
      await reqRepo.save(req);
      console.log(`  + requirement: ${def.categorySlug}/${def.authorityCode}`);
    } else {
      console.log(`  = requirement (exists): ${def.categorySlug}/${def.authorityCode}`);
    }
  }

  await ds.destroy();
  console.log('Done.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
