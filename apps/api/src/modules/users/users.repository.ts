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
