import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ServiceCategoryRepository } from './repositories/service-category.repository';
import { ServiceItemRepository } from './repositories/service-item.repository';
import { RegulatoryRequirementRepository } from './repositories/regulatory-requirement.repository';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceItem } from './entities/service-item.entity';
import { RegulatoryRequirement } from './entities/regulatory-requirement.entity';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto';
import { UpdateServiceCategoryDto } from './dto/update-service-category.dto';
import { CreateServiceItemDto } from './dto/create-service-item.dto';
import { UpdateServiceItemDto } from './dto/update-service-item.dto';
import { RejectServiceItemDto } from './dto/reject-service-item.dto';
import { CreateRegulatoryRequirementDto } from './dto/create-regulatory-requirement.dto';
import { UpdateRegulatoryRequirementDto } from './dto/update-regulatory-requirement.dto';
import { ApprovalStatus } from './enums/approval-status.enum';

@Injectable()
export class ServicesCatalogService {
  private readonly logger = new Logger(ServicesCatalogService.name);

  constructor(
    private readonly categoryRepo: ServiceCategoryRepository,
    private readonly itemRepo: ServiceItemRepository,
    private readonly requirementRepo: RegulatoryRequirementRepository,
  ) {}

  // ── Categories ────────────────────────────────────────────────────────────

  listPublicCategories(): Promise<ServiceCategory[]> {
    return this.categoryRepo.findActivePublic();
  }

  async getCategoryBySlug(slug: string): Promise<ServiceCategory> {
    const cat = await this.categoryRepo.findBySlug(slug);
    if (!cat || !cat.isActive)
      throw new NotFoundException(`Service category '${slug}' not found`);
    return cat;
  }

  async createCategory(dto: CreateServiceCategoryDto): Promise<ServiceCategory> {
    const exists = await this.categoryRepo.existsActiveSlug(dto.slug);
    if (exists) throw new ConflictException(`Slug '${dto.slug}' is already taken`);
    const cat = await this.categoryRepo.create(dto);
    this.logger.log(`Created service category: ${cat.id} (${cat.slug})`);
    return cat;
  }

  async updateCategory(
    id: string,
    dto: UpdateServiceCategoryDto,
  ): Promise<ServiceCategory> {
    if (dto.slug) {
      const exists = await this.categoryRepo.existsActiveSlug(dto.slug, id);
      if (exists) throw new ConflictException(`Slug '${dto.slug}' is already taken`);
    }
    const cat = await this.categoryRepo.update(id, dto);
    if (!cat) throw new NotFoundException('Service category not found');
    return cat;
  }

