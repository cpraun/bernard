/*
 * Copyright 2026 Christoph von Praun
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { getProjectDir } from '../services/ProjectService'
import { loadConfig } from '../services/ConfigService'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ImageRun,
  ShadingType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle
} from 'docx'
import katex from 'katex'
import JSZip from 'jszip'

// ---------------------------------------------------------------------------
// Markdown → docx conversion helpers
// ---------------------------------------------------------------------------

interface Segment {
  type: 'text' | 'display-math' | 'inline-math'
  value: string
}

/** Split markdown into text and math segments */
function splitMathSegments(md: string): Segment[] {
  const segments: Segment[] = []
  // Match $$...$$ (display) and $...$ (inline), non-greedy
  const pattern = /(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(md)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: md.slice(lastIndex, match.index) })
    }
    const raw = match[0]
    if (raw.startsWith('$$')) {
      segments.push({ type: 'display-math', value: raw.slice(2, -2).trim() })
    } else {
      segments.push({ type: 'inline-math', value: raw.slice(1, -1).trim() })
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < md.length) {
    segments.push({ type: 'text', value: md.slice(lastIndex) })
  }
  return segments
}

/** Parse inline formatting within a text fragment and return TextRun[] */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = []
  // Handle bold, italic, inline code, and plain text
  const inlinePattern = /(\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\*(.+?)\*|_([^_]+?)_)/g
  let lastIdx = 0
  let m: RegExpExecArray | null
  while ((m = inlinePattern.exec(text)) !== null) {
    if (m.index > lastIdx) {
      runs.push(new TextRun({ text: text.slice(lastIdx, m.index) }))
    }
    if (m[2] || m[3]) {
      // Bold
      runs.push(new TextRun({ text: m[2] || m[3], bold: true }))
    } else if (m[4]) {
      // Inline code
      runs.push(
        new TextRun({
          text: m[4],
          font: { name: 'Courier New' },
          shading: { type: ShadingType.CLEAR, fill: 'E8E8E8' }
        })
      )
    } else if (m[5] || m[6]) {
      // Italic
      runs.push(new TextRun({ text: m[5] || m[6], italics: true }))
    }
    lastIdx = inlinePattern.lastIndex
  }
  if (lastIdx < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIdx) }))
  }
  return runs
}

/** Check if a line is a markdown table separator (e.g. |---|---|) */
function isTableSeparator(line: string): boolean {
  return /^\|?[\s:]*-{3,}[\s:]*(\|[\s:]*-{3,}[\s:]*)*\|?$/.test(line.trim())
}

/** Parse a markdown table row into cell strings */
function parseTableRow(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split('|').map((c) => c.trim())
}

/** Build a docx Table from parsed markdown table lines */
function buildTable(headerLine: string, bodyLines: string[]): Table {
  const headerCells = parseTableRow(headerLine)
  const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: '999999' }
  const cellBorders = {
    top: thinBorder,
    bottom: thinBorder,
    left: thinBorder,
    right: thinBorder
  }

  const headerRow = new TableRow({
    tableHeader: true,
    children: headerCells.map(
      (text) =>
        new TableCell({
          borders: cellBorders,
          shading: { type: ShadingType.CLEAR, fill: 'E8E8E8' },
          children: [
            new Paragraph({ children: [new TextRun({ text, bold: true })] })
          ]
        })
    )
  })

  const dataRows = bodyLines.map((line) => {
    const cells = parseTableRow(line)
    // Pad or trim to match header column count
    while (cells.length < headerCells.length) cells.push('')
    return new TableRow({
      children: cells.slice(0, headerCells.length).map(
        (text) =>
          new TableCell({
            borders: cellBorders,
            children: [
              new Paragraph({ children: parseInlineFormatting(text) })
            ]
          })
      )
    })
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows]
  })
}

/** Convert a block of markdown text (no math) into docx Paragraphs and Tables */
function markdownToParagraphs(text: string): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = []
  const lines = text.split('\n')
  let inCodeBlock = false
  let codeLines: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block start/end
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        elements.push(
          new Paragraph({
            children: [
              new TextRun({
                text: codeLines.join('\n'),
                font: { name: 'Courier New' },
                size: 20
              })
            ],
            shading: { type: ShadingType.CLEAR, fill: 'F0F0F0' },
            spacing: { before: 100, after: 100 }
          })
        )
        codeLines = []
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      i++
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      i++
      continue
    }

    // Markdown table: header row followed by separator row
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headerLine = line
      i += 2 // skip header and separator
      const bodyLines: string[] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        bodyLines.push(lines[i])
        i++
      }
      elements.push(buildTable(headerLine, bodyLines))
      continue
    }

    // Skip empty lines (but add spacing)
    if (line.trim() === '') {
      i++
      continue
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const headingLevels = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4,
        HeadingLevel.HEADING_5,
        HeadingLevel.HEADING_6
      ]
      elements.push(
        new Paragraph({
          heading: headingLevels[level - 1],
          children: parseInlineFormatting(headingMatch[2])
        })
      )
      i++
      continue
    }

    // Blockquotes
    const blockquoteMatch = line.match(/^>\s*(.*)$/)
    if (blockquoteMatch) {
      elements.push(
        new Paragraph({
          indent: { left: 720 },
          children: [
            new TextRun({ text: blockquoteMatch[1], italics: true })
          ]
        })
      )
      i++
      continue
    }

    // Unordered list
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/)
    if (ulMatch) {
      elements.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInlineFormatting(ulMatch[1])
        })
      )
      i++
      continue
    }

    // Ordered list
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/)
    if (olMatch) {
      elements.push(
        new Paragraph({
          numbering: { reference: 'default-numbering', level: 0 },
          children: parseInlineFormatting(olMatch[1])
        })
      )
      i++
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(
        new Paragraph({
          border: { bottom: { style: 'single' as const, size: 6, color: 'CCCCCC' } },
          spacing: { before: 200, after: 200 }
        })
      )
      i++
      continue
    }

    // Regular paragraph
    elements.push(
      new Paragraph({
        children: parseInlineFormatting(line)
      })
    )
    i++
  }

  // Close any unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: codeLines.join('\n'),
            font: { name: 'Courier New' },
            size: 20
          })
        ],
        shading: { type: ShadingType.CLEAR, fill: 'F0F0F0' },
        spacing: { before: 100, after: 100 }
      })
    )
  }

  return elements
}

