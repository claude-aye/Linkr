import { ApiProperty } from '@nestjs/swagger';
import { ProviderType } from '../../service-providers/enums/provider-type.enum';
import { ServiceProvider } from '../../service-providers/entities/service-provider.entity';
import { VerificationDocument } from '../entities/verification-document.entity';
import { VerificationDocumentResponseDto } from './verification-document-response.dto';

/**
 * Resolves the polymorphic provider's human-readable name:
 *  - ORGANIZATION → organization.displayName
 *  - INDIVIDUAL   → businessName ?? `${user.firstName} ${user.lastName}`
 *
 * Defensive (`?.` + `'—'` fallback) so a missing relation never throws — the
 * queue must stay renderable even if a join is unexpectedly absent.
 */
function resolveProviderDisplayName(
  sp: ServiceProvider | null | undefined,
): string {
  if (!sp) return '—';
  if (sp.providerType === ProviderType.ORGANIZATION) {
    return sp.organization?.displayName ?? '—';
  }
  const fullName = `${sp.user?.firstName ?? ''} ${sp.user?.lastName ?? ''}`.trim();
  return sp.businessName ?? (fullName || '—');
}

/**
 * Admin review-queue item — the base verification-document projection enriched
 * with the joined, human-readable labels the console needs: the trade's i18n
 * name, the regulatory authority code, and the polymorphic provider name.
 *
 * Dedicated to `GET /admin/verification-documents` (Approach 1 — total
 * isolation): it extends the base DTO and reuses its frozen `from()` mapper, so
 * `VerificationDocumentResponseDto` and every other endpoint stay untouched.
 */
export class AdminVerificationQueueItemDto extends VerificationDocumentResponseDto {
  @ApiProperty({
    description: 'Libellés i18n du métier (service_categories.name_translations)',
    example: { 'fr-CA': 'Plomberie', 'en-CA': 'Plumbing' },
  })
  serviceCategoryNameTranslations!: Record<string, string>;

  @ApiProperty({ description: "Code de l'autorité réglementaire", example: 'RBQ' })
  authorityCode!: string;

  @ApiProperty({
    description: 'Nom affichable du prestataire (résolu polymorphe)',
    example: 'Plomberie ABC Inc.',
  })
  providerDisplayName!: string;

  /**
   * Builds the enriched item from a document loaded WITH its relations
   * (professionalServiceCategory → serviceCategory + serviceProvider →
   * user/organization, and regulatoryRequirement). The base scalar fields are
   * copied through the untouched `from()` mapper.
   */
  static fromWithLabels(
    doc: VerificationDocument,
  ): AdminVerificationQueueItemDto {
    const dto = new AdminVerificationQueueItemDto();
    // Base projection — single source of truth, from() stays frozen.
    Object.assign(dto, VerificationDocumentResponseDto.from(doc));

    const psc = doc.professionalServiceCategory;
    dto.serviceCategoryNameTranslations =
      psc?.serviceCategory?.nameTranslations ?? {};
    dto.authorityCode = doc.regulatoryRequirement?.authorityCode ?? '—';
    dto.providerDisplayName = resolveProviderDisplayName(psc?.serviceProvider);
    return dto;
  }
}
