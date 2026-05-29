import { describe, it, expect } from 'vitest'
import { buildProjectCsv, buildProjectPdf, type ProjectReportData } from './projectReport'

function makeReport(overrides: Partial<ProjectReportData> = {}): ProjectReportData {
  return {
    project: {
      id: 'p1',
      name: 'My Project',
      clientName: 'ACME',
      pmName: 'Alice PM',
      status: 'Active',
      priority: 'Normal',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      progressPct: 50,
    },
    fields: [
      { label: 'Stack', value: 'NestJS' },
      { label: 'Budget', value: '' },
    ],
    workPackages: [
      {
        title: 'Setup',
        status: 'Closed',
        priority: 'High',
        assignee: 'Bob Dev',
        startDate: '2026-02-01',
        dueDate: '2026-02-05',
        percentDone: 100,
      },
    ],
    ...overrides,
  }
}

describe('buildProjectCsv', () => {
  it('emits a BOM and the metadata / fields / tasks sections', () => {
    const csv = buildProjectCsv(makeReport())
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('RAPPORT DE PROJET')
    expect(csv).toContain('Nom;My Project')
    expect(csv).toContain('Chef de projet;Alice PM')
    expect(csv).toContain('Avancement;50%')
    expect(csv).toContain('CHAMPS DU QUESTIONNAIRE')
    expect(csv).toContain('Stack;NestJS')
    expect(csv).toContain('Budget;') // empty value
    expect(csv).toContain('TÂCHES')
    expect(csv).toContain('Setup;Closed;High;Bob Dev;2026-02-01;2026-02-05;100%')
  })

  it('uses CRLF line endings', () => {
    const csv = buildProjectCsv(makeReport())
    expect(csv).toContain('\r\n')
  })

  it('quotes cells containing the separator, quotes, or newlines', () => {
    const csv = buildProjectCsv(
      makeReport({ fields: [{ label: 'Note; with ;', value: 'has "quotes"' }] }),
    )
    expect(csv).toContain('"Note; with ;"')
    expect(csv).toContain('"has ""quotes"""')
  })

  it('neutralises spreadsheet formula-injection payloads', () => {
    const csv = buildProjectCsv(
      makeReport({ fields: [{ label: '=cmd', value: '@evil' }] }),
    )
    expect(csv).toContain("'=cmd")
    expect(csv).toContain("'@evil")
  })

  it('still renders task/field section headers when both are empty', () => {
    const csv = buildProjectCsv(makeReport({ fields: [], workPackages: [] }))
    expect(csv).toContain('CHAMPS DU QUESTIONNAIRE')
    expect(csv).toContain('TÂCHES')
  })
})

describe('buildProjectPdf', () => {
  it('produces a non-empty PDF blob', async () => {
    const blob = await buildProjectPdf(makeReport())
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('does not throw when fields and work packages are empty', async () => {
    const blob = await buildProjectPdf(makeReport({ fields: [], workPackages: [] }))
    expect(blob.size).toBeGreaterThan(0)
  })
})
