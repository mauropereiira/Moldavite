/**
 * The three building blocks of every Settings tab. A `Group` is a titled
 * section, or a fold at the bottom of the tab; a `Row` is one setting: its
 * label and (i) on the left, its control on the right, or below when `stack`
 * is set. Labels and (i) text come from `settingsMap.ts` by id.
 */

import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useSettingsStore } from '@/stores';
import { settingsEntry } from '../settingsMap';
import { InfoTooltip } from './InfoTooltip';
import { Toggle } from './Toggle';

/** A setting's visible label, for the accessible name of its control. */
export const label = (id: string) => settingsEntry(id).item.label;

export interface RowProps {
  id: string;
  children?: ReactNode;
  /** Put the control under the label, for wide controls. */
  stack?: boolean;
  /** A status line under the label. */
  note?: ReactNode;
  /** Extra (i) text known only at runtime, such as a path. */
  detail?: ReactNode;
}

export function Row({ id, children, stack, note, detail }: RowProps) {
  const { label: text, info } = settingsEntry(id).item;
  return (
    <div className={`settings-row${stack ? ' settings-row-stack' : ''}`} data-setting={id}>
      <div className="settings-row-text">
        <div className="settings-row-label">
          <span>{text}</span>
          {(info || detail) && (
            <InfoTooltip
              label={text}
              text={
                <>
                  {info}
                  {detail}
                </>
              }
            />
          )}
        </div>
        {note && <div className="settings-row-note">{note}</div>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}

export function ToggleRow({
  id,
  value,
  onChange,
  disabled,
  note,
  detail,
}: {
  id: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  note?: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <Row id={id} note={note} detail={detail}>
      <Toggle enabled={value} onChange={onChange} ariaLabel={label(id)} disabled={disabled} />
    </Row>
  );
}

export function Group({ id, children }: { id: string; children: ReactNode }) {
  const group = settingsEntry(id).group;
  const anchor = useSettingsStore((state) => state.settingsAnchor);
  const [open, setOpen] = useState(false);
  const headingId = `settings-group-${id}`;

  if (!group.fold) {
    return (
      <section className="settings-section" data-setting={id} aria-labelledby={headingId}>
        <div className="settings-section-head">
          <h3 id={headingId} className="settings-section-heading">
            {group.label}
          </h3>
          {group.info && <InfoTooltip label={group.label} text={group.info} />}
        </div>
        {children}
      </section>
    );
  }

  // A search result or an old tab id inside the fold opens it.
  if (!open && anchor !== null && (anchor === id || group.rows.some((row) => row.id === anchor))) {
    setOpen(true);
  }

  return (
    <section className="settings-fold" data-setting={id} aria-labelledby={headingId}>
      <button
        id={headingId}
        type="button"
        className="settings-fold-toggle"
        aria-expanded={open}
        aria-controls={`${headingId}-body`}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight aria-hidden="true" className="settings-fold-caret w-3.5 h-3.5" />
        {group.label}
      </button>
      <div id={`${headingId}-body`} className="settings-fold-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
