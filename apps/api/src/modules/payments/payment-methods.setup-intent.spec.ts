import 'reflect-metadata';
import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EMAIL_NOT_VERIFIED } from '../auth/email-verification.exceptions';
import { UsersRepository } from '../users/users.repository';
import { StripeService } from '../stripe-connect/stripe.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodRepository } from './repositories/payment-method.repository';

/**
 * L3b-B — `POST /payment-methods/setup-intent` requires a confirmed address.
 * The REAL service runs against a recording Stripe double: an unconfirmed
 * caller must reach neither Stripe nor the `stripe_customer_id` write.
 */
const USER = '6b0c3a0e-1111-4c3e-9d77-000000000001';
const fakeJwt: CanActivate = {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().user = { sub: USER, email: 'x@linkr.test', type: 'access' };
    return true;
  },
};

describe('L3b-B — POST /payment-methods/setup-intent', () => {
  let app: INestApplication;
  let verified: Date | null = null;
  const customersCreate = jest.fn(async () => ({ id: 'cus_test' }));
  const setupIntentsCreate = jest.fn(async () => ({ id: 'seti_test', client_secret: 'seti_secret' }));
  const setStripeCustomerId = jest.fn(async () => undefined);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentMethodsController],
      providers: [
        PaymentMethodsService,
        { provide: APP_GUARD, useValue: fakeJwt },
        {
          provide: StripeService,
          useValue: {
            envLabel: 'test',
            client: { customers: { create: customersCreate }, setupIntents: { create: setupIntentsCreate } },
          },
        },
        { provide: PaymentMethodRepository, useValue: {} },
        {
          provide: UsersRepository,
          useValue: {
            findById: jest.fn(async () => ({
              id: USER,
              email: 'x@linkr.test',
              firstName: 'A',
              lastName: 'B',
              stripeCustomerId: null,
              emailVerifiedAtUtc: verified,
            })),
            setStripeCustomerId,
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('unconfirmed → 403 EMAIL_NOT_VERIFIED, Stripe never called, no customer id written', async () => {
    verified = null;
    const res = await request(app.getHttpServer()).post('/payment-methods/setup-intent');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(EMAIL_NOT_VERIFIED);
    expect(customersCreate).not.toHaveBeenCalled();
    expect(setupIntentsCreate).not.toHaveBeenCalled();
    expect(setStripeCustomerId).not.toHaveBeenCalled();
  });

  it('confirmed → unchanged: customer and SetupIntent created', async () => {
    verified = new Date();
    const res = await request(app.getHttpServer()).post('/payment-methods/setup-intent');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ clientSecret: 'seti_secret' });
    expect(customersCreate).toHaveBeenCalledTimes(1);
    expect(setupIntentsCreate).toHaveBeenCalledTimes(1);
    expect(setStripeCustomerId).toHaveBeenCalledWith(USER, 'cus_test');
  });
});
