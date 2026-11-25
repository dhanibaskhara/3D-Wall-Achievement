import { generateUuidV4, mulberry32, formatDateIndo } from './utils.js';
import { createSupabaseService } from './supabase.js';
import { createCameraControls } from './camera-controls.js';
import { createMarkerRenderer } from './markers.js';

/* 3D Wall Achievement — application entry point. Keep app logic in this IIFE until safely split into modules. */
(function () {
        'use strict';

        // =========================================================================
        // 1. KONFIGURASI SUPABASE & KONSTANTA WALL 3D
        // =========================================================================
        const SUPABASE_URL = 'https://hutbxsmmwuyprxeilcfr.supabase.co';
        const SUPABASE_KEY = 'sb_publishable_fvKp7rX5jdGRFCuiMbb6lg_e8oSZfIQ';

        const THREE_CDNS = [
            'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
            'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
            'https://unpkg.com/three@0.128.0/build/three.min.js'
        ];
        const SUPABASE_CDNS = [
            'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
            'https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js',
            'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.min.js'
        ];

        // Geometri Dinding Pasar Festival Kuningan (Kiri Abu-Abu & Kanan Biru-Kuning, keduanya 19.3 m)
        const WALL_WIDTH = 3.0;
        const LEFT_CENTER_X = -1.65;   // X range: [-3.15, -0.15]
        const RIGHT_CENTER_X = 1.65;   // X range: [0.15, 3.15]
        const WALL_HEIGHT = 19.3;

        // Profil dinding [y, z_front] -> seluruh titik berada aman di dalam batas DB: X[-3.5..3.5], Y[0..19.6], Z[-0.6..6.6]
        // Wall Abu-abu (14 papan): Papan 1-5 vertikal, Papan 6-11 slab light, Papan 12-top vertikal kembali
        const leftProfile = [
            [0.0,                      0.00],
            [(5 / 14) * WALL_HEIGHT,   0.00],
            [(11 / 14) * WALL_HEIGHT, -0.52],
            [WALL_HEIGHT,             -0.52]
        ];
        const rightProfile = [
            [0.0,  0.22],
            [3.2,  0.58],
            [6.4,  1.24],
            [9.8,  2.22],
            [13.2, 3.45],
            [16.2, 4.46],
            [19.3, 5.28]
        ];

        // =========================================================================
        // 2. STATE APLIKASI
        // =========================================================================
        let scene, camera, renderer;
        let wallInteractMeshes = [];
        let pinsGroup, previewGroup;
        let raycaster, pointerVec;
        let dirLight, hemiLight, spotLeft, spotRight, canopyLight;
        let livingActors = null;
        let isNightMode = true;
        let animFrameId = null;

        // Orbit & Pan camera state
        let camTarget = null;
        let camSpherical = null;
        let targetSpherical = null;
        let targetLookAt = null;
        let isDragging = false;
        let isPinching = false;
        let pointerDownPos = { x: 0, y: 0 };
        let lastPointerPos = { x: 0, y: 0 };
        let lastPinchDist = 0;
        let activePointers = new Map();
        let isPanMode = false;
        let hadMultiTouch = false;

        // Data & Supabase state
        let supabaseClient = null;
        let realtimeChannel = null;
        let pollTimer = null;
        let currentUserId = null;
        let activeWeekStartDate = null;
        let markers = [];
        let renderedPawEntries = [];
        let hitTargets = [];
        let isAddMode = false;
        let pendingPlacement = null;
        let selectedMarker = null;
        let lastClusterDistBucket = -1;
        let toastTimer = null;

        let lastCloudDiag = {
            state: 'connecting',
            label: 'Menghubungkan...',
            isAnonDisabled: false,
            raw: '',
            hint: ''
        };

        let sharedPawAssets = null;

        const markerState = {};
        Object.defineProperties(markerState, {
            pinsGroup: { get: () => pinsGroup, set: (value) => { pinsGroup = value; } },
            camSpherical: { get: () => camSpherical, set: (value) => { camSpherical = value; } },
            previewGroup: { get: () => previewGroup, set: (value) => { previewGroup = value; } },
            markers: { get: () => markers, set: (value) => { markers = value; } },
            renderedPawEntries: { get: () => renderedPawEntries, set: (value) => { renderedPawEntries = value; } },
            hitTargets: { get: () => hitTargets, set: (value) => { hitTargets = value; } },
            lastClusterDistBucket: { get: () => lastClusterDistBucket, set: (value) => { lastClusterDistBucket = value; } },
            activeWeekStartDate: { get: () => activeWeekStartDate, set: (value) => { activeWeekStartDate = value; } },
            sharedPawAssets: { get: () => sharedPawAssets, set: (value) => { sharedPawAssets = value; } }
        });
        const markerService = createMarkerRenderer(markerState, {
            get THREE() { return window.THREE; }, snapPointToWallSurface
        });

        const supabaseState = {};
        Object.defineProperties(supabaseState, {
            supabaseClient: { get: () => supabaseClient, set: (value) => { supabaseClient = value; } },
            realtimeChannel: { get: () => realtimeChannel, set: (value) => { realtimeChannel = value; } },
            pollTimer: { get: () => pollTimer, set: (value) => { pollTimer = value; } },
            currentUserId: { get: () => currentUserId, set: (value) => { currentUserId = value; } },
            activeWeekStartDate: { get: () => activeWeekStartDate, set: (value) => { activeWeekStartDate = value; } },
            markers: { get: () => markers, set: (value) => { markers = value; } },
            selectedMarker: { get: () => selectedMarker, set: (value) => { selectedMarker = value; } },
            lastCloudDiag: { get: () => lastCloudDiag, set: (value) => { lastCloudDiag = value; } }
        });
        const supabaseService = createSupabaseService(supabaseState, { SUPABASE_URL, SUPABASE_KEY, createResilientStorage, formatDateIndo, generateUuidV4, showToast, rebuildMarkers3D: markerService.rebuildMarkers3D, closeMarkerPopup });
        const cameraState = {};
        Object.defineProperties(cameraState, {
            camera: { get: () => camera, set: (value) => { camera = value; } },
            renderer: { get: () => renderer, set: (value) => { renderer = value; } },
            camSpherical: { get: () => camSpherical, set: (value) => { camSpherical = value; } },
            targetSpherical: { get: () => targetSpherical, set: (value) => { targetSpherical = value; } },
            targetLookAt: { get: () => targetLookAt, set: (value) => { targetLookAt = value; } },
            isDragging: { get: () => isDragging, set: (value) => { isDragging = value; } },
            isPinching: { get: () => isPinching, set: (value) => { isPinching = value; } },
            pointerDownPos: { get: () => pointerDownPos, set: (value) => { pointerDownPos = value; } },
            lastPointerPos: { get: () => lastPointerPos, set: (value) => { lastPointerPos = value; } },
            lastPinchDist: { get: () => lastPinchDist, set: (value) => { lastPinchDist = value; } },
            activePointers: { get: () => activePointers, set: (value) => { activePointers = value; } },
            isPanMode: { get: () => isPanMode, set: (value) => { isPanMode = value; } },
            hadMultiTouch: { get: () => hadMultiTouch, set: (value) => { hadMultiTouch = value; } }
        });
        const cameraControls = createCameraControls(cameraState, { get THREE() { return window.THREE; }, handleCanvasTap });

        // =========================================================================
        // 3. HELPER UMUM (SCRIPT LOADER, STORAGE ADAPTER, UUID, TANGGAL, SEEDED RNG)
        // =========================================================================
        function loadScript(src) {
            return new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = src;
                s.async = true;
                s.onload = () => resolve(src);
                s.onerror = () => {
                    s.remove();
                    reject(new Error('Gagal memuat ' + src));
                };
                document.head.appendChild(s);
            });
        }

        async function loadFirstAvailable(urls, checkFn) {
            if (checkFn()) return true;
            for (const url of urls) {
                try {
                    await loadScript(url);
                    if (checkFn()) return true;
                } catch (_) {
                    // Coba CDN berikutnya
                }
            }
            return checkFn();
        }

        function createResilientStorage() {
            const mem = new Map();
            let canUseLocal = false;
            try {
                const testKey = '__iyalagi_storage_test__';
                window.localStorage.setItem(testKey, '1');
                window.localStorage.removeItem(testKey);
                canUseLocal = true;
            } catch (_) {
                canUseLocal = false;
            }
            return {
                getItem(key) {
                    if (canUseLocal) {
                        try { return window.localStorage.getItem(key); } catch (_) {}
                    }
                    return mem.has(key) ? mem.get(key) : null;
                },
                setItem(key, value) {
                    if (canUseLocal) {
                        try { window.localStorage.setItem(key, value); return; } catch (_) {}
                    }
                    mem.set(key, String(value));
                },
                removeItem(key) {
                    if (canUseLocal) {
                        try { window.localStorage.removeItem(key); return; } catch (_) {}
                    }
                    mem.delete(key);
                }
            };
        }

        function getWallSurfaceAtY(profile, y) {
            const clampedY = Math.max(profile[0][0], Math.min(profile[profile.length - 1][0], y));
            for (let i = 0; i < profile.length - 1; i++) {
                const [y0, z0] = profile[i];
                const [y1, z1] = profile[i + 1];
                if (clampedY >= y0 && clampedY <= y1) {
                    const t = y1 === y0 ? 0 : (clampedY - y0) / (y1 - y0);
                    const z = z0 + (z1 - z0) * t;
                    const dy = y1 - y0;
                    const dz = z1 - z0;
                    const len = Math.hypot(dz, dy) || 1;
                    return {
                        z,
                        normal: new THREE.Vector3(0, -dz / len, dy / len)
                    };
                }
            }
            const last = profile[profile.length - 1];
            return { z: last[1], normal: new THREE.Vector3(0, 0, 1) };
        }

        // Proyeksikan koordinat tepat ke permukaan dinding aktual agar marker menempel rapat
        function snapPointToWallSurface(x, y) {
            const isRight = x >= 0;
            const profile = isRight ? rightProfile : leftProfile;
            const cx = isRight ? RIGHT_CENTER_X : LEFT_CENTER_X;
            const halfW = WALL_WIDTH / 2;
            const clampedX = Math.max(cx - halfW + 0.05, Math.min(cx + halfW - 0.05, x));
            const clampedY = Math.max(0.08, Math.min(WALL_HEIGHT - 0.08, y));
            const surf = getWallSurfaceAtY(profile, clampedY);
            return {
                pos: new THREE.Vector3(clampedX, clampedY, surf.z),
                normal: surf.normal.clone().normalize()
            };
        }

        function showFatalError(message) {
            const loading = document.getElementById('loading-overlay');
            if (loading) loading.classList.add('hidden');
            const box = document.getElementById('fatal-error-box');
            const msg = document.getElementById('fatal-error-msg');
            if (msg) msg.textContent = message || 'Terjadi kesalahan saat menginisialisasi WebGL 3D.';
            if (box) box.classList.remove('hidden');
        }

        function showToast(text, duration = 3200) {
            const el = document.getElementById('toast');
            const txt = document.getElementById('toast-text');
            if (!el || !txt) return;
            txt.textContent = text;
            el.classList.add('toast-enter');
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => {
                el.classList.remove('toast-enter');
            }, duration);
        }

        // =========================================================================
        // 4. STATUS KONEKSI & DIAGNOSTIK SUPABASE
        // =========================================================================
        // =========================================================================
        // 6. PEMBUATAN SCENE 3D WALL PASAR FESTIVAL (LEFT GREY & RIGHT BLUE 19.3M)
        // =========================================================================
        function createWallTexture(isRightBlue) {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 1024;
            const ctx = canvas.getContext('2d');
            const rng = mulberry32(isRightBlue ? 7711 : 4422);

            if (isRightBlue) {
                ctx.fillStyle = '#8ec5cb';
                ctx.fillRect(0, 0, 512, 1024);

                for (let i = 0; i < 420; i++) {
                    const x = rng() * 512;
                    const y = rng() * 1024;
                    const r = 14 + rng() * 48;
                    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
                    const warm = rng() > 0.38;
                    g.addColorStop(0, warm ? 'rgba(202, 166, 92, 0.24)' : 'rgba(92, 152, 162, 0.20)');
                    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    ctx.fillStyle = g;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else {
                ctx.fillStyle = '#57534e';
                ctx.fillRect(0, 0, 512, 1024);

                for (let x = 0; x < 512; x += 6) {
                    const v = Math.floor((rng() - 0.5) * 18);
                    ctx.fillStyle = `rgb(${84 + v}, ${80 + v}, ${76 + v})`;
                    ctx.fillRect(x, 0, 6, 1024);
                }
                for (let i = 0; i < 240; i++) {
                    const x = rng() * 512;
                    const y = rng() * 1024;
                    const r = 10 + rng() * 34;
                    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
                    g.addColorStop(0, 'rgba(235, 232, 224, 0.10)');
                    g.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = g;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            ctx.strokeStyle = isRightBlue ? 'rgba(42, 74, 82, 0.42)' : 'rgba(28, 25, 23, 0.55)';
            ctx.lineWidth = 2;
            const rows = 14;
            for (let r = 1; r < rows; r++) {
                const y = (r / rows) * 1024;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(512, y);
                ctx.stroke();
            }
            for (let c = 1; c < 3; c++) {
                const x = (c / 3) * 512;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, 1024);
                ctx.stroke();
            }

            ctx.fillStyle = isRightBlue ? 'rgba(30, 50, 56, 0.25)' : 'rgba(15, 15, 15, 0.35)';
            for (let y = 18; y < 1024; y += 32) {
                for (let x = 20; x < 512; x += 32) {
                    ctx.beginPath();
                    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.encoding = THREE.sRGBEncoding;
            tex.anisotropy = 4;
            return tex;
        }

        function buildWallTowerMesh(centerX, width, profile, thickness, frontMat, sideMat) {
            const halfW = width / 2;
            const segCount = profile.length - 1;
            const group = new THREE.Group();

            const frontPositions = [];
            const frontUvs = [];
            const frontIndices = [];

            for (let i = 0; i < profile.length; i++) {
                const [y, z] = profile[i];
                const v = y / WALL_HEIGHT;
                frontPositions.push(centerX - halfW, y, z);
                frontUvs.push(0, v);
                frontPositions.push(centerX + halfW, y, z);
                frontUvs.push(1, v);
            }
            for (let i = 0; i < segCount; i++) {
                const a = i * 2;
                const b = a + 1;
                const c = a + 2;
                const d = a + 3;
                frontIndices.push(a, b, d, a, d, c);
            }

            const frontGeo = new THREE.BufferGeometry();
            frontGeo.setAttribute('position', new THREE.Float32BufferAttribute(frontPositions, 3));
            frontGeo.setAttribute('uv', new THREE.Float32BufferAttribute(frontUvs, 2));
            frontGeo.setIndex(frontIndices);
            frontGeo.computeVertexNormals();

            const frontMesh = new THREE.Mesh(frontGeo, frontMat);
            frontMesh.castShadow = true;
            frontMesh.receiveShadow = true;
            frontMesh.userData.isClimbableWall = true;
            group.add(frontMesh);
            wallInteractMeshes.push(frontMesh);

            const backPositions = [];
            const backIndices = [];
            for (let i = 0; i < profile.length; i++) {
                const [y, z] = profile[i];
                const surf = getWallSurfaceAtY(profile, y);
                const bz = z - surf.normal.z * thickness;
                const by = y - surf.normal.y * thickness;
                backPositions.push(centerX - halfW, by, bz);
                backPositions.push(centerX + halfW, by, bz);
            }
            for (let i = 0; i < segCount; i++) {
                const a = i * 2;
                const b = a + 1;
                const c = a + 2;
                const d = a + 3;
                backIndices.push(a, d, b, a, c, d);
            }
            const backGeo = new THREE.BufferGeometry();
            backGeo.setAttribute('position', new THREE.Float32BufferAttribute(backPositions, 3));
            backGeo.setIndex(backIndices);
            backGeo.computeVertexNormals();
            const backMesh = new THREE.Mesh(backGeo, sideMat);
            backMesh.castShadow = true;
            group.add(backMesh);

            const sideVerts = [];
            const pushQuad = (p0, p1, p2, p3) => {
                sideVerts.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
            };
            const getBackPt = (x, y, z) => {
                const surf = getWallSurfaceAtY(profile, y);
                return [x, y - surf.normal.y * thickness, z - surf.normal.z * thickness];
            };

            for (let i = 0; i < segCount; i++) {
                const [y0, z0] = profile[i];
                const [y1, z1] = profile[i + 1];
                pushQuad(
                    getBackPt(centerX - halfW, y0, z0),
                    [centerX - halfW, y0, z0],
                    [centerX - halfW, y1, z1],
                    getBackPt(centerX - halfW, y1, z1)
                );
                pushQuad(
                    [centerX + halfW, y0, z0],
                    getBackPt(centerX + halfW, y0, z0),
                    getBackPt(centerX + halfW, y1, z1),
                    [centerX + halfW, y1, z1]
                );
            }
            const [yTop, zTop] = profile[profile.length - 1];
            pushQuad(
                [centerX - halfW, yTop, zTop],
                [centerX + halfW, yTop, zTop],
                getBackPt(centerX + halfW, yTop, zTop),
                getBackPt(centerX - halfW, yTop, zTop)
            );

            const sideGeo = new THREE.BufferGeometry();
            sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(sideVerts, 3));
            sideGeo.computeVertexNormals();
            const sideMesh = new THREE.Mesh(sideGeo, sideMat);
            sideMesh.castShadow = true;
            group.add(sideMesh);

            return group;
        }

        function addStrut(group, pA, pB, radius, mat) {
            const dir = new THREE.Vector3().subVectors(pB, pA);
            const len = dir.length();
            if (len < 0.01) return;
            const geo = new THREE.CylinderGeometry(radius, radius, len, 6);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(pA).addScaledVector(dir, 0.5);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
            group.add(mesh);
        }

        function buildSteelTrussAndCanopy() {
            const group = new THREE.Group();
            const steelMat = new THREE.MeshStandardMaterial({
                color: 0x334155,
                roughness: 0.6,
                metalness: 0.72
            });

            const buildTowerTruss = (centerX, profile, backZ) => {
                const xCols = [centerX - 1.35, centerX, centerX + 1.35];
                const levels = [];
                for (let y = 0; y <= WALL_HEIGHT; y += 2.4125) {
                    levels.push(Math.min(WALL_HEIGHT, y));
                }
                if (levels[levels.length - 1] < WALL_HEIGHT - 0.05) levels.push(WALL_HEIGHT);

                xCols.forEach((x) => {
                    for (let i = 0; i < levels.length - 1; i++) {
                        const y0 = levels[i];
                        const y1 = levels[i + 1];
                        const zf0 = getWallSurfaceAtY(profile, y0).z - 0.28;
                        const zf1 = getWallSurfaceAtY(profile, y1).z - 0.28;

                        const f0 = new THREE.Vector3(x, y0, zf0);
                        const f1 = new THREE.Vector3(x, y1, zf1);
                        const b0 = new THREE.Vector3(x, y0, backZ);
                        const b1 = new THREE.Vector3(x, y1, backZ);

                        addStrut(group, f0, f1, 0.055, steelMat);
                        addStrut(group, b0, b1, 0.065, steelMat);
                        addStrut(group, f0, b0, 0.04, steelMat);
                        addStrut(group, f0, b1, 0.032, steelMat);
                    }
                    const topY = levels[levels.length - 1];
                    const zfTop = getWallSurfaceAtY(profile, topY).z - 0.28;
                    addStrut(group, new THREE.Vector3(x, topY, zfTop), new THREE.Vector3(x, topY, backZ), 0.045, steelMat);
                });

                for (let i = 0; i < levels.length; i++) {
                    const y = levels[i];
                    const zf = getWallSurfaceAtY(profile, y).z - 0.28;
                    addStrut(group, new THREE.Vector3(xCols[0], y, backZ), new THREE.Vector3(xCols[2], y, backZ), 0.04, steelMat);
                    addStrut(group, new THREE.Vector3(xCols[0], y, zf), new THREE.Vector3(xCols[2], y, zf), 0.035, steelMat);
                    if (i < levels.length - 1) {
                        const yNext = levels[i + 1];
                        addStrut(group, new THREE.Vector3(xCols[0], y, backZ), new THREE.Vector3(xCols[1], yNext, backZ), 0.028, steelMat);
                        addStrut(group, new THREE.Vector3(xCols[1], y, backZ), new THREE.Vector3(xCols[2], yNext, backZ), 0.028, steelMat);
                    }
                }
            };

            buildTowerTruss(LEFT_CENTER_X, leftProfile, -1.9);
            buildTowerTruss(RIGHT_CENTER_X, rightProfile, -1.9);

            for (let y = 2.4; y <= WALL_HEIGHT; y += 4.8) {
                addStrut(group, new THREE.Vector3(LEFT_CENTER_X + 1.35, y, -1.9), new THREE.Vector3(RIGHT_CENTER_X - 1.35, y, -1.9), 0.045, steelMat);
            }

            const roofMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.7, metalness: 0.25 });
            const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.09, 2.4), roofMat);
            canopy.position.set(RIGHT_CENTER_X + 2.15, 11.4, 0.35);
            canopy.rotation.z = -0.14;
            group.add(canopy);
            addStrut(group, new THREE.Vector3(RIGHT_CENTER_X + 1.45, 9.8, 0.9), new THREE.Vector3(RIGHT_CENTER_X + 2.8, 11.2, 0.9), 0.035, steelMat);
            addStrut(group, new THREE.Vector3(RIGHT_CENTER_X + 1.45, 9.8, -0.3), new THREE.Vector3(RIGHT_CENTER_X + 2.8, 11.2, -0.3), 0.035, steelMat);

            scene.add(group);
        }

        function buildHoldsAndVolumes() {
            const holdsGroup = new THREE.Group();
            const rng = mulberry32(90210);
            const up = new THREE.Vector3(0, 1, 0);

            // Helper penempatan hold menempel rapat mengikuti kontur & normal permukaan wall
            const placeOnWall = (obj, isRight, localX, y, lift = 0.0) => {
                const profile = isRight ? rightProfile : leftProfile;
                const cx = isRight ? RIGHT_CENTER_X : LEFT_CENTER_X;
                const surf = getWallSurfaceAtY(profile, y);
                obj.position.set(cx + localX, y, surf.z);
                obj.position.addScaledVector(surf.normal, lift);
                obj.quaternion.setFromUnitVectors(up, surf.normal);
                holdsGroup.add(obj);
            };

            // 1. Geometri sabit/pisang/hook organik (untuk sirip biru, sabit emas, hook, dan arch)
            const createCrescentMesh = (outerR, innerR, arcRad, depth, colorHex, rotZ = 0, scaleX = 1, scaleY = 1) => {
                const shape = new THREE.Shape();
                const steps = 16;
                const startA = -arcRad / 2;
                const endA = arcRad / 2;

                // Kurva punggung luar
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    const a = startA + (endA - startA) * t;
                    const px = Math.cos(a) * outerR;
                    const py = Math.sin(a) * outerR;
                    if (i === 0) shape.moveTo(px, py);
                    else shape.lineTo(px, py);
                }
                // Kurva cekung dalam (meruncing lembut di kedua ujung)
                for (let i = steps; i >= 0; i--) {
                    const t = i / steps;
                    const a = startA + (endA - startA) * t;
                    const taper = Math.sin(t * Math.PI);
                    const r = outerR - (outerR - innerR) * (0.22 + 0.78 * taper);
                    shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
                }
                shape.closePath();

                const geo = new THREE.ExtrudeGeometry(shape, {
                    depth: Math.max(0.03, depth),
                    bevelEnabled: true,
                    bevelThickness: Math.min(0.045, depth * 0.42),
                    bevelSize: Math.min(0.032, (outerR - innerR) * 0.25),
                    bevelSegments: 3,
                    curveSegments: 10
                });
                geo.center();
                geo.scale(scaleX, scaleY, 1);
                geo.rotateX(-Math.PI / 2);

                const mat = new THREE.MeshStandardMaterial({
                    color: colorHex,
                    roughness: 0.80,
                    metalness: 0.04
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.rotateY(rotZ);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                return mesh;
            };

            // 2. Dome / sloper bundar organik dengan sedikit cekungan baut di tengah
            const createDomeHold = (radius, height, colorHex, sx = 1, sz = 1, rot = 0) => {
                const g = new THREE.Group();
                const geo = new THREE.SphereGeometry(radius, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
                geo.scale(sx, height / radius, sz);
                const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.82, metalness: 0.03 });
                const body = new THREE.Mesh(geo, mat);
                body.castShadow = true;
                body.receiveShadow = true;
                g.add(body);

                const bolt = new THREE.Mesh(
                    new THREE.CylinderGeometry(radius * 0.14, radius * 0.14, 0.015, 8),
                    new THREE.MeshStandardMaterial({ color: 0x262220, roughness: 0.9 })
                );
                bolt.position.set(0, height * 0.84, 0);
                g.add(bolt);
                g.rotateY(rot);
                return g;
            };

            // 3. Donat / ring cup hold (sisi kanan wall kiri & deretan merah atas)
            const createDoughnutHold = (radius, tube, colorHex) => {
                const g = new THREE.Group();
                const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.80, metalness: 0.04 });
                const ringGeo = new THREE.TorusGeometry(radius, tube, 10, 20);
                ringGeo.rotateX(Math.PI / 2);
                ringGeo.scale(1, 0.78, 1);
                const ring = new THREE.Mesh(ringGeo, mat);
                ring.position.y = tube * 0.55;
                ring.castShadow = true;
                g.add(ring);

                const core = new THREE.Mesh(
                    new THREE.CylinderGeometry(radius * 0.72, radius * 0.88, tube * 0.75, 14),
                    new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.88 })
                );
                core.position.y = tube * 0.35;
                g.add(core);
                return g;
            };

            // 4. Landmark Wall Kiri: Bola setengah dua warna (hijau zaitun atas + putih kapur bawah)
            const createTwoToneGreenWhiteBall = (radius) => {
                const geo = new THREE.SphereGeometry(radius, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.54);
                geo.scale(1.04, 0.84, 1.0);

                const pos = geo.attributes.position;
                const colors = new Float32Array(pos.count * 3);
                const cGreen = new THREE.Color(0x5b7a34);
                const cWhite = new THREE.Color(0xeae5da);
                const cTint  = new THREE.Color(0xd7b9a8); // sedikit noda kapur/karet di sisi bawah
                const tmpCol = new THREE.Color();

                for (let i = 0; i < pos.count; i++) {
                    const vz = pos.getZ(i); // lokal -Z = arah ATAS dinding
                    const upRatio = -vz / radius;
                    if (upRatio > 0.18) {
                        tmpCol.copy(cGreen);
                    } else if (upRatio > 0.06) {
                        const blend = (upRatio - 0.06) / 0.12;
                        tmpCol.copy(cWhite).lerp(cGreen, blend);
                    } else if (upRatio < -0.58) {
                        const blend = Math.min(1, (-0.58 - upRatio) / 0.35);
                        tmpCol.copy(cWhite).lerp(cTint, blend * 0.55);
                    } else {
                        tmpCol.copy(cWhite);
                    }
                    colors[i * 3] = tmpCol.r;
                    colors[i * 3 + 1] = tmpCol.g;
                    colors[i * 3 + 2] = tmpCol.b;
                }
                geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

                const mat = new THREE.MeshStandardMaterial({
                    vertexColors: true,
                    roughness: 0.84,
                    metalness: 0.03
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                return mesh;
            };

            // 5. Landmark Wall Kanan: White Half-Dome Scoop Shell dengan ceruk baut gelap
            const createWhiteScoopShell = () => {
                const g = new THREE.Group();
                const shellGeo = new THREE.SphereGeometry(0.42, 18, 14, -Math.PI * 0.45, Math.PI * 0.95, 0, Math.PI * 0.52);
                shellGeo.scale(0.76, 0.82, 1.08);
                const shellMat = new THREE.MeshStandardMaterial({
                    color: 0xeeeae2,
                    roughness: 0.78,
                    metalness: 0.04
                });
                const shell = new THREE.Mesh(shellGeo, shellMat);
                shell.castShadow = true;
                shell.receiveShadow = true;
                g.add(shell);

                // Tepi datar gelap di sisi kiri cangkang + 2 titik ceruk gelap khas foto
                const rimMat = new THREE.MeshStandardMaterial({ color: 0x3f3632, roughness: 0.88 });
                const edgePlate = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.25, 0.76), rimMat);
                edgePlate.position.set(-0.10, 0.11, 0.0);
                g.add(edgePlate);

                [[-0.02, 0.26, -0.14], [0.09, 0.23, 0.15]].forEach(([px, py, pz]) => {
                    const hole = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), rimMat);
                    hole.scale.set(1.1, 0.45, 1.1);
                    hole.position.set(px, py, pz);
                    g.add(hole);
                });

                g.rotateY(0.18);
                return g;
            };

            // 6. Landmark Wall Kanan: Rel diagonal bergelombang kuning-oker
            const createWavyYellowRail = () => {
                const shape = new THREE.Shape();
                shape.moveTo(-0.36, -0.05);
                shape.bezierCurveTo(-0.24, -0.12, -0.12, -0.06, 0.0, -0.09);
                shape.bezierCurveTo( 0.14, -0.12,  0.26, -0.05, 0.36, -0.07);
                shape.bezierCurveTo( 0.42, -0.02,  0.42,  0.07, 0.34,  0.10);
                shape.bezierCurveTo( 0.22,  0.13,  0.12,  0.07, 0.0,   0.10);
                shape.bezierCurveTo(-0.14,  0.12, -0.26,  0.06, -0.35, 0.09);
                shape.bezierCurveTo(-0.42,  0.05, -0.42, -0.01, -0.36, -0.05);

                const geo = new THREE.ExtrudeGeometry(shape, {
                    depth: 0.11,
                    bevelEnabled: true,
                    bevelThickness: 0.04,
                    bevelSize: 0.025,
                    bevelSegments: 3
                });
                geo.center();
                geo.rotateX(-Math.PI / 2);

                const mat = new THREE.MeshStandardMaterial({ color: 0xc99f30, roughness: 0.80, metalness: 0.04 });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.rotateY(0.56); // miring diagonal naik ke kanan atas sesuai foto
                mesh.castShadow = true;
                return mesh;
            };

            // 7. Landmark Wall Kanan: Volume Heksagonal Gelap Besar
            const createHexVolume = (radius, height) => {
                const g = new THREE.Group();
                const bodyGeo = new THREE.CylinderGeometry(radius * 0.56, radius, height, 6);
                const bodyMat = new THREE.MeshStandardMaterial({
                    color: 0x453b36,
                    roughness: 0.84,
                    metalness: 0.06
                });
                const body = new THREE.Mesh(bodyGeo, bodyMat);
                body.position.y = height * 0.5;
                body.rotateY(Math.PI / 6);
                body.castShadow = true;
                body.receiveShadow = true;
                g.add(body);

                // Permukaan atas agak berkapur + lubang tengah kecil
                const topPlate = new THREE.Mesh(
                    new THREE.CylinderGeometry(radius * 0.48, radius * 0.52, 0.02, 6),
                    new THREE.MeshStandardMaterial({ color: 0x5c5049, roughness: 0.9 })
                );
                topPlate.position.y = height + 0.005;
                topPlate.rotateY(Math.PI / 6);
                g.add(topPlate);

                const centerDot = new THREE.Mesh(
                    new THREE.CylinderGeometry(radius * 0.11, radius * 0.11, 0.025, 8),
                    new THREE.MeshStandardMaterial({ color: 0x1e1917, roughness: 0.92 })
                );
                centerDot.position.y = height + 0.012;
                g.add(centerDot);
                return g;
            };

            // 8. Landmark Wall Kanan: Volume Piramida Segitiga Tajam (Krem-Kuning & Terakota-Oranye)
            const createPyramidVolume = (radius, height, colorHex, rotY = 0) => {
                const geo = new THREE.ConeGeometry(radius, height, 3);
                const mat = new THREE.MeshStandardMaterial({
                    color: colorHex,
                    roughness: 0.78,
                    metalness: 0.05,
                    flatShading: true
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.y = height * 0.48;
                mesh.rotateY(rotY);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                const g = new THREE.Group();
                g.add(mesh);
                return g;
            };

            // 9. Sculpted Pocket / Boulder Macro (Abu-Taupe & Coral-Merah di atas volume)
            const createSculptedMacro = (radius, height, colorHex, hasDeepPocket = false) => {
                const g = new THREE.Group();
                const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.82, metalness: 0.03 });
                const baseGeo = new THREE.DodecahedronGeometry(radius, 1);
                baseGeo.scale(1.0, height / radius, 1.15);
                const base = new THREE.Mesh(baseGeo, mat);
                base.position.y = height * 0.35;
                base.castShadow = true;
                g.add(base);

                if (hasDeepPocket) {
                    const pocket = new THREE.Mesh(
                        new THREE.SphereGeometry(radius * 0.44, 10, 8),
                        new THREE.MeshStandardMaterial({ color: 0x352e2a, roughness: 0.95 })
                    );
                    pocket.scale.set(0.9, 0.35, 1.15);
                    pocket.position.set(0.02, height * 0.78, 0.02);
                    g.add(pocket);
                }
                return g;
            };

            // -----------------------------------------------------------------
            // A. HOLD IKONIK WALL KIRI (ABU-ABU) — SESUAI FOTO REFERENSI
            // -----------------------------------------------------------------
            // Hook kuning-oker bawah
            placeOnWall(createCrescentMesh(0.27, 0.11, Math.PI * 1.28, 0.10, 0xc7a338, 1.15), false, -0.14, 2.25, 0.02);

            // Sepasang dome merah-bata bawah-tengah
            placeOnWall(createDomeHold(0.17, 0.13, 0xb85236, 1.05, 0.95, 0.2), false, -0.34, 4.35, 0.0);
            placeOnWall(createDomeHold(0.19, 0.15, 0xa84030, 1.0, 1.08, -0.2), false, -0.22, 4.95, 0.0);

            // Gugus dome kuning krem besar + dua dome merah-bata di sebelah kirinya
            placeOnWall(createDomeHold(0.16, 0.12, 0x9c4935, 1.05, 0.95, 0.3), false, -0.58, 6.32, 0.0);
            placeOnWall(createDomeHold(0.24, 0.17, 0xd9c97b, 1.06, 0.96, -0.15), false, 0.06, 6.72, 0.0);
            placeOnWall(createDomeHold(0.16, 0.12, 0xa34737, 1.0, 1.0, 0.1), false, -0.24, 7.08, 0.0);

            // 5 Sirip / Sabit Biru Muda Melengkung + Donat Merah-Bata di tepi kanan
            placeOnWall(createCrescentMesh(0.40, 0.22, Math.PI * 0.78, 0.11, 0x6ea3c8, -2.55, 1.0, 0.85), false,  0.42,  8.22, 0.02);
            placeOnWall(createCrescentMesh(0.42, 0.21, Math.PI * 0.92, 0.12, 0x74aad0, -0.72, 1.0, 0.88), false, -0.06,  9.02, 0.02);
            placeOnWall(createCrescentMesh(0.40, 0.23, Math.PI * 0.72, 0.11, 0x669cc2,  2.95, 0.95, 0.88), false,  0.04,  9.95, 0.02);
            placeOnWall(createCrescentMesh(0.38, 0.21, Math.PI * 0.76, 0.11, 0x72a8ce, -0.35, 0.95, 0.85), false, -0.46, 10.65, 0.02);
            placeOnWall(createCrescentMesh(0.40, 0.24, Math.PI * 0.68, 0.11, 0x679ec4,  3.05, 0.92, 0.85), false,  0.24, 11.08, 0.02);
            placeOnWall(createDoughnutHold(0.17, 0.075, 0xb54632), false, 0.92, 10.72, 0.0);

            // Bola Setengah Hijau-Atas & Putih-Kapur-Bawah (Landmark Wall Kiri)
            placeOnWall(createTwoToneGreenWhiteBall(0.32), false, -0.25, 12.15, 0.0);

            // Deretan 4 hold merah-bata/terakota melengkung di atas bola hijau-putih
            placeOnWall(createCrescentMesh(0.25, 0.11, Math.PI * 1.05, 0.10, 0xb04032, -1.15), false, 0.22, 12.88, 0.02);
            placeOnWall(createCrescentMesh(0.28, 0.12, Math.PI * 0.95, 0.10, 0xb83c30, -1.55), false, 0.18, 13.48, 0.02);
            placeOnWall(createDoughnutHold(0.15, 0.065, 0xb34535), false, 0.12, 14.08, 0.0);
            placeOnWall(createCrescentMesh(0.23, 0.10, Math.PI * 1.05, 0.09, 0xc26a4c,  1.58), false, 0.22, 14.78, 0.02);

            // Dome cokelat-tan kiri + dome merah kanan + sabit kuning cerah dekat puncak
            placeOnWall(createDomeHold(0.20, 0.15, 0x96734e, 1.12, 0.92, 0.3), false, -0.48, 15.72, 0.0);
            placeOnWall(createDomeHold(0.17, 0.13, 0xb84534, 1.0, 1.0, 0.0), false,  0.32, 16.25, 0.0);
            placeOnWall(createCrescentMesh(0.20, 0.08, Math.PI * 1.05, 0.08, 0xe3b82b, -1.52), false, -0.04, 17.85, 0.02);

            // -----------------------------------------------------------------
            // B. HOLD IKONIK, MACRO & VOLUME WALL KANAN (BIRU-KUNING) — SESUAI FOTO
            // -----------------------------------------------------------------
            // Bagian bawah (0.8m – 6.5m)
            placeOnWall(createDomeHold(0.17, 0.11, 0x8c6244, 1.25, 0.85, 0.4), true, -0.92, 1.45, 0.0);
            placeOnWall(createCrescentMesh(0.25, 0.10, Math.PI * 1.08, 0.09, 0xcab04e, -1.45), true, -0.25, 2.25, 0.02);
            placeOnWall(createCrescentMesh(0.32, 0.14, Math.PI * 1.12, 0.11, 0x8f6b3a, -2.10), true, -0.56, 3.45, 0.02);
            placeOnWall(createCrescentMesh(0.30, 0.13, Math.PI * 1.08, 0.11, 0x586d82,  0.85), true, -0.82, 3.98, 0.02);

            // Arch / tapal kuda abu-abu gelap besar (sangat jelas di foto bawah)
            placeOnWall(createCrescentMesh(0.38, 0.16, Math.PI * 1.12, 0.13, 0x3b4859,  1.56, 1.05, 0.92), true, 0.12, 4.95, 0.02);

            // Blok biru miring kecil + dome zaitun + sabit emas-kuning vertikal besar
            const blueBar1 = new THREE.Mesh(
                new THREE.BoxGeometry(0.15, 0.11, 0.36),
                new THREE.MeshStandardMaterial({ color: 0x4b648c, roughness: 0.82 })
            );
            blueBar1.rotateY(0.45);
            placeOnWall(blueBar1, true, -0.22, 6.18, 0.05);

            placeOnWall(createDomeHold(0.25, 0.16, 0x8a7d4a, 1.1, 0.85, 0.25), true, -0.55, 6.95, 0.0);
            placeOnWall(createCrescentMesh(0.48, 0.19, Math.PI * 1.08, 0.14, 0xc59d36, -0.08, 0.95, 1.05), true, -0.58, 7.95, 0.02);

            const blueBar2 = new THREE.Mesh(
                new THREE.BoxGeometry(0.14, 0.10, 0.38),
                new THREE.MeshStandardMaterial({ color: 0x486085, roughness: 0.82 })
            );
            blueBar2.rotateY(0.55);
            placeOnWall(blueBar2, true, 0.24, 7.75, 0.05);

            placeOnWall(createDomeHold(0.21, 0.14, 0xb06844, 1.15, 0.9, -0.3), true, 0.72, 8.90, 0.0);

            // White Half-Dome Scoop Shell + wedge biru di sudut kiri atasnya + half-moon emas kanan
            placeOnWall(createWhiteScoopShell(), true, -0.34, 10.15, 0.0);
            const blueWedge = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, 0.09, 0.14),
                new THREE.MeshStandardMaterial({ color: 0x466088, roughness: 0.82 })
            );
            blueWedge.rotateY(0.22);
            placeOnWall(blueWedge, true, -0.76, 10.62, 0.04);
            placeOnWall(createDomeHold(0.21, 0.15, 0xcfa32e, 1.15, 0.88, 0.15), true, 0.70, 10.85, 0.0);

            // Rel diagonal bergelombang kuning-oker
            placeOnWall(createWavyYellowRail(), true, -0.42, 12.60, 0.04);

            // Volume Heksagonal Gelap Besar + 2 volume segitiga kecil di sisi kanan
            placeOnWall(createHexVolume(0.49, 0.32), true, -0.52, 14.35, 0.0);
            placeOnWall(createPyramidVolume(0.24, 0.18, 0x857263, 1.55), true, 0.72, 14.00, 0.0);
            placeOnWall(createPyramidVolume(0.22, 0.17, 0xc2653b, 0.25), true, 0.62, 14.68, 0.0);

            // Sepasang Volume Piramida Segitiga Besar (Krem-Kuning kiri & Terakota-Oranye kanan)
            placeOnWall(createPyramidVolume(0.52, 0.34, 0xd8be74,  0.08), true, -0.34, 15.55, 0.0);
            placeOnWall(createPyramidVolume(0.51, 0.34, 0xc95c32, -0.26), true,  0.76, 15.40, 0.0);

            // Macro Pocket Abu-Taupe kanan + Coral-Merah tengah + Coral-Peach kiri + Hook Kuning-Emas puncak
            placeOnWall(createSculptedMacro(0.30, 0.24, 0x7a6d65, true),  true,  0.72, 16.52, 0.0);
            placeOnWall(createSculptedMacro(0.24, 0.18, 0xcc4b43, false), true, -0.24, 16.68, 0.0);
            placeOnWall(createSculptedMacro(0.23, 0.17, 0xd98476, false), true, -0.46, 17.32, 0.0);
            placeOnWall(createCrescentMesh(0.25, 0.10, Math.PI * 1.20, 0.10, 0xc99c2e, -2.35), true, -0.32, 18.30, 0.02);
            placeOnWall(createDomeHold(0.18, 0.12, 0x9b8e58, 1.2, 0.85, 0.2), true, 0.32, 18.85, 0.0);

            // -----------------------------------------------------------------
            // C. HOLD KECIL-MENENGAH (4 BENTUK REALISTIS: JUG, CRIMP, PINCH, FOOTHOLD)
            //    Wall kiri lebih lega & redup; wall kanan padat & berwarna-warni
            // -----------------------------------------------------------------
            const holdMat = new THREE.MeshStandardMaterial({ roughness: 0.84, metalness: 0.04 });

            const jugGeo = new THREE.SphereGeometry(0.088, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.62);
            jugGeo.scale(1.18, 0.72, 0.92);

            const crimpGeo = new THREE.BoxGeometry(0.17, 0.055, 0.068);

            const pinchGeo = new THREE.DodecahedronGeometry(0.082, 0);
            pinchGeo.scale(1.25, 0.64, 0.78);

            const jibGeo = new THREE.ConeGeometry(0.058, 0.045, 5);
            jibGeo.translate(0, 0.022, 0);

            const leftPalette = [
                0x6e6862, 0x57524e, 0x8f5b46, 0x454341,
                0x9c8652, 0x383a3e, 0x7d4c45, 0x5b7082
            ];
            const rightPalette = [
                0xe04856, 0xd93848, 0xe0b42c, 0xc99628,
                0x292d34, 0x3b6ea8, 0x4d7c47, 0xd46b2c,
                0x857863, 0xdf5868, 0x343a40, 0xb89d42
            ];

            const scatterHoldType = (geo, leftCount, rightCount, scaleMin, scaleMax, lift) => {
                const total = leftCount + rightCount;
                const inst = new THREE.InstancedMesh(geo, holdMat, total);
                const dummy = new THREE.Object3D();
                const col = new THREE.Color();

                for (let i = 0; i < total; i++) {
                    const isRight = i >= leftCount;
                    const profile = isRight ? rightProfile : leftProfile;
                    const cx = isRight ? RIGHT_CENTER_X : LEFT_CENTER_X;
                    const lx = (rng() - 0.5) * (WALL_WIDTH - 0.24);
                    const y = 0.55 + rng() * (WALL_HEIGHT - 0.95);
                    const surf = getWallSurfaceAtY(profile, y);

                    dummy.position.set(cx + lx, y, surf.z).addScaledVector(surf.normal, lift);
                    dummy.quaternion.setFromUnitVectors(up, surf.normal);
                    dummy.rotateY(rng() * Math.PI * 2);
                    const sc = scaleMin + rng() * (scaleMax - scaleMin);
                    dummy.scale.set(sc, sc * (0.82 + rng() * 0.35), sc);
                    dummy.updateMatrix();
                    inst.setMatrixAt(i, dummy.matrix);

                    const pal = isRight ? rightPalette : leftPalette;
                    col.setHex(pal[Math.floor(rng() * pal.length)]);
                    inst.setColorAt(i, col);
                }
                inst.instanceMatrix.needsUpdate = true;
                if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
                holdsGroup.add(inst);
            };

            // Total: ~115 hold kecil di wall kiri (lega) & ~355 hold di wall kanan (padat seperti foto)
            scatterHoldType(jugGeo,   35, 115, 0.72, 1.32, 0.008);
            scatterHoldType(crimpGeo, 25,  80, 0.68, 1.22, 0.022);
            scatterHoldType(pinchGeo, 30,  90, 0.70, 1.28, 0.024);
            scatterHoldType(jibGeo,   25,  70, 0.65, 1.15, 0.005);

            // Quickdraw & Top Anchor (tetap sama)
            const qdMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.7, roughness: 0.35 });
            const slingMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6 });
            const qdGeo = new THREE.BoxGeometry(0.04, 0.24, 0.04);
            const anchorGeo = new THREE.TorusGeometry(0.08, 0.02, 6, 12);

            [false, true].forEach((isRight) => {
                const profile = isRight ? rightProfile : leftProfile;
                const cx = isRight ? RIGHT_CENTER_X : LEFT_CENTER_X;
                for (let y = 3.2; y <= 17.6; y += 2.4) {
                    const surf = getWallSurfaceAtY(profile, y);
                    const qd = new THREE.Mesh(qdGeo, slingMat);
                    qd.position.set(cx + (isRight ? -0.15 : 0.15), y, surf.z).addScaledVector(surf.normal, 0.06);
                    holdsGroup.add(qd);
                }
                [-0.18, 0.18].forEach((dx) => {
                    const surf = getWallSurfaceAtY(profile, 18.85);
                    const anc = new THREE.Mesh(anchorGeo, qdMat);
                    anc.position.set(cx + dx, 18.85, surf.z).addScaledVector(surf.normal, 0.06);
                    holdsGroup.add(anc);
                });
            });

            scene.add(holdsGroup);
        }

        // =========================================================================
        // 6A. POHON RINDANG HANYA DI SEBELAH KIRI WALL (ZERO OVERLAP DENGAN WALL)
        // =========================================================================
        function buildLeftTreeOnly() {
            const treeGroup = new THREE.Group();
            const rng = mulberry32(4041);

            // Tekstur kartu daun majemuk halus
            const leafCv = document.createElement('canvas');
            leafCv.width = 128;
            leafCv.height = 128;
            const lctx = leafCv.getContext('2d');
            for (let i = 0; i < 36; i++) {
                const lx = 20 + rng() * 88;
                const ly = 20 + rng() * 88;
                const rx = 7 + rng() * 8;
                const ry = 4 + rng() * 4;
                const ang = rng() * Math.PI;
                lctx.fillStyle = rng() > 0.45 ? '#5f8a3d' : '#4b6f2e';
                lctx.save();
                lctx.translate(lx, ly);
                lctx.rotate(ang);
                lctx.beginPath();
                lctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
                lctx.fill();
                lctx.restore();
            }
            const leafTex = new THREE.CanvasTexture(leafCv);
            leafTex.encoding = THREE.sRGBEncoding;

            const barkMat = new THREE.MeshStandardMaterial({ color: 0x42362b, roughness: 0.92, metalness: 0.03 });

            // Batas tegas: wall kiri mulai di X = -3.15, batas daun maksimum X = -3.38
            const TREE_X = -6.45;
            const TREE_Z = -0.25;
            const MAX_WORLD_X = -3.38;

            const trunkCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(-0.15, 2.4, 0.1),
                new THREE.Vector3(0.05, 4.8, -0.05),
                new THREE.Vector3(0.12, 6.8, 0.0)
            ]);
            const trunkMesh = new THREE.Mesh(
                new THREE.TubeGeometry(trunkCurve, 10, 0.32, 8, false),
                barkMat
            );
            trunkMesh.castShadow = true;
            treeGroup.add(trunkMesh);

            const crownGroup = new THREE.Group();
            const leafPlacements = [];

            const branchConfigs = [
                { pts: [[0.08, 6.5, 0], [0.35, 9.2, 0.35], [0.55, 12.2, 0.45], [0.65, 14.6, 0.25]], r: 0.16 },
                { pts: [[0.05, 6.2, 0], [-0.55, 8.8, -0.3], [-0.45, 11.8, 0.1], [-0.15, 14.8, 0.15]], r: 0.16 },
                { pts: [[0, 5.5, 0], [-1.25, 7.5, 0.6], [-2.15, 10.2, 0.8], [-2.65, 12.6, 0.4]], r: 0.15 },
                { pts: [[0.05, 5.0, 0.1], [0.45, 6.6, 0.85], [0.68, 8.5, 1.05], [0.72, 10.2, 0.85]], r: 0.13 },
                { pts: [[-0.02, 5.8, -0.1], [-1.05, 8.2, -1.1], [-1.85, 10.8, -1.4], [-1.65, 12.8, -1.1]], r: 0.14 }
            ];

            branchConfigs.forEach((b) => {
                const vecs = b.pts.map((p) => {
                    const worldX = TREE_X + p[0];
                    const clampedRelX = worldX > MAX_WORLD_X - 0.75 ? (MAX_WORLD_X - 0.75 - TREE_X) : p[0];
                    return new THREE.Vector3(clampedRelX, p[1], p[2]);
                });
                const curve = new THREE.CatmullRomCurve3(vecs);
                const brMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, b.r, 6, false), barkMat);
                brMesh.castShadow = true;
                crownGroup.add(brMesh);

                for (let k = 0; k < 12; k++) {
                    const u = 0.35 + rng() * 0.65;
                    const p = curve.getPointAt(u);
                    const ang = rng() * Math.PI * 2;
                    const dist = 0.45 + rng() * 0.85;
                    const lx = p.x + Math.cos(ang) * dist;
                    const ly = p.y + (rng() - 0.4) * 0.85;
                    const lz = p.z + Math.sin(ang) * dist;

                    // Pastikan tepi terluar daun tidak melewati batas aman wall kiri
                    if (TREE_X + lx + 0.65 > MAX_WORLD_X) continue;

                    leafPlacements.push({
                        pos: new THREE.Vector3(lx, ly, lz),
                        scale: 0.75 + rng() * 0.55
                    });
                }
            });

            if (leafPlacements.length > 0) {
                const leafGeo = new THREE.PlaneGeometry(1.2, 1.2);
                const leafMat = new THREE.MeshStandardMaterial({
                    map: leafTex,
                    alphaTest: 0.35,
                    side: THREE.DoubleSide,
                    roughness: 0.88
                });
                const instLeaves = new THREE.InstancedMesh(leafGeo, leafMat, leafPlacements.length * 2);
                const d = new THREE.Object3D();
                const col = new THREE.Color();
                const leafTints = [0x9abf72, 0x82a85e, 0x6e944d];

                let idx = 0;
                for (let i = 0; i < leafPlacements.length; i++) {
                    const lp = leafPlacements[i];
                    col.setHex(leafTints[i % leafTints.length]);

                    d.position.copy(lp.pos);
                    d.rotation.set((rng() - 0.5) * 0.7, rng() * Math.PI, (rng() - 0.5) * 0.7);
                    d.scale.setScalar(lp.scale);
                    d.updateMatrix();
                    instLeaves.setMatrixAt(idx, d.matrix);
                    instLeaves.setColorAt(idx, col);
                    idx++;

                    d.rotation.y += Math.PI / 2;
                    d.updateMatrix();
                    instLeaves.setMatrixAt(idx, d.matrix);
                    instLeaves.setColorAt(idx, col);
                    idx++;
                }
                instLeaves.instanceMatrix.needsUpdate = true;
                if (instLeaves.instanceColor) instLeaves.instanceColor.needsUpdate = true;
                crownGroup.add(instLeaves);
            }

            treeGroup.add(crownGroup);
            treeGroup.position.set(TREE_X, 0, TREE_Z);
            scene.add(treeGroup);

            // Lampu sorot malam lembut di pangkal pohon kiri
            const treeSpot = new THREE.PointLight(0xffedd5, 0.85, 10.5);
            treeSpot.position.set(TREE_X + 0.8, 3.2, 1.2);
            scene.add(treeSpot);

            return crownGroup;        }

        function buildEnvironment() {
            const gCanvas = document.createElement('canvas');
            gCanvas.width = 256;
            gCanvas.height = 256;
            const ctx = gCanvas.getContext('2d');
            ctx.fillStyle = '#475569';
            ctx.fillRect(0, 0, 256, 256);
            ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
            ctx.lineWidth = 2;
            for (let y = 0; y < 256; y += 32) {
                const offset = (y / 32) % 2 === 0 ? 0 : 16;
                for (let x = -16; x < 256; x += 32) {
                    ctx.fillStyle = ((x + y) % 64 === 0) ? '#645452' : '#5b4e4c';
                    ctx.fillRect(x + offset + 1, y + 1, 30, 30);
                    ctx.strokeRect(x + offset, y, 32, 32);
                }
            }
            const gTex = new THREE.CanvasTexture(gCanvas);
            gTex.wrapS = THREE.RepeatWrapping;
            gTex.wrapT = THREE.RepeatWrapping;
            gTex.repeat.set(16, 16);
            gTex.encoding = THREE.sRGBEncoding;

            const ground = new THREE.Mesh(
                new THREE.PlaneGeometry(56, 56),
                new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.92, metalness: 0.05 })
            );
            ground.rotation.x = -Math.PI / 2;
            ground.receiveShadow = true;
            scene.add(ground);

            const baseMesh = new THREE.Mesh(
                new THREE.BoxGeometry(7.2, 0.24, 3.8),
                new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.85 })
            );
            baseMesh.position.set(0, 0.12, -0.45);
            baseMesh.receiveShadow = true;
            scene.add(baseMesh);
        }

        // =========================================================================
        // 6B. AKTIVITAS KOMUNITAS ANIMASI (PREPARE, NONTON, KANOPI NGOPI, KUCING)
        // =========================================================================
        function createStylizedPerson(opts = {}) {
            const skinMat = new THREE.MeshStandardMaterial({ color: opts.skin || 0xe7b98a, roughness: 0.78 });
            const shirtMat = new THREE.MeshStandardMaterial({ color: opts.shirt || 0x3b82f6, roughness: 0.82 });
            const pantsMat = new THREE.MeshStandardMaterial({ color: opts.pants || 0x334155, roughness: 0.88 });
            const shoeMat = new THREE.MeshStandardMaterial({ color: opts.shoe || 0xf97316, roughness: 0.7 });
            const hairMat = new THREE.MeshStandardMaterial({ color: opts.hair || 0x1e1b18, roughness: 0.85 });
            const harnessMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.65 });
            const harnessTrimMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6 });

            const root = new THREE.Group();
            const pelvis = new THREE.Group();
            pelvis.position.y = 0.88;
            root.add(pelvis);

            // Pinggul / celana
            const hipMesh = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.14, 0.19), pantsMat);
            pelvis.add(hipMesh);

            if (opts.harness) {
                const waistBelt = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.065, 0.22), harnessMat);
                waistBelt.position.y = 0.04;
                pelvis.add(waistBelt);
                const belayLoop = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.011, 6, 12), harnessTrimMat);
                belayLoop.position.set(0, 0.03, 0.11);
                pelvis.add(belayLoop);
                // Chalk bag di pinggang belakang
                const chalkBag = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.052, 0.042, 0.13, 10),
                    new THREE.MeshStandardMaterial({ color: opts.chalkColor || 0xe11d48, roughness: 0.8 })
                );
                chalkBag.position.set(0.04, 0.0, -0.14);
                chalkBag.rotation.x = 0.2;
                pelvis.add(chalkBag);
            }

            // Badan / torso
            const torso = new THREE.Group();
            torso.position.y = 0.07;
            pelvis.add(torso);

            const chest = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.44, 0.19), shirtMat);
            chest.position.y = 0.22;
            chest.castShadow = true;
            torso.add(chest);

            // Kepala + rambut/topi
            const headGroup = new THREE.Group();
            headGroup.position.set(0, 0.46, 0);
            torso.add(headGroup);

            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.08, 8), skinMat);
            neck.position.y = 0.03;
            headGroup.add(neck);

            const head = new THREE.Mesh(new THREE.SphereGeometry(0.118, 12, 10), skinMat);
            head.position.y = 0.16;
            head.castShadow = true;
            headGroup.add(head);

            const hair = new THREE.Mesh(
                new THREE.SphereGeometry(0.123, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
                hairMat
            );
            hair.position.set(0, 0.17, -0.01);
            headGroup.add(hair);

            if (opts.capColor) {
                const capMat = new THREE.MeshStandardMaterial({ color: opts.capColor, roughness: 0.7 });
                const capDome = new THREE.Mesh(
                    new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
                    capMat
                );
                capDome.position.set(0, 0.18, 0);
                headGroup.add(capDome);
                const brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.018, 0.12), capMat);
                brim.position.set(0, 0.185, 0.105);
                headGroup.add(brim);
            }

            // Lengan kiri & kanan (articulated bahu -> siku -> tangan)
            const buildArm = (sideX) => {
                const shoulder = new THREE.Group();
                shoulder.position.set(sideX * 0.21, 0.41, 0);
                torso.add(shoulder);

                const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, 0.14, 8), shirtMat);
                sleeve.position.y = -0.06;
                shoulder.add(sleeve);

                const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.28, 8), skinMat);
                upperArm.position.y = -0.15;
                upperArm.castShadow = true;
                shoulder.add(upperArm);

                const elbow = new THREE.Group();
                elbow.position.y = -0.29;
                shoulder.add(elbow);

                const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.031, 0.26, 8), skinMat);
                forearm.position.y = -0.13;
                forearm.castShadow = true;
                elbow.add(forearm);

                const hand = new THREE.Group();
                hand.position.y = -0.27;
                elbow.add(hand);

                const handMesh = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 8), skinMat);
                hand.add(handMesh);

                return { shoulder, elbow, hand };
            };

            const leftArm = buildArm(-1);
            const rightArm = buildArm(1);

            // Kaki kiri & kanan (articulated pinggul -> lutut -> sepatu)
            const buildLeg = (sideX) => {
                const hip = new THREE.Group();
                hip.position.set(sideX * 0.095, -0.04, 0);
                pelvis.add(hip);

                const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.053, 0.42, 8), pantsMat);
                thigh.position.y = -0.21;
                thigh.castShadow = true;
                hip.add(thigh);

                if (opts.harness) {
                    const legLoop = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.066, 0.055, 8), harnessMat);
                    legLoop.position.y = -0.12;
                    hip.add(legLoop);
                }

                const knee = new THREE.Group();
                knee.position.y = -0.42;
                hip.add(knee);

                const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.040, 0.40, 8), pantsMat);
                shin.position.y = -0.20;
                shin.castShadow = true;
                knee.add(shin);

                const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.065, 0.20), shoeMat);
                shoe.position.set(0, -0.41, 0.045);
                shoe.castShadow = true;
                knee.add(shoe);

                return { hip, knee };
            };

            const leftLeg = buildLeg(-1);
            const rightLeg = buildLeg(1);

            return { root, pelvis, torso, headGroup, leftArm, rightArm, leftLeg, rightLeg };
        }

        function createStylizedCat(furHex, bellyHex, accentHex) {
            const furMat = new THREE.MeshStandardMaterial({ color: furHex, roughness: 0.85 });
            const bellyMat = new THREE.MeshStandardMaterial({ color: bellyHex, roughness: 0.88 });
            const accentMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.85 });
            const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111827 });
            const noseMat = new THREE.MeshBasicMaterial({ color: 0xf472b6 });

            const root = new THREE.Group();
            const bodyGroup = new THREE.Group();
            bodyGroup.position.y = 0.22;
            root.add(bodyGroup);

            // Tubuh kucing
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.105, 0.36, 10), furMat);
            torso.rotation.x = Math.PI / 2;
            torso.castShadow = true;
            bodyGroup.add(torso);

            const chest = new THREE.Mesh(new THREE.SphereGeometry(0.098, 10, 8), bellyMat);
            chest.position.set(0, -0.01, 0.16);
            bodyGroup.add(chest);

            const rump = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), furMat);
            rump.position.set(0, 0, -0.17);
            bodyGroup.add(rump);

            // Garis punggung lucu
            const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.24), accentMat);
            stripe.position.set(0, 0.092, -0.02);
            bodyGroup.add(stripe);

            // Kepala & telinga lancip
            const headGroup = new THREE.Group();
            headGroup.position.set(0, 0.08, 0.23);
            bodyGroup.add(headGroup);

            const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), furMat);
            head.castShadow = true;
            headGroup.add(head);

            const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 8), bellyMat);
            muzzle.position.set(0, -0.025, 0.088);
            headGroup.add(muzzle);

            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 6), noseMat);
            nose.position.set(0, -0.01, 0.128);
            headGroup.add(nose);

            [-0.042, 0.042].forEach((ex) => {
                const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), eyeMat);
                eye.position.set(ex, 0.018, 0.092);
                headGroup.add(eye);
            });

            const earGeo = new THREE.ConeGeometry(0.036, 0.08, 4);
            [-0.062, 0.062].forEach((ex) => {
                const ear = new THREE.Mesh(earGeo, accentMat);
                ear.position.set(ex, 0.105, 0.01);
                ear.rotation.z = ex < 0 ? 0.24 : -0.24;
                headGroup.add(ear);
            });

            // Ekor tegak melengkung yang bisa goyang
            const tailPivot = new THREE.Group();
            tailPivot.position.set(0, 0.04, -0.24);
            bodyGroup.add(tailPivot);

            const tailLower = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.22, 8), furMat);
            tailLower.position.set(0, 0.09, -0.05);
            tailLower.rotation.x = -0.45;
            tailPivot.add(tailLower);

            const tailTip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.022, 0.15, 8), bellyMat);
            tailTip.position.set(0, 0.22, -0.08);
            tailTip.rotation.x = 0.28;
            tailPivot.add(tailTip);

            // 4 kaki animasi jalan
            const legGeo = new THREE.CylinderGeometry(0.024, 0.020, 0.18, 8);
            const pawGeo = new THREE.SphereGeometry(0.026, 8, 6);
            const legPositions = [
                [-0.06, 0.13],  // FL
                [ 0.06, 0.13],  // FR
                [-0.06, -0.14], // BL
                [ 0.06, -0.14]  // BR
            ];
            const legs = legPositions.map(([lx, lz]) => {
                const pivot = new THREE.Group();
                pivot.position.set(lx, -0.05, lz);
                bodyGroup.add(pivot);
                const leg = new THREE.Mesh(legGeo, furMat);
                leg.position.y = -0.08;
                pivot.add(leg);
                const paw = new THREE.Mesh(pawGeo, bellyMat);
                paw.position.set(0, -0.16, 0.012);
                pivot.add(paw);
                return pivot;
            });

            return { root, bodyGroup, headGroup, tailPivot, legs };
        }

        function buildLivingCommunityActivities() {
            const group = new THREE.Group();
            scene.add(group);

            const actors = {
                lastSec: 0,
                treeCrown: null,
                preparers: [],
                spectators: [],
                hanger: null,
                coffeeSteam: [],
                cats: [],
                chalkPuffs: []
            };

            // Pohon rindang hanya di sebelah kiri wall
            actors.treeCrown = buildLeftTreeOnly();

            // -----------------------------------------------------------------
            // A. ORANG-ORANG PREPARE MANJAT DI BAWAH WALL (CHALK-UP, IKAT TALI, BETA)
            // -----------------------------------------------------------------
            const chalkBucket = new THREE.Mesh(
                new THREE.CylinderGeometry(0.11, 0.095, 0.22, 12),
                new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.7 })
            );
            chalkBucket.position.set(-2.30, 0.11, 1.85);
            chalkBucket.castShadow = true;
            group.add(chalkBucket);

            const chalkPowder = new THREE.Mesh(
                new THREE.CircleGeometry(0.095, 12),
                new THREE.MeshBasicMaterial({ color: 0xf8fafc })
            );
            chalkPowder.rotation.x = -Math.PI / 2;
            chalkPowder.position.set(-2.30, 0.225, 1.85);
            group.add(chalkPowder);

            // Gulungan tali climbing di bawah wall kanan
            const ropeMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.85 });
            for (let r = 0; r < 3; r++) {
                const coil = new THREE.Mesh(new THREE.TorusGeometry(0.24 - r * 0.03, 0.022, 6, 16), ropeMat);
                coil.rotation.x = Math.PI / 2;
                coil.position.set(0.82, 0.025 + r * 0.028, 2.05);
                group.add(coil);
            }

            // Ransel peralatan
            const backpack = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, 0.42, 0.18),
                new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.88 })
            );
            backpack.position.set(-0.62, 0.21, 2.25);
            backpack.rotation.y = 0.4;
            backpack.castShadow = true;
            group.add(backpack);

            // Pemanjat 1 (bawah wall kiri): sedang chalk-up & melirik jalur ke atas
            const prep1 = createStylizedPerson({
                shirt: 0xef4444, pants: 0x1e293b, shoe: 0xfacc15,
                skin: 0xe6b68a, hair: 0x1c1917, harness: true, chalkColor: 0x38bdf8
            });
            prep1.root.position.set(-1.85, 0, 1.95);
            prep1.root.rotation.y = Math.PI + 0.18;
            group.add(prep1.root);
            actors.preparers.push({ person: prep1, type: 'chalkup', phase: 0 });

            // Kepulan debu kapur tipis
            const puffGeo = new THREE.SphereGeometry(0.045, 8, 8);
            for (let k = 0; k < 3; k++) {
                const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
                const puff = new THREE.Mesh(puffGeo, puffMat);
                puff.position.set(-1.85, 1.15, 1.82);
                group.add(puff);
                actors.chalkPuffs.push({ mesh: puff, mat: puffMat, phase: k * 2.1 });
            }

            // Pemanjat 2 (bawah wall kanan): sedang cek simpul tali
            const prep2 = createStylizedPerson({
                shirt: 0x10b981, pants: 0x334155, shoe: 0xf97316,
                skin: 0xd9a273, hair: 0x292524, capColor: 0xf97316, harness: true, chalkColor: 0xf59e0b
            });
            prep2.root.position.set(1.25, 0, 2.15);
            prep2.root.rotation.y = Math.PI - 0.25;
            group.add(prep2.root);
            actors.preparers.push({ person: prep2, type: 'tiein', phase: 1.4 });

            // Pemanjat 3: diskusi beta menunjuk rute atas
            const prep3 = createStylizedPerson({
                shirt: 0x6366f1, pants: 0x475569, shoe: 0x22d3ee,
                skin: 0xe8bc94, hair: 0x111827, harness: true, chalkColor: 0xa855f7
            });
            prep3.root.position.set(2.15, 0, 2.55);
            prep3.root.rotation.y = Math.PI - 0.55;
            group.add(prep3.root);
            actors.preparers.push({ person: prep3, type: 'beta', phase: 2.6 });

            // -----------------------------------------------------------------
            // B. PENONTON DUDUK DI LANTAI MEMAKAI KARPET HITAM (SESUAI REQUEST)
            // -----------------------------------------------------------------
            const createBlackCarpetTexture = () => {
                const cv = document.createElement('canvas');
                cv.width = 256;
                cv.height = 256;
                const ctx = cv.getContext('2d');
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(0, 0, 256, 256);

                // Anyaman tipis hitam arang
                ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
                for (let y = 0; y < 256; y += 8) {
                    ctx.fillRect(0, y, 256, 2);
                }
                ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
                for (let x = 0; x < 256; x += 8) {
                    ctx.fillRect(x, 0, 2, 256);
                }

                // Garis tepi abu gelap
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 10;
                ctx.strokeRect(12, 12, 232, 232);

                ctx.strokeStyle = '#334155';
                ctx.lineWidth = 3;
                ctx.strokeRect(24, 24, 208, 208);

                const tex = new THREE.CanvasTexture(cv);
                tex.encoding = THREE.sRGBEncoding;
                return tex;
            };

            const blackCarpetTex = createBlackCarpetTexture();
            const buildBlackFloorCarpet = (x, z, rotY, width, depth) => {
                const carpetMat = new THREE.MeshStandardMaterial({
                    map: blackCarpetTex,
                    roughness: 0.94,
                    metalness: 0.02
                });
                const carpet = new THREE.Mesh(new THREE.BoxGeometry(width, 0.028, depth), carpetMat);
                carpet.position.set(x, 0.014, z);
                carpet.rotation.y = rotY;
                carpet.receiveShadow = true;
                group.add(carpet);
            };

            // Dua karpet komunitas hitam pekat di lantai depan wall
            buildBlackFloorCarpet(-1.65, 5.75, 0.06, 3.05, 1.85);
            buildBlackFloorCarpet( 1.75, 5.85, -0.08, 3.05, 1.85);

            // Botol minum & snack
            const bottle1 = new THREE.Mesh(
                new THREE.CylinderGeometry(0.036, 0.038, 0.20, 10),
                new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.35 })
            );
            bottle1.position.set(-0.65, 0.125, 5.35);
            bottle1.castShadow = true;
            group.add(bottle1);

            const snackBag = new THREE.Mesh(
                new THREE.BoxGeometry(0.24, 0.14, 0.16),
                new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.85 })
            );
            snackBag.position.set(0.85, 0.095, 5.45);
            snackBag.rotation.y = 0.4;
            snackBag.castShadow = true;
            group.add(snackBag);

            const makeCarpetSpectator = (cfg) => {
                const p = createStylizedPerson(cfg);
                p.root.position.set(cfg.x, 0, cfg.z);
                p.root.rotation.y = cfg.rotY;

                p.pelvis.position.y = 0.15;
                if (cfg.pose === 'kneesUp') {
                    p.leftLeg.hip.rotation.set(-1.18, 0.16, 0);
                    p.leftLeg.knee.rotation.set(1.92, 0, 0);
                    p.rightLeg.hip.rotation.set(-1.10, -0.18, 0);
                    p.rightLeg.knee.rotation.set(1.85, 0, 0);
                } else {
                    p.leftLeg.hip.rotation.set(-1.38, 0.58, -0.26);
                    p.leftLeg.knee.rotation.set(1.82, 0, 0);
                    p.rightLeg.hip.rotation.set(-1.38, -0.58, 0.26);
                    p.rightLeg.knee.rotation.set(1.82, 0, 0);
                }

                p.torso.rotation.x = -0.10;
                p.headGroup.rotation.x = -0.46;
                p.leftArm.shoulder.rotation.set(-0.42, 0, 0.14);
                p.leftArm.elbow.rotation.x = -0.82;
                p.rightArm.shoulder.rotation.set(-0.42, 0, -0.14);
                p.rightArm.elbow.rotation.x = -0.82;

                if (cfg.drink) {
                    const cup = new THREE.Mesh(
                        new THREE.CylinderGeometry(0.036, 0.028, 0.11, 8),
                        new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.4 })
                    );
                    cup.position.set(0, -0.02, 0.04);
                    p.rightArm.hand.add(cup);
                }

                group.add(p.root);
                actors.spectators.push({
                    person: p,
                    style: cfg.style || 'watch',
                    phase: cfg.phase || 0
                });
            };

            makeCarpetSpectator({
                x: -2.45, z: 5.75, rotY: Math.PI + 0.14,
                shirt: 0xec4899, pants: 0x1e293b, shoe: 0xf8fafc, skin: 0xe6b88a,
                pose: 'cross', style: 'point', phase: 0.2
            });
            makeCarpetSpectator({
                x: -1.42, z: 5.95, rotY: Math.PI + 0.06,
                shirt: 0x38bdf8, pants: 0x334155, shoe: 0x0f172a, skin: 0xd29c70, capColor: 0x1e293b,
                pose: 'kneesUp', style: 'watch', phase: 1.5
            });
            makeCarpetSpectator({
                x: 0.72, z: 5.95, rotY: Math.PI - 0.06,
                shirt: 0xfacc15, pants: 0x1f2937, shoe: 0xf97316, skin: 0xe0ac82,
                pose: 'cross', style: 'nod', phase: 2.3
            });
            makeCarpetSpectator({
                x: 1.78, z: 5.72, rotY: Math.PI - 0.16,
                shirt: 0x22c55e, pants: 0x334155, shoe: 0xef4444, skin: 0xcf976b,
                pose: 'kneesUp', style: 'clap', phase: 0.9
            });
            makeCarpetSpectator({
                x: 2.68, z: 6.02, rotY: Math.PI - 0.22,
                shirt: 0xa855f7, pants: 0x1e293b, shoe: 0xe2e8f0, skin: 0xe5b78c,
                pose: 'cross', drink: true, style: 'sip', phase: 3.1
            });

            // -----------------------------------------------------------------
            // C. ORANG GELANTUNGAN SAMBIL NGOPI DI KANOPI ATAS SAMPING KANAN WALL BIRU
            // -----------------------------------------------------------------
            const upperCanopyGroup = new THREE.Group();
            group.add(upperCanopyGroup);

            const barMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4, metalness: 0.65 });
            const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.55, metalness: 0.75 });

            const hangBarX = RIGHT_CENTER_X + 2.45;
            const hangBarY = 10.85;
            const hangBarZ = 0.42;

            const hangBar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.55, 10), barMat);
            hangBar.rotation.x = Math.PI / 2;
            hangBar.position.set(hangBarX, hangBarY, 0.30);
            upperCanopyGroup.add(hangBar);

            [-0.30, 0.90].forEach((gz) => {
                const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.46, 8), steelMat);
                rod.position.set(hangBarX, hangBarY + 0.23, gz);
                upperCanopyGroup.add(rod);
            });

            const lampShade = new THREE.Mesh(
                new THREE.ConeGeometry(0.15, 0.12, 12),
                new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 })
            );
            lampShade.position.set(hangBarX - 0.15, 11.18, 0.95);
            upperCanopyGroup.add(lampShade);

            const lampBulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.048, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0xfde68a })
            );
            lampBulb.position.set(hangBarX - 0.15, 11.11, 0.95);
            upperCanopyGroup.add(lampBulb);

            canopyLight = new THREE.PointLight(0xffd28a, isNightMode ? 1.45 : 0.25, 8.5);
            canopyLight.position.set(hangBarX - 0.10, 10.95, 1.05);
            upperCanopyGroup.add(canopyLight);

            const hangerPivot = new THREE.Group();
            hangerPivot.position.set(hangBarX, hangBarY, hangBarZ);
            hangerPivot.rotation.y = -0.22;
            upperCanopyGroup.add(hangerPivot);

            const hangerPerson = createStylizedPerson({
                shirt: 0xf59e0b, pants: 0x1e293b, shoe: 0x10b981,
                skin: 0xdfa77c, hair: 0x1c1917, capColor: 0x0f172a,
                harness: true, chalkColor: 0xef4444
            });
            hangerPerson.pelvis.position.set(0.21, -1.04, 0);
            hangerPerson.leftArm.shoulder.rotation.set(Math.PI, 0, 0);
            hangerPerson.leftArm.elbow.rotation.set(0, 0, 0);

            hangerPerson.leftLeg.hip.rotation.set(-0.35, 0, 0.08);
            hangerPerson.leftLeg.knee.rotation.set(0.95, 0, 0);
            hangerPerson.rightLeg.hip.rotation.set(-0.58, 0, -0.10);
            hangerPerson.rightLeg.knee.rotation.set(1.22, 0, 0);

            const coffeeCup = new THREE.Group();
            coffeeCup.position.set(0, -0.02, 0.045);
            const cupBody = new THREE.Mesh(
                new THREE.CylinderGeometry(0.046, 0.036, 0.115, 10),
                new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 })
            );
            coffeeCup.add(cupBody);
            const cupSleeve = new THREE.Mesh(
                new THREE.CylinderGeometry(0.044, 0.040, 0.048, 10),
                new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.8 })
            );
            coffeeCup.add(cupSleeve);
            const coffeeLiquid = new THREE.Mesh(
                new THREE.CircleGeometry(0.042, 10),
                new THREE.MeshBasicMaterial({ color: 0x3b1d0c })
            );
            coffeeLiquid.rotation.x = -Math.PI / 2;
            coffeeLiquid.position.y = 0.056;
            coffeeCup.add(coffeeLiquid);

            const steamGeo = new THREE.SphereGeometry(0.024, 6, 6);
            for (let s = 0; s < 3; s++) {
                const steamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.48 });
                const puff = new THREE.Mesh(steamGeo, steamMat);
                puff.position.set(0, 0.08 + s * 0.05, 0);
                coffeeCup.add(puff);
                actors.coffeeSteam.push({ mesh: puff, mat: steamMat, phase: s * 2.1 });
            }

            hangerPerson.rightArm.hand.add(coffeeCup);
            hangerPivot.add(hangerPerson.root);

            actors.hanger = { pivot: hangerPivot, person: hangerPerson };

            // -----------------------------------------------------------------
            // D. KUCING WARA-WIRI DI BAWAH WALL (2 KUCING LUCU)
            // -----------------------------------------------------------------
            const cat1 = createStylizedCat(0xf97316, 0xfff7ed, 0xc2410c);
            group.add(cat1.root);
            actors.cats.push({
                cat: cat1,
                waypoints: [
                    new THREE.Vector3(-3.65, 0, 1.95),
                    new THREE.Vector3(-0.65, 0, 1.95),
                    new THREE.Vector3( 0.45, 0, 3.25),
                    new THREE.Vector3( 3.55, 0, 3.35),
                    new THREE.Vector3( 4.65, 0, 2.55),
                    new THREE.Vector3( 3.55, 0, 1.75),
                    new THREE.Vector3( 0.30, 0, 1.80),
                    new THREE.Vector3(-2.90, 0, 3.45)
                ],
                segIndex: 0,
                segT: 0,
                speed: 0.92,
                pauseTimer: 0,
                walkPhase: 0,
                heading: Math.PI / 2
            });

            const cat2 = createStylizedCat(0x1e293b, 0xf8fafc, 0x0f172a);
            group.add(cat2.root);
            actors.cats.push({
                cat: cat2,
                waypoints: [
                    new THREE.Vector3( 3.25, 0, 4.35),
                    new THREE.Vector3( 0.85, 0, 4.55),
                    new THREE.Vector3(-1.45, 0, 4.45),
                    new THREE.Vector3(-3.35, 0, 4.15),
                    new THREE.Vector3(-2.65, 0, 3.55),
                    new THREE.Vector3( 0.65, 0, 3.65),
                    new THREE.Vector3( 2.85, 0, 3.65)
                ],
                segIndex: 0,
                segT: 0.35,
                speed: 0.76,
                pauseTimer: 0,
                walkPhase: 1.7,
                heading: -Math.PI / 2
            });

            actors.cats.forEach((c) => {
                c.cat.root.position.copy(c.waypoints[0]);
            });

            livingActors = actors;
        }

        function updateLivingActivities(sec) {
            if (!livingActors) return;
            const dt = livingActors.lastSec === 0 ? 0.016 : Math.min(0.05, Math.max(0, sec - livingActors.lastSec));
            livingActors.lastSec = sec;

            // Ayunan angin lembut pohon kiri
            if (livingActors.treeCrown) {
                livingActors.treeCrown.rotation.z = Math.sin(sec * 0.85) * 0.012;
                livingActors.treeCrown.rotation.x = Math.cos(sec * 0.65) * 0.008;
            }

            // 1. Animasi pemanjat prepare di bawah wall
            for (let i = 0; i < livingActors.preparers.length; i++) {
                const item = livingActors.preparers[i];
                const p = item.person;
                const t = sec + item.phase;

                if (item.type === 'chalkup') {
                    const rub = Math.sin(t * 7.5);
                    p.pelvis.position.y = 0.88 + Math.sin(t * 2.2) * 0.018;
                    p.torso.rotation.x = 0.08 + Math.sin(t * 1.4) * 0.04;
                    p.headGroup.rotation.x = -0.35 + Math.sin(t * 0.9) * 0.25;
                    p.headGroup.rotation.y = Math.sin(t * 0.7) * 0.22;

                    p.leftArm.shoulder.rotation.set(-0.78 + rub * 0.07, 0.25, 0.15);
                    p.leftArm.elbow.rotation.set(-1.15 - rub * 0.12, 0, 0);
                    p.rightArm.shoulder.rotation.set(-0.78 - rub * 0.07, -0.25, -0.15);
                    p.rightArm.elbow.rotation.set(-1.15 + rub * 0.12, 0, 0);
                } else if (item.type === 'tiein') {
                    const tie = Math.sin(t * 4.8);
                    p.pelvis.position.y = 0.88 + Math.sin(t * 1.9) * 0.012;
                    p.torso.rotation.x = 0.12;
                    p.headGroup.rotation.x = -0.10 + Math.sin(t * 0.85) * 0.35;
                    p.leftArm.shoulder.rotation.set(-0.62 + tie * 0.12, 0.32, 0.1);
                    p.leftArm.elbow.rotation.set(-0.95 + tie * 0.18, 0, 0);
                    p.rightArm.shoulder.rotation.set(-0.68 - tie * 0.12, -0.32, -0.1);
                    p.rightArm.elbow.rotation.set(-1.05 - tie * 0.16, 0, 0);
                } else if (item.type === 'beta') {
                    const pointWave = Math.max(0, Math.sin(t * 0.75));
                    p.pelvis.position.y = 0.88 + Math.sin(t * 1.8) * 0.01;
                    p.headGroup.rotation.x = -0.45 + Math.sin(t * 2.4) * 0.08;
                    p.headGroup.rotation.y = -0.25 + Math.sin(t * 0.6) * 0.28;
                    p.rightArm.shoulder.rotation.set(-0.4 - pointWave * 1.85, 0, -0.15);
                    p.rightArm.elbow.rotation.set(-0.5 + pointWave * 0.35, 0, 0);
                    p.leftArm.shoulder.rotation.set(-0.45, 0.15, 0.1);
                    p.leftArm.elbow.rotation.set(-0.9, 0, 0);
                }
            }

            for (let i = 0; i < livingActors.chalkPuffs.length; i++) {
                const cf = livingActors.chalkPuffs[i];
                const cycle = ((sec * 0.55 + cf.phase) % 1);
                cf.mesh.position.set(
                    -1.85 + Math.sin(sec * 2 + i) * 0.08,
                    1.12 + cycle * 0.38,
                    1.82 - cycle * 0.06
                );
                const sc = 0.6 + cycle * 1.35;
                cf.mesh.scale.setScalar(sc);
                cf.mat.opacity = (1 - cycle) * 0.35;
            }

            // 2. Animasi penonton duduk-duduk di atas karpet hitam
            for (let i = 0; i < livingActors.spectators.length; i++) {
                const sp = livingActors.spectators[i];
                const p = sp.person;
                const t = sec + sp.phase;

                p.torso.rotation.x = -0.10 + Math.sin(t * 1.4) * 0.035;
                p.headGroup.rotation.x = -0.46 + Math.sin(t * 1.1) * 0.09;
                p.headGroup.rotation.y = Math.sin(t * 0.55) * 0.22;

                if (sp.style === 'point') {
                    const lift = Math.max(0, Math.sin(t * 0.65));
                    p.rightArm.shoulder.rotation.set(-0.5 - lift * 1.45, 0, -0.12);
                    p.rightArm.elbow.rotation.set(-0.75 + lift * 0.45, 0, 0);
                } else if (sp.style === 'clap') {
                    const clapBurst = Math.sin(t * 0.5) > 0.35 ? Math.sin(t * 10.5) * 0.16 : 0;
                    p.leftArm.shoulder.rotation.set(-0.75, 0.32 + clapBurst, 0.15);
                    p.rightArm.shoulder.rotation.set(-0.75, -0.32 - clapBurst, -0.15);
                } else if (sp.style === 'sip') {
                    const sip = Math.max(0, Math.sin(t * 0.55));
                    p.rightArm.shoulder.rotation.set(-0.55 - sip * 0.45, -0.15, -0.08);
                    p.rightArm.elbow.rotation.set(-0.95 - sip * 0.65, 0, 0);
                }
            }

            // 3. Animasi orang gelantungan sambil ngopi di bawah kanopi kanan
            if (livingActors.hanger) {
                const { pivot, person } = livingActors.hanger;
                pivot.rotation.x = Math.sin(sec * 1.35) * 0.12;
                pivot.rotation.z = Math.cos(sec * 0.95) * 0.065;

                person.leftLeg.hip.rotation.x = -0.35 + Math.sin(sec * 1.35 - 0.6) * 0.14;
                person.rightLeg.hip.rotation.x = -0.58 + Math.sin(sec * 1.35 - 0.9) * 0.16;

                const sipCycle = Math.sin(sec * 0.72);
                const sipAmount = Math.max(0, (sipCycle - 0.15) / 0.85);
                person.rightArm.shoulder.rotation.set(-0.48 - sipAmount * 0.62, -0.22 - sipAmount * 0.18, -0.12);
                person.rightArm.elbow.rotation.set(-1.05 - sipAmount * 0.72, 0, 0);
                person.headGroup.rotation.x = -0.08 - sipAmount * 0.22;
                person.headGroup.rotation.y = 0.18 - sipAmount * 0.12;

                for (let s = 0; s < livingActors.coffeeSteam.length; s++) {
                    const st = livingActors.coffeeSteam[s];
                    const cyc = ((sec * 0.65 + st.phase * 0.3) % 1);
                    st.mesh.position.set(Math.sin(sec * 3 + s) * 0.015, 0.07 + cyc * 0.18, 0);
                    st.mesh.scale.setScalar(0.55 + cyc * 1.1);
                    st.mat.opacity = (1 - cyc) * 0.42;
                }
            }

            // 4. Animasi kucing wara-wiri di bawah wall
            for (let i = 0; i < livingActors.cats.length; i++) {
                const c = livingActors.cats[i];
                const { cat, waypoints } = c;

                if (c.pauseTimer > 0) {
                    c.pauseTimer -= dt;
                    cat.headGroup.rotation.y = Math.sin(sec * 2.4 + i) * 0.42;
                    cat.headGroup.rotation.x = -0.12 + Math.sin(sec * 1.6) * 0.08;
                    cat.tailPivot.rotation.z = Math.sin(sec * 5.2 + i) * 0.38;
                    cat.legs.forEach((lg) => { lg.rotation.x *= 0.85; });
                    continue;
                }

                const pA = waypoints[c.segIndex];
                const nextIdx = (c.segIndex + 1) % waypoints.length;
                const pB = waypoints[nextIdx];
                const dx = pB.x - pA.x;
                const dz = pB.z - pA.z;
                const segLen = Math.max(0.01, Math.hypot(dx, dz));

                c.segT += (c.speed * dt) / segLen;
                if (c.segT >= 1) {
                    c.segT = 0;
                    c.segIndex = nextIdx;
                    if (c.segIndex % 3 === 1) {
                        c.pauseTimer = 1.3 + (i * 0.6);
                    }
                }

                const curA = waypoints[c.segIndex];
                const curB = waypoints[(c.segIndex + 1) % waypoints.length];
                cat.root.position.set(
                    curA.x + (curB.x - curA.x) * c.segT,
                    0,
                    curA.z + (curB.z - curA.z) * c.segT
                );

                const targetAngle = Math.atan2(curB.x - curA.x, curB.z - curA.z);
                let angleDiff = targetAngle - c.heading;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                c.heading += angleDiff * Math.min(1, dt * 6.5);
                cat.root.rotation.y = c.heading;

                c.walkPhase += dt * c.speed * 10.5;
                const swing = Math.sin(c.walkPhase) * 0.52;
                cat.legs[0].rotation.x =  swing;
                cat.legs[3].rotation.x =  swing;
                cat.legs[1].rotation.x = -swing;
                cat.legs[2].rotation.x = -swing;

                cat.bodyGroup.position.y = 0.22 + Math.abs(Math.sin(c.walkPhase)) * 0.018;
                cat.headGroup.rotation.y = Math.sin(c.walkPhase * 0.25) * 0.18;
                cat.headGroup.rotation.x = -0.05;
                cat.tailPivot.rotation.z = Math.sin(sec * 6.2 + i) * 0.34;
            }
        }

        function applyLightingMode() {
            if (!scene) return;
            if (isNightMode) {
                scene.background = new THREE.Color(0x0b1120);
                scene.fog = new THREE.FogExp2(0x0b1120, 0.014);
                hemiLight.intensity = 0.55;
                hemiLight.color.setHex(0x93c5fd);
                hemiLight.groundColor.setHex(0x1e293b);
                dirLight.intensity = 0.72;
                dirLight.color.setHex(0xfef3c7);
                spotLeft.intensity = 1.15;
                spotRight.intensity = 1.25;
                if (canopyLight) canopyLight.intensity = 1.25;
            } else {
                scene.background = new THREE.Color(0xdbeafe);
                scene.fog = new THREE.FogExp2(0xdbeafe, 0.011);
                hemiLight.intensity = 0.95;
                hemiLight.color.setHex(0xf0f9ff);
                hemiLight.groundColor.setHex(0x94a3b8);
                dirLight.intensity = 1.25;
                dirLight.color.setHex(0xfffbeb);
                spotLeft.intensity = 0.25;
                spotRight.intensity = 0.25;
                if (canopyLight) canopyLight.intensity = 0.20;
            }
        }

        // =========================================================================
        // 7. VISUALISASI 3D GLOWING CAT PAW + LABEL NAMA & CLUSTERING
        // =========================================================================
        // =========================================================================
        // 8. KONTROL KAMERA (ORBIT + PANNING 4 ARAH MOUSE & TOUCH) & INTERAKSI TAP
        // =========================================================================
        function handleCanvasTap(clientX, clientY) {
            if (!renderer || !camera) return;
            const rect = renderer.domElement.getBoundingClientRect();
            pointerVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
            pointerVec.y = -((clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(pointerVec, camera);

            if (isAddMode) {
                const wallHits = raycaster.intersectObjects(wallInteractMeshes, false);
                if (wallHits.length > 0) {
                    const hit = wallHits[0];
                    const sn = snapPointToWallSurface(hit.point.x, hit.point.y);
                    pendingPlacement = { position: sn.pos, normal: sn.normal };
                    const nameInput = document.getElementById('input-climber-name');
                    const curName = nameInput ? nameInput.value.trim() : '';
                    markerService.setPreviewMarker3D(pendingPlacement.position, pendingPlacement.normal, curName || 'Kamu');
                    openConfirmSheet(pendingPlacement.position.y);
                } else {
                    showToast('Ketuk langsung pada permukaan dinding abu-abu atau biru.');
                }
                return;
            }

            const hits = raycaster.intersectObjects(hitTargets, false);
            if (hits.length > 0) {
                const data = hits[0].object.userData;
                if (data.type === 'cluster') {
                    closeMarkerPopup();
                    if (data.isDenseCluster || camSpherical.radius <= 10.5) {
                        openClusterListPopup(data.markers);
                    } else {
                        closeClusterListPopup();
                        targetLookAt.copy(data.targetPos);
                        targetSpherical.radius = Math.max(8.2, Math.min(9.8, targetSpherical.radius * 0.52));
                    }
                } else if (data.type === 'marker') {
                    closeClusterListPopup();
                    openMarkerPopup(data.marker);
                }
                return;
            }
            closeMarkerPopup();
            closeClusterListPopup();
        }

        // =========================================================================
        // 9. INTERAKSI UI (ADD MODE, CONFIRM SHEET, POPUP, DELETE 10 MENIT)
        // =========================================================================
        function enterAddMode() {
            closeMarkerPopup();
            closeClusterListPopup();
            isAddMode = true;
            const banner = document.getElementById('add-mode-banner');
            if (banner) banner.classList.remove('hidden');
            const addBtn = document.getElementById('add-achievement-btn');
            if (addBtn) addBtn.classList.add('opacity-50', 'pointer-events-none');
        }

        function exitAddMode() {
            isAddMode = false;
            pendingPlacement = null;
            markerService.setPreviewMarker3D(null, null);
            const banner = document.getElementById('add-mode-banner');
            if (banner) banner.classList.add('hidden');
            const addBtn = document.getElementById('add-achievement-btn');
            if (addBtn) addBtn.classList.remove('opacity-50', 'pointer-events-none');
            const sheet = document.getElementById('confirm-sheet');
            if (sheet) sheet.classList.add('hidden');
        }

        function openConfirmSheet(heightY) {
            const info = document.getElementById('confirm-coord-info');
            if (info) {
                info.textContent = `Ketinggian: ${heightY.toFixed(1)} m · Tanggal ditentukan otomatis oleh server`;
            }
            const sheet = document.getElementById('confirm-sheet');
            if (sheet) sheet.classList.remove('hidden');
            const inp = document.getElementById('input-climber-name');
            if (inp) setTimeout(() => inp.focus(), 80);
        }

        function canOwnerDelete(marker) {
            if (!marker || !currentUserId || marker.owner_id !== currentUserId) return false;
            if (!marker.created_at) return false;
            const createdMs = Date.parse(marker.created_at);
            if (isNaN(createdMs)) return false;
            return (Date.now() - createdMs) <= 10 * 60 * 1000;
        }

        function openMarkerPopup(marker) {
            selectedMarker = marker;
            const nameEl = document.getElementById('popup-climber-name');
            const dateEl = document.getElementById('popup-achieved-date');
            const heightEl = document.getElementById('popup-height-est');
            const delWrap = document.getElementById('popup-delete-wrap');
            const popup = document.getElementById('marker-popup');

            if (nameEl) nameEl.textContent = marker.name;
            if (dateEl) dateEl.textContent = formatDateIndo(marker.achieved_date);
            if (heightEl) {
                const estHeight = Number.isFinite(marker.position_y) ? Math.max(0, marker.position_y).toFixed(1) : '0.0';
                heightEl.textContent = `Estimasi ketinggian: ±${estHeight} m`;
            }
            if (delWrap) {
                if (canOwnerDelete(marker)) delWrap.classList.remove('hidden');
                else delWrap.classList.add('hidden');
            }
            if (popup) popup.classList.remove('hidden');
        }

        function closeMarkerPopup() {
            selectedMarker = null;
            const popup = document.getElementById('marker-popup');
            if (popup) popup.classList.add('hidden');
        }

        function openClusterListPopup(clusterMarkers) {
            if (!Array.isArray(clusterMarkers) || clusterMarkers.length === 0) return;
            const popup = document.getElementById('cluster-list-popup');
            const titleEl = document.getElementById('cluster-list-title');
            const subEl = document.getElementById('cluster-list-sub');
            const listEl = document.getElementById('cluster-list-items');
            if (!popup || !listEl) return;

            const avgY = clusterMarkers.reduce((s, m) => s + (Number(m.position_y) || 0), 0) / clusterMarkers.length;
            if (titleEl) titleEl.textContent = `🐾 ${clusterMarkers.length} Pemanjat di Titik Ini`;
            if (subEl) subEl.textContent = `Estimasi ketinggian ±${avgY.toFixed(1)} m · Ketuk nama untuk detail`;

            listEl.innerHTML = '';
            const sorted = [...clusterMarkers].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
            sorted.forEach((m) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'w-full text-left px-3 py-2 rounded-xl bg-slate-100 hover:bg-orange-50 border border-transparent hover:border-orange-200 transition flex items-center justify-between gap-2';

                const leftWrap = document.createElement('div');
                leftWrap.className = 'min-w-0';
                const nameDiv = document.createElement('div');
                nameDiv.className = 'text-xs font-bold text-slate-900 truncate';
                nameDiv.textContent = m.name;
                const dateDiv = document.createElement('div');
                dateDiv.className = 'text-[10px] text-slate-500';
                dateDiv.textContent = formatDateIndo(m.achieved_date);
                leftWrap.appendChild(nameDiv);
                leftWrap.appendChild(dateDiv);

                const hBadge = document.createElement('span');
                hBadge.className = 'text-[10px] font-bold text-orange-600 shrink-0';
                hBadge.textContent = `±${(Number(m.position_y) || 0).toFixed(1)} m`;

                btn.appendChild(leftWrap);
                btn.appendChild(hBadge);
                btn.addEventListener('click', () => {
                    closeClusterListPopup();
                    openMarkerPopup(m);
                });
                listEl.appendChild(btn);
            });

            popup.classList.remove('hidden');
        }

        function closeClusterListPopup() {
            const popup = document.getElementById('cluster-list-popup');
            if (popup) popup.classList.add('hidden');
        }

        function bindUIEvents() {
            const on = (id, evt, fn) => {
                const el = document.getElementById(id);
                if (el) el.addEventListener(evt, fn);
            };

            on('fatal-retry-btn', 'click', () => window.location.reload());
            on('add-achievement-btn', 'click', enterAddMode);
            on('cancel-add-mode-btn', 'click', exitAddMode);
            on('confirm-close-x', 'click', exitAddMode);
            on('confirm-cancel-btn', 'click', exitAddMode);
            on('popup-close-btn', 'click', closeMarkerPopup);
            on('cluster-close-btn', 'click', closeClusterListPopup);
            on('btn-toggle-pan', 'click', () => {
                cameraControls.setPanMode(!isPanMode);
                showToast(isPanMode ? 'Mode Geser (Pan) aktif — seret atas/bawah/kiri/kanan' : 'Mode Putar (Orbit) aktif', 2000);
            });
            on('btn-reset-cam', 'click', cameraControls.resetCamera);
            on('btn-zoom-in', 'click', () => cameraControls.zoomCamera(0.82));
            on('btn-zoom-out', 'click', () => cameraControls.zoomCamera(1.22));
            on('btn-toggle-light', 'click', () => {
                isNightMode = !isNightMode;
                applyLightingMode();
            });

            on('cloud-status-btn', 'click', supabaseService.openCloudDiagModal);
            on('cloud-diag-close', 'click', supabaseService.closeCloudDiagModal);
            on('cloud-diag-ok', 'click', supabaseService.closeCloudDiagModal);
            on('cloud-diag-retry', 'click', async () => {
                const btn = document.getElementById('cloud-diag-retry');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = 'Menghubungkan...';
                }
                await loadFirstAvailable(SUPABASE_CDNS, () => !!(window.supabase && window.supabase.createClient));
                const ok = await supabaseService.syncFromSupabase(true);
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Coba Hubungkan Ulang';
                }
                if (ok) supabaseService.closeCloudDiagModal();
            });

            on('input-climber-name', 'input', (e) => {
                const val = e.target.value;
                const countEl = document.getElementById('name-char-count');
                if (countEl) countEl.textContent = `${val.length}/32`;
                markerService.updatePreviewLabelName(val.trim() || 'Kamu');
            });

            on('confirm-form', 'submit', async (e) => {
                e.preventDefault();
                if (!pendingPlacement) return;
                const inp = document.getElementById('input-climber-name');
                const saveBtn = document.getElementById('confirm-save-btn');
                const cleanName = inp ? inp.value.trim() : '';
                if (!cleanName || cleanName.length > 32) {
                    showToast('Nama pemanjat wajib diisi (maks 32 karakter).');
                    return;
                }

                if (saveBtn) {
                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Menyimpan...';
                }
                try {
                    await supabaseService.saveMarkerToSupabase(cleanName, pendingPlacement.position, pendingPlacement.normal);
                    if (inp) inp.value = '';
                    const cnt = document.getElementById('name-char-count');
                    if (cnt) cnt.textContent = '0/32';
                    exitAddMode();
                    showToast('🐾 Cat paw berhasil tersimpan di 3D Wall!');
                } catch (err) {
                    console.warn('Save marker error:', err);
                    showToast(err && err.message ? err.message : 'Gagal menyimpan marker.');
                } finally {
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.textContent = 'Save Achievement';
                    }
                }
            });

            on('popup-delete-btn', 'click', async () => {
                if (!selectedMarker) return;
                const btn = document.getElementById('popup-delete-btn');
                const targetId = selectedMarker.id;
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = 'Menghapus...';
                }
                try {
                    await supabaseService.deleteMarkerFromSupabase(targetId);
                    closeMarkerPopup();
                    showToast('Marker berhasil dihapus.');
                } catch (err) {
                    showToast(err && err.message ? err.message : 'Gagal menghapus marker.');
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = 'Hapus Marker';
                    }
                }
            });

            window.addEventListener('resize', onWindowResize);
            window.addEventListener('online', () => supabaseService.syncFromSupabase(false));
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && navigator.onLine) {
                    supabaseService.syncFromSupabase(false);
                }
            });
        }

        // =========================================================================
        // 10. ANIMATION LOOP & BOOTSTRAP INIT
        // =========================================================================
        function onWindowResize() {
            if (!camera || !renderer) return;
            const w = window.innerWidth || 1;
            const h = window.innerHeight || 1;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        }

        function animate(time) {
            animFrameId = requestAnimationFrame(animate);
            if (document.hidden || !renderer || !scene || !camera) return;

            camSpherical.radius += (targetSpherical.radius - camSpherical.radius) * 0.12;
            camSpherical.phi += (targetSpherical.phi - camSpherical.phi) * 0.14;
            camSpherical.theta += (targetSpherical.theta - camSpherical.theta) * 0.14;
            camTarget.lerp(targetLookAt, 0.14);

            const offset = new THREE.Vector3().setFromSpherical(camSpherical);
            camera.position.copy(camTarget).add(offset);
            camera.lookAt(camTarget);

            markerService.rebuildMarkers3D(false);

            const t = (time || 0) * 0.0028;
            for (let i = 0; i < renderedPawEntries.length; i++) {
                const entry = renderedPawEntries[i];
                const pulse = entry.baseScale * (1 + Math.sin(t + entry.phase) * 0.10);
                entry.glow.scale.set(pulse, pulse, 1);
            }
            if (previewGroup && previewGroup.userData.previewGlow) {
                const p = 0.55 * (1 + Math.sin(t * 1.8) * 0.16);
                previewGroup.userData.previewGlow.scale.set(p, p, 1);
            }

            updateLivingActivities((time || 0) * 0.001);

            renderer.render(scene, camera);
        }

        function createSafeRenderer(container) {
            const configs = [
                { antialias: true, powerPreference: 'high-performance', alpha: false },
                { antialias: false, powerPreference: 'default', alpha: false },
                { antialias: false }
            ];
            let lastErr = null;
            for (const cfg of configs) {
                try {
                    const r = new THREE.WebGLRenderer(cfg);
                    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                    r.setSize(window.innerWidth, window.innerHeight);
                    r.outputEncoding = THREE.sRGBEncoding;
                    r.shadowMap.enabled = true;
                    r.shadowMap.type = THREE.PCFSoftShadowMap;
                    container.appendChild(r.domElement);
                    return r;
                } catch (err) {
                    lastErr = err;
                }
            }
            throw lastErr || new Error('Perangkat/browser tidak mendukung WebGL.');
        }

        async function init() {
            bindUIEvents();
            const subEl = document.getElementById('loading-sub');

            try {
                if (subEl) subEl.textContent = 'Memuat engine 3D Three.js...';
                const threeOk = await loadFirstAvailable(THREE_CDNS, () => typeof window.THREE !== 'undefined');
                if (!threeOk) {
                    throw new Error('Pustaka Three.js gagal dimuat dari seluruh CDN. Periksa koneksi internet.');
                }

                const container = document.getElementById('canvas-container');
                scene = new THREE.Scene();
                camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.2, 160);
                renderer = createSafeRenderer(container);

                raycaster = new THREE.Raycaster();
                pointerVec = new THREE.Vector2();
                camTarget = new THREE.Vector3(0.15, 9.6, 1.35);
                targetLookAt = camTarget.clone();
                camSpherical = new THREE.Spherical(25.5, Math.PI * 0.44, 0.34);
                targetSpherical = camSpherical.clone();

                hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.6);
                scene.add(hemiLight);

                dirLight = new THREE.DirectionalLight(0xfef3c7, 0.8);
                dirLight.position.set(10, 26, 18);
                dirLight.castShadow = true;
                dirLight.shadow.mapSize.set(1024, 1024);
                dirLight.shadow.camera.near = 2;
                dirLight.shadow.camera.far = 60;
                dirLight.shadow.camera.left = -12;
                dirLight.shadow.camera.right = 12;
                dirLight.shadow.camera.top = 24;
                dirLight.shadow.camera.bottom = -2;
                scene.add(dirLight);

                spotLeft = new THREE.PointLight(0xfff1d6, 1.15, 36);
                spotLeft.position.set(-4.2, 10.5, 9.5);
                scene.add(spotLeft);

                spotRight = new THREE.PointLight(0xe0f2fe, 1.25, 36);
                spotRight.position.set(4.5, 13.0, 11.5);
                scene.add(spotRight);

                applyLightingMode();

                const leftFrontMat = new THREE.MeshStandardMaterial({
                    map: createWallTexture(false),
                    roughness: 0.88,
                    metalness: 0.05
                });
                const rightFrontMat = new THREE.MeshStandardMaterial({
                    map: createWallTexture(true),
                    roughness: 0.84,
                    metalness: 0.05
                });
                const darkSideMat = new THREE.MeshStandardMaterial({
                    color: 0x334155,
                    roughness: 0.85,
                    metalness: 0.2
                });

                scene.add(buildWallTowerMesh(LEFT_CENTER_X, WALL_WIDTH, leftProfile, 0.24, leftFrontMat, darkSideMat));
                scene.add(buildWallTowerMesh(RIGHT_CENTER_X, WALL_WIDTH, rightProfile, 0.24, rightFrontMat, darkSideMat));

                buildSteelTrussAndCanopy();
                buildHoldsAndVolumes();
                buildEnvironment();
                buildLivingCommunityActivities();

                pinsGroup = new THREE.Group();
                previewGroup = new THREE.Group();
                scene.add(pinsGroup);
                scene.add(previewGroup);

                cameraControls.setupCameraControls(renderer.domElement);
                animate(0);

                const overlay = document.getElementById('loading-overlay');
                if (overlay) {
                    overlay.style.opacity = '0';
                    setTimeout(() => overlay.classList.add('hidden'), 320);
                }

                await loadFirstAvailable(SUPABASE_CDNS, () => !!(window.supabase && window.supabase.createClient));
                await supabaseService.syncFromSupabase(false);
            } catch (err) {
                console.error('Init 3D error:', err);
                showFatalError(err && err.message ? err.message : String(err));
            }
        }

        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    })();
