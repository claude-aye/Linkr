import { randomUUID } from 'crypto';
import { extname } from 'path';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RegulationLevel } from '../services-catalog/enums/regulation-level.enum';
import { ServiceCategoryRepository } from '../services-catalog/repositories/service-category.repository';
import { RegulatoryRequirementRepository } from '../services-catalog/repositories/regulatory-requirement.repository';
import { ProfessionalServiceCategoryRepository } from '../service-providers/repositories/professional-service-category.repository';
import { ServiceProvidersService } from '../service-providers/service-providers.service';
import { UsersRepository } from '../users/users.repository';
import { SystemRole } from '../users/enums/system-role.enum';
import { NotProviderOwnerException } from '../service-providers/exceptions/provider-exceptions';
import {
  IStorageService,
  STORAGE_SERVICE,
} from '../../common/storage/storage.interface';
import { VerificationDocument } from './entities/verification-document.entity';
import { VerificationDocumentRepository } from './repositories/verification-document.repository';
import { UploadVerificationDocumentDto } from './dto/upload-verification-document.dto';
import { VerificationDocumentResponseDto } from './dto/verification-document-response.dto';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_SIZE_BYTES,
} from './constants';
import {
  CategoryNotRegulatedException,
  DocumentTypeMismatchException,
  InvalidFileException,
  RequirementNotInScopeException,
} from './exceptions/verification-exceptions';

export interface UploadedFileInput {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@Injectable()
export class VerificationsService {
  private readonly logger = new Logger(VerificationsService.name);

  constructor(
    private readonly documentRepo: VerificationDocumentRepository,
    private readonly pscRepo: ProfessionalServiceCategoryRepository,
    private readonly categoryRepo: ServiceCategoryRepository,
    private readonly requirementRepo: RegulatoryRequirementRepository,
    private readonly providersService: ServiceProvidersService,
    private readonly usersRepository: UsersRepository,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  // ── Provider: upload / list / download ───────────────────────────────────

  async uploadDocument(
    currentUserId: string,
    providerId: string,
    pscId: string,
    dto: UploadVerificationDocumentDto,
    file: UploadedFileInput | undefined,
  ): Promise<VerificationDocumentResponseDto> {
    // 1. Ownership.
    await this.providersService.loadOwnedProvider(currentUserId, providerId);
    const psc = await this.loadProviderPsc(providerId, pscId);

    // 2. Category must be REGULATED.
    const category = await this.categoryRepo.findById(psc.serviceCategoryId);
    if (!category) throw new NotFoundException('Service category not found');
    if (category.regulationLevel !== RegulationLevel.REGULATED) {
      throw new CategoryNotRegulatedException();
    }

    // 3. Requirement must be in the category AND the provider jurisdiction.
    const { countryCode, subdivisionCode } =
      await this.providersService.getProviderJurisdiction(providerId);
    const inScope = await this.requirementRepo.findByZone(
      category.id,
      countryCode,
      subdivisionCode,
    );
    const requirement = inScope.find((r) => r.id === dto.regulatoryRequirementId);
    if (!requirement) throw new RequirementNotInScopeException();

    // 4. documentType must match the requirement.
    if (dto.documentType !== requirement.requiredDocumentType) {
      throw new DocumentTypeMismatchException();
    }

    // 5. File validation (defensive — FileInterceptor also guards).
    this.assertValidFile(file);

    // 6. Store + persist.
    const key = this.buildStorageKey(pscId, file.originalname);
    await this.storage.upload({
      buffer: file.buffer,
      key,
      mimeType: file.mimetype,
    });

    const doc = await this.documentRepo.create({
      professionalServiceCategoryId: pscId,
      regulatoryRequirementId: dto.regulatoryRequirementId,
      documentType: dto.documentType,
      documentNumber: dto.documentNumber ?? null,
      fileUrl: key,
      fileMimeType: file.mimetype,
      fileSizeBytes: file.size,
      issuedAtUtc: dto.issuedAtUtc ? new Date(dto.issuedAtUtc) : null,
      expiresAtUtc: dto.expiresAtUtc ? new Date(dto.expiresAtUtc) : null,
    });

    this.logger.log(
      `Uploaded verification document ${doc.id} for PSC ${pscId} (req ${requirement.authorityCode})`,
    );
    return VerificationDocumentResponseDto.from(doc);
  }

  async listDocuments(
    currentUserId: string,
    providerId: string,
    pscId: string,
  ): Promise<VerificationDocumentResponseDto[]> {
    await this.providersService.loadOwnedProvider(currentUserId, providerId);
    await this.loadProviderPsc(providerId, pscId);
    const docs = await this.documentRepo.findByPscId(pscId);
    return docs.map((d) => VerificationDocumentResponseDto.from(d));
  }

  /**
   * Resolves a document for streaming, authorizing either an admin or the
   * provider owner. Returns the storage stream + metadata.
   */
  async getDocumentFile(currentUserId: string, documentId: string) {
    const doc = await this.documentRepo.findById(documentId);
    if (!doc) throw new NotFoundException('Verification document not found');

    await this.assertCanAccessDocument(currentUserId, doc);

    const { stream } = await this.storage.getStream(doc.fileUrl);
    return { stream, mimeType: doc.fileMimeType };
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  /** Loads a PSC and verifies it belongs to the given provider. */
  async loadProviderPsc(providerId: string, pscId: string) {
    const psc = await this.pscRepo.findById(pscId);
    if (!psc || psc.serviceProviderId !== providerId) {
      throw new NotFoundException('Provider category not found');
    }
    return psc;
  }

  private async assertCanAccessDocument(
    currentUserId: string,
    doc: VerificationDocument,
  ): Promise<void> {
    const user = await this.usersRepository.findById(currentUserId);
    if (user?.systemRole === SystemRole.ADMIN) return;

    const psc = await this.pscRepo.findById(doc.professionalServiceCategoryId);
    if (!psc) throw new NotProviderOwnerException();
    // Throws NotProviderOwnerException (403) if not the owner.
    await this.providersService.loadOwnedProvider(
      currentUserId,
      psc.serviceProviderId,
    );
  }

  private assertValidFile(
    file: UploadedFileInput | undefined,
  ): asserts file is UploadedFileInput {
    if (!file) throw new InvalidFileException('No file provided');
    if (
      !(ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(file.mimetype)
    ) {
      throw new InvalidFileException(
        `Unsupported file type: ${file.mimetype}`,
      );
    }
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      throw new InvalidFileException('File exceeds the 10 MB limit');
    }
  }

  private buildStorageKey(pscId: string, originalName: string): string {
    const ext = extname(originalName).toLowerCase() || '.bin';
    return `verifications/${pscId}/${randomUUID()}${ext}`;
  }
}
