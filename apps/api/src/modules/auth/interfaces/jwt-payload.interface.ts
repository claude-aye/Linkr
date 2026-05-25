import { TokenType } from '../enums/token-type.enum';

export interface JwtPayload {
  sub: string;
  email: string;
  type: TokenType;
  iat?: number;
  exp?: number;
}
