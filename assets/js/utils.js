// Pure helpers shared by the 3D Wall Achievement application.
export function generateUuidV4() {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                return window.crypto.randomUUID();
            }
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = (Math.random() * 16) | 0;
                const v = c === 'x' ? r : ((r & 0x3) | 0x8);
                return v.toString(16);
            });
        }

export function mulberry32(seed) {
            let a = seed >>> 0;
            return function () {
                a |= 0;
                a = (a + 0x6d2b79f5) | 0;
                let t = Math.imul(a ^ (a >>> 15), 1 | a);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        }

export function formatDateIndo(dateStr) {
            if (!dateStr) return '-';
            try {
                const parts = String(dateStr).slice(0, 10).split('-');
                if (parts.length !== 3) return dateStr;
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
                const d = parseInt(parts[2], 10);
                const m = parseInt(parts[1], 10) - 1;
                const y = parts[0];
                if (isNaN(d) || isNaN(m) || !months[m]) return dateStr;
                return `${d} ${months[m]} ${y}`;
            } catch (_) {
                return dateStr;
            }
        }
