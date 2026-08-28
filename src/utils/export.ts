/**
 * 导出工具 - 支持 Markdown、Word、PDF、HTML、图片
 * @ts-nocheck
 */
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { marked } from 'marked';

// ===== 辅助：从 URL 获取图片原始数据 =====
async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    if (url.startsWith('aw-img://') || url.startsWith('/') || url.startsWith('file://') || url.startsWith('uploads/')) {
      if (window.electronAPI?.readImageDataUrl) {
        const result = await window.electronAPI.readImageDataUrl(url);
        if (result?.dataUrl) {
          const base64 = result.dataUrl.replace(/^data:image\/\w+;base64,/, '');
          return new Uint8Array(atob(base64).split('').map(c => c.charCodeAt(0)));
        }
      }
    }
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  } catch {}
  return null;
}

// ===== 辅助：把图片 URL 转为 dataURL =====
async function resolveImageToDataUrl(url: string): Promise<string | null> {
  try {
    // 本地图片
    if (url.startsWith('aw-img://') || url.startsWith('/') || url.startsWith('file://') || url.startsWith('uploads/') || url.startsWith('~')) {
      if (window.electronAPI?.readImageDataUrl) {
        const result = await window.electronAPI.readImageDataUrl(url);
        if (result?.dataUrl) return result.dataUrl;
      }
    }
    // 网络图片直接返回
    if (url.startsWith('http') || url.startsWith('data:')) return url;
    // dataURL 直接返回
    if (url.startsWith('data:')) return url;
  } catch {}
  return null;
}

// ===== 辅助：替换 Markdown 中的图片 URL 为 dataURL =====
async function resolveAllImagesInHtml(html: string): Promise<string> {
  // 匹配 <img src="..." 和 <img src='...'  
  const imgRegex = /<img\s+([^>]*?)src=["']([^"']+)["']([^>]*)>/gi;
  let result = html;
  let match;
  const replacements: Array<{ from: string; to: string }> = [];

  while ((match = imgRegex.exec(html)) !== null) {
    const [full, before, src, after] = match;
    const dataUrl = await resolveImageToDataUrl(src);
    if (dataUrl) {
      replacements.push({ from: full, to: `<img ${before}src="${dataUrl}"${after}>` });
    }
  }

  // 应用替换（从后往前避免位置偏移）
  for (const r of replacements) {
    result = result.split(r.from).join(r.to);
  }

  return result;
}

// ===== 1. 导出 Markdown =====
export async function exportMarkdown(content: string, filename: string): Promise<void> {
  if (window.electronAPI?.saveMarkdownFile) {
    await window.electronAPI.saveMarkdownFile({ filename: `${filename}.md`, content });
  } else {
    downloadFile(`${filename}.md`, content, 'text/markdown');
  }
}

// ===== 辅助：解析内联格式 =====
// 支持: **bold**, __bold__, *italic*, _italic_, `code`, ~~del~~, [text](url)
function parseInlineFormats(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index), size: 24 }));
    }

    const content = match[0];
    if ((content.startsWith('**') && content.endsWith('**')) || (content.startsWith('__') && content.endsWith('__'))) {
      runs.push(new TextRun({ text: content.slice(2, -2), bold: true, size: 24 }));
    } else if ((content.startsWith('*') && content.endsWith('*')) || (content.startsWith('_') && content.endsWith('_'))) {
      runs.push(new TextRun({ text: content.slice(1, -1), italics: true, size: 24 }));
    } else if (content.startsWith('`') && content.endsWith('`')) {
      runs.push(new TextRun({ text: content.slice(1, -1), font: 'Courier New', size: 22, color: 'b45309', shading: { fill: 'fef3c7' } }));
    } else if (content.startsWith('~~') && content.endsWith('~~')) {
      runs.push(new TextRun({ text: content.slice(2, -2), size: 24, strike: true }));
    } else if (content.startsWith('[') && content.includes('](')) {
      runs.push(new TextRun({ text: content.match(/\[([^\]]+)\]/)?.[1] || content, size: 24, color: '059669', underline: {} }));
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex), size: 24 }));
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, size: 24 }));
  }

  return runs;
}

