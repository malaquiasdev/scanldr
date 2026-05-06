# CI/CD — Quality & Security Stack

## Prerequisites (human action required)

Before the workflows produce meaningful results, a human must complete these steps once:

1. **Dependabot** — enable it under Settings → Security → Dependabot alerts and Dependabot version updates.
2. **Branch protection** — configure under Settings → Branches → Add rule for `main`:
   - Require status checks: `Test, typecheck, lint`
   - Require branches to be up to date before merging
   - Do not allow bypassing the above settings

## Adopted stack

| Tool | Workflow | Purpose |
|---|---|---|
| Dependabot | `dependabot.yml` | Automated dependency version PRs |
| gitleaks | `secrets-scan.yml` | Detect committed secrets on every push/PR |
| Bun gates | `test.yml` | Unit tests + typecheck + Biome lint on every push/PR |

### Rationale

- **Dependabot** provides automated PRs; minor+patch are grouped per ecosystem to reduce noise. Major versions remain individual PRs for intentional review.
- **gitleaks** runs before any other check so a leaked secret never reaches the remote in even a non-default branch.
- Snyk, Codacy, DeepSource, and Trivy are explicitly excluded (YAGNI — overlap with the above).

## Local execution

```bash
# Run tests with LCOV coverage (same as CI)
bun test --coverage --coverage-reporter=lcov

# Typecheck
bun run typecheck

# Lint
bun run check

# Secrets scan locally (requires gitleaks installed)
gitleaks detect --source . --verbose

# Gitleaks on staged files only
gitleaks protect --staged --verbose
```

Install gitleaks: `brew install gitleaks` (macOS) or see https://github.com/gitleaks/gitleaks#installing.

> Note: Static analysis and semantic vulnerability scanning workflows were temporarily removed pending account setup (PR #94). To re-enable, revert the squash-merge commit of PR #94 on main, then complete the manual setup:
> 1. Create a SonarCloud account and link the repository.
> 2. Save the `SONAR_TOKEN` secret in repo settings → Secrets and variables → Actions.
> 3. Enable Code scanning in repo settings → Security → Code scanning.
> See PR #80 for the original implementation reference.
