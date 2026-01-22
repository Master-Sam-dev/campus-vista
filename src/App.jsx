import { Routes, Route } from "react-router-dom";
import LandingPage from "./components/LandingPage";
import ThreeDViewer from "./components/ThreeDViewer";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/viewer" element={<ThreeDViewer />} />
    </Routes>
  );
}
