import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class AppleAuthGuard extends AuthGuard('apple') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  canActivate(context: import('@nestjs/common').ExecutionContext) {
    const clientId = this.configService.get<string>('APPLE_OAUTH_CLIENT_ID');
    if (!clientId) {
      throw new ServiceUnavailableException('Apple Sign-In is not configured');
    }
    return super.canActivate(context);
  }
}
