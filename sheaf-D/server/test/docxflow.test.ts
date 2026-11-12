import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEditableDocx, buildEditablePptx, type FlowPage, type FlowText } from '../src/docxflow.js';

const word = (str: string, x: number, base: number, extra: Partial<FlowText> = {}): FlowText => ({
  str, x, w: str.length * 5, base, size: 10, font: 'Arial', kind: 'sans', bold: false, italic: false, color: '000000', link: null, ...extra,
});

// A 2 x 2 ruled table with a shaded header row, a faint watermark and a line of text above.
function page(): FlowPage {
  const lines = [];
  for (const y of [100, 120, 140]) lines.push({ x1: 50, y1: y, x2: 350, y2: y, color: '333333', lw: 0.75 });
  for (const x of [50, 200, 350]) lines.push({ x1: x, y1: 100, x2: x, y2: 140, color: '333333', lw: 0.75 });
  return {
    w: 400, h: 300,
    texts: [word('Report', 50, 80), word('Name', 55, 114), word('Score', 205, 114), word('Ada', 55, 134), word('91', 205, 134)],
    rects: [{ x: 50, y: 100, w: 300, h: 20, fill: 'DDEEFF', stroke: null, lw: 0, round: false }],
    lines, shapes: [],
    images: [{ x: 100, y: 60, w: 200, h: 200, id: 'crest', faint: true }],
  };
}
const media = { crest: { bytes: new Uint8Array([137, 80, 78, 71]), ext: 'png' as const } };
const none = async () => new Uint8Array(0);

test('a ruled grid becomes a real Word table with its borders and shading', async () => {
  const files = await buildEditableDocx([page()], media, none, { title: 't' });
  const doc = String(files['word/document.xml']);
  assert.equal(doc.match(/<w:tbl>/g)?.length, 1);
  assert.equal(doc.match(/<w:tr[ >]/g)?.length, 2);
  assert.match(doc, /<w:shd [^>]*w:fill="DDEEFF"/);
  assert.match(doc, /w:color="333333"/);
  for (const t of ['Report', 'Name', 'Score', 'Ada', '91']) assert.match(doc, new RegExp(`>${t}<`));
});

test('a faint picture is a watermark behind the text, pinned to the page, not the table', async () => {
  const doc = String((await buildEditableDocx([page()], media, none))['word/document.xml']);
  assert.match(doc, /<wp:anchor [^>]*behindDoc="1"/);
  assert.match(doc, /relativeFrom="page"/);
});

test('PowerPoint gets text boxes, lines and pictures, not a picture of the page', async () => {
  const files = await buildEditablePptx([page()], media, none, { title: 't' });
  const slide = String(files['ppt/slides/slide1.xml']);
  assert.ok((slide.match(/txBox="1"/g)?.length ?? 0) >= 3);
  assert.ok((slide.match(/prst="line"/g)?.length ?? 0) >= 4);
  assert.equal(slide.match(/<p:pic>/g)?.length, 1);
  assert.match(slide, />Score</);
});
