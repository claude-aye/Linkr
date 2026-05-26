import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { AppleOAuthStrategy } from './strategies/apple.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const expiresIn = config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
        return {
          secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          signOptions: {
            // @nestjs/jwt v11 uses branded StringValue from ms@3; cast required
            expiresIn: expiresIn as unknown as number,
          },
        };
      },
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    GoogleStrategy,
    AppleOAuthStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule implements OnModuleInit {
  private readonly logger = new Logger(AuthModule.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const googleConfigured =
      this.configService.get<string>('GOOGLE_OAUTH_CLIENT_ID') &&
      this.configService.get<string>('GOOGLE_OAUTH_CLIENT_SECRET');
    if (!googleConfigured) {
      this.logger.warn(
        'Google OAuth not configured — endpoints /auth/google* will return 503',
      );
    }

    const appleConfigured =
      this.configService.get<string>('APPLE_OAUTH_CLIENT_ID') &&
      this.configService.get<string>('APPLE_OAUTH_TEAM_ID') &&
      this.configService.get<string>('APPLE_OAUTH_KEY_ID') &&
      this.configService.get<string>('APPLE_OAUTH_PRIVATE_KEY');
    if (!appleConfigured) {
      this.logger.warn(
        'Apple OAuth not configured — endpoints /auth/apple* will return 503',
      );
    }
  }
}
