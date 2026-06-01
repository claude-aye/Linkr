import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateRegulatoryRequirementDto } from './create-regulatory-requirement.dto';

// The identity tuple (category + country + subdivision + authority) is immutable.
export class UpdateRegulatoryRequirementDto extends PartialType(
  OmitType(CreateRegulatoryRequirementDto, [
    'serviceCategoryId',
    'countryCode',
    'subdivisionCode',
    'authorityCode',
  ] as const),
) {}
