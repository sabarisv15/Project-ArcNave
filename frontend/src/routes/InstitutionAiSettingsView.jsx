import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { InstitutionScopeHeader } from '../components/InstitutionScopeHeader';
import { PANE } from '../components/WorkspaceLayout';
import { configurationsApi } from '@/api/configurations';
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

/**
 * Institution → AI Browsing.
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
      <InstitutionScopeHeader trail="AI Browsing" />

      <div className="flex-none flex items-center gap-[8px] flex-wrap mb-[14px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">AI Browsing</h1>
      </div>

      {loading ? (
        <p className="text-[13px] text-ink-faint">Loading…</p>
      ) : (
        <div className="flex-none flex flex-col gap-[10px] pb-[28px] max-w-[560px]">
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
