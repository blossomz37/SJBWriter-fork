# Fork changelog

Changes made in [blossomz37/SJBWriter-fork](https://github.com/blossomz37/SJBWriter-fork)
on top of Jim Boulter's [SJBWriter](https://github.com/JimBoulter/SJBWriter).

Each entry says what changed, why, and how it works, in plain words, so any
change can be re-built or cherry-picked on its own. Commit hashes refer to the
fork.

---

## 2026-10-22: Markdown preview toggle

**Commit:** `09c7f9e`. **Files:** `app/templates/index.html`,
`app/static/script.js`, `app/static/style.css`, and the new
`app/static/vendor/marked.min.js` and `app/static/vendor/purify.min.js`.

- **Why:** the editor shows raw Markdown (`#`, `**`, `|`), so headings, lists,
  and tables are hard to read. Writers want to see the finished page without
  leaving the app.
- **What the user sees:**
  - An eye button at the right end of the formatting bar.
  - **⌘E** (Ctrl+E on Windows) does the same thing. It is the same key as
    Obsidian's preview toggle.
  - Preview replaces the editor with a rendered page: headings, bullet and
    numbered lists (nested too), tables (with column alignment), block quotes,
    inline code and code blocks, links, and images.
  - The button turns the accent color while preview is on.
  - The B, I, H2, and bullet buttons are disabled in preview, because they edit
    raw text.
  - Double-click the preview to go back to editing.
  - Preview mode is remembered after a reload.
- **How it works:**
  - **Libraries:** two small libraries are stored in the app, with no CDN, so
    preview works offline. `marked` 12.0.2 (MIT) turns Markdown into HTML.
    `DOMPurify` 3.1.6 (Apache-2.0 / MPL-2.0) then removes scripts and event
    handlers. This matters because the text can come from an AI model. The
    rendered HTML is never inserted without that cleaning step.
  - **Markdown options:** GitHub-style Markdown with `breaks: true`. A single
    line break in the text stays a line break, which matches what the writer
    sees while typing, for dialogue and poetry.
  - **Clean-up after rendering:** every link gets `target="_blank"` and
    `rel="noopener noreferrer"`, so clicking one never navigates the app away
    from unsaved work. A plain link whose address ends in an image extension
    (png, jpg, jpeg, gif, webp, svg, avif) is also shown as the image. The
    standard `![alt](url)` form works as usual.
  - **Layout:** the preview copies the editor's chosen font and size. It uses
    the same centered text column (`--editor-measure`) and theme colors as the
    editor, so switching modes does not make the page jump.
  - **Staying current:** the preview re-renders when the text changes (typing,
    opening a file, undo, and streaming AI output). It renders at most once per
    animation frame, so long generations stay smooth. The hook is the existing
    word-count update, plus the three places that clear the editor.
  - **Nothing saved changes:** the editor textarea stays the single source of
    text. Preview only reads from it, and never writes to it.
- **Note:** images from the web load from their own servers when the preview
  is shown.

**Check:** paste a heading, a list, a table, and
`[pic](https://…/image.jpg)` into a file. Press ⌘E. All four should render, and
the image should show. Press ⌘E again, or double-click, to return to the raw
text.

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
