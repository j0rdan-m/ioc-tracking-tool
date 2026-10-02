# Security Review — IOC Investigation Toolkit

*Version 1.0 — 2026-10-02*

This document captures the security assessment of the IOC Investigation Toolkit and provides a structured format for future version reviews.

---

## 📋 Review Scope

**Application**: IOC Investigation Toolkit — a static Svelte (JavaScript) web app for cybersecurity analysts.
**Stack**: Svelte 5 + Vite (plain JavaScript with JSDoc types), no backend, deployed on GitHub Pages.
**Threat Model**: Browser-based only; no backend, no API keys, no file uploads to third parties.
**Attack Surface**: Client-side XSS, data injection via stored investigations, unsafe DOM operations, unsafe export formatting.

---

## ✅ Security Controls Verified

| Control | Status | Details |
|---------|--------|---------|
| **Provider response sanitization** | ✅ Pass | `sanitizeProviderRawResponse()` bounds bytes (32KB/response, 1MB/history), validates shape, stores inert text |
| **Analysis snapshot sanitization** | ✅ Pass | `sanitizeProviderAnalysis()` validates and truncates checks/fields, preserves normalized forms |
| **Investigation data sanitization** | ✅ Pass | `sanitizeInvestigation()`, `sanitizeNode()`, `sanitizeRelationship()`, `sanitizeTimelineEvent()` — unknown fields dropped, dangling relationships removed |
| **Export formatters (pure functions)** | ✅ Pass | All three formatters (markdown, json, csv) are DOM-free, no `innerHTML`, no `eval()`, no `dangerouslySetInnerHTML` |
| **External link safety** | ✅ Pass | All `<a>` links use `target="_blank" rel="noopener noreferrer"` |
| **No eval/Function/Constructor** | ✅ Pass | No dynamic code evaluation anywhere in source |
| **No document.write/innerHTML/outerHTML** | ✅ Pass | No unsafe DOM writes found |
| **No dangerouslySetInnerHTML** | ✅ Pass | Not used anywhere |
| **CSV escaping (RFC 4180)** | ✅ Pass | `escapeCell()` properly quotes fields with `,`, `"`, `\n`, `\r` |
| **Privacy — no external networking** | ✅ Pass | No `fetch()`, no external API calls outside documented keyless public APIs |
| **Storage sanitization on read** | ✅ Pass | IndexedDB/memory adapter sanitizes every payload; corrupted records dropped gracefully |

---

## 📁 Files Audited

| File | Purpose | Security Role |
|------|---------|--------------|
| `src/lib/utils/provider-response.js` | Provider response capture & bounding | Sanitizes raw bodies before storage |
| `src/lib/utils/history-filter.js` | Investigation history search/filter | Uses sanitized data only |
| `src/lib/services/workspace/investigation-model.js` | V2 investigation model | Sanitizes on read; validates node/relationship/timeline shapes |
| `src/lib/services/workspace/investigation-repository.js` | IndexedDB/memory persistence | Sanitizes stored payloads on read |
| `src/lib/services/export/export-model.js` | Export model builder | Validates/normalizes indicators, dates, verdicts, links |
| `src/lib/services/export/markdown-exporter.js` | Markdown formatter | Pure function; defanged IOCs; inert text rendering |
| `src/lib/services/export/json-exporter.js` | JSON formatter | Preserves native types; no HTML injection |
| `src/lib/services/export/csv-exporter.js` | CSV formatter | RFC 4180 escaping; safe cell output |
| `src/lib/services/export/workspace-exporter.js` | V2 workspace export | Reuses sanitized model; no new DOM operations |

---

## 🔒 Security-by-Design Patterns

1. **Sanitize on read, not on write** — Every storage adapter (`createMemoryWorkspaceAdapter`, `createIndexedDbWorkspaceAdapter`) sanitizes payloads before they enter the in-memory cache.

2. **Export formatters are pure functions** — No DOM access, no network calls, no side effects. Output is entirely text-based (Markdown/JSON/CSV) with proper escaping.

3. **Defanged IOCs by default** — All rendered values use defanged forms (e.g., `hxxp://[.]evil[.]example[.]com`), never raw URLs that could become active links.

4. **Input validation at every boundary** — `sanitizeInvestigation()`, `sanitizeProviderRawResponse()`, `sanitizeProviderAnalysis()`, and component-level validators all guard against malformed data.

5. **No threat derivation from provider data** — Analyst verdicts are always explicit; providers never implicitly set malicious/safe status.

---

## 📅 Future Version Review Checklist

Use this template for each new version (e.g., 1.1, 2.0, etc.):

```markdown
# Security Review — Version {{VERSION}}

**Date**: {{DATE}}
**Scope**: {{UPDATE_SCOPE}}

## ✅ Verified Controls (add/remove entries)

- [ ] Provider response sanitization bounds and validation
- [ ] Analysis snapshot sanitization truncation
- [ ] Investigation data sanitization on read
- [ ] Export formatters remain pure (no DOM/network)
- [ ] External link safety (target/_blank + rel/noopener)
- [ ] No eval/Function/Constructor usage
- [ ] No dangerous DOM writes
- [ ] No dangerouslySetInnerHTML
- [ ] CSV/RFC 4180 escaping adequacy
- [ ] Privacy: no unintended external networking
- [ ] Storage sanitization on read adequacy

## 🆕 Changes This Version

{{SUMMARY_OF_CODE_CHANGES}}

## ⚠️ New Areas to Watch

{{ANY_NEW_CODE_PATHS_OR_THIRD_PARTY_DEPENDENCIES}}

## ✅ Pass/Fail

**Overall: PASS** / **FAIL** — blocker: {{WHAT_NEEDS_FIXING}}
```

---

## 🛠️ How to Update This Document

When a new version is released:

1. Run the existing security checks (same patterns reviewed here).
2. Add a new version section above using the template.
3. Note any new dependencies and whether they introduce DOM/network access.
4. Update the "Files Audited" table if new files were added.
5. Record any new ⚠️ findings or ✅ verified controls.
6. If any control fails, document the fix required and create a follow-up task.

---

*This file lives at the repository root and is intended to be updated alongside each release. The review patterns documented here should be re-run with each new version to maintain the same security baseline.*