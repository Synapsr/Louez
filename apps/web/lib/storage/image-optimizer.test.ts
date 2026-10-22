import assert from "node:assert/strict";
import test from "node:test";
import { canOptimizeImage, storageImageRemotePattern } from "./image-optimizer";

test("the remote pattern covers only the configured bucket", () => {
  assert.deepEqual(storageImageRemotePattern("https://louez-uploads.s3.fr-par.scw.cloud"), {
    protocol: "https",
    hostname: "louez-uploads.s3.fr-par.scw.cloud",
    port: "",
    pathname: "/**",
  });
  assert.deepEqual(storageImageRemotePattern("http://minio.local:9000/louez/"), {
    protocol: "http",
    hostname: "minio.local",
    port: "9000",
    pathname: "/louez/**",
  });
});

test("same-origin or invalid storage bases add no remote pattern", () => {
  assert.equal(storageImageRemotePattern("/files"), null);
  assert.equal(storageImageRemotePattern(undefined), null);
  assert.equal(storageImageRemotePattern("ftp://bucket.example.com"), null);
  assert.equal(storageImageRemotePattern("not a url"), null);
});

test("only same-origin paths and the build-time bucket are optimized", () => {
  const previous = process.env.LOUEZ_OPTIMIZED_STORAGE_URL;
  process.env.LOUEZ_OPTIMIZED_STORAGE_URL = "https://s3.fr-par.scw.cloud/louez-uploads";

  try {
    assert.equal(canOptimizeImage("/files/stores/logo.png"), true);
    assert.equal(canOptimizeImage("https://s3.fr-par.scw.cloud/louez-uploads/a.png"), true);
    assert.equal(canOptimizeImage("https://s3.fr-par.scw.cloud/attacker/a.png"), false);
    assert.equal(canOptimizeImage("https://s3.fr-par.scw.cloud/louez-uploads-evil/a.png"), false);
    assert.equal(canOptimizeImage("https://other.example.com/louez-uploads/a.png"), false);
    assert.equal(canOptimizeImage("//evil.example.com/a.png"), false);
    assert.equal(canOptimizeImage(""), false);

    delete process.env.LOUEZ_OPTIMIZED_STORAGE_URL;
    assert.equal(canOptimizeImage("https://s3.fr-par.scw.cloud/louez-uploads/a.png"), false);
    assert.equal(canOptimizeImage("/files/a.png"), true);
  } finally {
    if (previous === undefined) delete process.env.LOUEZ_OPTIMIZED_STORAGE_URL;
    else process.env.LOUEZ_OPTIMIZED_STORAGE_URL = previous;
  }
});
