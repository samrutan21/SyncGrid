import { isTimecode } from '../core/timecode';
import type { VideoSlot } from '../core/types';
import { setVideoStartTC } from '../state/app';
import { CommitInput } from './common';

/**
 * The editable "File starts at" field, plus a note when that value was read
 * from the file. Typing always wins; the detected value can be restored.
 */
export function StartTCField({
  versionId,
  value,
  detected,
  from,
  compact,
}: {
  versionId: string;
  value: string;
  detected?: string;
  from?: VideoSlot['detectedFrom'];
  compact?: boolean;
}) {
  const found = detected && isTimecode(detected) ? detected : undefined;
  const matches = !!found && found === value;
  const source = from === 'picture' ? 'the burned-in timecode' : 'the file timecode';
  const title = matches
    ? `Detected from ${source}. Edit if the markers don’t match the picture.`
    : 'Timecode of the first frame of the video file';
  return (
    <div className={`start-tc ${compact ? 'is-compact' : ''}`}>
      <label className="mini-field" title={title}>
        <span>{compact ? 'Starts' : 'File starts at'}</span>
        <CommitInput
          className={`tc-input ${isTimecode(value) ? '' : 'invalid'}`}
          value={value}
          onCommit={(v) => setVideoStartTC(versionId, v.trim())}
        />
        {compact && matches && <span className="tc-dot" title={title} />}
      </label>
      {!compact && matches && (
        <p className="muted small start-tc-note">Detected from {source}. Change it if the picture doesn’t match.</p>
      )}
      {found && !matches && (
        <button type="button" className="linkish start-tc-note" title={`Detected from ${source}`} onClick={() => setVideoStartTC(versionId, found)}>
          {compact ? found : `Use detected ${found}`}
        </button>
      )}
    </div>
  );
}
