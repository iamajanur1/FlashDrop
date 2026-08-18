import "@/App.css";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import FlashDrop from "@/pages/FlashDrop";
import Landing from "@/pages/Landing";
import { Toaster } from "@/components/ui/sonner";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/app" element={<Navigate to="/app/send" replace />} />
          <Route path="/app/send" element={<FlashDrop defaultTab="send" />} />
          <Route path="/app/receive" element={<FlashDrop defaultTab="receive" />} />
          {/* Backwards compatibility for existing QR/share links. */}
          <Route path="/receive" element={<FlashDrop defaultTab="receive" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" richColors />
    </div>
  );
}

export default App;
