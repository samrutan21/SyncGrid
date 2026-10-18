import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GFX_CATEGORY_SETS } from '../core/gfxCategories';
import { parseRuleConfig, SUBTITLE_RULE_SETS } from '../core/proofread/rules';
import { addGfxProfile, addSubtitleProfile, app, setGfxCategories, setSubtitleRules, toast } from '../state/app';
import { useStore } from '../state/createStore';
import { Button, Modal, PromptModal } from './common';

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

const RULE_SAMPLE = `{
  "names_people": ["Ada Lovelace", "Lovelace"],
  "names_teams": ["Skylab"],
  "names_places_orgs": ["Houston", "NASA"]
}`;

/** Subtitle profile menu. A rule file uses the same shape as the OSOS config. */
export function SubtitleProfileSelect() {
  const id = useStore(app, (s) => s.project?.settings.subtitleRules) || 'off';
  const custom = useStore(app, (s) => s.project?.settings.subtitleProfiles) ?? NONE;
  const file = useRef<HTMLInputElement>(null);
  const [help, setHelp] = useState(false);
  return (
    <>
      <span className="rules-row">
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
      <button type="button" className="linkish rules-help" onClick={() => setHelp(true)}>
        Instructions
      </button>
      </span>
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
      {help &&
        createPortal(
          <Modal
            title="Subtitle rule file"
            onClose={() => setHelp(false)}
            footer={
              <Button variant="ghost" onClick={() => setHelp(false)}>
                Close
              </Button>
            }
          >
            <div className="rule-help">
              <p>
                A subtitle profile is a <span className="mono">.json</span> file. Choose <span className="mono">Upload rules…</span> and pick it. The file
                name becomes the profile name: <span className="mono">Skylab_subs.json</span> shows up as “Skylab subs”.
              </p>
              <p>
                The file is one JSON object, and it needs at least one of these lists. <span className="mono">names_people</span>,{' '}
                <span className="mono">names_teams</span>, and <span className="mono">names_places_orgs</span> are names to recognize. Include the full name
                and any short form. <span className="mono">homophone_sets</span> is groups of words that get confused, such as{' '}
                <span className="mono">["their", "there", "they're"]</span>.
              </p>
              <p>A short file is enough:</p>
              <pre className="rule-sample">{RULE_SAMPLE}</pre>
              <p>
                Lists you leave out are filled in from OSOS SUBS, except a name list you leave out, which stays empty. You can also set{' '}
                <span className="mono">allowed_accented</span>, <span className="mono">allowed_curly</span>, <span className="mono">profanity_leave_as_is</span>,{' '}
                <span className="mono">number_words</span>, <span className="mono">ellipsis_house_style</span>, and{' '}
                <span className="mono">flag_apostrophe_consistency</span>.
              </p>
              <p>The punctuation and spelling checks stay the same. This file only supplies the lists they use.</p>
            </div>
          </Modal>,
          document.body,
        )}
    </>
  );
}