// ===== 2. 导出 Word (.docx) - HTML 方式 =====
// 用 HTML 保存为 .docx，Word 原生支持所有格式和图片
export async function exportWord(content: string, filename: string): Promise<void> {
  // 替换自定义占位符为友好文本
  const cleanContent = content.replace(
    /\[\[配图[：:]([^\]@]{1,60})(?:@([\w-]+))?\]\]/g,
    (_, desc, id) => `[🖼️ 配图: ${desc}${id ? ' · ' + id : ''}]`
  );

  // Markdown → HTML
  const rawHtml = await marked(cleanContent);

  // 图片 URL 全部转 dataURL
  const htmlWithImages = await resolveAllImagesInHtml(rawHtml);

  // 完整的 HTML 文档
  const fullHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="Microsoft Word 15">
<title>${filename}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
</w:WordDocument>
</xml>
<![endif]-->
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Noto Serif SC', 'Source Han Serif SC', 'SimSun', Georgia, serif;
  font-size: 14pt;
  line-height: 1.9;
  color: #111827;
  background: white;
}
h1 {
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
  font-size: 24pt;
  font-weight: bold;
  margin: 0 0 20pt;
  padding: 0 0 10pt;
  border-bottom: 2pt solid #10b981;
  color: #111827;
  page-break-after: avoid;
}
h2 {
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
  font-size: 18pt;
  font-weight: bold;
  margin: 24pt 0 12pt;
  color: #111827;
  page-break-after: avoid;
}
h3 {
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
  font-size: 14pt;
  font-weight: bold;
  margin: 18pt 0 8pt;
  color: #111827;
  page-break-after: avoid;
}
p { margin: 0 0 10pt; text-align: justify; }
ul, ol { margin: 0 0 10pt 24pt; }
li { margin-bottom: 4pt; }
blockquote {
  margin: 12pt 0;
  padding: 10pt 14pt;
  background: #ecfdf5;
  border-left: 4pt solid #10b981;
  color: #374151;
  font-style: italic;
}
code {
  background: #f3f4f6;
  padding: 1pt 4pt;
  border-radius: 3pt;
  font-family: 'Courier New', monospace;
  font-size: 12pt;
  color: #b45309;
}
pre {
  background: #1e293b;
  color: #e2e8f0;
  padding: 12pt;
  border-radius: 6pt;
  font-family: 'Courier New', monospace;
  font-size: 12pt;
  page-break-inside: avoid;
}
pre code { background: transparent; padding: 0; color: inherit; }
table { width: 100%; border-collapse: collapse; margin: 14pt 0; }
th, td { border: 0.5pt solid #e2ebe7; padding: 6pt 10pt; text-align: left; }
th { background: #f8fafb; font-weight: bold; }
img { max-width: 100%; height: auto; margin: 10pt 0; page-break-inside: avoid; }
hr { border: none; border-top: 1pt dashed #e2ebe7; margin: 20pt 0; }
strong { font-weight: bold; }
em { font-style: italic; }
</style>
</head>
<body>
${htmlWithImages}
<div style="margin-top: 32pt; padding-top: 12pt; border-top: 1pt solid #e2ebe7; font-size: 10pt; color: #9ca3af; text-align: center;">
  由 autoWriter 生成
</div>
</body>
</html>`;

  // Word 可以直接打开 HTML 文件，所有格式和图片完美保留
  downloadFile(`${filename}.docx`, fullHtml, 'text/html');
}

// ===== 解析单个 HTML 节点 =====
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseNode(node: any): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [];

  if (!node) return paragraphs;

  const tagName = node.nodeName?.toLowerCase();

  // ===== 空节点 =====
  if (node.nodeType === 3) { // Text node
    const text = node.textContent?.trim();
    if (text) {
      paragraphs.push(new Paragraph({
        children: parseInlineFormats(text),
        spacing: { before: 60, after: 60 },
      }));
    }
    return paragraphs;
  }

  if (tagName === 'br') {
    paragraphs.push(new Paragraph({ text: '' }));
    return paragraphs;
  }

  if (tagName === 'hr') {
    paragraphs.push(new Paragraph({
      border: { bottom: { color: 'e2ebe7', size: 6, space: 4, style: BorderStyle.SINGLE } },
      spacing: { before: 160, after: 160 },
    }));
    return paragraphs;
  }

  // ===== 标题 =====
  if (tagName === 'h1') {
    const text = node.textContent?.trim() || '';
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text, bold: true, size: 48, color: '111827' })],
      heading: HeadingLevel.HEADING_1,
      border: { bottom: { color: '10b981', size: 12, space: 4, style: BorderStyle.SINGLE } },
      spacing: { before: 400, after: 200 },
    }));
    return paragraphs;
  }

  if (tagName === 'h2') {
    const text = node.textContent?.trim() || '';
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text, bold: true, size: 36, color: '111827' })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 320, after: 160 },
    }));
    return paragraphs;
  }

  if (tagName === 'h3') {
    const text = node.textContent?.trim() || '';
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text, bold: true, size: 28, color: '111827' })],
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 240, after: 120 },
    }));
    return paragraphs;
  }

  if (tagName === 'h4' || tagName === 'h5' || tagName === 'h6') {
    const text = node.textContent?.trim() || '';
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text, bold: true, size: 24, color: '111827' })],
      heading: HeadingLevel.HEADING_4,
      spacing: { before: 200, after: 100 },
    }));
    return paragraphs;
  }

  // ===== 图片 =====
  if (tagName === 'img') {
    const src = node.getAttribute?.('src');
    const alt = node.getAttribute?.('alt') || '';
    if (src) {
      const imgData = await fetchImageBytes(src);
      if (imgData) {
        const data = imgData as unknown as Parameters<typeof ImageRun>[0]['data'];
        paragraphs.push(new Paragraph({
          children: [new ImageRun({ data, transformation: { width: 440, height: 330 } })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 160, after: 160 },
        }));
      } else {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: `🖼️ ${alt || '图片'}`, color: '9ca3af', size: 20, italics: true })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 120 },
        }));
      }
    }
    return paragraphs;
  }

  // ===== div/img-placeholder ===== (自定义占位符)
  if (tagName === 'div') {
    const cls = node.getAttribute?.('class') || '';
    if (cls.includes('img-placeholder')) {
      const text = node.textContent?.trim() || '';
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: `🖼️ ${text}`, color: '9ca3af', size: 20, italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 120 },
      }));
      return paragraphs;
    }
    // 普通 div → 递归处理子节点
    for (const child of Array.from(node.childNodes)) {
      const childResult = await parseNode(child);
      paragraphs.push(...childResult);
    }
    return paragraphs;
  }

  // ===== 引用 =====
  if (tagName === 'blockquote') {
    const text = node.textContent?.trim() || '';
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text, italics: true, color: '6b7280', size: 24 })],
      indent: { left: 720 },
      border: { left: { color: '10b981', size: 12, space: 8, style: BorderStyle.SINGLE } },
      shading: { fill: 'ecfdf5' },
      spacing: { before: 120, after: 120 },
    }));
    return paragraphs;
  }

  // ===== 预格式化/代码块 =====
  if (tagName === 'pre' || tagName === 'code') {
    // 找出纯文本内容
    let text = '';
    if (tagName === 'pre') {
      const codeEl = node.querySelector?.('code');
      text = codeEl?.textContent?.trim() || node.textContent?.trim() || '';
    } else {
      // 单行 code（不在 pre 内）
      const parent = node.parentElement;
      if (parent?.nodeName?.toLowerCase() === 'pre') return paragraphs;
      text = node.textContent?.trim() || '';
    }
    if (text) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text, font: 'Courier New', size: 20, color: '1e293b', shading: { fill: 'f1f5f9' } })],
        indent: { left: 360 },
        spacing: { before: 80, after: 80 },
      }));
    }
    return paragraphs;
  }

  // ===== 无序列表 =====
  if (tagName === 'ul') {
    for (const li of Array.from(node.querySelectorAll?.('li') || [])) {
      const el = li as Element;
      const text = el.textContent?.trim() || '';
      if (text) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text, size: 24 })],
          bullet: { level: 0 },
          indent: { left: 720 },
          spacing: { before: 40, after: 40 },
        }));
      }
    }
    return paragraphs;
  }

  // ===== 有序列表 =====
  if (tagName === 'ol') {
    let idx = 1;
    for (const li of Array.from(node.querySelectorAll?.('li') || [])) {
      const el = li as Element;
      const text = el.textContent?.trim() || '';
      if (text) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text, size: 24 })],
          numbering: { reference: 'default-numbering', level: 0 },
          indent: { left: 720 },
          spacing: { before: 40, after: 40 },
        }));
        idx++;
      }
    }
    return paragraphs;
  }

  // ===== 表格 =====
  if (tagName === 'table') {
    const rows = node.querySelectorAll?.('tr') || [];
    if (rows.length > 0) {
      const tableRows: TableRow[] = [];
      for (let ri = 0; ri < rows.length; ri++) {
        const tr = rows[ri] as Element;
        const cells = tr.querySelectorAll?.('th, td') || [];
        tableRows.push(new TableRow({
          children: Array.from(cells).map(cell => {
            const el = cell as Element;
            const cellText = el.textContent?.trim() || '';
            const isHeader = el.nodeName?.toLowerCase() === 'th';
            return new TableCell({
              children: [new Paragraph({
                children: [new TextRun({ text: cellText, size: 22, bold: isHeader })],
              })],
              shading: isHeader ? { fill: 'f8fafb' } : undefined,
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: 'e2ebe7' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: 'e2ebe7' },
                left: { style: BorderStyle.SINGLE, size: 1, color: 'e2ebe7' },
                right: { style: BorderStyle.SINGLE, size: 1, color: 'e2ebe7' },
              },
            });
          }),
        }));
      }
      paragraphs.push(new Paragraph({
        children: [new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: tableRows,
        })],
        spacing: { before: 120, after: 120 },
      }));
    }
    return paragraphs;
  }

  // ===== 段落 / 其他元素 =====
  if (tagName === 'p' || tagName === 'div' || tagName === 'span' || tagName === 'a' || !tagName || tagName === 'body') {
    // 递归处理子节点
    const childParagraphs: Paragraph[] = [];
    for (const child of Array.from(node.childNodes)) {
      const childResult = await parseNode(child);
      childParagraphs.push(...childResult);
    }

    // 如果有多个子段落（来自子列表等），直接返回
    if (childParagraphs.length > 0 && tagName !== 'p' && tagName !== 'span') {
      return childParagraphs;
    }

    // 合并所有 TextRun 为一个段落
    const allRuns: TextRun[] = [];
    for (const child of Array.from(node.childNodes)) {
      const runs = extractRunsFromNode(child as Node);
      allRuns.push(...runs);
    }

    if (allRuns.length > 0) {
      paragraphs.push(new Paragraph({
        children: allRuns,
        spacing: { before: 80, after: 80 },
      }));
    }
    return paragraphs;
  }

  return paragraphs;
}

// ===== 从节点提取 TextRun =====
function extractRunsFromNode(node: Node): TextRun[] {
  const runs: TextRun[] = [];

  if (node.nodeType === 3) { // Text
    const text = node.textContent || '';
    if (text.trim()) {
      runs.push(new TextRun({ text, size: 24 }));
    }
    return runs;
  }

  const el = node as Element;
  const tagName = el.nodeName?.toLowerCase();

  if (tagName === 'strong' || tagName === 'b') {
    const childRuns = extractRunsFromNode(el.firstChild as Node);
    return childRuns.map(r => new TextRun({ ...r, bold: true }));
  }

  if (tagName === 'em' || tagName === 'i') {
    const childRuns = extractRunsFromNode(el.firstChild as Node);
    return childRuns.map(r => new TextRun({ ...r, italics: true }));
  }

  if (tagName === 'code') {
    const parent = (el.parentElement as Element)?.nodeName?.toLowerCase();
    if (parent === 'pre') return [];
    const text = el.textContent || '';
    return [new TextRun({ text, font: 'Courier New', size: 22, color: 'b45309', shading: { fill: 'fef3c7' } })];
  }

  if (tagName === 'del' || tagName === 's' || tagName === 'strike') {
    const childRuns = extractRunsFromNode(el.firstChild as Node);
    return childRuns.map(r => new TextRun({ ...r, strike: true }));
  }

  if (tagName === 'a') {
    const href = el.getAttribute?.('href') || '';
    const text = el.textContent?.trim() || '';
    return [new TextRun({ text, color: '059669', underline: {}, size: 24 })];
  }

  if (tagName === 'img') {
    const alt = el.getAttribute?.('alt') || '';
    return [new TextRun({ text: `🖼️ ${alt}`, color: '9ca3af', size: 20, italics: true })];
  }

  if (tagName === 'br') {
    return [new TextRun({ text: '\n', size: 24 })];
  }

  // 普通文本
  const text = el.textContent || '';
  if (text.trim()) {
    runs.push(new TextRun({ text, size: 24 }));
  }

  return runs;
}

// ===== 3. 导出 PDF =====
export async function exportPDF(content: string, filename: string): Promise<void> {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    left: -9999px;
    top: 0;
    width: 794px;
    padding: 60px;
    background: white;
    font-family: 'Noto Serif SC', 'Songti SC', 'SimSun', serif;
    color: #111827;
    font-size: 12pt;
    line-height: 1.8;
  `;

  const htmlContent = await marked(content);
  container.innerHTML = `
    <style>
      h1 { font-size: 22pt; font-weight: bold; margin: 0 0 20px; padding-bottom: 10px; border-bottom: 2px solid #10b981; }
      h2 { font-size: 16pt; font-weight: bold; margin: 24px 0 12px; }
      h3 { font-size: 13pt; font-weight: bold; margin: 18px 0 8px; }
      p { margin: 0 0 12px; text-align: justify; }
      ul, ol { margin: 0 0 12px; padding-left: 24px; }
      li { margin-bottom: 6px; }
      blockquote { margin: 16px 0; padding: 12px 16px; background: #f0fdf4; border-left: 4px solid #10b981; color: #374151; }
      code { background: #f3f4f6; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 10pt; }
      pre { background: #1e293b; color: #e2e8f0; padding: 12px; border-radius: 6px; overflow-x: auto; }
      pre code { background: transparent; padding: 0; color: inherit; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; }
      th, td { border: 1px solid #e2ebe7; padding: 8px 12px; text-align: left; }
      th { background: #f8fafb; font-weight: bold; }
      img { max-width: 100%; height: auto; margin: 12px 0; }
    </style>
    ${htmlContent}
  `;

  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    const imgWidth = 210;
    const pageHeight = 297;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pageHeight;
    }

    pdf.save(`${filename}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

// ===== 4. 导出 HTML =====
export async function exportHTML(content: string, filename: string, title: string = '文章'): Promise<void> {
  const htmlContent = await marked(content);
  const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', Georgia, serif;
      font-size: 16px;
      line-height: 1.9;
      color: #111827;
      background: #f8fafb;
      padding: 40px 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 60px;
      border-radius: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    h1 {
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
      font-size: 28px;
      font-weight: 700;
      margin: 0 0 24px;
      padding-bottom: 16px;
      border-bottom: 3px solid #10b981;
      color: #111827;
    }
    h2 {
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
      font-size: 20px;
      font-weight: 700;
      margin: 32px 0 16px;
      color: #111827;
    }
    h2::before {
      content: '';
      display: inline-block;
      width: 4px;
      height: 1.2em;
      background: #10b981;
      margin-right: 10px;
      vertical-align: middle;
    }
    h3 {
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
      font-size: 16px;
      font-weight: 600;
      margin: 24px 0 12px;
      color: #111827;
    }
    p { margin: 0 0 16px; text-align: justify; }
    ul, ol { margin: 0 0 16px; padding-left: 24px; }
    li { margin-bottom: 8px; }
    blockquote {
      margin: 20px 0;
      padding: 16px 20px;
      background: #ecfdf5;
      border-left: 4px solid #10b981;
      border-radius: 0 8px 8px 0;
      color: #374151;
    }
    code {
      background: #f3f4f6;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
      font-size: 0.9em;
      color: #f59e0b;
    }
    pre {
      background: #1e293b;
      color: #e2e8f0;
      padding: 16px 18px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 20px 0;
    }
    pre code { background: transparent; padding: 0; color: inherit; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; border-radius: 8px; overflow: hidden; border: 1px solid #e2ebe7; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #e2ebe7; }
    th { background: #f8fafb; font-weight: 600; color: #111827; }
    tr:last-child td { border-bottom: none; }
    a { color: #10b981; text-decoration: underline; text-underline-offset: 2px; }
    img { max-width: 100%; height: auto; border-radius: 8px; margin: 16px 0; box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
    hr { border: none; border-top: 2px dashed #e2ebe7; margin: 32px 0; }
    strong { font-weight: 700; color: #111827; }
    em { font-style: italic; color: #6b7280; }
    @media print {
      body { background: white; padding: 0; }
      .container { box-shadow: none; padding: 40px; }
    }
  </style>
</head>
<body>
  <div class="container">
    ${htmlContent}
  </div>
</body>
</html>`;

  downloadFile(`${filename}.html`, fullHTML, 'text/html');
}

// ===== 5. 导出图片（长图）=====
export async function exportImage(
  content: string,
  filename: string,
  title: string = '文章'
): Promise<void> {
  const htmlContent = await marked(content);

  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    left: -9999px;
    top: 0;
    width: 800px;
    padding: 60px;
    background: linear-gradient(135deg, #ffffff 0%, #f8fafb 100%);
    font-family: 'Noto Serif SC', 'Songti SC', 'SimSun', serif;
    color: #111827;
    font-size: 14px;
    line-height: 2;
  `;

  container.innerHTML = `
    <style>
      .title {
        font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
        font-size: 28px;
        font-weight: 700;
        margin: 0 0 32px;
        padding-bottom: 20px;
        border-bottom: 3px solid #10b981;
        color: #111827;
      }
      h2 { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; font-size: 18px; font-weight: 700; margin: 28px 0 14px; color: #111827; }
      h3 { font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; font-size: 15px; font-weight: 600; margin: 20px 0 10px; color: #111827; }
      p { margin: 0 0 14px; text-align: justify; }
      ul, ol { margin: 0 0 14px; padding-left: 22px; }
      li { margin-bottom: 6px; }
      blockquote { margin: 16px 0; padding: 14px 18px; background: #ecfdf5; border-left: 4px solid #10b981; border-radius: 0 8px 8px 0; color: #374151; }
      code { background: #f3f4f6; padding: 2px 5px; border-radius: 3px; font-family: monospace; font-size: 0.9em; color: #f59e0b; }
      pre { background: #1e293b; color: #e2e8f0; padding: 14px; border-radius: 8px; overflow-x: auto; margin: 16px 0; }
      pre code { background: transparent; padding: 0; color: inherit; }
      img { max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0; }
    </style>
    <div class="title">${title}</div>
    ${htmlContent}
    <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2ebe7; font-size: 11px; color: #9ca3af; text-align: center;">
      由 autoWriter 生成 · ${new Date().toLocaleDateString('zh-CN')}
    </div>
  `;

  document.body.appendChild(container);

  try {
    await new Promise(resolve => setTimeout(resolve, 100));

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: 800,
      height: container.scrollHeight + 100,
    });

    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } finally {
    document.body.removeChild(container);
  }
}

// ===== 辅助函数 =====
function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ===== 导出菜单组件类型 =====
export interface ExportOption {
  id: string;
  label: string;
  icon: string;
  format: string;
}

export const EXPORT_OPTIONS: ExportOption[] = [
  { id: 'md', label: 'Markdown', icon: '📝', format: '.md' },
  { id: 'docx', label: 'Word', icon: '📄', format: '.docx' },
  { id: 'pdf', label: 'PDF', icon: '📕', format: '.pdf' },
  { id: 'html', label: 'HTML', icon: '🌐', format: '.html' },
  { id: 'png', label: '图片', icon: '🖼️', format: '.png' },
];

export async function exportArticle(
  format: string,
  content: string,
  filename: string,
  title?: string
): Promise<void> {
  switch (format) {
    case 'md':
      await exportMarkdown(content, filename);
      break;
    case 'docx':
      await exportWord(content, filename);
      break;
    case 'pdf':
      await exportPDF(content, filename);
      break;
    case 'html':
      await exportHTML(content, filename, title);
      break;
    case 'png':
      await exportImage(content, filename, title);
      break;
    default:
      console.error('Unknown export format:', format);
  }
}
