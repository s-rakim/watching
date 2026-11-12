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
  // Right-to-left text (Arabic, Hebrew, or a translation into them) needs bidi paragraphs.
  const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
  const rtl = (text) => [...text].filter((c) => RTL.test(c)).length > (text.match(/[A-Za-z]/g) || []).length;
  // A tab character inside w:t is not a tab to Word; it needs its own element.
  const run = (text) => `<w:r>${RTL.test(text) ? '<w:rPr><w:rtl/></w:rPr>' : ''}${text.split('\t').map((t) => `<w:t xml:space="preserve">${x(t)}</w:t>`).join('<w:tab/>')}</w:r>`;
  const para = (style, text, extra = '') => {
    const pPr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${rtl(text) ? '<w:bidi/>' : ''}${extra}`;
    return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${run(text)}</w:p>`;
  };
  const body = [];
  blocks.forEach((b, i) => {
    if (b.t === 'h') body.push(para(`Heading${b.level}`, b.text));
    else if (b.t === 'li') body.push(para('ListParagraph', `${b.marker || '•'}\t${b.text}`, '<w:ind w:left="720" w:hanging="360"/>'));
    else if (b.t === 'p') body.push(para('', b.text));
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
