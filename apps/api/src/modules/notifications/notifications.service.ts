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
}
