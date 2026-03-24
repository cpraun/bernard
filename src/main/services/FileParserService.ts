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
import { copyFileSync, existsSync, readFileSync, statSync } from 'fs'
import { extname, basename, join } from 'path'
import { PDFParse } from 'pdf-parse'
import { getProviderConfig } from './ConfigService'
import JSZip from 'jszip'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: MsgReader } = require('@kenjiuno/msgreader')

export interface ParsedFile {
  filename: string
  content: string
  type: 'text' | 'md' | 'pdf' | 'msg' | 'eml' | 'docx' | 'jpg' | 'png'
  size: number
  contentLength: number
  mediaType?: string
}


/** Extract tracked changes (insertions/deletions) from a .docx file's XML */
async function extractDocxRevisions(filePath: string): Promise<string | null> {
  try {
    const buffer = readFileSync(filePath)
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('word/document.xml')?.async('string')
    if (!xml) return null

    const revisions: string[] = []

    // Extract insertions: <w:ins ...>...<w:t>text</w:t>...</w:ins>
    const insPattern = /<w:ins\b([^>]*)>([\s\S]*?)<\/w:ins>/g
    let m: RegExpExecArray | null
    while ((m = insPattern.exec(xml)) !== null) {
      const attrs = m[1]
      const inner = m[2]
      const author = attrs.match(/w:author="([^"]*)"/)
      const date = attrs.match(/w:date="([^"]*)"/)
      const textParts: string[] = []
      const tPattern = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g
      let tm: RegExpExecArray | null
      while ((tm = tPattern.exec(inner)) !== null) {
        textParts.push(tm[1])
      }
      const text = textParts.join('')
      if (!text) continue
      const truncated = text.length > 120 ? text.slice(0, 120) + '…' : text
      const meta: string[] = []
      if (author) meta.push(`by ${author[1]}`)
      if (date) meta.push(date[1].slice(0, 10))
      revisions.push(`+ Inserted${meta.length ? ` (${meta.join(', ')})` : ''}: "${truncated}"`)
    }

    // Extract deletions: <w:del ...>...<w:delText>text</w:delText>...</w:del>
    const delPattern = /<w:del\b([^>]*)>([\s\S]*?)<\/w:del>/g
    while ((m = delPattern.exec(xml)) !== null) {
      const attrs = m[1]
      const inner = m[2]
      const author = attrs.match(/w:author="([^"]*)"/)
      const date = attrs.match(/w:date="([^"]*)"/)
      const textParts: string[] = []
      const dtPattern = /<w:delText[^>]*>([\s\S]*?)<\/w:delText>/g
      let tm: RegExpExecArray | null
      while ((tm = dtPattern.exec(inner)) !== null) {
        textParts.push(tm[1])
      }
      const text = textParts.join('')
      if (!text) continue
      const truncated = text.length > 120 ? text.slice(0, 120) + '…' : text
      const meta: string[] = []
      if (author) meta.push(`by ${author[1]}`)
      if (date) meta.push(date[1].slice(0, 10))
      revisions.push(`- Deleted${meta.length ? ` (${meta.join(', ')})` : ''}: "${truncated}"`)
    }

    if (revisions.length === 0) return null
    return `[Tracked Changes]\n${revisions.join('\n')}`
  } catch {
    return null
  }
}

const KEEP_HEADERS = /^(from|to|cc|bcc|subject|date):/i

/** Strip all EML headers except From, To, CC, BCC, Subject, Date. */
export function filterEmlHeaders(raw: string): string {
  const splitIdx = raw.search(/\r?\n\r?\n/)
  if (splitIdx === -1) return raw

  const headerBlock = raw.slice(0, splitIdx)
  const body = raw.slice(splitIdx) // includes the blank-line separator

  const lines = headerBlock.split(/\r?\n/)
  const filtered: string[] = []
  let keeping = false

  for (const line of lines) {
    if (/^\s/.test(line)) {
      if (keeping) filtered.push(line)
    } else {
      keeping = KEEP_HEADERS.test(line)
      if (keeping) filtered.push(line)
    }
  }

  return filtered.join('\n') + body
}

