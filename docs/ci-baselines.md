# M² Calls CI baselines

Baselines make current debt explicit while new regressions remain blocking. They
are temporary evidence controls, not statements that the findings are safe or
remediated.

## Android lint baseline

- File: [mobile-kotlin/app/lint-baseline.xml](../mobile-kotlin/app/lint-baseline.xml)
- Created from source baseline:
  `482a83a83db50d75792610fc009f0fb87d24971d`
- Created: 2026-11-06
- Review/expiry date: 2027-02-06
- Policy: `lint` keeps `abortOnError = true`; only exact baseline matches are
  tolerated, and newly introduced findings fail CI.
- Current blocking-error debt captured before baseline generation:
  - two API-level 29 `startForeground` call findings with minimum SDK 26;
  - one restricted Navigation API access finding.
- Warnings are retained in the generated baseline/report and require separate
  triage; they are not described as zero findings.

Regenerate only after a reviewed source change:

```bash
cd mobile-kotlin
./gradlew updateLintBaseline
./gradlew lint
```

The review must compare removed, added, and changed findings. Extending the
expiry requires an owner decision and an updated rationale.

## Dependency baseline posture

The 2026-11 local locked installs reported existing high/critical npm
advisories. This documentation task does not remediate them. The pull-request
dependency-review job blocks newly introduced high/critical advisory changes;
current findings require separate triage with an owner-reviewed exception or
upgrade plan.
