import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Enable shutdown hooks so onModuleDestroy lifecycle hooks are called
  app.enableShutdownHooks();

  const port = configService.get<number>('PORT', 3000);

  await app.listen(port, '127.0.0.1');
  console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();
