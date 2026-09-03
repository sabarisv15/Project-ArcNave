import * as Dialog from '@radix-ui/react-dialog';
import { Building2, Database, FileSpreadsheet, FileText, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * Artifact context — what this artifact was **made from**.
 *
 * Not the chat Sources panel, and deliberately answering a different question.
 * Sources explains one assistant reply ("where did this answer come from");
 * this explains the document on the canvas ("what went into it"), which is what
 * someone about to circulate or defend an artifact actually needs. The two
 * never merge: a file dropped into the revision chat to ask a question about it
 * is not a creation input and does not appear here.
 *
 * Rules the shape depends on:
 *  - Creation inputs only — uploads made for the artifact, institutional and
 *    personal documents it drew on, and linked records.
 *  - Nothing the user cannot open is listed; permission is resolved upstream,
 *    not shown here as a greyed row.
 *  - An artifact with no recorded inputs renders **nothing** — no widget, no
 *    header control, no reserved column. A tall empty panel is worse than an
 *    absent one, so the short empty state exists only inside the drawer, which
 *    the user has to open deliberately.
 */

const KIND = {
  uploaded: { icon: Paperclip, label: 'Uploaded file' },
  institutional: { icon: Building2, label: 'Institutional document' },
  personal: { icon: FileText, label: 'Personal document' },
  record: { icon: Database, label: 'Linked record' },
};

function iconFor(item) {
  const ext = item.name?.split('.').pop()?.toLowerCase() ?? '';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return FileSpreadsheet;
  return (KIND[item.kind] ?? KIND.record).icon;
}

function ContextRow({ item }) {
  const Icon = iconFor(item);
  const secondary = [item.meta, item.size].filter(Boolean).join(' · ');

  return (
    <li>
      <button
        type="button"
        // Opening a creation input is a real document action, so it goes
        // through the same preview path the rest of the app uses rather than
        // inventing a second one here.
        onClick={() => toast(`Opening ${item.name} is not available in this preview`)}
        aria-label={`Open ${item.name}`}
        className="flex items-center gap-[8px] w-full h-[38px] px-[8px] rounded-[8px] border-0 bg-transparent text-left font-sans cursor-pointer transition-colors duration-200 hover:bg-tint2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        <Icon size={13} strokeWidth={1.8} className="flex-none text-ink-ghost" aria-hidden="true" />
        <span className="min-w-0 flex-1 leading-[1.25]">
          <span className="block text-[12px] font-[500] text-ink-soft truncate" title={item.name}>
            {item.name}
          </span>
          {secondary && (
            <span className="block text-[10.5px] text-ink-faint truncate" title={secondary}>
              {secondary}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function ContextBody({ items }) {
  if (!items?.length) {
    return (
      <p className="m-0 px-[8px] py-[10px] text-[11.5px] leading-[1.45] text-ink-faint">
        No recorded context for this artifact.
      </p>
    );
  }
  return (
    <ul className="m-0 p-0 list-none">
      {items.map((i) => (
        <ContextRow key={i.id} item={i} />
      ))}
    </ul>
  );
}

/** Shared sticky header — same title and count in the column and the drawer. */
function ContextHeader({ count, onClose, closeLabel, asDialogTitle = false, className }) {
  const Title = asDialogTitle ? Dialog.Title : 'span';
  const Close = asDialogTitle ? Dialog.Close : 'button';

  return (
    <div className={cn('shrink-0 flex items-center gap-[8px] border-b border-line-light', className)}>
      <Title className="flex-1 m-0 text-[12.5px] font-[600] text-ink-soft">Artifact context</Title>
      <span className="text-[11px] text-ink-faint tabular-nums">{count}</span>
      <Close
        type={asDialogTitle ? undefined : 'button'}
        onClick={asDialogTitle ? undefined : onClose}
        aria-label={closeLabel}
        title={closeLabel}
        className="flex-none w-[24px] h-[24px] grid place-items-center border-0 bg-transparent rounded-[7px] text-ink-ghost cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink-soft"
      >
        <X size={14} strokeWidth={1.9} />
      </Close>
    </div>
  );
}

/**
 * Wide desktop: a compact sibling column, 280px behind one hairline, matching
 * the chat Sources column's geometry so the workspace has one right-hand shape
 * rather than two. `pinned` is the full-screen case — the rail is gone, so the
 * threshold drops to `lg` and the column stays put while the canvas scrolls.
 */
export function ArtifactContextPanel({ items, onClose, pinned = false }) {
  const total = items?.length ?? 0;
  if (!total) return null;

  return (
    <aside
      aria-label="Artifact context"
      className={cn(
        'hidden flex-col shrink-0 w-[280px] min-h-0 border-l border-divider',
        pinned ? 'lg:flex' : 'min-[1360px]:flex',
      )}
    >
      <ContextHeader
        count={total}
        onClose={onClose}
        closeLabel="Hide artifact context"
        className="sticky top-0 z-[1] bg-surface px-[14px] pt-[16px] pb-[8px]"
      />
      <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[6px] py-[8px]">
        <ContextBody items={items} />
      </div>
    </aside>
  );
}

/** The same list as a right drawer, for viewports narrower than the column. */
export function ArtifactContextDrawer({ items, open, onOpenChange }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-overlay/15 animate-fadeUp motion-reduce:animate-none" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 right-0 z-[101] w-[min(340px,92vw)] flex flex-col',
            'bg-raised border-l border-line-strong rounded-l-[20px] shadow-pop outline-none',
            'data-[state=open]:animate-railIn motion-reduce:animate-none',
          )}
        >
          <ContextHeader
            count={items?.length ?? 0}
            closeLabel="Close artifact context"
            asDialogTitle
            className="px-[16px] pt-[16px] pb-[8px]"
          />
          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[8px] py-[8px]">
            <ContextBody items={items ?? []} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
