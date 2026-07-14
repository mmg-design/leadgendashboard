"use client";

import { useState } from "react";
import { X, Loader2, Check, Copy, FileText, MousePointerClick, FileCheck2, ArrowDownWideNarrow, Clock } from "lucide-react";

interface Suggestion {
  count?: number;
  views?: number;
  suggestedLabel: string;
}
interface EventSuggestion extends Suggestion {
  name: string;
  count: number;
}
interface PageSuggestion extends Suggestion {
  path: string;
  views: number;
}
interface DiscoverResult {
  eventSuggestions: EventSuggestion[];
  pageSuggestions: PageSuggestion[];
}

export type WizardConversionType = "pageview" | "event" | "click" | "form_submit" | "scroll_depth" | "time_on_page";
export type WizardValues = {
  conversionType: WizardConversionType;
  conversionValue: string;
  label: string;
  scopePagePath: string;
};

interface EventWizardModalProps {
  clientSlug: string;
  suggestions: DiscoverResult | null;
  suggestionsLoading: boolean;
  initial?: WizardValues;
  isFirstSnippetGoal: boolean;
  submitLabel: string;
  onSubmit: (values: WizardValues) => Promise<void>;
  onClose: () => void;
}

// "event" (a pre-existing GA4 event) is intentionally not offered as a creation
// option anymore — everything below is built and fired by our own snippet,
// with no GTM or prior instrumentation required.
const TYPE_OPTIONS: { type: WizardConversionType; icon: typeof FileText; title: string; desc: string }[] = [
  { type: "pageview", icon: FileText, title: "A page loads", desc: "Like a thank-you or confirmation page" },
  { type: "click", icon: MousePointerClick, title: "Someone clicks something", desc: "Match a button by what it says" },
  { type: "form_submit", icon: FileCheck2, title: "Someone submits a form", desc: "Any form submit on the page" },
  { type: "scroll_depth", icon: ArrowDownWideNarrow, title: "Someone scrolls down the page", desc: "Fires once they pass a scroll %" },
  { type: "time_on_page", icon: Clock, title: "Someone stays on the page a while", desc: "Fires after N seconds" },
];

function describeGoal(type: WizardConversionType, value: string, scopePagePath: string): string {
  const scope = scopePagePath ? ` on ${scopePagePath}` : "";
  if (type === "pageview") return `We'll count it every time someone visits ${value}.`;
  if (type === "click") return `We'll count it every time someone clicks a button that says "${value}"${scope}.`;
  if (type === "form_submit") return `We'll count it every time a form is submitted${scope || " anywhere on the site"}.`;
  if (type === "scroll_depth") return `We'll count it every time someone scrolls ${value}% down${scope || " any page"}.`;
  if (type === "time_on_page") return `We'll count it every time someone stays ${value} seconds${scope || " on any page"}.`;
  return `We'll count it every time the "${value}" event fires in GA4.`;
}

function snippetFor(clientSlug: string): string {
  return `<script>
(function() {
  fetch("https://data.mmg.studio/api/track-config?client=${clientSlug}")
    .then(function(r){ return r.json(); })
    .then(function(data){
      var rules = (data && data.rules) || [];
      var path = window.location.pathname;
      function applies(rule) { return !rule.scopePagePath || rule.scopePagePath === path; }
      function fire(name) { if (typeof gtag === "function") gtag("event", name); }

      rules.forEach(function(rule){
        if (!applies(rule)) return;

        if (rule.trigger === "click") {
          document.addEventListener("click", function(e){
            var el = e.target.closest("button, a, [role=button], input[type=submit]");
            if (!el) return;
            var text = (el.textContent || el.value || "").trim().toLowerCase();
            if (text.indexOf(rule.value.toLowerCase()) !== -1) fire(rule.eventName);
          });
        } else if (rule.trigger === "form_submit") {
          document.addEventListener("submit", function(){ fire(rule.eventName); }, true);
        } else if (rule.trigger === "scroll_depth") {
          var fired = false;
          window.addEventListener("scroll", function(){
            if (fired) return;
            var pct = ((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100;
            if (pct >= Number(rule.value)) { fired = true; fire(rule.eventName); }
          });
        } else if (rule.trigger === "time_on_page") {
          setTimeout(function(){ fire(rule.eventName); }, Number(rule.value) * 1000);
        }
      });
    })
    .catch(function(){});
})();
</script>`;
}

