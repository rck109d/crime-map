import { effect } from "@preact/signals";
import { render } from "preact";
import { App } from "./app";
import { start, theme } from "./state";
import "./styles.css";

effect(() => {
  document.documentElement.dataset.theme = theme.value;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme.value === "dark" ? "#1a1a19" : "#fcfcfb");
});

render(<App />, document.getElementById("app")!);
void start();
