# GEMINI.md — vscode-sap-hana-dev-tools

Host-environment and terminal execution rules for Antigravity / Gemini agents working in this repository. Project-wide, tool-agnostic conventions remain in `AGENTS.md`.

## 1. Environment Scope (Windows vs. Linux)

Determine the active operating system from the runtime environment context (or verify the OS silently if unclear) before issuing shell commands, and apply that information only to command formatting without highlighting raw environment details in outputs or documentation:

- **Windows:** Assume the terminal runner executes legacy **Windows PowerShell 5.1**, not Bash or PowerShell 7 (even when newer PowerShell versions are installed on the host). All **Windows PowerShell 5.1 Terminal Rules** below apply.
- **Linux:** The Windows PowerShell 5.1 terminal rules below do **not** apply; use standard POSIX shell syntax and quoting.

## 2. Windows PowerShell 5.1 Terminal Rules (Windows Only)

1. **`&&` and `||` Are Forbidden:** PowerShell 5.1 throws a parser error on `&&` and `||`.
2. **One Command Per Tool Call:** Execute commands as individual, sequential tool calls (e.g., wait for `git add` to finish before `git commit`). Never run parallel `git` commands (prevents `.git/index.lock` collisions and matches the terminal allowlist cleanly).
3. **Chaining Fallback:** Only if chaining in a single invocation is unavoidable, use `Command1; if ($?) { Command2 }` for dependent commands, or `Command1; Command2` for read-only inspection.
4. **Backtick Escaping Trap:** In PowerShell, `` ` `` is the escape character inside double quotes (`"..."`).
   - **Always use single quotes (`'...'`)** for commit messages, issue titles, and PR titles containing Markdown backticks (e.g., `git commit -m 'feat(grammar): ✨ add `.hdbtable` support'`).
   - For multi-line PR or issue bodies containing code blocks/backticks, use `--body-file` or a single-quoted here-string (`@' ... '@`).
