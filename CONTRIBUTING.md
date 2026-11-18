# Contributing to Sediment

Thanks for wanting to help. Sediment is small and moves fast, so a short conversation before a big change saves everyone time.

## Before you start

- **Bugs:** open an issue with what you did, what you expected and what happened. A screenshot helps.
- **Small fixes** (typos, clear bugs, polish): open a pull request directly.
- **Features or larger changes:** open an issue first so we can agree on the approach. Sediment has a clear direction (an agent-led research canvas, not an auto-generated graph), and some good ideas may not fit it.

## Setup

Follow [docs/development.md](docs/development.md) to run the frontend and backend locally. [docs/architecture.md](docs/architecture.md) explains how the pieces fit together.

## Making a change

1. Branch from `main`.
2. Keep the change focused: one fix or feature per pull request.
3. Run the checks before you push:

   ```bash
   cd backend && python -m unittest discover -s tests
   cd frontend && npx tsc --noEmit && npx eslint src
   ```

4. Add or update backend tests when you change behaviour there.
5. Open a pull request that says what changed and why, with a screenshot or short recording for anything visual.

## Project rules

- **Text fields get no focus highlights.** No focus ring, glow, shadow or border change on inputs, textareas, selects or the wrappers around them. Buttons and links keep their keyboard focus outline. (See [AGENTS.md](AGENTS.md).)
- **Keyboard and screen readers matter.** Anything you can click should work from the keyboard and have a label.
- **The agent stays honest.** It may only put real papers on the canvas, should say when it is inferring rather than citing, and must stay inside its per-message spending cap. Don't add tools or prompts that work around these.
- **No hard-coded agent flows.** Change what the agent does through its instructions and tools, not by scripting its steps.
- **Never commit secrets.** API keys go in `.env` files, which are not tracked.

## License

By contributing you agree that your work is released under the project's [AGPL-3.0 license](LICENSE).
