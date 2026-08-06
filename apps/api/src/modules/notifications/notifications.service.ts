import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { NotificationsRepository } from './repositories/notifications.repository';
import { NotificationType } from './enums/notification-type.enum';
import { ServiceRequestRecord } from '../service-requests/repositories/service-request.repository';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly notificationsRepo: NotificationsRepository,
    private readonly providerRepo: ServiceProviderRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Broadcast a NEW_TENDER_MATCH notification to every provider eligible for
   * the given tender's location + category. Inserts in a single transaction.
   *
   * Called best-effort from ServiceRequestsService.create() — any error here
   * is logged and swallowed; it never propagates to the caller.
   */
  async broadcastTenderMatch(serviceRequest: ServiceRequestRecord): Promise<void> {
    // service_location is a GeoJSONPoint { coordinates: [lng, lat] }
    const [lng, lat] = serviceRequest.serviceLocation.coordinates;

    const eligibleIds = await this.providerRepo.findEligibleProviderIds(
      lng,
      lat,
      serviceRequest.serviceCategoryId,
    );

    if (eligibleIds.length === 0) {
      this.logger.log(
        `broadcastTenderMatch: no eligible providers for request ${serviceRequest.id}`,
      );
      return;
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      await this.notificationsRepo.insertBatch(
        eligibleIds.map((providerId) => ({
          recipientServiceProviderId: providerId,
          recipientUserId: null,
          type: NotificationType.NEW_TENDER_MATCH,
          serviceRequestId: serviceRequest.id,
          data: {
            serviceCategoryId: serviceRequest.serviceCategoryId,
            title: serviceRequest.title,
          },
        })),
        qr.manager,
      );
      await qr.commitTransaction();
      this.logger.log(
        `broadcastTenderMatch: inserted ${eligibleIds.length} notification(s) for request ${serviceRequest.id}`,
      );
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  /**
   * Notify the one provider a DIRECT_BOOKING was addressed to.
   *
   * Deliberately a separate path from {@link broadcastTenderMatch} rather than
   * a branch inside it: that method fans out geographically to every eligible
   * provider, which is precisely what a direct booking must not do. The client
   * chose this provider; nobody else is told.
   *
   * Called best-effort from ServiceRequestsService.create(), on the same terms
   * as the broadcast — this method reports failure by throwing, and the caller
   * logs and swallows it. A notification that fails never fails the request.
   */
  async notifyDirectBooking(serviceRequest: ServiceRequestRecord): Promise<void> {
    const providerId = serviceRequest.requestedServiceProviderId;

    // Guarded at the call site too; kept here so the method is safe on its own
    // terms and cannot write a row that violates the single-recipient CHECK.
    if (!providerId) {
      this.logger.warn(
        `notifyDirectBooking: request ${serviceRequest.id} has no requested provider — skipped`,
      );
      return;
    }

    // `data` stays empty: the recipient and the request are columns, and a
    // reader joins on them (see the SQL comment on notifications.data).
    await this.notificationsRepo.insertOne({
      recipientServiceProviderId: providerId,
      recipientUserId: null,
      type: NotificationType.NEW_DIRECT_BOOKING,
      serviceRequestId: serviceRequest.id,
      data: {},
    });

    this.logger.log(
      `notifyDirectBooking: notified provider ${providerId} of request ${serviceRequest.id}`,
    );
  }
}
