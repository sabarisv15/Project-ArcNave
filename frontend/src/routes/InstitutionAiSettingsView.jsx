import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { InstitutionScopeHeader } from '../components/InstitutionScopeHeader';
import { PANE } from '../components/WorkspaceLayout';
import { configurationsApi } from '@/api/configurations';
import { aiConfigApi } from '@/api/aiConfig';
import { cn } from '../lib/utils';

const DEFAULT_ALLOWED_DOMAINS = ['ugc.gov.in', 'aicte-india.org', 'aicte.gov.in', 'nirfindia.org', 'naac.gov.in', 'nic.in'];

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

/** A labeled status chip — same visual language as the domain chips below, reused for ops signals. */
function StatusChip({ label, tone = 'neutral' }) {
  const toneClass = {
    neutral: 'bg-tint2 text-ink-muted',
    good: 'bg-tint2 text-ink-muted',
    warn: 'bg-[rgb(var(--c-accent)/0.14)] text-[rgb(var(--c-accent))]',
  }[tone];
  return (
    <span className={cn('inline-flex items-center h-[22px] px-[8px] rounded-[6px] text-[11.5px] font-[500]', toneClass)}>
      {label}
    </span>
  );
}

/** A simple horizontal usage bar — no design-system Progress component exists yet, so this reuses the same bg-tint2/bg-accent tokens the Save button and domain chips already use, rather than inventing a new visual language. */
function UsageBar({ percent, warn }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="h-[8px] w-full rounded-[4px] bg-tint2 overflow-hidden">
      <div
        className={cn('h-full rounded-[4px] transition-[width] duration-300', warn ? 'bg-[rgb(var(--c-accent))]' : 'bg-ink-faint')}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/**
 * CEO Vertex/Gemini audit #40/#41/#42/C20/C21 (2026-08-30) — "make sure
 * it shows in frontend". Read-only: this page has no controls for any
 * of these yet (setting a per-college quota override, a fallback
 * provider, etc. all still write through the generic PUT
 * /configurations/:category or PUT /ai-config the same way this page's
 * other sections already do — this section only surfaces what
 * GET /ai-config/ops-status already computes server-side).
 */
function OpsStatusSection() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    aiConfigApi
      .getOpsStatus()
      .then(setStatus)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Section title="AI Operations">
        <p className="m-0 text-[13px] text-ink-faint">Loading…</p>
      </Section>
    );
  }
  if (error || !status) {
    return (
      <Section title="AI Operations">
        <p className="m-0 text-[13px] text-ink-faint">Could not load AI operations status.</p>
      </Section>
    );
  }

  return (
    <Section
      title="AI Operations"
      description="Reliability and cost signals for this college's AI provider — read-only."
    >
      <div className="flex flex-col gap-[14px]">
        <div>
          <div className="flex items-center justify-between mb-[4px]">
            <span className="text-[12.5px] font-[500] text-ink">Provider fallback</span>
            <StatusChip
              label={status.fallback.configured ? `Configured (${status.fallback.provider})` : 'Not configured'}
              tone={status.fallback.configured ? 'good' : 'neutral'}
            />
          </div>
          <p className="m-0 text-[11.5px] text-ink-faint">
            {status.fallback.configured
              ? `If ${status.provider} fails, this college automatically fails over to ${status.fallback.provider}.`
              : 'No fallback provider configured — a sustained outage of the primary provider currently has no automatic recovery.'}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-[4px]">
            <span className="text-[12.5px] font-[500] text-ink">Model version</span>
            <StatusChip label={status.modelVersion.lastObserved || 'Not observed yet'} />
          </div>
          <p className="m-0 text-[11.5px] text-ink-faint">
            Configured: <span className="font-mono">{status.modelVersion.configured}</span>
            {status.modelVersion.lastObserved && (
              <> — last real response reported <span className="font-mono">{status.modelVersion.lastObserved}</span>.</>
            )}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-[6px]">
            <span className="text-[12.5px] font-[500] text-ink">Monthly AI usage</span>
            <StatusChip
              label={`${status.quota.tokensUsed.toLocaleString()} / ${status.quota.tokensLimit.toLocaleString()} tokens`}
              tone={status.quota.withinBudget ? 'neutral' : 'warn'}
            />
          </div>
          <UsageBar percent={status.quota.percentUsed} warn={!status.quota.withinBudget} />
          <p className="m-0 mt-[6px] text-[11.5px] text-ink-faint">
            {status.quota.callCount.toLocaleString()} AI calls since {new Date(status.quota.periodStart).toLocaleDateString()}.
            {!status.quota.withinBudget && ' This college has reached its monthly quota — further AI requests are refused until next month, or until the quota is raised.'}
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-[4px]">
            <span className="text-[12.5px] font-[500] text-ink">Rate limit</span>
            <StatusChip
              label={`${status.rateLimit.callsInWindow} / ${status.rateLimit.limit} calls this minute`}
              tone={status.rateLimit.withinLimit ? 'neutral' : 'warn'}
            />
          </div>
          <p className="m-0 text-[11.5px] text-ink-faint">
            Protects other colleges from one tenant&apos;s burst of AI requests.
          </p>
        </div>
      </div>
    </Section>
  );
}

