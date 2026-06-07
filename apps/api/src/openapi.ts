import { writeFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

/**
 * Emits apps/api/openapi.json from the live Nest application metadata.
 *
 * The Swagger config mirrors main.ts. NestFactory.create() initializes every
 * module (no HTTP listener is started), so the same env the app needs is
 * required — DATABASE_URL / REDIS_URL / JWT_* etc.
 *
 * Run with: pnpm --filter @linkr/api openapi:generate
 */
async function generateOpenapi(): Promise<void> {
  const logger = new Logger('OpenApi');
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Linkr API')
    .setDescription('Linkr REST API — Phase 3.6+')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outPath = join(__dirname, '..', 'openapi.json');
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);

  await app.close();
  logger.log(`OpenAPI spec written to ${outPath}`);
}

generateOpenapi()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    new Logger('OpenApi').error(err);
    process.exit(1);
  });
