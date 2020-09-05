import errorImageSrc from "!!url-loader!../assets/images/media-error.gif";
import { promisifyWorker } from "../utils/promisify-worker.js";
import GIFWorker from "../workers/gifparsing.worker.js";
import { createImageTexture, createBasisTexture, resolveUrl, getDefaultResolveQuality } from "../utils/media-utils";
import { guessContentType, proxiedUrlFor, isNonCorsProxyDomain } from "../utils/media-url-utils.js";

function disposeTexture(texture) {
  if (texture.image instanceof HTMLVideoElement) {
    const video = texture.image;
    video.pause();
    video.src = "";
    video.load();
  }

  if (texture.hls) {
    texture.hls.stopLoad();
    texture.hls.detachMedia();
    texture.hls.destroy();
    texture.hls = null;
  }

  if (texture.dash) {
    texture.dash.reset();
  }

  texture.dispose();
}

class TextureCache {
  cache = new Map();

  key(src, version) {
    return `${src}_${version}`;
  }

  set(src, version, texture) {
    const image = texture.image;
    this.cache.set(this.key(src, version), {
      texture,
      ratio: (image.videoHeight || image.height) / (image.videoWidth || image.width),
      count: 0
    });
    return this.retain(src, version);
  }

  has(src, version) {
    return this.cache.has(this.key(src, version));
  }

  get(src, version) {
    return this.cache.get(this.key(src, version));
  }

  retain(src, version) {
    const cacheItem = this.cache.get(this.key(src, version));
    cacheItem.count++;
    // console.log("retain", src, cacheItem.count);
    return cacheItem;
  }

  release(src, version) {
    const cacheItem = this.cache.get(this.key(src, version));

    if (!cacheItem) {
      console.error(`Releasing uncached texture src ${src}`);
      return;
    }

    cacheItem.count--;
    // console.log("release", src, cacheItem.count);
    if (cacheItem.count <= 0) {
      // Unload the video element to prevent it from continuing to play in the background
      disposeTexture(cacheItem.texture);
      this.cache.delete(this.key(src, version));
    }
  }
}

const parseGIF = promisifyWorker(new GIFWorker());
class GIFTexture extends THREE.Texture {
  constructor(frames, delays, disposals) {
    super(document.createElement("canvas"));
    this.image.width = frames[0].width;
    this.image.height = frames[0].height;

    this._ctx = this.image.getContext("2d");

    this.generateMipmaps = false;
    this.isVideoTexture = true;
    this.minFilter = THREE.NearestFilter;

    this.frames = frames;
    this.delays = delays;
    this.disposals = disposals;

    this.frame = 0;
    this.frameStartTime = Date.now();
  }

  update() {
    if (!this.frames || !this.delays || !this.disposals) return;
    const now = Date.now();
    if (now - this.frameStartTime > this.delays[this.frame]) {
      if (this.disposals[this.frame] === 2) {
        this._ctx.clearRect(0, 0, this.image.width, this.image.width);
      }
      this.frame = (this.frame + 1) % this.frames.length;
      this.frameStartTime = now;
      this._ctx.drawImage(this.frames[this.frame], 0, 0, this.image.width, this.image.height);
      this.needsUpdate = true;
    }
  }
}

async function createGIFTexture(url) {
  return new Promise((resolve, reject) => {
    fetch(url, { mode: "cors" })
      .then(r => r.arrayBuffer())
      .then(rawImageData => parseGIF(rawImageData, [rawImageData]))
      .then(result => {
        const { frames, delayTimes, disposals } = result;
        let loadCnt = 0;
        for (let i = 0; i < frames.length; i++) {
          const img = new Image();
          img.onload = e => {
            loadCnt++;
            frames[i] = e.target;
            if (loadCnt === frames.length) {
              const texture = new GIFTexture(frames, delayTimes, disposals);
              texture.image.src = url;
              texture.encoding = THREE.sRGBEncoding;
              texture.minFilter = THREE.LinearFilter;
              resolve(texture);
            }
          };
          img.src = frames[i];
        }
      })
      .catch(reject);
  });
}

const textureCache = new TextureCache();
const inflightTextures = new Map();
const errorImage = new Image();
errorImage.src = errorImageSrc;
const errorTexture = new THREE.Texture(errorImage);
errorTexture.magFilter = THREE.NearestFilter;
errorImage.onload = () => {
  errorTexture.needsUpdate = true;
};
const errorCacheItem = { texture: errorTexture, ratio: 1 };

function scaleToAspectRatio(el, ratio) {
  const width = Math.min(1.0, 1.0 / ratio);
  const height = Math.min(1.0, ratio);
  el.object3DMap.mesh.scale.set(width, height, 1);
  el.object3DMap.mesh.matrixNeedsUpdate = true;
}

const fetchContentType = url => {
  return fetch(url, { method: "HEAD" }).then(r => r.headers.get("content-type"));
};

