/**
 * Local mirrors of the backend auth DTOs.
 *
 * The API's OpenAPI spec ships the auth endpoints WITHOUT body/response schemas
 * (the `@nestjs/swagger` DTOs are empty), so the generated `@linkr/api-client`
 * types resolve to `never` for `/auth/login` and `/auth/me`. These interfaces
 * mirror the real backend DTOs so the BFF stays fully typed.
 *
 * Source of truth: apps/api/src/modules/auth/dtos/{auth-response,user-public}.dto.ts
 */

/** Mirror of users `verification_level` enum (progressive KYC state machine). */
export type VerificationLevel = 'NONE' | 'EMAIL' | 'PHONE' | 'IDENTITY';

/**
 * Mirror of `UserPublicDto`. Note: `createdAtUtc` is a `Date` server-side but is
 * serialized to an ISO-8601 string once it crosses the JSON boundary.
 */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  avatarUrl: string | null;
  languagePreference: string;
  countryCode: string;
  subdivisionCode: string;
  preferredCurrency: string;
  verificationLevel: VerificationLevel;
  createdAtUtc: string;
}

/** Mirror of `AuthResponseDto` returned by `POST /auth/login`. */
export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}
