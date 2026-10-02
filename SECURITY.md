# Security policy

cleanbreak reads git objects and, only when you pass `--verify <cmd>`, runs the command **you** give it inside a temporary worktree of a trial merge. It makes no network requests and sends no telemetry.

Treat `--verify` like any command that executes repository code: do not run it on branches you do not trust.

To report a vulnerability, please use GitHub's private vulnerability reporting on this repository (Security tab → Report a vulnerability) rather than a public issue.
