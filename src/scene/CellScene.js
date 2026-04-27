import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clamp } from "../utils/format.js";

const COLOR_MAP = {
  membrane: "#6de9ff",
  nucleus: "#e7a3ff",
  mitochondria: "#ff9466",
  golgi: "#ffd56e",
  reticulum: "#6ef7bf",
  lysosome: "#ff6f9e",
  vesicle: "#9ce8ff",
  cytoskeleton: "#7ca7ff",
  ribosome: "#f6f8ff",
};

export class CellScene {
  constructor(container) {
    this.container = container;
    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2("#07101c", 0.028);
    this.camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    );
    this.camera.position.set(0, 0.35, 7.6);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 12;
    this.controls.autoRotateSpeed = 0.4;

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.floaters = [];
    this.activeModel = null;
    this.stateTension = 0.25;

    this.setupEnvironment();
    this.setupLights();

    this.handleResize = this.handleResize.bind(this);
    this.animate = this.animate.bind(this);
    window.addEventListener("resize", this.handleResize);
    this.animate();
  }

  setupEnvironment() {
    const starGeometry = new THREE.BufferGeometry();
    const particleCount = 1800;
    const positions = new Float32Array(particleCount * 3);

    for (let index = 0; index < particleCount; index += 1) {
      const radius = 12 + Math.random() * 20;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.cos(phi);
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }

    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const starMaterial = new THREE.PointsMaterial({
      size: 0.04,
      color: "#87c8ff",
      transparent: true,
      opacity: 0.8,
    });

    this.stars = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(this.stars);
  }

  setupLights() {
    const ambient = new THREE.AmbientLight("#8cc7ff", 1.1);
    const key = new THREE.DirectionalLight("#ffffff", 2.3);
    key.position.set(4, 5, 7);
    const rim = new THREE.PointLight("#58e6ff", 18, 20);
    rim.position.set(-5, -2, -3);
    const warm = new THREE.PointLight("#ff7d80", 15, 18);
    warm.position.set(3, 1, 4);

    this.scene.add(ambient, key, rim, warm);
  }

  clearModel() {
    while (this.root.children.length > 0) {
      const child = this.root.children.pop();
      child.traverse?.((node) => {
        if (node.geometry) {
          node.geometry.dispose();
        }
        if (node.material) {
          if (Array.isArray(node.material)) {
            node.material.forEach((item) => item.dispose());
          } else {
            node.material.dispose();
          }
        }
      });
    }
    this.floaters = [];
  }

  setModel(model) {
    this.activeModel = model;
    this.clearModel();

    const membrane = this.createMembrane(model);
    const nucleus = this.createNucleus(model);
    const cytoskeleton = this.createCytoskeleton(model);
    const mitochondria = this.createMitochondria(model);
    const reticulum = this.createReticulum(model);
    const golgi = this.createGolgi(model);
    const vesicles = this.createVesicles(model);
    const lysosomes = this.createLysosomes(model);
    const ribosomes = this.createRibosomes(model);

    this.root.add(
      membrane,
      nucleus,
      cytoskeleton,
      mitochondria,
      reticulum,
      golgi,
      vesicles,
      lysosomes,
      ribosomes,
    );
  }

  createMembrane(model) {
    const geometry = new THREE.IcosahedronGeometry(model.geometry.radius, 32);
    const position = geometry.attributes.position;
    const vector = new THREE.Vector3();

    for (let index = 0; index < position.count; index += 1) {
      vector.fromBufferAttribute(position, index);
      const wrinkle =
        1 +
        Math.sin(vector.x * model.geometry.wrinkleScale) * model.geometry.wrinkleAmp +
        Math.cos(vector.y * model.geometry.wrinkleScale * 0.7) *
          model.geometry.wrinkleAmp *
          0.6;
      vector.normalize().multiplyScalar(model.geometry.radius * wrinkle);
      position.setXYZ(index, vector.x, vector.y, vector.z);
    }

    position.needsUpdate = true;
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(model.palette.membrane || COLOR_MAP.membrane),
      emissive: new THREE.Color(model.palette.membraneGlow || "#0d3345"),
      transmission: 0.45,
      thickness: 0.8,
      roughness: 0.15,
      metalness: 0.05,
      transparent: true,
      opacity: 0.92,
      clearcoat: 1,
      clearcoatRoughness: 0.2,
    });

    const shell = new THREE.Mesh(geometry, material);
    shell.rotation.x = 0.2;
    return shell;
  }

  createNucleus(model) {
    const group = new THREE.Group();
    const nucleusMaterial = new THREE.MeshPhysicalMaterial({
      color: model.palette.nucleus || COLOR_MAP.nucleus,
      emissive: "#29153d",
      roughness: 0.25,
      transparent: true,
      opacity: 0.95,
    });
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(model.geometry.nucleusRadius, 32, 32),
      nucleusMaterial,
    );
    core.position.set(-0.35, 0.18, 0.1);
    group.add(core);

    const nucleolus = new THREE.Mesh(
      new THREE.SphereGeometry(model.geometry.nucleusRadius * 0.33, 24, 24),
      new THREE.MeshStandardMaterial({
        color: "#ffe9ff",
        emissive: "#8d3975",
      }),
    );
    nucleolus.position.copy(core.position).add(new THREE.Vector3(0.12, -0.06, 0.18));
    group.add(nucleolus);

    this.floaters.push({
      mesh: group,
      axis: "y",
      speed: 0.45,
      range: 0.08,
    });

    return group;
  }

  createMitochondria(model) {
    const group = new THREE.Group();
    const count = model.components.mitochondria;
    const material = new THREE.MeshStandardMaterial({
      color: model.palette.mitochondria || COLOR_MAP.mitochondria,
      emissive: "#431509",
      roughness: 0.35,
    });

    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.1 + Math.random() * 0.06, 0.24 + Math.random() * 0.2, 8, 16),
        material,
      );
      const distance = model.geometry.radius * (0.25 + Math.random() * 0.48);
      const angle = (index / count) * Math.PI * 2;
      mesh.position.set(
        Math.cos(angle * 2.3) * distance,
        (Math.random() - 0.5) * model.geometry.radius * 0.85,
        Math.sin(angle * 1.7) * distance,
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      group.add(mesh);
      this.floaters.push({
        mesh,
        axis: "x",
        speed: 0.2 + Math.random() * 0.5,
        range: 0.04 + Math.random() * 0.06,
      });
    }

    return group;
  }

  createReticulum(model) {
    const group = new THREE.Group();
    const curveCount = model.components.reticulum;
    const material = new THREE.MeshStandardMaterial({
      color: model.palette.reticulum || COLOR_MAP.reticulum,
      emissive: "#10362d",
      roughness: 0.45,
    });

    for (let index = 0; index < curveCount; index += 1) {
      const points = [];
      const offset = index / curveCount;

      for (let step = 0; step < 14; step += 1) {
        const t = step / 13;
        points.push(
          new THREE.Vector3(
            Math.sin((t + offset) * Math.PI * 4) * 1.2,
            (t - 0.5) * 1.8 + Math.sin((t + offset) * Math.PI * 6) * 0.1,
            Math.cos((t + offset * 0.5) * Math.PI * 5) * 1.05,
          ),
        );
      }

      const curve = new THREE.CatmullRomCurve3(points);
      const geometry = new THREE.TubeGeometry(curve, 64, 0.04, 12, false);
      const tube = new THREE.Mesh(geometry, material);
      tube.scale.setScalar(0.95 + Math.random() * 0.35);
      group.add(tube);
    }

    return group;
  }

  createGolgi(model) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: model.palette.golgi || COLOR_MAP.golgi,
      emissive: "#4f3208",
      roughness: 0.3,
    });

    for (let index = 0; index < 6; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.62 - index * 0.05, 0.035, 16, 100, Math.PI * 1.3),
        material,
      );
      mesh.position.set(0.65, -0.45 + index * 0.08, -0.2 + index * 0.02);
      mesh.rotation.set(Math.PI / 2.5, 0.6, 0.15);
      group.add(mesh);
    }

    return group;
  }

  createVesicles(model) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: model.palette.vesicle || COLOR_MAP.vesicle,
      emissive: "#153947",
      transparent: true,
      opacity: 0.92,
    });

    for (let index = 0; index < model.components.vesicles; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.06 + Math.random() * 0.05, 16, 16),
        material,
      );
      const r = 0.8 + Math.random() * 1.35;
      mesh.position.set(
        (Math.random() - 0.5) * r * 1.6,
        (Math.random() - 0.5) * r * 1.2,
        (Math.random() - 0.5) * r * 1.6,
      );
      group.add(mesh);
      this.floaters.push({
        mesh,
        axis: "z",
        speed: 0.4 + Math.random() * 0.7,
        range: 0.05 + Math.random() * 0.06,
      });
    }

    return group;
  }

  createLysosomes(model) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: model.palette.lysosome || COLOR_MAP.lysosome,
      emissive: "#4d1432",
      roughness: 0.2,
    });

    for (let index = 0; index < model.components.lysosomes; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.08 + Math.random() * 0.04, 1),
        material,
      );
      const radius = 1.1 + Math.random() * 0.8;
      mesh.position.set(
        Math.cos(index * 0.8) * radius * 0.7,
        (Math.random() - 0.5) * radius,
        Math.sin(index * 0.9) * radius * 0.8,
      );
      group.add(mesh);
      this.floaters.push({
        mesh,
        axis: "y",
        speed: 0.35 + Math.random() * 0.45,
        range: 0.03 + Math.random() * 0.05,
      });
    }

    return group;
  }

  createRibosomes(model) {
    const geometry = new THREE.SphereGeometry(0.022, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: model.palette.ribosome || COLOR_MAP.ribosome,
    });
    const instanced = new THREE.InstancedMesh(geometry, material, model.components.ribosomes);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    for (let index = 0; index < model.components.ribosomes; index += 1) {
      const radius = 0.5 + Math.random() * (model.geometry.radius - 0.4);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const position = new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      );
      matrix.compose(position, quaternion, scale);
      instanced.setMatrixAt(index, matrix);
    }

    return instanced;
  }

  createCytoskeleton(model) {
    const group = new THREE.Group();
    const filamentCount = model.components.filaments;

    for (let index = 0; index < filamentCount; index += 1) {
      const curve = new THREE.CatmullRomCurve3(
        Array.from({ length: 6 }, (_, pointIndex) => {
          const t = pointIndex / 5;
          return new THREE.Vector3(
            Math.sin((t + index * 0.13) * Math.PI * 2) * (0.6 + Math.random() * 0.8),
            (t - 0.5) * 2.1 + (Math.random() - 0.5) * 0.3,
            Math.cos((t + index * 0.17) * Math.PI * 2) * (0.6 + Math.random() * 0.8),
          );
        }),
      );

      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 32, 0.018 + Math.random() * 0.01, 6, false),
        new THREE.MeshBasicMaterial({
          color: model.palette.cytoskeleton || COLOR_MAP.cytoskeleton,
          transparent: true,
          opacity: 0.75,
        }),
      );
      group.add(mesh);
    }

    return group;
  }

  setStateTension(nextValue) {
    this.stateTension = clamp(nextValue, 0, 1);
    if (!this.activeModel) {
      return;
    }

    const targetScale = 1 + this.stateTension * 0.08;
    this.root.scale.setScalar(targetScale);
    this.controls.autoRotate = this.stateTension > 0.15;
  }

  focusOnNucleus() {
    this.controls.target.set(-0.35, 0.18, 0.1);
  }

  resetFocus() {
    this.controls.target.set(0, 0, 0);
  }

  animate() {
    const elapsed = this.clock.getElapsedTime();

    this.floaters.forEach((floater, index) => {
      const phase = elapsed * floater.speed + index;
      floater.mesh.position[floater.axis] += Math.sin(phase) * floater.range * 0.01;
      floater.mesh.rotation.x += 0.0012;
      floater.mesh.rotation.y += 0.0015;
    });

    this.root.rotation.y += 0.001 + this.stateTension * 0.0013;
    this.root.rotation.z = Math.sin(elapsed * 0.17) * 0.06;
    this.stars.rotation.y -= 0.0004;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  }

  handleResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.handleResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}

