import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PricingModel } from '../enums/pricing-model.enum';
import { PsCatalogRecord } from '../repositories/professional-service.repository';

/**
 * Public, client-facing view of a provider's bookable service (the response of
 * `@Public() GET /service-providers/:providerId/services`). Dedicated DTO —
 * the global {@link ProfessionalServiceResponseDto} (owner/create/update) is
 * left INTACT.
 *
 * Enriched vs the global DTO so the public provider-profile page can name each
 * service AND build the `POST /service-requests` payload:
 *  - `serviceCategoryId` = the CATALOG trade id (`service_categories.id`,
 *    resolved via `service_items.service_category_id`). This is REQUIRED by
 *    `CreateServiceRequestDto` and is NOT the junction id.
 *    ⚠️ Do NOT confuse it with `professionalServiceCategoryId` (the id of the
 *    `professional_service_categories` junction row) — a different UUID.
 *  - `serviceItemNameTranslations` / `serviceCategoryNameTranslations` = joined
 *    i18n labels (anti-UUID), so the front never renders a raw id.
 *
 * Dropped vs the global DTO (client-irrelevant noise): the junction
 * `professionalServiceCategoryId`, `isActive` (already a server-side filter),
 * `createdAtUtc`, `updatedAtUtc`. No trust field (regulationLevel /
 * verificationStatus / badge) — badge display is a locked, deferred product
 * decision.
 */
export class ProviderServiceCatalogItemDto {
  @ApiProperty() id!: string;

  @ApiProperty({ format: 'uuid' }) serviceItemId!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Catalog trade id (service_categories.id) — REQUIRED by POST /service-requests. ' +
      'NOT the professional_service_categories junction id.',
  })
  serviceCategoryId!: string;

  @ApiProperty({
    description: 'Libellés i18n du service',
    additionalProperties: { type: 'string' }, // types the JSONB map (codegen → Record<string, string>)
    example: { 'fr-CA': 'Déboucher un évier', 'en-CA': 'Unclog a sink' },
  })
  serviceItemNameTranslations!: Record<string, string>;

  @ApiProperty({
    description: 'Libellés i18n du métier',
    additionalProperties: { type: 'string' }, // idem
    example: { 'fr-CA': 'Plomberie', 'en-CA': 'Plumbing' },
  })
  serviceCategoryNameTranslations!: Record<string, string>;

  @ApiProperty({ enum: PricingModel }) pricingModel!: PricingModel;
  @ApiPropertyOptional() priceAmount!: number | null;
  @ApiProperty() priceCurrency!: string;
  @ApiPropertyOptional() estimatedDurationMinutes!: number | null;
  @ApiPropertyOptional() descriptionOverride!: string | null;

  /**
   * Builds the enriched item from a label-joined record. Defensive on the
   * label maps (`?? {}`) so a renderable item is produced even if a join were
   * unexpectedly absent.
   */
  static fromWithLabels(
    record: PsCatalogRecord,
  ): ProviderServiceCatalogItemDto {
    const dto = new ProviderServiceCatalogItemDto();
    dto.id = record.id;
    dto.serviceItemId = record.serviceItemId;
    dto.serviceCategoryId = record.serviceCategoryId;
    dto.serviceItemNameTranslations = record.serviceItemNameTranslations ?? {};
    dto.serviceCategoryNameTranslations =
      record.serviceCategoryNameTranslations ?? {};
    dto.pricingModel = record.pricingModel;
    dto.priceAmount = record.priceAmount;
    dto.priceCurrency = record.priceCurrency;
    dto.estimatedDurationMinutes = record.estimatedDurationMinutes;
    dto.descriptionOverride = record.descriptionOverride;
    return dto;
  }
}
