/**
 * In-memory cache with optional TTL, max size, tags, and simple events.
 *
 * Features:
 * - Per-item or default TTL (seconds)
 * - Max size with oldest-first eviction
 * - Hit/miss statistics
 * - Bulk get/set
 * - Tag-based grouping
 * - Basic event hooks (set, delete, clear, expire, evict)
 *
 * Notes:
 * - Keys are always coerced to strings.
 * - null / undefined / 0 / false / "" CAN be stored and retrieved correctly.
 * - Expired items are removed lazily on access and can also be cleaned with cleanup().
 */
class Cache {
    /**
     * @param {Object} [options]
     * @param {number|null} [options.defaultTTL] - Default TTL in seconds (null = no expiry)
     * @param {number|null} [options.maxSize]    - Max number of items (null = unlimited)
     */
    constructor(options = {}) {
        /** @type {Map<string, {value: any, createdAt: number, expiresAt?: number}>} */
        this.store = new Map();

        /** @type {number|null} */
        this.defaultTTL = options.defaultTTL ?? null;

        /** @type {number|null} */
        this.maxSize = options.maxSize ?? null;

        // Performance counters
        this.hits = 0;
        this.misses = 0;

        /**
         * Tag → Set of keys
         * @type {Map<string, Set<string>>}
         */
        this.tags = new Map();

        /**
         * Reverse lookup: key → Set of tags (keeps tags consistent on delete/expire)
         * @type {Map<string, Set<string>>}
         */
        this.keyToTags = new Map();

        /**
         * Event name → array of callbacks
         * @type {Map<string, Function[]>}
         */
        this.events = new Map();
    }

    // -------------------------------------------------------------------------
    // Core API
    // -------------------------------------------------------------------------

    /**
     * Store a value under the given key.
     * @param {string|number} key
     * @param {*} value               - Any value, including null / undefined / falsy
     * @param {number|null} [ttlSeconds] - Override default TTL (null = no expiry)
     * @returns {boolean}
     */
    set(key, value, ttlSeconds = this.defaultTTL) {
        if (key === undefined || key === null || key === '') {
            throw new Error('Key cannot be empty');
        }

        const stringKey = String(key);

        // Evict oldest item if we are at capacity and this is a new key
        if (this.maxSize && this.store.size >= this.maxSize && !this.store.has(stringKey)) {
            this.evictOldest();
        }

        const item = {
            value,
            createdAt: Date.now()
        };

        if (ttlSeconds != null && ttlSeconds > 0) {
            item.expiresAt = Date.now() + ttlSeconds * 1000;
        }

        this.store.set(stringKey, item);
        this.emit('set', { key: stringKey, value });
        return true;
    }

    /**
     * Retrieve a value. Returns null if the key is missing or expired.
     * (Use has() if you need to distinguish "missing" from "stored null".)
     * @param {string|number} key
     * @returns {*|null}
     */
    get(key) {
        if (key === undefined || key === null) return null;

        const stringKey = String(key);
        const item = this.store.get(stringKey);

        // Cache miss – key never existed
        if (!item) {
            this.misses++;
            return null;
        }

        // Expired → remove and count as miss
        if (item.expiresAt && Date.now() > item.expiresAt) {
            this._removeKey(stringKey);           // also cleans tags
            this.misses++;
            this.emit('expire', { key: stringKey });
            return null;
        }

        // Hit
        this.hits++;
        return item.value;
    }

    /**
     * Returns true only if the key currently exists and is not expired.
     * Does NOT increment hit/miss counters.
     * @param {string|number} key
     * @returns {boolean}
     */
    has(key) {
        if (key === undefined || key === null) return false;

        const stringKey = String(key);
        const item = this.store.get(stringKey);
        if (!item) return false;

        if (item.expiresAt && Date.now() > item.expiresAt) {
            this._removeKey(stringKey);
            this.emit('expire', { key: stringKey });
            return false;
        }
        return true;
    }

