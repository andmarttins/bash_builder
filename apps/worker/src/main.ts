import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const context = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  context.enableShutdownHooks();
}

void bootstrap();

