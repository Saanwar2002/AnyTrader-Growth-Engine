import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import CloudWorkspace from "./CloudWorkspace";
import { firebaseClient } from "./firebaseClient";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root was not found.");

const Application = firebaseClient ? CloudWorkspace : App;
createRoot(rootElement).render(<StrictMode><Application /></StrictMode>);

