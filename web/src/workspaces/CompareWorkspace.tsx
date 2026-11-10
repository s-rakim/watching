import { diffArrays } from 'diff';
import { ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { plural } from '../lib/format';
import { openPdf, PDFDocumentProxy, renderPage } from '../lib/pdf';
import type { WorkspaceProps } from '../pages/ToolPage';
import Shell from './Shell';

interface Word {
  text: string;
  /** Box in page points from the top left. */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PageDiff {
  removed: Word[];
  added: Word[];
}

async function wordsOf(doc: PDFDocumentProxy, pageNo: number): Promise<{ words: Word[]; width: number; height: number }> {
  if (pageNo > doc.numPages) return { words: [], width: 0, height: 0 };
  const page = await doc.getPage(pageNo);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const words: Word[] = [];
  for (const item of content.items as any[]) {
    if (!item.str?.trim()) continue;
    const t = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontH = Math.hypot(t[2], t[3]);
    const per = item.width / item.str.length;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(item.str))) {
      words.push({ text: m[0], x: t[4] + per * m.index, y: t[5] - fontH * 0.9, w: per * m[0].length, h: fontH * 1.15 });
    }
  }
  return { words, width: viewport.width, height: viewport.height };
}

function Side({ doc, pageNo, marks, tone, label }: { doc: PDFDocumentProxy; pageNo: number; marks: Word[]; tone: 'old' | 'new'; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, scale: 1 });
  const missing = pageNo > doc.numPages;

  useEffect(() => {
    if (missing || !canvas.current || !holder.current) return;
    let alive = true;
    (async () => {
      const page = await doc.getPage(pageNo);
      const width = Math.max(240, holder.current!.clientWidth - 8);
      const s = await renderPage(page, canvas.current!, width);
      if (alive) setSize({ ...s, scale: width / page.getViewport({ scale: 1 }).width });
    })();
    return () => {
      alive = false;
    };
  }, [doc, pageNo, missing]);

  return (
    <div className="cmp-side" ref={holder}>
      <p className="cmp-label">{label}</p>
      {missing ? (
        <div className="cmp-missing">This version has no page {pageNo}.</div>
      ) : (
        <div className="cmp-page" style={size.width ? { width: size.width, height: size.height } : undefined}>
          <canvas ref={canvas} style={size.width ? { width: size.width, height: size.height } : undefined} />
          {marks.map((w, i) => (
            <span
              key={i}
              className={`cmp-mark cmp-${tone}`}
              style={{ left: w.x * size.scale, top: w.y * size.scale, width: w.w * size.scale, height: w.h * size.scale }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CompareWorkspace({ tool, items, setItems, reset, error }: WorkspaceProps) {
  const [docs, setDocs] = useState<[PDFDocumentProxy, PDFDocumentProxy] | null>(null);
  const [diffs, setDiffs] = useState<PageDiff[] | null>(null);
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState('');
  const a = items[0].file;
  const b = items[1].file;

  useEffect(() => {
    let alive = true;
    setDocs(null);
    setDiffs(null);
    (async () => {
      try {
        const [da, db] = await Promise.all([openPdf(a), openPdf(b)]);
        if (!alive) return;
        setDocs([da, db]);
        const total = Math.max(da.numPages, db.numPages);
        const all: PageDiff[] = [];
        for (let i = 1; i <= total; i++) {
          const [wa, wb] = await Promise.all([wordsOf(da, i), wordsOf(db, i)]);
          const removed: Word[] = [];
          const added: Word[] = [];
          let ia = 0;
          let ib = 0;
          for (const part of diffArrays(wa.words.map((w) => w.text), wb.words.map((w) => w.text))) {
            const n = part.value.length;
            if (part.removed) {
              removed.push(...wa.words.slice(ia, ia + n));
              ia += n;
            } else if (part.added) {
              added.push(...wb.words.slice(ib, ib + n));
              ib += n;
            } else {
              ia += n;
              ib += n;
            }
          }
          all.push({ removed, added });
        }
        if (alive) setDiffs(all);
      } catch (err: any) {
        if (alive) setLoadError(err.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [a, b]);

  const total = docs ? Math.max(docs[0].numPages, docs[1].numPages) : 0;
  const changed = diffs?.map((d, i) => ({ page: i + 1, count: d.removed.length + d.added.length })).filter((d) => d.count) ?? [];
  const here = diffs?.[page - 1];

  return (
    <Shell
      tool={tool}
      title={`${a.name} and ${b.name}`}
      onBack={reset}
      error={error || loadError}
      bar={
        total > 1 ? (
          <div className="pager">
            <button className="icon-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={20} strokeWidth={2.2} />
            </button>
            <span className="mono">
              {page} / {total}
            </span>
            <button className="icon-btn" aria-label="Next page" disabled={page >= total} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight size={20} strokeWidth={2.2} />
            </button>
          </div>
        ) : null
      }
      panel={
        <>
          <h2 className="panel-title">What changed</h2>
          {!diffs && !loadError && <p className="panel-note">Reading both files…</p>}
          {diffs && !changed.length && (
            <p className="panel-note">
              The text is the same in both files{docs && docs[0].numPages !== docs[1].numPages ? ', but the page counts differ' : ''}.
              Images and layout aren&rsquo;t compared.
            </p>
          )}
          {diffs && changed.length > 0 && (
            <>
              <p className="picked-count mono">
                {plural(changed.reduce((s, c) => s + c.count, 0), 'word')} differ on {plural(changed.length, 'page')}
              </p>
              <div className="cmp-legend">
                <span><i className="cmp-mark cmp-old" /> Only in the first file</span>
                <span><i className="cmp-mark cmp-new" /> Only in the second file</span>
              </div>
              <ul className="cmp-list">
                {changed.map((c) => (
                  <li key={c.page}>
                    <button className={`cmp-jump${c.page === page ? ' is-on' : ''}`} onClick={() => setPage(c.page)}>
                      <span>Page {c.page}</span>
                      <span className="mono">{plural(c.count, 'change')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      }
      action={
        <button className="btn btn-secondary btn-block" onClick={() => setItems((prev) => [prev[1], prev[0]])}>
          <ArrowLeftRight size={18} strokeWidth={2.2} />
          Swap sides
        </button>
      }
    >
      {docs ? (
        <div className="cmp">
          <Side doc={docs[0]} pageNo={page} marks={here?.removed ?? []} tone="old" label={a.name} />
          <Side doc={docs[1]} pageNo={page} marks={here?.added ?? []} tone="new" label={b.name} />
        </div>
      ) : (
        !loadError && <div className="loading-block" aria-busy="true" />
      )}
    </Shell>
  );
}
