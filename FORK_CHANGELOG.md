# Fork changelog

Changes made in [blossomz37/SJBWriter-fork](https://github.com/blossomz37/SJBWriter-fork)
on top of Jim Boulter's [SJBWriter](https://github.com/JimBoulter/SJBWriter).

Each entry says what changed, why, and how it works, in plain words, so any
change can be re-built or cherry-picked on its own. Commit hashes refer to the
fork.

---

## 2026-10-22: Icons for projects, folders, and documents

**Commit:** `264b723`. **Files:** `app/static/script.js`,
`app/static/style.css`, `app/templates/index.html`, and
`app/templates/_icons.html` (Lucide `book`, `folder`, `folder-open`,
`file-text`, `sticky-note`).

- **Why:** projects, folders, and documents looked alike in the lists. Only
  the arrow hinted at a folder.
- **How:**
  - **Project:** a `book` icon in front of "Project: …", and in front of each
    name in the project switcher menu.
  - **Folder:** `folder` when closed and `folder-open` when open, so the icon
    also shows the state.
  - **Document:** `file-text` (a page with lines) in Background and Writing.
    In the AI setup panel, System and Prompts files use `sticky-note`, a memo,
    so AI instructions read differently from manuscript and notes.
    `documentIconName(section)` picks the icon.
  - **Style:** the icons are 14 px and muted, so the names stay the strongest
    element. The open file's icon takes the accent color.
- **Layout detail:**
  - Each row label is now `inline-flex`: icon, then one `.tree-text` span that
    holds both the title and the word count. A long title wraps with its count,
    instead of the count drifting off as its own column.
  - The AI summary chip got `flex-shrink: 0`, so the model picker gives way
    first and "No rules · No prompt" is no longer cut off.

---

## 2026-10-22: Close the document; the logo goes home

**Commit:** `cd8dac0`. **Files:** `app/templates/index.html`,
`app/static/script.js`, `app/static/style.css`.

- **Why:** the empty state only appeared in projects with no files. The app
  always reopened the last file, or the first writing file, so there was no
  way to choose a clean start screen.
- **How:**
  - **Close button:** a × at the right end of the document title row calls the
    new `closeDocument()`.
  - **Logo:** the logo and version in the top bar are now one plain button,
    tooltip "Home". It does the same thing, following the usual "logo = home"
    pattern.
  - **What `closeDocument()` does:**
    - It saves unsaved changes first.
    - It refuses while a generation is running, with a notice.
    - It clears the current file, title, and editor, then re-renders.
    - It sets `sjb_doc_closed_<project>` in `localStorage`.
  - **On startup,** `loadAll()` checks that flag before its usual restore
    chain (last file, project's last file, first writing file). If it is set,
    the empty state stays. The flag is per project, so closing a document in
    one project does not empty the others.
  - Opening any file clears the flag in `openFile()`.
  - Zen mode hides the × button.
- **Note:** ⌘W was not used. Browsers reserve it for closing the tab, and a page
  cannot override it.

**Check:**

1. Open a file, type something, and click ×. The empty state should show, and
   the edit should be saved.
2. Reload. The empty state should stay.
3. Click a file to open it, then click the logo. The empty state should return.

---

## 2026-10-22: Empty state when no document is open

**Commit:** `a2aa0a2`. **Files:** `app/templates/index.html`,
`app/static/script.js`, `app/static/style.css`, and
`app/templates/_icons.html` (Lucide `feather` and `file-plus`).

- **Why:**
  - When no file is open, for example in a new project or after deleting the
    last file, the editor still looked usable. But `saveCurrentFile()` returns
    early when there is no file, so anything typed there was silently lost. AI
    output would land there too.
  - An empty state makes that clear, and gives an obvious next step.
- **How:**
  - A new `#emptyState` block holds:
    - a feather icon in the accent color
    - "No document open"
    - "Choose a file in the sidebar, or start a new one."
    - two buttons, **New writing file** (accent) and **New background note**,
      which call the existing `createNew()`. That function already opens the
      new file.
    - a shortcut hint
  - `updateEmptyState()` sets `body.no-document` when `currentFile.filename` is
    empty. It runs with every status bar update and every sidebar re-render.
    The class hides the title row, formatting bar, editor, preview, AI dock,
    and the status bar's word count and reading time. The token meter stays,
    because the chosen context still counts.
  - **No flash on startup:** an `appReady` flag holds the empty state back
    until startup finishes. The sidebar renders before the last file reopens,
    so without the flag the empty state would blink.

**Check:**

1. Create a new project. The empty state should show.
2. Click New writing file and give it a name. The file should open.
3. Delete it. The empty state should return.

---

## 2026-10-22: Panel toggles in the top bar

**Commit:** `d7cd197`. **Files:** `app/templates/index.html`,
`app/static/script.js`, `app/static/style.css`.

- **Why:** this sets one simple rule for the layout. The top bar holds
  *window* controls (which panels are open, light or dark, settings). The
  editor toolbar holds *document* controls (formatting, preview, zen).
- **How:**
  - The **sidebar toggle** moved from the title row to the left edge of the top
    bar, before the logo. The title row now holds only the title.
  - A new **AI setup toggle** (Lucide `panel-right`) sits in the top bar, left
    of the light/dark switch. It calls the same `toggleAiPanel()` as the
    summary chip and ⌘⌥\\.
  - Both toggles set `aria-pressed`. In the top bar, a pressed toggle shows its
    icon in the accent color, so an open panel is visible at a glance.
    `setAiPanelOpen()` keeps the new toggle in sync.
  - The zen rule that hid `#sidebarToggle` was removed, because zen hides the
    whole top bar.

---

## 2026-10-22: Top bar with logo, version, light/dark switch, and settings

**Commit:** `af6c552`. **Files:** `app/app.py`, `app/templates/index.html`,
`app/static/script.js`, `app/static/style.css`, and
`app/templates/_icons.html` (Lucide `sun` and `moon`).

- **Why:** the "Your Writing Helper" heading took space at the top of the
  sidebar and added nothing once the app is open. App-level controls (settings,
  light/dark) had no natural home.
- **How:**
  - **The bar:** a 40 px `<header class="top-bar">` sits above the main layout.
    The layout height became `100vh − --topbar-h − --statusbar-h`.
    - **Left:** the app icon (`apple-touch-icon.png` at 22 px, with rounded
      corners) and the version, in the muted text color.
    - **Right:** a light/dark switch and the settings gear, which moved here
      from the sidebar.
  - **Light/dark switch:**
    - It shows the mode a click switches to: a moon in light mode, a sun in
      dark mode.
    - It keeps the current accent, saves `themeMode` and `accent` to
      `app_state.json`, and updates its icon and tooltip in `applyAppearance()`.
    - "Match system" stays a choice in Settings → Visual Layout.
  - **The old header:** the `.header-row` markup and its CSS rule are removed.
  - **Version:** the new `APP_VERSION = "0.9.0"` constant in `app.py` is passed
    to the template. Both the top bar and the About view read it, so the
    version lives in one place.
  - **Zen mode** hides the bar.
  - The bar sits above the panes (`z-index: 20`), so tooltips that drop below
    it are not hidden.

## 2026-10-22: Personal prompts and system rules stay out of Git

**Commit:** `5fe1914`. **File:** `.gitignore`.

- **Why:** new prompts or system rules made in the app are saved in
  `Global/prompts/` and `Global/system/`. Those folders were tracked, so
  personal files showed up as untracked and could be committed by accident.
- **How:**
  - `Global/prompts/*` and `Global/system/*` are ignored, with exceptions for
    the shipped starters: `epbm-*.json`, `plan.json`,
    `always-on-instructions-from-cv-to-be-edited.json`, and `em-dashes.json`.
    This is the same pattern as `Projects/*` with its sample-project exception.
  - Starter files that are already tracked stay tracked. New starters must
    match the exceptions to be added.
  - **Local-only note:** in this fork's own copy, `Global/modelList.json` also
    has `git update-index --skip-worktree` set, because it records the user's
    own model choices. This is not part of the repository.

---

## 2026-10-22: AI setup panel on the right, with a summary chip

**Commit:** `9a73855`. **Files:** `app/templates/index.html`,
`app/static/script.js`, `app/static/style.css`, and
`app/templates/_icons.html` (3 more Lucide icons: `x`, `panel-right`,
`sliders-horizontal`).

- **Why:** the left sidebar mixed two kinds of things. Project and Writing are
  what a writer moves through all the time. System and Prompts are AI setup:
  chosen once, then mostly left alone. Splitting them follows the familiar
  "files on the left, inspector on the right" pattern, and it gives the
  project files the full sidebar height.
- **How:**
  - **The panel:** System and Prompts moved into a new
    `<aside id="aiPanel" class="ai-panel">`, after the writing area. It is
    300 px wide, with a header ("AI setup") and a close button.
    - It is **closed by default**. A `body.ai-panel-open` class shows it, and
      `localStorage` (`sjb_ai_panel_open`) remembers the state.
    - Zen mode hides it.
  - **The summary chip:** the AI dock, left of the model picker, has a chip
    that always shows what the AI will receive, for example
    **"1 rule · Prompt: EPBM 3 - Outline"** or "No rules · No prompt". It
    counts only System files that are checked and still exist.
    - The chip takes the accent color while anything is active, and it is
      tinted while the panel is open.
    - Clicking the chip opens or closes the panel.
    - It updates whenever the selections are saved or the lists re-render.
    - This is the safeguard for a hidden panel: you can always see that a rule
      is on.
  - **Shortcut:** **⌘⌥\\** (Ctrl+Alt+\\) toggles the panel. It checks
    `e.code === "Backslash"`, because with Option held, `e.key` returns a
    different character on a Mac.
  - **Left sidebar:** it now holds the app header and the project group
    (Background, Writing).
  - **Unchanged features:** folding, sorting, section reorder, and dragging
    files between sections work across both sides. For example, a Background
    note can be dragged onto the System label in the panel.
  - **Toasts** move left of the panel while it is open.

**Check:**

1. The panel should be closed on first load, with the chip reading
   "No rules · No prompt".
2. Click the chip, check a System rule, and pick a prompt. The chip should
   update.
3. Press ⌘⌥\\ to close the panel. The chip should still show what is active.

---

## 2026-10-22: System section above Prompts by default

**Commit:** `76f7525`. **File:** `app/templates/index.html`.

- **Why:** System files are standing rules that apply to every request.
  Prompts are the per-request instruction. Rules first, then the instruction,
  reads in the same order the context is built.
- **How:** in the first sidebar group, the System `.section` block now comes
  before the Prompts block. A reader's own drag order, saved in
  `localStorage` as `sjb_section_order`, still overrides this default.

---

## 2026-10-22: Sidebar: fold, sort, reorder sections, move files between sections

**Commit:** `b953ad2`. **Files:** `app/app.py`, `app/static/script.js`,
`app/static/style.css`, `app/templates/index.html`, and
`app/templates/_icons.html` (3 more Lucide icons: `arrow-up-down`,
`arrow-down-a-z`, `arrow-down-z-a`).

Each section header (`<h3>`) now has `class="section-header"`,
`draggable="true"`, and `data-section`. It holds a fold button that wraps a
chevron and the label, the existing new-file and new-folder buttons, and a sort
button on the right.

### 1. Fold a section

- **Why:** the four sections share a fixed height. With 10 prompts, the
  Prompts list was cut off.
- **How:**
  - Click the section label. A `folded` class hides the list, turns the
    chevron, and sets the section to `flex: 0 0 auto`, so the other sections
    in the group grow.
  - If every section in a group is folded, the group shrinks too, through a
    `:has()` rule.
  - The folded sections are remembered in `localStorage`
    (`sjb_folded_sections`).

### 2. Sort toggle per section

- **How:**
  - The button cycles **My order → A–Z → Z–A**. The icon and tooltip change
    with it, and the button takes the accent color while the list is sorted.
  - `sortForView()` sorts only what is shown. Folders come first, then files,
    by title, with numbers in natural order (2 before 10), at every folder
    level.
  - The saved order in `state.json` is never changed, so "My order" always
    brings back the hand-made order.
  - Dragging inside a sorted list still works: it places the file next to the
    target in the saved order.
  - The sort mode per section is in `localStorage` (`sjb_sort`).

### 3. Reorder sections

- **How:**
  - Drag a section label above or below another. A 2 px accent line shows the
    drop spot.
  - Sections move only inside their group (Prompts/System, or
    Background/Writing), because one group is shared by all projects and the
    other belongs to one project. A drop across groups shows a short notice
    instead.
  - The order is in `localStorage` (`sjb_section_order`) and is applied on
    load by re-appending the section elements.

### 4. Move a file to another section

- **Why:** a note that becomes a chapter, or a prompt that should be a system
  rule, could not change section.
- **Where to drop a file from another section:**
  - on a section label (it goes to the top level)
  - on a folder (it goes into the folder)
  - on a file (it goes before or after that file)
  - on empty space in the list (it goes to the end)
- **Server:** the new route `/move_file_section` (`from_section`, `section`,
  `filename`, and optional `folder_id`, `target_filename`, `position`):
  - moves the file on disk, and its `.history` folder with it
  - takes the item out of the source list, keeping its title and word count
  - reloads the target state (both lists can share one `state.json`) and
    inserts the item with the new `insert_into_tree()` helper
  - refuses a move when the target section already has a file with that name,
    and leaves the file where it was
- **Client:** `moveFileToSection()`:
  - saves first if the moved file is open with unsaved changes
  - clears its checkbox or prompt selection, because selections belong to a
    section
  - re-points the "last opened" record if the file was open
  - reloads, then shows "Moved to Writing." (for example)
- **Not included:** folders move only within their own section. A cross-section
  folder drop shows a notice.

### 5. Bug fix: one drop ran the move many times

- **Problem:** `renderSection()` added the list's `dragover` and `drop`
  listeners on every refresh, and the list element survives refreshes. After
  six refreshes, one drop on empty list space ran the move handler **8 times**.
- **How:** the listeners are now added once. A `data-drop-ready` flag on the
  list marks them. The same drop now runs the handler once.
- **Refactor:** `remove_file_from_tree()` moved out of the delete route to the
  module level, so the move route can use it too.

**Check:**

1. Fold Prompts. System should take the space.
2. Click the Writing sort button twice: A–Z, then Z–A.
3. Drag the System label above Prompts.
4. Drag a Background file onto the Writing label. It should move, and a
   "Moved to Writing." notice should appear.

---

## 2026-10-22: UI polish, batch 3: icons, mode + accent themes, toasts

Three commits. **Files:** `app/templates/index.html`, the new
`app/templates/_icons.html`, `app/static/script.js`, and
`app/static/style.css`.

### 1. Lucide icons and instant tooltips (`109e823`)

- **Why:** the controls mixed emoji (⚙️ 📁 ⏹ ↩ ⏳ ▶ ▼ ⋯), which look different
  on every operating system, with text buttons such as "ClearPrompt".
- **The icon file:**
  - 20 icons from Lucide v0.460.0 (ISC license) are bundled as an inline SVG
    sprite in `templates/_icons.html`.
  - `index.html` pulls the sprite in with
    `{% include "_icons.html" %}` right after `<body>`.
  - Each icon is `<svg class="icon"><use href="#i-NAME"/></svg>`. Icons work
    offline and take the text color.
  - Inside JavaScript, `iconSvg(name)` returns the same markup. It is used for
    the folder arrows and the ⋯ menu buttons.
- **Buttons that became icon-only:**
  - Settings
  - New file and new folder (each sidebar section)
  - Bold, italic, heading, and bullet list
  - Generate (in the accent color), Stop, Undo, Save, and Clear instruction
  - The project dropdown arrow and the ⋯ menus
  - The sidebar, preview, and zen toggles moved to the sprite too.
- **Tooltips:**
  - Each button has `aria-label` and `data-tip`. A CSS `::after` tooltip shows
    `data-tip` after 0.15 s. The native `title` tooltip waits about a second.
  - Helper classes: `tip-up` (tooltip above, used in the footer), `tip-end`
    (aligned to the right edge, so tooltips near the window or sidebar edge are
    not clipped), and `tip-start`.
  - Tooltips include the shortcut where there is one, for example
    "Generate (⌘↵)".
- **Generate button:** `generate()` used to replace the button's text with
  "Generating…", which would erase the icon. It now adds an `is-busy` class,
  which makes the icon pulse, and the button is found by its new
  `#generateBtn` ID.
- **Thinking indicator:** it uses a spinning loader icon.

### 2. Mode × accent appearance (`581b8e8`)

- **Why:** the five themes (Light, Dark, Crimson, Dark Stellar, Light Stellar)
  only changed tints. The accent color was barely used.
- **How:**
  - **Tokens:** two neutral palettes. Light is the default on `body`, and dark
    comes from `body.mode-dark`. They cover background, panel, surface,
    border, hover, text, inputs, scrollbars, and the select chevron.
  - **Accents:** six classes set a light-mode and a dark-mode shade, `--accent-light`
    and `--accent-dark`: blue, indigo, teal, crimson, amber, and violet. The
    mode then picks one as `--accent`.
  - **Derived colors:** `--accent-contrast` (white in light mode, near-black in
    dark mode) colors text on accent buttons. The selection tint `--active` is
    `color-mix()` of the accent and the background.
  - `color-scheme: light` / `dark` makes native checkboxes, radios, and menus
    match the mode.
  - **"Match system" mode** follows `prefers-color-scheme`, including live
    changes while the app is open.
- **Settings → Visual Layout:**
  - The old Theme list is replaced by a **Mode** picker (Light / Dark / Match
    system) and six round **Accent color** swatches. The picked swatch shows a
    ring.
  - Changes preview live. Back or Cancel restores the saved look, and Save
    stores `themeMode` and `accent` in `app_state.json`.
- **Old settings:** an old `theme` value keeps working through a lookup table:
  - light → light + blue
  - dark → dark + blue
  - crimson → dark + crimson
  - dark-stellar → dark + blue
  - light-stellar → light + blue
  - `setTheme(oldName)` still works too.

### 3. Toasts instead of `alert()` (`bfd3881`)

- **Why:** 28 `alert()` pop-ups blocked the whole page, even for "Nothing to
  undo."
- **How:**
  - `showToast(message, kind)` adds a small card to a stack at the top right,
    below the toolbar. That spot keeps it clear of the AI buttons at the bottom.
  - **Errors** (red edge) stay for 7 seconds. **Notices** (accent edge, `"info"`)
    stay for 3.5 seconds. Click a toast to close it.
  - Errors use `role="alert"`, and the stack is an `aria-live` region.
  - All 28 `alert()` calls now use it. Seven plain notices pass `"info"`.
  - `confirm()` and `prompt()` are unchanged, because they need an answer.

**Check:**

1. Hover over any toolbar or footer button for its tooltip.
2. In Settings → Visual Layout, try Dark + Teal, then Back. The look should
   return to the saved one.
3. Press ⌘Enter with no model selected. A toast should appear, not a pop-up.

---

## 2026-10-22: Safe saving, version history, trash, and name checks

**Commit:** `fbe4ae3`. **Files:** `app/app.py`, `app/static/script.js`,
`app/static/style.css`, `app/templates/index.html`, `.gitignore`.

### 1. Saves can no longer leave a broken file

- **Problem:** files were opened with `"w"` and rewritten in place. A crash,
  full disk, or power cut during a save could leave an empty or half-written
  chapter. The next load then returned nothing, and the next save wrote that
  over the file.
- **How:**
  - `save_json()` writes to a temporary file (`.tmp-*.json`) in the same
    folder.
  - It flushes and fsyncs the file, sets the mode to 0644, then swaps it into
    place with `os.replace()`. That swap is atomic: the file is either the old
    version or the new one, never half of each.
  - On any error, the temp file is removed.
  - Every server write now goes through `save_json()`: file saves, new files,
    state files, the initial global state, and the Ollama model order file.

### 2. Automatic version history

- **Why:** there was no way to get back yesterday's text.
- **How:**
  - When `/save_file` is about to overwrite a file whose text changed, it first
    copies the current file to `<section folder>/.history/<file name>/<YYYYMMDD-HHMMSS>.json`.
  - At most one version is kept per file every 5 minutes, and the newest 50
    are kept. Both limits are constants at the top of the new section.
  - A version is skipped when its text matches the newest kept version.
  - Versions made in the same second get a `-2`, `-3`… suffix instead of
    overwriting each other.
  - Renaming a file renames its history folder too.
- **New routes:**
  - `/file_history` lists the versions, newest first, with time, title, and
    word count.
  - `/file_version` returns one version's text.
  - `/restore_version` restores a version. It first keeps the current text as
    a version (forced, ignoring the 5-minute limit), so a restore can always
    be undone.
- **UI:**
  - The file ⋯ menu has a new **Version history…** item.
  - It opens a window with the versions on the left (date, words, "x min ago")
    and a plain-text preview on the right, in the editor's font.
  - **Restore this version** puts the text back. If the file is open, the
    editor updates in place.
  - Esc closes the window. Unsaved changes are saved before the window opens.

### 3. Deleted files and projects go to a trash folder

- **Why:** delete was permanent, for both files and whole projects.
- **How:**
  - Deleting a file moves it to `<section folder>/.trash/<timestamp>-<name>`.
  - Deleting a project moves the whole folder to
    `Projects/.trash/<timestamp>-<project>`.
  - Same-second name clashes get a `-2` suffix.
  - The project list and the "last project" check skip hidden folders, so
    `.trash` never appears as a project.
  - Sidebar folders need no trash: they exist only in `state.json`, and the
    app deletes them only when they are empty.
  - Restoring from the trash is manual for now: move the file back and
    re-add it.

### 4. Names that could reach outside the data folders are refused

- **Problem:** `section`, `filename`, and `project` came from the browser and
  went straight into `os.path.join()`. A crafted request could read, overwrite,
  or delete files elsewhere. For example, `delete_project` with `../Global`
  would remove the global folder.
- **How:**
  - One `@app.before_request` hook checks every JSON request. `section` must
    be one of `prompts`, `system`, `background`, or `writing`. `filename`,
    `project`, and `current_project` must be single names: no `/` or `\`, no
    `..`, and no leading dot.
  - As a second line of defense, `get_project_dir()` falls back to `default`
    if the saved current project is not a safe name, and
    `load_file_content()` (used by `/generate`) returns nothing for unsafe
    names.
- **Note:** names the app creates (slugified titles) always pass, so normal
  use is unchanged.

### 5. Git

`.history/`, `.trash/`, and `.tmp-*` are ignored everywhere. The rules sit at
the end of `.gitignore`, so they win over the `!Projects/sample-project/**`
exception.

**Check:**

1. Edit a file and save it. Open ⋯ → Version history, and the old text should
   be listed.
2. Restore it, then open Version history again. Your edited text should now be
   a version too.
3. Delete a file, then look in that section's `.trash` folder.

---

## 2026-10-22: AI output marker settings, and a marker placement fix

**Commit:** `c90d290`. **Files:** `app/templates/index.html`,
`app/static/script.js`, `app/static/style.css`. No server changes: the existing
`/save_app_state` route stores the new keys.

### 1. Markers can be turned off or reworded

- **Why:** every generation inserted
  `********` / `New generated content below` / `********` before the AI text,
  and a matching "End of generated content above" block when the AI wrote into
  the start or middle of the text. Some writers find this breaks their flow.
- **How:**
  - A new **AI Output Markers** section in the main Settings view has a
    checkbox ("Mark where AI text begins and ends") and two small text boxes,
    **Before AI text** and **After AI text**. Both boxes start with the
    original marker text.
  - The values are saved to `app_state.json` as `showOutputMarkers`,
    `outputMarkerBefore`, and `outputMarkerAfter`. If a key is missing, the
    original behavior applies: markers on, with the original text. Existing
    users therefore see no change until they edit the setting.
  - An empty box skips that marker.
  - With markers off, the AI text is still set off by a blank line (a new
    paragraph), as before. Only the marker lines disappear.
  - The old `formatOutput()` was replaced by `getOutputWrappers(mode)`. It
    returns the text to put before and after the AI output for each cursor
    position: empty document, start, end, or middle.

### 2. Bug fix: AI text landed after the closing marker

- **Problem:** at the start or in the middle of a document, the app inserted
  the whole wrapper first: opening marker, blank, closing marker. It then
  moved the insertion point past all of it. The AI text therefore streamed in
  *after* "End of generated content above", not between the markers. At the
  end of a document there is no closing marker, so that common case was not
  affected.
- **How:**
  - The opening text is inserted and the insertion point moves past it.
  - The closing text is inserted *after* the insertion point, without moving
    it.
  - Streamed chunks then land between the two markers.

**Check:** with a model selected, put the cursor in the middle of a paragraph
and generate. The AI text should sit between the two markers. Then uncheck the
setting, save, and generate at the end of the text. Only a blank line should
separate the AI text from yours.

---

## 2026-10-22: Sidebar toggle, zen mode, status bar, shortcuts, file reveal

**Commit:** `99ed60b`. **Files:** `app/templates/index.html`,
`app/static/script.js`, `app/static/style.css`. The icons are inline SVGs from
Lucide (ISC license).

### 1. Collapsible sidebar

- **Why:** the sidebar always took 30% of the window, even while you write.
- **How:**
  - A panel icon sits to the left of the title. A new `.title-row` wraps the
    toggle and the title input. **⌘\\** (Ctrl+\\) also toggles the sidebar.
  - A `sidebar-collapsed` class on `body` sets the sidebar's width and side
    padding to 0, with a short width transition.
  - The writing area changed from `width: 70%` to `flex: 1`, so it fills the
    freed space.
  - The state is saved in `localStorage` (`sjb_sidebar_collapsed`) and restored
    on load.

### 2. Zen mode

- **Why:** a distraction-free space to write or read.
- **How:**
  - A toolbar button (next to the preview eye), or **⌘⇧F**, adds a `zen` class
    to `body`.
  - That class hides the sidebar, formatting bar, AI dock, status bar, and
    sidebar toggle. It centers the title and lets the writing area take the
    full window height.
  - **Esc** exits. So does a faint button in the top-right corner, which
    appears only in zen and brightens on hover.
  - Zen combines with preview (⌘E) for a clean reading view.
  - Zen is not remembered: every session starts in normal view.

### 3. Status bar

- **Why:** the document stats shared a row with the AI buttons, and nothing
  showed whether the file was saved.
- **How:**
  - A 26 px bar spans the bottom of the window. The main layout height
    became `100vh − --statusbar-h`.
  - **Left side:** "Project › File title", then the save state:
    - "Unsaved" (accent color) while there are unsaved changes.
    - "Saved · just now / 45s ago / 3 min ago / 2:14 PM" after a save from
      this session.
    - "Saved" right after opening a file.
  - **Right side:** words, reading time (words ÷ 230, rounded, at least
    1 min), and the context meter.
  - **Context meter:** it now reads "1,473 / 128,000 tokens", with a small
    CSS dot instead of the 🟢🟡🔴 emoji. The dot is green, amber above 70%,
    and red above 90%, set through a `data-level` attribute.
  - **Updates:** the bar updates on every word-count update and every 2
    seconds. The timer keeps "x min ago" current and also catches title edits.
  - **Kept IDs:** the old `.footer-status` wrapper was removed, but the
    `#wordCount` and `#tokenMeter` elements kept their IDs, so existing code
    still finds them.

### 4. Keyboard shortcuts

These use ⌘ on Mac and Ctrl elsewhere, through one shared `keydown` listener:

- **⌘S** saves the current file and blocks the browser's "Save page" dialog.
- **⌘Enter** generates, unless a generation is already running.
- **Esc** stops a running generation. If nothing is running, it leaves zen.
- **⌘E** (preview), **⌘\\** (sidebar), and **⌘⇧F** (zen) are as above.
- Shortcuts are ignored while the Settings window is open.
- The tooltips on the new buttons show their shortcuts.

### 5. The open file is always visible in the sidebar

- **Why:** when the app reopened the last file at startup, the file's folder
  could be collapsed. Nothing in the sidebar then showed which file was open.
- **How:**
  - After a file opens, a new `revealActiveFile()` walks that section's
    folder tree.
  - It expands every collapsed folder that contains the file, and saves that
    through the existing `/update_folder_state` route, the same as a manual
    click.
  - It then re-renders and scrolls the highlighted row into view.
  - Startup restore goes through the same `openFile()` path, so both cases
    are covered.

**Check:**

1. Reload the app. The open file's folder should be expanded and the file
   highlighted.
2. Type something. The status bar should show "Unsaved". Press ⌘S, and it
   should change to "Saved · just now".
3. Press ⌘\\ twice, then ⌘⇧F, then Esc.

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
