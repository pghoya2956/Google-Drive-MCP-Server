interface CacheEntry<T> {
  value: T;
  size: number;
  timestamp: number;
  lastAccessed: number;
}

export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private readonly maxSize: number; // in bytes
  private readonly ttl: number; // in milliseconds
  private currentSize: number = 0;

  constructor(maxSizeMB: number = 100, ttlMinutes: number = 30) {
    this.maxSize = maxSizeMB * 1024 * 1024; // Convert MB to bytes
    this.ttl = ttlMinutes * 60 * 1000; // Convert minutes to milliseconds
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.delete(key);
      return null;
    }

    // Update last accessed time
    entry.lastAccessed = Date.now();
    
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    return entry.value;
  }

  set(key: string, value: T, size: number): void {
    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // Check if new entry would exceed max size
    if (size > this.maxSize) {
      console.warn(`Cache entry size (${size} bytes) exceeds max cache size (${this.maxSize} bytes)`);
      return;
    }

    // Evict least recently used entries until there's enough space
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      const lruKey = this.cache.keys().next().value;
      if (lruKey) {
        this.delete(lruKey);
      }
    }

    // Add new entry
    const entry: CacheEntry<T> = {
      value,
      size,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
    };
    
    this.cache.set(key, entry);
    this.currentSize += size;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }

  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }

  getSize(): number {
    return this.currentSize;
  }

  getCount(): number {
    return this.cache.size;
  }

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.delete(key));
  }

  // Get cache statistics
  getStats(): {
    size: number;
    count: number;
    maxSize: number;
    hitRate: number;
  } {
    return {
      size: this.currentSize,
      count: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0, // Could track hits/misses for real hit rate
    };
  }
}

// Singleton instance for PDF cache
export const pdfCache = new LRUCache<any>(100, 30); // 100MB, 30 minutes TTL