// ---------------------------------------------------------------------------
// KaTeX → PNG rendering via offscreen BrowserWindow
// ---------------------------------------------------------------------------

async function renderMathToImage(
  latex: string,
  displayMode: boolean
): Promise<{ png: Buffer; width: number; height: number }> {
  // Get KaTeX CSS path from node_modules
  const katexCssPath = join(
    __dirname,
    '../../node_modules/katex/dist/katex.min.css'
  )
  let katexCss: string
  try {
    katexCss = readFileSync(katexCssPath, 'utf-8')
  } catch {
    // Fallback: try relative to app root
    katexCss = ''
  }

  const html = katex.renderToString(latex, {
    displayMode,
    throwOnError: false,
    output: 'html'
  })

  const page = `<!DOCTYPE html><html><head>
<style>${katexCss}</style>
<style>
  body { margin: 0; padding: 8px; background: white; display: inline-block; }
  .katex { font-size: 1.3em; }
</style>
</head><body>${html}</body></html>`

  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 200,
    webPreferences: { offscreen: true }
  })

  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))

    // Wait for fonts to load
    await win.webContents.executeJavaScript('document.fonts.ready')

    // Get actual content size
    const rect = await win.webContents.executeJavaScript(
      `JSON.parse(JSON.stringify(document.body.getBoundingClientRect()))`
    )
    const width = Math.ceil(rect.width) || 200
    const height = Math.ceil(rect.height) || 40

    // Resize window to content
    win.setContentSize(width + 2, height + 2)

    // Small delay for re-render after resize
    await new Promise((resolve) => setTimeout(resolve, 100))

    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: width + 2,
      height: height + 2
    })
    const png = image.toPNG()
    return { png: Buffer.from(png), width, height }
  } finally {
    win.destroy()
  }
}

// ---------------------------------------------------------------------------
// Template styles loading
// ---------------------------------------------------------------------------

async function loadTemplateStyles(): Promise<string | undefined> {
  const config = loadConfig()
  if (!config.wordExportTemplatePath) return undefined
  try {
    const templateBuffer = readFileSync(config.wordExportTemplatePath)
    const zip = await JSZip.loadAsync(templateBuffer)
    const stylesXml = await zip.file('word/styles.xml')?.async('string')
    return stylesXml || undefined
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

export function registerExportHandlers(): void {
  ipcMain.handle(
    'export:messageToDocx',
    async (_event, projectId: string, messageContent: string) => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return undefined

      const projectDir = getProjectDir(projectId)
      const result = await dialog.showSaveDialog(win, {
        defaultPath: join(projectDir, 'export.docx'),
        filters: [{ name: 'Word Document', extensions: ['docx'] }]
      })

      if (result.canceled || !result.filePath) return undefined

      // Split content into text and math segments
      const segments = splitMathSegments(messageContent)

      // Build docx children
      const children: (Paragraph | Table)[] = []

      for (const seg of segments) {
        if (seg.type === 'text') {
          children.push(...markdownToParagraphs(seg.value))
        } else if (seg.type === 'display-math') {
          try {
            const { png, width, height } = await renderMathToImage(seg.value, true)
            children.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 200, after: 200 },
                children: [
                  new ImageRun({
                    data: png,
                    transformation: { width, height },
                    type: 'png'
                  })
                ]
              })
            )
          } catch {
            // Fallback: insert raw LaTeX as text
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `$$${seg.value}$$`,
                    font: { name: 'Courier New' }
                  })
                ]
              })
            )
          }
        } else if (seg.type === 'inline-math') {
          try {
            const { png, width, height } = await renderMathToImage(seg.value, false)
            // Inline math: add as image in its own paragraph (Word doesn't support true inline images easily)
            children.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: png,
                    transformation: { width, height },
                    type: 'png'
                  })
                ]
              })
            )
          } catch {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `$${seg.value}$`,
                    font: { name: 'Courier New' }
                  })
                ]
              })
            )
          }
        }
      }

      // If no content was generated, add a placeholder
      if (children.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: messageContent })] }))
      }

      const externalStyles = await loadTemplateStyles()

      const doc = new Document({
        externalStyles,
        numbering: {
          config: [
            {
              reference: 'default-numbering',
              levels: [
                {
                  level: 0,
                  format: 'decimal' as const,
                  text: '%1.',
                  alignment: AlignmentType.START
                }
              ]
            }
          ]
        },
        sections: [{ children }]
      })

      const buffer = await Packer.toBuffer(doc)
      writeFileSync(result.filePath, buffer)
      return result.filePath
    }
  )
}
