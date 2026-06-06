import { randomUUID } from 'crypto';
import { extname } from 'path';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  IStorageService,
  STORAGE_SERVICE,
} from '../../common/storage/storage.interface';
import { UsersRepository } from '../users/users.repository';
import { SystemRole } from '../users/enums/system-role.enum';
import { ServiceRequestRepository } from './repositories/service-request.repository';
import { ServiceRequestRecord } from './repositories/service-request.repository';
import { ServiceRequestAssignmentRepository } from './repositories/service-request-assignment.repository';
import { ServiceRequestAttachmentRepository } from './repositories/service-request-attachment.repository';
import { UploadServiceRequestAttachmentDto } from './dto/upload-service-request-attachment.dto';
import { ServiceRequestAttachmentResponseDto } from './dto/service-request-attachment-response.dto';
import { ServiceRequestAttachmentKind } from './enums/service-request-attachment-kind.enum';
import { ServiceRequestStatus } from './enums/service-request-status.enum';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
} from './constants';
import {
  AttachmentAccessForbiddenException,
  AttachmentKindForbiddenException,
  AttachmentRequestStateException,
  InvalidAttachmentFileException,
} from './exceptions/attachment-exceptions';

export interface UploadedFileInput {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

/** States in which no new attachment may be uploaded. */
const UPLOAD_FORBIDDEN_STATES: ReadonlySet<ServiceRequestStatus> = new Set([
  ServiceRequestStatus.CANCELLED,
  ServiceRequestStatus.EXPIRED,
  ServiceRequestStatus.REFUNDED,
]);

@Injectable()
export class ServiceRequestAttachmentsService {
  private readonly logger = new Logger(ServiceRequestAttachmentsService.name);

  constructor(
    private readonly attachmentRepo: ServiceRequestAttachmentRepository,
    private readonly requestRepo: ServiceRequestRepository,
    private readonly assignmentRepo: ServiceRequestAssignmentRepository,
    private readonly usersRepo: UsersRepository,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  async upload(
    callerUserId: string,
    requestId: string,
    dto: UploadServiceRequestAttachmentDto,
    file: UploadedFileInput | undefined,
  ): Promise<ServiceRequestAttachmentResponseDto> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) throw new NotFoundException('Service request not found');

    // State bound: no uploads on terminal-negative requests.
    if (UPLOAD_FORBIDDEN_STATES.has(request.status)) {
      throw new AttachmentRequestStateException(
        `Attachments cannot be uploaded for a ${request.status} request`,
      );
    }

    // Role ↔ kind authorization.
    await this.assertCanUploadKind(callerUserId, request, dto.attachmentKind);

    // File validation (defensive — FileInterceptor also guards).
    this.assertValidFile(file);

    const key = this.buildStorageKey(requestId, file.originalname);
    await this.storage.upload({
      buffer: file.buffer,
      key,
      mimeType: file.mimetype,
    });

    const attachment = await this.attachmentRepo.create({
      serviceRequestId: requestId,
      attachmentKind: dto.attachmentKind,
      fileUrl: key,
      fileMimeType: file.mimetype,
      fileSizeBytes: file.size,
      caption: dto.caption ?? null,
      uploadedByUserId: callerUserId,
    });

    this.logger.log(
      `Uploaded ${dto.attachmentKind} attachment ${attachment.id} for request ${requestId} by user ${callerUserId}`,
    );
    return ServiceRequestAttachmentResponseDto.from(attachment);
  }

  async list(
    callerUserId: string,
    requestId: string,
  ): Promise<ServiceRequestAttachmentResponseDto[]> {
    const request = await this.requestRepo.findById(requestId);
    if (!request) throw new NotFoundException('Service request not found');

    await this.assertCanViewRequest(callerUserId, request);

    const attachments = await this.attachmentRepo.findByRequestId(requestId);
    return attachments.map((a) => ServiceRequestAttachmentResponseDto.from(a));
  }

  async softDelete(
    callerUserId: string,
    requestId: string,
    attachmentId: string,
  ): Promise<void> {
    const attachment = await this.attachmentRepo.findById(attachmentId);
    if (!attachment || attachment.serviceRequestId !== requestId) {
      throw new NotFoundException('Attachment not found');
    }

    // Only the uploader or an ADMIN may delete. Blob is NOT removed.
    if (
      attachment.uploadedByUserId !== callerUserId &&
      !(await this.isAdmin(callerUserId))
    ) {
      throw new AttachmentAccessForbiddenException(
        'Only the uploader or an admin can delete this attachment',
      );
    }

    await this.attachmentRepo.softDelete(attachmentId);
    this.logger.log(
      `Soft-deleted attachment ${attachmentId} of request ${requestId} by user ${callerUserId}`,
    );
  }

  // ── Authorization helpers ─────────────────────────────────────────────────

  private async assertCanUploadKind(
    callerUserId: string,
    request: ServiceRequestRecord,
    kind: ServiceRequestAttachmentKind,
  ): Promise<void> {
    if (kind === ServiceRequestAttachmentKind.CLIENT_PHOTO) {
      if (request.clientUserId !== callerUserId) {
        throw new AttachmentKindForbiddenException(
          'Only the request owner can upload a CLIENT_PHOTO',
        );
      }
      return;
    }

    // BEFORE / AFTER — worker of the live assignment only.
    const assignment = await this.assignmentRepo.findLiveByRequestId(request.id);
    if (!assignment || assignment.workerUserId !== callerUserId) {
      throw new AttachmentKindForbiddenException(
        'Only the assigned worker can upload BEFORE/AFTER attachments',
      );
    }
  }

  private async assertCanViewRequest(
    callerUserId: string,
    request: ServiceRequestRecord,
  ): Promise<void> {
    if (request.clientUserId === callerUserId) return;
    if (await this.isAdmin(callerUserId)) return;

    const assignment = await this.assignmentRepo.findLiveByRequestId(request.id);
    if (assignment && assignment.workerUserId === callerUserId) return;

    throw new AttachmentAccessForbiddenException(
      'You are not allowed to view this request\'s attachments',
    );
  }

  private async isAdmin(userId: string): Promise<boolean> {
    const user = await this.usersRepo.findById(userId);
    return user?.systemRole === SystemRole.ADMIN;
  }

  // ── File helpers (mirrors 3.7c verification upload validation) ─────────────

  private assertValidFile(
    file: UploadedFileInput | undefined,
  ): asserts file is UploadedFileInput {
    if (!file) throw new InvalidAttachmentFileException('No file provided');
    if (
      !(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(
        file.mimetype,
      )
    ) {
      throw new InvalidAttachmentFileException(
        `Unsupported file type: ${file.mimetype}`,
      );
    }
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new InvalidAttachmentFileException('File exceeds the 50 MB limit');
    }
  }

  private buildStorageKey(requestId: string, originalName: string): string {
    const ext = extname(originalName).toLowerCase() || '.bin';
    return `service-request-attachments/${requestId}/${randomUUID()}${ext}`;
  }
}
