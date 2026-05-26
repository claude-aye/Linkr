import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { UserPublicDto } from '../auth/dtos/user-public.dto';
import { UpdateUserDto } from './dtos/update-user.dto';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async updateProfile(
    userId: string,
    dto: UpdateUserDto,
  ): Promise<UserPublicDto> {
    const user = await this.usersRepository.updateProfile(userId, dto);
    if (!user) throw new NotFoundException('User not found');
    return plainToInstance(UserPublicDto, user, {
      excludeExtraneousValues: true,
    });
  }

  async deleteAccount(userId: string): Promise<void> {
    const blockingOrgIds =
      await this.usersRepository.findOrgIdsWhereUserIsLastActiveOwner(userId);
    if (blockingOrgIds.length > 0) {
      throw new ConflictException({
        message:
          'Cannot delete account while you are the last active OWNER of one or more organizations. Promote another member or delete the organization first.',
        organizationIds: blockingOrgIds,
      });
    }
    await this.usersRepository.softDeleteUserWithMembershipCascade(userId);
  }
}
