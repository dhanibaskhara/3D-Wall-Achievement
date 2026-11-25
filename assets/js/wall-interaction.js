// Raycasting and pointer-tap behaviour for the 3D wall.
export function createWallInteraction(state, deps) {
    function handleCanvasTap(clientX, clientY) {
        if (!state.renderer || !state.camera) return;

        const rect = state.renderer.domElement.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        state.pointerVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        state.pointerVec.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        state.raycaster.setFromCamera(state.pointerVec, state.camera);

        if (state.isAddMode) {
            const wallHits = state.raycaster.intersectObjects(state.wallInteractMeshes, false);
            if (wallHits.length > 0) {
                const hit = wallHits[0];
                const snapped = deps.sceneService.snapPointToWallSurface(hit.point.x, hit.point.y);
                state.pendingPlacement = {
                    position: snapped.pos,
                    normal: snapped.normal
                };

                const nameInput = document.getElementById('input-climber-name');
                const currentName = nameInput ? nameInput.value.trim() : '';
                deps.markerService.setPreviewMarker3D(
                    state.pendingPlacement.position,
                    state.pendingPlacement.normal,
                    currentName || 'Kamu'
                );
                deps.uiController.openConfirmSheet(state.pendingPlacement.position.y);
            } else {
                deps.showToast('Ketuk langsung pada permukaan dinding abu-abu atau biru.');
            }
            return;
        }

        const hits = state.raycaster.intersectObjects(state.hitTargets, false);
        if (hits.length > 0) {
            const data = hits[0].object.userData;
            if (data.type === 'cluster') {
                deps.uiController.closeMarkerPopup();
                if (data.isDenseCluster || state.camSpherical.radius <= 10.5) {
                    deps.uiController.openClusterListPopup(data.markers);
                } else {
                    deps.uiController.closeClusterListPopup();
                    state.targetLookAt.copy(data.targetPos);
                    state.targetSpherical.radius = Math.max(
                        8.2,
                        Math.min(9.8, state.targetSpherical.radius * 0.52)
                    );
                }
            } else if (data.type === 'marker') {
                deps.uiController.closeClusterListPopup();
                deps.uiController.openMarkerPopup(data.marker);
            }
            return;
        }

        deps.uiController.closeMarkerPopup();
        deps.uiController.closeClusterListPopup();
    }

    return { handleCanvasTap };
}
