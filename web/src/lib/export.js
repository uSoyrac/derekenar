// Seçilen alıntıları kaynaklarına göre gruplayıp Markdown ya da Word belgesi üretir.
import { citation, reference, sourceLabel } from './util.js';

const pageNum = (p) => { const n = parseInt(p, 10); return Number.isNaN(n) ? Infinity : n; };

export function groupBySource(quotes, sourceById) {
  const groups = new Map();
  for (const q of quotes) {
    const key = q.source_id || '';
    if (!groups.has(key)) groups.set(key, { source: sourceById.get(q.source_id) || null, quotes: [] });
    groups.get(key).quotes.push(q);
  }
  const list = [...groups.values()];
  for (const g of list) {
    g.quotes.sort((a, b) => pageNum(a.page) - pageNum(b.page) || a.created_at.localeCompare(b.created_at));
  }
  list.sort((a, b) => sourceLabel(a.source).localeCompare(sourceLabel(b.source), 'tr'));
  return list;
}

export function toMarkdown(title, quotes, sourceById) {
  const groups = groupBySource(quotes, sourceById);
  const out = [`# ${title}`, ''];
  for (const g of groups) {
    out.push(`## ${g.source ? sourceLabel(g.source) : 'Kaynaksız notlar'}`, '');
    for (const q of g.quotes) {
      if (q.text) out.push(`> ${q.text.replace(/\n/g, '\n> ')} ${citation(g.source, q.page)}`.trimEnd(), '');
      if (q.note) out.push(`**Not:** ${q.note}`, '');
      if (q.tags?.length) out.push(q.tags.map((t) => `#${t.replace(/\s+/g, '-')}`).join(' '), '');
    }
  }
  const refs = groups.filter((g) => g.source).map((g) => reference(g.source));
  if (refs.length) out.push('## Kaynakça', '', ...refs.map((r) => `- ${r}`), '');
  return out.join('\n');
}

export async function toDocx(title, quotes, sourceById) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const groups = groupBySource(quotes, sourceById);
  const children = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })];
  for (const g of groups) {
    children.push(new Paragraph({ text: g.source ? sourceLabel(g.source) : 'Kaynaksız notlar', heading: HeadingLevel.HEADING_2, spacing: { before: 320, after: 120 } }));
    for (const q of g.quotes) {
      if (q.text) {
        children.push(new Paragraph({
          indent: { left: 480 }, spacing: { after: 100 },
          children: [new TextRun({ text: `“${q.text}” ` }), new TextRun({ text: citation(g.source, q.page), color: '555555' })],
        }));
      }
      if (q.note) {
        children.push(new Paragraph({
          spacing: { after: 160 },
          children: [new TextRun({ text: 'Not: ', bold: true }), new TextRun({ text: q.note })],
        }));
      }
    }
  }
  const refs = groups.filter((g) => g.source).map((g) => reference(g.source));
  if (refs.length) {
    children.push(new Paragraph({ text: 'Kaynakça', heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 120 } }));
    for (const r of refs) children.push(new Paragraph({ text: r, indent: { left: 480, hanging: 480 }, spacing: { after: 100 } }));
  }
  const doc = new Document({
    creator: 'Derkenar', title,
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}
