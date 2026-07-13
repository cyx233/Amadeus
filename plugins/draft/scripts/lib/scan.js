#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

function getDirs(subdir) {
  const dir = path.join(os.homedir(), ".claude", subdir);
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? [dir] : [];
}

function parseScript(filePath, content) {
  const lines = content.split(/\r?\n/);
  let name = "", description = "";
  for (const line of lines) {
    if (line.startsWith("# @name ")) { name = line.slice(8); continue; }
    if (line.startsWith("# @description ")) { description = line.slice(15); continue; }
    if (!line.startsWith("#")) break;
  }
  return name ? { name, path: filePath, description } : null;
}

function parseNote(filePath, content) {
  const lines = content.split(/\r?\n/);
  let name = "", description = "", inside = false;
  for (const line of lines) {
    if (line === "---") { if (inside) break; inside = true; continue; }
    if (inside) {
      if (line.startsWith("name: ")) name = line.slice(6);
      else if (line.startsWith("description: ")) description = line.slice(13);
    }
  }
  return name ? { name, path: filePath, description } : null;
}

function scanScripts() {
  const results = [];
  for (const dir of getDirs("scripts")) {
    for (const entry of fs.readdirSync(dir)) {
      const fp = path.join(dir, entry);
      if (!fs.statSync(fp).isFile()) continue;
      const content = fs.readFileSync(fp, "utf8");
      if (!content.slice(0, 300).includes("@draft")) continue;
      const parsed = parseScript(fp, content);
      if (parsed) results.push(parsed);
    }
  }
  return results;
}

function scanNotes() {
  const results = [];
  for (const dir of getDirs("notes")) {
    for (const entry of fs.readdirSync(dir)) {
      const fp = path.join(dir, entry);
      if (!fs.statSync(fp).isFile()) continue;
      const content = fs.readFileSync(fp, "utf8");
      if (!content.slice(0, 300).includes("draft: note")) continue;
      const parsed = parseNote(fp, content);
      if (parsed) results.push(parsed);
    }
  }
  return results;
}

const mode = process.argv[2] || "scripts";

switch (mode) {
  case "--all":
    for (const s of scanScripts()) process.stdout.write(`script\t${s.name}\t${s.path}\t${s.description}\n`);
    for (const n of scanNotes()) process.stdout.write(`note\t${n.name}\t${n.path}\t${n.description}\n`);
    break;
  case "--find": {
    const t = process.argv[3] || "";
    for (const s of scanScripts()) { if (s.name === t) { process.stdout.write(s.path + "\n"); process.exit(0); } }
    process.exit(1);
  }
  case "--find-note": {
    const t = process.argv[3] || "";
    for (const n of scanNotes()) { if (n.name === t) { process.stdout.write(n.path + "\n"); process.exit(0); } }
    process.exit(1);
  }
  case "--find-any": {
    const t = process.argv[3] || "";
    for (const s of scanScripts()) { if (s.name === t) { process.stdout.write(`script\t${s.path}\n`); process.exit(0); } }
    for (const n of scanNotes()) { if (n.name === t) { process.stdout.write(`note\t${n.path}\n`); process.exit(0); } }
    process.exit(1);
  }
  default:
    for (const s of scanScripts()) process.stdout.write(`${s.name}\t${s.path}\t${s.description}\n`);
    break;
}
