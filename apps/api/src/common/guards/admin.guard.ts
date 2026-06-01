import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';
import { SystemRole } from '../../modules/users/enums/system-role.enum';
import { UsersRepository } from '../../modules/users/users.repository';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly usersRepository: UsersRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: JwtPayload }>();

    const user = request.user;
    if (!user) throw new ForbiddenException('Authentication required');

    const dbUser = await this.usersRepository.findById(user.sub);
    if (!dbUser || dbUser.systemRole !== SystemRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
