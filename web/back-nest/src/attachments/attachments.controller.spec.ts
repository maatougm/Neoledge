import { BadRequestException, NotFoundException } from '@nestjs/common'
import { AttachmentsController, AttachmentAdminController } from './attachments.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

function makeRes() {
  return { set: jest.fn(), send: jest.fn() } as any
}

describe('AttachmentsController', () => {
  let controller: AttachmentsController
  let mockService: Record<string, jest.Mock>
  const user = { userId: 'u-1' }

  beforeEach(() => {
    mockService = {
      getProjectAttachments: jest.fn(),
      getById: jest.fn(),
      upload: jest.fn(),
      updateMetadata: jest.fn(),
      deleteAttachment: jest.fn(),
      download: jest.fn(),
      getTotalStorage: jest.fn(),
    }
    controller = new AttachmentsController(mockService as any)
  })

  it('getAll returns service value', async () => {
    mockService.getProjectAttachments.mockResolvedValue(ok([{ id: 'a-1' }]))
    expect(await controller.getAll('p-1')).toEqual([{ id: 'a-1' }])
  })

  it('getById returns row on success', async () => {
    mockService.getById.mockResolvedValue(ok({ id: 'a-1' }))
    expect(await controller.getById('a-1')).toEqual({ id: 'a-1' })
  })

  it('getById throws 404 on failure', async () => {
    mockService.getById.mockResolvedValue(fail('not found'))
    await expect(controller.getById('a-1')).rejects.toThrow(NotFoundException)
  })

  it('upload returns row on success', async () => {
    mockService.upload.mockResolvedValue(ok({ id: 'a-new' }))
    expect(await controller.upload('p-1', user, { fileName: 'x.pdf' } as any)).toEqual({
      id: 'a-new',
    })
    expect(mockService.upload).toHaveBeenCalledWith('p-1', 'u-1', { fileName: 'x.pdf' })
  })

  it('upload throws 400 on failure', async () => {
    mockService.upload.mockResolvedValue(fail('too large'))
    await expect(
      controller.upload('p-1', user, { fileName: 'x' } as any),
    ).rejects.toThrow(BadRequestException)
  })

  it('update returns row on success', async () => {
    mockService.updateMetadata.mockResolvedValue(ok({ id: 'a-1' }))
    expect(await controller.update('a-1', { fileName: 'n.pdf' } as any)).toEqual({ id: 'a-1' })
  })

  it('update throws 404 on failure', async () => {
    mockService.updateMetadata.mockResolvedValue(fail('no'))
    await expect(controller.update('a-1', {} as any)).rejects.toThrow(NotFoundException)
  })

  it('delete resolves on success', async () => {
    mockService.deleteAttachment.mockResolvedValue(ok(undefined))
    await expect(controller.delete('a-1')).resolves.toBeUndefined()
  })

  it('delete throws 404 on failure', async () => {
    mockService.deleteAttachment.mockResolvedValue(fail('no'))
    await expect(controller.delete('a-1')).rejects.toThrow(NotFoundException)
  })

  describe('download', () => {
    it('throws 404 on failure', async () => {
      mockService.download.mockResolvedValue(fail('no'))
      await expect(controller.download('a-1', makeRes())).rejects.toThrow(NotFoundException)
    })

    it('writes headers + body on success and encodes UTF-8 filenames', async () => {
      const buf = Buffer.from('hi')
      mockService.download.mockResolvedValue(
        ok({ content: buf, fileName: 'rapport été.pdf', contentType: 'application/pdf' }),
      )
      const res = makeRes()
      await controller.download('a-1', res)
      const headers = res.set.mock.calls[0][0]
      expect(headers['Content-Type']).toBe('application/pdf')
      // ASCII fallback strips non-ASCII to '_'; UTF-8 encoded form is preserved.
      expect(headers['Content-Disposition']).toContain('rapport ')
      expect(headers['Content-Disposition']).toMatch(/filename\*=UTF-8''/)
      expect(res.send).toHaveBeenCalledWith(buf)
    })

    it('sanitises control chars in the ASCII fallback filename', async () => {
      mockService.download.mockResolvedValue(
        ok({ content: Buffer.from(''), fileName: 'a\x00"b.pdf', contentType: 'application/pdf' }),
      )
      const res = makeRes()
      await controller.download('a-1', res)
      const cd = res.set.mock.calls[0][0]['Content-Disposition'] as string
      expect(cd).toContain('a__b.pdf') // \x00 + " → _
    })
  })
})

describe('AttachmentAdminController', () => {
  let controller: AttachmentAdminController
  let mockService: { getTotalStorage: jest.Mock }

  beforeEach(() => {
    mockService = { getTotalStorage: jest.fn() }
    controller = new AttachmentAdminController(mockService as any)
  })

  it('returns service value', async () => {
    mockService.getTotalStorage.mockResolvedValue(ok({ bytes: 12345 }))
    expect(await controller.getStorage()).toEqual({ bytes: 12345 })
  })
})
