import * as THREE from 'three';

const NASA_TOPOGRAPHY_URL =
  'https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia02/pia02031/PIA02031.jpg';

const TERRAIN_CROP = {
  height: 0.4,
  width: 0.74,
  x: 0.075,
  y: 0.495,
};

const CROPPED_SOURCE_WIDTH = 3072;
const TERRAIN_WORLD_DEPTH = 1120;
const TERRAIN_GRID_COLUMNS = 513;
const TERRAIN_SMOOTHING_PASSES = 6;
const HEIGHT_SCALE = 160;
const EYE_HEIGHT = 16;
const PLAYER_MARGIN = 24;
const BASE_MOVE_SPEED = 65;
const SPRINT_MULTIPLIER = 1.8;
const DRAG = 7.5;

const ELEVATION_RAMP = [
  { color: [44, 39, 93], value: 0.02 },
  { color: [43, 70, 150], value: 0.14 },
  { color: [61, 134, 212], value: 0.26 },
  { color: [70, 211, 229], value: 0.38 },
  { color: [48, 226, 106], value: 0.5 },
  { color: [163, 234, 48], value: 0.58 },
  { color: [251, 217, 58], value: 0.66 },
  { color: [255, 146, 39], value: 0.76 },
  { color: [224, 66, 55], value: 0.86 },
  { color: [195, 160, 146], value: 0.93 },
  { color: [241, 241, 241], value: 1 },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerpColor(from, to, amount) {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

function createImageLoader() {
  const loader = new THREE.ImageLoader();
  loader.setCrossOrigin('anonymous');
  return loader;
}

function loadImage(url) {
  const loader = createImageLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (image) => resolve(image),
      undefined,
      (error) => reject(error),
    );
  });
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawCroppedImage(sourceImage) {
  const cropX = sourceImage.width * TERRAIN_CROP.x;
  const cropY = sourceImage.height * TERRAIN_CROP.y;
  const cropWidth = sourceImage.width * TERRAIN_CROP.width;
  const cropHeight = sourceImage.height * TERRAIN_CROP.height;
  const outputWidth = CROPPED_SOURCE_WIDTH;
  const outputHeight = Math.round(outputWidth / (cropWidth / cropHeight));
  const canvas = createCanvas(outputWidth, outputHeight);
  const context = canvas.getContext('2d');

  context.drawImage(
    sourceImage,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  return canvas;
}

function normalizeRgb(r, g, b) {
  const max = Math.max(r, g, b, 1);
  return [(r / max) * 255, (g / max) * 255, (b / max) * 255];
}

function estimateElevation(r, g, b) {
  const [nr, ng, nb] = normalizeRgb(r, g, b);
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestValue = 0.5;

  for (const entry of ELEVATION_RAMP) {
    const dr = nr - entry.color[0];
    const dg = ng - entry.color[1];
    const db = nb - entry.color[2];
    const distance = dr * dr + dg * dg + db * db;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestValue = entry.value;
    }
  }

  return bestValue;
}

function smoothHeightData(data, width, height, passes = 2) {
  let source = data;

  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float32Array(source.length);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let total = 0;
        let samples = 0;

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = clamp(x + offsetX, 0, width - 1);
            const sampleY = clamp(y + offsetY, 0, height - 1);
            total += source[sampleY * width + sampleX];
            samples += 1;
          }
        }

        next[y * width + x] = total / samples;
      }
    }

    source = next;
  }

  return source;
}

function buildTerrainData(sourceCanvas, columns, rows, { fallback = false } = {}) {
  const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
    .data;
  const data = new Float32Array(columns * rows);

  const samplePixel = (u, v) => {
    const x = clamp(Math.round(u * (sourceCanvas.width - 1)), 0, sourceCanvas.width - 1);
    const y = clamp(Math.round(v * (sourceCanvas.height - 1)), 0, sourceCanvas.height - 1);
    const index = (y * sourceCanvas.width + x) * 4;
    return [
      pixels[index],
      pixels[index + 1],
      pixels[index + 2],
      pixels[index + 3],
    ];
  };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const u = column / (columns - 1);
      const v = row / (rows - 1);
      const [r, g, b] = samplePixel(u, v);
      const elevation = estimateElevation(r, g, b);
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const height = Math.pow(elevation, 1.12) * 0.9 + luma * 0.1;
      const index = row * columns + column;

      data[index] = height;
      min = Math.min(min, height);
      max = Math.max(max, height);
    }
  }

  const normalized = new Float32Array(data.length);
  const range = Math.max(max - min, 0.0001);

  for (let index = 0; index < data.length; index += 1) {
    normalized[index] = (data[index] - min) / range;
  }

  return smoothHeightData(
    normalized,
    columns,
    rows,
    fallback ? TERRAIN_SMOOTHING_PASSES : TERRAIN_SMOOTHING_PASSES + 1,
  );
}

