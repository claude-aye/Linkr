import { RefundsService } from './refunds.service';
import { RefundChargeFailedException } from './exceptions/payments.exceptions';
import { PaymentStatus } from './enums/payment-status.enum';
import { PaymentType } from './enums/payment-type.enum';
import { RefundStatus } from './enums/refund-status.enum';
import { PaymentRecord } from './repositories/payment.repository';
import { RefundRecord } from './repositories/refund.repository';

/**
 * Resilience tests for the admin refund flow (3.10c fix): a transient Stripe
 * connection error must NOT mark the row FAILED (it may have processed), and a
 * `charge_already_refunded` rejection must reconcile our PENDING row to the real
 * Stripe refund instead of losing it behind a FAILED row.
 */
/** A realistic Stripe SDK error: an Error instance with `type`/`code` attached. */
function stripeError(props: { type?: string; code?: string; message: string }): Error {
  const e = new Error(props.message) as Error & { type?: string; code?: string };
  e.type = props.type;
  e.code = props.code;
  return e;
}

describe('RefundsService.refundPayment — Stripe error resilience', () => {
  const PI = 'pi_test_1';

  const basePayment: PaymentRecord = {
    id: 'pay-1',
    serviceRequestId: 'req-1',
    paymentType: PaymentType.BALANCE,
    payerUserId: 'user-1',
    payerOrganizationId: null,
    recipientServiceProviderId: 'prov-1',
    paymentMethodId: 'pm-1',
    stripePaymentIntentId: PI,
    status: PaymentStatus.SUCCEEDED,
    grossAmount: '80.00',
    currency: 'CAD',
    commissionRatePercent: '10.00',
    platformFeeAmount: '8.00',
    taxAmount: '0.00',
    providerNetAmount: '72.00',
    capturedAtUtc: new Date(),
    failedAtUtc: null,
    failureReason: null,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
  };

  const pendingRefund: RefundRecord = {
    id: 'refund-1',
    paymentId: 'pay-1',
    amount: '80.00',
    currency: 'CAD',
    reason: 'test',
    initiatedByUserId: 'admin-1',
    status: RefundStatus.PENDING,
    stripeRefundId: null,
    failureReason: null,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
  };

  let stripeCreate: jest.Mock;
  let stripeList: jest.Mock;
  let refundRepo: {
    create: jest.Mock;
    findById: jest.Mock;
    findByStripeRefundId: jest.Mock;
    sumInFlightByPaymentId: jest.Mock;
    sumSucceededByPaymentId: jest.Mock;
    attachStripe: jest.Mock;
    markFailed: jest.Mock;
  };
  let paymentRepo: {
    findById: jest.Mock;
    findByServiceRequestId: jest.Mock;
    applyRefundDerivedStatus: jest.Mock;
  };
  let service: RefundsService;

  beforeEach(() => {
    stripeCreate = jest.fn();
    stripeList = jest.fn();
    refundRepo = {
      create: jest.fn().mockResolvedValue({ ...pendingRefund }),
      findById: jest.fn().mockResolvedValue({ ...pendingRefund }),
      findByStripeRefundId: jest.fn().mockResolvedValue(null),
      sumInFlightByPaymentId: jest.fn().mockResolvedValue('0'),
      sumSucceededByPaymentId: jest.fn().mockResolvedValue('80.00'),
      attachStripe: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    paymentRepo = {
      findById: jest.fn().mockResolvedValue({ ...basePayment }),
      findByServiceRequestId: jest.fn().mockResolvedValue([{ ...basePayment }]),
      applyRefundDerivedStatus: jest.fn().mockResolvedValue(null),
    };

    const stripe = { client: { refunds: { create: stripeCreate, list: stripeList } } };
    service = new RefundsService(
      stripe as never,
      refundRepo as never,
      paymentRepo as never,
    );
  });

  const dto = { amount: 80, reason: 'test' };

  it('leaves the row PENDING (no FAILED) on a transient connection error and surfaces 502', async () => {
    stripeCreate.mockRejectedValue(
      stripeError({
        type: 'StripeConnectionError',
        message: 'An error occurred with our connection to Stripe. ECONNRESET',
      }),
    );

    await expect(service.refundPayment('pay-1', dto, 'admin-1')).rejects.toBeInstanceOf(
      RefundChargeFailedException,
    );

    // The refund MAY have processed at Stripe → must NOT be marked FAILED, and
    // no Stripe id is attached (row stays exactly PENDING for retry/webhook).
    expect(refundRepo.markFailed).not.toHaveBeenCalled();
    expect(refundRepo.attachStripe).not.toHaveBeenCalled();
  });

  it('reconciles the PENDING row to the existing Stripe refund on charge_already_refunded', async () => {
    stripeCreate.mockRejectedValue(
      stripeError({
        type: 'StripeInvalidRequestError',
        code: 'charge_already_refunded',
        message: 'Charge ch_1 has already been refunded.',
      }),
    );
    stripeList.mockResolvedValue({
      data: [{ id: 're_existing', status: 'succeeded', amount: 8000 }],
    });
    // After reconcile, the row reads back linked + SUCCEEDED.
    refundRepo.findById.mockResolvedValue({
      ...pendingRefund,
      status: RefundStatus.SUCCEEDED,
      stripeRefundId: 're_existing',
    });

    const result = await service.refundPayment('pay-1', dto, 'admin-1');

    expect(stripeList).toHaveBeenCalledWith({ payment_intent: PI, limit: 100 });
    expect(refundRepo.attachStripe).toHaveBeenCalledWith(
      'refund-1',
      're_existing',
      RefundStatus.SUCCEEDED,
    );
    expect(refundRepo.markFailed).not.toHaveBeenCalled();
    expect(result.stripeRefundId).toBe('re_existing');
    expect(result.status).toBe(RefundStatus.SUCCEEDED);
  });

  it('marks the row FAILED on a definitive invalid-request error', async () => {
    stripeCreate.mockRejectedValue(
      stripeError({
        type: 'StripeInvalidRequestError',
        code: 'parameter_invalid_integer',
        message: 'Invalid amount',
      }),
    );

    await expect(service.refundPayment('pay-1', dto, 'admin-1')).rejects.toBeInstanceOf(
      RefundChargeFailedException,
    );
    expect(refundRepo.markFailed).toHaveBeenCalledWith('refund-1', 'Invalid amount');
    expect(refundRepo.attachStripe).not.toHaveBeenCalled();
  });

  it('persists the Stripe refund id immediately on a successful create', async () => {
    stripeCreate.mockResolvedValue({ id: 're_ok', status: 'succeeded' });
    refundRepo.findById.mockResolvedValue({
      ...pendingRefund,
      status: RefundStatus.SUCCEEDED,
      stripeRefundId: 're_ok',
    });

    const result = await service.refundPayment('pay-1', dto, 'admin-1');

    expect(refundRepo.attachStripe).toHaveBeenCalledWith(
      'refund-1',
      're_ok',
      RefundStatus.SUCCEEDED,
    );
    expect(stripeList).not.toHaveBeenCalled();
    expect(refundRepo.markFailed).not.toHaveBeenCalled();
    expect(result.stripeRefundId).toBe('re_ok');
  });
});
