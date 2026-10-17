import { useEffect, useRef, useState } from 'react';
import type { GfxType } from '../core/gfxCategories';
import { addGfxType, app, moveGfxType, toggleGfxFilter } from '../state/app';
import { useStore } from '../state/createStore';

/** Sidebar filter. Empty selection shows every graphic; otherwise any checked type. Type rows can be dragged. */
export function GfxCategoryFilter({ types }: { types: GfxType[] }) {
  const selected = useStore(app, (s) => s.gfxFilter);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const label = selected.length
    ? selected.map((id) => (id === 'temp' ? 'Temp' : types.find((t) => t.id === id)?.short ?? id)).join(', ')
    : 'Show all';

  return (
    <div className="gfx-filter" ref={root}>
      <button type="button" className="input gfx-filter-btn" aria-label="Show GFX categories" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div className="gfx-filter-menu">
          <button type="button" className={selected.length === 0 ? 'is-on' : ''} onClick={() => app.set({ gfxFilter: [] })}>
            Show all
          </button>
          {types.map((t) => (
            <div
              key={t.id}
              draggable
              title={`${t.label}. Drag to reorder.`}
              className={`gfx-filter-row is-draggable ${over === t.id ? 'is-drop' : ''}`}
              onClick={() => {
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                toggleGfxFilter(t.id);
              }}
              onDragStart={(e) => {
                dragId.current = t.id;
                dragged.current = false;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', t.id);
              }}
              onDragOver={(e) => {
                if (!dragId.current || dragId.current === t.id) return;
                e.preventDefault();
                if (over !== t.id) setOver(t.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragId.current;
                dragId.current = null;
                setOver(null);
                if (id) moveGfxType(id, t.id);
              }}
              onDragEnd={() => {
                dragged.current = true;
                dragId.current = null;
                setOver(null);
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(t.id)}
                aria-label={t.label}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={() => toggleGfxFilter(t.id)}
              />
              <span>{t.short}</span>
              {t.label !== t.short && <span className="muted">{t.label}</span>}
            </div>
          ))}
          <label>
            <input type="checkbox" checked={selected.includes('temp')} onChange={() => toggleGfxFilter('temp')} />
            <span>Temp</span>
          </label>
        </div>
      )}
    </div>
  );
}

/** One tab per GFX category, plus the full list and the temp list. Category tabs can be dragged. */
export function GfxSheetTabs({ types }: { types: GfxType[] }) {
  const current = useStore(app, (s) => s.gfxSheet);
  const dragId = useRef<string | null>(null);
  const dragged = useRef(false);
  const [over, setOver] = useState<string | null>(null);

  const fixed = (id: string, short: string, label: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      title={label}
      aria-selected={current === id}
      className={`sheet-subtab ${current === id ? 'is-on' : ''}`}
      onClick={() => app.set({ gfxSheet: id })}
    >
      {short}
    </button>
  );

  return (
    <div className="sheet-subtabs" role="tablist" aria-label="GFX categories">
      {fixed('all', 'All', 'All graphics')}
      {types.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          draggable
          title={`${t.label}. Drag to reorder.`}
          aria-selected={current === t.id}
          className={`sheet-subtab is-draggable ${current === t.id ? 'is-on' : ''} ${over === t.id ? 'is-drop' : ''}`}
          onClick={() => {
            if (dragged.current) {
              dragged.current = false;
              return;
            }
            app.set({ gfxSheet: t.id });
          }}
          onDragStart={(e) => {
            dragId.current = t.id;
            dragged.current = false;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', t.id);
          }}
          onDragOver={(e) => {
            if (!dragId.current || dragId.current === t.id) return;
            e.preventDefault();
            if (over !== t.id) setOver(t.id);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const id = dragId.current;
            dragId.current = null;
            setOver(null);
            if (id) moveGfxType(id, t.id);
          }}
          onDragEnd={() => {
            dragged.current = true;
            dragId.current = null;
            setOver(null);
          }}
        >
          {t.short}
        </button>
      ))}
      {fixed('temp', 'Temp', 'Temp graphics')}
      <AddGfxType compact />
    </div>
  );
}

export function AddGfxType({ compact }: { compact?: boolean }) {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  if (compact && !open) {
    return (
      <button type="button" className="sheet-subtab" onClick={() => setOpen(true)}>
        + type
      </button>
    );
  }
  return (
    <form
      className="gfx-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        addGfxType(name);
        setName('');
        if (compact) setOpen(false);
      }}
    >
      <input
        className="input"
        aria-label="New GFX category"
        placeholder="Add a category"
        value={name}
        autoFocus={compact}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (compact && !name.trim()) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setName('');
            setOpen(false);
          }
        }}
      />
    </form>
  );
}
