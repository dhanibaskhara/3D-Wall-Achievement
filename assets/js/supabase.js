// Supabase data/auth service. State is injected from the application shell.
export function createSupabaseService(appState, deps) {
        const MARKER_SELECT = [
            'id', 'session_id', 'owner_id', 'client_uuid', 'name',
            'position_x', 'position_y', 'position_z',
            'norm_x', 'norm_y', 'norm_z',
            'achieved_date', 'week_start_date', 'created_at'
        ].join(',');

        let pollInFlight = false;
        let markerRenderScheduled = false;

        function scheduleMarkerRender() {
            if (markerRenderScheduled) return;
            markerRenderScheduled = true;
            requestAnimationFrame(() => {
                markerRenderScheduled = false;
                deps.rebuildMarkers3D(true);
            });
        }

        function stopPollingFallback() {
            if (appState.pollTimer) {
                clearInterval(appState.pollTimer);
                appState.pollTimer = null;
            }
            pollInFlight = false;
        }
        function setCloudStatusUI(state, label) {
            const btn = document.getElementById('cloud-status-btn');
            const dot = document.getElementById('cloud-status-dot');
            const txt = document.getElementById('cloud-status-text');
            if (!btn || !dot || !txt) return;

            txt.textContent = label;
            if (state === 'live') {
                btn.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 hover:bg-emerald-500/30 transition cursor-pointer';
                dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]';
            } else if (state === 'connecting') {
                btn.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-200 border border-sky-400/30 transition cursor-pointer';
                dot.className = 'w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse';
            } else {
                btn.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-200 border border-amber-400/40 hover:bg-amber-500/30 transition cursor-pointer';
                dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-400';
            }
        }

        function diagnoseSupabaseError(err) {
            const code = err && err.code ? String(err.code) : '';
            const status = err && err.status ? String(err.status) : '';
            const msg = err && err.message ? String(err.message) : String(err || 'Unknown error');
            const details = err && err.details ? ` (${err.details})` : '';
            const hint = err && err.hint ? ` Hint: ${err.hint}` : '';
            const raw = `${code ? `[${code}] ` : ''}${status ? `(HTTP ${status}) ` : ''}${msg}${details}${hint}`;
            const lower = raw.toLowerCase();

            if (lower.includes('anonymous_provider_disabled') || lower.includes('anonymous sign-ins are disabled')) {
                return {
                    badge: 'Aktifkan Anon Auth',
                    isAnonDisabled: true,
                    raw,
                    hint: 'Anonymous Sign-Ins belum diaktifkan di project Supabase Anda.'
                };
            }
            if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
                return {
                    badge: 'Offline / Jaringan',
                    isAnonDisabled: false,
                    raw,
                    hint: 'Koneksi ke server Supabase terhambat atau sedang offline. Coba periksa internet lalu tekan Coba Hubungkan Ulang.'
                };
            }
            if (lower.includes('pgrst202') || lower.includes('could not find the function')) {
                return {
                    badge: 'Cek RPC Supabase',
                    isAnonDisabled: false,
                    raw,
                    hint: 'Fungsi RPC tidak ditemukan atau signature parameter berbeda dengan database Supabase.'
                };
            }
            if (lower.includes('get_or_create_weekly_session') || lower.includes('weekly_session_invalid_response')) {
                return {
                    badge: 'Cek Sesi Mingguan',
                    isAnonDisabled: false,
                    raw,
                    hint: 'RPC sesi mingguan gagal atau tidak mengembalikan week_start_date yang valid. Periksa fungsi RPC dan hak aksesnya di Supabase.'
                };
            }
            if (lower.includes('42501') || lower.includes('permission denied') || lower.includes('row-level security')) {
                return {
                    badge: 'Cek RLS / Auth',
                    isAnonDisabled: false,
                    raw,
                    hint: 'Hak akses ditolak oleh kebijakan RLS / autentikasi database.'
                };
            }
            return {
                badge: 'Gangguan Sync',
                isAnonDisabled: false,
                raw,
                hint: 'Periksa koneksi internet dan konfigurasi Supabase Anda.'
            };
        }

        function updateDiagModalUI() {
            const statusEl = document.getElementById('diag-status-label');
            const detailBox = document.getElementById('diag-detail-box');
            const rawEl = document.getElementById('diag-error-raw');
            const hintEl = document.getElementById('diag-error-hint');
            const anonStepsEl = document.getElementById('diag-anon-steps');
            if (!statusEl || !detailBox || !rawEl || !hintEl) return;

            statusEl.textContent = appState.lastCloudDiag.label;
            if (appState.lastCloudDiag.state === 'live') {
                detailBox.className = 'rounded-xl bg-emerald-50 border border-emerald-200 p-3 space-y-1.5';
                const uidShort = appState.currentUserId ? `${appState.currentUserId.slice(0, 8)}...` : 'Anonymous';
                rawEl.textContent = `Terhubung ke ${deps.SUPABASE_URL} · Auth UID: ${uidShort}`;
                hintEl.textContent = 'Marker Cat Paw langsung tersimpan ke database Supabase dan muncul real-time untuk seluruh anggota komunitas.';
                if (anonStepsEl) anonStepsEl.classList.add('hidden');
            } else {
                detailBox.className = 'rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-1.5';
                rawEl.textContent = appState.lastCloudDiag.raw || 'Menunggu koneksi ke Supabase...';
                hintEl.textContent = appState.lastCloudDiag.hint || 'Pastikan internet aktif dan Anonymous Sign-Ins sudah menyala.';
                if (anonStepsEl) {
                    if (appState.lastCloudDiag.isAnonDisabled) anonStepsEl.classList.remove('hidden');
                    else anonStepsEl.classList.add('hidden');
                }
            }
        }

        function openCloudDiagModal() {
            updateDiagModalUI();
            const m = document.getElementById('cloud-diag-modal');
            if (m) m.classList.remove('hidden');
        }

        function closeCloudDiagModal() {
            const m = document.getElementById('cloud-diag-modal');
            if (m) m.classList.add('hidden');
        }

        // =========================================================================
        // 5. INTEGRASI SUPABASE (ANON AUTH, WEEKLY SESSION, MARKER RPC, REALTIME)
        // =========================================================================
        function isRealtimeWebSocketAllowed() {
            try {
                const proto = window.location.protocol || '';
                const host = window.location.hostname || '';
                // Canvas preview / Google Web sandbox / blob memblokir WebSocket outbound
                if (proto === 'blob:' || proto === 'about:' || proto === 'data:' || host.includes('usercontent.goog')) {
                    return false;
                }
                return typeof window.WebSocket === 'function';
            } catch (_) {
                return false;
            }
        }

        function startPollingFallback() {
            if (appState.pollTimer) return;
            appState.pollTimer = setInterval(async () => {
                if (document.hidden || !navigator.onLine || pollInFlight) return;
                pollInFlight = true;
                try {
                    const fetched = await fetchAllMarkersPaginated();
                    appState.markers = fetched;
                    updateHeaderCounts();
                    scheduleMarkerRender();
                } catch (err) {
                    console.warn('Polling fallback Supabase gagal:', err);
                } finally {
                    pollInFlight = false;
                }
            }, 30000);
        }

        function initSupabaseClient() {
            if (!window.supabase || typeof window.supabase.createClient !== 'function') {
                return false;
            }
            if (!appState.supabaseClient) {
                appState.supabaseClient = window.supabase.createClient(deps.SUPABASE_URL, deps.SUPABASE_KEY, {
                    auth: {
                        storage: deps.createResilientStorage(),
                        persistSession: true,
                        autoRefreshToken: true,
                        detectSessionInUrl: false,
                        // Bypass navigator.locks agar tidak macet di sandbox iframe
                        lock: async function (_name, _acquireTimeout, fn) {
                            return await fn();
                        }
                    }
                });
            }
            return true;
        }

        async function ensureAnonymousSession() {
            if (!appState.supabaseClient) {
                return { ok: false, error: new Error('Supabase SDK belum dimuat.') };
            }
            try {
                const { data: sessionData, error: sessionErr } = await appState.supabaseClient.auth.getSession();
                if (!sessionErr && sessionData && sessionData.session && sessionData.session.user) {
                    appState.currentUserId = sessionData.session.user.id;
                    return { ok: true, user: sessionData.session.user };
                }
                const { data: anonData, error: anonErr } = await appState.supabaseClient.auth.signInAnonymously();
                if (anonErr) {
                    return { ok: false, error: anonErr };
                }
                if (anonData && anonData.user) {
                    appState.currentUserId = anonData.user.id;
                    return { ok: true, user: anonData.user };
                }
                return { ok: false, error: new Error('Sesi Anonymous Auth tidak mengembalikan user.') };
            } catch (err) {
                return { ok: false, error: err };
            }
        }

        function mapMarkerRow(row) {
            if (!row) return null;
            const px = Number(row.position_x ?? row.pos_x ?? 0);
            const py = Number(row.position_y ?? row.pos_y ?? 0);
            const pz = Number(row.position_z ?? row.pos_z ?? 0);
            const nx = Number(row.norm_x ?? 0);
            const ny = Number(row.norm_y ?? 0);
            const nz = Number(row.norm_z ?? 1);
            return {
                id: String(row.id),
                session_id: row.session_id || null,
                owner_id: row.owner_id || null,
                client_uuid: row.client_uuid || null,
                name: String(row.name ?? row.climber_name ?? 'Climber'),
                position_x: Number.isFinite(px) ? px : 0,
                position_y: Number.isFinite(py) ? py : 1,
                position_z: Number.isFinite(pz) ? pz : 0.3,
                norm_x: Number.isFinite(nx) ? nx : 0,
                norm_y: Number.isFinite(ny) ? ny : 0,
                norm_z: Number.isFinite(nz) ? nz : 1,
                achieved_date: row.achieved_date || '',
                week_start_date: row.week_start_date || null,
                created_at: row.created_at || null
            };
        }

        function upsertLocalMarker(mapped) {
            if (!mapped || !mapped.id) return false;
            const idx = appState.markers.findIndex((m) =>
                m.id === mapped.id || (mapped.client_uuid && m.client_uuid === mapped.client_uuid)
            );
            if (idx >= 0) {
                appState.markers[idx] = mapped;
            } else {
                appState.markers.unshift(mapped);
            }
            return true;
        }

        function updateHeaderCounts() {
            const cntEl = document.getElementById('marker-count-label');
            if (cntEl) cntEl.textContent = `${appState.markers.length} paw`;
            const wkEl = document.getElementById('week-badge-label');
            if (wkEl) {
                wkEl.textContent = appState.activeWeekStartDate
                    ? ` · ${deps.formatDateIndo(appState.activeWeekStartDate)}`
                    : '';
            }
        }

        async function fetchAllMarkersPaginated() {
            const pageSize = 500;
            let from = 0;
            const allRows = [];

            while (true) {
                const { data, error } = await appState.supabaseClient
                    .from('climbing_markers')
                    .select(MARKER_SELECT)
                    .order('created_at', { ascending: false })
                    .order('id', { ascending: false })
                    .range(from, from + pageSize - 1);

                if (error) throw error;
                if (!data || data.length === 0) break;

                for (const row of data) {
                    const mapped = mapMarkerRow(row);
                    if (mapped) allRows.push(mapped);
                }
                if (data.length < pageSize) break;
                from += pageSize;
            }
            return allRows;
        }

        async function syncFromSupabase(showFeedback = false) {
            setCloudStatusUI('connecting', 'Menghubungkan...');
            if (!initSupabaseClient()) {
                appState.lastCloudDiag = {
                    state: 'offline',
                    label: 'SDK Gagal Dimuat',
                    isAnonDisabled: false,
                    raw: 'Supabase JS SDK gagal dimuat dari CDN.',
                    hint: 'Periksa koneksi internet Anda lalu muat ulang halaman.'
                };
                setCloudStatusUI('offline', 'SDK Offline');
                updateDiagModalUI();
                return false;
            }

            try {
                // 1. Ambil data komunitas terlebih dahulu (public read)
                const fetched = await fetchAllMarkersPaginated();
                appState.markers = fetched;
                updateHeaderCounts();
                deps.rebuildMarkers3D(true);

                // 2. Pastikan sesi Anonymous Auth untuk hak simpan/hapus marker.
                const authRes = await ensureAnonymousSession();
                if (!authRes.ok) {
                    throw authRes.error || new Error('Anonymous Auth gagal dibuat atau dipulihkan.');
                }

                // Jangan pertahankan tanggal sesi lama bila RPC sesi mingguan gagal.
                appState.activeWeekStartDate = null;
                updateHeaderCounts();

                const { data: sessData, error: sessErr } = await appState.supabaseClient.rpc('get_or_create_weekly_session');
                if (sessErr) {
                    console.error('RPC get_or_create_weekly_session gagal:', sessErr);
                    throw sessErr;
                }

                const sessRow = Array.isArray(sessData) ? sessData[0] : sessData;
                const weekStartDate = sessRow && sessRow.week_start_date
                    ? String(sessRow.week_start_date).slice(0, 10)
                    : '';

                const parsedWeekStartDate = /^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)
                    ? new Date(`${weekStartDate}T00:00:00Z`)
                    : null;

                if (
                    !parsedWeekStartDate ||
                    Number.isNaN(parsedWeekStartDate.getTime()) ||
                    parsedWeekStartDate.toISOString().slice(0, 10) !== weekStartDate
                ) {
                    const sessionError = new Error(
                        'RPC get_or_create_weekly_session tidak mengembalikan week_start_date yang valid.'
                    );
                    sessionError.code = 'WEEKLY_SESSION_INVALID_RESPONSE';
                    throw sessionError;
                }

                appState.activeWeekStartDate = weekStartDate;
                updateHeaderCounts();

                // 3. Pasang realtime (atau fallback polling bila WebSocket sandbox dilarang).
                // Status Live baru boleh ditampilkan setelah RPC sesi mingguan tervalidasi.
                await setupRealtimeSubscription();

                appState.lastCloudDiag = {
                    state: 'live',
                    label: 'Live (Terhubung)',
                    isAnonDisabled: false,
                    raw: '',
                    hint: ''
                };
                setCloudStatusUI('live', 'Live');
                updateDiagModalUI();
                if (showFeedback) {
                    deps.showToast(`✅ Tersinkron (${appState.markers.length} paw komunitas)`);
                }
                return true;
            } catch (err) {
                console.warn('Gagal sinkronisasi Supabase:', err);
                const diag = diagnoseSupabaseError(err);
                appState.lastCloudDiag = {
                    state: 'offline',
                    label: diag.badge,
                    isAnonDisabled: !!diag.isAnonDisabled,
                    raw: diag.raw,
                    hint: diag.hint
                };
                setCloudStatusUI('offline', diag.badge);
                updateDiagModalUI();
                return false;
            }
        }

        async function setupRealtimeSubscription() {
            if (!appState.supabaseClient) return;
            if (!isRealtimeWebSocketAllowed()) {
                startPollingFallback();
                return;
            }

            try {
                if (appState.realtimeChannel) {
                    await appState.supabaseClient.removeChannel(appState.realtimeChannel);
                    appState.realtimeChannel = null;
                }

                const markerRealtimeColumns = [
                    'id', 'session_id', 'owner_id', 'client_uuid', 'name',
                    'position_x', 'position_y', 'position_z',
                    'norm_x', 'norm_y', 'norm_z',
                    'achieved_date', 'week_start_date', 'created_at'
                ];

                appState.realtimeChannel = appState.supabaseClient
                    .channel('iyalagi-manjat-markers-live')
                    .on(
                        'postgres_changes',
                        {
                            event: 'INSERT',
                            schema: 'public',
                            table: 'climbing_markers',
                            select: markerRealtimeColumns
                        },
                        (payload) => {
                            const mapped = mapMarkerRow(payload.new);
                            if (mapped) {
                                upsertLocalMarker(mapped);
                                updateHeaderCounts();
                                scheduleMarkerRender();
                            }
                        }
                    )
                    .on(
                        'postgres_changes',
                        {
                            event: 'DELETE',
                            schema: 'public',
                            table: 'climbing_markers',
                            select: ['id']
                        },
                        (payload) => {
                            const oldId = payload.old && payload.old.id ? String(payload.old.id) : null;
                            if (!oldId) return;
                            appState.markers = appState.markers.filter((m) => m.id !== oldId);
                            if (appState.selectedMarker && appState.selectedMarker.id === oldId) {
                                deps.closeMarkerPopup();
                            }
                            updateHeaderCounts();
                            scheduleMarkerRender();
                        }
                    )
                    .subscribe((status) => {
                        if (status === 'SUBSCRIBED') {
                            stopPollingFallback();
                        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                            startPollingFallback();
                        }
                    });
            } catch (err) {
                console.warn('Realtime WebSocket bypass, menggunakan polling fallback:', err);
                startPollingFallback();
            }
        }

        async function saveMarkerToSupabase(name, position, normal) {
            const authRes = await ensureAnonymousSession();
            if (!authRes.ok) {
                const diag = diagnoseSupabaseError(authRes.error);
                appState.lastCloudDiag = {
                    state: 'offline',
                    label: diag.badge,
                    isAnonDisabled: !!diag.isAnonDisabled,
                    raw: diag.raw,
                    hint: diag.hint
                };
                setCloudStatusUI('offline', diag.badge);
                updateDiagModalUI();
                if (diag.isAnonDisabled) openCloudDiagModal();
                throw new Error(diag.hint || diag.badge);
            }

            const clientUuid = deps.generateUuidV4();
            const px = Math.max(-3.45, Math.min(3.45, Number(position.x.toFixed(4))));
            const py = Math.max(0.05, Math.min(19.55, Number(position.y.toFixed(4))));
            const pz = Math.max(-0.55, Math.min(6.55, Number(position.z.toFixed(4))));
            const nx = Number(normal.x.toFixed(4));
            const ny = Number(normal.y.toFixed(4));
            const nz = Number(normal.z.toFixed(4));

            // Panggil RPC canonical 9 parameter V2.2
            let res = await appState.supabaseClient.rpc('insert_marker', {
                p_client_uuid: clientUuid,
                p_name: name,
                p_position_x: px,
                p_position_y: py,
                p_position_z: pz,
                p_norm_x: nx,
                p_norm_y: ny,
                p_norm_z: nz,
                p_offline_created_at: null
            });

            // Fallback otomatis jika server memakai urutan parameter alternatif
            if (res.error && (res.error.code === 'PGRST202' || String(res.error.message || '').includes('could not find the function'))) {
                res = await appState.supabaseClient.rpc('insert_marker', {
                    p_name: name,
                    p_position_x: px,
                    p_position_y: py,
                    p_position_z: pz,
                    p_norm_x: nx,
                    p_norm_y: ny,
                    p_norm_z: nz,
                    p_client_uuid: clientUuid,
                    p_is_offline: false,
                    p_client_created_at: null
                });
            }

            if (res.error) throw res.error;
            const data = res.data;

            if (data && typeof data === 'object' && 'ok' in data) {
                if (!data.ok) {
                    throw new Error(data.message || data.code || 'Gagal menyimpan marker.');
                }
                const saved = mapMarkerRow(data.marker);
                if (saved) {
                    if (!appState.activeWeekStartDate && saved.week_start_date) {
                        appState.activeWeekStartDate = saved.week_start_date;
                    }
                    upsertLocalMarker(saved);
                    updateHeaderCounts();
                    deps.rebuildMarkers3D(true);
                }
                return saved;
            }

            const row = Array.isArray(data) ? data[0] : data;
            const saved = mapMarkerRow(row);
            if (saved) {
                upsertLocalMarker(saved);
                updateHeaderCounts();
                deps.rebuildMarkers3D(true);
            } else {
                await syncFromSupabase(false);
            }
            return saved;
        }

        async function deleteMarkerFromSupabase(markerId) {
            const { data, error } = await appState.supabaseClient.rpc('delete_marker', {
                p_marker_id: markerId
            });
            if (error) throw error;
            if (data && typeof data === 'object' && 'deleted' in data && !data.deleted) {
                throw new Error(data.message || 'Marker tidak dapat dihapus.');
            }
            appState.markers = appState.markers.filter((m) => m.id !== markerId);
            updateHeaderCounts();
            deps.rebuildMarkers3D(true);
        }


    return { syncFromSupabase, saveMarkerToSupabase, deleteMarkerFromSupabase, openCloudDiagModal, closeCloudDiagModal, updateDiagModalUI };
}
