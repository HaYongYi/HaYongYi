// Converts docs/report.md (a fixed, known subset of Markdown) into a paper-style .docx.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, LevelFormat, PageNumber, Footer, PageBreak,
} = require('docx');

const [,, input, output] = process.argv;
const lines = fs.readFileSync(input, 'utf8').split(/\r?\n/);

const FONT = 'Malgun Gothic';
const BODY = 20; // 10 pt
const PAGE_W = 11906, MARGIN = 1440, TEXT_W = PAGE_W - 2 * MARGIN;

// Inline markup: **bold**, `code`, *italic*
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true, ...base }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas', ...base }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}

const children = [];
let i = 0;
let titleDone = false;
let breakBefore = false;
const takeBreak = () => { const b = breakBefore; breakBefore = false; return b; };

function para(text, opts = {}) {
  children.push(new Paragraph({ children: runs(text), spacing: { after: 120, line: 320 }, ...opts }));
}

function figurePlaceholder(text) {
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    pageBreakBefore: takeBreak(),
    spacing: { before: 160, after: 160 },
    border: { top: { style: BorderStyle.DASHED, size: 6, color: '9AA7B6' }, bottom: { style: BorderStyle.DASHED, size: 6, color: '9AA7B6' } },
    children: [new TextRun({ text: `[캡처 삽입 자리]`, color: '5D6B7A', italics: true })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: runs(text, { size: 18 }),
  }));
}

function table(rows) {
  const cells = rows.map((r) => r.slice(1, -1).split('|').map((c) => c.trim()));
  const header = cells[0];
  const body = cells.slice(2);
  const n = header.length;
  // Column widths follow the longest cell in each column (Korean counts double), with a floor
  const len = (t) => [...t.replace(/[*`]/g, '')].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
  const need = header.map((_, k) => Math.max(9, ...cells.filter((_, r) => r !== 1).map((row) => Math.min(len(row[k] || ''), 36))));
  const total = need.reduce((a, b) => a + b, 0);
  const widths = need.map((w) => Math.floor((w / total) * TEXT_W));
  widths[n - 1] += TEXT_W - widths.reduce((a, b) => a + b, 0);
  const mk = (cols, isHeader) => new TableRow({
    tableHeader: isHeader,
    cantSplit: true,
    children: cols.map((c, k) => new TableCell({
      width: { size: widths[k], type: WidthType.DXA },
      shading: isHeader ? { type: ShadingType.CLEAR, fill: 'E9EDF2', color: 'auto' } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [new Paragraph({ children: runs(c, { size: n >= 8 ? 16 : 18, bold: isHeader || undefined }), spacing: { after: 0 } })],
    })),
  });
  children.push(new Table({ columnWidths: widths, width: { size: TEXT_W, type: WidthType.DXA }, rows: [mk(header, true), ...body.map((r) => mk(r, false))] }));
  children.push(new Paragraph({ spacing: { after: 120 } }));
}

while (i < lines.length) {
  const line = lines[i];
  if (!titleDone && line.startsWith('# ')) {
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun(line.slice(2))] }));
    titleDone = true; i++; continue;
  }
  if (line.startsWith('## ')) { children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: takeBreak(), children: [new TextRun(line.slice(3))] })); i++; continue; }
  if (line.startsWith('### ')) { children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(line.slice(4))] })); i++; continue; }
  if (line.trim() === '---' || line.trim() === '') { i++; continue; }
  if (/^\*\*— .* —\*\*$/.test(line.trim())) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: line.trim().slice(2, -2), size: 24 })] }));
    i++; continue;
  }
  if (line.startsWith('학번 ')) {
    children.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 360 }, children: [new TextRun({ text: line, color: '5D6B7A' })] }));
    i++; continue;
  }
  if (line.trim() === '<<<pagebreak>>>') {
    // The next block starts a new page (a break paragraph of its own can leave a blank page)
    breakBefore = true;
    i++; continue;
  }
  if (line.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
    table(rows); continue;
  }
  if (/^\{.*\}$/.test(line.trim())) { figurePlaceholder(line.trim().slice(1, -1)); i++; continue; }
  if (/^- /.test(line)) {
    children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60, line: 320 }, children: runs(line.slice(2)) }));
    i++; continue;
  }
  const num = line.match(/^(\d+)\. (.*)$/);
  if (num) {
    children.push(new Paragraph({ spacing: { after: 60, line: 320 }, indent: { left: 360, hanging: 360 }, children: [new TextRun(`${num[1]}. `), ...runs(num[2])] }));
    i++; continue;
  }
  // Table captions stay on the same page as their table
  if (/^\*\*표 \d+\.\*\*/.test(line)) { para(line, { keepNext: true, spacing: { before: 120, after: 80 } }); i++; continue; }
  // Paragraph: join wrapped lines until a blank line
  let text = line;
  while (i + 1 < lines.length && lines[i + 1].trim() !== '' && !/^(#|\||- |\d+\. |\{|---)/.test(lines[i + 1])) text += ' ' + lines[++i];
  para(text);
  i++;
}

const doc = new Document({
  creator: '하용이',
  title: '웹 기반 3D 도시 모델을 이용한 서울 도심 스카이라인의 시각·미적 환경 분석',
  styles: {
    default: { document: { run: { font: FONT, size: BODY } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: FONT, size: 32, bold: true }, paragraph: { spacing: { before: 0, after: 160 }, alignment: AlignmentType.CENTER } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true }, paragraph: { spacing: { before: 360, after: 140 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 22, bold: true }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '5D6B7A' })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(output, buf); console.log('wrote', output, buf.length, 'bytes'); });