  async deleteCategory(id: string): Promise<void> {
    const cat = await this.categoryRepo.findById(id);
    if (!cat) throw new NotFoundException('Service category not found');
    await this.categoryRepo.softDelete(id);
    this.logger.log(`Soft-deleted service category: ${id}`);
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  async listApprovedItems(categorySlug: string): Promise<ServiceItem[]> {
    const cat = await this.categoryRepo.findBySlug(categorySlug);
    if (!cat || !cat.isActive)
      throw new NotFoundException(`Service category '${categorySlug}' not found`);
    return this.itemRepo.findApprovedByCategoryId(cat.id);
  }

  async adminCreateItem(dto: CreateServiceItemDto): Promise<ServiceItem> {
    const cat = await this.categoryRepo.findById(dto.serviceCategoryId);
    if (!cat) throw new NotFoundException('Service category not found');

    const slugExists = await this.itemRepo.existsActiveSlugInCategory(
      dto.serviceCategoryId,
      dto.slug,
    );
    if (slugExists)
      throw new ConflictException(`Slug '${dto.slug}' already exists in this category`);

    const item = await this.itemRepo.create({
      serviceCategoryId: dto.serviceCategoryId,
      slug: dto.slug,
      nameTranslations: dto.nameTranslations,
      descriptionTranslations: dto.descriptionTranslations,
      typicalDurationMinutes: dto.typicalDurationMinutes,
      suggestedPriceRange: dto.suggestedPriceRange,
      suggestedByUserId: null,
      approvalStatus: dto.approvalStatus ?? ApprovalStatus.APPROVED,
    });
    this.logger.log(`Admin created service item: ${item.id} (${item.slug})`);
    return item;
  }

  async updateItem(id: string, dto: UpdateServiceItemDto): Promise<ServiceItem> {
    const item = await this.itemRepo.findById(id);
    if (!item) throw new NotFoundException('Service item not found');

    if (dto.slug && dto.slug !== item.slug) {
      const exists = await this.itemRepo.existsActiveSlugInCategory(
        item.serviceCategoryId,
        dto.slug,
        id,
      );
      if (exists)
        throw new ConflictException(`Slug '${dto.slug}' already exists in this category`);
    }

    const updated = await this.itemRepo.update(id, dto);
    if (!updated) throw new NotFoundException('Service item not found');
    return updated;
  }

  async approveItem(id: string, adminUserId: string): Promise<ServiceItem> {
    const item = await this.itemRepo.findById(id);
    if (!item) throw new NotFoundException('Service item not found');
    if (item.approvalStatus !== ApprovalStatus.PENDING)
      throw new ConflictException(`Item is already ${item.approvalStatus}`);

    const approved = await this.itemRepo.approve(id, adminUserId);
    if (!approved) throw new NotFoundException('Service item not found');
    this.logger.log(`Approved service item: ${id} by admin ${adminUserId}`);
    return approved;
  }

  async rejectItem(
    id: string,
    dto: RejectServiceItemDto,
  ): Promise<ServiceItem> {
    const item = await this.itemRepo.findById(id);
    if (!item) throw new NotFoundException('Service item not found');
    if (item.approvalStatus !== ApprovalStatus.PENDING)
      throw new ConflictException(`Item is already ${item.approvalStatus}`);

    const rejected = await this.itemRepo.reject(id, dto.rejectionReason);
    if (!rejected) throw new NotFoundException('Service item not found');
    return rejected;
  }

  async deleteItem(id: string): Promise<void> {
    const item = await this.itemRepo.findById(id);
    if (!item) throw new NotFoundException('Service item not found');
    await this.itemRepo.softDelete(id);
    this.logger.log(`Soft-deleted service item: ${id}`);
  }

  // ── Regulatory requirements ───────────────────────────────────────────────

  async listRequirements(
    categorySlug: string,
    countryCode: string,
    subdivisionCode?: string,
  ): Promise<RegulatoryRequirement[]> {
    const cat = await this.categoryRepo.findBySlug(categorySlug);
    if (!cat || !cat.isActive)
      throw new NotFoundException(`Service category '${categorySlug}' not found`);
    return this.requirementRepo.findByZone(cat.id, countryCode, subdivisionCode);
  }

  async createRequirement(
    dto: CreateRegulatoryRequirementDto,
  ): Promise<RegulatoryRequirement> {
    const cat = await this.categoryRepo.findById(dto.serviceCategoryId);
    if (!cat) throw new NotFoundException('Service category not found');

    const exists = await this.requirementRepo.existsActiveRule(
      dto.serviceCategoryId,
      dto.countryCode,
      dto.subdivisionCode ?? null,
      dto.authorityCode,
    );
    if (exists)
      throw new ConflictException(
        `A requirement for authority '${dto.authorityCode}' already exists for this category/zone`,
      );

    const req = await this.requirementRepo.create({
      ...dto,
      subdivisionCode: dto.subdivisionCode ?? null,
    });
    this.logger.log(`Created regulatory requirement: ${req.id}`);
    return req;
  }

  async updateRequirement(
    id: string,
    dto: UpdateRegulatoryRequirementDto,
  ): Promise<RegulatoryRequirement> {
    const req = await this.requirementRepo.findById(id);
    if (!req) throw new NotFoundException('Regulatory requirement not found');
    const updated = await this.requirementRepo.update(id, dto);
    if (!updated) throw new NotFoundException('Regulatory requirement not found');
    return updated;
  }

  async deleteRequirement(id: string): Promise<void> {
    const req = await this.requirementRepo.findById(id);
    if (!req) throw new NotFoundException('Regulatory requirement not found');
    await this.requirementRepo.softDelete(id);
    this.logger.log(`Soft-deleted regulatory requirement: ${id}`);
  }
}
