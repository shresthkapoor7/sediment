# Agent Instructions

## Git restrictions

Agents may run read only Git commands like:

- `git log`
- `git diff`

Agents must not run any other Git command, including `git add`, `git commit`,
`git push`, `git pull`, `git fetch`, `git merge`, `git rebase`, `git checkout`,
or `git switch`.

Never stage files, create commits, push changes, alter branches, or make any
other change to Git or remote-repository state. Do not create or update pull
requests. The user exclusively controls all commits and pushes.