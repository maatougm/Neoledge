import * as fs from 'fs'
import * as path from 'path'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  Header,
  Footer,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  WidthType,
  ShadingType,
  PageNumber,
  PageBreak,
  LevelFormat,
  TableOfContents,
  TabStopType,
  TabStopPosition,
  SectionType,
} from 'docx'
import type { CahierDocxPayload, CahierSection } from './cahier-des-charges.types.js'

// ─── Neoledge brand colors ──────────────────────────────────────────────────

const DARK_COLOR = '3F3F3D'      // Dark charcoal — headers, bars, footer line
const TEAL_COLOR = '00ADB1'      // Neoledge teal accent (accent5)
const GOLD_COLOR = 'F6C900'      // Gold accent bar
const LIGHT_GREY = 'DDDDDC'      // Light grey bar
const TEXT_GREY = '8D8D89'       // Body grey for footer/header text
const WHITE = 'FFFFFF'

// Page dimensions (A4 in DXA — the template uses A4)
const PAGE_WIDTH = 11906
const PAGE_HEIGHT = 16838
const MARGIN_TOP = 1440
const MARGIN_BOTTOM = 1440
const MARGIN_LEFT = 1440
const MARGIN_RIGHT = 1440
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT // ~9026

// ─── Load logo images ───────────────────────────────────────────────────────

const ASSETS_DIR = path.join(__dirname, 'assets')

function loadAsset(name: string): Buffer {
  const filePath = path.join(ASSETS_DIR, name)
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath)
  }
  // Return a tiny transparent 1px PNG as fallback
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: DARK_COLOR }
const tableBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
const noBorder = { style: BorderStyle.NONE, size: 0, color: WHITE }
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

/** Convert markdown-ish text into an array of TextRun elements. */
function markdownToRuns(text: string, baseSize = 22): TextRun[] {
  if (!text) return [new TextRun({ text: '', size: baseSize })]

  const runs: TextRun[] = []
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/)

  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, size: baseSize }))
    } else if (part.startsWith('*') && part.endsWith('*')) {
      runs.push(new TextRun({ text: part.slice(1, -1), italics: true, size: baseSize }))
    } else if (part.startsWith('`') && part.endsWith('`')) {
      runs.push(new TextRun({ text: part.slice(1, -1), font: 'Consolas', size: baseSize - 2 }))
    } else if (part) {
      runs.push(new TextRun({ text: part, size: baseSize }))
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text: '', size: baseSize })]
}

/** Split markdown text into paragraphs, handling lists. */
function markdownToParagraphs(text: unknown): Paragraph[] {
  if (!text) return [new Paragraph({ children: [new TextRun('')] })]

  // The AI occasionally returns arrays of {title,content} or plain objects
  // where a string is expected. Flatten to text instead of crashing on .split.
  let source: string
  if (typeof text === 'string') {
    source = text
  } else if (Array.isArray(text)) {
    source = text
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>
          const title = typeof rec.title === 'string' ? `**${rec.title}**` : ''
          const content = typeof rec.content === 'string' ? rec.content : ''
          return [title, content].filter(Boolean).join('\n')
        }
        return String(item)
      })
      .join('\n\n')
  } else if (typeof text === 'object') {
    source = JSON.stringify(text)
  } else {
    source = String(text)
  }

  const lines = source.split('\n')
  const paragraphs: Paragraph[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      paragraphs.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun('')] }))
      continue
    }

    // Bullet list item
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      paragraphs.push(
        new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          spacing: { after: 60 },
          children: markdownToRuns(trimmed.slice(2)),
        }),
      )
      continue
    }

    // Nested bullet
    if (trimmed.startsWith('  - ') || trimmed.startsWith('  • ')) {
      paragraphs.push(
        new Paragraph({
          numbering: { reference: 'bullets', level: 1 },
          spacing: { after: 40 },
          children: markdownToRuns(trimmed.slice(4)),
        }),
      )
      continue
    }

    // Normal paragraph
    paragraphs.push(
      new Paragraph({
        spacing: { after: 120 },
        children: markdownToRuns(trimmed),
      }),
    )
  }

  return paragraphs
}

// ─── Main DOCX generator ───────────────────────────────────────────────────

