import { useCallback, useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Bell, X } from 'lucide-react';
import { notificationsApi } from '@/api/notifications';
import { useAuth } from '@/hooks/useAuth';
import { useRelativeTime } from '../hooks/useRelativeTime';
import { cn } from '../lib/utils';

// P4 5.4 — see bka/60-product-reasoning/notification-bell-approved-spec.md.
// The `notifications` table is a college-wide outbound-announcement ledger
// (Draft -> Approved -> Rejected -> Dispatched), not a personal inbox — it
// has no read_at/per-recipient row, so "unread" here is deliberately a
// client-side, session-local "changed since I last opened this" affordance,
// never a claim about server-tracked read state.

const MAX_ITEMS = 20;
const LAST_SEEN_PREFIX = 'arcnave.notifications.lastSeen.';

function lastSeenKey(userId) {
  return `${LAST_SEEN_PREFIX}${userId}`;
}

function readLastSeen(userId) {
  const raw = window.localStorage.getItem(lastSeenKey(userId));
  return raw ? Number(raw) : 0;
}

function writeLastSeen(userId) {
  window.localStorage.setItem(lastSeenKey(userId), String(Date.now()));
}

/** Newest first, deduped by id, capped — an SSE upsert never grows the list past what the trigger promises. */
function upsert(list, notification) {
  const withoutExisting = list.filter((n) => n.id !== notification.id);
  return [notification, ...withoutExisting]
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, MAX_ITEMS);
}

const STATUS_TONE = {
  Draft: 'bg-pending-soft text-pending',
  Approved: 'bg-info-soft text-info',
  Dispatched: 'bg-success-soft text-success',
  Rejected: 'bg-danger-soft text-danger',
};

function StatusPill({ status }) {
  return (
    <span
      className={cn(
        'flex-none px-[7px] h-[18px] rounded-full text-[10px] font-[600] leading-[18px]',
        STATUS_TONE[status] || STATUS_TONE.Draft,
      )}
    >
      {status}
    </span>
  );
}

function NotificationRow({ notification }) {
  const time = useRelativeTime(notification.updated_at || notification.created_at);
  const title = notification.subject || notification.body;

  return (
    <li className="flex flex-col gap-[3px] px-[13px] py-[9px] border-t border-line-light first:border-t-0">
      <div className="flex items-start justify-between gap-[8px]">
        <span className="min-w-0 flex-1 text-[12px] font-[500] text-ink-soft truncate" title={title}>
          {title}
        </span>
        <StatusPill status={notification.status} />
      </div>
      {notification.subject && (
        <span className="text-[11px] text-ink-faint truncate" title={notification.body}>
          {notification.body}
        </span>
      )}
      <span className="text-[10.5px] text-ink-ghost">{time}</span>
    </li>
  );
}

const TRIGGER_BTN =
  'relative w-[28px] h-[28px] rounded-[8px] bg-transparent text-ink-faint hover:bg-hoverline hover:text-ink transition-colors duration-200';

function UnreadDot({ count }) {
  if (!count) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -top-[2px] -right-[2px] min-w-[14px] h-[14px] px-[3px] rounded-full bg-danger text-white text-[9px] font-[700] leading-[14px] text-center"
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

/**
 * Sidebar notification bell — lives beside `SidebarUtilityCluster`, visible
 * only to `principal`/`hod` (`notifications.read`). Loads the recent list
 * once, then keeps it live via `GET /notifications/stream`
 * (`notificationsApi.watch`) for as long as the component is mounted.
 */
export function NotificationBell() {
  const { user, can } = useAuth();
  const allowed = can('notifications.read');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(0);

  useEffect(() => {
    if (!allowed || !user) return;
    setLastSeen(readLastSeen(user.userId));
  }, [allowed, user]);

  const loadList = useCallback(() => {
    setLoading(true);
    setError(false);
    notificationsApi
      .list({ limit: MAX_ITEMS })
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    loadList();
  }, [allowed, loadList]);

  // The stream is a plain fetch reader (see api/notifications.js) — tied to
  // this component's own mount lifecycle, not to the popover being open, so
  // a notification created while the popover is closed still moves the
  // badge the moment it happens.
  const onStreamEvent = useRef(null);
  onStreamEvent.current = (evt) => {
    if (evt.type === 'notification') {
      setItems((prev) => upsert(prev, evt.notification));
    }
  };

  useEffect(() => {
    if (!allowed) return undefined;
    const controller = new AbortController();
    notificationsApi.watch((evt) => onStreamEvent.current(evt), { signal: controller.signal });
    return () => controller.abort();
  }, [allowed]);

  const unreadCount = items.filter((n) => new Date(n.updated_at || n.created_at).getTime() > lastSeen).length;

  const handleOpenChange = (next) => {
    setOpen(next);
    if (next && user) {
      writeLastSeen(user.userId);
      setLastSeen(Date.now());
    }
  };

  if (!allowed) return null;

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={unreadCount ? `Notifications (${unreadCount} new)` : 'Notifications'}
          title="Notifications"
          className={cn(TRIGGER_BTN, 'grid place-items-center', open && 'bg-hoverline text-ink')}
        >
          <Bell size={15} strokeWidth={1.8} aria-hidden="true" />
          <UnreadDot count={unreadCount} />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label="Notifications"
          className={cn(
            'z-[120] flex flex-col outline-none',
            'w-[320px] max-w-[calc(100vw-24px)]',
            'max-h-[min(460px,var(--radix-popover-content-available-height))]',
            'bg-raised border border-line-strong rounded-[15px] shadow-pop overflow-hidden',
            'data-[state=open]:animate-fadeUp motion-reduce:animate-none',
          )}
        >
          <div className="shrink-0 flex items-center gap-[8px] px-[13px] pt-[11px] pb-[8px] bg-surface border-b border-line-light">
            <span className="flex-1 text-[12.5px] font-[600] text-ink-soft">Notifications</span>
            <Popover.Close
              aria-label="Close notifications"
              title="Close"
              className="flex-none w-[22px] h-[22px] grid place-items-center border-0 bg-transparent rounded-[7px] text-ink-ghost cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink-soft"
            >
              <X size={13} strokeWidth={1.9} />
            </Popover.Close>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet">
            {loading && <p className="px-[13px] py-[16px] text-[11.5px] text-ink-faint">Loading…</p>}
            {!loading && error && (
              <div className="px-[13px] py-[16px] flex items-center justify-between gap-[8px]">
                <span className="text-[11.5px] text-ink-faint">Couldn't load notifications.</span>
                <button
                  type="button"
                  onClick={loadList}
                  className="flex-none text-[11.5px] font-[500] text-accent cursor-pointer bg-transparent border-0"
                >
                  Retry
                </button>
              </div>
            )}
            {!loading && !error && items.length === 0 && (
              <p className="px-[13px] py-[16px] text-[11.5px] text-ink-faint">No notifications yet.</p>
            )}
            {!loading && !error && items.length > 0 && (
              <ul className="m-0 p-0 list-none">
                {items.map((n) => (
                  <NotificationRow key={n.id} notification={n} />
                ))}
              </ul>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
