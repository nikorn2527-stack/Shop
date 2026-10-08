import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BlockerAlert } from "@/components/BlockerAlert";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          {/* ROUND 37 (req 35) — ส่วนแจ้งเตือน: toast เด้งมุมขวาล่าง เหนือแผงสินค้า
              ไม่บังปุ่มชำระเงิน (อยู่ซ้าย) และเลื่อนพ้นแถบช่วยเหลือด้านล่าง */}
          <Toaster position="top-right" offset={18} gap={9} visibleToasts={3} closeButton duration={4000} />
          {/* ROUND 78 (user) — กล่องแจ้งเตือนกลางจอสำหรับเหตุที่ทำงานต่อไม่ได้
              (สต็อกไม่พอ · เงินไม่พอ · บัตรถูกระงับ · ชำระเงินไม่สำเร็จ)
              toast มุมขวาล่างผู้ใช้มองไม่เห็น — ต้องขึ้นกลางจอให้ชัด */}
          <BlockerAlert />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
