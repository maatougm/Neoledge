import { Test, TestingModule } from '@nestjs/testing';
import { ExportService } from './export.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  project: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  workPackage: {
    findMany: jest.fn(),
  },
};

function makeProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    name: 'My Project',
    clientName: 'ACME',
    status: 'Active',
    priority: 'Normal',
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-12-31T00:00:00Z'),
    createdAt: new Date('2026-01-15T00:00:00Z'),
    projectManager: { firstName: 'Alice', lastName: 'PM', email: 'alice@ex.com' },
    ...overrides,
  };
}

describe('ExportService', () => {
  let service: ExportService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ExportService>(ExportService);
  });

  // ── exportCsv ──────────────────────────────────────────────────────────────

  describe('exportCsv', () => {
    it('emits BOM + French header + semicolon-separated rows', async () => {
      mockPrisma.project.findMany.mockResolvedValueOnce([makeProject()]);

      const result = await service.exportCsv();

      expect(result.isSuccess).toBe(true);
      const payload = result.value as { content: string; contentType: string; fileName: string };
      expect(payload.content.startsWith('﻿')).toBe(true);
      expect(payload.content).toContain('Nom;Client;Chef de projet;Email PM;Statut;Priorité;Date début;Date fin;Créé le');
      expect(payload.content).toContain('My Project;ACME;Alice PM;alice@ex.com;Active;Normal;2026-01-01;2026-12-31;2026-01-15');
      expect(payload.contentType).toBe('text/csv; charset=utf-8');
      expect(payload.fileName).toMatch(/^projets-export-\d+\.csv$/);
    });

    it('quotes cells containing the ; separator, quotes, and newlines (RFC 4180)', async () => {
      mockPrisma.project.findMany.mockResolvedValueOnce([
        makeProject({
          name: 'ACME; Corp',
          clientName: 'has "quotes"',
          status: 'Active\nMulti',
        }),
      ]);

      const result = await service.exportCsv();
      const content = (result.value as { content: string }).content;

      // The separator is `;`, so a value containing `;` MUST be quoted or it
      // splits into two columns and shifts the rest of the row.
      expect(content).toContain('"ACME; Corp"');
      expect(content).toContain('"has ""quotes"""');
      expect(content).toMatch(/"Active\nMulti"/);
    });

    it('does NOT quote a bare comma — it is safe with a ; separator', async () => {
      mockPrisma.project.findMany.mockResolvedValueOnce([
        makeProject({ name: 'A, B' }),
      ]);

      const result = await service.exportCsv();
      const content = (result.value as { content: string }).content;

      // A comma is not the field separator, so the cell stays unquoted.
      expect(content).toContain('A, B;');
      expect(content).not.toContain('"A, B"');
    });

    it('neutralises formula-injection payloads with a leading single-quote', async () => {
      mockPrisma.project.findMany.mockResolvedValueOnce([
        makeProject({ name: '=cmd|/c calc', clientName: '@evil', status: '+1+1' }),
      ]);

      const result = await service.exportCsv();
      const content = (result.value as { content: string }).content;
      expect(content).toContain("'=cmd|/c calc");
      expect(content).toContain("'@evil");
      expect(content).toContain("'+1+1");
    });

    it('handles a missing projectManager gracefully (empty PM + email cells)', async () => {
      mockPrisma.project.findMany.mockResolvedValueOnce([
        makeProject({ projectManager: null }),
      ]);

      const result = await service.exportCsv();
      const content = (result.value as { content: string }).content;
      // After clientName=ACME, the PM and email fields should be empty.
      expect(content).toContain('ACME;;;');
    });

    it('applies the id filter via where.id.in when ids are provided', async () => {
      mockPrisma.project.findMany.mockResolvedValueOnce([]);

      await service.exportCsv(['id-a', 'id-b']);

      const args = mockPrisma.project.findMany.mock.calls[0][0] as {
        where: { isDeleted: boolean; id?: { in: string[] } };
      };
      expect(args.where.isDeleted).toBe(false);
      expect(args.where.id).toEqual({ in: ['id-a', 'id-b'] });
    });

    it('does not add the id filter when no ids are passed', async () => {
      mockPrisma.project.findMany.mockResolvedValueOnce([]);

      await service.exportCsv();

      const args = mockPrisma.project.findMany.mock.calls[0][0] as {
        where: { isDeleted: boolean; id?: { in: string[] } };
      };
      expect(args.where.id).toBeUndefined();
    });

    it('refuses requests with > 10 000 ids', async () => {
      const tooMany = Array.from({ length: 10_001 }, (_, i) => `id-${i}`);

      const result = await service.exportCsv(tooMany);

      expect(result.isFailure).toBe(true);
      expect(result.error).toMatch(/Trop d'identifiants/);
      expect(mockPrisma.project.findMany).not.toHaveBeenCalled();
    });
  });

  // ── exportJson ─────────────────────────────────────────────────────────────

  describe('exportJson', () => {
    it('returns the projects array with field/fieldValue includes', async () => {
      const rows = [
        { id: 'p1', name: 'A', clientName: 'C', status: 'Active', priority: 'Normal', startDate: new Date(), endDate: new Date(), createdAt: new Date(), projectManager: null, fields: [], fieldValues: [] },
      ];
      mockPrisma.project.findMany.mockResolvedValueOnce(rows);

      const result = await service.exportJson();

      expect(result.isSuccess).toBe(true);
      expect(result.value).toEqual(rows);
    });

    it('refuses requests with > 10 000 ids', async () => {
      const tooMany = Array.from({ length: 10_001 }, (_, i) => `id-${i}`);

      const result = await service.exportJson(tooMany);

      expect(result.isFailure).toBe(true);
      expect(mockPrisma.project.findMany).not.toHaveBeenCalled();
    });

    it('applies the id filter when ids are passed', async () => {
      mockPrisma.project.findMany.mockResolvedValueOnce([]);

      await service.exportJson(['p1']);

      const args = mockPrisma.project.findMany.mock.calls[0][0] as {
        where: { id?: { in: string[] } };
      };
      expect(args.where.id).toEqual({ in: ['p1'] });
    });
  });

  // ── generateReport ─────────────────────────────────────────────────────────

  describe('generateReport', () => {
    it('returns a formatted multi-line report for an existing project', async () => {
      mockPrisma.project.findFirst.mockResolvedValueOnce({
        ...makeProject(),
        fieldValues: [
          { field: { label: 'Stack' }, value: 'NestJS' },
          { field: null, value: null },
        ],
        activities: [
          { createdAt: new Date('2026-04-01T10:00:00Z'), action: 'created', detail: 'project setup' },
        ],
      });

      const result = await service.generateReport('p1');

      expect(result.isSuccess).toBe(true);
      const report = result.value as string;
      expect(report).toContain('=== RAPPORT DE PROJET ===');
      expect(report).toContain('Nom: My Project');
      expect(report).toContain('Client: ACME');
      expect(report).toContain('Chef de projet: Alice PM');
      expect(report).toContain('Stack: NestJS');
      expect(report).toContain('Champ: (vide)');
      expect(report).toContain('[2026-04-01T10:00] created: project setup');
    });

    it('falls back to "Non assigné" when projectManager is null', async () => {
      mockPrisma.project.findFirst.mockResolvedValueOnce({
        ...makeProject({ projectManager: null }),
        fieldValues: [],
        activities: [],
      });

      const result = await service.generateReport('p1');

      const report = result.value as string;
      expect(report).toContain('Chef de projet: Non assigné');
    });

    it('returns a failure when the project is not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValueOnce(null);

      const result = await service.generateReport('missing');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Projet non trouvé.');
    });
  });

  // ── generateReportData ───────────────────────────────────────────────────────

  describe('generateReportData', () => {
    it('assembles header, ordered fields, work packages, and progress %', async () => {
      mockPrisma.project.findFirst.mockResolvedValueOnce({
        ...makeProject(),
        projectManager: { firstName: 'Alice', lastName: 'PM' },
        fields: [
          { id: 'f1', label: 'Stack' },
          { id: 'f2', label: 'Budget' }, // no value → empty string
        ],
        fieldValues: [{ projectFieldId: 'f1', value: 'NestJS' }],
      });
      mockPrisma.workPackage.findMany.mockResolvedValueOnce([
        { title: 'Setup', status: 'Closed', priority: 'High', percentDone: 100, startDate: new Date('2026-02-01T00:00:00Z'), dueDate: new Date('2026-02-05T00:00:00Z'), assignee: { firstName: 'Bob', lastName: 'Dev' } },
        { title: 'Build', status: 'New', priority: 'Normal', percentDone: 0, startDate: null, dueDate: null, assignee: null },
      ]);

      const result = await service.generateReportData('p1');

      expect(result.isSuccess).toBe(true);
      const data = result.value!;
      expect(data.project).toMatchObject({
        id: 'p1', name: 'My Project', clientName: 'ACME', pmName: 'Alice PM',
        status: 'Active', priority: 'Normal', startDate: '2026-01-01', endDate: '2026-12-31',
        progressPct: 50, // 1 of 2 WPs terminal (Closed)
      });
      expect(data.fields).toEqual([
        { label: 'Stack', value: 'NestJS' },
        { label: 'Budget', value: '' },
      ]);
      expect(data.workPackages[0]).toEqual({
        title: 'Setup', status: 'Closed', priority: 'High', assignee: 'Bob Dev',
        startDate: '2026-02-01', dueDate: '2026-02-05', percentDone: 100,
      });
      expect(data.workPackages[1]).toMatchObject({ title: 'Build', assignee: '', startDate: '', dueDate: '' });
      // only non-deleted WPs of THIS project are queried
      const wpArgs = mockPrisma.workPackage.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(wpArgs.where).toMatchObject({ projectId: 'p1', isDeleted: false });
    });

    it('reports 0% progress and empty arrays when the project has no WPs/fields', async () => {
      mockPrisma.project.findFirst.mockResolvedValueOnce({
        ...makeProject({ projectManager: null }),
        fields: [],
        fieldValues: [],
      });
      mockPrisma.workPackage.findMany.mockResolvedValueOnce([]);

      const result = await service.generateReportData('p1');

      expect(result.isSuccess).toBe(true);
      expect(result.value!.project.progressPct).toBe(0);
      expect(result.value!.project.pmName).toBe('Non assigné');
      expect(result.value!.fields).toEqual([]);
      expect(result.value!.workPackages).toEqual([]);
    });

    it('returns a failure when the project is not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValueOnce(null);

      const result = await service.generateReportData('missing');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Projet non trouvé.');
      expect(mockPrisma.workPackage.findMany).not.toHaveBeenCalled();
    });
  });
});
