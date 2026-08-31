import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { aiMemoryApi } from '@/api/aiMemory';
import { ConfirmConsequenceDialog } from '../components/ConfirmConsequenceDialog';
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

// Mirrors aiMemoryService.js's own MAX_GENERAL_FACTS — display-only (the
// server is the real enforcement point, aiMemoryService.rememberFact),
// same "frontend constant mirrors a backend cap for display purposes"
// precedent aiService.js's own MAX_ATTACHMENTS comment already documents.
const MAX_GENERAL_FACTS = 30;

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
  const [facts, setFacts] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = () =>
    Promise.all([aiMemoryApi.getConsent(), aiMemoryApi.list(), aiMemoryApi.listFacts()]).then(
      ([consent, list, factList]) => {
        setConsented(Boolean(consent.consented));
        setMemories(list);
        setFacts(factList);
      },
    );

  useEffect(() => {
    load()
      .catch(() => toast('Could not load AI Memory settings.'))
      .finally(() => setLoading(false));
  }, []);

  const applyConsent = async (next) => {
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

  // Turning AI Memory off is a real, irreversible delete (setConsent(false)
  // wipes every stored row server-side, general facts included since this
  // round) — routed through the app's own AlertDialog-based confirmation,
  // not window.confirm, which some embedding/automation contexts suppress
  // outright (silently returning false, as if the user had cancelled every
  // time). Checks facts.length too, not just memories.length — a user with
  // only remembered facts and no bounded preferences must still see what
  // is about to be deleted, not have it silently wiped.
  const toggleConsent = (next) => {
    if (!next && (memories.length > 0 || facts.length > 0)) {
      setConfirmOpen(true);
      return;
    }
    applyConsent(next);
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

  const forgetFact = async (factId) => {
    setSaving(true);
    try {
      await aiMemoryApi.removeFact(factId);
      setFacts((prev) => prev.filter((f) => f.id !== factId));
      toast('Forgotten.');
    } catch {
      toast('Could not forget that fact.');
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
              title="Remember things across conversations"
              description="When on, you can ask ArcNave's AI to remember how you like to work — a fixed preference like 'always keep answers short', or a freeform fact like 'I mostly handle the placement cell' — and it will apply that in future chats. Off by default. Turning this off deletes everything it has remembered."
            >
              <label className="flex items-center gap-[9px] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={consented}
                  disabled={saving}
                  onChange={(e) => toggleConsent(e.target.checked)}
                  className="w-[16px] h-[16px] accent-[rgb(var(--c-accent))]"
                />
                <span className="text-[13px] text-ink">
                  {consented ? 'On for your account' : 'Off for your account'}
                </span>
              </label>
            </Section>

            <Section
              title="What ArcNave can remember"
              description="A fixed set of preferences, or a freeform fact — but only ever about YOU, the person chatting. Never a fact, note, or opinion about a student, staff member, or anyone else, and never an identifier number (roll number, admission number, phone number) — ArcNave will refuse to remember those even if asked."
            >
              <ul className="m-0 pl-[18px] flex flex-col gap-[4px] text-[12.5px] text-ink-muted">
                {Object.values(MEMORY_TYPE_LABELS).map((label) => (
                  <li key={label}>{label}</li>
                ))}
                <li>
                  Anything else about how you work, in your own words (up to {MAX_GENERAL_FACTS} things at a time)
                </li>
              </ul>
            </Section>

            <Section
              title="Currently remembered"
              description={consented ? undefined : 'Nothing is remembered while AI Memory is off.'}
            >
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
                          'disabled:opacity-40 disabled:cursor-not-allowed',
                        )}
                      >
                        <Trash2 size={14} strokeWidth={1.9} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section
              title={`Remembered facts (${facts.length}/${MAX_GENERAL_FACTS})`}
              description={consented ? undefined : 'Nothing is remembered while AI Memory is off.'}
            >
              {facts.length === 0 ? (
                <p className="m-0 text-[12.5px] text-ink-faint">Nothing remembered yet.</p>
              ) : (
                <ul className="m-0 p-0 flex flex-col gap-[6px] list-none">
                  {facts.map((f) => (
                    <li key={f.id} className="flex items-center gap-[8px] px-[10px] py-[8px] rounded-[10px] bg-tint2">
                      <div className="flex-1 min-w-0 text-[13px] text-ink">{f.fact}</div>
                      <button
                        type="button"
                        aria-label={`Forget "${f.fact}"`}
                        disabled={saving}
                        onClick={() => forgetFact(f.id)}
                        className={cn(
                          'flex-none w-[28px] h-[28px] grid place-items-center border-0 bg-transparent rounded-[8px]',
                          'text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-danger-soft hover:text-danger',
                          'disabled:opacity-40 disabled:cursor-not-allowed',
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

      <ConfirmConsequenceDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Turn off AI Memory?"
        lede="This deletes everything ArcNave has remembered for you. It cannot be undone."
        consequences={[
          ...memories.map((m) => ({
            key: m.memory_type,
            title: MEMORY_TYPE_LABELS[m.memory_type] || m.memory_type,
            detail: m.value,
          })),
          ...facts.map((f) => ({ key: f.id, title: 'Fact', detail: f.fact })),
        ]}
        confirmLabel="Turn off and delete"
        cancelLabel="Keep it on"
        onConfirm={() => {
          setConfirmOpen(false);
          applyConsent(false);
        }}
      />
    </div>
  );
}
