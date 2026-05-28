import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { AuthProviderType } from './enums/auth-provider-type.enum';
import { User } from './entities/user.entity';
import { UserAuthProvider } from './entities/user-auth-provider.entity';

export interface CreateUserData {
  email: string;
  firstName: string;
  lastName: string;
  countryCode: string;
  subdivisionCode: string;
  preferredCurrency: string;
  phone?: string | null;
  displayName?: string | null;
  languagePreference?: string;
}

export interface UpdateUserProfileData {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  avatarUrl?: string;
  languagePreference?: string;
  countryCode?: string;
  subdivisionCode?: string;
  preferredCurrency?: string;
  defaultLocation?: { latitude: number; longitude: number };
}

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserAuthProvider)
    private readonly authProviderRepo: Repository<UserAuthProvider>,
    private readonly dataSource: DataSource,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email } });
  }

  findByPhone(phone: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { phone } });
  }

  findByEmailWithAuthProviders(email: string): Promise<User | null> {
    return this.userRepo.findOne({
      where: { email },
      relations: { authProviders: true },
    });
  }

  findAuthProviderByProviderIdentity(
    providerType: AuthProviderType,
    providerUserId: string,
  ): Promise<UserAuthProvider | null> {
    return this.authProviderRepo.findOne({
      where: { providerType, providerUserId },
      relations: { user: true },
    });
  }

  async updateLastUsedAt(authProviderId: string): Promise<void> {
    await this.authProviderRepo.update(authProviderId, {
      lastUsedAtUtc: new Date(),
    });
  }

  async addAuthProvider(
    userId: string,
    providerType: AuthProviderType,
    providerUserId: string,
  ): Promise<void> {
    const provider = this.authProviderRepo.create({
      userId,
      providerType,
      providerUserId,
      passwordHash: null,
    });
    await this.authProviderRepo.save(provider);
  }

  // Whitelisted profile update (load-modify-save so the PostGIS point round-trips).
  async updateProfile(
    userId: string,
    data: UpdateUserProfileData,
  ): Promise<User | null> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return null;

    if (data.firstName !== undefined) user.firstName = data.firstName;
    if (data.lastName !== undefined) user.lastName = data.lastName;
    if (data.displayName !== undefined) user.displayName = data.displayName;
    if (data.avatarUrl !== undefined) user.avatarUrl = data.avatarUrl;
    if (data.languagePreference !== undefined)
      user.languagePreference = data.languagePreference;
    if (data.countryCode !== undefined) user.countryCode = data.countryCode;
    if (data.subdivisionCode !== undefined)
      user.subdivisionCode = data.subdivisionCode;
    if (data.preferredCurrency !== undefined)
      user.preferredCurrency = data.preferredCurrency;
    if (data.defaultLocation !== undefined) {
      user.defaultLocation = {
        type: 'Point',
        coordinates: [
          data.defaultLocation.longitude,
          data.defaultLocation.latitude,
        ],
      };
    }

    return this.userRepo.save(user);
  }

  // Org IDs where this user is the only active OWNER (blocks account deletion).
  async findOrgIdsWhereUserIsLastActiveOwner(
    userId: string,
  ): Promise<string[]> {
    const rows: Array<{ organization_id: string }> = await this.dataSource.query(
      `
      SELECT m.organization_id
      FROM organization_memberships m
      WHERE m.user_id = $1
        AND m.role = 'OWNER'
        AND m.is_active = true
        AND m.left_at_utc IS NULL
        AND (
          SELECT COUNT(*)
          FROM organization_memberships m2
          WHERE m2.organization_id = m.organization_id
            AND m2.role = 'OWNER'
            AND m2.is_active = true
            AND m2.left_at_utc IS NULL
        ) = 1
      `,
      [userId],
    );
    return rows.map((r) => r.organization_id);
  }

  // Soft-delete the user and deactivate their active memberships, atomically.
  async softDeleteUserWithMembershipCascade(userId: string): Promise<void> {
    const qr: QueryRunner = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(`UPDATE users SET deleted_at_utc = NOW() WHERE id = $1`, [
        userId,
      ]);
      await qr.query(
        `UPDATE organization_memberships
         SET left_at_utc = NOW(), is_active = false
         WHERE user_id = $1 AND left_at_utc IS NULL`,
        [userId],
      );
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  async createWithEmailPassword(
    userData: CreateUserData,
    passwordHash: string,
  ): Promise<User> {
    const qr: QueryRunner = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const user = qr.manager.create(User, {
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        countryCode: userData.countryCode,
        subdivisionCode: userData.subdivisionCode,
        preferredCurrency: userData.preferredCurrency,
        phone: userData.phone ?? null,
        displayName: userData.displayName ?? null,
        languagePreference: userData.languagePreference ?? 'fr-CA',
      });
      const savedUser = await qr.manager.save(User, user);

      const authProvider = qr.manager.create(UserAuthProvider, {
        userId: savedUser.id,
        providerType: AuthProviderType.EMAIL_PASSWORD,
        passwordHash,
        providerUserId: null,
      });
      await qr.manager.save(UserAuthProvider, authProvider);

      await qr.commitTransaction();
      return savedUser;
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  async createWithOAuthProvider(
    userData: CreateUserData,
    providerType: AuthProviderType,
    providerUserId: string,
  ): Promise<User> {
    const qr: QueryRunner = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const user = qr.manager.create(User, {
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        countryCode: userData.countryCode,
        subdivisionCode: userData.subdivisionCode,
        preferredCurrency: userData.preferredCurrency,
        phone: userData.phone ?? null,
        displayName: userData.displayName ?? null,
        languagePreference: userData.languagePreference ?? 'fr-CA',
      });
      const savedUser = await qr.manager.save(User, user);

      const authProvider = qr.manager.create(UserAuthProvider, {
        userId: savedUser.id,
        providerType,
        providerUserId,
        passwordHash: null,
      });
      await qr.manager.save(UserAuthProvider, authProvider);

      await qr.commitTransaction();
      return savedUser;
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }
}
