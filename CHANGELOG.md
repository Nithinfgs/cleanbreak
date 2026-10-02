# Changelog

## 0.1.0

First release.

- Pairwise comparison of branches, git worktrees (including uncommitted work) and the base branch
- Rules: `removed-symbol`, `signature-change`, `moved-path`, `duplicate-definition`
- Every candidate is re-checked against a `git merge-tree` result before it is reported
- `--verify <cmd>` runs your build or tests on the trial merge
- JS/TS, Python, Go, Rust, Java/Kotlin/Scala, C#, Ruby, PHP, Swift, C/C++ definition recognition
- `--json` output, `.cleanbreakrc.json` config, exit codes for CI