    /**
     * Atomic "get or compute and store".
     * Correctly handles stored null / falsy values.
     * @param {string|number} key
     * @param {Function} fn          - Called only on miss; return value is stored
     * @param {number|null} [ttlSeconds]
     * @returns {*}
     */
    getOrSet(key, fn, ttlSeconds = this.defaultTTL) {
        if (this.has(key)) {
            // has() already cleaned expired entries; get() will count a hit
            return this.get(key);
        }

        const value = fn();
        this.set(key, value, ttlSeconds);
        return value;
    }

    /**
     * Delete a single key.
     * @param {string|number} key
     * @returns {boolean} true if the key existed and was removed
     */
    delete(key) {
        if (key === undefined || key === null) return false;

        const stringKey = String(key);
        if (!this.store.has(stringKey)) return false;

        this._removeKey(stringKey);
        this.emit('delete', { key: stringKey });
        return true;
    }

    /**
     * Remove every entry and reset tags.
     */
    clear() {
        this.store.clear();
        this.tags.clear();
        this.keyToTags.clear();
        this.emit('clear', {});
    }

    size() {
        return this.store.size;
    }

    keys() {
        // Only return non-expired keys
        this.cleanup();
        return Array.from(this.store.keys());
    }

    values() {
        this.cleanup();
        return Array.from(this.store.values()).map(item => item.value);
    }

    entries() {
        this.cleanup();
        return Array.from(this.store.entries()).map(([key, item]) => [key, item.value]);
    }

    // -------------------------------------------------------------------------
    // Bulk operations
    // -------------------------------------------------------------------------

    /**
     * Set many key/value pairs at once.
     * @param {Object|Map} entries
     * @param {number|null} [ttlSeconds]
     * @returns {boolean}
     */
    mset(entries, ttlSeconds = this.defaultTTL) {
        const pairs = entries instanceof Map
            ? entries
            : Object.entries(entries);

        for (const [key, value] of pairs) {
            this.set(key, value, ttlSeconds);
        }
        return true;
    }

    /**
     * Get many keys at once.
     * @param {Array<string|number>} keys
     * @returns {Object} { key: value | null }
     */
    mget(keys) {
        const results = {};
        for (const key of keys) {
            results[key] = this.get(key);
        }
        return results;
    }

    // -------------------------------------------------------------------------
    // TTL helpers
    // -------------------------------------------------------------------------

    /**
     * Remaining TTL in seconds.
     * -2 → key does not exist (or was expired and removed)
     * -1 → key exists but has no expiry
     *  ≥0 → seconds left
     * @param {string|number} key
     * @returns {number}
     */
    ttl(key) {
        const stringKey = String(key);
        const item = this.store.get(stringKey);

        if (!item) return -2;

        if (!item.expiresAt) return -1;

        const remaining = Math.floor((item.expiresAt - Date.now()) / 1000);
        if (remaining <= 0) {
            this._removeKey(stringKey);
            this.emit('expire', { key: stringKey });
            return -2;
        }
        return remaining;
    }

    /**
     * Set / change the TTL of an existing key.
     * @param {string|number} key
     * @param {number} ttlSeconds
     * @returns {boolean}
     */
    expire(key, ttlSeconds) {
        const stringKey = String(key);
        const item = this.store.get(stringKey);
        if (!item) return false;

        item.expiresAt = Date.now() + ttlSeconds * 1000;
        this.store.set(stringKey, item);
        return true;
    }

    /**
     * Remove the expiry from a key (make it persistent).
     * @param {string|number} key
     * @returns {boolean}
     */
    persist(key) {
        const stringKey = String(key);
        const item = this.store.get(stringKey);
        if (!item) return false;

        delete item.expiresAt;
        this.store.set(stringKey, item);
        return true;
    }

    // -------------------------------------------------------------------------
    // Statistics
    // -------------------------------------------------------------------------

    getStats() {
        const total = this.hits + this.misses;
        return {
            size: this.store.size,
            hits: this.hits,
            misses: this.misses,
            hitRate: total === 0 ? 0 : Number(((this.hits / total) * 100).toFixed(2)),
            maxSize: this.maxSize,
            defaultTTL: this.defaultTTL
        };
    }

