import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

const GRAVITY = -30;
const PLAYER_HEIGHT = 1.5;
const MOVE_SPEED = 8;
const SPRINT_MULT = 2.25;
const JUMP_POWER = 10;
const DOOR_DISTANCE = 2.2;

/* Manual point targets */
const NAV_TARGETS = [
  { label: "Gate", position: new THREE.Vector3(5, 0, 10) },
  { label: "Parking Area", position: new THREE.Vector3(-8, 0, 4) },
  { label: "Cafeteria", position: new THREE.Vector3(12, 0, -6) },
  { label: "Security Office", position: new THREE.Vector3(-12, 0, -3) },
  { label: "Emergency Exit", position: new THREE.Vector3(0, 0, -15) },
];

const formatName = name =>
  name.replace(/[_\-]/g, " ").replace(/\d+/g, "").replace(/\s+/g, " ").trim();

export default function ThreeDViewer({
  // ✅ GitHub Pages safe path
  modelUrl = "/campus-vista/input.glb",
}) {
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

    /* ================= SCENE ================= */
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220); // ✅ not pure black
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1500
    );

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    mount.appendChild(renderer.domElement);

    /* ================= LIGHTING (FIXED) ================= */
    scene.add(new THREE.AmbientLight(0xffffff, 2.5));

    const dirLight = new THREE.DirectionalLight(0xffffff, 4);
    dirLight.position.set(20, 40, 20);
    scene.add(dirLight);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    scene.add(hemi);

    /* ================= CONTROLS ================= */
    const controls = new PointerLockControls(camera, renderer.domElement);
    const player = { velocity: new THREE.Vector3(), onGround: false };

    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const groundMeshes = [];
    const doors = [];

    const checkGround = () => {
      raycaster.set(camera.position, down);
      const hits = raycaster.intersectObjects(groundMeshes, false);
      const hit = hits.find(h => h.distance <= PLAYER_HEIGHT + 0.3);
      if (hit) {
        player.onGround = true;
        player.velocity.y = Math.max(0, player.velocity.y);
        camera.position.y = hit.point.y + PLAYER_HEIGHT;
      } else {
        player.onGround = false;
      }
    };

    const checkDoors = () => {
      doors.forEach(d => {
        d.userData.near =
          d.position.distanceTo(camera.position) < DOOR_DISTANCE &&
          !d.userData.opened;
      });
    };

    /* ================= LOADER ================= */
    const manager = new THREE.LoadingManager();
    manager.onError = () => {
      console.error("❌ GLB LOAD FAILED:", modelUrl);
      setError("Model failed to load. Check GitHub Pages path.");
      setLoading(false);
    };

    const loader = new GLTFLoader(manager);
    const draco = new DRACOLoader();
    draco.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.7/"
    );
    loader.setDRACOLoader(draco);

    loader.load(
      modelUrl,
      gltf => {
        scene.add(gltf.scene);

        const detectedTargets = [];
        const addedNames = new Set();

        gltf.scene.traverse(obj => {
          if (!obj.isMesh) return;

          groundMeshes.push(obj);

          if (obj.name.toLowerCase().includes("door")) {
            obj.userData.opened = false;
            obj.userData.near = false;
            doors.push(obj);
          }

          const label = formatName(obj.name);
          if (label && !addedNames.has(label)) {
            detectedTargets.push({ label, type: "mesh", ref: obj });
            addedNames.add(label);
          }
        });

        setNavTargets([
          ...detectedTargets,
          ...NAV_TARGETS.map(t => ({
            label: t.label,
            type: "point",
            position: t.position,
          })),
        ]);

        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        camera.position.set(
          center.x,
          box.min.y + PLAYER_HEIGHT,
          center.z + size.z * 0.3
        );
        camera.lookAt(center);

        setLoading(false);
      }
    );

    /* ================= INPUT ================= */
    const keys = {};
    const downHandler = e => {
      keys[e.code] = true;
      if (e.code === "Space" && player.onGround)
        player.velocity.y = JUMP_POWER;
      if (e.code === "KeyE")
        doors.forEach(d => {
          if (d.userData.near) {
            d.rotation.y -= Math.PI / 2;
            d.userData.opened = true;
          }
        });
    };
    const upHandler = e => (keys[e.code] = false);

    document.addEventListener("keydown", downHandler);
    document.addEventListener("keyup", upHandler);
    renderer.domElement.addEventListener("click", () => controls.lock());

    /* ================= NAV LINE ================= */
    const navGeometry = new THREE.BufferGeometry();
    navGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(6), 3)
    );
    const navLine = new THREE.Line(
      navGeometry,
      new THREE.LineBasicMaterial({ color: 0xff4444 })
    );
    scene.add(navLine);

    /* ================= LOOP ================= */
    const clock = new THREE.Clock();
    let groundTimer = 0;

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

  return (
    <div ref={mountRef} style={{ width: "100vw", height: "100vh" }}>
      {loading && <div style={overlayStyle}>Loading Campus…</div>}
      {error && <div style={{ ...overlayStyle, color: "red" }}>{error}</div>}
    </div>
  );
}

const overlayStyle = {
  position: "absolute",
  inset: 0,
  background: "rgba(0,0,0,0.85)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "32px",
  zIndex: 10,
};
