/**
 * @file src/lib/projectReport.ts
 * Per-project report export. Fetches a structured report from the backend
 * (`/api/export/projects/:id/report-data`) and renders it to either CSV or a
 * jsPDF document. jsPDF is lazily imported so it stays out of the main bundle.
 */

import api from './api'
import { downloadBlob } from './download'

/** Mirror of the backend `ProjectReportData` shape (export.service.ts). */
export interface ProjectReportData {
  project: {
    id: string
    name: string
    clientName: string
    pmName: string
    status: string
    priority: string
    startDate: string
    endDate: string
    progressPct: number
  }
  fields: { label: string; value: string }[]
  workPackages: {
    title: string
    status: string
    priority: string
    assignee: string
    startDate: string
    dueDate: string
    percentDone: number
  }[]
}

const CSV_SEP = ';'

/**
 * Sanitise a CSV cell: neutralise spreadsheet formula-injection
 * (`= + - @ \t \r` leaders) and apply RFC-4180 quoting when the value contains
 * the separator, a quote, or a newline. Mirrors the backend `safeCsvCell`.
 */
function safeCsvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  const escaped = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  if (/[";\r\n]/.test(escaped)) return `"${escaped.replace(/"/g, '""')}"`
  return escaped
}

function csvRow(...cells: unknown[]): string {
  return cells.map(safeCsvCell).join(CSV_SEP)
}

/** Build a single-project CSV: metadata block, questionnaire fields, then tasks. */
export function buildProjectCsv(report: ProjectReportData): string {
  const p = report.project
  const lines: string[] = [
    csvRow('RAPPORT DE PROJET'),
    csvRow('Nom', p.name),
    csvRow('Client', p.clientName),
    csvRow('Chef de projet', p.pmName),
    csvRow('Statut', p.status),
    csvRow('Priorité', p.priority),
    csvRow('Date début', p.startDate),
    csvRow('Date fin', p.endDate),
    csvRow('Avancement', `${p.progressPct}%`),
    '',
    csvRow('CHAMPS DU QUESTIONNAIRE'),
    csvRow('Champ', 'Valeur'),
    ...report.fields.map((f) => csvRow(f.label, f.value)),
    '',
    csvRow('TÂCHES'),
    csvRow('Titre', 'Statut', 'Priorité', 'Assigné à', 'Date début', 'Échéance', 'Avancement'),
    ...report.workPackages.map((w) =>
      csvRow(w.title, w.status, w.priority, w.assignee, w.startDate, w.dueDate, `${w.percentDone}%`),
    ),
  ]
  // BOM so Excel detects UTF-8; CRLF line endings per RFC 4180.
  return '﻿' + lines.join('\r\n')
}

/** Safely read the y-coordinate after the last autoTable, with a fallback. */
function autoTableFinalY(doc: unknown, fallback: number): number {
  const y = (doc as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY
  return typeof y === 'number' ? y : fallback
}

const TEAL: [number, number, number] = [13, 148, 136]

/** Build a single-project PDF report as a Blob. jsPDF is imported lazily. */
export async function buildProjectPdf(report: ProjectReportData): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const p = report.project

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const marginX = 40
  let y = 50

  doc.setFontSize(18)
  doc.text(p.name, marginX, y)
  y += 18
  doc.setFontSize(10)
  doc.setTextColor(110)
  doc.text(
    `Client : ${p.clientName}   |   Statut : ${p.status}   |   Avancement : ${p.progressPct}%`,
    marginX,
    y,
  )
  doc.setTextColor(0)
  y += 14

  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2 },
    body: [
      ['Chef de projet', p.pmName],
      ['Priorité', p.priority],
      ['Période', `${p.startDate} → ${p.endDate}`],
    ],
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 130 } },
  })
  y = autoTableFinalY(doc, y) + 24

  if (report.fields.length) {
    doc.setFontSize(13)
    doc.text('Questionnaire', marginX, y)
    y += 6
    autoTable(doc, {
      startY: y,
      head: [['Champ', 'Valeur']],
      body: report.fields.map((f) => [f.label, f.value]),
      styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: TEAL },
      columnStyles: { 0: { cellWidth: 170, fontStyle: 'bold' } },
    })
    y = autoTableFinalY(doc, y) + 24
  }

  doc.setFontSize(13)
  doc.text('Tâches', marginX, y)
  y += 6
  autoTable(doc, {
    startY: y,
    head: [['Titre', 'Statut', 'Priorité', 'Assigné à', 'Début', 'Échéance', '%']],
    body: report.workPackages.length
      ? report.workPackages.map((w) => [
          w.title,
          w.status,
          w.priority,
          w.assignee,
          w.startDate,
          w.dueDate,
          `${w.percentDone}%`,
        ])
      : [['Aucune tâche', '', '', '', '', '', '']],
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: TEAL },
  })

  return doc.output('blob')
}

/** kebab-case slug of the project name for use in a download filename. */
function reportFileName(report: ProjectReportData, ext: 'csv' | 'pdf'): string {
  const slug =
    report.project.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'projet'
  const date = new Date().toISOString().slice(0, 10)
  return `rapport-${slug}-${date}.${ext}`
}

/** Fetch the structured report for a single project. */
export async function fetchProjectReport(projectId: string): Promise<ProjectReportData> {
  const { data } = await api.get<ProjectReportData>(
    `/api/export/projects/${projectId}/report-data`,
  )
  return data
}

/** Fetch + build + download the project report as CSV. */
export async function exportProjectCsv(projectId: string): Promise<void> {
  const report = await fetchProjectReport(projectId)
  const blob = new Blob([buildProjectCsv(report)], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(reportFileName(report, 'csv'), blob)
}

/** Fetch + build + download the project report as PDF. */
export async function exportProjectPdf(projectId: string): Promise<void> {
  const report = await fetchProjectReport(projectId)
  const blob = await buildProjectPdf(report)
  downloadBlob(reportFileName(report, 'pdf'), blob)
}
