import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the branded voxel landscape entry", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]+lang="zh-CN"/i);
  assert.match(html, /<title>云岫 · 体素山水<\/title>/i);
  assert.match(html, /VOXEL LANDSCAPE · 01/);
  assert.match(html, /山从雾里醒来，水向云外落去。/);
  assert.match(html, /scene-root/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|SkeletonPreview/);
});

test("keeps the requested scene systems in the production source", async () => {
  const [sceneSource, pageSource, packageJson] = await Promise.all([
    readFile(new URL("../app/VoxelLandscape.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"three": "0\.180\.0"/);
  assert.match(sceneSource, /new THREE\.InstancedMesh/);
  assert.match(sceneSource, /createHeightGrid/);
  assert.match(sceneSource, /carveChannel/);
  assert.match(sceneSource, /buildWater/);
  assert.match(sceneSource, /buildClouds/);
  assert.match(sceneSource, /buildVegetation/);
  assert.match(sceneSource, /OrbitControls/);
  assert.match(sceneSource, /__VOXEL_SCENE_METRICS__/);
  assert.match(pageSource, /暂停自动巡游/);
  assert.match(pageSource, /fps-counter/);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});

test("ships a valid wide social preview image", async () => {
  const image = await readFile(new URL("../public/og.png", import.meta.url));
  assert.ok(image.length > 100_000, "social preview should be a real rendered image");
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  assert.equal(width, 1732);
  assert.equal(height, 908);
  assert.ok(width / height > 1.9 && width / height < 1.92);
});

test("project root remains addressable", async () => {
  await access(projectRoot);
});
