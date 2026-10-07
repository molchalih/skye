import { defineSkye } from "./element/define.ts";

// Without a DOM (server rendering) there is nothing to define.
if (typeof customElements !== "undefined") defineSkye();