// MAIN REGISTER
AFRAME.registerComponent("artwork", {
  schema: {
    src: { type: "string" },
    // version: { type: "number" },
    // projection: { type: "string", default: "flat" },
    contentType: { type: "string" }
    // batch: { default: false }
  },

  remove() {
    if (this.data.batch && this.mesh) {
      this.el.sceneEl.systems["hubs-systems"].batchManagerSystem.removeObject(this.mesh);
    }
    if (this.currentSrcIsRetained) {
      textureCache.release(this.data.src, this.data.version);
      this.currentSrcIsRetained = false;
    }
  },

  async update(oldData) {
    let texture;
    let ratio = 1;

    const batchManagerSystem = this.el.sceneEl.systems["hubs-systems"].batchManagerSystem;

    try {
      const { src } = this.data;

      const parsedUrl = new URL(src);
      const version = 1;

      let canonicalUrl = src;
      let canonicalAudioUrl = src;
      let accessibleUrl = src;
      let contentType = "";

      // We want to resolve and proxy some hubs urls, like rooms and scene links,
      // but want to avoid proxying assets in order for this to work in dev environments
      const isLocalModelAsset =
        isNonCorsProxyDomain(parsedUrl.hostname) && (guessContentType(src) || "").startsWith("model/gltf");

      if (this.data.resolve && !src.startsWith("data:") && !src.startsWith("hubs:") && !isLocalModelAsset) {
        const is360 = !!(this.data.mediaOptions.projection && this.data.mediaOptions.projection.startsWith("360"));
        const quality = getDefaultResolveQuality(is360);
        const result = await resolveUrl(src, quality, version);
        canonicalUrl = result.origin;

        // handle protocol relative urls
        if (canonicalUrl.startsWith("//")) {
          canonicalUrl = location.protocol + canonicalUrl;
        }

        canonicalAudioUrl = result.origin_audio;
        if (canonicalAudioUrl && canonicalAudioUrl.startsWith("//")) {
          canonicalAudioUrl = location.protocol + canonicalAudioUrl;
        }

        contentType = (result.meta && result.meta.expected_content_type) || contentType;
      }

      // todo: we don't need to proxy for many things if the canonical URL has permissive CORS headers
      accessibleUrl = proxiedUrlFor(canonicalUrl);

      // if the component creator didn't know the content type, we didn't get it from reticulum, and
      // we don't think we can infer it from the extension, we need to make a HEAD request to find it out
      contentType = contentType || guessContentType(canonicalUrl) || (await fetchContentType(accessibleUrl));

      if (!src) return;

      this.el.emit("image-loading");

      if (this.mesh && this.mesh.material.map && (src !== oldData.src || version !== oldData.version)) {
        this.mesh.material.map = null;
        this.mesh.material.needsUpdate = true;
        if (this.mesh.material.map !== errorTexture) {
          textureCache.release(oldData.src, oldData.version);
          this.currentSrcIsRetained = false;
        }
      }

      const srcProxified = accessibleUrl;

      let cacheItem;
      if (textureCache.has(srcProxified, version)) {
        if (this.currentsrcProxifiedIsRetained) {
          cacheItem = textureCache.get(srcProxified, version);
        } else {
          cacheItem = textureCache.retain(srcProxified, version);
        }
      } else {
        const inflightKey = textureCache.key(srcProxified, version);

        if (srcProxified === "error") {
          cacheItem = errorCacheItem;
        } else if (inflightTextures.has(inflightKey)) {
          await inflightTextures.get(inflightKey);
          cacheItem = textureCache.retain(srcProxified, version);
        } else {
          let promise;
          if (contentType.includes("image/gif")) {
            promise = createGIFTexture(srcProxified);
          } else if (contentType.includes("image/basis")) {
            promise = createBasisTexture(srcProxified);
          } else if (contentType.startsWith("image/")) {
            promise = createImageTexture(srcProxified);
          } else {
            throw new Error(`Unknown image content type: ${contentType}`);
          }
          inflightTextures.set(inflightKey, promise);
          texture = await promise;
          console.log(texture);
          inflightTextures.delete(inflightKey);
          cacheItem = textureCache.set(srcProxified, version, texture);
        }

        // No way to cancel promises, so if srcProxified has changed or this entity was removed while we were creating the texture just throw it away.
        if (!this.el.parentNode) {
          textureCache.release(srcProxified, version);
          return;
        }
      }

      texture = cacheItem.texture;
      ratio = cacheItem.ratio;

      this.currentSrcIsRetained = true;
    } catch (e) {
      console.error("Error loading image", this.data.src, e);
      texture = errorTexture;
      this.currentSrcIsRetained = false;
    }

    const projection = this.data.projection;

    if (this.mesh && this.data.batch) {
      // This is a no-op if the mesh was just created.
      // Otherwise we want to ensure the texture gets updated.
      batchManagerSystem.removeObject(this.mesh);
    }

    if (!this.mesh || projection !== oldData.projection) {
      const material = new THREE.MeshBasicMaterial();
      const geometry = new THREE.PlaneBufferGeometry(1, 1, 1, 1, texture.flipY);
      material.side = THREE.DoubleSide;
      this.mesh = new THREE.Mesh(geometry, material);
      this.el.setObject3D("mesh", this.mesh);
    }

    // We only support transparency on gifs. Other images will support cutout as part of batching, but not alpha transparency for now
    this.mesh.material.transparent =
      !this.data.batch ||
      texture == errorTexture ||
      this.data.contentType.includes("image/gif") ||
      !!(texture.image && texture.image.hasAlpha);

    this.mesh.material.map = texture;
    this.mesh.material.needsUpdate = true;

    const ratioMain = (texture.image.width || 1.0) / (texture.image.height || 1.0);
    const width = Math.min(this.data.width) * 2;
    const height = Math.min(this.data.width / ratioMain) * 2;

    this.el.object3DMap.mesh.scale.set(width, height, 1);
    this.el.object3DMap.mesh.matrixNeedsUpdate = true;

    if (texture !== errorTexture && this.data.batch && !texture.isCompressedTexture) {
      batchManagerSystem.addObject(this.mesh);
    }

    this.el.emit("image-loaded", { src: this.data.src, projection: projection });
  }
});
