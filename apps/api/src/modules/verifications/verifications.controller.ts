import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UploadVerificationDocumentDto } from './dto/upload-verification-document.dto';
import { VerificationDocumentResponseDto } from './dto/verification-document-response.dto';
import { VerificationsService, UploadedFileInput } from './verifications.service';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_SIZE_BYTES,
} from './constants';
import { InvalidFileException } from './exceptions/verification-exceptions';

@ApiTags('verifications')
@Controller()
export class VerificationsController {
  constructor(private readonly verificationsService: VerificationsService) {}

  @Post('service-providers/:providerId/categories/:pscId/documents')
  @ApiOperation({
    summary:
      'Upload a verification document for a regulated provider category (owner only).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        regulatoryRequirementId: { type: 'string', format: 'uuid' },
        documentType: { type: 'string' },
        documentNumber: { type: 'string' },
        issuedAtUtc: { type: 'string', format: 'date-time' },
        expiresAtUtc: { type: 'string', format: 'date-time' },
      },
      required: ['file', 'regulatoryRequirementId', 'documentType'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (
          (ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(
            file.mimetype,
          )
        ) {
          cb(null, true);
        } else {
          cb(new InvalidFileException(`Unsupported file type: ${file.mimetype}`), false);
        }
      },
    }),
  )
  uploadDocument(
    @CurrentUser() user: JwtPayload,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Param('pscId', ParseUUIDPipe) pscId: string,
    @Body() dto: UploadVerificationDocumentDto,
    @UploadedFile() file: UploadedFileInput | undefined,
  ): Promise<VerificationDocumentResponseDto> {
    return this.verificationsService.uploadDocument(
      user.sub,
      providerId,
      pscId,
      dto,
      file,
    );
  }

  @Get('service-providers/:providerId/categories/:pscId/documents')
  @ApiOperation({ summary: 'List verification documents for a provider category (owner only).' })
  listDocuments(
    @CurrentUser() user: JwtPayload,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Param('pscId', ParseUUIDPipe) pscId: string,
  ): Promise<VerificationDocumentResponseDto[]> {
    return this.verificationsService.listDocuments(user.sub, providerId, pscId);
  }

  @Get('verification-documents/:id/file')
  @ApiOperation({
    summary: 'Download a verification document file (admin or provider owner).',
  })
  async downloadDocument(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { stream, mimeType } = await this.verificationsService.getDocumentFile(
      user.sub,
      id,
    );
    return new StreamableFile(stream, { type: mimeType });
  }
}
