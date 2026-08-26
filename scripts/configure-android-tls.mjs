import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const androidRoot = path.join(repoRoot, "src-tauri", "gen", "android");
const rootBuildFile = path.join(androidRoot, "build.gradle.kts");
const appBuildFile = path.join(androidRoot, "app", "build.gradle.kts");

if (!existsSync(rootBuildFile) || !existsSync(appBuildFile)) {
  throw new Error(
    "Android project is missing; run `pnpm tauri android init` before building",
  );
}

const cargoManifest = path.join(repoRoot, "src-tauri", "Cargo.toml");
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--filter-platform",
      "aarch64-linux-android",
      "--manifest-path",
      cargoManifest,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ),
);
const androidSupport = metadata.packages.find(
  (item) => item.name === "rustls-platform-verifier-android",
);
if (!androidSupport) {
  throw new Error(
    "rustls-platform-verifier Android support package is missing",
  );
}

const mavenDirectory = path.join(
  path.dirname(androidSupport.manifest_path),
  "maven",
);
const kotlinMavenDirectory = mavenDirectory.replaceAll("\\", "\\\\");
const repositoryBlock = `        // TORDER_RUSTLS_REPOSITORY_START
        maven {
            url = uri("${kotlinMavenDirectory}")
            metadataSources {
                mavenPom()
                artifact()
            }
        }
        // TORDER_RUSTLS_REPOSITORY_END`;

let rootBuild = readFileSync(rootBuildFile, "utf8");
rootBuild = rootBuild.replace(
  /\s*\/\/ TORDER_RUSTLS_REPOSITORY_START[\s\S]*?\/\/ TORDER_RUSTLS_REPOSITORY_END/g,
  "",
);
const repositoriesAnchor =
  /(allprojects\s*\{\s*repositories\s*\{\s*google\(\)\s*mavenCentral\(\))/;
if (!repositoriesAnchor.test(rootBuild)) {
  throw new Error("Unable to locate Android repository configuration");
}
rootBuild = rootBuild.replace(repositoriesAnchor, `$1\n${repositoryBlock}`);
writeFileSync(rootBuildFile, rootBuild);

const dependency = `implementation("rustls:rustls-platform-verifier:${androidSupport.version}")`;
let appBuild = readFileSync(appBuildFile, "utf8");
if (!appBuild.includes(dependency)) {
  const dependenciesAnchor = "dependencies {";
  if (!appBuild.includes(dependenciesAnchor)) {
    throw new Error("Unable to locate Android dependency configuration");
  }
  appBuild = appBuild.replace(
    dependenciesAnchor,
    `${dependenciesAnchor}\n    ${dependency}`,
  );
  writeFileSync(appBuildFile, appBuild);
}

writeFileSync(
  path.join(androidRoot, "app", "rustls-platform-verifier.pro"),
  "-keep, includedescriptorclasses class org.rustls.platformverifier.** { *; }\n",
);

process.stdout.write("Android TLS verifier support configured\n");
