# Fork changelog

Changes made in [blossomz37/SJBWriter-fork](https://github.com/blossomz37/SJBWriter-fork)
on top of Jim Boulter's [SJBWriter](https://github.com/JimBoulter/SJBWriter).

Each entry says what changed, why, and how it works, in plain words, so any
change can be re-built or cherry-picked on its own. Commit hashes refer to the
fork.

---

## 2026-10-22: UI polish, batch 1 (CSS only)

**Commit:** `b8df8d5`. **File:** `app/static/style.css`. No HTML, JavaScript,
or Python changes.

### 1. Dropdown carets no longer touch the edge

- **Why:** the browser's own arrow sat against the right border of every
  dropdown (font, size, model, theme, model source).
- **How:** every `select` turns off the native look (`appearance: none`) and
  gets a small chevron icon as a background image, placed 10 px from the right
  edge, with 30 px of right padding (26 px in the formatting bar). The chevron
  is an inline SVG held in a CSS variable. Light themes use a dark stroke and
  dark themes a light one.

### 2. Thin scrollbars in every theme

- **Why:** the scrollbars were 10 px wide with a solid track, and they were
  only styled in the three dark themes. The two light themes showed the default
  OS bar.
- **How:** one shared rule for all themes. It uses `scrollbar-width: thin` and
  a transparent track, plus the webkit equivalent: an 8 px bar with a rounded
  thumb inset by 2 px. Each theme now only sets two colors, `--scrollbar` and
  `--scrollbar-hover`, using the same colors as before. This replaced four
  copies of the scrollbar rules.

### 3. Form-field colors come from the theme

- **Why:** each dark theme repeated its own input, textarea, and select rules,
  and the light themes had none.
- **How:** new theme variables `--input-bg`, `--input-text`, `--input-border`,
  and `--placeholder`, set in every theme. Dark themes keep the exact colors
  they had before. One shared rule applies them to text fields, textareas, and
  selects. Checkboxes and radios are left alone.

### 4. A modern UI font

- **Why:** the interface used Arial, and textareas fell back to the browser's
  monospace font (the instruction box and the model description).
- **How:** the body uses the system UI font stack (San Francisco on Mac,
  Segoe UI on Windows). Fields and buttons inherit it. The manuscript editor is
  not affected, because its font is still set from the font picker. Model IDs
  stay monospace on purpose.

### 5. A readable line length in the editor

- **Why:** the editor was a 900 px box centered in the writing area. Lines
  ran to about 120 characters, and the scrollbar floated in the middle of the
  screen.
- **How:** the editor now fills the whole writing area, so the scrollbar sits
  at the window edge. Its left and right padding is
  `max(24px, (100% − 70ch) / 2)`, which centers a text column about 70
  characters wide in the chosen font. The width is one variable,
  `--editor-measure`.

### 6. Clear zones instead of boxes

- **Why:** the sidebar was two bordered cards inside a padded frame, and the
  editor, instruction box, and footer blended together.
- **How:**
  - The outer frame padding is gone.
  - **Sidebar:** the `--panel` background fills the full height. The two groups
    are separated by a single 1 px line instead of card borders, and the last
    section in each group has no bottom line, so lines never double.
  - **Writing area:** the `--bg` background.
  - **AI dock** (the instruction box and controls): the `--panel` background
    with a 1 px top border. This also replaces a hard-coded `#ccc` border that
    ignored the theme.

### 7. Quieter sidebar headings

- **Why:** the section headings (Prompts, System, Background, Writing) were
  16 px bold, the same weight as the file names, so the eye had nowhere to rest.
- **How:**
  - The headings are 11 px, uppercase, with wider letter spacing, in the muted
    text color.
  - Their `+` and folder buttons are borderless and slightly faded until hover.
  - The panel titles ("Your Writing Helper", "Project: …") went from 18 px to
    15 px, semibold.

### 8. The instruction box looks like a field

- **Why:** it was a bare area with only a bottom line, set in monospace.
- **How:** a 1 px border with 8 px rounded corners, 15 px UI font, and a border
  that turns the theme's `--accent` color when the box is focused.

**Check:** load the app in each of the 5 themes. Open Settings → Visual Layout
and Settings → Manage Models. All dropdowns should show a chevron with space on
its right. The editor text should sit in a centered column.
