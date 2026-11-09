/**
 * Scalar renders /docs from its own theme variables. These overrides map them
 * onto the MakiSend design tokens so the reference follows the dashboard in
 * both light and dark mode.
 */
export const SCALAR_CUSTOM_CSS = `
.light-mode {
  --scalar-background-1: #ffffff;
  --scalar-background-2: #f5f5f5;
  --scalar-background-3: #ebebeb;
  --scalar-background-accent: #e3efe9;
  --scalar-color-1: #151515;
  --scalar-color-2: #5e5e5e;
  --scalar-color-3: #6e6e6e;
  --scalar-color-accent: #0f6b4f;
  --scalar-border-color: #ebebeb;
  --scalar-button-1: #151515;
  --scalar-button-1-color: #ffffff;
  --scalar-button-1-hover: #2c2c2c;
}

.dark-mode {
  --scalar-background-1: #1b1b1b;
  --scalar-background-2: #222222;
  --scalar-background-3: #2c2c2c;
  --scalar-background-accent: rgb(83 220 166 / 0.14);
  --scalar-color-1: #f3f3f3;
  --scalar-color-2: #b9b9b9;
  --scalar-color-3: #8a8a8a;
  --scalar-color-accent: #53dca6;
  --scalar-border-color: #333333;
  --scalar-button-1: #f3f3f3;
  --scalar-button-1-color: #1b1b1b;
  --scalar-button-1-hover: #d9d9d9;
}

.light-mode .sidebar,
.dark-mode .sidebar {
  --scalar-sidebar-item-hover-color: var(--scalar-color-accent);
  --scalar-sidebar-item-active-background: var(--scalar-background-accent);
  --scalar-sidebar-color-active: var(--scalar-color-accent);
}
`;
