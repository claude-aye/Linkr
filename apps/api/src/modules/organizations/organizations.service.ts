import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { CreateOrganizationDto } from './dtos/create-organization.dto';
import { OrganizationPublicDto } from './dtos/organization-public.dto';
import { UpdateOrganizationDto } from './dtos/update-organization.dto';
import { OrganizationsRepository } from './organizations.repository';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly organizationsRepository: OrganizationsRepository,
  ) {}

  async create(
    dto: CreateOrganizationDto,
    ownerUserId: string,
  ): Promise<OrganizationPublicDto> {
    const existing = await this.organizationsRepository.findBySlug(dto.slug);
    if (existing) throw new ConflictException(`Slug "${dto.slug}" is already taken`);

    const org = await this.organizationsRepository.createWithOwner(
      dto,
      ownerUserId,
    );
    return this.toDto(org);
  }

  async findOne(id: string): Promise<OrganizationPublicDto> {
    const org = await this.organizationsRepository.findById(id);
    if (!org) throw new NotFoundException('Organization not found');
    return this.toDto(org);
  }

  async update(
    id: string,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationPublicDto> {
    if (dto.slug) {
      const existing = await this.organizationsRepository.findBySlug(dto.slug);
      if (existing && existing.id !== id)
        throw new ConflictException(`Slug "${dto.slug}" is already taken`);
    }

    const org = await this.organizationsRepository.update(id, dto);
    if (!org) throw new NotFoundException('Organization not found');
    return this.toDto(org);
  }

  async remove(id: string): Promise<void> {
    const org = await this.organizationsRepository.findById(id);
    if (!org) throw new NotFoundException('Organization not found');
    await this.organizationsRepository.softDelete(id);
  }

  private toDto(org: object): OrganizationPublicDto {
    return plainToInstance(OrganizationPublicDto, org, {
      excludeExtraneousValues: true,
    });
  }
}
