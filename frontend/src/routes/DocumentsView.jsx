import { useState } from 'react';
import { cn } from '../lib/utils';
import { DocumentsProvider } from '../store/DocumentsProvider';
import { InstitutionalDocuments } from '../components/InstitutionalDocuments';
import { PersonalDocuments } from '../components/PersonalDocuments';

const TABS = [
  { key: 'institutional', label: 'Institutional documents' },
  { key: 'personal', label: 'Personal documents' },
];

/**
 * Documents is exactly two things, and the tab row says so.
 *
 * The split is not a filter over one pile: institutional documents are
 * published by an authority and read-only here, personal documents are the
 * staff member's own private files. They are separate collections with
 * separate shapes (see `documentsData.js`), so neither can appear in the
 * other's tab by a forgotten condition.
 *
 * Tabs use the same primary text-tab language as the Attendance workspace —
 * 14.5px, semibold active label, 2px teal underline on a full hairline — so
 * this reads as the same level of navigation, not a new one.
 */
export function DocumentsView() {
  const [tab, setTab] = useState('institutional');

  return (
    <DocumentsProvider>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden animate-viewIn">
        <div className="flex-none px-[24px] pt-[18px] border-b border-line">
          <div
            role="tablist"
            aria-label="Document types"
            className="flex items-center gap-[30px] overflow-x-auto overflow-y-hidden scroll-quiet"
          >
            {TABS.map(({ key, label }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(key)}
                  className={cn(
                    'relative -mb-px flex-none pb-[11px] border-0 border-b-2 bg-transparent font-sans text-[14.5px] whitespace-nowrap cursor-pointer transition-colors duration-200',
                    active
                      ? 'border-accent text-ink font-[600]'
                      : 'border-transparent text-ink-soft font-[500] hover:text-ink',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {tab === 'institutional' ? <InstitutionalDocuments /> : <PersonalDocuments />}
      </div>
    </DocumentsProvider>
  );
}
