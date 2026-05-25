import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService, TokenPair } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { SignupDto } from './dtos/signup.dto';
import { RefreshTokenDto } from './dtos/refresh-token.dto';
import { AuthResponseDto } from './dtos/auth-response.dto';
import { UserPublicDto } from './dtos/user-public.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User } from '../users/entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto): Promise<AuthResponseDto> {
    return this.authService.signup(dto);
  }

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Req() req: Request & { user: User }): AuthResponseDto {
    return this.authService.login(req.user);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto): Promise<TokenPair> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() payload: JwtPayload): Promise<UserPublicDto> {
    return this.authService.me(payload.sub);
  }
}
