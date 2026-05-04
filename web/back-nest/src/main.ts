import 'dotenv/config';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

@Catch()
class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? (exception as HttpException).getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawMessage = isHttp
      ? (exception as HttpException).getResponse()
      : exception instanceof Error
        ? exception.message
        : 'Internal server error';

    const stack = exception instanceof Error ? exception.stack : undefined;
    const name = exception instanceof Error ? exception.name : 'Error';

    // Always log server-side (pino) with full detail
    this.logger.error(
      `[${request.method}] ${request.url} -> ${status} (${name}): ${
        typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage)
      }`,
      stack,
    );

    if (this.isProduction) {
      // Sanitised response — never leak stack, error name, or Prisma codes.
      // Whitelisted business fields are passed through verbatim so the UI
      // can act on them (e.g. `missingFields` for the AI driver-fields gate).
      let safeMessage = 'Internal server error';
      const passthrough: Record<string, unknown> = {};
      const PASSTHROUGH_KEYS = ['missingFields'];
      if (isHttp) {
        if (typeof rawMessage === 'string') {
          safeMessage = rawMessage;
        } else if (
          rawMessage !== null &&
          typeof rawMessage === 'object' &&
          'message' in rawMessage
        ) {
          const obj = rawMessage as Record<string, unknown>;
          const msg = obj.message;
          safeMessage = Array.isArray(msg)
            ? msg.map((m) => String(m)).join(', ')
            : String(msg);
          for (const k of PASSTHROUGH_KEYS) {
            if (k in obj) passthrough[k] = obj[k];
          }
        }
      }

      response.status(status).json({
        statusCode: status,
        message: safeMessage,
        ...passthrough,
      });
      return;
    }

    // Dev — verbose output for debugging
    response.status(status).json({
      statusCode: status,
      message: rawMessage,
      name,
      stack,
      path: request.url,
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.use(helmet());
  app.useLogger(app.get(PinoLogger));

  const configService = app.get(ConfigService);
  const isProduction =
    configService.get<string>('NODE_ENV') === 'production';

  // trust proxy (Express under the hood)
  (app.getHttpAdapter().getInstance() as unknown as {
    set: (key: string, value: unknown) => void;
  }).set('trust proxy', 1);

  // Global JSON / urlencoded body limits (multer handles multipart separately)
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter(isProduction));

  const allowedOrigins = (
    configService.get<string>('CORS_ORIGINS') ?? 'http://localhost:5173'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true });

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('NeoLeadge API')
      .setVersion('2.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api', app, document);
  }

  app.useWebSocketAdapter(new IoAdapter(app));

  app.enableShutdownHooks();

  const port = process.env.PORT || 5122;
  await app.listen(port);
}

bootstrap();
