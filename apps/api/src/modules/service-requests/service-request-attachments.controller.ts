import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UploadServiceRequestAttachmentDto } from './dto/upload-service-request-attachment.dto';
import { ServiceRequestAttachmentResponseDto } from './dto/service-request-attachment-response.dto';
import { ServiceRequestAttachmentsService, UploadedFileInput } from './service-request-attachments.service';
import { InvalidAttachmentFileException } from './exceptions/attachment-exceptions';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
} from './constants';

@ApiTags('service-requests')
@Controller('service-requests')
export class ServiceRequestAttachmentsController {
  constructor(
    private readonly attachmentsService: ServiceRequestAttachmentsService,
  ) {}

  @Post(':id/attachments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Upload a photo or video attachment for a service request (multipart). ' +
      'CLIENT_PHOTO: request owner only. BEFORE/AFTER: assigned worker only.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'attachmentKind'],
      properties: {
        file: { type: 'string', format: 'binary' },
        attachmentKind: {
          type: 'string',
          enum: ['CLIENT_PHOTO', 'BEFORE', 'AFTER'],
        },
        caption: { type: 'string', maxLength: 500 },
      },
    },
  })
  @ApiResponse({ status: 201, type: ServiceRequestAttachmentResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid file type/size or missing file' })
  @ApiResponse({ status: 403, description: 'Role ↔ kind mismatch or not a participant' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  @ApiResponse({ status: 409, description: 'Request is in a terminal-negative state (CANCELLED/EXPIRED/REFUNDED)' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_ATTACHMENT_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (
          (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(
            file.mimetype,
          )
        ) {
          cb(null, true);
        } else {
          cb(
            new InvalidAttachmentFileException(
              `Unsupported file type: ${file.mimetype}`,
            ),
            false,
          );
        }
      },
    }),
  )
  uploadAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadServiceRequestAttachmentDto,
    @UploadedFile() file: UploadedFileInput | undefined,
  ): Promise<ServiceRequestAttachmentResponseDto> {
    return this.attachmentsService.upload(user.sub, id, dto, file);
  }

  @Get(':id/attachments')
  @ApiOperation({
    summary:
      'List non-deleted attachments for a service request. ' +
      'Visible to: request owner (client), assigned worker, or ADMIN.',
  })
  @ApiResponse({ status: 200, type: ServiceRequestAttachmentResponseDto, isArray: true })
  @ApiResponse({ status: 403, description: 'Not a participant or admin' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  listAttachments(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceRequestAttachmentResponseDto[]> {
    return this.attachmentsService.list(user.sub, id);
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Soft-delete an attachment (uploader or ADMIN only). The blob is NOT removed.',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 403, description: 'Not the uploader or admin' })
  @ApiResponse({ status: 404, description: 'Attachment not found' })
  deleteAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ): Promise<void> {
    return this.attachmentsService.softDelete(user.sub, id, attachmentId);
  }
}
