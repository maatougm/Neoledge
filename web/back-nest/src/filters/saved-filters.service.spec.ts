import { Test, TestingModule } from '@nestjs/testing';
import { SavedFiltersService } from './saved-filters.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  appUser: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

interface UserPrefsRow {
  preferences: string | null;
}

function makeUser(prefs: object | null): UserPrefsRow {
  return { preferences: prefs ? JSON.stringify(prefs) : null };
}

describe('SavedFiltersService', () => {
  let service: SavedFiltersService;

  beforeEach(async () => {
    // mockReset (not clearAllMocks) — drains queued mockResolvedValueOnce so
    // unconsumed values from early-returning tests (e.g. shape-validation
    // fast-paths in `create`) don't leak into the next test's findUnique.
    mockPrisma.appUser.findUnique.mockReset();
    mockPrisma.appUser.update.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SavedFiltersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<SavedFiltersService>(SavedFiltersService);
  });

  // ── getAll ─────────────────────────────────────────────────────────────────

  describe('getAll', () => {
    it('returns an empty array when the user has no preferences', async () => {
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })       // first check: user exists
        .mockResolvedValueOnce({ preferences: null }); // readPreferences

      const result = await service.getAll('u1');

      expect(result.isSuccess).toBe(true);
      expect(result.value).toEqual([]);
    });

    it('returns the savedFilters array from preferences', async () => {
      const filters = [
        { id: 'f1', name: 'Mine', filters: { assignedToMe: true }, createdAt: '2026-01-01', isDefault: false },
      ];
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(makeUser({ savedFilters: filters }));

      const result = await service.getAll('u1');

      expect(result.value).toEqual(filters);
    });

    it('returns failure when the user does not exist', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(null);

      const result = await service.getAll('ghost');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Utilisateur non trouvé.');
    });

    it('tolerates a corrupt preferences JSON (returns empty list)', async () => {
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce({ preferences: '{not json' });

      const result = await service.getAll('u1');

      expect(result.value).toEqual([]);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('persists a new filter to preferences', async () => {
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })       // user check
        .mockResolvedValueOnce(makeUser({}));      // readPreferences
      mockPrisma.appUser.update.mockResolvedValueOnce({});

      const result = await service.create('u1', {
        name: '  My Filter  ',
        filters: { status: ['Active'] },
        isDefault: false,
      });

      expect(result.isSuccess).toBe(true);
      const filter = result.value as { name: string; isDefault: boolean; id: string };
      expect(filter.name).toBe('My Filter');
      expect(filter.isDefault).toBe(false);
      expect(filter.id).toMatch(/[0-9a-f-]{36}/);

      const writeArgs = mockPrisma.appUser.update.mock.calls[0][0] as {
        where: { id: string };
        data: { preferences: string };
      };
      const written = JSON.parse(writeArgs.data.preferences) as { savedFilters: unknown[] };
      expect(written.savedFilters).toHaveLength(1);
    });

    it('clears isDefault on existing filters when a new default is created', async () => {
      const existing = [
        { id: 'f1', name: 'X', filters: {}, createdAt: '2026-01-01', isDefault: true },
      ];
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(makeUser({ savedFilters: existing }));
      mockPrisma.appUser.update.mockResolvedValueOnce({});

      const result = await service.create('u1', {
        name: 'New Default',
        filters: {},
        isDefault: true,
      });

      expect(result.isSuccess).toBe(true);
      const written = JSON.parse(
        (mockPrisma.appUser.update.mock.calls[0][0] as { data: { preferences: string } }).data.preferences,
      ) as { savedFilters: Array<{ id: string; isDefault: boolean }> };
      expect(written.savedFilters[0].isDefault).toBe(false); // old default cleared
      expect(written.savedFilters[1].isDefault).toBe(true);
    });

    it('rejects prototype-pollution payloads in filters', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce({ id: 'u1' });

      const result = await service.create('u1', {
        name: 'evil',
        filters: { __proto__: { polluted: true } } as unknown as Record<string, unknown>,
      });

      expect(result.isFailure).toBe(true);
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('rejects oversized filters (> 16 KB)', async () => {
      const huge = { search: 'x'.repeat(20_000) };
      mockPrisma.appUser.findUnique.mockResolvedValueOnce({ id: 'u1' });

      const result = await service.create('u1', {
        name: 'big',
        filters: huge as unknown as Record<string, unknown>,
      });

      expect(result.isFailure).toBe(true);
      expect(result.error).toMatch(/trop volumineux/i);
    });

    it('returns failure when the user does not exist', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(null);

      const result = await service.create('ghost', { name: 'x', filters: {} });

      expect(result.isFailure).toBe(true);
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('patches name + filters on an existing entry', async () => {
      const existing = [
        { id: 'f1', name: 'Old', filters: { status: ['Active'] }, createdAt: '2026-01-01', isDefault: false },
      ];
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(makeUser({ savedFilters: existing }));
      mockPrisma.appUser.update.mockResolvedValueOnce({});

      const result = await service.update('u1', 'f1', {
        name: 'New Name',
        filters: { status: ['Completed'] },
      });

      expect(result.isSuccess).toBe(true);
      const updated = result.value as { name: string; filters: { status: string[] } };
      expect(updated.name).toBe('New Name');
      expect(updated.filters.status).toEqual(['Completed']);
    });

    it('clears other defaults when isDefault=true', async () => {
      const existing = [
        { id: 'f1', name: 'A', filters: {}, createdAt: '2026-01-01', isDefault: true },
        { id: 'f2', name: 'B', filters: {}, createdAt: '2026-01-01', isDefault: false },
      ];
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(makeUser({ savedFilters: existing }));
      mockPrisma.appUser.update.mockResolvedValueOnce({});

      const result = await service.update('u1', 'f2', { isDefault: true });

      expect(result.isSuccess).toBe(true);
      const written = JSON.parse(
        (mockPrisma.appUser.update.mock.calls[0][0] as { data: { preferences: string } }).data.preferences,
      ) as { savedFilters: Array<{ id: string; isDefault: boolean }> };
      const byId = Object.fromEntries(written.savedFilters.map((f) => [f.id, f.isDefault]));
      expect(byId.f1).toBe(false);
      expect(byId.f2).toBe(true);
    });

    it('returns failure when the filter id does not exist', async () => {
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(makeUser({ savedFilters: [] }));

      const result = await service.update('u1', 'ghost', { name: 'X' });

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Filtre non trouvé.');
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('rejects bad-shape filters before touching prisma update', async () => {
      const existing = [{ id: 'f1', name: 'X', filters: {}, createdAt: '2026-01-01', isDefault: false }];
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(makeUser({ savedFilters: existing }));

      const result = await service.update('u1', 'f1', {
        filters: { constructor: { isOwner: true } } as unknown as Record<string, unknown>,
      });

      expect(result.isFailure).toBe(true);
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('removes the matching filter from preferences', async () => {
      const existing = [
        { id: 'f1', name: 'A', filters: {}, createdAt: '2026-01-01', isDefault: false },
        { id: 'f2', name: 'B', filters: {}, createdAt: '2026-01-01', isDefault: false },
      ];
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(makeUser({ savedFilters: existing }));
      mockPrisma.appUser.update.mockResolvedValueOnce({});

      const result = await service.delete('u1', 'f1');

      expect(result.isSuccess).toBe(true);
      const written = JSON.parse(
        (mockPrisma.appUser.update.mock.calls[0][0] as { data: { preferences: string } }).data.preferences,
      ) as { savedFilters: Array<{ id: string }> };
      expect(written.savedFilters.map((f) => f.id)).toEqual(['f2']);
    });

    it('returns failure when the filter does not exist', async () => {
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(makeUser({ savedFilters: [] }));

      const result = await service.delete('u1', 'ghost');

      expect(result.isFailure).toBe(true);
    });
  });

  // ── setDefault ─────────────────────────────────────────────────────────────

  describe('setDefault', () => {
    it('flips the target to default and clears all others', async () => {
      const existing = [
        { id: 'f1', name: 'A', filters: {}, createdAt: '2026-01-01', isDefault: true },
        { id: 'f2', name: 'B', filters: {}, createdAt: '2026-01-01', isDefault: false },
        { id: 'f3', name: 'C', filters: {}, createdAt: '2026-01-01', isDefault: false },
      ];
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(makeUser({ savedFilters: existing }));
      mockPrisma.appUser.update.mockResolvedValueOnce({});

      const result = await service.setDefault('u1', 'f2');

      expect(result.isSuccess).toBe(true);
      const written = JSON.parse(
        (mockPrisma.appUser.update.mock.calls[0][0] as { data: { preferences: string } }).data.preferences,
      ) as { savedFilters: Array<{ id: string; isDefault: boolean }> };
      const byId = Object.fromEntries(written.savedFilters.map((f) => [f.id, f.isDefault]));
      expect(byId).toEqual({ f1: false, f2: true, f3: false });
    });

    it('returns failure when the filter id does not exist', async () => {
      mockPrisma.appUser.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce(makeUser({ savedFilters: [] }));

      const result = await service.setDefault('u1', 'ghost');

      expect(result.isFailure).toBe(true);
    });
  });
});
