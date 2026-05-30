# UI Guidelines

Sidra UI controls must make interaction state visible without changing layout.

## Control States

- Enabled controls use `cursor: pointer`.
- Hover, focus-visible, and active states must be visible on enabled buttons and disclosure controls.
- Disabled controls stay muted and must not receive enabled hover or active styling.
- Busy controls should show progress text or `aria-busy` while work is in flight.
- Selected or open controls should expose state with ARIA where applicable and a visible state attribute or class.

## Keyboard Access

Keyboard users must be able to identify the focused control. Use `:focus-visible` rings on buttons, text inputs, textareas, and keyboard-focusable disclosure summaries.

## Icon Buttons

Icon-only buttons need an accessible name and a visual affordance such as `title` or an equivalent tooltip.

## Forms

Invalid fields use `aria-invalid="true"`, visible error text, and `aria-describedby` when error text is present. Submit actions stay disabled while form drafts are invalid.

## Manual Verification

Before shipping extension UI changes, check the side panel and options page with mouse and keyboard. Verify hover, focus-visible, active, disabled, busy, open, and invalid states where those states apply.
