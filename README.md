<h1 align="center">cleanbreak</h1>

<p align="center"><b>Find branches that merge cleanly in git and break anyway.</b><br>
Built for the moment you have several parallel branches or agent worktrees and are about to merge them.</p>

<p align="center">
  <a href="https://github.com/Nithinfgs/cleanbreak/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Nithinfgs/cleanbreak/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="license MIT" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="node 18+" src="https://img.shields.io/badge/node-%E2%89%A518-339933">
  <img alt="zero runtime dependencies" src="https://img.shields.io/badge/runtime%20dependencies-0-brightgreen">
</p>

<p align="center"><img src="docs/assets/demo.svg" alt="cleanbreak output: five branches, three of them merge without a conflict and then fail at runtime" width="900"></p>

## The 20-second version

Git only tells you when two branches touch the same lines. It cannot tell you that

- branch A renamed `calcTotal` while branch B just wrote a new call to `calcTotal`,
- branch A added a parameter to `applyDiscount` while branch B added a call with the old arguments,
- branch A moved `format.js` while branch B imported it from the old path.

Each branch passes its own tests. The merge has **no conflict**. Then `main` is red.

This got much more common once people run several coding agents at once, each in its own git worktree: every agent works on a stale picture of the code, and the surprises show up at merge time. `cleanbreak` compares every pair of branches or worktrees (uncommitted work included), simulates the merge without touching your checkout, and reports what one side removed or changed that the other side now relies on. Add `--verify "<your test command>"` and it runs that command on the trial merge, so you see a failing exit code instead of a guess.

## Quick start

Needs Node 18+ and git 2.38+ (for `git merge-tree --write-tree`). No install step:

```bash
cd your-repo
npx github:Nithinfgs/cleanbreak
```

With no arguments it compares every local branch that is ahead of `main` (or `master`, or `origin/HEAD`), every git worktree including uncommitted changes, and the base branch itself, which catches "my branch vs. a main that moved on".

```bash
npx github:Nithinfgs/cleanbreak --verify "npm test"       # confirm with your own tests
npx github:Nithinfgs/cleanbreak feature-a feature-b       # just these two
npx github:Nithinfgs/cleanbreak origin/main HEAD          # my branch vs. today's main
npx github:Nithinfgs/cleanbreak --json                    # for scripts
```

### See it work in 10 seconds

```bash
git clone https://github.com/Nithinfgs/cleanbreak && cd cleanbreak
node scripts/demo.js
```

That builds a small throwaway repository with five branches and runs the tool on it. Three of the pairs merge without a conflict and then crash `node main.js`; `--verify` proves it.

## What it catches

| Rule                   | One branch…                                      | …the other branch adds                              |
| ---------------------- | ------------------------------------------------ | --------------------------------------------------- |
| `removed-symbol`       | deletes or renames a function, class or constant | a use of the old name                               |
| `signature-change`     | changes a function's parameter count             | a call with the old argument count                  |
| `moved-path`           | renames or deletes a file                        | an import or path pointing at the old one           |
| `duplicate-definition` | adds `def slugify`                               | another `slugify` in the same file (git keeps both) |

Plus plain textual conflicts, reported in the same matrix so you see everything in one place.

Definition recognition covers JS/TS, Python, Go, Rust, Java/Kotlin/Scala, C#, Ruby, PHP, Swift and C/C++.

## How it works

For each pair of refs: find the merge base, diff both sides, build candidate problems in both directions, then **re-check every candidate against the tree produced by `git merge-tree --write-tree`**. A removed function that was merely moved to another file disappears at that step. A name that is only a local variable somewhere else is filtered by a visibility check (the using file has to import the defining file). Nothing is reported that is not true of the simulated merge. Details and the exact filters are in [docs/how-it-works.md](docs/how-it-works.md).

Nothing in your checkout changes: merges happen in the object database only, uncommitted work is captured through a temporary index, and `--verify` runs in a throwaway worktree.

## Use cases

- **Parallel coding agents.** Run it before you merge what three agents produced in three worktrees.
- **Long-lived feature branches.** Ask "does my branch still fit the main it will land on?" every morning.
- **CI on pull requests.** Fail a PR that merges cleanly but would break the base. See [examples/pr-check.yml](examples/pr-check.yml).
- **Release trains and backports.** Compare a hotfix branch with the next release branch.

## Configuration

Optional `.cleanbreakrc.json` in the repository root ([example](examples/cleanbreakrc.json)):

```json
{
  "base": "main",
  "ignore": ["**/*.test.js", "vendor/**"],
  "ignoreSymbols": ["main", "setup"]
}
```

| Flag                           |                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--base <ref>`                 | integration branch (default: `origin/HEAD`, `main`, `master`)                                                                                               |
| `--verify <cmd>`               | run `<cmd>` on each suspicious trial merge. If it also fails on one of the branches alone, the result is marked inconclusive instead of blamed on the merge |
| `--fail-on any\|silent\|never` | exit code policy (default `any`: textual conflicts and silent breaks both exit 1)                                                                           |
| `--json`                       | machine-readable output                                                                                                                                     |
| `--no-worktrees` / `--no-base` | skip worktrees and uncommitted work / skip the moved-base comparison                                                                                        |
| `-C <dir>`                     | run in another directory                                                                                                                                    |

Exit codes: `0` nothing found, `1` problems found, `2` usage or git error.

## Limitations (please read)

- It is a heuristic over diffs, one line at a time. There is no type checker and no call graph. Dynamic dispatch, reflection, re-exports through barrel files and generated code are invisible to it.
- It only sees breaks of the "one side removed or changed, the other side newly relies on it" kind. Two changes that compile together but disagree on behaviour are out of scope.
- Argument counting treats parameters without defaults as required. In JavaScript, a missing argument is only `undefined`, so a `signature-change` finding there is a warning to look at, not proof of a crash. `--verify` tells you which.
- **How well does it work on real code?** I replayed 300 historical merge commits from [expressjs/express](https://github.com/expressjs/express) and [pallets/flask](https://github.com/pallets/flask) (150 each) by comparing each merge's two parents. Four were flagged; the maintainers' actual merge result differs from a clean auto-merge in each, so they are plausible rather than clearly wrong, but I did not verify that each would have failed. The first version of the rules flagged 12 of the first 60 Express merges, almost all noise from local variables sharing a name; that is what the visibility filter fixes. This is a smoke test, not a precision/recall measurement. If you find a false positive or a miss, the issue templates are made for exactly that.

## Roadmap

- [ ] GitHub Action with PR annotations
- [ ] Rule: changed return shape for typed languages (via optional TypeScript / `go vet` hooks)
- [ ] Rule: config key and environment variable added on one side, removed on the other
- [ ] Optional language-server backend for exact references
- [ ] `--watch` mode for a folder of agent worktrees

## Contributing

Small, real cases are the best contribution. See [CONTRIBUTING.md](CONTRIBUTING.md). Tests build tiny git repositories, so reproducing a miss usually takes ten lines.

```bash
npm install
npm run check
```

## License

[MIT](LICENSE)
