import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "node_modules", "dist", "build"]);
const htmlFiles = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) walk(join(directory, entry.name));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".html") {
      htmlFiles.push(join(directory, entry.name));
    }
  }
}

function stripQueryAndHash(value) {
  return value.split(/[?#]/, 1)[0];
}

walk(root);
let errors = 0;

for (const file of htmlFiles) {
  const relativeFile = file.slice(root.length + 1);
  const source = readFileSync(file, "utf8");
  const markup = source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const ids = new Set();

  for (const tag of markup.matchAll(/<[a-z][^>]*>/gi)) {
    for (const match of tag[0].matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)) {
      const id = match[2].trim();
      if (!id) continue;
      if (ids.has(id)) {
        console.error(`Duplicate id "${id}" in ${relativeFile}`);
        errors++;
      }
      ids.add(id);
    }

    for (const match of tag[0].matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)) {
      const raw = match[2].trim();
      if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) continue;
      const localPath = stripQueryAndHash(raw);
      if (!localPath) continue;

      let decodedPath;
      try {
        decodedPath = decodeURIComponent(localPath);
      } catch {
        console.error(`Invalid URL encoding in ${relativeFile}: ${raw}`);
        errors++;
        continue;
      }

      const target = decodedPath.startsWith("/")
        ? resolve(root, `.${decodedPath}`)
        : resolve(dirname(file), decodedPath);
      const insideRoot = target === root || target.startsWith(root + sep);
      if (!insideRoot || !existsSync(target)) {
        console.error(`Missing local asset in ${relativeFile}: ${raw}`);
        errors++;
      }
    }
  }
}

if (errors) {
  console.error(`HTML validation failed with ${errors} issue(s).`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${htmlFiles.length} HTML file(s): no duplicate IDs or missing local assets.`);
}
