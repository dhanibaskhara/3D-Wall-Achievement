// 3D achievement marker, preview paw and clustering renderer.
export function createMarkerRenderer(appState, deps) {
        function initSharedPawAssets() {
            if (appState.sharedPawAssets) return appState.sharedPawAssets;

            const c = document.createElement('canvas');
            c.width = 128;
            c.height = 128;
            const ctx = c.getContext('2d');
            const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 128, 128);
            const glowTex = new deps.THREE.CanvasTexture(c);

            const makeMatSet = (padHex, rimHex, glowHex, opacity) => ({
                pad: new deps.THREE.MeshBasicMaterial({ color: padHex, transparent: opacity < 1, opacity }),
                rim: new deps.THREE.MeshBasicMaterial({ color: rimHex, transparent: opacity < 1, opacity }),
                back: new deps.THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.78 * opacity }),
                glow: new deps.THREE.SpriteMaterial({
                    map: glowTex,
                    color: glowHex,
                    transparent: true,
                    opacity: 0.72 * opacity,
                    blending: deps.THREE.AdditiveBlending,
                    depthWrite: false
                })
            });

            // Ukuran ringkas & presisi agar dinding sanggup menampung banyak paw
            appState.sharedPawAssets = {
                backDiscGeo: new deps.THREE.CircleGeometry(0.115, 20),
                rimGeo: new deps.THREE.TorusGeometry(0.115, 0.012, 8, 20),
                mainPadGeo: new deps.THREE.SphereGeometry(0.044, 10, 8),
                toeGeo: new deps.THREE.SphereGeometry(0.021, 8, 6),
                hitGeo: new deps.THREE.SphereGeometry(0.20, 8, 8),
                hitMat: new deps.THREE.MeshBasicMaterial({ visible: false }),
                anchorDotGeo: new deps.THREE.SphereGeometry(0.028, 8, 8),
                anchorDotMat: new deps.THREE.MeshBasicMaterial({ color: 0xfef3c7 }),
                spiderLineMat: new deps.THREE.LineBasicMaterial({ color: 0xfdba74, transparent: true, opacity: 0.8 }),
                styles: {
                    active:  makeMatSet(0xff922b, 0xffedd5, 0xf97316, 1.0),
                    archive: makeMatSet(0xd6b588, 0xcbd5e1, 0x94a3b8, 0.72),
                    preview: makeMatSet(0x34d399, 0xd1fae5, 0x10b981, 1.0)
                }
            };
            return appState.sharedPawAssets;
        }

        function createNameLabelSprite(nameText, styleKey) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const clean = (nameText || 'Kamu').trim().slice(0, 32) || 'Kamu';
            const fontSize = 28;
            ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
            const textW = ctx.measureText(clean).width;
            const padX = 22;
            const w = Math.min(512, Math.max(110, Math.ceil(textW + padX * 2)));
            const h = 48;
            canvas.width = w;
            canvas.height = h;

            const radius = 22;
            ctx.beginPath();
            ctx.moveTo(radius, 2);
            ctx.lineTo(w - radius, 2);
            ctx.quadraticCurveTo(w - 2, 2, w - 2, radius);
            ctx.lineTo(w - 2, h - radius);
            ctx.quadraticCurveTo(w - 2, h - 2, w - radius, h - 2);
            ctx.lineTo(radius, h - 2);
            ctx.quadraticCurveTo(2, h - 2, 2, h - radius);
            ctx.lineTo(2, radius);
            ctx.quadraticCurveTo(2, 2, radius, 2);
            ctx.closePath();

            ctx.fillStyle = styleKey === 'preview'
                ? 'rgba(6, 78, 59, 0.92)'
                : (styleKey === 'archive' ? 'rgba(30, 41, 59, 0.80)' : 'rgba(15, 23, 42, 0.90)');
            ctx.fill();

            ctx.lineWidth = 2.5;
            ctx.strokeStyle = styleKey === 'preview'
                ? '#34d399'
                : (styleKey === 'archive' ? 'rgba(203, 213, 225, 0.55)' : '#fb923c');
            ctx.stroke();

            ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
            ctx.fillStyle = styleKey === 'archive' ? '#e2e8f0' : '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(clean, w / 2, h / 2 + 1, w - 18);

            const tex = new deps.THREE.CanvasTexture(canvas);
            tex.encoding = deps.THREE.sRGBEncoding;
            const mat = new deps.THREE.SpriteMaterial({
                map: tex,
                transparent: true,
                depthTest: false
            });
            const sprite = new deps.THREE.Sprite(mat);
            const aspect = w / h;
            sprite.scale.set(0.165 * aspect, 0.165, 1);
            sprite.position.set(0, 0.21, 0.02);
            sprite.renderOrder = 20;
            sprite.userData._ownedTexture = tex;
            sprite.userData._ownedMaterial = mat;
            return sprite;
        }

        // Cat paw menempel sangat rapat ke permukaan dinding tanpa mengambang
        function createCatPaw3D(nameText, styleKey = 'active') {
            const assets = initSharedPawAssets();
            const st = assets.styles[styleKey] || assets.styles.active;            const root = new deps.THREE.Group();

            const glow = new deps.THREE.Sprite(st.glow);
            glow.scale.set(0.46, 0.46, 1);
            glow.position.z = 0.003;
            root.add(glow);

            const backDisc = new deps.THREE.Mesh(assets.backDiscGeo, st.back);
            backDisc.position.z = 0.005;
            root.add(backDisc);

            const rim = new deps.THREE.Mesh(assets.rimGeo, st.rim);
            rim.position.z = 0.007;
            root.add(rim);

            const mainPad = new deps.THREE.Mesh(assets.mainPadGeo, st.pad);
            mainPad.scale.set(1.15, 0.92, 0.32);
            mainPad.position.set(0, -0.024, 0.010);
            root.add(mainPad);

            const toes = [
                [-0.052,  0.022],
                [-0.021,  0.052],
                [ 0.021,  0.052],
                [ 0.052,  0.022]
            ];
            toes.forEach(([tx, ty]) => {
                const toe = new deps.THREE.Mesh(assets.toeGeo, st.pad);
                toe.scale.set(0.92, 1.12, 0.35);
                toe.position.set(tx, ty, 0.011);
                root.add(toe);
            });

            const labelSprite = createNameLabelSprite(nameText, styleKey);
            root.add(labelSprite);

            return { root, glow, labelSprite };
        }

        function createClusterBadge3D(count) {
            const canvas = document.createElement('canvas');
            canvas.width = 160;
            canvas.height = 160;
            const ctx = canvas.getContext('2d');

            const g = ctx.createRadialGradient(80, 80, 12, 80, 80, 78);
            g.addColorStop(0, 'rgba(249, 115, 22, 0.95)');
            g.addColorStop(0.58, 'rgba(234, 88, 12, 0.88)');
            g.addColorStop(1, 'rgba(249, 115, 22, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(80, 80, 76, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.arc(80, 80, 44, 0, Math.PI * 2);
            ctx.fillStyle = '#0f172a';
            ctx.fill();
            ctx.lineWidth = 5;
            ctx.strokeStyle = '#fb923c';
            ctx.stroke();

            ctx.font = '800 34px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`🐾${count}`, 80, 82);

            const tex = new deps.THREE.CanvasTexture(canvas);
            tex.encoding = deps.THREE.sRGBEncoding;
            const mat = new deps.THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
            const sprite = new deps.THREE.Sprite(mat);
            sprite.scale.set(0.65, 0.65, 1);
            sprite.renderOrder = 25;
            sprite.userData._ownedTexture = tex;
            sprite.userData._ownedMaterial = mat;
            return sprite;
        }

        function disposeOwnedSprites(group) {
            group.traverse((obj) => {
                if (obj.userData) {
                    if (obj.userData._ownedGeometry) {
                        obj.userData._ownedGeometry.dispose();
                    }
                    if (obj.userData._ownedTexture) {
                        obj.userData._ownedTexture.dispose();
                    }
                    if (obj.userData._ownedMaterial) {
                        obj.userData._ownedMaterial.dispose();
                    }
                }
            });
            while (group.children.length > 0) {
                group.remove(group.children[0]);
            }
        }

        function computeClusters(list, radius) {
            if (radius <= 0.05 || list.length <= 1) {
                return list.map((m) => {
                    const sn = deps.snapPointToWallSurface(m.position_x, m.position_y);
                    return {
                        isCluster: false,
                        appState.markers: [m],
                        pos: sn.pos,
                        normal: sn.normal
                    };
                });
            }
            const used = new Array(list.length).fill(false);
            const out = [];
            const r2 = radius * radius;

            for (let i = 0; i < list.length; i++) {
                if (used[i]) continue;
                used[i] = true;
                const base = list[i];
                const clusterItems = [base];
                let sx = base.position_x, sy = base.position_y;

                for (let j = i + 1; j < list.length; j++) {
                    if (used[j]) continue;
                    const o = list[j];
                    const dx = o.position_x - base.position_x;
                    const dy = o.position_y - base.position_y;
                    if (dx * dx + dy * dy <= r2) {
                        used[j] = true;
                        clusterItems.push(o);
                        sx += o.position_x;
                        sy += o.position_y;
                    }
                }
                const n = clusterItems.length;
                const avgX = sx / n;
                const avgY = sy / n;
                const sn = deps.snapPointToWallSurface(avgX, avgY);
                out.push({
                    isCluster: n > 1,
                    appState.markers: clusterItems,
                    pos: sn.pos,
                    normal: sn.normal
                });
            }
            return out;
        }

        function getClusterRadiusForCamera() {
            if (!camSpherical) return 0;
            const d = camSpherical.radius;
            if (d > 24) return 0.72;
            if (d > 16) return 0.42;
            if (d > 10.5) return 0.22;
            return 0;
        }

        function rebuildMarkers3D(force = false) {
            if (!appState.pinsGroup) return;
            const radius = getClusterRadiusForCamera();
            const bucket = Math.round(radius * 10);
            if (!force && bucket === appState.lastClusterDistBucket) return;
            appState.lastClusterDistBucket = bucket;

            disposeOwnedSprites(appState.pinsGroup);
            appState.renderedPawEntries = [];
            appState.hitTargets = [];

            const assets = initSharedPawAssets();
            const zAxis = new deps.THREE.Vector3(0, 0, 1);
            const worldUp = new deps.THREE.Vector3(0, 1, 0);

            // Jarak tumpuk spiderfy dirapatkan agar rapi & presisi
            const OVERLAP_SPIDERFY_RADIUS = 0.32;
            const MAX_SPIDERFY_COUNT = 10;
            const isCloseZoom = radius === 0;
            const groupingRadius = isCloseZoom ? OVERLAP_SPIDERFY_RADIUS : radius;
            const clusters = computeClusters(appState.markers, groupingRadius);

            const placeSinglePaw = (m, worldPos, norm) => {
                const isCurrentWeek = !appState.activeWeekStartDate || !m.week_start_date || m.week_start_date === appState.activeWeekStartDate;
                const styleKey = isCurrentWeek ? 'active' : 'archive';
                const pawObj = createCatPaw3D(m.name, styleKey);

                pawObj.root.position.copy(worldPos);
                pawObj.root.quaternion.setFromUnitVectors(zAxis, norm);
                appState.pinsGroup.add(pawObj.root);

                appState.renderedPawEntries.push({
                    glow: pawObj.glow,
                    baseScale: isCurrentWeek ? 0.46 : 0.36,
                    phase: Math.random() * Math.PI * 2
                });

                const hit = new deps.THREE.Mesh(assets.hitGeo, assets.hitMat);
                hit.position.copy(worldPos);
                hit.userData = { type: 'marker', marker: m };
                appState.pinsGroup.add(hit);
                appState.hitTargets.push(hit);
            };

            clusters.forEach((c) => {
                const norm = c.normal.lengthSq() > 0.01 ? c.normal.clone().normalize() : zAxis.clone();

                // 1. Marker tunggal: menempel sangat rapat ke permukaan dinding (offset normal hanya 1,2 cm)
                if (!c.isCluster) {
                    const m = c.appState.markers[0];
                    const pos = c.pos.clone().addScaledVector(norm, 0.012);
                    placeSinglePaw(m, pos, norm);
                    return;
                }

                // 2. Zoom dekat & 2–10 paw bertumpuk di titik sama -> Auto-Spiderfy (mekar sejajar dinding)
                if (isCloseZoom && c.appState.markers.length <= MAX_SPIDERFY_COUNT) {
                    const sorted = [...c.appState.markers].sort((a, b) => String(a.id).localeCompare(String(b.id)));
                    const n = sorted.length;
                    const anchorPos = c.pos.clone().addScaledVector(norm, 0.012);

                    const anchorDot = new deps.THREE.Mesh(assets.anchorDotGeo, assets.anchorDotMat);
                    anchorDot.position.copy(anchorPos);
                    appState.pinsGroup.add(anchorDot);

                    let wallRight = new deps.THREE.Vector3().crossVectors(worldUp, norm);
                    if (wallRight.lengthSq() < 0.001) {
                        wallRight.set(1, 0, 0);
                    } else {
                        wallRight.normalize();
                    }
                    const wallUp = new deps.THREE.Vector3().crossVectors(norm, wallRight).normalize();

                    const rx = n === 2 ? 0.22 : Math.min(0.55, 0.22 + n * 0.038);
                    const ry = n === 2 ? 0.00 : Math.min(0.44, 0.17 + n * 0.030);
                    const startAngle = n === 2 ? 0 : Math.PI / 2;

                    sorted.forEach((m, idx) => {
                        const angle = startAngle + (idx / n) * Math.PI * 2;
                        const spiderOffset = anchorPos.clone()
                            .addScaledVector(wallRight, Math.cos(angle) * rx)
                            .addScaledVector(wallUp, Math.sin(angle) * ry);
                        const sn = deps.snapPointToWallSurface(spiderOffset.x, spiderOffset.y);
                        const spiderPos = sn.pos.clone().addScaledVector(sn.normal, 0.012);

                        const lineGeo = new deps.THREE.BufferGeometry().setFromPoints([anchorPos, spiderPos]);
                        const line = new deps.THREE.Line(lineGeo, assets.spiderLineMat);
                        line.userData._ownedGeometry = lineGeo;
                        appState.pinsGroup.add(line);

                        placeSinglePaw(m, spiderPos, sn.normal);
                    });
                    return;
                }

                // 3. Zoom jauh/sedang ATAU >10 paw di satu titik -> Cluster Badge rapat
                const badge = createClusterBadge3D(c.appState.markers.length);
                badge.position.copy(c.pos).addScaledVector(norm, 0.045);
                appState.pinsGroup.add(badge);

                const hit = new deps.THREE.Mesh(assets.hitGeo, assets.hitMat);
                hit.position.copy(badge.position);
                hit.scale.setScalar(1.25);
                hit.userData = {
                    type: 'cluster',
                    targetPos: c.pos.clone(),
                    count: c.appState.markers.length,
                    appState.markers: c.appState.markers,
                    isDenseCluster: isCloseZoom
                };
                appState.pinsGroup.add(hit);
                appState.hitTargets.push(hit);
            });
        }

        function setPreviewMarker3D(position, normal, labelName = 'Kamu') {
            if (!appState.previewGroup) return;
            disposeOwnedSprites(appState.previewGroup);
            if (!position || !normal) return;

            const zAxis = new deps.THREE.Vector3(0, 0, 1);
            const pawObj = createCatPaw3D(labelName || 'Kamu', 'preview');
            const sn = deps.snapPointToWallSurface(position.x, position.y);
            pawObj.root.position.copy(sn.pos).addScaledVector(sn.normal, 0.012);
            pawObj.root.quaternion.setFromUnitVectors(zAxis, sn.normal);
            appState.previewGroup.add(pawObj.root);
            appState.previewGroup.userData.previewGlow = pawObj.glow;
            appState.previewGroup.userData.previewRoot = pawObj.root;
            appState.previewGroup.userData.previewLabel = pawObj.labelSprite;
        }

        function updatePreviewLabelName(text) {
            if (!appState.previewGroup || !appState.previewGroup.userData.previewRoot) return;
            const root = appState.previewGroup.userData.previewRoot;
            const oldLabel = appState.previewGroup.userData.previewLabel;
            if (oldLabel) {
                if (oldLabel.userData._ownedTexture) oldLabel.userData._ownedTexture.dispose();
                if (oldLabel.userData._ownedMaterial) oldLabel.userData._ownedMaterial.dispose();
                root.remove(oldLabel);
            }
            const newLabel = createNameLabelSprite(text || 'Kamu', 'preview');
            root.add(newLabel);
            appState.previewGroup.userData.previewLabel = newLabel;
        }


    return { initSharedPawAssets, rebuildMarkers3D, setPreviewMarker3D, updatePreviewLabelName };
}
