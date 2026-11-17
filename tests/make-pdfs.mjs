// Test PDF'leri üretir: metin katmanlı çizili PDF, taranmış (yalnızca görüntü) çizili PDF, çizimsiz PDF.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFHexString, PDFString } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const here = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(here, 'fixtures');
const FONT = '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf';

const SIZE = 12;
const LEFT = 72;

// Gerçek PDF'lerde olduğu gibi kalıcı belge kimliği (dosya yeniden kaydedilse de değişmez).
function setId(doc, hex) {
  doc.context.trailerInfo.ID = doc.context.obj([PDFHexString.of(hex), PDFHexString.of(hex)]);
}

function annotate(doc, page, annots) {
  const refs = annots.map((a) => doc.context.register(doc.context.obj(a)));
  page.node.set(PDFName.of('Annots'), doc.context.obj(refs));
}

// Bir satırın [from, to) harf aralığını kaplayan dörtgen (QuadPoints sırası: üst-sol, üst-sağ, alt-sol, alt-sağ).
function quad(font, line, y, from = 0, to = line.length) {
  const x0 = LEFT + font.widthOfTextAtSize(line.slice(0, from), SIZE);
  const x1 = LEFT + font.widthOfTextAtSize(line.slice(0, to), SIZE);
  const top = y + SIZE * 0.8, bottom = y - SIZE * 0.22;
  return { points: [x0, top, x1, top, x0, bottom, x1, bottom], rect: [x0, bottom, x1, top] };
}

function markup(subtype, quads, extra = {}) {
  const xs = quads.flatMap((q) => [q.rect[0], q.rect[2]]);
  const ys = quads.flatMap((q) => [q.rect[1], q.rect[3]]);
  return {
    Type: 'Annot', Subtype: subtype, F: 4, C: [1, 0.85, 0.2],
    Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    QuadPoints: quads.flatMap((q) => q.points),
    M: PDFString.of('D:20261101120000Z'),
    ...extra,
  };
}

export const P1 = [
  'Öz-yeterlik inancı, bireyin belirli bir işi başarma kapasitesine',
  'ilişkin yargısıdır ve öğrenme sürecinde belirleyici bir rol oy-',
  'nar. Bu nedenle öğretmenlerin geri bildirimleri önem taşır.',
  'Araştırmalar, yüksek öz-yeterliğin akademik başarıyı yordadığını gösteriyor.',
];
export const P2 = [
  'Self-efficacy beliefs determine how people feel, think, and behave.',
  'Mastery experiences are the most effective way of creating a strong sense of efficacy.',
];

async function textPdf({ extraHighlight = false, withMeta = true } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(FONT), { subset: false });
  if (withMeta) { doc.setTitle('Öz-yeterlik ve Öğrenme'); doc.setAuthor('Yılmaz, A.'); }
  setId(doc, withMeta ? 'a1'.repeat(16) : 'b2'.repeat(16));

  const p1 = doc.addPage([612, 792]);
  P1.forEach((line, i) => p1.drawText(line, { x: LEFT, y: 700 - i * 16, size: SIZE, font }));
  const start = P1[0].indexOf('bireyin');
  const a1 = [
    markup('Highlight', [quad(font, P1[0], 700, start), quad(font, P1[1], 684), quad(font, P1[2], 668, 0, 4)]),
    markup('Highlight', [quad(font, P1[2], 668, P1[2].indexOf('geri'), P1[2].indexOf(' önem'))], {
      C: [0.4, 0.8, 0.4], Contents: PDFHexString.fromText('yöntem bölümünde kullan'),
    }),
  ];
  if (extraHighlight) a1.push(markup('Highlight', [quad(font, P1[3], 652, 0, P1[3].indexOf(' gösteriyor'))]));
  annotate(doc, p1, a1);

  const p2 = doc.addPage([612, 792]);
  P2.forEach((line, i) => p2.drawText(line, { x: LEFT, y: 700 - i * 16, size: SIZE, font }));
  annotate(doc, p2, [
    markup('Underline', [quad(font, P2[0], 700)]),
    { Type: 'Annot', Subtype: 'Text', F: 4, Rect: [400, 600, 420, 620], Contents: PDFHexString.fromText('Bu bölümü tekrar oku') },
  ]);

  // Sayfa etiketleri: dergi makalesi gibi 233'ten başlasın.
  doc.catalog.set(PDFName.of('PageLabels'), doc.context.obj({ Nums: [0, { S: 'D', St: 233 }] }));
  return doc.save();
}

async function scanPdf() {
  const { chromium } = await import('./pw.mjs');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 612, height: 792 }, deviceScaleFactor: 3 });
  await page.setContent(`<body style="margin:0;background:#fff;font:15px/26px 'Liberation Serif',serif;color:#111">
    <div style="position:absolute;left:72px;top:120px;width:468px">
      <div>Okuma, yalnızca sözcükleri çözmek değildir.</div>
      <div id="hl">Anlam, okurun metinle kurduğu ilişkide ortaya çıkar.</div>
      <div>Bu yüzden her okuma aynı zamanda bir yorumdur.</div>
    </div></body>`);
  const box = await page.locator('#hl').boundingBox();
  const png = await page.screenshot();
  await browser.close();

  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png);
  const p = doc.addPage([612, 792]);
  p.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  const x0 = box.x - 2, x1 = box.x + box.width + 2;
  const top = 792 - box.y - 3, bottom = 792 - box.y - box.height + 3;
  annotate(doc, p, [{
    Type: 'Annot', Subtype: 'Highlight', F: 4, C: [1, 0.9, 0.1], Rect: [x0, bottom, x1, top],
    QuadPoints: [x0, top, x1, top, x0, bottom, x1, bottom],
  }]);
  doc.setTitle('Taranmış Kitap');
  setId(doc, 'c3'.repeat(16));
  return doc.save();
}

async function plainPdf() {
  const doc = await PDFDocument.create();
  const p = doc.addPage([612, 792]);
  p.drawText('No highlights here.', { x: LEFT, y: 700, size: SIZE });
  return doc.save();
}

export async function makeFixtures() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'oz-yeterlik.pdf'), await textPdf());
  fs.writeFileSync(path.join(OUT, 'oz-yeterlik-v2.pdf'), await textPdf({ extraHighlight: true }));
  fs.writeFileSync(path.join(OUT, 'Bandura - 1997 - Self-efficacy.pdf'), await textPdf({ withMeta: false }));
  fs.writeFileSync(path.join(OUT, 'taranmis.pdf'), await scanPdf());
  fs.writeFileSync(path.join(OUT, 'cizimsiz.pdf'), await plainPdf());
  return OUT;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await makeFixtures());
}
