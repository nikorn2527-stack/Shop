import { createRoot } from "react-dom/client";

// Load the business app once, inside the persistent same-origin display surface.
// The outer host never creates auth queries, changes the database or applies font zoom.
if (window.parent !== window && window.name === "shop-workspace") {
  void import("./appRuntime");
} else {
  void import("./components/WorkspaceViewport").then(
    ({ WorkspaceViewport }) => {
      createRoot(document.getElementById("root")!).render(
        <WorkspaceViewport />
      );
    }
  );
}
