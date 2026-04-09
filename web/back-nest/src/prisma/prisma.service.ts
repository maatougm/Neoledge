import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// PrismaService is created via async factory in PrismaModule —
// this class exists only to carry the injection token.
@Injectable()
export class PrismaService extends PrismaClient {}
