import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./i18n";
import "leaflet/dist/leaflet.css";
import "./index.css";
import { App } from "./App";
import { RealtimeSync } from "./lib/realtime";
import { Toaster } from "@/components/ui/sonner";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RealtimeSync />
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toaster position="bottom-center" />
    </QueryClientProvider>
  </StrictMode>,
);