function createFallbackSourceCanvas() {
  const canvas = createCanvas(2048, 1108);
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);

  gradient.addColorStop(0, '#2c1811');
  gradient.addColorStop(0.3, '#78351d');
  gradient.addColorStop(0.58, '#cf6234');
  gradient.addColorStop(1, '#f1d8b0');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < 2400; index += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = Math.random() * 6 + 1;
    const alpha = Math.random() * 0.15;

    context.fillStyle = `rgba(40, 12, 8, ${alpha})`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  return canvas;
}

function createDiffuseTexture(sourceCanvas) {
  const canvas = createCanvas(sourceCanvas.width, sourceCanvas.height);
  const context = canvas.getContext('2d');

  context.drawImage(sourceCanvas, 0, 0);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  for (let index = 0; index < pixels.length; index += 4) {
    const elevation = estimateElevation(pixels[index], pixels[index + 1], pixels[index + 2]);
    const base = lerpColor([56, 24, 18], [210, 115, 60], elevation);
    const highlight = lerpColor(base, [242, 223, 195], Math.max(0, elevation - 0.72) * 2.1);
    const luma =
      (0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]) /
      255;
    const detail = 0.68 + luma * 0.7;

    pixels[index] = clamp(highlight[0] * detail, 0, 255);
    pixels[index + 1] = clamp(highlight[1] * detail, 0, 255);
    pixels[index + 2] = clamp(highlight[2] * detail, 0, 255);
  }

  context.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createNormalTexture(heightData, columns, rows) {
  const pixels = new Uint8Array(columns * rows * 4);

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = heightData[row * columns + clamp(column - 1, 0, columns - 1)];
      const right = heightData[row * columns + clamp(column + 1, 0, columns - 1)];
      const down = heightData[clamp(row - 1, 0, rows - 1) * columns + column];
      const up = heightData[clamp(row + 1, 0, rows - 1) * columns + column];

      const normal = new THREE.Vector3(left - right, 2 / HEIGHT_SCALE, down - up).normalize();
      const index = (row * columns + column) * 4;

      pixels[index] = (normal.x * 0.5 + 0.5) * 255;
      pixels[index + 1] = (normal.y * 0.5 + 0.5) * 255;
      pixels[index + 2] = (normal.z * 0.5 + 0.5) * 255;
      pixels[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(pixels, columns, rows, THREE.RGBAFormat);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createMinimapTextureCanvas(sourceCanvas) {
  const canvas = createCanvas(320, Math.round((sourceCanvas.height / sourceCanvas.width) * 320));
  const context = canvas.getContext('2d');
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function createSkyDome() {
  const geometry = new THREE.SphereGeometry(3800, 48, 48);
  const material = new THREE.ShaderMaterial({
    depthWrite: false,
    fragmentShader: `
      varying vec3 vWorldPosition;

      void main() {
        float height = normalize(vWorldPosition).y * 0.5 + 0.5;
        vec3 horizon = vec3(0.93, 0.43, 0.22);
        vec3 upper = vec3(0.03, 0.02, 0.06);
        vec3 glow = vec3(0.96, 0.70, 0.31);
        vec3 color = mix(horizon, upper, smoothstep(0.1, 0.95, height));
        color += glow * pow(max(0.0, 1.0 - height), 6.0) * 0.18;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
    uniforms: {},
    vertexShader: `
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
  });

  return new THREE.Mesh(geometry, material);
}

function createStars() {
  const geometry = new THREE.BufferGeometry();
  const count = 2000;
  const positions = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    const radius = 3200 + Math.random() * 250;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));

    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi);
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xf7e6d9,
    opacity: 0.85,
    size: 4,
    sizeAttenuation: true,
    transparent: true,
  });

  return new THREE.Points(geometry, material);
}

