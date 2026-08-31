import { useCallback, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  ArrowUpRight,
  Building2,
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Globe,
  Image as ImageIcon,
  Link2,
  Paperclip,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { SourcePreviewDrawer } from './SourcePreviewDrawer';
import { downloadFile } from '../api/client';
import { cn } from '../lib/utils';

/**
 * Sources — what the selected assistant reply actually used.
 *
 * Three rules the shape of this depends on:
 *  - It is scoped to **one assistant response id**, never to the conversation.
 *    Selecting a different reply shows that reply's references, and the
 *    trigger's own count changes with it.
 *  - A reference appears only if the reply used it. An attachment that was
 *    merely present is not a source.
 *  - Nothing the user cannot open is listed at all — a title is itself
 *    information, so an unreadable document is filtered upstream rather than
 *    shown greyed out here.
 *
 * ## Two surfaces, one list
 * The list, the grouping and the rows are identical everywhere; only what
 * holds them changes, and only with the mode:
 *
 *  - **Normal view** — a compact popup anchored to its own `Sources (N)`
 *    trigger. Content-sized: ~320px wide, capped in height, scrolling
 *    internally past that, never stretched to the bottom of the screen. On a
 *    narrow viewport it stays the same anchored popover, shrunk to fit inside
 *    the viewport's own padding, rather than becoming a full-screen page.
 *  - **Full screen** — the same list as a compact card pinned to the right of
 *    the canvas, so provenance can stay in view while reading. Still capped,
 *    still content-sized, still never a full-height column; the trigger
 *    dismisses and restores it instead of opening a popup.
 *
 * There is no drawer and no reserved right column in either.
 *
 * ## Groups
 * Two, and only two: **Web** and **Files**. `web` sources are the first;
 * uploads, institutional documents, personal documents, project/artifact
 * attachments and records are all file-backed references and group as the
 * second. A group with nothing in it is not rendered — an empty "Web (0)" is a
 * question the popup should never raise.
 */

const KIND = {
  uploaded: { label: 'Uploaded file', group: 'files' },
  web: { label: 'Web page', group: 'web' },
  institutional: { icon: Building2, label: 'Institutional document', group: 'files' },
  personal: { icon: FileText, label: 'Personal document', group: 'files' },
  record: { icon: Database, label: 'Record', group: 'files' },
  // A tool-call result the reply was grounded in (aiService.buildEvidence)
  // — real provenance, but never a document: nothing to open, so this
  // stays a plain (non-clickable) row, same as `record`'s own icon.
  tool: { icon: Database, label: 'Data lookup', group: 'files' },
};

/** An attachment's glyph follows the file, not the fact that it was attached. */
function attachmentIcon(source) {
  const ext = source.title?.split('.').pop()?.toLowerCase() ?? '';
  if (source.type?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return ImageIcon;
  if (['csv', 'tsv'].includes(ext)) return Paperclip;
  if (['xlsx', 'xls', 'ods'].includes(ext)) return FileSpreadsheet;
  if (['js', 'jsx', 'ts', 'tsx', 'json', 'py', 'sql', 'html', 'css'].includes(ext)) return Code2;
  return FileText;
}

/** The domain is the honest identifier for a link — the title is authored by it. */
function domainOf(href = '') {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href.replace(/^https?:\/\//, '').split('/')[0];
  }
}

function iconFor(source) {
  if (source.kind === 'uploaded') return attachmentIcon(source);
  if (source.kind === 'web') return Link2;
  return (KIND[source.kind] ?? KIND.record).icon;
}

function groupOf(source) {
  return (KIND[source.kind] ?? KIND.record).group;
}

/**
 * A document source opens ArcNave's own preview rather than a URL: an
 * institutional or personal document is a record inside the app, and there is
 * nothing to hand a new browser tab. Everything else opens whatever link it
 * genuinely has.
 */
function previewable(source) {
  return source.kind === 'institutional' || source.kind === 'personal';
}

/**
 * A chat attachment or an AI-generated document (`kind: 'uploaded'`) is a
 * real `documents` row — `source.documentId` is that row's real id, the
 * same one ChatMessage.jsx's own SentFileChip already downloads through.
 * There is no separate "open" surface for these in the app yet (no
 * in-browser document viewer), so the one real action is the same
 * authenticated download SentFileChip already proves out — never a bare
 * `window.open(href)`, which can't carry the Bearer token this endpoint
 * requires.
 */
function downloadable(source) {
  return source.kind === 'uploaded' && Boolean(source.documentId);
}

/**
 * One compact 46px line: glyph, title, one subdued line, and a quiet arrow
 * that says the row opens something. No card, no border, no shadow — a source
 * list is an index, and an index whose entries are each a panel shows two of
 * them per screen.
 */
function SourceRow({ source, onPreview }) {
  const [downloading, setDownloading] = useState(false);
  const Icon = iconFor(source);
  const href = source.href || source.previewUrl;
  const opensPreview = previewable(source);
  const opensDownload = downloadable(source);
  const openable = opensPreview || opensDownload || Boolean(href);
  // Websites name their domain; a file names where it came from, falling back
  // to what kind of thing it is when it has no stated origin.
  const secondary =
    source.kind === 'web' ? domainOf(source.href) : source.origin || (KIND[source.kind] ?? KIND.record).label;
  // The page/section reference, where the reply recorded one.
  const locator = source.kind === 'web' ? null : source.detail;

  const body = (
    <>
      <Icon size={13} strokeWidth={1.8} className="flex-none text-ink-ghost" aria-hidden="true" />
      <span className="min-w-0 flex-1 leading-[1.25]">
        <span className="block text-[12px] font-[500] text-ink-soft truncate" title={source.title}>
          {source.title}
        </span>
        {(secondary || locator) && (
          <span className="flex items-center gap-[5px] min-w-0 text-[10.5px] text-ink-faint">
            <span className="truncate" title={secondary}>
              {secondary}
            </span>
            {locator && (
              <span className="flex-none truncate max-w-[92px] text-ink-ghost" title={locator}>
                · {locator}
              </span>
            )}
          </span>
        )}
      </span>
      {openable && !opensPreview && !opensDownload && (
        <ArrowUpRight
          size={13}
          strokeWidth={1.9}
          aria-hidden="true"
          className="flex-none text-ink-ghost opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      )}
      {opensPreview && (
        <Eye
          size={13}
          strokeWidth={1.9}
          aria-hidden="true"
          className="flex-none text-ink-ghost opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      )}
      {opensDownload && (
        <Download
          size={13}
          strokeWidth={1.9}
          aria-hidden="true"
          className={cn(
            'flex-none text-ink-ghost transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100',
            downloading ? 'opacity-100 animate-pulseSoft' : 'opacity-0',
          )}
        />
      )}
    </>
  );

  const ROW = 'flex items-center gap-[9px] w-full h-[46px] px-[9px] rounded-[9px]';

  if (!openable) return <li className={ROW}>{body}</li>;

  const handleClick = async () => {
    if (opensPreview) {
      onPreview?.(source);
      return;
    }
    if (opensDownload) {
      if (downloading) return;
      setDownloading(true);
      try {
        await downloadFile(`/documents/${source.documentId}/download`, source.title);
      } catch {
        toast(`Could not download ${source.title} — please try again.`);
      } finally {
        setDownloading(false);
      }
      return;
    }
    window.open(href, '_blank', 'noopener');
  };

  return (
    <li>
      <button
        type="button"
        // Web sources leave in a new browsing context with the opener severed;
        // a document source opens ArcNave's own preview instead of a tab; an
        // uploaded/generated file downloads for real, the same authenticated
        // call SentFileChip already uses.
        onClick={handleClick}
        disabled={opensDownload && downloading}
        aria-label={`${opensPreview ? 'Preview' : opensDownload ? 'Download' : 'Open'} ${source.title}`}
        title={source.title}
        className={cn(
          ROW,
          'group border-0 bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:opacity-70 disabled:cursor-wait',
        )}
      >
        {body}
      </button>
    </li>
  );
}

/**
 * A group is a header button and a list, divided from its neighbour by one
 * hairline — never a card. Open state lives here and therefore lasts as long
 * as the popup is open, which is exactly as long as it is worth remembering.
 */
function Group({ id, label, Icon, items, open, onToggle, onPreview }) {
  if (!items.length) return null;

  return (
    <section className="border-t border-line-light first:border-t-0">
      <h3 className="m-0">
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-expanded={open}
          aria-controls={`sources-group-${id}`}
          className="flex items-center gap-[6px] w-full h-[30px] px-[9px] border-0 bg-transparent rounded-[8px] text-left cursor-pointer transition-colors duration-200 hover:bg-tint2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          {open ? (
            <ChevronDown size={12} strokeWidth={2} className="flex-none text-ink-ghost" aria-hidden="true" />
          ) : (
            <ChevronRight size={12} strokeWidth={2} className="flex-none text-ink-ghost" aria-hidden="true" />
          )}
          <Icon size={12} strokeWidth={1.9} className="flex-none text-ink-ghost" aria-hidden="true" />
          <span className="flex-1 min-w-0 truncate text-[11px] font-[600] text-ink-muted">{label}</span>
          <span className="flex-none text-[10.5px] text-ink-faint tabular-nums">({items.length})</span>
        </button>
      </h3>
      <ul id={`sources-group-${id}`} hidden={!open} className="m-0 p-0 pb-[4px] list-none">
        {items.map((s) => (
          <SourceRow key={s.id} source={s} onPreview={onPreview} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Which group opens on its own: the only one, if there is only one; otherwise
 * the fuller of the two, with Web winning a tie because a link is the cheaper
 * thing to check.
 */
function defaultOpenGroup(web, files) {
  if (!files.length) return 'web';
  if (!web.length) return 'files';
  return files.length > web.length ? 'files' : 'web';
}

function SourcesGroups({ sources, onPreview }) {
  // Attachments most recent first; websites keep the order the reply used them.
  const web = sources.filter((s) => groupOf(s) === 'web');
  const files = sources.filter((s) => groupOf(s) === 'files');
  const [open, setOpen] = useState(() => {
    const first = defaultOpenGroup(web, files);
    return { web: first === 'web', files: first === 'files' };
  });
  const toggle = (id) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="flex flex-col">
      <Group id="web" label="Web" Icon={Globe} items={web} open={open.web} onToggle={toggle} onPreview={onPreview} />
      <Group
        id="files"
        label="Files"
        Icon={FileText}
        items={files}
        open={open.files}
        onToggle={toggle}
        onPreview={onPreview}
      />
    </div>
  );
}

/**
 * The header both surfaces share: title, the count in words, and one compact
 * close. `Close` differs only in what dismisses it — the popover's own
 * primitive, or the pinned card's dismiss callback.
 */
function SourcesHeader({ total, Close, className }) {
  return (
    <div className={cn('shrink-0 flex items-center gap-[8px] bg-surface border-b border-line-light', className)}>
      <span className="flex-1 min-w-0 flex items-baseline gap-[6px]">
        <span className="text-[12.5px] font-[600] text-ink-soft">Sources</span>
        <span className="text-[10.5px] text-ink-faint tabular-nums">{countLabel(total)}</span>
      </span>
      {Close}
    </div>
  );
}

const CLOSE_BTN =
  'flex-none w-[22px] h-[22px] grid place-items-center border-0 bg-transparent rounded-[7px] text-ink-ghost cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent';

/**
 * Opening a document preview from either surface. The drawer is rendered by
 * whichever surface owns it, and the popup additionally has to get out of its
 * own way — a popover still hanging over the drawer it just opened is two
 * dismissable layers arguing about Escape.
 */
function useSourcePreview(onOpenPreview) {
  const [source, setSource] = useState(null);
  const open = useCallback(
    (s) => {
      onOpenPreview?.();
      setSource(s);
    },
    [onOpenPreview],
  );
  return {
    source,
    open,
    // The source is kept until the drawer has closed, so its content does not
    // blank out mid-exit.
    close: useCallback(() => setSource(null), []),
  };
}

/** `1 source` / `6 sources` — the same count the trigger is showing. */
function countLabel(n) {
  return `${n} ${n === 1 ? 'source' : 'sources'}`;
}

/** The one trigger face, shared by both modes so the header never shifts. */
const TRIGGER =
  'flex items-center h-[26px] px-[9px] border-0 rounded-[8px] bg-transparent ' +
  'font-sans text-[11.5px] font-[500] text-ink-muted whitespace-nowrap cursor-pointer ' +
  'transition-colors duration-200 hover:bg-accent-soft hover:text-accent ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

/** The id the pinned card carries, so its trigger can point `aria-controls` at it. */
const WIDGET_ID = 'sources-pinned';

/**
 * The whole Sources interaction: one quiet text trigger and the surface it
 * owns.
 *
 * A route hands it the selected response's sources and, when it is in full
 * screen, says so — the count, the grammar, the grouping, the anchoring and
 * the open/close behaviour all live here, so every chat surface gets the
 * identical thing. Nothing renders at all when the reply cites nothing.
 *
 * **Normal view** is a Radix Popover, which supplies the semantics this needs
 * and no more: `aria-expanded` and `aria-controls` on the trigger, focus into
 * the panel on open and back to the trigger on close, Escape and outside-click
 * to dismiss, and a second click on the trigger to toggle it shut. It is
 * deliberately **not** modal — nothing behind it is inert, and there is no
 * focus trap on what is only a reference list.
 *
 * **Full screen** is the pinned card instead, so the trigger becomes a plain
 * toggle for it: same face, same count, `aria-expanded`/`aria-controls`
 * pointing at the card, no popup.
 */
export function SourcesTrigger({
  sources,
  label = 'Sources for this response',
  // Full screen: the list is pinned beside the transcript, so this control
  // dismisses and restores that card instead of opening a popup.
  pinned = false,
  pinnedShown = false,
  onTogglePinned,
}) {
  const [open, setOpen] = useState(false);
  const preview = useSourcePreview(useCallback(() => setOpen(false), []));
  const total = sources?.length ?? 0;
  if (!total) return null;

  const text = (
    <>
      {total === 1 ? 'Source' : 'Sources'} ({total})
    </>
  );

  if (pinned) {
    return (
      <button
        type="button"
        onClick={onTogglePinned}
        aria-expanded={pinnedShown}
        aria-controls={WIDGET_ID}
        aria-label={`${label} (${countLabel(total)})`}
        title={label}
        className={cn(TRIGGER, pinnedShown && 'bg-accent-soft text-accent')}
      >
        {text}
      </button>
    );
  }

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`${label} (${countLabel(total)})`}
            title={label}
            // Text-first and quiet: it sits in a header of icons without
            // becoming the loudest thing in it.
            className={cn(TRIGGER, 'data-[state=open]:bg-accent-soft data-[state=open]:text-accent')}
          >
            {text}
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={12}
            aria-label="Sources"
            className={cn(
              // Sources is a chat surface: it names what a reply was built
              // from, and it is read alongside the reply, so it takes the
              // reading face.
              'z-[120] flex flex-col font-chat outline-none',
              'w-[320px] max-w-[calc(100vw-24px)]',
              // Capped, and additionally capped by whatever room the trigger's
              // own position leaves — so it can never run to the bottom of the
              // screen and never opens off-screen on a short viewport.
              'max-h-[min(460px,var(--radix-popover-content-available-height))]',
              'bg-raised border border-line-strong rounded-[15px] shadow-pop overflow-hidden',
              // Right to left, ~10px, 200ms — the entrance every Sources
              // surface has had since it moved to this edge. Entrance only,
              // like every other surface in the app: an exit animation holds
              // the panel mounted until `animationend`, which is a dismissal
              // that can visibly fail to land.
              'data-[state=open]:animate-sourcesIn motion-reduce:animate-none',
            )}
          >
            <SourcesHeader
              total={total}
              className="px-[13px] pt-[11px] pb-[8px]"
              Close={
                <Popover.Close aria-label="Close sources" title="Close" className={CLOSE_BTN}>
                  <X size={13} strokeWidth={1.9} />
                </Popover.Close>
              }
            />
            <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet py-[4px] px-[5px]">
              <SourcesGroups sources={sources} onPreview={preview.open} />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <SourcePreviewDrawer source={preview.source} open={!!preview.source} onClose={preview.close} />
    </>
  );
}

/**
 * Full screen: the same list as a compact card pinned to the right of the
 * chat canvas.
 *
 * It floats over the transcript rather than reserving a column, so entering
 * and leaving full screen never reflows the reading measure, and it is capped
 * to a fraction of the canvas — never top to bottom — so it reads as a card
 * belonging to the right edge rather than a second rail. The header is fixed
 * and the list underneath is the only scrolling region.
 *
 * Rendered by the route only when the reply cites something and the reader has
 * not dismissed it; the header trigger brings it back.
 *
 * `rightClass` is how a route that already has something docked on that edge —
 * the artifact's context column — moves the card clear of it instead of
 * floating on top of it.
 */
export function SourcesWidget({ sources, onClose, rightClass = 'right-[16px]' }) {
  const preview = useSourcePreview();
  const total = sources?.length ?? 0;
  if (!total) return null;

  return (
    <>
      <aside
        id={WIDGET_ID}
        aria-label="Sources"
        className={cn(
          'hidden lg:flex flex-col font-chat animate-sourcesIn motion-reduce:animate-none',
          'absolute top-[8px] z-[30] w-[300px]',
          rightClass,
          'max-h-[min(58%,440px)] overflow-hidden',
          'bg-raised border border-line-strong rounded-[16px] shadow-pop',
        )}
      >
        <SourcesHeader
          total={total}
          className="px-[13px] pt-[11px] pb-[8px] rounded-t-[15px]"
          Close={
            <button
              type="button"
              onClick={onClose}
              aria-label="Hide sources"
              title="Hide sources"
              className={CLOSE_BTN}
            >
              <X size={13} strokeWidth={1.9} />
            </button>
          }
        />
        <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet py-[4px] px-[5px]">
          <SourcesGroups sources={sources} onPreview={preview.open} />
        </div>
      </aside>

      <SourcePreviewDrawer source={preview.source} open={!!preview.source} onClose={preview.close} />
    </>
  );
}
