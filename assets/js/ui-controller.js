// UI controller for achievement entry, marker popups, diagnostics and browser events.
import { formatDateIndo } from './utils.js';

export function createUIController(state, deps) {
    function enterAddMode() {
        closeMarkerPopup();
        closeClusterListPopup();
        state.isAddMode = true;

        const banner = document.getElementById('add-mode-banner');
        if (banner) banner.classList.remove('hidden');

        const addButton = document.getElementById('add-achievement-btn');
        if (addButton) addButton.classList.add('opacity-50', 'pointer-events-none');
    }

    function exitAddMode() {
        state.isAddMode = false;
        state.pendingPlacement = null;
        deps.markerService.setPreviewMarker3D(null, null);

        const banner = document.getElementById('add-mode-banner');
        if (banner) banner.classList.add('hidden');

        const addButton = document.getElementById('add-achievement-btn');
        if (addButton) addButton.classList.remove('opacity-50', 'pointer-events-none');

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

        const input = document.getElementById('input-climber-name');
        if (input) setTimeout(() => input.focus(), 80);
    }

    function canOwnerDelete(marker) {
        if (!marker || !state.currentUserId || marker.owner_id !== state.currentUserId) return false;
        if (!marker.created_at) return false;

        const createdMs = Date.parse(marker.created_at);
        if (Number.isNaN(createdMs)) return false;
        return (Date.now() - createdMs) <= 10 * 60 * 1000;
    }

    function openMarkerPopup(marker) {
        if (!marker) return;
        state.selectedMarker = marker;

        const name = document.getElementById('popup-climber-name');
        const date = document.getElementById('popup-achieved-date');
        const height = document.getElementById('popup-height-est');
        const deleteWrap = document.getElementById('popup-delete-wrap');
        const popup = document.getElementById('marker-popup');

        if (name) name.textContent = marker.name;
        if (date) date.textContent = formatDateIndo(marker.achieved_date);
        if (height) {
            const estimatedHeight = Number.isFinite(marker.position_y)
                ? Math.max(0, marker.position_y).toFixed(1)
                : '0.0';
            height.textContent = `Estimasi ketinggian: ±${estimatedHeight} m`;
        }
        if (deleteWrap) {
            deleteWrap.classList.toggle('hidden', !canOwnerDelete(marker));
        }
        if (popup) popup.classList.remove('hidden');
    }

    function closeMarkerPopup() {
        state.selectedMarker = null;
        const popup = document.getElementById('marker-popup');
        if (popup) popup.classList.add('hidden');
    }

    function openClusterListPopup(clusterMarkers) {
        if (!Array.isArray(clusterMarkers) || clusterMarkers.length === 0) return;

        const popup = document.getElementById('cluster-list-popup');
        const title = document.getElementById('cluster-list-title');
        const subtitle = document.getElementById('cluster-list-sub');
        const list = document.getElementById('cluster-list-items');
        if (!popup || !list) return;

        const averageHeight = clusterMarkers.reduce(
            (sum, marker) => sum + (Number(marker.position_y) || 0), 0
        ) / clusterMarkers.length;

        if (title) title.textContent = `🐾 ${clusterMarkers.length} Pemanjat di Titik Ini`;
        if (subtitle) {
            subtitle.textContent = `Estimasi ketinggian ±${averageHeight.toFixed(1)} m · Ketuk nama untuk detail`;
        }

        list.innerHTML = '';
        const sortedMarkers = [...clusterMarkers].sort((a, b) =>
            String(b.created_at || '').localeCompare(String(a.created_at || ''))
        );

        sortedMarkers.forEach((marker) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'w-full text-left px-3 py-2 rounded-xl bg-slate-100 hover:bg-orange-50 border border-transparent hover:border-orange-200 transition flex items-center justify-between gap-2';

            const leftWrap = document.createElement('div');
            leftWrap.className = 'min-w-0';

            const name = document.createElement('div');
            name.className = 'text-xs font-bold text-slate-900 truncate';
            name.textContent = marker.name;

            const date = document.createElement('div');
            date.className = 'text-[10px] text-slate-500';
            date.textContent = formatDateIndo(marker.achieved_date);

            leftWrap.appendChild(name);
            leftWrap.appendChild(date);

            const heightBadge = document.createElement('span');
            heightBadge.className = 'text-[10px] font-bold text-orange-600 shrink-0';
            heightBadge.textContent = `±${(Number(marker.position_y) || 0).toFixed(1)} m`;

            button.appendChild(leftWrap);
            button.appendChild(heightBadge);
            button.addEventListener('click', () => {
                closeClusterListPopup();
                openMarkerPopup(marker);
            });
            list.appendChild(button);
        });

        popup.classList.remove('hidden');
    }

    function closeClusterListPopup() {
        const popup = document.getElementById('cluster-list-popup');
        if (popup) popup.classList.add('hidden');
    }

    function bindUIEvents(onWindowResize) {
        const on = (id, eventName, handler) => {
            const element = document.getElementById(id);
            if (element) element.addEventListener(eventName, handler);
        };

        on('fatal-retry-btn', 'click', () => window.location.reload());
        on('add-achievement-btn', 'click', enterAddMode);
        on('cancel-add-mode-btn', 'click', exitAddMode);
        on('confirm-close-x', 'click', exitAddMode);
        on('confirm-cancel-btn', 'click', exitAddMode);
        on('popup-close-btn', 'click', closeMarkerPopup);
        on('cluster-close-btn', 'click', closeClusterListPopup);

        on('btn-toggle-pan', 'click', () => {
            deps.cameraControls.setPanMode(!state.isPanMode);
            deps.showToast(
                state.isPanMode
                    ? 'Mode Geser (Pan) aktif — seret atas/bawah/kiri/kanan'
                    : 'Mode Putar (Orbit) aktif',
                2000
            );
        });
        on('btn-reset-cam', 'click', deps.cameraControls.resetCamera);
        on('btn-zoom-in', 'click', () => deps.cameraControls.zoomCamera(0.82));
        on('btn-zoom-out', 'click', () => deps.cameraControls.zoomCamera(1.22));
        on('btn-toggle-light', 'click', () => {
            state.isNightMode = !state.isNightMode;
            deps.sceneService.applyLightingMode();
        });

        on('cloud-status-btn', 'click', deps.supabaseService.openCloudDiagModal);
        on('cloud-diag-close', 'click', deps.supabaseService.closeCloudDiagModal);
        on('cloud-diag-ok', 'click', deps.supabaseService.closeCloudDiagModal);

        window.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;

            const confirmSheet = document.getElementById('confirm-sheet');
            if (confirmSheet && !confirmSheet.classList.contains('hidden')) {
                exitAddMode();
                const addButton = document.getElementById('add-achievement-btn');
                if (addButton) addButton.focus();
                return;
            }

            const cloudModal = document.getElementById('cloud-diag-modal');
            if (cloudModal && !cloudModal.classList.contains('hidden')) {
                deps.supabaseService.closeCloudDiagModal();
                const statusButton = document.getElementById('cloud-status-btn');
                if (statusButton) statusButton.focus();
                return;
            }

            const clusterPopup = document.getElementById('cluster-list-popup');
            if (clusterPopup && !clusterPopup.classList.contains('hidden')) {
                closeClusterListPopup();
                return;
            }

            closeMarkerPopup();
        });

        on('cloud-diag-retry', 'click', async () => {
            const button = document.getElementById('cloud-diag-retry');
            if (button) {
                button.disabled = true;
                button.textContent = 'Menghubungkan...';
            }

            try {
                await deps.loadFirstAvailable(
                    deps.SUPABASE_CDNS,
                    () => !!(window.supabase && window.supabase.createClient)
                );
                const connected = await deps.supabaseService.syncFromSupabase(true);
                if (connected) deps.supabaseService.closeCloudDiagModal();
            } catch (error) {
                deps.showToast(error && error.message ? error.message : 'Gagal menghubungkan ke Supabase.');
            } finally {
                if (button) {
                    button.disabled = false;
                    button.textContent = 'Coba Hubungkan Ulang';
                }
            }
        });

        on('input-climber-name', 'input', (event) => {
            const value = event.target.value;
            const count = document.getElementById('name-char-count');
            if (count) count.textContent = `${value.length}/32`;
            deps.markerService.updatePreviewLabelName(value.trim() || 'Kamu');
        });

        on('confirm-form', 'submit', async (event) => {
            event.preventDefault();
            if (!state.pendingPlacement) return;

            const input = document.getElementById('input-climber-name');
            const saveButton = document.getElementById('confirm-save-btn');
            const cleanName = input ? input.value.trim() : '';
            if (!cleanName || cleanName.length > 32) {
                deps.showToast('Nama pemanjat wajib diisi (maks 32 karakter).');
                return;
            }

            if (saveButton) {
                saveButton.disabled = true;
                saveButton.textContent = 'Menyimpan...';
            }
            try {
                await deps.supabaseService.saveMarkerToSupabase(
                    cleanName,
                    state.pendingPlacement.position,
                    state.pendingPlacement.normal
                );
                if (input) input.value = '';
                const count = document.getElementById('name-char-count');
                if (count) count.textContent = '0/32';
                exitAddMode();
                deps.showToast('Pencapaian berhasil disimpan di 3D Wall.');
            } catch (error) {
                console.warn('Save marker error:', error);
                deps.showToast(error && error.message ? error.message : 'Gagal menyimpan marker.');
            } finally {
                if (saveButton) {
                    saveButton.disabled = false;
                    saveButton.textContent = 'Simpan pencapaian';
                }
            }
        });

        on('popup-delete-btn', 'click', async () => {
            if (!state.selectedMarker) return;

            const button = document.getElementById('popup-delete-btn');
            const targetId = state.selectedMarker.id;
            if (button) {
                button.disabled = true;
                button.textContent = 'Menghapus...';
            }
            try {
                await deps.supabaseService.deleteMarkerFromSupabase(targetId);
                closeMarkerPopup();
                deps.showToast('Marker berhasil dihapus.');
            } catch (error) {
                deps.showToast(error && error.message ? error.message : 'Gagal menghapus marker.');
            } finally {
                if (button) {
                    button.disabled = false;
                    button.textContent = 'Hapus Marker';
                }
            }
        });

        window.addEventListener('resize', onWindowResize);
        window.addEventListener('online', () => deps.supabaseService.syncFromSupabase(false));
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && navigator.onLine) {
                deps.supabaseService.syncFromSupabase(false);
            }
        });
    }

    return {
        enterAddMode,
        exitAddMode,
        openConfirmSheet,
        canOwnerDelete,
        openMarkerPopup,
        closeMarkerPopup,
        openClusterListPopup,
        closeClusterListPopup,
        bindUIEvents
    };
}
