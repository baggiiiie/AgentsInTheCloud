import { inlineDesignSystemCss } from "@atelier/design-system/styles/server";

let runtime: Promise<string> | undefined;
async function runtimeModule(): Promise<string> {
  runtime ??= (async () => {
    const build = await Bun.build({ entrypoints: [new URL("../client/rich-response-runtime.ts", import.meta.url).pathname], target: "browser", format: "esm", minify: true });
    if (!build.success) throw new AggregateError(build.logs, "Could not build rich-response runtime");
    return `data:text/javascript;base64,${Buffer.from(await build.outputs[0]!.text()).toString("base64")}`;
  })();
  return runtime;
}

/** The document is always loaded into an opaque-origin, scripts-only sandbox. */
export async function richResponseDocument(fragment: string): Promise<string> {
  const [design, styles, module] = await Promise.all([
    inlineDesignSystemCss(),
    Bun.file(new URL("../client/rich-response.css", import.meta.url)).text(),
    runtimeModule(),
  ]);
  // Public semantic controls are implemented using the actual design-system classes.
  const enhanced = await new HTMLRewriter()
    .on("button", { element(element) {
      const classes = element.getAttribute("class") ?? "";
      element.setAttribute("class", `${classes} button${classes.split(/\s+/).includes("ar-primary") ? " primary" : ""}`);
      element.setAttribute("type", "button");
    } })
    .on('input:not([type=checkbox]):not([type=radio]):not([type=range]), select', { element(element) { element.setAttribute("class", `${element.getAttribute("class") ?? ""} text-field`); } })
    .on("textarea", { element(element) { element.setAttribute("class", `${element.getAttribute("class") ?? ""} textarea`); } })
    .on("[data-ar-tabs]", { element(element) { element.setAttribute("data-controller", `${element.getAttribute("data-controller") ?? ""} ar-tabs`); } })
    .on("[data-ar-tooltip]", { element(element) { element.setAttribute("data-controller", `${element.getAttribute("data-controller") ?? ""} ar-tooltip`); } })
    .transform(new Response(fragment)).text();
  const csp = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${design}\n${styles}</style><script type="importmap">${JSON.stringify({ imports: { "@atelier/response": module } })}</script><script type="module" src="${module}"></script></head><body class="markdown" data-controller="ar-runtime"><main id="ar-content">${enhanced}</main></body></html>`;
}
