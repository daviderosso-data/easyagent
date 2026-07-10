import { writeProjectFile } from "@/server/projects";
import { join } from "node:path";
import { TEMPLATE_IDS, type TemplateId } from "@/lib/templates";

interface TemplateFile {
  path: string;
  content: string;
}

// Lightweight starter scaffolds — just files to build on, no installs. `{name}`
// is replaced with the project's display name.
const TEMPLATES: Record<TemplateId, TemplateFile[]> = {
  empty: [{ path: "README.md", content: "# {name}\n" }],
  web: [
    {
      path: "index.html",
      content:
        '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>{name}</title>\n    <link rel="stylesheet" href="styles.css" />\n  </head>\n  <body>\n    <h1>{name}</h1>\n    <p>Edit index.html to get started.</p>\n    <script src="script.js"></script>\n  </body>\n</html>\n',
    },
    { path: "styles.css", content: "body {\n  font-family: system-ui, sans-serif;\n  margin: 2rem;\n}\n" },
    { path: "script.js", content: "console.log('{name} ready');\n" },
    { path: "README.md", content: "# {name}\n\nA static website. Open index.html in your browser.\n" },
  ],
  node: [
    {
      path: "package.json",
      content:
        '{\n  "name": "{slug}",\n  "version": "0.1.0",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "start": "node index.js"\n  }\n}\n',
    },
    { path: "index.js", content: "console.log('Hello from {name}');\n" },
    { path: "README.md", content: "# {name}\n\n```bash\nnpm start\n```\n" },
  ],
  python: [
    {
      path: "main.py",
      content: 'def main():\n    print("Hello from {name}")\n\n\nif __name__ == "__main__":\n    main()\n',
    },
    { path: "requirements.txt", content: "" },
    { path: "README.md", content: "# {name}\n\n```bash\npython main.py\n```\n" },
  ],
};

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 40) || "project"
  );
}

export function isTemplateId(id: unknown): id is TemplateId {
  return typeof id === "string" && (TEMPLATE_IDS as readonly string[]).includes(id);
}

/** Write a template's starter files into a freshly created project folder.
 *  Each write is confined by writeProjectFile. Best-effort per file. */
export function scaffoldTemplate(projectPath: string, projectName: string, id: TemplateId): void {
  const files = TEMPLATES[id] ?? [];
  const slug = slugify(projectName);
  for (const f of files) {
    const content = f.content.replaceAll("{name}", projectName).replaceAll("{slug}", slug);
    writeProjectFile(join(projectPath, f.path), content);
  }
}
