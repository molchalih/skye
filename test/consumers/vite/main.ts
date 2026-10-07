// All an app needs: the side-effect entry defines <skye-view>; the bundler finds and emits the worker itself.
import "skye/define";
// An app that ships its own worker module points the `worker` attribute at it.
// oxlint-disable-next-line import/default -- Vite answers the `?worker&url` query with the bundled worker's URL
import customWorker from "./custom-worker.ts?worker&url";

document.getElementById("custom")?.setAttribute("worker", customWorker);
