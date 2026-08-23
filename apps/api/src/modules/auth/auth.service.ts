import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { plainToInstance } from 'class-transformer';
import * as argon2 from 'argon2';
import { AuthProviderType } from '../users/enums/auth-provider-type.enum';
import { User } from '../users/entities/user.entity';
import { UsersRepository } from '../users/users.repository';
import { AuthResponseDto } from './dtos/auth-response.dto';
import { SignupDto } from './dtos/signup.dto';
import { UserPublicDto } from './dtos/user-public.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { TokenType } from './enums/token-type.enum';

// @nestjs/jwt v11 uses branded StringValue from ms@3 for expiresIn;
// string values are valid at runtime — cast required to satisfy the compiler.
type ExpiresIn = number;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersRepository: UsersRepository,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  signTokenPair(sub: string, email: string): TokenPair {
    const accessSecret = this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');
    const accessExpiresIn = this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
    const refreshSecret = this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';

    const accessToken = this.jwtService.sign(
      { sub, email, type: TokenType.ACCESS } satisfies JwtPayload,
      { secret: accessSecret, expiresIn: accessExpiresIn as unknown as ExpiresIn },
    );

    const refreshToken = this.jwtService.sign(
      { sub, email, type: TokenType.REFRESH } satisfies JwtPayload,
      { secret: refreshSecret, expiresIn: refreshExpiresIn as unknown as ExpiresIn },
    );

    return { accessToken, refreshToken };
  }

  verifyRefreshToken(token: string): JwtPayload {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      if (payload.type !== TokenType.REFRESH) {
        throw new UnauthorizedException('Invalid token type');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async validateLocal(email: string, password: string): Promise<User | null> {
    const user = await this.usersRepository.findByEmailWithAuthProviders(email);
    if (!user) return null;

    const emailProvider = user.authProviders?.find(
      (p) => p.providerType === AuthProviderType.EMAIL_PASSWORD,
    );
    if (!emailProvider?.passwordHash) return null;

    const valid = await this.verifyPassword(emailProvider.passwordHash, password);
    if (!valid) return null;

    await this.usersRepository.updateLastUsedAt(emailProvider.id);
    return user;
  }

  async signup(dto: SignupDto): Promise<AuthResponseDto> {
    const existing = await this.usersRepository.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.usersRepository.createWithEmailPassword(
      {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        countryCode: dto.countryCode,
        subdivisionCode: dto.subdivisionCode,
        preferredCurrency: dto.preferredCurrency,
        phone: dto.phone ?? null,
        displayName: dto.displayName ?? null,
        languagePreference: dto.languagePreference ?? 'fr-CA',
      },
      passwordHash,
    );

    this.logger.log(`New user registered: ${user.id}`);
    const tokens = this.signTokenPair(user.id, user.email);
    return { ...tokens, user: this.toPublicDto(user) };
  }

  login(user: User): AuthResponseDto {
    const tokens = this.signTokenPair(user.id, user.email);
    return { ...tokens, user: this.toPublicDto(user) };
  }

  /**
   * Exchanges a refresh token for a fresh pair — and refuses the ones a password
   * change has expelled (A-2.10).
   *
   * ⚠️ THE REVOCATION CHECK LIVES HERE, ON THE REFRESH PATH, AND NOWHERE ELSE.
   * The ACCESS token is deliberately NOT checked: doing so would mean a database
   * read on every authenticated request, to close a window that is already
   * bounded by the access token's ≤15-minute lifetime. Accepted, bounded, and
   * cheap — an attacker holding a stolen access token keeps it for minutes, not
   * for the seven days a refresh token would have given them.
   *
   * ⚠️ THE COMPARISON IS IN SECONDS, AND THAT IS NOT A ROUNDING PREFERENCE. JWT
   * `iat` is in whole seconds (RFC 7519); `sessionsInvalidatedAtUtc` is a
   * millisecond-precision timestamp. Comparing raw milliseconds would reject a
   * token issued in the SAME second as the change — i.e. the token the user just
   * received from the very reset they performed — so the bound is floored to
   * seconds before comparing. Strict `<`: a token issued during that same second
   * survives. The blast radius of that one second is one token belonging to the
   * person who just proved control of the mailbox.
   *
   * A token with no `iat` is refused rather than trusted. Every token this
   * service signs has one (jsonwebtoken adds it), so an absent `iat` means a
   * token this service did not mint in the normal way — not a token to renew.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = this.verifyRefreshToken(refreshToken);
    const user = await this.usersRepository.findById(payload.sub);
    if (!user) throw new UnauthorizedException('User not found');

    const invalidatedAtSeconds = Math.floor(
      user.sessionsInvalidatedAtUtc.getTime() / 1000,
    );
    if (payload.iat === undefined || payload.iat < invalidatedAtSeconds) {
      // Same message as every other refresh failure: a client that learns
      // "expelled" rather than "expired" learns nothing it can act on
      // differently — both mean sign in again.
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return this.signTokenPair(user.id, user.email);
  }

  async me(userId: string): Promise<UserPublicDto> {
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');
    return this.toPublicDto(user);
  }

  async handleOAuthCallback(
    providerType: AuthProviderType,
    providerUserId: string,
    email: string,
    firstName: string,
    lastName: string,
  ): Promise<AuthResponseDto> {
    // 1. Known OAuth identity → log in directly.
    const existingProvider =
      await this.usersRepository.findAuthProviderByProviderIdentity(
        providerType,
        providerUserId,
      );
    if (existingProvider) {
      await this.usersRepository.updateLastUsedAt(existingProvider.id);
      const tokens = this.signTokenPair(
        existingProvider.user.id,
        existingProvider.user.email,
      );
      return { ...tokens, user: this.toPublicDto(existingProvider.user) };
    }

    // 2. Email already registered (e.g. email/password) → link the new provider.
    const existingUser = await this.usersRepository.findByEmail(email);
    if (existingUser) {
      await this.usersRepository.addAuthProvider(existingUser.id, providerType, providerUserId);
      this.logger.log(`Linked ${providerType} to existing user: ${existingUser.id}`);
      const tokens = this.signTokenPair(existingUser.id, existingUser.email);
      return { ...tokens, user: this.toPublicDto(existingUser) };
    }

    // 3. Brand-new user — provision with Quebec defaults.
    const user = await this.usersRepository.createWithOAuthProvider(
      {
        email,
        firstName,
        lastName,
        countryCode: 'CA',
        subdivisionCode: 'CA-QC',
        preferredCurrency: 'CAD',
        languagePreference: 'fr-CA',
      },
      providerType,
      providerUserId,
    );

    this.logger.log(`New OAuth user registered via ${providerType}: ${user.id}`);
    const tokens = this.signTokenPair(user.id, user.email);
    return { ...tokens, user: this.toPublicDto(user) };
  }

  toPublicDto(user: User): UserPublicDto {
    return plainToInstance(UserPublicDto, user, {
      excludeExtraneousValues: true,
    });
  }
}
