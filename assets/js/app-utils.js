// Browser bootstrap helpers and small UI utilities.
export function createAppUtilities(state) {
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => resolve(src);
            script.onerror = () => {
                script.remove();
                reject(new Error('Gagal memuat ' + src));
            };
            document.head.appendChild(script);
        });
    }

    async function loadFirstAvailable(urls, checkFn) {
        if (checkFn()) return true;
        for (const url of urls) {
            try {
                await loadScript(url);
                if (checkFn()) return true;
            } catch (_) {
                // Lanjutkan ke CDN cadangan berikutnya.
            }
        }
        return checkFn();
    }

    function createResilientStorage() {
        const memoryStorage = new Map();
        let canUseLocalStorage = false;
        try {
            const testKey = '__iyalagi_storage_test__';
            window.localStorage.setItem(testKey, '1');
            window.localStorage.removeItem(testKey);
            canUseLocalStorage = true;
        } catch (_) {
            canUseLocalStorage = false;
        }

        return {
            getItem(key) {
                if (canUseLocalStorage) {
                    try { return window.localStorage.getItem(key); } catch (_) {}
                }
                return memoryStorage.has(key) ? memoryStorage.get(key) : null;
            },
            setItem(key, value) {
                if (canUseLocalStorage) {
                    try { window.localStorage.setItem(key, value); return; } catch (_) {}
                }
                memoryStorage.set(key, String(value));
            },
            removeItem(key) {
                if (canUseLocalStorage) {
                    try { window.localStorage.removeItem(key); return; } catch (_) {}
                }
                memoryStorage.delete(key);
            }
        };
    }

    function showFatalError(message) {
        const loading = document.getElementById('loading-overlay');
        if (loading) loading.classList.add('hidden');

        const box = document.getElementById('fatal-error-box');
        const messageElement = document.getElementById('fatal-error-msg');
        if (messageElement) {
            messageElement.textContent = message || 'Terjadi kesalahan saat menginisialisasi WebGL 3D.';
        }
        if (box) box.classList.remove('hidden');
    }

    function showToast(message, duration = 3200) {
        const toast = document.getElementById('toast');
        const text = document.getElementById('toast-text');
        if (!toast || !text) return;

        text.textContent = message;
        toast.classList.add('toast-enter');
        if (state.toastTimer) clearTimeout(state.toastTimer);
        state.toastTimer = setTimeout(() => {
            toast.classList.remove('toast-enter');
            state.toastTimer = null;
        }, duration);
    }

    return {
        loadScript,
        loadFirstAvailable,
        createResilientStorage,
        showFatalError,
        showToast
    };
}
