import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import { AttachmentsService } from './attachments.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('fs');

const mockPrisma = {
  projectAttachment: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
  },
};

const mockedFs = fs as jest.Mocked<typeof fs>;

function makeRow(over: Partial<any> = {}) {
  return {
    id: 'a1', projectId: 'p1', uploadedByUserId: 'u1',
    fileName: 'doc.pdf', fileExtension: '.pdf', contentType: 'application/pdf',
    fileSize: BigInt(1024), storagePath: '/tmp/p1/aaa.pdf',
    description: null, category: 'Document', uploadedAt: new Date(),
    uploadedBy: { firstName: 'A', lastName: 'B' },
    isDeleted: false,
    ...over,
  };
}

describe('AttachmentsService', () => {
  let service: AttachmentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttachmentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AttachmentsService);
  });

  describe('getProjectAttachments', () => {
    it('returns mapped DTO list', async () => {
      mockPrisma.projectAttachment.findMany.mockResolvedValue([makeRow()]);
      const r = await service.getProjectAttachments('p1');
      expect(r.isSuccess).toBe(true);
      expect(r.value![0]).toEqual(expect.objectContaining({
        id: 'a1', fileName: 'doc.pdf', uploadedByUserName: 'A B', fileSize: 1024,
        downloadUrl: '/api/projects/p1/attachments/a1/download',
      }));
    });
  });

  describe('getById', () => {
    it('returns the row', async () => {
      mockPrisma.projectAttachment.findFirst.mockResolvedValue(makeRow());
      const r = await service.getById('a1');
      expect(r.isSuccess).toBe(true);
    });
    it('fails when not found', async () => {
      mockPrisma.projectAttachment.findFirst.mockResolvedValue(null);
      const r = await service.getById('missing');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Pièce jointe non trouvée.');
    });
  });

  describe('upload', () => {
    beforeEach(() => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.mkdirSync.mockReturnValue(undefined);
      mockedFs.writeFileSync.mockReturnValue(undefined);
    });

    it('rejects oversized files', async () => {
      const big = Buffer.alloc(11 * 1024 * 1024).toString('base64');
      const r = await service.upload('p1', 'u1', {
        base64Content: big, fileName: 'big.pdf', contentType: 'application/pdf',
      });
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/trop volumineux/);
    });

    it('rejects disallowed extensions', async () => {
      const r = await service.upload('p1', 'u1', {
        base64Content: Buffer.from('x').toString('base64'),
        fileName: 'script.exe',
        contentType: 'application/octet-stream',
      });
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/Extension/);
    });

    it('creates upload dir when missing then writes the file + DB row', async () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockPrisma.projectAttachment.create.mockResolvedValue(makeRow());
      const r = await service.upload('p1', 'u1', {
        base64Content: Buffer.from('hello').toString('base64'),
        fileName: 'a.pdf',
        contentType: 'application/pdf',
      });
      expect(r.isSuccess).toBe(true);
      expect(mockedFs.mkdirSync).toHaveBeenCalled();
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
      expect(mockPrisma.projectAttachment.create).toHaveBeenCalled();
    });

    it('writes default category=Document and null description when missing', async () => {
      mockPrisma.projectAttachment.create.mockResolvedValue(makeRow());
      await service.upload('p1', 'u1', {
        base64Content: Buffer.from('x').toString('base64'),
        fileName: 'a.pdf',
        contentType: 'application/pdf',
      });
      const arg = mockPrisma.projectAttachment.create.mock.calls[0][0];
      expect(arg.data.description).toBeNull();
      expect(arg.data.category).toBe('Document');
    });
  });

  describe('updateMetadata', () => {
    it('happy path', async () => {
      mockPrisma.projectAttachment.findFirst.mockResolvedValue(makeRow());
      mockPrisma.projectAttachment.update.mockResolvedValue(makeRow({ description: 'new' }));
      const r = await service.updateMetadata('a1', { description: 'new' });
      expect(r.isSuccess).toBe(true);
    });

    it('fails when not found', async () => {
      mockPrisma.projectAttachment.findFirst.mockResolvedValue(null);
      const r = await service.updateMetadata('missing', {});
      expect(r.isFailure).toBe(true);
    });
  });

  describe('deleteAttachment', () => {
    it('soft-deletes via update', async () => {
      mockPrisma.projectAttachment.findFirst.mockResolvedValue(makeRow());
      mockPrisma.projectAttachment.update.mockResolvedValue({});
      const r = await service.deleteAttachment('a1');
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.projectAttachment.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { isDeleted: true },
      });
    });

    it('fails when not found', async () => {
      mockPrisma.projectAttachment.findFirst.mockResolvedValue(null);
      const r = await service.deleteAttachment('missing');
      expect(r.isFailure).toBe(true);
    });
  });

  describe('download', () => {
    it('returns content + safe contentType', async () => {
      mockPrisma.projectAttachment.findFirst.mockResolvedValue(makeRow());
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(Buffer.from('hi'));
      const r = await service.download('a1');
      expect(r.isSuccess).toBe(true);
      expect(r.value.contentType).toBe('application/pdf');
    });

    it('falls back to octet-stream for an unsafe stored contentType', async () => {
      mockPrisma.projectAttachment.findFirst.mockResolvedValue(makeRow({ contentType: 'text/html' }));
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(Buffer.from('hi'));
      const r = await service.download('a1');
      expect(r.isSuccess).toBe(true);
      expect(r.value.contentType).toBe('application/octet-stream');
    });

    it('fails when DB row missing', async () => {
      mockPrisma.projectAttachment.findFirst.mockResolvedValue(null);
      const r = await service.download('missing');
      expect(r.isFailure).toBe(true);
    });

    it('fails when file missing on disk', async () => {
      mockPrisma.projectAttachment.findFirst.mockResolvedValue(makeRow());
      mockedFs.existsSync.mockReturnValue(false);
      const r = await service.download('a1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/disque/);
    });
  });

  describe('getTotalStorage', () => {
    it('formats 0 bytes', async () => {
      mockPrisma.projectAttachment.aggregate.mockResolvedValue({ _sum: { fileSize: null } });
      const r = await service.getTotalStorage();
      expect(r.value).toEqual({ bytes: 0, formatted: '0 B' });
    });
    it('formats KB / MB / GB', async () => {
      mockPrisma.projectAttachment.aggregate.mockResolvedValue({ _sum: { fileSize: BigInt(1024 * 1024 * 2) } });
      const r = await service.getTotalStorage();
      expect(r.value!.formatted).toMatch(/MB/);
    });
  });
});
