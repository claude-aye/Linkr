import { PartialType } from '@nestjs/swagger';
import { CreateServiceItemDto } from './create-service-item.dto';
import { OmitType } from '@nestjs/swagger';

// serviceCategoryId and approvalStatus are not patchable after creation.
export class UpdateServiceItemDto extends PartialType(
  OmitType(CreateServiceItemDto, ['serviceCategoryId', 'approvalStatus'] as const),
) {}
