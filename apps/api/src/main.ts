import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

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
