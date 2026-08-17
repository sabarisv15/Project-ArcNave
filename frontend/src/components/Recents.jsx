import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { RecentChatItem } from './RecentChatItem';
import { SearchControl, SearchField } from './SearchControl';
import { FilterControl } from './FilterControl';
import { useWorkspace } from '../store/WorkspaceProvider';
import { RECENT_FILTERS } from '../lib/mockData';

/** Recents owns the largest share of sidebar space: one continuous chronological list. */
export function Recents() {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const [searchOpen, setSearchOpen] = useState(false);
  const {
    chats, recentQuery, setRecentQuery, recentFilter, setRecentFilter,
    seedThread, projConv, artConv,
  } = useWorkspace();

  const q = recentQuery.toLowerCase();
  const list = chats.filter((c) => {
    if (q && !c.title.toLowerCase().includes(q)) return false;
    if (recentFilter === 'Normal chats') return c.kind === 'chat';
    if (recentFilter === 'Project chats') return c.kind === 'project';
    if (recentFilter === 'Today') return /Just now|hour/.test(c.meta);
    if (recentFilter === 'This week') return !/Last week/.test(c.meta);
    return true;
  });

  // Same resolution order ProjectDetail uses for its own conversation: the URL's
  // `?c=` wins, projConv is only a fallback for a project with no explicit query.
  const activeId =
    params.chatId ||
    (params.projectId ? searchParams.get('c') || projConv[params.projectId] : null) ||
    (params.artifactId ? artConv[params.artifactId] : null);

  const open = (chat) => {
    seedThread(chat);
    if (chat.kind === 'project' && chat.projectId) navigate(`/projects/${chat.projectId}?c=${chat.id}`);
    else navigate(`/chat/${chat.id}`);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-none flex items-center justify-between pt-[18px] px-[10px] pb-[6px]">
        <span className="text-[11.5px] font-[500] tracking-[.06em] uppercase text-ink-faint">Recents</span>
        <div className="flex items-center gap-[2px]">
          <SearchControl
            open={searchOpen}
            onToggle={() => {
              setSearchOpen((v) => !v);
              setRecentQuery('');
            }}
            label="Search conversations"
          />
          <FilterControl
            options={RECENT_FILTERS}
            value={recentFilter}
            onChange={setRecentFilter}
            label="Filter conversations"
          />
        </div>
      </div>

      {searchOpen && (
        <div className="flex-none px-[6px] pb-[8px] animate-fadeUp">
          <SearchField value={recentQuery} onChange={setRecentQuery} placeholder="Search conversations…" />
        </div>
      )}

      {/* `autohide-scope` + `autohide-bar`: the bar is mounted always so keyboard
          scrolling can bring it back, and painted only while the list is
          hovered, focused or moving — see the rule in `index.css`. */}
      <ScrollArea.Root type="always" className="autohide-scope flex-1 min-h-0 overflow-hidden">
        {/* `recents-viewport` blocks Radix's shrink-wrapping content wrapper —
            see the rule in `index.css`. Without it a long title widens the whole
            list instead of ellipsising. */}
        <ScrollArea.Viewport className="recents-viewport w-full h-full scroll-quiet px-[2px] pb-[4px]">
          <div className="flex flex-col gap-[1px]">
            {list.map((chat) => (
              <RecentChatItem key={chat.id} chat={chat} active={activeId === chat.id} onClick={() => open(chat)} />
            ))}
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical" className="autohide-bar w-[9px] p-[2px]">
          <ScrollArea.Thumb className="bg-ink-ghost rounded-[9px]" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </div>
  );
}
