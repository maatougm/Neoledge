import { Test, TestingModule } from '@nestjs/testing'
import { SearchService } from './search.service'
import { PrismaService } from '../prisma/prisma.service'

const mockPrisma = {
  appUser: { findUnique: jest.fn(), findMany: jest.fn() },
  project: { findMany: jest.fn() },
  projectMember: { findMany: jest.fn() },
  workPackage: { findMany: jest.fn() },
}

describe('SearchService', () => {
  let service: SearchService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [SearchService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile()
    service = module.get<SearchService>(SearchService)
  })

  // ── empty / short-query guards ────────────────────────────────────────────

  describe('input guards', () => {
    it('returns empty hits when query is too short (< 2 chars)', async () => {
      const r = await service.search('a', 'u1')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toEqual([])
      expect(mockPrisma.appUser.findUnique).not.toHaveBeenCalled()
    })

    it('returns empty hits when query is empty string', async () => {
      const r = await service.search('', 'u1')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toEqual([])
    })

    it('returns empty hits when query is null/undefined-coerced', async () => {
      const r = await service.search(null as unknown as string, 'u1')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toEqual([])
    })

    it('returns empty hits when query is whitespace-only', async () => {
      const r = await service.search('   ', 'u1')
      expect(r.isSuccess).toBe(true)
      expect(r.value).toEqual([])
    })

    it('truncates query to MAX_QUERY_LENGTH (200 chars)', async () => {
      const longQuery = 'x'.repeat(500)
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Admin' })
      mockPrisma.project.findMany.mockResolvedValue([])
      mockPrisma.workPackage.findMany.mockResolvedValue([])
      mockPrisma.appUser.findMany.mockResolvedValue([])

      await service.search(longQuery, 'u1')

      const projWhere = (mockPrisma.project.findMany.mock.calls[0][0] as { where: { OR: Array<{ name: { contains: string } }> } }).where
      expect(projWhere.OR[0].name.contains.length).toBe(200)
    })
  })

  // ── limit clamping ────────────────────────────────────────────────────────

  describe('limit clamping', () => {
    beforeEach(() => {
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Admin' })
      mockPrisma.project.findMany.mockResolvedValue([])
      mockPrisma.workPackage.findMany.mockResolvedValue([])
      mockPrisma.appUser.findMany.mockResolvedValue([])
    })

    it('clamps limit to MAX_TAKE (50) when caller asks for more', async () => {
      await service.search('test', 'u1', 999)
      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }))
      expect(mockPrisma.workPackage.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }))
    })

    it('clamps limit to min 1 when caller passes 0 or negative', async () => {
      await service.search('test', 'u1', 0)
      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }))
    })

    it('honors the default limit of 8 when no third arg', async () => {
      await service.search('test', 'u1')
      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 8 }))
    })

    it('caps user take at 4 even when project take is higher', async () => {
      await service.search('test', 'u1', 20)
      // User take = min(4, take) → 4
      expect(mockPrisma.appUser.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }))
    })
  })

  // ── Admin scope ───────────────────────────────────────────────────────────

  describe('Admin scope (sees everything)', () => {
    beforeEach(() => {
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Admin' })
    })

    it('does NOT compute accessibleProjectIds (skips the PM / member lookup)', async () => {
      mockPrisma.project.findMany.mockResolvedValue([])
      mockPrisma.workPackage.findMany.mockResolvedValue([])
      mockPrisma.appUser.findMany.mockResolvedValue([])

      await service.search('archimed', 'admin-1')

      // Admin path: no PM-projects findMany, no projectMember findMany
      // (Note: project.findMany IS called once for the search results;
      // we assert the PM-side findMany was NOT.)
      const pmProjectCall = mockPrisma.project.findMany.mock.calls.find(
        ([arg]) => arg && (arg as { where?: { projectManagerId?: string } }).where?.projectManagerId,
      )
      expect(pmProjectCall).toBeUndefined()
      expect(mockPrisma.projectMember.findMany).not.toHaveBeenCalled()
    })

    it('issues project + WP + user searches without the projectId filter', async () => {
      mockPrisma.project.findMany.mockResolvedValue([])
      mockPrisma.workPackage.findMany.mockResolvedValue([])
      mockPrisma.appUser.findMany.mockResolvedValue([])

      await service.search('elise', 'admin-1')

      const projWhere = (mockPrisma.project.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
      const wpWhere = (mockPrisma.workPackage.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where

      expect(projWhere).not.toHaveProperty('id')
      expect(wpWhere).not.toHaveProperty('projectId')
    })

    it('uses the unscoped user search (no shared-project AND)', async () => {
      mockPrisma.project.findMany.mockResolvedValue([])
      mockPrisma.workPackage.findMany.mockResolvedValue([])
      mockPrisma.appUser.findMany.mockResolvedValue([])

      await service.search('claire', 'admin-1')

      const userWhere = (mockPrisma.appUser.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
      expect(userWhere).not.toHaveProperty('AND')
    })
  })

  // ── Non-Admin scope ───────────────────────────────────────────────────────

  describe('non-Admin scope (PM / Member)', () => {
    beforeEach(() => {
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'ProjectManager' })
    })

    it('resolves accessibleProjectIds from PM-managed + ProjectMember rows', async () => {
      mockPrisma.project.findMany
        // First call: PM-managed lookup
        .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }])
        // Second call: the actual project search
        .mockResolvedValueOnce([])
      mockPrisma.projectMember.findMany.mockResolvedValue([{ projectId: 'p2' }, { projectId: 'p3' }])
      mockPrisma.workPackage.findMany.mockResolvedValue([])
      mockPrisma.appUser.findMany.mockResolvedValue([])

      await service.search('test', 'pm-1')

      // 2nd project.findMany IS the search; it should be scoped to the union.
      const searchCall = mockPrisma.project.findMany.mock.calls[1][0] as {
        where: { id: { in: string[] } }
      }
      expect(searchCall.where.id.in.sort()).toEqual(['p1', 'p2', 'p3'])
    })

    it('passes accessibleProjectIds onto the WP filter', async () => {
      mockPrisma.project.findMany.mockResolvedValueOnce([{ id: 'p1' }]).mockResolvedValueOnce([])
      mockPrisma.projectMember.findMany.mockResolvedValue([])
      mockPrisma.workPackage.findMany.mockResolvedValue([])
      mockPrisma.appUser.findMany.mockResolvedValue([])

      await service.search('test', 'pm-1')

      const wpWhere = (mockPrisma.workPackage.findMany.mock.calls[0][0] as {
        where: { projectId: { in: string[] } }
      }).where
      expect(wpWhere.projectId.in).toEqual(['p1'])
    })

    it('passes accessibleProjectIds onto the user search AND clause (closes directory enumeration)', async () => {
      mockPrisma.project.findMany.mockResolvedValueOnce([{ id: 'p1' }]).mockResolvedValueOnce([])
      mockPrisma.projectMember.findMany.mockResolvedValue([])
      mockPrisma.workPackage.findMany.mockResolvedValue([])
      mockPrisma.appUser.findMany.mockResolvedValue([])

      await service.search('test', 'pm-1')

      const userWhere = (mockPrisma.appUser.findMany.mock.calls[0][0] as {
        where: { AND: Array<{ OR: unknown[] }> }
      }).where
      expect(userWhere.AND).toBeDefined()
      expect(userWhere.AND[0].OR.length).toBe(2)
    })

    it('dedupes overlap between PM-managed and ProjectMember sets', async () => {
      mockPrisma.project.findMany.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]).mockResolvedValueOnce([])
      // Same p1 appears in member set
      mockPrisma.projectMember.findMany.mockResolvedValue([{ projectId: 'p1' }, { projectId: 'p3' }])
      mockPrisma.workPackage.findMany.mockResolvedValue([])
      mockPrisma.appUser.findMany.mockResolvedValue([])

      await service.search('test', 'pm-1')

      const searchCall = mockPrisma.project.findMany.mock.calls[1][0] as {
        where: { id: { in: string[] } }
      }
      expect(searchCall.where.id.in.sort()).toEqual(['p1', 'p2', 'p3'])
    })

    it('treats unknown role (callerId not found) as non-Admin', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(null)
      mockPrisma.project.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
      mockPrisma.projectMember.findMany.mockResolvedValue([])
      mockPrisma.workPackage.findMany.mockResolvedValue([])
      mockPrisma.appUser.findMany.mockResolvedValue([])

      await service.search('test', 'unknown')

      const wpWhere = (mockPrisma.workPackage.findMany.mock.calls[0][0] as {
        where: { projectId: { in: string[] } }
      }).where
      // Empty allow-list → scoped to empty array (nobody sees anything).
      expect(wpWhere.projectId.in).toEqual([])
    })
  })

  // ── hit mapping ───────────────────────────────────────────────────────────

  describe('hit mapping', () => {
    beforeEach(() => {
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Admin' })
    })

    it('maps Project rows to SearchHit shape', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        { id: 'p1', name: 'GED Project', clientName: 'ACME', status: 'Active', updatedAt: new Date() },
      ])
      mockPrisma.workPackage.findMany.mockResolvedValue([])
      mockPrisma.appUser.findMany.mockResolvedValue([])

      const r = await service.search('GED', 'admin')

      expect(r.isSuccess).toBe(true)
      expect(r.value).toContainEqual({
        type: 'project',
        id: 'p1',
        title: 'GED Project',
        subtitle: 'ACME · Active',
        link: '/app/pm/projects/p1',
      })
    })

    it('maps WorkPackage rows to SearchHit shape with projectId carried through', async () => {
      mockPrisma.project.findMany.mockResolvedValue([])
      mockPrisma.workPackage.findMany.mockResolvedValue([
        { id: 'wp1', title: 'Implement GED', status: 'New', projectId: 'p1', type: 'Task', updatedAt: new Date() },
      ])
      mockPrisma.appUser.findMany.mockResolvedValue([])

      const r = await service.search('GED', 'admin')

      expect(r.value).toContainEqual({
        type: 'work_package',
        id: 'wp1',
        title: 'Implement GED',
        subtitle: 'Task · New',
        projectId: 'p1',
        link: '/app/pm/projects/p1/workpackages',
      })
    })

    it('maps AppUser rows to SearchHit shape', async () => {
      mockPrisma.project.findMany.mockResolvedValue([])
      mockPrisma.workPackage.findMany.mockResolvedValue([])
      mockPrisma.appUser.findMany.mockResolvedValue([
        { id: 'u1', firstName: 'Jean', lastName: 'Dupont', email: 'j@x.fr', role: 'Member' },
      ])

      const r = await service.search('jean', 'admin')

      expect(r.value).toContainEqual({
        type: 'user',
        id: 'u1',
        title: 'Jean Dupont',
        subtitle: 'Member',
        link: '',
      })
    })

    it('returns hits in declared order: projects, then WPs, then users', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        { id: 'p1', name: 'PRJ', clientName: 'X', status: 'A', updatedAt: new Date() },
      ])
      mockPrisma.workPackage.findMany.mockResolvedValue([
        { id: 'w1', title: 'W', status: 'A', projectId: 'p1', type: 'T', updatedAt: new Date() },
      ])
      mockPrisma.appUser.findMany.mockResolvedValue([
        { id: 'u1', firstName: 'F', lastName: 'L', email: 'a@b.c', role: 'Member' },
      ])

      const r = await service.search('xyz', 'admin')

      expect(r.value!.map((h) => h.type)).toEqual(['project', 'work_package', 'user'])
    })
  })

  // ── failure path ──────────────────────────────────────────────────────────

  describe('failure path', () => {
    it('returns Result.fail when Prisma throws', async () => {
      mockPrisma.appUser.findUnique.mockRejectedValue(new Error('DB down'))

      const r = await service.search('test', 'u1')

      expect(r.isFailure).toBe(true)
      expect(r.error).toBe('Échec de la recherche.')
    })

    it('returns Result.fail when a downstream findMany throws', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Admin' })
      mockPrisma.project.findMany.mockRejectedValue(new Error('connection lost'))

      const r = await service.search('test', 'u1')

      expect(r.isFailure).toBe(true)
      expect(r.error).toBe('Échec de la recherche.')
    })
  })
})
