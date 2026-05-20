import { BadRequestException } from '@nestjs/common'
import { AgileController } from './agile.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

describe('AgileController', () => {
  let controller: AgileController
  let mockService: Record<string, jest.Mock>
  const user = { userId: 'u-1', role: 'ProjectManager' }

  beforeEach(() => {
    mockService = {
      listBoards: jest.fn(),
      getBoard: jest.fn(),
      createBoard: jest.fn(),
      updateBoard: jest.fn(),
      deleteBoard: jest.fn(),
      createColumn: jest.fn(),
      updateColumn: jest.fn(),
      deleteColumn: jest.fn(),
      reorderColumns: jest.fn(),
      moveCard: jest.fn(),
      listSprints: jest.fn(),
      createSprint: jest.fn(),
      updateSprint: jest.fn(),
      deleteSprint: jest.fn(),
      startSprint: jest.fn(),
      getSprintClosePreview: jest.fn(),
      closeSprint: jest.fn(),
      addWpToSprint: jest.fn(),
      removeWpFromSprint: jest.fn(),
      getBurndown: jest.fn(),
    }
    controller = new AgileController(mockService as any)
  })

  // Boards
  it('listBoards happy', async () => {
    mockService.listBoards.mockResolvedValue(ok([{ id: 'b-1' }]))
    expect(await controller.listBoards('p-1')).toEqual([{ id: 'b-1' }])
  })
  it('listBoards failure', async () => {
    mockService.listBoards.mockResolvedValue(fail('x'))
    await expect(controller.listBoards('p-1')).rejects.toThrow(BadRequestException)
  })
  it('getBoard happy + failure', async () => {
    mockService.getBoard.mockResolvedValueOnce(ok({ id: 'b-1' }))
    expect(await controller.getBoard('b-1')).toEqual({ id: 'b-1' })
    mockService.getBoard.mockResolvedValueOnce(fail('no'))
    await expect(controller.getBoard('b-1')).rejects.toThrow(BadRequestException)
  })
  it('createBoard rejects missing name', async () => {
    await expect(controller.createBoard('p-1', { name: '   ' } as any)).rejects.toThrow(
      BadRequestException,
    )
  })
  it('createBoard happy', async () => {
    mockService.createBoard.mockResolvedValue(ok({ id: 'b-1' }))
    expect(await controller.createBoard('p-1', { name: 'B' } as any)).toEqual({ id: 'b-1' })
  })
  it('createBoard failure → 400', async () => {
    mockService.createBoard.mockResolvedValue(fail('x'))
    await expect(controller.createBoard('p-1', { name: 'B' } as any)).rejects.toThrow(
      BadRequestException,
    )
  })
  it('updateBoard happy + failure', async () => {
    mockService.updateBoard.mockResolvedValueOnce(ok({ id: 'b-1' }))
    expect(await controller.updateBoard('b-1', {} as any)).toEqual({ id: 'b-1' })
    mockService.updateBoard.mockResolvedValueOnce(fail('no'))
    await expect(controller.updateBoard('b-1', {} as any)).rejects.toThrow(BadRequestException)
  })
  it('deleteBoard happy + failure', async () => {
    mockService.deleteBoard.mockResolvedValueOnce(ok(undefined))
    await expect(controller.deleteBoard('b-1')).resolves.toBeUndefined()
    mockService.deleteBoard.mockResolvedValueOnce(fail('no'))
    await expect(controller.deleteBoard('b-1')).rejects.toThrow(BadRequestException)
  })

  // Columns
  it('createColumn happy + failure', async () => {
    mockService.createColumn.mockResolvedValueOnce(ok({ id: 'c-1' }))
    expect(await controller.createColumn('b-1', { name: 'To Do' } as any)).toEqual({ id: 'c-1' })
    mockService.createColumn.mockResolvedValueOnce(fail('no'))
    await expect(controller.createColumn('b-1', {} as any)).rejects.toThrow(BadRequestException)
  })
  it('updateColumn happy + failure', async () => {
    mockService.updateColumn.mockResolvedValueOnce(ok({ id: 'c-1' }))
    expect(await controller.updateColumn('c-1', {} as any)).toEqual({ id: 'c-1' })
    mockService.updateColumn.mockResolvedValueOnce(fail('no'))
    await expect(controller.updateColumn('c-1', {} as any)).rejects.toThrow(BadRequestException)
  })
  it('deleteColumn happy + failure', async () => {
    mockService.deleteColumn.mockResolvedValueOnce(ok(undefined))
    await expect(controller.deleteColumn('c-1')).resolves.toBeUndefined()
    mockService.deleteColumn.mockResolvedValueOnce(fail('no'))
    await expect(controller.deleteColumn('c-1')).rejects.toThrow(BadRequestException)
  })
  it('reorderColumns happy + failure', async () => {
    mockService.reorderColumns.mockResolvedValueOnce(ok(undefined))
    expect(await controller.reorderColumns('b-1', { order: ['c-1', 'c-2'] } as any)).toEqual({
      success: true,
    })
    expect(mockService.reorderColumns).toHaveBeenCalledWith('b-1', ['c-1', 'c-2'])
    mockService.reorderColumns.mockResolvedValueOnce(fail('no'))
    await expect(
      controller.reorderColumns('b-1', { order: [] } as any),
    ).rejects.toThrow(BadRequestException)
  })

  // Cards
  it('moveCard passes columnId + position (with defaults) and happy + failure', async () => {
    mockService.moveCard.mockResolvedValueOnce(ok({ id: 'wp-1' }))
    expect(
      await controller.moveCard('p-1', 'wp-1', { columnId: 'c-1', position: 3 } as any),
    ).toEqual({ id: 'wp-1' })
    expect(mockService.moveCard).toHaveBeenCalledWith('p-1', 'wp-1', 'c-1', 3)

    mockService.moveCard.mockResolvedValueOnce(ok({ id: 'wp-1' }))
    await controller.moveCard('p-1', 'wp-1', {} as any)
    // default columnId null + position 0
    expect(mockService.moveCard).toHaveBeenLastCalledWith('p-1', 'wp-1', null, 0)

    mockService.moveCard.mockResolvedValueOnce(fail('no'))
    await expect(
      controller.moveCard('p-1', 'wp-1', {} as any),
    ).rejects.toThrow(BadRequestException)
  })

  // Sprints
  it('listSprints happy + failure', async () => {
    mockService.listSprints.mockResolvedValueOnce(ok([{ id: 's-1' }]))
    expect(await controller.listSprints('b-1')).toEqual([{ id: 's-1' }])
    mockService.listSprints.mockResolvedValueOnce(fail('no'))
    await expect(controller.listSprints('b-1')).rejects.toThrow(BadRequestException)
  })

  it('createSprint rejects empty name + happy + failure', async () => {
    await expect(
      controller.createSprint('b-1', { name: '' } as any),
    ).rejects.toThrow(BadRequestException)
    mockService.createSprint.mockResolvedValueOnce(ok({ id: 's-1' }))
    expect(await controller.createSprint('b-1', { name: 'Sprint 1' } as any)).toEqual({ id: 's-1' })
    mockService.createSprint.mockResolvedValueOnce(fail('no'))
    await expect(controller.createSprint('b-1', { name: 'S' } as any)).rejects.toThrow(
      BadRequestException,
    )
  })

  it('updateSprint happy + failure', async () => {
    mockService.updateSprint.mockResolvedValueOnce(ok({ id: 's-1' }))
    expect(await controller.updateSprint('s-1', {} as any)).toEqual({ id: 's-1' })
    mockService.updateSprint.mockResolvedValueOnce(fail('no'))
    await expect(controller.updateSprint('s-1', {} as any)).rejects.toThrow(BadRequestException)
  })

  it('deleteSprint happy + failure', async () => {
    mockService.deleteSprint.mockResolvedValueOnce(ok(undefined))
    await expect(controller.deleteSprint('s-1')).resolves.toBeUndefined()
    mockService.deleteSprint.mockResolvedValueOnce(fail('no'))
    await expect(controller.deleteSprint('s-1')).rejects.toThrow(BadRequestException)
  })

  it('startSprint happy + failure', async () => {
    mockService.startSprint.mockResolvedValueOnce(ok({ id: 's-1', status: 'Active' }))
    expect(await controller.startSprint('s-1')).toEqual({ id: 's-1', status: 'Active' })
    mockService.startSprint.mockResolvedValueOnce(fail('no'))
    await expect(controller.startSprint('s-1')).rejects.toThrow(BadRequestException)
  })

  it('closeSprintPreview happy + failure', async () => {
    mockService.getSprintClosePreview.mockResolvedValueOnce(ok({ tasks: [] }))
    expect(await controller.closeSprintPreview('p-1', 's-1')).toEqual({ tasks: [] })
    mockService.getSprintClosePreview.mockResolvedValueOnce(fail('no'))
    await expect(controller.closeSprintPreview('p-1', 's-1')).rejects.toThrow(BadRequestException)
  })

  it('closeSprint passes user.userId + happy + failure', async () => {
    mockService.closeSprint.mockResolvedValueOnce(ok({ id: 's-1' }))
    expect(await controller.closeSprint('p-1', 's-1', { decision: 'close' } as any, user)).toEqual({
      id: 's-1',
    })
    expect(mockService.closeSprint).toHaveBeenCalledWith('p-1', 's-1', { decision: 'close' }, 'u-1')
    mockService.closeSprint.mockResolvedValueOnce(fail('no'))
    await expect(
      controller.closeSprint('p-1', 's-1', {} as any, user),
    ).rejects.toThrow(BadRequestException)
  })

  it('addWps happy + failure', async () => {
    mockService.addWpToSprint.mockResolvedValueOnce(ok(undefined))
    expect(
      await controller.addWps('s-1', { workPackageIds: ['wp-1', 'wp-2'] } as any),
    ).toEqual({ success: true })
    expect(mockService.addWpToSprint).toHaveBeenCalledWith('s-1', ['wp-1', 'wp-2'])
    mockService.addWpToSprint.mockResolvedValueOnce(fail('no'))
    await expect(
      controller.addWps('s-1', { workPackageIds: [] } as any),
    ).rejects.toThrow(BadRequestException)
  })

  it('removeWp happy + failure', async () => {
    mockService.removeWpFromSprint.mockResolvedValueOnce(ok(undefined))
    await expect(controller.removeWp('s-1', 'wp-1')).resolves.toBeUndefined()
    mockService.removeWpFromSprint.mockResolvedValueOnce(fail('no'))
    await expect(controller.removeWp('s-1', 'wp-1')).rejects.toThrow(BadRequestException)
  })

  it('getBurndown happy + failure', async () => {
    mockService.getBurndown.mockResolvedValueOnce(ok({ points: [] }))
    expect(await controller.getBurndown('s-1')).toEqual({ points: [] })
    mockService.getBurndown.mockResolvedValueOnce(fail('no'))
    await expect(controller.getBurndown('s-1')).rejects.toThrow(BadRequestException)
  })
})
