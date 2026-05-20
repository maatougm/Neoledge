import { Test, TestingModule } from '@nestjs/testing';
import { TemplatesService } from './templates.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  projectTemplate: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  project: {
    findFirst: jest.fn(),
  },
  projectField: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  projectFieldValue: {
    create: jest.fn(),
  },
};

describe('TemplatesService', () => {
  let service: TemplatesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplatesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(TemplatesService);
  });

  describe('getAll', () => {
    it('returns shaped list with fieldCount', async () => {
      mockPrisma.projectTemplate.findMany.mockResolvedValue([
        { id: 't1', name: 'T', description: 'd', createdAt: new Date(), _count: { fields: 5 } },
      ]);
      const result = await service.getAll();
      expect(result.isSuccess).toBe(true);
      expect(result.value).toEqual([
        expect.objectContaining({ id: 't1', name: 'T', description: 'd', fieldCount: 5 }),
      ]);
    });

    it('returns empty array when no templates', async () => {
      mockPrisma.projectTemplate.findMany.mockResolvedValue([]);
      const r = await service.getAll();
      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual([]);
    });
  });

  describe('getById', () => {
    it('returns the template with fields', async () => {
      mockPrisma.projectTemplate.findUnique.mockResolvedValue({
        id: 't1', name: 'T', description: null, createdAt: new Date(),
        fields: [
          { id: 'f1', label: 'L', type: 'Text', category: 'Custom', isRequired: false, displayOrder: 0, options: null },
        ],
      });
      const r = await service.getById('t1');
      expect(r.isSuccess).toBe(true);
      expect(r.value.fields).toHaveLength(1);
      expect(r.value.fields[0]).toEqual(expect.objectContaining({ id: 'f1', label: 'L' }));
    });

    it('fails when not found', async () => {
      mockPrisma.projectTemplate.findUnique.mockResolvedValue(null);
      const r = await service.getById('missing');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Modèle non trouvé.');
    });
  });

  describe('create', () => {
    it('creates template with default values for fields', async () => {
      mockPrisma.projectTemplate.create.mockResolvedValue({
        id: 't1', name: 'T', fields: [],
      });
      const r = await service.create({ name: 'T', fields: [{ label: 'A' }] } as any, 'admin1');
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.projectTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          name: 'T',
          createdByAdminId: 'admin1',
          fields: { create: [expect.objectContaining({ label: 'A', type: 'Text', category: 'Custom', isRequired: false, displayOrder: 0 })] },
        }),
      }));
    });

    it('handles empty fields array', async () => {
      mockPrisma.projectTemplate.create.mockResolvedValue({ id: 't1', name: 'T', fields: [] });
      const r = await service.create({ name: 'T' } as any, 'admin1');
      expect(r.isSuccess).toBe(true);
    });

    it('preserves explicit type/category/isRequired/displayOrder/options', async () => {
      mockPrisma.projectTemplate.create.mockResolvedValue({ id: 't1', name: 'T', fields: [] });
      await service.create({
        name: 'T',
        description: 'd',
        fields: [{ label: 'A', type: 'Select', category: 'Dynamic', isRequired: true, displayOrder: 7, options: '["x"]' }],
      } as any, 'admin1');
      expect(mockPrisma.projectTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          fields: { create: [expect.objectContaining({ type: 'Select', category: 'Dynamic', isRequired: true, displayOrder: 7, options: '["x"]' })] },
        }),
      }));
    });
  });

  describe('deleteTemplate', () => {
    it('happy path', async () => {
      mockPrisma.projectTemplate.findUnique.mockResolvedValue({ id: 't1' });
      mockPrisma.projectTemplate.delete.mockResolvedValue({});
      const r = await service.deleteTemplate('t1');
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.projectTemplate.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    it('fails when not found', async () => {
      mockPrisma.projectTemplate.findUnique.mockResolvedValue(null);
      const r = await service.deleteTemplate('missing');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Modèle non trouvé.');
      expect(mockPrisma.projectTemplate.delete).not.toHaveBeenCalled();
    });
  });

  describe('createFromProject', () => {
    it('strips _-prefixed and Private fields then creates template', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'p1',
        fields: [
          { label: 'Public', fieldType: 'Text', fieldCategory: 'Custom', isRequired: false, options: null },
          { label: '_internal', fieldType: 'Text', fieldCategory: 'Custom', isRequired: false, options: null },
          { label: 'Secret', fieldType: 'Text', fieldCategory: 'Private', isRequired: false, options: null },
        ],
      });
      mockPrisma.projectTemplate.create.mockResolvedValue({ id: 't1', name: 'T', fields: [] });
      const r = await service.createFromProject('p1', { name: 'T' } as any, 'admin1');
      expect(r.isSuccess).toBe(true);
      const createArg = mockPrisma.projectTemplate.create.mock.calls[0][0];
      const created = createArg.data.fields.create;
      expect(created).toHaveLength(1);
      expect(created[0].label).toBe('Public');
    });

    it('fails when project not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      const r = await service.createFromProject('missing', { name: 'T' } as any, 'admin1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Projet non trouvé.');
    });
  });

  describe('applyToProject', () => {
    it('creates ProjectField + null ProjectFieldValue for each template field, skipping duplicates', async () => {
      mockPrisma.projectTemplate.findUnique.mockResolvedValue({
        id: 't1',
        fields: [
          { label: 'Existing', type: 'Text', category: 'Custom', isRequired: false, displayOrder: 0, options: null },
          { label: 'NewOne', type: 'Text', category: 'Custom', isRequired: false, displayOrder: 1, options: null },
        ],
      });
      mockPrisma.project.findFirst.mockResolvedValue({ id: 'p1', isDeleted: false });
      mockPrisma.projectField.findMany.mockResolvedValue([{ label: 'existing' }]);
      mockPrisma.projectField.create.mockImplementation(async ({ data }) => ({ id: `f-${data.label}`, ...data }));
      mockPrisma.projectFieldValue.create.mockResolvedValue({});

      const r = await service.applyToProject('t1', 'p1');
      expect(r.isSuccess).toBe(true);
      expect(r.value.skipped).toEqual(['Existing']);
      expect(mockPrisma.projectField.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.projectFieldValue.create).toHaveBeenCalledTimes(1);
    });

    it('fails when template not found', async () => {
      mockPrisma.projectTemplate.findUnique.mockResolvedValue(null);
      const r = await service.applyToProject('missing', 'p1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Modèle non trouvé.');
    });

    it('fails when project not found', async () => {
      mockPrisma.projectTemplate.findUnique.mockResolvedValue({ id: 't1', fields: [] });
      mockPrisma.project.findFirst.mockResolvedValue(null);
      const r = await service.applyToProject('t1', 'missing');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Projet non trouvé.');
    });

    it('does nothing when template has no fields', async () => {
      mockPrisma.projectTemplate.findUnique.mockResolvedValue({ id: 't1', fields: [] });
      mockPrisma.project.findFirst.mockResolvedValue({ id: 'p1' });
      mockPrisma.projectField.findMany.mockResolvedValue([]);
      const r = await service.applyToProject('t1', 'p1');
      expect(r.isSuccess).toBe(true);
      expect(r.value.skipped).toEqual([]);
      expect(mockPrisma.projectField.create).not.toHaveBeenCalled();
    });
  });
});
