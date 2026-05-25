import { UserPublicDto } from './user-public.dto';

export class AuthResponseDto {
  accessToken!: string;
  refreshToken!: string;
  user!: UserPublicDto;
}
