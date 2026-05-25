import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import AppleStrategy from 'passport-apple';
import { AuthService } from '../auth.service';
import { AuthProviderType } from '../../users/enums/auth-provider-type.enum';

interface AppleProfile {
  id: string;
  email?: string;
  name?: { firstName?: string; lastName?: string };
}

@Injectable()
export class AppleOAuthStrategy extends PassportStrategy(AppleStrategy, 'apple') {
  constructor(
    private readonly authService: AuthService,
    configService: ConfigService,
  ) {
    const clientID = configService.get<string>('APPLE_OAUTH_CLIENT_ID');
    const teamID = configService.get<string>('APPLE_OAUTH_TEAM_ID');
    const keyID = configService.get<string>('APPLE_OAUTH_KEY_ID');
    const privateKeyString = configService.get<string>('APPLE_OAUTH_PRIVATE_KEY');
    const callbackURL =
      configService.get<string>('APPLE_OAUTH_CALLBACK_URL') ??
      'http://localhost:3000/auth/apple/callback';

    super({
      clientID: clientID ?? 'APPLE_OAUTH_NOT_CONFIGURED',
      teamID: teamID ?? 'APPLE_TEAM_NOT_CONFIGURED',
      keyID: keyID ?? 'APPLE_KEY_NOT_CONFIGURED',
      privateKeyString: privateKeyString ?? 'APPLE_PRIVATE_KEY_NOT_CONFIGURED',
      callbackURL,
      passReqToCallback: false,
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    _idToken: string,
    profile: AppleProfile,
    done: (err: Error | null, user?: unknown) => void,
  ): Promise<void> {
    try {
      const email = profile.email;
      if (!email) return done(new Error('No email returned from Apple'));

      const response = await this.authService.handleOAuthCallback(
        AuthProviderType.APPLE,
        profile.id,
        email,
        profile.name?.firstName ?? '',
        profile.name?.lastName ?? '',
      );
      done(null, response);
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
