import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Greeting } from '../components/Greeting';
import { AIComposer } from '@/features/chat';
import { ScheduleStrip } from '../components/ScheduleStrip';
import { IdeasList } from '../components/IdeasList';
import { useWorkspace } from '../store/WorkspaceProvider';
import { composerScope, useComposer } from '../store/ComposerProvider';

/**
 * Home fits the viewport at 1440×900 and 1366×768; on shorter viewports the column
 * scrolls rather than clipping, and stays vertically centred whenever it fits.
 */
export function HomeView() {
  const navigate = useNavigate();
  const composerRef = useRef(null);
  const { sendMessage } = useWorkspace();
  // Home's own draft. It is never read by a project, artifact or chat composer.
  const composer = useComposer(composerScope.home());

  const send = async () => {
    const id = await sendMessage({
      scope: 'chat',
      text: composer.text,
      attachments: composer.attachments,
      mode: composer.mode,
      thinkingLevel: composer.thinkingLevel,
    });
    if (!id) return;
    composer.reset(); // sent — clears Home's scope and nothing else
    navigate(`/chat/${id}`);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet flex flex-col items-center pt-[26px] px-[32px] pb-[30px] animate-viewIn">
      <div className="my-auto flex flex-col items-center w-full max-w-[760px] mx-auto">
        <Greeting />

        {/* Two independent surfaces: the composer in front, the schedule strip
            tucked behind its lower edge. No shared wrapper background or
            border — that is what used to fuse them into one tall card. */}
        <div className="relative w-full animate-fadeUp motion-reduce:animate-none">
          <div className="relative z-20">
            <AIComposer
              ref={composerRef}
              composer={composer}
              value={composer.text}
              onChange={composer.setText}
              onSend={send}
              mode={composer.mode}
              onMode={composer.setMode}
              thinkingLevel={composer.thinkingLevel}
              onThinkingLevel={composer.setThinkingLevel}
              variant="start"
              placeholder="Ask ArcNave anything about your campus…"
            />
          </div>
          <div className="relative z-10 -mt-[14px] px-[10px]">
            <ScheduleStrip />
          </div>
        </div>

        <IdeasList
          onPick={(text) => {
            composer.setText(text);
            composerRef.current?.focus();
          }}
        />
      </div>
    </div>
  );
}
