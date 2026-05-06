# CI/CD — Quality & Security Stack

## Prerequisites (human action required)

Before the workflows produce meaningful results, a human must complete these steps once:

1. **SonarCloud account** — go to https://sonarcloud.io, sign in with GitHub, import the `malaquiasdev/scanldr` repository.
2. **SonarCloud project** — create a project with key `malaquiasdev_scanldr` under organization `malaquiasdev`. Disable automatic analysis (use CI-based analysis instead).
3. **SONAR_TOKEN secret** — in SonarCloud, generate a token under _My Account → Security_. Add it to the repository at GitHub → Settings → Secrets and variables → Actions → `SONAR_TOKEN`.
4. **Code scanning** — GitHub Advanced Security / Code scanning is enabled by default for public repositories. For private repos, enable it under Settings → Security → Code scanning.
5. **Dependabot** — enable it under Settings → Security → Dependabot alerts and Dependabot version updates.
6. **Branch protection** — configure under Settings → Branches → Add rule for `main`:
   - Require status checks: `Test, typecheck, lint`, `Analyze` (CodeQL), `SonarCloud Quality Gate`
   - Require branches to be up to date before merging
   - Do not allow bypassing the above settings

## Adopted stack

| Tool | Workflow | Purpose |
|---|---|---|
| SonarCloud | `sonarcloud.yml` | Static analysis, coverage gate, duplication, code smells |
| CodeQL | `codeql.yml` | Semantic vulnerability scanning (SAST) |
| Dependabot | `dependabot.yml` | Automated dependency version PRs |
| gitleaks | `secrets-scan.yml` | Detect committed secrets on every push/PR |
| Bun gates | `test.yml` | Unit tests + typecheck + Biome lint on every push/PR |

### Rationale

- **SonarCloud** is chosen over Codacy/DeepSource because it provides the most actionable coverage + smell reports with zero cost for public repos.
- **CodeQL** is the GitHub-native SAST engine; it runs semantic analysis that Sonar's JavaScript rules do not fully cover (e.g. prototype pollution, taint tracking).
- **Dependabot** provides automated PRs; minor+patch are grouped per ecosystem to reduce noise. Major versions remain individual PRs for intentional review.
- **gitleaks** runs before any other check so a leaked secret never reaches the remote in even a non-default branch.
- Snyk, Codacy, DeepSource, and Trivy are explicitly excluded (YAGNI — overlap with the above).

## SonarCloud Quality Gate (configure in UI)

The recommended gate for new code:

| Condition | Threshold |
|---|---|
| Bugs | 0 |
| Vulnerabilities | 0 |
| Security Hotspots reviewed | 100% |
| Coverage | >= 90% |
| Duplication | <= 3% |

These thresholds are set in the SonarCloud UI under _Project → Administration → Quality Gates_. They are not stored in this repository.

### When the Quality Gate fails

1. Open the SonarCloud dashboard for the failing PR.
2. Review the _New Code_ tab for the specific issues.
3. Fix bugs and vulnerabilities before merging — these block the gate by design.
4. For Security Hotspots, mark them as _Reviewed_ (Safe/Fixed/Acknowledged) in the SonarCloud UI if they are false positives.
5. If coverage dropped, add tests for uncovered new code. Run `bun test --coverage --coverage-reporter=lcov` locally to measure.

## Local execution

```bash
# Run tests with LCOV coverage (same as CI)
bun test --coverage --coverage-reporter=lcov

# Typecheck
bun run typecheck

# Lint
bun run check

# Sonar scan locally (requires sonar-scanner CLI and SONAR_TOKEN env var)
sonar-scanner

# Secrets scan locally (requires gitleaks installed)
gitleaks detect --source . --verbose

# Gitleaks on staged files only
gitleaks protect --staged --verbose
```

Install gitleaks: `brew install gitleaks` (macOS) or see https://github.com/gitleaks/gitleaks#installing.

Install sonar-scanner: `brew install sonar-scanner` (macOS) or see https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/ci-based-analysis/sonarscanner-cli/.
