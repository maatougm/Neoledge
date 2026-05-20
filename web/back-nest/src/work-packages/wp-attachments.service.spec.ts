import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { WpAttachmentsService } from './wp-attachments.service';
import { PrismaService } from '../prisma/prisma.service';

// fs is touched on the upload path. Mock the two operations the service actually calls.
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(async () => undefined),
    writeFile: jest.fn(async () => undefined),
  },
}));

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

const mockPrisma = {
  workPackage: {
    findUnique: jest.fn(),
  },
  workPackageAttachment: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  projectMember: {
    findFirst: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockedFs = fs as unknown as { mkdir: jest.Mock; writeFile: jest.Mock };

function makeWp(overrides: Partial<{ id: string; isDeleted: boolean; projectId: string; projectManagerId: string | null; projectIsDeleted: boolean }> = {}) {
  return {
    id: overrides.id ?? 'wp-1',
    isDeleted: overrides.isDeleted ?? false,
    projectId: overrides.projectId ?? 'proj-1',
    project: {
      projectManagerId: overrides.projectManagerId ?? 'pm-1',
      isDeleted: overrides.projectIsDeleted ?? false,
    },
  };
}

function makeAttachmentRow(overrides: Partial<{
  id: string;
  workPackageId: string;
  uploadedByUserId: string;
  fileName: string;
  contentType: string;
  fileSize: bigint;
  storagePath: string;
  uploadedAt: Date;
  isDeleted: boolean;
  uploadedBy: { firstName: string; lastName: string };
  workPackage?: { project: { projectManagerId: string | null } };
}> = {}) {
  return {
    id: overrides.id ?? 'att-1',
    workPackageId: overrides.workPackageId ?? 'wp-1',
    uploadedByUserId: overrides.uploadedByUserId ?? 'user-1',
    fileName: overrides.fileName ?? 'doc.pdf',
    contentType: overrides.contentType ?? 'application/pdf',
    fileSize: overrides.fileSize ?? BigInt(1234),
    storagePath: overrides.storagePath ?? 'abc-uuid__doc.pdf',
    uploadedAt: overrides.uploadedAt ?? new Date('2026-01-01T00:00:00Z'),
    isDeleted: overrides.isDeleted ?? false,
    uploadedBy: overrides.uploadedBy ?? { firstName: 'Alice', lastName: 'Smith' },
    workPackage: overrides.workPackage,
  };
}

function makeFile(overrides: Partial<{ buffer: Buffer; originalname: string; mimetype: string; size: number }> = {}) {
  return {
    buffer: overrides.buffer ?? Buffer.from('hello-world'),
    originalname: overrides.originalname ?? 'doc.pdf',
    mimetype: overrides.mimetype ?? 'application/pdf',
    size: overrides.size ?? 11,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WpAttachmentsService', () => {
  let service: WpAttachmentsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WpAttachmentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WpAttachmentsService>(WpAttachmentsService);
  });

  // ── assertWpProjectAccess (private) — exercised through every public method ──

  describe('access control (project membership gate)', () => {
    it('returns 404 when WP does not exist', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue(null);
      await expect(service.list('wp-missing', 'user-1', 'Member')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 when WP is soft-deleted', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp({ isDeleted: true }));
      await expect(service.list('wp-1', 'user-1', 'Member')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 when project is soft-deleted', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp({ projectIsDeleted: true }));
      await expect(service.list('wp-1', 'user-1', 'Member')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('admin bypasses membership check', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp({ projectManagerId: 'other-pm' }));
      mockPrisma.workPackageAttachment.findMany.mockResolvedValue([]);

      await expect(service.list('wp-1', 'random-admin', 'Admin')).resolves.toEqual([]);
      // The membership lookup should NOT have been called for an admin.
      expect(mockPrisma.projectMember.findFirst).not.toHaveBeenCalled();
    });

    it('PM of the project is allowed (no membership row needed)', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp({ projectManagerId: 'pm-self' }));
      mockPrisma.workPackageAttachment.findMany.mockResolvedValue([]);

      await expect(service.list('wp-1', 'pm-self', 'ProjectManager')).resolves.toEqual([]);
      expect(mockPrisma.projectMember.findFirst).not.toHaveBeenCalled();
    });

    it('non-member non-PM non-Admin is rejected with 404 (no existence leak)', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp({ projectManagerId: 'someone-else' }));
      mockPrisma.projectMember.findFirst.mockResolvedValue(null);

      await expect(service.list('wp-1', 'random-user', 'Member')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('regular Member who is in ProjectMember passes', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp({ projectManagerId: 'someone-else' }));
      mockPrisma.projectMember.findFirst.mockResolvedValue({ id: 'pm-row' });
      mockPrisma.workPackageAttachment.findMany.mockResolvedValue([]);

      await expect(service.list('wp-1', 'real-member', 'Member')).resolves.toEqual([]);
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns mapped rows ordered by service contract (orderBy: uploadedAt desc)', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp());
      mockPrisma.workPackageAttachment.findMany.mockResolvedValue([
        makeAttachmentRow({ id: 'a1', fileName: 'f1.pdf', uploadedBy: { firstName: 'Bob', lastName: 'Doe' } }),
        makeAttachmentRow({ id: 'a2', fileName: 'f2.pdf' }),
      ]);

      const rows = await service.list('wp-1', 'pm-1', 'ProjectManager');

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        id: 'a1',
        fileName: 'f1.pdf',
        contentType: 'application/pdf',
        fileSize: 1234,
        uploadedByName: 'Bob Doe',
      });
      // BigInt → Number coercion verified.
      expect(typeof rows[0].fileSize).toBe('number');
      // Filter clause is scoped to non-deleted only.
      expect(mockPrisma.workPackageAttachment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workPackageId: 'wp-1', isDeleted: false },
          orderBy: { uploadedAt: 'desc' },
        }),
      );
    });
  });

  // ── upload ────────────────────────────────────────────────────────────────

  describe('upload()', () => {
    beforeEach(() => {
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp());
      mockPrisma.workPackageAttachment.create.mockResolvedValue(
        makeAttachmentRow({
          id: 'new-att',
          fileName: 'doc.pdf',
          fileSize: BigInt(11),
        }),
      );
    });

    it('rejects when no file buffer is provided', async () => {
      await expect(
        service.upload('wp-1', 'pm-1', 'ProjectManager', { buffer: Buffer.alloc(0), originalname: 'x', mimetype: 'application/pdf', size: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects disallowed MIME types', async () => {
      await expect(
        service.upload('wp-1', 'pm-1', 'ProjectManager', makeFile({ mimetype: 'application/x-exe' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('writes file then creates DB row, returns mapped attachment', async () => {
      const row = await service.upload('wp-1', 'pm-1', 'ProjectManager', makeFile());

      // fs write happened.
      expect(mockedFs.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(mockedFs.writeFile).toHaveBeenCalledWith(expect.stringMatching(/__doc\.pdf$/), expect.any(Buffer));

      // Prisma row created with sanitised file name + bigint size.
      expect(mockPrisma.workPackageAttachment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workPackageId: 'wp-1',
            uploadedByUserId: 'pm-1',
            fileName: 'doc.pdf',
            contentType: 'application/pdf',
            fileSize: BigInt(11),
            storagePath: expect.stringMatching(/^[a-f0-9-]{36}__doc\.pdf$/i),
          }),
        }),
      );

      expect(row).toMatchObject({
        id: 'new-att',
        fileName: 'doc.pdf',
        fileSize: 11,
      });
    });

    it('sanitises dangerous characters out of the original filename', async () => {
      await service.upload('wp-1', 'pm-1', 'ProjectManager', makeFile({ originalname: '../../etc/passwd.pdf' }));

      expect(mockPrisma.workPackageAttachment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            // ../ stripped to _.._.._; only \w . - survive.
            fileName: expect.not.stringMatching(/\//),
          }),
        }),
      );
    });

    it('caps filename length to 200 chars', async () => {
      const longName = 'a'.repeat(300) + '.pdf';
      await service.upload('wp-1', 'pm-1', 'ProjectManager', makeFile({ originalname: longName }));

      const call = mockPrisma.workPackageAttachment.create.mock.calls[0][0] as { data: { fileName: string } };
      expect(call.data.fileName.length).toBeLessThanOrEqual(200);
    });

    it('returns 404 when WP becomes missing between access check and findUnique', async () => {
      // First call (assertWpProjectAccess) returns the WP, second call returns null.
      mockPrisma.workPackage.findUnique
        .mockResolvedValueOnce(makeWp())
        .mockResolvedValueOnce(null);

      await expect(
        service.upload('wp-1', 'pm-1', 'ProjectManager', makeFile()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── getDownload ───────────────────────────────────────────────────────────

  describe('getDownload()', () => {
    it('returns 404 when attachment does not exist', async () => {
      mockPrisma.workPackageAttachment.findUnique.mockResolvedValue(null);

      await expect(service.getDownload('att-missing', 'pm-1', 'ProjectManager')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 when attachment is soft-deleted', async () => {
      mockPrisma.workPackageAttachment.findUnique.mockResolvedValue(makeAttachmentRow({ isDeleted: true }));

      await expect(service.getDownload('att-1', 'pm-1', 'ProjectManager')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('runs the project-access gate even when the attachment exists (IDOR defence)', async () => {
      mockPrisma.workPackageAttachment.findUnique.mockResolvedValue(makeAttachmentRow());
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp({ projectManagerId: 'someone-else' }));
      mockPrisma.projectMember.findFirst.mockResolvedValue(null);

      await expect(service.getDownload('att-1', 'random', 'Member')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns absolute path + metadata on success', async () => {
      mockPrisma.workPackageAttachment.findUnique.mockResolvedValue(
        makeAttachmentRow({ storagePath: 'abc-uuid__doc.pdf', fileName: 'doc.pdf', contentType: 'application/pdf' }),
      );
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp());

      const out = await service.getDownload('att-1', 'pm-1', 'ProjectManager');

      expect(out).toEqual(
        expect.objectContaining({
          fileName: 'doc.pdf',
          contentType: 'application/pdf',
          absolutePath: expect.stringContaining('abc-uuid__doc.pdf'),
        }),
      );
    });

    it('blocks path-traversal attempts via a poisoned storagePath', async () => {
      // A stored path that, after path.join, escapes STORAGE_ROOT.
      mockPrisma.workPackageAttachment.findUnique.mockResolvedValue(
        makeAttachmentRow({ storagePath: '../../etc/passwd' }),
      );
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp());

      await expect(service.getDownload('att-1', 'pm-1', 'ProjectManager')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── softDelete ────────────────────────────────────────────────────────────

  describe('softDelete()', () => {
    it('returns 404 when attachment does not exist', async () => {
      mockPrisma.workPackageAttachment.findUnique.mockResolvedValue(null);

      await expect(service.softDelete('att-missing', 'pm-1', 'ProjectManager')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 when attachment is already soft-deleted', async () => {
      mockPrisma.workPackageAttachment.findUnique.mockResolvedValue(makeAttachmentRow({ isDeleted: true }));

      await expect(service.softDelete('att-1', 'pm-1', 'ProjectManager')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('forbids non-uploader non-PM members', async () => {
      mockPrisma.workPackageAttachment.findUnique.mockResolvedValue(
        makeAttachmentRow({
          uploadedByUserId: 'someone-else',
          workPackage: { project: { projectManagerId: 'pm-1' } },
        }),
      );
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp({ projectManagerId: 'pm-1' }));
      mockPrisma.projectMember.findFirst.mockResolvedValue({ id: 'pm-row' }); // membership passes

      await expect(service.softDelete('att-1', 'random-member', 'Member')).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.workPackageAttachment.update).not.toHaveBeenCalled();
    });

    it('allows the uploader to soft-delete', async () => {
      mockPrisma.workPackageAttachment.findUnique.mockResolvedValue(
        makeAttachmentRow({
          uploadedByUserId: 'uploader-self',
          workPackage: { project: { projectManagerId: 'pm-1' } },
        }),
      );
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp({ projectManagerId: 'pm-1' }));
      mockPrisma.projectMember.findFirst.mockResolvedValue({ id: 'pm-row' });

      await service.softDelete('att-1', 'uploader-self', 'Member');

      expect(mockPrisma.workPackageAttachment.update).toHaveBeenCalledWith({
        where: { id: 'att-1' },
        data: { isDeleted: true },
      });
    });

    it('allows the project PM to soft-delete even if not the uploader', async () => {
      mockPrisma.workPackageAttachment.findUnique.mockResolvedValue(
        makeAttachmentRow({
          uploadedByUserId: 'someone-else',
          workPackage: { project: { projectManagerId: 'pm-self' } },
        }),
      );
      mockPrisma.workPackage.findUnique.mockResolvedValue(makeWp({ projectManagerId: 'pm-self' }));

      await service.softDelete('att-1', 'pm-self', 'ProjectManager');

      expect(mockPrisma.workPackageAttachment.update).toHaveBeenCalledWith({
        where: { id: 'att-1' },
        data: { isDeleted: true },
      });
    });
  });
});
