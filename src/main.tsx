import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

// Side-effect import: initializes i18next with language detection (localStorage
// 'irium_language' -> browser navigator -> fallback to English) and registers
// the react-i18next bindings used by t()/useTranslation() across the app.
import "./i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
