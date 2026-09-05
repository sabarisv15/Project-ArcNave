import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';

/**
 * Gemini 3.8 Flash | Sonnet 5 | Opus 5 — ADL-099 (2026-09-04), amending
 * RS-AIG-008 (bka/10-specification/RS-AIG-ai-governance.md): the Composer's
 * old static "Auto" label becomes a real, named per-turn model choice, from
 * a fixed server-side allowlist (configurationService.js's MODEL_CHOICES —
 * the wire value sent as `model` is this component's own `id`, matched
 * verbatim against that allowlist server-side, never trusted as-is).
 *
 * A small dropdown, not a segmented control like ScopeToggle/
 * ThinkingLevelToggle — three longer, real vendor-model names don't fit
 * that fixed-width chip layout without truncation.
 */
const MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
];

export function ModelSelectorToggle({ model, onModel }) {
  const [open, setOpen] = useState(false);
  // `model` is `null` until the user actually picks one (EMPTY_COMPOSER.model's
  // own comment): the tenant's own configured provider decides until then, so
  // this displays as "Auto" — zero behavior change for an untouched composer.
  const current = MODELS.find((m) => m.id === model);

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-[4px] h-[28px] px-[10px] rounded-[10px] border-0 bg-transparent text-[13px] text-ink-faint tracking-[.01em] cursor-pointer hover:text-ink-soft hover:bg-tint2 transition-colors duration-200"
      >
        {current ? current.label : 'Auto'}
        <ChevronDown size={13} strokeWidth={2} />
      </button>
      {open && (
        <>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label="Model"
            className="absolute bottom-[34px] right-0 z-20 min-w-[168px] p-[4px] rounded-[12px] bg-paper shadow-chip border border-line-light flex flex-col gap-[1px]"
          >
            <button
              type="button"
              role="option"
              aria-selected={model === null}
              onClick={() => {
                onModel(null);
                setOpen(false);
              }}
              className={cn(
                'text-left h-[30px] px-[10px] rounded-[8px] border-0 text-[13px] cursor-pointer transition-colors duration-150',
                model === null ? 'bg-tint2 text-ink-soft font-[600]' : 'bg-transparent text-ink-muted hover:bg-tint2',
              )}
            >
              Auto
            </button>
            {MODELS.map((m) => {
              const active = model === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onModel(m.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'text-left h-[30px] px-[10px] rounded-[8px] border-0 text-[13px] cursor-pointer transition-colors duration-150',
                    active ? 'bg-tint2 text-ink-soft font-[600]' : 'bg-transparent text-ink-muted hover:bg-tint2',
                  )}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
