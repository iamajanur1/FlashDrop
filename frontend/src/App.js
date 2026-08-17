import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import FlashDrop from "@/pages/FlashDrop";
import Landing from "@/pages/Landing";
import { Toaster } from "@/components/ui/sonner";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/app" element={<FlashDrop />} />
          <Route path="/receive" element={<FlashDrop defaultTab="receive" />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" richColors />
    </div>
  );
}

export default App;