function createDust() {
  const geometry = new THREE.BufferGeometry();
  const count = 2400;
  const positions = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = THREE.MathUtils.randFloatSpread(2200);
    positions[index * 3 + 1] = Math.random() * 160 + 8;
    positions[index * 3 + 2] = THREE.MathUtils.randFloatSpread(2200);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xe8b488,
      opacity: 0.07,
      size: 10,
      sizeAttenuation: true,
      transparent: true,
    }),
  );
}

function createTerrainMesh({
  columns,
  diffuseTexture,
  heightData,
  normalTexture,
  rows,
  scene,
  worldDepth,
  worldWidth,
}) {
  const geometry = new THREE.PlaneGeometry(worldWidth, worldDepth, columns - 1, rows - 1);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;

  for (let index = 0; index < position.count; index += 1) {
    position.setY(index, heightData[index] * HEIGHT_SCALE);
  }

  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xf2e0d2),
    map: diffuseTexture,
    metalness: 0.02,
    normalMap: normalTexture,
    normalScale: new THREE.Vector2(0.25, 0.25),
    roughness: 1,
  });

  const terrain = new THREE.Mesh(geometry, material);
  terrain.castShadow = true;
  terrain.receiveShadow = true;
  scene.add(terrain);

  return terrain;
}

function sampleHeight(heightData, columns, rows, u, v) {
  const x = clamp(u * (columns - 1), 0, columns - 1);
  const y = clamp(v * (rows - 1), 0, rows - 1);
  const x0 = Math.floor(x);
  const x1 = clamp(x0 + 1, 0, columns - 1);
  const y0 = Math.floor(y);
  const y1 = clamp(y0 + 1, 0, rows - 1);
  const tx = x - x0;
  const ty = y - y0;

  const h00 = heightData[y0 * columns + x0];
  const h10 = heightData[y0 * columns + x1];
  const h01 = heightData[y1 * columns + x0];
  const h11 = heightData[y1 * columns + x1];

  const top = THREE.MathUtils.lerp(h00, h10, tx);
  const bottom = THREE.MathUtils.lerp(h01, h11, tx);

  return THREE.MathUtils.lerp(top, bottom, ty) * HEIGHT_SCALE;
}