    resetStats() {
        this.hits = 0;
        this.misses = 0;
    }

    // -------------------------------------------------------------------------
    // Maintenance
    // -------------------------------------------------------------------------

    /**
     * Remove all currently expired items.
     * @returns {number} how many items were deleted
     */
    cleanup() {
        let removed = 0;
        const now = Date.now();

        for (const [key, item] of this.store.entries()) {
            if (item.expiresAt && now > item.expiresAt) {
                this._removeKey(key);
                this.emit('expire', { key });
                removed++;
            }
        }
        return removed;
    }

    /**
     * Remove the oldest item (by createdAt). Used when maxSize is reached.
     * @returns {boolean}
     */
    evictOldest() {
        let oldestKey = null;
        let oldestTime = Infinity;

        for (const [key, item] of this.store.entries()) {
            if (item.createdAt < oldestTime) {
                oldestTime = item.createdAt;
                oldestKey = key;
            }
        }

        if (oldestKey !== null) {
            this._removeKey(oldestKey);
            this.emit('evict', { key: oldestKey });
            return true;
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // Tags
    // -------------------------------------------------------------------------

    /**
     * Store a value and associate it with a tag.
     * @param {string|number} key
     * @param {*} value
     * @param {string} tag
     * @param {number|null} [ttlSeconds]
     */
    setWithTag(key, value, tag, ttlSeconds = this.defaultTTL) {
        this.set(key, value, ttlSeconds);

        const stringKey = String(key);

        if (!this.tags.has(tag)) {
            this.tags.set(tag, new Set());
        }
        this.tags.get(tag).add(stringKey);

        if (!this.keyToTags.has(stringKey)) {
            this.keyToTags.set(stringKey, new Set());
        }
        this.keyToTags.get(stringKey).add(tag);
    }

    /**
     * Return all non-expired items that belong to a tag.
     * @param {string} tag
     * @returns {Array<{key: string, value: *}>}
     */
    getByTag(tag) {
        if (!this.tags.has(tag)) return [];

        const results = [];
        for (const key of this.tags.get(tag)) {
            // get() will clean expired entries and update stats
            if (this.has(key)) {
                results.push({ key, value: this.get(key) });
            }
        }
        return results;
    }

    /**
     * Delete every key that belongs to a tag (and remove the tag itself).
     * @param {string} tag
     * @returns {number} number of keys deleted
     */
    deleteByTag(tag) {
        if (!this.tags.has(tag)) return 0;

        let deleted = 0;
        // Copy the set because we mutate while iterating
        for (const key of [...this.tags.get(tag)]) {
            if (this.delete(key)) deleted++;
        }
        this.tags.delete(tag);
        return deleted;
    }

    // -------------------------------------------------------------------------
    // Simple event system
    // -------------------------------------------------------------------------

    /**
     * Subscribe to an event.
     * Supported events: 'set' | 'delete' | 'clear' | 'expire' | 'evict'
     * @param {string} event
     * @param {Function} callback
     */
    on(event, callback) {
        if (typeof callback !== 'function') return;
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(callback);
    }

    /**
     * Emit an event to all registered listeners.
     * @param {string} event
     * @param {*} data
     */
    emit(event, data) {
        const listeners = this.events.get(event);
        if (!listeners) return;

        for (const cb of listeners) {
            try {
                cb(data);
            } catch (err) {
                // Prevent one bad listener from breaking the cache
                console.error(`Cache event listener error (${event}):`, err);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /**
     * Fully remove a key from the store and from every tag that referenced it.
     * @private
     * @param {string} stringKey
     */
    _removeKey(stringKey) {
        this.store.delete(stringKey);

        const tagsForKey = this.keyToTags.get(stringKey);
        if (tagsForKey) {
            for (const tag of tagsForKey) {
                const set = this.tags.get(tag);
                if (set) {
                    set.delete(stringKey);
                    if (set.size === 0) this.tags.delete(tag);
                }
            }
            this.keyToTags.delete(stringKey);
        }
    }
}

// Optional: export for modules
// module.exports = Cache;
export default Cache;