# Cache.js – Complete Guide (A to Z)

A simple but powerful **in-memory cache** written in plain JavaScript.  
It stores data in memory (RAM) so you can get it back very fast later.  
Perfect for caching API responses, database results, computed values, or any temporary data.

This README explains **everything** – from the very basics to advanced features – with lots of clear examples and simple English.

---

## Table of Contents

1. [What is this Cache?](#1-what-is-this-cache)
2. [Installation / How to use the file](#2-installation--how-to-use-the-file)
3. [Creating a Cache (Constructor)](#3-creating-a-cache-constructor)
4. [Basic Operations – set, get, has, delete, clear](#4-basic-operations)
5. [getOrSet – The Smart Helper](#5-getorset--the-smart-helper)
6. [Bulk Operations – mset & mget](#6-bulk-operations--mset--mget)
7. [Time-To-Live (TTL) – Making data expire](#7-time-to-live-ttl--making-data-expire)
8. [Statistics – hits, misses, hit rate](#8-statistics--hits-misses-hit-rate)
9. [Maintenance – cleanup & eviction](#9-maintenance--cleanup--eviction)
10. [Tags – Grouping keys together](#10-tags--grouping-keys-together)
11. [Events – Listening to what happens](#11-events--listening-to-what-happens)
12. [Complete Real-World Examples](#12-complete-real-world-examples)
13. [Important Notes & Best Practices](#13-important-notes--best-practices)
14. [Quick Reference (Cheat Sheet)](#14-quick-reference-cheat-sheet)

---

## 1. What is this Cache?

Imagine you have a slow function (for example, it calls an API or does heavy math).  
Instead of running that slow function every time, you can save the result in this Cache.  
Next time you need the same result, you just read it from the Cache – which is almost instant.

**Key features:**

- Store any value (numbers, strings, objects, arrays, even `null` or `false`)
- Optional expiration time (TTL)
- Maximum size limit (old items are removed automatically)
- Hit / miss statistics
- Group keys with tags
- Listen to events (set, delete, expire, etc.)
- Works in Node.js and in the browser

**What it is NOT:**

- It is **not** a database. When your program stops, everything in the cache is lost.
- It is **not** shared between different processes or servers (it lives only in one process memory).

---

## 2. Installation / How to use the file

There is no special installation. Just copy the `Cache` class into your project.

### In Node.js

```bash
npm install cache
```
Or clone the cache file repo, https://github.com/amk2406/cache.git

```js
// cache.js  (the file that contains the class)
const Cache = require('./cache.js');   // if you use CommonJS
// or
import Cache from './cache.js';        // if you use ES modules
```

### In the browser

```html
<script src="cache.js"></script>
<script>
  const cache = new Cache();
  // now you can use it
</script>
```

Or if you are using a modern bundler (Vite, Webpack, etc.), just import it normally.

---

## 3. Creating a Cache (Constructor)

You create a new cache like this:

```js
const cache = new Cache();
```

You can also pass options:

```js
const cache = new Cache({
  defaultTTL: 60,     // every item will expire after 60 seconds (unless you say otherwise)
  maxSize: 1000       // never store more than 1000 items
});
```

### Options explained

| Option       | Type          | Default | Meaning                                      |
|--------------|---------------|---------|----------------------------------------------|
| `defaultTTL` | number / null | `null`  | Default lifetime in **seconds**. `null` = never expires |
| `maxSize`    | number / null | `null`  | Maximum number of items. When full, the oldest item is removed |

**Examples:**

```js
// Cache that never expires and has no size limit
const unlimited = new Cache();

// Cache where items live 5 minutes by default
const shortLived = new Cache({ defaultTTL: 300 });

// Cache that keeps at most 50 items
const limited = new Cache({ maxSize: 50 });

// Both options together
const productionCache = new Cache({
  defaultTTL: 600,   // 10 minutes
  maxSize: 5000
});
```

---

## 4. Basic Operations

### 4.1 set(key, value, ttlSeconds?)

Stores a value under a key.

```js
cache.set('username', 'Ada');
cache.set('age', 36);
cache.set('isAdmin', false);
cache.set('profile', { name: 'Ada', city: 'London' });
cache.set('scores', [10, 20, 30]);
```

You can also give a custom TTL (in seconds):

```js
// This item will disappear after 30 seconds
cache.set('tempToken', 'abc123', 30);

// This item will never expire (even if defaultTTL is set)
cache.set('permanent', 'I stay forever', null);
```

**Important rules:**

- The key cannot be empty, `null`, or `undefined`.
- Keys are always turned into strings (`123` becomes `"123"`).
- You **can** store `null`, `undefined`, `0`, `false`, and empty string `""`.

```js
cache.set('nothing', null);
cache.set('zero', 0);
cache.set('empty', '');
```

### 4.2 get(key)

Retrieves the value.  
Returns `null` if the key does not exist **or** if it has already expired.

```js
const name = cache.get('username');   // → "Ada"
const missing = cache.get('unknown'); // → null
```

### 4.3 has(key)

Checks if a key exists **and** is not expired.  
Returns `true` or `false`.  
This method does **not** change the hit/miss counters.

```js
if (cache.has('username')) {
  console.log('User is in the cache');
}
```

### 4.4 delete(key)

Removes one key. Returns `true` if the key existed, `false` otherwise.

```js
cache.delete('username');  // → true
cache.delete('unknown');   // → false
```

### 4.5 clear()

Removes **everything** from the cache (and also clears all tags).

```js
cache.clear();
```

### 4.6 size(), keys(), values(), entries()

```js
cache.size();     // how many items are currently stored

cache.keys();     // array of all non-expired keys
cache.values();   // array of all non-expired values
cache.entries();  // array of [key, value] pairs
```

These methods automatically clean expired items before returning the result.

---

## 5. getOrSet – The Smart Helper

This is one of the most useful methods.

**Idea:**  
“Give me the value for this key. If it is not in the cache, run this function, store the result, and then give it to me.”

```js
function expensiveCalculation(n) {
  console.log('Calculating...');
  return n * n;
}

// First call → function runs, result is stored
const result1 = cache.getOrSet('square-5', () => expensiveCalculation(5));
// → prints "Calculating..." and returns 25

// Second call → result comes from cache, function is NOT called
const result2 = cache.getOrSet('square-5', () => expensiveCalculation(5));
// → returns 25 immediately, no "Calculating..." message
```

You can also give a custom TTL:

```js
cache.getOrSet('weather', () => fetchWeather(), 300); // cache for 5 minutes
```

**Why is this better than writing the logic yourself?**

Without `getOrSet` you would write:

```js
let value = cache.get('key');
if (value === null) {
  value = expensiveFunction();
  cache.set('key', value);
}
```

`getOrSet` does exactly that in one clean line, and it correctly handles the case when the stored value is `null` or `false`.

---

## 6. Bulk Operations – mset & mget

When you need to set or get many items at once.

### mset – Set many keys

```js
// Using a normal object
cache.mset({
  name: 'Grace',
  age: 30,
  city: 'New York'
});

// Using a Map
const data = new Map();
data.set('color', 'blue');
data.set('size', 'large');
cache.mset(data);

// With a custom TTL for all of them
cache.mset({ a: 1, b: 2, c: 3 }, 60); // all expire after 60 seconds
```

### mget – Get many keys

```js
const results = cache.mget(['name', 'age', 'unknown']);

console.log(results);
// {
//   name: 'Grace',
//   age: 30,
//   unknown: null
// }
```

---

## 7. Time-To-Live (TTL) – Making data expire

TTL means “this item should only live for X seconds”.

### Setting TTL when you store the item

```js
cache.set('session', 'xyz789', 3600); // lives 1 hour
```

### Checking remaining time – ttl(key)

```js
cache.ttl('session');  
// returns a number:
//   -2  → key does not exist (or already expired)
//   -1  → key exists but has no expiration
//  ≥ 0  → seconds left
```

Example:

```js
cache.set('promo', 'SALE50', 120); // 2 minutes

setTimeout(() => {
  console.log(cache.ttl('promo')); // roughly 90 (or a bit less)
}, 30000);
```

### Changing the TTL later – expire(key, seconds)

```js
cache.set('token', 'abc');
cache.expire('token', 30); // now it will expire in 30 seconds
```

### Making an item permanent again – persist(key)

```js
cache.persist('token'); // removes the expiration, item stays forever
```

---

## 8. Statistics – hits, misses, hit rate

The cache automatically counts how many times you successfully found an item (hit) and how many times you did not (miss).

```js
cache.set('a', 1);
cache.get('a');      // hit
cache.get('a');      // hit
cache.get('missing'); // miss

console.log(cache.getStats());
/*
{
  size: 1,
  hits: 2,
  misses: 1,
  hitRate: 66.67,      // percentage
  maxSize: null,
  defaultTTL: null
}
*/
```

Reset the counters:

```js
cache.resetStats();
```

**Tip:** A high hit rate means your cache is working well. A very low hit rate means you are asking for keys that are rarely stored or expire too quickly.

---

## 9. Maintenance – cleanup & eviction

### cleanup()

Removes all items that have already expired.  
Returns how many items were deleted.

```js
const removed = cache.cleanup();
console.log(`Cleaned ${removed} expired items`);
```

You usually do not need to call this often, because `get()`, `has()`, `keys()`, etc. already remove expired items when they touch them.  
Calling `cleanup()` is useful if you want to free memory proactively.

### Automatic eviction (when maxSize is set)

If you created the cache with a `maxSize` and you try to add a new item when the cache is full, the **oldest** item (by creation time) is automatically removed.

```js
const cache = new Cache({ maxSize: 3 });

cache.set('one', 1);
cache.set('two', 2);
cache.set('three', 3);
cache.set('four', 4); // 'one' is automatically removed
```

You can also force eviction yourself (rarely needed):

```js
cache.evictOldest();
```

---

## 10. Tags – Grouping keys together

Tags let you group related keys so you can fetch or delete them all at once.

### setWithTag(key, value, tag, ttlSeconds?)

```js
cache.setWithTag('user:1', { name: 'Alice' }, 'users');
cache.setWithTag('user:2', { name: 'Bob' }, 'users');
cache.setWithTag('post:10', { title: 'Hello' }, 'posts');
cache.setWithTag('post:11', { title: 'World' }, 'posts');
```

### getByTag(tag)

Returns an array of `{ key, value }` for every non-expired item that has that tag.

```js
const allUsers = cache.getByTag('users');
/*
[
  { key: 'user:1', value: { name: 'Alice' } },
  { key: 'user:2', value: { name: 'Bob' } }
]
*/
```

### deleteByTag(tag)

Deletes every key that belongs to the tag and also removes the tag itself.  
Returns how many keys were deleted.

```js
const deleted = cache.deleteByTag('posts'); // → 2
```

**Good use cases for tags:**

- All cache entries for a specific user
- All product data for a category
- All translations for a language
- Temporary data for a single request / session

---

## 11. Events – Listening to what happens

You can subscribe to events and run your own code when something happens inside the cache.

Supported events:

| Event     | When it is fired                          | Data received          |
|-----------|-------------------------------------------|------------------------|
| `set`     | After a successful `set`                  | `{ key, value }`       |
| `delete`  | After a successful `delete`               | `{ key }`              |
| `clear`   | After `clear()`                           | `{}`                   |
| `expire`  | When an item is removed because it expired| `{ key }`              |
| `evict`   | When an item is removed because of maxSize| `{ key }`              |

### How to listen

```js
cache.on('set', (data) => {
  console.log(`Something was stored: ${data.key} =`, data.value);
});

cache.on('delete', (data) => {
  console.log(`Key removed: ${data.key}`);
});

cache.on('expire', (data) => {
  console.log(`Key expired: ${data.key}`);
});

cache.on('evict', (data) => {
  console.log(`Key evicted because cache is full: ${data.key}`);
});

cache.on('clear', () => {
  console.log('Cache was completely cleared');
});
```

You can register as many listeners as you want for the same event.

---

## 12. Complete Real-World Examples

### Example A – Caching an API response

```js
const cache = new Cache({ defaultTTL: 300 }); // 5 minutes

async function getUser(userId) {
  const cacheKey = `user:${userId}`;

  return cache.getOrSet(cacheKey, async () => {
    console.log('Fetching from API...');
    const response = await fetch(`https://api.example.com/users/${userId}`);
    return response.json();
  });
}

// First call → goes to the API
const user1 = await getUser(42);

// Second call (within 5 minutes) → comes from cache
const user2 = await getUser(42);
```

### Example B – Caching expensive calculations

```js
const cache = new Cache({ maxSize: 100 });

function fibonacci(n) {
  return cache.getOrSet(`fib:${n}`, () => {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
  });
}

console.log(fibonacci(40)); // first time is slow
console.log(fibonacci(40)); // second time is instant
```

### Example C – Session-like data with tags

```js
const cache = new Cache({ defaultTTL: 1800 }); // 30 minutes

function storeUserSession(userId, sessionData) {
  cache.setWithTag(`session:${userId}`, sessionData, 'sessions');
  cache.setWithTag(`session:${userId}`, sessionData, `user:${userId}`);
}

function logoutUser(userId) {
  // Delete everything related to this user
  cache.deleteByTag(`user:${userId}`);
}

function clearAllSessions() {
  cache.deleteByTag('sessions');
}
```

### Example D – Simple rate-limiting helper

```js
const cache = new Cache();

function isRateLimited(ip, maxRequests = 10, windowSeconds = 60) {
  const key = `rate:${ip}`;
  const current = cache.get(key) || 0;

  if (current >= maxRequests) {
    return true; // limited
  }

  cache.set(key, current + 1, windowSeconds);
  return false;
}
```

---

## 13. Important Notes & Best Practices

1. **Keys become strings**  
   `cache.set(123, 'hello')` is the same as `cache.set('123', 'hello')`.

2. **null is a valid value**  
   `cache.set('x', null)` → `cache.get('x')` returns `null`.  
   Use `has('x')` if you need to know whether the key exists.

3. **Memory only**  
   When the process dies, the cache is gone. Do not store data you cannot recreate.

4. **Not shared across servers**  
   Each Node.js process (or browser tab) has its own independent cache.

5. **TTL is not exact to the millisecond**  
   Expiration is checked when you access the item or when you call `cleanup()`.

6. **maxSize uses “oldest first”**  
   The item that was created earliest is removed when the limit is reached.  
   It is **not** a true LRU (Least Recently Used) cache.

7. **Good practice**  
   Always prefer `getOrSet` when the value comes from a slow source.  
   It keeps your code clean and avoids race conditions in simple cases.

8. **Cleanup**  
   For long-running applications with many short-lived keys, call `cache.cleanup()` from time to time (for example every few minutes with `setInterval`).

---

## 14. Quick Reference (Cheat Sheet)

```js
const cache = new Cache({ defaultTTL: 60, maxSize: 1000 });

// Basic
cache.set('key', value);
cache.set('key', value, 30);          // with TTL
cache.get('key');
cache.has('key');
cache.delete('key');
cache.clear();
cache.size();

// Smart helper
cache.getOrSet('key', () => computeValue());
cache.getOrSet('key', () => computeValue(), 120);

// Bulk
cache.mset({ a: 1, b: 2 });
cache.mget(['a', 'b', 'c']);

// TTL
cache.ttl('key');                     // seconds left / -1 / -2
cache.expire('key', 60);
cache.persist('key');

// Stats
cache.getStats();
cache.resetStats();

// Maintenance
cache.cleanup();
cache.evictOldest();

// Tags
cache.setWithTag('key', value, 'mytag');
cache.getByTag('mytag');
cache.deleteByTag('mytag');

// Events
cache.on('set', (data) => { ... });
cache.on('delete', (data) => { ... });
cache.on('expire', (data) => { ... });
cache.on('evict', (data) => { ... });
cache.on('clear', () => { ... });
```

---

## Final Words

This Cache is intentionally simple and dependency-free.  
It is great for:

- Speeding up repeated calculations
- Reducing calls to external APIs
- Temporary storage inside a single process
- Learning how caches work under the hood

If you later need a cache that survives restarts or is shared between many servers, look at Redis, Memcached, or similar tools.  
For most small-to-medium Node.js or browser applications, this class is more than enough.

Happy caching!