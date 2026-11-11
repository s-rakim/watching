// Every tool the app offers. `mode` picks the workspace, `fields` builds the options panel.
export const CATEGORIES = [
  { id: 'all', label: 'All tools' },
  { id: 'organize', label: 'Organize' },
  { id: 'optimize', label: 'Optimize' },
  { id: 'convert', label: 'Convert' },
  { id: 'edit', label: 'Edit' },
  { id: 'security', label: 'Security' },
  { id: 'smart', label: 'Read & translate' },
];

const PDF = 'application/pdf';
const LANG_OPTIONS = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'],
  ['ru', 'Russian'], ['uk', 'Ukrainian'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['sv', 'Swedish'], ['vi', 'Vietnamese']];
const IMG = 'image/jpeg,image/png,image/webp,image/gif,image/bmp';

export const TOOLS = [
  {
    id: 'merge', title: 'Merge PDF', cat: 'organize', icon: 'merge', hue: 'blue',
    desc: 'Join several PDFs into one. Drag the files into the order you want.',
    mode: 'files', accept: PDF, multiple: true, min: 2, sortable: true, action: 'Merge PDFs',
  },
  {
    id: 'split', title: 'Split PDF', cat: 'organize', icon: 'split', hue: 'blue',
    desc: 'Cut a PDF into separate files by page range, or one file per page.',
    mode: 'pages', accept: PDF, action: 'Split PDF', select: 'none',
    fields: [
      { key: 'how', label: 'Split by', type: 'segmented', default: 'ranges', options: [['ranges', 'Ranges'], ['every', 'Every page'], ['fixed', 'Fixed size']] },
      { key: 'ranges', label: 'Page ranges', type: 'text', placeholder: 'e.g. 1-3, 4-8, 9-', default: '', when: (o) => o.how === 'ranges', hint: 'Each range becomes its own PDF.' },
      { key: 'mergeAll', label: 'Put all ranges in one PDF', type: 'checkbox', default: false, when: (o) => o.how === 'ranges' },
      { key: 'chunk', label: 'Pages per file', type: 'number', default: 2, min: 1, when: (o) => o.how === 'fixed' },
    ],
  },
  {
    id: 'remove', title: 'Remove pages', cat: 'organize', icon: 'trash', hue: 'blue',
    desc: 'Pick the pages you no longer need and get a PDF without them.',
    mode: 'pages', accept: PDF, action: 'Remove pages', select: 'remove',
  },
  {
    id: 'extract', title: 'Extract pages', cat: 'organize', icon: 'extract', hue: 'blue',
    desc: 'Pull the pages you choose into a new PDF.',
    mode: 'pages', accept: PDF, action: 'Extract pages', select: 'keep',
    fields: [{ key: 'separate', label: 'One PDF per selected page', type: 'checkbox', default: false }],
  },
  {
    id: 'organize', title: 'Organize PDF', cat: 'organize', icon: 'layers', hue: 'blue',
    desc: 'Reorder, rotate and delete pages. Add pages from other PDFs too.',
    mode: 'pages', accept: PDF, multiple: true, action: 'Save PDF', select: 'organize',
  },
  {
    id: 'scan', title: 'Scan to PDF', cat: 'organize', icon: 'camera', hue: 'blue',
    desc: 'Photograph paper pages with your camera and turn them into a clean PDF.',
    mode: 'images', accept: IMG, multiple: true, capture: true, action: 'Create PDF',
    fields: [
      { key: 'scan', label: 'Clean up as black and white scan', type: 'checkbox', default: true },
      { key: 'size', label: 'Page size', type: 'select', default: 'a4', options: [['a4', 'A4'], ['letter', 'US Letter'], ['fit', 'Same as photo']] },
    ],
    fixed: { margin: 'none', orientation: 'auto' },
  },
  {
    id: 'compress', title: 'Compress PDF', cat: 'optimize', icon: 'compress', hue: 'orange',
    desc: 'Shrink the file size by re-encoding the images inside. Text stays sharp.',
    mode: 'files', accept: PDF, multiple: true, action: 'Compress PDF',
    fields: [
      { key: 'level', label: 'Compression level', type: 'cards', default: 'recommended', options: [
        ['extreme', 'Extreme', 'Smallest file, lower image quality'],
        ['recommended', 'Recommended', 'Good size, good quality'],
        ['low', 'Light', 'Best quality, modest savings'],
      ] },
    ],
  },
  {
    id: 'repair', title: 'Repair PDF', cat: 'optimize', icon: 'wrench', hue: 'orange',
    desc: 'Rebuild a PDF that will not open properly and recover what can be saved.',
    mode: 'files', accept: PDF, multiple: true, action: 'Repair PDF', lenient: true,
  },
  {
    id: 'ocr', title: 'OCR PDF', cat: 'optimize', icon: 'scanText', hue: 'orange',
    desc: 'Read the words in scanned pages so you can search, select and copy them.',
    mode: 'files', accept: PDF, multiple: true, action: 'Recognise text', busy: 'Reading your pages…',
    fields: [
      { key: 'lang', label: 'Language of the document', type: 'select', default: 'eng', options: [['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['ita', 'Italian'], ['por', 'Portuguese']] },
      { key: 'output', label: 'Output', type: 'segmented', default: 'pdf', options: [['pdf', 'Searchable PDF'], ['txt', 'Plain text']] },
      { key: 'skipText', label: 'Skip pages that already have text', type: 'checkbox', default: true },
    ],
  },
  {
    id: 'jpg-to-pdf', title: 'JPG to PDF', cat: 'convert', icon: 'image', hue: 'amber',
    desc: 'Turn JPG, PNG or WebP images into a PDF with the margins you choose.',
    mode: 'images', accept: IMG, multiple: true, action: 'Convert to PDF',
    fields: [
      { key: 'orientation', label: 'Orientation', type: 'segmented', default: 'auto', options: [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']] },
      { key: 'size', label: 'Page size', type: 'select', default: 'a4', options: [['a4', 'A4'], ['letter', 'US Letter'], ['fit', 'Fit to image']] },
      { key: 'margin', label: 'Margin', type: 'segmented', default: 'none', options: [['none', 'None'], ['small', 'Small'], ['big', 'Large']] },
      { key: 'merge', label: 'Put all images in one PDF', type: 'checkbox', default: true },
    ],
  },
  {
    id: 'pdf-to-jpg', title: 'PDF to JPG', cat: 'convert', icon: 'fileImage', hue: 'amber',
    desc: 'Save every page of a PDF as a JPG or PNG image.',
    mode: 'files', accept: PDF, multiple: true, action: 'Convert to images',
    fields: [
      { key: 'format', label: 'Format', type: 'segmented', default: 'jpg', options: [['jpg', 'JPG'], ['png', 'PNG']] },
      { key: 'dpi', label: 'Resolution', type: 'select', default: '150', options: [['96', 'Screen (96 dpi)'], ['150', 'Normal (150 dpi)'], ['300', 'Print (300 dpi)']] },
    ],
  },
  {
    id: 'pdf-to-markdown', title: 'PDF to Markdown', cat: 'convert', icon: 'markdown', hue: 'amber',
    desc: 'Pull the text out as Markdown with headings and lists, or as plain text.',
    mode: 'files', accept: PDF, multiple: true, action: 'Convert',
    fields: [{ key: 'format', label: 'Output', type: 'segmented', default: 'md', options: [['md', 'Markdown'], ['txt', 'Plain text']] }],
  },
  {
    id: 'pdf-to-word', title: 'PDF to Word', cat: 'convert', icon: 'fileWord', hue: 'amber',
    desc: 'Get an editable DOCX with the headings, paragraphs and lists from your PDF.',
    mode: 'files', accept: PDF, multiple: true, action: 'Convert to Word', busy: 'Building your document…',
  },
  {
    id: 'pdf-to-excel', title: 'PDF to Excel', cat: 'convert', icon: 'table', hue: 'amber',
    desc: 'Pull tables and columns of figures into an XLSX spreadsheet.',
    mode: 'files', accept: PDF, multiple: true, action: 'Convert to Excel', busy: 'Finding the columns…',
    fields: [{ key: 'layout', label: 'Sheets', type: 'segmented', default: 'pages', options: [['pages', 'One per page'], ['one', 'All on one']] }],
  },
  {
    id: 'pdf-to-powerpoint', title: 'PDF to PowerPoint', cat: 'convert', icon: 'slides', hue: 'amber',
    desc: 'Turn every page into a slide in a PPTX deck, ready to present or rearrange.',
    mode: 'files', accept: PDF, multiple: true, action: 'Convert to PowerPoint', busy: 'Building your slides…',
    fields: [{ key: 'dpi', label: 'Slide image quality', type: 'select', default: '150', options: [['96', 'Light (96 dpi)'], ['150', 'Normal (150 dpi)'], ['220', 'Sharp (220 dpi)']] }],
  },
  {
    id: 'edit', title: 'Edit PDF', cat: 'edit', icon: 'edit', hue: 'pink',
    desc: 'Change the text already on a page, add new text, images and shapes, draw, highlight or white out.',
    mode: 'canvas', accept: PDF, action: 'Save PDF', palette: ['edittext', 'text', 'image', 'ink', 'highlight', 'rect', 'whiteout'],
  },
  {
    id: 'rotate', title: 'Rotate PDF', cat: 'edit', icon: 'rotate', hue: 'pink',
    desc: 'Turn pages the right way up. Works on several PDFs at once.',
    mode: 'files', accept: PDF, multiple: true, action: 'Rotate PDF', rotatable: true,
  },
  {
    id: 'page-numbers', title: 'Page numbers', cat: 'edit', icon: 'hash', hue: 'pink',
    desc: 'Number the pages. Choose where they sit, how they read and where they start.',
    mode: 'files', accept: PDF, action: 'Add page numbers',
    fields: [
      { key: 'position', label: 'Position', type: 'grid', default: 'bottom-center' },
      { key: 'format', label: 'Text', type: 'select', default: '{n}', options: [['{n}', '1'], ['Page {n}', 'Page 1'], ['{n} / {total}', '1 / 12'], ['Page {n} of {total}', 'Page 1 of 12']] },
      { key: 'start', label: 'First number', type: 'number', default: 1, min: 0 },
      { key: 'size', label: 'Font size', type: 'number', default: 11, min: 6, max: 48 },
      { key: 'font', label: 'Font', type: 'segmented', default: 'sans', options: [['sans', 'Sans'], ['serif', 'Serif']] },
      { key: 'color', label: 'Colour', type: 'color', default: '#1f2937' },
      { key: 'skipFirst', label: 'Leave the first page unnumbered (cover)', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'watermark', title: 'Watermark', cat: 'edit', icon: 'drop', hue: 'pink',
    desc: 'Stamp text or an image across every page, as bold or as faint as you like.',
    mode: 'files', accept: PDF, action: 'Add watermark',
    fields: [
      { key: 'kind', label: 'Stamp', type: 'segmented', default: 'text', options: [['text', 'Text'], ['image', 'Image']] },
      { key: 'text', label: 'Text', type: 'text', default: 'CONFIDENTIAL', when: (o) => o.kind === 'text' },
      { key: 'color', label: 'Colour', type: 'color', default: '#d14343', when: (o) => o.kind === 'text' },
      { key: 'image', label: 'Image', type: 'file', accept: 'image/png,image/jpeg', when: (o) => o.kind === 'image' },
      { key: 'layout', label: 'Layout', type: 'segmented', default: 'center', options: [['center', 'Centre'], ['tile', 'Tiled']] },
      { key: 'angle', label: 'Angle', type: 'select', default: '45', options: [['0', 'Flat'], ['45', 'Diagonal'], ['90', 'Vertical']] },
      { key: 'opacity', label: 'Opacity', type: 'range', default: 0.3, min: 0.05, max: 1, step: 0.05 },
    ],
  },
  {
    id: 'crop', title: 'Crop PDF', cat: 'edit', icon: 'crop', hue: 'pink',
    desc: 'Trim the margins or keep just one area, on a single page or all of them.',
    mode: 'canvas', accept: PDF, action: 'Crop PDF', palette: ['crop'],
    fields: [{ key: 'scope', label: 'Apply to', type: 'segmented', default: 'all', options: [['all', 'All pages'], ['current', 'This page']] }],
  },
  {
    id: 'sign', title: 'Sign PDF', cat: 'security', icon: 'sign', hue: 'sky',
    desc: 'Draw or type your signature and drop it where it belongs. Add the date too.',
    mode: 'canvas', accept: PDF, action: 'Sign PDF', palette: ['signature', 'date', 'text'],
  },
  {
    id: 'protect', title: 'Protect PDF', cat: 'security', icon: 'lock', hue: 'sky',
    desc: 'Lock a PDF with a password using AES-256 encryption.',
    mode: 'files', accept: PDF, multiple: true, action: 'Protect PDF',
    fields: [
      { key: 'password', label: 'Password', type: 'password', default: '', required: true },
      { key: 'confirm', label: 'Repeat password', type: 'password', default: '', required: true },
      { key: 'allowPrint', label: 'Allow printing', type: 'checkbox', default: true },
      { key: 'allowCopy', label: 'Allow copying text', type: 'checkbox', default: false },
      { key: 'allowEdit', label: 'Allow editing', type: 'checkbox', default: false },
    ],
  },
  {
    id: 'unlock', title: 'Unlock PDF', cat: 'security', icon: 'unlock', hue: 'sky',
    desc: 'Remove the password from a PDF you have the password for.',
    mode: 'files', accept: PDF, multiple: true, action: 'Unlock PDF',
  },
  {
    id: 'redact', title: 'Redact PDF', cat: 'security', icon: 'redact', hue: 'sky',
    desc: 'Black out sensitive details for good. The hidden content is removed, not just covered.',
    mode: 'canvas', accept: PDF, action: 'Redact PDF', palette: ['redact'],
  },
  {
    id: 'compare', title: 'Compare PDF', cat: 'security', icon: 'compare', hue: 'sky',
    desc: 'Put two versions side by side and see which words were added or removed.',
    mode: 'compare', accept: PDF, multiple: true, min: 2, max: 2, action: 'Compare',
  },
  {
    id: 'summarize', title: 'Summarize PDF', cat: 'smart', icon: 'summary', hue: 'violet',
    desc: 'Get the key points of a long PDF in a few lines, worked out on your device.',
    mode: 'files', accept: PDF, action: 'Summarize', busy: 'Reading and summarising…',
    fields: [
      { key: 'length', label: 'Length', type: 'segmented', default: 'medium', options: [['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']] },
      { key: 'method', label: 'How', type: 'select', default: 'auto', options: [['auto', 'Browser model if there is one'], ['local', 'Pick key sentences only']],
        hint: 'Chrome has a built-in summariser that writes new sentences. Other browsers pick the most important sentences from the text.' },
    ],
  },
  {
    id: 'translate', title: 'Translate PDF', cat: 'smart', icon: 'languages', hue: 'violet',
    desc: 'Translate the text of a PDF into another language with DeepL or your browser\'s own translator.',
    mode: 'files', accept: PDF, action: 'Translate', busy: 'Translating…',
    fields: [
      { key: 'from', label: 'From', type: 'select', default: 'auto', options: [['auto', 'Detect it'], ...LANG_OPTIONS] },
      { key: 'to', label: 'To', type: 'select', default: 'en', options: LANG_OPTIONS },
      { key: 'format', label: 'Save as', type: 'segmented', default: 'docx', options: [['docx', 'Word'], ['md', 'Markdown']] },
      { key: 'engine', label: 'Translator', type: 'segmented', default: 'auto', options: [['auto', 'Automatic'], ['deepl', 'DeepL'], ['browser', 'On this device']],
        hint: 'Automatic uses DeepL when your key is set up, otherwise the browser\'s own translator. DeepL sends the text to DeepL; On this device keeps it in the browser.' },
    ],
  },
];

export const byId = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
