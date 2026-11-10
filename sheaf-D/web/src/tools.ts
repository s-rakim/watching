import type { LucideIcon } from 'lucide-react';
import {
  Camera,
  Combine,
  Crop,
  Droplets,
  Eraser,
  FileArchive,
  FileImage,
  FileOutput,
  FileSpreadsheet,
  FileText,
  FileType,
  GitCompareArrows,
  Globe,
  Hash,
  Image,
  LayoutGrid,
  Lock,
  LockOpen,
  Minimize2,
  PencilLine,
  Presentation,
  RotateCw,
  ScanText,
  Scissors,
  Signature,
  Table,
  Trash2,
  Wrench,
} from 'lucide-react';

export type Category = 'organize' | 'optimize' | 'convert-to' | 'convert-from' | 'edit' | 'security';

export const CATEGORIES: { id: Category; name: string; short: string }[] = [
  { id: 'organize', name: 'Organize', short: 'Organize' },
  { id: 'optimize', name: 'Optimize', short: 'Optimize' },
  { id: 'convert-to', name: 'Convert to PDF', short: 'To PDF' },
  { id: 'convert-from', name: 'Convert from PDF', short: 'From PDF' },
  { id: 'edit', name: 'Edit', short: 'Edit' },
  { id: 'security', name: 'Security', short: 'Security' },
];

export type Options = Record<string, any>;

interface FieldBase {
  key: string;
  label: string;
  hint?: string;
  showIf?: (o: Options) => boolean;
}

export type Field =
  | (FieldBase & { type: 'choice'; options: { value: string; label: string; hint?: string }[] })
  | (FieldBase & { type: 'select'; options: { value: string; label: string }[] })
  | (FieldBase & { type: 'text' | 'password' | 'number'; placeholder?: string; min?: number; max?: number })
  | (FieldBase & { type: 'toggle' })
  | (FieldBase & { type: 'range'; min: number; max: number; step?: number; unit?: string })
  | (FieldBase & { type: 'color' })
  | (FieldBase & { type: 'anchor' })
  | (FieldBase & { type: 'languages' })
  | (FieldBase & { type: 'file'; accept: string });

export type Workspace = 'pages' | 'editor' | 'crop' | 'compare';
export type Capability = 'qpdf' | 'ghostscript' | 'libreoffice' | 'ocr' | 'poppler' | 'python' | 'chromium';

export interface ToolDef {
  id: string;
  name: string;
  blurb: string;
  category: Category;
  icon: LucideIcon;
  /** File extensions this tool takes, without the dot. */
  accept: string[];
  multiple: boolean;
  minFiles?: number;
  maxFiles?: number;
  /** What the files are called in the dropzone copy. */
  noun: string;
  action: string;
  working: string;
  fields?: Field[];
  defaults?: Options;
  workspace?: Workspace;
  needs?: Capability[];
  /** Tools that can start without a file (HTML to PDF takes an address). */
  filesOptional?: boolean;
  camera?: boolean;
  /** True when the work happens in the browser and never touches the server. */
  local?: boolean;
  check?: (o: Options, fileCount: number) => string | null;
}

const IMAGES = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff'];

const pageRange = (label = 'Pages', hint = 'Leave empty for every page. Example: 1-3, 5, 8-end'): Field => ({
  type: 'text',
  key: 'pages',
  label,
  hint,
  placeholder: 'All pages',
});

const imageLayout: Field[] = [
  {
    type: 'choice',
    key: 'pageSize',
    label: 'Page size',
    options: [
      { value: 'fit', label: 'Fit to image', hint: 'Each page is the size of its picture' },
      { value: 'a4', label: 'A4', hint: '210 × 297 mm' },
      { value: 'letter', label: 'US Letter', hint: '8.5 × 11 in' },
    ],
  },
  {
    type: 'choice',
    key: 'orientation',
    label: 'Orientation',
    showIf: (o) => o.pageSize !== 'fit',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'portrait', label: 'Portrait' },
      { value: 'landscape', label: 'Landscape' },
    ],
  },
  {
    type: 'choice',
    key: 'margin',
    label: 'Margin',
    options: [
      { value: 'none', label: 'None' },
      { value: 'small', label: 'Small' },
      { value: 'big', label: 'Big' },
    ],
  },
  { type: 'toggle', key: 'merge', label: 'Put every image in one PDF' },
];

