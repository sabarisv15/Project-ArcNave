import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { aiMemoryApi } from '@/api/aiMemory';
import { cn } from '../lib/utils';

// The kind, description pairs mirror aiMemoryService.js's own
// ALLOWED_MEMORY_TYPES + AI-facing descriptions — a bounded, structured
// set, never a freeform key, same reasoning the AI tool's own JSON schema
// enum enforces server-side.
const MEMORY_TYPE_LABELS = {
  communication_style: 'Communication style',
  recurring_focus_area: 'Recurring focus area',
  preferred_terminology: 'Preferred terminology',
  response_length: 'Preferred response length',
};

function Section({ title, description, children }) {
  return (
    <section className="bg-paper border border-line rounded-[16px] overflow-hidden">
      <header className="px-[14px] py-[10px] bg-mist border-b border-line">
        <h2 className="m-0 text-[12.5px] font-[600] text-ink">{title}</h2>
        {description && <p className="m-0 mt-[2px] text-[11.5px] text-ink-faint">{description}</p>}
      </header>
      <div className="p-[14px]">{children}</div>
    </section>
  );
}

/**
 * Personal → AI Memory.
 *
 * Consent-gated, bounded "the AI remembers things you told it" — the P1
 * item CHECKPOINT.md's chat-attachment governance pass deliberately
 * deferred ("Scoped Preference Memory... separate migration/RLS/consent-UI
 * pass"). Distinct from AI Browsing (institution-scoped, principal-only):
 * this page is per-user, reachable by any role, because the memory itself
 * is private to whoever is chatting.
 *
 * The one real safety property this page embodies: consent can ONLY be
 * granted or revoked here, by the account owner directly hitting
 * PUT /ai/memory/consent — there is no AI tool that can flip it (see
 * aiMemoryService.js's own file comment). Turning it off deletes every
 * remembered fact immediately, not just stops future writes — reflected
 * here as an inline warning before the toggle goes off, not a silent
 * side effect.
 */
export function AiMemorySettingsView() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [consented, setConsented] = useState(false);
  const [memories, setMemories] = useState([]);

  const load = () => Promise.all([aiMemoryApi.getConsent(), aiMemoryApi.list()]).then(([consent, list]) => {
    setConsented(Boolean(consent.consented));
    setMemories(list);
  });

  useEffect(() => {
    load()
      .catch(() => toast('Could not load AI Memory settings.'))
      .finally(() => setLoading(false));
  }, []);

  const toggleConsent = async (next) => {
    if (!next && memories.length > 0) {
      const ok = window.confirm(
        `Turning off AI Memory deletes ${memories.length === 1 ? 'the 1 preference' : `all ${memories.length} preferences`} `
        + 'ArcNave has remembered for you. This cannot be undone. Continue?',
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      await aiMemoryApi.setConsent(next);
      await load();
      toast(next ? 'AI Memory is on.' : 'AI Memory is off — remembered preferences were deleted.');
    } catch {
      toast('Could not update AI Memory.');
    } finally {
      setSaving(false);
    }
  };

  const forget = async (memoryType) => {
    setSaving(true);
    try {
      await aiMemoryApi.remove(memoryType);
      setMemories((prev) => prev.filter((m) => m.memory_type !== memoryType));
      toast('Forgotten.');
    } catch {
      toast('Could not forget that preference.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet pt-[26px] px-[32px] pb-[32px] animate-viewIn">
      <div className="max-w-[560px] mx-auto">
        <h1 className="m-0 mb-[14px] text-[24px] font-[600] tracking-[-.015em]">AI Memory</h1>

        {loading ? (
          <p className="text-[13px] text-ink-faint">Loading…</p>
        ) : (
          <div className="flex flex-col gap-[10px] pb-[28px]">
            <Section
              title="Remember preferences across conversations"
              description="When on, you can ask ArcNave's AI to remember how you like to work — e.g. 'always keep answers short' — and it will apply that in future chats. Off by default. Turning this off deletes everything it has remembered."
            >
              <label className="flex items-center gap-[9px] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={consented}
                  disabled={saving}
                  onChange={(e) => toggleConsent(e.target.checked)}
                  className="w-[16px] h-[16px] accent-[rgb(var(--c-accent))]"
                />
                <span className="text-[13px] text-ink">{consented ? 'On for your account' : 'Off for your account'}</span>
              </label>
            </Section>

            <Section
              title="What ArcNave can remember"
              description="Only these kinds of preference — never facts, notes, or opinions about a student, staff member, or anyone else."
            >
              <ul className="m-0 pl-[18px] flex flex-col gap-[4px] text-[12.5px] text-ink-muted">
                {Object.values(MEMORY_TYPE_LABELS).map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </Section>

            <Section title="Currently remembered" description={consented ? undefined : 'Nothing is remembered while AI Memory is off.'}>
              {memories.length === 0 ? (
                <p className="m-0 text-[12.5px] text-ink-faint">Nothing remembered yet.</p>
              ) : (
                <ul className="m-0 p-0 flex flex-col gap-[6px] list-none">
                  {memories.map((m) => (
                    <li
                      key={m.memory_type}
                      className="flex items-center gap-[8px] px-[10px] py-[8px] rounded-[10px] bg-tint2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[11.5px] font-[500] text-ink-faint">
                          {MEMORY_TYPE_LABELS[m.memory_type] || m.memory_type}
                        </div>
                        <div className="text-[13px] text-ink truncate">{m.value}</div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Forget ${MEMORY_TYPE_LABELS[m.memory_type] || m.memory_type}`}
                        disabled={saving}
                        onClick={() => forget(m.memory_type)}
                        className={cn(
                          'flex-none w-[28px] h-[28px] grid place-items-center border-0 bg-transparent rounded-[8px]',
                          'text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-danger-soft hover:text-danger',
                          'disabled:opacity-40 disabled:cursor-not-allowed'
                        )}
                      >
                        <Trash2 size={14} strokeWidth={1.9} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
