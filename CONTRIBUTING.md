# Contributing

Thanks for helping. cleanbreak has no runtime dependencies and should stay that way.

```bash
git clone https://github.com/Nithinfgs/cleanbreak && cd cleanbreak
npm install
npm run check      # lint + typecheck + format check + tests
node scripts/demo.js
```

Tests build tiny real git repositories (see `test/helpers.js`), so a new case is usually 10 lines: create a repo, make two branches, assert on `rules(run({ cwd }))`.

## The most useful contributions

- **A real case that was missed or wrongly flagged.** Open an issue with the false-positive or missed-break template. Two small branches that reproduce it are gold.
- **Language support.** Definitions live in `src/lang.js` as one regex rule per construct. Add a rule, a unit test in `test/lang.test.js`, and an end-to-end case in `test/rules.test.js`.
- **New rule.** A rule must (1) produce candidates from the two diffs, (2) re-check each candidate against the `git merge-tree` result in `confirm()`, and (3) come with one case it catches and one look-alike it must not flag. Rules that cannot be confirmed against the merged tree will not be accepted; precision matters more than coverage here.

## Style

Prettier and ESLint are configured (`npm run format`). Prefer small functions and comments that explain _why_.