/**
 * Institution → AI Settings.
 *
 * Renamed from "AI Browsing" (2026-08-30, CEO Vertex/Gemini audit
 * #40/#41/#42) when this page grew a second, unrelated section
 * (OpsStatusSection below) — the route/component name was already
 * generic, only the sidebar label and on-page heading were narrowly
 * scoped to web retrieval.
 *
 * Controls webRetrievalService.js's `fetch_trusted_web_page` AI tool — opt-in
 * per college (defaults to off, no config row) with a domain allowlist. Until
 * this page existed there was no way to turn it on at all: the backend
 * (configurationService's generic PUT /configurations/:category) always
 * supported it, but nothing in the app ever called it — a real user asked
 * for web research and the tool had no working switch anywhere to reach.
 *
 * Domains: DEFAULT_ALLOWED_DOMAINS mirrors webRetrievalService.js's own
 * constant — shown as fixed, always-on context (this page can only add to
 * it, never remove from it, same as the backend already enforces).
 */
export function InstitutionAiSettingsView() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(null); // null = category not configured yet
  const [enabled, setEnabled] = useState(false);
  const [domainsText, setDomainsText] = useState('');

  useEffect(() => {
    configurationsApi
      .get('web_retrieval')
      .then((row) => {
        setVersion(row.version);
        setEnabled(Boolean(row.configuration?.enabled));
        setDomainsText((row.configuration?.allowedDomains ?? []).join('\n'));
      })
      .catch((err) => {
        // 404 just means this college has never set this category —
        // getConfiguration's own comment: "not an error." Anything else is.
        if (err?.status !== 404) toast('Could not load AI browsing settings.');
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async (nextEnabled, nextDomainsText) => {
    const allowedDomains = nextDomainsText
      .split('\n')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    setSaving(true);
    try {
      const row = await configurationsApi.update('web_retrieval', { enabled: nextEnabled, allowedDomains }, version);
      setVersion(row.version);
      setEnabled(Boolean(row.configuration?.enabled));
      setDomainsText((row.configuration?.allowedDomains ?? []).join('\n'));
      toast('AI browsing settings saved.');
    } catch {
      toast('Could not save — someone else may have changed this at the same time. Reloading.');
      window.location.reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn(PANE, 'overflow-auto scroll-quiet')}>
      <InstitutionScopeHeader trail="AI Settings" />

      <div className="flex-none flex items-center gap-[8px] flex-wrap mb-[14px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">AI Settings</h1>
      </div>

      {loading ? (
        <p className="text-[13px] text-ink-faint">Loading…</p>
      ) : (
        <div className="flex-none flex flex-col gap-[10px] pb-[28px] max-w-[560px]">
          <OpsStatusSection />

          <Section
            title="Trusted web retrieval"
            description="Lets ArcNave's AI fetch one specific, already-known page from an approved domain (e.g. a UGC circular) and use it to answer a question. Never a general web search, and a fetched page can never trigger an ARCNAVE action on its own."
          >
            <label className="flex items-center gap-[9px] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enabled}
                disabled={saving}
                onChange={(e) => save(e.target.checked, domainsText)}
                className="w-[16px] h-[16px] accent-[rgb(var(--c-accent))]"
              />
              <span className="text-[13px] text-ink">
                {enabled ? 'Enabled for this college' : 'Disabled for this college'}
              </span>
            </label>
          </Section>

          <Section
            title="Always-allowed domains"
            description="Every college gets these regardless of the setting below — webRetrievalService.js's own default list."
          >
            <div className="flex flex-wrap gap-[6px]">
              {DEFAULT_ALLOWED_DOMAINS.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center h-[22px] px-[8px] rounded-[6px] bg-tint2 text-[11.5px] font-[500] text-ink-muted"
                >
                  {d}
                </span>
              ))}
            </div>
          </Section>

          <Section
            title="Additional domains for this college"
            description="One hostname per line (e.g. mycollege.edu.in). Subdomains of an allowed domain are matched automatically — mycollege.edu.in also allows results.mycollege.edu.in."
          >
            <textarea
              value={domainsText}
              disabled={saving}
              onChange={(e) => setDomainsText(e.target.value)}
              placeholder="mycollege.edu.in"
              rows={4}
              className={cn(
                'w-full resize-y rounded-[10px] border border-line bg-paper px-[10px] py-[8px]',
                'font-mono text-[12.5px] text-ink outline-none focus-visible:border-accent'
              )}
            />
            <div className="mt-[10px] flex justify-end">
              <button
                type="button"
                disabled={saving}
                onClick={() => save(enabled, domainsText)}
                className="h-[30px] px-[13px] border-0 rounded-[9px] bg-accent font-sans text-[12.5px] font-[500] text-white cursor-pointer transition-colors duration-200 hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save domains
              </button>
            </div>
          </Section>

          <p className="m-0 text-[11.5px] text-ink-faint">
            Available to every role once enabled — principal, HOD, staff, and class tutors can all ask ArcNave to
            look up an allowed page for reference or research.
          </p>
        </div>
      )}
    </div>
  );
}
