import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRes = path.join(root, "src-tauri", "icons", "android");
const targetRes = path.join(
  root,
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "res",
);
const manifestPath = path.join(
  root,
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "AndroidManifest.xml",
);
const mainActivityPath = path.join(
  root,
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "java",
  "com",
  "zhaxideler",
  "torder",
  "MainActivity.kt",
);
const keyringPath = path.join(
  root,
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "java",
  "io",
  "crates",
  "keyring",
  "Keyring.kt",
);

const keyringSource = `package io.crates.keyring

import android.content.Context

class Keyring {
  companion object {
    init {
      System.loadLibrary("torder_lib")
    }

    external fun initializeNdkContext(context: Context)
  }
}
`;

function log(message) {
  process.stdout.write(`${message}\n`);
}

if (!existsSync(sourceRes)) {
  throw new Error(`Android icon source not found: ${sourceRes}`);
}

if (!existsSync(targetRes)) {
  log("[sync-android-icons] Android generated project not found, skipped.");
  process.exit(0);
}

let copied = 0;

function copyDirectory(from, to) {
  mkdirSync(to, { recursive: true });

  for (const entry of readdirSync(from)) {
    const sourcePath = path.join(from, entry);
    const targetPath = path.join(to, entry);

    if (statSync(sourcePath).isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }

    copyFileSync(sourcePath, targetPath);
    copied += 1;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setAndroidAttribute(tag, name, value, indent) {
  const attr = `android:${name}`;
  const attrPattern = new RegExp(`${escapeRegExp(attr)}="[^"]*"`);

  if (attrPattern.test(tag)) {
    return tag.replace(attrPattern, `${attr}="${value}"`);
  }

  return tag.replace(/\s*>$/, `\n${indent}${attr}="${value}">`);
}

function patchManifest(manifest) {
  let patched = manifest.replace(/<application\b[^>]*>/s, (tag) => {
    let next = setAndroidAttribute(
      tag,
      "icon",
      "@mipmap/ic_launcher",
      "        ",
    );
    next = setAndroidAttribute(
      next,
      "roundIcon",
      "@mipmap/ic_launcher_round",
      "        ",
    );
    return next;
  });

  patched = patched.replace(
    /<activity\b(?=[^>]*android:name=".MainActivity")[^>]*>/s,
    (tag) => {
      let next = setAndroidAttribute(
        tag,
        "icon",
        "@mipmap/ic_launcher",
        "            ",
      );
      next = setAndroidAttribute(
        next,
        "roundIcon",
        "@mipmap/ic_launcher_round",
        "            ",
      );
      next = setAndroidAttribute(
        next,
        "windowSoftInputMode",
        "adjustResize",
        "            ",
      );
      return next;
    },
  );

  return patched;
}

function patchMainActivity(source) {
  let patched = source;

  if (!patched.includes("import android.view.WindowManager")) {
    patched = patched.replace(
      /(import android\.os\.Bundle\r?\n)/,
      "$1import android.view.WindowManager\n",
    );
  }

  if (!patched.includes("import io.crates.keyring.Keyring")) {
    patched = patched.replace(
      /(import androidx\.activity\.enableEdgeToEdge\r?\n)/,
      "$1import io.crates.keyring.Keyring\n",
    );
  }

  if (!patched.includes("SOFT_INPUT_ADJUST_RESIZE")) {
    patched = patched.replace(
      /( {4}enableEdgeToEdge\(\)\r?\n)/,
      "$1    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)\n",
    );
  }

  if (!patched.includes("Keyring.initializeNdkContext")) {
    patched = patched.replace(
      /( {4}enableEdgeToEdge\(\)\r?\n)/,
      "$1    Keyring.initializeNdkContext(applicationContext)\n",
    );
  }

  if (
    patched.includes("SOFT_INPUT_ADJUST_RESIZE") &&
    !patched.includes('@Suppress("DEPRECATION")')
  ) {
    patched = patched.replace(
      "  override fun onCreate",
      '  @Suppress("DEPRECATION")\n  override fun onCreate',
    );
  }

  return patched;
}

copyDirectory(sourceRes, targetRes);

if (existsSync(manifestPath)) {
  const manifest = readFileSync(manifestPath, "utf8");
  const patched = patchManifest(manifest);

  if (patched !== manifest) {
    writeFileSync(manifestPath, patched);
  }
}

if (existsSync(mainActivityPath)) {
  const activity = readFileSync(mainActivityPath, "utf8");
  const patched = patchMainActivity(activity);

  if (patched !== activity) {
    writeFileSync(mainActivityPath, patched);
  }
}

mkdirSync(path.dirname(keyringPath), { recursive: true });
writeFileSync(keyringPath, keyringSource);

log(`[sync-android-icons] Synced ${copied} Android launcher icon files.`);
