import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true preserves the unparsed request body on `req.rawBody` (used by
  // the Stripe webhook for signature verification) while leaving normal JSON
  // body parsing intact for every other route.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('PORT');
  const env = configService.getOrThrow<string>('NODE_ENV');

  // Who may be believed about the real caller's address (chantier B).
  //
  // ⚠️ THE HEADER IS BELIEVED ONLY WHEN THE PEER IS ON THE LIST; OFF THE LIST WE
  // FALL BACK TO THE TCP PEER — FAILING CLOSED. Express walks `X-Forwarded-For`
  // from the socket peer outwards and stops at the first address this list does
  // not cover, so an `X-Forwarded-For` from an untrusted peer changes nothing.
  // Worst case is the shared bucket we had before, never a caller who grants
  // themselves a fresh budget by writing a header.
  //
  // Express splits and trims the comma-separated string itself
  // (`compileTrust` → `proxy-addr`), so it is passed through verbatim.
  //
  // ⚠️ NOTHING ELSE READS A FORWARDING HEADER. `RateLimitGuard` reads
  // `request.ip` and only `request.ip`; this one line is what makes that value
  // mean the visitor rather than the web tier. Resolving the caller by hand
  // anywhere else would be a second, weaker copy of this rule.
  app.set('trust proxy', configService.getOrThrow<string>('TRUSTED_PROXY_IPS'));

  if (env !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Linkr API')
      .setDescription('Linkr REST API — Phase 3.6+')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port);

  Logger.log(
    `🚀 Linkr API listening on port ${port} (env: ${env})`,
    'Bootstrap',
  );
}

bootstrap();
