import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

/* ================= CONSTANTS ================= */
const PLAYER_HEIGHT = 1.5;
const MOVE_SPEED = 8;
const SPRINT_MULT = 2.25;
const GRAVITY = -30;
const JUMP_POWER = 10;
const FLOOR_EPSILON = 0.05;

const NAV_TARGETS = [
  { label: "Gate", position: new THREE.Vector3(5, 0, 10) },
  { label: "Parking Area", position: new THREE.Vector3(-8, 0, 4) },
  { label: "Cafeteria", position: new THREE.Vector3(12, 0, -6) },
  { label: "Security Office", position: new THREE.Vector3(-12, 0, -3) },
  { label: "Emergency Exit", position: new THREE.Vector3(0, 0, -15) },
];

const formatName = (n) =>
  n.replace(/[_\-]/g, " ").replace(/\d+/g, "").replace(/\s+/g, " ").trim();

export default function ThreeDViewer({ modelUrl = "input.glb" }) {
  const mountRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [navTargets, setNavTargets] = useState([]);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [mobileMode, setMobileMode] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x20232a);

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    mount.appendChild(renderer.domElement);

    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(10, 20, 10);
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    scene.add(sun);

    const controls = new PointerLockControls(camera, renderer.domElement);

    /* ================= PLAYER STATE ================= */
    const velocityY = { value: 0 };
    let onGround = false;
    let lastSafeY = 0;

    const raycaster = new THREE.Raycaster();
    const groundMeshes = [];

    const snapToGround = () => {
      raycaster.set(camera.position, new THREE.Vector3(0, -1, 0));
      const hits = raycaster.intersectObjects(groundMeshes, false);

      if (hits.length) {
        const y = hits[0].point.y + PLAYER_HEIGHT;
        if (camera.position.y <= y + FLOOR_EPSILON) {
          camera.position.y = y;
          velocityY.value = 0;
          onGround = true;
          lastSafeY = y;
          return;
        }
      }

      camera.position.y = lastSafeY;
      velocityY.value = 0;
      onGround = true;
    };

    /* ================= LOAD MODEL ================= */
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    loader.setDRACOLoader(draco);

    loader.load(
      import.meta.env.BASE_URL + modelUrl,
      (gltf) => {
        scene.add(gltf.scene);

        const targets = [];
        const used = new Set();

        gltf.scene.traverse((m) => {
          if (!m.isMesh) return;
          groundMeshes.push(m);

          if (m.name) {
            const label = formatName(m.name);
            if (label && !used.has(label)) {
              used.add(label);
              targets.push({ label, type: "mesh", ref: m });
            }
          }
        });

        setNavTargets([
          ...targets,
          ...NAV_TARGETS.map((p) => ({ label: p.label, type: "point", position: p.position })),
        ]);

        // Spawn inside building
        const bounds = new THREE.Box3().setFromObject(gltf.scene);
        const center = bounds.getCenter(new THREE.Vector3());
        camera.position.set(center.x, bounds.min.y + PLAYER_HEIGHT, center.z);
        lastSafeY = camera.position.y;

        setLoading(false);
      },
      undefined,
      () => {
        setError("Model failed to load");
        setLoading(false);
      }
    );

    /* ================= INPUT ================= */
    const keys = {};
    document.addEventListener("keydown", (e) => {
      if (!mobileMode) {
        keys[e.code] = true;
        if (e.code === "Space" && onGround) {
          velocityY.value = JUMP_POWER;
          onGround = false;
        }
      }
    });
    document.addEventListener("keyup", (e) => (keys[e.code] = false));
    renderer.domElement.addEventListener("click", () => !mobileMode && controls.lock());

    /* ================= MOBILE JOYSTICK ================= */
    const mobileInput = { forward: 0, right: 0 };
    const joystickOuter = document.createElement("div");
    const joystickInner = document.createElement("div");

    joystickOuter.style.position = "absolute";
    joystickOuter.style.width = "100px";
    joystickOuter.style.height = "100px";
    joystickOuter.style.borderRadius = "50%";
    joystickOuter.style.background = "rgba(0,0,0,0.25)";
    joystickOuter.style.left = "40px";
    joystickOuter.style.bottom = "40px";
    joystickOuter.style.zIndex = 100;
    joystickOuter.style.touchAction = "none";

    joystickInner.style.position = "absolute";
    joystickInner.style.width = "50px";
    joystickInner.style.height = "50px";
    joystickInner.style.borderRadius = "50%";
    joystickInner.style.background = "rgba(255,255,255,0.75)";
    joystickInner.style.left = "25px";
    joystickInner.style.top = "25px";
    joystickInner.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";

    joystickOuter.appendChild(joystickInner);
    mount.appendChild(joystickOuter);
    joystickOuter.style.display = mobileMode ? "block" : "none";

    let joystickStart = null;
    let joystickActive = false;

    const joystickMove = (touch) => {
      if (!joystickActive) return;
      const dx = touch.clientX - joystickStart.x;
      const dy = touch.clientY - joystickStart.y;
      const maxDist = 40;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const clampedDist = Math.min(dist, maxDist);
      joystickInner.style.transform = `translate(${clampedDist * Math.cos(angle)}px, ${clampedDist * Math.sin(angle)}px)`;
      mobileInput.right = (clampedDist * Math.cos(angle)) / maxDist;
      mobileInput.forward = (clampedDist * Math.sin(angle)) / maxDist;
    };

    joystickOuter.addEventListener("touchstart", (e) => {
      joystickActive = true;
      const rect = joystickOuter.getBoundingClientRect();
      joystickStart = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      joystickMove(e.touches[0]);
    });

    window.addEventListener("touchmove", (e) => {
      if (!joystickActive) return;
      joystickMove(e.touches[0]);
    });

    window.addEventListener("touchend", () => {
      joystickActive = false;
      joystickInner.style.transform = "translate(0px,0px)";
      mobileInput.forward = 0;
      mobileInput.right = 0;
    });

    // Mobile camera rotate
    let rotateActive = false;
    let rotateStart = { x: 0, y: 0 };
    window.addEventListener("touchstart", (e) => {
      if (!mobileMode) return;
      if (e.target !== joystickInner && e.target !== joystickOuter && e.touches.length === 1) {
        rotateActive = true;
        rotateStart.x = e.touches[0].clientX;
        rotateStart.y = e.touches[0].clientY;
      }
    });
    window.addEventListener("touchmove", (e) => {
      if (!rotateActive || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - rotateStart.x;
      const dy = e.touches[0].clientY - rotateStart.y;
      camera.rotation.y -= dx * 0.005;
      camera.rotation.x -= dy * 0.005;
      camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
      rotateStart.x = e.touches[0].clientX;
      rotateStart.y = e.touches[0].clientY;
    });
    window.addEventListener("touchend", () => (rotateActive = false));

    /* ================= ADVANCED 3D AI NAVIGATOR ================= */
    const hud = new THREE.Group();

    // Blue flat plate
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00aaff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });

    const pulseRing = new THREE.Mesh(
      new THREE.RingGeometry(0.04, 0.065, 48),
      glowMaterial
    );
    pulseRing.rotation.x = -Math.PI / 2; // flat forward
    hud.add(pulseRing);

    // Attractive 3D arrow inside circle
    const arrowGeometry = new THREE.ConeGeometry(0.015, 0.045, 16);
    const arrowMesh = new THREE.Mesh(
      arrowGeometry,
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 })
    );
    arrowMesh.rotation.x = Math.PI / 2; // lean forward
    arrowMesh.position.z = 0.05; // slightly above plate
    hud.add(arrowMesh);

    hud.visible = false;

    camera.add(hud);
    hud.position.set(0, -0.12, -0.75); // in front of eyes
    scene.add(camera);

    let pulseTime = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      requestAnimationFrame(animate);
      const delta = clock.getDelta();

      // Desktop movement
      if (!mobileMode && controls.isLocked) {
        const speed = (keys.ShiftLeft ? MOVE_SPEED * SPRINT_MULT : MOVE_SPEED) * delta;
        const dir = new THREE.Vector3(
          (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
          0,
          (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0)
        );
        if (dir.lengthSq()) {
          dir.normalize().applyEuler(camera.rotation);
          camera.position.addScaledVector(dir, speed);
        }
      }

      // Mobile movement
      if (mobileMode) {
        const dir = new THREE.Vector3(mobileInput.right, 0, mobileInput.forward).applyEuler(camera.rotation);
        camera.position.addScaledVector(dir, MOVE_SPEED * delta);
      }

      velocityY.value += GRAVITY * delta;
      camera.position.y += velocityY.value * delta;
      snapToGround();

      // Update AI navigator
      if (selectedTarget) {
        const t = navTargets.find((n) => n.label === selectedTarget);
        if (t) {
          const targetPos =
            t.type === "mesh" ? t.ref.getWorldPosition(new THREE.Vector3()) : t.position;

          const dir = targetPos.clone().sub(camera.position).normalize();
          const invQuat = camera.quaternion.clone().invert();
          const localDir = dir.clone().applyQuaternion(invQuat);

          // Rotate HUD circle toward target
          const targetAngle = Math.atan2(localDir.x, localDir.z);
          hud.rotation.y += (targetAngle - hud.rotation.y) * 0.1; // smooth rotation

          // Arrow pulse / scale
          const dist = camera.position.distanceTo(targetPos);
          pulseTime += delta * 4;
          const scale = THREE.MathUtils.clamp(0.9 - dist * 0.01, 0.7, 0.9);
          arrowMesh.scale.setScalar(scale + Math.sin(pulseTime) * 0.03);

          // Glow color by distance
          glowMaterial.color.set(dist < 3 ? 0x00ff99 : dist < 8 ? 0x00ffaa : 0x00aaff);

          hud.visible = true;
        }
      } else {
        hud.visible = false;
      }

      renderer.render(scene, camera);
    };

    animate();

    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return () => {
      renderer.dispose();
      scene.clear();
      mount.removeChild(renderer.domElement);
    };
  }, [modelUrl, mobileMode, selectedTarget]);

  return (
    <div ref={mountRef} style={{ width: "100vw", height: "100vh" }}>
      {loading && <div style={overlayStyle}>Loading…</div>}
      {error && <div style={{ ...overlayStyle, color: "red" }}>{error}</div>}

      <select
        value={selectedTarget}
        onChange={(e) => setSelectedTarget(e.target.value)}
        style={selectStyle}
      >
        <option value="">Select Destination</option>
        {navTargets.map((t) => (
          <option key={t.label}>{t.label}</option>
        ))}
      </select>

      <button style={modeButtonStyle} onClick={() => setMobileMode((m) => !m)}>
        {mobileMode ? "Desktop" : "Mobile"}
      </button>
    </div>
  );
}

/* ================= STYLES ================= */
const overlayStyle = {
  position: "absolute",
  inset: 0,
  background: "#000",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "36px",
  zIndex: 10,
};

const selectStyle = {
  position: "absolute",
  top: "20px",
  left: "50%",
  transform: "translateX(-50%)",
  padding: "10px",
  borderRadius: "8px",
  zIndex: 20,
};

const modeButtonStyle = {
  position: "absolute",
  top: "60px",
  left: "50%",
  transform: "translateX(-50%)",
  padding: "10px",
  borderRadius: "8px",
  zIndex: 20,
};
