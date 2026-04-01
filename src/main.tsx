import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Hide the boot loader once React has mounted
const loader = document.getElementById('boot-loader');
if (loader) {
  loader.classList.add('hide');
  setTimeout(() => loader.remove(), 300);
}
