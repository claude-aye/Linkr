import {
  Injectable,
  Logger,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { TokenType } from './enums/token-type.enum';
import { AuthResponseDto } from './dtos/auth-response.dto';
import { UserPublicDto } from './dtos/user-public.dto';
import { SignupDto } from './dtos/signup.dto';

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

  // Implemented in subsequent commit — email/password + OAuth flows.
  validateLocal(_email: string, _password: string): Promise<null> {
    throw new NotImplementedException();
  }

  signup(_dto: SignupDto): Promise<AuthResponseDto> {
    throw new NotImplementedException();
  }

  login(_user: unknown): AuthResponseDto {
    throw new NotImplementedException();
  }

  refresh(_refreshToken: string): Promise<TokenPair> {
    throw new NotImplementedException();
  }

  me(_userId: string): Promise<UserPublicDto> {
    throw new NotImplementedException();
  }
}