export function EventWizardModal({
  clientSlug,
  suggestions,
  suggestionsLoading,
  initial,
  isFirstSnippetGoal,
  submitLabel,
  onSubmit,
  onClose,
}: EventWizardModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [conversionType, setConversionType] = useState<WizardConversionType>(initial?.conversionType || "pageview");
  const [conversionValue, setConversionValue] = useState(initial?.conversionValue || "");
  const [scopePagePath, setScopePagePath] = useState(initial?.scopePagePath || "");
  const [label, setLabel] = useState(initial?.label || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isSnippetType = conversionType === "click" || conversionType === "form_submit" || conversionType === "scroll_depth" || conversionType === "time_on_page";

  const relevantSuggestions: Suggestion[] =
    conversionType === "pageview" ? suggestions?.pageSuggestions || [] : [];

  function pickSuggestion(s: Suggestion) {
    const value = "name" in s ? (s as EventSuggestion).name : (s as PageSuggestion).path;
    setConversionValue(value);
    if (!label && s.suggestedLabel) setLabel(s.suggestedLabel);
  }

  function canContinue(): boolean {
    if (conversionType === "form_submit") return true;
    if (conversionType === "scroll_depth" || conversionType === "time_on_page") {
      return /^\d+$/.test(conversionValue.trim());
    }
    return !!conversionValue.trim();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const finalValue = conversionType === "form_submit" && !conversionValue.trim() ? "Any form" : conversionValue.trim();
      await onSubmit({ conversionType, conversionValue: finalValue, label: label.trim(), scopePagePath: scopePagePath.trim() });
      setSaved(true);
      setTimeout(onClose, 900);
    } catch {
      setError("Couldn't save — try again.");
      setSaving(false);
    }
  }

  const showSnippetStep = step === 3 && isSnippetType && isFirstSnippetGoal;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div>
            <h2 className="text-[16px] font-headline font-normal text-[#0B4F6C]">
              {initial ? "Edit conversion event" : "Create a new conversion event"}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Step {step} of 3</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:bg-muted/60 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {step === 1 && (
            <div className="space-y-2">
              <p className="text-[13px] font-medium text-foreground/80 mb-1">How do you know someone converted?</p>
              {TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = conversionType === opt.type;
                return (
                  <button
                    key={opt.type}
                    onClick={() => { setConversionType(opt.type); setConversionValue(""); }}
                    className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                      active ? "border-[#0B4F6C] bg-[#0B4F6C]/[0.04]" : "border-border/60 hover:border-[#0B4F6C]/30"
                    }`}
                  >
                    <div className={`p-1.5 rounded-md ${active ? "bg-[#0B4F6C]/10 text-[#0B4F6C]" : "bg-muted text-muted-foreground"}`}>
                      <Icon size={15} />
                    </div>
                    <div>
                      <div className="text-[13px] font-medium text-foreground/80">{opt.title}</div>
                      <div className="text-[11px] text-muted-foreground">{opt.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {conversionType === "pageview" && (
                <div>
                  <p className="text-[11px] font-medium text-foreground/70 mb-1.5">
                    {suggestionsLoading
                      ? "Checking what's actually firing on this site..."
                      : relevantSuggestions.length > 0
                      ? "Actually firing on this site — tap to use:"
                      : "Nothing matching found automatically — enter it manually below."}
                  </p>
                  {relevantSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {relevantSuggestions.map((s) => {
                        const value = (s as PageSuggestion).path;
                        const count = (s as PageSuggestion).views;
                        const active = conversionValue === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => pickSuggestion(s)}
                            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                              active ? "border-[#0B4F6C] bg-[#0B4F6C]/10 text-[#0B4F6C]" : "border-border/60 text-muted-foreground hover:border-[#0B4F6C]/40"
                            }`}
                          >
                            {value} <span className="opacity-50">· {count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <label className="text-[11px] font-medium text-foreground/70 mb-1 block">Page path</label>
                  <input
                    type="text"
                    value={conversionValue}
                    onChange={(e) => setConversionValue(e.target.value)}
                    placeholder="/thank-you"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                </div>
              )}

              {conversionType === "click" && (
                <div>
                  <label className="text-[11px] font-medium text-foreground/70 mb-1 block">Exact button text</label>
                  <input
                    type="text"
                    value={conversionValue}
                    onChange={(e) => setConversionValue(e.target.value)}
                    placeholder="Schedule My Call"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    Type it exactly as it appears on the button — we&apos;ll match it automatically.
                  </p>
                </div>
              )}

              {conversionType === "form_submit" && (
                <div>
                  <label className="text-[11px] font-medium text-foreground/70 mb-1 block">
                    Which form? (optional description)
                  </label>
                  <input
                    type="text"
                    value={conversionValue}
                    onChange={(e) => setConversionValue(e.target.value)}
                    placeholder="Contact form"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    Counts any form submission — narrow it to one page below if you only want a specific form.
                  </p>
                </div>
              )}

              {conversionType === "scroll_depth" && (
                <div>
                  <label className="text-[11px] font-medium text-foreground/70 mb-1 block">How far down? (%)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={conversionValue}
                    onChange={(e) => setConversionValue(e.target.value)}
                    placeholder="50"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                </div>
              )}

              {conversionType === "time_on_page" && (
                <div>
                  <label className="text-[11px] font-medium text-foreground/70 mb-1 block">How many seconds?</label>
                  <input
                    type="number"
                    min={1}
                    value={conversionValue}
                    onChange={(e) => setConversionValue(e.target.value)}
                    placeholder="30"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                </div>
              )}

              {isSnippetType && (
                <div>
                  <label className="text-[11px] font-medium text-foreground/70 mb-1 block">
                    Only on a specific page? (optional)
                  </label>
                  <input
                    type="text"
                    value={scopePagePath}
                    onChange={(e) => setScopePagePath(e.target.value)}
                    placeholder="/pricing"
                    className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                  />
                </div>
              )}

              <div>
                <label className="text-[11px] font-medium text-foreground/70 mb-1 block">
                  What do you call this? (optional)
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Booked a call"
                  className="w-full px-3 py-2 text-[13px] border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-[#0B4F6C]/20 focus:border-[#0B4F6C]/30"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-[#0B4F6C]/[0.04] border border-[#0B4F6C]/10">
                <p className="text-[13px] text-foreground/80">{describeGoal(conversionType, conversionValue, scopePagePath)}</p>
                {label && <p className="text-[11px] text-muted-foreground mt-1">Labeled as &quot;{label}&quot;</p>}
              </div>

              {showSnippetStep && (
                <div className="space-y-2">
                  <p className="text-[12px] font-medium text-foreground/80">
                    One-time setup — paste this into your site&apos;s custom code (footer), then you&apos;re done forever:
                  </p>
                  <div className="relative">
                    <pre className="text-[10.5px] leading-relaxed bg-[#1a1a1a] text-white/90 rounded-lg p-3 overflow-x-auto">
{snippetFor(clientSlug)}
                    </pre>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(snippetFor(clientSlug));
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                      className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
                      title="Copy snippet"
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/60">
                    Every future click, form, scroll, or time-based event you create for this client uses this
                    same snippet — no more code edits after this.
                  </p>
                </div>
              )}

              {error && <p className="text-[11px] text-red-600">{error}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-border/50">
          <button
            onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as 1 | 2))}
            className="px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((s) => (s + 1) as 2 | 3)}
              disabled={step === 2 && !canContinue()}
              className="px-4 py-2 text-[13px] font-medium text-white bg-[#0B4F6C] rounded-lg hover:bg-[#0B4F6C]/90 disabled:opacity-50 transition-colors"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-white bg-[#0B4F6C] rounded-lg hover:bg-[#0B4F6C]/90 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
              {saving ? "Saving..." : saved ? "Saved!" : submitLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
