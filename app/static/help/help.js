// Help pages match the app's look: its saved mode and accent color.
// Opened without the app running, they follow the computer's light/dark setting.
(async () => {
  const ACCENTS = ["blue", "indigo", "teal", "crimson", "amber", "violet"];
  let mode = "system";
  let accent = "blue";

  try {
    const appState = (await (await fetch("/load")).json()).app_state || {};
    mode = appState.themeMode || (appState.theme === "dark" ? "dark" : mode);
    if (ACCENTS.includes(appState.accent)) accent = appState.accent;
  } catch (e) {
    // Not served by the app (for example, opened as a file): keep the defaults
  }

  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const dark = mode === "dark" || (mode === "system" && systemDark.matches);
    document.body.classList.toggle("mode-dark", dark);
  };
  ACCENTS.forEach(a => document.body.classList.toggle(`accent-${a}`, a === accent));
  apply();
  systemDark.addEventListener("change", apply);
})();
