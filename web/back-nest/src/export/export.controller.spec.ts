import { NotFoundException } from '@nestjs/common'
import { ExportController } from './export.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

function makeRes() {
  const res = { set: jest.fn(), send: jest.fn() } as any
  return res
}

describe('ExportController', () => {
  let controller: ExportController
  let mockService: {
    exportCsv: jest.Mock
    exportJson: jest.Mock
    generateReport: jest.Mock
    generateReportData: jest.Mock
  }

  beforeEach(() => {
    mockService = {
      exportCsv: jest.fn(),
      exportJson: jest.fn(),
      generateReport: jest.fn(),
      generateReportData: jest.fn(),
    }
    controller = new ExportController(mockService as any)
  })

  describe('exportCsv', () => {
    it('writes Content-Type + Content-Disposition + body', async () => {
      mockService.exportCsv.mockResolvedValue(
        ok({ content: 'a,b\n1,2\n', contentType: 'text/csv', fileName: 'p.csv' }),
      )
      const res = makeRes()
      await controller.exportCsv('id1,id2', res)
      expect(mockService.exportCsv).toHaveBeenCalledWith(['id1', 'id2'])
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({ 'Content-Type': 'text/csv' }),
      )
      expect(res.set.mock.calls[0][0]['Content-Disposition']).toContain('p.csv')
      expect(res.send).toHaveBeenCalledWith('a,b\n1,2\n')
    })

    it('drops empty id segments and passes undefined when ids is empty', async () => {
      mockService.exportCsv.mockResolvedValue(
        ok({ content: '', contentType: 'text/csv', fileName: 'all.csv' }),
      )
      await controller.exportCsv('', makeRes())
      expect(mockService.exportCsv).toHaveBeenCalledWith(undefined)
    })

    it('throws NotFound when the service fails', async () => {
      mockService.exportCsv.mockResolvedValue(fail('not found'))
      await expect(controller.exportCsv('x', makeRes())).rejects.toThrow(NotFoundException)
    })
  })

  describe('exportJson', () => {
    it('returns service value', async () => {
      mockService.exportJson.mockResolvedValue(ok([{ id: '1' }]))
      expect(await controller.exportJson('1')).toEqual([{ id: '1' }])
      expect(mockService.exportJson).toHaveBeenCalledWith(['1'])
    })

    it('passes undefined when ids missing', async () => {
      mockService.exportJson.mockResolvedValue(ok([]))
      await controller.exportJson(undefined as any)
      expect(mockService.exportJson).toHaveBeenCalledWith(undefined)
    })
  })

  describe('generateReport', () => {
    it('returns service value', async () => {
      mockService.generateReport.mockResolvedValue(ok({ name: 'P', sections: [] }))
      expect(await controller.getReport('p-1')).toEqual({ name: 'P', sections: [] })
    })

    it('throws NotFound on failure', async () => {
      mockService.generateReport.mockResolvedValue(fail('Projet non trouvé'))
      await expect(controller.getReport('p-1')).rejects.toThrow(NotFoundException)
    })
  })

  describe('getReportData', () => {
    it('returns the structured service value', async () => {
      const payload = { project: { id: 'p-1', name: 'P' }, fields: [], workPackages: [] }
      mockService.generateReportData.mockResolvedValue(ok(payload))
      expect(await controller.getReportData('p-1')).toEqual(payload)
      expect(mockService.generateReportData).toHaveBeenCalledWith('p-1')
    })

    it('throws NotFound on failure', async () => {
      mockService.generateReportData.mockResolvedValue(fail('Projet non trouvé'))
      await expect(controller.getReportData('p-1')).rejects.toThrow(NotFoundException)
    })
  })
})
