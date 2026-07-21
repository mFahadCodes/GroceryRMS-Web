# Plugin Security Review Template

Use for security-sensitive changes after focused tests and before final quality gates.
Record evidence and classifications, not secret values or complete payloads.

## Task and branch

- **Task:**
- **Branch:**
- **Base hash:**
- **Reviewed diff:**
- **Review date:**

## Changed security surfaces

- Authentication:
- Authorization and permissions:
- Sessions and credential state:
- Input and trust boundaries:
- Database queries and transactions:
- Files, network, or process execution:
- Secrets and sensitive data:
- Business-integrity operations:

## Semgrep results

Status: available / authentication required / unavailable / failed safely

| Classification | File:line | Rule | Finding | Evidence |
| --- | --- | --- | --- | --- |
| confirmed exploitable / confirmed defect / defense-in-depth / false positive / not applicable | | | | |

## SonarQube security hotspots and quality findings

Status: available / authentication required / unavailable / failed safely

| Severity | File:line | Rule | Finding | Disposition |
| --- | --- | --- | --- | --- |
| | | | | |

## Overlapping findings

Correlate Semgrep and SonarQube reports into one underlying defect. Retain the more
precise location and explanation; do not inflate counts.

| Canonical finding | Sources | Preferred evidence | Disposition |
| --- | --- | --- | --- |
| | | | |

## Confirmed vulnerabilities and defects

- <impact, reachable path, evidence, and required remediation>

## Defense-in-depth recommendations

- <recommendation, benefit, and whether it is in scope>

## False positives

- <finding, classification rationale, and evidence; do not suppress without approval>

## Sensitive-data review

- Logs and audit events:
- Error responses:
- External plugin queries/uploads:
- Repository-local configuration:
- Secret scan:

## Authorization review

- Authoritative identity:
- Permission source and revalidation:
- Resource/action binding:
- Failure behavior:

## Transaction and rollback review

- Transaction boundary:
- Atomic mutations and audits:
- Rollback evidence:
- Concurrency/replay evidence:

## Dependency findings

- Sonatype status:
- Components reviewed:
- Advisories/licenses/maintenance:
- Compatibility and transitive risk:
- Dependency necessary:

## Required fixes before merge

1. <confirmed in-scope fix>

## Deferred findings

- <finding, owner/task, risk, and explicit reason for deferral>

## Reviewer conclusion

- **Verdict:** approve / approve after fixes / do not approve / inconclusive
- **Required plugins used:**
- **Unavailable integrations:**
- **Focused tests:**
- **Complete gates:**
- **No plugin expanded scope:** yes / no

## Forbidden content

Never include passwords, PINs, PIN pepper values, authentication secrets, raw tokens,
JWTs, session identifiers, cookies, full request bodies, credential-bearing connection
strings, authorization headers, plugin credentials, or secret-bearing screenshots.
Use safe identifiers, redacted summaries, and file/line references only.