function drawMinimap({
  cameraYaw,
  canvas,
  mapTextureCanvas,
  pointerLocked,
  position,
  worldDepth,
  worldWidth,
}) {
  const context = canvas.getContext('2d');
  const width = canvas.clientWidth || 280;
  const height = canvas.clientHeight || Math.round((mapTextureCanvas.height / mapTextureCanvas.width) * width);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(mapTextureCanvas, 0, 0, width, height);
  context.fillStyle = 'rgba(5, 6, 10, 0.18)';
  context.fillRect(0, 0, width, height);

  const u = clamp((position.x + worldWidth / 2) / worldWidth, 0, 1);
  const v = clamp((position.z + worldDepth / 2) / worldDepth, 0, 1);
  const x = u * width;
  const y = v * height;

  context.save();
  context.translate(x, y);
  context.rotate(cameraYaw);
  context.strokeStyle = pointerLocked ? '#ffecc5' : '#f3a55f';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, -14);
  context.lineTo(9, 10);
  context.lineTo(0, 5);
  context.lineTo(-9, 10);
  context.closePath();
  context.stroke();

  context.fillStyle = pointerLocked ? '#fff6e8' : '#ffb778';
  context.beginPath();
  context.arc(0, 0, 4, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function createMarsExplorer({ minimapCanvas, mount, onStatus, onTelemetry }) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8d4c2d, 0.00056);
  scene.add(createSkyDome());
  scene.add(createStars());
  scene.add(createDust());

  const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 6000);
  const yawRig = new THREE.Object3D();
  const pitchRig = new THREE.Object3D();
  yawRig.add(pitchRig);
  pitchRig.add(camera);
  scene.add(yawRig);

  const ambientLight = new THREE.HemisphereLight(0xf9a66a, 0x34140b, 1.6);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xffd1a3, 2.7);
  sunLight.position.set(-620, 540, -320);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.normalBias = 0.02;
  sunLight.shadow.camera.left = -900;
  sunLight.shadow.camera.right = 900;
  sunLight.shadow.camera.top = 900;
  sunLight.shadow.camera.bottom = -900;
  sunLight.shadow.camera.near = 20;
  sunLight.shadow.camera.far = 1800;
  scene.add(sunLight);

  const fillLight = new THREE.DirectionalLight(0xd86d40, 0.65);
  fillLight.position.set(460, 120, 380);
  scene.add(fillLight);

  let disposed = false;
  let pointerLocked = false;
  let terrainMesh = null;
  let terrainInfo = null;
  let mapTextureCanvas = null;

  const keys = {
    backward: false,
    forward: false,
    left: false,
    reset: false,
    right: false,
    sprint: false,
  };

  const velocity = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const clock = new THREE.Clock();
  let fpsAccumulator = 0;
  let fpsFrames = 0;
  let displayedFps = 0;
  let telemetryAccumulator = 0;

  function reportStatus(message, source) {
    onStatus({
      message,
      source,
    });
  }

  reportStatus('Loading NASA topography.', 'Preparing Mars terrain source imagery.');

  function resize() {
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function updatePointerLockState() {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    onTelemetry({
      pointerLocked,
    });
  }

  function handleMouseMove(event) {
    if (!pointerLocked) {
      return;
    }

    yawRig.rotation.y -= event.movementX * 0.0018;
    pitchRig.rotation.x -= event.movementY * 0.0014;
    pitchRig.rotation.x = clamp(pitchRig.rotation.x, -1.1, 1.1);
  }

  function handleKey(event, active) {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.forward = active;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keys.backward = active;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = active;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.right = active;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.sprint = active;
        break;
      case 'KeyR':
        keys.reset = active;
        break;
      default:
        break;
    }
  }

  const handleKeyDown = (event) => handleKey(event, true);
  const handleKeyUp = (event) => handleKey(event, false);
  const handleCanvasClick = () => {
    if (!pointerLocked) {
      renderer.domElement.requestPointerLock();
    }
  };

  function resetPlayer() {
    if (!terrainInfo) {
      return;
    }

    yawRig.position.set(0, 0, 0);
    yawRig.rotation.y = Math.PI * 1.4;
    pitchRig.rotation.x = -0.18;
  }

  function worldToUv(position) {
    const u = (position.x + terrainInfo.worldWidth / 2) / terrainInfo.worldWidth;
    const v = (position.z + terrainInfo.worldDepth / 2) / terrainInfo.worldDepth;
    return {
      u: clamp(u, 0, 1),
      v: clamp(v, 0, 1),
    };
  }

  async function buildTerrain() {
    let sourceCanvas;
    let sourceLabel;
    let fallback = false;

    try {
      const nasaImage = await loadImage(NASA_TOPOGRAPHY_URL);
      sourceCanvas = drawCroppedImage(nasaImage);
      sourceLabel = 'NASA/JPL/GSFC Mars Orbiter Laser Altimeter topography.';
      reportStatus('NASA terrain loaded.', sourceLabel);
    } catch (error) {
      sourceCanvas = createFallbackSourceCanvas();
      fallback = true;
      sourceLabel = 'Procedural fallback activated because NASA imagery could not be loaded.';
      reportStatus('Fallback terrain loaded.', sourceLabel);
    }

    if (disposed) {
      return;
    }

    mapTextureCanvas = createMinimapTextureCanvas(sourceCanvas);
    const aspect = sourceCanvas.width / sourceCanvas.height;
    const worldDepth = TERRAIN_WORLD_DEPTH;
    const worldWidth = worldDepth * aspect;
    const columns = TERRAIN_GRID_COLUMNS;
    const rows = Math.max(257, Math.round(columns / aspect));
    const heightData = buildTerrainData(sourceCanvas, columns, rows, {
      fallback,
    });
    const diffuseTexture = createDiffuseTexture(sourceCanvas);
    diffuseTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const normalTexture = createNormalTexture(heightData, columns, rows);

    terrainMesh = createTerrainMesh({
      columns,
      diffuseTexture,
      heightData,
      normalTexture,
      rows,
      scene,
      worldDepth,
      worldWidth,
    });

    terrainInfo = {
      columns,
      heightData,
      rows,
      worldDepth,
      worldWidth,
    };

    resetPlayer();
    onTelemetry({
      ready: true,
    });

    reportStatus('Explorer ready.', sourceLabel);
  }

  buildTerrain();

  function animate() {
    if (disposed) {
      return;
    }

    const delta = Math.min(clock.getDelta(), 0.05);
    const damping = Math.exp(-DRAG * delta);

    if (terrainInfo) {
      if (keys.reset) {
        resetPlayer();
        velocity.set(0, 0, 0);
        keys.reset = false;
      }

      direction.set(0, 0, 0);
      if (keys.forward) direction.z -= 1;
      if (keys.backward) direction.z += 1;
      if (keys.left) direction.x -= 1;
      if (keys.right) direction.x += 1;
      if (direction.lengthSq() > 0) {
        direction.normalize();
      }

      const moveSpeed = BASE_MOVE_SPEED * (keys.sprint ? SPRINT_MULTIPLIER : 1);
      const acceleration = direction
        .clone()
        .multiplyScalar(moveSpeed * delta)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), yawRig.rotation.y);

      velocity.x = velocity.x * damping + acceleration.x;
      velocity.z = velocity.z * damping + acceleration.z;

      yawRig.position.x += velocity.x;
      yawRig.position.z += velocity.z;

      const maxX = terrainInfo.worldWidth / 2 - PLAYER_MARGIN;
      const maxZ = terrainInfo.worldDepth / 2 - PLAYER_MARGIN;
      yawRig.position.x = clamp(yawRig.position.x, -maxX, maxX);
      yawRig.position.z = clamp(yawRig.position.z, -maxZ, maxZ);

      const uv = worldToUv(yawRig.position);
      const groundHeight = sampleHeight(
        terrainInfo.heightData,
        terrainInfo.columns,
        terrainInfo.rows,
        uv.u,
        uv.v,
      );

      yawRig.position.y = groundHeight + EYE_HEIGHT;

      const latitude = 70 - uv.v * 140;
      const longitude = -180 + uv.u * 360;
      const heading =
        ((THREE.MathUtils.radToDeg(yawRig.rotation.y) % 360) + 360) % 360;

      fpsAccumulator += delta;
      fpsFrames += 1;
      telemetryAccumulator += delta;
      if (fpsAccumulator >= 0.25) {
        displayedFps = fpsFrames / fpsAccumulator;
        fpsAccumulator = 0;
        fpsFrames = 0;
      }

      if (telemetryAccumulator >= 0.08) {
        onTelemetry({
          altitude: groundHeight,
          fps: displayedFps,
          heading,
          lat: latitude,
          lon: longitude,
          speed: Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z) / delta,
        });
        telemetryAccumulator = 0;
      }

      if (mapTextureCanvas) {
        drawMinimap({
          cameraYaw: yawRig.rotation.y,
          canvas: minimapCanvas,
          mapTextureCanvas,
          pointerLocked,
          position: yawRig.position,
          worldDepth: terrainInfo.worldDepth,
          worldWidth: terrainInfo.worldWidth,
        });
      }
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  resize();
  requestAnimationFrame(animate);

  window.addEventListener('resize', resize);
  document.addEventListener('pointerlockchange', updatePointerLockState);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);
  renderer.domElement.addEventListener('click', handleCanvasClick);

  return {
    destroy() {
      disposed = true;
      window.removeEventListener('resize', resize);
      document.removeEventListener('pointerlockchange', updatePointerLockState);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      renderer.domElement.removeEventListener('click', handleCanvasClick);

      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }

      renderer.dispose();
      scene.traverse((object) => {
        if (object.geometry) {
          object.geometry.dispose();
        }

        if (object.material) {
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];

          for (const material of materials) {
            Object.values(material).forEach((value) => {
              if (value && typeof value.dispose === 'function') {
                value.dispose();
              }
            });
            material.dispose();
          }
        }
      });

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    },
    lockPointer() {
      renderer.domElement.requestPointerLock();
    },
  };
}
