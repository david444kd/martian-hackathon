// Three separate products on one codebase, each at its own address:
//   /dispatch          Mission Control (dispatcher's admin)
//   /ship/:crewId      Ship Console (the crew's window on the ship)
//   /helmet/:crewId    EVA Helmet (Meta Quest 2)
import { lazy, Suspense } from "react";
import { Link, Navigate, Route, Routes } from "react-router";
import { Globe2, HardHat, Ship as ShipIcon } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { configError } from "./lib/db";

// each product loads only its own code
const Dispatch = lazy(() => import("./pages/Dispatch").then((m) => ({ default: m.Dispatch })));
const Ship = lazy(() => import("./pages/Ship").then((m) => ({ default: m.Ship })));
const ShipPicker = lazy(() => import("./pages/Ship").then((m) => ({ default: m.ShipPicker })));
const Helmet = lazy(() => import("./pages/Helmet").then((m) => ({ default: m.Helmet })));
const HelmetPicker = lazy(() => import("./pages/Helmet").then((m) => ({ default: m.HelmetPicker })));

export function App() {
  return (
    <>
      {configError && (
        <div className="fixed inset-x-0 top-0 z-[2000] bg-destructive px-4 py-2 text-center text-sm text-white">{configError}</div>
      )}
      <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">Loading…</div>}>
      <Routes>
        <Route index element={<Launcher />} />
        <Route path="dispatch" element={<Dispatch />} />
        <Route path="ship" element={<ShipPicker />} />
        <Route path="ship/:crewId" element={<Ship />} />
        <Route path="helmet" element={<HelmetPicker />} />
        <Route path="helmet/:crewId" element={<Helmet />} />
        <Route path="astronaut/*" element={<Navigate to="/helmet" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </>
  );
}

const PRODUCTS = [
  { to: "/dispatch", icon: Globe2, name: "Mission Control", text: "The dispatcher's console: crews on the Mars globe, their work plans." },
  { to: "/ship", icon: ShipIcon, name: "Ship Console", text: "The crew's window on the ship: plans on the map, safe routes, EVA control." },
  { to: "/helmet", icon: HardHat, name: "EVA Helmet", text: "Meta Quest 2: the active route on the surface, hands-free." },
];

function Launcher() {
  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col justify-center gap-8 overflow-auto p-6">
      <div>
        <div className="text-xs font-semibold tracking-[0.25em] text-muted-foreground uppercase">Mars Ops</div>
        <h1 className="mt-1 font-heading text-3xl font-semibold">Surface operations suite</h1>
        <p className="mt-1 text-muted-foreground">Three applications sharing one live mission database.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {PRODUCTS.map(({ to, icon: Icon, name, text }) => (
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