export async function parseFile(filePath: string, onProgress?: (msg: string) => void): Promise<ParsedFile> {
  const ext = extname(filePath).toLowerCase()
  const filename = basename(filePath)
  const fileSize = statSync(filePath).size

  switch (ext) {
    case '.md': {
      const content = readFileSync(filePath, 'utf-8')
      return { filename, content, type: 'md', size: fileSize, contentLength: content.length }
    }
    case '.eml': {
      const raw = readFileSync(filePath, 'utf-8')
      const content = filterEmlHeaders(raw)
      return { filename, content, type: 'eml', size: fileSize, contentLength: content.length }
    }
    case '.txt':
    case '.csv':
    case '.json':
    case '.xml':
    case '.html':
    case '.css':
    case '.js':
    case '.ts':
    case '.py':
    case '.log': {
      const content = readFileSync(filePath, 'utf-8')
      return { filename, content, type: 'text', size: fileSize, contentLength: content.length }
    }
    case '.pdf': {
      const parser = new PDFParse({ url: filePath })
      const data = await parser.getText()
      const content = data.text
      return { filename, content, type: 'pdf', size: fileSize, contentLength: content.length }
    }
    case '.msg': {
      const buffer = readFileSync(filePath)
      const reader = new MsgReader(buffer.buffer as ArrayBuffer)
      const msg = reader.getFileData()

      const headerParts: string[] = []
      if (msg.senderName || msg.senderEmail) {
        headerParts.push(`From: ${msg.senderName || ''}${msg.senderEmail ? ` <${msg.senderEmail}>` : ''}`)
      }
      if (msg.recipients && msg.recipients.length > 0) {
        const toRecipients = msg.recipients
          .filter((r) => !r.recipType || r.recipType === 'to')
          .map((r) => (r.name || '') + (r.email ? ` <${r.email}>` : ''))
          .join(', ')
        if (toRecipients) headerParts.push(`To: ${toRecipients}`)
        const ccRecipients = msg.recipients
          .filter((r) => r.recipType === 'cc')
          .map((r) => (r.name || '') + (r.email ? ` <${r.email}>` : ''))
          .join(', ')
        if (ccRecipients) headerParts.push(`Cc: ${ccRecipients}`)
        const bccRecipients = msg.recipients
          .filter((r) => r.recipType === 'bcc')
          .map((r) => (r.name || '') + (r.email ? ` <${r.email}>` : ''))
          .join(', ')
        if (bccRecipients) headerParts.push(`Bcc: ${bccRecipients}`)
      }
      if (msg.clientSubmitTime) headerParts.push(`Date: ${msg.clientSubmitTime}`)
      if (msg.subject) headerParts.push(`Subject: ${msg.subject}`)

      // Prefer HTML body for rich rendering; fall back to plain text
      const htmlBody = msg.bodyHtml
        ?? (msg.html ? Buffer.from(msg.html).toString('utf-8') : undefined)

      if (htmlBody) {
        const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        const headerHtml = headerParts.map((h) => `<div style="font-family:sans-serif;font-size:13px;color:#666">${esc(h)}</div>`).join('\n')
        const content = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:12px">\n${headerHtml}\n<hr style="border:none;border-top:1px solid #ddd;margin:10px 0">\n${htmlBody}\n</body></html>`
        return { filename, content, type: 'msg', size: fileSize, contentLength: content.length }
      }

      const parts = [...headerParts]
      if (parts.length > 0) parts.push('')
      if (msg.body) parts.push(msg.body)
      const content = parts.join('\n')
      return { filename, content, type: 'msg', size: fileSize, contentLength: content.length }
    }
    case '.docx': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require('mammoth')
      const result = await mammoth.extractRawText({ path: filePath })
      let content: string = result.value
      const revisions = await extractDocxRevisions(filePath)
      if (revisions) {
        content += '\n\n' + revisions
      }
      return { filename, content, type: 'docx', size: fileSize, contentLength: content.length }
    }
    case '.jpg':
    case '.jpeg': {
      const content = readFileSync(filePath).toString('base64')
      return { filename, content, type: 'jpg', size: fileSize, contentLength: content.length, mediaType: 'image/jpeg' }
    }
    case '.png': {
      const content = readFileSync(filePath).toString('base64')
      return { filename, content, type: 'png', size: fileSize, contentLength: content.length, mediaType: 'image/png' }
    }
    default:
      throw new Error(`Unsupported file type: ${ext}. Supported: .txt, .pdf, .msg, .docx, .jpg, .png`)
  }
}

export async function ocrPdfFile(filePath: string, onProgress?: (msg: string) => void): Promise<string> {
  const config = getProviderConfig('gemini')
  if (!config?.apiKey) throw new Error('Gemini API key not configured — needed for Cloud Vision OCR')

  const parser = new PDFParse({ url: filePath })
  const screenshots = await parser.getScreenshot({ imageBuffer: true, imageDataUrl: false })
  const pages: string[] = []

  for (let i = 0; i < screenshots.pages.length; i++) {
    onProgress?.(`Cloud Vision OCR (page ${i + 1}/${screenshots.pages.length})…`)
    const imageBase64 = Buffer.from(screenshots.pages[i].data).toString('base64')

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: imageBase64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
          }]
        })
      }
    )

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Cloud Vision API error (${response.status}): ${err}`)
    }

    const data = await response.json()
    const annotation = data.responses?.[0]?.fullTextAnnotation
    if (annotation?.text) {
      pages.push(annotation.text.trim())
    }
  }

  return pages.join('\n\n')
}

export function copyFileToDir(filePath: string, targetDir: string): string {
  const filename = basename(filePath)
  let destPath = join(targetDir, filename)
  // Avoid overwriting: append counter if file exists
  if (existsSync(destPath)) {
    const ext = extname(filename)
    const name = filename.slice(0, -ext.length || undefined)
    let counter = 1
    while (existsSync(destPath)) {
      destPath = join(targetDir, `${name}-${counter++}${ext}`)
    }
  }
  copyFileSync(filePath, destPath)
  return destPath
}
