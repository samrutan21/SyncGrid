import { useMemo, useRef, useState } from 'react';
import { GFX_CATEGORY_SETS } from '../core/gfxCategories';
import { parseRuleConfig, SUBTITLE_RULE_SETS } from '../core/proofread/rules';
import { addGfxProfile, addSubtitleProfile, app, setGfxCategories, setSubtitleRules, toast } from '../state/app';
import { useStore } from '../state/createStore';
import { PromptModal } from './common';

const NONE: never[] = [];

/** GFX profile menu. "New profile…" asks for a name, then tags are added on the sheet. */
export function GfxProfileSelect({ wide }: { wide?: boolean }) {
  const id = useStore(app, (s) => s.project?.settings.gfxCategories) || 'off';
  const saved = useStore(app, (s) => s.project?.settings.gfxProfiles);
  const custom = useMemo(() => (saved ?? NONE).filter((p) => p.id !== 'osos'), [saved]);
  const [naming, setNaming] = useState(false);
  return (
    <>
      <select
        className={`input rules-select ${wide ? 'wide' : ''}`}
        aria-label="GFX categories"
        title="GFX categories for this project"
        value={id}
        onChange={(e) => {
          if (e.target.value === '__new') setNaming(true);
          else setGfxCategories(e.target.value);
        }}
      >
        {GFX_CATEGORY_SETS.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
        {custom.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
        <option value="__new">New profile…</option>
      </select>
      {naming && (
        <PromptModal
          title="New GFX profile"
          label="Name"
          confirm="Add"
          onClose={() => setNaming(false)}
          onSubmit={(name) => addGfxProfile(name)}
        />
      )}
    </>
  );
}

/** Subtitle profile menu. A rule file uses the same shape as the OSOS config. */
export function SubtitleProfileSelect() {
  const id = useStore(app, (s) => s.project?.settings.subtitleRules) || 'off';
  const custom = useStore(app, (s) => s.project?.settings.subtitleProfiles) ?? NONE;
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <select
        className="input rules-select"
        aria-label="Subtitle rules"
        title="Proofreading rules for this project"
        value={id}
        onChange={(e) => {
          if (e.target.value === '__upload') file.current?.click();
          else setSubtitleRules(e.target.value);
        }}
      >
        {SUBTITLE_RULE_SETS.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
        {custom.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
        <option value="__upload">Upload rules…</option>
      </select>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Upload subtitle rules"
        onChange={async (e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (!picked) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(await picked.text());
          } catch {
            toast('That file is not JSON.', 'error');
            return;
          }
          const config = parseRuleConfig(parsed);
          if (!config) {
            toast('That file is not a subtitle rule profile.', 'error');
            return;
          }
          const name = picked.name.replace(/\.json$/i, '').replace(/[_-]+/g, ' ').trim() || 'Subtitles';
          addSubtitleProfile(name, config);
        }}
      />
    </>
  );
}
