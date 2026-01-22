import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

// Constants
const GRAVITY = -30;
const PLAYER_HEIGHT = 1.5;
const MOVE_SPEED = 8;
const SPRINT_MULT = 2.25;
const JUMP_POWER = 10;
const DOOR_DISTANCE = 2.2;

// Default navigation points
const NAV_TARGETS = [
  { label: "Gate", position: new THREE.Vector3(5, 0, 10) },
  { label: "Parking Area", position: new THREE.Vector3(-8, 0, 4) },
  { label: "Cafeteria", position: new THREE.Vector3(12, 0, -6) },
  { label: "Security Office", position: new THREE.Vector3(-12, 0, -3) },
  { label: "Emergency Exit", position: new THREE.Vector3(0, 0, -15) },
];

// Utility: clean mesh names for labels
const formatName = (name) =>
  name.replace(/[_\-]/g, " ").replace(/\d+/g, "").replace(/\s+/g, " ").trim();

export default function ThreeDViewer({ modelUrl = "/input.glb" }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [navTargets, setNavTargets] = useState([]);
  const [selectedTarget, setSelectedTarget] = useState("");

  const activeTargetRef = useRef(null);
  const dummyPointRef = useRef(null);
  const targetWorldPosRef = useRef(new THREE.Vector3());

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ================= SCENE =================
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaaaaaa); // light gray for visibility
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.8)); // softer ambient
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    scene.add(hemiLight);

    // Controls
    const controls = new PointerLockControls(camera, renderer.domElement);
    const player = { velocity: new THREE.Vector3(), onGround: false };

    // ================= RAYCASTER =================
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const groundMeshes = [];
    const doors = [];

    const checkGround = () => {
      raycaster.set(camera.position, down);
      const hits = raycaster.intersectObjects(groundMeshes, false);
      const hit = hits.find((h) => h.distance <= PLAYER_HEIGHT + 0.3);
      if (hit) {
        player.onGround = true;
        player.velocity.y = Math.max(0, player.velocity.y);
        camera.position.y = hit.point.y + PLAYER_HEIGHT;
      } else {
        player.onGround = false;
      }
    };

    const checkDoors = () => {
      doors.forEach((d) => {
        d.userData.near =
          d.position.distanceTo(camera.position) < DOOR_DISTANCE &&
          !d.userData.opened;
      });
    };

    // ================= LOADER =================
    const manager = new THREE.LoadingManager();
    manager.onError = (url) => {
      console.error("Failed to load:", url);
      setError("Model failed to load. Check network or file path.");
      setLoading(false);
    };

    const loader = new GLTFLoader(manager);
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    loader.setDRACOLoader(draco);

    loader.load(
      modelUrl,
      (gltf) => {
        gltf.scene.traverse((obj) => {
          if (obj.isMesh) {
            obj.frustumCulled = true;
            obj.geometry.computeBoundingSphere();
          }
        });

        scene.add(gltf.scene);

        const detectedTargets = [];
        const addedNames = new Set();

        gltf.scene.traverse((child) => {
          if (!child.isMesh) return;
          groundMeshes.push(child);

          if (child.name.toLowerCase().includes("door")) {
            child.userData.opened = false;
            child.userData.near = false;
            doors.push(child);
          }

          if (child.name && child.name.length > 2) {
            const label = formatName(child.name);
            if (!addedNames.has(label)) {
              detectedTargets.push({ label, type: "mesh", ref: child });
              addedNames.add(label);
            }
          }
        });

        setNavTargets([...detectedTargets, ...NAV_TARGETS.map(t => ({
          label: t.label,
          type: "point",
          position: t.position
        }))]);

        // Camera starting position
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        camera.position.set(center.x, box.min.y + PLAYER_HEIGHT, center.z + size.z * 0.3);
        camera.lookAt(center);

        setLoading(false);
      },
      undefined,
      (err) => {
        console.error("GLTF load error:", err);
        setError("Model failed to load. Check network or file path.");
        setLoading(false);
      }
    );

    // ================= INPUT =================
    const keys = {};
    const downHandler = (e) => {
      keys[e.code] = true;
      if (e.code === "Space" && player.onGround) player.velocity.y = JUMP_POWER;
      if (e.code === "KeyE")
        doors.forEach((d) => {
          if (d.userData.near) {
            d.rotation.y -= Math.PI / 2;
            d.userData.opened = true;
          }
        });
    };
    const upHandler = (e) => (keys[e.code] = false);
    document.addEventListener("keydown", downHandler);
    document.addEventListener("keyup", upHandler);
    renderer.domElement.addEventListener("click", () => controls.lock());

    // ================= NAVIGATION LINE =================
    const navGeometry = new THREE.BufferGeometry();
    navGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const navLine = new THREE.Line(navGeometry, new THREE.LineBasicMaterial({ color: 0xff4444, depthTest: false }));
    navLine.renderOrder = 999;
    scene.add(navLine);

    // ================= HUD =================
    const indicator = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.24, 32),
      new THREE.MeshBasicMaterial({ color: 0x00e0ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
    );
    ring.rotation.x = Math.PI / 2;

    const arrow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
    );
    arrow.position.z = 0.18;
    arrow.rotation.x = -Math.PI / 2;

    indicator.add(ring, arrow);
    indicator.visible = false;
    scene.add(indicator);

    // ================= ANIMATION LOOP =================
    const clock = new THREE.Clock();
    let groundTimer = 0;
    let smoothRotation = 0;

    const animate = () => {
      requestAnimationFrame(animate);
      const delta = clock.getDelta();

      if (controls.isLocked) {
        const speed = MOVE_SPEED * (keys.ShiftLeft ? SPRINT_MULT : 1);
        if (keys.KeyW) controls.moveForward(speed * delta);
        if (keys.KeyS) controls.moveForward(-speed * delta * 0.7);
        if (keys.KeyA) controls.moveRight(-speed * delta);
        if (keys.KeyD) controls.moveRight(speed * delta);

        if (!player.onGround) player.velocity.y += GRAVITY * delta;
        camera.position.y += player.velocity.y * delta;

        groundTimer += delta;
        if (groundTimer > 0.1) {
          checkGround();
          checkDoors();
          groundTimer = 0;
        }
      }

      if (activeTargetRef.current) {
        activeTargetRef.current.getWorldPosition(targetWorldPosRef.current);

        const start = camera.position.clone();
        const end = targetWorldPosRef.current.clone();
        end.y = start.y;

        navGeometry.attributes.position.array.set([start.x, start.y, start.z, end.x, end.y, end.z]);
        navGeometry.attributes.position.needsUpdate = true;

        indicator.visible = true;

        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        indicator.position.copy(camera.position).add(forward.multiplyScalar(1.4));
        indicator.position.y += 0.25;

        const dir = new THREE.Vector3().subVectors(targetWorldPosRef.current, camera.position).normalize();
        const targetAngle = Math.atan2(dir.x, dir.z);
        smoothRotation = THREE.MathUtils.lerp(smoothRotation, targetAngle, 0.08);
        indicator.rotation.y = smoothRotation;
      } else {
        indicator.visible = false;
      }

      renderer.render(scene, camera);
    };

    animate();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", downHandler);
      document.removeEventListener("keyup", upHandler);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      scene.clear();
    };
  }, [modelUrl]);

  // ================= NAVIGATION SELECT =================
  const handleSelect = (e) => {
    const value = e.target.value;
    setSelectedTarget(value);
    const target = navTargets.find((t) => t.label === value);

    if (!target) {
      activeTargetRef.current = null;
      return;
    }

    if (target.type === "mesh") {
      activeTargetRef.current = target.ref;
    } else {
      if (!dummyPointRef.current) {
        dummyPointRef.current = new THREE.Object3D();
        sceneRef.current.add(dummyPointRef.current);
      }
      dummyPointRef.current.position.copy(target.position);
      dummyPointRef.current.position.y += PLAYER_HEIGHT;
      dummyPointRef.current.updateMatrixWorld(true);
      activeTargetRef.current = dummyPointRef.current;
    }
  };

  return (
    <div ref={mountRef} style={{ width: "100vw", height: "100vh" }}>
      {loading && <div style={overlayStyle}>Loading Building…</div>}
      {error && <div style={{ ...overlayStyle, color: "red" }}>{error}</div>}

      <select value={selectedTarget} onChange={handleSelect} style={selectStyle}>
        <option value="">Select Destination</option>
        {navTargets.map((t) => (
          <option key={t.label} value={t.label}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ================= STYLES =================
const overlayStyle = {
  position: "absolute",
  inset: 0,
  background: "#000",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "42px",
  zIndex: 10,
};

const selectStyle = {
  position: "absolute",
  top: "20px",
  left: "50%",
  transform: "translateX(-50%)",
  padding: "10px 14px",
  fontSize: "16px",
  borderRadius: "8px",
  border: "none",
  outline: "none",
  zIndex: 20,
};
