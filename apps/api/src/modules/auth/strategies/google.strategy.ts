import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { AuthService } from '../auth.service';
import { AuthProviderType } from '../../users/enums/auth-provider-type.enum';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly authService: AuthService,
    configService: ConfigService,
  ) {
    const clientID = configService.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = configService.get<string>('GOOGLE_OAUTH_CLIENT_SECRET');
    const callbackURL =
      configService.get<string>('GOOGLE_OAUTH_CALLBACK_URL') ??
      'http://localhost:3000/auth/google/callback';

    super({
      clientID: clientID ?? 'GOOGLE_OAUTH_NOT_CONFIGURED',
      clientSecret: clientSecret ?? 'GOOGLE_OAUTH_NOT_CONFIGURED',
      callbackURL,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      emails?: Array<{ value: string }>;
      name?: { givenName?: string; familyName?: string };
    },
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) return done(new Error('No email returned from Google'), undefined);

      const response = await this.authService.handleOAuthCallback(
        AuthProviderType.GOOGLE,
        profile.id,
        email,
        profile.name?.givenName ?? '',
        profile.name?.familyName ?? '',
      );
      done(null, response);
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)), undefined);
    }
  }
}
