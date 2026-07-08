import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { configureDiffLanguages } from "./languages";
import { WorkerPoolProvider } from "./workerPool";
import "./styles.css";

configureDiffLanguages();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WorkerPoolProvider>
      <App />
    </WorkerPoolProvider>
  </React.StrictMode>,
);
