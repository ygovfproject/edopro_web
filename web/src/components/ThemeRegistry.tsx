"use client";

import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#f5c518", contrastText: "#1a1a1a" },
    secondary: { main: "#ffd54f", contrastText: "#1a1a1a" },
    background: { default: "#161616", paper: "#222222" },
    success: { main: "#5ccf8a" },
    error: { main: "#ff6b6b" },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTooltip: { defaultProps: { arrow: true } },
    // Scrollbars in the app's grey/yellow style, everywhere.
    MuiCssBaseline: {
      styleOverrides: {
        "*": { scrollbarWidth: "thin", scrollbarColor: "#4a4a4a transparent" },
        "*:hover": { scrollbarColor: "#6a6a6a transparent" },
        "*::-webkit-scrollbar": { width: 8, height: 8 },
        "*::-webkit-scrollbar-track": { background: "transparent" },
        "*::-webkit-scrollbar-thumb": { background: "#4a4a4a", borderRadius: 8, border: "2px solid transparent", backgroundClip: "padding-box" },
        "*::-webkit-scrollbar-thumb:hover": { background: "#f5c518", backgroundClip: "padding-box" },
        "*::-webkit-scrollbar-corner": { background: "transparent" },
      },
    },
  },
});

export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