export async function generateCahierDocx(payload: CahierDocxPayload): Promise<Uint8Array> {
  const { formData, aiContent, generatedAt } = payload
  const dateStr = new Date(generatedAt).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  // Load logos
  const archimedLogo = loadAsset('archimed-logo.png')
  const neoledgeLogo = loadAsset('neoledge-logo.png')

  // ─── Numbering config ─────────────────────────────────────────────────────

  const numberingConfig = {
    config: [
      {
        reference: 'bullets',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '\u2022',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
          {
            level: 1,
            format: LevelFormat.BULLET,
            text: '\u25E6',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } },
          },
        ],
      },
    ],
  }

  // ─── Shared header (content pages) — 3 colored bars ───────────────────────

  const contentHeader = new Header({
    children: [
      // Document title line with grey text
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: `Cahier des charges \u2014 ${formData.projectName}`,
            size: 16,
            color: TEXT_GREY,
            font: 'Segoe UI',
          }),
        ],
      }),
      // Dark bar
      new Paragraph({
        spacing: { after: 0, before: 0 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: DARK_COLOR, space: 1 } },
        children: [new TextRun({ text: '', size: 4 })],
      }),
      // Gold bar
      new Paragraph({
        spacing: { after: 0, before: 0 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GOLD_COLOR, space: 1 } },
        children: [new TextRun({ text: '', size: 4 })],
      }),
      // Light grey bar
      new Paragraph({
        spacing: { after: 0, before: 0 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LIGHT_GREY, space: 1 } },
        children: [new TextRun({ text: '', size: 4 })],
      }),
    ],
  })

  // ─── Shared footer (content pages) — dark line + logo + page X/Y ─────────

  const contentFooter = new Footer({
    children: [
      // Dark separator line
      new Paragraph({
        spacing: { after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: DARK_COLOR, space: 1 } },
        children: [new TextRun({ text: '', size: 4 })],
      }),
      // Footer content: Archimed logo + © NeoLedge + page number
      new Paragraph({
        tabStops: [
          { type: TabStopType.CENTER, position: Math.round(CONTENT_WIDTH / 2) },
          { type: TabStopType.RIGHT, position: CONTENT_WIDTH },
        ],
        spacing: { before: 0, after: 0 },
        children: [
          new ImageRun({
            type: 'png',
            data: archimedLogo,
            transformation: { width: 22, height: 24 },
            altText: { title: 'Archimed', description: 'Logo Archimed', name: 'archimed-logo' },
          }),
          new TextRun({ text: '  ', size: 16 }),
          new TextRun({ text: '\u00A9 NeoLedge', size: 16, color: TEXT_GREY }),
          new TextRun({ text: '\t', size: 16 }),
          new TextRun({ text: formData.projectName, size: 16, color: TEXT_GREY }),
          new TextRun({ text: '\t', size: 16 }),
          new TextRun({ text: 'Page ', size: 16, color: TEXT_GREY }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: TEXT_GREY }),
          new TextRun({ text: '/', size: 16, color: TEXT_GREY }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: TEXT_GREY }),
        ],
      }),
    ],
  })

  // ─── Cover page footer — company info ─────────────────────────────────────

  const coverFooter = new Footer({
    children: [
      new Paragraph({
        spacing: { before: 0, after: 40 },
        children: [new TextRun({ text: '\u00A9 NeoLedge', size: 16, color: DARK_COLOR })],
      }),
      new Paragraph({
        spacing: { before: 0, after: 40 },
        children: [
          new TextRun({
            text: '49 boulevard de Strasbourg CS 1042, 59044 Lille Cedex, France \u2013 www.neoledge.com',
            size: 16,
            color: TEXT_GREY,
          }),
        ],
      }),
      new Paragraph({
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({
            text: 'RCS Lille M\u00E9tropole B 750 581 712 \u2013 SAS au capital de 1.171.575 EUROS \u2013 SIRET 75058171200015',
            size: 16,
            color: LIGHT_GREY,
          }),
        ],
      }),
    ],
  })

  // ─── Cover page header — dark rectangle with Neoledge logo ────────────────

  const coverHeader = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new ImageRun({
            type: 'png',
            data: neoledgeLogo,
            transformation: { width: 130, height: 40 },
            altText: { title: 'NeoLedge', description: 'Logo NeoLedge', name: 'neoledge-logo' },
          }),
        ],
      }),
    ],
  })

  // ─── Build cover page children ────────────────────────────────────────────

  const coverChildren: (Paragraph | Table)[] = []

  // Spacer
  coverChildren.push(new Paragraph({ spacing: { before: 2400 }, children: [new TextRun('')] }))

  // "CAHIER DES CHARGES" title in teal
  coverChildren.push(
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: 'CAHIER DES CHARGES',
          bold: true,
          size: 40,
          color: TEAL_COLOR,
          font: 'Segoe UI Light',
        }),
      ],
    }),
  )

  // Empty line
  coverChildren.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun('')] }))

  // Project subtitle (large, dark)
  coverChildren.push(
    new Paragraph({
      spacing: { after: 600 },
      children: [
        new TextRun({
          text: formData.projectName,
          bold: true,
          size: 48,
          color: DARK_COLOR,
          font: 'Segoe UI',
        }),
      ],
    }),
  )

  // ── Revision table ──────────────────────────────────────────────────────────

  const revColWidths = [2200, 2200, 4626]
  const revHeaderRow = new TableRow({
    children: [
      new TableCell({
        borders: tableBorders,
        width: { size: revColWidths[0], type: WidthType.DXA },
        shading: { fill: DARK_COLOR, type: ShadingType.CLEAR },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: 'R\u00E9dacteur', bold: true, color: WHITE, size: 20, font: 'Segoe UI' })] })],
      }),
      new TableCell({
        borders: tableBorders,
        width: { size: revColWidths[1], type: WidthType.DXA },
        shading: { fill: DARK_COLOR, type: ShadingType.CLEAR },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: 'Date', bold: true, color: WHITE, size: 20, font: 'Segoe UI' })] })],
      }),
      new TableCell({
        borders: tableBorders,
        width: { size: revColWidths[2], type: WidthType.DXA },
        shading: { fill: DARK_COLOR, type: ShadingType.CLEAR },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: 'Commentaires', bold: true, color: WHITE, size: 20, font: 'Segoe UI' })] })],
      }),
    ],
  })

  const revDataRow = new TableRow({
    children: [
      new TableCell({
        borders: tableBorders,
        width: { size: revColWidths[0], type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: formData.projectManagerName, size: 20 })] })],
      }),
      new TableCell({
        borders: tableBorders,
        width: { size: revColWidths[1], type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: dateStr, size: 20 })] })],
      }),
      new TableCell({
        borders: tableBorders,
        width: { size: revColWidths[2], type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: 'Cr\u00E9ation', size: 20 })] })],
      }),
    ],
  })

  // Empty rows for future revisions
  const emptyRevRow = () =>
    new TableRow({
      children: revColWidths.map(
        (w) =>
          new TableCell({
            borders: tableBorders,
            width: { size: w, type: WidthType.DXA },
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph({ children: [new TextRun({ text: '', size: 20 })] })],
          }),
      ),
    })

  const revisionTable = new Table({
    width: { size: revColWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: revColWidths,
    rows: [revHeaderRow, revDataRow, emptyRevRow(), emptyRevRow()],
  })

  coverChildren.push(revisionTable)

  // Date and contacts below table
  coverChildren.push(new Paragraph({ spacing: { before: 400 }, children: [new TextRun('')] }))
  coverChildren.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: `Date : ${dateStr}`, size: 22, color: DARK_COLOR })],
    }),
  )
  coverChildren.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: 'Client : ', bold: true, size: 22, color: DARK_COLOR }),
        new TextRun({ text: formData.clientName, size: 22 }),
      ],
    }),
  )
  coverChildren.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: 'Chef de projet : ', bold: true, size: 22, color: DARK_COLOR }),
        new TextRun({ text: formData.projectManagerName, size: 22 }),
      ],
    }),
  )
  coverChildren.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Priorit\u00E9 : ', bold: true, size: 22, color: DARK_COLOR }),
        new TextRun({ text: formData.priority, size: 22 }),
      ],
    }),
  )

  // ─── Build main content children ──────────────────────────────────────────

  const content: (Paragraph | Table)[] = []

  // ── SOMMAIRE (Table of Contents) ──────────────────────────────────────────

  content.push(
    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [
        new TextRun({ text: 'SOMMAIRE', bold: true, size: 28, color: DARK_COLOR, font: 'Segoe UI' }),
      ],
    }),
  )
  content.push(
    new TableOfContents('SOMMAIRE', {
      hyperlink: true,
      headingStyleRange: '1-3',
    }),
  )
  content.push(new Paragraph({ children: [new PageBreak()] }))

  // ── 1. Introduction ───────────────────────────────────────────────────────

  content.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Introduction', bold: true })],
    }),
  )

  // 1.1 Objectif du document
  content.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Objectif du document', bold: true })],
    }),
  )
  content.push(...markdownToParagraphs(aiContent.objectifDocument))

  // 1.2 Contexte
  content.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Contexte', bold: true })],
    }),
  )
  content.push(...markdownToParagraphs(aiContent.contexte))

  content.push(new Paragraph({ children: [new PageBreak()] }))

  // ── 2. Présentation du projet ─────────────────────────────────────────────

  content.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: `Pr\u00E9sentation du projet`, bold: true })],
    }),
  )

  // 2.1 Objectif du projet
  content.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Objectif du projet', bold: true })],
    }),
  )
  content.push(...markdownToParagraphs(aiContent.objectifProjet))

  // 2.2 Périmètre
  content.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'P\u00E9rim\u00E8tre', bold: true })],
    }),
  )

  // 2.2.1 Éléments inclus
  content.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_3,
      children: [new TextRun({ text: '\u00C9l\u00E9ments inclus', bold: true })],
    }),
  )
  content.push(...markdownToParagraphs(aiContent.perimetreInclus))

  // 2.2.2 Éléments exclus
  content.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_3,
      children: [new TextRun({ text: '\u00C9l\u00E9ments exclus', bold: true })],
    }),
  )
  content.push(...markdownToParagraphs(aiContent.perimetreExclus))

  // 2.3 Exigences fonctionnelles
  content.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Exigences fonctionnelles', bold: true })],
    }),
  )
  content.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: 'Les exigences fonctionnelles d\u00E9crivent l\u2019ensemble des fonctionnalit\u00E9s que le module devra offrir.',
          size: 22,
        }),
      ],
    }),
  )

  for (const section of aiContent.exigencesFonctionnelles) {
    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: section.title, bold: true })],
      }),
    )
    content.push(...markdownToParagraphs(section.content))
  }

  // 2.4 Architecture technique
  content.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Architecture technique (proposition)', bold: true })],
    }),
  )
  content.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: 'Cette section pr\u00E9sente l\u2019architecture technique propos\u00E9e pour la mise en \u0153uvre de la solution.',
          size: 22,
        }),
      ],
    }),
  )

  for (const section of aiContent.architectureTechnique) {
    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: section.title, bold: true })],
      }),
    )
    content.push(...markdownToParagraphs(section.content))
  }

  // 2.5 Livrables
  content.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Livrables', bold: true })],
    }),
  )
  content.push(...markdownToParagraphs(aiContent.livrables))

  content.push(new Paragraph({ children: [new PageBreak()] }))

  // ── 3. Conclusion ─────────────────────────────────────────────────────────

  content.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'Conclusion', bold: true })],
    }),
  )
  content.push(...markdownToParagraphs(aiContent.conclusion))

  // ── Appendix: questionnaire data (if any fields) ──────────────────────────

  if (formData.fields.length > 0) {
    content.push(new Paragraph({ children: [new PageBreak()] }))
    content.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: 'Annexe : Donn\u00E9es du questionnaire', bold: true })],
      }),
    )

    const fieldColWidths = [3500, 5526]
    const fieldHeaderRow = new TableRow({
      children: [
        new TableCell({
          borders: tableBorders,
          width: { size: fieldColWidths[0], type: WidthType.DXA },
          shading: { fill: DARK_COLOR, type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: 'Champ', bold: true, color: WHITE, size: 20 })] })],
        }),
        new TableCell({
          borders: tableBorders,
          width: { size: fieldColWidths[1], type: WidthType.DXA },
          shading: { fill: DARK_COLOR, type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: 'Valeur', bold: true, color: WHITE, size: 20 })] })],
        }),
      ],
    })

    const fieldRows = formData.fields.map(
      (f) =>
        new TableRow({
          children: [
            new TableCell({
              borders: tableBorders,
              width: { size: fieldColWidths[0], type: WidthType.DXA },
              margins: { top: 60, bottom: 60, left: 120, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text: f.label, bold: true, size: 20 })] })],
            }),
            new TableCell({
              borders: tableBorders,
              width: { size: fieldColWidths[1], type: WidthType.DXA },
              margins: { top: 60, bottom: 60, left: 120, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text: f.value ?? '(non renseign\u00E9)', size: 20 })] })],
            }),
          ],
        }),
    )

    content.push(
      new Table({
        width: { size: fieldColWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
        columnWidths: fieldColWidths,
        rows: [fieldHeaderRow, ...fieldRows],
      }),
    )
  }

  // ─── Build document ───────────────────────────────────────────────────────

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Segoe UI', size: 22 }, // 11pt default — matches template
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true, font: 'Segoe UI', color: TEAL_COLOR },
          paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, font: 'Segoe UI', color: DARK_COLOR },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 24, bold: true, font: 'Segoe UI', color: DARK_COLOR },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 },
        },
      ],
    },
    numbering: numberingConfig,
    sections: [
      // ── Cover page section ──────────────────────────────────────────────────
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: 1800, right: MARGIN_RIGHT, bottom: 1800, left: MARGIN_LEFT },
          },
        },
        headers: { default: coverHeader },
        footers: { default: coverFooter },
        children: coverChildren,
      },
      // ── Main content section ────────────────────────────────────────────────
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN_TOP, right: MARGIN_RIGHT, bottom: MARGIN_BOTTOM, left: MARGIN_LEFT },
          },
        },
        headers: { default: contentHeader },
        footers: { default: contentFooter },
        children: content,
      },
    ],
  })

  return Packer.toBuffer(doc)
}
