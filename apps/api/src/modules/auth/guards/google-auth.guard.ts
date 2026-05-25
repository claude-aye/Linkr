import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  canActivate(context: import('@nestjs/common').ExecutionContext) {
    const clientId = this.configService.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    if (!clientId) {
      throw new ServiceUnavailableException('Google OAuth is not configured');
    }
    return super.canActivate(context);
  }
}
