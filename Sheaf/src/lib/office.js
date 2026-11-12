// Small writers for .docx, .xlsx and .pptx. Each one builds the bare minimum set of
// OOXML parts that Word, Excel, PowerPoint, LibreOffice and Google Docs all accept.
import JSZip from 'jszip';

const x = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // XML 1.0 forbids most control characters; PDFs carry them surprisingly often.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function rels(list) {
  return `${XML}<Relationships xmlns="${PKG_REL}">${list.map(([id, type, target]) =>
    `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
}

function types(defaults, overrides) {
  return `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${defaults.map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join('')}
${overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')}</Types>`;
}

const finish = (zip, mime) => zip.generateAsync({ type: 'blob', mimeType: mime, compression: 'DEFLATE' });

/* ------------------------------------------------------------------ Word */

/**
 * blocks: { t: 'h', level, text } | { t: 'p', text } | { t: 'li', marker, text } | { t: 'page' }
 * (the shape linesToBlocks produces). Page markers become page breaks.
 */
export async function buildDocx(blocks, { title = '' } = {}) {
  const run = (text) => `<w:r><w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
  const body = [];
  blocks.forEach((b, i) => {
    if (b.t === 'h') body.push(`<w:p><w:pPr><w:pStyle w:val="Heading${b.level}"/></w:pPr>${run(b.text)}</w:p>`);
    else if (b.t === 'li') body.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="720" w:hanging="360"/></w:pPr>${run(`${b.marker || '•'}\t${b.text}`)}</w:p>`);
    else if (b.t === 'p') body.push(`<w:p>${run(b.text)}</w:p>`);
    else if (b.t === 'page' && blocks.slice(i + 1).some((n) => n.t !== 'page')) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  });
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const heading = (n, size) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="${360 - n * 60}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', types([], [
    ['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
    ['/word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
  ]));
  zip.file('_rels/.rels', rootRels('word/document.xml'));
  zip.file('docProps/core.xml', core(title));
  zip.file('word/_rels/document.xml.rels', rels([['rId1', 'styles', 'styles.xml']]));
  zip.file('word/styles.xml', `${XML}<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${heading(1, 36)}${heading(2, 30)}${heading(3, 26)}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr></w:style>
</w:styles>`);
  zip.file('word/document.xml', `${XML}<w:document ${W}><w:body>${body.join('') || '<w:p/>'}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return finish(zip, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

/**
 * Word file that looks like the PDF. Each PDF page becomes its own section with the same
 * page size. Everything that isn't text sits behind the page as one picture, and every
 * piece of text is a paragraph in a frame pinned to where it was on the PDF page, in its
 * own font, size, weight and colour. The text stays normal, editable Word text.
 *
 * pages: [{ w, h, background: Uint8Array | null, frames: [{ x, base, size, w, runs }] }]
 * runs:  [{ text, font, size, bold, italic, color, link }]
 */
export async function buildLayoutDocx(pages, { title = '' } = {}) {
  const tw = (pt) => Math.round(pt * 20);
  const emu = (pt) => Math.round(pt * 12700);
  const relList = [['rId1', 'styles', 'styles.xml'], ['rId2', 'settings', 'settings.xml'], ['rId3', 'fontTable', 'fontTable.xml']];
  const links = new Map();
  const fontsUsed = new Map();
  const zip = new JSZip();
  let shapeId = 1;
  const linkId = (url) => {
    if (!links.has(url)) links.set(url, `rIdL${links.size + 1}`);
    return links.get(url);
  };

  const runXml = (r, tighten) => {
    fontsUsed.set(r.font, r.kind);
    const f = x(r.font);
    const sz = Math.max(2, Math.round(r.size * 2));
    const rPr = `<w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/>${r.bold ? '<w:b/><w:bCs/>' : ''}${r.italic ? '<w:i/><w:iCs/>' : ''}`
      + `${r.color && r.color !== '000000' ? `<w:color w:val="${r.color}"/>` : ''}${tighten ? `<w:spacing w:val="${Math.round(tighten * 20)}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
    return `<w:r>${rPr}<w:t xml:space="preserve">${x(r.text)}</w:t></w:r>`;
  };

  const body = [];
  pages.forEach((pg, i) => {
    // Empty flow paragraphs hold the page picture and the section break. They are made
    // tiny so they never push anything onto a second page.
    const tiny = '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>';
    if (pg.background) {
      const rid = `rIdP${i + 1}`;
      relList.push([rid, 'image', `media/page${i + 1}.png`]);
      zip.file(`word/media/page${i + 1}.png`, pg.background);
      const id = shapeId++;
      body.push(`<w:p><w:pPr>${tiny}</w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1">`
        + `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>`
        + `<wp:extent cx="${emu(pg.w)}" cy="${emu(pg.h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Page ${i + 1}"/>`
        + `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
        + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="page${i + 1}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
        + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(pg.w)}" cy="${emu(pg.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
        + `</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`);
    }
    for (const f of pg.frames) {
      // Exact line height; Word and LibreOffice both put the extra room above the text, so
      // the baseline sits one descent up from the bottom of the line.
      const line = f.size * 1.2;
      const top = Math.max(0, f.base - line + f.size * 0.24);
      // Room to spare on the right, in case Word swaps in a slightly wider font.
      const width = Math.min(Math.max(f.w * 1.25 + 4, f.w + 2), Math.max(f.w + 2, pg.w - f.x));
      const frame = `<w:framePr w:w="${tw(width)}" w:wrap="around" w:hAnchor="page" w:vAnchor="page" w:x="${tw(f.x)}" w:y="${tw(top)}"/>`;
      const content = [];
      for (const r of f.runs) {
        const xml = runXml(r, f.tighten);
        if (r.link && content.length && content.at(-1).link === r.link) content.at(-1).xml += xml;
        else content.push({ link: r.link, xml });
      }
      const inner = content.map((c) => (c.link ? `<w:hyperlink r:id="${linkId(c.link)}" w:history="1">${c.xml}</w:hyperlink>` : c.xml)).join('');
      body.push(`<w:p><w:pPr>${frame}<w:spacing w:before="0" w:after="0" w:line="${tw(line)}" w:lineRule="exact"/><w:ind w:left="0" w:right="0"/><w:jc w:val="left"/></w:pPr>${inner}</w:p>`);
    }
    const sect = `<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="${tw(pg.w)}" w:h="${tw(pg.h)}"${pg.w > pg.h ? ' w:orient="landscape"' : ''}/>`
      + `<w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
    if (i < pages.length - 1) body.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>${sect}</w:pPr></w:p>`);
    else body.push(`<w:p><w:pPr>${tiny}</w:pPr></w:p>${sect}`);
  });

  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const NS = `${W} xmlns:r="${REL}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
  zip.file('[Content_Types].xml', types([['png', 'image/png']], [
    ['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
    ['/word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
    ['/word/settings.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'],
    ['/word/fontTable.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml'],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
  ]));
  zip.file('_rels/.rels', rootRels('word/document.xml'));
  zip.file('docProps/core.xml', core(title));
  zip.file('word/_rels/document.xml.rels', `${XML}<Relationships xmlns="${PKG_REL}">${relList.map(([id, type, target]) =>
    `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}${[...links].map(([url, id]) =>
    `<Relationship Id="${id}" Type="${REL}/hyperlink" Target="${x(url)}" TargetMode="External"/>`).join('')}</Relationships>`);
  zip.file('word/styles.xml', `${XML}<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl w:val="0"/><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/></w:style>
</w:styles>`);
  // No grid snapping or compatibility spacing, so lines sit exactly where they're told to.
  zip.file('word/settings.xml', `${XML}<w:settings ${W}><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
  // The family and stand-in tell Word what to use when the font isn't installed.
  const fallback = { sans: ['Arial', 'swiss', 'variable'], serif: ['Times New Roman', 'roman', 'variable'], mono: ['Courier New', 'modern', 'fixed'] };
  zip.file('word/fontTable.xml', `${XML}<w:fonts ${W}>${[...fontsUsed].map(([name, kind]) => {
    const [alt, family, pitch] = fallback[kind] || fallback.sans;
    return `<w:font w:name="${x(name)}">${alt !== name ? `<w:altName w:val="${alt}"/>` : ''}<w:family w:val="${family}"/><w:pitch w:val="${pitch}"/></w:font>`;
  }).join('')}</w:fonts>`);
  zip.file('word/document.xml', `${XML}<w:document ${NS}><w:body>${body.join('')}</w:body></w:document>`);
  return finish(zip, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

const rootRels = (main) => `${XML}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="${main}"/><Relationship Id="rId2" Type="${PKG_REL}/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

function core(title) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${x(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

/* ----------------------------------------------------------------- Excel */

const col = (i) => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

/** sheets: [{ name, rows: [[string | number | null]] }] */
export async function buildXlsx(sheets) {
  const used = new Set();
  const names = sheets.map((s, i) => {
    let n = String(s.name || `Sheet ${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `Sheet ${i + 1}`;
    for (let k = 2; used.has(n.toLowerCase()); k++) n = `${n.slice(0, 27)} (${k})`;
    used.add(n.toLowerCase());
    return n;
  });
  const zip = new JSZip();
  zip.file('[Content_Types].xml', types([], [
    ['/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
    ['/xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'],
    ...sheets.map((_, i) => [`/xl/worksheets/sheet${i + 1}.xml`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml']),
  ]));
  zip.file('_rels/.rels', rels([['rId1', 'officeDocument', 'xl/workbook.xml']]));
  zip.file('xl/_rels/workbook.xml.rels', rels([
    ...sheets.map((_, i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`]),
    [`rId${sheets.length + 1}`, 'styles', 'styles.xml'],
  ]));
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  zip.file('xl/workbook.xml', `${XML}<workbook ${NS} xmlns:r="${REL}"><sheets>${names.map((n, i) =>
    `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/styles.xml', `${XML}<styleSheet ${NS}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`);
  sheets.forEach((s, i) => {
    const widths = [];
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      if (v == null || v === '') return '';
      widths[ci] = Math.max(widths[ci] || 8, Math.min(60, String(v).length + 2));
      const ref = `${col(ci)}${ri + 1}`;
      const style = s.header && ri === 0 ? ' s="1"' : '';
      return typeof v === 'number' ? `<c r="${ref}"${style}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const cols = widths.length ? `<cols>${widths.map((w, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${w || 8}" customWidth="1"/>`).join('')}</cols>` : '';
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, `${XML}<worksheet ${NS}>${cols}<sheetData>${rows}</sheetData></worksheet>`);
  });
  return finish(zip, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/* ------------------------------------------------------------ PowerPoint */

const EMU = 12700; // per PDF point

/** slides: [{ jpeg: Uint8Array, w, h }] where w/h are the page size in points. */
export async function buildPptx(slides, { title = '' } = {}) {
  // One slide size for the deck: the first page's. Other pages are fitted inside it.
  const cx = Math.round(slides[0].w * EMU), cy = Math.round(slides[0].h * EMU);
  const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + REL + '" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', types([['jpeg', 'image/jpeg']], [
    ['/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'],
    ['/ppt/slideMasters/slideMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml'],
    ['/ppt/slideLayouts/slideLayout1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'],
    ['/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ...slides.map((_, i) => [`/ppt/slides/slide${i + 1}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml']),
  ]));
  zip.file('_rels/.rels', rootRels('ppt/presentation.xml'));
  zip.file('docProps/core.xml', core(title));
  zip.file('ppt/_rels/presentation.xml.rels', rels([
    ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
    ['rId2', 'theme', 'theme/theme1.xml'],
    ...slides.map((_, i) => [`rId${i + 10}`, 'slide', `slides/slide${i + 1}.xml`]),
  ]));
  zip.file('ppt/presentation.xml', `${XML}<p:presentation ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  const emptyTree = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
  zip.file('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${P}><p:cSld><p:spTree>${emptyTree}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]));
  zip.file('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${P} type="blank"><p:cSld name="Blank"><p:spTree>${emptyTree}</p:spTree></p:cSld></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]));
  zip.file('ppt/theme/theme1.xml', THEME);
  slides.forEach((s, i) => {
    // fit the page inside the slide, centred
    const k = Math.min(cx / (s.w * EMU), cy / (s.h * EMU));
    const w = Math.round(s.w * EMU * k), h = Math.round(s.h * EMU * k);
    const ox = Math.round((cx - w) / 2), oy = Math.round((cy - h) / 2);
    zip.file(`ppt/media/page${i + 1}.jpeg`, s.jpeg);
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'image', `../media/page${i + 1}.jpeg`]]));
    zip.file(`ppt/slides/slide${i + 1}.xml`, `${XML}<p:sld ${P}><p:cSld><p:spTree>${emptyTree}
<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${i + 1}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${ox}" y="${oy}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
  });
  return finish(zip, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
}

const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Sheaf"><a:themeElements>
<a:clrScheme name="Sheaf"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="F2F5F8"/></a:lt2>
<a:accent1><a:srgbClr val="00679E"/></a:accent1><a:accent2><a:srgbClr val="E8730C"/></a:accent2><a:accent3><a:srgbClr val="B8135A"/></a:accent3><a:accent4><a:srgbClr val="8A5200"/></a:accent4><a:accent5><a:srgbClr val="0A62A0"/></a:accent5><a:accent6><a:srgbClr val="7C3AED"/></a:accent6>
<a:hlink><a:srgbClr val="00679E"/></a:hlink><a:folHlink><a:srgbClr val="005A8A"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Sheaf"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Sheaf"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;
