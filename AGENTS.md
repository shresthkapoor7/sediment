# Project rules

- **No focus highlights on text fields.** Inputs, textareas and selects (and the bars or wrappers around them) never get a focus ring, glow, `box-shadow` or border-colour change on focus. Don't add `:focus`, `:focus-visible` or `:focus-within` styling to them, and don't use `:has(input:focus)` on a wrapper to fake it. Buttons and links keep their keyboard focus outline.
