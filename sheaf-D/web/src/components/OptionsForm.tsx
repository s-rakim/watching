import { ArrowDown, ArrowUp, Check, ImagePlus, Plus, X } from 'lucide-react';
import { useId } from 'react';
import { useStore } from '../lib/store';
import { CHAINABLE, Field, Options, toolById } from '../tools';

const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English', deu: 'German', fra: 'French', spa: 'Spanish', ita: 'Italian', por: 'Portuguese', nld: 'Dutch',
  pol: 'Polish', rus: 'Russian', ukr: 'Ukrainian', tur: 'Turkish', ara: 'Arabic', hin: 'Hindi', jpn: 'Japanese',
  kor: 'Korean', chi_sim: 'Chinese (Simplified)', chi_tra: 'Chinese (Traditional)', swe: 'Swedish', dan: 'Danish',
  nor: 'Norwegian', fin: 'Finnish', ces: 'Czech', ell: 'Greek', heb: 'Hebrew', swa: 'Swahili', vie: 'Vietnamese',
  ind: 'Indonesian', ron: 'Romanian', hun: 'Hungarian', tha: 'Thai',
};

// Languages DeepL translates. Sources are plain languages; a few targets come in regional flavours.
const DEEPL_LANGS: [string, string][] = [
  ['ar', 'Arabic'], ['bg', 'Bulgarian'], ['zh', 'Chinese'], ['cs', 'Czech'], ['da', 'Danish'], ['nl', 'Dutch'],
  ['en', 'English'], ['et', 'Estonian'], ['fi', 'Finnish'], ['fr', 'French'], ['de', 'German'], ['el', 'Greek'],
  ['he', 'Hebrew'], ['hu', 'Hungarian'], ['id', 'Indonesian'], ['it', 'Italian'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['lv', 'Latvian'], ['lt', 'Lithuanian'], ['nb', 'Norwegian'], ['pl', 'Polish'], ['pt', 'Portuguese'], ['ro', 'Romanian'],
  ['ru', 'Russian'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['es', 'Spanish'], ['sv', 'Swedish'], ['th', 'Thai'],
  ['tr', 'Turkish'], ['uk', 'Ukrainian'], ['vi', 'Vietnamese'],
];
const DEEPL_TARGETS: [string, string][] = DEEPL_LANGS.flatMap(([code, name]): [string, string][] => {
  if (code === 'en') return [['en-us', 'English (US)'], ['en-gb', 'English (UK)']];
  if (code === 'pt') return [['pt-br', 'Portuguese (Brazil)'], ['pt-pt', 'Portuguese (Portugal)']];
  if (code === 'zh') return [['zh-hans', 'Chinese (Simplified)'], ['zh-hant', 'Chinese (Traditional)']];
  if (code === 'es') return [['es', 'Spanish'], ['es-419', 'Spanish (Latin America)']];
  return [[code, name]];
});

const ANCHORS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
const ANCHOR_NAMES: Record<string, string> = {
  tl: 'Top left', tc: 'Top centre', tr: 'Top right', ml: 'Middle left', mc: 'Centre', mr: 'Middle right',
  bl: 'Bottom left', bc: 'Bottom centre', br: 'Bottom right',
};

interface Props {
  fields: Field[];
  values: Options;
  onChange: (patch: Options) => void;
}

export default function OptionsForm({ fields, values, onChange }: Props) {
  const { health } = useStore();
  const base = useId();
  return (
    <div className="options">
      {fields
        .filter((f) => !f.showIf || f.showIf(values))
        .map((f) => {
          const id = `${base}-${f.key}`;
          const value = values[f.key];
          const set = (v: unknown) => onChange({ [f.key]: v });

          if (f.type === 'toggle') {
            return (
              <label key={f.key} className="toggle-row">
                <input type="checkbox" className="toggle" checked={!!value} onChange={(e) => set(e.target.checked)} />
                <span>
                  {f.label}
                  {f.hint && <small>{f.hint}</small>}
                </span>
              </label>
            );
          }

          let control = null;
          if (f.type === 'choice') {
            control = (
              <div className={`choices${f.options.every((o) => !o.hint) ? ' choices-compact' : ''}`} role="radiogroup" aria-labelledby={`${id}-label`}>
                {f.options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    className="choice"
                    onClick={() => set(o.value)}
                  >
                    <span className="choice-text">
                      <strong>{o.label}</strong>
                      {o.hint && <small>{o.hint}</small>}
                    </span>
                    {value === o.value && <Check size={18} strokeWidth={2.6} className="choice-check" />}
                  </button>
                ))}
              </div>
            );
          } else if (f.type === 'select') {
            control = (
              <select id={id} className="input" value={value} onChange={(e) => set(e.target.value)}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
          } else if (f.type === 'text' || f.type === 'password' || f.type === 'number') {
            control = (
              <input
                id={id}
                className="input"
                type={f.type}
                value={value ?? ''}
                min={f.min}
                max={f.max}
                placeholder={f.placeholder}
                autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                spellCheck={false}
                onChange={(e) => set(f.type === 'number' ? e.target.value : e.target.value)}
              />
            );
          } else if (f.type === 'range') {
            const shown = f.unit === '×' ? `${Math.round(Number(value) * 100)}%` : `${value}${f.unit ?? ''}`;
            control = (
              <div className="range-row">
                <input
                  id={id}
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step ?? 1}
                  value={value}
                  onChange={(e) => set(Number(e.target.value))}
                />
                <output className="mono">{shown}</output>
              </div>
            );
          } else if (f.type === 'color') {
            control = (
              <div className="color-row">
                <input id={id} type="color" value={value} onChange={(e) => set(e.target.value)} />
                {['#1f1a14', '#c9252b', '#0a62a0', '#17733a', '#8f8475'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`swatch${value === c ? ' is-on' : ''}`}
                    style={{ background: c }}
                    aria-label={`Use colour ${c}`}
                    onClick={() => set(c)}
                  />
                ))}
              </div>
            );
          } else if (f.type === 'anchor') {
            control = (
              <div className="anchor-grid" role="radiogroup" aria-labelledby={`${id}-label`}>
                {ANCHORS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={value === a}
                    aria-label={ANCHOR_NAMES[a]}
                    title={ANCHOR_NAMES[a]}
                    className="anchor"
                    onClick={() => set(a)}
                  />
                ))}
              </div>
            );
          } else if (f.type === 'languages') {
            const available = health?.languages?.length ? health.languages : ['eng'];
            const chosen: string[] = value ?? [];
            control = (
              <div className="chips">
                {available.map((l) => {
                  const on = chosen.includes(l);
                  return (
                    <button
                      key={l}
                      type="button"
                      className={`chip${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => set(on ? chosen.filter((x) => x !== l) : [...chosen, l])}
                    >
                      {on && <Check size={14} strokeWidth={2.6} />}
                      {LANGUAGE_NAMES[l] ?? l}
                    </button>
                  );
                })}
              </div>
            );
          } else if (f.type === 'translate-language') {
            control = (
              <select id={id} className="input" value={value} onChange={(e) => set(e.target.value)}>
                {f.allowAuto && <option value="auto">Detect it</option>}
                {(f.allowAuto ? DEEPL_LANGS : DEEPL_TARGETS).map(([c, name]) => (
                  <option key={c} value={c}>
                    {name}
                  </option>
                ))}
              </select>
            );
          } else if (f.type === 'steps') {
            control = <StepsEditor steps={value ?? []} onChange={set} />;
          } else if (f.type === 'file') {
            const file = value as File | undefined;
            control = (
              <label className="file-pick">
                <ImagePlus size={20} strokeWidth={2} />
                <span>{file ? file.name : 'Choose an image'}</span>
                <input
                  type="file"
                  className="sr-only"
                  accept={f.accept}
                  onChange={(e) => set(e.target.files?.[0])}
                />
              </label>
            );
          }

          return (
            <div key={f.key} className="field">
              <label className="field-label" id={`${id}-label`} htmlFor={id}>
                {f.label}
              </label>
              {control}
              {f.hint && <p className="field-hint">{f.hint}</p>}
            </div>
          );
        })}
    </div>
  );
}

interface Step {
  tool: string;
  options: Options;
}

/** The step list behind Workflow: pick a tool per step and set its options inline. */
function StepsEditor({ steps, onChange }: { steps: Step[]; onChange: (s: Step[]) => void }) {
  const put = (i: number, next: Step | null) => {
    const copy = [...steps];
    if (next) copy[i] = next;
    else copy.splice(i, 1);
    onChange(copy);
  };
  const move = (i: number, by: number) => {
    const copy = [...steps];
    const [s] = copy.splice(i, 1);
    copy.splice(i + by, 0, s);
    onChange(copy);
  };
  const fresh = (id: string): Step => ({ tool: id, options: { ...(toolById(id)?.defaults ?? {}) } });
  return (
    <div className="steps">
      <ol className="step-list">
        {steps.map((s, i) => {
          const t = toolById(s.tool);
          // image watermarks need a second upload, which a chained step can't take
          const fields = (t?.fields ?? [])
            .filter((f) => f.type !== 'file' && !(s.tool === 'watermark' && f.key === 'kind'))
            .map((f) => (s.tool === 'watermark' ? { ...f, showIf: f.showIf ? (o: Options) => f.showIf!({ ...o, kind: 'text' }) : undefined } : f));
          return (
            <li key={i} className="step">
              <div className="step-head">
                <span className="step-num mono">{i + 1}</span>
                <select
                  className="input"
                  aria-label={`Tool for step ${i + 1}`}
                  value={s.tool}
                  onChange={(e) => put(i, fresh(e.target.value))}
                >
                  {CHAINABLE.map((id) => (
                    <option key={id} value={id}>
                      {toolById(id)?.name ?? id}
                    </option>
                  ))}
                </select>
                <button type="button" className="icon-btn" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={16} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move step ${i + 1} down`}
                  disabled={i === steps.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={16} strokeWidth={2} />
                </button>
                <button type="button" className="icon-btn" aria-label={`Remove step ${i + 1}`} onClick={() => put(i, null)}>
                  <X size={16} strokeWidth={2} />
                </button>
              </div>
              {fields.length > 0 && (
                <div className="step-body">
                  <OptionsForm fields={fields} values={s.options} onChange={(patch) => put(i, { ...s, options: { ...s.options, ...patch } })} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {steps.length < 8 && (
        <button type="button" className="btn btn-secondary step-add" onClick={() => onChange([...steps, fresh(steps.length ? 'page-numbers' : 'compress')])}>
          <Plus size={16} strokeWidth={2.2} /> Add a step
        </button>
      )}
    </div>
  );
}
