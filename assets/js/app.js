import { generateUuidV4, mulberry32, formatDateIndo } from './utils.js';
import { createSupabaseService } from './supabase.js';
import { createCameraControls } from './camera-controls.js';
import { createMarkerRenderer } from './markers.js';
import { createScene3D } from './scene3d.js';

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

        const sceneState = {};
        Object.defineProperties(sceneState, {
            scene: { get: () => scene, set: (value) => { scene = value; } },
            wallInteractMeshes: { get: () => wallInteractMeshes, set: (value) => { wallInteractMeshes = value; } },
            dirLight: { get: () => dirLight, set: (value) => { dirLight = value; } },
            hemiLight: { get: () => hemiLight, set: (value) => { hemiLight = value; } },
            spotLeft: { get: () => spotLeft, set: (value) => { spotLeft = value; } },
            spotRight: { get: () => spotRight, set: (value) => { spotRight = value; } },
            canopyLight: { get: () => canopyLight, set: (value) => { canopyLight = value; } },
            livingActors: { get: () => livingActors, set: (value) => { livingActors = value; } },
            isNightMode: { get: () => isNightMode, set: (value) => { isNightMode = value; } }
        });
        const sceneService = createScene3D(sceneState, {
            get THREE() { return window.THREE; },
            WALL_WIDTH, LEFT_CENTER_X, RIGHT_CENTER_X, WALL_HEIGHT, leftProfile, rightProfile, showToast
        });

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
            get THREE() { return window.THREE; }, snapPointToWallSurface: sceneService.snapPointToWallSurface
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
                    const sn = sceneService.snapPointToWallSurface(hit.point.x, hit.point.y);
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
                sceneService.applyLightingMode();
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

            sceneService.updateLivingActivities((time || 0) * 0.001);

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

                sceneService.applyLightingMode();

                const leftFrontMat = new THREE.MeshStandardMaterial({
                    map: sceneService.createWallTexture(false),
                    roughness: 0.88,
                    metalness: 0.05
                });
                const rightFrontMat = new THREE.MeshStandardMaterial({
                    map: sceneService.createWallTexture(true),
                    roughness: 0.84,
                    metalness: 0.05
                });
                const darkSideMat = new THREE.MeshStandardMaterial({
                    color: 0x334155,
                    roughness: 0.85,
                    metalness: 0.2
                });

                scene.add(sceneService.buildWallTowerMesh(LEFT_CENTER_X, WALL_WIDTH, leftProfile, 0.24, leftFrontMat, darkSideMat));
                scene.add(sceneService.buildWallTowerMesh(RIGHT_CENTER_X, WALL_WIDTH, rightProfile, 0.24, rightFrontMat, darkSideMat));

                sceneService.buildSteelTrussAndCanopy();
                sceneService.buildHoldsAndVolumes();
                sceneService.buildEnvironment();
                sceneService.buildLivingCommunityActivities();

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
