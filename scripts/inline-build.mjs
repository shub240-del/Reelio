// Bundle dist/public into ONE self-contained HTML file.
// Assets are embedded as base64 and injected at runtime: base64 uses only
// [A-Za-z0-9+/=], so the payload can never contain "</script>" or "<!--" and
// therefore can never terminate the script element early (the bug that made
// earlier builds render the bundle as visible body text).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "dist/public";
const out = process.argv[3] ?? "dist/single.html";

const assetDir = join(dir, "assets");
const names = readdirSync(assetDir);
const cssName = names.find((f) => f.endsWith(".css"));
const jsName = names.find((f) => f.endsWith(".js"));
if (!cssName || !jsName) throw new Error(`missing css/js in ${assetDir}: ${names}`);

const cssB64 = readFileSync(join(assetDir, cssName)).toString("base64");
const jsB64 = readFileSync(join(assetDir, jsName)).toString("base64");

let html = readFileSync(join(dir, "index.html"), "utf8");

// Remove the emitted asset tags by exact-substring surgery (no regex).
function dropTag(source, needle) {
  const at = source.indexOf(needle);
  if (at === -1) throw new Error(`tag referencing ${needle} not found`);
  const start = source.lastIndexOf("<", at);
  const end = source.indexOf(">", at) + 1;
  return source.slice(0, start) + source.slice(end);
}
html = dropTag(html, `/assets/${cssName}`);
html = dropTag(html, `/assets/${jsName}`);

const loader = `<script>(function(){
function bytes(b64){var bin=atob(b64),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u}
var st=document.createElement("style");st.textContent=new TextDecoder().decode(bytes("${cssB64}"));document.head.appendChild(st);
var url=URL.createObjectURL(new Blob([bytes("${jsB64}")],{type:"text/javascript"}));
var sc=document.createElement("script");sc.type="module";sc.src=url;document.body.appendChild(sc);
})();</script>`;

html = html.replace("</body>", loader + "</body>");

// Offline self-checks: fail loudly rather than publishing a broken page.
const problems = [];
if (html.includes("/assets/")) problems.push("leftover /assets/ reference");
if (!html.includes("createObjectURL")) problems.push("loader not injected");
const scriptOpens = (html.match(/<script/g) || []).length;
const scriptCloses = (html.match(/<\/script>/g) || []).length;
if (scriptOpens !== scriptCloses) problems.push(`unbalanced script tags ${scriptOpens}/${scriptCloses}`);
if (problems.length) throw new Error("inline-build failed: " + problems.join("; "));

writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} kB), script tags ${scriptOpens}, css ${cssName}, js ${jsName}`);
