// Three separate products on one codebase, each at its own address:
//   /dispatch          Mission Control (dispatcher's admin)
//   /ship/:crewId      Ship Console (the crew's window on the ship)
//   /helmet/:crewId    EVA Helmet (Meta Quest 2)
//   /demo              Demo remote (a phone): one button that raises a dust storm
import { lazy, Suspense } from "react";
import { Link, Navigate, Route, Routes } from "react-router";
import { useTranslation } from "react-i18next";
import { Globe2, HardHat, Ship as ShipIcon } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { configError } from "./lib/db";
import { LanguageSwitcher } from "./components/LanguageSwitcher";

// each product loads only its own code
const Dispatch = lazy(() => import("./pages/Dispatch").then((m) => ({ default: m.Dispatch })));
const Ship = lazy(() => import("./pages/Ship").then((m) => ({ default: m.Ship })));
const ShipPicker = lazy(() => import("./pages/Ship").then((m) => ({ default: m.ShipPicker })));
const Helmet = lazy(() => import("./pages/Helmet").then((m) => ({ default: m.Helmet })));
const HelmetPicker = lazy(() => import("./pages/Helmet").then((m) => ({ default: m.HelmetPicker })));
const Demo = lazy(() => import("./pages/Demo").then((m) => ({ default: m.Demo })));

export function App() {
  const { t } = useTranslation();
  return (
    <>
      {configError && (
        <div className="fixed inset-x-0 top-0 z-[2000] bg-destructive px-4 py-2 text-center text-sm text-white">{t("common.config_error")}</div>
      )}
      <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">{t("common.loading")}</div>}>
      <Routes>
        <Route index element={<Launcher />} />
        <Route path="dispatch" element={<Dispatch />} />
        <Route path="ship" element={<ShipPicker />} />
        <Route path="ship/:crewId" element={<Ship />} />
        <Route path="helmet" element={<HelmetPicker />} />
        <Route path="helmet/:crewId" element={<Helmet />} />
        <Route path="demo" element={<Demo />} />
        <Route path="astronaut/*" element={<Navigate to="/helmet" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  );
}

function Launcher() {
  const { t } = useTranslation();

  const products = [
    { to: "/dispatch", icon: Globe2, name: t("launcher.dispatchTitle"), text: t("launcher.dispatchDesc") },
    { to: "/ship", icon: ShipIcon, name: t("launcher.shipTitle"), text: t("launcher.shipDesc") },
    { to: "/helmet", icon: HardHat, name: t("launcher.helmetTitle"), text: t("launcher.helmetDesc") },
  ];

  return (
    <div className="relative mx-auto flex h-full max-w-4xl flex-col justify-center gap-8 overflow-auto p-6">
      <div className="absolute top-6 right-6">
        <LanguageSwitcher />
      </div>
      <div>
        <div className="text-xs font-semibold tracking-[0.25em] text-muted-foreground uppercase">{t("common.appName")}</div>
        <h1 className="mt-1 font-heading text-3xl font-semibold">{t("launcher.tagline")}</h1>
        <p className="mt-1 text-muted-foreground">{t("launcher.subtitle")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {products.map(({ to, icon: Icon, name, text }) => (
          <Link key={to} to={to} className="group">
            <Card className="h-full transition-colors group-hover:ring-primary/60">
              <CardHeader>
                <div className="mb-2 grid size-10 place-items-center rounded-xl bg-primary/15 text-primary"><Icon className="size-5" /></div>
                <CardTitle className="text-lg">{name}</CardTitle>
                <CardDescription>{text}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
