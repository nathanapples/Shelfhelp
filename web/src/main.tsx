import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "@fontsource-variable/inter";
import "./index.css";
import { api, type Status } from "./lib/api";
import { ToastProvider } from "./components/toast";
import { Layout } from "./components/Layout";
import { LoadingBlock } from "./components/ui";
import ListsPage from "./pages/Lists";
import ListDetailPage from "./pages/ListDetail";
import ReviewPage from "./pages/Review";
import MissingPage from "./pages/Missing";
import SearchPage from "./pages/Search";
import SettingsPage from "./pages/Settings";
import LoginPage from "./pages/Login";

function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const load = useCallback(() => api<Status>("/status").then(setStatus).catch(() => setTimeout(load, 3000)), []);

  useEffect(() => {
    load();
    const out = () => load();
    window.addEventListener("shelfhelper:signedout", out);
    return () => window.removeEventListener("shelfhelper:signedout", out);
  }, [load]);

  if (!status) return <LoadingBlock />;
  if (status.authRequired && !status.signedIn) return <LoginPage onSignedIn={load} />;

  return (
    <Layout version={status.version} authRequired={status.authRequired}>
      <Routes>
        <Route path="/" element={<ListsPage status={status} />} />
        <Route path="/lists/:id" element={<ListDetailPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/missing" element={<MissingPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/activity" element={<Navigate to="/settings?tab=activity" replace />} />
        <Route path="/settings" element={<SettingsPage status={status} onSaved={load} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
