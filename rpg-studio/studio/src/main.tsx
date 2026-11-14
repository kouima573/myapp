import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { detectSource } from "./lib/source";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App source={detectSource()} /></StrictMode>);