export const TOOLS: ToolDef[] = [
  // Organize
  {
    id: 'merge',
    name: 'Merge PDF',
    blurb: 'Combine several PDFs into one, in the order you want.',
    category: 'organize',
    icon: Combine,
    accept: ['pdf'],
    multiple: true,
    minFiles: 2,
    noun: 'PDF',
    action: 'Merge PDF',
    working: 'Merging your files',
    needs: ['qpdf'],
  },
  {
    id: 'split',
    name: 'Split PDF',
    blurb: 'Cut one PDF into several, by range or every few pages.',
    category: 'organize',
    icon: Scissors,
    accept: ['pdf'],
    multiple: false,
    noun: 'PDF',
    action: 'Split PDF',
    working: 'Splitting your file',
    needs: ['qpdf'],
    defaults: { mode: 'ranges', ranges: '', every: 1, mergeRanges: false },
    fields: [
      {
        type: 'choice',
        key: 'mode',
        label: 'How to split',
        options: [
          { value: 'ranges', label: 'By range', hint: 'You pick where each file starts and ends' },
          { value: 'every', label: 'Fixed size', hint: 'A new file every few pages' },
          { value: 'all', label: 'Every page', hint: 'One file per page' },
        ],
      },
      {
        type: 'text',
        key: 'ranges',
        label: 'Ranges',
        placeholder: '1-3, 4-8, 9-end',
        hint: 'Each range becomes its own PDF.',
        showIf: (o) => o.mode === 'ranges',
      },
      { type: 'toggle', key: 'mergeRanges', label: 'Join all ranges into one PDF', showIf: (o) => o.mode === 'ranges' },
      { type: 'number', key: 'every', label: 'Pages per file', min: 1, showIf: (o) => o.mode === 'every' },
    ],
    check: (o) => (o.mode === 'ranges' && !String(o.ranges).trim() ? 'Type at least one range, like 1-3.' : null),
  },
  {
    id: 'remove-pages',
    name: 'Remove pages',
    blurb: 'Click the pages you don’t want and save the rest.',
    category: 'organize',
    icon: Trash2,
    accept: ['pdf'],
    multiple: false,
    noun: 'PDF',
    action: 'Remove pages',
    working: 'Removing pages',
    workspace: 'pages',
    needs: ['qpdf'],
  },
  {
    id: 'extract-pages',
    name: 'Extract pages',
    blurb: 'Pick the pages you need and get them as a new PDF.',
    category: 'organize',
    icon: FileOutput,
    accept: ['pdf'],
    multiple: false,
    noun: 'PDF',
    action: 'Extract pages',
    working: 'Extracting pages',
    workspace: 'pages',
    needs: ['qpdf'],
  },
  {
    id: 'organize',
    name: 'Organize PDF',
    blurb: 'Drag pages into a new order, rotate them, delete or add some.',
    category: 'organize',
    icon: LayoutGrid,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Save PDF',
    working: 'Rebuilding your PDF',
    workspace: 'pages',
    needs: ['qpdf'],
  },
  {
    id: 'scan-to-pdf',
    name: 'Scan to PDF',
    blurb: 'Photograph paper with your camera and turn the shots into a PDF.',
    category: 'organize',
    icon: Camera,
    accept: IMAGES,
    multiple: true,
    noun: 'photo',
    action: 'Create PDF',
    working: 'Building your PDF',
    camera: true,
    needs: ['python'],
    defaults: { pageSize: 'a4', orientation: 'auto', margin: 'none', merge: true, outputName: 'scan.pdf' },
    fields: imageLayout.slice(0, 3),
  },

  // Optimize
  {
    id: 'compress',
    name: 'Compress PDF',
    blurb: 'Shrink the file size while keeping it readable.',
    category: 'optimize',
    icon: Minimize2,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Compress PDF',
    working: 'Squeezing your files',
    needs: ['ghostscript'],
    defaults: { level: 'recommended' },
    fields: [
      {
        type: 'choice',
        key: 'level',
        label: 'Compression level',
        options: [
          { value: 'extreme', label: 'Extreme', hint: 'Smallest file, images get visibly softer' },
          { value: 'recommended', label: 'Recommended', hint: 'Good size, good quality' },
          { value: 'light', label: 'Light', hint: 'Best quality, modest saving' },
        ],
      },
    ],
  },
  {
    id: 'repair',
    name: 'Repair PDF',
    blurb: 'Try to recover a PDF that is damaged or won’t open.',
    category: 'optimize',
    icon: Wrench,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Repair PDF',
    working: 'Repairing your files',
    needs: ['qpdf'],
  },
  {
    id: 'ocr',
    name: 'OCR PDF',
    blurb: 'Make scanned pages searchable and their text selectable.',
    category: 'optimize',
    icon: ScanText,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Recognise text',
    working: 'Reading your pages',
    needs: ['ocr'],
    defaults: { languages: ['eng'], deskew: false, rotate: false, redo: false },
    fields: [
      { type: 'languages', key: 'languages', label: 'Languages in the document' },
      { type: 'toggle', key: 'deskew', label: 'Straighten crooked scans' },
      { type: 'toggle', key: 'rotate', label: 'Fix pages that are sideways' },
      { type: 'toggle', key: 'redo', label: 'Redo pages that already have text', hint: 'Slower. Replaces any existing text layer.' },
    ],
    check: (o) => (o.languages?.length ? null : 'Pick at least one language.'),
  },

  // Convert to PDF
  {
    id: 'jpg-to-pdf',
    name: 'JPG to PDF',
    blurb: 'Turn photos and images into a PDF, with margins and page size.',
    category: 'convert-to',
    icon: Image,
    accept: IMAGES,
    multiple: true,
    noun: 'image',
    action: 'Convert to PDF',
    working: 'Converting your images',
    needs: ['python'],
    defaults: { pageSize: 'a4', orientation: 'auto', margin: 'none', merge: true },
    fields: imageLayout,
  },
  {
    id: 'word-to-pdf',
    name: 'Word to PDF',
    blurb: 'Convert DOC and DOCX documents into PDFs that look the same anywhere.',
    category: 'convert-to',
    icon: FileText,
    accept: ['doc', 'docx', 'odt', 'rtf', 'txt'],
    multiple: true,
    noun: 'Word document',
    action: 'Convert to PDF',
    working: 'Converting your documents',
    needs: ['libreoffice'],
  },
  {
    id: 'powerpoint-to-pdf',
    name: 'PowerPoint to PDF',
    blurb: 'Convert PPT and PPTX slideshows into PDFs.',
    category: 'convert-to',
    icon: Presentation,
    accept: ['ppt', 'pptx', 'odp', 'pps', 'ppsx'],
    multiple: true,
    noun: 'presentation',
    action: 'Convert to PDF',
    working: 'Converting your slides',
    needs: ['libreoffice'],
  },
  {
    id: 'excel-to-pdf',
    name: 'Excel to PDF',
    blurb: 'Convert XLS and XLSX spreadsheets into PDFs.',
    category: 'convert-to',
    icon: Table,
    accept: ['xls', 'xlsx', 'ods', 'csv'],
    multiple: true,
    noun: 'spreadsheet',
    action: 'Convert to PDF',
    working: 'Converting your spreadsheets',
    needs: ['libreoffice'],
  },
  {
    id: 'html-to-pdf',
    name: 'HTML to PDF',
    blurb: 'Save a web page as a PDF from its address or an HTML file.',
    category: 'convert-to',
    icon: Globe,
    accept: ['html', 'htm'],
    multiple: true,
    noun: 'HTML file',
    action: 'Convert to PDF',
    working: 'Printing the page',
    needs: ['chromium'],
    filesOptional: true,
    defaults: { url: '', screen: 'laptop', pageSize: 'A4', orientation: 'portrait', margin: 'small' },
    fields: [
      {
        type: 'text',
        key: 'url',
        label: 'Web address',
        placeholder: 'https://example.com',
        hint: 'Or add HTML files instead. The page is fetched by this machine, nothing else.',
      },
      {
        type: 'select',
        key: 'screen',
        label: 'Render as',
        options: [
          { value: 'desktop', label: 'Wide desktop (1440px)' },
          { value: 'laptop', label: 'Laptop (1280px)' },
          { value: 'tablet', label: 'Tablet (820px)' },
          { value: 'phone', label: 'Phone (390px)' },
        ],
      },
      {
        type: 'select',
        key: 'pageSize',
        label: 'Page size',
        options: [
          { value: 'A4', label: 'A4' },
          { value: 'Letter', label: 'US Letter' },
          { value: 'A3', label: 'A3' },
          { value: 'A5', label: 'A5' },
          { value: 'Legal', label: 'Legal' },
          { value: 'single', label: 'One long page' },
        ],
      },
      {
        type: 'choice',
        key: 'orientation',
        label: 'Orientation',
        showIf: (o) => o.pageSize !== 'single',
        options: [
          { value: 'portrait', label: 'Portrait' },
          { value: 'landscape', label: 'Landscape' },
        ],
      },
      {
        type: 'choice',
        key: 'margin',
        label: 'Margin',
        showIf: (o) => o.pageSize !== 'single',
        options: [
          { value: 'none', label: 'None' },
          { value: 'small', label: 'Small' },
          { value: 'big', label: 'Big' },
        ],
      },
    ],
    check: (o, n) => {
      if (!n && !String(o.url).trim()) return 'Paste a web address or add an HTML file.';
      if (!n && !/^https?:\/\/\S+\.\S+/i.test(String(o.url).trim()) && !/^https?:\/\/localhost/i.test(String(o.url).trim()))
        return 'The address should start with http:// or https://';
      return null;
    },
  },

  // Convert from PDF
  {
    id: 'pdf-to-jpg',
    name: 'PDF to JPG',
    blurb: 'Save every page as a JPG, or pull out the images inside.',
    category: 'convert-from',
    icon: FileImage,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Convert to JPG',
    working: 'Rendering your pages',
    needs: ['poppler'],
    defaults: { mode: 'pages', quality: 'medium' },
    fields: [
      {
        type: 'choice',
        key: 'mode',
        label: 'What to save',
        options: [
          { value: 'pages', label: 'Pages as JPG', hint: 'One picture per page' },
          { value: 'images', label: 'Extract images', hint: 'Only the pictures embedded in the PDF' },
        ],
      },
      {
        type: 'choice',
        key: 'quality',
        label: 'Image quality',
        showIf: (o) => o.mode === 'pages',
        options: [
          { value: 'low', label: 'Screen', hint: '72 dpi' },
          { value: 'medium', label: 'Normal', hint: '150 dpi' },
          { value: 'high', label: 'Print', hint: '300 dpi' },
        ],
      },
    ],
  },
  {
    id: 'pdf-to-word',
    name: 'PDF to Word',
    blurb: 'Turn a PDF into an editable DOCX, keeping the layout where it can.',
    category: 'convert-from',
    icon: FileType,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Convert to Word',
    working: 'Rebuilding your document',
    needs: ['python'],
  },
  {
    id: 'pdf-to-powerpoint',
    name: 'PDF to PowerPoint',
    blurb: 'Turn each page into a slide in an editable PPTX.',
    category: 'convert-from',
    icon: Presentation,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Convert to PowerPoint',
    working: 'Building your slides',
    needs: ['libreoffice'],
  },
  {
    id: 'pdf-to-excel',
    name: 'PDF to Excel',
    blurb: 'Pull tables out of a PDF into an XLSX spreadsheet.',
    category: 'convert-from',
    icon: FileSpreadsheet,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Convert to Excel',
    working: 'Finding the tables',
    needs: ['python'],
  },
  {
    id: 'pdf-to-pdfa',
    name: 'PDF to PDF/A',
    blurb: 'Convert to the archival PDF/A standard for long-term storage.',
    category: 'convert-from',
    icon: FileArchive,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Convert to PDF/A',
    working: 'Converting for the archive',
    needs: ['ocr'],
    defaults: { level: '2' },
    fields: [
      {
        type: 'choice',
        key: 'level',
        label: 'Conformance',
        options: [
          { value: '1', label: 'PDF/A-1b', hint: 'Oldest and strictest' },
          { value: '2', label: 'PDF/A-2b', hint: 'The usual choice' },
          { value: '3', label: 'PDF/A-3b', hint: 'Allows attachments' },
        ],
      },
    ],
  },

  // Edit
  {
    id: 'edit',
    name: 'Edit PDF',
    blurb: 'Add text, shapes, drawings, highlights and images on top of any page.',
    category: 'edit',
    icon: PencilLine,
    accept: ['pdf'],
    multiple: false,
    noun: 'PDF',
    action: 'Save PDF',
    working: 'Saving your changes',
    workspace: 'editor',
    local: true,
  },
  {
    id: 'rotate',
    name: 'Rotate PDF',
    blurb: 'Turn pages the right way up, all at once or just some.',
    category: 'edit',
    icon: RotateCw,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Rotate PDF',
    working: 'Turning your pages',
    needs: ['qpdf'],
    defaults: { angle: '90', pages: '' },
    fields: [
      {
        type: 'choice',
        key: 'angle',
        label: 'Turn',
        options: [
          { value: '90', label: 'Right', hint: '90° clockwise' },
          { value: '180', label: 'Upside down', hint: '180°' },
          { value: '270', label: 'Left', hint: '90° anticlockwise' },
        ],
      },
      pageRange(),
    ],
  },
  {
    id: 'page-numbers',
    name: 'Add page numbers',
    blurb: 'Number the pages, with your choice of position and style.',
    category: 'edit',
    icon: Hash,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Add page numbers',
    working: 'Numbering your pages',
    defaults: { position: 'bc', margin: 'medium', template: '{n}', start: 1, fontSize: 12, font: 'sans', bold: false, color: '#1f1a14', pages: '' },
    fields: [
      { type: 'anchor', key: 'position', label: 'Position' },
      {
        type: 'choice',
        key: 'margin',
        label: 'Distance from the edge',
        options: [
          { value: 'small', label: 'Close' },
          { value: 'medium', label: 'Normal' },
          { value: 'large', label: 'Far' },
        ],
      },
      {
        type: 'select',
        key: 'template',
        label: 'Text',
        options: [
          { value: '{n}', label: '1' },
          { value: 'Page {n}', label: 'Page 1' },
          { value: '{n} / {p}', label: '1 / 12' },
          { value: 'Page {n} of {p}', label: 'Page 1 of 12' },
          { value: '- {n} -', label: '- 1 -' },
        ],
      },
      { type: 'number', key: 'start', label: 'First number', min: 0 },
      pageRange('Pages to number', 'Leave empty for every page. Use 2-end to skip a cover.'),
      { type: 'range', key: 'fontSize', label: 'Text size', min: 6, max: 36, unit: 'pt' },
      {
        type: 'select',
        key: 'font',
        label: 'Font',
        options: [
          { value: 'sans', label: 'Helvetica' },
          { value: 'serif', label: 'Times' },
          { value: 'mono', label: 'Courier' },
        ],
      },
      { type: 'toggle', key: 'bold', label: 'Bold' },
      { type: 'color', key: 'color', label: 'Colour' },
    ],
  },
  {
    id: 'watermark',
    name: 'Add watermark',
    blurb: 'Stamp text or an image across your pages.',
    category: 'edit',
    icon: Droplets,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Add watermark',
    working: 'Stamping your pages',
    defaults: {
      kind: 'text',
      text: 'CONFIDENTIAL',
      font: 'sans',
      bold: true,
      fontSize: 54,
      color: '#c9252b',
      scale: 30,
      opacity: 0.3,
      rotation: 45,
      position: 'mc',
      mosaic: false,
      pages: '',
    },
    fields: [
      {
        type: 'choice',
        key: 'kind',
        label: 'Watermark',
        options: [
          { value: 'text', label: 'Text' },
          { value: 'image', label: 'Image' },
        ],
      },
      { type: 'text', key: 'text', label: 'Text', showIf: (o) => o.kind === 'text' },
      { type: 'file', key: 'image', label: 'Image', accept: 'image/*', showIf: (o) => o.kind === 'image' },
      { type: 'range', key: 'fontSize', label: 'Text size', min: 12, max: 160, unit: 'pt', showIf: (o) => o.kind === 'text' },
      { type: 'range', key: 'scale', label: 'Image width', min: 5, max: 100, unit: '%', showIf: (o) => o.kind === 'image' },
      {
        type: 'select',
        key: 'font',
        label: 'Font',
        showIf: (o) => o.kind === 'text',
        options: [
          { value: 'sans', label: 'Helvetica' },
          { value: 'serif', label: 'Times' },
          { value: 'mono', label: 'Courier' },
        ],
      },
      { type: 'toggle', key: 'bold', label: 'Bold', showIf: (o) => o.kind === 'text' },
      { type: 'color', key: 'color', label: 'Colour', showIf: (o) => o.kind === 'text' },
      { type: 'anchor', key: 'position', label: 'Position', showIf: (o) => !o.mosaic },
      { type: 'toggle', key: 'mosaic', label: 'Repeat across the page' },
      { type: 'range', key: 'opacity', label: 'Opacity', min: 0.05, max: 1, step: 0.05, unit: '×' },
      { type: 'range', key: 'rotation', label: 'Rotation', min: -90, max: 90, step: 5, unit: '°' },
      pageRange(),
    ],
    check: (o) => {
      if (o.kind === 'text' && !String(o.text).trim()) return 'Type the watermark text.';
      if (o.kind === 'image' && !o.image) return 'Choose an image for the watermark.';
      return null;
    },
  },
  {
    id: 'crop',
    name: 'Crop PDF',
    blurb: 'Trim the margins or keep just one area of the page.',
    category: 'edit',
    icon: Crop,
    accept: ['pdf'],
    multiple: false,
    noun: 'PDF',
    action: 'Crop PDF',
    working: 'Cropping your pages',
    workspace: 'crop',
    local: true,
  },

  // Security
  {
    id: 'unlock',
    name: 'Unlock PDF',
    blurb: 'Remove the password from a PDF you have the password for.',
    category: 'security',
    icon: LockOpen,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Unlock PDF',
    working: 'Unlocking your files',
    needs: ['qpdf'],
    defaults: { password: '' },
    fields: [
      {
        type: 'password',
        key: 'password',
        label: 'Current password',
        hint: 'Leave empty if the file opens without one and only has printing or copying locked.',
      },
    ],
  },
  {
    id: 'protect',
    name: 'Protect PDF',
    blurb: 'Lock a PDF with a password and strong AES-256 encryption.',
    category: 'security',
    icon: Lock,
    accept: ['pdf'],
    multiple: true,
    noun: 'PDF',
    action: 'Protect PDF',
    working: 'Encrypting your files',
    needs: ['qpdf'],
    defaults: { password: '', confirm: '', noPrint: false, noCopy: false, noEdit: false },
    fields: [
      { type: 'password', key: 'password', label: 'Password' },
      { type: 'password', key: 'confirm', label: 'Type it again' },
      { type: 'toggle', key: 'noPrint', label: 'Block printing' },
      { type: 'toggle', key: 'noCopy', label: 'Block copying text' },
      { type: 'toggle', key: 'noEdit', label: 'Block editing' },
    ],
    check: (o) => {
      if (!o.password) return 'Type a password.';
      if (o.password !== o.confirm) return 'The two passwords don’t match.';
      return null;
    },
  },
  {
    id: 'sign',
    name: 'Sign PDF',
    blurb: 'Draw, type or upload your signature and place it on the page.',
    category: 'security',
    icon: Signature,
    accept: ['pdf'],
    multiple: false,
    noun: 'PDF',
    action: 'Save signed PDF',
    working: 'Signing your document',
    workspace: 'editor',
    local: true,
  },
  {
    id: 'redact',
    name: 'Redact PDF',
    blurb: 'Black out sensitive text and images so they are gone for good.',
    category: 'security',
    icon: Eraser,
    accept: ['pdf'],
    multiple: false,
    noun: 'PDF',
    action: 'Redact PDF',
    working: 'Removing what you covered',
    workspace: 'editor',
    local: true,
  },
  {
    id: 'compare',
    name: 'Compare PDF',
    blurb: 'Put two versions side by side and see what changed.',
    category: 'security',
    icon: GitCompareArrows,
    accept: ['pdf'],
    multiple: true,
    minFiles: 2,
    maxFiles: 2,
    noun: 'PDF',
    action: 'Compare',
    working: 'Comparing',
    workspace: 'compare',
    local: true,
  },
];

export const toolById = (id: string | undefined) => TOOLS.find((t) => t.id === id);

/** Tools worth offering once a PDF has just been produced. */
export const FOLLOW_UPS = ['compress', 'merge', 'split', 'organize', 'edit', 'sign', 'protect', 'watermark', 'page-numbers', 'pdf-to-jpg'];
